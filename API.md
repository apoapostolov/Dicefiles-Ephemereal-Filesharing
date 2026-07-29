# Dicefiles API Reference (`/api/v1`)

This spec is written for automation clients (agentic tools, skill builders, MCP wrappers).

## 1. Base URLs and Compatibility

- Primary automation prefix: `/api/v1`
- Compatibility alias (same behavior): `/api/automation`
- Base host: `http://<host>:<port>`

### 1.1 A2A Manifest (Agent‑to‑Agent)

To support Google’s Agent‑to‑Agent protocol, Dicefiles exposes a simple
self‑describing manifest at `/.well-known/a2a`. Agents can fetch this URL to
discover the service name, API base, version, and a small list of representative
endpoints with required scopes. The manifest returns:

```json
{
  "ok": true,
  "service": "Dicefiles",
  "version": "1.4.4",
  "baseUrl": "/api/v1",
  "endpoints": [
    { "path": "/api/v1/files", "scope": "files:read" },
    { "path": "/api/v1/rooms", "scope": "rooms:write" },
    { "path": "/api/v1/rooms/:id/links", "scope": "room-links:read" },
    { "path": "/api/v1/rooms/:id/federation-links", "scope": "federation-links:read" },
    { "path": "/api/v1/rooms/:id/guest-invites", "scope": "guest-invites:read" },
    { "path": "/api/v1/rooms/:id/plugins", "scope": "room-plugins:read" },
    { "path": "/healthz", "scope": null }
  ]
}
```

Agents may ignore `endpoints` or augment them with the full `/api/v1` matrix
listed later in this document.
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

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (unix seconds)
- `Retry-After` (only on `429`)

Audit logs are appended as JSON lines to `automationAuditLog`.

## 5. Endpoint Matrix

| Method   | Path                          | Scope            | Session Required |
| -------- | ----------------------------- | ---------------- | ---------------- |
| `POST`   | `/api/v1/auth/login`          | `auth:login`     | No               |
| `POST`   | `/api/v1/auth/logout`         | `auth:logout`    | Yes              |
| `POST`   | `/api/v1/rooms`               | `rooms:write`    | Yes              |
| `GET`    | `/api/v1/rooms/:id/links`     | `room-links:read` | No              |
| `POST`   | `/api/v1/rooms/:id/links`     | `room-links:write` | No             |
| `DELETE` | `/api/v1/rooms/:id/links/:sourceRoomId` | `room-links:write` | No   |
| `GET`    | `/api/v1/rooms/:id/federation-links` | `federation-links:read` | No |
| `POST`   | `/api/v1/rooms/:id/federation-links` | `federation-links:write` | No |
| `DELETE` | `/api/v1/rooms/:id/federation-links/:peerId/:remoteRoomId` | `federation-links:write` | No |
| `PATCH`  | `/api/v1/rooms/:id/federation` | `federation-links:write` | No |
| `GET`    | `/api/v1/rooms/:id/guest-invites` | `guest-invites:read` | No       |
| `POST`   | `/api/v1/rooms/:id/guest-invites` | `guest-invites:write` | No      |
| `DELETE` | `/api/v1/rooms/:id/guest-invites/:token` | `guest-invites:write` | No |
| `GET`    | `/api/v1/rooms/:id/plugins`   | `room-plugins:read` | No              |
| `PUT`    | `/api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` | No |
| `DELETE` | `/api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` | No |
| `POST`   | `/api/v1/rooms/:id/plugins/:pluginId/run` | `room-plugins:run` | No |
| `GET`    | `/api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:read` | No |
| `DELETE` | `/api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:write` | No |
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
| `GET`    | `/api/v1/federation/peers`    | `admin:read`     | No               |
| `GET`    | `/api/v1/federation/audit`    | `admin:read`     | No               |

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

### 6.3.1 Multi-room links

These endpoints mutate a destination room’s linked sources. They use dedicated
global automation scopes; no browser session is required.

