# Developing Dicefiles plugins

This guide explains how to build **first-party plugins** that hook Dicefiles’ event bus and automation surface. The shipped example is **Mega Autoshare** (`mega-folder`): monitor a Mega.nz folder, download new files over time, and auto-share into a room **as a bot** (cyan **BOT** pill). For a multi-host roadmap (MediaFire, 4shared, Pixeldrain, Gofile, plowshare shell bridge), see **[REMOTE_HOST_IMPORTS.md](./REMOTE_HOST_IMPORTS.md)**.

Audience: operators and developers who already run a self-hosted Dicefiles instance.

---

## 1. Concepts

| Concept | Role |
|---------|------|
| **Webhook events** | Outbound HTTP notifications (`lib/webhooks.js`) for bots and external automation |
| **Plugin registry** | In-process loader for modules under `lib/plugins/<id>/` (`lib/plugins/registry.js`) |
| **Plugin hooks** | Optional `onStart` / `onStop` / `onEvent` callbacks |
| **Plugin `run()`** | Imperative entry point (e.g. “sync Mega folder now”) |
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
| `uploadFile` / `megaDownloader` | **Production:** attached by `buildPluginRuntimeCtx` in the HTTP worker (`lib/plugins/runtime-adapters.js`). **Tests:** inject fakes the same way. Uploads are bot-attributed. |

### Room Options → Plugins (operators)

Owners/mods invite bots into a **room** from the registry (not only via `.config.json`):

| RPC (`setconfig` name) | Purpose |
|------------------------|---------|
| `listPluginCatalog` | Available bots + this room’s invitations |
| `inviteRoomPlugin` / `updateRoomPlugin` | Invite or update settings |
| `revokeRoomPlugin` | Remove bot from room |
| `runRoomPlugin` | Manual “Run now” |
| `listRoomPlugins` / `setRoomPlugins` | List / replace full list |

Per-room storage: `roomPlugins` on the room config. Runtime pollers sync via `lib/plugins/room-runtime.js`.

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
   - plugins `hooks.onEvent` (async, errors isolated)
   - matching HTTP webhooks queued/delivered  
5. Process exit → optional `stopAll()` (not always called on SIGKILL)

### Calling `run()` from automation

v1 does not expose a public REST route for arbitrary plugins (trust boundary). Operators can:

- call `defaultRegistry.run("mega-folder", args)` from a trusted maintenance script in-process, or  
- add a scoped automation route in a future release.

The Mega plugin’s `run()` **requires** `ctx.uploadFile` and `ctx.megaDownloader`. Production `startAll` always supplies both via `buildPluginRuntimeCtx` (`uploadFile` → `ingestFromBuffer`; `megaDownloader` → optional `megajs`). Tests inject fakes so they never hit the network; without `megajs` installed, live `listFolder` fails with an install hint rather than a missing-adapter crash.

---

## 5. Writing a new plugin (checklist)

1. **Pick an id** (`lib/plugins/my-tool/index.js`).
2. **Define `configSchema` + `validateConfig`** — fail closed on bad URLs/rooms.
3. **Implement `run(ctx, args)`** for the main work; keep side effects behind injectables (`download`, `uploadFile`).
4. **Optional `onEvent`** — only for light reactions; heavy work via `ctx.scheduleRun`.
5. **Unit tests** that `require` the real module and inject fakes (see `tests/unit/plugins.test.js`).
6. **Document** operator config in this folder or README.
7. **Enable** in `.config.json` and restart.

### Permissions & safety

- Plugins inherit server filesystem and network access.
- Prefer **secrets in env** (`MEGA_PASSWORD`) over config files.
- Never log full invite tokens or API keys.
- Validate `roomId` exists before upload.
- Rate-limit external downloads yourself.

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

Plugins are for **in-server** work (Mega import, future cron-like jobs). Webhooks are for **out-of-server** bots.

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
3. For bulk import from Mega, enable `mega-folder` plugin and run sync with credentials in env.

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
| `lib/plugins/mega-folder/index.js` | Mega example plugin |
| `lib/webhooks.js` | Event dispatch + HTTP delivery |
| `lib/room/guest-invites.js` | Pure invite create/redeem |
| `core/plugins/MEGA_FOLDER.md` | Operator guide for Mega |
| `tests/unit/plugins.test.js` | Registry + Mega inject tests |
| `tests/unit/guest-invites.test.js` | Invite pure tests |

---

## 10. Versioning

- Treat `plugin.id` + `version` as a contract for operators.  
- Adding events is non-breaking if hooks ignore unknown names.  
- Removing events or changing payload fields is breaking — document in CHANGELOG.
