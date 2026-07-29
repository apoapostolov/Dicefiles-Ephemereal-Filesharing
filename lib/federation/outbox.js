"use strict";

const crypto = require("crypto");
const CONFIG = require("../config");
const BROKER = require("../broker");
const {
  currentConfig,
  sendRoomInvalidation,
} = require("./transport");
const {
  peerAllowsRoom,
} = require("./config");

const QUEUE_KEY = "federation:outbox:schedule";
const JOBS_KEY = "federation:outbox:jobs";
const LOCK_PREFIX = "federation:outbox:lock:";
const DONE_PREFIX = "federation:outbox:done:";
const POLL_INTERVAL_MS = 15000;
const LOCK_SECONDS = 120;
const DONE_SECONDS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 20;

function jobId(peerId, type, payload) {
  return crypto.
    createHash("sha256").
    update(
      [
        peerId,
        type,
        payload.roomid,
        payload.key || "",
        payload.uploaded || payload.expires || "",
      ].join("\0"),
    ).
    digest("base64url");
}

function retryDelay(attempt) {
  return Math.min(15 * 60 * 1000, 5000 * 2 ** Math.max(0, attempt - 1));
}

function createFederationOutbox(options = {}) {
  const redis = options.redis || BROKER.getMethods(
    "del",
    "get",
    "hdel",
    "hget",
    "hset",
    "multi",
    "set",
    "zadd",
    "zrangebyscore",
    "zrem",
  );
  const getConfig = options.getConfig || currentConfig;
  const deliver = options.deliver || sendRoomInvalidation;
  let timer = null;
  let processing = false;

  async function store(job, dueAt) {
    const multi = redis.multi();
    multi.hset(JOBS_KEY, job.id, JSON.stringify(job));
    multi.zadd(QUEUE_KEY, String(dueAt), job.id);
    await multi.exec();
  }

  async function enqueue(type, payload) {
    if (
      !["Add", "Remove", "Update"].includes(type) ||
      !payload ||
      !payload.roomid
    ) {
      return 0;
    }
    const federation = getConfig();
    if (!federation.enabled) {
      return 0;
    }
    const peers = federation.peers.filter(peer =>
      peerAllowsRoom(peer, String(payload.roomid)),
    );
    let added = 0;
    for (const peer of peers) {
      const id = jobId(peer.peerId, type, payload);
      if (await redis.get(`${DONE_PREFIX}${id}`)) {
        continue;
      }
      const job = {
        id,
        peerId: peer.peerId,
        type,
        roomId: String(payload.roomid),
        fileKey: String(payload.key || ""),
        attempt: 0,
        createdAt: Date.now(),
      };
      await store(job, Date.now());
      added++;
    }
    if (added) {
      setImmediate(() => {
        processDue().catch(error => {
          console.error(
            "[federation] outbox processing failed",
            error && error.message || error,
          );
        });
      });
    }
    return added;
  }

  function activityFor(job) {
    const federation = getConfig();
    return {
      "@context": "https://www.w3.org/ns/activitystreams",
      "id": `${federation.publicBaseUrl}/federation/activities/${job.id}`,
      "type": job.type,
      "actor": `${federation.publicBaseUrl}/federation/actor`,
      "object": {
        type: "Document",
        roomId: job.roomId,
        fileKey: job.fileKey || undefined,
      },
      "published": new Date(job.createdAt).toISOString(),
    };
  }

  async function processJob(id) {
    const lockKey = `${LOCK_PREFIX}${id}`;
    const token = crypto.randomBytes(12).toString("hex");
    const claimed = await redis.set(
      lockKey,
      token,
      "NX",
      "EX",
      LOCK_SECONDS,
    );
    if (claimed !== "OK") {
      return false;
    }
    try {
      const raw = await redis.hget(JOBS_KEY, id);
      if (!raw) {
        await redis.zrem(QUEUE_KEY, id);
        return false;
      }
      const job = JSON.parse(raw);
      await redis.zrem(QUEUE_KEY, id);
      try {
        await deliver(job.peerId, activityFor(job));
        const multi = redis.multi();
        multi.zrem(QUEUE_KEY, id);
        multi.hdel(JOBS_KEY, id);
        multi.set(`${DONE_PREFIX}${id}`, "1", "EX", DONE_SECONDS);
        await multi.exec();
        return true;
      }
      catch (error) {
        job.attempt = Number(job.attempt || 0) + 1;
        job.lastError = String(error && error.code || "FEDERATION_UNREACHABLE").
          slice(0, 100);
        if (job.attempt >= MAX_ATTEMPTS) {
          await redis.hdel(JOBS_KEY, id);
          console.error(
            `[federation] invalidation ${id} abandoned after ${job.attempt} attempts`,
          );
          return false;
        }
        await store(job, Date.now() + retryDelay(job.attempt));
        return false;
      }
    }
    finally {
      if (await redis.get(lockKey) === token) {
        await redis.del(lockKey);
      }
    }
  }

  async function processDue() {
    if (processing) {
      return 0;
    }
    processing = true;
    try {
      const ids = await redis.zrangebyscore(
        QUEUE_KEY,
        0,
        String(Date.now()),
        "LIMIT",
        0,
        BATCH_SIZE,
      );
      let completed = 0;
      for (const id of ids || []) {
        if (await processJob(id)) {
          completed++;
        }
      }
      return completed;
    }
    finally {
      processing = false;
    }
  }

  function start() {
    if (timer || !CONFIG.get("federation")?.enabled) {
      return;
    }
    timer = setInterval(() => {
      processDue().catch(error => {
        console.error(
          "[federation] outbox poll failed",
          error && error.message || error,
        );
      });
    }, POLL_INTERVAL_MS);
    timer.unref?.();
    setImmediate(() => {
      processDue().catch(() => {});
    });
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    enqueue,
    processDue,
    processJob,
    start,
    stop,
    activityFor,
    _store: store,
  };
}

const defaultFederationOutbox = createFederationOutbox();

module.exports = {
  QUEUE_KEY,
  JOBS_KEY,
  MAX_ATTEMPTS,
  jobId,
  retryDelay,
  createFederationOutbox,
  defaultFederationOutbox,
};
