# Hobbyfiles Skill

**Trigger**: Use this skill whenever the user asks you to interact with a Hobbyfiles
room — listing files, uploading URLs, fulfilling requests, enriching metadata,
checking server status, managing storage volumes, protected-room access,
local/federated links, guest invites, room bots, or running any multi-step
file-management workflow against a Hobbyfiles instance.

**Requires**: The `hobbyfiles` MCP server must be registered in mcporter. Verify with:
`mcporter list` — `hobbyfiles` must appear and show status `connected`.

---

## What Hobbyfiles Is

Hobbyfiles is an ephemeral file-sharing platform for hobby communities. Files are
organised into rooms. Each room has uploads (files), requests (unfulfilled asks from
participants), and a chat channel. Rooms are identified by a short alphanumeric
`roomid`.

Hobbyfiles 1.4.7 exposes 57 MCP tools. All network calls go through the tools; never
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
| `archive_list_contents` | Inspect an archive without downloading it                     |
| `list_room_links`       | Inspect a destination room's linked sources and status         |
| `create_room_link`      | Add a linked source with visibility and filter rules           |
| `remove_room_link`      | Remove a linked source from a destination room                 |
| `list_guest_invites`    | List active invite tokens and recent invite activity           |
| `create_guest_invite`   | Mint a bounded guest invite token                              |
| `revoke_guest_invite`   | Revoke an active guest invite token                            |
| `list_federated_room_links` | Inspect trusted peer-room links and live status            |
| `create_federated_room_link` | Add a source room from an operator-pinned peer              |
| `remove_federated_room_link` | Remove one exact peer/remote-room link                       |
| `set_room_federation_policy` | Opt a source room into trusted-host federation               |
| `list_room_plugins`     | List invited bots, catalog, redacted settings, and run status    |
| `configure_room_plugin` | Invite or partially update an installed room bot                 |
| `remove_room_plugin`    | Remove an invited bot from a room                                 |
| `run_room_plugin`       | Run one already invited room bot immediately                      |
| `inspect_room_plugin_sync_memory` | Inspect remembered imports and latest run state       |
| `clear_room_plugin_sync_memory` | Confirm and clear remembered import state                |
| `get_storage_volumes`   | Inspect storage tiers, capacity, reservations, and health             |
| `preview_storage_placement` | Preview a blob destination without writing it                   |
| `get_room_password_access` | Read protection policy without revealing passwords                |
| `configure_room_password_access` | Enable, update, or disable rotating room access           |
| `rotate_room_password`  | Replace the password and revoke existing visitor grants                |
| `reveal_room_passwords` | Reveal current/prepared secrets under a sensitive scope                 |
| `list_remote_import_providers` | Inspect provider availability and capabilities |
| `validate_remote_import_source` | Validate a supported source without importing |
| `list_storage_migrations` | Read the paginated migration journal |
| `plan_storage_migration` | Plan move/drain/rebalance; dry run by default |
| `control_storage_migration` | Explicitly pause, resume or roll back a move |
| `set_storage_volume_draining` | Stop new allocations or re-enable a volume |
| `list_room_access_credentials` | Read cohort/personal credential metadata |
| `create_room_access_credential` | Create a bounded cohort/personal credential |
| `update_room_access_credential` | Change label, state or activation limits |
| `revoke_room_access_credential` | Revoke one credential and its grants |
| `rotate_room_access_credential` | Rotate one credential |
| `reveal_room_access_credential` | Sensitive owner-authorized password reveal |
| `get_room_access_audit` | Read bounded access administration history |
| `inspect_room_plugin_operations` | Read jobs, report and reviewed-action history |
| `list_room_plugin_connections` | List approved connection references without secrets |
| `queue_room_plugin_job` | Queue an invited bot's preview or real run |
| `update_room_plugin_job` | Cancel or replay failed/cancelled work |
| `review_room_plugin_item` | Apply a current declared report action |
| `list_room_sessions` | Read sessions and aggregate RSVP counts |
| `create_room_session` | Plan a room-local session with preparation links |
| `update_room_session` | Cancel or restore using the current revision |

See [MCP.md](../../MCP.md) for exact schemas and scopes. In-process extensions
use a separate [Plugin API 2](../../core/plugins/PLUGIN_API.md). Room owners can
use the [27-bot guide](../../docs/CORE_PLUGINS.md).

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
   f. verify request state before reporting fulfillment; a plain URL upload
      and claim release do not establish a file/request association
   g. on failure: release_request(key) immediately, do not leave it claimed
