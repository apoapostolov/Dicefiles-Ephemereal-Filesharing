# Developing Dicefiles plugins

This guide explains how to build **first-party plugins** that hook Dicefiles’
event bus and automation surface. Shipped examples include **Mega.nz Autoshare**
(`mega-folder`) plus the Discord and Telegram release publishers. See
**[RELEASE_PUBLISHERS.md](./RELEASE_PUBLISHERS.md)** for operator setup.

Audience: operators and developers who already run a self-hosted Dicefiles instance.

---

## 1.4.4 runtime contract

Release 1.4.4 makes event-driven plugins a supported first-party integration path:
plugins can subscribe to room lifecycle events, call bounded Dicefiles adapters,
perform timeout-limited JSON requests, and acquire Redis-backed one-time event
leases before publishing to an external service. Scheduled runs are leased
across workers, bounded last-run status is retained, and room bots have scoped
REST/MCP administration. Discord and Telegram release publishers are the
reference outbound and authenticated-inbound implementations.

---

## 1. Concepts

| Concept | Role |
|---------|------|
| **Webhook events** | Outbound HTTP notifications (`lib/webhooks.js`) for bots and external automation |
| **Plugin registry** | In-process loader for modules under `lib/plugins/<id>/` (`lib/plugins/registry.js`) |
| **Plugin hooks** | Optional `onStart` / `onStop` / `onEvent` callbacks |
| **Event subscriptions** | Declarative room-scoped lifecycle events handled by a plugin |
| **Plugin `run()`** | Imperative entry point (e.g. “sync Mega.nz folder now”) |
| **Automation API** | REST `/api/v1/*` with scoped API keys (unchanged; plugins complement it) |

Plugins run **inside the Dicefiles Node worker**, with the same trust as core code. Do not load untrusted third-party code without your own sandboxing.

---

## 2. Event catalog (webhooks + plugins)

Configure outbound hooks in `.config.json` → `webhooks[]`. Each hook lists the events it wants.

| Event | When |
|-------|------|
| `file_uploaded` | A finished upload is registered |
| `file_deleted` | An upload is about to be deleted |
| `request_created` | A request card is created |
| `request_fulfilled` | A request is fulfilled |
| `linked_file_appeared` | A file uploaded to source room **S** matches destination room **D**’s multi-room link rules (S has cross-linking on) |
| `guest_invite_created` | Owner mints a guest invite link |
| `guest_invite_redeemed` | A guest invite use is consumed |

Payload shape (common envelope):

```json
{
  "id": "delivery-id",
  "event": "file_uploaded",
  "timestamp": "2026-07-27T12:00:00.000Z",
  "payload": { },
  "attempt": 1
}
```

Headers when a `secret` is set:

- `x-dicefiles-event`
- `x-dicefiles-webhook-id`
- `x-dicefiles-timestamp`
- `x-dicefiles-signature` = HMAC-SHA256 hex of `${timestamp}.${body}` with the hook secret

Plugins receive the same **event name** and **payload object** (not the HTTP envelope) via `hooks.onEvent(event, payload, ctx)`.

---

## 3. Plugin module contract

Create `lib/plugins/<plugin-id>/index.js` exporting:

```js
module.exports = {
  id: "my-plugin",           // required, kebab-case
  name: "Human name",        // required (also default bot label)
  botName: "My Bot",         // optional; file-list BOT pill label
  version: "1.0.0",
  description: "…",
  capabilities: ["events:read", "rooms:read", "network:write"],
  eventSubscriptions: ["file_uploaded"],
  configSchema: { /* JSON-Schema-like object for docs */ },

  /** @returns {{ ok: boolean, errors?: string[] }} */
  validateConfig(config) { return { ok: true }; },

  hooks: {
    async onStart(ctx) {},
    async onStop(ctx) {},
    async onEvent(event, payload, ctx) {},
  },

  /** Imperative entry (CLI/job/automation wrapper) */
  async run(ctx, args) { return { ok: true }; },

  /** Optional provider-authenticated webhook handler */
  inbound: {
    async handle(request, ctx) {
      return { status: 200, body: { ok: true } };
    },
  },
};
```

### Bots (identity)

Plugins **act like bots**, not like silent system noise:

| Piece | Behavior |
|-------|----------|
| `plugin.botName` or `plugin.name` | Display name on uploads |
| `role: "bot"` | Stored on upload meta |
| File list UI | Cyan **BOT** pill + name (`tag-bot`) |
| Chat (if used) | `.u.bot` color + BOT glyph |

`makePluginCtx` wraps `ctx.uploadFile` so every upload gets `botName`, `role: "bot"`, and `meta.plugin` unless you override.

### Context (`ctx`)

Provided by the registry:

| Field | Meaning |
|-------|---------|
| `pluginId` | Same as `plugin.id` |
| `pluginName` / `botName` | Display identity for the bot |
| `config` | Per-instance config from `.config.json` → `plugins[].config` |
| `enabled` | boolean |
| `log` | `{ info, warn, error }` (when started from httpserver) |
| `scheduleRun(id, args)` | Queue `run()` without blocking the event path |
| `uploadFile` | Bot-attributed buffer or stream ingest. Streams are written through bounded temporary storage when `maxBytes` is supplied. |
| `megaDownloader` | Compatibility adapter for the dedicated Mega.nz bot. |
| `remoteDownloaders` | Allowlisted provider registry used by multi-host importers (`resolve` / `listFolder`). |
| `publicBaseUrl` | Operator-configured public Dicefiles origin for external links |
| `http.requestJson(url, options)` | Timeout-bounded JSON HTTP client whose errors do not echo secret-bearing URLs |
| `events.begin/complete/fail` | Redis-backed one-time event lease for multi-worker idempotency |
| `dicefiles.getRoomSummary(roomId)` | Stable room identity/read surface |
| `dicefiles.listFiles({roomId, since?, limit?})` | Stable, bounded file read surface |
| `dicefiles.listRequests({roomId, status?, limit?})` | Stable, bounded request read surface |
| `dicefiles.createRequest({roomId, text, remoteUser?})` | Create a bot-attributed request |
| `dicefiles.postMessage({roomId, text})` | Post bot-attributed room chat without importing Broker internals |

`capabilities` are documentation and catalog metadata, not a sandbox. First-
party plugins still run as trusted server code. The injected adapters make the
contract testable and reduce accidental coupling to core modules.

### Room Options → Plugins (operators)

Owners/mods invite bots into a **room** from the registry (not only via `.config.json`):

| RPC (`setconfig` name) | Purpose |
|------------------------|---------|
| `listPluginCatalog` | Available bots + this room’s invitations |
| `inviteRoomPlugin` / `updateRoomPlugin` | Invite or update settings |
| `revokeRoomPlugin` | Remove bot from room |
| `runRoomPlugin` | Manual “Run now” |
| `inspectRoomPluginSyncMemory` | Latest run plus bounded remembered-import state |
| `clearRoomPluginSyncMemory` | Confirmed reset of remembered imports |
| `listRoomPlugins` / `setRoomPlugins` | List / replace full list |

Per-room storage: `roomPlugins` on the room config. Runtime pollers sync via `lib/plugins/room-runtime.js`.

The equivalent automation endpoints use dedicated least-privilege scopes:

| REST route | Scope |
| --- | --- |
| `GET /api/v1/rooms/:id/plugins` | `room-plugins:read` |
| `PUT /api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` |
| `DELETE /api/v1/rooms/:id/plugins/:pluginId` | `room-plugins:write` |
| `POST /api/v1/rooms/:id/plugins/:pluginId/run` | `room-plugins:run` |
| `GET /api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:read` |
| `DELETE /api/v1/rooms/:id/plugins/:pluginId/sync-log` | `room-plugins:write` |

Read responses redact secret-like configuration fields and include bounded
last-run state. PUT merges supplied config so omitted credentials survive.

### Configuration

In `.config.json`:

```json
{
  "plugins": [
    {
      "id": "mega-folder",
      "enabled": true,
      "config": {
        "folderUrl": "https://mega.nz/folder/XXXX#YYYY",
        "roomId": "yourRoomIdHere",
        "namePrefix": "mega-",
        "pollEvents": ["linked_file_appeared"]
      }
    }
  ]
}
```

- `enabled: false` skips load.
- Unknown `id` values log a warning and are skipped.
- Restart workers after changing plugins (`systemctl --user restart dicefiles` or your process manager).

---

## 4. Lifecycle

1. Worker boots → `WEBHOOKS.install()`  
2. `defaultRegistry.loadFromConfig(CONFIG.plugins)`  
3. `defaultRegistry.startAll(ctx)` → each enabled plugin `hooks.onStart`  
4. On every `WEBHOOKS.dispatch(event, payload)`:
   - global plugins receive `hooks.onEvent`
   - invited room plugins whose `eventSubscriptions` include the event receive
     `hooks.onEvent`, scoped to `payload.roomid`
   - matching HTTP webhooks queued/delivered  
5. Process exit → optional `stopAll()` (not always called on SIGKILL)

Room-scheduled `startup`, `poll`, and event-triggered runs acquire a Redis event
lease keyed by room, plugin, reason, and time/event bucket. A second worker
returns `already_running_or_completed`; manual **Run now** remains explicit.
Success/failure records store only time, duration, reason, sanitized error, and
bounded numeric result fields.

### Calling `run()` from automation

Only an already invited room plugin can be run through
`POST /api/v1/rooms/:id/plugins/:pluginId/run` with `room-plugins:run`.
The route cannot install modules or run a catalog entry that the room did not
invite. Process-wide plugins may still be invoked by a trusted maintenance
script with `defaultRegistry.run(id, args)`.

