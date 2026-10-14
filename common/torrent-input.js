"use strict";

// Lightweight browser validation; authoritative parsing happens on the server.
function normalizeMagnetInput(raw) {
  if (raw.length > 16384) {
    throw new Error("Magnet link is too long. Use a .torrent file instead.");
  }
  const url = new URL(raw);
  if (url.protocol !== "magnet:" || !url.searchParams.getAll("xt").some(topic => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$|^urn:btmh:1220[a-f\d]{64}$/i.test(topic))) {
    throw new Error("Magnet link needs a valid BitTorrent info hash. Copy the complete link from its source.");
  }
  const name = (url.searchParams.get("dn") || "torrent").replace(/[/\\\p{Cc}]/gu, "_").slice(0, 160);
  return { name, magnet: url.href };
}

function messageLimit(value) {
  return /^magnet:\?\S*$/i.test(value.trim()) ? 16384 : 300;
}

module.exports = { normalizeMagnetInput, messageLimit };
