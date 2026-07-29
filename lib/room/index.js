"use strict";

const EventEmitter = require("events");
const msgpack = require("notepack.io");
const {
  DistributedMap,
  DistributedTracking,
} = require("../broker/collections");
const {
  CoalescedUpdate,
  debounce,
  sort,
  toMessage,
  token,
} = require("../util");
const { randomRN } = require("../nicknames");
const { FloodProtector } = require("../tracking");
const { EMITTER: UPLOADS } = require("../upload");
const BROKER = require("../broker");
const CONFIG = require("../config");
const bans = require("../bans");
const { FileLister } = require("./filelister");
const LinkLister = require("./linklister");
const {
  normalizeLinkedRoomEntries,
  markLinkedClientFile,
  isCrossLinkingAllowed,
  sourceAllowsCrossLink,
  sourceAllowsPrivateCrossLink,
  resolveLinkedRoomEntries,
  filterLinkedSourceFiles,
  linkSourceStatus,
  linkVisibilityAllows,
} = require("./room-links");
const { isDeepLinksEnabled } = require("./deep-links");
const {
  normalizeGuestInvites,
  createGuestInvite,
  redeemGuestInvite,
  findGuestInvite,
  inviteRedeemability,
  serializeGuestInvite,
  guestInvitePath,
  revokeGuestInvite,
  countActiveGuestInvites,
  guestInviteCapacity,
  normalizeGuestInviteAudit,
  appendGuestInviteAudit,
} = require("./guest-invites");
const {
  normalizeRoomPlugins,
  upsertRoomPlugin,
  removeRoomPlugin,
  serializeRoomPlugins,
  findRoomPlugin,
} = require("../plugins/room-plugins");
const { memberJoinedAtKey } = require("./member-age");
const {
  normalizeFederatedRoomLinks,
  remoteFileToClient,
} = require("../federation/links");
const {
  currentConfig: currentFederationConfig,
  getRemoteRoomFiles,
  probePeerRoom,
} = require("../federation/transport");

const LOADING = Symbol();

const ROOMS = new Map();
const ROOM_LOADS = new Map();
const USERCOUNT_DEBOUNCE = 5000;

const redis = BROKER.getMethods("exists", "get", "set", "keys", "del");

const EXPIRER = new CoalescedUpdate(60000, rooms =>
  rooms.forEach(r => {
    if (r.maybeKill()) {
      return;
    }
    EXPIRER.add(r);
  }),
);

class Room extends EventEmitter {
  /**
   * Record that this room had activity right now.
   * Called on file upload and chat message.  Debounced to at most once per
   * 5 minutes to keep Redis writes cheap.
   */
  touchActivity() {
    const now = Date.now();
    const last = this.pconfig.get("lastActivity") || 0;
    if (now - last > 5 * 60 * 1000) {
      this.pconfig.set("lastActivity", now);
    }
  }

  /**
   * Return the first time this account/browser joined the room. Identity
   * values are hashed before being used as private room metadata keys.
   */
  async recordMemberJoin(account, roomToken, now = Date.now()) {
    await this[LOADING];
    const keys = [
      memberJoinedAtKey(this.roomid, "account", account),
      memberJoinedAtKey(this.roomid, "token", roomToken),
    ].filter(Boolean);
    if (!keys.length) {
      return 0;
    }

    const existing = keys.
      map(key => Number(this.pconfig.get(key))).
      filter(value => Number.isFinite(value) && value > 0);
    const joinedAt = existing.length ? Math.min(...existing) : now;

    for (const key of keys) {
      const current = Number(this.pconfig.get(key));
      if (!Number.isFinite(current) || current <= 0 || current > joinedAt) {
        this.pconfig.set(key, joinedAt);
      }
    }
    return joinedAt;
  }

  /**
   * Permanently delete a room by id: trash all its files, wipe Redis keys.
   * Safe to call whether or not the Room is currently loaded in this worker.
   */
  static async destroy(roomid) {
    // Evict from in-process cache if loaded
    const live = ROOMS.get(roomid);
    if (live) {
      live.localUserCount = 0;
      live.maybeKill();
    }

    // Delete all files belonging to the room
    await UPLOADS.loaded;
    const files = Array.from(await UPLOADS.for({ roomid }));
    if (files.length) {
      await UPLOADS.trash(files);
    }

    // Wipe Redis keys: existence marker, config, pconfig
    await redis.del(
      `rooms:${roomid}`,
      `map:rco:${roomid}`,
      `map:rpco:${roomid}`,
    );
    // Invalidate the cached room list
    await redis.del("roomlist");
    console.log(`[prune] Destroyed room ${roomid}`);
  }

