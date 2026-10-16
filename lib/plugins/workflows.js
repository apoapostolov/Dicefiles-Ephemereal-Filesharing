"use strict";

const { defaultPluginConfig } = require("../../common/plugin-config");
const { createHash } = require("node:crypto");

const properties = {
  pollIntervalMinutes: { type: "number", title: "Scan interval", description: "Minutes between scans; 0 for manual only", default: 1440, minimum: 0, maximum: 10080 },
  maxItems: { type: "number", title: "Items per scan", default: 100, minimum: 1, maximum: 500 },
  postToChat: { type: "boolean", title: "Post summaries to chat", description: "Off by default; reports remain in bot activity" },
  timezone: { type: "string", title: "Room timezone", default: "UTC", description: "IANA timezone, such as Europe/Sofia" },
  quietStart: { type: "number", title: "Quiet hours start", default: 22, minimum: 0, maximum: 23 },
  quietEnd: { type: "number", title: "Quiet hours end", default: 8, minimum: 0, maximum: 23 },
};

function localTime(config, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hour, quiet: config.quietStart === config.quietEnd ? false : config.quietStart < config.quietEnd ? hour >= config.quietStart && hour < config.quietEnd : hour >= config.quietStart || hour < config.quietEnd };
}

async function bulletin(ctx, id, text, dryRun) {
  if (dryRun || !ctx.config.postToChat || localTime(ctx.config).quiet) {
    return false;
  }
  if ((await ctx.state.get(`notice:${id}`))?.value) {
    return false;
  }
  ctx.signal?.throwIfAborted();
  await ctx.dicefiles.postMessage({ text: text.slice(0, 2000) });
  await ctx.state.set(`notice:${id}`, true, { ttlSeconds: 30 * 86400 });
  return true;
}

async function review(ctx, input, handlers) {
  const saved = await ctx.state.get("report:last"); const report = saved?.value;
  const item = report?.items.find(item => item.id === input.itemId);
  if (!report || report.id !== input.reportId || !item?.actions?.some(action => action.id === input.action) || !handlers[input.action]) {
    throw Object.assign(new Error("This review action is no longer available. Refresh the bot report and choose a current item."), { status: 409 });
  }
  ctx.signal?.throwIfAborted();
  const result = await handlers[input.action](ctx, item.data || {}, item);
  if (result?.actions) {
    item.actions = result.actions; item.data = { ...item.data, ...result.data };
  }
  else {
    delete item.actions; delete item.data;
  }
  item.status = "success"; item.detail = result?.detail || "Reviewed";
  await ctx.state.set("report:last", report, { ifVersion: saved.version, ttlSeconds: 30 * 86400 });
  return { ok: true, reviewed: true };
}

function defineWorkflow({ id, name, description, category = "Community workflows", fields = {}, scan, actions = {}, events = [] }) {
  const configSchema = { type: "object", properties: { ...properties, ...fields, roomId: { type: "string" } } };
  return {
    id, name, description, version: "1.0.0", category, botName: name, configSchema, runModes: ["preview", "run"], capabilities: ["reports", "review", "jobs"], eventSubscriptions: events,
    validateConfig(input = {}) {
      const config = { ...defaultPluginConfig(configSchema), ...input }; const errors = [];
      for (const [key, field] of Object.entries(configSchema.properties)) {
        if (field.type === "number" && (!Number.isSafeInteger(config[key]) || config[key] < field.minimum || config[key] > field.maximum)) {
          errors.push(`${field.title || key} must be between ${field.minimum} and ${field.maximum}.`);
        }
        if (field.type === "string" && (typeof config[key] !== "string" || config[key].length > (field.maxLength || 2000))) {
          errors.push(`${field.title || key} must be short text.`);
        }
        if (field.type === "array" && (!Array.isArray(config[key]) || config[key].length > 50 || config[key].some(value => typeof value !== "string" || value.length > 200))) {
          errors.push(`${field.title || key} must contain at most 50 short text values.`);
        }
        if (field.type === "boolean" && typeof config[key] !== "boolean") {
          errors.push(`${field.title || key} must be true or false.`);
        }
        if (field.enum && !field.enum.includes(config[key])) {
          errors.push(`Choose a supported ${field.title || key}.`);
        }
      }
      try {
        localTime(config);
      }
      catch (_) {
        errors.push("Choose a valid IANA timezone, such as Europe/Sofia.");
      }
      return { ok: !errors.length, errors };
    },
    async run(base, args = {}) {
      const ctx = { ...base, config: { ...defaultPluginConfig(configSchema), ...base.config } };
      const validation = this.validateConfig(ctx.config);
      if (!validation.ok) {
        throw Object.assign(new Error(validation.errors.join(" ")), { retryable: false });
      }
      if (args.review) {
        return review(ctx, args.review, actions);
      }
      const dryRun = args.mode === "preview";
      const result = await scan(ctx, { ...args, dryRun });
      result.report ||= { title: name, summary: "Scan completed.", items: [] };
      if (result.delivered === undefined && result.flagged > 0) {
        result.delivered = await bulletin(ctx, `review-${localTime(ctx.config).day}`, `${name}: ${result.flagged} items need review. Open this bot's activity report in Room Options.`, dryRun) ? 1 : 0;
      }
      if (result.report.items.length > 40) {
        result.report.summary += " Showing the first 40 results; narrow the scan to review more.";
      }
      return result;
    },
    hooks: { async onEvent(event, payload, ctx) {
      if (!events.includes(event) || !ctx.jobs) {
        return;
      }
      const key = event === "member_joined" ? payload.memberId : payload.key;
      if (key) {
        return ctx.jobs.enqueue({ type: "event", event, key, idempotencyKey: `${event}:${key}` });
      }
    } },
  };
}

async function filesFor(ctx) {
  const files = []; let cursor;
  do {
    ctx.signal?.throwIfAborted();
    const page = await ctx.dicefiles.listFilesPage({ limit: Math.min(100, ctx.config.maxItems - files.length), cursor });
    files.push(...page.files); cursor = page.nextCursor;
  } while (cursor && files.length < ctx.config.maxItems);
  return files;
}

function tokens(name) {
  return [...new Set(String(name).normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])].filter(word => !["the", "and", "for", "pdf", "epub", "zip", "mp4", "mkv"].includes(word));
}

function similarity(left, right) {
  const a = tokens(left); const b = new Set(tokens(right));
  if (!a.length || !b.size) {
    return 0;
  }
  return a.filter(word => b.has(word)).length / Math.max(a.length, b.size);
}

const reviewKey = input => createHash("sha256").update(JSON.stringify(input)).digest("hex");

async function dismissedReviews(ctx) {
  return new Set((await ctx.state.get("review:dismissed"))?.value || []);
}

async function dismissReview(ctx, data) {
  if (data.reviewKey) {
    const dismissed = await dismissedReviews(ctx); dismissed.add(data.reviewKey);
    await ctx.state.set("review:dismissed", [...dismissed].slice(-150));
  }
  return { detail: "Reviewed; no file changed. Unchanged candidates will stay dismissed." };
}

module.exports = { defineWorkflow, filesFor, bulletin, localTime, similarity, review, reviewKey, dismissedReviews, dismissReview };
