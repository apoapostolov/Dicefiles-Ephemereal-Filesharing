"use strict";

const { defineWorkflow } = require("../workflows");

module.exports = defineWorkflow({ id: "link-health", name: "Link Health", category: "Maintenance", description: "Relaxed, SSRF-safe checks of collected links, with rate-limit backoff.", fields: {
  checksPerRun: { type: "number", title: "Links per scan", default: 10, minimum: 1, maximum: 30 },
}, async scan(ctx, args) {
  const retryAt = (await ctx.state.get("links:retry-at"))?.value || 0;
  if (retryAt > Date.now()) {
    return { report: { title: "Link health", summary: `Provider backoff is active until ${new Date(retryAt).toISOString()}. No early checks were sent.`, items: [] } };
  }
  const links = await ctx.dicefiles.listLinks({ limit: 500 }); let cursor = (await ctx.state.get("links:cursor"))?.value || 0; const items = [];
  for (let index = 0; index < Math.min(links.length, ctx.config.checksPerRun); index++) {
    ctx.signal?.throwIfAborted(); const link = links[cursor % links.length]; cursor++;
    const result = args.dryRun ? { state: "ready" } : await ctx.dicefiles.probeLink({ id: link.id, signal: ctx.signal });
    const detail = { "reachable": "Reachable", "broken": "Unavailable: removed or not found. Review the source before replacing it.", "restricted": "Access restricted; this does not prove the link is broken.", "temporary": "Temporary provider failure; check again later.", "unreachable": "Could not check safely or connect. Review the destination and try later.", "unsupported": "This link type is not checked over HTTP.", "ready": "Ready for a bounded HEAD check in Run mode.", "rate-limited": "Provider rate limit; further checks are delayed." }[result.state];
    items.push({ title: link.name || "Collected link", detail: `${detail}${result.status ? ` (HTTP ${result.status})` : ""}`, status: ["reachable", "ready", "unsupported"].includes(result.state) ? "info" : "warning" });
    if (!args.dryRun && result.state === "rate-limited") {
      await ctx.state.set("links:retry-at", Date.now() + Math.max(3600000, Math.min(7 * 86400000, result.retryAfterMs || 0))); break;
    }
  }
  if (!args.dryRun) {
    await ctx.state.set("links:cursor", cursor);
  }
  return { checked: items.length, flagged: items.filter(item => item.status === "warning").length, report: { title: "Link health", summary: "Checks use public-network-only HEAD, with bounded GET fallback. Restricted and temporary failures are distinct from removed links. No links are removed.", items } };
} });
