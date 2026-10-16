"use strict";

const { defineWorkflow, filesFor, bulletin, localTime } = require("../workflows");

module.exports = defineWorkflow({ id: "expiry-concierge", name: "Expiry Concierge", category: "Maintenance", description: "Daily expiry reminders for valuable files, without extending retention automatically.", fields: {
  withinHours: { type: "number", title: "Expiring within (hours)", default: 24, minimum: 1, maximum: 168 },
  valuableOnly: { type: "boolean", title: "Curated files only", default: true, description: "Include collection/series files; disable to review every expiring file" },
}, async scan(ctx, args) {
  const files = await filesFor(ctx); const expiring = files.filter(file => file.expires > Date.now() && file.expires < Date.now() + ctx.config.withinHours * 3600000 && (!ctx.config.valuableOnly || file.tags?.collection || file.tags?.series));
  const delivered = expiring.length && await bulletin(ctx, `expiry-${localTime(ctx.config).day}`, `${expiring.length} curated files expire within ${ctx.config.withinHours} hours. Review Expiry Concierge's report and save any files you still need.`, args.dryRun);
  return { checked: files.length, flagged: expiring.length, delivered: delivered ? 1 : 0, report: { title: "Files nearing expiry", summary: `${expiring.length} files expire within ${ctx.config.withinHours} hours. Retention is unchanged. Download files you need to keep.`, items: expiring.map(file => ({ title: file.name, detail: `Expires ${new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short", timeZone: ctx.config.timezone }).format(file.expires)}`, href: file.href, status: "warning" })) } };
} });