  /**
   * Scan all rooms and delete those with no file or chat activity in the last
   * roomPruningDays days.  Runs once on startup then every 24 h.
   *
   * Rooms that predate the lastActivity field (no value stored) fall back to
   * the room creation timestamp stored as the value of the `rooms:${id}` key.
   * If neither timestamp can be determined the room is left alone.
   */
  static async prune() {
    if (!CONFIG.get("roomPruning")) {
      return 0;
    }
    const days = CONFIG.get("roomPruningDays") || 21;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const roomids = (await redis.keys("rooms:*")).map(r => r.slice(6));
    let pruned = 0;

    for (const roomid of roomids) {
      try {
        const pconfig = new DistributedMap(`rpco:${roomid}`);
        let lastActivity;
        try {
          await pconfig.loaded;
          lastActivity = pconfig.get("lastActivity");
        }
        finally {
          pconfig.kill();
        }

        // Fall back to room creation time stored as the key's value
        if (!lastActivity) {
          const created = await redis.get(`rooms:${roomid}`);
          lastActivity = created ? parseInt(created, 10) : null;
        }

        // Cannot determine activity age — leave the room alone
        if (!lastActivity || isNaN(lastActivity)) {
          continue;
        }

        if (lastActivity >= cutoff) {
          continue; // room is active
        }

        console.log(
          `[prune] Room ${roomid} inactive since ${new Date(lastActivity).toISOString()}, pruning…`,
        );
        await Room.destroy(roomid);
        pruned++;
      }
      catch (ex) {
        console.error(`[prune] Failed to evaluate room ${roomid}:`, ex.message);
      }
    }

    if (pruned > 0) {
      console.log(`[prune] Pruned ${pruned} inactive room(s)`);
    }
    return pruned;
  }

  static async list() {
    const cached = await redis.get("roomlist");
    if (cached) {
      return msgpack.decode(Buffer.from(cached, "binary"));
    }
    const roomids = (await redis.keys("rooms:*")).map(r => r.slice(6));
    const rooms = [];
    for (const roomid of roomids) {
      const config = new DistributedMap(`rco:${roomid}`);
      const pconfig = new DistributedMap(`rpco:${roomid}`);
      try {
        await config.loaded;
        await pconfig.loaded;
        const room = {
          roomid,
          name: config.get("roomname"),
          motd: config.get("rawmotd") || "",
          owners: sort(config.get("owners") || []),
          users: pconfig.get("usercount") || 0,
        };
        room.files = (await UPLOADS.for(room)).length;
        rooms.push(room);
      }
      catch (ex) {
        console.error("failed to read room", roomid, ex);
      }
      finally {
        config.kill();
        pconfig.kill();
      }
    }
    await redis.set(
      "roomlist",
      msgpack.encode(rooms).toString("binary"),
      "EX",
      10,
    );
    return rooms;
  }

  static async get(roomid) {
    let room = ROOMS.get(roomid);
    if (!room) {
      let pending = ROOM_LOADS.get(roomid);
      if (!pending) {
        pending = (async () => {
          const exists = await redis.exists(`rooms:${roomid}`);
          if (!exists) {
            return null;
          }
          const tracked = ROOMS.get(roomid);
          if (tracked) {
            return tracked;
          }
          const created = new Room(roomid);
          ROOMS.set(roomid, created);
          await created[LOADING];
          return created;
        })().finally(() => {
          ROOM_LOADS.delete(roomid);
        });
        ROOM_LOADS.set(roomid, pending);
      }
      room = await pending;
      if (!room) {
        return null;
      }
    }
    else {
      await room[LOADING];
    }
    EXPIRER.add(room);
    return room;
  }

  static async create(ip, user, rtoken) {
    const isMod = user && user.isMod;

    if (!CONFIG.get("roomCreation") && !isMod) {
      throw new Error("Room creation is disabled on this server");
    }

    if (
      !user &&
      (CONFIG.get("requireAccounts") ||
        CONFIG.get("roomCreationRequiresAccount"))
    ) {
      throw new Error("You cannot create rooms right now");
    }

    if (!isMod) {
      const fp = new FloodProtector(
        `flood:${ip}`,
        "roomFloods",
        CONFIG.get("roomFloodTrigger"),
        CONFIG.get("roomFloodDuration"),
      );
      if (await fp.bump()) {
        throw new Error("Cannot create this many rooms m8");
      }
    }

    if (!isMod) {
      const anyBans = await Promise.all(
        ["mute", "upload", "hellban"].map(b =>
          bans.findBan(b, ip, user && user.account),
        ),
      );
      if (anyBans.some(e => !!e)) {
        throw new Error("You cannot create rooms right now");
      }
    }

    let room;
    for (;;) {
      const roomid = await token(10);
      const created = await redis.set(`rooms:${roomid}`, Date.now(), "NX");
      if (created === "OK") {
        room = new Room(roomid);
        break;
      }
    }
    ROOMS.set(room.roomid, room);
    await room[LOADING];
    EXPIRER.add(room);
    if (user) {
      room.addOwner(user.account);
    }
    else if (token) {
      room.setTempOwner(rtoken);
    }
    return room;
  }

