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
    this.ontoggle = this.ontoggle.bind(this);

    this.toggleBtn = document.querySelector("#links-toggle");
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener("click", this.ontoggle);
    }

    addEventListener("pagehide", this.onleave, { passive: true });
    addEventListener("beforeunload", this.onleave, { passive: true });
  }

  init() {
    this.newStateKey = `links-new-state-${this.getRoomId()}`;
    this.initNewState();

    registry.socket.on("links", this.onlinks);
    registry.socket.on("links-deleted", this.onlinksdeleted);
    registry.socket.on("links-updated", this.onlinksupdated);

    // REMOVEME: hardcoded test links for visual style development
    const _now = Date.now();
    this.onlinks({
      replace: true,
      links: [
        {
          id: "_t1",
          url: "https://github.com/apoapostolov/dicefiles",
          name: "dicefiles — GitHub",
          sharer: "testuser",
          date: _now - 300000,
          expires: _now + 1e10,
        },
        {
          id: "_t2",
          url: "https://developer.mozilla.org/en-US/docs/Web/CSS",
          name: "CSS: Cascading Style Sheets | MDN Web Docs",
          sharer: "anon",
          date: _now - 60000,
          expires: _now + 1e10,
        },
        {
          id: "_t3",
          url: "https://www.example.com/very/long/path/that/should/be/truncated/in/the/display/column/properly",
          name: "",
          sharer: "longnick_user",
          date: _now - 1800000,
          expires: _now + 1e10,
        },
        {
          id: "_t4",
          url: "https://news.ycombinator.com",
          name: "Hacker News",
          sharer: "anon",
          date: _now - 7200000,
          expires: _now + 1e10,
        },
        {
          id: "_t5",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          name: "Rick Astley — Never Gonna Give You Up",
          sharer: "testuser",
          date: _now - 10000,
          expires: _now + 1e10,
        },
      ],
    });
    // END REMOVEME
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
    } catch (ex) {
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
    } catch (ex) {
      // ignored
    }
  }

  onleave() {
    this.persistNewState();
  }

  ontoggle() {
    const filesEl = document.querySelector("#files");
    if (this.el.classList.contains("hidden")) {
      // Show links archive
      this.el.classList.remove("hidden");
      // Lazily create the Scroller now that #links is visible
      if (!this.scroller) {
        this.scroller = new Scroller(
          this.el,
          document.querySelector("#filelist-scroller"),
        );
      }
      filesEl.classList.add("hidden");
      document.body.classList.add("links-mode");
      if (this.toggleBtn) this.toggleBtn.classList.add("active");
    } else {
      // Restore files view
      this.el.classList.add("hidden");
      filesEl.classList.remove("hidden");
      document.body.classList.remove("links-mode");
      if (this.toggleBtn) this.toggleBtn.classList.remove("active");
    }
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
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
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

    // Name column
    const nameEl = document.createElement("span");
    nameEl.className = "name";

    const nameTextEl = document.createElement("span");
    nameTextEl.className = "name-text";
    nameTextEl.textContent = link.name || link.url;
    nameEl.appendChild(nameTextEl);

    const newPill = document.createElement("span");
    newPill.className = "file-new-pill";
    newPill.textContent = "NEW!";
    nameEl.appendChild(newPill);

    el.appendChild(nameEl);

    // Tags (sharer)
    const tagsEl = document.createElement("span");
    tagsEl.className = "tags";

    const sharerTag = document.createElement("span");
    sharerTag.className = "tag tag-user";
    sharerTag.textContent = link.sharer || "anon";
    tagsEl.appendChild(sharerTag);

    el.appendChild(tagsEl);

    // Detail column (URL + age)
    const detailEl = document.createElement("span");
    detailEl.className = "detail";

    const urlSpan = document.createElement("span");
    urlSpan.className = "url-display";
    const rawUrl = link.url || "";
    urlSpan.textContent =
      rawUrl.length > 48 ? rawUrl.substring(0, 45) + "…" : rawUrl;
    urlSpan.title = rawUrl;
    detailEl.appendChild(urlSpan);

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
      Array.from(this.el.querySelectorAll(".file")).forEach((el) =>
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
      if (!link) continue;

      this.linkmap.delete(id);
      const idx = this.links.indexOf(link);
      if (idx >= 0) this.links.splice(idx, 1);

      const el = this.elmap.get(link);
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
  }

  onlinksupdated(links) {
    for (const link of links) {
      const existing = this.linkmap.get(link.id);
      if (!existing) continue;

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
