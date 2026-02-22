# Dicefiles API Reference (`/api/v1`)

This spec is written for automation clients (agentic tools, skill builders, MCP wrappers).

## 1. Base URLs and Compatibility

- Primary automation prefix: `/api/v1`
- Compatibility alias (same behavior): `/api/automation`
- Base host: `http://<host>:<port>`

Example:

- `POST /api/v1/auth/login`
- `POST /api/automation/auth/login` (alias)

## 2. Authentication Model

### 2.1 API Key (required for automation endpoints)

Use one of:

- `Authorization: Bearer <api-key>`
- `X-Dicefiles-API-Key: <api-key>`

### 2.2 Session (required for user-bound actions)

Use:

- `X-Dicefiles-Session: <session-token>`

Fallbacks supported by server:

- `session` in JSON body
- `session` query parameter

## 3. API Key Configuration and Scopes

Configure in `.config.json` via `automationApiKeys`.

### 3.1 Legacy key (full access)

```json
{
  "automationApiKeys": ["legacy-full-access-key"]
}
```

### 3.2 Scoped key objects

```json
{
  "automationApiKeys": [
    { "id": "readonly", "key": "replace-read-key", "scopes": ["files:read"] },
    {
      "id": "uploader",
      "key": "replace-upload-key",
      "scopes": ["files:read", "rooms:write", "uploads:write", "requests:write"]
    },
    {
      "id": "moderator",
      "key": "replace-mod-key",
      "scopes": ["files:delete", "mod:*"]
    }
  ]
}
```

### 3.3 Scope matching

- Exact scopes are supported (example: `files:read`)
- Prefix wildcard scopes are supported (example: `mod:*`)
- Global wildcard is supported (legacy/full keys): `*`

## 4. Rate Limits and Audit Logging

Automation endpoints are rate-limited per key + scope (fixed window).

Config:

```json
{
  "automationApiRateLimit": { "windowMs": 60000, "max": 180 },
  "automationApiRateLimitByScope": {
    "files:read": { "windowMs": 60000, "max": 600 },
    "uploads:write": { "windowMs": 60000, "max": 120 }
  },
  "automationAuditLog": "automation.log"
}
```

Response headers:

- `X-Dicefiles-RateLimit-Limit`
- `X-Dicefiles-RateLimit-Remaining`
- `X-Dicefiles-RateLimit-Reset` (unix seconds)
- `Retry-After` (only on `429`)

Audit logs are appended as JSON lines to `automationAuditLog`.

## 5. Endpoint Matrix

| Method   | Path                          | Scope            | Session Required |
| -------- | ----------------------------- | ---------------- | ---------------- |
| `POST`   | `/api/v1/auth/login`          | `auth:login`     | No               |
| `POST`   | `/api/v1/auth/logout`         | `auth:logout`    | Yes              |
| `POST`   | `/api/v1/rooms`               | `rooms:write`    | Yes              |
| `POST`   | `/api/v1/requests`            | `requests:write` | Yes              |
| `POST`   | `/api/v1/uploads/key`         | `uploads:write`  | Yes              |
| `GET`    | `/api/v1/uploads/:key/offset` | `uploads:write`  | Yes              |
| `PUT`    | `/api/v1/uploads/:key`        | `uploads:write`  | Yes              |
| `GET`    | `/api/v1/files`               | `files:read`     | Optional         |
| `GET`    | `/api/v1/downloads`           | `files:read`     | Optional         |
| `POST`   | `/api/v1/files/delete`        | `files:delete`   | Yes              |
| `GET`    | `/api/v1/admin/config`        | `admin:config`   | No               |
| `PATCH`  | `/api/v1/admin/config`        | `admin:config`   | No               |
| `POST`   | `/api/v1/admin/rooms/prune`   | `admin:rooms`    | No               |
| `DELETE` | `/api/v1/admin/rooms/:id`     | `admin:rooms`    | No               |
| `DELETE` | `/api/v1/admin/rooms`         | `admin:rooms`    | No               |

## 6. Endpoint Details

All automation responses are JSON.

### 6.1 Login

- `POST /api/v1/auth/login`
- Body:

```json
{
  "username": "myuser",
  "password": "mypassword",
  "twofactor": "123456"
}
```

- Success:

```json
{
  "ok": true,
  "session": "<session>",
  "user": "myuser",
  "role": "user"
}
```

### 6.2 Logout

- `POST /api/v1/auth/logout`
- Success:

```json
{ "ok": true }
```

### 6.3 Create Room

- `POST /api/v1/rooms`
- Body: `{}` (empty body is fine)
- Success:

```json
{
  "ok": true,
  "roomid": "AbCdEf1234",
  "href": "/r/AbCdEf1234"
}
```

### 6.4 Create Request

- `POST /api/v1/requests`
- Body:

```json
{
  "roomid": "AbCdEf1234",
  "text": "Please upload Player Handbook 5e",
  "url": "https://example.com/product",
  "requestImage": "data:image/png;base64,..."
}
```

Validation:

