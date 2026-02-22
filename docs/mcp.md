# Dicefiles MCP Integration Guide

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is an open standard
by Anthropic that lets AI clients — Claude Desktop, Cursor IDE, Continue.dev, VS Code
Copilot, custom agents using the MCP SDK — call **tools** on a server. The protocol
speaks JSON-RPC 2.0 over stdio (for local agents) or HTTP/SSE (for remote agents).

Think of it as a standardized plugin interface: you define a tool with a name,
description, and input schema. Any MCP-compatible client can then call that tool
without knowing anything about the underlying implementation.

## The "can Dicefiles run as an MCP server?" question

**Short answer**: Dicefiles is a REST server. It doesn't speak MCP natively. But it has
exactly the right API surface to be wrapped as one, and that wrapper is small.

**Long answer**: ~300 lines of Node.js using the official `@modelcontextprotocol/sdk`
package. The wrapper translates MCP tool calls into Dicefiles REST calls and returns
the results as MCP tool responses. Local agents connect via stdio; remote agents
connect via HTTP. Claude Desktop sees Dicefiles as a first-class MCP server it can
invoke whenever appropriate.

This approach is the standard pattern for wrapping any existing REST API as an MCP
server (GitHub, Linear, Slack all have community-built MCP wrappers that work the
same way).

---

## Scoped for implementation: `scripts/mcp-server.js`

> **Status**: This file is scoped for implementation in the P2 AI Automation roadmap.
> See `TODO.md` for priority and execution order.

### Setup

```bash
npm install @modelcontextprotocol/sdk node-fetch   # or: node-fetch is built-in Node 18+

# Configuration via env vars
export DICEFILES_BASE_URL=http://localhost:9090
export DICEFILES_API_KEY=your-agent-api-key-here

# Stdio mode (Claude Desktop, Cursor)
node scripts/mcp-server.js

# HTTP mode (remote agents — future)
MCP_TRANSPORT=http MCP_PORT=3001 node scripts/mcp-server.js
```

### Claude Desktop config

Add to `~/.config/claude-desktop/config.json` (Linux) or the equivalent on macOS:

```json
{
  "mcpServers": {
    "dicefiles": {
      "command": "node",
      "args": ["/path/to/Dicefiles/scripts/mcp-server.js"],
      "env": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The Dicefiles tools will appear in the tool picker.
Claude can now answer questions like `"What's in the books room?"` by calling
`list_files` behind the scenes.

---

## Tool definitions

Each tool maps directly to one or more REST calls. The `files:read`-scoped key is
read-only and safe to hand to assistants for browsing; give `uploads:write` and
`requests:write` only to agents that should be able to act.

### `list_files`

Lists files (and/or requests) in a room, with optional filters.

**Input schema**:

```json
{
  "roomid": "AbCdEf1234",
  "type": "all",
  "since": 1739870000000,
  "name_contains": "neuromancer",
  "ext": "epub,pdf"
}
```

**Maps to**: `GET /api/v1/files`

**Scope**: `files:read`

---

### `get_file`

Returns the full metadata object for a single file by key.

**Input schema**:

```json
{ "key": "abc123" }
```

**Maps to**: `GET /api/v1/file/:key`

**Scope**: `files:read`

---

### `get_room_snapshot`

Returns aggregate stats for a room: file count, total bytes, open requests,
unique uploaders, oldest expiry.

**Input schema**:

```json
{ "roomid": "AbCdEf1234" }
```

**Maps to**: `GET /api/v1/room/:id/snapshot`

**Scope**: `files:read`

---

### `download_file`

Fetches a file and returns its content as a base64 string (for the MCP client
to handle). Includes `filename` and `contentType` in the response.

**Input schema**:

```json
{ "key": "abc123" }
```

**Maps to**: `GET /g/:key` (direct download route)

**Scope**: `files:read` (API key is passed as bearer token to the download route)

> **Note on large files**: The MCP client will receive the entire file as a base64
> blob in the JSON response. This works fine for documents up to a few MB; for very
> large files it's better to return the `href` and let the client or user fetch it
> directly.

---

### `upload_file_from_urls`

Fetches one or more URLs server-side and stores them as uploads in a room.

**Input schema**:

```json
{
  "roomid": "AbCdEf1234",
  "urls": ["https://example.com/book.pdf", "https://example.com/other.epub"]
}
```

**Maps to**: `POST /api/v1/batch-upload`

**Scope**: `uploads:write`

---

### `create_request`

Creates a file request in a room, with optional structured hints.

**Input schema**:

```json
{
  "roomid": "AbCdEf1234",
  "text": "Please upload the 2023 IPCC climate report",
  "hints": {
    "type": "document",
    "keywords": ["IPCC", "climate", "2023"],
    "max_size_mb": 50
  }
}
```

**Maps to**: `POST /api/v1/requests`

**Scope**: `requests:write`

---

### `claim_request`

Claims an open request, marking it as in-progress for this agent.
Returns `409` if already claimed by another agent.

**Input schema**:

```json
{ "key": "req_abc123", "ttlMs": 300000 }
```

**Maps to**: `POST /api/v1/requests/:key/claim`

**Scope**: `requests:write`

---

### `release_request`

Releases a previously claimed request back to open state.

**Input schema**:

```json
{ "key": "req_abc123" }
```

**Maps to**: `DELETE /api/v1/requests/:key/claim`

**Scope**: `requests:write`

---

### `update_file_metadata`

Writes AI-enriched metadata back to a file: captions, OCR previews, author/genre tags.

**Input schema**:

```json
{
  "key": "abc123",
  "meta": {
    "ai_caption": "A noir sci-fi novel set in cyberspace.",
    "ocr_text_preview": "Chapter One: The expedition departs..."
  },
  "tags": {
    "author": "William Gibson",
    "genre": "Cyberpunk",
    "series": "Sprawl Trilogy"
  }
}
```

**Maps to**: `PATCH /api/v1/file/:key`

**Scope**: `files:write`

---

### `post_room_chat`

Posts a chat message into a room from the agent.

**Input schema**:

```json
{
  "roomid": "AbCdEf1234",
  "text": "Found it! Uploading now...",
  "nick": "BookBot"
}
```

**Maps to**: `POST /api/v1/room/:id/chat`

**Scope**: `rooms:write`

---

### `save_subscription`

Saves a named filter preset for what this agent is interested in watching.

**Input schema**:

```json
{
  "name": "new-books",
  "room": "AbCdEf1234",
  "ext": [".pdf", ".epub"],
  "type": "document"
}
```

**Maps to**: `POST /api/v1/agent/subscriptions`

**Scope**: `files:read`

---

### `list_subscriptions`

Returns all saved filter subscriptions for this API key.

**Maps to**: `GET /api/v1/agent/subscriptions`

**Scope**: `files:read`

---

### `server_health`

Returns the health check response including metrics counters.

**Maps to**: `GET /healthz`

**Scope**: none (public endpoint)

---

## Reference implementation sketch

```js
"use strict";
// scripts/mcp-server.js — Dicefiles MCP server wrapper
// Requires: @modelcontextprotocol/sdk

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const BASE = process.env.DICEFILES_BASE_URL || "http://localhost:9090";
const KEY = process.env.DICEFILES_API_KEY || "";

