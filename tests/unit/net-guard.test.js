"use strict";

/**
 * Unit tests for lib/net-guard.js
 *
 * Coverage:
 *   - isPrivateIp()            — loopback, private, link-local, CGNAT, IPv6
 *   - validateOutboundUrl()    — scheme, credentials, private destinations
 *   - pinnedLookup()           — the socket can only reach the validated address
 *   - guardedFetch()           — request path, redirect following, caps, timeout
 *
 * The request-path tests use a throwaway HTTP server on 127.0.0.1 and pass
 * `allowPrivate` so the guard permits the loopback destination. No test reaches
 * the public internet.
 */

const http = require("http");
const {
  NetGuardError,
  isPrivateIp,
  validateOutboundUrl,
  pinnedLookup,
  guardedFetch,
} = require("../../lib/net-guard");

// ── isPrivateIp ──────────────────────────────────────────────────────────────

describe("isPrivateIp", () => {
  test.each([
    ["127.0.0.1", true],
    ["127.10.20.30", true],
    ["10.0.0.5", true],
    ["172.16.4.4", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["0.0.0.0", true],
    ["100.64.0.1", true],
    ["::1", true],
    ["::", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["::ffff:127.0.0.1", true],
    ["not-an-address", true],
    ["172.32.0.1", false],
    ["100.63.255.255", false],
    ["93.184.216.34", false],
    ["2606:2800:220:1:248:1893:25c8:1946", false],
  ])("%s -> %s", (address, expected) => {
    expect(isPrivateIp(address)).toBe(expected);
  });
});

// ── validateOutboundUrl ──────────────────────────────────────────────────────

describe("validateOutboundUrl", () => {
  test.each([
    ["file:///etc/passwd", "DESTINATION_BLOCKED"],
    ["gopher://example.com", "DESTINATION_BLOCKED"],
    ["http://user:pass@example.com/", "DESTINATION_BLOCKED"],
    ["not a url", "DESTINATION_INVALID"],
  ])("refuses %s", async (raw, code) => {
    await expect(validateOutboundUrl(raw)).rejects.toMatchObject({ code });
  });

  test.each([
    "http://127.0.0.1/",
    "http://localhost:6379/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/",
    "http://[::1]/",
  ])("refuses the private destination %s", async raw => {
    await expect(validateOutboundUrl(raw)).rejects.toMatchObject({
      code: "DESTINATION_BLOCKED",
    });
  });

  test("reports a name that does not resolve", async () => {
    await expect(
      validateOutboundUrl("http://dicefiles.invalid./x"),
    ).rejects.toMatchObject({ code: "DESTINATION_UNAVAILABLE" });
  });

  test("keeps the parsed url and the address it pinned", async () => {
    const target = await validateOutboundUrl(
      "http://127.0.0.1:9/x",
      { allowPrivate: true },
    );
    expect(target.url.pathname).toBe("/x");
    expect(target.address).toEqual({ address: "127.0.0.1", family: 4 });
  });
});

// ── pinnedLookup ─────────────────────────────────────────────────────────────

describe("pinnedLookup", () => {
  test("answers with the pinned address whatever the hostname is", done => {
    const lookup = pinnedLookup({ address: "203.0.113.9", family: 4 });
    lookup("evil.example", {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe("203.0.113.9");
      expect(family).toBe(4);
      done();
    });
  });

  test("honours an all-addresses lookup", done => {
    const lookup = pinnedLookup({ address: "203.0.113.9", family: 4 });
    lookup("evil.example", { all: true }, (err, addresses) => {
      expect(err).toBeNull();
      expect(addresses).toEqual([{ address: "203.0.113.9", family: 4 }]);
      done();
    });
  });
});

// ── guardedFetch ─────────────────────────────────────────────────────────────

describe("guardedFetch", () => {
  let server;
  let base;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/final" });
        res.end();
        return;
      }
      if (req.url === "/slow") {
        setTimeout(() => {
          res.writeHead(200);
          res.end("late");
        }, 3000).unref();
        return;
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(Buffer.alloc(64 * 1024, 0x41));
        return;
      }
      if (req.url === "/no-content") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === "/echo-auth") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(req.headers.authorization || "none");
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test("returns a Response for an allowed destination", async () => {
    const res = await guardedFetch(`${base}/hello`, {}, { allowPrivate: true });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("refuses the same destination without the private-network opt-in", async () => {
    await expect(guardedFetch(`${base}/hello`)).rejects.toMatchObject({
      code: "DESTINATION_BLOCKED",
    });
  });

  test("follows a redirect it re-validated", async () => {
    const res = await guardedFetch(`${base}/redirect`, {}, { allowPrivate: true });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("stops after the redirect budget", async () => {
    await expect(
      guardedFetch(`${base}/redirect`, {}, { allowPrivate: true, maxRedirects: 0 }),
    ).resolves.toMatchObject({ status: 302 });
  });

  test("hands back a null body for a 204", async () => {
    const res = await guardedFetch(
      `${base}/no-content`,
      {},
      { allowPrivate: true },
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("stops a response that outgrows the byte cap", async () => {
    await expect(
      guardedFetch(`${base}/big`, {}, { allowPrivate: true, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  test("gives up on a request that outlasts the timeout", async () => {
    await expect(
      guardedFetch(`${base}/slow`, {}, { allowPrivate: true, timeoutMs: 200 }),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
  });

  test("keeps the authorization header on the first hop", async () => {
    const res = await guardedFetch(
      `${base}/echo-auth`,
      { headers: { authorization: "Bearer test" } },
      { allowPrivate: true },
    );
    expect(await res.text()).toBe("Bearer test");
  });

  test("surfaces a refused connection as a guard error", async () => {
    const closed = http.createServer();
    await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve));
    const port = closed.address().port;
    await new Promise(resolve => closed.close(resolve));
    await expect(
      guardedFetch(
        `http://127.0.0.1:${port}/hello`,
        {},
        { allowPrivate: true, timeoutMs: 2000 },
      ),
    ).rejects.toBeInstanceOf(NetGuardError);
  });
});