- `roomid`: required
- `text`: required, max 200 chars
- `url`: optional, max 500 chars, must be `http` or `https`
- `requestImage`: optional data URL, max ~2.5MB

- Success:

```json
{
  "ok": true,
  "request": {}
}
```

### 6.5 Reserve Upload Key

- `POST /api/v1/uploads/key`
- Body:

```json
{ "roomid": "AbCdEf1234" }
```

- Success:

```json
{
  "ok": true,
  "key": "uploadKeyString",
  "ttlHours": 48
}
```

### 6.6 Query Upload Offset

- `GET /api/v1/uploads/:key/offset`
- Success:

```json
{
  "ok": true,
  "key": "uploadKeyString",
  "offset": 1048576
}
```

### 6.7 Upload Bytes (resumable)

- `PUT /api/v1/uploads/:key?name=<filename>&offset=<n>`
- Body: raw binary bytes (typically `application/octet-stream`)
- Behavior:
  - send bytes starting from `offset`
  - on failure, re-query offset and resume
- Success:

```json
{ "key": "fileKey" }
```

### 6.8 List Files/Requests

- `GET /api/v1/files`
- Query:
  - `roomid` required
  - `type` = `all` | `uploads` | `requests` | `new`
  - `since` required when `type=new` (unix ms timestamp)
  - `name_contains` optional — case-insensitive substring match on filename (e.g. `pathfinder`)
  - `ext` optional — comma-separated extensions without dot (e.g. `epub,mobi,pdf`)
- Notes:
  - `type=new` and `name_contains`/`ext` can be combined arbitrarily
  - `isNew` is always `false` unless `since` is provided
- Success:

```json
{
  "ok": true,
  "roomid": "AbCdEf1234",
  "count": 2,
  "files": [
    {
      "key": "abc123",
      "name": "file.pdf",
      "size": 1234567,
      "uploaded": 1739870000000,
      "href": "/g/abc123",
      "isNew": true
    }
  ]
}
```

### 6.9 Download Planning

- `GET /api/v1/downloads`
- Query:
  - `roomid` required
  - `scope` = `all` | `new`
  - `since` required when `scope=new` (unix ms timestamp)
  - `name_contains` optional — case-insensitive substring match on filename
  - `ext` optional — comma-separated extensions without dot
- Notes:
  - request pseudo-files are always excluded
  - returns `href` suitable for file retrieval
  - filters combine: `scope=new&since=X&ext=epub,mobi` = new EPUB/MOBI since timestamp X

#### Polling example (agent loop)

```bash
# Step 1 — initial snapshot: record the latest upload timestamp
LAST_CHECK=$(curl -s "$BASE/api/v1/downloads?roomid=$ROOM" \
  -H "X-Dicefiles-API-Key: $KEY" | jq '[.files[].uploaded] | max // 0')

# Step 2 — in a cron / timer loop: fetch only files added since last check
curl -s "$BASE/api/v1/downloads?roomid=$ROOM&scope=new&since=$LAST_CHECK" \
  -H "X-Dicefiles-API-Key: $KEY"

# Step 3 — download all PDFs with “pathfinder” in the name
curl -s "$BASE/api/v1/downloads?roomid=$ROOM&name_contains=pathfinder&ext=pdf" \
  -H "X-Dicefiles-API-Key: $KEY" \
  | jq -r '.files[] | "$BASE" + .href' \
  | xargs -I{} curl -OJL {}

# Step 4 — download all EPUB and MOBI files
curl -s "$BASE/api/v1/downloads?roomid=$ROOM&ext=epub,mobi" \
  -H "X-Dicefiles-API-Key: $KEY" \
  | jq -r '.files[].href' \
  | xargs -I{} curl -OJL "$BASE{}"
```

### 6.10 Delete Files/Requests

- `POST /api/v1/files/delete`
- Body:

```json
{
  "roomid": "AbCdEf1234",
  "keys": ["fileOrRequestKey1", "fileOrRequestKey2"]
}
```

Permission behavior:

- moderators and room owners can delete any listed entries
- regular users can delete only their own uploads/requests

- Success:

```json
{
  "ok": true,
  "requested": 2,
  "removed": 2
}
```

## 7. Health and Ops Endpoint

### 7.1 Health check

- `GET /healthz`
- No automation API key required

Response:

```json
{
  "ok": true,
  "now": "2026-02-18T17:00:00.000Z",
  "checks": {
    "redis": { "ok": true, "latencyMs": 2, "detail": "PONG" },
    "storage": { "ok": true, "latencyMs": 1, "path": "uploads" }
  },
  "metrics": {
    "uploadsCreated": 10,
    "uploadsDeleted": 3,
    "downloadsServed": 55,
    "downloadsBytes": 123456789,
    "requestsCreated": 7,
    "requestsFulfilled": 4,
    "previewFailures": 1,
    "uptimeSec": 3600
  }
}
```

Status codes:

- `200` healthy
- `503` one or more dependency checks failed

## 8. Webhooks

Configure in `.config.json`:

