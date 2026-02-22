"use strict";

/**
 * Security hardening tests
 *
 * Behavioural coverage for the security hardening implementations:
 *  - Webhook request_fulfilled firing on setStatus vs deletion (no double-fire)
 *  - Webhook HMAC signature correctness and sensitivity
 *  - Webhook exponential backoff ceiling
 *  - FloodProtector per-account lockout logic
 *  - Weak-secret detection (startup guard)
 *  - URL regex ReDoS resistance (url-regex-safe)
 *
 * All tests run in pure Node without a live server, Redis, or network.
 */

// ─── Webhook dispatcher — dispatch routing ────────────────────────────────────

describe("WebhookDispatcher — request_fulfilled routing", () => {
  /**
   * We load lib/webhooks.js with mocked REQUESTS / UPLOADS / CONFIG so that
   * no real Redis or HTTP connections are ever attempted.
   * jest.resetModules() + jest.doMock() (non-hoisted) give us a fresh module
   * instance per test group.
   */

  let webhooks;
  let mockRequests;
  let mockUploads;

  beforeEach(() => {
    jest.resetModules();

    const { ObservableMap } = require("../../common/omap");
    mockRequests = new ObservableMap();
    mockUploads = new ObservableMap();

    jest.doMock("../../lib/request", () => ({ REQUESTS: mockRequests }));
    jest.doMock("../../lib/upload", () => ({ UPLOADS: mockUploads }));
    // Provide one hook subscribed to all events so dispatch() doesn't
    // short-circuit on "no configured hooks".
    jest.doMock("../../lib/config", () => ({
      get: (key) => {
        if (key === "webhooks") {
          return [
            {
              url: "http://test.example.com/hook",
              events: [
                "request_fulfilled",
                "request_created",
                "file_uploaded",
                "file_deleted",
              ],
            },
          ];
        }
        if (key === "webhookRetry") return {};
        if (key === "webhookDeadLetterLog") return null;
        return null;
      },
    }));

    webhooks = require("../../lib/webhooks");
  });

  afterEach(() => {
    jest.resetModules();
  });

  // onRequestUpdate ────────────────────────────────────────────────────────────

  test("onRequestUpdate fires request_fulfilled when status is 'fulfilled'", () => {
    const dispatched = [];
    jest
      .spyOn(webhooks, "dispatch")
      .mockImplementation((event, payload) =>
        dispatched.push({ event, payload }),
      );

    webhooks.onRequestUpdate("k1", {
      status: "fulfilled",
      key: "k1",
      name: "test",
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].event).toBe("request_fulfilled");
  });

  test("onRequestUpdate does not fire for status 'open'", () => {
    const spy = jest.spyOn(webhooks, "dispatch").mockImplementation(() => {});

    webhooks.onRequestUpdate("k1", { status: "open", key: "k1" });

    expect(spy).not.toHaveBeenCalled();
  });

  test("onRequestUpdate does not fire when request is null", () => {
    const spy = jest.spyOn(webhooks, "dispatch").mockImplementation(() => {});

    webhooks.onRequestUpdate("k1", null);

    expect(spy).not.toHaveBeenCalled();
  });

  // onRequestPredelete ─────────────────────────────────────────────────────────

  test("onRequestPredelete fires for open, non-expired request (mod delete)", () => {
    const dispatched = [];
    jest
      .spyOn(webhooks, "dispatch")
      .mockImplementation((event, payload) =>
        dispatched.push({ event, payload }),
      );

    mockRequests.set("k1", {
      status: "open",
      expired: false,
      key: "k1",
      name: "wanted: book",
    });
    webhooks.onRequestPredelete("k1");

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].event).toBe("request_fulfilled");
  });

  test("onRequestPredelete does NOT fire when request is already fulfilled (no double-fire)", () => {
    const spy = jest.spyOn(webhooks, "dispatch").mockImplementation(() => {});

    mockRequests.set("k1", {
      status: "fulfilled",
      expired: false,
      key: "k1",
      name: "wanted: book",
    });
    webhooks.onRequestPredelete("k1");

    expect(spy).not.toHaveBeenCalled();
  });

  test("onRequestPredelete does NOT fire for expired requests (lifecycle cleanup)", () => {
    const spy = jest.spyOn(webhooks, "dispatch").mockImplementation(() => {});

    mockRequests.set("k1", {
      status: "open",
      expired: true,
      key: "k1",
      name: "old request",
    });
    webhooks.onRequestPredelete("k1");

    expect(spy).not.toHaveBeenCalled();
  });

  test("onRequestPredelete is a no-op when key is not in REQUESTS", () => {
    const spy = jest.spyOn(webhooks, "dispatch").mockImplementation(() => {});

    webhooks.onRequestPredelete("nonexistent");

    expect(spy).not.toHaveBeenCalled();
  });

  // Two-event lifecycle — setStatus then delete ────────────────────────────────

  test("full lifecycle: setStatus fires once; subsequent delete does not fire again", () => {
    const events = [];
    jest
      .spyOn(webhooks, "dispatch")
      .mockImplementation((event) => events.push(event));

    // 1. Request created
    mockRequests.set("k1", {
      status: "open",
      expired: false,
      key: "k1",
      name: "wanted",
    });

    // 2. Status updated to fulfilled → should fire
    webhooks.onRequestUpdate("k1", { status: "fulfilled", key: "k1" });

    // 3. Request subsequently deleted (e.g. TTL expiry) → should NOT fire again
    mockRequests.set("k1", { status: "fulfilled", expired: false, key: "k1" });
    webhooks.onRequestPredelete("k1");

    expect(events).toEqual(["request_fulfilled"]);
  });
});