The Mega.nz plugin’s `run()` requires `ctx.uploadFile` and
`ctx.megaDownloader`. Remote Host Import uses `ctx.remoteDownloaders`.
Production supplies all three through `buildPluginRuntimeCtx`; streamed bodies
use `ingestFromStream`, while small/fake buffers retain `ingestFromBuffer`.
Tests inject fakes so they never hit the network.

---

## 5. Writing a new plugin (checklist)

1. **Pick an id** (`lib/plugins/my-tool/index.js`).
2. **Define `configSchema` + `validateConfig`** — fail closed on bad URLs/rooms.
3. **Implement `run(ctx, args)`** for the main work; keep side effects behind injectables (`download`, `uploadFile`).
4. **Optional `onEvent`** — declare `eventSubscriptions`; use
   `ctx.events` when an external side effect must happen only once across
   multiple workers.
5. **Optional inbound endpoint** — verify the provider signature/secret against
   the exact raw body, require explicit caller/action allowlists, deduplicate
   provider event IDs with `ctx.events`, and return a bounded provider response.
6. **Unit tests** that `require` the real module and inject fakes (see `tests/unit/plugins.test.js`).
7. **Document** operator config in this folder or README.
8. **Enable** in `.config.json` and restart.

### Permissions & safety

- Plugins inherit server filesystem and network access.
- Prefer **secrets in env** (`MEGA_PASSWORD`,
  `DICEFILES_DISCORD_WEBHOOK_URL`, `DICEFILES_TELEGRAM_BOT_TOKEN`) over config
  files.
- Never log full invite tokens or API keys.
- Validate `roomId` exists before upload.
- Rate-limit external downloads yourself.
- Never expose a generic remote command, shell, arbitrary URL fetch, or raw
  automation-API proxy through `inbound.handle`.

### Testing pattern

```js
const plugin = require("../../lib/plugins/my-tool");
await plugin.run({
  config: { /* valid */ },
  async uploadFile(spec) { /* capture */ return { key: "k" }; },
  myDownloader: { async fetch() { return Buffer.from("x"); } },
}, {});
```

---

## 6. Wiring to webhooks

External bots usually use **webhooks only** (no plugin code on the server):

1. Add a `webhooks[]` entry with `events` including what you care about.  
2. Verify `x-dicefiles-signature` if `secret` is set.  
3. Call the **Automation API** (`API.md`) with a scoped key to upload, list files, create requests, etc.

Plugins are for **in-server** work (Mega.nz import, future cron-like jobs). Webhooks are for **out-of-server** bots.

---

## 7. Powerful automation surface (summary)

| Surface | Use for |
|---------|---------|
| Webhooks | Push events to Discord bots, n8n, custom services |
| REST `/api/v1` | Pull/upload/list/moderation with API keys + scopes |
| MCP server | AI agents (`scripts/mcp-server.js`) |
| Plugins | In-process integrations with hooks + `run()` |

Recommended bot flow:

1. Subscribe to `file_uploaded` / `linked_file_appeared` / `request_*`.  
2. On event, call Automation API to fetch metadata or download.  
3. For bulk import from Mega.nz, enable `mega-folder` plugin and run sync with credentials in env.

---

## 8. Guest invite links (related)

Guest invites are managed in **Room Options → Invites** (not General): generate opens a limits panel; the list shows every link with copy (`i-copy`) and revoke.

Room owners can mint **guest invite links** for invite-only rooms:

- Single-use (exactly one redeem)  
- Or max **X** redemptions  
- Optional max age in hours  

URL: `/r/<roomId>?invite=<token>`

Redeem burns one use and grants a **guest pass** for the browser session key so refresh does not re-consume multi-use invites incorrectly. Events: `guest_invite_created`, `guest_invite_redeemed`.

UI: Room Options → **Invites** tab.

---

## 9. File map

| Path | Purpose |
|------|---------|
| `lib/plugins/registry.js` | Registry, load, emit, run |
| `lib/plugins/mega-folder/index.js` | Mega.nz example plugin |
| `lib/plugins/discord-release/index.js` | Discord release publisher |
| `lib/plugins/telegram-release/index.js` | Telegram release publisher |
| `lib/plugins/runtime-adapters.js` | Stable Dicefiles, HTTP, and upload adapters |
| `lib/plugins/event-lease.js` | Cross-worker one-time event leases |
| `lib/webhooks.js` | Event dispatch + HTTP delivery |
| `lib/room/guest-invites.js` | Pure invite create/redeem |
| `core/plugins/MEGA_FOLDER.md` | Operator guide for Mega.nz |
| `tests/unit/plugins.test.js` | Registry + Mega.nz inject tests |
| `tests/unit/guest-invites.test.js` | Invite pure tests |

---

## 10. Versioning

- Treat `plugin.id` + `version` as a contract for operators.  
- Adding events is non-breaking if hooks ignore unknown names.  
- Removing events or changing payload fields is breaking — document in CHANGELOG.