```json
{
  "webhooks": [
    {
      "id": "my-bot",
      "url": "https://example.org/hooks/dicefiles",
      "secret": "replace-with-random-secret",
      "events": [
        "file_uploaded",
        "request_created",
        "request_fulfilled",
        "file_deleted"
      ],
      "retries": 3,
      "timeoutMs": 7000
    }
  ],
  "webhookRetry": { "retries": 3, "baseDelayMs": 1500, "maxDelayMs": 30000 },
  "webhookDeadLetterLog": "webhook-dead-letter.log"
}
```

### 8.1 Delivery payload

```json
{
  "id": "event-id",
  "event": "file_uploaded",
  "timestamp": "2026-02-18T16:00:00.000Z",
  "payload": {},
  "attempt": 1
}
```

### 8.2 Delivery headers

- `X-Dicefiles-Event`
- `X-Dicefiles-Webhook-Id`
- `X-Dicefiles-Timestamp`
- `X-Dicefiles-Signature` (when webhook has `secret`)

Signature format:

- HMAC-SHA256 over: `timestamp + "." + rawBody`
- hex digest

### 8.3 Event semantics

- `file_uploaded`: upload registration completed
- `request_created`: request pseudo-file created
- `request_fulfilled`: request deleted before expiry (non-expired deletion path)
- `file_deleted`: upload deleted/expired path

Retries use exponential backoff. Permanent failures are written as JSON lines to `webhookDeadLetterLog`.

## 9. Error Contract

Error shape:

```json
{ "err": "Human-readable message" }
```

Typical status codes:

- `400` validation/domain errors
- `401` invalid API key or invalid automation session
- `403` missing required API scope
- `404` automation API disabled (no keys configured)
- `429` automation API rate limit exceeded

## 10. Agent Workflow Recipes

### 10.1 Create room + request

1. `POST /api/v1/auth/login`
2. `POST /api/v1/rooms`
3. `POST /api/v1/requests`
4. Optional: `GET /api/v1/files?type=requests`

### 10.2 Resumable upload

1. `POST /api/v1/auth/login`
2. `POST /api/v1/uploads/key`
3. `GET /api/v1/uploads/:key/offset`
4. `PUT /api/v1/uploads/:key?name=<n>&offset=<offset>`
5. On interruption, repeat from step 3

### 10.3 Batch download new uploads

1. Persist `lastSeenMs` in agent state
2. `GET /api/v1/downloads?scope=new&since=<lastSeenMs>`
3. Download each returned `href`
4. Update `lastSeenMs`

## 11. Skill-Builder Mapping

Suggested tool contracts:

- `dicefiles_login(username,password,twofactor?) -> {session,user,role}`
- `dicefiles_logout(session) -> {ok}`
- `dicefiles_create_room(session) -> {roomid,href}`
- `dicefiles_create_request(session,roomid,text,url?,requestImage?) -> {request}`
- `dicefiles_upload_key(session,roomid) -> {key,ttlHours}`
- `dicefiles_upload_offset(session,key) -> {offset}`
- `dicefiles_upload_put(session,key,name,offset,binary) -> {key}`
- `dicefiles_list_files(session?,roomid,type,since?) -> {files}`
- `dicefiles_plan_downloads(session?,roomid,scope,since?) -> {files}`
- `dicefiles_delete(session,roomid,keys[]) -> {removed}`
- `dicefiles_health() -> {ok,checks,metrics}`

Persisted state:

- `apiKey`
- `session`
- `roomid`
- `lastSeenMs`
- per-upload `key` + `offset`

---

## 12. File Management Endpoints (v1.1)

These endpoints let agents read and write individual file metadata, making Dicefiles
a full two-way mirror between your AI pipeline and the room.

### 12.1 Get single file metadata

- `GET /api/v1/file/:key`
- Scope: `files:read`
- Returns the full JSON shape for a single upload including all tags, meta, and asset info.

```json
{
  "ok": true,
  "file": {
    "key": "abc123",
    "name": "Neuromancer.epub",
    "type": "document",
    "size": 524288,
    "uploaded": 1739870000000,
    "expires": 1740130000000,
    "href": "/g/abc123",
    "tags": { "author": "William Gibson", "genre": "Cyberpunk" },
    "meta": { "ai_caption": "A noir sci-fi novel set in cyberspace." }
  }
}
```

> **What this enables**
>
> Perfect for agents that drill into a single file after spotting its key in a webhook
> event or room poll. Your book-indexer sees `"Neuromancer.epub"` appear in the upload
> webhook — it calls this endpoint to read the full tag set before deciding whether to
> enrich it. An OpenClaw workflow step can check whether `meta.ai_caption` is already
> populated and skip the expensive vision-model call if so, saving tokens.
>
> ```js
> // Agent: check before enriching
> const { file } = await api("GET", `/file/${key}`);
> if (file.meta?.ai_caption) return; // already enriched, skip
> const caption = await llm.describe(file.href);
> await api("PATCH", `/file/${key}`, { meta: { ai_caption: caption } });
> ```

---

### 12.2 Update file metadata

