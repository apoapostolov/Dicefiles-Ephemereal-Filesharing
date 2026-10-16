# Plugin API v2 and extension design

This is the additive **in-process context API**, identified by `ctx.apiVersion
=== 2`. REST remains `/api/v1`; MCP keeps its existing tools and transport.
It supports trusted, operator-installed modules. Capabilities in a plugin
manifest describe intent; they do not sandbox Node code or grant remote users
administrative access. Existing modules need no version migration.

## Implemented surfaces

### Jobs, connections and reports

- `ctx.jobs.enqueue({mode, idempotencyKey?, dueAt?})` queues current bot/room
  work. `get(id)`, `list({cursor?,limit?})`, `cancel(id)`, `replay(id)` expose
  bounded history. Only failed/cancelled jobs replay. Jobs contain IDs and a
  configuration fingerprint, never settings or credentials. Changed/disabled
  invitations invalidate queued work. Five retries honor Retry-After within
  seven days; busy locks do not consume attempts. Renewable ownership aborts
  cooperative work on cancellation/loss. One queued job runs per room across
  workers. The latest 200 finished jobs are retained service-wide and filtered
  by owning bot/room when read.
- `ctx.connections.list(provider?)` returns approved labels and credential
  presence. `resolve(id, provider?)` returns server-only credentials/settings.
  Operator grants require the current bot and room. Never put resolved secrets
  in state, reports, uploads or job arguments. OAuth helpers use a separate,
  encrypted connection vault for rotated credentials.
- Return `report: {title,summary,items}` from `run`, or use
  `ctx.report.write(...)` / `read()`. Reports keep up to 40 rows/14 KiB for 30
  days. Rows support title/detail/status, local room/request/file links, private
  review data and declared actions. Public reads omit private data. Text/errors
  redact configured secrets and remote addresses. Reports appear in Room Options,
  REST and MCP.
- `ctx.dicefiles.listLinks({limit?})` lists room links.
  `addLink({url,title,sourceId,revision,provider})` respects room link policy and
  deduplicates stable source identity/canonical URLs. Metadata discovery preserves
  collector provenance and supplied titles.

The [collection guide](./COLLECTION_BOTS.md) covers provider grants, byte limits,
pinned releases and recovery. Publisher lifecycle events use durable delivery
and reconstruct current room items instead of storing event payloads in jobs.

Room-invited contexts default to their invited room and reject a different room
in injected read, upload, request and message adapters. Uploads, requests and
messages carry the bot identity. A global plugin with a configured `roomId` uses
the same scope; a global plugin without one remains operator-trusted code.

| Surface | Contract and bounds |
| --- | --- |
| `dicefiles.getRoomSummary(roomId?)` | Room name/link, TTL, file and open-request counts |
| `dicefiles.listFiles(spec?)` | Compatibility array, same filters as the paginated API |
| `dicefiles.listFilesPage(spec?)` | `{files, nextCursor}`; `query`, `since`, `expiresBefore`, opaque `cursor`, `limit` 1–500 |
| `dicefiles.getFile({key, roomId?})` | One file in that room; 404 if absent; includes sanitized metadata, tags, times, content hash and download link |
| `dicefiles.getRoomInventory(spec?)` | File count, logical bytes, per-type totals, duplicate-hash groups/copies and files expiring in 24 hours |
| `dicefiles.listRequests(spec?)` | Newest first, optional `status` open/fulfilled, limit 1–100 |
| `dicefiles.createRequest({text, remoteUser?, roomId?})` | Bot-attributed request, max 200 characters, respects Allow requests |
| `dicefiles.postMessage({text, roomId?})` | Bot-attributed chat, max 2,000 characters; do not use for routine poll noise |
| `uploadFile({name, body, roomId?, maxBytes?, signal?, meta?, skipIfRoomHashExists?})` | Buffer, Uint8Array or readable stream; 256 MiB default byte cap; stream-first for large imports |
| `http.requestJson(url, options?)` | `{ok, status, body, headers}`; parses JSON |
| `http.requestText(url, options?)` | Same response shape; UTF-8 string, useful for feeds/manifests |
| `http.requestBuffer(url, options?)` | Same response shape; Buffer, useful for small subtitle/artwork/metadata files |
| `events.begin/renew/complete/fail` | Ownership-checked event leases; completion is atomic in production Redis |
| `state.get/set/delete/list` | Private durable checkpoints, detailed below |
| `remoteDownloaders` | Allowlisted provider discovery, availability, capability and streamed entry adapters |
| `signal` | Runtime cancellation on lost run ownership; combine it with provider deadlines |

