"use strict";

// Exercise the real SDK and transport, including schema validation. No live
// Dicefiles API, private configuration, or Redis is needed for these tests.
const http = require("http");
const { PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } = require("@modelcontextprotocol/server");
const { createHttpServer } = require("../../scripts/mcp-server");

const meta = {
  [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
  [CLIENT_INFO_META_KEY]: { name: "dicefiles-test", version: "1.0.0" },
  [CLIENT_CAPABILITIES_META_KEY]: {},
};

describe("stateless MCP HTTP", () => {
  let httpServer;
  let handler;
  let base;
  const token = "test-mcp-token";
  const headers = {
    "authorization": `Bearer ${token}`,
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2026-07-28",
  };

  beforeAll(async () => {
    ({ httpServer, handler } = createHttpServer({ authToken: token }));
    await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${httpServer.address().port}`;
  });
  afterAll(async () => {
    await handler.close();
    httpServer.closeAllConnections();
    await new Promise(resolve => httpServer.close(resolve));
  });

  function post(method, params = {}, extra = {}) {
    return fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...headers, "Mcp-Method": method, ...extra },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
    });
  }

  test("lists every tool without initialization or session state", async () => {
    const res = await post("tools/list");
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const data = await res.json();
    expect(data.result.tools).toHaveLength(57);
    expect(data.result.tools.find(t => t.name === "post_room_chat").annotations.idempotentHint).toBe(false);
    const repeated = await post("tools/list");
    expect((await repeated.json()).result.tools).toHaveLength(57);
  });

  test("rejects malformed tool inputs through the real Zod schemas", async () => {
    const res = await post("tools/call", {
      name: "download_file", arguments: { key: "fake", maxBytes: -1 },
    }, { "Mcp-Name": "download_file" });
    const data = await res.json();
    expect(data.error || data.result?.isError).toBeTruthy();
  });

  test("serves older clients through stateless HTTP fallback", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST", headers: { ...headers, "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-test", version: "1.0.0" },
      } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    await res.text();
  });

  test("requires a matching bearer token before invoking MCP", async () => {
    const res = await post("tools/list", {}, { authorization: "Bearer wrong" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  test("rejects hostile browser origins", async () => {
    const res = await post("tools/list", {}, { origin: "https://hostile.example" });
    expect(res.status).toBe(403);
  });

  test("rejects DNS rebinding hostnames before invoking MCP", async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/mcp`, { method: "POST", headers: {
        ...headers, "host": "hostile.example", "Mcp-Method": "tools/list",
      } }, res => {
        res.resume(); resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    });
    expect(status).toBe(403);
  });

  test("rejects oversized request bodies at the adapter boundary", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers,
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  test("fails closed on remote binds without an explicit host allowlist or token", () => {
    expect(() => createHttpServer({ host: "0.0.0.0", authToken: "", allowedHosts: [] })).toThrow(/MCP_AUTH_TOKEN/);
    expect(() => createHttpServer({ host: "0.0.0.0", authToken: token, allowedHosts: [] })).toThrow(/MCP_ALLOWED_HOSTS/);
  });

  test("accepts an explicitly configured reverse proxy hostname", async () => {
    const remote = createHttpServer({ host: "0.0.0.0", authToken: token, allowedHosts: ["mcp.example.test"] });
    try {
      await new Promise(resolve => remote.httpServer.listen(0, "127.0.0.1", resolve));
      const status = await new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${remote.httpServer.address().port}/mcp`, {
          method: "POST", headers: { ...headers, "host": "mcp.example.test", "Mcp-Method": "tools/list" },
        }, res => {
          res.resume(); resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }));
      });
      expect(status).toBe(200);
    }
    finally {
      await remote.handler.close();
      remote.httpServer.closeAllConnections();
      await new Promise(resolve => remote.httpServer.close(resolve));
    }
  });
});
