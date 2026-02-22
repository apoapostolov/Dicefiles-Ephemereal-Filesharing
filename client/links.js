import EventEmitter from "events";
import registry from "./registry";
import Scroller from "./scroller";

export default new (class Links extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#links");
    // Scroller is created lazily on first toggle (element is display:none at import time)
    this.scroller = null;
    this.links = [];
    this.linkmap = new Map();
    this.elmap = new WeakMap();
    this.newSinceServerTime = 0;
    this.newStateKey = null;

    this.onlinks = this.onlinks.bind(this);
    this.onlinksdeleted = this.onlinksdeleted.bind(this);
    this.onlinksupdated = this.onlinksupdated.bind(this);
    this.onleave = this.onleave.bind(this);

    // toggleBtn is #linkmode — set by files.js via setToggleBtn()
    this.toggleBtn = null;

    addEventListener("pagehide", this.onleave, { passive: true });
    addEventListener("beforeunload", this.onleave, { passive: true });
  }

  setToggleBtn(btn) {
    this.toggleBtn = btn;
  }

  init() {
    this.newStateKey = `links-new-state-${this.getRoomId()}`;
    this.initNewState();

    registry.socket.on("links", this.onlinks);
    registry.socket.on("links-deleted", this.onlinksdeleted);
    registry.socket.on("links-updated", this.onlinksupdated);

    // Request the current room links now that the handler is registered
    registry.socket.emit("getlinks");

    // Restore links mode if files.js marked it pending
    if (registry.files && registry.files._pendingLinksRestore) {
      registry.files._pendingLinksRestore = false;
      registry.files.linksMode = true;
      registry.files.el.classList.add("hidden");
      this.show();
      if (registry.files.linkModeEl) {
        registry.files.linkModeEl.classList.add("active");
      }
      // Deactivate list/gallery nail buttons (nailoff starts active in HTML)
      if (registry.files.nailOffEl) {
        registry.files.nailOffEl.classList.remove("active");
      }
      if (registry.files.nailOnEl) {
        registry.files.nailOnEl.classList.remove("active");
      }
    }
  }

  initNewState() {
    const fallback = registry.roomie.toServerTime(Date.now());
    try {
      const raw = localStorage.getItem(this.newStateKey);
      if (!raw) {
        this.newSinceServerTime = fallback;
        this.persistNewState();
        return;
      }
      const parsed = JSON.parse(raw);
      const v = Number(parsed && parsed.lastSeenServerTime);
      this.newSinceServerTime = Number.isFinite(v) && v > 0 ? v : fallback;
    }
    catch (ex) {
      this.newSinceServerTime = fallback;
    }
  }

  persistNewState() {
    try {
      localStorage.setItem(
        this.newStateKey,
        JSON.stringify({
          lastSeenServerTime: registry.roomie.toServerTime(Date.now()),
        }),
      );
    }
    catch (ex) {
      // ignored
    }
  }

  onleave() {
    this.persistNewState();
  }

  show() {
    // Lazily create the Scroller now that #links is visible
    if (!this.scroller) {
      this.scroller = new Scroller(
        this.el,
        document.querySelector("#filelist-scroller"),
      );
    }
    this.el.classList.remove("hidden");
    document.body.classList.add("links-mode");
  }

  hide() {
    this.el.classList.add("hidden");
    document.body.classList.remove("links-mode");
  }

  getRoomId() {
    const raw = document.location.pathname || "";
    const normalized = raw.replace(/^\/r\//, "").replace(/\/+$/, "");
    return normalized || "default";
  }

  isLinkNew(link) {
    const date = Number(link.date);
    if (!Number.isFinite(date) || date <= 0) {
      return false;
    }
    return date > this.newSinceServerTime;
  }

  formatAge(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) {
      return `${secs}s`;
    }
    const mins = Math.floor(secs / 60);
    if (mins < 60) {
      return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
      return `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  createLinkElement(link) {
    const isNew = this.isLinkNew(link);

    const el = document.createElement("a");
    el.className = "file";
    el.href = link.url;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
    if (isNew) {
      el.classList.add("is-new");
    }

    // Name column: primary line (name + NEW pill) stacked above URL subtitle
    const nameEl = document.createElement("span");
    nameEl.className = "name";

    const namePrimaryEl = document.createElement("span");
    namePrimaryEl.className = "name-primary";

    const nameTextEl = document.createElement("span");
    nameTextEl.className = "name-text";
    nameTextEl.textContent = link.name || link.url;
    namePrimaryEl.appendChild(nameTextEl);

    const newPill = document.createElement("span");
    newPill.className = "file-new-pill";
    newPill.textContent = "NEW!";
    namePrimaryEl.appendChild(newPill);

    nameEl.appendChild(namePrimaryEl);

    const urlSubEl = document.createElement("span");
    urlSubEl.className = "url-sub";
    urlSubEl.textContent = link.url || "";
    urlSubEl.title = link.url || "";
    nameEl.appendChild(urlSubEl);

    el.appendChild(nameEl);

    // Tags (sharer pill)
    const tagsEl = document.createElement("span");
    tagsEl.className = "tags";

    const sharerTag = document.createElement("span");
    sharerTag.className = "tag tag-user";
    sharerTag.textContent = link.sharer || "anon";
    tagsEl.appendChild(sharerTag);

    el.appendChild(tagsEl);

    // Detail column: age only
    const detailEl = document.createElement("span");
    detailEl.className = "detail";

    const ageSpan = document.createElement("span");
    ageSpan.className = "ttl";
    ageSpan.textContent = this.formatAge(Date.now() - link.date);
    detailEl.appendChild(ageSpan);

    el.appendChild(detailEl);

    return el;
  }

  onlinks(data) {
    if (data.replace) {
      this.links = [];
      this.linkmap.clear();
      // Remove only .file rows, preserving the #links-header element
      Array.from(this.el.querySelectorAll(".file")).forEach(el =>
        el.remove(),
      );
    }

    for (const link of data.links) {
      if (this.linkmap.has(link.id)) {
        continue;
      }
      this.links.push(link);
      this.linkmap.set(link.id, link);

      const el = this.createLinkElement(link);
      this.elmap.set(link, el);
      this.el.appendChild(el);
    }

    this.links.sort((a, b) => b.date - a.date);
    this.render();
  }

  onlinksdeleted(ids) {
    for (const id of ids) {
      const link = this.linkmap.get(id);
      if (!link) {
        continue;
      }

      this.linkmap.delete(id);
      const idx = this.links.indexOf(link);
      if (idx >= 0) {
        this.links.splice(idx, 1);
      }

      const el = this.elmap.get(link);
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
  }

  onlinksupdated(links) {
    for (const link of links) {
      const existing = this.linkmap.get(link.id);
      if (!existing) {
        continue;
      }

      Object.assign(existing, link);
      const el = this.elmap.get(existing);
      if (el) {
        const newEl = this.createLinkElement(existing);
        el.parentNode.replaceChild(newEl, el);
        this.elmap.set(existing, newEl);
      }
    }
  }

  render() {
    // Reorder elements based on sorted links array
    for (const link of this.links) {
      const el = this.elmap.get(link);
      if (el) {
        this.el.appendChild(el);
      }
    }
  }
})();
