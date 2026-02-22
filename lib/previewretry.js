"use strict";

/**
 * Retry queue for transient preview asset generation failures.
 *
 * When generateAssets() fails (e.g. GraphicsMagick unavailable, ffmpeg
 * temporarily broken, transient I/O), the upload handler drops the failure on
 * the floor with console.error. This module persists a retry schedule in Redis
 * so that preview generation is reattempted after a back-off delay.
 *
 * Design
 * ──────
 * - Queue:    Redis sorted set `preview:retry`
 *               score  = Unix ms timestamp (earliest next attempt)
 *               member = StorageLocation.hash
 * - Attempts: Redis hash `preview:retry:attempts`
 *               field = hash, value = number of attempts already made
 * - Lock:     `SET preview:retry:lock:<hash> 1 NX EX 120` — prevents two
 *             workers from retrying the same hash concurrently.
 *
 * Retry policy
 * ────────────
 * MAX_RETRIES = 3, delays = 5 min → 15 min → 45 min.
 * After three failed retries the hash is removed from tracking and the
 * permanent failure is left to the OBS counter / ops.log.
 *
 * Multi-worker safety
 * ───────────────────
 * Each HTTP worker runs a 60-second poller. The per-hash Redis lock ensures
 * exactly one worker processes any given retry attempt, even when many workers
 * are running. Because `generateAssets → addAssets` is idempotent (assets.has
 * guard), a rare double-claim (lock race at restart) causes harmless wasted
 * work at worst.
 */

const BROKER = require("./broker");
const OBS = require("./observability");

const RETRY_QUEUE_KEY = "preview:retry";
const RETRY_ATTEMPTS_KEY = "preview:retry:attempts";
const LOCK_PREFIX = "preview:retry:lock:";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 45 * 60 * 1000];
const POLL_INTERVAL_MS = 60 * 1000;
const LOCK_TTL_SEC = 120;
const BATCH_SIZE = 5;

const redis = BROKER.getMethods(
  "zadd",
  "zrangebyscore",
  "zrem",
  "hget",
  "hset",
  "hdel",
  "set",
  "del",
);

/**
 * Schedule a preview-generation retry for the given storage hash.
 * Safe to call more than once for the same hash; later calls update the
 * score (rescheduling) only when attempts remain.
 *
 * @param {string} hash - StorageLocation.hash
 */
async function scheduleRetry(hash) {
  if (!hash) {
    return;
  }
  try {
    const raw = await redis.hget(RETRY_ATTEMPTS_KEY, hash);
    const attempt = raw !== null ? (parseInt(raw, 10) || 0) : 0;
    if (attempt >= MAX_RETRIES) {
      // No more retries — clean up tracking state
      await redis.hdel(RETRY_ATTEMPTS_KEY, hash).catch(() => {});
      return;
    }
    const delayMs =
      RETRY_DELAYS_MS[attempt] ||
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    const retryAt = Date.now() + delayMs;
    // Unconditional ZADD: updates score if already present, which is fine —
    // it means we reschedule on repeated failures.
    await redis.zadd(RETRY_QUEUE_KEY, String(retryAt), hash);
    await redis.hset(RETRY_ATTEMPTS_KEY, hash, String(attempt + 1));
    console.info(
      `[previewretry] hash ${hash} scheduled for attempt ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs / 60000)} min`,
    );
  } catch (ex) {
    console.error("[previewretry] scheduleRetry error:", ex.message || ex);
  }
}

/**
 * Poll for overdue retry jobs and process up to BATCH_SIZE per tick.
 * Called by the setInterval in start().
 */
async function processDue() {
  // Lazy require to avoid circular deps (meta → upload → previewretry → meta).
  const { STORAGE } = require("./storage");
  const { generateAssets } = require("./meta");

  const now = Date.now();
  let hashes;
  try {
    hashes = await redis.zrangebyscore(
      RETRY_QUEUE_KEY,
      0,
      String(now),
      "LIMIT",
      0,
      BATCH_SIZE,
    );
  } catch (ex) {
    console.error("[previewretry] zrangebyscore error:", ex.message || ex);
    return;
  }
  if (!hashes || !hashes.length) {
    return;
  }

  for (const hash of hashes) {
    const lockKey = LOCK_PREFIX + hash;
    // Claim this hash for this worker process.
    let claimed;
    try {
      claimed = await redis.set(lockKey, "1", "NX", "EX", LOCK_TTL_SEC);
    } catch (ex) {
      console.error("[previewretry] lock acquire error:", ex.message || ex);
      continue;
    }
    if (!claimed) {
      // Another worker claimed it first; skip.
      continue;
    }

    // Remove from the queue now that we've won the lock.
    try {
      await redis.zrem(RETRY_QUEUE_KEY, hash);
    } catch (_) {
      // Best-effort; lock ensures we won't double-run.
    }

    try {
      await STORAGE.loaded;
      const storage = STORAGE.get(hash);
      if (!storage) {
        // Upload was deleted between scheduling and retry; clear tracking.
        await redis.hdel(RETRY_ATTEMPTS_KEY, hash).catch(() => {});
        continue;
      }
      if (storage.assets && storage.assets.size > 0) {
        // Assets already generated via another path; nothing to do.
        await redis.hdel(RETRY_ATTEMPTS_KEY, hash).catch(() => {});
        continue;
      }

      await generateAssets(storage);

      // Success — clear all retry tracking for this hash.
      await redis.hdel(RETRY_ATTEMPTS_KEY, hash).catch(() => {});
      console.info(`[previewretry] hash ${hash} preview generated on retry`);
    } catch (ex) {
      OBS.trackPreviewFailure({ hash }, "preview-retry", ex);
      console.error(
        `[previewretry] retry attempt failed for hash ${hash}:`,
        ex.message || ex,
      );
      // scheduleRetry reads the current attempt count and decides
      // whether to enqueue another try.
      await scheduleRetry(hash);
    } finally {
      await redis.del(lockKey).catch(() => {});
    }
  }
}

let _timer = null;

/**
 * Start the background retry poller.
 * Intended to be called once per HTTP worker process.
 * The timer is `unref`-ed so it does not prevent clean process exit.
 */
function start() {
  if (_timer) {
    return;
  }
  _timer = setInterval(() => {
    processDue().catch((err) =>
      console.error(
        "[previewretry] poll error:",
        (err && err.message) || err,
      ),
    );
  }, POLL_INTERVAL_MS);
  if (_timer && typeof _timer.unref === "function") {
    _timer.unref();
  }
}

/**
 * Stop the background retry poller (for clean shutdown / tests).
 */
function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

module.exports = { scheduleRetry, start, stop };
