"use strict";

const GROUPS = [
  ["Video", "video", /\.(mp4|mkv|avi|mov|webm|m4v|mpeg|mpg|ts)$/i],
  ["Audio", "audio", /\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff)$/i],
  ["Books & documents", "document", /\.(pdf|epub|mobi|azw3?|docx?|odt|txt|rtf|cbz|cbr)$/i],
  ["Images", "image", /\.(png|jpe?g|webp|gif|avif|tiff?|svg|heic)$/i],
  ["Software", "file", /\.(exe|msi|dmg|apk|deb|rpm|appimage|iso)$/i],
  ["Archives", "archive", /\.(zip|rar|7z|tar|gz|bz2|xz)$/i],
];

function fileKind(path) {
  const group = GROUPS.find(([, , pattern]) => pattern.test(path));
  return { label: group?.[0] || "Other files", icon: group?.[1] || "file" };
}

function presentTorrent(torrent, fallback = "Torrent") {
  const files = Array.isArray(torrent.files) ? torrent.files : [];
  const kinds = new Map();
  for (const file of files) {
    const kind = fileKind(file.path);
    const row = kinds.get(kind.label) || { ...kind, count: 0, size: 0 };
    row.count++; row.size += file.size || 0; kinds.set(kind.label, row);
  }
  const categories = [...kinds.values()].sort((a, b) => b.size - a.size || b.count - a.count);
  const suppliedName = torrent.name || fallback;
  const name = suppliedName === torrent.infoHashV1 || suppliedName === torrent.infoHashV2 ? "Torrent" : suppliedName.replace(/\.(magnet|torrent)$/i, "");
  return { name, files, categories, category: categories.length === 1 ? categories[0].label : categories.length ? "Mixed files" : "Torrent",
    known: files.length > 0, size: Number.isSafeInteger(torrent.totalSize) && torrent.totalSize >= 0 ? torrent.totalSize : null };
}

function availabilityView(torrent, now = Date.now()) {
  const stats = torrent.availability || {};
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const seeders = count(stats.seeders); const peers = count(stats.leechers);
  const reportedAt = stats.reportedAt || (stats.responding ? stats.checkedAt : null);
  const known = seeders !== null || peers !== null;
  const stale = known && (stats.state === "stale" || !reportedAt || now - reportedAt > 45 * 60000);
  const format = value => value === null ? "—" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const full = value => value === null ? "Unknown" : value.toLocaleString();
  const state = stale ? "stale" : known ? "current" : "unknown";
  const explanation = known ? `${stale ? "Last known report. " : ""}${reportedAt ? `Reported ${new Date(reportedAt).toLocaleString()}. ` : ""}Tracker counts are estimates; downloading peers exclude seeders.` : "Tracker counts are unavailable. A dash means unknown, not zero.";
  return { seeders: format(seeders), peers: format(peers), state,
    label: `${full(seeders)} seeders · ${full(peers)} downloading peers${stale ? " · Stale report" : ""}`,
    explanation };
}

function featuredMovie(torrent, cinema = {}) {
  const matched = (Array.isArray(torrent.files) ? torrent.files : []).map((file, index) => ({ movie: cinema[index]?.movie, index, file })).filter(row => row.movie?.title && fileKind(row.file.path || "").icon === "video").sort((a, b) => (b.file.size || 0) - (a.file.size || 0));
  return matched.length ? { ...matched[0], count: matched.length } : null;
}

module.exports = { fileKind, presentTorrent, availabilityView, featuredMovie };
