# AI Agent Automation Guide — Dicefiles

This document catalogues automation use cases for AI agents operating against a Dicefiles
instance. It serves as a living proposal file: anything here is a candidate to implement,
not a commitment. Items marked **\[implemented\]** are available today; everything else is a
proposal for later evaluation.

---

## Prerequisites

All automation uses the stable `/api/v1` endpoint namespace with a scoped API key.
See `API.md` for the complete reference.

```bash
# Quick smoke-test: list files in room "media"
curl -sH "Authorization: Bearer $DICEFILES_API_KEY" \
     "https://your-instance/api/v1/files?roomid=media"
```

Set `DICEFILES_API_KEY` to an API key with the minimum scope required for the task.

---

## 1 — Real-time File Monitoring

**Goal**: An agent watches a room and reacts to every new file that appears.

### How it works today **\[implemented\]**

Poll `/api/v1/files?roomid=<room>&since=<timestamp>` on a short interval and compare
against a locally persisted high-water mark. The `since` parameter takes a Unix ms
timestamp and returns only files uploaded after it.

```js
// Minimal polling loop (Node 18+)
let since = Date.now();
async function poll() {
  const res = await fetch(
    `${BASE}/api/v1/files?roomid=${ROOM}&since=${since}`,
    {
      headers: { Authorization: `Bearer ${KEY}` },
    },
  );
  const { files } = await res.json();
  for (const f of files) {
    console.log("New file:", f.name, f.href);
    since = Math.max(since, f.uploaded + 1);
  }
}
setInterval(poll, 5000);
```

### Proposed: webhook push **\[proposal\]**

Rather than polling, register a webhook for the `file_uploaded` event. The server will
POST to your agent's endpoint within seconds of every upload, eliminating poll latency
and reducing API traffic. See the Webhooks section of `API.md`.

```json
// .config.json
{
  "webhooks": [
    {
      "url": "https://your-agent.example.com/hooks/dicefiles",
      "events": ["file_uploaded", "request_fulfilled"],
      "secret": "shared-hmac-secret"
    }
  ]
}
```

Verify the `x-dicefiles-signature` header before processing:

