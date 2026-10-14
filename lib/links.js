"use strict";

const { EventEmitter } = require("events");
const { DistributedMap } = require("./broker/collections");
const { token, ofilter } = require("./util");
const { linkMetadata } = require("./link-metadata");
const CONFIG = require("./config");

const EXPIRE_LINK = 365 * 24; // 1 year in hours
const SECSPERHOUR = 60 * 60;

const LINK_OFILTER = new Set([
  "id",
  "roomid",
  "url",
  "name",
  "sharer",
  "date",
  "expires",
  "meta",
]);

class Link extends EventEmitter {
  constructor(options) {
    super();
    Object.assign(this, { meta: {} }, options);
    Object.seal(this);
  }

  get expired() {
    return this.expires < Date.now();
  }

  get TTL() {
    return Math.max(0, this.expires - Date.now());
  }

  async expire() {
    if (!this.expired) {
      return false;
    }
    this.emit("expired");
    await this.remove();
    return true;
  }

  remove() {
    LINKS.delete(this.id);
    this.emit("removed");
  }

  toJSON() {
    return ofilter(this, LINK_OFILTER);
  }

  toClientJSON() {
    return this.toJSON();
  }

  toString() {
    return `Link(${this.id}, ${this.url})`;
  }

  static async create(l, ttl) {
    const now = Date.now();
    const id = await token(10);
    const rv = new Link(
      Object.assign(l, {
        id,
        date: now,
        expires: now + (ttl || EXPIRE_LINK) * SECSPERHOUR * 1000,
      }),
    );
    LINKS.set(id, rv);

    // Bounded guarded discovery never follows torrent peer/tracker traffic.
    linkMetadata(rv.url, { opengraphKey: CONFIG.get("opengraphIoKey") }).
      then(result => {
        if (!rv.expired && LINKS.has(id)) {
          if (result.name) {
            rv.name = result.name;
          }
          rv.meta = result.meta || {};
          LINKS.set(id, rv);
        }
      }).
      catch(() => {});

    return rv;
  }

  static async get(id) {
    await LINKS.loaded;
    return LINKS.get(id);
  }
}

const LINKS = new DistributedMap("links:links", v => new Link(v));

const EMITTER = new (class LinkEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.cache = new WeakMap(); // room -> cached link list
    LINKS.on("set", (_, v) => {
      if (!v.expired) {
        this.emit(v.roomid, "add", v);
      }
      this.cache = new WeakMap();
    });
    LINKS.on("update", (_, v) => {
      if (!v.expired) {
        this.emit(v.roomid, "update", v);
      }
      this.cache = new WeakMap();
    });
    LINKS.on("predelete", k => {
      const v = LINKS.get(k);
      if (!v) {
        return;
      }
      this.emit(v.roomid, "delete", v);
      this.cache = new WeakMap();
    });
    LINKS.on("clear", () => {
      this.cache = new WeakMap();
      this.emit("clear");
    });
    setInterval(
      () => {
        this.cache = new WeakMap();
      },
      5 * 60 * 1000,
    );
  }

  async for(room) {
    await LINKS.loaded;
    let rv = this.cache.get(room);
    if (rv) {
      return rv;
    }
    rv = [];
    for (const l of Array.from(LINKS.values())) {
      if (l.roomid === room.roomid && !l.expired) {
        rv.push(l);
      }
    }
    rv.sort((a, b) => b.date - a.date);
    this.cache.set(room, rv);
    return rv;
  }
})();

class LinkExpirer {
  constructor() {
    this.links = LINKS.loaded.then(() => {
      const rv = Array.from(LINKS.values());
      rv.sort((a, b) => a.expires - b.expires);
      return rv;
    });
    LINKS.on("set", (_, v) => {
      this.links.then(links => {
        links.push(v);
        links.sort((a, b) => a.expires - b.expires);
      });
    });
    setInterval(this.expire.bind(this), 60 * 1000);
  }

  async expireLinks() {
    const links = await this.links;
    for (;;) {
      const [link] = links;
      if (!link) {
        break;
      }
      try {
        if (!(await link.expire())) {
          return;
        }
        LINKS.delete(link.id);
        links.shift();
      }
      catch (ex) {
        console.error(`Failed to remove ${link}`, ex);
        links.shift();
      }
    }
  }

  async expire() {
    try {
      await this.expireLinks();
    }
    catch (ex) {
      console.error("Failed to expire links", ex);
    }
  }
}

const EXPIRER = new LinkExpirer();

module.exports = {
  Link,
  LINKS,
  EMITTER,
  EXPIRER,
};