- `PATCH /api/v1/file/:key`
- Scope: `files:write`
- Body (all fields optional):

```json
{
  "meta": {
    "description": "A short human-readable synopsis of the file.",
    "ai_caption": "One-line AI-generated summary.",
    "ocr_text_preview": "First ~500 characters extracted by OCR."
  },
  "tags": {
    "title": "Neuromancer",
    "author": "William Gibson",
    "genre": "Cyberpunk",
    "language": "en",
    "series": "Sprawl Trilogy"
  }
}
```

Only the fields listed above are accepted; unknown keys are silently dropped.

```json
{ "ok": true, "key": "abc123", "hash": "sha512hex" }
```

> **What this enables**
>
> This is the enrichment endpoint — the closed loop that makes Dicefiles act as a
> living, AI-curated library. After uploading a PDF your agent can:
>
> 1. Run it through an OCR pipeline → PATCH writes `ocr_text_preview`
> 2. Send the cover thumbnail to a vision model → PATCH writes `ai_caption`
> 3. Query a book-catalog API (Google Books, Open Library) → PATCH writes
>    `author`, `series`, `genre` tags
>
> Browser users see all of this data appear in the gallery card immediately, with
> zero manual tagging effort.
>
> Requires a separate `files:write`-scoped key so enrichment bots can't delete
> files and upload bots can't rewrite metadata. Scopes compose cleanly.

---

### 12.3 Upload agent-provided cover image

- `POST /api/v1/file/:key/asset/cover`
- Scope: `files:write`
- Body: raw JPEG bytes
- Headers: `Content-Type: image/jpeg` (required), max 5 MB
- The image is validated and re-encoded at quality 85, then stored as the
  file's `.cover.jpg` asset, replacing any existing thumbnail.

```json
{ "ok": true, "key": "abc123", "hash": "sha512hex" }
```

> **What this enables**
>
> For file types where the standard thumbnail pipeline draws a blank — plain text
> files, 3D model packs, structured data, raw binaries — your agent can generate
> a cover and push it here. The gallery shows a real thumbnail immediately.
>
> A typical flow: agent uploads a zip of `.stl` files → calls DALL-E/SDXL with
> the file description → POSTs the resulting JPEG here. Everyone else in the room
> instantly sees a nice preview instead of a blank archive icon.
>
> Also great for request-fulfillment bots: before fulfilling a book request,
> fetch the cover image from Open Library's Covers API and post it here so the
> room shelf looks polished.
>
> ```bash
> # Fetch cover from Open Library, push to Dicefiles
> curl -sL "https://covers.openlibrary.org/b/isbn/9780441569595-L.jpg" \
>   | curl -X POST "$BASE/api/v1/file/$KEY/asset/cover" \
>     -H "Authorization: Bearer $AGENT_KEY" \
>     -H "Content-Type: image/jpeg" \
>     --data-binary @-
> ```

---

## 13. Room Interaction Endpoints (v1.1)

Agents can participate in the room — reading stats and posting status messages — so
users always know what's happening without leaving the chat window.

### 13.1 Post agent chat message

- `POST /api/v1/room/:id/chat`
- Scope: `rooms:write`
- Session: required (agent must be logged in)
- Body:

```json
{
  "text": "Found it! Uploading Player's Handbook 5e now...",
  "nick": "BookBot",
  "replyTo": "optional-message-id"
}
```

`nick` defaults to the logged-in username if omitted. `replyTo` is optional threading.

```json
{ "ok": true }
```

> **What this enables**
>
> Your agent can talk back to the room — real two-way interaction instead of silent
> background processing. A request-fulfillment bot can post:
>
> - `"On it — searching 4 catalogs..."` as soon as it claims a request
> - `"Done ✓ — expires in 72 h."` after a successful upload
> - `"Came up empty across all sources. Anyone have a direct link?"` on failure
>
> This is what separates a polished agentic workflow from a mysterious background
> process. OpenClaw orchestrators can use the chat channel as a progress bus:
> long-running multi-step pipelines post status at each stage so room members can
> follow along in real time.
>
> ```js
> // Agent lifecycle messages
> await chat(roomid, "BookBot", "📥 Claiming request...");
> await api("POST", `/requests/${reqKey}/claim`);
> const result = await searchAndUpload(request);
> await chat(
>   roomid,
>   "BookBot",
>   result.ok
>     ? `✅ Uploaded — ${result.href}`
>     : `❌ Not found after 3 catalog searches.`,
> );
> ```

---

### 13.2 Room snapshot

- `GET /api/v1/room/:id/snapshot`
- Scope: `files:read`

```json
{
  "ok": true,
  "roomid": "AbCdEf1234",
  "fileCount": 42,
  "totalBytes": 3145728000,
  "openRequestCount": 7,
  "uniqueUploaders": 12,
  "oldestExpiry": 1750000000000
}
```

