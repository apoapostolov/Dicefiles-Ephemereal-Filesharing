"use strict";

/**
 * Memory hygiene and churn stress tests
 *
 * Verify that:
 *  1. ObservableMap emits correct events and does not leak listeners
 *     under rapid set/delete cycles.
 *  2. The AUTOMATION_RATE_STATE size-cap guard is enforced.
 *
 * These tests run in pure Node without a live server or Redis.
 */

const { ObservableMap } = require("../../common/omap.js");

// ─── ObservableMap event lifecycle ───────────────────────────────────────────

describe("ObservableMap — event lifecycle under churn", () => {
  test("set fires 'set' for new keys", () => {
    const m = new ObservableMap();
    const received = [];
    m.on("set", (k, v) => received.push({ k, v }));
    m.set("a", 1);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ k: "a", v: 1 });
  });

  test("set fires 'update' for existing keys", () => {
    const m = new ObservableMap();
    const received = [];
    m.on("update", (k, v) => received.push({ k, v }));
    m.set("a", 1); // new key — fires 'set'
    m.set("a", 2); // existing key — fires 'update'
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ k: "a", v: 2 });
  });

  test("delete fires 'predelete' then 'delete'", () => {
    const m = new ObservableMap();
    const events = [];
    m.on("predelete", (k) => events.push(`predelete:${k}`));
    m.on("delete", (k) => events.push(`delete:${k}`));
    m.set("a", 1);
    m.delete("a");
    expect(events).toEqual(["predelete:a", "delete:a"]);
  });

  test("delete on missing key does not fire predelete", () => {
    const m = new ObservableMap();
    let fired = false;
    m.on("predelete", () => {
      fired = true;
    });
    m.delete("nonexistent");
    expect(fired).toBe(false);
  });

  test("rapid set/delete cycles of 1000 entries do not leak", () => {
    const m = new ObservableMap();
    let setCount = 0;
    let deleteCount = 0;
    m.on("set", () => setCount++);
    m.on("delete", () => deleteCount++);

    for (let i = 0; i < 1000; i++) {
      m.set(`key-${i}`, i);
    }
    for (let i = 0; i < 1000; i++) {
      m.delete(`key-${i}`);
    }

    expect(setCount).toBe(1000);
    expect(deleteCount).toBe(1000);
    expect(m.size).toBe(0);
  });

  test("listener removal stops future events", () => {
    const m = new ObservableMap();
    let count = 0;
    const listener = () => count++;
    m.on("set", listener);
    m.set("a", 1);
    m.off("set", listener);
    m.set("b", 2);
    // Only the first set should have fired
    expect(count).toBe(1);
  });
});

// ─── AUTOMATION_RATE_STATE size-cap guard ────────────────────────────────────

describe("checkAutomationRateLimit — size cap", () => {
  // To test without importing the full httpserver (which starts Express),
  // we replicate the relevant logic in isolation.

  const LIMIT = { windowMs: 60000, max: 180 };
  const CAP = 5; // use small cap for test

  function makeRateLimiter(cap) {
    const state = new Map();
    function check(keyId) {
      const bucketKey = String(keyId);
      const now = Date.now();
      let s = state.get(bucketKey);
      if (!s || now >= s.resetAt) {
        // Enforce size cap
        if (!s && state.size >= cap) {
          return { limited: true, fromCap: true };
        }
        s = { count: 0, resetAt: now + LIMIT.windowMs };
      }
      s.count += 1;
      state.set(bucketKey, s);
      return { limited: s.count > LIMIT.max, fromCap: false, size: state.size };
    }
    return { check, state };
  }

  test("allows new buckets under cap", () => {
    const { check } = makeRateLimiter(10);
    expect(check("key-1").fromCap).toBe(false);
    expect(check("key-2").fromCap).toBe(false);
  });

  test("blocks new buckets when at cap", () => {
    const { check } = makeRateLimiter(CAP);
    for (let i = 0; i < CAP; i++) {
      check(`key-${i}`);
    }
    // One more unique key — should hit the cap
    const result = check("overflow-key");
    expect(result.limited).toBe(true);
    expect(result.fromCap).toBe(true);
  });

  test("existing bucket is not blocked by cap", () => {
    const { check } = makeRateLimiter(CAP);
    for (let i = 0; i < CAP; i++) {
      check(`key-${i}`);
    }
    // Calling an EXISTING key should always succeed (not treated as new)
    const result = check("key-0");
    expect(result.fromCap).toBe(false);
  });

  test("size never exceeds cap", () => {
    const { check, state } = makeRateLimiter(CAP);
    for (let i = 0; i < CAP * 3; i++) {
      check(`key-${i}`);
    }
    expect(state.size).toBeLessThanOrEqual(CAP);
  });
});
