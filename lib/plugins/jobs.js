"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { DurableOutbox } = require("../durable-outbox");
const { normalizePluginId } = require("./plugin-id");
const { safeErrorMessage } = require("./metadata");
const { summarizeResult } = require("./run-status");

function configFingerprint(config) {
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  return createHash("sha256").update(JSON.stringify(sorted(config || {}))).digest("hex");
}

function publicJob(job) {
  if (!job) {
    return null;
  }
  return { id: job.id, pluginId: job.pluginId, type: job.type, mode: job.mode, status: job.status || "queued", attempt: job.attempt || 0,
    createdAt: job.createdAt, dueAt: job.dueAt, finishedAt: job.finishedAt || job.failedAt || null, error: job.error ? safeErrorMessage(job.error) : "", result: job.result || null };
}

class PluginJobs {
  constructor(options = {}) {
    this.outbox = options.outbox || new DurableOutbox("plugins", { leaseMs: 90000 });
    this.resolve = options.resolve;
    this.execute = options.execute;
    this.now = options.now || Date.now;
    this.active = new Map(); this.timer = null; this.processing = false;
    this.roomLeases = options.roomLeases || require("./event-lease").createDefaultEventLease();
    this.log = options.log || console;
  }

  scope({ pluginId, roomId, config = {}, global = false }) {
    pluginId = normalizePluginId(pluginId);
    if (!pluginId || !roomId) {
      throw new Error("Plugin jobs require an installed bot and a target room.");
    }
    const owns = job => !!job && job.pluginId === pluginId && job.roomId === roomId && !!job.global === global;
    const read = async id => {
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) {
        throw new Error("Choose a valid job from this bot's history.");
      }
      const job = await this.outbox.get(id);
      if (!owns(job)) {
        throw Object.assign(new Error("Job is unavailable in this room and bot."), { status: 404 });
      }
      return job;
    };
    return {
      enqueue: async (spec = {}) => {
        const type = spec.type || "run";
        if (!["run", "event"].includes(type) || spec.mode && !["run", "preview", "test", "digest"].includes(spec.mode)) {
          throw new Error("Choose a supported bot job and run mode.");
        }
        const event = type === "event" ? String(spec.event || "") : "";
        const key = type === "event" ? String(spec.key || "") : "";
        if (type === "event" && (!/^[a-z_]{1,64}$/.test(event) || !/^[a-zA-Z0-9_-]{1,128}$/.test(key))) {
          throw new Error("Queued events require a valid event name and room item key.");
        }
        const dedupe = String(spec.idempotencyKey || randomUUID());
        if (dedupe.length > 256) {
          throw new Error("Job idempotency keys must be at most 256 characters.");
        }
        const dueAt = Number(spec.dueAt || this.now());
        if (!Number.isFinite(dueAt) || dueAt > this.now() + 30 * 86400000) {
          throw new Error("Schedule a bot job within the next 30 days.");
        }
        const fingerprint = configFingerprint(config);
        const id = createHash("sha256").update(`${global}\0${roomId}\0${pluginId}\0${fingerprint}\0${type}\0${spec.mode || ""}\0${dedupe}`).digest("hex");
        const job = { id, roomId, pluginId, global, fingerprint, type, event, key, mode: spec.mode || "", attempt: 0, createdAt: this.now(), dueAt };
        const added = await this.outbox.enqueue(job);
        return { ...publicJob(job), added };
      },
      get: async id => publicJob(await read(id)),
      list: async (options = {}) => {
        if (options.cursor != null && !/^\d{1,8}$/.test(String(options.cursor))) {
          throw new Error("Job cursor is invalid. Restart from the first page.");
        }
        const page = await this.outbox.list({ roomId, pluginId, global, limit: Math.max(1, Math.min(50, Number(options.limit) || 20)), cursor: options.cursor || 0 });
        return { jobs: (Array.isArray(page.records) ? page.records : []).map(publicJob), nextCursor: page.nextCursor || null };
      },
      cancel: async id => {
        await read(id);
        const cancelled = Number(await this.outbox.cancel(id)) === 1;
        this.active.get(id)?.abort(new Error("Bot job cancelled by a room moderator."));
        if (cancelled && this.broadcastCancel) {
          this.broadcastCancel(id);
        }
        return { cancelled };
      },
      replay: async id => {
        const job = await read(id);
        if (!["failed", "cancelled"].includes(job.status)) {
          throw new Error("Only failed or cancelled jobs can be replayed.");
        }
        const next = { ...job, fingerprint: configFingerprint(config), attempt: 0, createdAt: this.now(), dueAt: this.now() };
        delete next.status; delete next.error; delete next.result; delete next.finishedAt; delete next.failedAt;
        return { replayed: Number(await this.outbox.replay(next)) === 1 };
      },
    };
  }

  async pump() {
    if (this.processing || !this.resolve || !this.execute) {
      return;
    }
    this.processing = true;
    try {
      for (let count = 0; count < 4; count++) {
        const job = await this.outbox.claim();
        if (!job) {
          break;
        }
        const controller = new AbortController(); this.active.set(job.id, controller);
        let current; let roomLease; let renewing = false;
        const renew = setInterval(async () => {
          if (renewing) {
            return;
          } renewing = true;
          try {
            if (Number(await this.outbox.renew(job)) !== 1) {
              controller.abort(new Error("Job ownership expired or was cancelled."));
            }
            if (roomLease && !await this.roomLeases.renew(roomLease, 900)) {
              controller.abort(new Error("Room job ownership expired. Refresh the job history before retrying."));
            }
          }
          catch (_) {
            controller.abort(new Error("Job ownership could not be renewed. Retry after the service recovers."));
          }
          finally {
            renewing = false;
          }
        }, 15000); renew.unref?.();
        try {
          current = await this.resolve(job.roomId, job.pluginId, job.global === true);
          if (!current?.enabled || configFingerprint(current.config) !== job.fingerprint) {
            throw Object.assign(new Error("Bot invitation or settings changed. Review the settings and replay this job if still needed."), { retryable: false });
          }
          if (this.now() - job.createdAt > 7 * 86400000) {
            throw Object.assign(new Error("This job exceeded its seven-day retry window. Review and replay it if still needed."), { retryable: false });
          }
          roomLease = await this.roomLeases.begin("plugin-job-room", job.roomId, { leaseSeconds: 900 });
          if (!roomLease) {
            await this.outbox.retry(job, 30000, { increment: false });
            continue;
          }
          const result = await this.execute(job, controller.signal);
          controller.signal.throwIfAborted();
          if (result?.reason === "already_running" || result?.reason === "already_running_or_completed") {
            await this.outbox.retry(job, 30000, { increment: false });
          }
          else {
            await this.outbox.complete(job, summarizeResult(result));
          }
        }
        catch (failure) {
          const error = Object.assign(new Error(safeErrorMessage(failure, current?.config)), { retryable: failure?.retryable, retryAfterMs: failure?.retryAfterMs });
          if (!controller.signal.aborted && error.retryable !== false && job.attempt < 5 && this.now() - job.createdAt < 7 * 86400000) {
            const delay = Math.max(Math.min(300000, 5000 * 2 ** job.attempt), Number(error.retryAfterMs) || 0);
            await this.outbox.retry(job, Math.min(7 * 86400000, delay));
          }
          else {
            await this.outbox.deadLetter(job, error);
          }
        }
        finally {
          clearInterval(renew); this.active.delete(job.id); if (roomLease) {
            await this.roomLeases.fail(roomLease);
          }
        }
      }
    }
    finally {
      this.processing = false;
    }
  }

  start({ resolve, execute, broker } = {}) {
    if (this.timer) {
      return;
    }
    this.resolve = resolve || this.resolve; this.execute = execute || this.execute;
    if (broker) {
      broker.on("plugin-jobs:cancel", id => this.active.get(id)?.abort(new Error("Bot job cancelled by a room moderator.")));
      this.broadcastCancel = id => broker.emit("plugin-jobs:cancel", id);
    }
    this.timer = setInterval(() => this.pump().catch(error => this.log.error("Bot job processor could not continue. Check Redis connectivity.", safeErrorMessage(error))), 5000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer); this.timer = null; for (const controller of this.active.values()) {
      controller.abort();
    }
  }
}

let singleton;

function getPluginJobs() {
  return singleton ||= new PluginJobs();
}

module.exports = { PluginJobs, getPluginJobs, configFingerprint, publicJob };
