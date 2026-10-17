"use strict";

require("../lib/environment").loadEnvironment();
/**
 * scripts/mcp-server.js — Hobbyfiles MCP server wrapper
 *
 * Wraps the Hobbyfiles REST API as 57 MCP tools, allowing any MCP-compatible
 * AI client (Claude Desktop, Cursor, Continue, OpenClaw, AutoGen) to interact with
 * a Hobbyfiles instance directly.
 *
 * Usage (stdio — Claude Desktop, Cursor, local agents):
 *   node scripts/mcp-server.js
 *
 * Usage (HTTP — remote orchestrators):
 *   MCP_TRANSPORT=http MCP_PORT=3001 node scripts/mcp-server.js
 *
 * The HTTP transport speaks the stateless 2026-07-28 protocol core: no
 * `initialize` handshake, no `Mcp-Session-Id`, and a fresh server instance per
 * request, so it scales horizontally behind a plain load balancer.
 *
 * Required env vars:
 *   HOBBYFILES_BASE_URL   Base URL of your Hobbyfiles instance (default: http://localhost:10005)
 *   HOBBYFILES_API_KEY    Automation API key (minimum scope: files:read)
 *
 * Optional env vars:
 *   MCP_TRANSPORT        "stdio" (default) | "http"
 *   MCP_PORT             HTTP port when MCP_TRANSPORT=http (default: 3001)
 *   MCP_HOST             HTTP bind address when MCP_TRANSPORT=http (default: 127.0.0.1)
 *   MCP_API_TIMEOUT_MS   Per-request Hobbyfiles API timeout (default: 30000)
 *   MCP_AUTH_TOKEN       Separate incoming HTTP bearer token
 *   MCP_ALLOWED_HOSTS    Comma-separated accepted HTTP hostnames
 *   MCP_ALLOWED_ORIGINS  Comma-separated accepted Origin hostnames
 *
 * Dependencies:
 *   @modelcontextprotocol/server  ≥2.1.0  (2026-07-28 stateless protocol core)
 *   @modelcontextprotocol/node    ≥2.1.0  (node:http adapter, Host/Origin guards)
 *   zod                           ^4
 *
 * Install: yarn add @modelcontextprotocol/server @modelcontextprotocol/node zod
 */

const {
  McpServer,
  createMcpHandler,
} = require("@modelcontextprotocol/server");
const { StdioServerTransport } = require("@modelcontextprotocol/server/stdio");
const {
  toNodeHandler,
  hostHeaderValidation,
  originValidation,
  localhostHostValidation,
  localhostOriginValidation,
} = require("@modelcontextprotocol/node");
const { z } = require("zod/v4");
const { timingSafeEqual } = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const { scopeAllowed, loadOAuthConfig, createOAuthAuthorization } = require("./mcp-authorization");

const CALLER = new AsyncLocalStorage();
const { version: HOBBYFILES_VERSION } = require("../package.json");
const { readBoundedJson } = require("../lib/bounded-json");

// ── Configuration ──────────────────────────────────────────────────────────

const BASE = (
  process.env.HOBBYFILES_BASE_URL || "http://localhost:10005"
).replace(/\/+$/, "");
const KEY = process.env.HOBBYFILES_API_KEY || "";

/** Network timeout for every outbound Hobbyfiles API call, in ms. */
function positiveInteger(value, fallback, name, max = 2147483647) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > max) {
    throw new Error(`${name} must be a positive integer no greater than ${max}`);
  }
  return number;
}

const API_TIMEOUT_MS = positiveInteger(
  process.env.MCP_API_TIMEOUT_MS, 30000, "MCP_API_TIMEOUT_MS",
);
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

if (!KEY) {
  console.error(
    "[hobbyfiles-mcp] WARNING: HOBBYFILES_API_KEY is not set. " +
      "Most tools require an API key and will return 401/404.",
  );
}

// ── REST helper ────────────────────────────────────────────────────────────

