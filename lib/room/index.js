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

const LOADING = Symbol();

const ROOMS = new Map();
const USERCOUNT_DEBOUNCE = 5000;

const redis = BROKER.getMethods("exists", "get", "set", "keys", "del");

const EXPIRER = new CoalescedUpdate(60000, (rooms) =>
  rooms.forEach((r) => {
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

    const roomids = (await redis.keys("rooms:*")).map((r) => r.slice(6));
    let pruned = 0;

    for (const roomid of roomids) {
      try {
        const pconfig = new DistributedMap(`rpco:${roomid}`);
        let lastActivity;
        try {
          await pconfig.loaded;
          lastActivity = pconfig.get("lastActivity");
        } finally {
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
      } catch (ex) {
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
    const roomids = (await redis.keys("rooms:*")).map((r) => r.slice(6));
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
      } catch (ex) {
        console.error("failed to read room", roomid, ex);
      } finally {
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
      const exists = await redis.exists(`rooms:${roomid}`);
      if (!exists) {
        return null;
      }
      ROOMS.set(roomid, (room = new Room(roomid)));
    }
    await room[LOADING];
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
        ["mute", "upload", "hellban"].map((b) =>
          bans.findBan(b, ip, user && user.account),
        ),
      );
      if (anyBans.some((e) => !!e)) {
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
    } else if (token) {
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
            } catch (ex) {
              this.owners = new Set();
              val = [];
            }
            break;

          case "invitees":
            try {
              this.invitees = new Set(val);
            } catch (ex) {
              this.invitees = new Set();
              val = [];
            }
            break;
        }
        this.emit("config", key, val);
      });
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
      rawAllowReq !== undefined && rawAllowReq !== null
        ? !!rawAllowReq
        : CONFIG.get("allowRequests") !== false,
    ]);
    const rawLinkColl = this.config.get("linkCollection");
    c.push([
      "linkCollection",
      rawLinkColl !== undefined && rawLinkColl !== null
        ? !!rawLinkColl
        : CONFIG.get("linkCollection") !== false,
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

  invited(user, token) {
    if (!this.config.get("inviteonly")) {
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
    this[key] = new Set(users.map((u) => this.validateUser(u)));
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
    } catch (ex) {
      throw new Error("Invalid MOTD");
    }
    return "";
  }

  async getFilesFor(client) {
    return await this.files.for(client.role, client.ip);
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
