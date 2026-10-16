"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { setTimeout: delay } = require("node:timers/promises");

async function inside(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    throw new Error("The backup manifest contains an invalid relative path. Ask the operator to correct it.");
  }
  const full = await fs.promises.realpath(path.resolve(root, relative));
  if (!full.startsWith(root + path.sep) || !(await fs.promises.stat(full)).isFile()) {
    throw new Error("A backup sample is outside the approved directory or is not a regular file.");
  }
  return full;
}

async function readManifest(settings) {
  const root = await fs.promises.realpath(settings.directory);
  const full = await inside(root, settings.manifest || "manifest.json");
  if ((await fs.promises.stat(full)).size > 1024 * 1024) {
    throw new Error("The backup manifest exceeds 1 MiB. Reduce it to at most 500 samples.");
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(full, "utf8"));
  }
  catch (_) {
    throw new Error("The backup manifest is not valid JSON. Ask the operator to regenerate it.");
  }
  if (!manifest || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 500 || manifest.files.some(file => !file || typeof file.path !== "string" || !file.path || file.path.length > 1024 || !/^[a-f0-9]{64}$/i.test(file.sha256 || "") || !Number.isSafeInteger(file.size) || file.size < 0)) {
    throw new Error("The backup manifest needs createdAt and 1–500 files with path, size and SHA-256. Ask the operator to regenerate it.");
  }
  return { root, manifest };
}

async function inspectBackup(settings) {
  const { manifest } = await readManifest(settings);
  return { createdAt: Date.parse(manifest.createdAt), files: manifest.files.length, bytes: manifest.files.reduce((total, file) => total + file.size, 0) };
}

async function verifyBackup(settings, { maxFiles = 2, maxBytes = 33554432, cursor = 0, signal } = {}) {
  const { root, manifest } = await readManifest(settings); const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dicefiles-backup-check-"));
  if (!path.resolve(temporary).startsWith(`${path.resolve(os.tmpdir())}${path.sep}dicefiles-backup-check-`)) {
    throw new Error("Temporary backup verification path is invalid. Ask the operator to inspect it.");
  }
  maxBytes = Math.max(1, Math.min(1073741824, Number(maxBytes) || 33554432));
  const result = { createdAt: Date.parse(manifest.createdAt), checked: 0, bytes: 0, items: [], cursor: Math.max(0, Math.floor(Number(cursor) || 0)) };
  try {
    for (let count = 0; count < Math.min(5, Math.max(1, Number(maxFiles) || 2), manifest.files.length); count++) {
      signal?.throwIfAborted(); const index = result.cursor % manifest.files.length; const entry = manifest.files[index];
      if (entry.size * 2 > maxBytes - result.bytes) {
        result.items.push({ title: path.basename(entry.path), detail: "Above the remaining sample budget; increase the scan limit to verify it.", status: "warning" }); result.cursor++; continue;
      }
      const full = await inside(root, entry.path); let bytes = 0;
      const counter = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes * 2 > maxBytes - result.bytes) {
          callback(new Error("Backup sample exceeded the byte budget. Check the manifest sizes.")); return;
        }
        delay(Math.ceil(chunk.length / (8 * 1024 * 1024) * 1000), undefined, { signal }).then(() => callback(null, chunk), callback);
      } });
      const target = path.join(temporary, `${count}.sample`);
      await pipeline(fs.createReadStream(full), counter, fs.createWriteStream(target, { flags: "wx", mode: 0o600 }), { signal });
      const digest = createHash("sha256"); let restoredBytes = 0;
      for await (const chunk of fs.createReadStream(target)) {
        signal?.throwIfAborted(); restoredBytes += chunk.length; digest.update(chunk);
        await delay(Math.ceil(chunk.length / (8 * 1024 * 1024) * 1000), undefined, { signal });
      }
      const checksum = digest.digest("hex");
      result.items.push({ title: path.basename(entry.path), detail: checksum === entry.sha256.toLowerCase() && bytes === entry.size ? "Sample restored in an isolated temporary directory; checksum and size verified." : "Sample checksum or size does not match the manifest. Review the backup before relying on it.", status: checksum === entry.sha256.toLowerCase() && bytes === entry.size ? "success" : "error" });
      result.bytes += bytes + restoredBytes; result.checked++; result.cursor++;
    }
    return result;
  }
  finally {
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

module.exports = { inspectBackup, verifyBackup, inside };