function authHeaders() {
  const key = CALLER.getStore()?.key ?? KEY;
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

/**
 * Call the Hobbyfiles REST API.
 * @param {string} method  HTTP method
 * @param {string} path    Path under /api/v1 (e.g. "/files")
 * @param {object} [body]  Request body (JSON-serialised)
 * @returns {Promise<object>}
 */
async function api(method, path, body) {
  const url = `${BASE}/api/v1${path}`;
  const init = {
    method,
    headers: authHeaders(),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  let res;
  try {
    res = await fetch(url, init);
  }
  catch (err) {
    return { ok: false, err: `${BASE} unreachable: ${err.message}` };
  }
  return readJsonResponse(res);
}

async function readJsonResponse(res) {
  const data = await readBoundedJson(res).catch(() => null);
  if (data === null) {
    return { ok: false, err: `HTTP ${res.status} with a non-JSON body` };
  }
  if (!res.ok || (data && data.err && data.ok !== true)) {
    return { ...data, ok: false, err: data.err || `HTTP ${res.status}`, status: res.status };
  }
  return data;
}

/** Wrap any JSON response as an MCP text content block. */
function wrap(data) {
  const failed = !data || data.ok === false;
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    ...(data && typeof data === "object" && !Array.isArray(data) ? { structuredContent: data } : {}),
    ...(failed ? { isError: true } : {}),
  };
}

/** Read at most maxBytes, including chunked responses without Content-Length. */
async function downloadFile(key, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/g/${encodeURIComponent(key)}`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) {
      controller.abort();
      return wrap({ ok: false, err: `HTTP ${res.status}`, key });
    }
    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const disposition = res.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || key;
    const tooLarge = sizeBytes => wrap({
      ok: false, key, filename, sizeBytes,
      err: `File exceeds maxBytes=${maxBytes}. Fetch the file URL directly instead.`,
    });
    const declared = Number(res.headers.get("content-length"));
    if (declared > maxBytes) {
      controller.abort();
      await res.body?.cancel();
      return tooLarge(declared);
    }
    const chunks = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          size += value.byteLength;
          if (size > maxBytes) {
            controller.abort();
            await reader.cancel();
            return tooLarge(size);
          }
          chunks.push(Buffer.from(value));
        }
      }
      finally {
        reader.releaseLock();
      }
    }
    return wrap({
      ok: true, key, filename, contentType, sizeBytes: size,
      content_base64: Buffer.concat(chunks, size).toString("base64"),
    });
  }
  finally {
    clearTimeout(timer);
  }
}

// ── Tool metadata ───────────────────────────────────────────────────────────

/**
 * Per-tool behaviour hints. `readOnlyHint` lets a host auto-approve lookups;
 * Annotations are hints for hosts, never an authorization mechanism. Reads are
 * safe to retry; writes must explicitly opt in to idempotence.
 */
const TOOL_META = {
  list_storage_migrations: { title: "list storage migrations", readOnly: true },
  plan_storage_migration: { title: "plan storage migration", destructive: true },
  control_storage_migration: { title: "control storage migration", destructive: true },
  set_storage_volume_draining: { title: "set storage volume draining", destructive: true },
  list_room_access_credentials: { title: "list room access credentials", readOnly: true },
  create_room_access_credential: { title: "create room access credential", destructive: false },
  update_room_access_credential: { title: "update room access credential", destructive: true },
  revoke_room_access_credential: { title: "revoke room access credential", destructive: true },
  rotate_room_access_credential: { title: "rotate room access credential", destructive: true },
  reveal_room_access_credential: { title: "reveal room access credential", readOnly: true },
  get_room_access_audit: { title: "get room access audit", readOnly: true },
  list_remote_import_providers: { title: "List remote import providers", readOnly: true },
  validate_remote_import_source: { title: "Validate remote import source", readOnly: true },
  // Reads.
  server_health: { title: "Server health", readOnly: true },
  list_files: { title: "List files and requests", readOnly: true },
  get_file: { title: "Get file metadata", readOnly: true },
  get_room_snapshot: { title: "Get room snapshot", readOnly: true },
  list_subscriptions: { title: "List subscriptions", readOnly: true },
  archive_list_contents: { title: "List archive contents", readOnly: true },
  list_room_links: { title: "List room links", readOnly: true },
  list_guest_invites: { title: "List guest invites", readOnly: true },
  list_federated_room_links: {
    title: "List federated room links",
    readOnly: true,
  },
  list_room_plugins: { title: "List room plugins", readOnly: true },
  inspect_room_plugin_operations: { title: "Inspect bot jobs and report", readOnly: true },
  list_room_plugin_connections: { title: "List approved bot connections", readOnly: true },
  queue_room_plugin_job: { title: "Queue a bot job", idempotent: false },
  update_room_plugin_job: { title: "Cancel or replay a bot job" },
  review_room_plugin_item: { title: "Apply a reviewed bot proposal" },
  list_room_sessions: { title: "List room sessions", readOnly: true },
  create_room_session: { title: "Plan a room session", idempotent: false },
  update_room_session: { title: "Cancel or restore a room session" },
  inspect_room_plugin_sync_memory: {
    title: "Inspect plugin sync memory",
    readOnly: true,
  },
  get_storage_volumes: { title: "Get storage volumes", readOnly: true },
  preview_storage_placement: {
    title: "Preview storage placement",
    readOnly: true,
  },
  get_room_password_access: { title: "Get room password access", readOnly: true },
  reveal_room_passwords: { title: "Reveal room passwords", readOnly: true },

  // Writes that add or change state.
  update_file_metadata: { title: "Update file metadata" },
  upload_file_from_urls: { title: "Upload files from URLs" },
  create_request: { title: "Create a request", idempotent: false },
  claim_request: { title: "Claim a request", idempotent: false },
  release_request: { title: "Release a request", idempotent: false },
  post_room_chat: { title: "Post a room chat message" },
  save_subscription: { title: "Save a subscription" },
  download_file: { title: "Download a file" },
  create_room_link: { title: "Create a room link" },
  create_guest_invite: { title: "Create a guest invite" },
  create_federated_room_link: { title: "Create a federated room link" },
  set_room_federation_policy: { title: "Set room federation policy" },
  configure_room_plugin: { title: "Configure a room plugin" },
  run_room_plugin: { title: "Run a room plugin" },
  configure_room_password_access: { title: "Configure room password access" },
  rotate_room_password: {
    title: "Rotate room password",
    destructive: true,
  },

  // Removals.
  remove_room_link: { title: "Remove a room link", destructive: true },
  revoke_guest_invite: { title: "Revoke a guest invite", destructive: true },
  remove_federated_room_link: {
    title: "Remove a federated room link",
    destructive: true,
  },
  remove_room_plugin: { title: "Remove a room plugin", destructive: true },
  clear_room_plugin_sync_memory: {
    title: "Clear plugin sync memory",
    destructive: true,
  },
};

/**
 * Register one tool on the server. Thin wrapper so the 57 registrations below
 * keep the v1 call shape while the annotations live in one reviewable table.
 * @param {McpServer|{registerTool:Function}} srv
 * @param {string} name
 * @param {string} description
 * @param {object} [inputSchema] Zod object schema, omitted for no-arg tools
 * @param {Function} handler
 */
const TOOL_SCOPES = Object.freeze({
  list_storage_migrations: "admin:read",
  plan_storage_migration: "admin:storage",
  control_storage_migration: "admin:storage",
  set_storage_volume_draining: "admin:storage",
  list_room_access_credentials: "room-access:read",
  create_room_access_credential: "room-access:write",
  update_room_access_credential: "room-access:write",
  revoke_room_access_credential: "room-access:write",
  rotate_room_access_credential: "room-access:write",
  reveal_room_access_credential: "room-access:secrets",
  get_room_access_audit: "room-access:read",
  list_remote_import_providers: "room-plugins:read",
  validate_remote_import_source: "room-plugins:read",
  server_health: "mcp",
  list_files: "files:read",
  get_file: "files:read",
  get_room_snapshot: "files:read",
  update_file_metadata: "files:write",
  upload_file_from_urls: "uploads:write",
  create_request: "requests:write",
  claim_request: "requests:write",
  release_request: "requests:write",
  post_room_chat: "chat:write",
  download_file: "files:read",
  save_subscription: "files:read",
  list_subscriptions: "files:read",
  archive_list_contents: "files:read",
  list_room_links: "room-links:read",
  create_room_link: "room-links:write",
  remove_room_link: "room-links:write",
  list_guest_invites: "guest-invites:read",
  create_guest_invite: "guest-invites:write",
  revoke_guest_invite: "guest-invites:write",
  list_federated_room_links: "federation-links:read",
  create_federated_room_link: "federation-links:write",
  remove_federated_room_link: "federation-links:write",
  set_room_federation_policy: "federation-links:write",
  list_room_plugins: "room-plugins:read",
  inspect_room_plugin_operations: "room-plugins:read",
  list_room_plugin_connections: "room-plugins:read",
  queue_room_plugin_job: "room-plugins:run",
  update_room_plugin_job: "room-plugins:run",
  review_room_plugin_item: "room-plugins:write",
  list_room_sessions: "files:read",
  create_room_session: "rooms:write",
  update_room_session: "rooms:write",
  configure_room_plugin: "room-plugins:write",
  remove_room_plugin: "room-plugins:write",
  run_room_plugin: "room-plugins:run",
  inspect_room_plugin_sync_memory: "room-plugins:read",
  clear_room_plugin_sync_memory: "room-plugins:write",
  get_storage_volumes: "admin:read",
  preview_storage_placement: "admin:read",
  get_room_password_access: "room-access:read",
  configure_room_password_access: "room-access:write",
  rotate_room_password: "room-access:write",
  reveal_room_passwords: "room-access:secrets"
});

function defineTool(srv, name, description, inputSchema, handler) {
  const caller = CALLER.getStore();
  if (caller && !scopeAllowed(caller.scopes, TOOL_SCOPES[name])) {
    return undefined;
  }
  const meta = TOOL_META[name] || {};
  const config = {
    title: meta.title || name,
    description,
    annotations: {
      readOnlyHint: meta.readOnly === true,
      destructiveHint: meta.destructive ?? meta.readOnly !== true,
      idempotentHint: meta.idempotent ?? meta.readOnly === true,
      openWorldHint: true,
    },
    ...(inputSchema && Object.keys(inputSchema).length ?
      { inputSchema } :
      {}),
  };
  return srv.registerTool(name, config, (...args) => CALLER.run(caller || { key: KEY, scopes: ["*"] }, () => handler(...args)));
}

// ── Tool registration ──────────────────────────────────────────────────────

/**
 * Build a fresh server instance with every Hobbyfiles tool registered.
 *
 * The 2026-07-28 protocol core is stateless: the HTTP handler calls this
 * factory once per request, so no instance state is shared between callers.
 *
 * @returns {McpServer}
 */
function createServer() {
  const srv = new McpServer({ name: "hobbyfiles", version: HOBBYFILES_VERSION });
  registerTools(srv);
  return srv;
}

/**
 * Register all Hobbyfiles tools on an McpServer (or mock server for tests).
 * @param {McpServer|{registerTool:Function}} srv
 */
function registerTools(srv) {
  const botSelection = { roomid: z.string(), pluginId: z.string() };
  const botPath = args => `/rooms/${encodeURIComponent(args.roomid)}/plugins/${encodeURIComponent(args.pluginId)}`;
  defineTool(srv, "review_room_plugin_item", "Apply a declared action from the latest bot report. Stale or changed items are rejected. Requires room-plugins:write.", { ...botSelection, reportId: z.string().max(64), itemId: z.string().max(80), action: z.string().max(32) }, async args => wrap(await api("POST", `${botPath(args)}/review`, { reportId: args.reportId, itemId: args.itemId, action: args.action })));
  defineTool(srv, "list_room_sessions", "List room-local sessions, preparation links and aggregate RSVPs without member identities. Requires files:read.", { roomid: z.string() }, async args => wrap(await api("GET", `/rooms/${encodeURIComponent(args.roomid)}/sessions`)));
  defineTool(srv, "create_room_session", "Plan a session within 60 days in a room with Session Organizer enabled. Times are Unix milliseconds; no external calendars are changed. Requires rooms:write.", { roomid: z.string(), title: z.string().max(120), startsAt: z.number(), endsAt: z.number().optional(), timezone: z.string(), description: z.string().max(1000).optional(), links: z.array(z.string()).max(20).optional() }, async ({ roomid, ...body }) => wrap(await api("POST", `/rooms/${encodeURIComponent(roomid)}/sessions`, body)));
  defineTool(srv, "update_room_session", "Cancel or restore a room session using its current revision. Requires rooms:write.", { roomid: z.string(), sessionId: z.string(), revision: z.string(), cancelled: z.boolean() }, async ({ roomid, sessionId, ...body }) => wrap(await api("PATCH", `/rooms/${encodeURIComponent(roomid)}/sessions/${encodeURIComponent(sessionId)}`, body)));
  defineTool(srv, "inspect_room_plugin_operations", "Read one invited bot's bounded job history and latest preview/report. Requires room-plugins:read.", { ...botSelection, cursor: z.string().optional() }, async args => wrap(await api("GET", `${botPath(args)}/operations${args.cursor ? `?cursor=${encodeURIComponent(args.cursor)}` : ""}`)));
  defineTool(srv, "list_room_plugin_connections", "List operator-approved connection labels for this bot and room. Credentials are never returned. Requires room-plugins:read.", botSelection, async args => wrap(await api("GET", `${botPath(args)}/connections`)));
  defineTool(srv, "queue_room_plugin_job", "Queue durable bot work; retries survive restarts. Choose an advertised run mode. Requires room-plugins:run.", { ...botSelection, mode: z.enum(["run", "preview", "test", "digest"]).optional(), idempotencyKey: z.string().max(256).optional() }, async args => wrap(await api("POST", `${botPath(args)}/jobs`, { mode: args.mode, idempotencyKey: args.idempotencyKey })));
  defineTool(srv, "update_room_plugin_job", "Cancel active work or replay a failed/cancelled bot job using current settings. Requires room-plugins:run.", { ...botSelection, jobId: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(["cancel", "replay"]) }, async args => wrap(await api("POST", `${botPath(args)}/jobs/${args.jobId}/${args.action}`)));
  defineTool(srv, "list_remote_import_providers", "List installed remote import providers, capabilities, circuit state and availability. Requires room-plugins:read.", {}, async () => wrap(await api("GET", "/remote-import/providers")));
  defineTool(srv, "validate_remote_import_source", "Validate a source URL against installed and allowed remote providers without importing files. Requires room-plugins:read.", { url: z.string().max(2048), providers: z.array(z.string()).max(4).optional() }, async body => wrap(await api("POST", "/remote-import/validate-source", body)));
  defineTool(srv, "list_storage_migrations", "List the persistent storage migration journal. Requires admin:read.", { limit: z.number().int().min(1).max(500).optional(), cursor: z.string().optional() }, async args => wrap(await api("GET", `/admin/storage/migrations?${new URLSearchParams(Object.entries(args).filter(([, value]) => value != null))}`)));
  defineTool(srv, "plan_storage_migration", "Preview a move, volume drain, or controlled rebalance. dryRun defaults true. Set dryRun=false to queue checksum-verified moves with source grace and rollback. Requires admin:storage.", { hashes: z.array(z.string()).max(500).optional(), sourceVolumeId: z.string().optional(), targetVolumeId: z.string().optional(), mode: z.enum(["drain", "rebalance"]).optional(), maxBlobs: z.number().int().min(1).max(500).optional(), dryRun: z.boolean().optional() }, async body => wrap(await api("POST", "/admin/storage/migrations", { ...body, dryRun: body.dryRun !== false })));
  defineTool(srv, "control_storage_migration", "Pause, resume, or roll back a storage move while source copies remain valid. Requires admin:storage.", { id: z.string().uuid(), action: z.enum(["pause", "resume", "rollback"]) }, async ({id, action}) => wrap(await api("POST", `/admin/storage/migrations/${encodeURIComponent(id)}/${action}`, {})));
  defineTool(srv, "set_storage_volume_draining", "Set or clear a volume's draining state. Draining rejects new allocations while existing reservations can finish. Requires admin:storage.", { volumeId: z.string(), draining: z.boolean() }, async ({volumeId, draining}) => wrap(await api("PATCH", `/admin/storage/volumes/${encodeURIComponent(volumeId)}/drain`, {draining})));
  const credentialAddress = (roomid, id = "") => `/rooms/${encodeURIComponent(roomid)}/access-credentials${id ? `/${encodeURIComponent(id)}` : ""}`;
  const credentialFields = { label: z.string().min(1).max(80).optional(), mode: z.enum(["cohort", "personal"]).optional(), binding: z.enum(["account", "browser"]).optional(), accountId: z.string().max(128).optional(), rotation: z.enum(["monthly", "fixed-days", "manual"]).optional(), days: z.number().int().min(1).max(365).optional(), expiresAt: z.number().int().positive().optional(), maxActivations: z.number().int().min(0).max(1000).optional(), password: z.string().min(12).max(256).optional(), state: z.enum(["active", "suspended", "revoked"]).optional() };
  defineTool(srv, "list_room_access_credentials", "List cohort/personal credentials without secrets. Requires room-access:read.", { roomid: z.string(), limit: z.number().int().min(1).max(500).optional(), cursor: z.string().optional() }, async ({roomid, ...args}) => wrap(await api("GET", `${credentialAddress(roomid)}?${new URLSearchParams(Object.entries(args).filter(([,value]) => value != null))}`)));
  defineTool(srv, "create_room_access_credential", "Create a cohort or personal credential in a protected room. Retrieve its password through the separately scoped reveal tool. Requires room-access:write.", { roomid: z.string(), ...credentialFields, label: z.string().min(1).max(80), mode: z.enum(["cohort", "personal"]) }, async ({roomid, ...body}) => wrap(await api("POST", credentialAddress(roomid), body)));
  defineTool(srv, "update_room_access_credential", "Update a credential label, state, or browser activation limit. Requires room-access:write.", { roomid: z.string(), id: z.string().uuid(), label: z.string().max(80).optional(), state: z.enum(["active", "suspended", "revoked"]).optional(), maxActivations: z.number().int().min(0).max(1000).optional() }, async ({roomid, id, ...body}) => wrap(await api("PATCH", credentialAddress(roomid, id), body)));
  defineTool(srv, "revoke_room_access_credential", "Revoke and remove a cohort/personal credential and its grants. Other credentials remain valid. Requires room-access:write.", { roomid: z.string(), id: z.string().uuid() }, async ({roomid, id}) => wrap(await api("DELETE", credentialAddress(roomid, id))));
  defineTool(srv, "rotate_room_access_credential", "Rotate one credential and revoke its existing grants. Requires room-access:write.", { roomid: z.string(), id: z.string().uuid(), password: z.string().min(12).max(256).optional() }, async ({roomid, id, ...body}) => wrap(await api("POST", `${credentialAddress(roomid, id)}/rotations`, body)));
  defineTool(srv, "reveal_room_access_credential", "Reveal an active credential's current password for private distribution. Requires room-access:secrets.", { roomid: z.string(), id: z.string().uuid() }, async ({roomid, id}) => wrap(await api("POST", `${credentialAddress(roomid, id)}/reveals`, {})));
  defineTool(srv, "get_room_access_audit", "Read the bounded credential administration and activation audit, without secrets. Requires room-access:read.", { roomid: z.string(), limit: z.number().int().min(1).max(500).optional(), cursor: z.string().optional() }, async ({roomid, ...args}) => wrap(await api("GET", `/rooms/${encodeURIComponent(roomid)}/access-audit?${new URLSearchParams(Object.entries(args).filter(([,value]) => value != null))}`)));

  // ── 1. server_health ───────────────────────────────────────────────────
  defineTool(srv,
    "server_health",
    "Check Hobbyfiles server health and retrieve metrics counters " +
      "(uploads, downloads, preview failures, uptime). " +
      "Use this as a pre-flight check before long automation runs.",
    {},
    async () => {
      try {
        const res = await fetch(`${BASE}/healthz`, {
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
        return wrap(await readJsonResponse(res));
      }
      catch (err) {
        return wrap({ ok: false, err: `healthz unreachable: ${err.message}` });
      }
    },
  );

  // ── 2. list_files ──────────────────────────────────────────────────────
  defineTool(srv,
    "list_files",
    "List files and/or requests in a Hobbyfiles room. " +
      "Use type=requests to see open requests, type=new with since=<ms> for incremental polling, " +
      "or combine name_contains and ext for targeted searches.",
    {
      roomid: z.string().describe("Room ID"),
      type: z.
        enum(["all", "uploads", "requests", "new"]).
        optional().
        describe("Filter type (default \"all\")"),
      since: z.
        number().
        optional().
        describe(
          "Unix milliseconds — return only files uploaded after this time",
        ),
      name_contains: z.
        string().
        optional().
        describe("Case-insensitive substring of filename"),
      ext: z.
        string().
        optional().
        describe("Comma-separated extensions without dot, e.g. \"pdf,epub\""),
      limit: z.number().int().min(1).max(500).optional().describe("Page size, default 100"),
      cursor: z.string().optional().describe("Continuation cursor"),
    },
    async ({ roomid, type, since, name_contains, ext, limit = 100, cursor }) => {
      const qs = new URLSearchParams({ roomid });
      qs.set("type", type || "all");
      if (since != null) {
        qs.set("since", String(since));
      }
      if (name_contains) {
        qs.set("name_contains", name_contains);
      }
      if (ext) {
        qs.set("ext", ext);
      }
      qs.set("limit", String(limit));
      if (cursor) {
        qs.set("cursor", cursor);
      }
      return wrap(await api("GET", `/files?${qs}`));
    },
  );

  // ── 3. get_file ────────────────────────────────────────────────────────
  defineTool(srv,
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
  defineTool(srv,
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
  defineTool(srv,
    "update_file_metadata",
    "Write AI-enriched metadata back to a file: captions, OCR text previews, " +
      "and structured tags (author, genre, series, language). " +
      "Requires files:write scope. Unknown fields are silently dropped.",
    {
      key: z.string().describe("File key"),
      meta: z.
        object({
          description: z.string().optional(),
          ai_caption: z.string().optional(),
          ocr_text_preview: z.string().optional(),
        }).
        optional(),
      tags: z.
        object({
          title: z.string().optional(),
          author: z.string().optional(),
          genre: z.string().optional(),
          language: z.string().optional(),
          series: z.string().optional(),
        }).
        optional(),
    },
    async ({ key, meta, tags }) =>
      wrap(
        await api("PATCH", `/file/${encodeURIComponent(key)}`, { meta, tags }),
      ),
  );

  // ── 6. upload_file_from_urls ───────────────────────────────────────────
  defineTool(srv,
    "upload_file_from_urls",
    "Fetch one or more URLs server-side and store them as uploads in a room. " +
      "The server does the downloading — the agent doesn't stream bytes. " +
      "Max 20 URLs per call, 100 MB per file, 60 second fetch timeout. " +
      "Requires uploads:write scope.",
    {
      roomid: z.string().describe("Destination room ID"),
      urls: z.
        array(z.string().max(16384).url()).
        min(1).
        max(20).
        describe("Public HTTP/HTTPS URLs or magnet URIs; torrents import metadata only"),
    },
    async ({ roomid, urls }) =>
      wrap(
        await api("POST", "/batch-upload", urls.map(url => ({ url, roomid }))),
      ),
  );

  // ── 7. create_request ─────────────────────────────────────────────────
  defineTool(srv,
    "create_request",
    "Create a file request in a room. Include structured hints to help " +
      "automation agents match and fulfil the request programmatically. " +
      "Requires requests:write scope and a session.",
    {
      roomid: z.string().describe("Room ID"),
      text: z.
        string().
        describe("Human-readable description of what is being requested"),
      url: z.
        string().
        url().
        optional().
        describe("Optional reference URL (e.g. a store page)"),
      hints: z.
        object({
          type: z.
            string().
            optional().
            describe("e.g. \"document\", \"image\", \"audio\""),
          keywords: z.array(z.string()).optional(),
          max_size_mb: z.number().optional(),
        }).
        optional(),
    },
    async ({ roomid, text, url, hints }) =>
      wrap(await api("POST", "/requests", { roomid, text, url, hints })),
  );

  // ── 8. claim_request ──────────────────────────────────────────────────
  defineTool(srv,
    "claim_request",
    "Claim an open request to signal this agent is working on it. " +
      "Returns 409 if already claimed by another agent. " +
      "The claim auto-releases after ttlMs so a crashed agent doesn't block others forever. " +
      "Requires requests:write scope.",
    {
      key: z.string().describe("Request key (from list_files type=requests)"),
      ttlMs: z.
        number().
        min(5000).
        max(3600000).
        optional().
        describe(
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
  defineTool(srv,
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
  defineTool(srv,
    "post_room_chat",
    "Post a message into a room's chat channel from the agent. " +
      "Use this to provide real-time progress updates so users can see what the agent is doing. " +
      "Requires rooms:write scope and a valid session on the API key.",
    {
      roomid: z.string().describe("Room ID"),
      text: z.string().max(500).describe("Message text (max 500 chars)"),
      nick: z.
        string().
        optional().
        describe(
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
  defineTool(srv,
    "download_file",
    "Download a file and return its content as a base64 string. " +
      "Suitable for documents up to a few MB. For larger files, use get_file to " +
      "retrieve the href and fetch it directly. Aborts if the file exceeds maxBytes.",
    {
      key: z.string().describe("File key"),
      maxBytes: z.
        number().
        int().
        min(1).
        max(MAX_DOWNLOAD_BYTES).
        optional().
        describe("Abort if file exceeds this size in bytes (default 5 MB)"),
    },
    async ({ key, maxBytes = 5 * 1024 * 1024 }) => {
      positiveInteger(maxBytes, 5 * 1024 * 1024, "maxBytes", MAX_DOWNLOAD_BYTES);
      try {
        return await downloadFile(key, maxBytes);
      }
      catch (err) {
        return wrap({ ok: false, key, err: err.message });
      }
    },
  );

  // ── 12. save_subscription ────────────────────────────────────────────
  defineTool(srv,
    "save_subscription",
    "Save a named server-side filter preset so the agent remembers what to watch for across restarts. " +
      "Retrieve with list_subscriptions after startup to reconstruct your polling filters. " +
      "Requires files:read scope.",
    {
      name: z.string().describe("Unique name for this subscription"),
      room: z.string().optional().describe("Filter to this room ID"),
      ext: z.
        array(z.string()).
        optional().
        describe("Extensions to watch, e.g. [\".pdf\", \".epub\"]"),
      name_contains: z.string().optional(),
      max_size_mb: z.number().optional(),
      type: z.string().optional().describe("File type, e.g. \"document\""),
    },
    async body => wrap(await api("POST", "/agent/subscriptions", body)),
  );

  // ── 13. list_subscriptions ────────────────────────────────────────────
  defineTool(srv,
    "list_subscriptions",
    "Retrieve all saved filter subscriptions for this API key. " +
      "Call this at agent startup to restore your previous polling configuration. " +
      "Requires files:read scope.",
    {},
    async () => wrap(await api("GET", "/agent/subscriptions")),
  );

  // ── 14. archive_list_contents ─────────────────────────────────────────
  defineTool(srv,
    "archive_list_contents",
    "List every entry inside a ZIP, RAR, 7z, or TAR archive stored in Hobbyfiles. " +
      "Returns name, size, compressed size, and path for every file in the archive. " +
      "Use this to inspect what is inside an archive before deciding whether to download it. " +
      "Requires files:read scope.",
    {
      key: z.
        string().
        describe("File key of the archive (from list_files or get_file)"),
      limit: z.number().int().min(1).max(500).optional(),
      cursor: z.string().optional(),
    },
    async ({ key, limit = 100, cursor }) =>
      wrap(await api("GET", `/archive/${encodeURIComponent(key)}/ls?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`)),
  );

  // ── 15. list_room_links ─────────────────────────────────────────────────
  defineTool(srv,
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
  defineTool(srv,
    "create_room_link",
    "Add a source room to a destination room's linked-file view. " +
      "The source must allow cross-linking; private sources require bilateral consent. " +
      "Requires room-links:write.",
    {
      roomid: z.string().describe("Destination room ID"),
      source: z.string().describe("Source room ID or exact room name"),
      name: z.string().optional().describe("Optional display label"),
      visibility: z.
        enum(["all", "authenticated", "members", "owners", "mods"]).
        optional().
        describe("Who may see files from this link"),
      allowPrivateSource: z.
        boolean().
        optional().
        describe("Destination consent for an invite-only source"),
      rules: z.
        object({
          nameContains: z.
            string().
            optional().
            describe("Filename rule using comma/OR, AND, or /regex/flags"),
          tagContains: z.
            string().
            optional().
            describe("Tag key/value rule using comma/OR, AND, or /regex/flags"),
          userContains: z.
            string().
            optional().
            describe("Uploader username rule using comma/OR, AND, or /regex/flags"),
          types: z.array(z.string()).optional(),
          maxAgeHours: z.number().optional(),
          minAgeHours: z.number().optional(),
        }).
        optional(),
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
  defineTool(srv,
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
  defineTool(srv,
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
  defineTool(srv,
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
  defineTool(srv,
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
  defineTool(srv,
    "list_federated_room_links",
    "List a room's trusted cross-host Hobbyfiles links and live peer status. " +
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
  defineTool(srv,
    "create_federated_room_link",
    "Link a room from an operator-pinned Hobbyfiles peer. The source peer and " +
      "source room must independently allow access. Requires federation-links:write.",
    {
      roomid: z.string().describe("Destination room ID"),
      peerId: z.string().describe("Configured federation peer ID"),
      remoteRoomId: z.string().describe("Room ID on the remote peer"),
      name: z.string().max(160).optional(),
      visibility: z.
        enum(["all", "authenticated", "members", "owners", "mods"]).
        optional(),
      rules: z.
        object({
          nameContains: z.
            string().
            optional().
            describe("Filename rule using comma/OR, AND, or /regex/flags"),
          tagContains: z.
            string().
            optional().
            describe("Source tag rule using comma/OR, AND, or /regex/flags"),
          userContains: z.
            string().
            optional().
            describe("Source uploader rule using comma/OR, AND, or /regex/flags"),
          types: z.array(z.string()).optional(),
          maxAgeHours: z.number().optional(),
          minAgeHours: z.number().optional(),
        }).
        optional(),
    },
    async ({
      roomid,
      peerId,
      remoteRoomId,
      name,
      visibility,
      rules,
    }) =>
      wrap(
        await api(
          "POST",
          `/rooms/${encodeURIComponent(roomid)}/federation-links`,
          { peerId, roomId: remoteRoomId, name, visibility, rules },
        ),
      ),
  );

  // ── 23. remove_federated_room_link ─────────────────────────────────────
  defineTool(srv,
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
  defineTool(srv,
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

  // ── 25. list_room_plugins ─────────────────────────────────────────────
  defineTool(srv,
    "list_room_plugins",
    "List the bots invited to a room and the installed bot catalog. " +
      "Stored credentials are redacted. Requires room-plugins:read.",
    {
      roomid: z.string().describe("Room ID"),
    },
    async ({ roomid }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/plugins`,
        ),
      ),
  );

  // ── 26. configure_room_plugin ─────────────────────────────────────────
  defineTool(srv,
    "configure_room_plugin",
    "Invite or update one installed room bot. Existing secret settings are " +
      "preserved when omitted. Requires room-plugins:write.",
    {
      roomid: z.string().describe("Room ID"),
      pluginId: z.string().describe("Installed plugin ID"),
      enabled: z.boolean().optional(),
      label: z.string().max(80).optional(),
      config: z.
        record(z.unknown()).
        optional().
        describe("Plugin settings; may contain credentials"),
    },
    async ({ roomid, pluginId, enabled, label, config }) =>
      wrap(
        await api(
          "PUT",
          `/rooms/${encodeURIComponent(roomid)}/plugins/${
            encodeURIComponent(pluginId)}`,
          { enabled, label, config },
        ),
      ),
  );

  // ── 27. remove_room_plugin ────────────────────────────────────────────
  defineTool(srv,
    "remove_room_plugin",
    "Remove one invited bot from a room. Requires room-plugins:write.",
    {
      roomid: z.string().describe("Room ID"),
      pluginId: z.string().describe("Invited plugin ID"),
    },
    async ({ roomid, pluginId }) =>
      wrap(
        await api(
          "DELETE",
          `/rooms/${encodeURIComponent(roomid)}/plugins/${
            encodeURIComponent(pluginId)}`,
        ),
      ),
  );

  // ── 28. run_room_plugin ───────────────────────────────────────────────
  defineTool(srv,
    "run_room_plugin",
    "Run one invited room bot immediately and return its bounded result. " +
      "Requires room-plugins:run.",
    {
      roomid: z.string().describe("Room ID"),
      pluginId: z.string().describe("Invited plugin ID"),
      mode: z.enum(["run", "preview", "test", "digest"]).optional().describe("Optional mode from this bot's runModes; preview imports without downloading"),
    },
    async ({ roomid, pluginId, mode }) =>
      wrap(
        await api(
          "POST",
          `/rooms/${encodeURIComponent(roomid)}/plugins/` +
            `${encodeURIComponent(pluginId)}/run`,
          mode ? { mode } : undefined,
        ),
      ),
  );

  // ── 29. inspect_room_plugin_sync_memory ───────────────────────────────
  defineTool(srv,
    "inspect_room_plugin_sync_memory",
    "Inspect the bounded import-memory log for one invited room plugin, " +
      "including its most recent run. Requires room-plugins:read.",
    {
      roomid: z.string().describe("Room ID"),
      pluginId: z.string().describe("Invited plugin ID"),
      limit: z.number().min(1).max(200).optional(),
    },
    async ({ roomid, pluginId, limit }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/plugins/` +
            `${encodeURIComponent(pluginId)}/sync-log${
              limit ? `?limit=${encodeURIComponent(limit)}` : ""}`,
        ),
      ),
  );

  // ── 30. clear_room_plugin_sync_memory ─────────────────────────────────
  defineTool(srv,
    "clear_room_plugin_sync_memory",
    "Forget which remote files one room plugin has imported. This can cause " +
      "old remote files to be considered again. Requires room-plugins:write " +
      "and an explicit confirm=true.",
    {
      roomid: z.string().describe("Room ID"),
      pluginId: z.string().describe("Invited plugin ID"),
      confirm: z.
        boolean().
        describe("Must be true to confirm this destructive action"),
    },
    async ({ roomid, pluginId, confirm }) =>
      wrap(
        await api(
          "DELETE",
          `/rooms/${encodeURIComponent(roomid)}/plugins/` +
            `${encodeURIComponent(pluginId)}/sync-log`,
          { confirm },
        ),
      ),
  );

  defineTool(srv,
    "get_storage_volumes",
    "Inspect configured Hobbyfiles storage volumes, capacity, health, roles, " +
      "and placement thresholds. Requires admin:read.",
    {},
    async () => wrap(await api("GET", "/admin/storage")),
  );

  defineTool(srv,
    "preview_storage_placement",
    "Preview which storage volume would receive a new physical blob without " +
      "writing it. Requires admin:read.",
    {
      bytes: z.number().min(0).optional().describe("Expected blob size in bytes"),
    },
    async ({ bytes }) =>
      wrap(await api("POST", "/admin/storage/placement-preview", { bytes })),
  );

  defineTool(srv,
    "get_room_password_access",
    "Read the privacy-safe password-access policy and current period for a room. " +
      "Does not reveal passwords. Requires room-access:read.",
    { roomid: z.string().describe("Room ID") },
    async ({ roomid }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/password-access`,
        ),
      ),
  );

  defineTool(srv,
    "configure_room_password_access",
    "Enable, update, or disable rotating community-password access. " +
      "Requires room-access:write.",
    {
      roomid: z.string().describe("Room ID"),
      enabled: z.boolean(),
      rotation: z.enum(["monthly", "fixed-days"]).optional(),
      days: z.number().min(1).max(365).optional(),
      prepareDays: z.number().min(0).max(31).optional(),
      password: z.string().optional(),
    },
    async ({ roomid, ...body }) =>
      wrap(
        await api(
          "PATCH",
          `/rooms/${encodeURIComponent(roomid)}/password-access`,
          body,
        ),
      ),
  );

  defineTool(srv,
    "rotate_room_password",
    "Immediately rotate a protected room password and revoke existing visitor " +
      "grants. Requires room-access:write.",
    {
      roomid: z.string().describe("Room ID"),
      password: z.string().optional(),
    },
    async ({ roomid, password }) =>
      wrap(
        await api(
          "POST",
          `/rooms/${encodeURIComponent(roomid)}/password-access/rotate`,
          { password },
        ),
      ),
  );

  defineTool(srv,
    "reveal_room_passwords",
    "Reveal the current and prepared-next community passwords for secure owner " +
      "distribution. Requires the separate room-access:secrets scope.",
    { roomid: z.string().describe("Room ID") },
    async ({ roomid }) =>
      wrap(
        await api(
          "GET",
          `/rooms/${encodeURIComponent(roomid)}/password-access/secrets`,
        ),
      ),
  );
}

