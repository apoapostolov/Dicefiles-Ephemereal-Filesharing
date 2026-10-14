"use strict";

// Run the actual request emitter against an isolated map in the live test Redis.
const mockPrefix = `dicefiles:test:claims:${process.pid}:${Date.now()}:`;
jest.mock("../../lib/broker/collections", () => {
  const { DistributedMap } = jest.requireActual("../../lib/broker/collections");
  return { DistributedMap: class IsolatedMap extends DistributedMap {
    constructor(key, deserialize) {
      super(mockPrefix + key, deserialize);
    }
  } };
});
const BROKER = require("../../lib/broker");
const { EMITTER, REQUESTS } = require("../../lib/request");

describe("request claims against authoritative Redis state", () => {
  let available = false;
  beforeAll(async () => {
    try {
      await Promise.race([BROKER.ready(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Redis unavailable")), 5000))]);
      await REQUESTS.loaded;
      available = true;
    }
    catch (_) {
      available = false;
    }
  });
  afterAll(async () => {
    if (available) {
      await BROKER.getMethod("del")(`map:${mockPrefix}upload:requests`);
      await BROKER.getMethod("del")(`map:${mockPrefix}policy`);
    }
  });
  test("a policy change rejects an already authorized claim", async () => {
    if (!available) {
      return;
    }
    const request = await EMITTER.createRequest("synthetic-room", "Synthetic request", "", "127.0.0.1", "test", "white", "", 1, "", {});
    const map = `map:${mockPrefix}policy`;
    const field = JSON.stringify({ v: "passwordAccess" });
    const raw = JSON.stringify({ enabled: false });
    await BROKER.getMethod("hset")(map, field, raw);
    const guard = { map, field, raw };
    await BROKER.getMethod("hset")(map, field, JSON.stringify({ enabled: true }));
    await expect(EMITTER.claim(request.key, "agent-a", 5000, guard)).rejects.toMatchObject({ status: 403 });
  });
  test("only one competing agent wins, and a different agent cannot release it", async () => {
    if (!available) {
      return;
    }
    const request = await EMITTER.createRequest("synthetic-room", "Synthetic request", "", "127.0.0.1", "test", "white", "", 1, "", { keywords: [] });
    const results = await Promise.allSettled([
      EMITTER.claim(request.key, "agent-a", 5000),
      EMITTER.claim(request.key, "agent-b", 5000),
    ]);
    const winner = results.find(result => result.status === "fulfilled").value;
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected").reason.status).toBe(409);
    expect(winner.hints.keywords).toEqual([]);
    const loser = winner.claimedBy === "agent-a" ? "agent-b" : "agent-a";
    await expect(EMITTER.release(request.key, loser)).rejects.toMatchObject({ status: 403 });
    const released = await EMITTER.release(request.key, winner.claimedBy);
    expect(released.claimedBy).toBe("");
    expect(released.claimedUntil).toBe(0);
    const next = await EMITTER.claim(request.key, loser, 5000);
    expect(next.claimedBy).toBe(loser);
  });
});
