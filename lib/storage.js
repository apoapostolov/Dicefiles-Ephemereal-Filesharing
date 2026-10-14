"use strict";

const fs = require("fs");
const path = require("path");
const {promisify} = require("util");
const BROKER = require("./broker");
const {DistributedMap} = require("./broker/collections");
const { withLease } = require("./redis-lease");

const redis = BROKER.getMethods("dset", "scard");
const { getVolume } = require("./storage-volumes");
const { randomUUID } = require("crypto");

const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

async function mkdirp(dir) {
  await mkdir(dir, { recursive: true });
}

function toskey(s) {
  return `upload:s:${s}`;
}

class StorageLocation {
  constructor(data) {
    this.meta = {};
    this.tags = {};
    this.assets = [];
    this.mime = "application/octet-stream";
    if (typeof data === "string") {
      this.name = data;
      this.volumeId = "legacy";
    }
    else {
      Object.assign(this, data);
      this.volumeId = this.volumeId || "legacy";
    }
    if (Array.isArray(this.assets)) {
      this.assets = new Map(this.assets);
    }
    else {
      this.assets = new Map();
    }
    this.url = path.join("/", this.name[0], this.name[1], this.name);
    this.dir = path.join(
      getVolume(this.volumeId).path,
      this.name[0],
      this.name[1],
    );
    this.full = path.join(this.dir, this.name);
    Object.freeze(this);
  }

  async _addAsset(asset) {
    if (!asset.ext || !/^\.[a-zA-Z0-9._-]{1,100}$/.test(asset.ext) || !asset.type || !asset.mime) {
      throw new Error("Trying to add an incomplete asset");
    }
    if (this.assets.has(asset.ext)) {
      return;
    }
    const full = this.full + asset.ext;
    const { data, file } = asset;
    if (!file && (!Buffer.isBuffer(data) || !data.length)) {
      throw new Error("Trying to add invalid asset data");
    }
    if (file !== full) {
      const temporary = `${full}.preview-${randomUUID()}`;
      try {
        if (file) {
          await fs.promises.copyFile(file, temporary, fs.constants.COPYFILE_EXCL);
        }
        else {
          await fs.promises.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
        }
        const handle = await fs.promises.open(temporary, "r+");
        try {
          await handle.sync();
        }
        finally {
          await handle.close();
        }
        await fs.promises.rename(temporary, full);
        if (file) {
          await fs.promises.unlink(file);
        }
      }
      finally {
        await fs.promises.unlink(temporary).catch(error => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        });
      }
    }
    const metadata = { ...asset }; delete metadata.data; delete metadata.file;
    this.assets.set(asset.ext, metadata);
  }

  async addAssets(assets, { replace = false } = {}) {
    if (!this.hash) {
      throw new Error("Cannot add assets to temporary storage");
    }
    return withLease(`lock:storage-blob:${this.hash}`, async assertOwned => {
      const raw = await STORAGE.getFresh(this.hash);
      if (!raw) {
        return;
      }
      const current = new StorageLocation(raw);
      if (replace) {
        for (const asset of assets) {
          current.assets.delete(asset.ext);
        }
      }
      await Promise.all(assets.map(current._addAsset.bind(current)));
      await assertOwned();
      await STORAGE.updateAtomic(this.hash, value => {
        if (value.volumeId !== current.volumeId || value.name !== current.name) {
          throw new Error("Storage changed while adding previews");
        }
        return new StorageLocation({ ...value.toJSON(), assets: Array.from(current.assets) });
      });
      BROKER.emit("storage-updated", this.hash);
    });
  }

  async mkdir() {
    await mkdirp(this.dir);
  }

  async ref(key) {
    return withLease(`lock:storage-blob:${this.hash}`, async assertOwned => {
      if (!await STORAGE.getFresh(this.hash)) {
        throw new Error("Storage was removed before reference creation");
      }
      await assertOwned();
      await redis.dset(toskey(this.name), "atomic", "add", JSON.stringify({ v: key }));
    });
  }

  async unref(key) {
    return withLease(`lock:storage-blob:${this.hash}`, async assertOwned => {
      await redis.dset(toskey(this.name), "atomic", "delete", JSON.stringify({ v: key }));
      if (Number(await redis.scard(toskey(this.name)))) {
        return false;
      }
      const raw = await STORAGE.getFresh(this.hash);
      if (raw) {
        await assertOwned();
        await new StorageLocation(raw)._rmUnlocked();
        await STORAGE.deleteDurable(this.hash);
      }
      return true;
    });
  }

  async rm() {
    if (!this.hash) {
      return this._rmUnlocked();
    }
    return withLease(`lock:storage-blob:${this.hash}`, async assertOwned => {
      const current = await STORAGE.getFresh(this.hash);
      await assertOwned();
      return new StorageLocation(current || this.toJSON())._rmUnlocked();
    });
  }

  async _rmUnlocked() {
    try {
      await unlink(this.full);
    }
    catch (ex) {
      console.error(`Failed to remove storage ${this.full}`);
    }
    for (const a of this.assets.values()) {
      try {
        await unlink(this.full + a.ext);
      }
      catch (ex) {
        console.error(`Failed to remove asset storage ${this.full}: `, a);
      }
    }
    try {
      await rmdir(this.dir);
    }
    catch (ex) {
      // ignored
    }
  }

  async openWriteAt(offset) {
    await mkdirp(this.dir);
    return fs.createWriteStream(this.full, {
      encoding: null,
      flags: offset ? "r+" : "w",
      start: offset,
    });
  }

  toJSON() {
    return {
      name: this.name,
      hash: this.hash,
      mime: this.mime,
      type: this.type,
      meta: this.meta,
      tags: this.tags,
      size: this.size,
      assets: Array.from(this.assets.entries()),
      volumeId: this.volumeId,
    };
  }

  get hidden() {
    return this.tags.hidden;
  }

  set hidden(val) {
    if (!this.hash) {
      throw new Error("Cannot hide temporary storage");
    }
    val = !!val;
    if (val === !!this.tags.hidden) {
      return;
    }
    this.tags.hidden = !!val;
    if (!STORAGE.has(this.hash)) {
      STORAGE.set(this.hash, this);
    }
    else {
      STORAGE.updateAtomic(this.hash, current => {
        current.tags.hidden = val;
        return current;
      }).then(() => BROKER.emit("storage-hidden", this.hash)).catch(error => console.error("Storage visibility update failed", error.message));
    }
  }

  toString() {
    return `StorageLocation(${this.full})`;
  }
}

const STORAGE = new DistributedMap(
  "upload:storage", (v, hash) => new StorageLocation({ ...v, hash: v.hash || hash }));


module.exports = {toskey, StorageLocation, STORAGE};
