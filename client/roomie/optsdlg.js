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
 * Room Options — General + Linking tabs.
 * Linking table stores per-source filters/rules; saved as linkedRooms entries.
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

    this.oninviteonly();
    this.setTab("general");
  }

  setTab(tab) {
    this.activeTab = tab === "linking" ? "linking" : "general";
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
