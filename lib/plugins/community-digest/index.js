"use strict";

const { defineWorkflow, filesFor, bulletin, localTime } = require("../workflows");

module.exports = defineWorkflow({ id: "community-digest", name: "Community Digest", description: "A quiet weekly room bulletin of new files and fulfilled requests.", fields: {
  publishDay: { type: "string", title: "Publish day", enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], default: "Sun" },
  publishHour: { type: "number", title: "Publish hour", default: 18, minimum: 0, maximum: 23 },
  pollIntervalMinutes: { type: "number", title: "Scan interval", default: 60, minimum: 0, maximum: 10080 },
}, async scan(ctx, args) {
  const time = localTime(ctx.config); const watermark = (await ctx.state.get("digest:watermark"))?.value || Date.now() - 7 * 86400000;
  const files = (await filesFor(ctx)).filter(file => !file.tags?.hidden && file.uploaded > watermark);
  const requests = (await ctx.dicefiles.listRequests({ status: "fulfilled", limit: 100 })).filter(request => request.fulfilledAt > watermark);
  const collections = [...new Set(files.map(file => file.tags?.collection).filter(Boolean))];
  const text = [`Community digest: ${files.length} new files, ${requests.length} requests fulfilled.`, files.slice(0, 8).map(file => `${file.name} ${file.href}`).join("\n"), collections.length ? `Collections: ${collections.join(", ")}.` : ""].filter(Boolean).join("\n");
  const due = time.weekday === ctx.config.publishDay && time.hour >= ctx.config.publishHour;
  const delivered = due && (files.length || requests.length) && await bulletin(ctx, `digest-${time.day}`, text, args.dryRun);
  if (delivered) {
    await ctx.state.set("digest:watermark", Date.now());
  }
  return { delivered: delivered ? 1 : 0, report: { title: "Community digest", summary: `${due ? "Scheduled window" : `Next configured window: ${ctx.config.publishDay} at ${ctx.config.publishHour}:00 ${ctx.config.timezone}`} · ${files.length} new files · ${requests.length} fulfilled requests`, items: files.slice(0, 20).map(file => ({ title: file.name, href: file.href, detail: file.tags?.collection || "New file" })) } };
} });
