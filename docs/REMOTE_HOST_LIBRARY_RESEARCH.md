# Remote host download libraries — research notes

**Audience:** maintainers embedding import adapters inside Dicefiles (not shipping a standalone multi-hoster product).  
**Related design:** [REMOTE_HOST_IMPORTS.md](../../core/plugins/REMOTE_HOST_IMPORTS.md) (contract + build order).  
**Related operator/dev guides:** [MEGA_FOLDER.md](../../core/plugins/MEGA_FOLDER.md), [DEVELOPING_PLUGINS.md](../../core/plugins/DEVELOPING_PLUGINS.md).  
**Related code today:** `lib/plugins/mega-folder/`, `lib/plugins/runtime-adapters.js`, optionalDep `megajs`.  
**Researched:** 2026-07-27.  
**Location:** `docs/plugins/` (research). Design sketches live under `core/plugins/`.

---

## 1. Goal and non-goals

### Goal

Find **GitHub / npm libraries** (or thin API strategies) that Dicefiles can **incorporate as an internal layer**: operator/bot pastes a folder or file URL from common online file storages → server pulls bytes → existing `uploadFile` / `ingestFromBuffer` path into a room.

Target hosts (community language in parentheses):

| Host | Notes |
|------|--------|
| **Mega.nz** | Already partially shipped (`mega-folder` + `megajs`) |
| **MediaFire** | Free public links + optional account API |
| **4shared** (often called “4storage”) | Classic locker; poor Node ecosystem |
| **Pixeldrain**, **Gofile**, Catbox/Litterbox, Workupload | Common hobby share hosts |
| Long tail | Rapidgator-class lockers via debrid or plowshare |

### Non-goals

- Not a **final user product** (no JDownloader/pyLoad/cyberdrop-dl clone UI).
- Not embedding full download-manager apps as nested services by default.
- Not shipping brittle Playwright scrapers or “limit bypass” proxies as core.
- Not yt-dlp as the primary path (video sites, not classic file lockers).

Constraints that match Dicefiles: self-hosted, opt-in plugins, ephemeral rooms + size/rate caps, secrets in env/config, audit `meta.sourceUrl` on ingest.

---

## 2. Executive finding

**There is no mature, all-in-one Node library** that cleanly covers Mega.nz + MediaFire + 4shared + Pixeldrain + Gofile the way a mini multi-hoster would.

What exists falls into five tiers:

| Tier | Shape | Fit inside Dicefiles |
|------|--------|----------------------|
| **A** | Thin per-host **SDK / official REST** (Node or first-party `fetch`) | **Best** — map to `RemoteDownloader` |
| **B** | **Shell bridge** to plowshare / host CLIs | **Best** for MediaFire / 4shared / long free-tier tail |
| **C** | **Debrid API** (Real-Debrid, AllDebrid, …) | One operator key → many classic premium lockers |
| **D** | Full apps (pyLoad, cyberdrop-dl, JDownloader) | **Do not** vendor as core product code |
| **E** | Random scraper npm (`mediafire-dl`, etc.) | Fragile; optional/experiment only, never hard dep |

**Recommendation:** keep Dicefiles as the product; implement a small internal **provider registry** (`RemoteDownloader`) and only optionalDeps for real SDKs (today: `megajs`). Prefer first-party REST for Pixeldrain/Gofile. Use shell/debrid for coverage, not abandoned scrapers.

This aligns with [REMOTE_HOST_IMPORTS.md](../../core/plugins/REMOTE_HOST_IMPORTS.md).

---

## 3. Shared embed contract (reminder)

Every host adapter should implement the same thin interface already used by Mega.nz (logical TypeScript; JS in tree):

```ts
type RemoteEntry = {
  name: string;
  size?: number;
  isDir?: boolean;
  download?: () => Promise<Buffer | NodeJS.ReadableStream>;
};

type RemoteDownloader = {
  /** Host id: mega | mediafire | fourshared | pixeldrain | gofile | … */
  id: string;
  canHandle(url: string): boolean;
  listFolder(url: string, credentials?: object): Promise<RemoteEntry[]>;
};
```

Orchestration (shared, not per-host plugin forever):

1. Match URL → downloader (`canHandle` / registry).
2. `listFolder` → entries (skip dirs or recurse with depth cap).
3. Per file: `download()` → prefer streams for large files.
4. `uploadFile({ roomId, name, body, size, meta: { plugin, sourceUrl, host } })`.
5. Normal `file_uploaded` webhooks.

Refactor target over time: `ctx.megaDownloader` → `ctx.remoteDownloaders` (map) or a dispatcher; Mega.nz remains the first implementation.

---

## 4. Host matrix — libraries and strategies

### 4.1 Mega.nz — keep and normalize

