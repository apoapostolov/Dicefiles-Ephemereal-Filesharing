# Automation workflows for Dicefiles 1.4.7

Dicefiles exposes a scoped REST API, 57 MCP tools and 27 opt-in core plugins.
Use MCP for an agent that needs typed tools. Use REST for an external service.
Use an in-process plugin for operator-installed background collection or room
workflows. The [power-user guide](./CORE_PLUGINS.md),
[Plugin API reference](../core/plugins/PLUGIN_API.md) and
[cookbook](../core/plugins/PLUGIN_COOKBOOK.md) cover the plugin path.

## Connect with the right authority

1. Check `server_health` or `GET /healthz`. Resolve degraded storage/Redis before writes.
2. Give the caller only the needed scopes and room restrictions.
3. Protected rooms require `room-access:bypass` in addition to the action scope.
4. Keep secrets out of room chat, reports and saved job payloads.

The standalone MCP process reads the same environment file as the application:

```sh
DICEFILES_BASE_URL=http://127.0.0.1:8080 \
DICEFILES_API_KEY=replace-with-scoped-key \
node scripts/mcp-server.js
```

Local clients use stdio. HTTP uses the stateless MCP 2026-07-28 core: no initialize
handshake or `Mcp-Session-Id`, with a fresh server per request. Remote bindings
need explicit incoming authentication and host/origin controls. OAuth mode maps
callers to separate upstream keys and allowed scopes. Use the full
[MCP setup](../MCP.md) for transport headers, OAuth and client configuration.
Context API 2 is the in-process plugin contract; REST remains `/api/v1`.

## 1. Monitor files without skipping a page

Use `list_files` with `limit` and `cursor`, or REST
`GET /api/v1/files?roomid=...&limit=100`. Paginated REST results include
`pagination.nextCursor`. Keep filters identical for every page; signed cursors
expire after 30 minutes. Deduplicate by stable file key in the receiving agent.

For incremental scans, hold the previous timestamp fixed while reading every
page. Persist a watermark only after processing the window. Revisit a small
overlap and skip known keys to handle tied timestamps and concurrent arrivals.
Do not increment `since` after each individual result or use the displayed name
as an identity. A cursor is not a frozen snapshot.

For event-driven external work, configure signed `file_uploaded` webhooks.
Verify HMAC-SHA256 over the timestamp and exact raw body with a constant-time
comparison, reject malformed signatures before comparing their lengths, and
apply a freshness/replay policy. The [REST webhook reference](../API.md) defines
the headers and envelope. In-process hooks receive the event name and payload,
not that HTTP envelope. Queue expensive work and re-read current room data.

## 2. Collect files from an approved source

Prefer a built-in collector when the source is RSS/Atom, S3, Nextcloud, Drive,
Dropbox, OneDrive or pinned Hugging Face files. Supported locker URLs use
Remote Host Import or Mega.nz Autoshare. Provider permissions remain with the
operator; an agent cannot grant itself access by saving a connection ID.

MCP sequence:

```text
list_room_plugins(roomid)
list_room_plugin_connections(roomid, pluginId)
configure_room_plugin(roomid, pluginId, config, enabled=true)
queue_room_plugin_job(roomid, pluginId, mode="preview", idempotencyKey="setup-1")
inspect_room_plugin_operations(roomid, pluginId)
```

These are workflow sketches; use the tool's schema for exact argument fields.
Configuration requires `room-plugins:write`, execution `room-plugins:run` and
inspection `room-plugins:read`. Read the preview before authorizing an import.
A plugin must be installed, invited and enabled before it can execute.

For individual public URLs, `upload_file_from_urls` supports batches of up to
20 and returns per-item outcomes. Check each result. Retry failed items only
when their errors permit it; do not repeat successful uploads blindly. There is
no general shell execution or arbitrary server-code installation through MCP.

## 3. Review a bot suggestion

Request Triage, Collection Curator, Upload Review, Preview Repair and Metadata
Steward expose typed actions through their latest report. Inspect the report,
show the proposed effect to the authorized user, then call
`review_room_plugin_item(roomid,pluginId,reportId,itemId,action)` with its actual
IDs. Review needs `room-plugins:write`.

