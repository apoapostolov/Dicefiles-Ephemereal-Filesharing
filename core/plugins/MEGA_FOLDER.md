# Mega.nz Autoshare (`mega-folder`)

First-party plugin that **monitors a Mega.nz folder**, downloads new files over time, and **auto-shares** them into a Hobbyfiles room.

Uploads appear under the **Mega.nz Autoshare** bot with a cyan **BOT** pill in the file list (not a human account).

See the [Plugin API reference](./PLUGIN_API.md) for the current context contract,
the [cookbook](./PLUGIN_COOKBOOK.md) for examples and
[DEVELOPING_PLUGINS.md](./DEVELOPING_PLUGINS.md) for lifecycle and installation.

---

## Enable (recommended: Room Options → Plugins)

1. Install the optional Mega.nz SDK (once per host):

```bash
yarn add megajs
```

2. Restart Hobbyfiles so the plugin catalog can load `mega-folder`.

3. Open the room → **Room Options** → **Plugins** tab:
   - Select **Mega.nz Autoshare** from *Available bots* → **Invite**
   - Set **folder URL**, **poll interval** (minutes), optional prefix / bot name
   - **Save settings** (and **Run now** to sync immediately)

New invitations default to manual-only polling (`0`) and valid file/byte caps.
Set a positive interval to enable startup and periodic scans. Existing invited
bots retain their saved interval.

The bot is invited **into this room only**. Settings live in room config (`roomPlugins`); uploads appear under the cyan **BOT · Mega.nz Autoshare** pill.

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
        "maxFilesPerRun": 50,
        "maxBytesPerFile": 268435456,
        "maxBytesPerRun": 1073741824,
        "botName": "Mega.nz Autoshare",
        "pollEvents": []
      }
    }
  ]
}
```

Optional account authentication for shared folder/file links:

- `config.email` / `config.password`, or  
- environment: `MEGA_EMAIL`, `MEGA_PASSWORD` (preferred)

The link must still include its decryption key. This adapter does not enumerate
arbitrary private account folders. Account sessions disable keepalive and close
after a scan; metadata and file fetches share a five-minute scan deadline.

---

## How monitoring works

| Setting | Behavior |
|---------|----------|
| `pollIntervalMinutes` &gt; 0 | On start: one scan. Then re-scan every N minutes. |
| `pollIntervalMinutes` = 0 or omitted | No timer. Use **Run now** / `run("mega-folder")` or `pollEvents`. |

### Already-synced files (durable skip log)

After a successful upload, Mega.nz Autoshare records the provider's stable node
identity in a **Redis-backed sync log**, while retaining compatibility with
older **name + size** records. Later polls and process restarts skip those
entries until the record ages out. A renamed Mega.nz node therefore remains
recognized, and content already present in the destination room is rejected by
hash before another file row is created.

| App config | Default | Meaning |
|------------|---------|---------|
| `pluginSyncLogRetentionDays` | `30` | Keep skip records for this many days (1–730). Set in `.config.json`. |

Expired entries are pruned on sync. Within a process lifetime an in-memory
cache mirrors the log for speed.

Scheduled startup, poll, and event runs also acquire a Redis lease for the
room/plugin/time bucket. Several HTTP workers may load the room, but only one
performs that scan. Manual **Run now** remains an explicit new run.

---

## Config fields

| Field | Required | Description |
|-------|----------|-------------|
| `folderUrl` | yes | Must contain `mega.nz` |
| `roomId` | yes | Destination room id (≥ 4 chars) |
| `namePrefix` | no | Prefix for uploaded filenames |
| `botName` | no | Uploader pill label (default **Mega.nz Autoshare**) |
| `pollIntervalMinutes` | no | Folder monitor interval; `0` = off |
| `email` / `password` | no | Mega.nz account (prefer env for password) |
| `pollEvents` | no | Event names that schedule a `run()` |
| `maxFilesPerRun` | no | Positive whole-number cap; default `50` |
| `maxBytesPerFile` | no | Skip known/actual oversized files; default 256 MiB (`268435456`) |
| `maxBytesPerRun` | no | Combined import cap; default 1 GiB (`1073741824`) |
| `includeExtensions` | no | Case-insensitive allowlist, e.g. `["pdf", "epub"]`; empty accepts all |
| `excludeNameContains` | no | Case-insensitive literal filename/path exclusions; no regular expressions |
| `dryRun` | no | Preview eligible files without downloading/uploading or updating sync memory |

In Room Options select **Preview** beside Run now, or call the run endpoint
with `{ "mode": "preview" }`. Results include `planned`, `plannedBytes` and
`dryRun`. Listing still contacts Mega. A preview is also subject to import caps.
Filters allow up to 50 entries, each at most 100 characters; extensions use
letters/digits. Polling is disabled at zero, otherwise 1–10,080 minutes.

`validateConfig()` rejects missing URL/room, non-Mega.nz URLs, and non-positive
or fractional limits. Known oversized entries are skipped before download.
Unknown-size downloads are measured before upload. The run result reports
`uploaded`, `uploadedBytes`, `skipped`, reasoned skip counts, and effective
limits; Hobbyfiles stores the bounded last result for room-bot operators.

---

## Runtime requirements

`run(ctx)` needs:

1. **`ctx.megaDownloader.listFolder(folderUrl, credentials)`** → array of `{ name, size, isDir?, download? }`  
2. **`ctx.uploadFile({ roomId, name, body, size, meta })`** → `{ key }` (as bot)

### Production wiring (HTTP worker)

`lib/httpserver.js` boots plugins with **`buildPluginRuntimeCtx`** (`lib/plugins/runtime-adapters.js`):

| Adapter | Source |
|---------|--------|
| `uploadFile` | Bot-attributed streaming or buffer ingest + `Room.get` |
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
| Display name | `botName` or **Mega.nz Autoshare** |
| `meta.role` | `bot` |
| UI | Cyan **BOT** pill + name on the file row |

Plugins always upload as bots so room members can tell automation from people. See the README section *Developers: plugin API & bots*.

---

## Security notes

- Treat Mega.nz passwords as secrets (env, not git).
- Source folder URLs contain decryption keys. New imports retain only a source
  fingerprint; public serialization removes legacy raw folder fields. Existing
  private stored records are retained for compatibility.
- Only enable for rooms you control.  
- Keep the import caps conservative for remaining disk and transfer allowance.
  Mega.nz streams through a bounded temporary file, so large imports do not
  accumulate as one full in-process buffer.
- Room owners can inspect the latest run and remembered import count in Room
  Options → **Plugins**, and can explicitly forget the sync memory when they
  intend to rescan old provider entries.
- Plugin code runs with full server privileges.
