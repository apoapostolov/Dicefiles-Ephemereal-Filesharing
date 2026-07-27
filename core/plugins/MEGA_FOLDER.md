# Mega Autoshare (`mega-folder`)

First-party plugin that **monitors a Mega.nz folder**, downloads new files over time, and **auto-shares** them into a Dicefiles room.

Uploads appear under the **Mega Autoshare** bot with a cyan **BOT** pill in the file list (not a human account).

See [DEVELOPING_PLUGINS.md](./DEVELOPING_PLUGINS.md) for the full plugin contract.

---

## Enable (recommended: Room Options → Plugins)

1. Install the optional Mega SDK (once per host):

```bash
yarn add megajs
```

2. Restart Dicefiles so the plugin catalog can load `mega-folder`.

3. Open the room → **Room Options** → **Plugins** tab:
   - Select **Mega Autoshare** from *Available bots* → **Invite**
   - Set **folder URL**, **poll interval** (minutes), optional prefix / bot name
   - **Save settings** (and **Run now** to sync immediately)

The bot is invited **into this room only**. Settings live in room config (`roomPlugins`); uploads appear under the cyan **BOT · Mega Autoshare** pill.

### Legacy: process-wide `.config.json` plugins

Still supported for headless/global wiring (requires explicit `roomId`):

```json
{
  "plugins": [
    {
      "id": "mega-folder",
      "enabled": true,
      "config": {
        "folderUrl": "https://mega.nz/folder/XXXXXXXX#YYYYYYYY",
        "roomId": "YourRoomId12",
        "namePrefix": "mega-",
        "pollIntervalMinutes": 15,
        "botName": "Mega Autoshare",
        "pollEvents": []
      }
    }
  ]
}
```

Optional account credentials (private folders):

- `config.email` / `config.password`, or  
- environment: `MEGA_EMAIL`, `MEGA_PASSWORD` (preferred)
---

## How monitoring works

| Setting | Behavior |
|---------|----------|
| `pollIntervalMinutes` &gt; 0 | On start: one scan. Then re-scan every N minutes. New files only (name+size dedupe in-process). |
| `pollIntervalMinutes` = 0 or omitted | No timer. Use manual `defaultRegistry.run("mega-folder")` or `pollEvents`. |
| `pollEvents` | Optional webhook event names (e.g. `linked_file_appeared`) that call `scheduleRun`. |

Dedupe is process-local: after restart, existing Mega entries may upload again if they still appear in the folder listing. Use `namePrefix` and room cleanup as needed.

---

## Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `folderUrl` | yes | Must contain `mega.nz` |
| `roomId` | yes | Destination room id (≥ 4 chars) |
| `namePrefix` | no | Prefix for uploaded filenames |
| `botName` | no | Uploader pill label (default **Mega Autoshare**) |
| `pollIntervalMinutes` | no | Folder monitor interval; `0` = off |
| `email` / `password` | no | Mega account (prefer env for password) |
| `pollEvents` | no | Event names that schedule a `run()` |

`validateConfig()` rejects missing URL/room or non-Mega URLs.

---

## Runtime requirements

`run(ctx)` needs:

1. **`ctx.megaDownloader.listFolder(folderUrl, credentials)`** → array of `{ name, size, isDir?, download? }`  
2. **`ctx.uploadFile({ roomId, name, body, size, meta })`** → `{ key }` (as bot)

### Production wiring (HTTP worker)

`lib/httpserver.js` boots plugins with **`buildPluginRuntimeCtx`** (`lib/plugins/runtime-adapters.js`):

| Adapter | Source |
|---------|--------|
| `uploadFile` | Bot-attributed `ingestFromBuffer` + `Room.get` |
| `megaDownloader` | `createMegaDownloader` → optional **`megajs`** |

- **`uploadFile` is always attached.**  
- **`megaDownloader` is always attached**; if `megajs` is missing, `listFolder` throws a clear install hint.  
- Unit tests inject fakes — see `tests/unit/runtime-adapters.test.js` and `tests/unit/plugins.test.js`.

### Manual run (same process as server)

```js
const { defaultRegistry } = require("../lib/plugins/registry");
await defaultRegistry.run("mega-folder", {});
```

---

## Bot identity

| Field | Value |
|-------|--------|
| Display name | `botName` or **Mega Autoshare** |
| `meta.role` | `bot` |
| UI | Cyan **BOT** pill + name on the file row |

Plugins always upload as bots so room members can tell automation from people. See the README section *Developers: plugin API & bots*.

---

## Security notes

- Treat Mega passwords as secrets (env, not git).  
- Only enable for rooms you control.  
- Large folders can flood a room — start with a longer poll interval and `namePrefix`.  
- Plugin code runs with full server privileges.
