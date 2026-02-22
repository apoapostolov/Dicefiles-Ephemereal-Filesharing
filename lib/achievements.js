"use strict";

const { toPrettySize, toPrettyInt } = require("./util");
const CONFIG = require("./config");

const KiB = 1024;
const MiB = KiB * KiB;
const GiB = KiB * MiB;
const TiB = KiB * GiB;
const PiB = KiB * TiB;

const FILE_MILESTONES = Object.freeze([
  10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000,
  250000, 500000, 1000000,
]);

const FILE_TITLES = Object.freeze([
  "First Stack",
  "Page Scribe",
  "Shelf Starter",
  "Archive Clerk",
  "Collection Keeper",
  "Volume Curator",
  "Script Librarian",
  "Codex Steward",
  "Tome Marshal",
  "Vault Chronicler",
  "Grand Registrar",
  "Lore Custodian",
  "Archive Chancellor",
  "Repository Regent",
  "Library Sovereign",
  "Eternal Archivist",
]);

const BYTE_MILESTONES = Object.freeze([
  50 * MiB,
  100 * MiB,
  250 * MiB,
  500 * MiB,
  1 * GiB,
  2 * GiB,
  5 * GiB,
  10 * GiB,
  25 * GiB,
  50 * GiB,
  100 * GiB,
  250 * GiB,
  500 * GiB,
  1 * TiB,
  2 * TiB,
  5 * TiB,
  10 * TiB,
  25 * TiB,
  50 * TiB,
  100 * TiB,
  250 * TiB,
  500 * TiB,
  1 * PiB,
  2 * PiB,
  5 * PiB,
  10 * PiB,
]);

const BYTE_TITLES = Object.freeze([
  "Byte Scout",
  "Data Porter",
  "Block Carrier",
  "Chunk Keeper",
  "Gig Runner",
  "Cache Warden",
  "Buffer Captain",
  "Payload Marshal",
  "Bandwidth Knight",
  "Storage Baron",
  "Depot Lord",
  "Transfer Duke",
  "Vault Prince",
  "Terabyte Regent",
  "Terabyte Monarch",
  "Data Emperor",
  "Petabyte Herald",
  "Petabyte Tribune",
  "Petabyte Viceroy",
  "Petabyte Archon",
  "Petabyte Overlord",
  "Petabyte Ascendant",
]);

const DOWNLOAD_BYTE_MILESTONES = Object.freeze(BYTE_MILESTONES);

const DOWNLOAD_BYTE_TITLES = Object.freeze([
  "First Fetch",
  "Link Runner",
  "Packet Courier",
  "Mirror Squire",
  "Cache Hunter",
  "Archive Seeker",
  "Vault Retriever",
  "Bulk Harvester",
  "Bit Pathfinder",
  "Storefront Raider",
  "Repository Pilgrim",
  "Chronicle Gatherer",
  "Compendium Forager",
  "Terabyte Trailblazer",
  "Terabyte Pathfinder",
  "Data Conqueror",
  "Petabyte Nomad",
  "Petabyte Ranger",
  "Petabyte Vanguard",
  "Petabyte Marshal",
  "Petabyte Warmaster",
  "Petabyte Mytharch",
]);

const ICONS = Object.freeze({
  // Each sub-array maps one-to-one to the rarity tier span for semantic
  // progression: common→uncommon→rare→epic→legendary→mythic→ascendant.
  files: [
    // common (3)
    "i-file",
    "i-upload",
    "i-document",
    // uncommon (3)
    "i-images",
    "i-video",
    "i-audio",
    // rare (2)
    "i-archive",
    "i-list",
    // epic (2)
    "i-grid",
    "i-copy",
    // legendary (2)
    "i-owner",
    "i-plus",
    // mythic (2)
    "i-arrow-up",
    "i-info",
    // ascendant (2)
    "i-upload-done",
    "i-wait",
  ],
  bytes: [
    // common (3)
    "i-upload-done",
    "i-archive-b",
    "i-file-b",
    // uncommon (3)
    "i-document-b",
    "i-image-b",
    "i-video-b",
    // rare (2)
    "i-audio-b",
    "i-clock",
    // epic (2)
    "i-upload",
    "i-arrow-up",
    // legendary (2)
    "i-wait",
    "i-owner",
    // mythic (2)
    "i-download",
    "i-info",
    // ascendant (2)
    "i-grid",
    "i-copy",
    // extra for overflow milestones
    "i-plus",
    "i-list",
    "i-archive",
    "i-images",
    "i-video",
    "i-audio",
    "i-document",
    "i-file",
  ],
  downloads: [
    // common (3)
    "i-download",
    "i-file-b",
    "i-document-b",
    // uncommon (3)
    "i-images",
    "i-video",
    "i-audio",
    // rare (2)
    "i-archive-b",
    "i-list",
    // epic (2)
    "i-grid",
    "i-clock",
    // legendary (2)
    "i-wait",
    "i-arrow-up",
    // mythic (2)
    "i-info",
    "i-owner",
    // ascendant (2)
    "i-copy",
    "i-upload-done",
    // extra for overflow milestones
    "i-plus",
    "i-file",
    "i-upload",
    "i-image-b",
    "i-video-b",
    "i-audio-b",
    "i-archive",
    "i-document",
  ],
});

