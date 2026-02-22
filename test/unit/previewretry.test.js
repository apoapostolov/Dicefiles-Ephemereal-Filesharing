"use strict";

/**
 * Unit tests for lib/previewretry.js
 *
 * The module requires lib/broker at load time. We mock the broker so that no
 * real Redis connection is attempted. The mock's _mocks map gives tests access
 * to the spy functions for assertion.
 *
 * What is tested here:
 *  - scheduleRetry(null / undefined) is a no-op
 *  - scheduleRetry(hash) on first attempt: zadd + hset called
 *  - scheduleRetry(hash) when attempt count reaches MAX_RETRIES: hdel called, no zadd
 *  - start() & stop() manage the interval correctly
 */

/** @type {Record<string, jest.Mock>} */
const brokerMocks = {};

// Mock BEFORE any require() that loads broker or its dependents
jest.mock("../../lib/broker", () => {
  const EventEmitter = require("events");

  class MockBroker extends EventEmitter {
    constructor() {
      super();
      this.setMaxListeners(0);
      // PUB stubs — broker/index.js loads Lua scripts via PUB.script(); we skip that
      this.PUB = {
        dmap: jest.fn(),
        dset: jest.fn(),
        publish: jest.fn((_ch, _msg, cb) => cb && cb(null)),
        config: jest.fn(),
        script: jest.fn((_op, _src, cb) => cb && cb(null)),
      };
    }

    // Override emit so messages are not published to Redis in tests
    emit(event, ...args) {
      if (event === "newListener" || event === "removeListener") {
        return super.emit(event, ...args);
      }
      return super.emit(event, ...args);
    }

    getMethods(...methods) {
      const rv = Object.create(null);
      for (const m of methods) {
        if (!brokerMocks[m]) {
          brokerMocks[m] = jest.fn().mockResolvedValue(null);
        }
        rv[m] = brokerMocks[m];
      }
      return rv;
    }

    getMethod(m) {
      if (!brokerMocks[m]) {
        brokerMocks[m] = jest.fn().mockResolvedValue(null);
      }
      return brokerMocks[m];
    }
  }

  return new MockBroker();
});

// Require target module AFTER mock is registered
const { scheduleRetry, start, stop } = require("../../lib/previewretry");

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────
function resetMocks() {
  for (const fn of Object.values(brokerMocks)) {
    fn.mockReset();
    fn.mockResolvedValue(null);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduleRetry
// ─────────────────────────────────────────────────────────────────────────────
describe("scheduleRetry", () => {
  beforeEach(resetMocks);

  test("null hash is a no-op (no redis calls)", async () => {
    await scheduleRetry(null);
    for (const fn of Object.values(brokerMocks)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  test("undefined hash is a no-op", async () => {
    await scheduleRetry(undefined);
    for (const fn of Object.values(brokerMocks)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  test("first attempt: hget returns null → zadd and hset are called", async () => {
    brokerMocks.hget.mockResolvedValue(null); // no prior attempt count

    await scheduleRetry("testhash");

    expect(brokerMocks.hget).toHaveBeenCalled();
    expect(brokerMocks.zadd).toHaveBeenCalled();
    expect(brokerMocks.hset).toHaveBeenCalled();

    // zadd called with the queue key and the hash as member
    const zaddArgs = brokerMocks.zadd.mock.calls[0];
    expect(zaddArgs[0]).toBe("preview:retry");
    expect(zaddArgs[zaddArgs.length - 1]).toBe("testhash");
  });

  test("second attempt: increments counter, uses 15-minute delay", async () => {
    brokerMocks.hget.mockResolvedValue("1"); // already had one attempt

    const before = Date.now();
    await scheduleRetry("testhash2");
    const after = Date.now();

    expect(brokerMocks.zadd).toHaveBeenCalled();
    const score = Number(brokerMocks.zadd.mock.calls[0][1]);
    // 15 min = 900000 ms delay
    expect(score).toBeGreaterThanOrEqual(before + 900000 - 100);
    expect(score).toBeLessThanOrEqual(after + 900000 + 100);
  });

  test("third (MAX_RETRIES) attempt: still schedules (hdel NOT called)", async () => {
    brokerMocks.hget.mockResolvedValue("2"); // 2 prior attempts = about to be 3rd

    await scheduleRetry("testhash3");

    expect(brokerMocks.zadd).toHaveBeenCalled();
    expect(brokerMocks.hdel).not.toHaveBeenCalled();
  });

  test("beyond MAX_RETRIES: hdel called, zadd NOT called", async () => {
    brokerMocks.hget.mockResolvedValue("3"); // 3 prior attempts → give up

    await scheduleRetry("testhash4");

    expect(brokerMocks.hdel).toHaveBeenCalled();
    expect(brokerMocks.zadd).not.toHaveBeenCalled();
  });

  test("redis error is caught and does not throw", async () => {
    brokerMocks.hget.mockRejectedValue(new Error("redis down"));
    await expect(scheduleRetry("testhash5")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// start / stop
// ─────────────────────────────────────────────────────────────────────────────
describe("start / stop", () => {
  afterEach(() => stop());

  test("start() does not throw", () => {
    expect(() => start()).not.toThrow();
  });

  test("stop() after start does not throw", () => {
    start();
    expect(() => stop()).not.toThrow();
  });

  test("calling start() twice does not create two intervals (idempotent)", () => {
    // There is no observable output for this other than no crash and correct behaviour.
    start();
    start(); // should be a no-op
    expect(() => stop()).not.toThrow();
  });

  test("stop() without start() is safe", () => {
    expect(() => stop()).not.toThrow();
  });
});