> **What this enables**
>
> Build a nightly digest bot that posts a human-readable room summary to Discord:
> `"#books: 42 files (3.1 GB), 7 open requests, 12 contributors. Oldest file
expires Mar 15."` No need to page through file lists — one call returns the
> aggregate.
>
> Monitoring agents can alert when `openRequestCount` climbs above a threshold
> (community demand exceeding supply), or when `oldestExpiry` is approaching so
> someone can bump TTLs before content disappears.
>
> An MCP tool wrapping this endpoint is a perfect `get_room_stats` capability for
> a conversational assistant: user asks "what's in the books room?" and the agent
> answers in one sentence from a single API call.

---

## 14. Server Observability Endpoints (v1.1)

These endpoints are for ops agents and monitoring bots, not end-users.
Both require `admin:read` scope — issue a dedicated key, keep it off your general
automation boxes.

### 14.1 Metrics snapshot

- `GET /api/v1/metrics`
- Scope: `admin:read`

```json
{
  "ok": true,
  "metrics": {
    "uploadsCreated": 1234,
    "uploadsDeleted": 56,
    "downloadsServed": 9876,
    "downloadsBytes": 10737418240,
    "requestsCreated": 78,
    "requestsFulfilled": 45,
    "previewFailures": 2,
    "uptimeSec": 86400
  }
}
```

> **What this enables**
>
> Plug this into Grafana, Datadog, or a simple Prometheus scraper. Every counter
> here corresponds to something meaningful to your community:
>
> - `uploadsCreated / downloadsServed` → activity health
> - `previewFailures` → thumbnail pipeline alerts
> - `requestsFulfilled / requestsCreated` → how well agents are keeping up
>   with demand
>
> A dead-simple monitoring agent polls every 60 seconds and Slacks you if
> `previewFailures` spikes or `uptimeSec` resets (server restarted unexpectedly).
>
> MCP clients can call this as a `check_server_health` tool at the start of any
> long ingestion workflow — no point claiming 20 requests if the server is sick.
>
> ```python
> # SimpleBot health pre-flight
> metrics = await dicefiles.metrics()
> if metrics["previewFailures"] > metrics_baseline["previewFailures"] + 10:
>     alert("Preview pipeline degraded — pausing uploads")
>     return
> ```

---

### 14.2 Paginated audit log

- `GET /api/v1/audit`
- Scope: `admin:read`
- Query params:
  - `since` — ISO timestamp; return only entries after this time
  - `limit` — max entries to return (default 100, max 1000)
- Returns newest entries first.

```json
{
  "ok": true,
  "count": 25,
  "entries": [
    {
      "at": "2026-02-22T14:00:00.000Z",
      "keyId": "uploader-bot",
      "scope": "uploads:write",
      "path": "/api/v1/batch-upload",
      "ip": "1.2.3.4"
    }
  ]
}
```

> **What this enables**
>
> Feed a rolling audit window to an LLM: `"Here are the last 200 API events —
summarize any unusual patterns."` Or build a simple rule: if more than 5
> `files:delete` events appear within an hour from an unfamiliar key, fire an
> alert.
>
> Compliance workflows can pull the full log every night, store it in cold
> storage, and query it later. `since` + `limit` makes it easy to pick up
> exactly where you left off without re-reading old entries.

---

## 15. Batch Upload (v1.1)

### 15.1 Fetch-and-ingest from URL list

- `POST /api/v1/batch-upload`
- Scope: `uploads:write`
- Session: required
- Body:

```json
{
  "roomid": "AbCdEf1234",
  "items": [
    { "url": "https://example.com/book.pdf", "name": "book.pdf" },
    { "url": "https://example.com/cover.jpg" }
  ]
}
```

- Max 20 items per call; max 100 MB per file; 60 s fetch timeout per URL.
- `name` defaults to the last URL path segment.
- `roomid` can also be specified per item (overrides the top-level value).

```json
{
  "ok": true,
  "results": [
    {
      "ok": true,
      "url": "https://example.com/book.pdf",
      "key": "abc123",
      "href": "/g/abc123"
    },
    {
      "ok": false,
      "url": "https://example.com/cover.jpg",
      "error": "fetch failed: 404"
    }
  ]
}
```

> **What this enables**
>
> This is the "grab it for me" endpoint. A user drops a list of URLs into a room
> request and your agent resolves them all server-side — no streaming gigabytes
> through the agent's own connection.
>
> A Discord bot can accept `!upload https://... https://...` and fire a single API
> call. An OpenClaw workflow looks like:
> `[web_search for results] → [pick top 5] → [batch_upload to room]` — three
> steps, no custom download code.
>
> The 100 MB/file and 60-second timeout caps prevent accidentally ingesting huge
> archives. Per-item `ok/error` in the response means partial success is handled
> cleanly — log the failures, report the wins.
>
> ```js
> // Discord bot handler
> const urls = message.content.match(/https?:\/\/\S+/g) || [];
> if (!urls.length) return;
> const { results } = await api("POST", "/batch-upload", {
>   roomid: ROOM,
>   items: urls.slice(0, 20).map((url) => ({ url })),
> });
> const ok = results.filter((r) => r.ok).map((r) => r.href);
> const fail = results.filter((r) => !r.ok).length;
> reply(`Uploaded ${ok.length} files${fail ? ` (${fail} failed)` : ""}`);
> ```

