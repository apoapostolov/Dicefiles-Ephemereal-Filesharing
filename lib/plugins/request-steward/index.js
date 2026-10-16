"use strict";

const { defineWorkflow, bulletin, localTime } = require("../workflows");

module.exports = defineWorkflow({ id: "request-steward", name: "Request Steward", description: "Review stale claims and aging requests without taking over human claims.", fields: {
  staleDays: { type: "number", title: "Request age (days)", default: 7, minimum: 1, maximum: 365 },
}, async scan(ctx, args) {
  const requests = await ctx.dicefiles.listRequests({ status: "open", limit: 100 });
  const items = requests.filter(request => request.claimedBy && request.claimedUntil <= Date.now() || request.uploaded < Date.now() - ctx.config.staleDays * 86400000).map(request => ({ title: request.name,
    detail: request.claimedBy ? request.claimedUntil > Date.now() ? "Active claim: keep it assigned." : "Claim expired: available for owner review." : "Still open: review whether the request is relevant.", href: `/q/${request.key}`,
    data: { key: request.key }, actions: request.claimedBy === `plugin:${ctx.pluginId}` && request.claimedUntil <= Date.now() ? [{ id: "release", label: "Release bot claim" }] : [] }));
  const delivered = items.length && await bulletin(ctx, `steward-${localTime(ctx.config).day}`, `${items.length} older requests or expired claims need review in Request Steward. Active human claims remain assigned.`, args.dryRun);
  return { checked: requests.length, flagged: items.length, delivered: delivered ? 1 : 0, report: { title: "Request stewardship", summary: `${items.length} items for review. No human claim is changed automatically.`, items } };
}, actions: { release: (ctx, data) => ctx.dicefiles.releaseRequest(data).then(() => ({ detail: "The bot's expired claim was released." })) } });