// ── Transport ──────────────────────────────────────────────────────────────

/**
 * Stateless Streamable HTTP transport (MCP 2026-07-28).
 *
 * `createMcpHandler` takes a factory and runs it once per request, so nothing
 * lives on the wire between calls: no `Mcp-Session-Id`, no `initialize`
 * handshake, and any request can land on any instance behind a load balancer.
 *
 * The handler validates no `Host`, no `Origin`, and no token itself, so the
 * guards below run in front of it. On a loopback bind the `Host` check is what
 * stops DNS rebinding, where a hostile page points its own domain at
 * 127.0.0.1 and the browser treats the local server as same-origin.
 */
function createHttpServer(options = {}) {
  const http = require("http");

  const host = options.host || process.env.MCP_HOST || "127.0.0.1";
  const authToken = options.authToken ?? process.env.MCP_AUTH_TOKEN ?? "";
  const oauthConfig = options.oauth ?? loadOAuthConfig(process.env.MCP_OAUTH_CONFIG);
  const oauth = oauthConfig ? createOAuthAuthorization(oauthConfig, options.oauthOptions) : null;
  if (oauth && authToken) {
    throw new Error("Choose OAuth or MCP_AUTH_TOKEN");
  }
  const parseList = value => String(value || "").split(",").map(v => v.trim()).filter(Boolean);
  const allowedHosts = options.allowedHosts ?? parseList(process.env.MCP_ALLOWED_HOSTS);
  const allowedOrigins = options.allowedOrigins ?? parseList(process.env.MCP_ALLOWED_ORIGINS);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!loopback && ((!authToken && !oauth) || !allowedHosts.length)) {
    throw new Error("Remote MCP requires MCP_AUTH_TOKEN and MCP_ALLOWED_HOSTS");
  }
  const handler = createMcpHandler(() => createServer());
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: 1024 * 1024 });
  const validateHost = allowedHosts.length ? hostHeaderValidation(allowedHosts) : localhostHostValidation();
  const validateOrigin = allowedOrigins.length ? originValidation(allowedOrigins) : localhostOriginValidation();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!validateHost(req, res) || !validateOrigin(req, res)) {
        return;
      }
      let pathname;
      try {
        ({ pathname } = new URL(req.url, "http://localhost"));
      }
      catch (_) {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }
      if (oauth && pathname === "/.well-known/oauth-protected-resource/mcp") {
        res.writeHead(req.method === "GET" ? 200 : 405, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(req.method === "GET" ? JSON.stringify(oauth.metadata) : "");
        return;
      }
      let caller;
      if (oauth) {
        const auth = await oauth.gate(new Request(new URL(req.url, oauth.resource), { headers: req.headers }));
        if (auth instanceof Response) {
          res.writeHead(auth.status, Object.fromEntries(auth.headers));
          res.end(await auth.text());
          return;
        }
        caller = { key: auth.extra.apiKey, scopes: auth.scopes };
        req.auth = auth;
      }
      if (authToken) {
        const provided = Buffer.from(req.headers.authorization || "");
        const expected = Buffer.from(`Bearer ${authToken}`);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          res.writeHead(401, { "WWW-Authenticate": "Bearer", "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      }
      if (pathname !== "/mcp") {
        res.writeHead(req.method === "GET" ? 200 : 404, {
          "Content-Type": "text/plain",
        });
        res.end(
          req.method === "GET" ?
            "Hobbyfiles MCP server running. POST /mcp for JSON-RPC.\n" :
            "Not Found",
        );
        return;
      }
      await CALLER.run(caller || { key: KEY, scopes: ["*"] }, () => nodeHandler(req, res));
    }
    catch (_) {
      if (res.headersSent) {
        res.destroy();
      }
      else {
        res.writeHead(500, { "Content-Type": "text/plain" }); res.end("MCP request failed");
      }
    }
  });
  return { httpServer, handler, host };
}

