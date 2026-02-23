"use strict";
/**
 * tests/unit/mcp-tools.test.js
 *
 * Unit tests for scripts/mcp-server.js
 *
 * Strategy:
 *  - All external deps (@modelcontextprotocol/sdk, zod) are mocked so the
 *    test suite runs without those packages being installed.
 *  - global.fetch is replaced with a jest.fn() before each test.
 *  - registerTools() is called with a lightweight mock McpServer that captures
 *    each tool's handler keyed by name.
 *  - Each handler is invoked directly and its return value is asserted.
 */

// ── Mock @modelcontextprotocol/sdk before any require() ──────────────────────
jest.mock(
  "@modelcontextprotocol/sdk/server/mcp.js",
  () => ({
    McpServer: class MockMcpServer {
      constructor(meta) {
        this.meta = meta;
      }
      tool(name, desc, schema, handler) {
        // captured by mock server in registerTools tests
      }
      connect() {
        return Promise.resolve();
      }
    },
  }),
  { virtual: true },
);

jest.mock(
  "@modelcontextprotocol/sdk/server/stdio.js",
  () => ({
    StdioServerTransport: class MockStdio {},
  }),
  { virtual: true },
);

// ── Mock zod — schemas are only used at registration time, not in handlers ──
jest.mock(
  "zod",
  () => {
    const chain = () => {
      const o = {
        optional: () => o,
        min: () => o,
        max: () => o,
        url: () => o,
        describe: () => o,
        default: () => o,
      };
      return o;
    };
    return {
      z: {
        string: chain,
        number: chain,
        array: () => chain(),
        object: () => chain(),
        enum: () => chain(),
      },
    };
  },
  { virtual: true },
);

// ── Set env before loading module ─────────────────────────────────────────────
process.env.DICEFILES_BASE_URL = "http://test.dicefiles.local";
process.env.DICEFILES_API_KEY = "test-key-abc";

// ── Load module under test ────────────────────────────────────────────────────
const { registerTools } = require("../../scripts/mcp-server");

// ── Helper: capture all registered tool handlers ─────────────────────────────
function buildToolMap() {
  const tools = {};
  const mockServer = {
    tool: (name, _desc, _schema, handler) => {
      tools[name] = handler;
    },
  };
  registerTools(mockServer);
  return tools;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Build a mock fetch response */
function mockFetchJson(json, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
    headers: {
      get: () => null,
    },
    arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(json))),
  });
}

