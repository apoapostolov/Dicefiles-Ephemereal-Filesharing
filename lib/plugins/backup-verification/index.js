"use strict";

const { defineWorkflow } = require("../workflows");

module.exports = defineWorkflow({ id: "backup-verification", name: "Backup Verification", category: "Maintenance", description: "Check backup freshness and verify isolated sample restores against an operator manifest.", fields: {
  connectionId: { type: "string", title: "Backup connection", connectionProvider: "backup" },
  maxAgeHours: { type: "number", title: "Maximum backup age (hours)", default: 48, minimum: 1, maximum: 8760 },
  maxBytesPerRun: { type: "number", title: "Sample I/O budget (bytes)", default: 33554432, minimum: 1, maximum: 1073741824 },
  sampleFiles: { type: "number", title: "Samples per scan", default: 2, minimum: 1, maximum: 5 },
}, async scan(ctx, args) {
  if (!ctx.config.connectionId) {
    return { report: { title: "Backup verification", summary: "Choose an operator-approved backup directory and manifest connection. Production storage is never restored automatically.", items: [] } };
  }
  const summary = await ctx.dicefiles.inspectBackup({ connectionId: ctx.config.connectionId });
  const old = Date.now() - summary.createdAt > ctx.config.maxAgeHours * 3600000;
  let items = [{ title: "Backup freshness", detail: `${new Date(summary.createdAt).toISOString()} · ${summary.files} manifest files${old ? " · older than the configured limit" : ""}`, status: old ? "warning" : "success" }]; let checked = 0;
  if (!args.dryRun) {
    const result = await ctx.dicefiles.verifyBackup({ connectionId: ctx.config.connectionId, maxBytes: ctx.config.maxBytesPerRun, maxFiles: ctx.config.sampleFiles, cursor: (await ctx.state.get("backup:cursor"))?.value || 0, signal: ctx.signal });
    items = items.concat(result.items); ({ checked } = result); await ctx.state.set("backup:cursor", result.cursor);
  }
  return { checked, flagged: items.filter(item => ["warning", "error"].includes(item.status)).length, report: { title: "Backup verification", summary: args.dryRun ? "Manifest preview only. Run performs bounded sample restores in a temporary directory." : `${checked} sample restores checked. This validates samples and freshness, not complete disaster recovery. Production files were not touched.`, items } };
} });
