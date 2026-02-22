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

### Proposed: filter presets saved server-side **\[proposal\]**

Add a `/api/v1/agent/subscriptions` endpoint where agents can register named filter presets
(e.g., `{"room": "books", "ext": ["pdf","epub"], "maxSize": 209715200}`). The server
evaluates filters at upload time and delivers only matching events to webhook subscribers,
reducing agent-side noise. Tags and metadata fields (author, series) could also be
filter dimensions.

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

### Proposed: multi-file upload from URL list **\[proposal\]**

Add a `/api/v1/batch-upload` endpoint that accepts a JSON array of `{url, name, roomid}`
objects. The server fetches each URL server-side (with a timeout and size cap) and
stores them as normal uploads. Useful when an agent wants to mirror a list of resources
without streaming every byte through the agent host.

### Proposed: upload from clipboard / base64 **\[proposal\]**

Accept a `Content-Transfer-Encoding: base64` variant of the PUT endpoint so mobile
agents or browser extensions can upload without a dedicated multipart form layer.

---

## 4 — Metadata Enrichment

**Goal**: An agent adds or updates tags, descriptions, and structured metadata on existing
files after upload (e.g., OCR-derived text, AI-generated caption, archive index).

### Current state

`tags` and `meta` fields are written at upload time via query parameters and are
read-only afterward. There is no update API today.

### Proposed: PATCH /api/v1/file/:hash **\[proposal\]**

Add a `PATCH /api/v1/file/:hash` endpoint accepting:

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

Scoped API key requirement: `files:write`. Separate scope from upload (`files:upload`)
so read-only or upload-only keys cannot modify existing metadata.

### Proposed: AI-generated thumbnails **\[proposal\]**

For file types where the standard cover pipeline produces no thumbnail (e.g., text files,
structured data, 3D models), allow an agent to POST a `cover.jpg` asset:

```
POST /api/v1/file/:hash/asset/cover
Content-Type: image/jpeg
[binary body]
```

The server stores it as the `.cover.jpg` asset and serves it through the standard gallery
thumbnail pipeline.

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

### Proposed: agent declaration on request **\[proposal\]**

Allow agents to "claim" a request, setting a `claimedBy: "<agent-id>"` field that is
visible in the UI while the agent works on it (similar to a Jira "in-progress" state). A
claim TTL (e.g., 5 minutes) auto-releases if the agent fails to fulfill.

### Proposed: structured request schema **\[proposal\]**

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

### Proposed: POST /api/v1/room/:id/chat **\[proposal\]**

Agents that participate in the room conversation can call:

```json
POST /api/v1/room/:id/chat
{
  "text": "I found 3 new PDFs matching your request. They are now uploaded.",
  "nick": "BookBot",
  "replyTo": "<message-id>"        // optional threading
}
```

This enables true two-way interaction: the user types in the room, the agent listens
(via polling or webhook), processes the command, acts on the API, and replies in chat.

---

## 8 — Observability and Audit

**Goal**: An ops agent monitors server health and surfaces anomalies.

### Health check **\[implemented\]**

```bash
curl http://your-instance/healthz
# → {"ok":true,"redis":"ok","storage":"ok","uptime_s":3600,...}
```

### Proposed: structured metrics export **\[proposal\]**

Add `GET /api/v1/metrics` (Prometheus text format or JSON) exposing counters already
tracked by `lib/observability.js`:

```
dicefiles_uploads_total 1423
dicefiles_bytes_total 42949672960
dicefiles_downloads_total 7841
dicefiles_preview_failures_total 3
dicefiles_active_connections 14
```

An agent (or a standard Prometheus scraper) can ingest these and alert on anomalies.

### Proposed: audit log streaming **\[proposal\]**

`GET /api/v1/audit?since=<ts>&limit=100` returns a paginated JSON log of scoped API
events (uploads, deletes, rate-limit hits, failed auth attempts). Useful for a
compliance agent that monitors for unusual patterns.

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
| Metadata PATCH API               | Medium     | High   | Proposal          |
| Chat API for agents              | Medium     | Medium | Proposal          |
| Structured request hints         | Low        | Medium | Proposal          |
| Filter presets saved server-side | Medium     | Medium | Proposal          |
| Batch upload from URL list       | Medium     | Medium | Proposal          |
| Metrics endpoint (Prometheus)    | Low        | Medium | Proposal          |
| Audit log API                    | Medium     | Low    | Proposal          |
| Agent request claiming           | Medium     | Low    | Proposal          |
| AI-generated thumbnails          | Medium     | Low    | Proposal          |
| Content policy webhook agent     | High       | Low    | Proposal          |
