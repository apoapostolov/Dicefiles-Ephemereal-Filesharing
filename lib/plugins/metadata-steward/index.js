"use strict";

const { defineWorkflow, filesFor } = require("../workflows");

module.exports = defineWorkflow({ id: "metadata-steward", name: "Metadata Steward", category: "Maintenance", description: "Review missing book/video metadata and reuse existing extraction and movie matching workers.", async scan(ctx) {
  const files = await filesFor(ctx); const items = [];
  for (const file of files) {
    const torrent = file.meta?.torrent;
    const unmatched = torrent?.files?.some((entry, index) => /\.(mp4|mkv|webm|m4v|avi|mov)$/i.test(entry.path || "") && !file.meta.cinema?.[index]?.movie && file.meta.cinema?.[index]?.autoMatch?.state !== "manual");
    const book = (["pdf", "epub", "mobi", "comic"].includes(file.type) || /\.(pdf|epub|mobi|azw3?|cbz|cbr|cbt)$/i.test(file.name)) && (!file.tags?.title || !file.tags?.author);
    const video = file.type === "video" && !file.meta?.cinema?.[-1]?.movie && file.meta?.cinema?.[-1]?.autoMatch?.state !== "manual";
    if (unmatched || book || video) {
      items.push({ title: file.name, detail: unmatched ? "Unmatched torrent video. Retry uses the existing catalogue worker and its confidence checks." : video ? "Open Video Information to search and confirm catalogue metadata." : "Title or author is missing. Re-read embedded metadata; existing values remain unchanged.", href: file.href, data: { key: file.key, expectedRevision: file.revision }, actions: video ? [] : [{ id: "retry", label: "Retry metadata" }] });
    }
  }
  return { checked: files.length, flagged: items.length, report: { title: "Metadata stewardship", summary: `${items.length} items need metadata review. Manual movie choices are preserved; torrent availability monitoring is unchanged.`, items } };
}, actions: { retry: (ctx, data) => ctx.dicefiles.retryFileMetadata({ ...data, signal: ctx.signal }).then(result => ({ detail: result.detail })) } });
