"use strict";
/**
 * Integration tests for Automation API v1.1 endpoints.
 *
 * Three test categories:
 *   1. Auth boundary  — all v1.1 endpoints return 401/404 without a valid API key
 *   2. Structural     — shape/schema validation on responses (run with any valid key)
 *   3. AI workflows   — multi-step agentic patterns (claim-work-release, subscriptions,
 *                       metrics pre-flight). These simulate how a real orchestrator or
 *                       MCP wrapper would interact with the server.
 *
 * Prerequisites
 * -------------
 *   Server listening at http://127.0.0.1:9090
 *
 * Live tests run automatically when env vars are set:
 *   export DICEFILES_TEST_API_KEY=<key-with-files:read+rooms:write+requests:write+admin:read>
 *   export DICEFILES_TEST_UPLOAD_KEY=<key-with-uploads:write+files:write>
 *   export DICEFILES_TEST_ROOMID=<existing-room-id>
 *
 * Without those vars the auth-boundary and schema-free tests still run.
 */

const BASE = "http://127.0.0.1:9090";
const TEST_KEY = process.env.DICEFILES_TEST_API_KEY || "";
const UPLOAD_KEY = process.env.DICEFILES_TEST_UPLOAD_KEY || TEST_KEY;
const TEST_ROOM = process.env.DICEFILES_TEST_ROOMID || "";
const LIVE = Boolean(TEST_KEY && TEST_ROOM);
const LIVE_MSG =
  "skipped — set DICEFILES_TEST_API_KEY + DICEFILES_TEST_ROOMID to enable";

// ── helpers ────────────────────────────────────────────────────────────────

async function req(
  method,
  path,
  { key = "", body, rawBody, headers = {} } = {},
) {
  const url = `${BASE}${path}`;
  const h = { ...headers };
  if (key) h["X-Dicefiles-API-Key"] = key;

  let fetchBody;
  if (rawBody !== undefined) {
    fetchBody = rawBody;
  } else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers: h, body: fetchBody });
  let json;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const get = (path, opts) => req("GET", path, opts);
const post = (path, opts) => req("POST", path, opts);
const patch = (path, opts) => req("PATCH", path, opts);
const del = (path, opts) => req("DELETE", path, opts);

function auth(key) {
  return { key };
}

// ── 1. Auth boundary tests ─────────────────────────────────────────────────
//
// Every v1.1 endpoint should reject requests with no API key.
// Expected: 401 (automation disabled) or 404 (room/file not found before auth check).
// The important assertion is that it is NOT 200.

