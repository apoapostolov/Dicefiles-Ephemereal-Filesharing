"use strict";
/**
 * scripts/mcp-server.js — Dicefiles MCP server wrapper
 *
 * Wraps the Dicefiles REST API as 20 MCP tools, allowing any MCP-compatible
 * AI client (Claude Desktop, Cursor, Continue, OpenClaw, AutoGen) to interact with
 * a Dicefiles instance directly.
 *
 * Usage (stdio — Claude Desktop, Cursor, local agents):
 *   node scripts/mcp-server.js
 *
 * Usage (HTTP — remote orchestrators):
 *   MCP_TRANSPORT=http MCP_PORT=3001 node scripts/mcp-server.js
 *
 * Required env vars:
 *   DICEFILES_BASE_URL   Base URL of your Dicefiles instance (default: http://localhost:9090)
 *   DICEFILES_API_KEY    Automation API key (minimum scope: files:read)
 *
 * Optional env vars:
 *   MCP_TRANSPORT        "stdio" (default) | "http"
 *   MCP_PORT             HTTP port when MCP_TRANSPORT=http (default: 3001)
 *
 * Dependencies:
 *   @modelcontextprotocol/sdk  ≥1.6.0
 *   zod                        ^3
 *
 * Install: npm install @modelcontextprotocol/sdk zod
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// ── Configuration ──────────────────────────────────────────────────────────

const BASE = (
  process.env.DICEFILES_BASE_URL || "http://localhost:9090"
).replace(/\/+$/, "");
const KEY = process.env.DICEFILES_API_KEY || "";

if (!KEY) {
  console.error(
    "[dicefiles-mcp] WARNING: DICEFILES_API_KEY is not set. " +
      "Most tools require an API key and will return 401/404.",
  );
}

// ── REST helper ────────────────────────────────────────────────────────────

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
};

/**
 * Call the Dicefiles REST API.
 * @param {string} method  HTTP method
 * @param {string} path    Path under /api/v1 (e.g. "/files")
 * @param {object} [body]  Request body (JSON-serialised)
 * @returns {Promise<object>}
 */
async function api(method, path, body) {
  const url = `${BASE}/api/v1${path}`;
  const init = {
    method,
    headers: AUTH_HEADERS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, init);
  return res.json().catch(() => ({ ok: false, err: `HTTP ${res.status}` }));
}