async function startHttpTransport() {
  const port = positiveInteger(process.env.MCP_PORT, 3001, "MCP_PORT", 65535);
  const { httpServer, handler, host } = createHttpServer();

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, resolve);
  });

  const shutdown = async () => {
    httpServer.close();
    await handler.close();
    httpServer.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.error(
    `[hobbyfiles-mcp] Stateless HTTP transport at http://${host}:${port}/mcp ` +
      "(protocol 2026-07-28, no sessions)",
  );
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    console.error(
      "[hobbyfiles-mcp] Remote callers require the MCP bearer token and an allowed Host. " +
        "Use TLS at the reverse proxy; OAuth callers use their mapped Hobbyfiles credentials.",
    );
  }
  return handler;
}

async function main() {
  if (process.env.MCP_TRANSPORT && !["http", "stdio"].includes(process.env.MCP_TRANSPORT)) {
    throw new Error("MCP_TRANSPORT must be stdio or http");
  }
  if (process.env.MCP_TRANSPORT === "http") {
    // createMcpHandler owns the per-request server instances.
    await startHttpTransport();
    return;
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(
    "[hobbyfiles-mcp] Stdio transport ready. Waiting for MCP client...",
  );
}

// Allow require()-ing this module without auto-starting (for tests)
if (require.main === module) {
  main().catch(err => {
    console.error("[hobbyfiles-mcp] Fatal:", err);
    process.exit(1);
  });
}

module.exports = { registerTools, createServer, createHttpServer, api };