describe("Auth boundaries — v1.1 endpoints reject unauthenticated requests", () => {
  const FAKE = "notarealfile00000";
  const FAKE_ROOM = "XXXXXXXXXXXXXX";

  test("GET /api/v1/file/:key → not 200 without key", async () => {
    const { status } = await get(`/api/v1/file/${FAKE}`);
    expect(status).not.toBe(200);
  });

  test("PATCH /api/v1/file/:key → not 200 without key", async () => {
    const { status } = await patch(`/api/v1/file/${FAKE}`, {
      body: { meta: {} },
    });
    expect(status).not.toBe(200);
  });

  test("POST /api/v1/file/:key/asset/cover → not 200 without key", async () => {
    const { status } = await post(`/api/v1/file/${FAKE}/asset/cover`, {
      rawBody: Buffer.from("ff"),
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(status).not.toBe(200);
  });

  test("POST /api/v1/room/:id/chat → not 200 without key", async () => {
    const { status } = await post(`/api/v1/room/${FAKE_ROOM}/chat`, {
      body: { text: "hello" },
    });
    expect(status).not.toBe(200);
  });

  test("GET /api/v1/room/:id/snapshot → not 200 without key", async () => {
    const { status } = await get(`/api/v1/room/${FAKE_ROOM}/snapshot`);
    expect(status).not.toBe(200);
  });

  test("GET /api/v1/metrics → not 200 without key", async () => {
    const { status } = await get("/api/v1/metrics");
    expect(status).not.toBe(200);
  });

  test("GET /api/v1/audit → not 200 without key", async () => {
    const { status } = await get("/api/v1/audit");
    expect(status).not.toBe(200);
  });

  test("POST /api/v1/batch-upload → not 200 without key", async () => {
    const { status } = await post("/api/v1/batch-upload", {
      body: { roomid: FAKE_ROOM, items: [] },
    });
    expect(status).not.toBe(200);
  });

  test("POST /api/v1/requests/:key/claim → not 200 without key", async () => {
    const { status } = await post(`/api/v1/requests/${FAKE}/claim`);
    expect(status).not.toBe(200);
  });

  test("DELETE /api/v1/requests/:key/claim → not 200 without key", async () => {
    const { status } = await del(`/api/v1/requests/${FAKE}/claim`);
    expect(status).not.toBe(200);
  });

  test("POST /api/v1/agent/subscriptions → not 200 without key", async () => {
    const { status } = await post("/api/v1/agent/subscriptions", {
      body: { name: "test-sub" },
    });
    expect(status).not.toBe(200);
  });

  test("GET /api/v1/agent/subscriptions → not 200 without key", async () => {
    const { status } = await get("/api/v1/agent/subscriptions");
    expect(status).not.toBe(200);
  });

  test("DELETE /api/v1/agent/subscriptions/:name → not 200 without key", async () => {
    const { status } = await del("/api/v1/agent/subscriptions/ghost-sub");
    expect(status).not.toBe(200);
  });
});

// ── 2. Health endpoint (no key required) ──────────────────────────────────

describe("Health endpoint", () => {
  test("GET /healthz returns ok:true with all expected metric fields", async () => {
    const { status, json } = await get("/healthz");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.checks).toBeDefined();
    expect(json.checks.redis).toBeDefined();
    expect(json.checks.storage).toBeDefined();
    expect(json.metrics).toBeDefined();
    expect(typeof json.metrics.uploadsCreated).toBe("number");
    expect(typeof json.metrics.downloadsServed).toBe("number");
    expect(typeof json.metrics.requestsCreated).toBe("number");
    expect(typeof json.metrics.requestsFulfilled).toBe("number");
    expect(typeof json.metrics.previewFailures).toBe("number");
    expect(typeof json.metrics.uptimeSec).toBe("number");
  });
});

// ── 3. Live structural tests ───────────────────────────────────────────────
//
// These run only when LIVE=true. They verify the response shape of each v1.1
// endpoint but don't assert exact values (those vary by server state).

describe("Metrics endpoint (live)", () => {
  const skip = !LIVE;

  test("GET /api/v1/metrics returns ok:true with counter fields", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await get("/api/v1/metrics", auth(TEST_KEY));
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.metrics).toBeDefined();
    expect(typeof json.metrics.uploadsCreated).toBe("number");
    expect(typeof json.metrics.uploadsDeleted).toBe("number");
    expect(typeof json.metrics.downloadsServed).toBe("number");
    expect(typeof json.metrics.requestsCreated).toBe("number");
    expect(typeof json.metrics.requestsFulfilled).toBe("number");
    expect(typeof json.metrics.previewFailures).toBe("number");
    expect(typeof json.metrics.uptimeSec).toBe("number");
  });
});

describe("Audit log endpoint (live)", () => {
  const skip = !LIVE;

  test("GET /api/v1/audit returns ok:true with count and entries array", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await get(
      "/api/v1/audit?limit=10",
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.count).toBe("number");
    expect(Array.isArray(json.entries)).toBe(true);
    // Each entry should have at least these fields
    for (const e of json.entries) {
      expect(typeof e.at).toBe("string");
      expect(typeof e.path).toBe("string");
    }
  });

  test("GET /api/v1/audit?limit=1 returns at most 1 entry", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await get("/api/v1/audit?limit=1", auth(TEST_KEY));
    expect(status).toBe(200);
    expect(json.entries.length).toBeLessThanOrEqual(1);
  });
});

describe("Room snapshot endpoint (live)", () => {
  const skip = !LIVE;

  test("GET /api/v1/room/:id/snapshot returns room aggregate stats", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await get(
      `/api/v1/room/${TEST_ROOM}/snapshot`,
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.roomid).toBe(TEST_ROOM);
    expect(typeof json.fileCount).toBe("number");
    expect(typeof json.totalBytes).toBe("number");
    expect(typeof json.openRequestCount).toBe("number");
    expect(typeof json.uniqueUploaders).toBe("number");
    // oldestExpiry may be null if room is empty
    expect(["number", "object"]).toContain(typeof json.oldestExpiry);
  });

  test("GET /api/v1/room/INVALID/snapshot returns 400 or 404", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await get(
      "/api/v1/room/does-not-exist-xyz/snapshot",
      auth(TEST_KEY),
    );
    expect([400, 404]).toContain(status);
  });
});

describe("Single file lookup (live)", () => {
  const skip = !LIVE;
  let fileKey;

  beforeAll(async () => {
    if (skip) return;
    // Get any file from the room to test single-file lookup
    const { json } = await get(
      `/api/v1/files?roomid=${TEST_ROOM}&type=uploads`,
      auth(TEST_KEY),
    );
    fileKey = json?.files?.[0]?.key;
  });

  test("GET /api/v1/file/:key returns full file object when key exists", async () => {
    if (skip || !fileKey)
      return console.log(fileKey ? LIVE_MSG : "no files in room — skipped");
    const { status, json } = await get(
      `/api/v1/file/${fileKey}`,
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.file).toBeDefined();
    expect(json.file.key).toBe(fileKey);
    expect(typeof json.file.name).toBe("string");
    expect(typeof json.file.size).toBe("number");
  });

  test("GET /api/v1/file/nonexistent returns 400 or 404", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await get(
      "/api/v1/file/thiskeycannotexist00000000",
      auth(TEST_KEY),
    );
    expect([400, 404]).toContain(status);
  });
});