/** Wrap any JSON response as an MCP text content block. */
function wrap(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// ── Tool registration ──────────────────────────────────────────────────────

const server = new McpServer({ name: "dicefiles", version: "1.4.3" });

/**
 * Register all Dicefiles tools on an McpServer (or mock server for tests).
 * @param {McpServer|{tool:Function}} srv
 */
function registerTools(srv) {
  // ── 1. server_health ───────────────────────────────────────────────────
  srv.tool(
    "server_health",
    "Check Dicefiles server health and retrieve metrics counters " +
      "(uploads, downloads, preview failures, uptime). " +
      "Use this as a pre-flight check before long automation runs.",
    {},
    async () => {
      const res = await fetch(`${BASE}/healthz`);
      const data = await res
        .json()
        .catch(() => ({ ok: false, err: "healthz unreachable" }));
      return wrap(data);
    },
  );

  // ── 2. list_files ──────────────────────────────────────────────────────
  srv.tool(
    "list_files",
    "List files and/or requests in a Dicefiles room. " +
      "Use type=requests to see open requests, type=new with since=<ms> for incremental polling, " +
      "or combine name_contains and ext for targeted searches.",
    {
      roomid: z.string().describe("Room ID"),
      type: z
        .enum(["all", "uploads", "requests", "new"])
        .optional()
        .describe('Filter type (default "all")'),
      since: z
        .number()
        .optional()
        .describe(
          "Unix milliseconds — return only files uploaded after this time",
        ),
      name_contains: z
        .string()
        .optional()
        .describe("Case-insensitive substring of filename"),
      ext: z
        .string()
        .optional()
        .describe('Comma-separated extensions without dot, e.g. "pdf,epub"'),
    },
    async ({ roomid, type, since, name_contains, ext }) => {
      const qs = new URLSearchParams({ roomid });
      qs.set("type", type || "all");
      if (since != null) qs.set("since", String(since));
      if (name_contains) qs.set("name_contains", name_contains);
      if (ext) qs.set("ext", ext);
      return wrap(await api("GET", `/files?${qs}`));
    },
  );

  // ── 3. get_file ────────────────────────────────────────────────────────
  srv.tool(
    "get_file",
    "Fetch full metadata (tags, meta fields, asset URLs) for a single file by key. " +
      "Use this to check whether ai_caption or author tags are already populated before " +
      "spending tokens on enrichment.",
    {
      key: z.string().describe("File key (from list_files or a webhook event)"),
    },
    async ({ key }) =>
      wrap(await api("GET", `/file/${encodeURIComponent(key)}`)),
  );

  // ── 4. get_room_snapshot ───────────────────────────────────────────────
  srv.tool(
    "get_room_snapshot",
    "Get a one-call aggregate summary of a room: file count, total bytes, " +
      "open request count, unique uploaders, and oldest expiry timestamp. " +
      "Perfect for answering 'what's in the books room?' without paging through file lists.",
    {
      roomid: z.string().describe("Room ID"),
    },
    async ({ roomid }) =>
      wrap(await api("GET", `/room/${encodeURIComponent(roomid)}/snapshot`)),
  );

  // ── 5. update_file_metadata ────────────────────────────────────────────
  srv.tool(
    "update_file_metadata",
    "Write AI-enriched metadata back to a file: captions, OCR text previews, " +
      "and structured tags (author, genre, series, language). " +
      "Requires files:write scope. Unknown fields are silently dropped.",
    {
      key: z.string().describe("File key"),
      meta: z
        .object({
          description: z.string().optional(),
          ai_caption: z.string().optional(),
          ocr_text_preview: z.string().optional(),
        })
        .optional(),
      tags: z
        .object({
          title: z.string().optional(),
          author: z.string().optional(),
          genre: z.string().optional(),
          language: z.string().optional(),
          series: z.string().optional(),
        })
        .optional(),
    },
    async ({ key, meta, tags }) =>
      wrap(
        await api("PATCH", `/file/${encodeURIComponent(key)}`, { meta, tags }),
      ),
  );

  // ── 6. upload_file_from_urls ───────────────────────────────────────────
  srv.tool(
    "upload_file_from_urls",
    "Fetch one or more URLs server-side and store them as uploads in a room. " +
      "The server does the downloading — the agent doesn't stream bytes. " +
      "Max 20 URLs per call, 100 MB per file, 60 second fetch timeout. " +
      "Requires uploads:write scope.",
    {
      roomid: z.string().describe("Destination room ID"),
      urls: z
        .array(z.string().url())
        .min(1)
        .max(20)
        .describe("Array of public URLs to fetch and ingest"),
    },
    async ({ roomid, urls }) =>
      wrap(
        await api("POST", "/batch-upload", {
          roomid,
          items: urls.map((url) => ({ url })),
        }),
      ),
  );

  // ── 7. create_request ─────────────────────────────────────────────────
  srv.tool(
    "create_request",
    "Create a file request in a room. Include structured hints to help " +
      "automation agents match and fulfil the request programmatically. " +
      "Requires requests:write scope and a session.",
    {
      roomid: z.string().describe("Room ID"),
      text: z
        .string()
        .describe("Human-readable description of what is being requested"),
      url: z
        .string()
        .url()
        .optional()
        .describe("Optional reference URL (e.g. a store page)"),
      hints: z
        .object({
          type: z
            .string()
            .optional()
            .describe('e.g. "document", "image", "audio"'),
          keywords: z.array(z.string()).optional(),
          max_size_mb: z.number().optional(),
        })
        .optional(),
    },
    async ({ roomid, text, url, hints }) =>
      wrap(await api("POST", "/requests", { roomid, text, url, hints })),
  );

  // ── 8. claim_request ──────────────────────────────────────────────────
  srv.tool(
    "claim_request",
    "Claim an open request to signal this agent is working on it. " +
      "Returns 409 if already claimed by another agent. " +
      "The claim auto-releases after ttlMs so a crashed agent doesn't block others forever. " +
      "Requires requests:write scope.",
    {
      key: z.string().describe("Request key (from list_files type=requests)"),
      ttlMs: z
        .number()
        .min(5000)
        .max(3600000)
        .optional()
        .describe(
          "Auto-release timeout in milliseconds (default 300000 = 5 min)",
        ),
    },
    async ({ key, ttlMs }) =>
      wrap(
        await api("POST", `/requests/${encodeURIComponent(key)}/claim`, {
          ttlMs: ttlMs ?? 300000,
        }),
      ),
  );

  // ── 9. release_request ────────────────────────────────────────────────
  srv.tool(
    "release_request",
    "Release a previously claimed request back to open state immediately. " +
      "Use this when the agent determines it cannot fulfil the request, " +
      "rather than waiting for the TTL to expire. Requires requests:write scope.",
    {
      key: z.string().describe("Request key you previously claimed"),
    },
    async ({ key }) =>
      wrap(await api("DELETE", `/requests/${encodeURIComponent(key)}/claim`)),
  );

  // ── 10. post_room_chat ────────────────────────────────────────────────
  srv.tool(
    "post_room_chat",
    "Post a message into a room's chat channel from the agent. " +
      "Use this to provide real-time progress updates so users can see what the agent is doing. " +
      "Requires rooms:write scope and a valid session on the API key.",
    {
      roomid: z.string().describe("Room ID"),
      text: z.string().max(500).describe("Message text (max 500 chars)"),
      nick: z
        .string()
        .optional()
        .describe(
          "Display name for the agent (defaults to the account username)",
        ),
    },
    async ({ roomid, text, nick }) =>
      wrap(
        await api("POST", `/room/${encodeURIComponent(roomid)}/chat`, {
          text,
          nick,
        }),
      ),
  );

  // ── 11. download_file ─────────────────────────────────────────────────
  srv.tool(
    "download_file",
    "Download a file and return its content as a base64 string. " +
      "Suitable for documents up to a few MB. For larger files, use get_file to " +
      "retrieve the href and fetch it directly. Aborts if the file exceeds maxBytes.",
    {
      key: z.string().describe("File key"),
      maxBytes: z
        .number()
        .optional()
        .describe("Abort if file exceeds this size in bytes (default 5 MB)"),
    },
    async ({ key, maxBytes = 5 * 1024 * 1024 }) => {
      const url = `${BASE}/g/${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: KEY ? { Authorization: `Bearer ${KEY}` } : {},
      });
      if (!res.ok) {
        return wrap({ ok: false, err: `HTTP ${res.status}`, key });
      }
      const contentType =
        res.headers.get("content-type") || "application/octet-stream";
      const disposition = res.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || key;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength > maxBytes) {
        return wrap({
          ok: false,
          key,
          filename,
          sizeBytes: bytes.byteLength,
          err:
            `File (${bytes.byteLength} bytes) exceeds maxBytes=${maxBytes}. ` +
            `Fetch ${BASE}/g/${key} directly instead.`,
        });
      }
      return wrap({
        ok: true,
        key,
        filename,
        contentType,
        sizeBytes: bytes.byteLength,
        content_base64: Buffer.from(bytes).toString("base64"),
      });
    },
  );

  // ── 12. save_subscription ────────────────────────────────────────────
  srv.tool(
    "save_subscription",
    "Save a named server-side filter preset so the agent remembers what to watch for across restarts. " +
      "Retrieve with list_subscriptions after startup to reconstruct your polling filters. " +
      "Requires files:read scope.",
    {
      name: z.string().describe("Unique name for this subscription"),
      room: z.string().optional().describe("Filter to this room ID"),
      ext: z
        .array(z.string())
        .optional()
        .describe('Extensions to watch, e.g. [".pdf", ".epub"]'),
      name_contains: z.string().optional(),
      max_size_mb: z.number().optional(),
      type: z.string().optional().describe('File type, e.g. "document"'),
    },
    async (body) => wrap(await api("POST", "/agent/subscriptions", body)),
  );

  // ── 13. list_subscriptions ────────────────────────────────────────────
  srv.tool(
    "list_subscriptions",
    "Retrieve all saved filter subscriptions for this API key. " +
      "Call this at agent startup to restore your previous polling configuration. " +
      "Requires files:read scope.",
    {},
    async () => wrap(await api("GET", "/agent/subscriptions")),
  );

  // ── 14. archive_list_contents ─────────────────────────────────────────
  srv.tool(
    "archive_list_contents",
    "List every entry inside a ZIP, RAR, 7z, or TAR archive stored in Dicefiles. " +
      "Returns name, size, compressed size, and path for every file in the archive. " +
      "Use this to inspect what is inside an archive before deciding whether to download it. " +
      "Requires files:read scope.",
    {
      key: z
        .string()
        .describe("File key of the archive (from list_files or get_file)"),
    },
    async ({ key }) =>
      wrap(await api("GET", `/archive/${encodeURIComponent(key)}/ls`)),
  );

  // ── 15. list_room_links ─────────────────────────────────────────────────
  srv.tool(
    "list_room_links",
    "List a destination room's linked source rooms, rules, visibility, " +
      "private-source consent, and live status. Requires room-links:read.",
    {
      roomid: z.string().describe("Destination room ID"),
    },
    async ({ roomid }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/links`,
        ),
      ),
  );

  // ── 16. create_room_link ────────────────────────────────────────────────
  srv.tool(
    "create_room_link",
    "Add a source room to a destination room's linked-file view. " +
      "The source must allow cross-linking; private sources require bilateral consent. " +
      "Requires room-links:write.",
    {
      roomid: z.string().describe("Destination room ID"),
      source: z.string().describe("Source room ID or exact room name"),
      name: z.string().optional().describe("Optional display label"),
      visibility: z
        .enum(["all", "authenticated", "members", "owners", "mods"])
        .optional()
        .describe("Who may see files from this link"),
      allowPrivateSource: z
        .boolean()
        .optional()
        .describe("Destination consent for an invite-only source"),
      rules: z
        .object({
          nameContains: z.string().optional(),
          tagContains: z.string().optional(),
          types: z.array(z.string()).optional(),
          maxAgeHours: z.number().optional(),
          minAgeHours: z.number().optional(),
        })
        .optional(),
    },
    async ({
      roomid,
      source,
      name,
      visibility,
      allowPrivateSource,
      rules,
    }) =>
      wrap(
        await api(
          "POST",
          `/rooms/${encodeURIComponent(roomid)}/links`,
          { source, name, visibility, allowPrivateSource, rules },
        ),
      ),
  );

  // ── 17. remove_room_link ────────────────────────────────────────────────
  srv.tool(
    "remove_room_link",
    "Remove one linked source room from a destination room. " +
      "Requires room-links:write.",
    {
      roomid: z.string().describe("Destination room ID"),
      sourceRoomId: z.string().describe("Source room ID"),
    },
    async ({ roomid, sourceRoomId }) =>
      wrap(
        await api(
          "DELETE",
          `/rooms/${encodeURIComponent(roomid)}/links/${encodeURIComponent(
            sourceRoomId,
          )}`,
        ),
      ),
  );

  // ── 18. list_guest_invites ──────────────────────────────────────────────
  srv.tool(
    "list_guest_invites",
    "List active guest invite links and recent privacy-safe invite activity " +
      "for a room. Responses include full active tokens; treat them as secrets. " +
      "Requires guest-invites:read.",
    {
      roomid: z.string().describe("Room ID"),
    },
    async ({ roomid }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/guest-invites`,
        ),
      ),
  );

  // ── 19. create_guest_invite ─────────────────────────────────────────────
  srv.tool(
    "create_guest_invite",
    "Mint a guest invite with optional use and age limits. " +
      "The returned token is secret. Requires guest-invites:write.",
    {
      roomid: z.string().describe("Room ID"),
      singleUse: z.boolean().optional(),
      maxUses: z.number().min(1).max(100000).optional(),
      maxAgeHours: z.number().min(0.01).optional(),
      label: z.string().max(80).optional(),
    },
    async ({ roomid, singleUse, maxUses, maxAgeHours, label }) =>
      wrap(
        await api(
          "POST",
          `/rooms/${encodeURIComponent(roomid)}/guest-invites`,
          { singleUse, maxUses, maxAgeHours, label },
        ),
      ),
  );

  // ── 20. revoke_guest_invite ─────────────────────────────────────────────
  srv.tool(
    "revoke_guest_invite",
    "Revoke one active guest invite by its full token. " +
      "Requires guest-invites:write.",
    {
      roomid: z.string().describe("Room ID"),
      token: z.string().describe("Full guest invite token"),
    },
    async ({ roomid, token }) =>
      wrap(
        await api(
          "DELETE",
          `/rooms/${encodeURIComponent(roomid)}/guest-invites/${encodeURIComponent(
            token,
          )}`,
        ),
      ),
  );

  // ── 21. list_federated_room_links ──────────────────────────────────────
  srv.tool(
    "list_federated_room_links",
    "List a room's trusted cross-host Dicefiles links and live peer status. " +
      "Requires federation-links:read.",
    {
      roomid: z.string().describe("Destination room ID"),
    },
    async ({ roomid }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/federation-links`,
        ),
      ),
  );

  // ── 22. create_federated_room_link ─────────────────────────────────────
  srv.tool(
    "create_federated_room_link",
    "Link a room from an operator-pinned Dicefiles peer. The source peer and " +
      "source room must independently allow access. Requires federation-links:write.",
    {
      roomid: z.string().describe("Destination room ID"),
      peerId: z.string().describe("Configured federation peer ID"),
      remoteRoomId: z.string().describe("Room ID on the remote peer"),
      name: z.string().max(160).optional(),
      visibility: z
        .enum(["all", "authenticated", "members", "owners", "mods"])
        .optional(),
    },
    async ({ roomid, peerId, remoteRoomId, name, visibility }) =>
      wrap(
        await api(
          "POST",
          `/rooms/${encodeURIComponent(roomid)}/federation-links`,
          { peerId, roomId: remoteRoomId, name, visibility },
        ),
      ),
  );

  // ── 23. remove_federated_room_link ─────────────────────────────────────
  srv.tool(
    "remove_federated_room_link",
    "Remove one peer-room link from a destination room. " +
      "Requires federation-links:write.",
    {
      roomid: z.string().describe("Destination room ID"),
      peerId: z.string().describe("Configured federation peer ID"),
      remoteRoomId: z.string().describe("Room ID on the remote peer"),
    },
    async ({ roomid, peerId, remoteRoomId }) =>
      wrap(
        await api(
          "DELETE",
          `/rooms/${encodeURIComponent(roomid)}/federation-links/` +
            `${encodeURIComponent(peerId)}/${encodeURIComponent(remoteRoomId)}`,
        ),
      ),
  );

  // ── 24. set_room_federation_policy ─────────────────────────────────────
  srv.tool(
    "set_room_federation_policy",
    "Opt a source room into or out of trusted-peer federation. Private rooms " +
      "need both switches. Requires federation-links:write.",
    {
      roomid: z.string().describe("Source room ID"),
      allowFederation: z.boolean(),
      allowPrivateFederation: z.boolean().optional(),
    },
    async ({ roomid, allowFederation, allowPrivateFederation }) =>
      wrap(
        await api(
          "PATCH",
          `/rooms/${encodeURIComponent(roomid)}/federation`,
          { allowFederation, allowPrivateFederation },
        ),
      ),
  );
}