File pagination sorts newest timestamp first, then key ascending. It is stable
for tied timestamps, but not a frozen snapshot: inserted/deleted files can change
later pages. `since` is a strict timestamp filter; use the cursor when consuming
an inventory page by page. Inventory bytes are logical room totals, not physical
disk usage or a storage-volume quota. Hash groups are candidates for review,
not proof that a file should be deleted.

HTTP options include `method`, JSON `body`, `headers`, `signal`, `timeoutMs`
(500–120,000; default 10,000) and `maxResponseBytes` (1 KiB–8 MiB; default 1 MiB).
All three methods retain the deadline through body consumption and reject
redirects. Use provider/downloader streams for larger bodies. HTTP failures
carry `code`, `status` when known, `retryable`, and `retryAfterMs` where provided;
error bodies and secret-bearing URLs are not echoed. Caller cancellation is
not retryable. External hosts are still a trusted module's responsibility;
these helpers are not a generic user-configurable URL proxy.

## Private checkpoint storage

Each plugin/room has its own Redis-backed namespace. A global plugin without
a room gets a distinct global namespace. Values are JSON; keys use 1–128
letters/digits with `:`, `.`, `_`, `-`. Limits: **16 KiB/value, 256 keys and
256 KiB/namespace** (including record encoding); JSON nesting is at most 16
levels. Retention defaults to 30 days, configurable per key from 60 seconds to
90 days. Redis persistence is required to survive a Redis restart.

```js
const previous = await ctx.state.get("source:cursor"); // record or null
const next = await ctx.state.set("source:cursor", { cursor: "next-page" }, {
  ifVersion: previous?.version ?? null,
  ttlSeconds: 30 * 86400,
});
// record: {value, version, updatedAt, expiresAt}
await ctx.state.delete("source:cursor", { ifVersion: next.version });
const page = await ctx.state.list({ prefix: "source:", limit: 50 });
// {entries:[{key, version, updatedAt, expiresAt}], nextCursor}
```

`ifVersion: null` means create only; a returned version means compare-and-set;
omitting it permits replacement. Conflicts return code `PLUGIN_STATE_CONFLICT`
and status 409. Capacity failures return `PLUGIN_STATE_LIMIT`; validation errors
explain the bound. Version checks and writes/deletes are atomic across workers.
Expired records are invisible and the Redis namespace expires after its latest
key. Revoking an invitation stops execution; private checkpoints expire according
to their retention and are not immediately erased. Do not store credentials,
file bodies, personal chat logs or a second copy of the room database here.

Commit a provider cursor **after** processing the corresponding page. Do not
advance it during preview or after partial failure. Provider identities and
revisions should be separate from user filenames. An expired provider cursor
needs a bounded reconciliation scan, not an unbounded full-library import.

## Run and event behavior

Declare `runModes`, validate mode/config, and make previews read-only. Importers
provide `run`/`preview`; publishers provide `test`/`digest`. The runtime checks
saved invitations, scopes the target room, rejects disabled bots, and renews
active/scheduled execution leases every minute. Cooperative HTTP/upload/import
adapters abort on lost ownership. Code doing its own I/O must honor `ctx.signal`.
There is no thread termination for a module that ignores cancellation.