  constructor(roomid) {
    super();
    this.setMaxListeners(0);
    this.roomid = roomid;
    this.lastUserCount = 0;
    this.localUserCount = 0;
    this.files = new FileLister(this);
    this.links = new LinkLister(this);

    this.config = new DistributedMap(`rco:${this.roomid}`);
    this.pconfig = new DistributedMap(`rpco:${this.roomid}`);
    this.owners = new Set();
    this.invitees = new Set();
    this.onremovemessages = this.onremovemessages.bind(this);

    this.clients = new DistributedTracking(`clients:${this.roomid}`);
    this.clients.on(
      "update",
      debounce(() => {
        this.usercount = this.clients.size;
      }, USERCOUNT_DEBOUNCE),
    );

    this[LOADING] = (async () => {
      await this.config.loaded;
      await this.pconfig.loaded;
      await this.clients.loaded;
      this.owners = new Set(this.config.get("owners"));
      this.invitees = new Set(this.config.get("invitees"));
      if (!this.config.has("roomname")) {
        this.config.set("roomname", randomRN());
      }

      this.config.on("change", (key, val) => {
        switch (key) {
        case "owners":
          try {
            this.owners = new Set(val);
          }
          catch (ex) {
            this.owners = new Set();
            val = [];
          }
          break;

        case "invitees":
          try {
            this.invitees = new Set(val);
          }
          catch (ex) {
            this.invitees = new Set();
            val = [];
          }
          break;

        case "roomPlugins":
          try {
            const {
              defaultRoomPluginRuntime,
            } = require("../plugins/room-runtime");

            defaultRoomPluginRuntime.syncRoom(this.roomid, val);
          }
          catch (ex) {
            console.error("roomPlugins sync", ex);
          }
          break;
        }
        this.emit("config", key, val);
      });

      // Activate invited room bots (poll timers) when this room loads
      try {
        const { defaultRoomPluginRuntime } = require("../plugins/room-runtime");

        defaultRoomPluginRuntime.syncRoom(
          this.roomid,
          this.config.get("roomPlugins"),
        );
      }
      catch (ex) {
        console.error("roomPlugins initial sync", ex);
      }
    })();
    BROKER.on(`removeMessages:${this.roomid}`, this.onremovemessages);

    Object.seal(this);
    console.log(`Tracking room ${this.toString().bold}`);
  }

  get exportedRoomConfig() {
    const c = Array.from(this.config);
    c.unshift(["name", CONFIG.get("name")]);
    c.push(["ttl", this.fileTTL]);
    c.push(["maxFileSize", CONFIG.get("maxFileSize")]);
    c.push(["historySize", CONFIG.get("historySize")]);
    c.push(["downloadMaxConcurrent", CONFIG.get("downloadMaxConcurrent")]);
    c.push(["requireAccounts", CONFIG.get("requireAccounts")]);
    c.push(["roomCreation", CONFIG.get("roomCreation")]);
    c.push([
      "roomCreationRequiresAccount",
      CONFIG.get("roomCreationRequiresAccount"),
    ]);
    const rawAllowReq = this.config.get("allowRequests");
    c.push([
      "allowRequests",
      rawAllowReq !== undefined && rawAllowReq !== null ?
        !!rawAllowReq :
        CONFIG.get("allowRequests") !== false,
    ]);
    const rawLinkColl = this.config.get("linkCollection");
    c.push([
      "linkCollection",
      rawLinkColl !== undefined && rawLinkColl !== null ?
        !!rawLinkColl :
        CONFIG.get("linkCollection") !== false,
    ]);
    // Full link entries (roomId + optional rules/name) for Linking tab UI.
    c.push([
      "linkedRooms",
      normalizeLinkedRoomEntries(this.config.get("linkedRooms")),
    ]);
    c.push(["deepLinks", isDeepLinksEnabled(this.config.get("deepLinks"))]);
    c.push([
      "allowCrossLinking",
      isCrossLinkingAllowed(this.config.get("allowCrossLinking")),
    ]);
    c.push([
      "allowPrivateCrossLinking",
      isCrossLinkingAllowed(this.config.get("allowPrivateCrossLinking")),
    ]);
    const federation = currentFederationConfig();
    c.push([
      "federationPeers",
      federation.enabled ?
        federation.peers.
          filter(peer => peer.enabled).
          map(peer => ({
            peerId: peer.peerId,
            displayName: peer.displayName,
          })) :
        [],
    ]);
    c.push([
      "federatedRooms",
      normalizeFederatedRoomLinks(this.config.get("federatedRooms")),
    ]);
    c.push([
      "allowFederation",
      this.config.get("allowFederation") === true,
    ]);
    c.push([
      "allowPrivateFederation",
      this.config.get("allowPrivateFederation") === true,
    ]);
    // Invited bots for Room Options → Plugins (ids + enabled; full config via RPC)
    c.push([
      "roomPlugins",
      normalizeRoomPlugins(this.config.get("roomPlugins")).map(e => ({
        id: e.id,
        enabled: e.enabled,
        label: e.label,
      })),
    ]);
    return c;
  }

  get usercount() {
    return this.lastUserCount;
  }