// Register all tools on the server
registerTools(server);

// ── Transport ──────────────────────────────────────────────────────────────

async function startHttpTransport() {
  let StreamableHTTPServerTransport;
  try {
    ({
      StreamableHTTPServerTransport,
    } = require("@modelcontextprotocol/sdk/server/streamableHttp.js"));
  } catch {
    throw new Error(
      "HTTP transport requires @modelcontextprotocol/sdk ≥1.5.0. " +
        "Run: npm install @modelcontextprotocol/sdk",
    );
  }
  const http = require("http");
  const port = Number(process.env.MCP_PORT) || 3001;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const httpServer = http.createServer(async (req, res) => {
    if (
      (req.method === "POST" ||
        req.method === "GET" ||
        req.method === "DELETE") &&
      req.url === "/mcp"
    ) {
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(req.method === "GET" ? 200 : 404, {
        "Content-Type": "text/plain",
      });
      res.end(
        req.method === "GET"
          ? "Dicefiles MCP server running. POST /mcp for JSON-RPC.\n"
          : "Not Found",
      );
    }
  });
  await new Promise((resolve, reject) =>
    httpServer.listen(port, (err) => (err ? reject(err) : resolve())),
  );
  console.error(
    `[dicefiles-mcp] HTTP transport listening at http://0.0.0.0:${port}/mcp`,
  );
  return transport;
}

async function main() {
  const transport =
    process.env.MCP_TRANSPORT === "http"
      ? await startHttpTransport()
      : new StdioServerTransport();
  await server.connect(transport);
  if (process.env.MCP_TRANSPORT !== "http") {
    console.error(
      "[dicefiles-mcp] Stdio transport ready. Waiting for MCP client...",
    );
  }
}

// Allow require()-ing this module without auto-starting (for tests)
if (require.main === module) {
  main().catch((err) => {
    console.error("[dicefiles-mcp] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { registerTools, api };
