# Dicefiles MCP Reference (`scripts/mcp-server.js`)

This reference is written for developers who want to connect AI clients (Claude Desktop,
Cursor, Continue, OpenClaw, AutoGen) to a Dicefiles instance via the
[Model Context Protocol](https://modelcontextprotocol.io). It covers setup, all 14
exposed tools, security configuration, and worked multi-step workflows.

---

## 1. What MCP Means for Dicefiles

The REST API (`/api/v1`) describes what Dicefiles can do given raw HTTP calls. The MCP
server wraps every relevant endpoint as a **named tool with a typed schema**, so any MCP
client can discover and call them without writing any HTTP code.

From the moment Claude Desktop is pointed at a Dicefiles MCP server:

- Claude can list, filter, and download files without being given a URL.
- Claude can claim and fulfil open requests in a room as part of a tool-use loop.
- Claude can write AI captions, OCR excerpts, and structured tags back to files.
- Every call is authenticated with your existing API key — no session tokens, no CSRF.

---

## 2. Setup and Configuration

### 2.1 Prerequisites

Install the two runtime dependencies into the Dicefiles project once:

```bash
cd /path/to/Dicefiles
npm install @modelcontextprotocol/sdk zod
```

Smoke-test the server before wiring it into any client:

```bash
DICEFILES_BASE_URL=http://localhost:9090 \
DICEFILES_API_KEY=your-api-key-here \
node scripts/mcp-server.js
# → [dicefiles-mcp] Stdio transport ready. Waiting for MCP client...
# Ctrl-C to exit
```

Environment variables accepted by the server:

| Variable             | Default                 | Description                                   |
| -------------------- | ----------------------- | --------------------------------------------- |
| `DICEFILES_BASE_URL` | `http://localhost:9090` | Base URL of your Dicefiles instance           |
| `DICEFILES_API_KEY`  | _(empty)_               | Automation API key — warning printed if unset |
| `MCP_TRANSPORT`      | `stdio`                 | `stdio` (default) or `http`                   |
| `MCP_PORT`           | `3001`                  | Listening port when `MCP_TRANSPORT=http`      |

---

### 2.2 Claude Desktop

Config file locations:

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| Linux   | `~/.config/claude/claude_desktop_config.json`                     |

Add a `dicefiles` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "dicefiles": {
      "command": "node",
      "args": ["/absolute/path/to/Dicefiles/scripts/mcp-server.js"],
      "env": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. All 14 tools appear in the tool picker. Try: _"Use the
`server_health` tool to check my Dicefiles instance."_

---

### 2.3 VS Code (GitHub Copilot agent mode)

MCP tools are available in **agent mode** only (not standard chat).

**Workspace config** (checked into the repo — recommended for team use):

Create `.vscode/mcp.json` in the project root:

```json
{
  "servers": {
    "dicefiles": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/scripts/mcp-server.js"],
      "env": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**User-global config** (all workspaces — do not commit API keys):

Open `settings.json` (`Ctrl+Shift+P` → _Preferences: Open User Settings (JSON)_) and
add:

```json
{
  "mcp": {
    "servers": {
      "dicefiles": {
        "type": "stdio",
        "command": "node",
        "args": ["/absolute/path/to/Dicefiles/scripts/mcp-server.js"],
        "env": {
          "DICEFILES_BASE_URL": "http://localhost:9090",
          "DICEFILES_API_KEY": "your-api-key-here"
        }
      }
    }
  }
}
```

Reload VS Code. Open GitHub Copilot Chat, switch to **Agent** mode, and the Dicefiles
tools will be listed.

---

### 2.4 Antigravity

1. Open the agent panel and click the **`…`** dropdown at the top right.
2. Click **MCP store** → **Manage MCP Servers** → **View raw config**.
3. Edit `mcp_config.json` to add a Dicefiles entry under `mcpServers`:

```json
{
  "mcpServers": {
    "dicefiles": {
      "command": "node",
      "args": ["/absolute/path/to/Dicefiles/scripts/mcp-server.js"],
      "env": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Save and reload. The 13 tools are now available to Antigravity's agent.

---

### 2.5 Cursor

**Global** (`~/.cursor/mcp.json`) or **per-project** (`.cursor/mcp.json` in
project root):

```json
{
  "mcpServers": {
    "dicefiles": {
      "command": "node",
      "args": ["/absolute/path/to/Dicefiles/scripts/mcp-server.js"],
      "env": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or add via the UI: **File → Preferences → Cursor Settings → Features → MCP Servers →
Add new MCP server**.

---

### 2.6 Codex CLI

Codex uses TOML format at `~/.codex/config.toml`. The same file is shared by both the
CLI and the Codex VS Code extension. **Note: Codex currently supports stdio servers
only — the HTTP transport below is not compatible.**

```toml
# ~/.codex/config.toml

[mcp_servers.dicefiles]
command = "node"
args    = ["/absolute/path/to/Dicefiles/scripts/mcp-server.js"]

[mcp_servers.dicefiles.env]
DICEFILES_BASE_URL = "http://localhost:9090"
DICEFILES_API_KEY  = "your-api-key-here"
```

> **Important**: The section key must be `mcp_servers` (underscore). Using `mcpServers`
> or `mcp-servers` silently breaks detection.

Verify inside a Codex session by typing `/mcp` — the `dicefiles` server should appear.

---

### 2.7 OpenCode CLI

OpenCode reads `~/.config/opencode/opencode.json` (global) or
`opencode.json` / `opencode.jsonc` in the project root (workspace).

Unlike most clients, OpenCode expects `command` as an **array** (program + args
combined), not separate `command` and `args` fields:

```json
{
  "mcp": {
    "dicefiles": {
      "type": "local",
      "command": ["node", "/absolute/path/to/Dicefiles/scripts/mcp-server.js"],
      "environment": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart OpenCode after saving. Tools are accessible in the agent session immediately.

---

### 2.8 OpenClaw

OpenClaw supports two integration paths: the **mcporter registry** (for calling tools
from workflows) and an **agent skill** (for teaching the agent the full Dicefiles
workflow so it can act autonomously). Use both for the best experience.

#### mcporter (tool registry)

Add Dicefiles to `~/.config/mcporter.json`:

```json
{
  "mcpServers": {
    "dicefiles": {
      "command": "node",
      "args": ["/absolute/path/to/Dicefiles/scripts/mcp-server.js"],
      "env": {
        "DICEFILES_BASE_URL": "http://localhost:9090",
        "DICEFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or use the mcporter CLI:

```bash
mcporter add dicefiles -- node /absolute/path/to/Dicefiles/scripts/mcp-server.js
# then set env via mcporter env set dicefiles DICEFILES_API_KEY your-key
```

The tools are now callable from any OpenClaw workflow step.

#### Agent skill (autonomous operation)

For fully autonomous operation — where the agent understands Dicefiles rooms,
requests, and workflows without being prompted — install the bundled skill:

```bash
mkdir -p ~/.claude/skills/dicefiles
cp /path/to/Dicefiles/scripts/openclaw-dicefiles-skill/SKILL.md \
   ~/.claude/skills/dicefiles/
```

The skill teaches the agent the full 13-tool inventory, recommended call sequences,
error handling, and fulfillment loop patterns. See
`scripts/openclaw-dicefiles-skill/SKILL.md` for the full skill definition.

---

### 2.9 HTTP Transport (remote orchestrators)

For orchestrators that connect over the network (AutoGen, LangGraph, custom agents)
instead of spawning a local process:

```bash
MCP_TRANSPORT=http MCP_PORT=3001 node scripts/mcp-server.js
# → [dicefiles-mcp] HTTP transport listening at http://0.0.0.0:3001/mcp
```

Point your orchestrator at `http://<host>:3001/mcp`. The server implements the
Streamable HTTP MCP transport (`POST /mcp` for JSON-RPC, `GET /mcp` for SSE event
stream).

Protect the port with a reverse proxy (nginx, Caddy) and TLS before exposing it
beyond localhost.

---

## 3. Tool Matrix

| #   | Tool name               | Scope required   | Session |
| --- | ----------------------- | ---------------- | ------- |
| 1   | `server_health`         | None             | No      |
| 2   | `list_files`            | `files:read`     | No      |
| 3   | `get_file`              | `files:read`     | No      |
| 4   | `get_room_snapshot`     | `files:read`     | No      |
| 5   | `update_file_metadata`  | `files:write`    | No      |
| 6   | `upload_file_from_urls` | `uploads:write`  | No      |
| 7   | `create_request`        | `requests:write` | Yes     |
| 8   | `claim_request`         | `requests:write` | No      |
| 9   | `release_request`       | `requests:write` | No      |
| 10  | `post_room_chat`        | `rooms:write`    | Yes     |
| 11  | `download_file`         | None             | No      |
| 12  | `save_subscription`     | `files:read`     | No      |
| 13  | `list_subscriptions`    | `files:read`     | No      |
| 14  | `archive_list_contents` | `files:read`     | No      |

---

## 4. Tool Reference

### 4.1 `server_health`

Check server health and retrieve real-time metrics counters.

- **Maps to**: `GET /healthz`
- **Input**: _(none)_
- **Response**: Full health JSON (see API.md § 7.1)

```json
{
  "ok": true,
  "checks": {
    "redis": { "ok": true, "latencyMs": 1 },
    "storage": { "ok": true }
  },
  "metrics": { "uploadsCreated": 42, "downloadsServed": 130, "uptimeSec": 7200 }
}
```

> **What this enables**
>
> Use this as a pre-flight before long automation runs. If Redis is degraded the
> agent should pause and notify instead of blindly filing 50 upload requests into
> a broken queue. Claude Desktop can surface the health data in plain English:
> "Your Dicefiles server has been up for 2 hours and has served 130 downloads."

---

### 4.2 `list_files`

List files and/or requests in a room, with optional filters.

- **Maps to**: `GET /api/v1/files`
- **Input**:

| Field           | Type                                              | Required | Notes                                       |
| --------------- | ------------------------------------------------- | -------- | ------------------------------------------- |
| `roomid`        | string                                            | Yes      | Room ID                                     |
| `type`          | `"all"` \| `"uploads"` \| `"requests"` \| `"new"` | No       | Default `"all"`                             |
| `since`         | number (unix ms)                                  | No       | Required when `type=new`                    |
| `name_contains` | string                                            | No       | Case-insensitive substring                  |
| `ext`           | string                                            | No       | Comma-separated extensions, e.g. `pdf,epub` |

- **Response**: Same as `GET /api/v1/files` (see API.md § 6.8)

> **What this enables**
>
> The primary discovery tool. An agent maintaining a book archive calls this with
> `type=new&since=<lastSeenMs>` every few minutes to find newly uploaded documents,
> then enriches each one using `update_file_metadata`. The `name_contains` and `ext`
> filters let agents narrow to just the files they care about before fetching metadata,
> keeping context windows small.

---

### 4.3 `get_file`

Fetch the full metadata shape for a single file by key.

- **Maps to**: `GET /api/v1/file/:key`
- **Input**:

| Field | Type   | Required |
| ----- | ------ | -------- |
| `key` | string | Yes      |

- **Response**: `{ ok, file: { key, name, tags, meta, href, … } }`

> **What this enables**
>
> Call this before enriching a file to check whether `meta.ai_caption` is already
> populated. Saves an expensive vision-model call if the work was already done by a
> previous agent run. Also useful for reading an author's name before posting a
> chat message: "Uploaded: Neuromancer by William Gibson."

---

### 4.4 `get_room_snapshot`

Get an aggregate summary of a room in one call.

- **Maps to**: `GET /api/v1/room/:roomid/snapshot`
- **Input**:

| Field    | Type   | Required |
| -------- | ------ | -------- |
| `roomid` | string | Yes      |

- **Response**: `{ ok, roomid, fileCount, totalBytes, openRequestCount, uploaders, oldestExpiry }`

> **What this enables**
>
> Answers "what's in the books room?" at a glance. An orchestrator deciding whether
> to run a large enrichment pass checks the snapshot first — if `fileCount` is 0
> there's nothing to do. If `openRequestCount > 0` the fulfillment agent should
> spin up.

---

### 4.5 `update_file_metadata`

Write structured tags and AI-generated metadata back to a file.

- **Maps to**: `PATCH /api/v1/file/:key`
- **Scope**: `files:write`
- **Input**:

| Field  | Type   | Required |
| ------ | ------ | -------- |
| `key`  | string | Yes      |
| `meta` | object | No       |
| `tags` | object | No       |

`meta` fields: `description`, `ai_caption`, `ocr_text_preview`

`tags` fields: `title`, `author`, `genre`, `language`, `series`

- **Response**: `{ ok, key, hash }`

> **What this enables**
>
> This is the enrichment write-back endpoint — the closed loop that turns Dicefiles
> into a self-curating library. After any new upload the enrichment agent:
>
> 1. Calls `get_file` to check for existing metadata.
> 2. Sends the cover thumbnail to a vision model → stores result via `ai_caption`.
> 3. Runs a book-catalog lookup (Open Library, Google Books) → stores `author`, `series`.
> 4. Optionally runs OCR → stores `ocr_text_preview`.
>
> Browser users see the enriched gallery data immediately, with no manual tagging.

---

### 4.6 `upload_file_from_urls`

Fetch one or more public URLs server-side and store them as uploads in a room.

- **Maps to**: `POST /api/v1/batch-upload`
- **Scope**: `uploads:write`
- **Input**:

| Field    | Type             | Required | Limits                                     |
| -------- | ---------------- | -------- | ------------------------------------------ |
| `roomid` | string           | Yes      |                                            |
| `urls`   | array of strings | Yes      | 1–20 URLs, each a valid `http`/`https` URL |

Max 100 MB per file, 60 second server-side fetch timeout.

- **Response**: `{ ok, results: [{ url, key?, err? }] }`

> **What this enables**
>
> Let Claude autonomously populate a room. Tell it "add the latest D&D errata from
> [URL]" and it calls this tool — the server fetches the PDF directly, so the agent
> never streams binary data through the context window. Up to 20 URLs in one call
> means a single assistant turn can ingest a whole reading list.

---

### 4.7 `create_request`

Create an open file request in a room.

- **Maps to**: `POST /api/v1/requests`
- **Scope**: `requests:write`
- **Session required**: Yes
- **Input**:

| Field    | Type   | Required | Notes                             |
| -------- | ------ | -------- | --------------------------------- |
| `roomid` | string | Yes      |                                   |
| `text`   | string | Yes      | Max 200 chars                     |
| `url`    | string | No       | Reference URL (product page etc)  |
| `hints`  | object | No       | `type`, `keywords`, `max_size_mb` |

- **Response**: `{ ok, request: {} }`

> **What this enables**
>
> An agent can queue requests for a human (or another agent) to fulfil. A librarian
> agent scanning a wishlist CSV creates one request per row, sets `hints.keywords`
> to help the fulfillment agent find the right file later, then steps back. The
> hints object is stored alongside the request and returned in `list_files
type=requests`, forming a structured RPC-like request channel between agents.

---

### 4.8 `claim_request`

Claim an open request to signal exclusive ownership.

- **Maps to**: `POST /api/v1/requests/:key/claim`
- **Scope**: `requests:write`
- **Input**:

| Field   | Type   | Required | Default  | Notes                                                   |
| ------- | ------ | -------- | -------- | ------------------------------------------------------- |
| `key`   | string | Yes      |          | Request key from `list_files type=requests`             |
| `ttlMs` | number | No       | `300000` | Auto-release after this many milliseconds (5 min– 1 hr) |

- **Response**: `{ ok, key, claimedUntil }` or `{ err: "already_claimed" }` with HTTP 409

> **What this enables**
>
> In a multi-agent environment with several fulfillment bots running in parallel,
> `claim_request` prevents two agents simultaneously downloading and uploading the
> same file. The TTL means a crashed agent doesn't starve the queue forever — the
> claim self-releases and another agent picks it up.

---

### 4.9 `release_request`

Release a previously claimed request back to open state immediately.

- **Maps to**: `DELETE /api/v1/requests/:key/claim`
- **Scope**: `requests:write`
- **Input**:

| Field | Type   | Required |
| ----- | ------ | -------- |
| `key` | string | Yes      |

- **Response**: `{ ok, key }`

> **What this enables**
>
> Graceful abort: when the agent determines that it cannot fulfill a request (source
> URL is paywalled, file exceeds size limit, wrong format) it calls this immediately
> rather than waiting up to 5 minutes for TTL expiry. Another agent can then pick up
> the request without delay.

---

### 4.10 `post_room_chat`

Post a message into a room's chat channel.

- **Maps to**: `POST /api/v1/room/:roomid/chat`
- **Scope**: `rooms:write`
- **Session required**: Yes
- **Input**:

| Field    | Type   | Required | Limits                              |
| -------- | ------ | -------- | ----------------------------------- |
| `roomid` | string | Yes      |                                     |
| `text`   | string | Yes      | Max 500 chars                       |
| `nick`   | string | No       | Override display name for the agent |

- **Response**: `{ ok }`

> **What this enables**
>
> Real-time transparency. Users watching the room see the agent narrate its activity:
> "Claiming request: Neuromancer EPUB." / "Upload complete. Releasing claim."
> This bridges the gap between automated background work and human observers, so users
> understand why files are appearing and requests are disappearing.

---

### 4.11 `download_file`

Download a file from the room and return it as a base64 string.

- **Maps to**: `GET /g/:key` (public download endpoint)
- **Input**:

| Field      | Type   | Required | Default   | Notes                                                |
| ---------- | ------ | -------- | --------- | ---------------------------------------------------- |
| `key`      | string | Yes      |           | File key                                             |
| `maxBytes` | number | No       | 5 242 880 | Abort if file exceeds this byte count (5 MB default) |

- **Response**: `{ ok, key, filename, contentType, sizeBytes, content_base64 }` or `{ ok: false, err, sizeBytes }` if over limit.

> **What this enables**
>
> Pull smaller documents directly into the agent context — an EPUB, a short PDF,
> a plain-text manifest. For large files (over the `maxBytes` guard) the tool
> returns an error with the actual size and the direct URL, letting the agent decide
> whether to proceed. Never stream more than you meant to.

---

### 4.12 `save_subscription`

Save a named filter preset for this API key.

- **Maps to**: `POST /api/v1/agent/subscriptions`
- **Scope**: `files:read`
- **Input**:

| Field           | Type            | Required |
| --------------- | --------------- | -------- |
| `name`          | string          | Yes      |
| `room`          | string          | No       |
| `ext`           | array of string | No       |
| `name_contains` | string          | No       |
| `max_size_mb`   | number          | No       |
| `type`          | string          | No       |

- **Response**: `{ ok, id }`

> **What this enables**
>
> Agents that restart after a crash or deployment shouldn't hardcode their
> filter configuration in environment variables or agent memory. Instead they save
> their subscription at startup, retrieve it with `list_subscriptions` on the
> next run, and reconstruct their polling loop — no state management code required.

---

### 4.13 `list_subscriptions`

Retrieve all saved filter subscriptions for this API key.

- **Maps to**: `GET /api/v1/agent/subscriptions`
- **Scope**: `files:read`
- **Input**: _(none)_
- **Response**: `{ ok, subscriptions: [{ id, name, room?, ext?, … }] }`

> **What this enables**
>
> The complement to `save_subscription`. Call this at every agent startup before
> entering the polling loop. The agent reconstructs its watching configuration from
> server state, making the agent stateless and crash-resilient by default.

---

## 5. Security Model

### 5.1 Authentication

Every call from `scripts/mcp-server.js` adds `Authorization: Bearer <key>` to the
outgoing REST request. The same scoped-key system described in API.md § 3 applies here:
each API key is configured with specific scopes in `.config.json`.

Recommended key setup for full agent access:

```json
{
  "automationApiKeys": [
    {
      "id": "agent-full",
      "key": "replace-with-random-secret",
      "scopes": [
        "files:read",
        "files:write",
        "uploads:write",
        "requests:write",
        "rooms:write"
      ]
    }
  ]
}
```

For a read-only agent (monitoring, indexing, snapshots only):

```json
{
  "id": "agent-readonly",
  "key": "replace-with-random-readonly-key",
  "scopes": ["files:read"]
}
```

### 5.2 What the MCP Server Cannot Do

The MCP server exposes a curated subset of the API. It cannot:

- Delete files or requests (`files:delete`)
- Access moderation endpoints (`mod:*`)
- Issue sessions for other users
- Call any admin-only endpoint

Scopes are enforced server-side on every request; the MCP layer adds no extra gates
and removes no existing ones.

### 5.3 Network Exposure

- **Stdio mode** (default): the MCP process is only accessible to a parent process
  that started it (Claude Desktop, Cursor). No network port is opened.
- **HTTP mode** (`MCP_TRANSPORT=http`): the server binds on `0.0.0.0:MCP_PORT`.
  Put it behind a reverse proxy with TLS if it needs to be reachable over the internet.

---

## 6. Workflow Examples

### 6.1 Claude Desktop — book archive assistant

Configure Claude Desktop with the MCP server and prompt:

> "Check the books room (@books) for any files I haven't seen before, summarize
> what's new, and for any untagged EPUB, look up the author and language on Open
> Library and write the tags back."

Expected tool sequence:

1. `server_health` — pre-flight
2. `list_files` → `roomid=books&type=new&since=<lastSeenMs>`
3. `get_file` for each untagged file
4. External LLM/tool call to Open Library
5. `update_file_metadata` for each enriched file
6. Summary text to user

### 6.2 Request Fulfillment Loop (multi-agent)

Two agents running concurrently:

**Watcher agent** (runs every 5 min via cron):

1. `list_files` → `type=requests`
2. For each unclaimed request: `claim_request` → `ttlMs=120000`
3. Search source for matching file → `upload_file_from_urls`
4. `release_request` (or it auto-releases after TTL if agent crashes)
5. `post_room_chat` → "Fulfilled: [request text]"

**Monitor agent** (reads but doesn't write):

1. `get_room_snapshot` — logs counts
2. `list_files` → `type=new&since=<lastSeenMs>` — index new arrivals
3. `save_subscription` at startup — persists filter config serverside

### 6.3 OpenClaw Pipeline — enrichment pass

Triggered by a `file_uploaded` webhook event:

```js
// orchestrator step 1 — skip if already enriched
const { file } = await mcp.call("get_file", { key });
if (file.meta?.ai_caption) return;

// step 2 — caption via vision model
const caption = await vision.describe(`${BASE}/g/${key}`);

// step 3 — catalog lookup
const catalog = await openLibrary.search(file.name);

// step 4 — write back
await mcp.call("update_file_metadata", {
  key,
  meta: { ai_caption: caption },
  tags: {
    author: catalog.author,
    genre: catalog.genre,
    language: catalog.language,
  },
});

// step 5 — announce
await mcp.call("post_room_chat", {
  roomid: file.roomid,
  text: `Enriched: ${file.name} — ${caption}`,
  nick: "Scribe",
});
```

---

### 4.14 `archive_list_contents`

List every entry inside a ZIP, RAR, 7z, or TAR archive stored in Dicefiles.

- **Maps to**: `GET /api/v1/archive/:key/ls`
- **Scope**: `files:read`
- **Input**:

| Field | Type   | Required |
| ----- | ------ | -------- |
| `key` | string | Yes      |

- **Response**: `{ ok, key, name, format, entries: [{ path, name, size, compressedSize }] }`

> **What this enables**
>
> An agent evaluating an uploaded ZIP can call this tool before deciding to download
> or extract anything. "Show me what's in `collection.zip`" triggers a single tool
> call that returns the full file tree — no download, no byte streaming through the
> context window. The agent can then select specific entries worth extracting via the
> `GET /api/v1/archive/:key/file?path=…` endpoint documented in API.md § 22.2.

---

_See also: [API.md](API.md) for the underlying REST API reference._
