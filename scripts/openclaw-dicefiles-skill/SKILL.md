# Dicefiles Skill

**Trigger**: Use this skill whenever the user asks you to interact with a Dicefiles
room — listing files, uploading URLs, fulfilling requests, enriching metadata,
checking server status, or running any multi-step file-management workflow against
a Dicefiles instance.

**Requires**: The `dicefiles` MCP server must be registered in mcporter. Verify with:
`mcporter list` — `dicefiles` must appear and show status `connected`.

---

## What Dicefiles Is

Dicefiles is an ephemeral file-sharing platform for hobby communities. Files are
organised into rooms. Each room has uploads (files), requests (unfulfilled asks from
participants), and a chat channel. Rooms are identified by a short alphanumeric
`roomid`.

The MCP server exposes 13 tools. All network calls go through the tools — never
construct raw HTTP requests.

---

## Tool Inventory

| Tool                    | One-line purpose                                             |
| ----------------------- | ------------------------------------------------------------ |
| `server_health`         | Pre-flight check: Redis, storage, and metrics counters       |
| `list_files`            | List uploads and/or requests in a room with optional filters |
| `get_file`              | Full metadata for a single file (tags, meta, asset URLs)     |
| `get_room_snapshot`     | Aggregate summary: counts, total bytes, open requests        |
| `update_file_metadata`  | Write AI captions, OCR text, author/genre/series tags        |
| `upload_file_from_urls` | Server-side ingest of 1–20 public URLs into a room           |
| `create_request`        | Post a file request into a room on behalf of a user          |
| `claim_request`         | Exclusively claim an open request (prevents parallel agents) |
| `release_request`       | Release a claim immediately without waiting for TTL          |
| `post_room_chat`        | Send a status message visible to room participants           |
| `download_file`         | Fetch a file and return its content as base64 (≤5 MB)        |
| `save_subscription`     | Persist a named filter preset for this API key               |
| `list_subscriptions`    | Retrieve all saved filter presets at agent startup           |

---

## Standard Startup Sequence

Run these steps at the beginning of every autonomous session:

```
1. server_health           → abort if ok=false (Redis or storage degraded)
2. list_subscriptions      → restore any previously saved filter configurations
3. get_room_snapshot(roomid) → orient: how many files, open requests, total size
```

If `server_health` returns a degraded dependency, report the issue to the user and
stop. Do not proceed with writes against a degraded server.

---

## Common Workflows

### A. Discover and summarise a room

```
get_room_snapshot(roomid)
→ report fileCount, openRequestCount, totalBytes in plain English
→ if openRequestCount > 0: list_files(roomid, type="requests")
→ summarise open requests to the user
```

### B. Incremental file polling (new-files-only)

Persist `lastSeenMs` across runs (use `save_subscription` to store it server-side if
no local state is available):

```
list_files(roomid, type="new", since=lastSeenMs)
→ for each file: get_file(key) if metadata enrichment is needed
→ update lastSeenMs to max uploaded timestamp from results
```

### C. Metadata enrichment pass

For each untagged file returned by `list_files`:

```
1. get_file(key)                          # check existing tags
2. if meta.ai_caption already set: skip
3. download_file(key, maxBytes=2097152)   # 2 MB cap for document snippets
4. [call external model / catalog API]
5. update_file_metadata(key, meta={...}, tags={...})
6. post_room_chat if user is watching:    "Enriched: <filename>"
```

Never call `update_file_metadata` with empty `meta` and `tags` — skip the call if
there is nothing to write.

### D. Request fulfillment loop

```
1. list_files(roomid, type="requests")
2. for each open (unclaimed) request:
   a. claim_request(key, ttlMs=180000)   # 3-minute TTL
   b. if 409 returned: skip (another agent has it)
   c. attempt to source the file
   d. on success: upload_file_from_urls(roomid, [url])
   e. release_request(key)               # or let TTL expire on crash
   f. post_room_chat: "Fulfilled: <request text>"
   g. on failure: release_request(key) immediately, do not leave it claimed
```

### E. Batch ingest from a URL list

```
upload_file_from_urls(roomid, urls)
→ max 20 URLs per call — batch if more
→ check results array for per-URL errors
→ report summary: X succeeded, Y failed
```

---

## Error Handling

| Situation                            | Action                                                     |
| ------------------------------------ | ---------------------------------------------------------- |
| `server_health` → `ok: false`        | Stop all writes; report to user                            |
| `claim_request` → HTTP 409           | Skip this request; move to the next                        |
| `download_file` → `ok: false, err`   | Report size/status; use `get_file` href instead            |
| Any tool → `ok: false`               | Surface the `err` field to the user; do not retry blindly  |
| `upload_file_from_urls` partial fail | Report failed URLs; do not retry without user confirmation |

---

## Scope Reminder

The MCP server cannot delete files, access moderation endpoints, or impersonate users.
If a task requires those actions, inform the user that the REST API must be called
directly with appropriate credentials (see API.md).

---

## Configuration Reference

The MCP server is started by mcporter using:

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

Scopes needed for full automation:
`files:read`, `files:write`, `uploads:write`, `requests:write`, `rooms:write`

For read-only monitoring, `files:read` alone is sufficient.
