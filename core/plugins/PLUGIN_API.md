# Hobbyfiles plugin developer reference

**Product release: 1.4.7 · In-process context API: 2 · Runtime: Node.js `^22.13.0 || >=24`**

Build trusted server plugins that collect files, help a community and maintain
its library. This reference documents callable interfaces in 1.4.7. The
[cookbook](./PLUGIN_COOKBOOK.md) gives configuration recipes and implementation
patterns drawn from all 27 core plugins. The [power-user guide](../../docs/CORE_PLUGINS.md)
explains their room-facing behavior.

## 1. Choose an integration surface

| Surface | Use it for | Version and authority |
| --- | --- | --- |
| In-process plugin | Operator-installed Node modules, provider imports, lifecycle hooks and host-rendered reports | `ctx.apiVersion === 2`; trusted server code |
| REST | External applications managing files, requests and invited bots | `/api/v1`; explicit automation key scopes; [REST reference](../../API.md) |
| MCP | Agent tools for the same scoped room operations | Separate protocol/transport version; [MCP reference](../../MCP.md) |
| Webhooks | External receivers of room events | HTTP delivery contract; [webhook reference](../../API.md#8-webhooks) |

An API v2 plugin does not require REST v2 or an MCP version migration.
Manifest `capabilities` describe intent. They do not sandbox Node code or grant
permissions. A module can import server internals, so install only reviewed code.
The injected adapters enforce room scope, bot attribution and specific operator
grants; use them to avoid accidental coupling and cross-room operations.

## 2. Create and register a module

Place the CommonJS module at `lib/plugins/<id>/index.js`. IDs use lowercase
letters, numbers and hyphens; follow the existing short kebab-case IDs. The
following complete module produces a report and makes no room changes.

```js
"use strict";

module.exports = {
  id: "library-overview",
  name: "Library Overview",
  version: "1.0.0",
  description: "Summarize this room's file collection.",
  capabilities: ["files:read", "reports"],
  runModes: ["preview", "run"],
  configSchema: {
    type: "object",
    properties: {
      roomId: { type: "string" },
      pollIntervalMinutes: {
        type: "number", default: 0, minimum: 0, maximum: 10080,
      },
    },
  },
  validateConfig(config = {}) {
    const minutes = config.pollIntervalMinutes ?? 0;
    const ok = typeof config.roomId === "string" &&
      config.roomId.length >= 4 && Number.isSafeInteger(minutes) &&
      minutes >= 0 && minutes <= 10080;
    return { ok, errors: ok ? [] : ["Choose a room and a valid scan interval."] };
  },
  async run(ctx, args = {}) {
    const mode = args.mode || "run";
    if (!["preview", "run"].includes(mode)) {
      throw Object.assign(new Error("Choose Preview or Run."), { retryable: false });
    }
    ctx.signal?.throwIfAborted();
    const inventory = await ctx.hobbyfiles.getRoomInventory();
    return {
      checked: inventory.files,
      report: {
        title: "Library overview",
        summary: `${inventory.files} files; ${inventory.bytes} logical bytes.`,
        items: [{
          title: "Expiring within 24 hours",
          detail: String(inventory.expiringWithin24Hours),
        }],
      },
    };
  },
};
```

For a room-invitable plugin, add its ID to `BUILTIN_IDS` in
[`registry.js`](../../lib/plugins/registry.js). Creating the directory alone does
not add it to the room catalog. Rebuild/restart using the repository's deployment
workflow, invite it in Room Options and save its configuration.

An operator can instead load a module globally through private configuration:

```json
{
  "plugins": [{
    "id": "library-overview",
    "enabled": true,
    "config": { "roomId": "replace-with-room-id", "pollIntervalMinutes": 0 }
  }]
}
```

Global loading resolves the module by ID. A global instance with `roomId` gets
the room-scoped adapters. One without a room remains operator-trusted and lacks
room-scoped jobs. Avoid enabling both a global instance and a room invitation
for the same task unless duplicate scheduling is intentional.

### Module exports

| Export | Contract |
| --- | --- |
| `id`, `name` | Required identity and display name |
| `version`, `description`, `botName`, `category` | Optional catalog/display metadata |
| `capabilities` | Array of descriptive strings; no permission enforcement |
| `runModes` | Advertised modes, usually `preview`/`run`, collector `test`, publisher `test`/`digest` |
| `configSchema` | JSON-schema-like object used by the host configuration form |
| `validateConfig(config)` | Return `{ok, errors?}`; authoritative server validation |
| `run(ctx, args)` | Imperative execution; return a small JSON result, optionally with `report` |
| `eventSubscriptions` | Array of room event names handled by the plugin |
| `hooks.onEvent(event, payload, ctx)` | Quick event handling; queue expensive work |
| `hooks.onStart(ctx)`, `hooks.onStop(ctx)` | Global registry lifecycle hooks; room invitations use room runtime scheduling |
| `inbound.handle(request, ctx)` | Optional authenticated provider handler; see publisher implementation before extending |
| `syncLog` | Import-memory manifest; see section 10 |

### Authenticated inbound handlers

The host routes `POST /api/plugins/:pluginId/:roomId/inbound` to an enabled room
invitation's `inbound.handle(request, ctx)`. The request supplies parsed `body`,
exact `rawBody` and lower-case header names in `headers`. Return
`{status,body}` in the provider's expected response shape. Inbound authority is
separate from automation API keys: verify the provider signature or secret,
destination, caller allowlist and command allowlist before any action.

Discord verifies the raw Ed25519-signed body and supports caller-only replies;
Telegram checks its secret header and ignores unrelated messages. Follow
[Discord](../../lib/plugins/discord-release/index.js),
[Telegram](../../lib/plugins/telegram-release/index.js) and their
[operator setup](./RELEASE_PUBLISHERS.md) for provider-specific response/deferred
delivery handling. Reject invalid signatures rather than parsing them as commands.
Queue slow work, deduplicate provider event IDs and bound returned text. Never
expose arbitrary HTTP, shell or module-loading commands through an inbound bot.

### Configuration forms and defaults

Use `type`, `title`, `description`, `default`, `enum`, `minimum`, `maximum` and
`required` where relevant. Arrays contain short strings. `multiline: true`
requests a multiline editor. Mark secrets with `writeOnly: true` and
`format: "password"`. A `connectionProvider` field offers approved connections:

```js
const fields = {
  connectionId: {
    type: "string", title: "Source", connectionProvider: "drive",
  },
  token: {
    type: "string", title: "Access token", writeOnly: true, format: "password",
  },
};
```

Schema defaults populate the room form; raw custom modules must also handle
missing defaults in their validator and run method. The shared workflow and
collector helpers merge defaults themselves. The server validator must enforce
types, lengths and bounds; a form schema is not validation by itself.

Partial updates preserve omitted configuration and enabled state. In the room
form, a blank password preserves the existing secret; blank non-secret text and
optional numeric fields clear those settings. A room allows 32 invitations and
8,000 characters of shared configuration. Prefer connection references for
credentials and large operator settings.

## 3. Runtime context and execution

| Field | Meaning |
| --- | --- |
| `apiVersion` | `2` |
| `pluginId`, `pluginName`, `botName`, `enabled` | Active instance identity |
| `config` | Saved instance configuration; room invitations inject `roomId` |
| `signal` | AbortSignal during guarded execution; pass it into I/O |
| `log.info/warn/error` | Operator logging; redact secrets before calling |
| `publicBaseUrl` | Operator-configured external origin; it can be empty |
| `dicefiles` | Typed room reads and actions, sections 4–5 |
| `uploadFile`, `http` | File ingest and bounded HTTP, section 6 |
| `state`, `report` | Private state and host-rendered activity, sections 7–8 |
| `jobs`, `connections` | Durable work and approved provider access, sections 9–10 |
| `events` | Ownership-checked event leases, section 9 |
| `scheduleRun(id, args)` | Compatibility scheduling shim; prefer explicit `jobs.enqueue` |
| `remoteDownloaders`, `megaDownloader` | Existing provider/legacy Mega adapters |

Room-scoped methods default to the invited room. Passing another `roomId`
fails. Uploads, messages, requests and links carry the active bot identity;
supplying another identity does not impersonate it through these adapters.

The runtime serializes a bot's active runs with a renewable 900-second lease,
renewed every minute. Queued work also takes a room lease so one queued job runs
per room across workers. Cancellation and lease loss abort cooperative work.
The runtime cannot terminate JavaScript that ignores its signal.

Positive scan intervals run once at startup and then periodically. Zero disables
the timer, while event subscriptions remain active. Unchanged settings retain
their existing timer. A failed global startup hook disables that instance for
the process without stopping other plugins.

Validate mode explicitly in custom plugins. Never infer preview from the absence
of a mode: several core bots default to a real run. A preview may read metadata
and write its report; it must not import, publish, change a file or advance the
source cursor. Provider token refresh can still occur during metadata reads.

## 4. Room reads

Methods below live on `ctx.hobbyfiles`. The established `ctx.dicefiles` property
remains available as a compatibility alias. All object arguments can include the
scoped `roomId`; omit it for a room invitation. Times are Unix milliseconds
unless a field explicitly says otherwise. Treat revisions and cursors as opaque.

| Method | Input / return |
| --- | --- |
| `getRoomSummary(roomId?)` | Positional room ID; `{roomId,name,href,fileTTL,files,openRequests}` |
| `getRoomGuide(spec?)` | `{name,motd,allowRequests,ttlHours}`; rules bounded to 1,000 characters |
| `listFilesPage(spec?)` | `query?`, `since?`, `expiresBefore?`, `cursor?`, `limit?` 1–500; `{files,nextCursor}` |
| `listFiles(spec?)` | Compatibility array containing one page; not an unbounded inventory |
| `getFile({key})` | One room file or 404 |
| `getRoomInventory(spec?)` | `{roomId,files,bytes,byType,expiringWithin24Hours,duplicateGroups,duplicateCopies,measuredAt}` |
| `listRequests({status?,limit?})` | Newest first; open/fulfilled status; limit 1–100; array with opaque revisions |
| `listLinks({limit?})` | Up to 500; default 100; `{id,name,url,date,expires,meta}` entries |
| `getEventItem({event,key})` | Reconstruct a current file/request from its event identity; returns null if unavailable |
| `listSessions(spec?)` | Sessions with aggregate RSVP counts and preparation links; no attendee list |
| `getAccessSummary(spec?)` | Invite/bot counts and approved connection summaries; no credentials |

File results include `key`, `name`, `size`, `hash`, `type`, `uploaded`, `expires`,
`href`, `tags`, sanitized `meta`, `revision` and `assets`. These are plugin-facing
shapes, not direct access to internal Room or Upload objects. A scoped privileged
inventory can include moderation fields such as hidden tags: filter them before
publishing a public digest.

Pagination sorts by uploaded timestamp descending, then key ascending. `since`
is strict. A cursor is not a frozen snapshot; additions and deletions can affect
later pages. Inventory bytes are logical file totals, not disk usage or free
capacity. Hash groups identify review candidates.

```js
async function collectWindow(ctx, maxItems = 250) {
  const files = [];
  let cursor;
  do {
    ctx.signal?.throwIfAborted();
    const page = await ctx.hobbyfiles.listFilesPage({
      cursor, limit: Math.min(100, maxItems - files.length),
    });
    files.push(...page.files);
    cursor = page.nextCursor;
  } while (cursor && files.length < maxItems);
  return files;
}
```

## 5. Room actions and maintenance

### Community actions

| Method | Contract |
| --- | --- |
| `postMessage({text})` | Bot-attributed chat, up to 2,000 characters |
| `createRequest({text,remoteUser?})` | Bot-attributed request, up to 200 characters; respects Allow requests |
| `claimRequest({key,ttlMs?})` | Own bot claim; default five minutes, bounded five seconds–one hour |
| `releaseRequest({key})` | Releases only this bot's claim |
| `fulfillRequest({key,fileKey,expectedRevision})` | Current open request, visible same-room file; checks active claims, records association and fulfillment |
| `curateFile({key,expectedRevision,tags?,undo?})` | Fill absent `genre`, `language`, `series`, `author`, `collection` strings, each up to 200 characters; own-receipt undo |
| `quarantineFile({key,expectedRevision,release?})` | Only the enabled `upload-review` plugin with `allowQuarantine: true`; reversible hidden-state change |
| `addLink({url,title,sourceId,revision,provider})` | HTTP or HTTPS URL, no embedded credentials, up to 2,048 characters; respects link policy; `{id,added}` |

`addLink` removes the URL fragment and deduplicates canonical URLs or stable
source identity. Keep meaningful source IDs stable across feed edits. It is not
the generic room magnet-upload API.

Use a fresh opaque `revision` in reviewed mutations. A 409 means the item/report
changed or the operation is busy; refresh and ask for a new review. Curation
preserves existing fields. Undo checks its own receipt and rejects intervening
edits. Quarantine is a restricted built-in operation, not a general grant to
custom modules. Typed mutations retain up to 50 private audit entries; operations
reads expose the latest 20.

### Maintenance reads and retries

| Method | Behavior and bounds |
| --- | --- |
| `inspectFile({key,expectedRevision?})` | Existence, size and preview state; no server path |
| `retryFilePreview({key,expectedRevision})` | Queue existing preview retry work with its native-tool, concurrency and attempt limits |
| `verifyFile({key,maxBytes?,signal?})` | Read-only stored-byte verification; default 32 MiB, maximum 1 GiB, 8 MiB/s throttle |
| `getStorageMetrics({connectionId})` | Aggregate volumes; approved `maintenance` connection with `settings.capabilities: ["storage:read"]` |
| `probeLink({id,signal?})` | Same-room collected link; public DNS-pinned HEAD, bounded GET fallback, at most three redirects and ten-second deadline |
| `inspectBackup({connectionId})` | Approved `backup` manifest's creation time, file count and bytes |
| `verifyBackup({connectionId,maxFiles?,maxBytes?,cursor?,signal?})` | Isolated sample restore/readback; default two, maximum five samples; default 32 MiB, maximum 1 GiB total reads |
| `retryFileMetadata({key,expectedRevision,signal?})` | Existing embedded book extraction or torrent matching; preserves manual choices |

`verifyFile` returns a `state` such as `verified`, `mismatch`, `missing`,
`unreadable`, `over-budget` or `not-file`, plus byte accounting. It checks the
existing upload checksum format; do not substitute SHA-256 for that format.

`probeLink` distinguishes `reachable`, `broken`, `restricted`, `temporary`,
`rate-limited`, `unreachable` and `unsupported`. A response can include `status`
and `retryAfterMs`. Do not delete a link because access was restricted.

Backup verification counts source and restored reads against its budget, uses
8 MiB/s throttling and removes temporary copies. The manifest is at most 1 MiB
with 1–500 relative regular-file entries containing `path`, `size` and `sha256`.
Real-path containment checks reject traversal. See the
[manifest recipe](./WORKFLOW_BOTS.md#operator-grants). This API neither creates a
backup nor restores production data.

Ordinary video matching still needs the user-facing Video Information search.
`retryFileMetadata` is not a general catalogue query API.

### Sessions from external applications

The injected context exposes `listSessions`; it does not expose a session-create
or RSVP method. Use the existing REST/MCP actions for owner planning:

| REST route | Scope | Input |
| --- | --- | --- |
| `GET /api/v1/rooms/:id/sessions` | `files:read` | Returns `{ok,sessions}` |
| `POST /api/v1/rooms/:id/sessions` | `rooms:write` | `title,startsAt,endsAt?,timezone,description?,links?` |
| `PATCH /api/v1/rooms/:id/sessions/:sessionId` | `rooms:write` | `revision,cancelled` |

Creation requires Session Organizer enabled. Titles have at most 120 characters,
descriptions 1,000, and preparation links 20 local `/g/`, `/q/` or `/r/` paths.
Starts must be within 60 days and duration at most 24 hours. A room retains at
most 100 sessions, each with at most 100 responses, expiring seven days after
its end. RSVP remains a member action through the room UI; automation cannot
impersonate an attendee. Protected rooms also require `room-access:bypass`.

## 6. HTTP and file ingest

All three HTTP methods return `{ok,status,body,headers}`. Non-success status
codes throw a typed error rather than returning an ordinary success value.

| Method | Successful body |
| --- | --- |
| `ctx.http.requestJson(url, options?)` | Parsed JSON, or null for an empty body |
| `ctx.http.requestText(url, options?)` | UTF-8 string |
| `ctx.http.requestBuffer(url, options?)` | Buffer for small binary metadata |

Options: `method`, `headers`, JSON `body`, `signal`, `timeoutMs` and
`maxResponseBytes`. Timeout defaults to 10 seconds, bounded 500–120,000 ms;
response size defaults to 1 MiB, bounded 1 KiB–8 MiB. Redirects are rejected.
The timeout covers body consumption. Stream larger files through a provider
adapter instead of buffering them through this client.

```js
async function readApprovedManifest(ctx) {
  const connection = ctx.connections.resolve(ctx.config.connectionId, "example");
  // The operator fixes this origin in the reviewed module/connection contract.
  const response = await ctx.http.requestJson("https://api.example.org/releases", {
    headers: { authorization: `Bearer ${connection.credentials.accessToken}` },
    signal: ctx.signal, timeoutMs: 10000, maxResponseBytes: 262144,
  });
  return response.body;
}
```

`example` is an illustrative provider name, not a bundled connector. The generic
HTTP client is not an SSRF-safe arbitrary URL proxy. Validate operator-owned
destinations; use the collection network helper for room-supplied public sources.
Never forward credentials across an unapproved redirect.

```js
async function uploadSmallManifest(ctx, manifest) {
  const body = Buffer.from(JSON.stringify(manifest, null, 2));
  return ctx.uploadFile({
    name: "release-manifest.json", body,
    maxBytes: 262144, signal: ctx.signal, skipIfRoomHashExists: true,
  });
}
```

`uploadFile({name,body,roomId?,maxBytes?,signal?,meta?,skipIfRoomHashExists?})`
accepts Buffer, Uint8Array or a Node readable stream. The byte cap defaults to
256 MiB. Prefer streams with an explicit cap for imports. The return includes
`key` and `href`; deduplicated calls can include `skipped`. Preserve only safe
source provenance in metadata. Never copy tokens, signed URLs, Mega keys or raw
connection settings into a room file.

## 7. Private state

`ctx.state` stores small checkpoints in a private plugin/room namespace. A global
instance without a room uses a separate global namespace. Global and invited
instances targeting the same plugin/room share that state scope.
Production uses Redis; Redis persistence
must be configured to survive its own restart.

```js
async function advanceCursor(ctx, cursor) {
  const previous = await ctx.state.get("source:cursor");
  return ctx.state.set("source:cursor", { cursor }, {
    ifVersion: previous?.version ?? null,
    ttlSeconds: 30 * 86400,
  });
}
```

| Method | Contract |
| --- | --- |
| `get(key)` | Null or `{value,version,updatedAt,expiresAt}` |
| `set(key,value,{ifVersion?,ttlSeconds?}?)` | Return the new record |
| `delete(key,{ifVersion?}?)` | Return whether deleted |
| `list({prefix?,limit?,cursor?}?)` | `{entries,nextCursor}`; record metadata, not stored values |

Keys match `[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}`. JSON values have at most
16 KiB and 16 levels of nesting. A namespace has at most 256 keys and 256 KiB,
including record encoding. TTL defaults to 30 days, bounded 60 seconds–90 days.
State is not a blob store, credential vault or replacement room database.

`ifVersion: null` means create only. A version means compare-and-set; omission
permits replacement. Conflicts throw `PLUGIN_STATE_CONFLICT` with status 409;
capacity errors use `PLUGIN_STATE_LIMIT`. Writes/deletes enforce version checks
atomically. Revoking an invitation does not immediately erase its checkpoints.

Advance a source cursor only after its entire page succeeds. Keep stable source
IDs separate from filenames. If a page partly succeeds, revisit it and skip
completed revisions. Recover an expired provider token with bounded reconciliation.

## 8. Reports and review actions

Return `{report:{title,summary,items}}` from `run`; the runtime persists it. Or
call `ctx.report.write(report)` directly. `ctx.report.read()` returns the private
stored record to trusted plugin code. Public operations/UI responses strip each
row's `data`.

```js
const proposal = {
  title: "Collection proposals",
  summary: "Review before applying collection tags.",
  items: [{
    id: "candidate-1", title: "Example book", detail: "Suggested collection: Essays",
    status: "info", href: "/g/example-file",
    data: { key: "example-file", expectedRevision: "opaque-revision", tags: { collection: "Essays" } },
    actions: [{ id: "apply", label: "Add to collection" }],
  }],
};
```

Use real keys/revisions from reads when constructing this illustrative proposal.
Reports have at most 40 rows, three actions per row and 14,000 bytes total. Private
row data is at most 1,024 bytes. Reports expire after 30 days; truncation is
reported. Titles are short, statuses are `info`, `success`, `warning` or `error`,
and links must be local `/g/`, `/q/` or `/r/` paths without query/fragment. Text
passes through bounded redaction. Keep detail text within 300 characters.

Action IDs match `[a-z][a-z0-9-]{0,31}`; item IDs use 1–80 letters, digits,
underscores or hyphens. The host renders controls. Reports cannot inject scripts,
HTML, CSS, iframes or arbitrary new toolbar widgets.

For reviewable workflows, use `defineWorkflow` from
[`workflows.js`](../../lib/plugins/workflows.js). It validates the latest report
ID, item, declared action and handler before executing `args.review`:

```js
"use strict";
const { defineWorkflow, filesFor } = require("../workflows");

module.exports = defineWorkflow({
  id: "essay-curator", name: "Essay Curator",
  fields: {},
  async scan(ctx) {
    const files = await filesFor(ctx);
    return { report: {
      title: "Essay collections", summary: "Review files with a genre but no collection.",
      items: files.filter(file => file.tags?.genre && !file.tags?.collection).map(file => ({
        id: file.key, title: file.name, href: file.href,
        data: { key: file.key, expectedRevision: file.revision, tags: { collection: file.tags.genre } },
        actions: [{ id: "apply", label: "Add to collection" }],
      })),
    } };
  },
  actions: {
    async apply(ctx, data) {
      const result = await ctx.hobbyfiles.curateFile(data);
      return {
        detail: "Collection applied. Undo is available.",
        data: { expectedRevision: result.revision },
        actions: [{ id: "undo", label: "Undo curation" }],
      };
    },
    async undo(ctx, data) {
      await ctx.hobbyfiles.curateFile({ ...data, undo: true });
      return { detail: "Curation undone." };
    },
  },
});
```

This is a complete module for `lib/plugins/essay-curator/index.js`; register it
as described in section 2. The helper adds `preview`/`run`, config defaults,
validation, report handling and review dispatch. Handler return `data` merges
into the private receipt. Return `actions` when another review is available;
otherwise the row's action/data is removed. The helper uses a state version
check to update the report. Do not return a public report after a review: that
would discard private undo data. The helper returns a small review result itself.

Shared workflow defaults: `pollIntervalMinutes: 1440`, `maxItems: 100` (maximum
500), `postToChat: false`, `timezone: "UTC"`, `quietStart: 22`, `quietEnd: 8`.
`filesFor(ctx)` paginates only to `maxItems`. `bulletin(ctx,id,text,dryRun)`
honors preview, chat opt-in, quiet hours and a retained notice key. It records
the key after acceptance; this is not an external delivery transaction.

## 9. Durable jobs and event handling

```js
async function queuePreview(ctx) {
  return ctx.jobs.enqueue({ mode: "preview", idempotencyKey: "source-check-1" });
}
```

| Method | Contract |
| --- | --- |
| `enqueue({type?,mode?,event?,key?,idempotencyKey?,dueAt?})` | Default type `run`; returns public job plus `added` |
| `get(id)` | Current owned public job |
| `list({cursor?,limit?}?)` | `{jobs,nextCursor}`; default 20, maximum 50 |
| `cancel(id)` | `{cancelled}`; fences work and signals active cooperative execution |
| `replay(id)` | `{replayed}`; failed/cancelled jobs only, with current settings |

Jobs require a room scope. Modes are `run`, `preview`, `test` or `digest`, and
must also be supported by the plugin. For event jobs, `event` matches
`[a-z_]{1,64}` and `key` matches `[a-zA-Z0-9_-]{1,128}`. Idempotency keys have
at most 256 characters. `dueAt` is Unix milliseconds, at most 30 days ahead.

The job ID hashes instance scope, configuration fingerprint, type, mode and
idempotency key. Jobs store identifiers and the fingerprint, not raw settings,
credentials or event bodies. Use the same idempotency key for retries of the
same intended operation; use a new one for a distinct scheduled occurrence.
Only the latest 200 finished jobs are retained service-wide. Deduplication is
bounded by retained state, not a permanent exactly-once guarantee.

Public job fields include `id`, `pluginId`, `type`, `mode`, `status`, `attempt`,
`createdAt`, `dueAt`, `finishedAt`, `error` and a bounded `result`. Status is
`queued`, `running`, `retrying`, `completed`, `failed` or `cancelled`.

Retries are bounded to five within seven days and honor Retry-After. A busy
lock gets a delayed retry without spending an attempt. Changed settings or a
disabled/removed invitation invalidate queued work. Replay requires an enabled
invitation and uses its current configuration. A crash after a provider accepts
a message can leave an uncertain delivery; reconcile before replaying it.

### Keep hooks short

```js
const eventSubscriptions = ["file_uploaded"];
const hooks = {
  async onEvent(event, payload, ctx) {
    if (event !== "file_uploaded" || !payload?.key) return;
    await ctx.jobs.enqueue({
      type: "event", event, key: payload.key,
      idempotencyKey: `${event}:${payload.key}`,
    });
  },
};

async function loadQueuedItem(ctx, args) {
  if (args.job?.type !== "event") return null;
  return ctx.hobbyfiles.getEventItem({ event: args.job.event, key: args.job.key });
}
```

These are fragments for a module's exports/run method. The worker passes the job
in `args.job`. Reconstruct the item at execution time and accept that it may
have expired. Do not serialize webhook envelopes into job arguments. The shared
workflow helper can declare `events` and queue its event work automatically;
Welcome Guide uses `member_joined` and its opaque member key.

Common lifecycle names include `file_uploaded`, `linked_file_appeared`,
`file_deleted`, `request_created` and `request_fulfilled`. Use the
[event catalog](./DEVELOPING_PLUGINS.md#plugin-event-catalog) and the actual publisher or
workflow hook as payload examples. External HTTP webhook envelopes are a
separate contract. Do not log entire payloads.

`ctx.events.begin(scope,eventId,{leaseSeconds?})` returns a lease or null when
busy/completed. `renew(lease,seconds?)` returns ownership success;
`complete(lease)` marks completion and `fail(lease)` releases ownership. The
default lease is 120 seconds, bounded 10–900; default completion retention is
30 days. The runtime renews its own execution leases. If custom code acquires
another long-lived lease, it must renew it and stop on lost ownership. These
leases are not atomic with an external provider's write.

## 10. Connections and collection providers

Operators configure `pluginConnections` in private configuration or set
`HOBBYFILES_PLUGIN_CONNECTIONS` to a JSON array. Restart after changes.

```json
{
  "pluginConnections": [{
    "id": "community-drive", "provider": "drive", "label": "Community library",
    "pluginIds": ["drive-collection"], "roomIds": ["replace-with-room-id"],
    "credentials": {
      "clientIdEnv": "DRIVE_CLIENT_ID",
      "clientSecretEnv": "DRIVE_CLIENT_SECRET",
      "refreshTokenEnv": "DRIVE_REFRESH_TOKEN"
    },
    "settings": { "folderIds": ["replace-with-folder-id"] }
  }]
}
```

| Method | Return / behavior |
| --- | --- |
| `connections.list(provider?)` | Approved `{id,provider,label,configured}` values; configured means credentials present, not successful remote access |
| `connections.resolve(id,provider?)` | Server-only `{id,provider,credentials,settings,tokens}` |
| `connections.settings(id,provider?)` | Approved cloned settings without resolving credentials; useful for source-memory inspection |

Every connection requires bot and room grants. `roomIds: ["*"]` deliberately
grants every room. IDs use up to 64 lowercase letters/digits/hyphens. Credential
keys ending in `Env` resolve their environment variable at use; direct strings
are supported but environment references are preferred. An unavailable grant
throws `PLUGIN_CONNECTION_UNAVAILABLE`; a missing environment value throws
`PLUGIN_CREDENTIAL_MISSING`. Both need a configuration repair before retrying.

Resolved values stay on the server. Do not return them from `run`, include them
in reports/logs/state, attach them to uploads or send them to API clients.
Shared OAuth helpers cache rotated tokens in an encrypted Redis vault for 30
days, derived from operator credentials. Changing those credentials invalidates
the cache. The vault is not a general plugin secret store or OAuth consent API.

### Extend a collector

Use `defineCollector` in [`collection/engine.js`](../../lib/plugins/collection/engine.js)
for a new approved source. Its shared engine supplies modes, budgets, filtering,
reports, source/revision deduplication and checkpoint handling. Provider code
supplies `page({config,connection,net,checkpoint,signal})`:

```js
// Shape only: provider-specific discovery and streaming code must be supplied.
const pageResult = {
  entries: [{
    id: "stable-provider-id", name: "release.pdf", revision: "provider-version",
    size: 4096, license: "CC-BY-4.0",
    open: async maxBytes => { throw new Error("Implement a bounded Node stream."); },
  }],
  checkpoint: { cursor: "next-provider-page" },
  hasMore: false,
};
```

This shape is not a runnable provider. A link entry uses `kind: "link"` and
`url` instead of `open`; a removal uses `removed: true`. Discovery returns
metadata without downloading file payloads. Use the injected collection network
guard and signal; validate approved folder/prefix/path grants. The guard pins
DNS, denies private destinations, bounds redirects/bodies and strips cross-origin
authorization. S3 uses its official SDK and operator-owned endpoint/IAM grants.

Common collector defaults are 30 minutes, 25 items, 256 MiB/file and 1 GiB/run;
S3 changes the interval to 60 minutes. Bounds are 200 items, 10 GiB/file and
20 GiB/run, with at most ten pages of 500 entries. Import filters share
`includeExtensions`, `excludeNameContains` and `dryRun`.

The engine hashes provider identity, source fields and approved settings. Filter
and budget changes retain source identity. It commits a checkpoint only after
the whole page succeeds, remembers successful revisions and checks existing room
provenance after an interrupted import. Source removals do not delete local
copies; a new revision creates another file. Preview/test never import or commit
a source cursor.

The helper declares a `syncLog` manifest with `label`, `scope(config)` and
`clearLocal(config)`. Import-memory inspection and confirmed reset use this
manifest. Await cursor deletion during reset. Pause/cancel work first. Existing
room provenance still protects current copies after forgetting revisions.

`remoteDownloaders` is a separate existing multi-host registry, with
`listProviders()`, `resolve(url,allowedProviders?)`,
`listFolder(url,credentials,allowedProviders)` and the asynchronous iterator
`entries(url,credentials,allowedProviders,{signal,pageSize}?)` for newer paged
stream adapters. Follow
[`remote-import`](../../lib/plugins/remote-import/index.js) and
[`remote-downloaders.js`](../../lib/plugins/remote-downloaders.js) for that
contract. Do not mix its `openStream` entries with the collector engine's `open`
entries. `megaDownloader` remains the dedicated Mega compatibility adapter.

## 11. External automation examples

Keep tokens in your shell environment. Use a scoped key restricted to the room;
password-protected rooms also need `room-access:bypass`.

```sh
# Requires room-plugins:write. Save a manual-only Feed Collector invitation.
curl --fail-with-body -X PUT \
  "$HOBBYFILES_URL/api/v1/rooms/$ROOM_ID/plugins/feed-collector" \
  -H "Authorization: Bearer $HOBBYFILES_API_KEY" -H 'Content-Type: application/json' \
  --data '{"enabled":true,"config":{"feedUrl":"https://example.org/feed.xml","allowedOrigins":["https://example.org"],"pollIntervalMinutes":0}}'

# Requires room-plugins:run. Queue a metadata preview.
curl --fail-with-body -X POST \
  "$HOBBYFILES_URL/api/v1/rooms/$ROOM_ID/plugins/feed-collector/jobs" \
  -H "Authorization: Bearer $HOBBYFILES_API_KEY" -H 'Content-Type: application/json' \
  --data '{"mode":"preview","idempotencyKey":"feed-setup-1"}'

# Requires room-plugins:read. Inspect jobs and the latest report.
curl --fail-with-body \
  "$HOBBYFILES_URL/api/v1/rooms/$ROOM_ID/plugins/feed-collector/operations?limit=20" \
  -H "Authorization: Bearer $HOBBYFILES_API_KEY"
```

For a review, POST `{reportId,itemId,action}` to
`/api/v1/rooms/:id/plugins/:pluginId/review` using `room-plugins:write`.
Use current values returned by operations, never a fabricated revision. Cancel
and replay use POST `/jobs/:jobId/cancel` or `/jobs/:jobId/replay` with
`room-plugins:run`. GET `/connections` requires `room-plugins:read`.

MCP equivalents include `configure_room_plugin`, `queue_room_plugin_job`,
`inspect_room_plugin_operations`, `update_room_plugin_job`,
`review_room_plugin_item` and `list_room_plugin_connections`. Their exact inputs
are in the [MCP tool reference](../../MCP.md). Neither REST nor MCP installs new
server code or expands an operator's provider grant.

## 12. Errors, verification and compatibility

Use an actionable message plus typed fields. Avoid embedding a URL, provider
response body or resolved credential in an error:

```js
function missingFolderError() {
  return Object.assign(
    new Error("The selected folder is unavailable. Check its ID and connection grant, then test again."),
    { code: "SOURCE_FOLDER_UNAVAILABLE", status: 404, retryable: false },
  );
}
```

| Condition | Handling |
| --- | --- |
| `PLUGIN_STATE_CONFLICT`, stale review / revision 409 | Read fresh state/report; recompute, then request another review |
| Missing connection or credential | Operator repair; do not loop retries |
| `REMOTE_HTTP_ERROR` 429 or 5xx | Preserve `retryable` and `retryAfterMs`; queue bounded retry |
| `REMOTE_NETWORK_ERROR` | Retry only when marked retryable; caller cancellation is not retryable |
| `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE` | Fix contract/page/body limits; do not claim success |
| `PLUGIN_UPLOAD_TOO_LARGE` | Reduce source size or deliberately raise the file/scan budget |
| Aborted signal | Stop I/O, clean up streams/temp resources and leave the cursor uncommitted |

For a new plugin, cover default/invalid configuration, preview side effects,
room isolation, retries, aborts, partial pages, revision conflicts and secret
redaction. Inject fake adapters around the real module for contract tests. Use
operator-owned destinations for live provider acceptance. A fixture proves the
adapter's expected contract; it does not prove today's account credentials or
external permissions. Follow the repository's test and deployment instructions.

There is no generic arbitrary-code UI slot, automatic provider OAuth consent,
general session-write context method, file-deletion adapter or universal
metadata mutation API in this contract. Add a bounded typed API with a real
plugin, explicit authority, conflict handling and documentation when needed.
Future product work belongs in the [backlog](../../docs/FUTURE_DEVELOPMENT_PLAN.md),
not in the callable reference.

## Source map

| Implementation | Responsibility |
| --- | --- |
| [registry](../../lib/plugins/registry.js) / [room runtime](../../lib/plugins/room-runtime.js) | Module loading, catalog, lifecycle, scheduling and context |
| [runtime adapters](../../lib/plugins/runtime-adapters.js) / [scoped API](../../lib/plugins/scoped-api.js) | Reads, HTTP, upload and room/identity wrappers |
| [workflows](../../lib/plugins/workflows.js) / [workflow API](../../lib/plugins/workflow-api.js) | Shared reports, review dispatch and typed room actions |
| [maintenance API](../../lib/plugins/maintenance-api.js) | File, preview, storage, backup and metadata operations |
| [state](../../lib/plugins/state.js) / [reports](../../lib/plugins/reports.js) | Versioned private checkpoints and public/private report shapes |
| [jobs](../../lib/plugins/jobs.js) / [event leases](../../lib/plugins/event-lease.js) | Durable execution, retry, cancellation and ownership |
| [connections](../../lib/plugins/connections.js) / [credential vault](../../lib/plugins/credential-vault.js) | Operator grants and encrypted OAuth cache |
| [collector engine](../../lib/plugins/collection/engine.js) / [network guard](../../lib/plugins/collection/network.js) | Revision-aware collection and public-network restrictions |
| [sessions](../../lib/plugins/sessions.js) | Room session storage, limits and RSVP privacy |

Continue with the [27-plugin cookbook](./PLUGIN_COOKBOOK.md).