| Artifact | Lang / license | Role |
|----------|----------------|------|
| **[megajs](https://www.npmjs.com/package/megajs)** ([qgustavor/mega](https://github.com/qgustavor/mega), ~191★, MIT) | JS | **Canonical in-process SDK.** Already `optionalDependencies` + `createMegaDownloader`. |
| [megajs-cli](https://github.com/qgustavor/megajs-cli) | JS CLI | Maintenance mode; unnecessary if megajs works in-process. |
| [MEGAcmd](https://github.com/meganz/MEGAcmd) | Official CLI | Optional shell fallback for operators who already install it. |
| Python mega.py forks / megapubdl | Python | Not for Node server core. |

**Import shape:** existing `listFolder` / per-entry `download` (buffer or stream). Prefer streams later for large files.

**Mega.nz docs:** [MEGA_FOLDER.md](../../core/plugins/MEGA_FOLDER.md), mega.js.org.

---

### 4.2 Pixeldrain — first-party REST preferred

Official HTTP API is stable enough for a thin adapter (`pixeldrain.com/api/...`). No heavy SDK required.

| Artifact | Notes |
|----------|--------|
| **First-party `fetch` adapter** | **Recommended.** Zero new deps. |
| [pixeldrainjs](https://www.npmjs.com/package/pixeldrainjs) | Node wrapper; more upload-oriented; optional if it saves time. |
| [pdb-downloader](https://www.npmjs.com/package/pdb-downloader) | Pixeldrain + Bunkr → disk-oriented downloader API; weak fit for stream→ingest contract. |
| [jkawamoto/go-pixeldrain](https://github.com/jkawamoto/go-pixeldrain) | Solid Go client; wrong language for in-process Node. |
| Limit-bypass proxies / userscripts | **Avoid in core** (ToS / abuse surface). Stay on official API + operator accounts if needed. |

**Verdict:** implement `providers/pixeldrain.js` with `canHandle` + list file/list album + download stream. Best second host after Mega.nz.

---

### 4.3 Gofile.io — first-party REST preferred

| Artifact | Lang | Notes |
|----------|------|--------|
| **First-party REST** (guest token + content API) | JS in-repo | **Recommended.** |
| [gofile-downloader](https://www.npmjs.com/package/gofile-downloader) (npm, small) | JS | Resolves download links / lists content; low stars; copy patterns, don’t hard-depend without audit. |
| [yyyywaiwai/gofile-dl](https://github.com/yyyywaiwai/gofile-dl) | JS | Folder batch; CLI-shaped. |
| [ltsdw/gofile-downloader](https://github.com/ltsdw/gofile-downloader) (~374★) | **Python** | Good external tool; not Node embed. |
| [Lysagxra/GoFileDownloader](https://github.com/Lysagxra/GoFileDownloader) | Python | Same. |

**Verdict:** thin first-party adapter; treat small npm packages as reference implementations only unless audited and pinned carefully.

---

### 4.4 MediaFire — free link scrape vs account API

| Artifact | Type | Notes |
|----------|------|--------|
| [mediafire](https://www.npmjs.com/package/mediafire) official JS SDK ([MediaFire/mediafire-javascript-sdk](https://github.com/MediaFire/mediafire-javascript-sdk), Apache-2.0) | Account REST | Last meaningful publish ~2020; needs API app keys. Stale but “real” API path. |
| [@jesusacd/mediafire](https://www.npmjs.com/package/@jesusacd/mediafire) (TS, ~2026) | Email/password SDK | Library-shaped (upload, links, folders). **Unproven** (low visibility). Trial only for account imports. |
| [mediafire-dl](https://www.npmjs.com/package/mediafire-dl), [mediafire-getlink](https://github.com/pepzwee/mediafire-getlink), BochilTeam scrapers | Free-link HTML resolve | Extract direct CDN URL then HTTP GET. Break often (captcha, timers, HTML changes). |
| [Juvenal-Yescas/mediafire-dl](https://github.com/Juvenal-Yescas/mediafire-dl) | Python CLI | Shell-import candidate, not core. |
| Gopeed extension / userscripts | Browser/extension | Not server embed. |

**Verdict:**

- Free public links → **shell/plowshare** or a **flagged best-effort** resolve adapter; document breakage.
- Account library path → only if operators need MF cloud folders and a maintained SDK proves out.
- **Do not** add random scraper packages as hard dependencies of Dicefiles.

---

### 4.5 4shared (“4storage”)

Almost no maintained Node SDK. Same fragility class as free MediaFire.

**Verdict:** plowshare module / `shell-import` only. No native npm worth owning in-repo.

---

### 4.6 Catbox / Litterbox / direct file URLs

Usually single-file public URLs → plain HTTP GET (or host upload API for reverse direction).

**Verdict:** trivial first-party `direct-http` / catbox adapter; no third-party library required.

---

### 4.7 Workupload and similar mid-tier lockers

Site-specific scrape or community scripts only. Same class as MediaFire free tier.

**Verdict:** shell bridge or skip until demand is proven.

---

### 4.8 Dropbox / Google Drive shared links

| Host | Strategy |
|------|----------|
| Dropbox public share | Well-known `?dl=1` / direct resolve — thin adapter OK |
| Google Drive | Prefer **official APIs + OAuth**; scrapers are ToS-sensitive |

**Verdict:** optional operator-enabled providers only when ToS surface is accepted. Not default hobby-locker path.

---

### 4.9 Multi-host umbrellas (library vs product)

| Project | Stars (approx) / license | Embed inside Dicefiles? |
|---------|--------------------------|-------------------------|
| **[plowshare](https://github.com/mcrapet/plowshare)** (`plowdown`, modules via `plowmod`) | ~857★, **GPL-3.0**, Shell | **Yes as shell bridge.** Operator installs plowshare + modules on the host OS. Dicefiles does not ship hoster scrapers. Watch GPL if ever vendoring scripts in-tree (prefer external binary). |
| **[pyLoad](https://github.com/pyload/pyload)** | ~3.8k★, Python download manager | **No** as library — full app (core + plugins + webui). External bot OK. |
| **[Cyberdrop-DL/cyberdrop-dl](https://github.com/Cyberdrop-DL/cyberdrop-dl)** | ~703★, GPL-3, Python | **No** as library — bulk multi-host **product** (gallery-oriented). External pipeline only. |
| **[totallynotdavid/megaloader](https://github.com/totallynotdavid/megaloader)** | ~15★, Apache-2.0, Python | **Library-shaped** (GoFile, Bunkr, Pixeldrain, Cyberdrop, …). Good reference or **sidecar process**, not `require()` from Node. |
| JDownloader / My.JDownloader API wrappers | Java product + remote API | External bot only. |
| Colab “ultimate downloaders”, gallery CLIs | User tools | Not core. |

---

### 4.10 Debrid APIs — Node-native multi-locker coverage

Premium debrid services turn many classic hoster URLs into direct HTTP links. This is the main **Node-native multi-host** pattern that is not a scraper farm.

| Artifact | Role |
|----------|------|
| [node-real-debrid](https://github.com/razorxan/node-real-debrid) / npm `node-real-debrid` | Real-Debrid unrestrict → direct URL → stream into ingest |
| [alldebrid](https://www.npmjs.com/package/alldebrid) (TS SDK+CLI), `all-debrid-api`, older `node-alldebrid` | AllDebrid equivalent |

**Verdict:** optional plugin (`realdebrid-import` / generic `debrid-import`) with operator API key in env. Document that this is premium multi-host coverage, not free bypass. Host allowlist still applies.

---

## 5. npm packages snapshot (embed candidates)

Rough suitability for **in-process Dicefiles** (not completeness of npm):

| Package | Host focus | Library-shaped? | Recommend |
|---------|------------|-----------------|-----------|
| `megajs` | Mega.nz | Yes | **Yes** (already optionalDep) |
| `pixeldrainjs` | Pixeldrain | Partial | Optional; prefer first-party fetch |
| `pdb-downloader` | Pixeldrain, Bunkr | Downloader-to-disk | No as core |
| `gofile-downloader` / `gofile-dl` | Gofile | Thin / CLI | Reference only unless audited |
| `mediafire` (official) | MediaFire API | Yes, stale | Maybe account path |
| `@jesusacd/mediafire` | MediaFire account | Yes, unproven | Trial only |
| `mediafire-dl`, `mediafire-getlink`, scraper scopes | MediaFire free | Scrape resolve | Flagged best-effort or shell |
| `node-real-debrid`, `alldebrid` | Many via debrid | Yes | Optional premium path |

**HTTP utility only** (not host-aware): `node-downloader-helper`, generic `download` packages — fine for streaming a **already resolved** direct URL; they do not replace host adapters.

---

## 6. Integration shapes (product boundary)

### A. First-party thin adapters (default for Mega.nz, Pixeldrain, Gofile, direct)

- Location sketch: `lib/plugins/remote-import/providers/*.js` or shared `lib/remote-downloaders/`.
- Optional npm: **`megajs` only** for Mega.nz crypto/protocol.
- Pixeldrain/Gofile: Node 20+ `fetch`, no new deps.

### B. Shell bridge (MediaFire free, 4shared, plowshare long tail)

- Plugin id sketch: `shell-import` / `plowshare-import`.
- Config: allowlisted binaries (`plowdown`, `megadl`, maybe `curl`), argument template **without** free-form shell, temp dir, timeout, max bytes.
- Operator installs tools on OS; Dicefiles ingests resulting file/stream.
- Security: no user-controlled command strings; URL as single substituted arg.

### C. Debrid bridge (optional)

- Operator API token → unrestrict → direct GET → ingest.
- One adapter covers many lockers the debrid service supports.

### D. External bot (already possible)

- Webhooks + automation upload API / MCP.
- Python tools (megaloader, cyberdrop-dl, gofile-downloader CLIs) stay **outside** the Node process.
- Preferred when host logic is Python-only or GPL-awkward to combine.

**Dicefiles remains the product;** A–C are internal capabilities. D is integration, not a nested multi-hoster UI.

---

## 7. Suggested build order

1. **Normalize** Mega.nz onto shared `RemoteDownloader` (rename/docs; keep behavior).
2. **Pixeldrain + Gofile** first-party adapters (official/public APIs).
3. **`remote-import` plugin** — multi-URL list, `maxBytesPerFile`, `maxFilesPerRun`, source URL in meta.
4. **`shell-import`** — plowshare/MEGAcmd allowlist for MediaFire / 4shared / long tail.
5. **Optional debrid** adapter if premium locker URLs matter to operators.
6. Native MediaFire/4shared adapters **only if** shell path is too awkward **and** a maintained library survives audit.

Safety rails (non-negotiable): size/count caps; no crawl of arbitrary pastes without owner enable + host allowlist; secrets in env; log `sourceUrl` + host id; document free-hoster bitrot; respect ToS/copyright (operator sync tool, not a piracy appliance).

---

## 8. Explicit rejects for core

| Candidate | Why reject as core dependency |
|-----------|-------------------------------|
| yt-dlp / youtube-dl | Wrong domain (video platforms) |
| Playwright/Puppeteer host scrapers | Heavy, brittle, ops cost |
| cyberdrop-dl, pyLoad, JDownloader | Final products / wrong boundary |
| Pixeldrain “bypass” proxies | Abuse/ToS risk |
| Unaudited `mediafire-dl`-class npm as hard deps | Bitrot + supply chain |
| Gallery-oriented NSFW multi-host CLIs as default | Product mismatch |

---

## 9. Relation to current tree

| Piece | Location |
|-------|----------|
| Plugin registry | `lib/plugins/registry.js` |
| Mega.nz plugin | `lib/plugins/mega-folder/` |
| Production wiring | `lib/plugins/runtime-adapters.js` |
| Design sketch | [core/plugins/REMOTE_HOST_IMPORTS.md](../../core/plugins/REMOTE_HOST_IMPORTS.md) |
| Operator Mega.nz guide | [core/plugins/MEGA_FOLDER.md](../../core/plugins/MEGA_FOLDER.md) |
| Plugin author guide | [core/plugins/DEVELOPING_PLUGINS.md](../../core/plugins/DEVELOPING_PLUGINS.md) |
| This research | `docs/plugins/REMOTE_HOST_LIBRARY_RESEARCH.md` |
| Feature backlog pointer | `docs/FUTURE_DEVELOPMENT_PLAN.md` / feature creep notes (multi-host open item) |

Next code step when scheduled: extract `RemoteDownloader` + register Mega.nz; add Pixeldrain without new npm deps.

---

## 10. Reference links

### Mega.nz

- https://www.npmjs.com/package/megajs  
- https://mega.js.org/  
- https://github.com/qgustavor/mega  
- https://github.com/qgustavor/megajs-cli  
- https://github.com/meganz/MEGAcmd  

### Multi-host / shell

- https://github.com/mcrapet/plowshare  
- https://github.com/pyload/pyload  
- https://github.com/Cyberdrop-DL/cyberdrop-dl  
- https://github.com/totallynotdavid/megaloader  

### Pixeldrain / Gofile

- https://pixeldrain.com/api  
- https://www.npmjs.com/package/pixeldrainjs  
- https://www.npmjs.com/package/gofile-downloader  
- https://github.com/ltsdw/gofile-downloader  

### MediaFire

- https://www.npmjs.com/package/mediafire  
- https://www.npmjs.com/package/@jesusacd/mediafire  
- https://www.npmjs.com/package/mediafire-dl  
- https://github.com/pepzwee/mediafire-getlink  
- https://github.com/Juvenal-Yescas/mediafire-dl  

### Debrid

- https://github.com/razorxan/node-real-debrid  
- https://www.npmjs.com/package/alldebrid  

---

## 11. Changelog of this doc

| Date | Change |
|------|--------|
| 2026-07-27 | Initial research dump: tiers, host matrix, npm/GitHub candidates, embed vs product boundary, build order. |

*When implementation drifts, update [REMOTE_HOST_IMPORTS.md](../../core/plugins/REMOTE_HOST_IMPORTS.md) for the contract and this file for library landscape / rejects.*