  set usercount(nv) {
    this.pconfig.set("usercount", (this.lastUserCount = nv));
    this.emit("usercount", this.lastUserCount);
  }

  invited(user, token, guestInviteToken) {
    if (!this.config.get("inviteonly")) {
      return true;
    }
    // Already redeemed guest pass for this browser/session key (rtoken)
    if (token && this.hasGuestPass(token)) {
      return true;
    }
    // Fresh guest invite still has capacity (first hit before redeem)
    if (guestInviteToken && this.hasValidGuestInvite(guestInviteToken)) {
      return true;
    }
    if (!user) {
      return this.owns(user, token);
    }
    return (
      user.account &&
      (this.invitees.has(user.account) || this.owns(user.account, token))
    );
  }

  getGuestInvites() {
    return normalizeGuestInvites(this.config.get("guestInvites"));
  }

  getMaxActiveGuestInvites() {
    const roomValue = Number(this.config.get("maxActiveGuestInvites"));
    const globalValue = Number(CONFIG.get("maxActiveGuestInvitesPerRoom"));
    const value = Number.isFinite(roomValue) ? roomValue : globalValue;
    return Math.min(1000, Math.max(1, Math.floor(value || 25)));
  }

  getGuestInviteAuditLimit() {
    const value = Number(CONFIG.get("guestInviteAuditLimit"));
    return Math.min(1000, Math.max(1, Math.floor(value || 100)));
  }

  getGuestInviteAudit() {
    return normalizeGuestInviteAudit(
      this.pconfig.get("guestInviteAudit"),
      this.getGuestInviteAuditLimit(),
    );
  }

  recordGuestInviteAudit(event, details) {
    const next = appendGuestInviteAudit(
      this.getGuestInviteAudit(),
      event,
      details,
      this.getGuestInviteAuditLimit(),
    );
    this.pconfig.set("guestInviteAudit", next);
    return next;
  }

  hasValidGuestInvite(token) {
    const inv = findGuestInvite(this.getGuestInvites(), token);
    return !!(inv && inviteRedeemability(inv).ok);
  }

  /**
   * Session/browser keys that already redeemed a guest invite (pconfig map).
   * @returns {object} { [guestKey]: expiresAtMs }
   */
  getGuestPasses() {
    const raw = this.pconfig.get("guestPasses") || {};
    return raw && typeof raw === "object" ? raw : {};
  }

  hasGuestPass(guestKey) {
    const k = String(guestKey || "").trim();
    if (!k) {
      return false;
    }
    const exp = Number(this.getGuestPasses()[k]);
    if (!Number.isFinite(exp)) {
      return false;
    }
    if (Date.now() >= exp) {
      return false;
    }
    return true;
  }

  grantGuestPass(guestKey, invite) {
    const k = String(guestKey || "").trim();
    if (!k) {
      return;
    }
    const passes = Object.assign({}, this.getGuestPasses());
    const fallback = Date.now() + 24 * 3600 * 1000;
    const exp =
      invite &&
      invite.expiresAt != null &&
      Number.isFinite(Number(invite.expiresAt)) ?
        Number(invite.expiresAt) :
        fallback;
    passes[k] = Math.max(exp, Date.now() + 3600 * 1000);
    // prune expired
    const now = Date.now();
    for (const [key, e] of Object.entries(passes)) {
      if (!Number.isFinite(Number(e)) || Number(e) <= now) {
        delete passes[key];
      }
    }
    this.pconfig.set("guestPasses", passes);
  }

  /**
   * Mint a guest invite link (owner/mod).
   * @param {object} opts
   * @returns {{invite: object, path: string, urlPath: string}}
   */
  createGuestInviteLink(opts) {
    const current = this.getGuestInvites();
    const maxActive = this.getMaxActiveGuestInvites();
    const capacity = guestInviteCapacity(current, maxActive);
    if (!capacity.ok) {
      throw new Error(
        `This room already has the maximum of ${maxActive} active guest invites`,
      );
    }
    const inv = createGuestInvite(opts || {});
    const list = current.concat(inv);
    this.config.set("guestInvites", list);
    this.recordGuestInviteAudit("created", {
      token: inv.token,
      label: inv.label,
      actor: inv.createdBy,
      uses: inv.uses,
      maxUses: inv.maxUses,
    });
    try {
      const webhooks = require("../webhooks");

      webhooks.dispatch("guest_invite_created", {
        roomid: this.roomid,
        maxUses: inv.maxUses,
        expiresAt: inv.expiresAt,
        singleUse: inv.singleUse,
        label: inv.label,
      });
    }
    catch (_) {
      /* optional */
    }
    return {
      invite: serializeGuestInvite(inv, { fullToken: true }),
      path: guestInvitePath(this.roomid, inv.token),
      urlPath: guestInvitePath(this.roomid, inv.token),
    };
  }

  listGuestInviteLinks() {
    // Owners need full token to revoke / rebuild absolute URLs in Room Options.
    return this.getGuestInvites().map(i => {
      const s = serializeGuestInvite(i, { fullToken: true });
      const path = guestInvitePath(this.roomid, i.token);
      return Object.assign({}, s, {
        token: s.token,
        tokenFull: i.token,
        path,
        urlPath: path,
      });
    });
  }

