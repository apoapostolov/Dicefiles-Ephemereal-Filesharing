"use strict";

const { defineWorkflow, bulletin, localTime } = require("../workflows");

module.exports = defineWorkflow({ id: "storage-capacity", name: "Storage Capacity", category: "Maintenance", description: "Operator-granted aggregate storage alerts with hysteresis and measured growth estimates.", fields: {
  connectionId: { type: "string", title: "Metrics connection", connectionProvider: "maintenance" },
  warnPercent: { type: "number", title: "Alert above (%)", default: 85, minimum: 20, maximum: 99 },
  resumePercent: { type: "number", title: "Clear below (%)", default: 75, minimum: 10, maximum: 98 },
  pollIntervalMinutes: { type: "number", title: "Scan interval", default: 60, minimum: 0, maximum: 10080 },
}, async scan(ctx, args) {
  if (!ctx.config.connectionId) {
    return { report: { title: "Storage capacity", summary: "Choose an operator connection granting storage:read to this bot and room.", items: [] } };
  }
  if (ctx.config.resumePercent >= ctx.config.warnPercent) {
    throw Object.assign(new Error("Clear threshold must be below the alert threshold. Adjust Storage Capacity settings."), { retryable: false });
  }
  const volumes = await ctx.dicefiles.getStorageMetrics({ connectionId: ctx.config.connectionId }); const history = (await ctx.state.get("capacity:last"))?.value || { samples: {} }; const samples = {}; const items = []; let alerts = 0;
  for (const volume of volumes) {
    const previous = history.samples[volume.id]; const high = !volume.ok || volume.usedPercent >= ctx.config.warnPercent || previous?.high && volume.usedPercent > ctx.config.resumePercent;
    if (high) {
      alerts++;
    }
    const elapsed = Date.now() - (previous?.at || Date.now()); const growth = previous && elapsed >= 3600000 ? (volume.used - previous.used) / elapsed : 0;
    const days = growth > 0 ? volume.free / growth / 86400000 : null;
    items.push({ title: volume.id, detail: volume.ok ? `${volume.usedPercent.toFixed(1)}% used · ${volume.free.toLocaleString()} bytes free${days !== null ? ` · about ${Math.max(0, Math.round(days))} days at measured growth` : " · growth estimate needs another hourly sample"}` : "Storage is unavailable. Ask the operator to check the volume.", status: high ? "warning" : "success" });
    samples[volume.id] = { used: volume.used, at: Date.now(), high };
  }
  const delivered = alerts && await bulletin(ctx, `capacity-${localTime(ctx.config).day}`, `${alerts} storage volumes need attention. Review Storage Capacity before adding large files. No files have been deleted.`, args.dryRun);
  if (!args.dryRun) {
    await ctx.state.set("capacity:last", { samples });
  }
  return { checked: volumes.length, flagged: alerts, delivered: delivered ? 1 : 0, report: { title: "Storage capacity", summary: "Aggregate operator-approved metrics. Growth estimates describe observed usage, not guaranteed remaining time. No deletion or volume changes.", items } };
} });
