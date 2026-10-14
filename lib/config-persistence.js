"use strict";

const fs = require("fs/promises");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { withLease } = require("./redis-lease");

function persistConfig(updates, configPath = path.resolve(".config.json")) {
  const lockKey = `lock:config:${createHash("sha256").update(configPath).digest("hex")}`;
  return withLease(lockKey, async assertOwned => {
    let existing = {};
    let mode = 0o600;
    try {
      const stat = await fs.lstat(configPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
        throw new Error("Config must be a regular file under 4 MiB");
      }
      mode = stat.mode & 0o777;
      existing = JSON.parse(await fs.readFile(configPath, "utf8"));
      if (!existing || Array.isArray(existing) || typeof existing !== "object") {
        throw new Error("Config must contain an object");
      }
    }
    catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    Object.assign(existing, updates);
    const temporary = path.join(path.dirname(configPath), `.config-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, "wx", mode);
      await handle.writeFile(`${JSON.stringify(existing, null, 2)}\n`);
      await handle.sync();
      await handle.close();
      handle = null;
      await assertOwned();
      await fs.rename(temporary, configPath);
      const directory = await fs.open(path.dirname(configPath), "r");
      try {
        await directory.sync();
      }
      finally {
        await directory.close();
      }
    }
    finally {
      if (handle) {
        await handle.close();
      }
      await fs.unlink(temporary).catch(error => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      });
    }
  });
}

module.exports = { persistConfig };