// ─── Webhook — HMAC signature ─────────────────────────────────────────────────

describe("WebhookDispatcher — HMAC signature", () => {
  let webhooks;

  beforeAll(() => {
    jest.resetModules();
    const { ObservableMap } = require("../../common/omap");
    jest.doMock("../../lib/request", () => ({ REQUESTS: new ObservableMap() }));
    jest.doMock("../../lib/upload", () => ({ UPLOADS: new ObservableMap() }));
    jest.doMock("../../lib/config", () => ({
      get: (key) => (key === "webhooks" ? [] : null),
    }));
    webhooks = require("../../lib/webhooks");
  });

  afterAll(() => jest.resetModules());

  test("signature produces a 64-character hex string", () => {
    const sig = webhooks.signature(
      "mysecret",
      "1700000000000",
      '{"foo":"bar"}',
    );
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test("signature is deterministic", () => {
    const s1 = webhooks.signature("s", "ts", "body");
    const s2 = webhooks.signature("s", "ts", "body");
    expect(s1).toBe(s2);
  });

  test("signature changes when secret changes", () => {
    const s1 = webhooks.signature("secret-A", "ts", "body");
    const s2 = webhooks.signature("secret-B", "ts", "body");
    expect(s1).not.toBe(s2);
  });

  test("signature changes when timestamp changes", () => {
    const s1 = webhooks.signature("s", "t1", "body");
    const s2 = webhooks.signature("s", "t2", "body");
    expect(s1).not.toBe(s2);
  });

  test("signature changes when body changes", () => {
    const s1 = webhooks.signature("s", "ts", "body-a");
    const s2 = webhooks.signature("s", "ts", "body-b");
    expect(s1).not.toBe(s2);
  });
});

// ─── Webhook — exponential backoff ───────────────────────────────────────────

describe("WebhookDispatcher — backoff", () => {
  let webhooks;

  const BASE = 1500;
  const MAX = 30000;

  beforeAll(() => {
    jest.resetModules();
    const { ObservableMap } = require("../../common/omap");
    jest.doMock("../../lib/request", () => ({ REQUESTS: new ObservableMap() }));
    jest.doMock("../../lib/upload", () => ({ UPLOADS: new ObservableMap() }));
    jest.doMock("../../lib/config", () => ({
      get: (key) => {
        if (key === "webhooks") return [];
        if (key === "webhookRetry")
          return { baseDelayMs: BASE, maxDelayMs: MAX };
        return null;
      },
    }));
    webhooks = require("../../lib/webhooks");
  });

  afterAll(() => jest.resetModules());

  test("attempt 1 returns baseDelayMs", () => {
    expect(webhooks.backoff(1)).toBe(BASE);
  });

  test("attempt 2 doubles the delay", () => {
    expect(webhooks.backoff(2)).toBe(BASE * 2);
  });

  test("delay is capped at maxDelayMs", () => {
    expect(webhooks.backoff(100)).toBe(MAX);
  });

  test("attempt 0 (edge case) returns baseDelayMs", () => {
    expect(webhooks.backoff(0)).toBe(BASE);
  });
});

// ─── FloodProtector — per-account lockout logic ───────────────────────────────

describe("FloodProtector — per-account lockout", () => {
  /**
   * FloodProtector uses BROKER.getMethods("get", "del", "ratelimit").
   * We mock the broker and broker/collections to avoid a real Redis connection.
   */

  let FloodProtector;

  const mockGet = jest.fn();
  const mockDel = jest.fn();
  const mockRatelimit = jest.fn();

  beforeAll(() => {
    jest.resetModules();

    jest.doMock("../../lib/broker", () => {
      const EventEmitter = require("events");
      const broker = new EventEmitter();
      broker.setMaxListeners(0);
      broker.getMethods = (...methods) => {
        const rv = Object.create(null);
        for (const m of methods) {
          if (m === "get") rv.get = mockGet;
          else if (m === "del") rv.del = mockDel;
          else if (m === "ratelimit") rv.ratelimit = mockRatelimit;
          else rv[m] = jest.fn().mockResolvedValue(null);
        }
        return rv;
      };
      broker.getMethod = (m) => broker.getMethods(m)[m];
      return broker;
    });

    // Mock DistributedTracking so the `clients` singleton in tracking.js doesn't
    // attempt a real Redis SUBSCRIBE.
    jest.doMock("../../lib/broker/collections", () => ({
      DistributedTracking: class {
        constructor() {}
        on() {}
      },
    }));

    ({ FloodProtector } = require("../../lib/tracking"));
  });

  afterAll(() => jest.resetModules());

  beforeEach(() => {
    mockGet.mockReset();
    mockDel.mockReset();
    mockRatelimit.mockReset();
  });

  test("check() returns true when Redis count equals the max (locked out)", async () => {
    mockGet.mockResolvedValue("10");
    const fp = new FloodProtector("alice", "loginAccountFloods", 10, 900000);
    expect(await fp.check()).toBe(true);
  });

  test("check() returns true when Redis count exceeds max", async () => {
    mockGet.mockResolvedValue("15");
    const fp = new FloodProtector("alice", "loginAccountFloods", 10, 900000);
    expect(await fp.check()).toBe(true);
  });

  test("check() returns false when Redis count is below max", async () => {
    mockGet.mockResolvedValue("3");
    const fp = new FloodProtector("alice", "loginAccountFloods", 10, 900000);
    expect(await fp.check()).toBe(false);
  });

  test("check() returns false when Redis returns null (no prior attempts)", async () => {
    mockGet.mockResolvedValue(null);
    const fp = new FloodProtector("alice", "loginAccountFloods", 10, 900000);
    expect(await fp.check()).toBe(false);
  });

  test("check() uses the correct Redis key per account name", async () => {
    mockGet.mockResolvedValue("0");
    const fp = new FloodProtector("bob", "loginAccountFloods", 10, 900000);
    await fp.check();
    expect(mockGet).toHaveBeenCalledWith("flooding:loginAccountFloods:bob");
  });

  test("delete() calls redis.del with the correct flooding key", async () => {
    mockDel.mockResolvedValue(1);
    const fp = new FloodProtector("charlie", "loginAccountFloods", 10, 900000);
    await fp.delete();
    expect(mockDel).toHaveBeenCalledWith("flooding:loginAccountFloods:charlie");
  });

  test("bump() calls redis.ratelimit with the correct key and expiry", async () => {
    mockRatelimit.mockResolvedValue([1, 900000]);
    const fp = new FloodProtector("dave", "loginAccountFloods", 10, 900000);
    await fp.bump();
    expect(mockRatelimit).toHaveBeenCalledWith(
      "flooding:loginAccountFloods:dave",
      900000,
    );
  });
});

// ─── Weak-secret detection logic ─────────────────────────────────────────────

describe("Startup weak-secret detection", () => {
  /**
   * Re-encodes the exact condition from server.js so the logic is
   * tested independently without starting the server.
   */

  const WEAK_SECRETS = new Set(["dicefiles", "secret", "changeme"]);

  function isWeakSecret(s) {
    return !s || WEAK_SECRETS.has(s) || s.length < 16;
  }

  test("known default string 'dicefiles' is weak", () => {
    expect(isWeakSecret("dicefiles")).toBe(true);
  });

  test("known default string 'secret' is weak", () => {
    expect(isWeakSecret("secret")).toBe(true);
  });

  test("known default string 'changeme' is weak", () => {
    expect(isWeakSecret("changeme")).toBe(true);
  });

  test("short secret under 16 chars is weak", () => {
    expect(isWeakSecret("abc123")).toBe(true);
  });

  test("exactly 15 chars is weak (boundary — one under threshold)", () => {
    expect(isWeakSecret("1234567890abcde")).toBe(true);
  });

  test("exactly 16 chars is NOT weak (boundary — at threshold)", () => {
    expect(isWeakSecret("1234567890abcdef")).toBe(false);
  });

  test("null secret is weak", () => {
    expect(isWeakSecret(null)).toBe(true);
  });

  test("empty string is weak", () => {
    expect(isWeakSecret("")).toBe(true);
  });

  test("a long, unique secret is not weak", () => {
    expect(isWeakSecret("xK9mQ2zRvP1nLw7dF3bH6aJeGcYuNsT0")).toBe(false);
  });
});

// ─── URL regex ReDoS resistance ───────────────────────────────────────────────

describe("url-regex-safe — ReDoS resistance", () => {
  // These tests confirm the replacement module doesn't catastrophically
  // backtrack on crafted inputs that would hang the old url-regex package.

  let urlRegexSafe;

  beforeAll(() => {
    urlRegexSafe = require("url-regex-safe");
  });

  test("module loads and returns a RegExp from the factory", () => {
    const re = urlRegexSafe({ exact: false });
    expect(re).toBeInstanceOf(RegExp);
  });

  test("matches a plain https URL", () => {
    const re = urlRegexSafe({ exact: false });
    expect(re.test("visit https://example.com/path?q=1")).toBe(true);
  });

  test("matches a plain http URL", () => {
    const re = urlRegexSafe({ exact: false });
    expect(re.test("see http://example.org")).toBe(true);
  });

  test("does not catastrophically backtrack on ReDoS input (< 200 ms)", () => {
    const re = urlRegexSafe({ exact: false });
    // Shape that historically caused exponential backtracking in url-regex:
    // many domain-like segments ending abruptly without a valid TLD.
    const evil = "a".repeat(50) + "@" + "b".repeat(50) + "." + "c".repeat(50);
    const start = Date.now();
    re.test(evil);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("does not catastrophically backtrack on repeated dot+colon pattern (< 200 ms)", () => {
    const re = urlRegexSafe({ exact: false });
    const evil = "http://foo.bar.baz:".repeat(30);
    const start = Date.now();
    re.test(evil);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