```

### E. Batch ingest from a URL list

```
upload_file_from_urls(roomid, urls)
→ max 20 URLs per call — batch if more
→ check results array for per-URL errors
→ report summary: X succeeded, Y failed
```

### F. Curate a linked room

```
list_room_links(destination)
→ create_room_link(destination, source, visibility, rules)
→ list_room_links(destination) and confirm status="active"
```

The source must allow cross-linking. For invite-only sources, require explicit
operator approval before setting `allowPrivateSource`; the source must consent too.

### G. Issue temporary guest access

```
create_guest_invite(roomid, singleUse=true)
→ deliver the returned token through a private channel
→ revoke_guest_invite(roomid, token) if access should end early
```

Guest invite tokens are bearer secrets. Never post them to room chat or logs.

### H. Curate a trusted-host room

```
list_federated_room_links(destination)
→ create_federated_room_link(destination, peerId, remoteRoomId, rules)
→ list_federated_room_links(destination) and confirm status="active"
```

Never invent or add peer trust. The operator must pin the peer/key in local
configuration first. Uploader/tag rules execute on the source without returning
those private values.

### I. Operate an invited room bot

```
list_room_plugins(roomid)
→ configure_room_plugin(roomid, pluginId, config) when authorized
→ run_room_plugin(roomid, pluginId)
→ list_room_plugins(roomid) and inspect lastRun
```

Omit stored secret fields unless replacing them; the API preserves omitted
credentials and never returns their values. A tool cannot install code or run
an uninvited catalog plugin.

For recoverable work prefer queue_room_plugin_job with an explicit mode, then
inspect_room_plugin_operations. Read reports before reviewing an action with
review_room_plugin_item. A stale report or revision needs a refresh. Connection
grants remain operator-owned. Cancellation cannot undo completed side effects;
replay uses current settings. Disabled bots cannot execute.

Session Organizer enables owner planning through create_room_session and
revision-checked cancellation/restore. RSVP stays in the room UI; tools expose
aggregate counts, not attendee identities.

### J. Inspect storage placement

```
get_storage_volumes()
→ preview_storage_placement(bytes)
→ report the selected tier and any hard-full or unavailable volume
```

These two inspection tools do not move existing blobs. The separate migration
and draining tools can change storage with admin:storage authority. Use a dry-run
plan first and explicit authorization before executing. Do not rename durable
volume IDs or edit storage configuration as a substitute for a migration.

### K. Operate protected community access

```
get_room_password_access(roomid)
→ configure_room_password_access(...) or rotate_room_password(...)
→ reveal_room_passwords(roomid) only for explicit owner delivery
```

Never put revealed passwords in chat, logs, memory, or ordinary summaries.
Content tools also require explicit `room-access:bypass` for protected rooms.

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

The tool set does not expose generic file deletion or user impersonation.
Specific reviewed bot actions, owner session changes, access administration and
storage migrations are available with their documented scopes and saved grants.
Check MCP.md for each tool's authority; do not treat a plugin capability label
as permission. Use a separate scoped REST integration for unsupported actions.

---

## Configuration Reference

The MCP server is started by mcporter using:

```json
{
  "mcpServers": {
    "hobbyfiles": {
      "command": "node",
      "args": ["/path/to/Hobbyfiles/scripts/mcp-server.js"],
      "env": {
        "HOBBYFILES_BASE_URL": "http://localhost:10005",
        "HOBBYFILES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Possible scopes by workflow (grant only those needed):
`files:read`, `files:write`, `uploads:write`, `requests:write`, `rooms:write`,
`room-links:read`, `room-links:write`, `guest-invites:read`,
`guest-invites:write`, `federation-links:read`,
`federation-links:write`, `room-plugins:read`, `room-plugins:write`,
`room-plugins:run`, `room-access:read`, `room-access:write`,
`room-access:secrets`, `room-access:bypass`, `admin:read`, `admin:storage`

Basic public-room file reads use files:read. Add room-plugins:read for bot
activity, admin:read for storage health, and room-access:bypass for protected
content. Sensitive reveal/write scopes are not needed for ordinary monitoring.

Local configuration above uses stdio. HTTP follows the stateless 2026-07-28
protocol, without initialize or Mcp-Session-Id. Remote use requires incoming
authentication and explicit host/origin controls; OAuth mode separates callers.
See MCP.md before exposing a listener.