- `GET /api/v1/rooms/:id/links` — `room-links:read`
- `POST /api/v1/rooms/:id/links` — `room-links:write`
- `DELETE /api/v1/rooms/:id/links/:sourceRoomId` — `room-links:write`

Create body:

```json
{
  "source": "source room id or exact room name",
  "visibility": "members",
  "allowPrivateSource": false,
  "rules": {
    "nameContains": "map OR handout",
    "tagContains": "pf2e AND remaster",
    "userContains": "/^(alice|bob)$/i",
    "types": ["image", "document"],
    "maxAgeHours": 168
  }
}
```

The filename, tag, and uploader username fields accept case-insensitive plain
substring terms. Commas and uppercase `OR` match any term; uppercase `AND`
requires every term and is evaluated before OR. Slash-delimited JavaScript
regular expressions such as `/^pf2.*\.pdf$/i` are also supported and can be
combined with AND/OR. When several rule fields are present, every field must
match. Tag operands may match any tag key or value; uploader operands match
the recorded user/usernick or bot display name. Regex flags are limited to
`i`, `m`, `s`, and `u`.

`visibility` is one of `all`, `authenticated`, `members`, `owners`, or `mods`.
The source must enable **Allow Room Cross-Linking**. Invite-only sources require
bilateral consent: the source room must additionally enable **Allow Invite-Only
Room Cross-Linking**, and this destination link must set
`allowPrivateSource: true`. A destination owner cannot bypass the source
room’s privacy setting. Hidden/hellbanned rows and request cards never cross
room boundaries; a finished upload that fulfilled a request can mirror as an
ordinary file.

### 6.3.2 Guest invite administration

- `GET /api/v1/rooms/:id/guest-invites` — `guest-invites:read`
- `POST /api/v1/rooms/:id/guest-invites` — `guest-invites:write`
- `DELETE /api/v1/rooms/:id/guest-invites/:token` — `guest-invites:write`

Create body:

```json
{
  "singleUse": false,
  "maxUses": 5,
  "maxAgeHours": 24,
  "label": "Friday guests"
}
```

The create response includes the newly minted full token. List responses also
include full active-invite tokens so automation can copy or revoke an invite it
did not mint; treat `guest-invites:read` as a sensitive scope. Audit records use
only privacy-safe token hints and are bounded by `guestInviteAuditLimit`. The
per-room active invite cap is configured with
`maxActiveGuestInvitesPerRoom`.

### 6.3.3 Room plugin administration

Room bots have dedicated scopes so a bot operator need not receive moderation
or room-owner credentials:

- `GET /api/v1/rooms/:id/plugins` — `room-plugins:read`
- `PUT /api/v1/rooms/:id/plugins/:pluginId` — `room-plugins:write`
- `DELETE /api/v1/rooms/:id/plugins/:pluginId` — `room-plugins:write`
- `POST /api/v1/rooms/:id/plugins/:pluginId/run` — `room-plugins:run`
- `GET /api/v1/rooms/:id/plugins/:pluginId/sync-log?limit=50` —
  `room-plugins:read`
- `DELETE /api/v1/rooms/:id/plugins/:pluginId/sync-log` —
  `room-plugins:write`, body `{ "confirm": true }`

The list response includes invited bots, the installed catalog, the public
inbound webhook path when supported, and each bot's most recent bounded run
status. Passwords, bot tokens, webhook URLs, secrets, and API keys are removed
from returned `config`; `secretFields` identifies which stored fields exist.

Configure or invite with:

```json
{
  "enabled": true,
  "label": "Community announcements",
  "config": {
    "chatId": "-100123456789",
    "botToken": "123456:secret",
    "baseUrl": "https://files.example.org"
  }
}
```

Configuration is a partial merge: omitting an existing secret preserves it.
Sending a new value replaces it. The path `pluginId` is authoritative and a
client cannot redirect configuration to another installed module.

