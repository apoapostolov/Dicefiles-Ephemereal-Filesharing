"use strict";

const { EventEmitter } = require("events");
const { DistributedMap } = require("./broker/collections");
const { token, ofilter } = require("./util");
const redis = require("./broker").getMethods("set", "get", "del", "keys");
const OBS = require("./observability");
const https = require("https");
const http = require("http");
const CONFIG = require("./config");

const EXPIRE_LINK = 365 * 24; // 1 year in hours
const SECSPERHOUR = 60 * 60;

async function resolveByOpengraphIo(url, apiKey) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(url);
    const apiUrl = `https://opengraph.io/api/1.1/site/${encoded}?app_id=${apiKey}`;
    const req = https.get(apiUrl, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`opengraph.io status ${res.statusCode}`));
      }
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
        if (data.length > 64 * 1024) res.destroy();
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const title =
            json?.hybridGraph?.title ||
            json?.openGraph?.title ||
            json?.htmlInferred?.title;
          resolve(title ? title.trim() : null);
        } catch (ex) {
          reject(ex);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("opengraph.io timeout"));
    });
  });
}

async function resolveByHtmlTitle(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        return resolve(resolveByHtmlTitle(res.headers.location));
      }
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1024 * 1024) {
          // 1MB limit
          res.destroy();
        }
      });
      res.on("end", () => {
        const match = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match && match[1]) {
          resolve(match[1].trim().replace(/\s+/g, " "));
        } else {
          resolve(url);
        }
      });
    });
    req.on("error", () => resolve(url));
    req.on("timeout", () => {
      req.destroy();
      resolve(url);
    });
  });
}

async function resolveTitle(url) {
  const ogKey = CONFIG.get("opengraphIoKey");
  if (ogKey) {
    try {
      const title = await resolveByOpengraphIo(url, ogKey);
      if (title) return title;
    } catch {
      // opengraph.io failed — fall through to HTML scraping
    }
  }
  return resolveByHtmlTitle(url);
}

const LINK_OFILTER = new Set([
  "id",
  "roomid",
  "url",
  "name",
  "sharer",
  "date",
  "expires",
]);

class Link extends EventEmitter {
  constructor(options) {
    super();
    Object.assign(this, options);
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

  async remove() {
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

    // Resolve title asynchronously
    resolveTitle(rv.url)
      .then((title) => {
        if (title && title !== rv.url) {
          rv.name = title;
          LINKS.set(id, rv);
        }
      })
      .catch(console.error);

    return rv;
  }

  static async get(id) {
    await LINKS.loaded;
    return LINKS.get(id);
  }
}

const LINKS = new DistributedMap("links:links", (v) => new Link(v));

const EMITTER = new (class LinkEmitter extends EventEmitter {
  constructor() {
    super();
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
    LINKS.on("predelete", (k) => {
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
      this.links.then((links) => {
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
      } catch (ex) {
        console.error(`Failed to remove ${link}`, ex);
        links.shift();
      }
    }
  }

  async expire() {
    try {
      await this.expireLinks();
    } catch (ex) {
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
