"use strict";

const { defineWorkflow, filesFor } = require("../workflows");

module.exports = defineWorkflow({ id: "collection-curator", name: "Collection Curator", description: "Propose collection membership from existing metadata. Reviewed changes can be undone.", fields: {
  groupBy: { type: "string", title: "Group by", enum: ["series", "author", "genre", "language", "type"], default: "series" },
}, async scan(ctx) {
  const files = await filesFor(ctx); const items = [];
  for (const file of files) {
    if (file.meta?.pluginCuration?.pluginId === ctx.pluginId) {
      items.push({ title: file.name, detail: `Curated collection: ${file.tags?.collection || ""}`, href: file.href, data: { key: file.key, expectedRevision: file.revision }, actions: [{ id: "undo", label: "Undo curation" }] }); continue;
    }
    const value = ctx.config.groupBy === "type" ? file.type : file.tags?.[ctx.config.groupBy];
    if (value && !file.tags?.collection) {
      items.push({ title: file.name, detail: `Suggested collection: ${value}`, href: file.href, data: { key: file.key, expectedRevision: file.revision, tags: { collection: String(value).slice(0, 200) } }, actions: [{ id: "apply", label: "Add to collection" }] });
    }
  }
  return { checked: files.length, flagged: items.length, report: { title: "Collection proposals", summary: `${items.length} proposals or prior changes. Existing manual metadata is preserved.`, items } };
}, actions: {
  apply: async (ctx, data) => {
    const result = await ctx.dicefiles.curateFile(data); return { detail: "Collection applied. You can undo it.", data: { expectedRevision: result.revision }, actions: [{ id: "undo", label: "Undo curation" }] };
  },
  undo: (ctx, data) => ctx.dicefiles.curateFile({ ...data, undo: true }).then(() => ({ detail: "Curation undone." })),
} });
