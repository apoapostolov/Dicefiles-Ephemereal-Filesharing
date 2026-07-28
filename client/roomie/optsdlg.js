"use strict";

import Modal from "../modal";
import registry from "../registry";
import { UsersModal } from "./usersdlg";
import {
  normalizeLinkedRoomEntries,
  validateLinkRules,
  serializeLinkedRoomEntries,
  summarizeLinkRules,
  summarizeLinkAccess,
  LINK_FILE_TYPES,
} from "../../lib/room/room-links";

const INVITE_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
});
const INVITE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function compactInviteText(value, maxLength = 12) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  const visible = maxLength - 1;
  const start = Math.ceil(visible / 2);
  const end = Math.floor(visible / 2);
  return `${text.slice(0, start)}…${text.slice(-end)}`;
}

function compactInviteToken(value) {
  const token = String(value || "").trim();
  if (!token) {
    return "Invite";
  }
  if (token.includes("…") && token.length <= 12) {
    return token;
  }
  return token.length > 8 ?
      `${token.slice(0, 4)}…${token.slice(-4)}` :
      token;
}

function compactInviteDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${INVITE_DATE_FORMAT.format(date)} ${INVITE_TIME_FORMAT.format(date)}`;
}

/**
 * Room Options — General + Linking + Plugins tabs.
 * Linking table stores per-source filters/rules; saved as linkedRooms entries.
 * Plugins tab invites bots from the server registry and stores roomPlugins.
 */
export class OptionsModal extends Modal {
  constructor(owner) {
    super(
      "optsdlg",
      "Room Options",
      {
        text: "Change",
        default: true,
      },
      {
        text: "Cancel",
        cancel: true,
      },
    );
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#roomopts-tmpl").innerHTML;

    const fields = [
      "owners",
      "invitees",
      "name",
      "motd",
      "inviteonly",
      "adult",
      "allowrequests",
      "linkcollection",
      "deeplinks",
      "allowcrosslinking",
      "allowprivatecrosslinking",
      "allowfederation",
      "allowprivatefederation",
      "linkedrooms",
      "disabled",
      "disablereports",
      "ttl",
      "linkaddtoken",
      "linkaddbtn",
      "linktbody",
      "linkempty",
      "federationpeer",
      "federationroom",
      "federationaddbtn",
      "federationtbody",
      "federationempty",
      "linkeditor",
      "linkeditorlabel",
      "rule_name",
      "rule_tag",
      "rule_user",
      "linkruleerror",
      "rule_maxage",
      "rule_minage",
      "linkvisibility",
      "linkprivate",
      "linkeditorapply",
      "linkeditorclear",
      "linkeditorsclose",
      "linkhelpbtn",
      "linkhelp",
      "linkhelpclose",
      "crosslinkhelpbtn",
      "crosslinkhelp",
      "invitesingle",
      "invitemax",
      "invitehours",
      "invitelabel",
      "invitecreate",
      "inviteurlfield",
      "invitelimitsbtn",
      "invitelimitspanel",
      "invitelimitsclose",
      "invitecopy",
      "invitetbody",
      "inviteempty",
      "invitecap",
      "inviteaudittbody",
      "inviteauditempty",
      "pluginpick",
      "plugininvite",
      "plugindesc",
      "plugintbody",
      "pluginempty",
      "plugineditor",
      "plugineditorlabel",
      "plugineditorfields",
      "pluginenabled",
      "pluginapply",
      "pluginrun",
      "pluginrevoke",
      "pluginclose",
      "pluginstatus",
    ];
    for (const f of fields) {
      this[f] = this.el.elements[f] || this.el.querySelector(`[name="${f}"]`);
    }

    // Type checkboxes
    this.ruleTypeBoxes = {};
    for (const t of LINK_FILE_TYPES) {
      this.ruleTypeBoxes[t] = this.el.elements[`rule_type_${t}`];
    }

    this.linkEntries = [];
    this.federationLinks = [];
    this.federationPeers = [];
    this.editingRoomId = null;
    this.activeTab = "general";
    this.pluginCatalog = [];
    this.roomPlugins = [];
    this.editingPluginId = null;

    this.owners.addEventListener("click", this.onowners.bind(this));
    this.invitees.addEventListener("click", this.oninvitees.bind(this));
    this.inviteonly.addEventListener("change", this.oninviteonly.bind(this));
    if (this.allowcrosslinking) {
      this.allowcrosslinking.addEventListener("change", () =>
        this.syncPrivateCrossLinkControl(),
      );
    }

    this.el.querySelectorAll("[data-roomopts-tab]").forEach((btn) => {
      btn.addEventListener("click", () => this.setTab(btn.dataset.roomoptsTab));
    });

    if (this.linkaddbtn) {
      this.linkaddbtn.addEventListener("click", () => this.onAddLink());
    }
    if (this.linkaddtoken) {
      this.linkaddtoken.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          this.onAddLink();
        }
      });
    }
    if (this.federationaddbtn) {
      this.federationaddbtn.addEventListener("click", () =>
        this.onAddFederationLink(),
      );
    }
    if (this.federationroom) {
      this.federationroom.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          this.onAddFederationLink();
        }
      });
    }
    if (this.linkeditorapply) {
      this.linkeditorapply.addEventListener("click", () => this.onApplyRules());
    }
    if (this.linkeditorclear) {
      this.linkeditorclear.addEventListener("click", () => this.onClearRules());
    }
    if (this.linkeditorsclose) {
      this.linkeditorsclose.addEventListener("click", () => this.closeEditor());
    }
    if (this.linkhelpbtn) {
      this.linkhelpbtn.addEventListener("click", () => this.toggleLinkHelp());
    }
    if (this.linkhelpclose) {
      this.linkhelpclose.addEventListener("click", () =>
        this.setLinkHelp(false),
      );
    }
    if (this.crosslinkhelpbtn) {
      this.crosslinkhelpbtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.toggleCrosslinkHelp();
      });
    }
    if (this.invitecreate) {
      this.invitecreate.addEventListener("click", () =>
        this.onCreateGuestInvite(),
      );
    }
    if (this.invitelimitsbtn) {
      this.invitelimitsbtn.addEventListener("click", () =>
        this.toggleInviteLimitsPanel(),
      );
    }
    if (this.invitelimitsclose) {
      this.invitelimitsclose.addEventListener("click", () =>
        this.setInviteLimitsPanel(false),
      );
    }
    if (this.invitecopy) {
      this.invitecopy.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyInviteLink(
          this.inviteurlfield && this.inviteurlfield.value,
          this.invitecopy,
        );
      });
    }
    if (this.invitesingle) {
      this.invitesingle.addEventListener("change", () => {
        if (this.invitesingle.checked && this.invitemax) {
          this.invitemax.value = "1";
        }
      });
    }
    if (this.plugininvite) {
      this.plugininvite.addEventListener("click", () => this.onInvitePlugin());
    }
    if (this.pluginpick) {
      this.pluginpick.addEventListener("change", () =>
        this.onPluginPickChange(),
      );
    }
    if (this.pluginapply) {
      this.pluginapply.addEventListener("click", () =>
        this.onApplyPluginSettings(),
      );
    }
    if (this.pluginrun) {
      this.pluginrun.addEventListener("click", () => this.onRunPlugin());
    }
    if (this.pluginrevoke) {
      this.pluginrevoke.addEventListener("click", () => this.onRevokePlugin());
    }
    if (this.pluginclose) {
      this.pluginclose.addEventListener("click", () =>
        this.closePluginEditor(),
      );
    }

    const { config: c } = registry;
    this.name.value = c.get("roomname");
    this.motd.value = c.get("rawmotd") || "";
    this.inviteonly.checked = !!c.get("inviteonly");
    this.adult.checked = !!c.get("adult");
    this.allowrequests.checked = c.get("allowRequests") !== false;
    this.linkcollection.checked = c.get("linkCollection") !== false;
    if (this.deeplinks) {
      this.deeplinks.checked = !!c.get("deepLinks");
    }
    if (this.allowcrosslinking) {
      this.allowcrosslinking.checked = !!c.get("allowCrossLinking");
    }
    if (this.allowprivatecrosslinking) {
      this.allowprivatecrosslinking.checked = !!c.get(
        "allowPrivateCrossLinking",
      );
    }
    if (this.allowfederation) {
      this.allowfederation.checked = !!c.get("allowFederation");
    }
    if (this.allowprivatefederation) {
      this.allowprivatefederation.checked = !!c.get(
        "allowPrivateFederation",
      );
    }
    this.disabled.checked = !!c.get("disabled");
    this.disablereports.checked = !!c.get("disableReports");
    this.ttl.value = c.get("fileTTL") || 0;
    this.owners = null;
    this.invitees = null;

    this.linkEntries = normalizeLinkedRoomEntries(c.get("linkedRooms")).map(
      (e) => Object.assign({ status: "unknown" }, e),
    );
    this._initialLinkedSerialized = serializeLinkedRoomEntries(
      this.linkEntries,
    );
    this.renderLinkTable();
    this.probeLinkStatuses();
    this.federationPeers = Array.isArray(c.get("federationPeers"))
      ? c.get("federationPeers")
      : [];
    this.federationLinks = Array.isArray(c.get("federatedRooms"))
      ? c.get("federatedRooms").map((row) =>
          Object.assign({ status: "unknown" }, row),
        )
      : [];
    this._initialFederationSerialized = JSON.stringify(
      this.federationLinks.map(({ status, error, ...row }) => row),
    );
    this.renderFederationPeerOptions();
    this.renderFederationTable();
    this.probeFederationStatuses();
    this.guestInvites = [];
    this.guestInviteAudit = [];
    this.refreshGuestInvites();
    this.refreshPlugins();

    this.syncInviteCopyVisibility();
    this.oninviteonly();
    this.syncPrivateCrossLinkControl();
    this.setTab("general");
  }

  onshown() {
    super.onshown();
    const holder = this.el.parentElement;
    if (!holder) {
      return;
    }

    this._modalPinnedTop = this.el.getBoundingClientRect().top;
    holder.classList.add("modal-holder-roomopts-pinned");
    this.el.style.marginTop = `${this._modalPinnedTop}px`;

    this._modalViewportResize = () => this.queueModalVerticalFit();
    addEventListener("resize", this._modalViewportResize);
    if (typeof ResizeObserver !== "undefined") {
      this._modalResizeObserver = new ResizeObserver(() =>
        this.queueModalVerticalFit(),
      );
      this._modalResizeObserver.observe(this.el);
    }
    this.queueModalVerticalFit();
  }

  onhidden() {
    if (this._modalFitFrame) {
      cancelAnimationFrame(this._modalFitFrame);
      this._modalFitFrame = null;
    }
    if (this._modalResizeObserver) {
      this._modalResizeObserver.disconnect();
      this._modalResizeObserver = null;
    }
    if (this._modalViewportResize) {
      removeEventListener("resize", this._modalViewportResize);
      this._modalViewportResize = null;
    }
    const holder = this.el.parentElement;
    if (holder) {
      holder.classList.remove("modal-holder-roomopts-pinned");
    }
    this.el.style.marginTop = "";
  }

  queueModalVerticalFit() {
    if (!this.el.parentElement || this._modalFitFrame) {
      return;
    }
    this._modalFitFrame = requestAnimationFrame(() => {
      this._modalFitFrame = null;
      this.fitModalVertically();
    });
  }

  fitModalVertically() {
    if (!this.el.parentElement) {
      return;
    }
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const rect = this.el.getBoundingClientRect();
    const gutter = Math.max(6, Math.min(16, viewportHeight * 0.02));
    const preferredTop = Number.isFinite(this._modalPinnedTop)
      ? this._modalPinnedTop
      : rect.top;
    const highestAllowedTop = Math.max(
      gutter,
      viewportHeight - rect.height - gutter,
    );
    const nextTop = Math.max(
      gutter,
      Math.min(preferredTop, highestAllowedTop),
    );
    this._modalPinnedTop = nextTop;
    this.el.style.marginTop = `${Math.round(nextTop)}px`;
  }

  async refreshPlugins() {
    if (!registry.socket) {
      return;
    }
    try {
      const rv = await registry.socket.makeCall(
        "setconfig",
        "listPluginCatalog",
        null,
      );
      this.pluginCatalog = (rv && rv.catalog) || [];
      this.roomPlugins = (rv && rv.roomPlugins) || [];
      this.renderPluginCatalog();
      this.renderPluginTable();
    } catch (ex) {
      console.warn("listPluginCatalog", ex);
      this.pluginCatalog = [];
      this.roomPlugins = [];
      this.renderPluginCatalog();
      this.renderPluginTable();
    }
  }

  renderPluginCatalog() {
    const sel = this.pluginpick;
    if (!sel) {
      return;
    }
    const invited = new Set((this.roomPlugins || []).map((p) => p.id));
    const available = (this.pluginCatalog || []).filter((c) => c.available);
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = available.length
      ? "Select a bot…"
      : "No plugins installed on server";
    sel.appendChild(ph);
    for (const c of available) {
      const opt = document.createElement("option");
      const catalogName = c.name || c.botName || c.id;
      opt.value = c.id;
      opt.textContent = invited.has(c.id)
        ? `${catalogName} (already invited)`
        : catalogName;
      opt.disabled = invited.has(c.id);
      sel.appendChild(opt);
    }
    this.onPluginPickChange();
  }

  onPluginPickChange() {
    const id = this.pluginpick && this.pluginpick.value;
    const cat = (this.pluginCatalog || []).find((c) => c.id === id);
    if (this.plugindesc) {
      this.plugindesc.textContent = cat
        ? cat.description || cat.name || ""
        : "Bots appear in the file list with a cyan BOT pill when they upload.";
    }
  }

  renderPluginTable() {
    const tbody = this.plugintbody;
    const empty = this.pluginempty;
    if (!tbody) {
      return;
    }
    tbody.innerHTML = "";
    const list = this.roomPlugins || [];
    if (empty) {
      empty.classList.toggle("hidden", list.length > 0);
    }
    for (const p of list) {
      const tr = document.createElement("tr");
      const nameTd = document.createElement("td");
      nameTd.innerHTML = "";
      const pill = document.createElement("span");
      pill.className = "roomopts-bot-pill";
      pill.textContent = "BOT";
      const nm = document.createElement("span");
      nm.className = "roomopts-bot-name";
      nm.textContent = p.botName || p.name || p.id;
      nameTd.appendChild(pill);
      nameTd.appendChild(document.createTextNode(" "));
      nameTd.appendChild(nm);
      if (p.label) {
        const lab = document.createElement("div");
        lab.className = "roomopts-field-hint";
        lab.textContent = p.label;
        nameTd.appendChild(lab);
      }

      const stTd = document.createElement("td");
      stTd.textContent = !p.available
        ? "Unavailable"
        : p.enabled
          ? "Enabled"
          : "Disabled";
      stTd.className = p.enabled && p.available ? "roomopts-status-ok" : "";

      const setTd = document.createElement("td");
      const summary = this.summarizePluginConfig(p);
      setTd.textContent = summary;
      setTd.title = summary;

      const actTd = document.createElement("td");
      actTd.className = "roomopts-link-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Settings";
      edit.addEventListener("click", () => this.openPluginEditor(p.id));
      actTd.appendChild(edit);

      tr.appendChild(nameTd);
      tr.appendChild(stTd);
      tr.appendChild(setTd);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
  }

  summarizePluginConfig(p) {
    const c = (p && p.config) || {};
    const bits = [];
    if (c.folderUrl) {
      bits.push("folder set");
    }
    if (c.pollIntervalMinutes) {
      bits.push(`poll ${c.pollIntervalMinutes}m`);
    }
    if (c.namePrefix) {
      bits.push(`prefix ${c.namePrefix}`);
    }
    if (c.botName) {
      bits.push(c.botName);
    }
    if (c.webhookUrl) {
      bits.push("Discord connected");
    }
    if (c.chatId) {
      bits.push(`Telegram ${c.chatId}`);
    }
    if (c.baseUrl) {
      bits.push("public URL set");
    }
    return bits.length ? bits.join(" · ") : "—";
  }

  async onInvitePlugin() {
    const id = this.pluginpick && this.pluginpick.value;
    if (!id) {
      await this.owner.showMessage(
        "Pick a bot from the catalog first.",
        "Plugins",
        "i-info",
      );
      return;
    }
    const cat = (this.pluginCatalog || []).find((c) => c.id === id);
    // Open editor with defaults for new invite (save on Apply)
    this.editingPluginId = id;
    this.openPluginEditor(id, {
      id,
      enabled: true,
      config: this.defaultConfigForSchema(cat && cat.configSchema),
      botName: (cat && cat.botName) || (cat && cat.name) || id,
      name: (cat && cat.name) || id,
      configSchema: cat && cat.configSchema,
      available: true,
      _new: true,
    });
  }

  defaultConfigForSchema(schema) {
    const cfg = {};
    const props = (schema && schema.properties) || {};
    for (const [k, def] of Object.entries(props)) {
      if (k === "roomId") {
        continue;
      }
      if (def && def.type === "number") {
        cfg[k] = k === "pollIntervalMinutes" ? 15 : 0;
      } else if (def && def.type === "boolean") {
        cfg[k] = false;
      } else if (def && def.type === "array") {
        cfg[k] = [];
      } else if (k === "botName") {
        cfg[k] = "";
      } else {
        cfg[k] = "";
      }
    }
    return cfg;
  }

  openPluginEditor(pluginId, forced) {
    const p =
      forced || (this.roomPlugins || []).find((x) => x.id === pluginId) || null;
    if (!p) {
      return;
    }
    this.editingPluginId = p.id;
    if (this.plugineditor) {
      this.plugineditor.classList.remove("hidden");
    }
    if (this.plugineditorlabel) {
      this.plugineditorlabel.textContent = p.botName || p.name || p.id;
    }
    if (this.pluginenabled) {
      this.pluginenabled.checked = p.enabled !== false;
    }
    if (this.pluginstatus) {
      this.pluginstatus.textContent = p._new
        ? "Fill required fields and Save to invite this bot."
        : "";
    }
    this.renderPluginEditorFields(p);
  }

  renderPluginEditorFields(p) {
    const host = this.plugineditorfields;
    if (!host) {
      return;
    }
    host.innerHTML = "";
    const schema =
      p.configSchema ||
      ((this.pluginCatalog || []).find((c) => c.id === p.id) || {})
        .configSchema;
    const props = (schema && schema.properties) || {};
    const keys = Object.keys(props).filter((k) => k !== "roomId");
    const config = Object.assign({}, p.config || {});

    // Always show common free-form if schema empty
    const fieldKeys =
      keys.length > 0
        ? keys
        : ["folderUrl", "namePrefix", "pollIntervalMinutes", "botName"];

    for (const key of fieldKeys) {
      const def = props[key] || {};
      const wrap = document.createElement("div");
      wrap.className = "roomopts-field";
      const lab = document.createElement("label");
      lab.htmlFor = `roomopts-plugin-${key}`;
      lab.textContent =
        def.description ||
        key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      const input = document.createElement("input");
      input.id = `roomopts-plugin-${key}`;
      input.name = `plugin_cfg_${key}`;
      input.autocomplete = "off";
      if (def.type === "boolean") {
        input.type = "checkbox";
        input.checked = config[key] === true;
      } else if (def.type === "number" || key === "pollIntervalMinutes") {
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.value =
          config[key] != null && config[key] !== ""
            ? String(config[key])
            : key === "pollIntervalMinutes"
              ? "15"
              : "";
      } else {
        input.type = "text";
        input.value = config[key] != null ? String(config[key]) : "";
        if (key === "folderUrl") {
          input.placeholder = "https://mega.nz/folder/…";
        }
        if (
          key === "password" ||
          def.writeOnly === true ||
          def.format === "password"
        ) {
          input.type = "password";
          input.placeholder =
            def.description && /\benv\b/i.test(def.description)
              ? "optional when configured through env"
              : "";
        }
      }
      if (input.type === "checkbox") {
        wrap.className = "roomopts-checks roomopts-plugin-check";
        lab.prepend(input);
        wrap.appendChild(lab);
      } else {
        wrap.appendChild(lab);
        wrap.appendChild(input);
      }
      host.appendChild(wrap);
    }
  }

  readPluginEditorConfig() {
    const host = this.plugineditorfields;
    const config = {};
    if (!host) {
      return config;
    }
    host.querySelectorAll("input[name^='plugin_cfg_']").forEach((input) => {
      const key = input.name.replace(/^plugin_cfg_/, "");
      if (input.type === "checkbox") {
        config[key] = input.checked;
      } else if (input.type === "number") {
        const n = Number(input.value);
        if (input.value !== "" && Number.isFinite(n)) {
          config[key] = n;
        }
      } else if (input.value.trim()) {
        config[key] = input.value.trim();
      }
    });
    return config;
  }

  closePluginEditor() {
    this.editingPluginId = null;
    if (this.plugineditor) {
      this.plugineditor.classList.add("hidden");
    }
    if (this.pluginstatus) {
      this.pluginstatus.textContent = "";
    }
  }

  async onApplyPluginSettings() {
    const id = this.editingPluginId;
    if (!id || !registry.socket) {
      return;
    }
    const config = this.readPluginEditorConfig();
    const enabled = this.pluginenabled ? this.pluginenabled.checked : true;
    try {
      if (this.pluginstatus) {
        this.pluginstatus.textContent = "Saving…";
      }
      const list = await registry.socket.makeCall(
        "setconfig",
        "inviteRoomPlugin",
        { id, enabled, config },
      );
      this.roomPlugins = Array.isArray(list) ? list : [];
      this.renderPluginCatalog();
      this.renderPluginTable();
      if (this.pluginstatus) {
        this.pluginstatus.textContent = "Saved.";
      }
      // Re-open editor with saved row
      this.openPluginEditor(id);
    } catch (ex) {
      if (this.pluginstatus) {
        this.pluginstatus.textContent = "";
      }
      await this.owner.showMessage(
        ex.message || ex.toString(),
        "Plugin settings",
        "i-error",
      );
    }
  }

  async onRunPlugin() {
    const id = this.editingPluginId;
    if (!id || !registry.socket) {
      return;
    }
    try {
      if (this.pluginstatus) {
        this.pluginstatus.textContent = "Running…";
      }
      const rv = await registry.socket.makeCall("setconfig", "runRoomPlugin", {
        id,
      });
      const uploaded = rv && rv.uploaded;
      const skipped = rv && rv.skipped;
      if (this.pluginstatus) {
        this.pluginstatus.textContent =
          uploaded != null
            ? `Done — uploaded ${uploaded}, skipped ${skipped || 0}.`
            : "Run finished.";
      }
    } catch (ex) {
      if (this.pluginstatus) {
        this.pluginstatus.textContent = "";
      }
      await this.owner.showMessage(
        ex.message || ex.toString(),
        "Run plugin",
        "i-error",
      );
    }
  }

  async onRevokePlugin() {
    const id = this.editingPluginId;
    if (!id || !registry.socket) {
      return;
    }
    try {
      const list = await registry.socket.makeCall(
        "setconfig",
        "revokeRoomPlugin",
        { id },
      );
      this.roomPlugins = Array.isArray(list) ? list : [];
      this.closePluginEditor();
      this.renderPluginCatalog();
      this.renderPluginTable();
    } catch (ex) {
      await this.owner.showMessage(
        ex.message || ex.toString(),
        "Remove plugin",
        "i-error",
      );
    }
  }

  async refreshGuestInvites() {
    if (!registry.socket || !this.invitetbody) {
      return;
    }
    try {
      const state = await registry.socket.makeCall(
        "setconfig",
        "getGuestInviteAdminState",
        null,
      );
      this.guestInvites =
        state && Array.isArray(state.invites) ? state.invites : [];
      this.guestInviteAudit =
        state && Array.isArray(state.audit) ? state.audit : [];
      if (this.invitecap) {
        this.invitecap.textContent =
          state && Number.isFinite(state.maxActive)
            ? `${state.activeCount || 0} of ${state.maxActive} active`
            : "";
      }
      this.renderGuestInvites();
      this.renderGuestInviteAudit();
    } catch (ex) {
      console.warn("getGuestInviteAdminState", ex);
      this.guestInvites = [];
      this.guestInviteAudit = [];
      this.renderGuestInvites();
      this.renderGuestInviteAudit();
    }
  }

  guestInviteAbsoluteUrl(inv) {
    if (!inv) {
      return "";
    }
    if (inv.urlPath || inv.path) {
      const p = inv.urlPath || inv.path;
      return p.startsWith("http") ? p : `${document.location.origin}${p}`;
    }
    const token = inv.tokenFull || inv.token;
    if (!token) {
      return "";
    }
    // Prefer path from server; fall back to current room URL
    const roomPath = document.location.pathname || "";
    const base = roomPath.startsWith("/r/")
      ? roomPath
      : `/r/${(registry.config && registry.config.get && registry.config.get("roomid")) || ""}`;
    const path = `${base}?invite=${encodeURIComponent(token)}`;
    return `${document.location.origin}${path}`;
  }

  setInviteLimitsPanel(open) {
    if (!this.invitelimitspanel) {
      return;
    }
    this.invitelimitspanel.classList.toggle("hidden", !open);
    if (this.invitelimitsbtn) {
      this.invitelimitsbtn.setAttribute(
        "aria-expanded",
        open ? "true" : "false",
      );
    }
  }

  toggleInviteLimitsPanel() {
    if (!this.invitelimitspanel) {
      return;
    }
    this.setInviteLimitsPanel(
      this.invitelimitspanel.classList.contains("hidden"),
    );
  }

  syncInviteCopyVisibility() {
    if (!this.invitecopy) {
      return;
    }
    const hasLink = !!(
      this.inviteurlfield && this.inviteurlfield.value.trim()
    );
    this.invitecopy.hidden = !hasLink;
    this.invitecopy.disabled = !hasLink;
  }

  /**
   * Copy helper — same affordance as welcome room URL (i-copy + .copied flash).
   * @param {string} text
   * @param {HTMLElement} [iconEl]
   */
  async copyInviteLink(text, iconEl) {
    const value = (text || "").trim();
    if (!value) {
      await this.owner.showMessage(
        "Generate an invite link first.",
        "Guest invite",
        "i-info",
      );
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const i = document.createElement("input");
        i.type = "text";
        i.value = value;
        (iconEl || document.body).appendChild(i);
        i.select();
        document.execCommand("copy");
        i.remove();
      }
      if (iconEl) {
        iconEl.classList.add("copied");
        setTimeout(() => iconEl.classList.remove("copied"), 2000);
      }
    } catch (ex) {
      console.error(ex);
      await this.owner.showMessage(
        "Could not copy to clipboard.",
        "Guest invite",
        "i-error",
      );
    }
  }

  renderGuestInvites() {
    const tbody = this.invitetbody;
    const empty = this.inviteempty;
    if (!tbody) {
      return;
    }
    tbody.innerHTML = "";
    const list = this.guestInvites || [];
    if (empty) {
      empty.classList.toggle("hidden", list.length > 0);
    }
    for (const inv of list) {
      const fullUrl = this.guestInviteAbsoluteUrl(inv);
      const tr = document.createElement("tr");

      const td1 = document.createElement("td");
      td1.className = "roomopts-invite-link-cell";
      const label = document.createElement("span");
      label.className = "link-source-name";
      const fullLabel =
        inv.label || (inv.singleUse ? "Single-use" : "Multi-use");
      label.textContent = compactInviteText(
        inv.label || (inv.singleUse ? "Single" : "Multi"),
      );
      label.title = fullLabel;
      const linkRow = document.createElement("div");
      linkRow.className = "roomopts-invite-url-line";
      const separator = document.createElement("span");
      separator.className = "roomopts-invite-link-separator";
      separator.textContent = "·";
      const linkText = document.createElement("span");
      linkText.className = "roomopts-invite-url-text";
      linkText.textContent = compactInviteToken(inv.tokenFull || inv.token);
      linkText.title = fullUrl || "";
      const copyA = document.createElement("a");
      copyA.href = "#";
      copyA.className = "roomopts-invite-copy icon i-copy";
      copyA.title = "Copy link";
      copyA.setAttribute("role", "button");
      copyA.setAttribute("aria-label", "Copy invite link to clipboard");
      copyA.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.copyInviteLink(fullUrl, copyA);
      });
      linkRow.appendChild(label);
      linkRow.appendChild(separator);
      linkRow.appendChild(linkText);
      linkRow.appendChild(copyA);
      td1.appendChild(linkRow);

      const td2 = document.createElement("td");
      td2.textContent = `${inv.uses || 0}/${inv.maxUses || 1}`;
      td2.title = `${inv.uses || 0} of ${inv.maxUses || 1} uses`;
      const td3 = document.createElement("td");
      td3.textContent = inv.expiresAt
        ? compactInviteDate(inv.expiresAt)
        : "Never";
      td3.title = inv.expiresAt
        ? new Date(inv.expiresAt).toLocaleString()
        : "No expiry";
      const td4 = document.createElement("td");
      td4.className = "roomopts-link-actions";
      const rev = document.createElement("button");
      rev.type = "button";
      rev.textContent = "Revoke";
      rev.addEventListener("click", () => this.onRevokeGuestInvite(inv));
      td4.appendChild(rev);

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      tbody.appendChild(tr);
    }
  }

  renderGuestInviteAudit() {
    const tbody = this.inviteaudittbody;
    if (!tbody) {
      return;
    }
    tbody.innerHTML = "";
    const list = this.guestInviteAudit || [];
    if (this.inviteauditempty) {
      this.inviteauditempty.classList.toggle("hidden", list.length > 0);
    }
    const eventLabels = {
      created: "Create",
      redeemed: "Redeem",
      revoked: "Revoke",
    };
    for (const record of list) {
      const tr = document.createElement("tr");
      const event = document.createElement("td");
      event.textContent = eventLabels[record.event] || record.event;
      event.title = record.event || "";
      const link = document.createElement("td");
      const fullInviteLabel =
        record.label || record.tokenHint || "Guest invite";
      link.textContent = compactInviteText(fullInviteLabel);
      link.title = record.label
        ? `${record.label} · ${record.tokenHint || "Invite"}`
        : record.tokenHint || "";
      const uses = document.createElement("td");
      uses.textContent = `${record.uses || 0}/${record.maxUses || 1}`;
      uses.title = `${record.uses || 0} of ${record.maxUses || 1} uses`;
      const actor = document.createElement("td");
      const fullActor = record.actor || "Guest";
      actor.textContent = compactInviteText(fullActor);
      actor.title = fullActor;
      const at = document.createElement("td");
      at.textContent = record.at ? compactInviteDate(record.at) : "—";
      at.title = record.at ? new Date(record.at).toLocaleString() : "";
      tr.appendChild(event);
      tr.appendChild(link);
      tr.appendChild(uses);
      tr.appendChild(actor);
      tr.appendChild(at);
      tbody.appendChild(tr);
    }
  }

  async onCreateGuestInvite() {
    try {
      const singleUse = !!(this.invitesingle && this.invitesingle.checked);
      let maxUses = this.invitemax ? parseInt(this.invitemax.value, 10) : 1;
      if (!Number.isFinite(maxUses) || maxUses < 1) {
        maxUses = 1;
      }
      if (singleUse) {
        maxUses = 1;
      }
      let maxAgeHours = null;
      if (this.invitehours && this.invitehours.value !== "") {
        maxAgeHours = Number(this.invitehours.value);
      }
      const label = this.invitelabel ? this.invitelabel.value.trim() : "";
      const rv = await registry.socket.makeCall(
        "setconfig",
        "createGuestInvite",
        {
          singleUse,
          maxUses,
          maxAgeHours,
          label,
        },
      );
      const path = (rv && (rv.path || rv.urlPath)) || "";
      const full =
        path && document.location
          ? path.startsWith("http")
            ? path
            : `${document.location.origin}${path}`
          : "";
      if (this.inviteurlfield) {
        this.inviteurlfield.value = full || "";
        this.inviteurlfield.title = full || "";
      }
      this.syncInviteCopyVisibility();
      // Keep limits panel open so user can tweak and mint again; flash copy
      if (this.invitecopy && full) {
        this.invitecopy.classList.add("copied");
        setTimeout(() => {
          if (this.invitecopy) {
            this.invitecopy.classList.remove("copied");
          }
        }, 2000);
      }
      await this.refreshGuestInvites();
    } catch (ex) {
      await this.owner.showMessage(ex.message || ex, "Guest invite", "i-error");
    }
  }

  async onRevokeGuestInvite(inv) {
    try {
      await registry.socket.makeCall("setconfig", "revokeGuestInvite", {
        token: inv.tokenFull || inv.token,
      });
      // Clear gen field if it was this invite
      if (this.inviteurlfield && inv) {
        const url = this.guestInviteAbsoluteUrl(inv);
        if (this.inviteurlfield.value === url) {
          this.inviteurlfield.value = "";
          this.inviteurlfield.title = "";
        }
      }
      this.syncInviteCopyVisibility();
      await this.refreshGuestInvites();
    } catch (ex) {
      await this.owner.showMessage(ex.message || ex, "Guest invite", "i-error");
    }
  }

  setTab(tab) {
    if (this.el.parentElement) {
      this._modalPinnedTop = this.el.getBoundingClientRect().top;
    }
    const allowed = new Set(["general", "invites", "linking", "plugins"]);
    this.activeTab = allowed.has(tab) ? tab : "general";
    this.el.querySelectorAll("[data-roomopts-tab]").forEach((btn) => {
      const on = btn.dataset.roomoptsTab === this.activeTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    this.el.querySelectorAll("[data-roomopts-panel]").forEach((panel) => {
      const on = panel.dataset.roomoptsPanel === this.activeTab;
      panel.classList.toggle("hidden", !on);
    });
    // Help (?) only on Linking tab
    if (this.linkhelpbtn) {
      this.linkhelpbtn.classList.toggle("hidden", this.activeTab !== "linking");
    }
    if (this.activeTab !== "linking") {
      this.setLinkHelp(false);
    }
    if (this.activeTab === "linking") {
      this.probeLinkStatuses();
    }
    if (this.activeTab === "invites") {
      this.refreshGuestInvites();
    } else {
      this.setInviteLimitsPanel(false);
    }
    if (this.activeTab === "plugins") {
      this.refreshPlugins();
    } else {
      this.closePluginEditor();
    }
    this.queueModalVerticalFit();
  }

  setLinkHelp(open) {
    if (!this.linkhelp) {
      return;
    }
    this.linkhelp.classList.toggle("hidden", !open);
    if (this.linkhelpbtn) {
      this.linkhelpbtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  toggleLinkHelp() {
    if (!this.linkhelp) {
      return;
    }
    this.setLinkHelp(this.linkhelp.classList.contains("hidden"));
  }

  setCrosslinkHelp(open) {
    if (!this.crosslinkhelp) {
      return;
    }
    this.crosslinkhelp.classList.toggle("hidden", !open);
    if (this.crosslinkhelpbtn) {
      this.crosslinkhelpbtn.setAttribute(
        "aria-expanded",
        open ? "true" : "false",
      );
    }
  }

  toggleCrosslinkHelp() {
    if (!this.crosslinkhelp) {
      return;
    }
    this.setCrosslinkHelp(this.crosslinkhelp.classList.contains("hidden"));
  }

  async probeLinkStatuses() {
    if (!registry.socket || !this.linkEntries.length) {
      this.renderLinkTable();
      return;
    }
    try {
      const rv = await registry.socket.makeCall("probelinks");
      const rows = (rv && rv.links) || [];
      const byId = new Map(rows.map((r) => [r.roomId, r]));
      this.linkEntries = this.linkEntries.map((e) => {
        const live = byId.get(e.roomId);
        if (!live) {
          return Object.assign({}, e, { status: e.status || "unknown" });
        }
        return Object.assign({}, e, live, {
          roomId: e.roomId,
          name: live.name || e.name,
          rules: e.rules || live.rules || null,
          visibility: live.visibility || e.visibility || "all",
          allowPrivateSource:
            live.allowPrivateSource === true || e.allowPrivateSource === true,
          status: live.status || "unknown",
        });
      });
      this.renderLinkTable();
    } catch (ex) {
      // Non-fatal: table still shows stored links without live status
      console.warn("probelinks", ex);
      this.renderLinkTable();
    }
  }

  renderFederationPeerOptions() {
    if (!this.federationpeer) {
      return;
    }
    this.federationpeer.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = this.federationPeers.length
      ? "Choose trusted peer"
      : "No trusted peers configured";
    this.federationpeer.appendChild(placeholder);
    for (const peer of this.federationPeers) {
      const option = document.createElement("option");
      option.value = peer.peerId;
      option.textContent = `${peer.displayName || peer.peerId} (${peer.peerId})`;
      this.federationpeer.appendChild(option);
    }
    if (this.federationaddbtn) {
      this.federationaddbtn.disabled = !this.federationPeers.length;
    }
  }

  onAddFederationLink() {
    const peerId = String(this.federationpeer?.value || "").trim();
    const roomId = String(this.federationroom?.value || "").trim();
    if (!peerId || !roomId) {
      return;
    }
    if (
      this.federationLinks.some(
        (row) => row.peerId === peerId && row.roomId === roomId,
      )
    ) {
      return;
    }
    const peer = this.federationPeers.find((row) => row.peerId === peerId);
    this.federationLinks.push({
      peerId,
      roomId,
      name: `${(peer && peer.displayName) || peerId} / ${roomId}`,
      status: "unknown",
    });
    this.federationroom.value = "";
    this.renderFederationTable();
    this.probeFederationStatuses();
  }

  removeFederationLink(peerId, roomId) {
    this.federationLinks = this.federationLinks.filter(
      (row) => row.peerId !== peerId || row.roomId !== roomId,
    );
    this.renderFederationTable();
  }

  async probeFederationStatuses() {
    if (!registry.socket || !this.federationLinks.length) {
      return;
    }
    try {
      const rv = await registry.socket.makeCall("probefederationlinks");
      const rows = (rv && rv.links) || [];
      const byKey = new Map(
        rows.map((row) => [`${row.peerId}\0${row.roomId}`, row]),
      );
      this.federationLinks = this.federationLinks.map((row) =>
        Object.assign(
          {},
          row,
          byKey.get(`${row.peerId}\0${row.roomId}`) || {},
        ),
      );
      this.renderFederationTable();
    } catch (ex) {
      console.warn("probefederationlinks", ex);
    }
  }

  renderFederationTable() {
    if (!this.federationtbody) {
      return;
    }
    this.federationtbody.innerHTML = "";
    if (this.federationempty) {
      this.federationempty.classList.toggle(
        "hidden",
        this.federationLinks.length > 0,
      );
    }
    for (const entry of this.federationLinks) {
      const tr = document.createElement("tr");
      const source = document.createElement("td");
      source.className = "link-col-source";
      const peer = this.federationPeers.find(
        (row) => row.peerId === entry.peerId,
      );
      const title = document.createElement("div");
      title.className = "link-source-name";
      title.textContent =
        entry.name ||
        `${(peer && peer.displayName) || entry.peerId} / ${entry.roomId}`;
      const id = document.createElement("div");
      id.className = "link-source-id";
      id.textContent = `${entry.peerId} · ${entry.roomId}`;
      source.append(title, id);

      const status = document.createElement("td");
      status.className = "link-col-status";
      const labels = {
        active: "Active",
        unreachable: "Unreachable",
        denied: "Denied",
        missing: "Missing",
        "key-invalid": "Key invalid",
        "protocol-mismatch": "Protocol mismatch",
        "circuit-open": "Temporarily paused",
        unknown: "Checking…",
      };
      status.textContent = labels[entry.status] || entry.status || "Checking…";

      const actions = document.createElement("td");
      actions.className = "link-col-actions";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () =>
        this.removeFederationLink(entry.peerId, entry.roomId),
      );
      actions.appendChild(remove);
      tr.append(source, status, actions);
      this.federationtbody.appendChild(tr);
    }
  }

  renderLinkTable() {
    const tbody = this.linktbody;
    const empty = this.linkempty;
    if (!tbody) {
      return;
    }
    tbody.innerHTML = "";
    const list = this.linkEntries;
    if (empty) {
      empty.classList.toggle("hidden", list.length > 0);
    }
    for (const entry of list) {
      const tr = document.createElement("tr");
      tr.dataset.roomId = entry.roomId;
      const status = entry.status || "unknown";
      tr.classList.add(`link-status-${status}`);
      if (status === "missing" || status === "denied" || status === "private") {
        tr.classList.add("link-row-inactive");
      }

      const tdSrc = document.createElement("td");
      tdSrc.className = "link-col-source";
      const name = entry.name || entry.roomId;
      tdSrc.innerHTML = `<div class="link-source-name"></div><div class="link-source-id"></div>`;
      tdSrc.querySelector(".link-source-name").textContent = name;
      tdSrc.querySelector(".link-source-id").textContent = entry.roomId;

      const tdStatus = document.createElement("td");
      tdStatus.className = "link-col-status";
      const label =
        status === "ok"
          ? "Active"
          : status === "denied"
            ? "Cross-link off"
            : status === "private"
              ? "Private source"
              : status === "missing"
                ? "Missing"
                : "Unknown";
      tdStatus.textContent = label;
      tdStatus.title =
        status === "denied"
          ? "Source room has not enabled Allow Room Cross-Linking"
          : status === "private"
            ? "Invite-only mirroring requires approval in both the source room and this destination link"
            : status === "missing"
              ? "Source room not found"
              : status === "ok"
                ? "Source allows cross-linking"
                : "Status not probed yet";

      const tdRules = document.createElement("td");
      tdRules.className = "link-col-rules";
      const filterSummary = document.createElement("div");
      filterSummary.textContent = summarizeLinkRules(entry.rules || null);
      const accessSummary = document.createElement("div");
      accessSummary.className = "link-access-summary";
      accessSummary.textContent = summarizeLinkAccess(entry);
      tdRules.appendChild(filterSummary);
      tdRules.appendChild(accessSummary);

      const tdAct = document.createElement("td");
      tdAct.className = "link-col-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.textContent = "Edit";
      editBtn.className = "link-btn-edit";
      editBtn.addEventListener("click", () => this.openEditor(entry.roomId));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "Remove";
      delBtn.className = "link-btn-remove";
      delBtn.addEventListener("click", () => this.onRemoveLink(entry.roomId));
      tdAct.appendChild(editBtn);
      tdAct.appendChild(delBtn);

      tr.appendChild(tdSrc);
      tr.appendChild(tdStatus);
      tr.appendChild(tdRules);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }

    if (this.linkedrooms) {
      this.linkedrooms.value = serializeLinkedRoomEntries(this.linkEntries);
    }
  }

  onAddLink() {
    const token = (this.linkaddtoken && this.linkaddtoken.value.trim()) || "";
    if (!token) {
      return;
    }
    // Client-side: store token as roomId if it looks like one, else as pending
    // name; server resolves on save.
    const existing = this.linkEntries.find(
      (e) =>
        e.roomId === token ||
        (e.name && e.name.toLowerCase() === token.toLowerCase()),
    );
    if (existing) {
      this.owner.showMessage(
        "That room is already in the link list.",
        "Linking",
        "i-warning",
      );
      return;
    }
    // Tentative entry: roomId may be a name until save/resolve
    this.linkEntries.push({
      roomId: token,
      name: token,
      rules: null,
      status: "unknown",
      _token: token,
    });
    if (this.linkaddtoken) {
      this.linkaddtoken.value = "";
    }
    this.renderLinkTable();
  }

  onRemoveLink(roomId) {
    this.linkEntries = this.linkEntries.filter((e) => e.roomId !== roomId);
    if (this.editingRoomId === roomId) {
      this.closeEditor();
    }
    this.renderLinkTable();
  }

  openEditor(roomId) {
    const entry = this.linkEntries.find((e) => e.roomId === roomId);
    if (!entry || !this.linkeditor) {
      return;
    }
    this.editingRoomId = roomId;
    this.linkeditor.classList.remove("hidden");
    if (this.linkeditorlabel) {
      this.linkeditorlabel.textContent = entry.name || entry.roomId;
    }
    const rules = entry.rules || {};
    if (this.rule_name) {
      this.rule_name.value = rules.nameContains || "";
    }
    if (this.rule_tag) {
      this.rule_tag.value = rules.tagContains || "";
    }
    if (this.rule_user) {
      this.rule_user.value = rules.userContains || "";
    }
    this.clearRuleError();
    if (this.rule_maxage) {
      this.rule_maxage.value =
        rules.maxAgeHours != null ? String(rules.maxAgeHours) : "";
    }
    if (this.rule_minage) {
      this.rule_minage.value =
        rules.minAgeHours != null ? String(rules.minAgeHours) : "";
    }
    if (this.linkvisibility) {
      this.linkvisibility.value = entry.visibility || "all";
    }
    if (this.linkprivate) {
      this.linkprivate.checked = entry.allowPrivateSource === true;
    }
    const types = new Set(rules.types || []);
    for (const t of LINK_FILE_TYPES) {
      const box = this.ruleTypeBoxes[t];
      if (box) {
        box.checked = types.has(t);
      }
    }
  }

  closeEditor() {
    this.editingRoomId = null;
    if (this.linkeditor) {
      this.linkeditor.classList.add("hidden");
    }
  }

  readEditorRulesRaw() {
    const types = [];
    for (const t of LINK_FILE_TYPES) {
      const box = this.ruleTypeBoxes[t];
      if (box && box.checked) {
        types.push(t);
      }
    }
    const raw = {
      nameContains: this.rule_name ? this.rule_name.value : "",
      tagContains: this.rule_tag ? this.rule_tag.value : "",
      userContains: this.rule_user ? this.rule_user.value : "",
      types,
      maxAgeHours: this.rule_maxage ? this.rule_maxage.value : "",
      minAgeHours: this.rule_minage ? this.rule_minage.value : "",
    };
    return raw;
  }

  clearRuleError() {
    if (this.linkruleerror) {
      this.linkruleerror.textContent = "";
      this.linkruleerror.classList.add("hidden");
    }
    for (const input of [this.rule_name, this.rule_tag, this.rule_user]) {
      if (input) {
        input.removeAttribute("aria-invalid");
      }
    }
  }

  showRuleErrors(errors) {
    const fieldMap = {
      nameContains: this.rule_name,
      tagContains: this.rule_tag,
      userContains: this.rule_user,
    };
    const messages = Object.values(errors);
    if (this.linkruleerror) {
      this.linkruleerror.textContent = messages.join(" ");
      this.linkruleerror.classList.remove("hidden");
    }
    let firstInvalid = null;
    for (const [field, input] of Object.entries(fieldMap)) {
      if (!input || !errors[field]) {
        continue;
      }
      input.setAttribute("aria-invalid", "true");
      if (!firstInvalid) {
        firstInvalid = input;
      }
    }
    if (firstInvalid) {
      firstInvalid.focus();
    }
  }

  onApplyRules() {
    if (!this.editingRoomId) {
      return;
    }
    this.clearRuleError();
    const validation = validateLinkRules(this.readEditorRulesRaw());
    if (!validation.valid) {
      this.showRuleErrors(validation.errors);
      return;
    }
    const rules = validation.rules;
    this.linkEntries = this.linkEntries.map((e) => {
      if (e.roomId !== this.editingRoomId) {
        return e;
      }
      const next = Object.assign({}, e);
      if (rules) {
        next.rules = rules;
      } else {
        delete next.rules;
      }
      const visibility = this.linkvisibility
        ? this.linkvisibility.value
        : "all";
      if (visibility && visibility !== "all") {
        next.visibility = visibility;
      } else {
        delete next.visibility;
      }
      if (this.linkprivate && this.linkprivate.checked) {
        next.allowPrivateSource = true;
      } else {
        delete next.allowPrivateSource;
      }
      return next;
    });
    this.renderLinkTable();
    this.closeEditor();
  }

  onClearRules() {
    if (!this.editingRoomId) {
      return;
    }
    this.linkEntries = this.linkEntries.map((e) => {
      if (e.roomId !== this.editingRoomId) {
        return e;
      }
      const next = Object.assign({}, e);
      delete next.rules;
      return next;
    });
    this.clearRuleError();
    this.openEditor(this.editingRoomId);
    this.renderLinkTable();
  }

  /** Payload for setconfig linkedRooms (server resolves names). */
  buildLinkedRoomsPayload() {
    return this.linkEntries.map((e) => {
      const o = {
        roomId: e._token || e.roomId,
      };
      // Prefer real roomId when it is a valid stored id (probe may have fixed name)
      if (e.roomId && !e._token) {
        o.roomId = e.roomId;
      }
      if (e.name) {
        o.name = e.name;
      }
      if (e.rules) {
        o.rules = e.rules;
      }
      if (e.visibility && e.visibility !== "all") {
        o.visibility = e.visibility;
      }
      if (e.allowPrivateSource) {
        o.allowPrivateSource = true;
      }
      // If entry was added by name only, send name as token
      if (e._token) {
        o.roomId = e._token;
      }
      return o;
    });
  }

  async showUsersDlg(title, description, users, warnSelf) {
    try {
      const list = this[users] || registry.config.get(users) || [];
      const usersDlg = new UsersModal(
        this.owner,
        title,
        description,
        list,
        warnSelf,
      );
      await this.owner.showModal(usersDlg);
      this[users] = usersDlg.users;
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  oninviteonly() {
    if (this.inviteonly.checked) {
      this.el.elements.invitees.classList.remove("hidden");
    } else {
      this.el.elements.invitees.classList.add("hidden");
    }
  }

  syncPrivateCrossLinkControl() {
    if (!this.allowprivatecrosslinking) {
      return;
    }
    const enabled = !!(
      this.allowcrosslinking && this.allowcrosslinking.checked
    );
    this.allowprivatecrosslinking.disabled = !enabled;
    this.allowprivatecrosslinking.title = enabled
      ? "Additionally allow invite-only sources to be mirrored"
      : "Enable room cross-linking first";
  }

  async onowners() {
    await this.showUsersDlg(
      "Room Owners",
      `