  getGuestInviteAdminState() {
    const invites = this.listGuestInviteLinks();
    return {
      invites,
      audit: this.getGuestInviteAudit().slice().reverse(),
      activeCount: countActiveGuestInvites(this.getGuestInvites()),
      maxActive: this.getMaxActiveGuestInvites(),
    };
  }

  revokeGuestInviteLink(token, actor) {
    const current = this.getGuestInvites();
    const removed = findGuestInvite(current, token);
    const next = revokeGuestInvite(current, token);
    this.config.set("guestInvites", next);
    if (removed) {
      this.recordGuestInviteAudit("revoked", {
        token: removed.token,
        label: removed.label,
        actor: actor || "",
        uses: removed.uses,
        maxUses: removed.maxUses,
      });
    }
    return next.map(i => serializeGuestInvite(i));
  }

  /**
   * Consume one use of a guest invite and grant a session guest pass.
   * @param {string} token — invite token from ?invite=
   * @param {string} guestKey — usually browser rtoken
   * @returns {{ok: boolean, reason?: string, invite?: object}}
   */
  redeemGuestInviteToken(token, guestKey) {
    // Already has pass — do not burn another use
    if (guestKey && this.hasGuestPass(guestKey)) {
      return { ok: true, already: true };
    }
    const result = redeemGuestInvite(this.getGuestInvites(), token);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    this.config.set("guestInvites", result.invites);
    this.recordGuestInviteAudit("redeemed", {
      token: result.invite.token,
      label: result.invite.label,
      uses: result.invite.uses,
      maxUses: result.invite.maxUses,
    });
    if (guestKey) {
      this.grantGuestPass(guestKey, result.invite);
    }
    try {
      const webhooks = require("../webhooks");

      webhooks.dispatch("guest_invite_redeemed", {
        roomid: this.roomid,
        uses: result.invite.uses,
        maxUses: result.invite.maxUses,
        remaining: Math.max(0, result.invite.maxUses - result.invite.uses),
      });
    }
    catch (_) {
      /* optional */
    }
    return {
      ok: true,
      invite: serializeGuestInvite(result.invite, { fullToken: false }),
    };
  }

  /**
   * Room Options → Plugins: invited bots for this room.
   */
  getRoomPlugins() {
    return normalizeRoomPlugins(this.config.get("roomPlugins"));
  }

  listRoomPluginsDetailed() {
    let catalog = [];
    try {
      const { defaultRoomPluginRuntime } = require("../plugins/room-runtime");

      catalog = defaultRoomPluginRuntime.listCatalog();
    }
    catch (_) {
      catalog = [];
    }
    return serializeRoomPlugins(this.getRoomPlugins(), { catalog });
  }

  /**
   * Replace full roomPlugins list (owner/mod).
   * @param {unknown} raw
   */
  setRoomPlugins(raw) {
    const next = normalizeRoomPlugins(raw);
    // Validate each enabled plugin config against module schema when possible
    const { loadPluginModule } = require("../plugins/registry");

    for (const e of next) {
      if (!e.enabled) {
        continue;
      }
      const res = loadPluginModule(e.id);
      if (!res.ok) {
        throw new Error(`Unknown or unloadable plugin: ${e.id}`);
      }
      const cfg = Object.assign({}, e.config, { roomId: this.roomid });
      if (typeof res.plugin.validateConfig === "function") {
        const v = res.plugin.validateConfig(cfg);
        if (v && v.ok === false) {
          throw new Error(
            `${e.id}: ${(v.errors || ["invalid config"]).join("; ")}`,
          );
        }
      }
    }
    this.config.set("roomPlugins", next);
    try {
      const { defaultRoomPluginRuntime } = require("../plugins/room-runtime");

      defaultRoomPluginRuntime.syncRoom(this.roomid, next);
    }
    catch (ex) {
      console.error("setRoomPlugins sync", ex);
    }
    return this.listRoomPluginsDetailed();
  }

  /**
   * Invite or update one bot from the catalog.
   * @param {{id: string, enabled?: boolean, config?: object, label?: string}} entry
   */
  inviteRoomPlugin(entry) {
    const id = entry && entry.id;
    const res = require("../plugins/registry").loadPluginModule(id);

    if (!res.ok) {
      throw new Error(res.error || `Unknown plugin: ${id}`);
    }
    const next = upsertRoomPlugin(this.getRoomPlugins(), entry || {});
    // Validate
    const invited = findRoomPlugin(next, id);
    if (invited && invited.enabled) {
      const cfg = Object.assign({}, invited.config, { roomId: this.roomid });
      if (typeof res.plugin.validateConfig === "function") {
        const v = res.plugin.validateConfig(cfg);
        if (v && v.ok === false) {
          throw new Error((v.errors || ["invalid config"]).join("; "));
        }
      }
    }
    this.config.set("roomPlugins", next);
    try {
      const { defaultRoomPluginRuntime } = require("../plugins/room-runtime");

      defaultRoomPluginRuntime.syncRoom(this.roomid, next);
    }
    catch (ex) {
      console.error("inviteRoomPlugin sync", ex);
    }
    return this.listRoomPluginsDetailed();
  }