`run` returns the plugin's bounded result. Scheduled runs additionally use a
Redis lease so multiple HTTP workers do not execute the same room/bot interval.
Mega.nz Autoshare returns upload/skip counts and enforces configurable
`maxFilesPerRun`, `maxBytesPerFile`, and `maxBytesPerRun` limits.

Sync-log inspection is bounded to 200 newest records and returns the remembered
entry key and timestamp, retention, total count, and most recent run status.
Clearing is rejected unless `confirm` is exactly `true`; it never removes files
already in the room, but remote entries may become eligible for a later rescan.

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
    "uploadsBytes": 987654321,
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

### 7.2 Aggregate operator status

The operator dashboard and its privacy-safe aggregate JSON feed are protected
with a generated capability link by default:

- `GET /status/:statusPageToken`
- `GET /api/public/status/:statusPageToken`

The token is generated on first startup and stored as `statusPageToken` in the
local `.config.json`. The unkeyed routes return `404`, and protected responses
use `Cache-Control: private, no-store`.

Set `statusPagePrivate` to `false` and restart to restore the public routes:

- `GET /status`
- `GET /api/public/status`

The JSON response contains only aggregate capacity, activity, community,
service-component, queue, bounded history, and global request-flow data.
`history.traffic` contains 60 two-hour buckets spanning five days, with
`uploadedBytes` and `downloadedBytes` totals. Request telemetry uses the same
five-day, two-hour window; every bucket reports available requests split into
`unfulfilled` and `fulfilled`, alongside current counts, fulfillment percentage,
active claims, and aggregate timing. It does not include request text, room
names, user names, file names, addresses, internal paths, or process IDs.

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
        "file_deleted",
        "linked_file_appeared",
        "guest_invite_created",
        "guest_invite_redeemed"
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
- `request_fulfilled`: request marked fulfilled (status path) or fulfilled via lifecycle cleanup when not already fulfilled
- `file_deleted`: upload deleted/expired path
- `linked_file_appeared`: a file uploaded to a **source** room matches a **destination** room’s multi-room link rules (source has Allow Room Cross-Linking). Payload includes destination `roomid`, `sourceRoomId`, and file fields
- `guest_invite_created` / `guest_invite_redeemed`: guest invite link minted or one use consumed

Retries use exponential backoff. Permanent failures are written as JSON lines to `webhookDeadLetterLog`.

The same event names are fanned out to global plugins and to plugins invited
to the affected room. Room plugins opt in with `eventSubscriptions`; delivery
is scoped to `payload.roomid`. See
[core/plugins/DEVELOPING_PLUGINS.md](core/plugins/DEVELOPING_PLUGINS.md).

External bots already have a bidirectional surface without arbitrary remote
code execution:

1. detect changes through signed webhooks;
2. read room/file state through scoped `files:read` endpoints;
3. execute allowed actions through narrowly scoped write keys.

Trusted in-process plugins receive equivalent injected adapters (`ctx.http`,
`ctx.events`, and `ctx.dicefiles`) rather than importing HTTP server or Redis
internals directly.

## 8.4 Guest invite links

Room owners (privileged) can mint invite URLs for invite-only rooms via Room Options or:

- `setconfig` socket: `createGuestInvite` `{ singleUse?, maxUses?, maxAgeHours?, label? }`
- `listGuestInvites` / `revokeGuestInvite`

Share: `/r/<roomId>?invite=<token>`. Single-use or max **X** redemptions; optional max age in hours. After redeem, a guest pass is stored for the browser session key so refresh does not re-burn multi-use invites.

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

> **Quick answer on MCP:** Dicefiles ships a 30-tool MCP server at
> `scripts/mcp-server.js`. It translates typed MCP calls from Claude Desktop,
> Cursor, OpenClaw, and other clients into the scoped REST API documented here.
> See `MCP.md` for client setup, tool schemas, and security guidance.

