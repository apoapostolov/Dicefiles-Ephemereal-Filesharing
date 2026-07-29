"use strict";

jest.mock("../../lib/config", () => new Map([
  ["federation", { enabled: false }],
]));
jest.mock("../../lib/broker", () => ({
  getMethods: () => ({}),
}));
jest.mock("../../lib/federation/transport", () => ({
  currentConfig: () => ({ enabled: false, peers: [] }),
  sendRoomInvalidation: jest.fn(),
}));

const {
  createFederationOutbox,
} = require("../../lib/federation/outbox");

function fakeRedis() {
  const values = new Map();
  const hashes = new Map();
  const schedule = new Map();
  const api = {
    async del(key) {
      return values.delete(key) ? 1 : 0;
    },
    async get(key) {
      return values.get(key) || null;
    },
    async set(key, value, ...args) {
      if (args.includes("NX") && values.has(key)) {
        return null;
      }
      values.set(key, String(value));
      return "OK";
    },
    async hget(key, field) {
      return hashes.get(key)?.get(field) || null;
    },
    async hset(key, field, value) {
      if (!hashes.has(key)) {
        hashes.set(key, new Map());
      }
      hashes.get(key).set(field, String(value));
      return 1;
    },
    async hdel(key, field) {
      return hashes.get(key)?.delete(field) ? 1 : 0;
    },
    async zadd(_key, score, member) {
      schedule.set(String(member), Number(score));
      return 1;
    },
    async zrem(_key, member) {
      return schedule.delete(String(member)) ? 1 : 0;
    },
    async zrangebyscore(_key, min, max, _limit, offset, count) {
      return Array.from(schedule.entries()).
        filter(([, score]) => score >= Number(min) && score <= Number(max)).
        sort((a, b) => a[1] - b[1]).
        slice(Number(offset), Number(offset) + Number(count)).
        map(([member]) => member);
    },
    multi() {
      const ops = [];
      const chain = {};
      for (const name of ["hset", "hdel", "zadd", "zrem", "set"]) {
        chain[name] = (...args) => {
          ops.push([name, args]);
          return chain;
        };
      }
      chain.exec = async () => {
        const results = [];
        for (const [name, args] of ops) {
          results.push(await api[name](...args));
        }
        return results;
      };
      return chain;
    },
    _hashes: hashes,
    _schedule: schedule,
  };
  return api;
}

describe("durable federation invalidation outbox", () => {
  test("persists, delivers, and de-duplicates a room invalidation", async () => {
    const redis = fakeRedis();
    const deliver = jest.fn(async () => 202);
    const federation = {
      enabled: true,
      publicBaseUrl: "https://alpha.example",
      peers: [{
        peerId: "beta",
        enabled: true,
        allowedRooms: ["releases"],
      }],
    };
    const outbox = createFederationOutbox({
      redis,
      deliver,
      getConfig: () => federation,
    });

    await expect(outbox.enqueue("Add", {
      roomid: "releases",
      key: "file-1",
      uploaded: 123,
    })).resolves.toBe(1);
    expect(redis._schedule.size).toBe(1);
    await expect(outbox.processDue()).resolves.toBe(1);
    expect(deliver).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({
        type: "Add",
        object: expect.objectContaining({
          roomId: "releases",
          fileKey: "file-1",
        }),
      }),
    );
    expect(redis._schedule.size).toBe(0);

    await expect(outbox.enqueue("Add", {
      roomid: "releases",
      key: "file-1",
      uploaded: 123,
    })).resolves.toBe(0);
  });

  test("does not enqueue activity for peers without room permission", async () => {
    const outbox = createFederationOutbox({
      redis: fakeRedis(),
      deliver: jest.fn(),
      getConfig: () => ({
        enabled: true,
        publicBaseUrl: "https://alpha.example",
        peers: [{
          peerId: "beta",
          enabled: true,
          allowedRooms: ["other-room"],
        }],
      }),
    });
    await expect(outbox.enqueue("Remove", {
      roomid: "releases",
      key: "file-1",
    })).resolves.toBe(0);
  });
});
