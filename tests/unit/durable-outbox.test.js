"use strict";

const BROKER = require("../../lib/broker");
const { DurableOutbox } = require("../../lib/durable-outbox");

describe("durable outbox", () => {
  const outbox = new DurableOutbox(`test-${process.pid}-${Date.now()}`, { leaseMs: 30 });
  beforeAll(async () => {
    await BROKER.ready();
  });
  afterAll(async () => {
    for (const key of outbox.keys) {
      await BROKER.getMethod("del")(key);
    }
  });
  test("leases survive worker loss, preserve arrays, and fence stale acknowledgements", async () => {
    const job = { id: "synthetic", event: "test", payload: { empty: [], nested: [1, 2] }, attempt: 0, createdAt: Date.now() };
    expect(await outbox.enqueue(job)).toBe(true);
    expect(await outbox.enqueue(job)).toBe(false);
    const first = await outbox.claim();
    expect(first.payload).toEqual(job.payload);
    expect(await outbox.claim()).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 40));
    const recovered = await new DurableOutbox(outbox.keys[0].match(/\{(.+)\}/)[1]).claim();
    expect(recovered.id).toBe(job.id);
    expect(recovered.owner).not.toBe(first.owner);
    expect(Number(await outbox.complete(first))).toBe(0);
    expect(Number(await outbox.retry(recovered, 0))).toBe(1);
    const retry = await outbox.claim();
    expect(retry.attempt).toBe(1);
    expect(retry.payload.empty).toEqual([]);
    await outbox.deadLetter(retry, new Error("Synthetic failure"));
    expect(await outbox.claim()).toBeNull();
    expect(await BROKER.getMethod("hget")(outbox.keys[4], job.id)).toContain("Synthetic failure");
    expect(await BROKER.getMethod("get")(outbox.keys[5])).toBe("0");
  });
  test("rejects oversized jobs", async () => {
    await expect(outbox.enqueue({ id: "oversized", value: "x".repeat(262144) })).rejects.toThrow("capacity");
  });
});
