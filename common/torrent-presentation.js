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

module.exports = { fileKind, presentTorrent };
