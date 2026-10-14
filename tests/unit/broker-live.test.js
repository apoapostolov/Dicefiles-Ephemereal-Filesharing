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
      await del(`${KEY}:zset`);
    }
    catch (_e) {
      // ignore
    }
  });

  test("draining, expiry accounting and renewal are atomic in Redis", async () => {
    if (!available) {
      return;
    }
    const redis = BROKER.getMethods("storagereserve", "storagerenew", "storagerelease", "hset", "hget", "del");
    const keys = [`${KEY}:reservations`, `${KEY}:expiry`, `${KEY}:totals`, `${KEY}:draining`];
    const now = Date.now();
    try {
      expect(Number((await redis.storagereserve(...keys, "upload", "volume", 100, 1000, now, now + 1000))[0])).toBe(1);
      await redis.hset(keys[3], "volume", "1");
      expect(Number((await redis.storagereserve(...keys, "new", "volume", 100, 1000, now, now + 1000))[0])).toBe(0);
      expect(Number((await redis.storagereserve(...keys, "upload", "volume", 120, 1000, now, now + 1000))[0])).toBe(1);
      expect(Number(await redis.storagerenew(keys[0], keys[1], "upload", "volume", now, now + 3000))).toBe(1);
      expect(Number(await redis.storagerenew(keys[0], keys[1], "upload", "other", now, now + 3000))).toBe(0);
      await redis.hset(keys[3], "volume", "0");
      expect(Number((await redis.storagereserve(...keys, "upload", "volume", 50, 1000, now + 4000, now + 5000))[0])).toBe(1);
      expect(Number(await redis.hget(keys[2], "volume"))).toBe(50);
      await redis.storagerelease(keys[0], keys[1], keys[2], "upload", "volume");
      expect(Number(await redis.hget(keys[2], "volume"))).toBe(0);
    }
    finally {
      await redis.del(...keys);
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
    expect(
      setResult === "OK" ||
        setResult === true ||
        setResult == null ||
        setResult === "ok" ||
        setResult === "OK",
    ).toBe(true);

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
    expect(
      b === null || b === undefined || b === false || b === 0 || b === "null",
    ).toBe(true);
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

  test("zrevrange supports legacy WITHSCORES on the installed Redis client", async () => {
    if (!available) {
      return;
    }
    const redis = BROKER.getMethods("zadd", "zrevrange", "del");
    const zk = `${KEY}:zset`;
    await redis.del(zk);
    await redis.zadd(zk, 10, "alice");
    await redis.zadd(zk, 20, "bob");
    await expect(redis.zrevrange(zk, 0, -1)).resolves.toEqual(["bob", "alice"]);
    await expect(redis.zrevrange(zk, 0, -1, "WITHSCORES")).resolves.toEqual([
      "bob",
      "20",
      "alice",
      "10",
    ]);
  }, 10000);
  test("distributed map clear removes durable values from Redis", async () => {
    if (!available) {
      return;
    }
    const redis = BROKER.getMethods("dmap", "hgetall", "del");
    const key = `${KEY}:clear-map`;
    try {
      await redis.dmap(key, "test-worker", "set", JSON.stringify("file"), JSON.stringify({ value: 1 }));
      expect(Object.keys(await redis.hgetall(key))).toHaveLength(1);
      await redis.dmap(key, "test-worker", "clear");
      expect(await redis.hgetall(key)).toEqual({});
    }
    finally {
      await redis.del(key);
    }
  });

  test("atomic map updates arbitrate competing workers and preserve JSON arrays", async () => {
    if (!available) {
      return;
    }
    const { DistributedMap } = require("../../lib/broker/collections");

    const name = `${KEY}:atomic-map`;
    const redisKey = `map:${name}`;
    const redis = BROKER.getMethods("hset", "hgetall", "del");
    await redis.hset(redisKey, JSON.stringify({ v: "request" }), JSON.stringify({ claimedBy: "", keywords: [] }));
    const workers = [new DistributedMap(name), new DistributedMap(name)];
    try {
      await Promise.all(workers.map(w => w.loaded));
      const results = await Promise.allSettled(workers.map((worker, index) =>
        worker.updateAtomic("request", current => {
          if (current.claimedBy) {
            throw Object.assign(new Error("Already claimed"), { status: 409 });
          }
          return { ...current, claimedBy: `agent-${index}` };
        }),
      ));
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find(r => r.status === "rejected").reason.status).toBe(409);
      const stored = Object.values(await redis.hgetall(redisKey)).map(v => JSON.parse(v));
      expect(stored[0].keywords).toEqual([]);
      expect(stored[0].claimedBy).toMatch(/^agent-/);
      await redis.del(redisKey);
      await expect(workers[0].updateAtomic("request", value => value)).rejects.toMatchObject({ status: 404 });
    }
    finally {
      await redis.del(redisKey);
      for (const worker of workers) {
        BROKER.removeListener(redisKey, worker.onsync);
        worker.kill();
      }
    }
  });
});
