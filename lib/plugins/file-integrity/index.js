"use strict";

const { defineWorkflow } = require("../workflows");

module.exports = defineWorkflow({ id: "file-integrity", name: "File Integrity", category: "Maintenance", description: "Incremental, read-only checksum verification with a strict I/O budget.", fields: {
  maxBytesPerRun: { type: "number", title: "Read budget (bytes)", default: 33554432, minimum: 1, maximum: 1073741824 },
  maxChecksPerRun: { type: "number", title: "Files per check", default: 5, minimum: 1, maximum: 20 },
}, async scan(ctx, args) {
  const items = []; let bytes = 0; let checked = 0; let cursor = (await ctx.state.get("integrity:page"))?.value?.cursor || undefined;
  for (let index = 0; index < ctx.config.maxChecksPerRun; index++) {
    ctx.signal?.throwIfAborted();
    const page = await ctx.dicefiles.listFilesPage({ limit: 1, cursor }); const [file] = page.files;
    if (!file) {
      cursor = undefined; break;
    }
    cursor = page.nextCursor || undefined;
    const result = args.dryRun ? { state: file.size > ctx.config.maxBytesPerRun - bytes ? "over-budget" : "ready", bytes: 0 } : await ctx.dicefiles.verifyFile({ key: file.key, maxBytes: ctx.config.maxBytesPerRun - bytes, signal: ctx.signal });
    bytes += result.bytes; checked++;
    const labels = { "verified": "Stored content and size match the upload checksum.", "mismatch": "Checksum or size mismatch. Review storage and restore a verified backup; no repair was attempted.", "missing": "Stored file is missing. Review the backup before restoring.", "unreadable": "Stored file could not be read. Check storage permissions and availability.", "over-budget": "File exceeds this scan's remaining read budget. Increase the limit to verify it.", "ready": "Within budget; checksum will be verified in Run mode.", "not-file": "Storage is not a regular file. Ask the operator to inspect it." };
    items.push({ title: file.name, detail: labels[result.state] || result.state, href: file.href, status: ["verified", "ready"].includes(result.state) ? "success" : "warning" });
    if (!args.dryRun) {
      await ctx.state.set("integrity:page", { cursor: cursor || null });
    }
    if (!cursor || bytes >= ctx.config.maxBytesPerRun) {
      break;
    }
  }
  if (!args.dryRun) {
    await ctx.state.set("integrity:page", { cursor: cursor || null });
  }
  return { checked, flagged: items.filter(item => item.status === "warning").length, report: { title: "File integrity", summary: `${checked} files checked · ${bytes.toLocaleString()} bytes read. Checkpoints rotate through the bounded inventory; reads are throttled to 8 MiB/s. No files are changed.`, items } };
} });
