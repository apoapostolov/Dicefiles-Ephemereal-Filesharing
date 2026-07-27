"use strict";

import Modal from "../modal";
import registry from "../registry";
import { UsersModal } from "./usersdlg";
import {
  normalizeLinkedRoomEntries,
  normalizeLinkRules,
  serializeLinkedRoomEntries,
  summarizeLinkRules,
  LINK_FILE_TYPES,
} from "../../lib/room/room-links";

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
      "linkedrooms",
      "disabled",
      "disablereports",
      "ttl",
      "linkaddtoken",
      "linkaddbtn",
      "linktbody",
      "linkempty",
      "linkeditor",
      "linkeditorlabel",
      "rule_name",
      "rule_tag",
      "rule_maxage",
      "rule_minage",
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
    this.editingRoomId = null;
    this.activeTab = "general";
    this.pluginCatalog = [];
    this.roomPlugins = [];
    this.editingPluginId = null;

    this.owners.addEventListener("click", this.onowners.bind(this));
    this.invitees.addEventListener("click", this.oninvitees.bind(this));
    this.inviteonly.addEventListener("change", this.oninviteonly.bind(this));

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
      this.linkhelpclose.addEventListener("click", () => this.setLinkHelp(false));
    }
    if (this.crosslinkhelpbtn) {
      this.crosslinkhelpbtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.toggleCrosslinkHelp();
      });
    }
    if (this.invitecreate) {
      this.invitecreate.addEventListener("click", () => this.onCreateGuestInvite());
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
      this.pluginpick.addEventListener("change", () => this.onPluginPickChange());
    }
    if (this.pluginapply) {
      this.pluginapply.addEventListener("click", () => this.onApplyPluginSettings());
    }
    if (this.pluginrun) {
      this.pluginrun.addEventListener("click", () => this.onRunPlugin());
    }
    if (this.pluginrevoke) {
      this.pluginrevoke.addEventListener("click", () => this.onRevokePlugin());
    }
    if (this.pluginclose) {
      this.pluginclose.addEventListener("click", () => this.closePluginEditor());
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
    this.disabled.checked = !!c.get("disabled");
    this.disablereports.checked = !!c.get("disableReports");
    this.ttl.value = c.get("fileTTL") || 0;
    this.owners = null;
    this.invitees = null;

    this.linkEntries = normalizeLinkedRoomEntries(c.get("linkedRooms")).map(
      (e) => Object.assign({ status: "unknown" }, e),
    );
    this._initialLinkedSerialized = serializeLinkedRoomEntries(this.linkEntries);
    this.renderLinkTable();
    this.probeLinkStatuses();
    this.guestInvites = [];
    this.refreshGuestInvites();
    this.refreshPlugins();

    this.oninviteonly();
    this.setTab("general");
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
      opt.value = c.id;
      opt.textContent = invited.has(c.id)
        ? `${c.botName || c.name} (already invited)`
        : `${c.botName || c.name}`;
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
      forced ||
      (this.roomPlugins || []).find((x) => x.id === pluginId) ||
      null;
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
      ((this.pluginCatalog || []).find((c) => c.id === p.id) || {}).configSchema;
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
      if (def.type === "number" || key === "pollIntervalMinutes") {
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
        if (key === "password") {
          input.type = "password";
          input.placeholder = "prefer MEGA_PASSWORD env";
        }
      }
      wrap.appendChild(lab);
      wrap.appendChild(input);
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
      if (input.type === "number") {
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
      const list = await registry.socket.makeCall(
        "setconfig",
        "listGuestInvites",
        null,
      );
      this.guestInvites = Array.isArray(list) ? list : [];
      this.renderGuestInvites();
    } catch (ex) {
      console.warn("listGuestInvites", ex);
      this.guestInvites = [];
      this.renderGuestInvites();
    }
  }

  guestInviteAbsoluteUrl(inv) {
    if (!inv) {
      return "";
    }
    if (inv.urlPath || inv.path) {
      const p = inv.urlPath || inv.path;
      return p.startsWith("http")
        ? p
        : `${document.location.origin}${p}`;
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
      const label = document.createElement("div");
      label.className = "link-source-name";
      label.textContent =
        inv.label || (inv.singleUse ? "Single-use" : "Multi-use");
      const linkRow = document.createElement("div");
      linkRow.className = "roomopts-invite-url-line";
      const linkText = document.createElement("span");
      linkText.className = "roomopts-invite-url-text";
      linkText.textContent = fullUrl || inv.token || "";
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
      linkRow.appendChild(linkText);
      linkRow.appendChild(copyA);
      td1.appendChild(label);
      td1.appendChild(linkRow);

      const td2 = document.createElement("td");
      td2.textContent = `${inv.uses || 0} / ${inv.maxUses || 1}`;
      const td3 = document.createElement("td");
      td3.textContent = inv.expiresAt
        ? new Date(inv.expiresAt).toLocaleString()
        : "—";
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
      const rv = await registry.socket.makeCall("setconfig", "createGuestInvite", {
        singleUse,
        maxUses,
        maxAgeHours,
        label,
      });
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
      await this.owner.showMessage(
        ex.message || ex,
        "Guest invite",
        "i-error",
      );
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
        }
      }
      await this.refreshGuestInvites();
    } catch (ex) {
      await this.owner.showMessage(
        ex.message || ex,
        "Guest invite",
        "i-error",
      );
    }
  }

  setTab(tab) {
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
      this.linkhelpbtn.classList.toggle(
        "hidden",
        this.activeTab !== "linking",
      );
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
        return {
          roomId: e.roomId,
          name: live.name || e.name,
          rules: e.rules || live.rules || null,
          status: live.status || "unknown",
        };
      });
      this.renderLinkTable();
    } catch (ex) {
      // Non-fatal: table still shows stored links without live status
      console.warn("probelinks", ex);
      this.renderLinkTable();
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
      if (status === "missing" || status === "denied") {
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
            : status === "missing"
              ? "Missing"
              : "Unknown";
      tdStatus.textContent = label;
      tdStatus.title =
        status === "denied"
          ? "Source room has not enabled Allow Room Cross-Linking"
          : status === "missing"
            ? "Source room not found"
            : status === "ok"
              ? "Source allows cross-linking"
              : "Status not probed yet";

      const tdRules = document.createElement("td");
      tdRules.className = "link-col-rules";
      tdRules.textContent = summarizeLinkRules(entry.rules || null);

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
    if (this.rule_maxage) {
      this.rule_maxage.value =
        rules.maxAgeHours != null ? String(rules.maxAgeHours) : "";
    }
    if (this.rule_minage) {
      this.rule_minage.value =
        rules.minAgeHours != null ? String(rules.minAgeHours) : "";
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

  readEditorRules() {
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
      types,
      maxAgeHours: this.rule_maxage ? this.rule_maxage.value : "",
      minAgeHours: this.rule_minage ? this.rule_minage.value : "",
    };
    return normalizeLinkRules(raw);
  }

  onApplyRules() {
    if (!this.editingRoomId) {
      return;
    }
    const rules = this.readEditorRules();
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

      const nowSerialized = serializeLinkedRoomEntries(this.linkEntries);
      const needSaveLinks =
        nowSerialized !== this._initialLinkedSerialized ||
        this.linkEntries.some((e) => e._token);
      if (needSaveLinks) {
        await socket.makeCall("setconfig", "linkedRooms", linkedPayload);
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