Keep hooks quick; use `ctx.scheduleRun(ctx.pluginId, args)` for longer work.
Deferred work rechecks the current invitation. A failed global startup hook
disables that instance for the process and allows other plugins to start.
External delivery cannot be exactly-once: a crash after provider acceptance can
leave an uncertain result. Use ctx.jobs for durable deferred work. Event leases and private state alone
are not a transaction with an external provider.

## Expansion design: useful extension domains

These are **proposed interfaces**, not callable APIs. Deliver them in the order
below alongside a real bot that uses them. Prefer a typed adapter with a bounded
result over a generic shell, SQL, Redis or arbitrary REST endpoint.

| Domain | Proposed contract | Useful applications / boundary |
| --- | --- | --- |
| Jobs and delivery | `jobs.enqueue/get/list/cancel/replay`, `outbox.publish` | Resumable imports, webhook relays, retry-at/Retry-After, dead letters; adapt the existing core durable outbox rather than introduce another queue |
| Connections | `connections.check/resolveCredential` | OAuth/token references, rotation, provider scopes and health; secrets resolved only at use, never in UI/catalog |
| Provider changes | `sources.changes/reconcile`, revision checkpoints | S3, Nextcloud, Drive, Dropbox, OneDrive and selected dataset files; bounded pages and revision-aware replacement |
| Requests | `requests.claim/release/fulfill` | Request triage and fulfillment; revision checks and explicit file association; no fabricated fulfillment |
| Collections | `collections.list/create/add/remove` | Reading lists, episode groups, research bundles; stable item IDs, reversible membership and pagination |
| Metadata | `metadata.propose/apply`, plugin-owned namespaced annotations | Language, license, source, media identifiers and attribution; schema validation, provenance and conflict checks |
| Review queues | `reviews.submit/list/resolve` | Duplicate, suspicious upload and metadata review; recommendations by default, human decision for destructive effects |
| File maintenance | `files.verify/repairPreview/extendExpiry/quarantine` | Integrity reports, preview repair and expiry concierge; explicit grants, budgets and audit events |
| Links and feeds | `links.add/check/refresh`, normalized feed entries | Saved links, publications and release feeds; SSRF-safe adapters and bounded image discovery |
| Membership | `members.summary`, `access.propose` | Welcome/help and access reviews; no user tracking or automatic privilege escalation |
| Policy | `policy.inspect/propose`, rate/budget contracts | Capacity and lifecycle recommendations; policy writes separately granted and previewed |
| Notifications | `notifications.publish/subscribe`, loop/source IDs | Room digests and existing Discord/Telegram publishers; opt-in destinations, quiet defaults and loop prevention |
| Export and backup | `exports.preview/create/verify` | Manifests and restore checks; protected destinations, retention, checksums and explicit data scope |
| Operator diagnostics | `health.providers/jobs/storage`, structured run results | Admin health cards, actionable failures and budgets; no credentials or raw user/IP inventories |
| UI extension slots | Declarative detail panels, metadata rows, review actions and settings schemas | Useful file inspectors and collection tools; host-rendered controls, accessible labels, theme tokens and mobile layouts |

New mutation APIs need a declared permission **and a saved operator/room grant**,
an authoritative room check at execution time, idempotency/conflict handling,
bounded inputs and a structured audit event. Existing capabilities metadata must
not be mistaken for that future grant system. External automation scopes should
map one-to-one to the same typed actions, without gifting owner credentials.

Configuration forms honor explicit JSON-schema `default` values (copied per
instance). Optional numbers without a default stay blank. New importers default
to manual-only scans with positive byte/file limits; Discord responses default
to caller-only. Set schema bounds and required fields alongside defaults, and
keep the plugin's server-side validator authoritative.
Partial room updates preserve omitted configuration and enabled state. A blank
password field in the room form preserves the existing credential; blank
non-secret text and optional numeric inputs explicitly clear those settings.
The merged configuration must fit the room's 8,000-character limit.

