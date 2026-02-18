# Dicefiles Automation API (Experimental)

This document is intentionally structured for agentic automation clients and skill generators (for example OpenClaw, skills.sh-style wrappers, or MCP adapters).

## 1. Purpose

Dicefiles exposes a machine-focused API for automating:
- user/mod authentication
- room creation
- request creation
- resumable uploads
- file listing and download planning
- deletion with existing permission rules

## 2. Enablement

Set at least one API key in `.config.json`:

```json
{
  "automationApiKeys": ["replace-with-a-long-random-secret"]
}
```

If `automationApiKeys` is empty, all automation endpoints return `404` with:

```json
{"err":"Automation API is disabled"}
```

## 3. Transport + Auth Model

- Base URL: `http://<host>:<port>`
- Content type: `application/json` for JSON routes
- API key header (required for all automation routes):
  - `Authorization: Bearer <api-key>`
  - or `X-Dicefiles-API-Key: <api-key>`
- Session header (required for user actions):
  - `X-Dicefiles-Session: <session-token>`
  - alternatively `session` in body/query on most routes

## 4. Session Lifecycle

1. `POST /api/automation/auth/login` with username/password
2. Store returned `session`
3. Send `X-Dicefiles-Session` on subsequent calls
4. `POST /api/automation/auth/logout` when done

## 5. Endpoint Reference

All responses are JSON.

### 5.1 Login

- Method: `POST`
- Path: `/api/automation/auth/login`
- Auth: API key
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

### 5.2 Logout

- Method: `POST`
- Path: `/api/automation/auth/logout`
- Auth: API key + session
- Success:

```json
{"ok":true}
```

### 5.3 Create Room

- Method: `POST`
- Path: `/api/automation/rooms`
- Auth: API key + session
- Body: empty object allowed
- Success:

```json
{
  "ok": true,
  "roomid": "AbCdEf1234",
  "href": "/r/AbCdEf1234"
}
```

### 5.4 Create Request

- Method: `POST`
- Path: `/api/automation/requests`
- Auth: API key + session
- Body:

```json
{
  "roomid": "AbCdEf1234",
  "text": "Please upload Player Handbook 5e",
  "url": "https://example.com/product",
  "requestImage": "data:image/png;base64,..."
}
```

- Validation rules:
  - `text`: required, max 200 chars
  - `url`: optional, max 500 chars, must be `http` or `https`
  - `requestImage`: optional data URL, max ~2.5MB

### 5.5 Reserve Upload Key

- Method: `POST`
- Path: `/api/automation/uploads/key`
- Auth: API key + session
- Body:

```json
{"roomid":"AbCdEf1234"}
```

- Success:

```json
{
  "ok": true,
  "key": "uploadKeyString",
  "ttlHours": 48
}
```

### 5.6 Query Upload Offset

- Method: `GET`
- Path: `/api/automation/uploads/:key/offset`
- Auth: API key + session
- Success:

```json
{
  "ok": true,
  "key": "uploadKeyString",
  "offset": 1048576
}
```

### 5.7 Upload Bytes (resumable)

- Method: `PUT`
- Path: `/api/automation/uploads/:key?name=<filename>&offset=<n>`
- Auth: API key + session
- Body: raw binary bytes (`application/octet-stream`)
- Behavior:
  - send bytes starting from `offset`
  - use queried offset before each retry/resume

### 5.8 List Files/Requests

- Method: `GET`
- Path: `/api/automation/files`
- Auth: API key (+ session recommended)
- Query:
  - `roomid` (required)
  - `type` = `all` | `uploads` | `requests` | `new`
  - `since` (required for `type=new`, unix ms)
- Success:

```json
{
  "ok": true,
  "roomid": "AbCdEf1234",
  "count": 2,
  "files": []
}
```

Each item may include `isNew` if `since` was provided.

### 5.9 Download Planning (not file bytes)

- Method: `GET`
- Path: `/api/automation/downloads`
- Auth: API key (+ session recommended)
- Query:
  - `roomid` (required)
  - `scope` = `all` | `new`
  - `since` (required for `scope=new`)
- Response contains download-ready items:
  - excludes requests
  - each item includes `href` (typically `/g/<key>`)

### 5.10 Delete Files/Requests

- Method: `POST`
- Path: `/api/automation/files/delete`
- Auth: API key + session
- Body:

```json
{
  "roomid": "AbCdEf1234",
  "keys": ["fileOrRequestKey1", "fileOrRequestKey2"]
}
```

- Permissions:
  - moderators and room owners: can delete any listed entries
  - regular users: can delete only their own uploads/requests

## 6. Error Contract

Common error shape:

```json
{"err":"Human-readable message"}
```

Typical status codes:
- `401` invalid API key or invalid automation session
- `404` automation API disabled
- `400` validation and domain errors (invalid room, payload, permissions)

## 7. Agent Workflow Recipes

### 7.1 Recipe: Create Room + Request

1. Login
2. Create room
3. Create request in that room
4. Optionally list files with `type=requests`

### 7.2 Recipe: Resumable Upload

1. Login
2. Reserve upload key
3. Query offset
4. `PUT` remaining bytes from offset
5. If interrupted: repeat from step 3

### 7.3 Recipe: Batch Download New Uploads

1. Keep `lastSeenMs` in your agent state
2. Call `/api/automation/downloads?scope=new&since=<lastSeenMs>`
3. Download each returned `href`
4. Update `lastSeenMs` after successful batch

## 8. Skill-Generator Mapping (skills.sh/OpenClaw friendly)

Suggested tool definitions:
- `dicefiles_login(username,password,twofactor?) -> {session,user,role}`
- `dicefiles_create_room(session) -> {roomid,href}`
- `dicefiles_create_request(session,roomid,text,url?,requestImage?) -> {request}`
- `dicefiles_upload_key(session,roomid) -> {key,ttlHours}`
- `dicefiles_upload_offset(session,key) -> {offset}`
- `dicefiles_upload_put(session,key,name,offset,binary)`
- `dicefiles_list_files(session,roomid,type,since?) -> {files}`
- `dicefiles_plan_downloads(session,roomid,scope,since?) -> {files}`
- `dicefiles_delete(session,roomid,keys[]) -> {removed}`

State to persist in a skill:
- `apiKey`
- `session`
- `roomid`
- `lastSeenMs`
- per-upload `key` + `offset`