  revokeRoomPlugin(pluginId) {
    const next = removeRoomPlugin(this.getRoomPlugins(), pluginId);
    this.config.set("roomPlugins", next);
    try {
      const { defaultRoomPluginRuntime } = require("../plugins/room-runtime");

      defaultRoomPluginRuntime.syncRoom(this.roomid, next);
    }
    catch (ex) {
      console.error("revokeRoomPlugin sync", ex);
    }
    return this.listRoomPluginsDetailed();
  }

  /**
   * Run an invited bot once (manual "Run now").
   * @param {string} pluginId
   */
  async runRoomPluginNow(pluginId) {
    const { defaultRoomPluginRuntime } = require("../plugins/room-runtime");

    return defaultRoomPluginRuntime.runRoomPlugin(
      this.roomid,
      pluginId,
      { reason: "manual", force: true },
      this.getRoomPlugins(),
    );
  }

  async inspectRoomPluginSyncMemory(pluginId, opts) {
    const {
      inspectPluginSyncMemory,
    } = require("../plugins/sync-memory");

    return inspectPluginSyncMemory(this, pluginId, opts);
  }

  async clearRoomPluginSyncMemory(pluginId, opts) {
    const {
      clearPluginSyncMemory,
    } = require("../plugins/sync-memory");

    return clearPluginSyncMemory(this, pluginId, opts);
  }

  validateUser(user) {
    if (!user) {
      throw new Error(`Invalid user '${user}'`);
    }
    return user.toLowerCase();
  }

  get fileTTL() {
    return this.config.get("fileTTL") || CONFIG.get("TTL");
  }

  set fileTTL(arg) {
    if (
      typeof arg !== "number" ||
      (arg | 0) !== arg ||
      arg < 0 ||
      !isFinite(arg) ||
      arg > 168
    ) {
      throw new Error("Invalid file TTL");
    }
    this.config.set("fileTTL", arg);
  }
  setInviteOnly(arg) {
    this.config.set("inviteonly", !!arg);
  }

  setUsers(users, key) {
    this[key] = new Set(users.map(u => this.validateUser(u)));
    this.config.set(key, Array.from(this[key]));
  }

  setInvitees(invitees) {
    this.setUsers(invitees, "invitees");
  }

  setOwners(owners) {
    this.setUsers(owners, "owners");
  }

  addUser(user, key) {
    user = this.validateUser(user);
    if (this[key].has(user)) {
      return;
    }
    this[key].add(user);
    this.config.set(key, Array.from(this[key]));
  }

  removeUser(user, key) {
    user = this.validateUser(user);
    if (!this[key].has(user)) {
      return;
    }
    this[key].delete(user);
    this.config.set(key, Array.from(this[key]));
  }

  addInvitee(invitee) {
    this.addUser(invitee, "invitees");
  }

  removeInvitee(invitee) {
    this.removeUser(invitee, "invitees");
  }

  addOwner(owner) {
    this.addUser(owner, "owners");
  }

  removeOwner(owner) {
    this.removeUser(owner, "owners");
  }

  setTempOwner(rtoken) {
    if (!rtoken) {
      throw new Error("Invalid owner token");
    }
    this.pconfig.set("towner", rtoken);
  }

  owns(acct, rtoken) {
    return (
      (acct && this.owners.has(acct)) ||
      (rtoken && rtoken === this.pconfig.get("towner"))
    );
  }

  async setMOTD(arg) {
    if (!arg) {
      this.config.delete("motd");
      return "Removed MOTD";
    }
    if (arg.length > 500) {
      throw new Error("MOTD too long");
    }
    try {
      const motd = await toMessage(arg);
      if (this.config.get("rawmotd") === arg) {
        return "";
      }
      this.config.set("rawmotd", arg);
      this.config.set("motd", motd);
    }
    catch (ex) {
      throw new Error("Invalid MOTD");
    }
    return "";
  }

  async getFilesFor(client) {
    const local = await this.files.for(client.role, client.ip);
    const [linked, federated] = await Promise.all([
      this.collectLinkedClientFiles(client),
      this.collectFederatedClientFiles(client),
    ]);
    if (!linked.length && !federated.length) {
      return local;
    }
    // Prefer local keys when both appear (should be rare — keys are global).
    const localKeys = new Set(local.map(f => f.key));
    return local.concat(
      linked.concat(federated).filter(f => !localKeys.has(f.key)),
    );
  }