Room owners can manage room options, just like yourself.
They can also add and remove room owners (including you), so be
very careful who you add.`,
      "owners",
      true,
    );
  }

  async oninvitees() {
    await this.showUsersDlg(
      "Room Invitees",
      `
Only invited users and room owners can join this room.
Once you remove a user, they will be kicked!
However, if they started any downloads before being kicked, those downloads
will NOT be aborted, and they also retain their chat histories.`,
      "invitees",
    );
  }

  async validate() {
    try {
      const { socket, config: c } = registry;
      const { value: name } = this.name;
      const { value: motd } = this.motd;
      let { value: ttl } = this.ttl;
      const { checked: inviteonly } = this.inviteonly;
      const { checked: adult } = this.adult;
      const { checked: allowRequests } = this.allowrequests;
      const { checked: linkCollection } = this.linkcollection;
      const deepLinks = !!(this.deeplinks && this.deeplinks.checked);
      const allowCrossLinking = !!(
        this.allowcrosslinking && this.allowcrosslinking.checked
      );
      const allowPrivateCrossLinking = !!(
        this.allowprivatecrosslinking && this.allowprivatecrosslinking.checked
      );
      const allowFederation = !!(
        this.allowfederation && this.allowfederation.checked
      );
      const allowPrivateFederation = !!(
        this.allowprivatefederation &&
        this.allowprivatefederation.checked
      );
      const linkedPayload = this.buildLinkedRoomsPayload();
      const { checked: disabled } = this.disabled;
      const { checked: disableReports } = this.disablereports;

      ttl = parseInt(ttl, 10);
      if (ttl.toString() !== this.ttl.value) {
        throw new Error("Invalid ttl (1)");
      }
      if (ttl < 0 || !isFinite(ttl)) {
        throw new Error("Invalid ttl");
      }

      if (name !== c.get("roomname")) {
        await socket.makeCall("setconfig", "name", name);
      }
      if (motd !== c.get("rawmotd")) {
        await socket.makeCall("setconfig", "motd", motd);
      }
      if (adult !== !!c.get("adult")) {
        await socket.makeCall("setconfig", "adult", adult);
      }
      if (allowRequests !== (c.get("allowRequests") !== false)) {
        await socket.makeCall("setconfig", "allowRequests", allowRequests);
      }
      if (linkCollection !== (c.get("linkCollection") !== false)) {
        await socket.makeCall("setconfig", "linkCollection", linkCollection);
      }
      if (deepLinks !== !!c.get("deepLinks")) {
        await socket.makeCall("setconfig", "deepLinks", deepLinks);
      }
      if (allowCrossLinking !== !!c.get("allowCrossLinking")) {
        await socket.makeCall(
          "setconfig",
          "allowCrossLinking",
          allowCrossLinking,
        );
      }
      if (allowPrivateCrossLinking !== !!c.get("allowPrivateCrossLinking")) {
        await socket.makeCall(
          "setconfig",
          "allowPrivateCrossLinking",
          allowPrivateCrossLinking,
        );
      }
      if (allowFederation !== !!c.get("allowFederation")) {
        await socket.makeCall(
          "setconfig",
          "allowFederation",
          allowFederation,
        );
      }
      if (
        allowPrivateFederation !== !!c.get("allowPrivateFederation")
      ) {
        await socket.makeCall(
          "setconfig",
          "allowPrivateFederation",
          allowPrivateFederation,
        );
      }

      const nowSerialized = serializeLinkedRoomEntries(this.linkEntries);
      const needSaveLinks =
        nowSerialized !== this._initialLinkedSerialized ||
        this.linkEntries.some((e) => e._token);
      if (needSaveLinks) {
        await socket.makeCall("setconfig", "linkedRooms", linkedPayload);
      }
      const federationPayload = this.federationLinks.map(
        ({ status, error, peerName, roomName, ...row }) => row,
      );
      if (
        JSON.stringify(federationPayload) !==
        this._initialFederationSerialized
      ) {
        await socket.makeCall(
          "setconfig",
          "federatedRooms",
          federationPayload,
        );
      }

      if (registry.chatbox.role === "mod") {
        if (disabled !== !!c.get("disabled")) {
          await socket.makeCall("setconfig", "disabled", disabled);
        }
        if (ttl !== (c.get("fileTTL") || 0)) {
          await socket.makeCall("setconfig", "fileTTL", ttl);
        }
        if (disableReports !== !!c.get("disableReports")) {
          await socket.makeCall("setconfig", "disableReports", disableReports);
        }
      }

      if (this.invitees) {
        await socket.makeCall("setconfig", "invitees", this.invitees);
      }
      if (inviteonly !== !!c.get("inviteonly")) {
        await socket.makeCall("setconfig", "inviteonly", inviteonly);
      }
      if (this.owners) {
        await socket.makeCall("setconfig", "owners", this.owners);
      }
      return true;
    } catch (ex) {
      await this.owner.showMessage(ex.message || ex, "Error", "i-error");
    }
    return false;
  }
}