### 19.1 What MCP means here

[Model Context Protocol](https://modelcontextprotocol.io/) (Anthropic open standard)
defines a JSON-RPC 2.0 protocol over stdio or HTTP/SSE that lets AI clients
(Claude Desktop, Cursor IDE, Continue.dev, any agent using the MCP SDK) call
named **tools** with typed inputs.

Dicefiles keeps REST as its core automation contract and ships an MCP adapter over
that contract. Local clients connect via stdio; remote agents connect through the
optional Streamable HTTP transport.

### 19.2 The bundled `dicefiles-mcp` server

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
| `archive_list_contents` | `GET /api/v1/archive/:key/ls`          | `files:read`     |
| `list_room_links`       | `GET /api/v1/rooms/:id/links`          | `room-links:read` |
| `create_room_link`      | `POST /api/v1/rooms/:id/links`         | `room-links:write` |
| `remove_room_link`      | `DELETE /api/v1/rooms/:id/links/:sourceRoomId` | `room-links:write` |
| `list_guest_invites`    | `GET /api/v1/rooms/:id/guest-invites` | `guest-invites:read` |
| `create_guest_invite`   | `POST /api/v1/rooms/:id/guest-invites` | `guest-invites:write` |
| `revoke_guest_invite`   | `DELETE /api/v1/rooms/:id/guest-invites/:token` | `guest-invites:write` |
| `list_federated_room_links` | `GET /api/v1/rooms/:id/federation-links` | `federation-links:read` |
| `create_federated_room_link` | `POST /api/v1/rooms/:id/federation-links` | `federation-links:write` |
| `remove_federated_room_link` | `DELETE /api/v1/rooms/:id/federation-links/:peerId/:remoteRoomId` | `federation-links:write` |
| `set_room_federation_policy` | `PATCH /api/v1/rooms/:id/federation` | `federation-links:write` |
| `list_room_plugins`    | `GET /api/v1/rooms/:id/plugins`         | `room-plugins:read` |
| `configure_room_plugin` | `PUT /api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` |
| `remove_room_plugin`   | `DELETE /api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` |
| `run_room_plugin`      | `POST /api/v1/rooms/:id/plugins/:pluginId/run` | `room-plugins:run` |
| `inspect_room_plugin_sync_memory` | `GET /api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:read` |
| `clear_room_plugin_sync_memory` | `DELETE /api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:write` |

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

See `MCP.md` for the full specification, security model, and deployment guide.

---

## 20. Complete Endpoint Matrix (v1.0 through v1.4.4)

| Method   | Path                                | Scope            | Session Required | Version |
| -------- | ----------------------------------- | ---------------- | ---------------- | ------- |
| `POST`   | `/api/v1/auth/login`                | `auth:login`     | No               | v1.0    |
| `POST`   | `/api/v1/auth/logout`               | `auth:logout`    | Yes              | v1.0    |
| `POST`   | `/api/v1/rooms`                     | `rooms:write`    | Yes              | v1.0    |
| `GET`    | `/api/v1/rooms/:id/links`           | `room-links:read` | No              | v1.4.3  |
| `POST`   | `/api/v1/rooms/:id/links`           | `room-links:write` | No             | v1.4.3  |
| `DELETE` | `/api/v1/rooms/:id/links/:sourceRoomId` | `room-links:write` | No         | v1.4.3  |
| `GET`    | `/api/v1/rooms/:id/federation-links` | `federation-links:read` | No | v1.4.4 |
| `POST`   | `/api/v1/rooms/:id/federation-links` | `federation-links:write` | No | v1.4.4 |
| `DELETE` | `/api/v1/rooms/:id/federation-links/:peerId/:remoteRoomId` | `federation-links:write` | No | v1.4.4 |
| `PATCH`  | `/api/v1/rooms/:id/federation` | `federation-links:write` | No | v1.4.4 |
| `GET`    | `/api/v1/rooms/:id/guest-invites`   | `guest-invites:read` | No          | v1.4.3  |
| `POST`   | `/api/v1/rooms/:id/guest-invites`   | `guest-invites:write` | No         | v1.4.3  |
| `DELETE` | `/api/v1/rooms/:id/guest-invites/:token` | `guest-invites:write` | No    | v1.4.3  |
| `GET`    | `/api/v1/rooms/:id/plugins`         | `room-plugins:read` | No          | v1.4.4  |
| `PUT`    | `/api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` | No       | v1.4.4  |
| `DELETE` | `/api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` | No    | v1.4.4  |
| `POST`   | `/api/v1/rooms/:id/plugins/:pluginId/run` | `room-plugins:run` | No   | v1.4.4  |
| `GET`    | `/api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:read` | No | v1.4.4 |
| `DELETE` | `/api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:write` | No | v1.4.4 |
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
| `GET`    | `/api/v1/federation/peers`          | `admin:read`     | No               | v1.4.4  |
| `GET`    | `/api/v1/federation/audit`          | `admin:read`     | No               | v1.4.4  |

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

---

## 22. Archive Viewer Endpoints (v1.2)

These endpoints expose the contents of ZIP, RAR, 7z, and TAR archives stored in
Dicefiles. They are read-only and require `files:read` scope (or a valid session).
Archives larger than 50 MB are rejected to prevent runaway memory usage.

### 22.1 List archive contents

- `GET /api/v1/archive/:key/ls`
- Scope: `files:read`

Returns every file entry inside the archive with its name, uncompressed size,
compressed size, and internal path.

Success:

```json
{
  "ok": true,
  "key": "AbCdEfGh",
  "name": "collection.zip",
  "format": "zip",
  "entries": [
    {
      "path": "docs/readme.txt",
      "name": "readme.txt",
      "size": 1024,
      "compressedSize": 512
    },
    {
      "path": "images/cover.jpg",
      "name": "cover.jpg",
      "size": 204800,
      "compressedSize": 198000
    }
  ]
}
```

Errors:

| Status | `err`               | Meaning                                                |
| ------ | ------------------- | ------------------------------------------------------ |
| 400    | `not_archive`       | File is not a recognised archive format                |
| 400    | `archive_too_large` | Archive exceeds 50 MB                                  |
| 404    | `not_found`         | File key does not exist                                |
| 500    | `extract_failed`    | The archive could not be opened (corrupt or encrypted) |

### 22.2 Extract a single archive entry

- `GET /api/v1/archive/:key/file?path=<encoded-path>`
- Scope: `files:read`
- Response: raw file bytes with `Content-Type` derived from the entry extension.

Streams the decompressed content of a single entry directly to the client.
Individual entries larger than 50 MB are refused with `400 entry_too_large`.

Query parameters:

| Parameter | Required | Notes                                               |
| --------- | -------- | --------------------------------------------------- |
| `path`    | Yes      | URL-encoded internal path, e.g. `docs%2Freadme.txt` |

Errors:

| Status | `err`               | Meaning                                  |
| ------ | ------------------- | ---------------------------------------- |
| 400    | `not_archive`       | File is not a recognised archive format  |
| 400    | `archive_too_large` | Archive exceeds 50 MB                    |
| 400    | `entry_too_large`   | Entry exceeds 50 MB                      |
| 400    | `path_required`     | `path` query parameter was missing       |
| 404    | `not_found`         | File key or internal path does not exist |
| 500    | `extract_failed`    | The archive could not be opened          |

> **MCP exposure:** `GET /api/v1/archive/:key/ls` is exposed as the
> `archive_list_contents` MCP tool (tool #14). The single-entry extraction
> endpoint is not wrapped as an MCP tool because binary download is better
> served by constructing the URL directly and fetching it out-of-band.

---

## 23. Trusted-Host Federation (v1)

The authoritative security and transport contract is
[`docs/FEDERATION.md`](docs/FEDERATION.md). Federation uses its own
`/api/federation/v1` namespace because peer authentication is RFC 9421 HTTP
Message Signatures, not an automation bearer key.

### 23.1 Public discovery

These routes exist only when `federation.enabled` is true. They never enumerate
rooms, files, users, or configured peers.

| Route | Response |
| --- | --- |
| `GET /.well-known/dicefiles-federation` | Protocol version, peer id, canonical origin, capabilities, actor, RSA public JWK and fingerprint |
| `GET /.well-known/webfinger?resource=acct:dicefiles@host` | JRD link to the service actor |
| `GET /.well-known/nodeinfo` | NodeInfo 2.1 discovery |
| `GET /nodeinfo/2.1` | Privacy-safe software/protocol metadata |
| `GET /federation/actor` | ActivityStreams `Service` identity and public key |

### 23.2 Signed peer endpoints

Every request must contain an RFC 9421 `Signature-Input` and `Signature`. The
signature key id must exactly match an enabled, operator-pinned peer record.
Dicefiles never follows a request-supplied key URL. Signatures use
`rsa-v1_5-sha256`, cover the method, target URI, authority, host and date (plus
the content digest for a body), and carry a `dicefiles-federation` tag and
one-time nonce.

| Route | Purpose |
| --- | --- |
| `GET /api/federation/v1/hello` | Bilateral authentication and capability negotiation |
| `GET /api/federation/v1/rooms/:roomId` | Authorized privacy-safe room metadata |
| `GET /api/federation/v1/rooms/:roomId/files?cursor=&limit=&rules=` | Finished, source-filtered files; cursor page |
| `HEAD /api/federation/v1/files/:key?roomId=` | Stream metadata and range support |
| `GET /api/federation/v1/files/:key?roomId=` | Original bytes; supports one HTTP byte range |
| `POST /api/federation/v1/inbox` | ActivityStreams `Add`, `Remove`, or `Update` cache invalidation |

The peer record's `allowedRooms` and the source room's `allowFederation` must
both allow access. Invite-only rooms additionally require
`allowPrivateFederation`. Missing and unauthorized rooms deliberately share the
same `404 FEDERATION_ROOM_UNAVAILABLE` response.

File-list responses contain only:

```json
{
  "protocolVersion": "1.0",
  "room": {
    "id": "releases",
    "name": "Releases",
    "private": false
  },
  "files": [
    {
      "key": "opaque-key",
      "name": "dicefiles.zip",
      "size": 12345,
      "type": "archive",
      "mime": "application/zip",
      "uploadedAt": "2026-07-28T12:00:00.000Z",
      "expiresAt": "2026-08-02T12:00:00.000Z",
      "digest": null
    }
  ],
  "nextCursor": null
}
```

Uploader account, nickname, IP, tags, room membership, moderation state,
storage path, and plugin metadata are excluded.

`rules` is an encoded JSON object using the local link rule fields
`nameContains`, `tagContains`, `userContains`, `types`, `maxAgeHours`, and
`minAgeHours`. The source validates the same comma/OR, AND, and regex syntax as
the automation API, evaluates it before serialization, and returns
`FEDERATION_RULES_INVALID` for malformed input. This lets a remote link select
by private tags or uploader identity without transmitting those values.

Errors have one stable shape:

```json
{
  "error": {
    "code": "FEDERATION_SIGNATURE_INVALID",
    "message": "The federation request could not be authenticated.",
    "requestId": "opaque-correlation-id"
  }
}
```

Important codes include `FEDERATION_DISABLED`, `FEDERATION_PEER_UNKNOWN`,
`FEDERATION_SIGNATURE_REQUIRED`, `FEDERATION_SIGNATURE_INVALID`,
`FEDERATION_KEY_INVALID`, `FEDERATION_REPLAY`,
`FEDERATION_RATE_LIMITED`, `FEDERATION_ROOM_UNAVAILABLE`, and
`FEDERATION_FILE_UNAVAILABLE`.

### 23.3 Local automation endpoints

These routes use the ordinary scoped automation bearer key:

| Route | Scope | Purpose |
| --- | --- | --- |
| `GET /api/v1/rooms/:id/federation-links` | `federation-links:read` | List destination peer-room links and live status |
| `POST /api/v1/rooms/:id/federation-links` | `federation-links:write` | Add `{peerId, roomId, name?, visibility?, rules?}` |
| `DELETE /api/v1/rooms/:id/federation-links/:peerId/:remoteRoomId` | `federation-links:write` | Remove one destination link |
| `PATCH /api/v1/rooms/:id/federation` | `federation-links:write` | Set source `allowFederation` and `allowPrivateFederation` |
| `GET /api/v1/federation/peers` | `admin:read` | Probe configured peers and return status/latency/capabilities |
| `GET /api/v1/federation/audit?limit=100` | `admin:read` | Read bounded newest-first request diagnostics |

Destination status is `active`, `unreachable`, `denied`, `missing`,
`key-invalid`, `protocol-mismatch`, or `circuit-open`. A destination streams
remote bytes through
`/federation/files/:destinationRoomId/:peerId/:roomId/:key/:name`; peer
credentials and source cookies never enter the browser.

The peer response also includes the local active public key fingerprint and any
prepared public rotation record. Private JWK data is never returned. The audit
response is limited to 1–1000 rows and only exposes timestamp, request ID, peer
ID, method, path, status, and stable code.

---

## 24. Authenticated Plugin Inbound Commands (v1.4.4)

Discord and Telegram publisher plugins may optionally receive remote community
commands at:

```text
POST /api/plugins/:pluginId/:roomId/inbound
```

This is a provider-authenticated webhook, not an automation-key endpoint.
Requests are capped at 256 KiB and 120 calls per room/plugin per minute.

Inbound operation is disabled unless the invited room plugin sets
`inboundEnabled: true`, a non-empty `inboundCommands` allowlist, and an explicit
caller allowlist. Supported commands are:

| Command | Effect |
| --- | --- |
| `help` | List commands enabled for this room |
| `status` | Return aggregate file and open-request counts |
| `requests` | List up to eight open request titles |
| `request <text>` | Create a bot-attributed room request |
| `say <text>` | Post a bot-attributed room chat message naming the remote caller |

No shell, plugin installation, arbitrary API path, file deletion, moderation,
or unrestricted code execution is reachable through this endpoint.

### 24.1 Discord interactions

Set `applicationPublicKey`, `allowedInboundUserIds` and/or
`allowedInboundRoleIds`, and point the Discord application's Interactions
Endpoint URL at the plugin's returned `inboundPath`. Dicefiles verifies
`X-Signature-Ed25519` over the timestamp plus exact raw body, rejects
timestamps outside five minutes, handles Discord PING, and deduplicates
interaction IDs. Configure a `/dicefiles` command with subcommands named after
the allowlisted actions; `request` and `say` use a string option named `text`.

Responses are ephemeral by default. Set
`discordEphemeralResponses: false` only when the community should see command
results in the Discord channel.

### 24.2 Telegram updates

Set `inboundWebhookSecret`, `allowedInboundUserIds`, and the existing `chatId`.
Register the returned `inboundPath` with Telegram `setWebhook` and pass the same
value as `secret_token`. Dicefiles compares
`X-Telegram-Bot-Api-Secret-Token` in constant time, enforces the configured
chat and optional forum topic, and deduplicates `update_id`.

Telegram accepts `/status`, `/requests`, `/request text`, `/say text`, and the
equivalent `/dicefiles command text` form. Bot tokens, webhook secrets, and
provider webhook URLs are redacted from room-plugin API reads. Discord's
application public key is intentionally readable because it is not a credential.