const headers = {
  "Content-Type": "application/json",
  ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
};

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

const server = new McpServer({ name: "dicefiles", version: "1.1.0" });

server.tool(
  "list_files",
  "List files and requests in a Dicefiles room with optional filters",
  {
    roomid: z.string().describe("Room ID"),
    type: z.enum(["all", "uploads", "requests", "new"]).optional(),
    since: z.number().optional().describe("Unix ms timestamp"),
    name_contains: z.string().optional(),
    ext: z.string().optional().describe("Comma-separated extensions"),
  },
  async ({ roomid, type, since, name_contains, ext }) => {
    const qs = new URLSearchParams({ roomid });
    if (type) qs.set("type", type);
    if (since) qs.set("since", String(since));
    if (name_contains) qs.set("name_contains", name_contains);
    if (ext) qs.set("ext", ext);
    const data = await api("GET", `/files?${qs}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_file",
  "Get full metadata for a single file",
  { key: z.string() },
  async ({ key }) => {
    const data = await api("GET", `/file/${key}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_room_snapshot",
  "Get aggregate statistics for a room",
  { roomid: z.string() },
  async ({ roomid }) => {
    const data = await api("GET", `/room/${roomid}/snapshot`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "post_room_chat",
  "Post a chat message into a room from the agent",
  {
    roomid: z.string(),
    text: z.string().max(500),
    nick: z.string().optional(),
  },
  async ({ roomid, text, nick }) => {
    const data = await api("POST", `/room/${roomid}/chat`, { text, nick });
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.tool(
  "server_health",
  "Check Dicefiles server health and metrics",
  {},
  async () => {
    const res = await fetch(`${BASE}/healthz`);
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ... additional tools follow the same pattern

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Dicefiles MCP server running (stdio)");
}

main().catch(console.error);
```

---

## Security model

- The MCP wrapper holds one API key with specifically scoped permissions.
- Use a **read-only key** (`files:read`) for browsing/assistant bots.
- Use a **full-agent key** (`files:read,files:write,uploads:write,requests:write,rooms:write`)
  for automated fulfillment bots.
- Never give an MCP wrapper `admin:read`, `files:delete`, or `mod:*` unless the
  agent explicitly needs those capabilities.
- The stdio transport only exposes the tools to the local MCP client process. No
  network exposure.
- HTTP transport (remote mode) should sit behind a reverse proxy with TLS and
  appropriate access controls.

---

## Agentic workflow examples

### Claude Desktop: browsing assistant

1. User opens Claude Desktop, types: `"What EPUBs are in the fantasy-books room?"`
2. Claude calls `list_files({ roomid: "fantasy-books", ext: "epub" })`
3. Claude reads the response and answers: `"There are 14 EPUBs — here are the 5
most recent: ..."`

### Claude Desktop: request fulfillment

1. User: `"Fulfill the open requests in the library room"`
2. Claude calls `list_files({ roomid: "library", type: "requests" })`
3. For each open request, Claude calls `claim_request`, searches externally,
   calls `upload_file_from_urls`, then `post_room_chat` to notify the room.

### OpenClaw / multi-agent: nightly enrichment pipeline

```
[list_files since=yesterday] →
  [for each file without ai_caption] →
    [call vision LLM] →
    [update_file_metadata with ai_caption] →
    [save_subscription to track future uploads]
```

### CrewAI: room content auditor

```python
class DicefilesAuditorAgent(Agent):
    tools = [
        DicefilesMCPTool("get_room_snapshot"),
        DicefilesMCPTool("list_files"),
        DicefilesMCPTool("server_health"),
    ]
    goal = "Summarize room activity and flag unusual patterns"
```
