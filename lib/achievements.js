"use strict";

const { toPrettySize, toPrettyInt } = require("./util");

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
const REQUEST_MILESTONES = Object.freeze([
  1, 5, 10, 25, 50, 100, 250, 500, 1000,
]);
const REQUEST_CREATED_MILESTONES = Object.freeze([5, 25, 100]);

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

const REQUEST_TITLES = Object.freeze([
  "First Responder",
  "Helpful Hand",
  "Gap Filler",
  "Shelf Finder",
  "Stack Saver",
  "Request Ranger",
  "Needle Seeker",
  "Room Quartermaster",
  "Patron Saint",
]);

const REQUEST_CREATED_TITLES = Object.freeze([
  "Testing the Waters",
  "Request Regular",
  "Feature Evangelist",
]);

const ICONS = Object.freeze({
  // Font Awesome 6 Free solid class strings.
  // Each sub-array maps index → rarity tier span (common→…→ascendant).
  files: [
    // common (3)
    "fa-solid fa-file",
    "fa-solid fa-file-lines",
    "fa-solid fa-folder-open",
    // uncommon (3)
    "fa-solid fa-box-archive",
    "fa-solid fa-boxes-stacked",
    "fa-solid fa-layer-group",
    // rare (2)
    "fa-solid fa-list",
    "fa-solid fa-table-list",
    // epic (2)
    "fa-solid fa-database",
    "fa-solid fa-building-columns",
    // legendary (2)
    "fa-solid fa-landmark",
    "fa-solid fa-trophy",
    // mythic (2)
    "fa-solid fa-crown",
    "fa-solid fa-gem",
    // ascendant (2)
    "fa-solid fa-star",
    "fa-solid fa-fire-flame-curved",
  ],
  bytes: [
    // common (3)
    "fa-solid fa-arrow-up-from-bracket",
    "fa-solid fa-cloud-arrow-up",
    "fa-solid fa-hard-drive",
    // uncommon (3)
    "fa-solid fa-server",
    "fa-solid fa-database",
    "fa-solid fa-microchip",
    // rare (2)
    "fa-solid fa-network-wired",
    "fa-solid fa-globe",
    // epic (2)
    "fa-solid fa-satellite-dish",
    "fa-solid fa-tower-broadcast",
    // legendary (2)
    "fa-solid fa-bolt",
    "fa-solid fa-fire",
    // mythic (2+) — wraps for deeper milestones
    "fa-solid fa-fire-flame-curved",
    "fa-solid fa-trophy",
    "fa-solid fa-crown",
    "fa-solid fa-gem",
  ],
  downloads: [
    // common (3)
    "fa-solid fa-file-arrow-down",
    "fa-solid fa-cloud-arrow-down",
    "fa-solid fa-download",
    // uncommon (3)
    "fa-solid fa-box-open",
    "fa-solid fa-vault",
    "fa-solid fa-warehouse",
    // rare (2)
    "fa-solid fa-building",
    "fa-solid fa-landmark",
    // epic (2)
    "fa-solid fa-trophy",
    "fa-solid fa-award",
    // legendary (2)
    "fa-solid fa-medal",
    "fa-solid fa-crown",
    // mythic (2+) — wraps for deeper milestones
    "fa-solid fa-gem",
    "fa-solid fa-star",
    "fa-solid fa-bolt",
    "fa-solid fa-fire-flame-curved",
  ],
  requests: [
    "fa-solid fa-circle-check",
    "fa-solid fa-hand-holding-heart",
    "fa-solid fa-life-ring",
    "fa-solid fa-compass",
    "fa-solid fa-map",
    "fa-solid fa-wand-magic-sparkles",
    "fa-solid fa-medal",
    "fa-solid fa-trophy",
    "fa-solid fa-crown",
  ],
  requestsCreated: [
    "fa-solid fa-note-sticky",
    "fa-solid fa-list-check",
    "fa-solid fa-bullhorn",
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
    if (index < offset) {
      return tier.name;
    }
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
  const fulfilledRequests = parseInt(stats.fulfilledRequests, 10) || 0;
  const createdRequests = parseInt(stats.createdRequests, 10) || 0;

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

  const requestAchievements = makeAchievements(
    fulfilledRequests,
    REQUEST_MILESTONES,
    {
      kind: "requests",
      icons: ICONS.requests,
      titleFor(index) {
        return REQUEST_TITLES[index] || `Request Keeper ${index + 1}`;
      },
      describe(required) {
        return `Complete ${toPrettyInt(required)} requests`;
      },
    },
  );

  const requestCreatedAchievements = makeAchievements(
    createdRequests,
    REQUEST_CREATED_MILESTONES,
    {
      kind: "requests-created",
      icons: ICONS.requestsCreated,
      titleFor(index) {
        return REQUEST_CREATED_TITLES[index] || `Request Starter ${index + 1}`;
      },
      describe(required) {
        return `Create ${toPrettyInt(required)} requests`;
      },
    },
  );

  const byRequired = (a, b) => a.required - b.required;
  const allAchievements = fileAchievements.concat(
    byteAchievements,
    downloadAchievements,
    requestAchievements,
    requestCreatedAchievements,
  );
  const unlockedList = allAchievements.
    filter(a => a.unlocked).
    sort(byRequired);
  const lockedList = allAchievements.
    filter(a => !a.unlocked).
    sort(byRequired);
  const all = unlockedList.concat(lockedList);
  const unlocked = unlockedList.length;

  return {
    files,
    uploaded,
    downloaded,
    fulfilledRequests,
    createdRequests,
    unlocked,
    total: all.length,
    all,
    unlockedList,
    lockedList,
    filesOnly: fileAchievements,
    bytesOnly: byteAchievements,
    downloadsOnly: downloadAchievements,
    requestsOnly: requestAchievements,
    requestsCreatedOnly: requestCreatedAchievements,
  };
}

module.exports = {
  computeAchievements,
  FILE_MILESTONES,
  BYTE_MILESTONES,
  DOWNLOAD_BYTE_MILESTONES,
  REQUEST_MILESTONES,
  REQUEST_CREATED_MILESTONES,
};