/** Parse the MCP content block back to an object */
function parseResult(result) {
  expect(result).toHaveProperty("content");
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content[0]).toHaveProperty("type", "text");
  return JSON.parse(result.content[0].text);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("registerTools", () => {
  it("registers exactly 14 tools", () => {
    const tools = buildToolMap();
    expect(Object.keys(tools)).toHaveLength(14);
  });

  it("registers every expected tool name", () => {
    const tools = buildToolMap();
    const expected = [
      "server_health",
      "list_files",
      "get_file",
      "get_room_snapshot",
      "update_file_metadata",
      "upload_file_from_urls",
      "create_request",
      "claim_request",
      "release_request",
      "post_room_chat",
      "download_file",
      "save_subscription",
      "list_subscriptions",
      "archive_list_contents",
    ];
    for (const name of expected) {
      expect(tools).toHaveProperty(name);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("server_health", () => {
  it("calls GET /healthz without api prefix and wraps response", async () => {
    const tools = buildToolMap();
    const payload = { ok: true, checks: { redis: { ok: true } }, metrics: {} };
    global.fetch = mockFetchJson(payload);

    const result = await tools.server_health({});
    const data = parseResult(result);

    expect(data).toEqual(payload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toMatch(/http:\/\/test\.dicefiles\.local\/healthz/);
    // healthz must NOT go through /api/v1
    expect(url).not.toContain("/api/v1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("list_files", () => {
  it("builds the correct query string for a simple call", async () => {
    const tools = buildToolMap();
    const payload = { ok: true, files: [] };
    global.fetch = mockFetchJson(payload);

    await tools.list_files({ roomid: "Abc123" });

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/files");
    expect(url).toContain("roomid=Abc123");
    expect(url).toContain("type=all"); // default injected
  });

  it("includes optional filters when provided", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, files: [] });

    await tools.list_files({
      roomid: "Abc123",
      type: "new",
      since: 1700000000000,
      name_contains: "neuromancer",
      ext: "epub,mobi",
    });

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("type=new");
    expect(url).toContain("since=1700000000000");
    expect(url).toContain("name_contains=neuromancer");
    expect(url).toContain("ext=epub%2Cmobi");
  });

  it("sends Authorization header with api key", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, files: [] });

    await tools.list_files({ roomid: "Abc123" });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers).toHaveProperty("Authorization", "Bearer test-key-abc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("get_file", () => {
  it("calls GET /api/v1/file/:key", async () => {
    const tools = buildToolMap();
    const filePayload = { ok: true, file: { key: "xyz", name: "test.epub" } };
    global.fetch = mockFetchJson(filePayload);

    const result = await tools.get_file({ key: "xyz" });
    const data = parseResult(result);

    expect(data).toEqual(filePayload);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/file/xyz");
    expect(global.fetch.mock.calls[0][1].method).toBe("GET");
  });

  it("URL-encodes keys with special chars", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, file: {} });
    await tools.get_file({ key: "a/b c" });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/file/a%2Fb%20c");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("get_room_snapshot", () => {
  it("calls GET /api/v1/room/:roomid/snapshot", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, fileCount: 5 });
    await tools.get_room_snapshot({ roomid: "Room99" });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/room/Room99/snapshot");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("update_file_metadata", () => {
  it("calls PATCH /api/v1/file/:key with body", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, key: "abc", hash: "sha512" });

    await tools.update_file_metadata({
      key: "abc",
      meta: { ai_caption: "A noir novel." },
      tags: { author: "Gibson" },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/file/abc");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(body.meta.ai_caption).toBe("A noir novel.");
    expect(body.tags.author).toBe("Gibson");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("upload_file_from_urls", () => {
  it("calls POST /api/v1/batch-upload with items array", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, results: [] });

    await tools.upload_file_from_urls({
      roomid: "Abc123",
      urls: ["https://example.com/a.pdf", "https://example.com/b.epub"],
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/batch-upload");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.roomid).toBe("Abc123");
    expect(body.items).toHaveLength(2);
    expect(body.items[0].url).toBe("https://example.com/a.pdf");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("create_request", () => {
  it("calls POST /api/v1/requests with full body", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, request: {} });

    await tools.create_request({
      roomid: "Room1",
      text: "Upload D&D Player Handbook",
      url: "https://dndshop.com/phb",
      hints: { type: "document", keywords: ["D&D", "RPG"] },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/requests");
    const body = JSON.parse(init.body);
    expect(body.text).toBe("Upload D&D Player Handbook");
    expect(body.hints.type).toBe("document");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("claim_request", () => {
  it("calls POST /api/v1/requests/:key/claim with ttlMs default", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, key: "req1", claimedUntil: 9999 });

    await tools.claim_request({ key: "req1" });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/requests/req1/claim");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.ttlMs).toBe(300000); // default 5 min
  });

  it("uses provided ttlMs when given", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, key: "req2", claimedUntil: 9999 });
    await tools.claim_request({ key: "req2", ttlMs: 60000 });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.ttlMs).toBe(60000);
  });

  it("returns 409 payload when already claimed", async () => {
    const tools = buildToolMap();
    const errPayload = { err: "already_claimed" };
    global.fetch = mockFetchJson(errPayload, 409);

    const result = await tools.claim_request({ key: "req3" });
    const data = parseResult(result);
    expect(data.err).toBe("already_claimed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("release_request", () => {
  it("calls DELETE /api/v1/requests/:key/claim", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, key: "req1" });

    await tools.release_request({ key: "req1" });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/requests/req1/claim");
    expect(init.method).toBe("DELETE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("post_room_chat", () => {
  it("calls POST /api/v1/room/:roomid/chat with text and optional nick", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true });

    await tools.post_room_chat({
      roomid: "Chat1",
      text: "Processing upload...",
      nick: "ScribeBot",
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/room/Chat1/chat");
    const body = JSON.parse(init.body);
    expect(body.text).toBe("Processing upload...");
    expect(body.nick).toBe("ScribeBot");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("download_file", () => {
  it("returns base64 content for small files", async () => {
    const tools = buildToolMap();
    const fileContent = Buffer.from("hello world");
    // Use slice to get a properly-sized standalone ArrayBuffer (not pooled)
    const ab = fileContent.buffer.slice(
      fileContent.byteOffset,
      fileContent.byteOffset + fileContent.byteLength,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name) => {
          if (name === "content-type") return "text/plain";
          if (name === "content-disposition")
            return 'attachment; filename="hello.txt"';
          return null;
        },
      },
      arrayBuffer: () => Promise.resolve(ab),
    });

    const result = await tools.download_file({ key: "hello99" });
    const data = parseResult(result);

    expect(data.ok).toBe(true);
    expect(data.filename).toBe("hello.txt");
    expect(data.contentType).toBe("text/plain");
    expect(data.sizeBytes).toBe(fileContent.length);
    expect(data.content_base64).toBe(fileContent.toString("base64"));
  });

  it("rejects files exceeding maxBytes", async () => {
    const tools = buildToolMap();
    const bigFile = Buffer.alloc(100);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(bigFile.buffer),
    });

    const result = await tools.download_file({ key: "big99", maxBytes: 10 });
    const data = parseResult(result);

    expect(data.ok).toBe(false);
    expect(data.err).toMatch(/exceeds maxBytes/);
    expect(data.sizeBytes).toBe(100);
  });

  it("returns error response for non-200 HTTP status", async () => {
    const tools = buildToolMap();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const result = await tools.download_file({ key: "notfound" });
    const data = parseResult(result);
    expect(data.ok).toBe(false);
    expect(data.err).toContain("404");
  });

  it("calls /g/:key endpoint (not /api/v1)", async () => {
    const tools = buildToolMap();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(Buffer.from("x").buffer),
    });
    await tools.download_file({ key: "abc" });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/g/abc");
    expect(url).not.toContain("/api/v1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("save_subscription", () => {
  it("calls POST /api/v1/agent/subscriptions with full payload", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, id: "sub-1" });

    await tools.save_subscription({
      name: "epub-watcher",
      room: "Books",
      ext: [".epub", ".mobi"],
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/agent/subscriptions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("epub-watcher");
    expect(body.ext).toEqual([".epub", ".mobi"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("list_subscriptions", () => {
  it("calls GET /api/v1/agent/subscriptions", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, subscriptions: [] });

    await tools.list_subscriptions({});

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/agent/subscriptions");
    expect(init.method).toBe("GET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

describe("archive_list_contents", () => {
  it("calls GET /api/v1/archive/:key/ls", async () => {
    const tools = buildToolMap();
    const payload = { ok: true, entries: [] };
    global.fetch = mockFetchJson(payload);

    const result = await tools.archive_list_contents({ key: "zip99" });
    const data = parseResult(result);

    expect(data).toEqual(payload);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/archive/zip99/ls");
    expect(init.method).toBe("GET");
  });

  it("URL-encodes keys with special chars", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, entries: [] });
    await tools.archive_list_contents({ key: "a/b c" });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("/api/v1/archive/a%2Fb%20c/ls");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("authentication boundary", () => {
  it("sends Authorization header on all api() calls", async () => {
    const tools = buildToolMap();
    // Use get_room_snapshot as a representative api() consumer
    global.fetch = mockFetchJson({ ok: true, fileCount: 0 });
    await tools.get_room_snapshot({ roomid: "R1" });
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers).toHaveProperty("Authorization", "Bearer test-key-abc");
  });

  it("wraps all JSON responses as MCP content blocks", async () => {
    const tools = buildToolMap();
    global.fetch = mockFetchJson({ ok: true, custom: 42 });
    const result = await tools.list_subscriptions({});
    expect(result.content[0].type).toBe("text");
    const data = JSON.parse(result.content[0].text);
    expect(data.custom).toBe(42);
  });
});
