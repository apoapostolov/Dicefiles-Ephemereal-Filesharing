"use strict";

import EventEmitter from "events";
import emojiCatalog from "../core/emoji-list.json";
import {
  dom,
  nukeEvent,
  parseCommand,
  roleToStatus,
  validateUsername,
} from "./util";
import registry from "./registry";
import History from "./chatbox/history";
import Autocomplete from "./chatbox/autocomplete";
import {convertMessage, WHITE} from "./chatbox/parse";

/* global __GIF_PROVIDERS__ */
const gifProviders = typeof __GIF_PROVIDERS__ !== "undefined" ?
  __GIF_PROVIDERS__ :
  {};

export default new class ChatBox extends EventEmitter {
  constructor() {
    super();
    this.currentNick = "";
    this.chatbox = document.querySelector("#chatbox");
    this.status = document.querySelector("#status");
    this.text = document.querySelector("#text");
    this.nick = document.querySelector("#nick");
    this.icon = document.querySelector("#user-icon");
    this.authed = "";
    this.role = "white";
    this.history = null;
    this.autocomplete = new Autocomplete(this);
    this.emojiMenuOpen = false;
    this.emojiMenu = null;
    this.emojiToggle = null;
    this.emojiSearchEl = null;
    this.emojiGridEl = null;
    this.emojiEmptyEl = null;
    this.emojiUniverse = [];
    this.overlayAnchor = null;
    this.gifMenuOpen = false;
    this.gifMenu = null;
    this.gifProviderPill = null;
    this.gifSearchEl = null;
    this.gifGridEl = null;
    this.gifStatusEl = null;
    this.activeGifProvider = "giphy";
    this.gifSearchTimer = null;
    this.gifSearchNonce = 0;
    this.ondocclick = this.ondocclick.bind(this);
    this.text.addEventListener("keypress", this.onpress.bind(this));
    this.text.addEventListener("paste", this.onpaste.bind(this));
    this.text.addEventListener("drop", this.ondrop.bind(this));

    this.updateDisabledState = this.updateDisabledState.bind(this);
    Object.seal(this);
  }

  init() {
    this.history = new History(this.text);
    this.installEmojiPicker();

    registry.messages.on("message", m => {
      this.autocomplete.add(m);
    });

    registry.socket.on("role", m => {
      this.role = m;
      this.icon.className = "";
      this.icon.classList.add(m);
      switch (m) {
      case "user":
        this.icon.classList.add("i-green");
        break;

      case "mod":
        this.icon.classList.add("i-purple");
        break;

      default:
        this.icon.classList.add("i-white");
        break;
      }
      this.icon.setAttribute("title", roleToStatus(m));
      this.updateDisabledState();
    });

    registry.socket.on("nick", m => {
      this.setNick(m);
    });

    registry.socket.on("authed", async authed => {
      this.authed = authed;
      if (this.authed) {
        await this.ensureNick(true);
      }
    });

    registry.config.on("requireAccounts", this.updateDisabledState);
    registry.socket.on("connect", this.updateDisabledState);
    registry.socket.on("disconnect", this.updateDisabledState);
  }

  installEmojiPicker() {
    if (!this.status || this.emojiToggle) {
      return;
    }
    this.emojiUniverse = this.buildEmojiUniverse();

    const anchor = dom("div", {classes: ["emoji-anchor"]});
    this.overlayAnchor = anchor;
    this.emojiToggle = dom("button", {
      attrs: {
        type: "button",
        title: "Insert emoji",
        "aria-label": "Insert emoji",
      },
      classes: ["emoji-toggle"],
      text: "🙂",
    });
    this.emojiToggle.addEventListener("click", e => {
      nukeEvent(e);
      this.toggleEmojiMenu();
    });

    this.emojiMenu = dom("div", {
      classes: ["emoji-menu", "hidden"],
      attrs: {"aria-hidden": "true"},
    });
    this.emojiSearchEl = dom("input", {
      classes: ["emoji-search"],
      attrs: {
        type: "search",
        placeholder: "Search emoji...",
        autocomplete: "off",
        spellcheck: "false",
      }
    });
    this.emojiSearchEl.addEventListener("input", () => this.renderEmojiGrid());
    this.emojiGridEl = dom("div", {classes: ["emoji-grid"]});
    this.emojiEmptyEl = dom("div", {
      classes: ["emoji-empty", "hidden"],
      text: "No emoji found",
    });
    this.emojiMenu.appendChild(this.emojiSearchEl);
    this.emojiMenu.appendChild(this.emojiGridEl);
    this.emojiMenu.appendChild(this.emojiEmptyEl);
    this.renderEmojiGrid();

    anchor.appendChild(this.emojiToggle);
    anchor.appendChild(this.emojiMenu);
    this.installGifMenu();
    this.status.insertBefore(anchor, this.status.firstChild);
    document.addEventListener("click", this.ondocclick, {passive: true});
  }

  buildEmojiUniverse() {
    const out = [];
    const seen = new Set();
    const fromConfig = Array.isArray(emojiCatalog) ? emojiCatalog : [];
    for (const item of fromConfig) {
      if (!item || typeof item.emoji !== "string") {
        continue;
      }
      const emoji = item.emoji.trim();
      if (!emoji || seen.has(emoji)) {
        continue;
      }
      const search = `${item.search || ""}`.trim().toLowerCase();
      seen.add(emoji);
      out.push({emoji, search});
    }
    if (out.length) {
      return out;
    }
    return [{emoji: "🙂", search: "smile"}];
  }

  renderEmojiGrid() {
    if (!this.emojiGridEl) {
      return;
    }
    const q = (this.emojiSearchEl && this.emojiSearchEl.value || "").
      trim().
      toLowerCase();
    const list = q ?
      this.emojiUniverse.filter(e => e.search.includes(q) || e.emoji.includes(q)) :
      this.emojiUniverse;
    this.emojiGridEl.textContent = "";
    const frag = document.createDocumentFragment();
    for (const item of list) {
      const b = dom("button", {
        attrs: {
          type: "button",
          title: item.search,
          "aria-label": `Insert ${item.emoji}`,
        },
        classes: ["emoji-item"],
        text: item.emoji,
      });
      b.addEventListener("click", e => {
        nukeEvent(e);
        this.injectFromEvent(item.emoji);
        this.hideEmojiMenu();
        this.text.focus();
      });
      frag.appendChild(b);
    }
    this.emojiGridEl.appendChild(frag);
    this.emojiEmptyEl.classList[list.length ? "add" : "remove"]("hidden");
  }

  ondocclick(e) {
    if ((!this.emojiMenuOpen && !this.gifMenuOpen) || !this.overlayAnchor) {
      return;
    }
    if (this.overlayAnchor.contains(e.target)) {
      return;
    }
    this.hideEmojiMenu();
    this.hideGifMenu();
  }

  toggleEmojiMenu() {
    if (this.emojiMenuOpen) {
      this.hideEmojiMenu();
      return;
    }
    this.hideGifMenu();
    this.emojiMenuOpen = true;
    this.emojiMenu.classList.remove("hidden");
    this.emojiMenu.setAttribute("aria-hidden", "false");
    if (this.emojiSearchEl) {
      this.emojiSearchEl.value = "";
      this.renderEmojiGrid();
      setTimeout(() => this.emojiSearchEl.focus(), 0);
    }
  }

  hideEmojiMenu() {
    this.emojiMenuOpen = false;
    if (!this.emojiMenu) {
      return;
    }
    this.emojiMenu.classList.add("hidden");
    this.emojiMenu.setAttribute("aria-hidden", "true");
  }

  installGifMenu() {
    if (!this.overlayAnchor || this.gifProviderPill) {
      return;
    }
    this.gifProviderPill = dom("div", {classes: ["gif-provider-pill"]});
    const providers = [
      {id: "giphy", name: "Giphy", icon: "https://giphy.com/favicon.ico"},
      {id: "tenor", name: "Tenor", icon: "https://tenor.com/favicon.ico"},
    ];
    for (const p of providers) {
      const btn = dom("button", {
        attrs: {
          type: "button",
          title: `Search ${p.name} GIFs`,
          "aria-label": `Search ${p.name} GIFs`,
          "data-provider": p.id,
        },
        classes: ["gif-provider-btn", ...(p.id === this.activeGifProvider ? ["active"] : [])],
      });
      const img = dom("img", {
        classes: ["gif-provider-icon"],
        attrs: {
          alt: `${p.name} icon`,
          src: p.icon,
          loading: "lazy",
          decoding: "async",
        },
      });
      btn.appendChild(img);
      btn.addEventListener("click", e => {
        nukeEvent(e);
        this.toggleGifMenu(p.id);
      });
      this.gifProviderPill.appendChild(btn);
    }
    this.overlayAnchor.appendChild(this.gifProviderPill);

    this.gifMenu = dom("div", {
      classes: ["gif-menu", "hidden"],
      attrs: {"aria-hidden": "true"},
    });
    this.gifSearchEl = dom("input", {
      classes: ["gif-search"],
      attrs: {
        type: "search",
        placeholder: "Search GIFs...",
        autocomplete: "off",
        spellcheck: "false",
      },
    });
    this.gifSearchEl.addEventListener("input", () => this.onGifSearchInput());
    this.gifStatusEl = dom("div", {
      classes: ["gif-status"],
      text: "Start typing to search GIFs",
    });
    this.gifGridEl = dom("div", {classes: ["gif-grid"]});
    this.gifMenu.appendChild(this.gifSearchEl);
    this.gifMenu.appendChild(this.gifStatusEl);
    this.gifMenu.appendChild(this.gifGridEl);
    this.overlayAnchor.appendChild(this.gifMenu);
  }

  toggleGifMenu(provider) {
    const nextProvider = provider || this.activeGifProvider;
    if (this.gifMenuOpen && nextProvider === this.activeGifProvider) {
      this.hideGifMenu();
      return;
    }
    this.activeGifProvider = nextProvider;
    this.hideEmojiMenu();
    this.gifMenuOpen = true;
    this.gifMenu.classList.remove("hidden");
    this.gifMenu.setAttribute("aria-hidden", "false");
    this.markActiveGifProviderButton();
    if (this.gifSearchEl) {
      this.gifSearchEl.value = "";
      this.gifGridEl.textContent = "";
      this.gifStatusEl.textContent = "Start typing to search GIFs";
      this.gifMenu.classList.remove("has-results");
      setTimeout(() => this.gifSearchEl.focus(), 0);
    }
  }

  hideGifMenu() {
    this.gifMenuOpen = false;
    if (!this.gifMenu) {
      return;
    }
    this.gifMenu.classList.add("hidden");
    this.gifMenu.setAttribute("aria-hidden", "true");
    this.markActiveGifProviderButton();
  }

  markActiveGifProviderButton() {
    if (!this.gifProviderPill) {
      return;
    }
    for (const btn of this.gifProviderPill.querySelectorAll(".gif-provider-btn")) {
      const active = btn.dataset.provider === this.activeGifProvider;
      btn.classList[active ? "add" : "remove"]("active");
    }
  }

  onGifSearchInput() {
    if (!this.gifSearchEl) {
      return;
    }
    const q = this.gifSearchEl.value.trim();
    if (this.gifSearchTimer) {
      clearTimeout(this.gifSearchTimer);
      this.gifSearchTimer = null;
    }
    if (!q) {
      this.gifGridEl.textContent = "";
      this.gifStatusEl.textContent = "Start typing to search GIFs";
      this.gifMenu.classList.remove("has-results");
      return;
    }
    this.gifStatusEl.textContent = `Searching ${this.activeGifProvider}...`;
    this.gifSearchTimer = setTimeout(() => {
      this.searchGifRealtime(q, this.activeGifProvider).catch(console.error);
    }, 800);
  }

  async searchGifRealtime(query, provider) {
    const nonce = ++this.gifSearchNonce;
    let results = [];
    try {
      results = provider === "tenor" ?
        await this.searchTenor(query) :
        await this.searchGiphy(query);
    }
    catch (ex) {
      if (nonce !== this.gifSearchNonce) {
        return;
      }
      this.gifStatusEl.textContent = ex.message || "GIF search failed";
      this.gifGridEl.textContent = "";
      this.gifMenu.classList.remove("has-results");
      return;
    }
    if (nonce !== this.gifSearchNonce) {
      return;
    }
    this.renderGifGrid(results, provider, query);
  }

  async searchGiphy(query) {
    const cfg = (gifProviders && gifProviders.giphy) || {};
    const key = (cfg.apiKey || "").trim();
    if (!key) {
      throw new Error("Giphy API key missing in core/gif-providers.json");
    }
    const limit = Math.max(1, Math.min(40, Number(cfg.limit) || 20));
    const rating = encodeURIComponent(cfg.rating || "pg-13");
    const u = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=${rating}`;
    const res = await fetch(u);
    const body = await res.json();
    const data = Array.isArray(body && body.data) ? body.data : [];
    return data.map(item => ({
      preview: item && item.images && item.images.fixed_width && item.images.fixed_width.url,
      url: item && item.images && item.images.original && item.images.original.url,
    })).filter(r => r.preview && r.url);
  }

  async searchTenor(query) {
    const cfg = (gifProviders && gifProviders.tenor) || {};
    const key = (cfg.apiKey || "").trim();
    if (!key) {
      throw new Error("Tenor API key missing in core/gif-providers.json");
    }
    const limit = Math.max(1, Math.min(40, Number(cfg.limit) || 20));
    const clientKey = encodeURIComponent(cfg.clientKey || "dicefiles");
    const mediaFilter = encodeURIComponent(cfg.mediaFilter || "tinygif,gif");
    const contentFilter = encodeURIComponent(cfg.contentFilter || "medium");
    const u = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}&client_key=${clientKey}&limit=${limit}&media_filter=${mediaFilter}&contentfilter=${contentFilter}`;
    let data = [];
    try {
      const res = await fetch(u);
      const body = await res.json();
      if (!res.ok) {
        const reason = body && body.error && body.error.details &&
          body.error.details.find(e => e.reason) &&
          body.error.details.find(e => e.reason).reason;
        if (reason === "API_KEY_INVALID") {
          return await this.searchTenorLegacy(query, key, limit);
        }
        throw new Error(
          body && body.error && body.error.message || "Tenor search failed");
      }
      data = Array.isArray(body && body.results) ? body.results : [];
    }
    catch (ex) {
      return await this.searchTenorLegacy(query, key, limit);
    }

    const out = data.map(item => {
      const fm = item && item.media_formats || {};
      const tiny = fm.tinygif && (fm.tinygif.preview || fm.tinygif.url);
      const gif = fm.gif && (fm.gif.preview || fm.gif.url);
      const tinyGifUrl = fm.tinygif && fm.tinygif.url;
      const gifUrl = fm.gif && fm.gif.url;
      return {preview: tiny || gif || tinyGifUrl || gifUrl, url: gifUrl || tinyGifUrl};
    }).filter(r => r.preview && r.url);
    if (out.length) {
      return out;
    }
    return await this.searchTenorLegacy(query, key, limit);
  }

  async searchTenorLegacy(query, key, limit) {
    const u = `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}&limit=${limit}`;
    const res = await fetch(u);
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        body && body.error && body.error.message || "Tenor search failed");
    }
    const data = Array.isArray(body && body.results) ? body.results : [];
    return data.map(item => {
      const media = Array.isArray(item && item.media) ? item.media[0] : {};
      const tiny = media && media.tinygif || {};
      const gif = media && (media.gif || media.mediumgif || media.nanogif) || {};
      const preview = tiny.preview || gif.preview || tiny.url || gif.url;
      const url = gif.url || tiny.url;
      return {preview, url};
    }).filter(r => r.preview && r.url);
  }

  renderGifGrid(results, provider, query) {
    this.gifGridEl.textContent = "";
    if (!results.length) {
      this.gifStatusEl.textContent = `No ${provider} GIFs for "${query}"`;
      this.gifMenu.classList.remove("has-results");
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of results) {
      const b = dom("button", {
        classes: ["gif-item"],
        attrs: {
          type: "button",
          title: "Insert GIF URL",
          "aria-label": "Insert GIF URL",
        },
      });
      const img = dom("img", {
        attrs: {
          src: item.preview,
          alt: "GIF result",
          loading: "lazy",
          decoding: "async",
          referrerpolicy: "no-referrer",
        }
      });
      b.appendChild(img);
      b.addEventListener("click", e => {
        nukeEvent(e);
        const url = this.normalizeGifChatUrl(item.url);
        this.sendMessage(url).catch(ex => {
          this.emit("error", `Could not send GIF: ${ex.message || ex}`);
        });
        this.hideGifMenu();
      });
      frag.appendChild(b);
    }
    this.gifGridEl.appendChild(frag);
    this.gifStatusEl.textContent = `${results.length} results from ${provider}`;
    this.gifMenu.classList.add("has-results");
  }

  normalizeGifChatUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = "";
      u.search = "";
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host.endsWith("giphy.com")) {
        const id = (u.pathname.match(/\/media\/([a-zA-Z0-9]+)\//) || [])[1];
        if (id) {
          return `https://i.giphy.com/media/${id}/giphy.gif`;
        }
      }
      return u.href;
    }
    catch (ex) {
      return rawUrl;
    }
  }

  async send(value) {
    const cmd = parseCommand(value);
    if (cmd && await this.doCommand(cmd)) {
      // done
    }
    else {
      this.sendMessage(value);
    }
  }

  onpress(e) {
    const {key, shiftKey} = e;
    if (key === "Enter" && !shiftKey) {
      const {target} = e;
      if (target.value) {
        let {value} = target;
        value = value.trim();
        this.send(value).catch(console.error);
        target.value = "";
      }
      return nukeEvent(e);
    }
    if (this.text.value.length >= 300) {
      return nukeEvent(e);
    }
    if (key === " " || key === "Enter") {
      this.reparse(key === "Enter" ? "\n" : " ");
      return nukeEvent(e);
    }
    return true;
  }

  reparse(additional) {
    const {selectionStart: start, selectionEnd: end, value} = this.text;
    const pre = value.slice(0, start);
    const post = value.slice(end);
    const cpre = convertMessage(pre);
    const cpost = convertMessage(post);
    const nm = cpre + additional + cpost;
    this.text.value = nm.slice(0, 300);
    this.text.selectionEnd = this.text.selectionStart = Math.min(
      cpre.length + 1, this.text.value.length);
  }

  injectFromEvent(data) {
    data = convertMessage(data);
    if (!data) {
      return;
    }
    const {selectionStart: start, selectionEnd: end, value} = this.text;
    const pre = value.slice(0, start);
    const post = value.slice(end);
    data = (pre && !WHITE.test(pre.slice(-1)) ? " " : "") +
      data +
      (!post || !WHITE.test(post[0]) ? " " : "");
    const nm = pre + data + post;
    if (nm.length > 300) {
      return;
    }
    this.text.value = nm;
    this.text.selectionEnd = this.text.selectionStart = start + data.length;
  }

  onpaste(e) {
    let data = e.clipboardData || window.clipboardData;
    if (!data) {
      return;
    }
    data = data.getData("text") || data.getData("text/plain");
    if (!data) {
      return;
    }
    nukeEvent(e);
    this.injectFromEvent(data);
  }

  ondrop() {
    setTimeout(() => {
      this.text.selectionStart = this.text.selectionEnd;
      this.reparse(" ");
      this.text.focus();
    });
  }

  async cmd_help() {
    await registry.roomie.showHelpModal();
    return true;
  }

  async cmd_login() {
    await registry.roomie.showLoginModal();
    return true;
  }

  async cmd_changepw() {
    if (this.role === "white" || !this.authed) {
      throw new Error("You must be logged in to change your password");
    }

    await registry.roomie.showChangePWModal();
    return true;
  }

  async cmd_nick(value) {
    this.nick.value = value;
    await this.ensureNick();
    return true;
  }

  cmd_motd() {
    registry.messages.showMOTD();
    return true;
  }

  cmd_search(value) {
    registry.files.setFilter(value);
    return true;
  }

  cmd_p(value) {
    registry.privmsg.command(value).catch(ex => {
      registry.messages.add({
        volatile: true,
        user: "Error",
        role: "system",
        msg: `Could not send privmsg: ${ex}`
      });
    });
    return true;
  }

  async doCommand(cmd) {
    try {
      const fn = this[`cmd_${cmd.cmd}`];
      if (!fn) {
        return false;
      }
      let rv = fn.call(this, cmd.args);
      if (rv && rv.then) {
        rv = await rv;
      }
      if (rv) {
        this.history.add(cmd.str);
        return true;
      }
      return false;
    }
    finally {
      this.text.focus();
    }
  }

  async ensureNick(silent) {
    try {
      let {value: onick} = this.nick;
      if (!onick) {
        onick = localStorage.getItem("nick");
      }
      let nick;
      if (this.authed) {
        if (onick.toLowerCase() === this.authed) {
          nick = onick;
        }
        else {
          nick = this.authed;
          this.emit(
            "warn",
            "Chat name must match your account name, " +
            "except for capitalization! " +
            "It was reset to your account name.");
          silent = true;
        }
      }
      else {
        nick = await validateUsername(onick);
      }
      const oldnick = localStorage.getItem("nick");
      localStorage.setItem("nick", nick);
      if (onick !== nick && !silent) {
        this.emit(
          "warn",
          "Chat name contained invalid stuff, which was removed");
      }
      if (oldnick === nick) {
        return;
      }
      registry.socket.emit("nick", nick);
    }
    catch (ex) {
      this.emit(
        "error",
        `User name invalid: ${ex.message || ex}`);
    }
    finally {
      this.currentNick = this.nick.value = localStorage.getItem("nick");
    }
  }

  async sendMessage(m) {
    await this.ensureNick();
    registry.socket.emit("message", m);
    this.history.add(m);
  }

  checkHighlight(str) {
    if (!this.currentNick) {
      return false;
    }
    return str.toUpperCase().includes(this.currentNick.toUpperCase());
  }

  setNick(nick) {
    this.nick.value = nick;
    this.currentNick = nick;
    localStorage.setItem("nick", nick);
  }

  updateDisabledState() {
    const disabled = registry.config.get("requireAccounts") &&
      this.role === "white";
    if (!registry.roomie.connected) {
      this.text.setAttribute("disabled", "disabled");
      this.text.setAttribute(
        "placeholder", this.text.dataset.placeholderDisconnected);
    }
    else if (disabled) {
      this.text.setAttribute("disabled", "disabled");
      this.text.setAttribute(
        "placeholder", this.text.dataset.placeholderDisabled);
    }
    else {
      this.text.removeAttribute("disabled");
      this.text.setAttribute(
        "placeholder", this.text.dataset.placeholderEnabled);
      this.text.focus();
    }
  }
}();
