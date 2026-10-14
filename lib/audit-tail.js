"use strict";

const fs = require("fs/promises");

/** Read only a bounded suffix. Discard the first incomplete and oversized lines. */
async function readAuditTail(file, { limit = 100, since = 0, maxBytes = 1024 * 1024 } = {}) {
  if (!file) {
    return [];
  }
  let handle;
  try {
    handle = await fs.open(file, "r");
  }
  catch (error) {
    if (error.code === "ENOENT") {
      return [];
    } throw error;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const bytes = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
    const lines = bytes.subarray(0, bytesRead).toString("utf8").split("\n");
    if (start) {
      lines.shift();
    }
    const entries = [];
    for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
      if (!lines[i] || Buffer.byteLength(lines[i]) > 65536) {
        continue;
      }
      try {
        const entry = JSON.parse(lines[i]);
        if (since && new Date(entry.at || entry.timestamp).getTime() <= since) {
          continue;
        }
        entries.push(entry);
      }
      catch (_) { /* Ignore partial or malformed records. */ }
    }
    return entries;
  }
  finally {
    await handle.close();
  }
}

module.exports = { readAuditTail };