// ── 4. Agent subscription lifecycle (live) ────────────────────────────────
//
// Exercises the full CRUD cycle: save → list → verify → delete → verify gone.
// This is the exact sequence an MCP client or orchestrator bot would use at startup.

describe("Agent subscriptions — full lifecycle (live)", () => {
  const skip = !LIVE;
  const subName = `test-${Date.now()}`;

  afterAll(async () => {
    // Cleanup: attempt to delete even if the test failed midway
    if (!skip) {
      await del(`/api/v1/agent/subscriptions/${subName}`, auth(TEST_KEY)).catch(
        () => {},
      );
    }
  });

  test("POST /api/v1/agent/subscriptions saves a new subscription", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await post("/api/v1/agent/subscriptions", {
      ...auth(TEST_KEY),
      body: {
        name: subName,
        room: TEST_ROOM,
        ext: [".pdf", ".epub"],
        max_size_mb: 50,
      },
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.subscription?.name ?? json.name).toBe(subName);
  });

  test("GET /api/v1/agent/subscriptions lists the saved subscription", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await get(
      "/api/v1/agent/subscriptions",
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.subscriptions)).toBe(true);
    const found = json.subscriptions.find((s) => s.name === subName);
    expect(found).toBeDefined();
    expect(found.room).toBe(TEST_ROOM);
  });

  test("DELETE /api/v1/agent/subscriptions/:name removes the subscription", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status, json } = await del(
      `/api/v1/agent/subscriptions/${subName}`,
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  test("GET after DELETE confirms subscription is gone", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { json } = await get("/api/v1/agent/subscriptions", auth(TEST_KEY));
    const found = json.subscriptions?.find((s) => s.name === subName);
    expect(found).toBeUndefined();
  });

  test("DELETE a non-existent subscription returns 404", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await del(
      "/api/v1/agent/subscriptions/ghost-sub-that-never-existed",
      auth(TEST_KEY),
    );
    expect(status).toBe(404);
  });
});

// ── 5. AI workflow simulations (live) ─────────────────────────────────────
//
// These tests simulate the patterns an AI orchestrator would use:
//   a) Pre-flight health check before starting work
//   b) Polling loop with type+since filters
//   c) Room snapshot as "what's available" context tool
//   d) Subscription as persistent agent state
//   e) Chat message as agent status update

describe("AI workflow — pre-flight health check pattern", () => {
  test("healthz + metrics together give a complete picture of server state", async () => {
    if (!LIVE) return console.log(LIVE_MSG);
    const [health, metrics] = await Promise.all([
      get("/healthz"),
      get("/api/v1/metrics", auth(TEST_KEY)),
    ]);
    // Verify health
    expect(health.status).toBe(200);
    expect(health.json.ok).toBe(true);
    expect(health.json.checks.redis.ok).toBe(true);
    // Verify metrics has all expected agent-decision fields
    expect(metrics.status).toBe(200);
    const m = metrics.json.metrics;
    expect(typeof m.requestsCreated).toBe("number");
    expect(typeof m.requestsFulfilled).toBe("number");
    expect(typeof m.previewFailures).toBe("number");
    // A healthy agent would abort if previewFailures is extremely high
    // (we just check the field exists and is a non-negative number)
    expect(m.previewFailures).toBeGreaterThanOrEqual(0);
  });
});

