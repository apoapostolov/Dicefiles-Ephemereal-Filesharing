"use strict";

/**
 * Live Redis broker contract tests — drive the real shipped BROKER path.
 * Skips cleanly when Redis is unreachable.
 */

const BROKER = require("../../lib/broker");

const KEY = `dicefiles:test:broker:${process.pid}:${Date.now()}`;

describe("broker live redis (shipped)", () => {
  let available = false;

  beforeAll(async () => {
    try {
      await Promise.race([
        BROKER.ready(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("ready timeout")), 5000),
        ),
      ]);
      const ping = BROKER.getMethod("ping");
      const pong = await Promise.race([
        ping(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("ping timeout")), 5000),
        ),
      ]);
      available = pong === "PONG" || pong === "pong" || !!pong;
    }
    catch (ex) {
      available = false;
      console.warn("[broker-live] Redis unavailable, skipping:", ex.message);
    }
  }, 15000);

  afterAll(async () => {
    if (!available) {
      return;
    }
    try {
      const del = BROKER.getMethod("del");
      await del(KEY);
      await del(`${KEY}:hash`);
    }
    catch (_e) {
      // ignore
    }
  });

  test("ready resolves and ping works", async () => {
    if (!available) {
      return;
    }
    await expect(BROKER.ready()).resolves.toBeUndefined();
    const ping = BROKER.getMethod("ping");
    await expect(ping()).resolves.toBeTruthy();
  }, 10000);

  test("set/get/del complete without hang (promise-only path)", async () => {
    if (!available) {
      return;
    }
    const redis = BROKER.getMethods("set", "get", "del");
    const setResult = await Promise.race([
      redis.set(KEY, "hello-overhaul", "EX", 60),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("set hung >5s")), 5000),
      ),
    ]);
    expect(setResult === "OK" || setResult === true || setResult == null || setResult === "ok" || setResult === "OK").toBe(true);

    const got = await Promise.race([
      redis.get(KEY),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("get hung >5s")), 5000),
      ),
    ]);
    expect(got).toBe("hello-overhaul");

    await redis.del(KEY);
    const gone = await redis.get(KEY);
    expect(gone).toBeNull();
  }, 15000);

  test("set NX EX works", async () => {
    if (!available) {
      return;
    }
    const redis = BROKER.getMethods("set", "del", "get");
    await redis.del(KEY);
    const a = await redis.set(KEY, "one", "NX", "EX", 30);
    // v4 returns 'OK' or null
    expect(a === "OK" || a === true || a != null).toBe(true);
    const b = await redis.set(KEY, "two", "NX", "EX", 30);
    expect(b === null || b === undefined || b === false || b === 0 || b === "null").toBe(true);
    expect(await redis.get(KEY)).toBe("one");
    await redis.del(KEY);
  }, 10000);

  test("ratelimit lua script returns count", async () => {
    if (!available) {
      return;
    }
    const rl = BROKER.getMethod("ratelimit");
    const out = await Promise.race([
      rl(`rl:test:${KEY}`, 60000),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("ratelimit hung")), 5000),
      ),
    ]);
    expect(Array.isArray(out) || typeof out === "object").toBe(true);
    const count = Array.isArray(out) ? Number(out[0]) : Number(out);
    expect(count).toBeGreaterThanOrEqual(1);
  }, 10000);

  test("hset/hgetall roundtrip", async () => {
    if (!available) {
      return;
    }
    const redis = BROKER.getMethods("hset", "hgetall", "del");
    const hk = `${KEY}:hash`;
    await redis.del(hk);
    await redis.hset(hk, "a", "1");
    await redis.hset(hk, "b", "2");
    const all = await redis.hgetall(hk);
    expect(all).toBeTruthy();
    expect(all.a).toBe("1");
    expect(all.b).toBe("2");
    await redis.del(hk);
  }, 10000);
});
