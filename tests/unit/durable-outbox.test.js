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
  test("scheduled jobs, scoped history, cancellation, replay and fencing", async () => {
    const job = { id: "scheduled", roomId: "synthetic-room", pluginId: "feed-collector", global: false, attempt: 0, dueAt: Date.now() + 10000 };
    expect(await outbox.enqueue(job)).toBe(true);
    expect(await outbox.claim()).toBeNull();
    expect((await outbox.list({ roomId: job.roomId, pluginId: job.pluginId, global: false })).records).toHaveLength(1);
    expect(Object.values((await outbox.list({ roomId: "other-room" })).records)).toHaveLength(0);
    expect(Number(await outbox.cancel(job.id))).toBe(1);
    expect((await outbox.get(job.id)).status).toBe("cancelled");
    expect(Number(await outbox.replay({ ...job, dueAt: Date.now() }))).toBe(1);
    const active = await outbox.claim();
    expect(active.id).toBe(job.id);
    expect(Number(await outbox.cancel(job.id))).toBe(1);
    expect(Number(await outbox.complete(active, { imported: 1 }))).toBe(0);
    expect(Number(await outbox.replay({ ...job, dueAt: Date.now() }))).toBe(1);
    const next = await outbox.claim();
    await outbox.retry(next, 0, { increment: false });
    const resumed = await outbox.claim();
    expect(resumed.attempt).toBe(0);
    await outbox.complete(resumed, { imported: 1 });
    expect(await outbox.get(job.id)).toMatchObject({ status: "completed", result: { imported: 1 } });
    expect(Number(await outbox.replay(job))).toBe(0);
    expect((await outbox.list({ roomId: job.roomId })).records[0].status).toBe("completed");
    expect(await BROKER.getMethod("get")(outbox.keys[5])).toBe("0");
  });
});