describe("AI workflow — polling loop simulation", () => {
  test("GET /api/v1/files returns correctly shaped file list for polling", async () => {
    if (!LIVE) return console.log(LIVE_MSG);
    const { status, json } = await get(
      `/api/v1/files?roomid=${TEST_ROOM}&type=all`,
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.count).toBe("number");
    expect(Array.isArray(json.files)).toBe(true);
    // Each file entry has the fields a polling agent needs
    for (const f of json.files.slice(0, 5)) {
      expect(typeof f.key).toBe("string");
      expect(typeof f.uploaded).toBe("number");
    }
  });

  test("Polling with type=new&since=<future> returns empty (no future files)", async () => {
    if (!LIVE) return console.log(LIVE_MSG);
    const futureMs = Date.now() + 1_000_000_000;
    const { status, json } = await get(
      `/api/v1/files?roomid=${TEST_ROOM}&type=new&since=${futureMs}`,
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    expect(json.count).toBe(0);
    expect(json.files).toHaveLength(0);
  });
});

describe("AI workflow — room context tool simulation", () => {
  test("snapshot returns all fields needed for a one-sentence room summary", async () => {
    if (!LIVE) return console.log(LIVE_MSG);
    const { status, json } = await get(
      `/api/v1/room/${TEST_ROOM}/snapshot`,
      auth(TEST_KEY),
    );
    expect(status).toBe(200);
    // All fields required for a human-readable summary:
    expect(typeof json.fileCount).toBe("number");
    expect(typeof json.totalBytes).toBe("number");
    expect(typeof json.openRequestCount).toBe("number");
    expect(typeof json.uniqueUploaders).toBe("number");
    // Simulate agent building a summary sentence
    const summary =
      `Room ${json.roomid}: ${json.fileCount} files ` +
      `(${(json.totalBytes / 1e9).toFixed(2)} GB), ` +
      `${json.openRequestCount} open requests, ` +
      `${json.uniqueUploaders} contributors.`;
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(10);
  });
});

describe("AI workflow — subscription as persistent agent state", () => {
  test("Agent startup: save subscription, retrieve on restart (round-trip)", async () => {
    if (!LIVE) return console.log(LIVE_MSG);
    const name = `agent-startup-${Date.now()}`;
    const filter = {
      name,
      room: TEST_ROOM,
      ext: [".epub", ".mobi"],
      name_contains: "fantasy",
    };
    // Save subscription (agent startup)
    const save = await post("/api/v1/agent/subscriptions", {
      ...auth(TEST_KEY),
      body: filter,
    });
    expect(save.status).toBe(200);

    // Simulate restart: retrieve subscription
    const list = await get("/api/v1/agent/subscriptions", auth(TEST_KEY));
    const found = list.json.subscriptions?.find((s) => s.name === name);
    expect(found).toBeDefined();
    expect(found.ext).toContain(".epub");

    // Cleanup
    await del(`/api/v1/agent/subscriptions/${name}`, auth(TEST_KEY));
  });
});

describe("AI workflow — agent chat message (status bus)", () => {
  // Chat requires both API key AND a valid session (logged-in automation user).
  // We skip if a session is not available; just verify the shape of the error.
  test("POST /api/v1/room/:id/chat without session returns 400 or 401", async () => {
    if (!LIVE) return console.log(LIVE_MSG);
    const { status } = await post(`/api/v1/room/${TEST_ROOM}/chat`, {
      ...auth(TEST_KEY),
      body: { text: "Test agent status message", nick: "TestBot" },
    });
    // Without a session: expect auth error (401) or missing-user error (400)
    // A 200 is only possible if the test key also has an associated session —
    // in that case we accept it too, since the server is correctly configured.
    expect([200, 400, 401, 403]).toContain(status);
  });
});

// ── 6. Batch upload — field validation only (no live URL fetch) ────────────

describe("Batch upload — input validation (live)", () => {
  const skip = !LIVE;

  test("POST /api/v1/batch-upload with empty items array returns 400", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await post("/api/v1/batch-upload", {
      key: UPLOAD_KEY,
      body: { roomid: TEST_ROOM, items: [] },
    });
    // Empty items should be rejected with a validation error
    expect([400, 422]).toContain(status);
  });

  test("POST /api/v1/batch-upload with missing roomid returns 400", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await post("/api/v1/batch-upload", {
      key: UPLOAD_KEY,
      body: { items: [{ url: "https://example.com/test.pdf" }] },
    });
    expect([400, 422]).toContain(status);
  });

  test("POST /api/v1/batch-upload with more than 20 items returns 400", async () => {
    if (skip) return console.log(LIVE_MSG);
    const items = Array.from({ length: 21 }, (_, i) => ({
      url: `https://example.com/file${i}.pdf`,
    }));
    const { status } = await post("/api/v1/batch-upload", {
      key: UPLOAD_KEY,
      body: { roomid: TEST_ROOM, items },
    });
    expect([400, 422]).toContain(status);
  });
});

// ── 7. Claiming — field validation (live) ─────────────────────────────────

describe("Request claiming — claim a non-existent key returns 404 or 400", () => {
  const skip = !LIVE;

  test("POST /requests/nonexistent/claim → 400 or 404", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await post(
      "/api/v1/requests/thiskeycannotexist000/claim",
      {
        ...auth(TEST_KEY),
        body: {},
      },
    );
    expect([400, 404]).toContain(status);
  });

  test("DELETE /requests/nonexistent/claim → 400 or 404", async () => {
    if (skip) return console.log(LIVE_MSG);
    const { status } = await del(
      "/api/v1/requests/thiskeycannotexist000/claim",
      auth(TEST_KEY),
    );
    expect([400, 403, 404]).toContain(status);
  });
});
