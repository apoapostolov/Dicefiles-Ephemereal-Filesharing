"use strict";

const EventEmitter = require("events");
const { DistributedMap } = require("./broker/collections");
const { ofilter, sort, token } = require("./util");
const CONFIG = require("./config");
const OBS = require("./observability");

const SECSPERHOUR = 3600;
const EXPIRE_REQUEST = CONFIG.get("TTL");
const MAX_REQUEST_AGE_MS = EXPIRE_REQUEST * SECSPERHOUR * 1000;

const REQUEST_OFILTER = new Set([
  "key",
  "href",
  "type",
  "name",
  "size",
  "roomid",
  "ip",
  "hash",
  "tags",
  "meta",
  "uploaded",
  "expires",
  "status",
  "fulfilledByNick",
]);

class RequestFile {
  constructor(options) {
    Object.assign(this, options);
    const uploaded = Number(this.uploaded) || Date.now();
    this.uploaded = uploaded;
    const expires = Number(this.expires);
    const maxExpires = uploaded + MAX_REQUEST_AGE_MS;
    if (
      !Number.isFinite(expires) ||
      expires <= uploaded ||
      expires > maxExpires
    ) {
      this.expires = maxExpires;
    } else {
      this.expires = expires;
    }
    if (!this.meta || typeof this.meta !== "object") {
      this.meta = {};
    }
    if (
      !this.meta.requestImageDataUrl ||
      typeof this.meta.requestImageDataUrl !== "string"
    ) {
      this.meta.requestImageDataUrl = "";
    }
    if (
      typeof this.status !== "string" ||
      !(this.status === "open" || this.status === "fulfilled")
    ) {
      this.status = "open";
    }
    if (typeof this.fulfilledByNick !== "string") {
      this.fulfilledByNick = "";
    }
    Object.seal(this);
  }

  get hidden() {
    return false;
  }

  get expired() {
    return this.expires < Date.now();
  }

  async expire() {
    if (!this.expired) {
      return false;
    }
    await REQUESTS.loaded;
    REQUESTS.delete(this.key);
    return true;
  }

  toJSON() {
    return ofilter(this, REQUEST_OFILTER);
  }

  toClientJSON() {
    return Object.assign(this.toJSON(), {
      assets: [],
    });
  }

  static async create({
    roomid,
    name,
    requestUrl,
    requestImageDataUrl,
    ip,
    user,
    role,
    account,
    ttl,
  }) {
    await REQUESTS.loaded;
    let key;
    for (;;) {
      key = `rq${await token(10)}`;
      if (!REQUESTS.has(key)) {
        break;
      }
    }
    const now = Date.now();
    const tags = account ? { user } : { usernick: user };
    return new RequestFile({
      key,
      href: `/q/${key}`,
      type: "file",
      name,
      size: 0,
      roomid,
      ip,
      hash: null,
      tags: Object.assign({ request: true }, tags),
      meta: {
        request: true,
        requestUrl: requestUrl || "",
        requestImageDataUrl: requestImageDataUrl || "",
        role: role || "white",
        account: account || "",
      },
      uploaded: now,
      expires: now + (ttl || EXPIRE_REQUEST) * SECSPERHOUR * 1000,
      status: "open",
      fulfilledByNick: "",
    });
  }
}

const REQUESTS = new DistributedMap(
  "upload:requests",
  (v) => new RequestFile(v),
);

REQUESTS.on("set", (_, req) => {
  OBS.trackRequestCreated(req);
});

REQUESTS.on("predelete", (key) => {
  const req = REQUESTS.get(key);
  if (!req || req.expired) {
    return;
  }
  OBS.trackRequestFulfilled(req);
});

const EMITTER = new (class RequestEmitter extends EventEmitter {
  constructor() {
    super();
    this.cache = new WeakMap();
    REQUESTS.on("set", (_, v) => {
      this.emit(v.roomid, "add", v);
      this.cache = new WeakMap();
    });
    REQUESTS.on("update", (_, v) => {
      this.emit(v.roomid, "update", v);
      this.cache = new WeakMap();
    });
    REQUESTS.on("predelete", (k) => {
      const v = REQUESTS.get(k);
      if (!v) {
        return;
      }
      this.emit(v.roomid, "delete", v);
      this.cache = new WeakMap();
    });
    REQUESTS.on("clear", () => {
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
    await REQUESTS.loaded;
    let requests = this.cache.get(room);
    if (!Array.isArray(requests)) {
      requests = Array.from(REQUESTS.values()).filter(
        (v) => v.roomid === room.roomid,
      );
      this.cache.set(room, requests);
    }
    return sort(requests, (f) => f.uploaded);
  }

  async setStatus(key, status, byNick) {
    await REQUESTS.loaded;
    const req = REQUESTS.get(key);
    if (!req) {
      throw new Error("Request not found");
    }
    const data = req.toJSON();
    data.status = status;
    data.fulfilledByNick = byNick || "";
    const updated = new RequestFile(data);
    REQUESTS.set(key, updated);
    return updated;
  }

  async createRequest(
    roomid,
    text,
    requestUrl,
    ip,
    user,
    role,
    account,
    ttl,
    requestImageDataUrl,
  ) {
    const req = await RequestFile.create({
      roomid,
      name: text,
      requestUrl,
      requestImageDataUrl,
      ip,
      user,
      role,
      account,
      ttl,
    });
    REQUESTS.set(req.key, req);
    return req;
  }

  async trash(files) {
    await REQUESTS.loaded;
    for (const f of files) {
      REQUESTS.delete(f.key);
    }
  }
})();

class Expirer {
  constructor() {
    this.requests = (async () => {
      const a = [];
      let added = 0;
      await REQUESTS.loaded;
      REQUESTS.on("set", (_, v) => {
        a.push(v);
        if (++added >= 1) {
          sort(a, (f) => f.expires);
          added = 0;
        }
      });
      a.push(...REQUESTS.values());
      return sort(a, (f) => f.expires);
    })();
  }

  async expire() {
    await REQUESTS.loaded;
    const requests = await this.requests;
    for (;;) {
      const [request] = requests;
      if (!request) {
        break;
      }
      if (!REQUESTS.has(request.key)) {
        requests.shift();
        continue;
      }
      try {
        if (!(await request.expire())) {
          return;
        }
        requests.shift();
      } catch (ex) {
        console.error(`Failed to remove request ${request.key}`, ex);
        requests.shift();
      }
    }
  }
}

module.exports = {
  EMITTER,
  REQUESTS,
  Expirer,
};