```js
const crypto = require("crypto");
function verify(secret, timestamp, body, sig) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

---

## 2 — Conditional Auto-Download

**Goal**: An agent monitors incoming files and automatically downloads those matching a
user's criteria (file type, room, keyword in name, size range, uploader, tags, etc.).

### Polling-based implementation **\[partially implemented\]**

1. Poll `/api/v1/files?roomid=<room>&since=<ts>` (or use webhooks above).
2. Apply local filter conditions to each `file` object.
3. Download matching files via `GET /api/v1/download/<hash>` (or the file's `href`).

```js
async function maybeDownload(file) {
  if (!file.name.match(/\.(pdf|epub|mobi)$/i)) return; // only books
  if (file.size > 200 * 1024 * 1024) return; // skip >200 MB
  const dest = path.join("~/Downloads", file.name);
  const stream = fs.createWriteStream(dest);
  const res = await fetch(`${BASE}${file.href}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  await pipeline(res.body, stream);
  console.log("Downloaded:", dest);
}
```

### Proposed: resume-on-restart **\[proposal\]**

Persist the high-water mark and a local manifest of already-downloaded hashes to a small
SQLite or JSON file. On agent restart, replay missed events since the last persisted
timestamp. This prevents gaps when the agent is offline briefly.

### Agent subscription presets **\[implemented\]**

`POST/GET/DELETE /api/v1/agent/subscriptions` — save named filter presets per API key.
Agents register their interests at startup and retrieve them on restart, eliminating
hardcoded filter config. See API.md §17.

---

## 3 — Agent-Triggered Upload

**Goal**: A user asks an AI assistant "upload this file to the media room" and the agent
does it automatically.

### API **\[implemented\]**

```bash
curl -X PUT "$BASE/api/v1/upload?roomid=media&name=report.pdf" \
     -H "Authorization: Bearer $KEY" \
     --data-binary @report.pdf
```

The response includes `{ key, href, expires }`.

### Multi-file upload from URL list **\[implemented\]**

`POST /api/v1/batch-upload` — JSON array of `{url, name, roomid}` objects. The server
fetches each URL with a 100 MB cap and 60-second timeout. Max 20 items per call.
Returns per-item `ok/error`. See API.md §15.

### Proposed: upload from clipboard / base64 **\[proposal\]**

Accept a `Content-Transfer-Encoding: base64` variant of the PUT endpoint so mobile
agents or browser extensions can upload without a dedicated multipart form layer.

---

## 4 — Metadata Enrichment

**Goal**: An agent adds or updates tags, descriptions, and structured metadata on existing
files after upload (e.g., OCR-derived text, AI-generated caption, archive index).

### Metadata PATCH API **\[implemented\]**

`PATCH /api/v1/file/:key` accepts:

```json
{
  "tags": { "genre": "sci-fi", "language": "en" },
  "meta": {
    "description": "A short synopsis …",
    "ai_caption": "Cover shows a starship emerging from hyperspace.",
    "ocr_text_preview": "Chapter One: The expedition departs …"
  }
}
```

Scoped API key requirement: `files:write`. See API.md §12.2.

### AI-generated cover images **\[implemented\]**

`POST /api/v1/file/:key/asset/cover` — raw JPEG body (max 5 MB). The server validates
with sharp, encodes at quality 85, and replaces the existing thumbnail. See API.md §12.3.

---

## 5 — Request Workflow Automation

**Goal**: An agent monitors open requests in a room and auto-fulfills them when it can
find a matching resource.

### How it works today **\[implemented\]**

1. Poll `/api/v1/requests?roomid=<room>` for open requests.
2. Match request text against the agent's knowledge base or external search index.
3. Upload the matching file via `PUT /api/v1/upload?roomid=<room>&fulfillsRequest=<key>`.
4. The server marks the request as fulfilled and links the file to it.

Webhook `request_created` fires for new requests; `request_fulfilled` fires when one is
resolved — subscribe to both for a complete event log.

### Agent request claiming **\[implemented\]**

`POST /api/v1/requests/:key/claim` — single-agent lock with auto-release TTL (default 5 min).
`DELETE /api/v1/requests/:key/claim` — release early. Returns `409` if already claimed
by another agent. See API.md §16.

### Structured request hints **\[implemented\]**

Extend request creation to accept structured fields (beyond free text) that agents can
match more reliably:

```json
{
  "text": "Share the 2023 IPCC climate report",
  "hints": {
    "type": "pdf",
    "keywords": ["IPCC", "climate", "2023"],
    "max_size_mb": 50
  }
}
```

---

## 6 — Room Management

**Goal**: An agent performs moderation or housekeeping tasks in response to triggers.

### Proposed: auto-expire on inactivity **\[proposal\]**

Add an endpoint `POST /api/v1/room/:id/set-expiry` that shortens all file TTLs in a room
to a given duration when triggered by an agent (e.g., "clear this room in 24 hours").

### Proposed: content policy enforcement **\[proposal\]**

An agent subscribes to `file_uploaded` webhooks, runs the received file metadata through
an AI content classifier, and calls `DELETE /api/v1/file/:hash` (mod scope) if the
classifier flags it. The server already supports mod-level deletion via the API; the
missing piece is an action webhook that includes the full `href` for the agent to
download and inspect.

### Proposed: room summary on snapshot **\[proposal\]**

`GET /api/v1/room/:id/snapshot` returns a compact summary:

```json
{
  "roomid": "books",
  "file_count": 142,
  "total_bytes": 3200000000,
  "open_requests": 7,
  "unique_uploaders": 12,
  "oldest_expires": "2026-03-15T00:00:00Z"
}
```

Useful for agents that generate a human-readable digest of what's in a room.

---

## 7 — Conversational File Assistant

**Goal**: A user chats with an AI that can answer questions about files in the room
("What books were uploaded this week?", "Is there a PDF of the meeting notes?",
"Download the largest video to my laptop.").

### Building blocks needed **\[proposal\]**

| Capability            | API surface needed                                               |
| --------------------- | ---------------------------------------------------------------- |
| List and search files | `GET /api/v1/files` with `name_contains`, `ext`, `type`, `since` |
| Read file metadata    | `GET /api/v1/file/:hash` (not yet available — proposal)          |
| Download file         | `GET /api/v1/download/:hash` or file `href`                      |
| Upload file           | `PUT /api/v1/upload`                                             |
| Fulfill request       | Upload with `fulfillsRequest` query param                        |
| Post a chat message   | Not in API yet — proposal below                                  |

### Agent chat messages **\[implemented\]**

`POST /api/v1/room/:id/chat` — body: `{ text, nick, replyTo }`. Agents appear in the
room chat with a distinct `role:"agent"` badge. Enables two-way interaction: user
requests in chat, agent acts on the API, agent replies with results. See API.md §13.1.

---

## 8 — Observability and Audit

**Goal**: An ops agent monitors server health and surfaces anomalies.

### Health check **\[implemented\]**

```bash
curl http://your-instance/healthz
# → {"ok":true,"redis":"ok","storage":"ok","uptime_s":3600,...}
```

### Metrics endpoint **\[implemented\]**

`GET /api/v1/metrics` (`admin:read`) — JSON counters from `lib/observability.js`.
See API.md §14.1.

### Audit log **\[implemented\]**

`GET /api/v1/audit?since=<iso>&limit=<n>` (`admin:read`) — paginated JSON lines of
automation API events, newest first. See API.md §14.2.

---

## 9 — Integration Recipes

### Recipe: Discord bot

1. Discord bot receives DM "upload this to #media: [URL]"
2. Bot fetches the URL and streams it to `PUT /api/v1/upload?roomid=media`
3. Bot replies with the resulting `href`

### Recipe: AI search assistant

1. Index all file names and metadata from `/api/v1/files` into a local vector store
2. Rebuild the index on every `file_uploaded` or `file_deleted` webhook event
3. Answer semantic queries ("books about ancient Rome") by retrieving the top-N matches
   from the vector store and returning their `href` values

### Recipe: periodic backup agent

1. Cron job polls `/api/v1/files?since=<last-run-ts>` each night
2. Downloads all new files to a cold-storage provider (S3, B2, local NAS)
3. Records downloaded hashes to avoid re-downloading on the next run

### Recipe: request fulfillment queue

1. Agent subscribes to `request_created` webhook
2. Parses the request text and queries an external library catalog API
3. If a matching resource is found, downloads it and re-uploads via
   `PUT /api/v1/upload?fulfillsRequest=<key>`
4. If not found, posts a chat message ("Working on it — nothing found yet") and retries
   on a 30-minute schedule

---

## 10 — Implementation Priority Guide

| Use case                         | Complexity | Value  | Status            |
| -------------------------------- | ---------- | ------ | ----------------- |
| Polling-based file monitor       | Low        | High   | Implementable now |
| Webhook-based file monitor       | Low        | High   | Implementable now |
| Auto-download with filters       | Low        | High   | Implementable now |
| Agent-triggered upload           | Low        | High   | Implemented       |
| Request fulfillment automation   | Medium     | High   | Implemented       |
| Metadata PATCH API               | Medium     | High   | Implemented       |
| Chat API for agents              | Medium     | Medium | Implemented       |
| Structured request hints         | Low        | Medium | Implemented       |
| Filter presets saved server-side | Medium     | Medium | Implemented       |
| Batch upload from URL list       | Medium     | Medium | Implemented       |
| Metrics endpoint (JSON)          | Low        | Medium | Implemented       |
| Audit log API                    | Medium     | Low    | Implemented       |
| Agent request claiming           | Medium     | Low    | Implemented       |
| AI-generated thumbnails          | Medium     | Low    | Implemented       |
| MCP server wrapper               | Medium     | High   | Scoped (P2)       |
| Content policy webhook agent     | High       | Low    | Proposal          |

---

## 11 — MCP Integration

See `docs/mcp.md` for the complete design and implementation guide.

In brief: Dicefiles doesn't natively speak Model Context Protocol — it speaks HTTP REST.
A thin `scripts/mcp-server.js` wrapper (~300 lines, using `@modelcontextprotocol/sdk`)
translates MCP tool calls into Dicefiles API calls. Clients (Claude Desktop, Cursor,
OpenClaw, etc.) connect via stdio (local) or HTTP/SSE (remote).

All the v1.1 API endpoints implemented in the P2 phase map directly to MCP tools:
`list_files`, `get_file`, `get_room_snapshot`, `upload_file_from_urls`,
`create_request`, `claim_request`, `update_file_metadata`, `post_room_chat`,
`server_health`, and more.

```bash
# Quick start: Claude Desktop integration
export DICEFILES_BASE_URL=http://localhost:9090
export DICEFILES_API_KEY=your-key
node scripts/mcp-server.js  # expose to Claude Desktop via stdio
```
