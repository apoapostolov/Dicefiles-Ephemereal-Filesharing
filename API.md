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

| Method | Path                          | Scope            | Session Required |
| ------ | ----------------------------- | ---------------- | ---------------- |
| `POST` | `/api/v1/auth/login`          | `auth:login`     | No               |
| `POST` | `/api/v1/auth/logout`         | `auth:logout`    | Yes              |
| `POST` | `/api/v1/rooms`               | `rooms:write`    | Yes              |
| `POST` | `/api/v1/requests`            | `requests:write` | Yes              |
| `POST` | `/api/v1/uploads/key`         | `uploads:write`  | Yes              |
| `GET`  | `/api/v1/uploads/:key/offset` | `uploads:write`  | Yes              |
| `PUT`  | `/api/v1/uploads/:key`        | `uploads:write`  | Yes              |
| `GET`  | `/api/v1/files`               | `files:read`     | Optional         |
| `GET`  | `/api/v1/downloads`           | `files:read`     | Optional         |
| `POST` | `/api/v1/files/delete`        | `files:delete`   | Yes              |

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