  /**
   * Finished uploads from rooms listed in config.linkedRooms, stamped as linked.
   * Destination viewers need not join the source room.
   * Source must have allowCrossLinking enabled or zero files are mirrored.
   * Invite-only sources require bilateral source/destination consent.
   * Per-link rules (name/tag/type/age) further filter which files appear.
   */
  async collectLinkedClientFiles(client) {
    const entries = normalizeLinkedRoomEntries(this.config.get("linkedRooms"));
    if (!entries.length) {
      return [];
    }
    const role = client.role || "white";
    const account = client.user && client.user.account;
    const owner = this.owns(account, client.token);
    const member =
      owner ||
      role === "mod" ||
      !!(account && this.invitees.has(account)) ||
      this.hasGuestPass(client.token);
    const viewer = {
      role,
      authenticated: !!account,
      member,
      owner,
    };
    const out = [];
    const seen = new Set();
    const now = Date.now();
    for (const entry of entries) {
      if (!linkVisibilityAllows(entry.visibility, viewer)) {
        continue;
      }
      const srcId = entry.roomId;
      if (srcId === this.roomid) {
        continue;
      }
      let src;
      try {
        src = await Room.get(srcId);
      }
      catch (_) {
        src = null;
      }
      if (!src) {
        continue;
      }
      // Source owner must opt in — knowing the id/name is not enough.
      if (!sourceAllowsCrossLink(src.config)) {
        continue;
      }
      if (
        src.config.get("inviteonly") &&
        (!entry.allowPrivateSource || !sourceAllowsPrivateCrossLink(src.config))
      ) {
        continue;
      }
      let files;
      try {
        files = await src.files.for(role, client.ip);
      }
      catch (_) {
        continue;
      }
      const roomName = entry.name || src.config.get("roomname") || srcId;
      const matched = filterLinkedSourceFiles(
        files,
        entry.rules || null,
        role,
        now,
      );
      for (const f of matched) {
        if (seen.has(f.key)) {
          continue;
        }
        seen.add(f.key);
        out.push(markLinkedClientFile(f, srcId, roomName));
      }
    }
    return out;
  }

  /**
   * Privacy-safe remote uploads from explicitly configured peer-room links.
   * Transport errors are isolated per peer so local and healthy linked files
   * continue loading.
   */
  async collectFederatedClientFiles(client) {
    const entries = normalizeFederatedRoomLinks(
      this.config.get("federatedRooms"),
    );
    if (!entries.length) {
      return [];
    }
    const role = client.role || "white";
    const account = client.user && client.user.account;
    const owner = this.owns(account, client.token);
    const member =
      owner ||
      role === "mod" ||
      !!(account && this.invitees.has(account)) ||
      this.hasGuestPass(client.token);
    const viewer = {
      role,
      authenticated: !!account,
      member,
      owner,
    };
    const out = [];
    const seen = new Set();
    const now = Date.now();
    for (const entry of entries) {
      if (!linkVisibilityAllows(entry.visibility, viewer)) {
        continue;
      }
      try {
        const remote = await getRemoteRoomFiles(entry.peerId, entry.roomId, {
          rules: entry.rules || null,
        });
        const link = Object.assign({}, entry, {
          peerDisplayName: remote.peer.displayName,
          name: entry.name || `${remote.peer.displayName} / ${remote.room.name}`,
        });
        const files = remote.files.
          filter(file => {
            const expires = Date.parse(file.expiresAt);
            return Number.isFinite(expires) && expires > now;
          }).
          map(file => remoteFileToClient(file, link, this.roomid));
        const privacySafeRules = entry.rules ?
          {
            nameContains: entry.rules.nameContains,
            types: entry.rules.types,
            maxAgeHours: entry.rules.maxAgeHours,
            minAgeHours: entry.rules.minAgeHours,
          } :
          null;
        for (const file of filterLinkedSourceFiles(
          files,
          privacySafeRules,
          role,
          now,
        )) {
          if (!seen.has(file.key)) {
            seen.add(file.key);
            out.push(file);
          }
        }
      }
      catch (error) {
        console.warn(
          `[federation] ${entry.peerId}/${entry.roomId}: ` +
            `${error.code || error.message}`,
        );
      }
    }
    return out;
  }

  /**
   * Resolve linked room tokens (ids and/or names) and store full link entries
   * with optional per-link rules. Backward-compatible with string id lists.
   * @param {unknown} list
   * @returns {Promise<Array<object>>}
   */
  async setLinkedRooms(list) {
    let catalog = [];
    try {
      catalog = await Room.list();
    }
    catch (ex) {
      console.error("setLinkedRooms catalog", ex);
      catalog = [];
    }
    const { entries, unresolved } = resolveLinkedRoomEntries(
      list,
      catalog,
      this.roomid,
    );
    if (unresolved.length) {
      throw new Error(
        `Unknown room(s): ${unresolved.join(", ")}. Use a room id or exact room name.`,
      );
    }
    const filtered = entries.filter(e => e.roomId !== this.roomid);
    this.config.set("linkedRooms", filtered);
    return filtered;
  }

