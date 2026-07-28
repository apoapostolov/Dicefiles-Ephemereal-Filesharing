#!/usr/bin/env node
"use strict";

/**
 * Re-detect metadata and generate missing previews for existing uploads.
 *
 * Usage:
 *   yarn backfill:previews
 *   yarn backfill:previews --dry-run
 */

const fs = require("fs");
const BROKER = require("../lib/broker");
const { STORAGE, StorageLocation } = require("../lib/storage");
const { getMetaData, generateAssets } = require("../lib/meta");
const { indexArchive } = require("../lib/archive");

const DRY_RUN = process.argv.includes("--dry-run");

function redisMapField(key) {
  return JSON.stringify({ v: key });
}

function isPreviewable(storage) {
  const type = ((storage.meta || {}).type || "").toUpperCase();
  return (
    type === "PDF" ||
    type === "EPUB" ||
    type === "MOBI" ||
    type === "AZW" ||
    type === "AZW3" ||
    type === "CBZ" ||
    type === "CBR" ||
    type === "CBT" ||
    type === "CB7" ||
    storage.mime.startsWith("image/") ||
    storage.mime.startsWith("video/") ||
    storage.mime.startsWith("audio/")
  );
}

async function persistStorage(hash, storage) {
  await BROKER.PUB.hSet(
    "map:upload:storage",
    redisMapField(hash),
    JSON.stringify(storage),
  );
}

async function persistUpload(key, upload) {
  await BROKER.PUB.hSet(
    "map:upload:uploads",
    redisMapField(key),
    JSON.stringify(upload),
  );
}

async function main() {
  await Promise.all([BROKER.ready(), STORAGE.loaded]);

  const uploadsByHash = new Map();
  const rawUploads = await BROKER.PUB.hGetAll("map:upload:uploads");
  for (const [rawKey, rawUpload] of Object.entries(rawUploads)) {
    const key = JSON.parse(rawKey).v;
    const upload = JSON.parse(rawUpload);
    if (!uploadsByHash.has(upload.hash)) {
      uploadsByHash.set(upload.hash, []);
    }
    uploadsByHash.get(upload.hash).push([key, upload]);
  }

  let refreshed = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const [hash, oldStorage] of STORAGE) {
    const references = uploadsByHash.get(hash) || [];
    const displayName =
      (references[0] && references[0][1].name) || oldStorage.name;
    if (!fs.existsSync(oldStorage.full)) {
      console.warn(`[missing] ${displayName}`);
      failed++;
      continue;
    }

    if (oldStorage.assets.size) {
      console.log(`[skip] ${displayName} already has previews`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[would refresh] ${displayName}`);
      refreshed++;
      continue;
    }

    try {
      const detected = await getMetaData(oldStorage, displayName);
      const storage = new StorageLocation({
        ...oldStorage.toJSON(),
        type: detected.type,
        mime: detected.mime,
        meta: { ...oldStorage.meta, ...detected.meta },
        tags: { ...oldStorage.tags, ...detected.tags },
      });

      if (storage.type === "archive") {
        await indexArchive(storage);
      }
      if (isPreviewable(storage)) {
        await generateAssets(storage);
        if (storage.assets.size) {
          generated++;
        }
      }

      await persistStorage(hash, storage);
      for (const [key, upload] of references) {
        upload.type = storage.type;
        upload.meta = { ...upload.meta, ...storage.meta };
        await persistUpload(key, upload);
      }
      console.log(
        `[updated] ${displayName}: ${storage.type}/${storage.mime}, ` +
          `${storage.assets.size} preview(s)`,
      );
      refreshed++;
    }
    catch (error) {
      console.error(`[failed] ${displayName}: ${error.message || error}`);
      failed++;
    }
  }

  console.log(
    `Done: refreshed=${refreshed} generated=${generated} ` +
      `skipped=${skipped} failed=${failed}`,
  );
  if (failed) {
    process.exitCode = 1;
  }
}

main().
  catch(error => {
    console.error(error);
    process.exitCode = 1;
  }).
  finally(async () => {
    STORAGE.kill();
    if (BROKER.PUB.isOpen) {
      await BROKER.PUB.quit();
    }
    process.exit(process.exitCode || 0);
  });
