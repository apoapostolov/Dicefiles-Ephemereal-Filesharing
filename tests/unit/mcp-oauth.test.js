"use strict";

const { PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } = require("@modelcontextprotocol/server");

const meta = { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_INFO_META_KEY]: { name: "oauth-test", version: "1.0" }, [CLIENT_CAPABILITIES_META_KEY]: {} };
const { createHttpServer } = require("../../scripts/mcp-server");

describe("MCP OAuth caller isolation", () => {
  let httpServer;
  let handler;
  let base;
  let jose;
  let privateKey;
  let publicKey;
  const issuer = "https://identity.example/";
  const resource = "https://mcp.example/mcp";
  const config = { issuer, resource, principals: {
    charlie: { apiKey: "synthetic-charlie-key", scopes: ["mcp", "files:read"] },
    alice: { apiKey: "synthetic-alice-key", scopes: ["mcp", "files:read"] },
    bob: { apiKey: "synthetic-bob-key", scopes: ["mcp", "requests:write"] },
  } };

  async function token(subject, scope, audience = resource, expiration = "5m") {
    return new jose.SignJWT({ scope }).setProtectedHeader({ alg: "ES256" }).setSubject(subject).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  }

  async function rpc(accessToken, method, params = {}) {
    return fetch(`${base}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", "authorization": `Bearer ${accessToken}`, "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...(params.name ? { "Mcp-Name": params.name } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
    });
  }

  beforeAll(async () => {
    jose = await import("jose");
    ({ privateKey, publicKey } = await jose.generateKeyPair("ES256"));
    ({ httpServer, handler } = createHttpServer({ oauth: config, oauthOptions: { keySet: async () => publicKey } }));
    await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${httpServer.address().port}`;
  });
  afterAll(async () => {
    await handler.close(); httpServer.closeAllConnections();
    await new Promise(resolve => httpServer.close(resolve));
  });
  test("serves public discovery and challenges unauthenticated callers", async () => {
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect((await metadata.json()).resource).toBe(resource);
    const response = await rpc("invalid", "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  });
  test("rejects wrong audiences, expired tokens and unmapped subjects", async () => {
    for (const accessToken of [await token("alice", "mcp", "https://other.example/mcp"), await token("alice", "mcp", resource, "-10m"), await token("unknown", "mcp")]) {
      expect((await rpc(accessToken, "tools/list")).status).toBe(401);
    }
    expect((await rpc(await token("alice", "files:read"), "tools/list")).status).toBe(403);
  });
  test("filters the tool catalog separately for concurrent callers", async () => {
    const tokens = [await token("alice", "mcp files:read requests:write"), await token("bob", "mcp files:read requests:write")];
    const responses = await Promise.all(tokens.map(value => rpc(value, "tools/list")));
    const catalogs = await Promise.all(responses.map(response => response.json()));
    const alice = catalogs[0].result.tools.map(tool => tool.name);
    const bob = catalogs[1].result.tools.map(tool => tool.name);
    expect(alice).toContain("list_files"); expect(alice).not.toContain("claim_request");
    expect(bob).toContain("claim_request"); expect(bob).not.toContain("list_files");
  }); test("forwards each caller's mapped API key without passing OAuth tokens upstream", async () => {
    const nativeFetch = global.fetch;
    const authorizations = [];
    const mock = jest.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      if (String(url).startsWith("http://localhost:10005/api/v1/files")) {
        authorizations.push(init.headers.Authorization);
        return new Response(JSON.stringify({ ok: true, files: [] }));
      }
      return nativeFetch(url, init);
    });
    try {
      const tokens = [await token("alice", "mcp files:read"), await token("charlie", "mcp files:read")];
      const replies = await Promise.all(tokens.map(value => rpc(value, "tools/call", { name: "list_files", arguments: { roomid: "synthetic-room" } })));
      for (const reply of replies) {
        expect((await reply.json()).result.structuredContent.ok).toBe(true);
      }
      expect(authorizations.sort()).toEqual(["Bearer synthetic-alice-key", "Bearer synthetic-charlie-key"]);
    }
    finally {
      mock.mockRestore();
    }
  });
});
