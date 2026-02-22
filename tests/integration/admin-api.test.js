"use strict";

/**
 * Integration tests for the admin API endpoints (v1.2):
 *   GET  /api/v1/admin/config
 *   PATCH /api/v1/admin/config
 *   POST /api/v1/admin/rooms/prune
 *   DELETE /api/v1/admin/rooms/:id
 *   DELETE /api/v1/admin/rooms        (nuclear)
 *
 * Runs against the live server at http://127.0.0.1:9090.
 * Requires an automation API key in the DICEFILES_TEST_KEY environment variable
 * (or falls back to reading .config.json for automationApiKeys[0]).
 * All tests are skipped automatically if the server is unreachable.
 */

const BASE = "http://127.0.0.1:9090";

// Resolve the API key: prefer env var, then find a key in .config.json that
// has admin:config / admin:rooms / admin:* / mod:* / * scope.
function resolveApiKey() {
  if (process.env.DICEFILES_TEST_KEY) {
    return process.env.DICEFILES_TEST_KEY;
  }
  try {
    const fs = require("fs");
    const path = require("path");
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../.config.json"), "utf8"),
    );
    const keys = cfg.automationApiKeys || [];
    if (!keys.length) return null;
    // Prefer a key that explicitly carries admin or wildcard scopes.
    const adminScopes = new Set([
      "*",
      "admin:*",
      "admin:config",
      "admin:rooms",
      "mod:*",
    ]);
    for (const entry of keys) {
      if (typeof entry === "string") return entry; // legacy = full access
      const scopes = entry.scopes || [];
      if (scopes.some((s) => adminScopes.has(s))) {
        return entry.key || null;
      }
    }
    // Fall back to the first key.
    const first = keys[0];
    return typeof first === "string" ? first : first.key || null;
  } catch {
    return null;
  }
}

const API_KEY = resolveApiKey();

async function apiFetch(method, path, body, key = API_KEY) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-Dicefiles-API-Key"] = key;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ── pre-flight: skip if server is down ────────────────────────────────────────

let serverUp = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/healthz`, {
      signal: AbortSignal.timeout(4000),
    });
    serverUp = res.status === 200 || res.status === 503;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(
      "\n[admin-api.test.js] Server not reachable at",
      BASE,
      "— all integration tests SKIPPED\n",
    );
  }
  if (!API_KEY) {
    console.warn(
      "\n[admin-api.test.js] No API key found — set DICEFILES_TEST_KEY or add automationApiKeys to .config.json\n",
    );
  }
});

function ifServer(name, fn) {
  test(name, async () => {
    if (!serverUp || !API_KEY) return;
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/admin/config
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/v1/admin/config", () => {
  ifServer("returns 200 with config object", async () => {
    const { status, json } = await apiFetch("GET", "/api/v1/admin/config");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.config).toBeDefined();
    expect(typeof json.config.roomPruning).toBe("boolean");
    expect(typeof json.config.publicRooms).toBe("boolean");
  });

  ifServer("returns 401 without API key", async () => {
    const { status } = await apiFetch(
      "GET",
      "/api/v1/admin/config",
      undefined,
      "",
    );
    expect(status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/admin/config
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/v1/admin/config", () => {
  // Store original value to restore after tests
  let originalPruningDays;

  beforeAll(async () => {
    if (!serverUp || !API_KEY) return;
    const { json } = await apiFetch("GET", "/api/v1/admin/config");
    originalPruningDays = json?.config?.roomPruningDays ?? 21;
  });

  afterAll(async () => {
    if (!serverUp || !API_KEY) return;
    // Restore original value (without persisting)
    await apiFetch("PATCH", "/api/v1/admin/config", {
      roomPruningDays: originalPruningDays,
    });
  });

  ifServer("applies a valid mutable key", async () => {
    const { status, json } = await apiFetch("PATCH", "/api/v1/admin/config", {
      roomPruningDays: 99,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.applied.roomPruningDays).toBe(99);
  });

  ifServer("persist:true sets persisted:true in response", async () => {
    // The in-memory change is per-worker so we can't reliably test cross-request
    // visibility in a multi-worker setup. Instead, verify the persist flag works
    // by checking the response and then restoring the previous value.
    const { status, json } = await apiFetch("PATCH", "/api/v1/admin/config", {
      roomPruningDays: originalPruningDays,
      persist: true,
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.persisted).toBe(true);
    expect(json.applied.roomPruningDays).toBe(originalPruningDays);
  });

  ifServer("rejects non-whitelisted keys", async () => {
    const { status, json } = await apiFetch("PATCH", "/api/v1/admin/config", {
      secret: "hacked",
    });
    expect(status).toBe(200); // partial success
    expect(json.rejected).toBeDefined();
    expect(json.rejected.secret).toBeDefined();
    expect(json.applied.secret).toBeUndefined();
  });

  ifServer("returns 401 without API key", async () => {
    const { status } = await apiFetch(
      "PATCH",
      "/api/v1/admin/config",
      { roomPruning: true },
      "",
    );
    expect(status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/admin/rooms/prune
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/v1/admin/rooms/prune", () => {
  ifServer("returns 200 with pruned count", async () => {
    const { status, json } = await apiFetch(
      "POST",
      "/api/v1/admin/rooms/prune",
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.pruned).toBe("number");
    expect(json.pruned).toBeGreaterThanOrEqual(0);
  });

  ifServer("returns 401 without API key", async () => {
    const { status } = await apiFetch(
      "POST",
      "/api/v1/admin/rooms/prune",
      undefined,
      "",
    );
    expect(status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/admin/rooms/:id  — 404 for unknown room
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/v1/admin/rooms/:id", () => {
  ifServer("returns 404 for a non-existent room", async () => {
    const { status, json } = await apiFetch(
      "DELETE",
      "/api/v1/admin/rooms/nonexistentroom999",
    );
    expect(status).toBe(404);
    expect(json.err).toBeDefined();
  });

  ifServer("returns 401 without API key", async () => {
    const { status } = await apiFetch(
      "DELETE",
      "/api/v1/admin/rooms/anyroomid",
      undefined,
      "",
    );
    expect(status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/admin/rooms  — nuclear; require confirmation string
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/v1/admin/rooms (nuclear)", () => {
  ifServer("returns 400 without confirmation string", async () => {
    const { status } = await apiFetch("DELETE", "/api/v1/admin/rooms", {});
    expect(status).toBe(400);
  });

  ifServer("returns 400 with wrong confirmation string", async () => {
    const { status } = await apiFetch("DELETE", "/api/v1/admin/rooms", {
      confirm: "yes please",
    });
    expect(status).toBe(400);
  });

  ifServer("returns 401 without API key", async () => {
    const { status } = await apiFetch(
      "DELETE",
      "/api/v1/admin/rooms",
      { confirm: "destroy-all-rooms" },
      "",
    );
    expect(status).toBe(401);
  });

  // NOTE: we intentionally do NOT test the happy-path of the nuclear endpoint
  // in automated integration tests because it would destroy all live room data.
  // Test it manually on a disposable instance.
});