const RARITY_TIERS = Object.freeze([
  { name: "common", span: 3 },
  { name: "uncommon", span: 3 },
  { name: "rare", span: 2 },
  { name: "epic", span: 2 },
  { name: "legendary", span: 2 },
  { name: "mythic", span: 2 },
  { name: "ascendant", span: 2 },
]);

function pickIcon(list, index) {
  return list[index % list.length];
}

function rarityForIndex(index) {
  let offset = 0;
  for (const tier of RARITY_TIERS) {
    offset += tier.span;
    if (index < offset) return tier.name;
  }
  return RARITY_TIERS[RARITY_TIERS.length - 1].name;
}

function makeAchievements(current, milestones, opts) {
  return milestones.map((required, index) => {
    const unlocked = current >= required;
    return {
      key: `${opts.kind}-${required}`,
      kind: opts.kind,
      icon: pickIcon(opts.icons, index),
      rarity: rarityForIndex(index),
      title: opts.titleFor(index, required),
      description: opts.describe(required),
      required,
      current,
      unlocked,
    };
  });
}

function computeAchievements(stats) {
  const files = parseInt(stats.files, 10) || 0;
  const uploaded = parseInt(stats.uploaded, 10) || 0;
  const downloaded = parseInt(stats.downloaded, 10) || 0;

  const fileAchievements = makeAchievements(files, FILE_MILESTONES, {
    kind: "files",
    icons: ICONS.files,
    titleFor(index) {
      return FILE_TITLES[index] || `Archivist ${index + 1}`;
    },
    describe(required) {
      return `Upload ${toPrettyInt(required)} files`;
    },
  });

  const byteAchievements = makeAchievements(uploaded, BYTE_MILESTONES, {
    kind: "bytes",
    icons: ICONS.bytes,
    titleFor(index) {
      return BYTE_TITLES[index] || `Vaultkeeper ${index + 1}`;
    },
    describe(required) {
      return `Upload ${toPrettySize(required)} total`;
    },
  });

  const downloadAchievements = makeAchievements(
    downloaded,
    DOWNLOAD_BYTE_MILESTONES,
    {
      kind: "downloads",
      icons: ICONS.downloads,
      titleFor(index) {
        return DOWNLOAD_BYTE_TITLES[index] || `Collector ${index + 1}`;
      },
      describe(required) {
        return `Download ${toPrettySize(required)} total`;
      },
    },
  );

  const byRequired = (a, b) => a.required - b.required;
  const allAchievements = fileAchievements.concat(
    byteAchievements,
    downloadAchievements,
  );
  const unlockedList = allAchievements
    .filter((a) => a.unlocked)
    .sort(byRequired);
  const lockedList = allAchievements
    .filter((a) => !a.unlocked)
    .sort(byRequired);
  const all = unlockedList.concat(lockedList);
  const unlocked = unlockedList.length;

  return {
    files,
    uploaded,
    downloaded,
    unlocked,
    total: all.length,
    all,
    unlockedList,
    lockedList,
    filesOnly: fileAchievements,
    bytesOnly: byteAchievements,
    downloadsOnly: downloadAchievements,
  };
}

/**
 * Seasonal / event achievements — placeholder.
 * Returns an empty array when the `seasonalAchievements` feature flag is off.
 * When enabled, this function should build and return achievement objects
 * using the same shape as makeAchievements() output so they can be merged
 * into the achievements UI without further changes.
 *
 * @param {object} stats  — same shape as uploadStats() result
 * @returns {Array}
 */
function computeSeasonalAchievements(stats) {
  if (!CONFIG.get("seasonalAchievements")) {
    return [];
  }
  // Extend here with real seasonal achievement logic when needed.
  return [];
}

module.exports = {
  computeAchievements,
  computeSeasonalAchievements,
  FILE_MILESTONES,
  BYTE_MILESTONES,
  DOWNLOAD_BYTE_MILESTONES,
};
