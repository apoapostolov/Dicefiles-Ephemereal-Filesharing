"use strict";

import EventEmitter from "events";
import { APOOL } from "./animationpool";
import { ContextMenu } from "./contextmenu";
import { MessageBox } from "./modal";
import registry from "./registry";
import { BanModal, UnbanModal } from "./roomie/bandlg";
import { BlacklistModal } from "./roomie/bldlg";
import { ChangePWModal } from "./roomie/changepwdlg";
import { HelpModal } from "./roomie/helpdlg";
import { LoginModal } from "./roomie/logindlg";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationModal,
} from "./roomie/notifdlg";
import { OptionsModal } from "./roomie/optsdlg";
import { ReportModal } from "./roomie/reportdlg";
import { debounce, dom, nukeEvent, openInNew } from "./util";

const ALLOW_DRIFT = 200;
const NOTIFY_SETTINGS_PREFIX = "dicefiles:notifications:settings:";
const NOTIFY_SEEN_PREFIX = "dicefiles:notifications:seen:";
const MAX_NOTIFY_SEEN = 400;

export default new (class Roomie extends EventEmitter {
  constructor() {
    super();
    this._name = "New Room";
    this.motd = null;
    this.menu = document.querySelector("#menu");
    this.menu.addEventListener("click", this.onmenu.bind(this));
    this.context = new ContextMenu("#context-menu");
    this.unread = 0;
    this.hidden = document.hidden;
    this.drift = 0;
    this.tooltip = null;
    this.tooltipid = null;
    this._ttinfo = null;
    this.modals = new Set();
    this.connected = false;
    this._mouseMoveInstalled = false;
    this._installTooltip = debounce(this._installTooltip.bind(this), 250);

    this.incrUnread = this.incrUnread.bind(this);
    this.mousepos = Object.seal({ x: 0, y: 0 });
    this.onmousemove = this.onmousemove.bind(this);
    this.onmouseout = this.onmouseout.bind(this);
    this.onmodalkey = this.onmodalkey.bind(this);

    this.role = "white";
    this.notificationSettings = this.loadNotificationSettings();
    this.notificationSeen = this.loadNotificationSeen();

    Object.seal(this);

    document.querySelector("#ips").addEventListener(
      "click",
      () => {
        document.body.classList.toggle("noips");
        this.emit("ips");
      },
      { passive: true },
    );

    addEventListener("mouseout", this.onmouseout, {
      capture: true,
      passive: true,
    });
    const ces = [
      "home",
      "newroom",
      "roomlist",
      "report",
      "options",
      "notifications",
      "ban",
      "unban",
      "nuke",
      "modlog",
      "register",
      "login",
      "account",
      "logout",
    ];
    for (const ce of ces) {
      this.context.on(`ctx-${ce}`, this[`onctx${ce}`].bind(this));
    }
  }

  onctxhome() {
    openInNew("/");
  }

  onctxnewroom() {
    openInNew("/new");
  }

  onctxroomlist() {
    openInNew("/adiscover");
  }

  onctxmodlog() {
    openInNew("/modlog");
  }

  async onctxreport() {
    await this.showReportModal();
  }

  async onctxoptions() {
    await this.showOptionsModal();
  }

  async onctxnotifications() {
    await this.showNotificationsModal();
  }

  async onctxban() {
    await this.showBanModal();
  }

  async onctxunban() {
    await this.showUnbanModal();
  }

  async onctxnuke() {
    try {
      await this.question(
        "Really nuke this room?",
        "R.I.P",
        "i-nuke",
        "NUKE",
        "Nah, I'm robocop!",
      );
      registry.socket.emit("NUKE!!!!");
    } catch (ex) {
      console.log("nuke cancelled");
    }
  }

  onctxregister() {
    openInNew("/register");
  }

  async onctxlogin() {
    await this.showLoginModal();
  }
  onctxaccount() {
    openInNew("/account");
  }

  async onctxlogout() {
    try {
      await registry.init();
      if (!registry.socket || typeof registry.socket.rest !== "function") {
        throw new Error("Connection is not ready yet. Please retry.");
      }
      await registry.socket.rest("logout");
      registry.socket.emit("session", null);
      registry.messages.addSystemMessage("Successfully logged out!");
    } catch (ex) {
      await this.showMessage(ex.message || ex, "Error");
    }
  }

  init() {
    registry.socket.on("usercount", (v) => {
      document.querySelector("#usercount").textContent = v;
    });
    const connection = document.querySelector("#connection");
    registry.socket.on("disconnect", () => {
      connection.classList.add("visible");
      this.connected = false;
    });
    registry.socket.on("connect", () => {
      connection.classList.remove("visible");
      this.connected = true;
    });
    registry.socket.on("authed", (authed) => {
      document.body.classList[authed ? "add" : "remove"]("authed");
      document.body.classList[!authed ? "add" : "remove"]("unauthed");
    });
    registry.socket.on("role", (role) => {
      this.role = role;
      document.body.classList[role === "mod" ? "add" : "remove"]("mod");
      document.body.classList[role !== "mod" ? "add" : "remove"]("regular");
      this.updateRole();
    });
    registry.socket.on("owner", (owner) => {
      document.body.classList[owner ? "add" : "remove"]("owner");
    });

    registry.socket.on("time", (v) => {
      const now = Date.now();
      const drift = v - now;
      this.drift =
        Math.floor(Math.abs(drift) / ALLOW_DRIFT) *
        (drift < 0 ? -ALLOW_DRIFT : ALLOW_DRIFT);
    });

    registry.config.on("change-roomname", (v) => {
      this.name = v;
    });

    registry.config.on("change-disableReports", (disabled) => {
      document.body.classList[disabled ? "add" : "remove"]("noreports");
    });

    registry.config.on("change-motd", (v) => {
      if (JSON.stringify(this.motd) === JSON.stringify(v)) {
        return;
      }
      this.motd = v;
      registry.messages.showMOTD();
    });

    registry.config.on("requireAccounts", () => this.updateRole());
    registry.config.on("roomCreation", () => this.updateRole());
    registry.config.on("roomCreationRequiresAccount", () => this.updateRole());

    registry.messages.on("message", (m) => {
      if (m.saved) {
        return;
      }

      if (m.role === "system") {
        return;
      }

      this.incrUnread();
    });
    registry.files.on("file-added", (file, replace) => {
      const key = file && file.key;
      if (replace) {
        this.rememberNotificationKey(key);
        return;
      }

      this.incrUnread();
      if (!file || !this.hidden) {
        this.rememberNotificationKey(key);
        return;
      }

      const isRequest = !!(file.meta && file.meta.request);
      const kind = isRequest ? "request" : "file";
      const settings =
        this.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS;
      if (settings.muteRoom || !settings.enabled) {
        this.rememberNotificationKey(key);
        return;
      }
      if (kind === "request" && !settings.notifyRequests) {
        this.rememberNotificationKey(key);
        return;
      }
      if (kind === "file" && !settings.notifyFiles) {
        this.rememberNotificationKey(key);
        return;
      }

      this.displayNotification({
        key,
        kind,
        user: file.tags.user || file.tags.usernick || "Unknown",
        msg: (isRequest ? "New request: " : "New file: ") + file.name,
      }).catch(console.error);
    });

    const updateVisible = () => {
      this.hidden = document.hidden || !document.hasFocus();
      if (!this.hidden) {
        this.unread = 0;
        this.emit("unread", this.unread);
        this.hideTooltip();
      }
      this._updateTitle();
      this.emit("hidden", this.hidden);
    };

    addEventListener("focus", updateVisible, false);
    addEventListener("blur", updateVisible, false);
    addEventListener("visibilitychange", updateVisible, false);
  }

  onmenu() {
    if (this.context.showing) {
      this.context.dismiss();
      return;
    }
    this.context.show(this.menu);
  }

  onmousemove(e) {
    const x = (this.mousepos.x = e.pageX);
    const y = (this.mousepos.y = e.pageY);
    if (this.tooltip) {
      this.tooltip.position(x, y);
    }
  }

  onmouseout() {
    this.hideTooltip();
  }

  _installMouseMove() {
    if (this._mouseMoveInstalled) {
      return;
    }
    addEventListener("mousemove", this.onmousemove, { passive: true });
    this._mouseMoveInstalled = true;
  }

  _removeMouseMove() {
    if (!this._mouseMoveInstalled) {
      return;
    }
    addEventListener("mousemove", this.onmousemove, { passive: true });
    this._mouseMoveInstalled = false;
  }

  installTooltip(tip, e) {
    this._installMouseMove();
    this._ttinfo = tip;
    if (e) {
      this.onmousemove(e);
    }
    this._installTooltip();
  }

  _installTooltip() {
    if (!this._ttinfo) {
      return;
    }
    const tip = this._ttinfo;
    this._ttinfo = null;
    if (tip === this.tooltip || this.hidden) {
      return;
    }
    if (this.tooltip) {
      this.hideTooltip();
    }
    this.tooltip = tip;
    document.body.appendChild(tip.el);
    APOOL.schedule(null, () => {
      if (!this.tooltip) {
        return;
      }
      const { x, y } = this.mousepos;
      this.tooltip.position(x, y);
      this.tooltip.show();
      this.emit("tooltip-shown", this.tooltip);
    });
  }

  hideTooltip() {
    if (this._ttinfo) {
      this._removeMouseMove();
      this._ttinfo = null;
    }
    if (!this.tooltip) {
      return;
    }
    this.tooltip.remove();
    this._removeMouseMove();
    this.emit("tooltip-hidden", this.tooltip);
    this.tooltip = null;
  }

  onmodalkey(e) {
    const {
      key,
      target: { localName },
    } = e;
    if (
      key === "Enter" &&
      (localName === "input" || localName === "textarea")
    ) {
      return;
    }
    if (key === "Enter" || key === "Escape") {
      const modal = Array.from(this.modals).pop();
      if (!modal) {
        return;
      }
      nukeEvent(e);
      if (key === "Enter") {
        modal.accept();
      } else {
        modal.dismiss();
      }
    }
  }

  async showModal(modal) {
    if (this.modals.has(modal)) {
      return modal.promise;
    }
    this.hideTooltip();
    if (!this.modals.size) {
      addEventListener("keydown", this.onmodalkey);
    } else {
      this.modals.forEach((e) => {
        e.disable();
      });
    }
    this.modals.add(modal);
    const holder = dom("div", {
      classes: ["modal-holder"],
    });
    holder.appendChild(modal.el);
    document.body.appendChild(holder);
    try {
      modal.onshown();
      return await modal.promise;
    } finally {
      document.body.removeChild(holder);
      this.modals.delete(modal);
      const newtop = Array.from(this.modals).pop();
      if (newtop) {
        newtop.enable();
      } else {
        removeEventListener("keydown", this.onmodalkey);
      }
    }
  }

  async showMessage(text, caption, icon) {
    try {
      console.log(
        await this.showModal(new MessageBox(caption || "Message", text, icon)),
      );
    } catch (ex) {
      console.error(ex);
      // don't care
    }
  }

  async question(text, caption, icon, ...buttons) {
    if (!buttons.length) {
      buttons = ["Yes", "No"];
    }
    buttons = buttons.map((e, i, a) => {
      return {
        id: i,
        text: e,
        default: !i,
        cancel: i === a.length - 1,
      };
    });
    return await this.showModal(
      new MessageBox(caption || "Message", text, icon, ...buttons),
    );
  }

  async showOptionsModal() {
    try {
      await this.showModal(new OptionsModal(this));
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  async showLoginModal() {
    try {
      await this.showModal(new LoginModal(this));
    } catch (ex) {
      // ignored
    }
  }

  async showReportModal() {
    try {
      if (registry.config.get("disableReports")) {
        registry.messages.addSystemMessage("Reports are disabled in this room");
        return;
      }

      await this.showModal(new ReportModal(this));
    } catch (ex) {
      // ignored
    }
  }

  async showChangePWModal() {
    try {
      await this.showModal(new ChangePWModal(this));
    } catch (ex) {
      // ignored
    }
  }

  async showRemoveMessagesModal(id) {
    if (!id) {
      return;
    }
    try {
      const res = await this.question(
        "Really want to remove this message?",
        "Message Removal",
        "i-nuke",
        // Buttons
        "Just this one",
        "All (User, Room)",
        "All (IP, Room)",
        "All (User)",
        "All (IP)",
        "Nope",
      );
      const options = {
        user: false,
        ip: false,
        room: false,
      };
      switch (res) {
        case "accept":
          break;

        case 1:
          options.room = true;
          options.user = true;
          break;

        case 2:
          options.room = true;
          options.ip = true;
          break;

        case 3:
          options.user = true;
          break;

        case 4:
          options.ip = true;
          break;
        default:
          throw new Error("invalid res");
      }
      await registry.socket.makeCall("removeMessage", id, options);
    } catch (ex) {
      console.error("message removal cancelled", ex);
    }
  }
  async showBanModal(subjects, template) {
    try {
      await this.showModal(new BanModal(this, subjects, template));
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  async showUnbanModal(subjects) {
    try {
      await this.showModal(new UnbanModal(this, subjects));
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  async showBlacklistModal(files, template) {
    try {
      await this.showModal(new BlacklistModal(this, files, template));
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  async showHelpModal() {
    try {
      await this.showModal(new HelpModal(this));
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  notificationSettingsKey() {
    return NOTIFY_SETTINGS_PREFIX + registry.roomid;
  }

  notificationSeenKey() {
    return NOTIFY_SEEN_PREFIX + registry.roomid;
  }

  loadNotificationSettings() {
    try {
      const raw = localStorage.getItem(this.notificationSettingsKey());
      if (!raw) {
        return Object.assign({}, DEFAULT_NOTIFICATION_SETTINGS);
      }
      return Object.assign({}, DEFAULT_NOTIFICATION_SETTINGS, JSON.parse(raw));
    } catch (ex) {
      return Object.assign({}, DEFAULT_NOTIFICATION_SETTINGS);
    }
  }

  saveNotificationSettings(settings) {
    this.notificationSettings = Object.assign(
      {},
      DEFAULT_NOTIFICATION_SETTINGS,
      settings || {},
    );
    localStorage.setItem(
      this.notificationSettingsKey(),
      JSON.stringify(this.notificationSettings),
    );
  }

  loadNotificationSeen() {
    try {
      const raw = localStorage.getItem(this.notificationSeenKey());
      if (!raw) {
        return new Set();
      }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        return new Set();
      }
      return new Set(arr.slice(-MAX_NOTIFY_SEEN));
    } catch (ex) {
      return new Set();
    }
  }

  saveNotificationSeen() {
    const arr = Array.from(this.notificationSeen).slice(-MAX_NOTIFY_SEEN);
    localStorage.setItem(this.notificationSeenKey(), JSON.stringify(arr));
  }

  rememberNotificationKey(key) {
    if (!key) {
      return;
    }
    if (this.notificationSeen.has(key)) {
      return;
    }
    this.notificationSeen.add(key);
    if (this.notificationSeen.size > MAX_NOTIFY_SEEN) {
      const overflow = this.notificationSeen.size - MAX_NOTIFY_SEEN;
      let idx = 0;
      for (const val of this.notificationSeen) {
        this.notificationSeen.delete(val);
        idx++;
        if (idx >= overflow) {
          break;
        }
      }
    }
    this.saveNotificationSeen();
  }

  shouldNotify(key) {
    if (!key) {
      return false;
    }
    return !this.notificationSeen.has(key);
  }

  async showNotificationsModal() {
    try {
      const modal = new NotificationModal(this, this.notificationSettings);
      await this.showModal(modal);
      const settings = modal.values;
      if (
        settings.enabled &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          settings.enabled = false;
          await this.showMessage(
            "Desktop notification permission was not granted. Notifications remain disabled for this room.",
            "Notifications",
            "i-warning",
          );
        }
      }
      this.saveNotificationSettings(settings);
    } catch (ex) {
      if (ex) {
        console.error(ex);
      }
    }
  }

  incrUnread() {
    if (!this.hidden) {
      return;
    }
    this.unread++;
    this._updateTitle();
    this.emit("unread", this.unread);
  }

  get name() {
    return this._name;
  }

  set name(nv) {
    this._name = nv || "";
    this._updateTitleAndName();
    this.emit("name", this._name);
  }

  displayNotification(n) {
    if (!("Notification" in window)) {
      return;
    }
    const settings = this.notificationSettings || DEFAULT_NOTIFICATION_SETTINGS;
    if (!settings.enabled || settings.muteRoom) {
      return;
    }
    if (Notification.permission !== "granted") {
      return;
    }

    const key = n && n.key;
    if (key) {
      if (!this.shouldNotify(key)) {
        return;
      }
      this.rememberNotificationKey(key);
    }

    const opts = {
      icon: "/favicon/favicon.ico",
      body: n.msg,
      silent: true,
      noscreen: true,
      ...(key ? { tag: `file:${key}` } : {}),
    };
    const notification = new Notification(
      `${n.user} | ${this.name} | ${registry.config.get("name")}`,
      opts,
    );

    notification.onclick = () => {
      notification.close();
      if (typeof window.focus === "function") {
        window.focus();
      }
      if (key) {
        const highlighted = registry.files.highlightFromNotification(key);
        if (!highlighted) {
          setTimeout(() => registry.files.highlightFromNotification(key), 150);
        }
      }
    };

    setTimeout(notification.close.bind(notification), 10000);
  }

  fromServerTime(serverTime) {
    return serverTime - this.drift;
  }

  toServerTime(localTime) {
    if (!localTime) {
      localTime = Date.now();
    }
    return localTime + this.drift;
  }

  diffTimes(remote, local) {
    return remote - this.toServerTime(local);
  }

  _updateTitle() {
    const unread = this.unread ? `(${this.unread}) ` : "";
    const title = `${unread}${this.name}`;
    document.title = `${title} - ${registry.config.get("name")}`;
    this.emit("title", title);
  }

  _updateTitleAndName() {
    this._updateTitle();
    document.querySelector("#name").textContent = this.name;
  }

  updateRole() {
    let enabled;
    const { config: c } = registry;
    if (this.role === "mod") {
      enabled = true;
    } else if (this.role === "white") {
      enabled =
        c.get("roomCreation") &&
        !c.get("requireAccounts") &&
        !c.get("roomCreationRequiresAccount");
    } else {
      enabled = c.get("roomCreation");
    }
    document.body.classList[enabled ? "add" : "remove"]("newroom");
  }
})();