  /**
   * Probe stored links for Linking-tab status (ok / denied / missing).
   * @returns {Promise<Array<object>>}
   */
  async probeLinkedRooms() {
    const entries = normalizeLinkedRoomEntries(this.config.get("linkedRooms"));
    const out = [];
    for (const entry of entries) {
      let exists = false;
      let allow = false;
      let privateSource = false;
      let allowPrivateCrossLinking = false;
      let name = entry.name || entry.roomId;
      try {
        const src = await Room.get(entry.roomId);
        if (src) {
          exists = true;
          allow = sourceAllowsCrossLink(src.config);
          privateSource = !!src.config.get("inviteonly");
          allowPrivateCrossLinking = sourceAllowsPrivateCrossLink(src.config);
          name = src.config.get("roomname") || name;
        }
      }
      catch (_) {
        exists = false;
      }
      out.push({
        roomId: entry.roomId,
        name,
        rules: entry.rules || null,
        visibility: entry.visibility || "all",
        allowPrivateSource: entry.allowPrivateSource === true,
        privateSourceAllowed: allowPrivateCrossLinking,
        status: linkSourceStatus({
          exists,
          allowCrossLinking: allow,
          privateSource,
          allowPrivateSource: entry.allowPrivateSource === true,
          allowPrivateCrossLinking,
        }),
      });
    }
    return out;
  }

  setFederatedRooms(raw) {
    const links = normalizeFederatedRoomLinks(raw);
    const federation = currentFederationConfig();
    const known = new Set(
      federation.peers.filter(peer => peer.enabled).map(peer => peer.peerId),
    );
    const unknown = links.
      map(link => link.peerId).
      filter(peerId => !known.has(peerId));
    if (unknown.length) {
      throw new Error(
        `Unknown federation peer(s): ${Array.from(new Set(unknown)).join(", ")}`,
      );
    }
    this.config.set("federatedRooms", links);
    return links;
  }

  async probeFederatedRooms() {
    const links = normalizeFederatedRoomLinks(
      this.config.get("federatedRooms"),
    );
    const rows = [];
    for (const link of links) {
      rows.push(
        Object.assign({}, link, await probePeerRoom(link.peerId, link.roomId)),
      );
    }
    return rows;
  }

  setAllowFederation(enabled) {
    this.config.set("allowFederation", !!enabled);
    return !!enabled;
  }

  setAllowPrivateFederation(enabled) {
    this.config.set("allowPrivateFederation", !!enabled);
    return !!enabled;
  }

  setDeepLinks(enabled) {
    this.config.set("deepLinks", !!enabled);
    return !!enabled;
  }

  setAllowCrossLinking(enabled) {
    this.config.set("allowCrossLinking", !!enabled);
    return !!enabled;
  }

  setAllowPrivateCrossLinking(enabled) {
    this.config.set("allowPrivateCrossLinking", !!enabled);
    return !!enabled;
  }

  async getFileInfo(key, client) {
    return await this.files.get(key, client.role, client.ip);
  }

  convertFiles(files, client) {
    return this.files.convert(files, client.role, client.ip);
  }

  ref() {
    this.localUserCount++;
  }

  async trackClient(ip) {
    await this[LOADING];
    if (ip && (await this.clients.incr(ip)) === 1) {
      this.lastUserCount++;
    }
    this.emit("usercount", this.lastUserCount);
  }

  async untrackClient(ip) {
    await this[LOADING];
    if ((await this.clients.decr(ip)) === 0) {
      this.lastUserCount--;
    }
    this.emit("usercount", this.lastUserCount);
  }

  unref() {
    this.localUserCount--;
  }

  maybeKill() {
    if (this.localUserCount > 0) {
      return false;
    }

    if (!ROOMS.delete(this.roomid)) {
      // Already gone
      return true;
    }

    this.emit("sudoku", this);
    console.log(`Untracked room ${this.toString().bold}`);
    this.removeAllListeners();
    this.config.kill();
    this.clients.kill();
    this.files.kill();
    BROKER.off(`removeMessages:${this.roomid}`, this.onremovemessages);
    return true;
  }

  onremovemessages(ids) {
    this.emit("removeMessages", ids);
  }

  async trash(files) {
    return await this.files.trash(files);
  }

  async trashOwned(files, ip, account) {
    return await this.files.trashOwned(files, ip, account);
  }

  async ban(mod, subjects, opts) {
    await bans.ban(
      this.roomid,
      {
        name: mod.name,
        role: mod.role,
      },
      subjects,
      opts,
    );
  }

  async unban(mod, subjects, opts) {
    await bans.unban(
      this.roomid,
      {
        name: mod.name,
        role: mod.role,
      },
      subjects,
      opts,
    );
  }

  async nuke(mod) {
    this.config.set("disabled", true);
    this.config.set("roomname", "[closed]");
    await this.setMOTD("");
    await bans.nuke(this.roomid, mod);
  }

  async blacklist(mod, options, files) {
    await this.files.blacklist(mod, options, files);
  }

  async whitelist(mod, files) {
    await this.files.whitelist(mod, files);
  }

  toString() {
    return `Room<${this.roomid}>`;
  }
}

module.exports = { Room };
