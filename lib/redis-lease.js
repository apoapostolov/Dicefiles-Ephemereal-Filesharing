"use strict";

const { randomUUID } = require("crypto");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Ownership checked release and renewal, shared across workers. */
async function withLease(key, action, { ttlMs = 30000, waitMs = 5000 } = {}) {
  const redis = require("./broker").getMethods("set", "lease");

  const owner = randomUUID();
  const deadline = Date.now() + waitMs;
  while (await redis.set(key, owner, "NX", "PX", ttlMs) !== "OK") {
    if (Date.now() >= deadline) {
      throw Object.assign(new Error("Operation is busy; try again"), { status: 409 });
    }
    await pause(50 + Math.random() * 50);
  }
  let lost = false;
  let renewing = false;
  const assertOwned = async () => {
    if (lost || Number(await redis.lease(key, owner, ttlMs)) !== 1) {
      lost = true;
      throw Object.assign(new Error("Operation lease expired; try again"), { status: 409 });
    }
  };
  const timer = setInterval(async () => {
    if (renewing) {
      return;
    }
    renewing = true;
    try {
      await assertOwned();
    }
    catch (_) {
      lost = true;
    }
    finally {
      renewing = false;
    }
  }, Math.floor(ttlMs / 3));
  timer.unref();
  try {
    return await action(assertOwned);
  }
  finally {
    clearInterval(timer);
    await redis.lease(key, owner, "release");
  }
}

module.exports = { withLease };
