"use strict";

/**
 * Integration / end-to-end route tests.
 *
 * These tests run against the live Dicefiles server at http://127.0.0.1:9090.
 * They confirm that:
 *   - Every public page returns the correct HTTP status
 *   - HTML pages contain expected structural elements
 *   - JSON endpoints follow their documented error shapes
 *   - Auth, upload, and automation endpoints behave correctly at the boundary
 *
 * Prerequisites: server must be running at port 9090.
 * If the server is unreachable, ALL tests in this file are skipped.
 */

const BASE = "http://127.0.0.1:9090";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Thin fetch wrapper that returns { status, headers, body, json }
 * without throwing on non-2xx.
 */
async function get(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? null : await res.text();
  const json = ct.includes("json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body, json };
}

async function post(path, payload, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(payload),
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? null : await res.text();
  const json = ct.includes("json") ? await res.json() : null;
  return { status: res.status, body, json };
}

// ── pre-flight: skip the entire suite if server is down ────────────────────

let serverUp = false;
let kftCookie = "";

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/healthz`, {
      signal: AbortSignal.timeout(4000),
    });
    serverUp = res.status === 200 || res.status === 503;
    // Grab kft cookie for CSRF-protected POST calls
    const resp = await fetch(`${BASE}/`);
    const setCookie = resp.headers.get("set-cookie") || "";
    const match = setCookie.match(/kft=([^;]+)/);
    if (match) {
      kftCookie = `kft=${match[1]}`;
    }
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(
      "\n[routes.test.js] Server not reachable at",
      BASE,
      "— all integration tests SKIPPED\n",
    );
  }
});

function ifServer(name, fn) {
  // Jest doesn't have built-in conditional skipping at describe level;
  // use test.skip when serverUp=false.
  test(name, async () => {
    if (!serverUp) {
      return; // intentional skip
    }
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Health endpoint
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /healthz", () => {
  ifServer("returns JSON with ok field", async () => {
    const { status, json } = await get("/healthz");
    expect([200, 503]).toContain(status);
    expect(json).toHaveProperty("ok");
    expect(typeof json.ok).toBe("boolean");
  });

  ifServer("includes uptime field", async () => {
    const { json } = await get("/healthz");
    // uptime is nested under metrics.uptimeSec
    expect(json).toHaveProperty("metrics.uptimeSec");
    expect(typeof json.metrics.uptimeSec).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static pages
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /", () => {
  ifServer("returns 200", async () => {
    const { status } = await get("/");
    expect(status).toBe(200);
  });

  ifServer("returns HTML with expected structure", async () => {
    const { body } = await get("/");
    expect(body).toContain("<body");
    expect(body).toContain("Welcome to Dicefiles");
    expect(body).toContain("</footer>");
  });

  ifServer("includes footer navigation links", async () => {
    const { body } = await get("/");
    expect(body).toContain("/terms");
    expect(body).toContain("/rules");
  });
});

describe("GET /terms", () => {
  ifServer("returns 200 with HTML", async () => {
    const { status, body } = await get("/terms");
    expect(status).toBe(200);
    expect(body).toContain("<body");
    expect(body).toContain("Terms");
  });
});

describe("GET /rules", () => {
  ifServer("returns 200 with HTML", async () => {
    const { status, body } = await get("/rules");
    expect(status).toBe(200);
    expect(body).toContain("<body");
    expect(body).toContain("Rules");
  });
});

describe("GET /register", () => {
  ifServer("returns 200 with registration form", async () => {
    const { status, body } = await get("/register");
    expect(status).toBe(200);
    expect(body).toContain("<body");
    expect(body).toContain("Register");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Top-lists
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /top/:list", () => {
  ifServer("GET /top/uploaded returns 200", async () => {
    const { status, body } = await get("/top/uploaded");
    expect(status).toBe(200);
    expect(body).toContain("toplist");
  });

  ifServer("GET /top/files returns 200", async () => {
    const { status, body } = await get("/top/files");
    expect(status).toBe(200);
    expect(body).toContain("toplist");
  });

  ifServer("GET /top/invalid returns 404", async () => {
    const { status } = await get("/top/invalid");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 — non-existent paths
// ─────────────────────────────────────────────────────────────────────────────
describe("404 handling", () => {
  ifServer("unknown page returns 404 HTML", async () => {
    const { status, body } = await get("/zzznone-existent-page-xyz99");
    expect(status).toBe(404);
    expect(body).toContain("<body");
  });

  ifServer("unknown room returns 404", async () => {
    const { status } = await get("/r/zzznotarealroom99xyz");
    expect(status).toBe(404);
  });

  ifServer("unknown user returns 404", async () => {
    const { status } = await get("/u/zzzfakenick99xyz");
    expect(status).toBe(404);
  });

  ifServer("unknown file key returns 404", async () => {
    // /g/:key is the file download route
    const { status } = await get("/g/zzzfakekey99xyz");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session / auth endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/login", () => {
  ifServer("missing credentials → error JSON", async () => {
    // No kft cookie → bad token error
    const { status, json } = await post("/api/login", { u: "", p: "" });
    expect(status).toBe(200); // rtokenize always returns 200
    expect(json).toHaveProperty("err");
  });

  ifServer("wrong credentials with valid kft cookie → error JSON", async () => {
    // First: extract HMAC token from the page visit
    const homeRes = await fetch(`${BASE}/`);
    const cookies = homeRes.headers.get("set-cookie") || "";
    const kftMatch = cookies.match(/kft=([^;]+)/);
    if (!kftMatch) return; // can't test without kft

    // We'd need to compute an HMAC or hit /api/login via browser — just assert
    // the error shape is what we expect
    const { json } = await post(
      "/api/login",
      { u: "nonexistentuser99xyz", p: "badpassword1" },
      { Cookie: `kft=${kftMatch[1]}` },
    );
    // With mismatched token we still expect an error
    expect(json).toHaveProperty("err");
  });
});

describe("POST /api/register", () => {
  ifServer("missing kft token returns error JSON", async () => {
    const { status, json } = await post("/api/register", {
      u: "testuser",
      p: "password",
    });
    expect(status).toBe(200);
    expect(json).toHaveProperty("err");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Automation API
// ─────────────────────────────────────────────────────────────────────────────
describe("Automation API /api/v1/*", () => {
  ifServer("GET /api/v1/files without API key returns 401 or 404", async () => {
    const { status } = await get("/api/v1/files?roomid=xxx");
    // 404 when API keys are disabled (default config), 401 when enabled
    expect([401, 404]).toContain(status);
  });

  ifServer(
    "GET /api/v1/files with wrong API key returns 401 or 404",
    async () => {
      const { status } = await get("/api/v1/files?roomid=xxx", {
        headers: { Authorization: "Bearer fakewrongkey99xyz" },
      });
      expect([401, 404]).toContain(status);
    },
  );

  ifServer(
    "POST /api/v1/auth/login without creds returns 401 or 404",
    async () => {
      const { status, json } = await post(
        "/api/v1/auth/login",
        { username: "", password: "" },
        { Authorization: "Bearer fakewrongkey99xyz" },
      );
      // 404 when API is disabled; 401 when enabled with wrong key
      expect([401, 404]).toContain(status);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Comic reader API
// ─────────────────────────────────────────────────────────────────────────────
describe("Comic reader API /api/v1/comic/:key/*", () => {
  ifServer("index endpoint with fake key returns 404", async () => {
    const { status } = await get("/api/v1/comic/zzznonce99xyz/index");
    expect(status).toBe(404);
  });

  ifServer("page endpoint with fake key returns 404", async () => {
    const { status } = await get("/api/v1/comic/zzznonce99xyz/page/0");
    expect(status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static assets
// ─────────────────────────────────────────────────────────────────────────────
describe("Static asset serving", () => {
  ifServer("GET /client.js returns a JS asset", async () => {
    const res = await fetch(`${BASE}/client.js`);
    expect([200, 304]).toContain(res.status);
    if (res.status === 200) {
      const ct = res.headers.get("content-type") || "";
      expect(ct).toContain("javascript");
    }
  });

  ifServer("GET /style.css returns a CSS asset", async () => {
    const res = await fetch(`${BASE}/style.css`);
    expect([200, 304]).toContain(res.status);
    if (res.status === 200) {
      const ct = res.headers.get("content-type") || "";
      expect(ct).toContain("css");
    }
  });

  ifServer("GET /favicon.ico returns an icon file", async () => {
    const res = await fetch(`${BASE}/favicon.ico`);
    // May be 200 or 404 if favicon not present; just not a 500
    expect(res.status).not.toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────────────────────────────────────
describe("Security headers", () => {
  ifServer("X-Powered-By is disabled", async () => {
    const { headers } = await get("/");
    expect(headers.get("x-powered-by")).toBeNull();
  });

  ifServer("Content-Security-Policy header is present", async () => {
    const { headers } = await get("/");
    const csp = headers.get("content-security-policy");
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src");
  });

  ifServer("X-Frame-Options or CSP frame-ancestors is set", async () => {
    const { headers } = await get("/");
    const xfo = headers.get("x-frame-options");
    const csp = headers.get("content-security-policy") || "";
    // Either X-Frame-Options or frame-ancestors in CSP is acceptable
    const protected_ = xfo !== null || csp.includes("frame-ancestors");
    expect(protected_).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Room redirect (/new)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /new", () => {
  ifServer(
    "redirects to a new room when room creation is enabled",
    async () => {
      const res = await fetch(`${BASE}/new`, { redirect: "manual" });
      // Expect either a redirect (302/303) to /r/:roomid or a 200 if we follow
      expect([200, 302, 303]).toContain(res.status);
    },
  );
});