---

## 16. Request Claiming (v1.1)

Claiming prevents multiple agents from racing to fulfill the same request and
uploading duplicate files.

### 16.1 Claim a request

- `POST /api/v1/requests/:key/claim`
- Scope: `requests:write`
- Session: required
- Body (optional):

```json
{ "ttlMs": 300000 }
```

`ttlMs` is the claim TTL in milliseconds (min 5 s, max 1 h, default 5 min).
The claim auto-releases after the TTL, so a crashed agent doesn't lock out others.

```json
{ "ok": true, "key": "req_abc123", "claimedUntil": 1740000300000 }
```

Returns `409` if the request is already claimed by a different agent.

---

### 16.2 Release a claim

- `DELETE /api/v1/requests/:key/claim`
- Scope: `requests:write`
- Session: required

Returns `403` if the claim belongs to a different agent.

```json
{ "ok": true }
```

> **What claiming enables overall**
>
> This is coordination infrastructure for multi-agent deployments. Running a PDF
> bot and an EPUB bot in parallel against the same room? They both poll for open
> requests. The first to `POST /claim` wins that request; the other skips it.
>
> TTL auto-release is safety-net plumbing: if your bot crashes mid-search, the
> claim expires after 5 minutes and any other agent can pick the request up. No
> manual intervention needed.
>
> `DELETE /claim` is for clean early release: your agent searched three catalogs,
> came up empty, and wants to give up immediately rather than waiting for the
> timeout. Another agent with a different data source can try right away.
>
> ```js
> // Standard claim-work-fulfill loop
> for (const req of openRequests) {
>   const claim = await api("POST", `/requests/${req.key}/claim`, {
>     ttlMs: 600000,
>   });
>   if (!claim.ok) continue; // already claimed, skip
>   try {
>     const file = await searchAndDownload(req);
>     if (!file) {
>       await api("DELETE", `/requests/${req.key}/claim`); // release immediately
>       continue;
>     }
>     await uploadAndFulfill(file, req.key);
>   } catch (err) {
>     await api("DELETE", `/requests/${req.key}/claim`).catch(() => {});
>     throw err;
>   }
> }
> ```

---

## 17. Agent Subscriptions (v1.1)

Named server-side filter presets stored per API key in Redis. Save what you want to
watch for; retrieve it on restart; clean up when you're done.

### 17.1 Save a subscription

- `POST /api/v1/agent/subscriptions`
- Scope: `files:read`
- Body:

```json
{
  "name": "new-books",
  "room": "AbCdEf1234",
  "ext": [".pdf", ".epub", ".mobi"],
  "name_contains": "fantasy",
  "max_size_mb": 50,
  "type": "document"
}
```

All filter fields except `name` are optional. Overwrites an existing subscription
with the same `name` for this API key.

```json
{ "ok": true, "subscription": { "name": "new-books", ... } }
```

---

### 17.2 List subscriptions

- `GET /api/v1/agent/subscriptions`
- Scope: `files:read`

```json
{
  "ok": true,
  "subscriptions": [
    {
      "name": "new-books",
      "room": "AbCdEf1234",
      "ext": [".pdf", ".epub"],
      "createdAt": "..."
    }
  ]
}
```

---

### 17.3 Delete a subscription

- `DELETE /api/v1/agent/subscriptions/:name`
- Scope: `files:read`

Returns `404` if not found.

```json
{ "ok": true }
```

> **What subscriptions enable**
>
> Server-side filter presets that survive agent restarts. Your book-bot registers
> its interests once at startup and GETs them back after every restart — no
> hardcoded filter logic scattered across your config files.
>
> Multiple bots with different API keys maintain independent subscription sets on
> the same server. An "images" bot watches `.jpg,.png,.webp`; a "books" bot watches
> `.pdf,.epub,.mobi`. They never step on each other.
>
> An admin agent can list all subscriptions before a planned migration to understand
> what clients are watching. A management UI can expose subscription CRUD to
> non-technical users: `"What should the bot download automatically?"`.
>
> Right now subscriptions are storage only — your agent reads them back and uses
> them as filter parameters in its polling loop. A future enhancement could route
> webhook events server-side to only fire for matching files.

---

## 18. Request Hints (v1.1)

The `POST /api/v1/requests` endpoint accepts an optional `hints` object alongside
the free-text `text` field:

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

Agents that poll `GET /api/v1/files?type=requests` receive the full request object
including `meta.hints`, and can match against it programmatically.

> **What hints enable**
>
> Hints bridge the gap between human free-text and machine-parseable intent.
> `"Please upload the 2023 IPCC climate report"` is ambiguous to a regex. But
> `hints.keywords = ["IPCC", "2023"]` + `hints.type = "document"` is trivial to
> match against a catalog API's structured search.
>
> Your orchestrator can have a light NLP pre-processing step that extracts hints
> from the request text and re-writes the request with them populated. Future
> agents that poll for requests can then filter `meta.hints.type === "document"`
> to find only requests they're capable of fulfilling — an image bot ignores PDF
> requests, a book-catalog bot ignores image requests.

