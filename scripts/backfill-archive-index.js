#!/usr/bin/env node
"use strict";

/**
 * One-time backfill script: index archive contents for existing uploads that
 * are missing meta.archive_count.
 *
 * Finds all uploads in Redis where:
 *   - type === "archive"  (standard ZIPs/RARs properly classified)
 *   - OR type === "file" AND meta.type is a plain archive format
 *     (7Z files and ZIPs uploaded before the archive type was introduced)
 *
 * For each matching upload, calls listArchive() and writes archive_count +
 * archive_ext_sample directly into Redis without going through the broker.
 *
 * Usage:
 *   node scripts/backfill-archive-index.js [--dry-run]
 */

const redis = require("redis");
const { promisify } = require("util");
const path = require("path");
const CONFIG = require("../lib/config");
const { listArchive } = require("../lib/archive");

const DRY_RUN = process.argv.includes("--dry-run");
const UPLOADS_DIR = CONFIG.get("uploads");

const PLAIN_ARCHIVE_META_TYPES = new Set([
  "ZIP",
  "7Z",
  "RAR",
  "TAR",
  "GZIP",
  "BZ2",
]);
const STORAGE_MAP_KEY = "map:upload:storage";

async function main() {
  // Build Redis connection params the same way the broker does
  const CONN = {};
  CONFIG.forEach((v, k) => {
    if (k.startsWith("redis_")) {
      CONN[k.slice("redis_".length)] = v;
    }
  });

  const client = redis.createClient(CONN);
  client.on("error", (err) => console.error("Redis error:", err));

  const hgetall = promisify(client.hgetall).bind(client);
  const hset = promisify(client.hset).bind(client);
  const quit = promisify(client.quit).bind(client);

  console.log(`Connected to Redis. DRY_RUN=${DRY_RUN}`);

  // Load all entries from the storage hash
  const raw = await hgetall(STORAGE_MAP_KEY);
  const keys = Object.keys(raw);
  console.log(`Total uploads in storage map: ${keys.length}`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of keys) {
    let entry;
    try {
      entry = JSON.parse(raw[key]);
    } catch {
      console.warn(`  Skipping: could not parse entry for key ${key}`);
      skipped++;
      continue;
    }

    const { name, hash, type, meta = {} } = entry;
    if (!name || !hash) {
      skipped++;
      continue;
    }

    // Determine if this upload should be indexed
    const isArchiveType = type === "archive";
    const isPlainArchiveFile =
      type === "file" &&
      PLAIN_ARCHIVE_META_TYPES.has((meta.type || "").toUpperCase());

    if (!isArchiveType && !isPlainArchiveFile) {
      skipped++;
      continue;
    }

    // Skip if already indexed
    if (meta.archive_count) {
      console.log(
        `  [skip] ${name} — already indexed (${meta.archive_count} files)`,
      );
      skipped++;
      continue;
    }

    // Resolve file path
    const filePath = path.join(UPLOADS_DIR, name[0], name[1], name);

    console.log(
      `  [index] ${name} (type=${type}, meta.type=${meta.type || "?"})`,
    );

    if (DRY_RUN) {
      processed++;
      continue;
    }

    try {
      const listing = await listArchive(filePath, name);
      const files = (listing.files || []).filter((f) => !f.isDir);
      const count = String(files.length);

      // Collect up to 3 unique extensions
      const extSet = new Set();
      for (const f of files) {
        const ext = path.extname(f.path).toLowerCase().replace(/^\./, "");
        if (ext && ext.length <= 8) extSet.add(ext);
        if (extSet.size >= 3) break;
      }
      const extSample = Array.from(extSet).join(",");

      // Patch the stored JSON and write back
      entry.meta = entry.meta || {};
      entry.meta.archive_count = count;
      entry.meta.archive_ext_sample = extSample;
      // If it was misclassified as "file", correct the type too
      if (isPlainArchiveFile) {
        entry.type = "archive";
        console.log(`    corrected type: file → archive`);
      }
      await hset(STORAGE_MAP_KEY, key, JSON.stringify(entry));
      console.log(`    → ${count} files, exts: ${extSample || "(none)"}`);
      processed++;
    } catch (ex) {
      console.warn(`    FAILED: ${ex.message || ex}`);
      failed++;
    }
  }

  await quit();
  console.log(
    `\nDone. processed=${processed} skipped=${skipped} failed=${failed}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
