"use strict";

const { defineWorkflow, localTime } = require("../workflows");

module.exports = defineWorkflow({ id: "welcome-guide", name: "Welcome Guide", description: "Quiet room onboarding with durable per-member reconnect suppression.", events: ["member_joined"], fields: {
  welcomeText: { type: "string", title: "Welcome message", multiline: true, description: "Optional room-specific guidance; room rules and request help are included" },
  cooldownDays: { type: "number", title: "Welcome cooldown (days)", default: 30, minimum: 1, maximum: 30 },
  maxWelcomesPerDay: { type: "number", title: "Daily welcome limit", default: 10, minimum: 1, maximum: 100 },
  pollIntervalMinutes: { type: "number", title: "Scan interval", default: 0, minimum: 0, maximum: 10080 },
}, async scan(ctx, args) {
  const guide = await ctx.dicefiles.getRoomGuide();
  const text = [`Welcome to ${guide.name}.`, ctx.config.welcomeText || guide.motd, `Files remain available for ${guide.ttlHours} hours.`, guide.allowRequests ? "Search the file list first, then use Create Request for missing files." : "Use file search and the link archive to find shared material."].filter(Boolean).join(" ");
  const key = args.job?.event === "member_joined" ? args.job.key : args.payload?.memberId;
  let known = false;
  if (key) {
    for (let day = 0; day < ctx.config.cooldownDays; day++) {
      const bucket = Math.floor(Date.now() / 86400000) - day;
      if ((await ctx.state.get(`welcome:${bucket}`))?.value?.includes(key)) {
        known = true; break;
      }
    }
  }
  const bucket = `welcome:${Math.floor(Date.now() / 86400000)}`; const row = await ctx.state.get(bucket);
  const delivered = !!(key && !known && !args.dryRun && ctx.config.postToChat && !localTime(ctx.config).quiet && (row?.value || []).length < ctx.config.maxWelcomesPerDay);
  if (delivered) {
    ctx.signal?.throwIfAborted(); await ctx.dicefiles.postMessage({ text: text.slice(0, 2000) });
    await ctx.state.set(bucket, [...(row?.value || []), key], { ttlSeconds: 30 * 86400 });
  }
  return { delivered: delivered ? 1 : 0, report: { title: "Welcome Guide", summary: known ? "This member has already received the guide. Reconnect suppressed." : "Enable chat summaries to deliver this guide to newly joining members.", items: [{ title: "Welcome message", detail: text }] } };
} });