---

## 19. MCP Server Integration

> **Quick answer on MCP:** Dicefiles is _almost_ an MCP server — it has exactly
> the right HTTP API. The missing piece is a thin wrapper that speaks the
> Model Context Protocol JSON-RPC dialect that Claude Desktop, Cursor, Continue,
> and other MCP clients understand. That wrapper is a ~300-line Node.js script
> that proxies MCP tool calls into Dicefiles REST calls. See `docs/mcp.md` for
> the full design and setup guide.

### 19.1 What MCP means here

[Model Context Protocol](https://modelcontextprotocol.io/) (Anthropic open standard)
defines a JSON-RPC 2.0 protocol over stdio or HTTP/SSE that lets AI clients
(Claude Desktop, Cursor IDE, Continue.dev, any agent using the MCP SDK) call
named **tools** with typed inputs.

Dicefiles **does not** speak this protocol natively — it speaks HTTP REST. But you
can run a tiny MCP server script alongside Dicefiles that wraps every REST endpoint
as an MCP tool. Local clients connect via stdio; remote agents connect via HTTP.

### 19.2 The `dicefiles-mcp` wrapper (scoped for implementation)

The wrapper lives at `scripts/mcp-server.js` in the repo. Configure with two env vars:

```bash
DICEFILES_BASE_URL=http://localhost:9090
DICEFILES_API_KEY=your-agent-key-here
node scripts/mcp-server.js  # stdio mode for Claude Desktop / local agents
```

### 19.3 Exposed MCP tools

| Tool name               | Maps to                                | Scope needed     |
| ----------------------- | -------------------------------------- | ---------------- |
| `list_files`            | `GET /api/v1/files`                    | `files:read`     |
| `get_file`              | `GET /api/v1/file/:key`                | `files:read`     |
| `get_room_snapshot`     | `GET /api/v1/room/:id/snapshot`        | `files:read`     |
| `download_file`         | Proxies `GET /g/:key` → returns base64 | `files:read`     |
| `upload_file_from_urls` | `POST /api/v1/batch-upload`            | `uploads:write`  |
| `create_request`        | `POST /api/v1/requests`                | `requests:write` |
| `claim_request`         | `POST /api/v1/requests/:key/claim`     | `requests:write` |
| `release_request`       | `DELETE /api/v1/requests/:key/claim`   | `requests:write` |
| `update_file_metadata`  | `PATCH /api/v1/file/:key`              | `files:write`    |
| `post_room_chat`        | `POST /api/v1/room/:id/chat`           | `rooms:write`    |
| `save_subscription`     | `POST /api/v1/agent/subscriptions`     | `files:read`     |
| `list_subscriptions`    | `GET /api/v1/agent/subscriptions`      | `files:read`     |
| `server_health`         | `GET /healthz`                         | none             |

### 19.4 Claude Desktop integration example

Add to `claude_desktop_config.json`:

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

After restarting Claude Desktop, Claude can directly answer questions like:
`"What's in the books room?"`, `"Upload these 3 URLs to the media room"`,
`"Are there any open requests for PDFs?"`.

### 19.5 Remote agent / HTTP transport

For non-local agents, the MCP wrapper can also run in StreamableHTTP mode
(HTTP + SSE transport), making Dicefiles accessible to remote orchestrators
like OpenClaw, AutoGen, or CrewAI that support the MCP remote-server spec.

```bash
MCP_TRANSPORT=http MCP_PORT=3001 node scripts/mcp-server.js
```

See `docs/mcp.md` for the full specification, security model, and deployment guide.

---

## 20. Complete Endpoint Matrix (v1.0 + v1.1 + v1.2)

| Method   | Path                                | Scope            | Session Required | Version |
| -------- | ----------------------------------- | ---------------- | ---------------- | ------- |
| `POST`   | `/api/v1/auth/login`                | `auth:login`     | No               | v1.0    |
| `POST`   | `/api/v1/auth/logout`               | `auth:logout`    | Yes              | v1.0    |
| `POST`   | `/api/v1/rooms`                     | `rooms:write`    | Yes              | v1.0    |
| `POST`   | `/api/v1/requests`                  | `requests:write` | Yes              | v1.0    |
| `POST`   | `/api/v1/uploads/key`               | `uploads:write`  | Yes              | v1.0    |
| `GET`    | `/api/v1/uploads/:key/offset`       | `uploads:write`  | Yes              | v1.0    |
| `PUT`    | `/api/v1/uploads/:key`              | `uploads:write`  | Yes              | v1.0    |
| `GET`    | `/api/v1/files`                     | `files:read`     | Optional         | v1.0    |
| `GET`    | `/api/v1/downloads`                 | `files:read`     | Optional         | v1.0    |
| `POST`   | `/api/v1/files/delete`              | `files:delete`   | Yes              | v1.0    |
| `GET`    | `/api/v1/file/:key`                 | `files:read`     | No               | v1.1    |
| `PATCH`  | `/api/v1/file/:key`                 | `files:write`    | No               | v1.1    |
| `POST`   | `/api/v1/file/:key/asset/cover`     | `files:write`    | No               | v1.1    |
| `POST`   | `/api/v1/room/:id/chat`             | `rooms:write`    | Yes              | v1.1    |
| `GET`    | `/api/v1/room/:id/snapshot`         | `files:read`     | No               | v1.1    |
| `GET`    | `/api/v1/metrics`                   | `admin:read`     | No               | v1.1    |
| `GET`    | `/api/v1/audit`                     | `admin:read`     | No               | v1.1    |
| `POST`   | `/api/v1/batch-upload`              | `uploads:write`  | Yes              | v1.1    |
| `POST`   | `/api/v1/requests/:key/claim`       | `requests:write` | Yes              | v1.1    |
| `DELETE` | `/api/v1/requests/:key/claim`       | `requests:write` | Yes              | v1.1    |
| `POST`   | `/api/v1/agent/subscriptions`       | `files:read`     | No               | v1.1    |
| `GET`    | `/api/v1/agent/subscriptions`       | `files:read`     | No               | v1.1    |
| `DELETE` | `/api/v1/agent/subscriptions/:name` | `files:read`     | No               | v1.1    |
| `GET`    | `/api/v1/admin/config`              | `admin:config`   | No               | v1.2    |
| `PATCH`  | `/api/v1/admin/config`              | `admin:config`   | No               | v1.2    |
| `POST`   | `/api/v1/admin/rooms/prune`         | `admin:rooms`    | No               | v1.2    |
| `DELETE` | `/api/v1/admin/rooms/:id`           | `admin:rooms`    | No               | v1.2    |
| `DELETE` | `/api/v1/admin/rooms`               | `admin:rooms`    | No               | v1.2    |

---

## 21. Admin: Remote Config and Room Management (v1.2)

These endpoints require the `admin:config` or `admin:rooms` scope. Both scopes
are included in the `mod` scope preset.

### 21.1 Get mutable config

- `GET /api/v1/admin/config`
- Scope: `admin:config`
- Returns the current values of all runtime-mutable configuration keys.

Success:

```json
{
  "ok": true,
  "config": {
    "publicRooms": false,
    "roomPruning": true,
    "roomPruningDays": 21,
    "roomCreation": true,
    "requireAccounts": false,
    "name": "My File Share"
  }
}
```

### 21.2 Update config at runtime

- `PATCH /api/v1/admin/config`
- Scope: `admin:config`
- Body: any subset of mutable config keys, plus an optional `persist` flag.

```json
{
  "roomPruning": false,
  "roomPruningDays": 30,
  "persist": true
}
```

When `persist` is `true`, accepted changes are written back to `.config.json`
so they survive a server restart.

Mutable keys: `publicRooms`, `roomPruning`, `roomPruningDays`, `roomCreation`,
`roomCreationRequiresAccount`, `requireAccounts`, `allowRequests`,
`linkCollection`, `profileActivity`, `maxFileSize`, `TTL`,
`downloadMaxConcurrent`, `chatFloodTrigger`, `chatFloodDuration`,
`uploadFloodTrigger`, `uploadFloodDuration`, `name`, `motto`, `opengraphIoKey`.

Success:

```json
{
  "ok": true,
  "applied": { "roomPruning": false, "roomPruningDays": 30 },
  "persisted": true
}
```

If any keys were rejected (not in the mutable whitelist), the response includes
a `rejected` map:

```json
{
  "ok": true,
  "applied": {},
  "rejected": { "secret": "key not runtime-mutable" }
}
```

### 21.3 Force room prune

- `POST /api/v1/admin/rooms/prune`
- Scope: `admin:rooms`
- Immediately runs the room prune pass (same logic as the 24-hour scheduled
  prune, respecting `roomPruningDays`). Useful after lowering `roomPruningDays`
  to reclaim space immediately.

Success:

```json
{ "ok": true, "pruned": 3 }
```

### 21.4 Destroy a single room

- `DELETE /api/v1/admin/rooms/:id`
- Scope: `admin:rooms`
- Permanently deletes the room and all its files, regardless of prune settings.

Success:

```json
{ "ok": true, "roomid": "AbCdEf1234" }
```

On unknown room: `404` with `{ "err": "Room not found" }`.

### 21.5 Destroy all rooms (nuclear)

- `DELETE /api/v1/admin/rooms`
- Scope: `admin:rooms`
- **Irreversible.** Destroys every room and all associated files on the server.
- Requires explicit confirmation in the request body.

Body:

```json
{ "confirm": "destroy-all-rooms" }
```

Omitting the confirmation string returns `400`.

Success:

```json
{ "ok": true, "destroyed": 12 }
```

> **Warning:** This operation is intended for emergency use (e.g., legal
> takedown). It permanently erases all rooms and uploaded files. There is no
> undo. Protect keys carrying the `admin:rooms` scope accordingly.
