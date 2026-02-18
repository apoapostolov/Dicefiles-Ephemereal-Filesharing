"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const CONFIG = require("./config");
const {UPLOADS} = require("./upload");
const {REQUESTS} = require("./request");

const VALID_EVENTS = new Set([
  "file_uploaded",
  "request_created",
  "request_fulfilled",
  "file_deleted",
]);

function asArray(v) {
  if (Array.isArray(v)) {
    return v;
  }
  return [];
}

function resolvePath(p) {
  if (!p) {
    return null;
  }
  if (path.isAbsolute(p)) {
    return p;
  }
  return path.join(process.cwd(), p);
}

function appendJSONLine(file, payload) {
  try {
    if (!file) {
      return;
    }
    fs.appendFile(file, `${JSON.stringify(payload)}\n`, () => {});
  }
  catch (ex) {
    console.error("Failed to append webhook log", ex);
  }
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function createId() {
  return crypto.randomBytes(12).toString("hex");
}

class WebhookDispatcher {
  constructor() {
    this.config = this.loadConfig();
    this.queue = [];
    this.running = false;
    this.installed = false;
    this._onUploadSet = this.onUploadSet.bind(this);
    this._onUploadPredelete = this.onUploadPredelete.bind(this);
    this._onRequestSet = this.onRequestSet.bind(this);
    this._onRequestPredelete = this.onRequestPredelete.bind(this);
  }

  loadConfig() {
    const retry = CONFIG.get("webhookRetry") || {};
    const defaults = {
      retries: clampInt(retry.retries, 3, 0, 10),
      baseDelayMs: clampInt(retry.baseDelayMs, 1500, 100, 120000),
      maxDelayMs: clampInt(retry.maxDelayMs, 30000, 1000, 300000),
    };
    const deadLetterLog = resolvePath(CONFIG.get("webhookDeadLetterLog"));
    const rawHooks = asArray(CONFIG.get("webhooks"));
    const hooks = rawHooks.
      map((hook, i) => this.normalizeHook(hook, i, defaults)).
      filter(h => h && h.url);
    return {
      hooks,
      defaults,
      deadLetterLog,
    };
  }

  normalizeHook(hook, i, defaults) {
    if (!hook || typeof hook !== "object") {
      return null;
    }
    const url = (hook.url || "").toString().trim();
    if (!url) {
      return null;
    }
    const id = (hook.id || `webhook-${i + 1}`).toString();
    const events = asArray(hook.events).
      map(e => (e || "").toString().trim()).
      filter(e => VALID_EVENTS.has(e));
    if (!events.length) {
      return null;
    }
    return {
      id,
      url,
      secret: (hook.secret || "").toString(),
      events: new Set(events),
      retries: clampInt(hook.retries, defaults.retries, 0, 10),
      timeoutMs: clampInt(hook.timeoutMs, 7000, 500, 120000),
    };
  }

  install() {
    if (this.installed) {
      return;
    }
    this.installed = true;
    UPLOADS.on("set", this._onUploadSet);
    UPLOADS.on("predelete", this._onUploadPredelete);
    REQUESTS.on("set", this._onRequestSet);
    REQUESTS.on("predelete", this._onRequestPredelete);
  }

  onUploadSet(_, upload) {
    this.dispatch("file_uploaded", this.serializeUpload(upload));
  }

  onUploadPredelete(key) {
    const upload = UPLOADS.get(key);
    if (!upload) {
      return;
    }
    this.dispatch("file_deleted", this.serializeUpload(upload));
  }

  onRequestSet(_, request) {
    this.dispatch("request_created", this.serializeRequest(request));
  }

  onRequestPredelete(key) {
    const request = REQUESTS.get(key);
    if (!request) {
      return;
    }
    // Current semantics: non-expired request deletion is treated as fulfilled.
    // Expired requests are lifecycle cleanup and not webhooked as fulfillment.
    if (request.expired) {
      return;
    }
    this.dispatch("request_fulfilled", this.serializeRequest(request));
  }

  serializeUpload(upload) {
    const tags = Object.assign({}, upload.tags || {});
    if (Object.prototype.hasOwnProperty.call(tags, "hidden")) {
      delete tags.hidden;
    }
    return {
      key: upload.key,
      roomid: upload.roomid,
      name: upload.name,
      size: upload.size,
      href: upload.href || `/g/${upload.key}`,
      uploaded: upload.uploaded,
      expires: upload.expires,
      type: upload.type,
      tags,
      meta: Object.assign({}, upload.meta || {}),
    };
  }

  serializeRequest(request) {
    const tags = Object.assign({}, request.tags || {});
    return {
      key: request.key,
      roomid: request.roomid,
      text: request.name,
      href: request.href || `/q/${request.key}`,
      uploaded: request.uploaded,
      expires: request.expires,
      tags,
      meta: Object.assign({}, request.meta || {}),
    };
  }

  dispatch(event, payload) {
    if (!VALID_EVENTS.has(event)) {
      return;
    }
    const hooks = this.config.hooks.filter(h => h.events.has(event));
    if (!hooks.length) {
      return;
    }
    for (const hook of hooks) {
      this.queue.push({
        id: createId(),
        hook,
        event,
        payload,
        attempt: 0,
        createdAt: Date.now(),
      });
    }
    this.pump();
  }

  pump() {
    if (this.running) {
      return;
    }
    this.running = true;
    const run = async() => {
      while (this.queue.length) {
        const job = this.queue.shift();
        try {
          await this.deliver(job);
        }
        catch (ex) {
          this.onDeliveryFailure(job, ex);
        }
      }
      this.running = false;
    };
    run().catch(ex => {
      this.running = false;
      console.error("Webhook pump crashed", ex);
    });
  }

  signature(secret, timestamp, body) {
    return crypto.
      createHmac("sha256", secret).
      update(`${timestamp}.${body}`).
      digest("hex");
  }

  async deliver(job) {
    const bodyObject = {
      id: job.id,
      event: job.event,
      timestamp: new Date().toISOString(),
      payload: job.payload,
      attempt: job.attempt + 1,
    };
    const body = JSON.stringify(bodyObject);
    const ts = Date.now().toString();
    const headers = {
      "content-type": "application/json",
      "x-dicefiles-event": job.event,
      "x-dicefiles-webhook-id": job.hook.id,
      "x-dicefiles-timestamp": ts,
    };
    if (job.hook.secret) {
      headers["x-dicefiles-signature"] = this.signature(job.hook.secret, ts, body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), job.hook.timeoutMs);
    try {
      const res = await fetch(job.hook.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    }
    finally {
      clearTimeout(timeout);
    }
  }

  backoff(attempt) {
    const {baseDelayMs, maxDelayMs} = this.config.defaults;
    const d = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
    return d;
  }

  onDeliveryFailure(job, error) {
    const nextAttempt = job.attempt + 1;
    if (nextAttempt <= job.hook.retries) {
      const delay = this.backoff(nextAttempt);
      setTimeout(() => {
        this.queue.push(Object.assign({}, job, {
          attempt: nextAttempt,
        }));
        this.pump();
      }, delay);
      return;
    }
    appendJSONLine(this.config.deadLetterLog, {
      createdAt: new Date(job.createdAt).toISOString(),
      failedAt: new Date().toISOString(),
      event: job.event,
      webhookId: job.hook.id,
      url: job.hook.url,
      attempts: nextAttempt,
      error: error && (error.message || error.toString()),
      payload: job.payload,
    });
  }
}

module.exports = new WebhookDispatcher();