A 409 means a stale report, conflicting item or busy bot. Refresh and recompute.
Do not reuse an old action against a different file. Public report data excludes
private undo receipts; the plugin retains those itself. Upload Review quarantine
also requires the owner's saved `allowQuarantine` setting.

## 4. Work on a request honestly

List open requests and claim one before spending time sourcing it. A claim is a
bounded lease; release it when the task cannot be completed. Respect other
active claims and the room's request policy.

Uploading a similarly named file does not by itself prove fulfillment. For an
existing room file, Request Triage can prepare a reviewed association and call
the typed fulfillment adapter. For an external upload, follow the REST
request-fulfillment contract when the caller has that authority. Confirm the
resulting request state before reporting it as fulfilled.

Do not use `release_request` as a substitute for fulfillment or post a success
message after a failed upload. Human confirmation remains useful when editions,
languages or file variants are ambiguous.

## 5. Enrich metadata without erasing manual work

Read `get_file` before `update_file_metadata`. Write only missing values that
the evidence supports. Keep provider IDs and provenance where the documented
schema accepts them. Skip an empty patch.

Use `download_file` only when content is needed, with a deliberate `maxBytes`.
Its default is 5 MiB and configurable cap is 20 MiB; inspect metadata first.
For book extraction and torrent matching, Metadata Steward reuses the existing
workers. Ordinary videos use Video Information for catalogue search and user
confirmation. Do not promise a generic plugin catalogue-search method.

## 6. Operate durable work

`queue_room_plugin_job` records identifiers and a configuration fingerprint.
Inspect attempts and safe errors through `inspect_room_plugin_operations`.
`update_room_plugin_job` cancels or replays failed/cancelled work. Replay uses
current settings. Disabled/removed invitations cannot execute; changed settings
invalidate old queued jobs.

Cancellation is cooperative and cannot undo a completed import or provider
message. Jobs retry with bounded attempts and Retry-After. Check an external
destination before replaying a delivery with an uncertain outcome. History and
idempotency are retained for a bounded period, not forever.

## 7. Run maintenance with a useful budget

- File Integrity rotates checksum checks through the inventory with an I/O cap.
- Storage Capacity needs an operator-approved metrics connection; it reports aggregates.
- Backup Verification samples an existing backup into isolated temporary storage.
- Link Health distinguishes removed, restricted, temporary and rate-limited responses.
- Access Review proposes invitation/connection cleanup without revoking access.
- Expiry Concierge warns about files nearing expiry without extending retention.

Preview first. A report covers a bounded window, and a sample restore is not a
full disaster-recovery test. Storage migration tools are separate explicit
administrative writes: `plan_storage_migration` defaults to dry run, while
execution/control requires `admin:storage`. Read the
[storage guide](./MULTI_VOLUME_STORAGE.md) before moving or draining a volume.

## 8. Plan a room session

Enable Session Organizer, then use `list_room_sessions`, `create_room_session`
and `update_room_session`. Planning and cancellation need `rooms:write`; listing
uses `files:read`. Use Unix millisecond times and an IANA display timezone, with
local preparation links. Updates require the current revision.

Members RSVP through the room UI. Automation sees aggregate counts and cannot
respond as another person. No external calendar is changed.

## 9. Handle errors and private outputs

MCP failures set `isError` and include structured error information. Report the
action that failed and a useful recovery step. Preserve retry hints; repair
invalid configuration rather than looping. Partial batches remain partial.

Passwords and access tokens require explicit owner authorization and sensitive
scopes before reveal. Do not include them in ordinary summaries, saved memory
or logs. Grant the smallest scope set for the intended workflow, not every
available scope as a setup shortcut.

## References

- [REST contract, pagination and scopes](../API.md)
- [MCP transport and all 57 tools](../MCP.md)
- [All 27 core plugins](./CORE_PLUGINS.md)
- [Developer reference](../core/plugins/PLUGIN_API.md) and [cookbook](../core/plugins/PLUGIN_COOKBOOK.md)
- [Operator connection setup](../core/plugins/COLLECTION_BOTS.md)
- [Future proposals](./FUTURE_DEVELOPMENT_PLAN.md), kept separate from callable APIs