UI extensions should describe data and actions, not inject arbitrary scripts,
CSS, iframes or remote code into the room. Keep the toolbar stable; use existing
detail/review surfaces for specialized functions. Background bots should be quiet
on unchanged polls, never post repetitive status chatter, and never enable paid
services, external transmission or destructive cleanup by default.

See the [ordered bot development TODO](../../docs/BOTS_AND_PLUGINS.md#ordered-development-todo)
for the 23 retained proposals, provider research and acceptance criteria.
The user removed original proposals 2, 3, 9, 10 and 12–16; they are outside this
development plan. Community and maintenance proposals 17 onward remain included.


## Typed community and maintenance adapters

All methods below default to the invited room; an explicit different room is
rejected. Bot identity is injected by the host. File/request results include an
opaque **revision** for reviewed mutations. Fetch a fresh report after 409.

| ctx.dicefiles method | Contract |
| --- | --- |
| getRoomGuide({}) | Room name, bounded raw rules, request policy and TTL |
| claimRequest({key,ttlMs?}) / releaseRequest({key}) | Bot-attributed claims, bounded lease; release only its own claim |
| fulfillRequest({key,fileKey,expectedRevision}) | Current open request plus visible same-room file; respects active human claims, records file association and fulfillment metrics |
| curateFile({key,expectedRevision,tags?,undo?}) | Fill absent genre/language/series/author/collection fields; own receipt and conflict-checked undo |
| quarantineFile({key,expectedRevision,release?}) | Enabled Upload Review only, explicit allowQuarantine; reversible hidden state |
| listSessions({}) | Aggregate room-local session data and preparation links; no attendee identities |
| getAccessSummary({}) | Invite/bot counts and connection grant recommendations; no secret values |
| inspectFile({key,expectedRevision?}) | Blob existence and preview availability, without server paths |
| retryFilePreview({key,expectedRevision}) | Existing preview retry worker and limits |
| verifyFile({key,maxBytes?,signal?}) | Read-only content checksum, maximum 1 GiB, default 32 MiB and throttled I/O |
| getStorageMetrics({connectionId}) | Aggregate volumes; maintenance provider with storage:read operator grant |
| probeLink({id,signal?}) | Same-room collected HTTP link; public DNS-pinned HEAD/bounded GET, typed reachability/Retry-After |
| inspectBackup({connectionId}) | Approved backup manifest freshness/count/bytes |
| verifyBackup({connectionId,maxFiles?,maxBytes?,cursor?,signal?}) | At most five isolated sampled restores; source plus restored reads count toward budget |
| retryFileMetadata({key,expectedRevision,signal?}) | Existing extraction/torrent matching queues; missing fields only, manual precedence |

Reviewed mutations record a bounded audit in private bot/room state and emit
plugin:action with operation, item key and timestamp. Reports expose declared
short action IDs and labels; host-rendered buttons call the enabled bot's run
with args.review = {reportId,itemId,action}. Use the shared workflow helper to
validate the current report and retain private undo receipts. Do not return the
public report after an action: it omits the private data needed for undo. A busy
review returns 409; report actions do not use scheduler bucket deduplication.
Reports are data, not arbitrary executable UI; no injected HTML/scripts/iframes.

connections.settings(id,provider?) reads approved server-only source settings
without resolving credentials, allowing import-memory inspection when a token
is missing. It still enforces bot/room grants. Do not expose these settings to
room API callers. Collector syncLog manifests scope remembered revisions to the
same source as private cursors; clearLocal must be awaited. Pause/cancel active
collection before resetting its checkpoint.

See [workflow setup](./WORKFLOW_BOTS.md) for schedules, review semantics, session
limits and the backup manifest. The extension-domain table above describes
possible future normalized namespaces; the callable interfaces are those listed
in the implemented sections, not the proposed names in that table.
