# Dicefiles Development Log

## 2026-02-23 — Fix activity null guard in user.ejs, run tests, update changelog

- `views/user.ejs` — Fixed two `info.activity !== null` guards to use loose `!= null` (catches both `null` and `undefined`). The test fixture in `tests/views/render.test.js` does not set `activity` at all, so the strict `!== null` guard didn't catch `undefined` and `info.activity.length` threw a TypeError. Root cause: template was written expecting only `null`/array but the view-render test supplies a minimal fixture without the key. 324/324 tests now pass.
- `CHANGELOG.md` — Added four new `[Unreleased]` entries: Latest Activity tab (Added), Per-tile gallery download button (Added), Uploader pill opens profile page (Changed), File type icon always downloads (Changed). Re-sorted Added and Changed sections by user-impact tier per AGENTS.md rules. Entries considered and deliberately omitted: internal CSS micro-polish commits (activity table centering, align-self fixes), git metadata changes, DEVELOPMENT_LOG updates.

- `entries/css/page.css` — Added `align-self: start` to `.profile-stats`. Same root cause as the previous `.profile-tabbed` fix: `#userprofile` is a CSS grid whose cells default to `stretch`, causing the stats box to expand to the full row height alongside the (shorter) activity table.

## 2026-02-22 — Activity table header centering and stretch fix

- `entries/css/page.css` — Added `align-self: start` to `.profile-tabbed`. Root cause: `#userprofile` is a CSS grid whose items default to `align-items: stretch`, so the tabbed panel was expanding to fill the full row height and pushing the table toward the bottom. `align-self: start` makes the cell shrink-wrap to its content.
- `entries/css/page.css` — Changed `thead th` `text-align` from `left` to `center` so all column headers are centered.

## 2026-02-22 — Fix uploader pill URL and activity table base.css border bleed

- `client/files/file.js` — Changed pill click URL from `/user/${account}` to `/u/${account}`. The express route is `/u/:user`; the previous path 404'd.
- `entries/css/page.css` — Added explicit `border: none` to `.activity-table`, `.activity-table thead th`, and `.activity-row td`. Root cause: `base.css` sets global `table { border: 1px solid }`, `th { border: 1px solid }`, and `td { border: 1px dotted }` which overrode the previous intent of no borders. Now all three elements explicitly cancel those inherited rules.

## 2026-02-22 — Gallery tile download button, uploader pill navigation, activity table redesign

- `client/files/file.js` — Added `galleryDlEl` (`a.gallery-dl.i-download`) at the end of the file constructor. Button is absolutely positioned top-right of each gallery tile, triggers `this.download()` on click with `stopPropagation` so it never opens the lightbox. Hidden in list mode via CSS.
- `client/files/file.js` — `setupTags`: split `usernick` tag handling into two passes — one for `tag-user` class (unchanged), one for the click-to-profile listener. Also added the same click listener for `tn === "user"` when `meta.account` exists. Both add `tag-user-link` class so CSS can target clickable pills specifically.
- `entries/css/files.css` — Added `.tag-user-link { cursor: pointer }` and `hover opacity` rules for clickable uploader pills. Added `.gallery-dl` rules: `display: none` in list mode; in gallery mode `position: absolute; top/right 0.5rem; z-index: 9; border-radius: 50%` with `opacity: 0` that fades to `1` on tile `:hover`, plus `backdrop-filter: blur(2px)` for glass effect.
- `entries/css/page.css` — Activity table fully redesigned: removed all `border-bottom` lines from header and rows; header now uppercase small text with `letter-spacing: 0.06em`; rows use `nth-child(odd)` for a subtle alternating fill instead of explicit borders; `.activity-type` changed to `text-align: center` with symmetric padding so FA icons are properly centered in their column; overall padding increased to `0.75rem` per column.

## 2026-02-22 — File icon downloads, uploader pill profile link, gallery download button

- `client/files/file.js` — `oniconclick` refactored: now always calls `nukeEvent` and `this.download()` for all users so the type icon always triggers a file download. Mods/owners additionally trigger `this.owner.select()` so selection still works. Previously icon click only worked as selection for mods and did a bare anchor navigate for regulars.
- `client/files/file.js` — `setupTags`: when creating a `usernick` tag that has `this.meta.account`, a `click` listener is added directly on the tag element that calls `window.open('/user/{account}', '_blank')` and stops propagation, so clicking the uploader pill opens the user profile in a new tab instead of setting the filter.
- `views/room.ejs` — Added `<a id="gallery_download" class="i-download">` anchor to the `#gallery` section.
- `client/files/gallery.js` — Added `this.downloadEl` reference; wired click handler that calls `this.file.download()`; added `applyDownloadColor(img)` which samples the top-right 40×40 px of the loaded cover image via Canvas to compute average brightness and toggles `dl-light` (white icon) or `dl-dark` (dark icon) class accordingly; color detection called after image swap in `open()`; video and no-cover cases default to `dl-light`; color classes reset in `close()`.
- `entries/css/gallery.css` — Added `#gallery_download` rule: `position: absolute` at top-right (just left of close button), fades in with `.aux` class using the same `0.3s opacity` transition as other gallery UI, `dl-light`/`dl-dark` classes add appropriate `color` and `text-shadow` for readability on any cover.

## 2026-02-23 — Latest Activity tab, tab hover fix, profileActivity config

- `lib/user.js` — Added `zadd` and `zremrangebyrank` to `redis.getMethods()`; added `ACTIVITY_MAX = 20` and `activityKey()` constants; added `recordActivity(type, entry)` (writes to Redis sorted set `activity:{account}` capped at 20) and `getActivity()` (returns last 20 entries newest-first) methods to `User` class.
- `lib/upload.js` — Added `recordActivity("upload", ...)` call after `OBS.trackUploadCreated(upload)`; added `recordActivity("download", ...)` call after `req.user.addDownload()` in `serve()`.
- `lib/httpserver.js` — Added `info.activity = CONFIG.get("profileActivity") !== false ? await user.getActivity() : null` to profile render route. Returns `null` when disabled, causing the tab button to be hidden in the template.
- `defaults.js` — Added `profileActivity: true` with comment; explicit `false` disables the tab for all users.
- `views/user.ejs` — Added "Latest Activity" tab button (conditional on `info.activity !== null`); added `profile-activity` section with borderless table showing FA upload/download arrow icons, file link, human-readable size, and formatted date. Empty state shows "No activity recorded yet."
- `entries/css/page.css` — Added `outline: none; box-shadow: none` to `.profile-tab` base and `:hover`/`:focus` rules to remove browser button border artifacts (only bottom-line indicator retained); added `.profile-activity { display: none }` with `.tab-activity` show/hide rules; added full `.activity-table` borderless styles with upload (blue `#7c93ff`) and download (green `#6ec97e`) type colors; `.activity-name` ellipsis truncation.
- `.config.json.example` — Added commented `profileActivity` entry with explanation.
- `README.md` — Added `profileActivity` row to configuration table.

## 2026-02-22 — Profile Overview: About Me + Looking For, FA icons CSP fix, achievement count badge

**Root cause (FA icons):** The Content Security Policy in `lib/httpserver.js` had `style-src-elem 'self' 'unsafe-inline' blob:` and no `font-src` directive — neither of which allowed `cdnjs.cloudflare.com`. The browser silently blocked the Font Awesome stylesheet and webfonts, so all FA `<i>` elements rendered as blank boxes.

**Changes:**

- `lib/httpserver.js` — Added `https://cdnjs.cloudflare.com` to `style-src-elem`; added `font-src 'self' data: https://cdnjs.cloudflare.com` directive.
- `lib/user.js` — Added `"looking"` to `ADOPT_OFILTER`; added 2000-char length guard for the new field in `adopt()`.
- `lib/httpserver.js` — Added `info.lookingHtml = renderMarkdown(user.looking || "")` to the profile render.
- `views/user.ejs` — Replaced single Profile Message textarea with two labelled fields: "About Me" (smaller) and "What I'm Looking For" (taller), sharing one Save button. Rendered view shows `<h4>` labels above each markdown block, only when non-empty. Achievement tab badge now shows `X / Y` instead of just the unlocked count.
- `entries/css/page.css` — `.profile-message-fields` flex-column with 0.75rem gap; labels styled smaller/muted; About Me textarea fixed at 80px, Looking For at 160px; `.profile-message-view` and `.profile-message-block h4` for the rendered read-only view.
- `entries/user.js` — Form submit sends both `message` and `looking` fields.

## 2026-02-22 — Fix profile tabs breaking grid layout

**Root cause:** The tab nav was inserted as a free-floating grid item inside `#userprofile` (a single-column CSS grid), and the two tab panel divs used `display: contents` to pass their children through to the parent grid. This desynced the tab nav from its content sections, causing the nav to appear detached in the lower area while the stats and message sections reordered unpredictably.

**Fix:** Consolidated the tab nav + `.profile-message` + `.profile-achievements` into a single `.profile-tabbed` wrapper div — one grid cell. Tab state is now driven by a `.tab-achievements` class on `#userprofile` itself, with CSS show/hide rules. No `display: contents` anywhere.

**Changed files:**

- `views/user.ejs` — Removed `profile-panel` wrapper divs; introduced `<div class="profile-tabbed">` wrapping the nav + message + achievements sections.
- `entries/css/page.css` — Removed `display: contents` / `.hidden` rules for panels; added `.profile-tabbed` flex-column container; added `#userprofile.tab-achievements .profile-message { display: none }` and `#userprofile.tab-achievements .profile-achievements { display: block }`.
- `entries/user.js` — Tab click handler now toggles `.tab-<name>` class on `#userprofile` instead of `.hidden` on individual panel divs.

## 2026-02-22 - P3 surgical: Font Awesome achievement icons, profile tabs, Node guard

### Summary

Surgically implemented the remaining P3 profile items without touching existing
layout structure. Added Font Awesome 6 Free achievement icons, a two-tab profile
navigation (Overview / Achievements) with progress bars for locked achievements,
a Node.js 20+ startup guard, and cleaned up the TODO completely.

**Changed files:**

- `server.js` — Added Node.js major-version guard block at top; process exits with a
  clear error message if running on Node < 20.
- `lib/achievements.js` — Replaced the internal `i-*` icon strings in the `ICONS`
  constant with Font Awesome 6 Free Solid class strings (`fa-solid fa-*`). Added a
  `current` field to each achievement object returned by `makeAchievements()` so
  the template can calculate progress-bar width without extra logic.
- `views/user.ejs` — Added FA 6.7.2 CDN `<link>` tag; added `<nav class="profile-tabs">`
  bar with Overview and Achievements buttons (Achievements shows unlocked-count badge);
  wrapped `profile-stats` + `profile-message` sections in `<div class="profile-panel"
data-panel="overview">`; wrapped `profile-achievements` in `<div class="profile-panel
hidden" data-panel="achievements">`; switched achievement icon span from `i-*` custom
  font to `<i class="...fa...">` child element; added progress bar div + percentage
  label for locked achievements; removed `if (info.canEditMessage)` guard around the
  user.js `<script>` tag so tab switching loads for all visitors.
- `entries/css/page.css` — Replaced `.achievement-icon::before` font-size rule with
  `.achievement-icon i` sizing rule for FA `<i>` elements; added `.achievement-progress`
  and `.achievement-progress-bar` styles; added full tab nav CSS (`.profile-tabs`,
  `.profile-tab`, `.profile-tab.active`, `.tab-badge`); added `.profile-panel` /
  `.profile-panel.hidden` rules.
- `entries/user.js` — Removed the throw-on-missing-form guard (fixes crash for
  non-owner profile visitors now that user.js always loads); added tab-switching
  logic at top of file (click listener on `.profile-tab` toggles `active` /
  `aria-selected` on buttons and `hidden` on panels); wrapped form logic in
  `if (form) { ... }`.
- `docs/archive-viewer.md` — Created: full Archive Viewer spec migrated from TODO.md
  (format table, endpoint signatures, security constraints, memory model, client UI).
- `TODO.md` — Full overhaul: removed all completed items (MCP server, yauzl evaluation,
  node guard, FA icons); migrated Archive Viewer spec to `docs/archive-viewer.md`;
  rewrote as clean P1/P2/P3 structure with checkbox-only sections and updated
  Execution Order table.

## 2026-02-22 - yauzl streaming ZIP implementation for large CBZ archives

### Summary

Implemented yauzl as the ZIP-reading backend for large comic archives (≥ 100 MB)
in `lib/meta.js`, replacing the full-heap jszip pattern for the two CBZ code paths
while leaving the EPUB paths unchanged (jszip only; EPUBs are almost always < 50 MB).

**Problem**: `JSZip.loadAsync(buf)` loads the entire archive file into a Node.js
heap buffer before any entry can be read. A 500 MB CBZ scan-pack causes a ~1–1.5 GB
heap spike during asset generation and per-page serving, risking OOM on constrained
hosts and degrading all other concurrent workers while the decompression runs.

**Solution**: `yauzl` (MIT, npm) opens a ZIP file via `fs.open` (file descriptor),
reads only the central directory index (~KB) into RAM, then streams each entry on
demand via `fs.createReadStream`. Peak heap for the same 500 MB archive is ~10–25 MB
regardless of total archive size.

**Threshold**: `YAUZL_THRESHOLD = 100 * 1024 * 1024` (100 MB). Archives below this
size continue to use jszip (simpler API, lower open overhead for small files).
Archives at or above the threshold use yauzl with jszip as error fallback in
`generateAssetsComic`.

**New functions in `lib/meta.js`**:

- `yauzlListImages(filePath)` — promisified entry-scan returning an unsorted array of
  comic image paths; uses `lazyEntries: true` + autoClose.
- `yauzlExtractEntry(filePath, entryName)` — opens, central-dir scans for a single
  named entry, streams it into a `Buffer`, closes the fd without reading remaining
  entries. Used per page-view request, so the open/close overhead occurs only when
  the ZIP > 100 MB (and the alternative was reading 500 MB into heap).
- `yauzlReadComicInfo(filePath)` — same as above but case-insensitively looks for
  `ComicInfo.xml`; returns the XML string or null.

**Call sites changed** (`lib/meta.js`):

- `generateAssetsComic` ZIP branch: stat → if ≥ threshold, yauzl list + index +
  per-page buffer; else jszip as before. yauzl errors fall back to jszip.
- `extractComicPage` ZIP index-reconstruction fallback: stat → yauzl or jszip.
- `extractComicPage` ZIP page extraction: stat → yauzl or jszip.

**EPUB paths untouched**: `extractEpubCover` and `countEpubPages` continue to use
jszip only (EPUBs < 50 MB; streaming adds complexity with no meaningful gain for
those functions).

**Dependency**: `yauzl ^2.10.0` added to `package.json` and installed via
`npm install --legacy-peer-deps`. Verified `require('yauzl')` is `function` on
Node 20.20.0. Server restarted cleanly with all workers up.

### Changed Files

- **`lib/meta.js`** — Added `YAUZL_THRESHOLD` constant; added three yauzl helper
  functions (`yauzlListImages`, `yauzlExtractEntry`, `yauzlReadComicInfo`);
  replaced JSZip.loadAsync blocks in `generateAssetsComic` (ZIP branch) and both
  ZIP branches of `extractComicPage` with threshold-routed yauzl/jszip dispatch.
  EPUB paths (`extractEpubCover`, `countEpubPages`) unchanged.
- **`package.json`** — Added `"yauzl": "^2.10.0"` to `dependencies`.

---

## 2026-02-22 - AGENTS.md changelog ordering rule + yauzl evaluation

### Summary

Two documentation upgrades: a mandatory ordering rule added to the AGENTS.md
Changelog Update Procedure, and a complete yauzl streaming ZIP evaluation recorded
in TODO.md.

**AGENTS.md — Entry ordering within a version block**: Added a new mandatory subsection
between step 5 ("group by type") and the Writing Style section. The rule requires agents
to reorder all entries within each type group (`Added`, `Changed`, `Fixed`) by user impact
before committing a changelog update, using six priority tiers: flagship/major workflows
(Tier 1) → daily-use UX improvements (Tier 2) → security changes users see (Tier 3) →
performance wins (Tier 4) → opt-in/operator features (Tier 5) → developer tooling (Tier 6).
The rationale: readers skim the first two or three bullets; the most impactful feature must
be first. Added an explicit anti-pattern note warning against preserving chronological
shipping order (e.g., opengraph.io enrichment committed before MCP server should not
appear above it in the changelog).

**TODO.md — yauzl evaluation**: Resolved the Research Backlog item "Evaluate yauzl for
archives > 100 MB". Findings: yauzl uses file-descriptor + `fs.createReadStream` internally,
reading only the ZIP central directory into RAM; peak heap for a 500 MB CBZ is ~10–25 MB vs.
~1–1.5 GB with jszip `loadAsync`. Per-callsite recommendation: yauzl-first for
`generateAssetsComic` and `extractComicPage` ZIP branches (CBZ files routinely exceed 100 MB);
jszip-only for `extractEpubCover` and `countEpubPages` (EPUBs < 50 MB, streaming adds
complexity with no meaningful gain). Implementation plan recorded: `npm install yauzl`,
two helper functions (`yauzlListImages`, `yauzlExtractEntry`), size-threshold routing at
100 MB. Archive Viewer memory limitation note updated to reference the evaluation and
correct threshold (was "< 200 MB, add yauzl someday" → "< 100 MB jszip / ≥ 100 MB yauzl,
see evaluation above").

### Changed Files

- **`AGENTS.md`** — New "Entry ordering within a version block (mandatory)" subsection
  added to Changelog Update Procedure; step 5 now explicitly triggers re-sort; six-tier
  priority table added; anti-pattern example included.
- **`TODO.md`** — Research Backlog yauzl item marked `[x]` and expanded with full
  evaluation (memory model table, per-callsite decision matrix, implementation plan,
  dependency note). Archive Viewer memory limitation note updated to reference evaluation.

---

## 2026-02-22 - README AI setup section + .config.json.example + API/MCP doc links

### Summary

Two user-facing improvements to help new operators and AI agents get started quickly.

**README.md — AI-Assisted Setup section**: Added a new section immediately before
"Quick Start" containing a complete, copy-pasteable six-step prompt that any MCP-capable
agent (OpenClaw, Claude, Codex, Cursor) can execute to:

1. Clone and `npm install`
2. Copy `.config.json.example` → `.config.json` and fill required secrets
3. Build webpack bundle and start the server with a health verification step
4. Wire the MCP server into the agent's config file (with format reference to MCP.md)
5. Smoke-test the MCP stdio transport
6. Install the OpenClaw skill to `~/.claude/skills/dicefiles/`

**README.md — Documentation table**: Replaced the flat bullet list with a table that
includes `API.md` and `MCP.md` with one-sentence descriptions of purpose, so users
know which document to reach for.

**README.md — Automation API section**: Added a paragraph pointing to `MCP.md` for
AI clients that want tool-based access rather than raw HTTP calls.

**README.md — Quick Start configure step**: Both Linux/macOS and Windows sections now
say "Copy `.config.json.example` and edit it" instead of showing an inline JSON
snippet, keeping the docs in sync with the example file.

**.config.json.example**: New annotated JSONC reference file. Covers every operator-
relevant config key with inline comments explaining purpose, units, examples, and
cross-references. Sections: Identity, Security (secret generation command included),
Network (port + TLS toggle), Storage (uploads dir + maxFileSize), Automation API
(key schema, all scopes, references to API.md and MCP.md), Optional External Services
(opengraphIoKey), Rooms, File Expiry, Webhooks (event list), Logging, Preview Tooling,
and Flood Control. Includes JSONC warning at the top: "Remove all // comment lines
before copying to .config.json."

### Changed Files

- **`README.md`** — Documentation section converted to table with API.md + MCP.md rows;
  new "AI-Assisted Setup (OpenClaw)" section before Quick Start; configure step in both
  OS tracks updated to reference `.config.json.example`; Automation API section links
  to MCP.md.
- **`.config.json.example`** — New file: annotated JSONC configuration reference.

---

### Summary

Two fixes shipped together: a CSS colour regression on the show-new-btn icon, and
an optional opengraph.io integration for better link-title resolution in the Links
Archive.

**Show-new-btn icon colour**: The compiled `static/style.css` bundle still contained
`color:var(--accent-light,#4af)` on `#show-new-btn.active` from before the prior
source edit. Added explicit `color: var(--text-fg)` to the source rule so the compiled
output is deterministic (white icon, matching all other active filter buttons). Bundle
rebuilt — confirmed `color:var(--text-fg)` in new `static/style.css`.

**opengraph.io link enrichment** (`lib/links.js`):

- The original `resolveTitle(url)` function fetched the raw HTML of each posted URL
  and parsed the `<title>` tag — cheap but fragile on JS-rendered pages and redirected
  URLs.
- New implementation adds an optional fast path: when `opengraphIoKey` is set in the
  project configuration, `resolveByOpengraphIo(url, key)` is tried first. It calls
  `https://opengraph.io/api/1.1/site/<encoded>?app_id=<key>` and extracts
  `hybridGraph.title || openGraph.title || htmlInferred.title`.
- On any failure (non-200 status, timeout, parse error, empty title) the fallback
  `resolveByHtmlTitle(url)` — identical logic to the original `resolveTitle` — runs
  instead. Existing deployments without a key are completely unaffected.
- Added `const CONFIG = require("./config")` import to `lib/links.js`.
- Config option `opengraphIoKey: ""` added to `defaults.js`.
- Local `.config.json` updated with `"opengraphIoKey": "b01bd6fc-298d-47dd-ae15-7a354c0aa251"`.
- `git/lifestyle/.env` updated with `OPENGRAPH_IO_API_KEY=b01bd6fc-...` under a new
  `# DICEFILES` section.
- `README.md` config table: new row for `opengraphIoKey` with description, fallback
  behaviour, free tier note, and signup URL.
- `CHANGELOG.md`: new `[Unreleased] Added` entry for the feature.

### Changed Files

- **`entries/css/room.css`** — `#show-new-btn.active`: added `color: var(--text-fg)` to
  ensure white icon in active state; previously relied solely on inheritance which was
  overridden in the old compiled bundle.
- **`static/style.css`** (compiled) — Rebuilt; `show-new-btn.active` now emits
  `color:var(--text-fg)`, no more `accent-light` blue.
- **`lib/links.js`** — Added `CONFIG` import; split `resolveTitle` into
  `resolveByOpengraphIo` + `resolveByHtmlTitle` + new `resolveTitle` orchestrator that
  tries opengraph.io first when key is configured.
- **`defaults.js`** — Added `opengraphIoKey: ""` config key with doc comment.
- **`.config.json`** — Added `"opengraphIoKey": "b01bd6fc-298d-47dd-ae15-7a354c0aa251"`.
- **`git/lifestyle/.env`** (external) — Added `OPENGRAPH_IO_API_KEY` under `# DICEFILES`.
- **`README.md`** — Config table: added `opengraphIoKey` row.
- **`CHANGELOG.md`** — Added opengraph.io feature entry under `[Unreleased] → Added`.

---

### Summary

Expanded MCP.md Section 2 (Setup and Configuration) from 3 generic subsections to 9
client-specific subsections covering every major MCP-capable client. Created a bundled
OpenClaw agent skill file for autonomous room-management workflows.

**MCP.md — Section 2 rewrite**: Old section 2 covered only Claude Desktop + HTTP
transport in a single combined block. New section 2 covers 9 distinct clients in
dedicated subsections with copy-pasteable JSON/TOML configs and client-specific notes.

- 2.1 Prerequisites — `npm install`, smoke-test command, env-var table
- 2.2 Claude Desktop — OS-specific path table + `mcpServers` JSON
- 2.3 VS Code — workspace `.vscode/mcp.json` (`"servers"` key, `"type":"stdio"`,
  `${workspaceFolder}`) + user `settings.json` under `"mcp"` wrapper; agent-mode note
- 2.4 Antigravity — 3-step UI walkthrough, `mcp_config.json` with `"mcpServers"`
- 2.5 Cursor — `~/.cursor/mcp.json` (global) / `.cursor/mcp.json` (per-project);
  Settings UI alternative
- 2.6 Codex CLI — TOML at `~/.codex/config.toml`, `[mcp_servers.dicefiles]` (underscore
  mandatory, camelCase silently breaks detection); stdio-only warning; `/mcp` verify step
- 2.7 OpenCode CLI — `~/.config/opencode/opencode.json`; `"command"` as array
  (program + args merged); `"environment"` key rather than `"env"`; `"type":"local"`
- 2.8 OpenClaw — mcporter `~/.config/mcporter.json` + `mcporter add` CLI one-liner;
  agent skill install via `cp scripts/openclaw-dicefiles-skill/SKILL.md ~/.claude/skills/dicefiles/`
- 2.9 HTTP Transport — generic orchestrators, `MCP_TRANSPORT=http MCP_PORT=3001`,
  reverse-proxy note

**OpenClaw skill** (`scripts/openclaw-dicefiles-skill/SKILL.md`): New file. Describes
the full 13-tool inventory, three standard call sequences (discovery, new-file polling,
request fulfillment loop), error-handling table (409 claim collision, `ok:false`
propagation, partial upload failures), startup sequence (health → subscriptions →
snapshot), and a configuration reference block. Intended to be installed into
`~/.claude/skills/dicefiles/` so an OpenClaw agent can act autonomously on a Dicefiles
room without per-session prompting.

**Research findings recorded**:

- VS Code uses `"servers"` key (not `"mcpServers"`) and requires `"type":"stdio"` field
- OpenCode `command` is a merged array, not separate `command`+`args`; env key is `"environment"`, not `"env"`
- Codex silently ignores `mcpServers` / `mcp-servers`; only `mcp_servers` (underscore) works
- Codex CLI currently supports stdio only; HTTP transport is not compatible

### Changed Files

- **`MCP.md`** — Section 2 replaced entirely with 9-subsection client-specific install guide.
- **`scripts/openclaw-dicefiles-skill/SKILL.md`** — New file; OpenClaw agent skill for
  autonomous Dicefiles room automation covering all 13 MCP tools, workflow patterns,
  and error-handling guidance.

---

## 2026-02-22 - Comment cleanup, AGENTS.md rule, changelog, UI tweak

### Summary

Housekeeping pass following the P1/P2 feature work.

- **PXX comment cleanup**: All `P1`, `P2`, and `PX-X` labels removed from source code
  comments in `client/files.js`, `lib/httpserver.js`, and `entries/css/room.css`.
  Replaced with descriptions of what the code actually does. Follows the new AGENTS.md
  rule (see below). No logic changed.
- **AGENTS.md — Code Comment Standards**: Added a mandatory section documenting the
  rule: agents must never write `P0`/`P1`/`P2`/`PX-X` labels into source code
  comments. Rationale, before/after examples, and failure mode description included.
- **UI — show-new-btn active colour removed**: The blue `color: var(--accent-light, #4af)`
  was removed from `#show-new-btn.active`. The button now signals active state with
  opacity and background only, matching the neutral style of the filter buttons.
- **CHANGELOG updated**: Three new items added under `[Unreleased] → Added`: sort
  icons on sort controls, "show new files" button integrated into filter bar, and MCP
  server for AI clients.

### Changed Files

- **`client/files.js`** — Removed `P1 —` prefix from 2 inline comments; removed
  `P1:` prefix from 3 section-divider comments.
- **`lib/httpserver.js`** — Removed `P2` from 2 section-divider comments
  (`AI Automation API` / `End AI Automation API`).
- **`entries/css/room.css`** — Removed `P1:` from 3 CSS section comments; removed
  `color: var(--accent-light, #4af)` from `#show-new-btn.active`.
- **`AGENTS.md`** — Added "Code Comment Standards (Mandatory)" section with rule,
  rationale, examples table, applicability scope, and failure mode.
- **`CHANGELOG.md`** — Prepended 3 new `[Unreleased] → Added` entries.

---

## 2026-02-23 - P1 sort icons + filter pill, P2 MCP server

### Summary

Two parallel deliverables: P1 UI polish (sort pill icons, filter pill reorganisation)
and the full P2 MCP server implementation.

**P1 — Sort icons**: The three sort buttons ("New", "Size", "Exp") now display inline
SVG icons instead of text labels. Lightning bolt = newest first, descending bar chart =
largest first, hourglass = expiring soon. No Font Awesome dependency needed. The
active sort button continues to receive the `.active` class (background accent). CSS
updated to remove text-sizing overrides from `.sort-pill .btn` and add
`pointer-events: none` on SVG children.

**P1 — Filter pill reorganisation**: The "Show Only New Files" button (`#show-new-btn`)
is now the rightmost element inside the `.filter-pill` div instead of a standalone
button. It retains its `btn i-arrow-up` class (not `filterbtn`) so it does not
register in the `filterButtons` array and does not interfere with the type-filter
toggle system. The `margin-left: 0.5rem` rule was removed; pill border-radius
is handled automatically by the existing `.btn-pill .btn:last-child` rule in CSS.

**P2 — MCP server** (`scripts/mcp-server.js`): Full CommonJS implementation of a
Model Context Protocol server wrapping all 13 v1.1 REST endpoints as named tools with
Zod input schemas. Supports stdio transport (default, for Claude Desktop) and
Streamable HTTP transport (for remote orchestrators). Exports `registerTools()` and
`api()` for unit-test injection. Includes startup API-key warning and graceful
`require.main` guard so the module can be `require()`d from tests safely.

**P2 — MCP.md** (root): Complete MCP reference in API.md format. Replaced the
informal `docs/mcp.md` stub. Covers: setup & env vars, Claude Desktop config JSON,
HTTP transport mode, 13-tool matrix with scope table, per-tool spec + "What this
enables" prose, security model, and 3 workflow examples (Claude Desktop assistant,
multi-agent request fulfillment loop, OpenClaw enrichment pipeline). Old `docs/mcp.md`
removed from git tracking.

**P2 — Tests** (`tests/unit/mcp-tools.test.js`): 25 unit tests covering tool
registration count, every tool's REST call (URL, method, path encoding, query params,
request body), auth header presence, download base64 encoding, oversized file guard,
non-200 error handling, and MCP content wrapping. All mocks are virtual (no SDK or
Zod install required). All 324 tests pass.

**Dependencies added**: `@modelcontextprotocol/sdk: ^1.6.0`, `zod: ^3.24.0` added
to `package.json` dependencies. Both have CJS exports and are compatible with Node 20.

### Changed Files

- **`views/room.ejs`** — Sort pill buttons replaced with SVG icons; `#show-new-btn`
  moved into filter-pill as last child.
- **`entries/css/room.css`** — `.sort-pill .btn` text sizing removed, SVG display rules
  added; `#show-new-btn` margin-left removed.
- **`scripts/mcp-server.js`** (new) — Full MCP server: 13 tools, stdio + HTTP
  transports, auth, exported helpers.
- **`MCP.md`** (new, root) — Complete MCP reference in API.md format.
- **`docs/mcp.md`** (deleted) — Superseded by root `MCP.md`.
- **`package.json`** — Added `@modelcontextprotocol/sdk ^1.6.0` and `zod ^3.24.0`.
- **`tests/unit/mcp-tools.test.js`** (new) — 25 unit tests for all MCP tools.

---

## 2026-02-22 - API documentation enrichment, MCP guide, automation tests

### Summary

Follow-up documentation and testing pass for the P2 AI Automation Infrastructure
shipped in the previous session.

- **API.md** fully rewritten from section 12 onward: rich use-case prose ("What this
  enables") added to every v1.1 endpoint, an MCP integration section (§19), and a
  complete version-tagged endpoint matrix (§20). Also fixed a documentation bug where
  the chat endpoint body field was documented as `msg` instead of the actual `text`.
- **docs/mcp.md** (new) — comprehensive MCP integration guide: MCP clarification,
  Claude Desktop config, 13 tool definitions with input schemas, reference implementation
  sketch for `scripts/mcp-server.js`, security model, and agentic workflow examples.
- **docs/ai_automation.md** — all proposal items that were implemented in the P2 session
  are now marked `[implemented]`. Priority table updated. New Section 11 added with MCP
  wrapper summary and quick-start snippet.
- **TODO.md** — removed completed P0, P1, and P2 sections per hygiene rules.
  Added new P2 MCP Server Wrapper scoping with 2 actionable checkboxes.
  Execution Order updated to match remaining work.
- **tests/integration/automation-v1.1.test.js** (new) — 37-test integration suite
  covering all 13 v1.1 endpoints across 3 categories: auth boundary (13 tests),
  structural/schema validation (live), and AI workflow simulations (pre-flight health
  check pattern, polling loop, room context tool, subscription round-trip, agent chat,
  batch upload validation, request claiming). Runs without API key for auth tests;
  live tests activate when `DICEFILES_TEST_API_KEY` + `DICEFILES_TEST_ROOMID` are set.

### Changed Files

- **`API.md`** — Replaced sections 12-20 content with rich use-case prose, fixed
  `text` field name in §13.1 chat endpoint (was incorrectly documented as `msg`),
  added §19 MCP integration, added §20 complete endpoint matrix with Version column.
  Removed duplicate bare-bones sections that were left over from the previous session.
- **`docs/mcp.md`** (new) — Complete MCP wrapper design guide.
- **`docs/ai_automation.md`** — Marked all implemented proposals `[implemented]`,
  updated priority table, added MCP section (§11).
- **`TODO.md`** — Removed P0, P1 Smart Collections, P2 Server API Gaps, P2 Upload and
  Ingestion, P2 Workflow and Coordination sections (all fully implemented). Added P2
  MCP Server Wrapper section. Updated Execution Order.
- **`tests/integration/automation-v1.1.test.js`** (new) — 37-test automation v1.1
  integration and workflow simulation suite.

### Summary

Implements two major feature groups from TODO.md:

- **P1 Smart Collections / Saved Filters** — per-room filter presets, sort modes (newest/size/expiring), and a "show new only" toggle
- **P2 AI Automation Infrastructure** — 13 new server-side REST endpoints covering file metadata management, room interaction, observability, batch upload, request claiming, and agent subscriptions

### Changed Files

- **`lib/request.js`** — Added `hints`, `claimedBy`, `claimedUntil` fields to `RequestFile` and `REQUEST_OFILTER`. Added `claim(key, agentId, ttlMs)` and `release(key, agentId)` methods to `EMITTER` for single-agent request claiming with auto-release TTL (5s–1h, default 5min). Extended `createRequest()` to accept and store `hints`.
- **`lib/upload.js`** — Added `ingestFromBuffer({name, roomid, buffer, ip, user, account, role, ttl})` async function that replicates the full upload pipeline (hash, dedup, metadata extraction, asset generation, Upload.create) from a raw `Buffer`. Exported as `ingestFromBuffer`.
- **`lib/httpserver.js`** — Added imports for `StorageLocation`, `STORAGE`, `ingestFromBuffer`, `REQUESTS`, and optional `sharp`. Added `files:write` and `admin:read` to the `mod` scope preset. Added all 13 P2 endpoints:
  - `GET /api/v1/file/:key` — single-file metadata (files:read)
  - `PATCH /api/v1/file/:key` — allow-listed meta/tag updates, creates new frozen StorageLocation (files:write)
  - `POST /api/v1/file/:key/asset/cover` — raw JPEG body → sharp JPEG → replaces existing cover asset (files:write)
  - `POST /api/v1/room/:id/chat` — emit agent message into room chat (rooms:write)
  - `GET /api/v1/room/:id/snapshot` — fileCount, totalBytes, openRequestCount, uniqueUploaders, oldestExpiry (files:read)
  - `GET /api/v1/metrics` — OBS.snapshot() (admin:read)
  - `GET /api/v1/audit` — paginated JSON-lines audit log, newest-first, supports `since`+`limit` (admin:read)
  - `POST /api/v1/batch-upload` — fetch URLs (max 20, 100 MB/file, 60 s timeout) via ingestFromBuffer (uploads:write)
  - `POST /api/v1/requests/:key/claim` + `DELETE /api/v1/requests/:key/claim` — agent claiming with TTL (requests:write)
  - `POST/GET/DELETE /api/v1/agent/subscriptions[/:name]` — Redis-backed named filter presets per API key (files:read)
  - Updated existing `POST /api/v1/requests` to parse and forward `hints`.
- **`client/files.js`** — Added constants `PRESETS_PREFIX`, `SORT_MODE_PREFIX`, `SORT_MODES`. Added constructor members: `presetsKey`, `sortModeKey`, `sortMode`, `showingNewOnly`, plus DOM refs for new UI elements (`presetsEl`, `presetsListEl`, `presetSaveEl`, `sortNewestEl`, `sortLargestEl`, `sortExpiringEl`, `showNewBtnEl`). Extended `init()` to set the localStorage keys, call `initSortMode()` and `renderPresets()`. Modified `filtered()` to apply a `showingNewOnly` post-filter. Modified `sortFiles()` to branch on `sortMode` (newest/largest/expiring). Added new methods: `initSortMode`, `setSortMode`, `updateSortButtons`, `toggleNewOnly`, `loadPresets`, `_savePresets`, `onPresetSave`, `applyPreset`, `deletePreset`, `renderPresets`. Added click listeners for all new buttons.
- **`views/room.ejs`** — Added `#show-new-btn` button (near `#new-status`), a `#sort-pill` with three `.btn` divs (`#sort-newest`, `#sort-largest`, `#sort-expiring`), and a `#presets-row` nav below `#tools` containing `#presets-list` + `#preset-save`.
- **`entries/css/room.css`** — Added CSS for `.sort-pill` (3-button sort pill with active state), `#show-new-btn` (opacity + accent color when active), `#presets-row`, `#presets-list`, `.preset-pill`, and `.preset-pill-del`.
- **`API.md`** — Added Sections 12–19 documenting all new v1.1 endpoints, including request hints extension, and an updated full endpoint matrix.

### Changes

- **`AGENTS.md`** — Updated runtime requirement from Node 18 → Node 20 throughout: version pin, required binary path (`v20.20.0`), agent rule check, all command snippets in Strict Server Startup Procedure, Forbidden Startup Patterns, Failure Modes, and Shared Dicefiles Server Policy.
- **`scripts/restart-server.sh`** — Updated `NODE_BIN` to `/home/apoapostolov/.nvm/versions/node/v20.20.0/bin/node` and updated the echo message from "Node 18" to "Node 20".
- **`.github/workflows/ci.yml`** — Step name and `node-version` updated from `18` → `20`.
- **`.github/workflows/lint.yml`** — `node-version` updated from `18` → `20`.
- **`.github/workflows/release.yml`** — Step name and `node-version` updated from `18` → `20`.
- **`.github/workflows/security.yml`** — Step name and `node-version` updated from `18` → `20`.
- **`.github/workflows/compat.yml`** — Matrix updated from `[18, 20, 22]` → `[20, 22]`; Node 18 removed as it reached EOL April 2025.
- **`.vscode/settings.json`** — Auto-approve terminal pattern updated from `v18.20.8` → `v20.20.0` for both the webpack build and server start commands.

### Server restart

Previous server process (pid 753701) was running under `v18.20.8/bin/node`. Killed and restarted under `v20.20.0/bin/node` with a fresh production webpack build. Verified `HTTP/1.1 200 OK` on port 9090.

---

## 2026-02-22 - P1.5 archive-only cleanup, TODO hygiene rule, Node 20 compatibility confirmed

### Changes

- **`TODO.md`** — P1.5 section rewritten: removed Feature B (Comic Book Reader), Feature C (Manga/Webtoon Reader), Shared Implementation Plan, and Open Questions blocks that accounted for ~320 lines of spec. Only the Archive Viewer (Feature A) content remains. Section header renamed from "Archive Viewer and Comic Book Reader" to "Archive Viewer". Execution Order table updated: removed "Comic reader Phase 1" row, renamed "Archive browser Phase 3" row to "Archive Viewer (P1.5)", renumbered all rows 1–5.
- **`AGENTS.md`** — Added "TODO.md Hygiene (Mandatory)" section with six enforcement rules for agents: no design documents in TODO (use docs/), every section must have at least one checkbox, no aspirational P-level or Research Backlog sections without concrete next actions, remove completed sections immediately, P-level assignments must be real engineering work, and Execution Order must stay in sync on every add/remove. Also added a "Failure mode: Spec-creep" paragraph.

### Node Compatibility Research

Full compatibility investigation for Node 20/22/24:

- **Node 20.20.0** — 262/262 Jest tests pass, webpack production build is clean (same 4 pre-existing warnings, no new ones), all native modules load (sharp 0.31.3, redis 3.1.2, socket.io 4.8.3). **Zero code changes required.** Node 20 is safe to use as the new baseline today.
- **Node 22** — Functional, but `punycode` (DEP0040) and `url.parse()` (DEP0169) deprecation warnings fire from inside node_modules (not our source). Our source code contains zero uses of any deprecated API. Main practical blocker: `redis@3.1.2` is callback-based; redis@4 rewrote the entire API to promise/async-await. Migrating `lib/broker/` and any direct redis usage is the primary work item before Node 22 can be considered fully clean.
- **Node 24** — Same blockers as Node 22 plus `AsyncLocalStorage` now defaults to `AsyncContextFrame`. Not yet LTS (October 2025); no urgent reason to target.
- **Node 18 EOL**: Node 18 reached Maintenance LTS in Oct 2023 and goes EOL April 2025. The project is currently pinned to an imminently EOL runtime.

**Recommendation**: update AGENTS.md runtime pin to Node 20 immediately (zero-risk); plan redis@3→redis@4 migration for Node 22 support before April 2025.

---

## 2026-02-22 - GitHub Actions, AI automation P-level, TODO.md cleanup

### Changes

- **`.github/workflows/ci.yml`** _(new)_ — CI test workflow; runs Jest on every push and PR to `main` using Node 18.
- **`.github/workflows/release.yml`** _(new)_ — Release automation; triggered by any `v*.*.*` tag push; runs tests, builds webpack, extracts the matching CHANGELOG.md section, and publishes a GitHub Release.
- **`.github/workflows/stale.yml`** _(new)_ — Marks issues/PRs stale after 60 days of inactivity, closes after a further 7.
- **`.github/workflows/compat.yml`** _(new)_ — Node compatibility matrix; tests on Node 18, 20, and 22 in parallel on every push to `main` and weekly on Mondays.
- **`.github/workflows/lint.yml`** _(new)_ — ESLint check on every push and PR to `main`.
- **`.github/dependabot.yml`** _(new)_ — Dependabot weekly npm scan; groups minor/patch production updates; blocks major upgrades for webpack, pdfjs-dist, socket.io, express, redis.
- **`.eslintignore`** _(new)_ — Excludes `static/` (webpack output), `uploads/`, `views/`, `scripts/`, `contrib/`, `core/`, `images/`, `tests/` from lint scope.
- **`package.json`** — Added `eslint@^8.57.0` to `devDependencies`; added `"lint": "eslint ."` to `scripts`.
- **`TODO.md`** — Full rewrite: removed all fully-implemented sections (P0.5, P2 webhooks/API hardening, P1 notifications/downloads/metadata); added new **P2 — AI Automation Infrastructure** section with 11 server-side feature items from `docs/ai_automation.md`; updated execution order.

## 2026-02-22 - Security hardening cleanup, additional tests, and documentation

### Changes

- **`common/message.js`** — Stripped `P0.5 — 3.3:` prefix from inline comment; purpose still stated clearly.
- **`lib/httpserver.js`** — Removed 7 comment prefixes of the form `P0.5 — 3.x:`; kept the descriptive explanations intact.
- **`lib/validate.js`** — Removed `P0.5 — 3.4:` and `P0.5 — 3.2` from module docstring and function JSDoc.
- **`lib/user.js`** — Removed 7 `P0.5 — 3.2:` / `P0.5 — 3.3:` prefixes from inline comments.
- **`defaults.js`** — Removed `P0.5 — 3.6:` prefix from rate-limit comment.
- **`server.js`** — Removed `P0.5 — 3.1:` and `P0.5 — 3.7:` prefixes from startup comments.
- **`tests/unit/xss.test.js`** — Removed `P0.5 3.4` from file docstring.
- **`tests/unit/memory-hygiene.test.js`** — Removed `P0.5 3.5` from file docstring.
- **GitHub release `v1.3.0` deleted** — Release was premature; tag removed from remote and local. Will be re-created when the release is formally ready.
- **`automation.log` untracked** — Added to `.gitignore`; removed from git tracking with `git rm --cached`. This prevents runtime log state from appearing in commits or releases.
- **`tests/unit/security-hardening.test.js` (new)** — 38 new unit tests covering:
  - WebhookDispatcher `onRequestUpdate` fires `request_fulfilled` for fulfilled status only.
  - WebhookDispatcher `onRequestPredelete` skips already-fulfilled requests (no double-fire), skips expired requests, skips missing keys.
  - Full lifecycle test: setStatus fires once; subsequent deletion does not re-fire.
  - WebhookDispatcher HMAC signature: format, determinism, sensitivity to all three inputs.
  - WebhookDispatcher backoff: base delay, doubling, ceiling.
  - FloodProtector: check() true/false at/above/below/null, correct Redis key shape, delete() and bump() dispatch correctly.
  - Weak-secret detection: all default strings, short lengths, boundary at 15/16 chars, null/empty.
  - URL regex ReDoS resistance: two pathological patterns complete under 200 ms.
  - Full test count: 262 (up from 224).
- **`docs/ai_automation.md` (new)** — Second-tier proposal document for AI agent automation of Dicefiles. Covers real-time monitoring, conditional auto-download, agent-triggered upload, metadata enrichment, request fulfillment automation, room management, conversational file assistant, observability, and integration recipes. Distinguishes implemented features from proposals with priority table.
- **`docs/proposed_git_actions.md` (new)** — Beginner-friendly GitHub Actions proposal document. Explains workflows, jobs, steps, triggers, and secrets in plain English. Proposes 7 workflows (CI tests, release automation, Node compat matrix, Dependabot, lint, stale cleanup) with full YAML examples and a recommended adoption order.

## 2026-02-22 - Fix: EPUB cover page not rendering in reader

### Root cause

Calibre-generated EPUBs (and many other EPUB3 files) use a `titlepage.xhtml`
as the first spine chapter, whose `<body>` contains an SVG element like:

```html
<svg xmlns:xlink="http://www.w3.org/1999/xlink" …>
  <image xlink:href="cover.jpeg" … />
</svg>
```

`parseEpubChapters` in `client/files/reader.js` replaced `src="..."` image
references with `blob:` URLs but did **not** handle `xlink:href` (or plain
`href`) on SVG `<image>` elements. The raw path (`cover.jpeg`) was left
unchanged in the iframe `srcdoc`, so the browser resolved it relative to the
current page URL `/r/roomname` → `GET /r/cover.jpeg 404`.

### Fix

Added two additional replacement passes inside `parseEpubChapters`, processed
in reverse-index order (same as the existing `src=` pass to preserve string
offsets):

1. **`xlink:href="..."`** — matches all occurrences globally; handles
   Calibre/EPUB2-style cover pages like the one confirmed in test EPUB
   `HCH-zfOVTQDZvvgPL5wC`.
2. **`href="..."` on `<image>` tags only** — matches EPUB3 files that use
   the SVG `href` attribute directly (no `xlink:` prefix). Anchor `<a href>`
   links are excluded because the regex anchors on `<image\b`.

Both passes reuse the same `replaceAttr` helper and the existing `epubResolve`
/ `zipToBlob` / `extMime` pipeline.

### Changed files

- `client/files/reader.js` — extended `parseEpubChapters` to rewrite
  `xlink:href` and SVG `<image href>` attributes alongside `src` attributes

---

## 2026-02-22 - Chore: Full test suite for v1.2.0 release

### Summary

Added a complete Jest 29 test suite in preparation for the v1.2.0 release. Tests
cover pure utilities, view rendering, and live integration with the running server.

### Test suites (9 total, 185 tests)

| File                              | Tests | Notes                                                                                                                                  |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/common.test.js`        | 57    | toPrettySize, toPrettyInt, toPrettyETA, toPrettyDuration, ofilter, plural, shuffle, randint, sleep, debounce, CoalescedUpdate, memoize |
| `test/unit/sorting.test.js`       | 10    | naturalSort, naturalCaseSort, sort, sorted                                                                                             |
| `test/unit/iter.test.js`          | 8     | iter, riter (forward/reverse/wrap)                                                                                                     |
| `test/unit/message.test.js`       | 22    | normalizeURL, toMessage (all token types)                                                                                              |
| `test/unit/markdown.test.js`      | 15    | renderMarkdown (paragraphs, bold/italic, links, XSS, scheme rejection)                                                                 |
| `test/unit/achievements.test.js`  | 13    | computeAchievements — correct return shape (filesOnly, bytesOnly, downloadsOnly, unlockedList, lockedList, all)                        |
| `test/unit/previewretry.test.js`  | 10    | scheduleRetry via broker mock pattern (zadd/hset/hdel paths, error swallowing, timer start/stop)                                       |
| `test/views/render.test.js`       | 30    | EJS renderFile for every view: index, room, register, terms, rules, error, notfound, user, account, modlog*, toplist*, discover        |
| `test/integration/routes.test.js` | 30    | Live HTTP fetch to port 9090: all public routes, 404 handling, API auth, static assets, CSP headers, /new redirect                     |

### Infrastructure

- **`jest.config.js`** (new) — Jest 29 config with `transform: {}` (CJS, no transpile), 20 s timeout, coverage collection from `lib/**` and `common/**`
- **`package.json`** — added `jest@^29.7.0` devDependency; added `test`, `test:unit`, `test:integration`, `test:coverage` scripts all using explicit Node 18 binary path

### Bugs caught and fixed in tests

- `toPrettySize` boundary is strict `>`: `toPrettySize(1024)` → `"1024 B"` not `"1 KiB"`; tests use `1025` for KiB threshold
- `toPrettyETA` zero-pads all digits; `toPrettyETA(3600)` → `"01:00:00"`
- `memoize` requires functions with ≥ 1 argument
- `renderMarkdown` normalizes `https://example.com` → `https://example.com/` (trailing slash added by URL parser)
- `computeAchievements` returns named groups (`filesOnly`, `bytesOnly`, `downloadsOnly`) not arrays keyed by `files`/`bytes`/`downloads`; `files`/`uploaded`/`downloaded` are the numeric inputs
- `GET /healthz` uptime is at `json.metrics.uptimeSec`, not `json.uptime`
- `GET /` template does not emit `</html>` (closes at `</body>`); test updated to assert `</footer>` instead

### Changed files

- `jest.config.js` — created
- `package.json` — jest devDep + test scripts
- `test/unit/common.test.js` — created
- `test/unit/sorting.test.js` — created
- `test/unit/iter.test.js` — created
- `test/unit/message.test.js` — created
- `test/unit/markdown.test.js` — created (URL normalization fix applied)
- `test/unit/achievements.test.js` — created (corrected return-shape assertions)
- `test/unit/previewretry.test.js` — created
- `test/views/render.test.js` — created (achievements stub fixed to use `all`, `unlockedList`, etc.)
- `test/integration/routes.test.js` — created (`uptime` path + `</html>` fixes applied)

---

## 2026-02-22 - Feat: Preview retry queue; README config docs

### Summary

Two items in one session:

1. **README — new configuration options documented**: Added `allowRequests` and `linkCollection` rows to the Key Options configuration table, pointing readers to the per-room defaults introduced in the previous session.

2. **Preview retry queue** (`lib/previewretry.js`, new module):
   - When `generateAssets()` fails (e.g. transient GraphicsMagick/ffmpeg/I/O error), the existing code silently dropped the error with `.catch(console.error)`. The upload then had no cover assets permanently.
   - New module uses a Redis sorted set (`preview:retry`, score = next-attempt-at-ms) as a durable retry queue and a Redis hash (`preview:retry:attempts`) as the attempt counter.
   - Policy: MAX_RETRIES = 3; delays = 5 min → 15 min → 45 min; exponential back-off.
   - Multi-worker safety: each claim is guarded by `SET preview:retry:lock:<hash> 1 NX EX 120` — only one worker processes any given hash at a time even in a multi-worker cluster. Since `addAssets` already has an idempotency guard (`assets.has`), a very rare lock race at restart causes harmless duplicate work at worst.
   - All lazy-requires inside `processDue()` to avoid a circular dependency chain (meta → upload → previewretry → meta → ...).
   - Timer is `unref()`-ed so it does not block clean process exit.
   - `lib/upload.js`: on `generateAssets` failure, calls `PREVIEWRETRY.scheduleRetry(hash)` instead of `console.error`.
   - `lib/httpserver.js`: calls `require('./previewretry').start()` at server init.

### Changed files

- **`README.md`** — Add `allowRequests` and `linkCollection` to the Key Options table.
- **`lib/previewretry.js`** — New module: retry queue, poller, lock, scheduleRetry, start/stop.
- **`lib/upload.js`** — On generateAssets failure, schedule retry instead of silent log.
- **`lib/httpserver.js`** — Start retry poller at HTTP worker init.
- **`TODO.md`** — Mark "Add retry queue for transient preview failures" completed.

### Summary

Four areas delivered in one session:

1. **Fulfill Request modal — request-text-first**: The "Requested by: X" attribution was previously the first thing shown in the request view modal, making the fulfiller hunt for the actual request description. Request text is now the first and primary element; "Requested by" attribution is secondary below. No other structural changes.

2. **Room Options — Allow Requests toggle** (owner-level, on by default):
   - New checkbox in the Room Options dialog ("Allow Requests").
   - When disabled: the "Create Request" toolbar button hides client-side; the server rejects `request` socket events for that room.
   - Configurable site-wide default via `allowRequests: true|false` in the project config file.

3. **Room Options — Link Collection toggle** (owner-level, on by default):
   - New checkbox ("Link Collection") in Room Options.
   - When disabled: the Links Archive toolbar button hides client-side; if the room is in links mode at the moment it is disabled, it exits to normal mode automatically; `Link.create()` is skipped so no new URLs accumulate; the initial links emit sends an empty list.
   - Configurable site-wide default via `linkCollection: true|false` in the project config file.
   - Both capabilities are pushed to clients via `exportedRoomConfig` as resolved booleans (room-level config takes precedence, falls back to global `CONFIG.get()`).

4. **P0.5-3.2 — Password policy hardening**: The minimum password length was raised from 8 to 10 characters. The character-class check was tightened to require at least one letter (`[a-zA-Z]`) and one digit (`\d`). The same check was applied to `User.changePassword()` (previously absent — any string was accepted on password change).

### Items deliberately deferred

- Login throttling tuning (3.2) — FloodProtector already covers this; behavioral change risk.
- Dynamic `Unreleased` blocking of links-mode restoration from localStorage when `linkCollection=false` — would require reading the config at restore time; deferred.

### Changed files

- **`client/files/requestmodal.js`** — `_buildBody()`: reorder request text before "Requested by" attribution.
- **`defaults.js`** — Add `allowRequests: true` and `linkCollection: true` global defaults with comments.
- **`lib/room/index.js`** — `exportedRoomConfig`: push resolved `allowRequests` and `linkCollection` booleans.
- **`lib/client.js`** — `setConfig()`: add `allowRequests` and `linkCollection` cases. `onrequest()`: gate with `effectiveAR`. `init()`: gate links emission on `effectiveLC`. Chat message handler: gate `Link.create()` calls on `collectLinks`.
- **`views/room.ejs`** — Add `allowrequests` and `linkcollection` checkboxes to `#roomopts-tmpl`.
- **`client/roomie/optsdlg.js`** — Add both fields to the fields array; init checkboxes from config; send `setconfig` calls in `validate()`.
- **`client/files.js`** — Add `updateCapabilityButtons()` method; call it in `init()` and on every `config` socket event.
- **`lib/user.js`** — Strengthen password check in `create()` (10 chars, letter + digit). Apply same check in `changePassword()`.

### Summary

Three areas touched in one session:

1. **EPUB/MOBI focus-mode centering**: In focus reading mode the A5 page was top-aligned inside the full-viewport content area. Added a CSS override (`justify-content: center; padding: 0`) scoped to `body.focus-reading #reader-content:has(.reader-book-iframe)`.
2. **P0-3 TODO update**: Marked 9 of 11 implementation checklist items done; heading updated to "Mostly Done"; clarified the webhook gap (fires on deletion only, not `setStatus`).
3. **P0.5 security hardening** (safe/additive items only):
   - **3.1 startup warning**: `server.js` now logs `[WARN]` when the secret is a known default or shorter than 16 chars. Advisory only — does not refuse to start.
   - **3.2 auth event logs**: `User.login()` now logs `[auth] Failed login attempt from <ip> for account <nick>` on wrong password, and `[auth] Failed 2FA attempt ...` on wrong TOTP.
   - **3.3 dep modernization**: Removed `request-promise-native` import from `lib/user.js`; replaced the Gravatar HTTP call with native `fetch` + `AbortSignal.timeout(8000)`. `request` and `request-promise-native` removed from `package.json`.
   - **3.8 MD5 comment**: Added inline comment in `adopt()` clarifying MD5 is for Gravatar URL construction only.
   - **defaults.js**: Updated `secret` comment to explain the security requirement and override method.

### Items deliberately deferred

- Password policy strengthening (3.2) — affects existing user flows, needs further design.
- Login throttling tuning (3.2) — FloodProtector already covers this; behavioral change risk too high.
- Express/Helmet upgrades (3.3) — too broad for one session.
- Input validation centralization (3.4) — large scope, needs audit.
- Memory Maps/Sets cleanup (3.5) — needs broker/collections audit.
- `request_fulfilled` webhook on `setStatus` (P0.3 remaining) — `REQUESTS.set` fires for both create and update; needs semantic disambiguation before wiring.

### Changed files

- **`entries/css/reader.css`** — Add `body.focus-reading #reader-content:has(.reader-book-iframe)` rule.
- **`server.js`** — Add weak-secret startup warning in `master()`.
- **`lib/user.js`** — Remove `request-promise-native`; replace Gravatar call with `fetch`; add MD5 comment; add failed-login/2FA warn logs.
- **`defaults.js`** — Update `secret` comment.
- **`package.json`** — Remove `request` and `request-promise-native` dependencies.

### Verification

- webpack: `compiled with 4 warnings in 7808 ms`
- curl `http://127.0.0.1:9090/` → `HTTP/1.1 200 OK`
- `server.log` shows `[WARN] [security] WEAK OR DEFAULT SECRET in use.`
- Commit: `d95ebfe`

---

## 2026-02-22 - Fix: Fulfilled pill crashes file constructor before nameEl exists

### Summary

**Critical regression** introduced in commit `aac0b66`: the `File` constructor in `client/files/file.js` attempted to call `this.nameEl.appendChild(this.fulfilledPillEl)` inside the early `if (this.isRequest && isFulfilled)` block — at a point roughly 30 lines before `this.nameEl` is actually assigned. Any room containing at least one fulfilled request threw `TypeError: Cannot read properties of undefined (reading 'appendChild')` on page load, causing the socket to disconnect immediately and the entire file list to fail to render.

### Root cause

The fulfilled pill DOM creation was added in `aac0b66` alongside other request-related changes. It was placed too early in the constructor before `this.nameEl = dom("a", ...)` on the later block. The `this.fulfilledPillEl = null` placeholder that appears after `this.nameEl` was already present for the dynamic update path but was not used as the site for initial creation.

### Fix

Removed the premature pill creation from the early `if (this.isRequest)` block (kept only the class addition), and moved the conditional pill creation to directly after the `this.requestUrlEl = null` line where `this.nameEl` is guaranteed to be set.

### Changed files

- **`client/files/file.js`** — `File` constructor: remove `dom("span", ...)` + `nameEl.appendChild` from before `nameEl` exists; add conditional pill creation in-place at the `fulfilledPillEl = null` initializer.

### Verification

- webpack: `compiled with 4 warnings in 7301 ms`
- curl `http://127.0.0.1:9090/` → `HTTP/1.1 200 OK`
- Commit: `eddef41`

---

## 2026-02-22 - Docs: Strengthen changelog same-version rule; clean changelog; rename drop label

### Summary

Three changes in one commit:

1. Strengthened `AGENTS.md` changelog procedure: added explicit rule (step 4) that `Changed` and `Fixed` entries must never describe features first introduced in the same version — all iterative fixes are part of the base implementation. Added matching row to the "What does NOT go in the changelog" reference table.
2. Cleaned `CHANGELOG.md` — removed 3 `Changed` bullets (Manga/Webtoon pill, Webtoon PageDown/PageUp, Webtoon stream-ahead) and 3 `Fixed` bullets (EPUB typography navigation freeze, "Comic archive has no readable pages", CBZ override) from `[Unreleased]` because those features/bugs were all introduced in the same `[Unreleased]` version. Removed 2 `Fixed` bullets (Links Archive toggle non-functional, Link rows unstyled) from `[1.1.0]` per the same rule (Links Archive debuted in 1.1.0).
3. Changed the drag-drop image preview label in `RequestModal` from "Drop stuff here" to two-line "Drop Cover / or Image".

### Changed files

- **`AGENTS.md`** — Changelog Update Procedure: insert step 4 (never add Changed/Fixed for same-version features, renumber old step 4 → 5); add row to "What does NOT go in the changelog" table.
- **`CHANGELOG.md`** — `[Unreleased]` Changed: removed 3 webtoon/comics bullets. `[Unreleased]` Fixed: removed 3 bullets for new-in-`[Unreleased]` features. `[1.1.0]` Fixed: removed 2 Links Archive bullets.
- **`client/files/requestmodal.js`** — `RequestModal` constructor: `previewTextEl` no longer uses `dom()` `text` option; sets `innerHTML = "Drop Cover<br>or Image"` to produce a two-line label.

### Verification

- webpack: `compiled with 4 warnings in 6493 ms`
- curl `http://127.0.0.1:9090/` → `HTTP/1.1 200 OK`
- Commit: `0200a5f`

---

## 2026-02-22 - Fix: EPUB opts re-render freezes navigation; remove preview square from RequestViewModal

### Summary

Two bug fixes:

1. Prev/Next and arrow-key navigation in the EPUB/MOBI reader became permanently unresponsive after opening the font-opts (Aa) dropdown, because `applyOpts` called `_renderChapter` which set `_loaded = false` synchronously and the iframe `load` event (which restores it) hadn't fired yet when the user clicked.
2. The RequestViewModal (request fulfillment dialog) always rendered an empty/dark square on the left side — the image-preview column (`requestview-preview`) was unconditionally created and appended even when no image was supplied.

### Root causes

**Bug 1:** `BookReader._renderChapter` is async. It sets `this._loaded = false` synchronously before its first `await`. `nextPage()` / `prevPage()` both guard on `if (!this._loaded) return`, so all navigation was blocked from the moment `applyOpts` was called until the new iframe fired `load` + `requestAnimationFrame` (a window of hundreds of ms). Because JS is single-threaded and `_renderChapter` suspends at `await this._getChapter(idx)`, restoring `_loaded` synchronously after the call is safe — it runs before any microtask tick.

**Bug 2:** `RequestViewModal._buildBody()` created, styled, and appended `this.previewEl` unconditionally. The CSS used `grid-template-columns: 11em 1fr`, so the empty div always occupied an 11 em left column.

### Changed files

- **`client/files/reader.js`** — `BookReader.applyOpts`: save `wasLoaded` before `_renderChapter`, restore `this._loaded = wasLoaded` immediately after (synchronously, before first `await` fires).
- **`client/files/requestmodal.js`** — `RequestViewModal._buildBody()`: remove 8-line `previewEl` creation/append block; update section comment.
- **`entries/css/modal.css`** — `.modal-requestview .modal-body`: change from `display: grid; grid-template-columns: 11em 1fr` to `display: flex; flex-direction: column`; reduce `min-width` from 34 em to 28 em. `.modal-requestview .requestview-right`: remove `min-height: 11em`.

### Verification

- webpack: `compiled with 4 warnings in 6420 ms`
- curl `http://127.0.0.1:9090/` → `HTTP/1.1 200 OK`
- Commit: `3852fbb`

---

## 2026-02-22 - Docs: Changelog update + AGENTS.md changelog procedure

### Summary

Updated `CHANGELOG.md` with all user-facing features and fixes shipped since the last recorded entry, and added a **Changelog Update Procedure** section to `AGENTS.md` so future agents follow a consistent, quality-controlled process when updating the changelog.

### DEVELOPMENT_LOG.md entries reviewed

Reviewed all 2026-02-22 entries from the most recent backward until reaching content already represented in `CHANGELOG.md`. The following entries were evaluated:

| Dev Log Entry                                               | Decision                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fix: EPUB pagination, fulfilled pill, drop zone, modal drag | **Included** (EPUB fix + fulfilled pill are UX-visible)                                                           |
| Fix: A5 box-sizing / name+ext API filters                   | **Included** (API filters are user-facing; box-sizing is technical root-cause for already-listed pagination fix)  |
| Fix: WebtoonReader saves/restores by page                   | Omitted — internal correctness fix behind the reading-progress feature, not independently user-visible            |
| Fix: WebtoonReader progress restore — \_restoring guard     | Omitted — implementation detail of same progress feature                                                          |
| Fix: \_focusTransitioning guard                             | Omitted — double-press edge case that only manifested in unusual conditions; below the "would a user notice?" bar |
| Fix: focus mode no longer hijacks native fullscreen         | Omitted — the overall focus-mode feature is already in the changelog; this was a refinement pass                  |
| Fix: Comic/Webtoon progress not persisting                  | **Included** — root cause for reading progress feature; bundled into the progress feature bullet                  |
| Feat: Reading Progress Persistence + Webtoon stream-ahead   | **Included** — clearly user-visible                                                                               |
| Feat: Webtoon Mode for Comic Reader                         | Already in changelog via existing Webtoon entries                                                                 |
| Fix: File List TTL/Size Column Alignment                    | Omitted — layout micro-fix invisible to most users                                                                |
| Fix: CBZ Phase 2 — RAR support, ComicInfo.xml, Manga pill   | Already in changelog                                                                                              |
| Request Fulfillment Workflow (P0-3)                         | **Included** — major user-facing feature                                                                          |
| All 2026-02-21 and earlier entries                          | Already represented in CHANGELOG.md v1.1.0 and earlier                                                            |

### New bullets added to CHANGELOG.md [Unreleased]

**Added:**

- Request Fulfillment Workflow — click a request to open management overlay, upload files to fulfill, fulfilled state transitions automatically, drag-and-drop intercepted correctly
- Fulfilled Request Pill — grey "Fulfilled" badge replaces strikethrough; title muted to mid-grey
- Reading Progress Persistence — all reader formats (PDF, EPUB/MOBI, comics, webtoon) save and restore last-read page via localStorage
- Webtoon stream-ahead loading — moved from 1-at-a-time to 10-page preload buffer with 600 px margin

**Changed:**

- Webtoon stream-ahead (added as Changed entry clarifying preload improvement)
- API file-listing filters — `name_contains` and `ext` query params on `/api/v1/files` and `/api/v1/downloads`

**Fixed:**

- EPUB/MOBI page navigation after typography changes — rAF deferral of sentinel measurement

### AGENTS.md changes

Added **Changelog Update Procedure (Mandatory)** section (after the GitHub Release Protocol failure-modes block) covering:

- Pre-writing review procedure (read dev log backward, filter for user-visible items)
- Writing style requirements (user-directed language, no internal identifiers, root-cause note acceptable only in Fixed)
- Post-update dev log obligation
- Decision table (what does NOT go in the changelog)

### Changed files

- `CHANGELOG.md` — added 6 new bullets to `[Unreleased]` (4 Added, 1 Changed expanded, 1 Fixed) and reorganised section order
- `AGENTS.md` — added Changelog Update Procedure section
- `DEVELOPMENT_LOG.md` — this entry

---

## 2026-02-22 - Fix: EPUB pagination, fulfilled pill, drop zone, modal drag

Four bug fixes targeting the EPUB/MOBI reader, request fulfilled styling, the RequestViewModal upload zone, and drag-and-drop interception.

**Root causes & fixes:**

- `BookReader._renderChapter` measured the CSS multi-column sentinel inside the `load` event handler, which fires before the browser finalises column geometry. Result: `totalPages` always returned 1 after a font-size change, making pagination buttons appear broken. Fix: wrapped the measurement in `requestAnimationFrame`; also added explicit `_loaded = true` fallback so buttons are never permanently silenced.
- Fulfilled requests showed strikethrough (unwanted). Replaced with a grey `Fulfilled` pill element appended into `.nameEl` alongside the name text. Pill is created/removed on status transitions (constructor + `update()`).
- `RequestViewModal` upload zone used a plain dashed outline with small text. Redesigned to match the room's dropminder overlay: dark gradient background, thick dashed border, bold "Drop Files Here" heading, sub-caption "or click to choose". Label resets to default text when staged file list empties.
- `requestModalOpen` only detected `.modal-requestcreate`, so drag events over the open `RequestViewModal` passed through to the room upload handler and/or spawned the full-page drop overlay. Added `.modal-requestview` to the check so all drag/drop paths correctly defer to the modal's own handlers.

**Changed files:**

- `client/files/reader.js` — `_renderChapter` load handler: add rAF wrapper + error fallback for `_loaded`
- `client/files/file.js` — add `fulfilledPillEl`; create/remove in constructor and `update()`
- `client/files/requestmodal.js` — dropminder-style zone markup ("Drop Files Here" + hint); reset label on empty staged list
- `client/files.js` — `requestModalOpen` now checks for both `.modal-requestcreate` and `.modal-requestview`
- `entries/css/files.css` — remove strikethrough; add `.request-fulfilled-pill` style
- `entries/css/modal.css` — new upload zone CSS: dark bg, thick dashed border, large label, hover/drag states

Implemented the full request status lifecycle — clicking a request now opens a management modal, uploaded files can be linked to a request, and fulfilled requests are visually distinct.

**Changed files:**

- `lib/request.js` — Added `status` (`"open"` / `"fulfilled"`) and `fulfilledByNick` fields to `RequestFile`; both go through `REQUEST_OFILTER` so they reach the client. Added `EMITTER.setStatus(key, status, byNick)` which rebuilds the `RequestFile` from its serialised form (to work around `Object.seal`) and sets the new value via `REQUESTS.set()`, triggering the distributed "update" event chain.
- `lib/client.js` — Added `requeststatus` socket event handler (`onrequestStatus`). Fulfilled and Reopen are available to any connected user; Remove is mod-only. Imports both `EMITTER` (for `setStatus`) and `REQUESTS` DistributedMap (for `loaded`, `get`, `delete`) from `./request`.
- `lib/upload.js` — Reads `req.query.fulfillsRequest`; validates it as a `rqXXX` key in the same room; stores `meta.fulfilledRequestKey` and `meta.requesterNick` on the new upload so the link survives in Redis.
- `client/files/requestmodal.js` — Added `RequestViewModal` named export. Shows request text, optional reference image, and (for open requests) a file drop/pick zone. Inline XHR upload with per-file progress bar; marks fulfilled after all uploads complete. Remove (mod), Reopen, and Cancel are also implemented.
- `client/files/file.js` — Request clicks now call `owner.openRequestView(this)` instead of consuming the event silently. `request-fulfilled` CSS class toggled in constructor and `update()`.
- `client/files.js` — Imports `RequestViewModal`; adds `openRequestView(fileInst)` method that shows the modal and emits `requeststatus` on resolution.
- `client/file.js` — `FileTooltip` renders a "Requested by: {nick}" row when `meta.requesterNick` is present.
- `entries/css/files.css` — `.request-file.request-fulfilled > .name`: `#888` colour + `text-decoration: line-through`; `.request-file > .name`: `cursor: pointer`.
- `entries/css/modal.css` — Full `RequestViewModal` layout: two-column grid (preview + right panel), upload zone, staged files list, progress bar, coloured action buttons.
- `TODO.md` — Marked P0-1 webtoon persistence as done; replaced P0-3 bullet list with detailed spec and implementation checklist.

**Root cause**: CSS multi-column stretches columns to exactly fill the content-box width. With `#scroller { box-sizing: border-box; width: 30000px; padding-left: HP }`, content-box = `30000 − HP`. For `HP=56, pageWidth=400`: content-box = 29944 px, 75 columns, actual width = 288.75 px (should be 288), actual step = 400.75 px (+0.75 px per page). Two bugs from this one root cause:

1. **Margin drift** (`translateX(−N × pageWidth)` undershoots by `N × 0.75 px`) — visible as growing left margin, shrinking right margin on each page turn.
2. **Broken pagination after font change** — `sentinel.getBoundingClientRect().left` returns `HP + N × actualStep`, not `HP + N × pageWidth`. The formula `floor((sl − HP) / pageWidth)` underestimates page count (often gives 1), so every Next press jumps to the next chapter instead of the next page.

**Fix** (`client/files/reader.js` — `buildSrcdoc`): override `box-sizing: content-box !important` on `#scroller` and set `width: COLS × pageWidth − 2 × HP` (content-box). With `box-sizing: content-box`, padding-left does NOT reduce the content box. The content box = `COLS × pageWidth − 2 × HP`, giving exactly `COLS` columns each of width `pageWidth − 2 × HP = textW`, with zero remainder and an exact step of `pageWidth`. Both bugs eliminated. `COLS = 500` (generous upper bound for pages per chapter).

## 2026-02-22 - Fix: WebtoonReader saves/restores by page, not pixels; debounced scroll save

**Root cause**: `_pageHeight` was captured from `first.naturalHeight` (the image's intrinsic pixel size, e.g. 2048 px), but CSS renders images at `width:100%; max-width:900px; height:auto`, so the actual displayed height is scaled (e.g. 2048 × 900/1280 = 1440 px). The restore calculation `scrollTop = saved.page × naturalHeight` overshoots by the ratio `imageWidth / containerWidth`, placing the user far past the correct page.

- `client/files/reader.js` — `_pageHeight` now set from `first.offsetHeight` (CSS-rendered px, same coordinate space as `scrollTop`). Restore now uses `scrollIntoView({ behavior: "instant", block: "start" })` instead of the pixel estimate. To ensure `scrollIntoView` works on unloaded images (which otherwise have 0px height), each unloaded image gets `minHeight = offsetHeight` as a placeholder; a one-shot `load` listener clears `minHeight` per-image so scroll anchoring keeps the viewport stable as real images load. Added `_onContainerScroll` debounced listener (300 ms) that saves progress on every scroll stop — covers mousewheel, touch, scrollbar drag, and `PageUp`/`PageDown`. `nextPage()` and `prevPage()` now also call `saveProgress` immediately on each press so no button interaction is lost. `destroy()` removes the scroll listener and clears the debounce timer.
- `static/client.js` — Rebuilt.

## 2026-02-22 - Feat: CSS-column A5 pagination; trade-book margins; name/ext API filters

### A5 BookReader overhaul (EPUB/MOBI)

**Root cause of half-line bleed**: Previous approach used `translateY` to shift a tall `#scroller` div, combined with manual line-snapping logic. The snapping measured one `<p>` element's `lineHeight` but was fragile with mixed content (headings, block elements have different heights). Also, `padding` on a vertically-scrolled div only appears at the very top/bottom of the whole content, not on each "page".

**Fix**: Switch to CSS multi-column layout. The browser's column engine handles all line-boundary splits natively and respects `orphans`/`widows` rules. Each column = one page. Column geometry: `padding-left: HP` (left margin), `column-width: pageWidth−2·HP` (text area), `column-gap: 2·HP` (right margin of page N + left of page N+1), step = pageWidth ✓.

- `client/files/reader.js` — `BOOK_VP` 28→40 (top/bottom margin). `READER_OPTS_DEFAULTS.margin` 40→56. `buildSrcdoc` rewritten: `#scroller` gets `width:30000px`, `height: pageHeight-2·VP`, `margin-top: VP`, and CSS column properties. Load handler uses sentinel `<span>.getBoundingClientRect().left` to measure total pages. `_scrollToPage` uses `translateX`. `applyOpts` resets to page 0. Removed all line-snapping code.
- `entries/css/reader.css` — `#reader-content:has(.reader-book-iframe)`: `justify-content: flex-start` + `padding-top: 12px` — page is top-aligned, not vertically centred.
- `views/room.ejs` — Margin presets: 16/40/72 → 40/56/72px.
- `static/client.js` — Rebuilt.

### API: name/ext filters on file listing endpoints

- `lib/httpserver.js` — `GET /api/v1/files` and `GET /api/v1/downloads` accept `name_contains` (case-insensitive substring) and `ext` (comma-separated extension list). Combinable with existing `type`/`scope`/`since`.
- `API.md` — Documented new params; §6.9 includes agent polling shell examples.

## 2026-02-22 - Fix: WebtoonReader progress restore — pixel-based scroll + \_restoring guard

**Root cause**: Two compounding bugs caused webtoon reading position to always reset to page 0 on refresh:

1. `scrollIntoView` on unloaded images: `.reader-webtoon-page` has `height: auto` with no `min-height`. An `<img>` without a loaded source has 0px height, so all images before the target are also 0px — `scrollIntoView` scrolled to y=0 regardless of the saved page.
2. `visTracker` IntersectionObserver clobbered saved progress: the visibility tracker was set up _before_ `loadProgress`/scroll, so its initial IO callback for page 0 (always in the initial viewport) called `saveProgress({page: 0})`, overwriting the correct saved position before the restore rAF could fire.

- `client/files/reader.js` — Added `this._restoring = false` field to `WebtoonReader` constructor. Moved the position restore **before** `visTracker` setup. On restore: sets `_restoring = true`, gives all unloaded images a provisional `style.minHeight = _pageHeight + 'px'` so the pixel-based scroll has an accurate DOM layout, then uses `container.scrollTop = saved.page * _pageHeight` instead of `scrollIntoView`. A second `requestAnimationFrame` clears `min-height` on all images and sets `_restoring = false`. `visTracker` callback now checks `!this._restoring` before calling `saveProgress`, so no clobber can occur during the restore window.
- `static/client.js` — Rebuilt production bundle.

## 2026-02-22 - Fix: \_focusTransitioning guard prevents double-press fullscreen issue

- `client/files/reader.js` — Added `this._focusTransitioning = false` field to `Reader` constructor (before `Object.seal`). `_toggleFocus()` now returns early if `_focusTransitioning` is true (re-entrancy guard) and sets it `true` before calling `document.documentElement.requestFullscreen()`. The flag is cleared via `setTimeout(..., 300)` after the promise resolves or rejects, ensuring any spurious `fullscreenchange` events fired during the browser's fullscreen transition cannot flip `_focusMode` back to `false` before the transition completes. `_onFullscreenChange` also checks `!this._focusTransitioning` as a second guard layer. This fixes the "two-press" bug where the first press entered native fullscreen but the focus reading CSS was silently removed by a re-entrant toggle triggered by an intermediate `fullscreenchange` event with `fullscreenElement === null`.
- `static/client.js` — Rebuilt production bundle.

## 2026-02-22 - Fix: focus mode no longer hijacks native fullscreen; gallery truly hides request tiles

- `client/files/reader.js` — Removed `document.documentElement.requestFullscreen()` from `_toggleFocus()` entry path. The in-app CSS overlay (`body.focus-reading`) is the intended reading experience; calling `requestFullscreen()` was handing control to the browser and breaking the layout. Exiting focus mode still calls `document.exitFullscreen()` when `document.fullscreenElement` is set, so if the user was in native fullscreen (e.g. F11) closing the reading experience will also dismiss it. The `fullscreenchange` sync listener is kept on entry so externally-triggered fullscreen dismissal still syncs state.
- `entries/css/files.css` — Fixed CSS specificity battle: `#files.gallerymode > .file:not(.upload)` had `display: block !important` and came after `#files.gallerymode > .file.request-file { display: none !important }` in source order. Both rules had the same specificity, so source-order caused the `block` to win. Changed `:not(.upload)` → `:not(.upload):not(.request-file)` so request tiles are fully excluded from the gallery tile rule and the `display: none` rule takes effect.

- `client/files/reader.js` — Added `BOOK_VMARGIN = 10` constant. `_computePageSize()` now uses `container.clientHeight - 2 * BOOK_VMARGIN` so the A5 page is 10 px shorter than the container on each side, giving a visible gap above and below the page frame. `applyOpts()` now calls `_computePageSize()` before re-rendering so page dimensions are always fresh when font size / spacing change — prevents pagination drift where a larger font caused measured scroller height to exceed the stale `pageHeight`. Removed `will-change: transform` from `#scroller` inside `buildSrcdoc` (premature compositor-layer hint that allows painted content to escape `overflow: hidden` bounds on some GPU rendering paths); replaced with `contain: paint` on `html, body` which strictly clips compositor layers to the body boundary.

- `client/files/reader.js` — Added `_onFullscreenChange` field (declared before `Object.seal`). `_toggleFocus()` now calls `document.documentElement.requestFullscreen()` when entering focus mode and `document.exitFullscreen()` when leaving (guarded by `document.fullscreenElement` check). A `fullscreenchange` listener is attached on enter and removed on exit so that externally-triggered fullscreen dismissal (F11, OS shortcut) syncs the focus mode state automatically. Closing the reader via ✕ while in focus mode therefore also exits native browser fullscreen.
- `CHANGELOG.md` — Updated `[Unreleased]` section: merged duplicate `Changed` blocks, added Focus reading mode, EPUB/MOBI reader options, Webtoon PgDn/PgUp, gallery request tile hiding, and EPUB/MOBI dark-text fix entries.

- `views/room.ejs` — Added `<button id="reader-opts">Aa</button>` to `#reader-bar` (shows only for EPUB/MOBI) and `<div id="reader-opts-modal">` panel with four sections: font family (4 swatches), font size stepper, line spacing (Compact/Normal/Relaxed), and margins (Narrow/Normal/Wide).
- `client/files/reader.js` — Added `READER_OPTS_KEY`, `READER_OPTS_DEFAULTS`, `FONT_FAMILIES` map, `loadReaderOpts()` / `saveReaderOpts()` helpers. Modified `buildSrcdoc()` to accept an `opts` argument and apply dynamic `font-family`, `font-size`, `line-height`, and horizontal padding. Added `_opts` field and `applyOpts(patch)` method to `BookReader` which re-renders the current chapter page. Added `readerOptsEl`, `readerOptsModalEl`, `_optsOpen` fields to `Reader`; wired click handlers for all modal controls; `_openOptsModal`, `_closeOptsModal`, `_toggleOptsModal`, `_applyReaderOpt`, `_updateOptsUI` methods added. Modal auto-closes on outside click and on reader close. Options persist in `localStorage` under `dicefiles:readeropts`.
- `entries/css/reader.css` — Added `#reader-opts` button styles (matches fullscreen button), `#reader-opts-modal` dark panel with gap-based flex layout, `.rom-section`, `.rom-label`, `.rom-fonts`, `.rom-font-btn`, `.rom-row`, `.rom-step-btn`, `#rom-size-val`, `.rom-choices`, `.rom-choice-btn` styles including active/hover states. Added `position: relative` to `#reader` to anchor the modal.

- `entries/css/files.css` — Added `#files.gallerymode > .file.request-file { display: none !important; }` so request tiles are hidden in gallery mode (they have no cover image to show).
- `client/files/reader.js` — Webtoon `PageDown`/`PageUp` now scroll by one full natural page height (`this._renderer._pageHeight`) instead of falling through to the book chapter handler. `F` key also toggles focus mode.
- `client/files/reader.js` — `buildSrcdoc()` now injects `*:not(a) { color: #e8e8e8 !important; background-color: transparent !important; }` to override publisher dark-on-dark text colour declarations in EPUB/MOBI content.
- `views/room.ejs` — Added `<button id="reader-fullscreen">` (⛎) to the reader toolbar before the download button.
- `entries/css/reader.css` — Added `#reader-fullscreen` button styles and full focus-mode rules: `body.focus-reading #reader` fixed-positions the reader over the whole viewport; `#reader-bar` is opacity-0/pointer-events:none and transitions in via `body.focus-reading.focus-bar-visible` (toggled by mousemove, removed after 2 s).
- `client/files/reader.js` — `Reader._toggleFocus()`: toggles `body.focus-reading`, attaches/detaches mousemove listener, shows bar on entry, clears timer on exit. `Escape` exits focus mode before closing reader. `close()` exits focus mode automatically.

---

## 2026-02-22 - Fix: Comic/Webtoon Reading Progress Not Persisting Across Refreshes

**Root cause**: Progress was saved via an `onPageChange` callback wired in `_openComicRenderer()` using `const fileKey = this.file.key` (a closure over `Reader.this.file.key`). If `file.key` was falsy or differed from the href-derived key used by `ComicReader._fileKey`, `saveProgress(undefined, …)` silently returned without writing to localStorage. Meanwhile `loadProgress(this._fileKey)` used the href-derived fallback and found nothing — so comics always opened at page 0 after F5.

The same class of bug existed latently for the webtoon and book renderers.

**Fix**: Removed all `onPageChange`-based save callbacks from `Reader.open()` and `_openComicRenderer()`. Each renderer now calls `saveProgress(this._fileKey, …)` **directly** at the point of page change, using the very same `this._fileKey` that `loadProgress` reads from. This eliminates all possible key mismatches caused by external closures.

- `client/files/reader.js`:
  - `PDFReader._updateInfo()` — calls `saveProgress(this._fileKey, {page: current})` directly instead of forwarding to `onPageChange`
  - `BookReader._updateInfo()` — calls `saveProgress(this._fileKey, {chapter, page})` directly
  - `ComicReader._showPage()` — calls `saveProgress(this._fileKey, {page: clamped})` directly
  - `WebtoonReader` visibility tracker — calls `saveProgress(this._fileKey, {page: this._visiblePage})` directly
  - `Reader.open()` — removed `this._renderer.onPageChange = …` assignments (now redundant)
  - `Reader._openComicRenderer()` — removed `fileKey` local variable and `onPageChange` assignments

---

**Root cause**: Browser UA stylesheet applies `background-color: ButtonFace` (typically white) to `<button>` elements on `:focus`. After clicking a toggled-off mode button the focus ring activates with the UA background, overriding the dark translucent `.reader-view-btn` background — making it appear white.

- `entries/css/reader.css` — Added explicit `:focus` rule that resets `background` to the same `rgba(255,255,255,0.04)` used in the base state, suppressing the UA background. Added `:focus-visible` with a blue outline for keyboard navigation. Added `.active:focus`/`.active:focus-visible` overrides to keep the active highlight when focus lands on an active button.

---

**Root cause**: In `PDFReader.open()`, `_updateInfo(0, this.totalPages)` was called _before_ `loadProgress()`. Because `Reader.open()` wires `onPageChange` onto the renderer _before_ calling `renderer.open()`, the `_updateInfo(0, …)` call immediately invoked `onPageChange(0)` → `saveProgress(key, {page:0})`, writing page 0 back to localStorage and wiping any previously saved position. Then `loadProgress()` returned `{page:0}`, causing the restore check (`saved.page >= 1`) to always fall back to page 1. This also caused persistence loss across F5 reloads for PDFs.

- `client/files/reader.js` — Moved `loadProgress()` and `startPage` calculation to _before_ `_updateInfo()` in `PDFReader.open()`; changed `_updateInfo(0, total)` → `_updateInfo(startPage, total)` so the UI immediately shows the restored page number instead of "Page 0 / total".

---

## 2026-02-22 - Feature: Reading Progress Persistence + Webtoon Stream-ahead

### Summary

Two improvements across all reader formats:

1. **Reading progress** — The reader now saves the last-read position (page number, and chapter index for EPUB/MOBI) to `localStorage` under `dicefiles:readprogress:<fileKey>` whenever the visible page changes. When the same file is re-opened the reader restores directly to that position instead of starting at page 1. On each full file-list refresh (`replace` event) any stored keys not present in the live file map are purged.

2. **Webtoon stream-ahead** — The `WebtoonReader` lazy-loader now preloads the next **10** pages whenever an image enters the viewport (previously each page was fetched individually only when it intersected the viewport). The `rootMargin` was also widened to 600 px so browser decode can happen before the user scrolls to that image.

### Changed Files

- **`client/files/reader.js`**
  - Added `PROGRESS_PREFIX` constant, `saveProgress(fileKey, state)`, `loadProgress(fileKey)`, and `flushStaleProgress(liveKeys)` helpers (the last is exported for `files.js`).
  - `PDFReader`: added `_fileKey` / `onPageChange` fields; `open()` now accepts `fileKey` second arg; `_updateInfo()` calls `onPageChange`; `_setupObserver()` starts from the saved page and scrolls to it on first render.
  - `BookReader`: added `_fileKey` / `onPageChange` fields; `open()` now accepts `fileKey` third arg and restores saved chapter + page; `_updateInfo()` calls `onPageChange`.
  - `ComicReader`: added `_fileKey` / `onPageChange` fields; `open()` restores saved page via `_showPage(startPage)`; `_showPage()` calls `onPageChange`.
  - `WebtoonReader`: added `_fileKey` / `onPageChange` fields; `open()` restores saved scroll position; lazy-loader now preloads next 10 pages on each IntersectionObserver entry; rootMargin widened to 600 px; visibility tracker calls `onPageChange`.
  - `Reader.open()`: wires `onPageChange` → `saveProgress` on all renderer types.
  - `Reader._openComicRenderer()`: wires `onPageChange` on both `ComicReader` and `WebtoonReader`.
  - `Reader._paginatePage()`: now dispatches to `_comicPage()` for both `ComicReader` and `WebtoonReader`.

- **`client/files.js`**
  - Imports `flushStaleProgress` from `./files/reader`.
  - After each `replace` event, calls `flushStaleProgress(new Set(filemap.keys()))` to remove stale progress entries.

---

## 2026-02-22 - Feature: Webtoon Mode for Comic Reader

### Summary

Implemented Webtoon mode in the comic reader. Clicking "Webtoon" in the reader pill switches from the paged single-image view to a continuous vertical strip of all pages loaded lazily as the user scrolls. Up/Down buttons (and ↑/↓ arrow keys) scroll by 25% of a single page's natural height per press instead of jumping to a discrete page.

### Changed Files

- **`client/files/reader.js`** — Added `WebtoonReader` class: fetches page count from `/api/v1/comic/:key/index`, renders all pages as `<img>` elements in a vertical strip loaded via `IntersectionObserver`, tracks visible page for the info bar, implements `prevPage()`/`nextPage()` as `scrollBy(±25% of pageHeight)`. Wired `_webtoonMode` state into `Reader` constructor (persisted to `localStorage`). Added `_openComicRenderer()` helper that spawns either `ComicReader` or `WebtoonReader` based on mode; Webtoon button click toggles mode and hot-switches renderer without closing the overlay. Arrow keys ↑/↓ now scroll 25% in webtoon mode. Manga and Webtoon modes are mutually exclusive.
- **`views/room.ejs`** — Removed `disabled` attribute and updated tooltip text on the Webtoon button.
- **`entries/css/reader.css`** — Added `.reader-webtoon-strip` (vertical flex, centered) and `.reader-webtoon-page` (full-width, max 900px, `height: auto`) styles. Added `#reader-content:has(.reader-webtoon-strip)` context rule to make the content area scrollable with no padding when in webtoon mode.

---

## 2026-02-22 - Fix: File List TTL/Size Column Alignment for Request Files

### Summary

Request file rows were missing a `.size` element in the `.detail` flex container, causing the `.ttl` span to start at the left edge of the detail area instead of aligning with the TTL column of normal file rows.

### Root Cause

The `.detail` container is a fixed-width (212px) flex box. Normal files render `[.size(flex:2)] [.ttl(flex:3)]`; request files only rendered `[.ttl(flex:3)]`, making TTL occupy the full 212px width instead of the rightmost 3/5 of it.

### Changed Files

- **`client/files/file.js`** — In the `isRequest` branch, insert an empty `<span class="size size-placeholder">` before the TTL element so layout matches normal rows.
- **`entries/css/files.css`** — Added `#files > .file > .detail > .size.size-placeholder { visibility: hidden; }` so the placeholder takes up space without rendering visible content or a separator border.

---

## 2026-02-22 - Fix: CBZ Phase 2 — RAR Support, On-demand Index, ComicInfo.xml, Manga/Webtoon Pill

### Summary

Fixed three bugs in the comic reader and added Phase 2 RAR support:

1. **"Comic archive has no readable pages"** — The index endpoint now calls `ensureComicAssets(storage)` on-demand when `comic_index` is absent. This handles files whose initial asset generation was interrupted (e.g. server restarted mid-upload for the 306 MB Batman Dark Designs ZIP).
2. **CBR/RAR support** — `generateAssetsComic` and `extractComicPage` now detect the internal container format via magic bytes (ZIP: `PK\x03\x04`, RAR: `Rar!`) and route to jszip (ZIP path) or `spawn unrar` (RAR path). Both `CBZ` and `CBR` files with RAR containers now work end-to-end.
3. **CBZ-override bug** — The extension override in `getMetaData` previously required `FileType === "ZIP"` for `.cbz`, so `.cbz` files with internal RAR containers were stored as `meta.type = "RAR"` and rejected by `comicCheck`. Fix: extension always wins regardless of detected container type.
4. **ComicInfo.xml metadata** — `generateAssetsComic` now reads `ComicInfo.xml` from both ZIP and RAR archives. Parses title, series, number, year, publisher, writer, and `FrontCover` page index. Cover selection priority: ComicInfo `FrontCover` page → filename "cover" heuristic → index 0.
5. **`comicCheck` backward compat** — Also accepts files by filename extension (`.cbz/.cbr/.cbt`) for uploads stored with wrong `meta.type` before the override fix, and patches `meta.type` in-memory for the request.
6. **Manga/Webtoon pill** — Manga and Webtoon buttons are now a single pill (`#reader-view-pill`) placed to the LEFT of the download button instead of after Prev/Next. The pill is shown/hidden as a unit. CSS updated from `.reader-mode-btn` to `.reader-view-pill` + `.reader-view-btn`.

### Changed files

- **`lib/meta.js`** — Fixed CBZ override: removed `FileType === "ZIP"` restriction so any `.cbz` extension is typed `"CBZ"`. Added `detectComicContainer(filePath)` (magic-byte ZIP vs RAR detection), `spawnBuffer(cmd, args)` helper, `rarListImages(archivePath)`, `rarExtractFile(archivePath, fileName)`, `zipReadComicInfo(zip)`, `rarReadComicInfo(archivePath)`, `parseComicInfoXml(xmlStr)`. Rewrote `generateAssetsComic`: routes to jszip or unrar based on container detection, reads ComicInfo.xml, selects cover by FrontCover index/heuristic, always calls `addAssets` to persist index. Rewrote `extractComicPage`: uses container detection to route extraction between jszip and unrar; fallback index listing if `comic_index` absent. Added `ensureComicAssets(storage)`: idempotent on-demand index rebuild (no-op if `comic_index` already set). Exported `ensureComicAssets` with `wrap(maxAssetsProcesses, ...)`.
- **`lib/httpserver.js`** — `comicCheck`: also accepts files by filename extension when `meta.type` is wrong; patches `meta.type` in-memory if needed. Index route: calls `META.ensureComicAssets(storage)` before computing page count when `comic_index` is absent.
- **`views/room.ejs`** — Replaced standalone `#reader-manga` / `#reader-webtoon` buttons (after Prev/Next) with `<div id="reader-view-pill">` pill wrapper placed BEFORE `#reader-download`. Buttons inside the pill use `reader-view-btn` class.
- **`entries/css/reader.css`** — Replaced `.reader-mode-btn` styles with `.reader-view-pill` (flex container, single border-radius, shared border) and `.reader-view-btn` (pill segment, border-right divider, no individual border-radius). Active state removes the per-button border-color override.
- **`client/files/reader.js`** — Added `this.viewPillEl = document.querySelector("#reader-view-pill")`. In `Reader.open()`: hides/shows `viewPillEl` as a unit instead of toggling individual button hidden classes. `mangaEl` click handler unchanged; `active` class still toggled on `#reader-manga`.

### Summary

Implemented end-to-end support for reading CBZ comic book archives directly in the browser. Uploaded CBZ files are now detected as type `"CBZ"` (instead of the generic `"ZIP"`), a sorted page index and cover thumbnail are generated at upload time, and each page is served on-demand as a transcoded JPEG via a new API route. The client opens CBZ/CBR/CBT files in a new `ComicReader`, displays pages one at a time with prev/next navigation, and preloads adjacent pages. A manga mode toggle button reverses the left/right direction to match right-to-left reading order.

### Changed files

- **`lib/meta.js`** — Added `COMIC_TYPES` (`CBZ`, `CBR`, `CBT`) and `COMIC_IMAGE_EXTS` constants. Added post-exiftool extension override that sets `rv.meta.type` to `"CBZ"/"CBR"/"CBT"` instead of the generic container type. Added COMIC_TYPES check (before ARCHIVE_TYPES) in the MIME/type dispatch so comics are classified as `type: "document"`. Added `generateAssetsComic(storage)`: loads CBZ with jszip, natural-sorts image entries, persists sorted page list in `storage.meta.comic_index`, page count in `storage.meta.pages`/`storage.tags.pages`, extracts first page and saves a 400×600 JPEG cover via sharp. Added `extractComicPage(storage, n)`: extracts the n-th page from the archive (falls back to re-listing if no index), transcodes to 1400 px-wide JPEG via sharp. Both functions exported and rate-limited via `wrap(maxAssetsProcesses, ...)`. Updated `generateAssets()` dispatch to route COMIC_TYPES before EPUB/MOBI.
- **`lib/httpserver.js`** — Added `const META = require("./meta")`. Added `comicCheck(req, res)` helper (resolves upload, validates comic type, enforces hidden-file guard). Added `GET /api/v1/comic/:key/index` route: returns `{ pages, hash }`. Added `GET /api/v1/comic/:key/page/:n` route: calls `META.extractComicPage`, streams result as `image/jpeg` with `Cache-Control: public, max-age=<TTL>`.
- **`client/file.js`** — `getReadableType()`: added `"comic"` return for `CBZ`/`CBR`/`CBT` types and `.cbz`/`.cbr`/`.cbt` filename extensions.
- **`client/files/reader.js`** — Updated module docstring. Updated local `getReadableType()` helper to return `"comic"` for CBZ/CBR/CBT. Added full `ComicReader` class: `open(file)` fetches index endpoint, renders a single `<img>` element, `_showPage(n)` updates src and preloads neighbours, `nextPage()`/`prevPage()` respect manga RTL flip, `setMangaMode(bool)` toggles RTL and updates the info bar, `destroy()` clears DOM. Updated `Reader` constructor: added `mangaEl`, `webtoonEl`, `_mangaMode` (persistent via `localStorage`); prev/next click handlers now route through `_paginatePage()` which dispatches to `_bookPage` or `_comicPage`. Updated `Reader.open()`: added `isComic` flag, prev/next shown for both books and comics, manga/webtoon buttons shown only for comics, manga button initialised with `active` class from `_mangaMode` state. Added `_comicPage(dir)` and `_paginatePage(dir)` helpers. Updated `_onKey()`: ArrowLeft/Right route to `_comicPage` when `_readerType === "comic"`.
- **`views/room.ejs`** — Added `<button id="reader-manga">` and `<button id="reader-webtoon" disabled>` (webtoon is a placeholder for Phase 2) after the existing prev/next buttons in `#reader-bar`.
- **`entries/css/reader.css`** — Added `.reader-comic-page` styles (full-height, letterboxed, dark shadow). Added `.reader-mode-btn` base styles and `.reader-mode-btn.active` highlight (blue tint). Added `#reader-content:has(.reader-comic-page)` overrides for single-page centered layout.

### Notes

- CBR and CBT support (RAR / TAR extraction) is Phase 2; uploads are accepted and typed correctly but `generateAssetsComic` + `extractComicPage` log an "not yet implemented" and no-op for those types.
- Webtoon mode button is visible but disabled; full vertical-strip implementation is scoped in `TODO.md` Feature C.

### Root Cause

After a workspace sanitation (uploads directory cleared), Redis still held stale
`STORAGE` map entries pointing to deleted physical files. When a user re-uploaded
the same file (same content hash), the deduplication logic found the old
`StorageLocation` in Redis, deleted the freshly-uploaded temp file via
`storage.rm()`, and then tried to serve the now-gone file — resulting in an
`ENOENT` stream error that reached the Express error handler, which always returns
HTTP 403 (Forbidden). PDF.js reported this as "Unexpected server response (403)"
and refused to open the document. Thumbnail generation also silently failed for
the same reason.

### Changes

- **`lib/upload.js`** — In `realupload()`, after a dedup hit (`STORAGE.get(hash)`
  returns an existing `StorageLocation`), now verify the physical file exists via
  `fs.promises.access(newStorage.full)`. If it is missing (stale entry), fall
  through to the "new storage" code path so the freshly uploaded file is kept,
  metadata is re-extracted, and thumbnails are regenerated correctly.
- **`lib/upload.js`** — In `serve()`, changed `s.on("error", next)` to inspect
  the error: `ENOENT` / `err.status === 404` now calls `next()` (→ 404 Not Found)
  instead of `next(err)` (→ 403 Forbidden via the global error handler). This
  makes missing-file responses semantically correct for any remaining stale
  entries.

---

## 2026-02-21 - Release: v1.1.0 GitHub Release + AGENTS.md Release Protocol

- **`AGENTS.md`** — Added _GitHub Release Protocol_ section (mandatory): pre-flight checks, tag placement rules (move stale tags to HEAD before publishing), `gh release create` command with `--notes-file`, release body quality requirements table, post-release verification step, and explicit failure modes (wrong commit, missing notes file, drafts, missing `--latest`). This protocol is now required for every dated CHANGELOG version bump.
- **Git tag `v1.1.0`** — Moved from the original milestone commit (`7501141`) to the fully-patched HEAD (`f3530fb`) so the diff link represents the complete stable state of v1.1.0 including MOBI cover and page-count bug-fix commits.
- **GitHub release `v1.1.0`** created at `https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing/releases/tag/v1.1.0` with full release notes derived from `CHANGELOG.md`: Added section with 5 feature subsections (Streaming Reader, A5 Layout, EPUB/MOBI/AZW Covers, Page Count Estimation, Links Archive) and Fixed section with 5 root-cause entries.

---

## 2026-02-21 - Fix: MOBI Page Count Stale Value / Always-Recalculate Guard

### Root Cause

Three MOBI files had `meta.pages = "8"` stored in Redis. The value originated from
a previous intermediate implementation of `countMobiPages` that used a wrong
`A5_CHARS_PER_PAGE` constant (~100,000 instead of 1600) during testing. The cover
asset was saved for those files (because they had embedded covers), which
persisted the incorrect count via `addAssets`.

The existing guard `if (!storage.meta.pages)` was intended to let exiftool's page
count win, but exiftool returns **no page count for MOBI files** at all, so the
guard only served to preserve stale values and never provided any benefit for
EPUB/MOBI.

### Fixed Files

- **`lib/meta.js`** — `generateAssetsEpubMobi`: removed `if (!storage.meta.pages)`
  guard; page count is now always recalculated from PalmDoc `text_length` (MOBI)
  or OPF spine walk (EPUB). This ensures future uploads never get stuck with a
  stale value even if a prior run produced a wrong estimate.

### Manual Redis Fix

One-time patch issued directly to Redis:

- `zaJREIbrgLgcZPIw8zE5` (Wolfsbane, MOBI): `pages` corrected `8 → 502`
- `DCrS2B3s-aZmz1JQVVfm` (EPUB, 474 pages): fix script erroneously matched it
  (ENOENT guard race); pages reverted back to `474` immediately

---

## 2026-02-21 - Feat: Server-side A5 Page Count for EPUB/MOBI/AZW at Upload

### Summary

Implemented server-side estimation of A5-format page counts for EPUB, MOBI, AZW, and AZW3 files. The count is written to `storage.meta.pages` and `storage.tags.pages` at upload time, matching how PDF page counts are stored, so it displays in the gallery without any further client changes.

### Changed Files

- **`lib/meta.js`**

---

## 2026-02-21 - Improvement: new /favicon directory and asset switching

### Summary

The repository now includes a `/favicon` directory containing multiple
icon sizes and a webmanifest. The application serves this folder at
`/favicon/*` and routes `/favicon.ico` to that directory. All
references to the legacy root-level `favicon.png`/`favicon.ico` have
been updated accordingly in templates, CSS, and JS.

### Files Modified

- **`views/head.ejs`** — replaced single `/favicon.png` link tags with a
  complete set of `<link>` entries pointing into `/favicon/` and added
  manifest/shortcut entries.
- **`entries/css/room.css`** — `.kf` background now uses
  `/favicon/favicon-16x16.png`.
- **`client/roomie.js`** — icon property changed to
  `/favicon/favicon.ico`.
- **`lib/httpserver.js`** — mounted express static middleware on `/favicon`
  and added explicit `/favicon.ico` handler; preserved old static root
  as fallback.

### Testing

Rebuilt and restarted the server; verified `curl -I` returns 200 for
`/favicon/favicon-32x32.png` and `/favicon.ico`. The gallery and room UI
should continue to display the key icon correctly.

### Notes

The old `static/favicon.png` and symlink remain for compatibility but are
no longer referenced by templates. They can be removed in a future cleanup.

### Future

Consider pruning obsolete root-level favicon files once rollout completes.

### Changed Files

- **`lib/meta.js`**
  - `extractMobiCoverNative(filePath, buf = null)` — updated signature to accept an optional pre-read buffer, avoiding a second `readFile` call when the caller already has the buffer loaded.
  - `countEpubPages(filePath)` — new function; JSZip-based OPF spine walk, HTML tag strip, sums chars across all chapters, returns `Math.round(total / 1600)`.
  - `countMobiPages(buf)` — new function; reads PalmDoc `text_length` from record-0 bytes 4–7 (`buf.readUInt32BE(r0Start + 4)`), returns `Math.round(textLength / 1600)`.
  - `generateAssetsEpubMobi` — loads MOBI buffer once (reused for both cover extraction and page count); calls `countEpubPages` or `countMobiPages`; writes `storage.meta.pages` + `storage.tags.pages` only when not already set by exiftool. No-cover guard changed to call `addAssets([])` before returning so page count is persisted even for books without embedded cover art.
- **`CHANGELOG.md`** — added A5 page count bullet to v1.1.0 Added section.

---

## 2026-02-21 - Fix: MOBI PalmDB Parser — Wrong first_image_record Offset (56 → 92)

### Root Cause

The `extractMobiCoverNative` function read `first_image_record` from MOBI header offset **+56**, which is actually the `extra_index_4` field (0xFFFFFFFF in most files). The correct offset is **+92**:

| Offset   | Field                                                     |
| -------- | --------------------------------------------------------- |
| +0       | "MOBI" magic                                              |
| +4       | header length                                             |
| +8       | Mobi type                                                 |
| +12      | text encoding                                             |
| +16      | unique ID                                                 |
| +20      | file version                                              |
| +24..+60 | 6 index fields (ortho, inflection, names, keys, extra0–3) |
| +64      | first non-book record                                     |
| +68      | full name offset                                          |
| +72      | full name length                                          |
| +76      | language                                                  |
| +80      | input language                                            |
| +84      | output language                                           |
| +88      | min version                                               |
| **+92**  | **first_image_record** ← correct                          |

Because offset +56 always returned 0xFFFFFFFF, `firstImageRecord` hit the sentinel guard and `extractMobiCoverNative` returned `null` for every file.

### Fix

- `lib/meta.js` `extractMobiCoverNative`: changed `mobiOff + 56` → `mobiOff + 92`; bumped minimum header-length guard from 68 → 96.
- Retroactively generated `.cover.jpg` for all 5 existing MOBI uploads.

---

## 2026-02-21 - Fix: MOBI/AZW/AZW3 Cover Extraction via Native PalmDB Parser

### Root Causes

1. **exiftool `-b -CoverImage` for MOBI returns an integer offset, not image bytes.** The value (e.g. `"2"`) was rejected by the `>= 100` bytes check and silently discarded every time.
2. **AZW/AZW3 files were not matched by any type check.** exiftool reports `FileType = "AZW3"` for AZW3 files, which never matched any `=== "MOBI"` guard in `previewable`, `generateAssets`, or `generateAssetsEpubMobi`.

### Fix

Implemented `extractMobiCoverNative(filePath)` — a pure Node.js PalmDB binary parser:

- Reads `numRecords` at `buf[76:78]` (BE 16-bit) and builds the record offset list from `buf[78 + i*8]`.
- Finds the `MOBI` magic (0x4D4F4249) in record 0.
- Reads `mobiHeaderLen` at `mobiOff + 4`, `firstImageRecord` at `mobiOff + 56` (calibre-documented).
- Scans EXTH records starting at `mobiOff + mobiHeaderLen` for type 201 (CoverOffset integer).
- Extracts the image record at `firstImageRecord + coverOffset` and validates JPEG/PNG/GIF/BMP magic.

### Changed Files

- `lib/meta.js`: Added `extractMobiCoverNative()` function; updated `generateAssetsEpubMobi` to use it via `isMobiFamily` check; extended `generateAssets` routing for AZW/AZW3; added `"AZW"`, `"AZW3"` to `DOC_TYPES`.
- `lib/upload.js`: Added `mtype === "AZW"` and `mtype === "AZW3"` to `previewable` gate.
- `CHANGELOG.md`: Updated v1.1.0 cover-thumbnails bullet to document native extraction and AZW/AZW3 support.

---

## 2026-02-21 - Release: v1.1.0 pushed to origin

### Summary

Committed and pushed `276772d` to `origin/main`. All five source files staged; `ops.log` and `server.log` intentionally excluded.

### Changed Files

- `lib/upload.js`: EPUB/MOBI added to `previewable` gate
- `lib/meta.js`: `sharp(...).limitInputPixels()` instance-method bug fixed (both EPUB/MOBI and audio paths); all `[COVER-DBG]` instrumentation removed
- `client/files/gallery.js`: no-cover branch now uses `new Image()` swap
- `CHANGELOG.md`: v1.1.0 updated with A5 pagination, cover thumbnails, gallery stale-cover fix
- `README.md`: corrected feature bullet and "Important distinction" note — EPUB/MOBI covers are server-side, not client-side

## 2026-02-21 - Fix: sharp().limitInputPixels() Not a Function — EPUB/MOBI Cover Broken

### Root Cause

`lib/meta.js` was calling `.limitInputPixels(Math.pow(8000, 2))` as a **chained instance method** on the sharp pipeline in `generateAssetsEpubMobi` (EPUB/MOBI cover) and `generateAssetsAudio` (audio artwork). In sharp 0.31.3 (the installed version), `limitInputPixels` is **not** an instance method — it is a **constructor option** (e.g. `sharp(input, { limitInputPixels: N })`). This caused a `TypeError: sharp(...).limitInputPixels is not a function` exception every time a cover was extracted, silently preventing any `.cover.jpg` from being written.

The existing PDF and image pipelines in the same file already used the correct constructor-option form (`sharp(prev, { limitInputPixels: PIXEL_LIMIT })`), so only the EPUB/MOBI and audio paths were broken.

The bug was uncovered by adding detailed `[COVER-DBG]` instrumentation (also note: `console.debug` is suppressed at the default `info` log level — instrumentation had to use `console.info`).

### Changed Files

- `lib/meta.js`: In `generateAssetsEpubMobi`, replaced `sharp(coverBinary).limitInputPixels(...)` with `sharp(coverBinary, { limitInputPixels: Math.pow(8000, 2) })`. Same fix applied to `generateAssetsAudio`.

## 2026-02-21 - Fix: EPUB/MOBI Cover Extraction + Gallery Stale Cover

### Root Cause

**Cover extraction never triggered**: In `lib/upload.js`, the `previewable` IIFE gated all calls to `generateAssets()`. The condition only checked for `PDF`, `image/`, `video/`, and `audio/` types — `EPUB` and `MOBI` were missing. As a result, `generateAssets()` (which calls `generateAssetsEpubMobi()` → `extractEpubCover()` / exiftool for MOBI) was never invoked after upload, and no `.cover.jpg` was ever written for any EPUB or MOBI file.

**Gallery stale cover**: In `client/files/gallery.js`, the `open()` no-cover branch only ran `this.imgEl.src = ""`. This cleared the `src` attribute but left `srcset`/`sizes` in place and did not swap out the existing DOM element, so the browser continued to display the previously loaded cover image. The fix replaces `this.imgEl` with a fresh `new Image()` element (same `id`), inserted via `replaceChild()`, which guarantees no residual attributes or cached source.

### Changed Files

- `lib/upload.js`: `previewable` IIFE — added `mtype === "EPUB" || mtype === "MOBI"` so `generateAssets()` is called for book uploads, triggering cover extraction
- `client/files/gallery.js`: `open()` no-cover `else` branch — replaced `this.imgEl.src = ""` with `new Image()` swap via `replaceChild()` to fully clear the previous cover

> **Note**: EPUB/MOBI files uploaded before this fix will not have covers retroactively. Only newly uploaded files will trigger extraction.

## 2026-02-21 - AGENTS.md: Shared Redis + Dicefiles Server Policies

### Motivation

Multiple AI agents share the same Redis instance and Dicefiles server. An agent blindly starting Redis risks colliding with the existing OS-managed service; an agent blindly starting the Node server risks running a second instance on the same port, causing confusion about which instance is serving requests.

### Changed Files

- `AGENTS.md`: **Strict Server Startup Procedure** updated to check port 9090 before any start/restart; added **Shared Redis Policy** (never `redis-server`, verify with `redis-cli ping`, only `systemctl restart redis` if truly down, no FLUSHALL); added **Shared Dicefiles Server Policy** (always `ss -ltnp | grep 9090` first, only restart after a fresh build, never start a second instance)

## 2026-02-21 - Book Reader: Fix Pagination + Confirm Cover Extraction

### Root Cause / Motivation

**Pagination bug**: `#pgwrap + display:inline-block + column-fill:auto` was used to detect total pages via `offsetWidth`, but this measurement is unreliable — the element does not expand horizontally as expected inside an `overflow:hidden` iframe body. Consequently `_totalPagesInChapter` always stayed at 1, so every Left/Right key press immediately wrapped to the next/previous chapter.

**Cover extraction**: Already implemented in `lib/meta.js` from a prior session — `extractEpubCover()` uses jszip (server-side Node.js) to parse the OPF manifest and extract the cover-image, and exiftool is used for MOBI/AZW. No additional changes needed.

### Approach (Pagination Fix)

Replaced horizontal CSS-columns pagination with a vertical `translateY` approach:

- `buildSrcdoc` now renders content inside `#scroller` (natural height, no columns), with the iframe body set to `overflow:hidden` at `pageWidth × pageHeight`.
- After the iframe `load` event, `scroller.offsetHeight` is measured; `totalPages = ceil(height / pageHeight)`. This is reliable.
- Navigation: `scroller.style.transform = translateY(-pageIdx * pageHeight)` — one translateY = one page.
- Added `_loaded` boolean flag: `nextPage()`/`prevPage()` are no-ops until the iframe has fired `load`, preventing the "immediate chapter skip" bug caused by `_totalPagesInChapter === 1` before measurement.
- Going backwards to last page (-1): resolved inside the `load` handler once total pages is known.

### Changed Files

- `client/files/reader.js`: `buildSrcdoc` replaced (CSS columns → `#scroller` + `overflow:hidden`); `BookReader` fields (`_loaded`); `_renderChapter` measures `scroller.offsetHeight` and sets `_loaded = true` in `load` handler; `_scrollToPage` targets `#scroller` via `translateY`; `nextPage`/`prevPage` guard with `if (!this._loaded) return`

## 2026-02-21 - Doc/Dep Sync: Replace epubjs with jszip + @lingo-reader/mobi-parser

### Root Cause

`epubjs` was still listed in `package.json` and documented in `README.md` even though it was replaced in the previous session by native JSZip + `@lingo-reader/mobi-parser` parsing. Documentation and dependency declarations were stale.

### Changed Files

- `package.json`: removed `epubjs ^0.3.93`; added `jszip ^3.10.1` as a direct dependency (previously only available transitively through epubjs)
- `README.md`: updated Features bullet, User-Facing section, ePub reader section (now describes native JSZip parsing), added new MOBI/AZW/AZW3 reader section, replaced npm packages table (`epubjs` → `jszip` + `@lingo-reader/mobi-parser`), updated the preview-tooling note
- `AGENTS.md`: added **Dependency & Documentation Sync** rule — whenever a dep is added/removed/replaced, `package.json`, `README.md`, and `DEVELOPMENT_LOG.md` must all be updated in the same response

## 2026-02-21 - Book Reader: A5 Page Pagination (EPUB + MOBI)

### Motivation

The existing `BookReader` rendered each chapter as a single scrolling iframe. The user requested book-like A5 pagination: Left/Right arrow keys (and prev/next buttons) scroll between pages within a chapter; PageUp/PageDown change chapters.

### Approach

- **CSS columns pagination**: `buildSrcdoc` now wraps chapter HTML in `#pgwrap` (`display: inline-block; column-width: <pageWidth>px; column-fill: auto`) so content automatically flows into horizontal A5-sized columns. `#pgwrap` is `inline-block` so it expands to `numPages × pageWidth` — its `offsetWidth` after the `load` event gives the total page count.
- **Page navigation**: CSS `transform: translateX(-pageIdx * pageWidth)` on `#pgwrap` reveals one page at a time without scrollbars. The outer `#reader-content` uses `overflow: hidden; align-items: center; justify-content: center` to center the fixed-size A5 iframe.
- **A5 sizing**: `_computePageSize()` fits one A5 page (148:210 ratio) inside the container — height-constrained if wider than A5, width-constrained if narrower.
- **Chapter wrapping**: `nextPage()` / `prevPage()` wrap to the next/prev chapter at chapter boundaries. `nextChapter()` / `prevChapter()` jump chapters directly.
- **`box-decoration-break: clone`** on `#bc` repeats per-column padding in every column fragment.
- **Key bindings**: Left/Right = page; PageUp/PageDown = chapter (PDF keys unchanged).
- **Buttons**: prev/next toolbar buttons call `_bookPage()` (page nav).

### Changed Files

- `client/files/reader.js`: `buildSrcdoc` rewritten with CSS-columns `#pgwrap`/`#bc` layout; `BookReader` rewritten with `_computePageSize`, `_renderChapter(idx, startAtPage)`, `_scrollToPage`, `nextPage`, `prevPage`, `nextChapter`, `prevChapter`; `Reader._book` replaced with `_bookPage` + `_bookChapter`; `_onKey` updated for new key bindings
- `entries/css/reader.css`: `.reader-book-iframe` changed to fixed-size block (no flex-fill); `#reader-content:has(.reader-book-iframe)` adds `align-items/justify-content: center`
- `client/file.js`: `getReadableType()` MOBI branch returns `"mobi"` (was `"epub"`)

## 2026-02-21 - EPUB + MOBI: Native Client-Side Rendering (Drop epubjs + calibre)

### Root Cause / Motivation

epubjs rendered via a sandboxed iframe causing console warnings; MOBI required a slow server-side calibre conversion (`ebook-convert`) that introduced latency and complexity. The user requested truly native rendering of both formats in the reader canvas, without external tools or intermediate conversion steps.

### Approach

Both EPUB and MOBI are now parsed and rendered entirely in the browser, chapter by chapter, with no server-side preprocessing:

- **EPUB**: `JSZip` (already available as a transitive dependency) parses the EPUB ZIP client-side. The OPF manifest is extracted with a regex scanner; spine items are loaded in order. CSS `url()` references and `<img src>` attributes are replaced with `blob:` URLs so all assets render locally without additional requests.
- **MOBI**: `@lingo-reader/mobi-parser` (browser build at `dist/index.browser.mjs`) is dynamically imported. It accepts a `Response` object from `fetch()`, parses the binary MOBI format using `fflate`, and returns `{ html, css: [{href}] }` per chapter where all image resources are already `blob:` URLs.
- Both formats render into a **sandboxless `<iframe srcdoc>`** (no `sandbox` attribute → no browser warnings) with base dark-reader styles injected.

### Changed

- `client/files/reader.js` — `getReadableType()`: MOBI now returns `"mobi"` (was `"epub"`), enabling separate code paths.
- `client/files/reader.js` — Removed `EpubReader` class (epubjs).
- `client/files/reader.js` — Added `epubResolve()`, `zipFile()`, `zipToBlob()`, `extMime()`, `parseEpubChapters()`, `buildSrcdoc()` helpers and `BookReader` class with `open(url, type)`, `next()`, `prev()`, `destroy()`.
- `client/files/reader.js` — `Reader`: `_epub()` → `_book()`; prev/next buttons now shown for both `epub` and `mobi` types; `open()` uses `BookReader` for both; `_onKey()` uses `nukeEvent` for book arrow keys too.
- `entries/css/reader.css` — Replaced `.reader-epub-wrap` + `.reader-epub-wrap iframe` with `.reader-book-iframe`; added `#reader-content:has(.reader-book-iframe)` rule to remove padding/scroll when a book is open.
- `lib/meta.js` — Removed `convertMobiToEpub()` function; reverted MOBI branch in `generateAssetsEpubMobi()` to cover-extraction-only (exiftool). Removed from `module.exports`.
- `lib/upload.js` — Removed `convertMobiToEpub` import; reverted `serve()` asset lookup to the simple original form (no on-demand conversion fallback).
- `client/file.js` — Removed `readableUrl` property (no longer needed since format dispatch happens client-side).

---

## 2026-02-21 - MOBI Reader: Convert to EPUB Server-Side via ebook-convert

### Root Cause

epubjs parses EPUB files as ZIP archives. MOBI/AZW files are a completely different binary format — not ZIP-based — so epubjs fails to build a spine for them. The rendition was created but `this.location` was never set, causing `rendition.next()` to crash with `TypeError: Cannot read properties of undefined (reading 'next')` on every arrow-key press.

### Changed

- `lib/meta.js` — Added `convertMobiToEpub(storage)` function: runs `ebook-convert <mobi> <hash>.converted.epub` (calibre), then registers the output as a `.converted.epub` asset using `storage.addAssets()` with the `file:` property (no buffer copy needed since ebook-convert already writes to the correct path). Safe to call on already-converted files.
- `lib/meta.js` — `generateAssetsEpubMobi()`: MOBI branch now calls `convertMobiToEpub(storage)` before (and independently of) cover extraction, so conversion runs even when no cover image is present.
- `lib/meta.js` — Exported `convertMobiToEpub` in `module.exports`.
- `lib/upload.js` — Imported `convertMobiToEpub`. In `serve()`, renamed inner `asset` to preserve the string key (`assetKey`) before it is replaced by the resolved object, and added on-demand conversion fallback: if `assetKey === ".converted.epub"` and `storage.meta.type === "MOBI"`, triggers `convertMobiToEpub(storage)` once (result is cached in assets), allowing previously-uploaded MOBI files to work without re-upload.
- `client/file.js` — `init()`: computes `this.readableUrl`. For MOBI files that have a `.converted.epub` asset, `readableUrl = href + ".converted.epub"`. All other files fall back to `this.url`.
- `client/files/reader.js` — `Reader.open()`: EPUB renderer now calls `EpubReader.open(file.readableUrl || file.url)` so MOBI files are opened via the converted asset URL.

---

## 2026-02-21 - EPUB Reader: Remove Iframe Sandbox Warning

### Root Cause

epubjs creates an `srcdoc` iframe with `sandbox="allow-scripts allow-same-origin"`. Browsers emit a security advisory for this combination on every section render (repeated warnings in DevTools console). The epub content is served from our own origin so the sandbox provides no meaningful protection here.

### Changed

- `client/files/reader.js` — added `rendition.on("rendered", ...)` handler that calls `view.iframe.removeAttribute("sandbox")` immediately after epubjs creates each iframe. This eliminates the browser warning while preserving full script and same-origin access for epub content.

---

## 2026-02-21 - PDF Reader: A5 Page Format + Arrow Key Page Navigation

### Changed

- `client/files/reader.js` — `PDFReader` constructor: added `_pageHeight` and `_currentPageNum` to property list.
- `client/files/reader.js` — `PDFReader.open()`: scale computation now enforces A5 proportions (148 × 210 mm). Page display width is `min(containerWidth - 32, containerHeight × 148/210)` so each page fits vertically in the viewer without scrolling — one page = one viewport.
- `client/files/reader.js` — `PDFReader._trackVisible()`: sets `this._currentPageNum` when a page enters the viewport, keeping it in sync during manual scroll.
- `client/files/reader.js` — `PDFReader.setZoom()`: saves `_currentPageNum` before rebuilding placeholders, restores scroll position via `scrollToPage(savedPage, "instant")` in `requestAnimationFrame` after rebuild.
- `client/files/reader.js` — `PDFReader`: added `scrollToPage(pageNum, behavior)`, `prevPage()`, `nextPage()` methods. `scrollToPage` uses `container.scrollTo({ top: wrapper.offsetTop })` to jump directly to a page without touching IntersectionObserver.
- `client/files/reader.js` — `Reader`: added `_pdf(dir)` method (mirrors `_epub(dir)`). `_onKey` now calls `_pdf("prev"/"next")` for PDF mode on ArrowLeft/Up and ArrowRight/Down instead of routing to epub.
- `entries/css/reader.css` — `.reader-page-wrap`: added `align-self: center` so A5-sized pages (narrower than the full container width) are centered horizontally.

## 2026-02-21 - EPUB Reader: Iframe Sandbox + CSP blob: + Cover Extraction Fix

### Root Cause / Problems Fixed

**epub.js iframe "allow-scripts" missing:** epub.js renders EPUB content into an `iframe` using `srcdoc`. By default, that iframe had only `allow-same-origin` in its sandbox attribute — no `allow-scripts`. This blocked all script execution inside the iframe, preventing epub.js from injecting its chapter renderer and stylesheet. Fix: added `allowScriptedContent: true` to the `book.renderTo()` options, which causes epub.js to add `allow-scripts` to the iframe sandbox.

**Blob: stylesheet blocked by CSP:** epub.js generates internal stylesheets as `blob:` URLs and loads them via `<link>` tags inside the iframe. The server CSP header had no explicit `style-src` or `style-src-elem` directive, so it fell back to `default-src 'self' 'unsafe-inline'` which does not allow `blob:`. Fix: added explicit `style-src 'self' 'unsafe-inline' blob:` and `style-src-elem 'self' 'unsafe-inline' blob:` directives to the CSP header in `lib/httpserver.js`.

**EPUB cover extraction used wrong exiftool tag:** The `exiftool -b -CoverImage` command works for MOBI/AZW (which embed the cover as a raw binary record), but EPUBs are ZIP files — exiftool reads their OPF metadata but cannot extract binary cover images via `-CoverImage`. Fix: replaced the unified exiftool-based function with type-specific paths: EPUB cover is extracted by reading the ZIP with `jszip`, parsing `META-INF/container.xml` to find the OPF, parsing the OPF manifest for EPUB3 `properties="cover-image"` or EPUB2 `<meta name="cover">`, then extracting that image file from the ZIP. MOBI continues to use `exiftool -b -CoverImage`.

### Changed Files

- `client/files/reader.js` — `EpubReader.open()`: added `allowScriptedContent: true` to `book.renderTo()` options so the epub.js iframe gets `allow-scripts` in its sandbox attribute.
- `lib/httpserver.js` — CSP header: added `style-src 'self' 'unsafe-inline' blob:` and `style-src-elem 'self' 'unsafe-inline' blob:` directives to allow epub.js blob: stylesheet URLs.
- `lib/meta.js` — replaced `generateAssetsEpubMobi()` with a type-split implementation: EPUB cover extracted via `jszip` + OPF parsing (supports both EPUB2 and EPUB3 cover conventions); MOBI cover via `exiftool -b -CoverImage` (unchanged). Added `extractEpubCover()` helper function.

## 2026-02-21 - EPUB/MOBI: Gallery Cover + Read Now + Reader Support

### Root Cause / Problems Fixed

**EPUBs and MOBIs downloaded directly instead of opening gallery:** `getGalleryInfo()` in `client/files/file.js` checked `!this.assets.size` and returned `null` when no preview assets existed. EPUBs/MOBIs never had server-generated preview images, so clicking any EPUB/MOBI file bypassed the gallery entirely and triggered a browser download.

**No cover image extraction for EPUB/MOBI:** `generateAssets()` in `lib/meta.js` only handled PDF (via GraphicsMagick) and media files. EPUB and MOBI files were silently skipped with no preview generated.

**MOBI not recognized as readable:** `getReadableType()` (both in `client/file.js` and the local helper in `client/files/reader.js`) only matched PDF and EPUB extensions/types. MOBI/AZW/AZW3 files were treated as plain documents (no "Read Now" button).

**Loader.png flash on no-cover gallery open:** Gallery `open()` had no `else` branch after the `if (info.img) / else if (info.video)` block. For readable docs without cover assets, the 60ms timer fired and replaced the empty imgEl with `/loader.png`, producing a visible flash.

### Changed Files

- `lib/meta.js` — added `generateAssetsEpubMobi()`: extracts embedded cover image via `exiftool -b -CoverImage`, processes through sharp (resize 400×600 inside, JPEG 75%), saves as `.cover.jpg` asset. Called from `generateAssets()` for `meta.type === "EPUB"` or `"MOBI"`.
- `lib/upload.js` — `serve()` MIME fallback: added `.mobi` / `.azw` / `.azw3` → `application/x-mobipocket-ebook` alongside existing PDF/EPUB fallbacks.
- `client/file.js` — `getReadableType()`: added MOBI/AZW/AZW3 case returning `"epub"` (best-effort rendering via epub.js).
- `client/files/reader.js` — local `getReadableType()` helper: same MOBI/AZW/AZW3 addition.
- `client/files/file.js` — `getGalleryInfo()`: split the `type === "audio" || !assets.size` guard into two; when `!assets.size` but `getReadableType()` returns a truthy type, return `{ infos, noCover: true }` so the gallery opens with title + "Read Now" button even without a cover image.
- `client/files/gallery.js` — `open()`: added `else` branch after `if (info.img) / else if (info.video)` that calls `clearTimeout(to)` and resets `imgEl.src = ""` to prevent the loader.png flash when opening a readable doc without a cover image.

## 2026-02-21 - Files: Fix insertFilesIntoDOM querySelector Scope Regression

### Root Cause

`insertFilesIntoDOM()` in `client/files.js` used `document.querySelector(".file:not(.upload)")` to find the first existing file row as an insert anchor. After the links panel was added, `#links` also contains `.file` elements. With a link present, `document.querySelector` returned a `.file` from `#links` instead of `#files`. The subsequent `this.el.insertBefore(f.el, head)` then threw `NotFoundError` ("the node before which the new node is to be inserted is not a child of this node"), breaking all file rendering and uploads.

`clear()` had the same broad scope — it found link rows and tried `this.el.removeChild()` on them, silently catching the errors, but it was wasteful.

### Changed Files

- `client/files.js` — `insertFilesIntoDOM()`: changed `document.querySelector(".file:not(.upload)")` → `this.el.querySelector(...)` so it searches only inside `#files`. `clear()`: same scope fix `document.querySelectorAll` → `this.el.querySelectorAll`.

## 2026-02-21 - Links Panel: Column Layout Redesign + Grey Filter Fix

### Root Cause / Problems Fixed

**Grey filter on links panel:** `body.empty #filelist { opacity: 0.3 }` was being applied when links mode was active. Because `#files` is hidden in links mode with no visible children, `body.empty` was set, causing `#filelist` (and everything inside including `#links`) to be dimmed to 30% opacity. Fix: added `body.links-mode #filelist, body.links-mode #filelist-scroller { opacity: 1 !important }` to override the empty-state dimming.

**Column layout:** The previous layout had name, then a detail column containing both the URL and age side by side. User requested: (1) link name + URL as a single stacked column, (2) uploader pill, (3) age only.

### Changed Files

- `client/links.js` — `createLinkElement()`: wrapped `name-text` + `file-new-pill` in a `.name-primary` flex row, added `.url-sub` span as a second line inside `.name`. Removed `.url-display` from `.detail`, leaving only `.ttl` (age).
- `entries/css/files.css` — `.name` column changed to `flex-direction: column` with `.name-primary` inner row. Added `.url-sub` style (subtle, truncated, uses `--detail-size`). Simplified `.detail` to `width: 72px` (age only), removed old `.detail > span` and `.url-display` rules. Updated `#links-header .lh-detail` width to match (72px). Added `body.links-mode #filelist/filelist-scroller { opacity: 1 !important }` grey-filter override.
- `views/room.ejs` — Column header `.lh-detail` label changed from "URL & Age" to "Age".

## 2026-02-21 - PDF Reader: Flexbox Collapse Fix + Accurate Placeholder Height

### Root Cause / Problems Fixed

**PDF pages invisible despite "rendered OK":** Debug instrumentation (added in prior session) revealed `scrollHeight = 3086` for 255 pages, when 255 × 1100px placeholder should give ~281,000px. Root cause: `#reader-content` is a `display: flex; flex-direction: column` container with a fixed height (802px via `flex: 1 1 0`). Default `flex-shrink: 1` on the `.reader-page-wrap` children caused the flexbox layout algorithm to shrink all 255 wrappers proportionally to fit within 802px. Each wrapper collapsed to ~12px. With `overflow: hidden` on the wrapper, the 1488px-tall canvas inside each was clipped to invisible. Because all 255 wrappers were ~12px, the IntersectionObserver with `rootMargin: "300px"` fired for pages 1-91 simultaneously, confirming collapsed layout.

**Inaccurate placeholder height:** Placeholder used hardcoded `1100px` (approx A4 at scale 1.4) instead of the actual computed page height, causing layout shift and early IntersectionObserver misfires.

### Changed Files

- `entries/css/reader.css` — added `flex-shrink: 0` to `.reader-page-wrap` to prevent flexbox from collapsing page wrappers to fit the container height.
- `client/files/reader.js` — `PDFReader.open()`: compute `this._pageHeight = Math.ceil(naturalViewport.height * this.scale)` alongside scale; `_buildPagePlaceholders()` now uses `this._pageHeight || 1100` so placeholder heights match actual rendered page dimensions.

## 2026-02-21 - Links Panel: Pill Exclusivity + Sync Fix + F5 Restore Nail Buttons

### Root Cause / Problems Fixed

**Pill not mutually exclusive (confirmed bug):** When `linkMode()` activated the Links button, it added `active` to `#linkmode` but did NOT remove `active` from `#nailoff` / `#nailon`. Both nail buttons and the Links button appeared "active" at the same time. Conversely, clicking Links a second time (toggle off) restored the file view but didn't re-add `active` to the correct list/gallery nail button — the pill ended up with nothing highlighted.

**F5 restore nail bleed:** The `#nailoff` button starts with `active` in the HTML. On F5 restore when `links` mode was persisted, `links.init()` restored links mode but did not remove `active` from `#nailoff`, so both buttons appeared active after reload.

**Dynamic import complexity:** `files.js` called `import("./links").then(...)` (async webpack dynamic import) to reach `links.show()` / `links.hide()`. Since `registry.links` is the same singleton instance (set synchronously in the first registry pass, before any `init()` runs), the dynamic import was unnecessary indirection with no benefit.

**No links in Redis:** After the previous session's LINK_OFILTER fix, the Redis store was empty — no links had been created since that fix was applied. A test link was seeded directly into `map:links:links` (roomid `73HW2DR3XX`, `https://example.com`) so the display pipeline could be verified end-to-end.

### Changed Files

- `client/files.js` — `linkMode()`: now removes `active` from `nailOffEl` / `nailOnEl` when activating links mode; when deactivating, restores `active` on the correct nail button (`nailOnEl` if gallery mode, otherwise `nailOffEl`). Both `linkMode()` and `applyViewMode()` now call `registry.links.show()` / `registry.links.hide()` synchronously instead of via async dynamic import.
- `client/links.js` — `init()` restore path now also calls `registry.files.nailOffEl.classList.remove("active")` and `nailOnEl.classList.remove("active")` when restoring links mode on F5, so only the Links button is active after reload.

## 2026-02-21 - Correct MIME Types for PDF and EPUB Uploads

### Root Cause

`lib/meta.js` assigned `mime: "application/octet-stream"` to all `DOC_TYPES` files (PDF, EPUB, DOCX, etc.) because the classification branch only checked the type category, not the specific type. While PDF.js validates file content by magic bytes rather than MIME, some versions of epub.js and certain browser fetch policies do use the `Content-Type` header. More importantly, serving `application/octet-stream` for PDFs causes browsers to trigger a download rather than allow inline viewing in other contexts, and is generally incorrect.

Additionally, files already uploaded before this fix had `application/octet-stream` stored in Redis — the serve path needed a runtime fallback to infer correct MIME from the filename extension for those existing files.

### Changed Files

- `lib/meta.js` — `DOC_TYPES` branch now assigns `application/pdf` for PDF and `application/epub+zip` for EPUB (all other doc types keep `application/octet-stream`). Applies to newly uploaded files.
- `lib/upload.js` — `serve()` function: added runtime fallback that upgrades `application/octet-stream` to the correct MIME based on filename extension (`.pdf` → `application/pdf`, `.epub` → `application/epub+zip`) for existing files whose metadata was stored before the correct MIME detection was in place. No webpack rebuild needed (server-side only).

## 2026-02-21 - PDF Worker: Cache-Bust URL to Fix Stale CSP

### Root Cause

`pdf.worker.js` is served with `Cache-Control: public, max-age=2592000, immutable`. Chrome applies **the worker script's own cached response headers** as the worker's CSP context — it does not re-evaluate the parent document's headers. The browser had cached the old `pdf.worker.js` response (from before `'unsafe-eval'` was added to the server CSP), so the worker ran with the old cached CSP that lacked `unsafe-eval`. PDF.js's `isEvalSupported` check (`new Function("")`) then threw a SecurityError, and PDF.js logged the warning: _"Note that 'script-src' was not explicitly set, so 'default-src' is used as a fallback."_

Adding `script-src 'unsafe-eval'` to the server header was correct but insufficient — cache invalidation was required.

### Fix

Append the build version hash (`window.__CV__`) to the `pdf.worker.js` URL so the browser considers it a new resource when the build changes, fetching fresh with the current response headers. The version is exposed as `window.__CV__` in `room.ejs` inline script (reusing the same `v` variable already used for `client.js?v=<hash>`).

### Changed Files

- `views/room.ejs` — added `<script>window.__CV__="<%- v %>";</script>` before the client script tag to expose the build hash as a JS global.
- `client/files/reader.js` — changed `PDF_WORKER_SRC` from `/pdf.worker.js` to `/pdf.worker.js?v=${window.__CV__ || "1"}` so the worker URL changes on each build, busting the immutable cache entry.

## 2026-02-21 - CSP: Add script-src with unsafe-eval for PDF.js Worker

### Root Cause

The server CSP header had `default-src 'self' 'unsafe-inline'` but no explicit `script-src`. Browsers fall back to `default-src` for scripts, which lacks `'unsafe-eval'`. The PDF.js web worker (`pdf.worker.js`) uses `eval()` internally for rendering PostScript/Type4 color-space functions (triggered when processing images with embedded PostScript). This caused the browser to block the eval call and log: _"Note that 'script-src' was not explicitly set, so 'default-src' is used as a fallback."_ Affected PDFs would render blank or partial pages for pages containing those image types.

### Changed Files

- `lib/httpserver.js` — Added explicit `script-src 'self' 'unsafe-inline' 'unsafe-eval'` to the `Content-Security-Policy` header. The `'unsafe-eval'` token is required for the PDF.js worker's PostScript renderer. No webpack rebuild needed (server-side change only).

## 2026-02-21 - Fix Tooltip Tag CSS Class With Spaces

### Root Cause

`addTag(value, tag)` in `client/file.js` used the raw tag name directly as a CSS class suffix: `` `tooltip-tag-${tag}` ``. When `tag` contains spaces (e.g. `"suggested tags"`), `classList.add("tooltip-tag-suggested tags")` threw `InvalidCharacterError` because the space is interpreted as a class separator.

### Fix

Introduced `tagClass = tag.replace(/\s+/g, "-").toLowerCase()` and used `tagClass` in both `tooltip-tag-${tagClass}` class strings, while keeping the original `tag` string for the `tag === "user"` role-class logic and label generation.

### Changed Files

- `client/file.js` — `addTag()`: derived `tagClass` from `tag` by replacing whitespace with `-` before applying it as a CSS class name suffix.

## 2026-02-21 - Fix Links Creation + Links as Third View Mode

### Root Causes / Bugs Fixed

- **`Link.create` always threw `TypeError: set.values is not a function`** — `ofilter(o, set)` in `common/index.js` calls `set.values()`, expecting a proper `Set` instance. However `LINK_OFILTER` in `lib/links.js` was defined as a plain object `{id: true, roomid: true, …}` rather than `new Set([…])`. Every time a chat link was posted, `Link.prototype.toJSON()` was called inside `LINKS.set()`, which triggered `ofilter(this, LINK_OFILTER)` → crash. Links never persisted to Redis, and therefore `getlinks` responses were always empty. Fix: converted `LINK_OFILTER` to `new Set(["id", "roomid", …])`.
- **`#links-toggle` was a standalone toggle** — replaced with `#linkmode` as the 3rd button in the viewmode pill (List | Gallery | Links). Mode persisted to localStorage alongside list/gallery so F5 restores the links view. The `_pendingLinksRestore` flag bridges the init-order gap (files.init runs before links.init) so the restore applies correctly after links handlers are registered.

### Changed Files

- `lib/links.js` — Changed `LINK_OFILTER` from plain object to `new Set([...])` so that `ofilter()` can call `.values()` on it. This was the root cause of all link creation failures.
- `client/links.js` — Removed standalone `#links-toggle` click handler and `ontoggle()` method. Added `show()`/`hide()` public methods (DOM-only, no button state). `init()` now checks `registry.files._pendingLinksRestore` and activates links mode if set. Removed `setToggleBtn()` helper (unused).
- `client/files.js` — Added `linksMode` and `_pendingLinksRestore` boolean properties to constructor. Wired `#linkmode` click → new `linkMode()` method. Extended `applyViewMode()` to deactivate links mode when switching to list/gallery. Added `linkMode()` toggle method. Updated `persistViewMode()` to save `"links"` value. Updated `restoreViewMode()` to handle `"links"` via deferred `_pendingLinksRestore` flag.
- `views/room.ejs` — Removed standalone `#links-toggle` div. Added `#linkmode` with chain SVG as 3rd button inside `.viewmode-pill`. Added `title="List view"` / `title="Gallery view"` tooltips to `#nailoff` / `#nailon`.
- `entries/css/room.css` — Removed `#links-toggle.btn { margin-right: 0.55rem }` rule. Replaced `#links-toggle.btn.active` reference with `#linkmode.btn.active` in the shared active-state rule.

## 2026-02-21 - Fix Passive Wheel Event Warning + Wrong Handler Removal

### Root Causes / Bugs Fixed

- **"Unable to preventDefault inside passive event listener"** — Chrome treats `wheel` events on `document.body` as passive by default (opt-in via the [Permissions Policy](https://www.chromestatus.com/feature/6662647093133312)). Passing bare `true` (capture flag) does not override passiveness. Fix: replaced `true` with `{ passive: false, capture: true }` on both the `addEventListener` and matching `removeEventListener` call.
- **Wheel listener never removed on gallery close** — `close()` called `removeEventListener("wheel", this.onpress, ...)` instead of `this.onwheel`. Because the handler reference didn't match the registered listener, the wheel handler leaked and was never cleaned up, causing duplicate navigation calls and preventing garbage collection. Fix: corrected to `this.onwheel`.

### Changed Files

- `client/files/gallery.js` — `open()`: `addEventListener("wheel", …, { passive: false, capture: true })`. `close()`: corrected handler from `this.onpress` → `this.onwheel` and matched options to `{ passive: false, capture: true }`.

## 2026-02-21 - PDF Rendering Fix + Square Toolbar Buttons

### Root Causes / Bugs Fixed

- **PDF reader rendering blank** — `pdfjs-dist` is a UMD/CJS bundle. webpack 5 wraps CJS modules so the entire `module.exports` API object lands on `.default` of the dynamic import namespace (`await import("pdfjs-dist")`). The previous code accessed `pdfjsLib.GlobalWorkerOptions` and `pdfjsLib.getDocument` directly on the namespace, which were both `undefined`, causing a silent TypeError that prevented the PDF document from loading at all. Fix: `const pdfjsLib = pdfModule.default || pdfModule;` before calling any API, giving correct CJS/ESM interop. (Note: epubjs was already correct because it sets `__esModule: true` and does expose `.default`.)

### Changed Files

- `client/files/reader.js` — `PDFReader.open()`: added `const pdfjsLib = pdfModule.default || pdfModule` CJS interop shim so `GlobalWorkerOptions` and `getDocument` are correctly resolved from the dynamic import.
- `entries/css/reader.css` — all toolbar buttons (`#reader-close`, `.reader-zoom-pill button`, `#reader-download`, `#reader-prev`, `#reader-next`) now use explicit `width: 2.1rem; height: 2.1rem; padding: 0; display: flex; align-items: center; justify-content: center` for consistent square sizing. `border-radius` unified to `7px` for close/download. Prev/Next retain a minimum width for their text labels.

## 2026-02-21 - Reader Polish: Read Now Button, PDF Blank Fix, Download + Zoom Pill

### Root Causes / Bugs Fixed

- **`#gallery` had no `position`** — was `position: static`, so the absolutely-positioned `#gallery_read_now` button anchored to the wrong containing block (the viewport), and `z-index: 2000` was silently ignored. Fix: added `position: relative` to `#gallery`.
- **Read Now tied to `.aux` fade** — the button's opacity was `0` by default and only became `1` when the `.aux` class was active (same as the file-size info overlay). Fix: made `.gallery-read-now` always `opacity: 1; pointer-events: auto`, positioned at `bottom: 4%` of the gallery (bottom 5% of the cover area). The `.aux .gallery-read-now` override was removed.
- **PDF pages blank** — `IntersectionObserver` root was `this.container.parentElement` (`#reader`, `overflow: hidden`, non-scrollable). The IntersectionObserver fires based on scroll in the ROOT element; pages 3+ never triggered because only `#reader-content` scrolls. Also, scale was fixed at 1.4 which could produce canvases wider than the container, causing subtle CSS sizing issues. Fixes: (a) root changed to `this.container` (the scrollable `#reader-content`); (b) scale is now auto-computed from `container.clientWidth / naturalViewport.width` so pages perfectly fill the reader width.
- **Zoom delta** — changed from additive `±0.2` to `±0.25` for more noticeable zoom steps.

### Changes

- `entries/css/gallery.css`: Added `position: relative` to `#gallery`.
- `entries/css/reader.css`: Rewrote `.gallery-read-now` — always visible, `bottom: 4%`, no `.aux` dependency. Replaced individual `#reader-zoom-in/out` rules with `.reader-zoom-pill` (joined pill group). Added `#reader-download` button styles.
- `views/room.ejs`: Wrapped `#reader-zoom-out` / `#reader-zoom-in` in `<div class="reader-zoom-pill">`. Added `<a id="reader-download">` after the pill.
- `client/files/reader.js`: Auto-compute PDF scale from container width. Fixed `IntersectionObserver` root to `this.container` for both lazy-load observer and page-visibility tracker. Added `downloadEl` to `Reader` constructor, `_ondownload()` handler, and `Object.seal` includes it. Zoom delta changed to `±0.25`.

## 2026-02-21 - Streaming PDF / ePub In-Page Reader

### Summary

Implemented an in-page reader for PDF and ePub files. Clicking a document file in gallery mode shows the cover image in the gallery lightbox. A **"Read Now"** button (transparent-black, grey-bordered) appears on the cover overlay for PDF and ePub files. Clicking it opens a full-screen reader that fills the file-list area, streaming the content lazily as the user scrolls.

### Architecture

- **PDF engine**: Mozilla PDF.js (`pdfjs-dist@3.11.174`, Apache-2.0). Streams pages via HTTP Range requests (server already had `acceptRanges: true`). Pages are rendered lazily via `IntersectionObserver` — only pages near the viewport are decoded, everything else is a lightweight placeholder. Zoom in/out re-renders at new scale.
- **ePub engine**: epub.js (`epubjs@0.3.93`, BSD-2). Fetches and parses the epub ZIP client-side. Renders chapters in a sandboxed iframe with dark-theme defaults. Prev/next chapter navigation.
- **Worker**: `pdf.worker.entry.js` added as a webpack entry point, producing `/pdf.worker.js`. Referenced directly at `GlobalWorkerOptions.workerSrc`; no CDN dependency.

### Changes

- `package.json`: added `pdfjs-dist@^3.11.174` and `epubjs@^0.3.93` to dependencies.
- `webpack.config.js`: added `pdf.worker` entry pointing at `pdfjs-dist/build/pdf.worker.entry.js`; produces `static/pdf.worker.js`.
- `client/files/reader.js` (new): `PDFReader`, `EpubReader`, and `Reader` classes. Dynamic imports (`import()`) so the ~1 MB PDF.js and epub.js bundles are only fetched when a user actually opens a document — zero cost for normal usage.
- `entries/css/reader.css` (new): reader toolbar bar, scrollable content area, page canvas styling, ePub iframe sizing, and `.gallery-read-now` button.
- `entries/css/style.css`: imports `reader.css`.
- `client/file.js`: added `getReadableType()` returning `"pdf"`, `"epub"`, or `null`.
- `client/files/gallery.js`: imported `Reader`; added `readNowEl` and `reader` to constructor; added `onreadnow()` handler; shows/hides the Read Now button per file readability.
- `views/room.ejs`: added `<button id="gallery_read_now" ...>` inside `#gallery`; added `#reader` overlay with toolbar and `#reader-content` scroll area.

## 2026-02-21 - Links Archive: Content Population + Chat Link Capture Fix

### Root Cause

Two related timing bugs:

1. **Client missed initial `"links"` socket event**: The server sends `{ replace: true, links: [...] }` immediately on connect (after an async Redis lookup). The client's `links.init()` registers the socket handler AFTER all components are initialized, so the initial event was already dispatched and dropped. The handler never saw it.

2. **Server's empty-replace cleared test data**: Even in dev testing, after `links.init()` called `onlinks()` with hardcoded test links, the server's delayed `{ replace: true, links: [] }` would arrive a few milliseconds later and wipe everything. This made the panel always appear empty.

3. **Chat links appearing then vanishing**: Links created by chat messages correctly arrived via the "add" event path (no `replace`), but the subsequent server empty-replace cleared them too.

### Changes

- `lib/client.js`:
  - Added `socket.on("getlinks", async handler)` — when the client emits `"getlinks"`, server responds by fetching current room links from Redis and sending `{ replace: true, links: [...] }`. This is the same code as `emitInitialState` but triggered on demand.
- `client/links.js`:
  - Removed all hardcoded `// REMOVEME` test link data from `init()`.
  - Added `registry.socket.emit("getlinks")` at the end of `init()` (after socket handlers registered) — client requests the fresh room link state, guaranteed to land after the handler is ready to receive it.

---

## 2026-02-21 - Filter Field Alignment + Links Archive Header Row

### Changes

- `entries/css/room.css`:
  - Added `line-height: 1` to `#filter` rule — fixes 1-2px upward browser-default offset that `<input>` elements exhibit inside flex containers despite `align-self: center`.
- `entries/css/files.css`:
  - Added `background: var(--dark-bg); color: var(--text-fg)` to `#links` for explicit visibility guarantee (previously relied on inheritance).
  - Added `#links::before { content: ''; display: block; height: 28px; }` spacer to push rows below the fixed header.
  - Added `#links-header` sticky header bar (position: absolute, top: 0, 28px height) with three column label spans: `.lh-name` (Title/URL), `.lh-tags` (Shared by), `.lh-detail` (URL & Age). Widths mirror the `.name`/`.tags`/`.detail` column layout of link rows.
- `views/room.ejs`:
  - Added `<div id="links-header">` inside `<section id="links">` with column labels.
- `client/links.js`:
  - Changed `onlinks()` clear path from `this.el.innerHTML = ""` to `Array.from(this.el.querySelectorAll(".file")).forEach(el => el.remove())` so that the `#links-header` element is preserved when the list is replaced.

---

## 2026-02-21 - Button Height Normalization + Filter Input Anchor

### Root Cause

`.btn` had no explicit `height`, so button height was driven by line-height and padding — meaning buttons with different inner content (icon vs icon+count-pill vs SVG) came out different heights. `.btn-download` overrode `font-size: 10pt`, making its icons smaller than all other toolbar icons. `#filter` had only padding-based sizing, so it grew taller than buttons and didn't align to them visually.

### Changes

- `entries/css/room.css`:
  - Added `height: 34px` to `#tools .btn` and `#tools label.btn` base rule — all buttons now exactly square.
  - Added `height: 34px` to `.filterbtn` rule — filter type buttons match icon buttons.
  - Added `height: 34px` to `#tools .btn.btn-download` and removed `font-size: 10pt` override — download button icons now render at 12pt matching all other toolbar icons.
  - Changed `#tools .btn.btn-download` padding to `0 0.55rem` — vertical padding no longer needed, height is explicit.
  - Added `height: 32px; box-sizing: border-box; align-self: center; padding: 0 0.65rem` to `#filter` — input is 2px shorter than buttons, aligned vertically in the toolbar flex row.
- `views/room.ejs`:
  - Changed links-toggle SVG `width`/`height` from `14` → `18` — SVG icon now visually matches font-based icons.

---

## 2026-02-21 - Filter + Download Button Pills + Pill Margin Fix

### Root Cause

The direct-child combinator was missing from `#tools .btn:last-child` — this rule matched any `.btn` that was `:last-child` of any ancestor inside `#tools`, including `#trash` inside `.selection-pill` and `#nailon` inside `.viewmode-pill`, causing `margin-left: 0.85rem` to be applied to the last button inside each pill wrapper. This produced a gap before the last button in every pill, breaking the joined appearance.

### Changes

- `entries/css/room.css`:
  - Changed `#tools .btn:last-child` → `#tools > .btn:last-child` (direct-child combinator) so the Upload label margin rule no longer leaks into pill wrappers.
  - Changed `#tools .btn:last-child span` → `#tools > .btn:last-child span` correspondingly.
  - Added `margin-left: 0` to `#tools .btn-pill .btn:last-child` as belt-and-suspenders against any future inheritance.
  - Added `#tools .btn-pill .filterbtn` pill flatten rules (border-radius, border-right) to support `.filterbtn` native `<button>` elements inside a `.btn-pill` wrapper.
  - Added `#tools .btn-pill .filterbtn:first-child` and `:last-child` radius rules.
- `views/room.ejs`:
  - Wrapped 7 filter type buttons (`#filter-image` through `#filter-request`) in `<div class="btn-pill filter-pill">`.
  - Wrapped `#downloadnew` and `#downloadall` in `<div class="btn-pill download-pill">`.

---

## 2026-02-21 - Segmented Pill Specificity Fix

### Root Cause

`.btn-pill .btn` has CSS specificity 20. `#tools .btn` has specificity 110. The base `border-radius: 6px` from the `#tools .btn` rule always defeated the pill's `border-radius: 0` override, so every button inside a pill still had four rounded corners.

### Changes

- `entries/css/room.css`:
  - Rescoped all `.btn-pill .btn` rules to `#tools .btn-pill .btn` (specificity 120) to beat the base `#tools .btn` rule at 110.
  - Affected rules: base flatten (`border-radius: 0; border-right: 0`), `:first-child` radius, `:last-child` radius + border-right, `:hover` z-index.

---

## 2026-02-21 - Segmented Pill System + Toolbar Padding

### Changes

- `entries/css/room.css`:
  - Added 3px top/bottom padding to `#room > #tools` (was `0 0.35rem`, now `3px 0.35rem`) for breathing room in the toolbar.
  - Added `.btn-pill` system: `display: inline-flex; align-items: center; align-self: center` wrapper style.
  - Added `.selection-pill` visibility rules: `display: none` default, `display: inline-flex` for `.mod` and `.owner` body classes.
  - Added `.viewmode-pill { margin-left: 0.85rem }` to visually separate view mode controls.
  - Added `#banfiles.btn { margin-left: 0.85rem }` to visually separate mod controls.
  - Removed old standalone `#clearselection.btn { margin-right: 1em }`, `#nailoff.btn { margin-left: 0.85rem }`, `#nailon.btn { margin-left: 0 }` rules.
  - Removed old `#selectall/#clearselection/#trash` merged border-radius/border group overrides.
- `views/room.ejs`:
  - Wrapped `#selectall`, `#clearselection`, `#trash` in `<div class="btn-pill selection-pill">`.
  - Wrapped `#nailoff`, `#nailon` in `<div class="btn-pill viewmode-pill">`.

---

## 2026-02-21 - Filter Button Style Regression Fix

### Root Cause

`.filterbtn` elements are native `<button>` HTML elements. Browsers apply default agent styles (`appearance: auto`, UA padding, default font metrics) to `<button>` that are not applied to `<div>`. Without explicit resets, filter buttons rendered with browser-default button appearance — different shape, size, and alignment from `.btn` divs.

### Changes

- `entries/css/room.css`:
  - Added `display: inline-flex; align-items: center; justify-content: center; align-self: center; -webkit-appearance: none; appearance: none; padding: 0.5ex; box-sizing: border-box; cursor: pointer; font-size: 12pt` to `.filterbtn` rule.
  - These properties strip browser-default button rendering and make `.filterbtn` visually consistent with `.btn` divs.

---

## 2026-02-21 - UI_STYLE.md Creation (Chapters 1–6)

### Changes

- Created new top-level `UI_STYLE.md` file documenting the complete Dicefiles CSS design system:
  - **Chapter 1**: Button system — `.btn`, `.filterbtn`, `.btn-pill`, icon usage; toolbar padding rule; CSS specificity note (why pill selectors use `#tools .btn-pill .btn`).
  - **Chapter 2**: `.btn-download` with `.count-pill` badge anatomy.
  - **Chapter 3**: Full CSS variable palette table, typography variables, color usage rules.
  - **Chapter 4**: `title` attribute rules, rich `.tooltip` grid spec.
  - **Chapter 5**: Complete `.modal` markup structure, button variant table, checkbox styling, icon areas.
  - **Chapter 6**: File row anatomy (`.name`/`.tags`/`.detail`), all state classes table, gallery mode rules, Links Archive structure mirrors.

---

## 2026-02-21 - Links Archive Feature

### Changes

- `entries/css/files.css`:
  - Changed `#files.listmode` → `#files.listmode:not(.hidden)` to fix a specificity conflict where `display: block !important` on the ID rule overrode `.hidden`'s `display: none !important`.
  - Added full `#links` archive section CSS: base element, `.file` row, `.name`, `.tags`, `.detail`, `.file-new-pill`, sharer pill, `.url-display`, `.ttl`.
  - Added `#filelist { position: relative }` for absolute overlay positioning context.
- `client/links.js`:
  - Created new Links Archive frontend controller. Lazy Scroller init, `body.links-mode` toggle, `createLinkElement` using correct CSS class names (`.name > .name-text`, `.file-new-pill`, `.tags > .tag.tag-user`, `.detail > .url-display`, `.detail > .ttl`).
  - 5 hardcoded test links in `init()` marked `// REMOVEME`.
- `views/room.ejs`:
  - Added `#links-toggle` button with inline SVG chain icon (positioned before `#createrequest`).
  - Added `<section id="links" class="listmode hidden">` alongside `#files` in `#filelist`.
- `entries/css/room.css`:
  - Added `#links-toggle.btn { margin-right: 0.55rem }`.
  - Added `#links-toggle.btn.active` to active state rule.
  - Added `#status { position: relative }`.
  - Changed `.gif-menu` width from fixed `32rem` to `calc(100% - 0.3rem)` with `left: 0.15rem`.
- `client/chatbox.js`:
  - Moved `gifMenu` DOM append from `overlayAnchor` to `this.status`.
  - Updated `ondocclick` to check `this.gifMenu.contains(e.target)` preventing auto-dismiss on panel interaction.

## 2026-02-21 - Links Archive + GIF Width Fixes

### Root Cause Analysis

- The Links Archive toggle button appeared to do nothing because CSS rule `#files.listmode { display: block !important; }` has higher specificity than `.hidden { display: none !important; }`. When `hidden` class was toggled onto `#files.listmode`, the `display: block !important` won due to id+class specificity vs class-only.

### Changes

- `entries/css/files.css`: Changed `#files.listmode` to `#files.listmode:not(.hidden)` to resolve the specificity conflict. Added full `#links` section CSS (base element, row, name, tags, detail, NEW pill, sharer pill, URL display, age).
- `client/links.js`: Rewrote `createLinkElement` to use proper CSS class names consistent with the file row CSS (`.name > .name-text`, `.file-new-pill`, `.tags > .tag.tag-user`, `.detail > .url-display`, `.detail > .ttl`) instead of the non-matching `.file_name`, `.file_size`, `.file_tag` classes from the partial implementation.
- `entries/css/room.css`: Added `position: relative` to `#status` so it acts as positioning context. Changed `.gif-menu` width from fixed `32rem` to `calc(100% - 0.3rem)` with `left: 0.15rem` so the GIF popup fills the full chat column width.
- `client/chatbox.js`: Moved `this.gifMenu` DOM append from `this.overlayAnchor` to `this.status` so it inherits the full-width positioning context. Updated `ondocclick` to also check `this.gifMenu.contains(e.target)` to prevent auto-dismiss when clicking inside the GIF panel.

## 2026-02-18 - Changelog Release Consolidation (1.0.0)

- Folded all previously pending `Unreleased` feature notes into the current `1.0.0` changelog entry.
- Simplified release notes to user-facing capabilities plus a concise API/integrations section.
- Removed incremental unreleased deltas so changelog reflects a single coherent baseline release view.

## 2026-02-18 - API.md Full Sync Pass

- Reworked `API.md` into a complete, code-aligned API spec for current Dicefiles behavior.
- Documented stable `/api/v1` namespace and `/api/automation` compatibility alias.
- Added full scope model details, key configuration patterns, and scope matching rules.
- Added complete endpoint matrix and per-endpoint examples (auth, rooms, requests, uploads, files, downloads, delete).
- Added automation rate-limit/audit headers and status behavior.
- Added `GET /healthz` contract with dependency checks and metrics payload.
- Expanded webhook section with signing details, event semantics, retries, and dead-letter behavior.
- Added agent workflow recipes and explicit skill-builder mapping for automation tooling.

## 2026-02-18 - TODO 13: Observability and Ops Baseline

- Added new shared observability module (`lib/observability.js`) for lifecycle logs, counters, and health checks.
- Added structured JSONL lifecycle logging for:
  - upload created / deleted
  - request created / fulfilled
  - download served
  - preview generation failures
- Added in-memory metrics counters:
  - `uploadsCreated`, `uploadsDeleted`
  - `downloadsServed`, `downloadsBytes`
  - `requestsCreated`, `requestsFulfilled`
  - `previewFailures`
- Added lightweight `GET /healthz` endpoint with:
  - Redis ping + latency check
  - upload storage writeability probe + latency
  - current metrics snapshot
- Added new default config key:
  - `observabilityLog` (default `ops.log`)
- Updated roadmap/docs to mark TODO-13 completed and document health/observability settings.

## 2026-02-18 - TODO 8/9: Automation API Hardening + Webhooks

- Added a stable versioned automation API namespace: `/api/v1/*` with compatibility alias `/api/automation/*`.
- Added scoped automation API key support:
  - legacy string keys still map to full access
  - object keys support scoped permissions (`files:read`, `uploads:write`, `requests:write`, `files:delete`, etc.)
- Added per-scope fixed-window rate limiting for automation routes with standard response headers and `429` handling.
- Added structured automation audit logging (JSON lines) to configurable `automationAuditLog`.
- Implemented outbound webhook dispatcher with event coverage:
  - `file_uploaded`
  - `request_created`
  - `request_fulfilled` (on non-expiry request removal)
  - `file_deleted`
- Added signed webhook delivery (`X-Dicefiles-Signature`, HMAC-SHA256), retry/backoff policy, and dead-letter JSONL logging.
- Updated API and README documentation to reflect new config and integration flow for agentic tooling.
- Marked roadmap TODO items 8 and 9 as done in `TODO.md`.

## 2026-02-18 - Unreleased squashed into 1.0.0

- Squashed player/API-facing Unreleased items into `CHANGELOG.md` under `1.0.0` (emoji picker, GIF search/post flow, batch-download features, file view-mode persistence, preview quality, file metadata and CSP/API fixes).
- Added Links Archive functionality to collect and display links posted in chat.
- Dropped non-essential visual polish and micro-alignment changes per request.

## 2026-02-18 - Restart script & runbook update

- Added `scripts/restart-server.sh` (canonical restart helper; builds with explicit Node 18 and starts the server in foreground — run inside a persistent PTY).
- Added `npm run restart` (runs `scripts/restart-server.sh`).
- Updated `AGENTS.md` to recommend `tail -F server.log` as an additional verification step when running the server in background.

## 2026-02-18 - First-Switch Gallery-to-Table Width Leak Hardening

- Prevented fixed file-row style capture while gallery mode is active.
- Added a list-mode row normalization pass (`normalizeListRows`) that runs immediately and again on the next frame when switching from gallery to table mode.
- Normalization now explicitly resets row width/flex and clears stale min/height inline properties before table rendering settles.

## 2026-02-18 - Batch Download Controls Right Alignment

- Right-aligned both numeric controls on the Download All/New options row.
- `Retries` and `Concurrent` controls now anchor to the right edge of the row for cleaner visual grouping.

## 2026-02-18 - Batch Download Options: Concurrent Control

- Added `Concurrent` setting to Download All/New modal options, on the same row as `Retries`.
- Default concurrent downloads is now `4`.
- Concurrent value is persisted with download preferences and queued-batch restore state.
- Batch runner now uses per-batch configured concurrency (clamped `1..4`) instead of fixed script default only.
- Polished modal row layout with compact labels: `Retries` and `Concurrent`, centered as a controls group.

## 2026-02-18 - Table-Mode Width Leak Hard Fix

- Added explicit per-row inline layout reset when switching to table mode:
  - `width: 100%`
  - `max-width: 100%`
  - `flex: 0 0 auto`
- Added corresponding inline cleanup when switching back to gallery mode.
- This removes any residual gallery tile sizing even if class toggling timing races on first reload/switch.

## 2026-02-18 - Table View Hover Tooltip Recovery

- Restored reliable file hover behavior in table mode by binding tooltip activation to the full file row (`.file`) in addition to filename anchor hover.
- This prevents tooltip loss caused by layout/targeting changes where hovering non-name row regions no longer triggered tooltip display.

## 2026-02-18 - Pages Pill Wording Update

- Replaced abbreviated pages suffix with natural English singular/plural wording:
  - `1 page`
  - `N pages`

## 2026-02-18 - Pages Pill Suffix + List-Mode Width Guard

- Added `pg.` suffix to the pages metadata pill text in file list (`e.g. 312 pg.`) for immediate clarity without hover.
- Added explicit list/table-mode layout guards in `entries/css/files.css`:
  - `#files.listmode` is forced to block layout
  - list-mode file rows are forced to `width: 100%`
- Purpose: prevent gallery tile width leakage during first switch from restored gallery mode back to table mode.

## 2026-02-18 - CSP Allowlist Update for Tenor Legacy Endpoint

- Added `https://g.tenor.com` to `connect-src` in `lib/httpserver.js`.
- Required for Tenor legacy fallback search requests to pass browser CSP checks.

## 2026-02-18 - Gallery-to-Table First-Switch Regression Fix

- Replaced mode-button toggle behavior with explicit mode setters:
  - `nailOff` now always applies table/list mode
  - `nailOn` now always applies gallery mode
- This prevents post-restore state desync where first switch could leave gallery sizing rules visually stuck in table mode.

## 2026-02-18 - Tenor Search Compatibility Fallback

- Fixed Tenor search returning no results with legacy/public keys that fail Tenor v2 validation.
- `searchTenor()` now auto-falls back to Tenor legacy endpoint (`g.tenor.com/v1/search`) when v2 returns key-validation errors or unparseable/empty results.
- Added robust parsing for both v2 (`media_formats`) and v1 (`media[]`) response shapes.

## 2026-02-18 - View Mode Persistence Hardening

- Normalized room-id key derivation for view-mode storage (trailing slash-safe) to avoid room-key mismatches.
- Added global fallback key for view mode, so last-used mode can still restore if room-specific key is missing.
- Added a second restore attempt on first `files` sync to ensure mode is applied immediately on reload.

## 2026-02-18 - Persist File View Mode Per Room

- Added per-room persistence for file list view mode (`list` vs `gallery`) in browser localStorage.
- Refreshing or reopening the same room now restores the last used mode automatically.
- Refactored mode switching through a shared `applyViewMode()` path for consistent class/button/state updates.

## 2026-02-18 - GIF Auto-Scroll Load-Timing Fix

- Added secondary scroll-to-bottom hooks on chat media load events (`img load/error`, `video loadeddata/canplay`) for posted GIF/media messages.
- This addresses cases where initial auto-scroll fired before media dimensions were finalized, leaving chat above the latest message.

## 2026-02-18 - GIF Auto-Scroll Reliability Fix

- Reworked GIF auto-scroll trigger to detect rendered media blocks (`.chatgif-wrap`) instead of relying on message flags.
- This ensures chat reliably scrolls to bottom after GIF/media posts even when upstream message metadata varies.

## 2026-02-18 - Auto-Scroll on Posted GIF

- Added sender-side auto-scroll for GIF/media chat posts.
- When a message is authored by the current user and includes an embeddable media URL, chat now scrolls to bottom after flush/render.
- Keeps GIF posting flow visible without manual scrolling.

## 2026-02-18 - Gallery Overlay Click-to-Download

- In gallery mode, clicking on white overlay rows now downloads the file.
- Applied to both filename overlay (`.name`) and bottom metadata overlay (`.detail`) for non-request files.
- Preserved special overlay actions:
  - metadata copy button keeps copy behavior
  - request URL icon keeps link-open behavior

## 2026-02-18 - Centered Chat GIF Alignment

- Updated chat media wrapper styling so posted GIF/video embeds are centered in chat messages.
- Applied via `entries/css/room.css` by switching `.chatgif-wrap` to a centered flex container.

## 2026-02-18 - Gallery NEW Pill Visibility Fix

- Fixed gallery mode regression where `NEW!` badge appeared on every file.
- Scoped gallery `NEW!` badge display to `.file.is-new` only, matching table-mode behavior.

## 2026-02-18 - Gallery TTL/Size Alignment Correction

- Restored gallery file-size placement to right alignment at the end of the metadata row.
- Converted TTL segment into a centered middle flex region (`flex: 1`) so clock + TTL value stay centered.
- Result: left = type pill, center = TTL, right = file size.

## 2026-02-18 - Gallery Name Row Bottom Alignment + Type Pill Reset Fix

- Bottom-aligned filename row content (`name-text` + `NEW!` badge) in gallery mode for cleaner overlay anchoring.
- Scoped the generic gallery detail `span` reset so it excludes `.type-pill`, preventing the type pill's horizontal padding from being stripped.
- Result: file type label remains properly centered inside the pill while other detail spans keep compact spacing.

## 2026-02-18 - 2x Thumbnail Resolution Upgrade

- Doubled generated preview dimensions in `lib/meta.js` for image/PDF thumbnail assets.
- Upgraded video preview transcode scale from width `200` to `400` for sharper gallery playback previews.
- Upgraded embedded audio cover extraction from `200x200` to `400x400`.
- Result: significantly cleaner previews in gallery mode, especially on larger and high-DPI displays.

## 2026-02-18 - Gallery Bottom Overlay + TTL Alignment Polish

- Unified the two bottom gallery overlays to the same (more opaque) transparency level for consistent appearance.
- Fixed gallery file-type pill label centering by switching the pill to explicit flex centering.
- Repositioned gallery TTL to center between type and size, and tuned TTL icon/value to dark grey for better balance on the light overlay.

## 2026-02-18 - Agent Runbook Lessons Captured

- Expanded `AGENTS.md` with a dedicated "Failure Modes We Hit" section so repeated operational mistakes are prevented.
- Documented concrete pitfalls:
  - wrong default Node major in shell
  - conflicting server processes from other runtimes/paths
  - unreliable detached `nohup` starts in this environment
  - mandatory dual health verification (`curl` + `ss`)
  - process ownership/path checks before kill/restart
- Updated `TODO.md` labels to explicitly mark items 6 and 7 as done.

## 2026-02-18 - Server Runbook Hardening

- Added strict startup instructions to `AGENTS.md`:
  - always use explicit Node 18 binary path
  - mandatory build/start/health-check sequence
  - explicit forbidden patterns (`bun`, wrong node path, wrong project path)
- Purpose: prevent recurring "server down" incidents caused by inconsistent runtime/start methods.

## 2026-02-18 - GIF Chat Cleanup

- Updated chat link rendering so GIF/video messages no longer show the raw URL above the media.
- For embeddable GIF/media links, chat now renders only the media block for cleaner conversation flow.
- Non-embeddable links continue to render as clickable text links.

## 2026-02-18 - GIF Panel Width + Density Tweak

- Widened the GIF search panel from `26rem` to `32rem`.
- Increased GIF result grid density from 4 to 5 columns so one more item appears per row.

## 2026-02-18 - GIF Send Reliability Fix

- Normalized selected GIF URLs before sending to chat (strip query/hash, keep direct media URL).
- Added Giphy media-id canonicalization to `https://i.giphy.com/media/<id>/giphy.gif` for shorter and more stable chat links.
- This fixes cases where GIF search results appeared but clicking a result did not reliably post/render in chat due overly long or noisy provider URLs.

## 2026-02-18 - Chat Emoji + GIF Injection

- Added a native in-chat emoji picker button next to the message textarea for quick emoji insertion at cursor position.
- Added `/gif <url>` chat command for quickly posting GIF/media URLs.
- Added inline GIF/media embedding in chat messages for:
  - direct `.gif`, `.mp4`, `.webm` links
  - Giphy page/media links (auto-converted to embeddable GIF source)
  - Tenor direct media hosts (`media.tenor.com`, `c.tenor.com`)
- Styled embedded chat GIFs/videos with bounded dimensions and greytone-compatible framing.

## 2026-02-18 - Cover Mode Polish

- Reworked cover/gallery tiles so media dominates each item and fills the full frame with top-aligned cover presentation.
- Added soft translucent white gradient overlays for the title layer and bottom metadata layer to improve readability on bright/dark covers.
- Consolidated gallery bottom metadata into a single line with file type pill, file size, TTL, uploader tag, and metadata copy action.

## 2026-02-18 - Emoji Control Placement Update

- Relocated emoji picker trigger from the chat input area to the status/account row above chat, left-aligned as requested.
- Kept emoji insertion flow unchanged (inserts at cursor in chat textarea), while keeping the picker popover anchored to the new status-bar button.

## 2026-02-18 - Gallery Metadata Contrast Pass

- Increased gradient strength behind gallery title and bottom metadata for better readability on bright covers.
- Updated gallery title color to dark grey for higher contrast with the light overlay.
- Switched gallery type pill text from generic item type to file extension (e.g., `PDF`, `EPUB`, `PNG`) and styled it as a dark pill with light text.
- Restored uploader pill to dark-green background with white text for consistent visibility.
- Centered file size visually between the left-aligned type pill and right-aligned uploader pill.

## 2026-02-18 - Batch Download Auto-Resume Regression Fix

- Fixed a regression where the Download All/New modal could appear automatically on room open.
- Queue state is now persisted only after the user explicitly presses `Start`.
- Queue restore now resumes only previously started batches; stale pre-start entries are cleared.
- Cancelling before `Start` now guarantees queue cleanup and prevents auto-resume on next room load.

## 2026-02-18 - Searchable Full Emoji Picker

- Expanded emoji picker from a small static set to a broad Unicode emoji set generated from emoji codepoint ranges.
- Added in-picker search bar for filtering emojis by query.
- Search field now auto-focuses whenever the emoji panel opens.
- Kept insertion behavior unchanged (emoji inserted at cursor in chat textarea).

## 2026-02-18 - Gallery Overlay and Pill Alignment Pass

- Reworked gallery text overlays from soft gradients to mostly solid translucent light overlays with only the top 20% faded.
- Tuned gallery text for light-background readability.
- Restyled extension/type pill to a centered grey theme.
- Kept uploader pill right-aligned with centered pill content and improved contrast.
- Increased gallery file size text by +2px and preserved center positioning between type and uploader.

## 2026-02-18 - Emoji Set Curation and Descriptor Search

- Replaced the very large generated emoji list with a smaller curated set tailored to typical forum/Discord communication.
- Changed emoji search behavior to match human-readable descriptors/aliases (e.g. `laugh`, `party`, `thumbs up`, `heart`) instead of codepoint-based labels.
- Preserved autofocus and insertion behavior of the emoji panel.

## 2026-02-18 - Gallery Name + Metadata Vertical Alignment

- Switched gallery filename row to flex alignment so filename text and `NEW!` badge align vertically on one row.
- Constrained gallery filename text width to preserve space for `NEW!`, mirroring table-mode behavior.
- Normalized gallery filename tone to dark grey for both regular and new files.
- Tightened vertical alignment of gallery metadata row elements (`type`, centered `size`, right-side `uploader`).

## 2026-02-18 - Core Editable Emoji Catalog

- Moved emoji picker content into project core config file: `core/emoji-list.json`.
- Chat picker now reads the emoji catalog from this file at build/runtime bundle load.
- Added validation/normalization so invalid entries are ignored safely.
- Added fallback default emoji entry to avoid picker breakage if config is empty/invalid.

## 2026-02-18 - Gallery Overlay + Pill Contrast Tweaks

- Changed gallery second/bottom metadata overlay to solid translucent light background (removed fade in this row).
- Updated extension/type pill sizing to content-based width for short labels like `PDF`/`EPUB`.
- Reversed gallery `NEW!` pill contrast for light overlays: darker green fill with white text.

## 2026-02-18 - Gallery Metadata Simplification

- Darkened gallery type pill styling to grey background with white text for stronger contrast.
- Increased `NEW!` badge contrast in gallery mode (darker green with white text).
- Removed uploader pill from gallery metadata row.
- Moved file size to right-aligned position to replace uploader slot.

## 2026-02-18 - Gallery Overlay Edge + Pill Tone

- Fixed slight overlap between upper title overlay and lower metadata overlay by aligning their row boundary.
- Adjusted extension/type pill from dark grey to an above-mid grey tone.
- Enforced centered short extension labels inside the type pill (e.g. `PDF`, `EPUB`).

## 2026-02-18 - Gallery Pill Centering + Width Pass

- Removed remaining 1–2px overlay seam by forcing matching fixed heights for title and metadata rows.
- Increased extension pill minimum width slightly (+4px) while keeping pill left-aligned in row.
- Enforced true vertical centering for gallery pill text (`type`, `NEW!`, and any remaining tags).

## 2026-02-18 - Live GIF Search Overlay (Giphy/Tenor)

- Added segmented GIF controls (Giphy/Tenor) beside emoji controls in the status bar.
- Buttons use provider favicons and open a GIF search overlay with centered search input.
- Implemented real-time query updates with debounced live search and animated preview tiles.
- Selecting a GIF inserts its direct URL into chat input at cursor position.
- Added editable provider configuration in `core/gif-providers.json` for API keys and search options.
- Implemented in-overlay status feedback for missing/invalid API key or empty result sets.
- Removed old `/gif` command path so GIF insertion flow is now overlay-driven.

## 2026-02-18 - Gallery Extension Pill Centering Fix

- Corrected extension pill text alignment in gallery mode (`PDF`/`EPUB` labels).
- Switched pill internals to strict center-placement layout and removed selector override that was re-left-biasing content.

## 2026-02-18 - GIF API Key Local Secret Config

- Reworked GIF provider key handling to use a local git-ignored file (`.gif-providers.local.json`) for secrets.
- Kept `core/gif-providers.json` in-repo with non-secret defaults only.
- Added build-time merge in `webpack.config.js` so local keys override defaults without committing secrets.
- Documented setup steps in `README.md`.

## 2026-02-18 - Giphy Rating Default to Mature

- Changed default `giphy.rating` to `r` (mature) in `core/gif-providers.json`.
- Added inline note in config listing supported rating values (`g`, `pg`, `pg-13`, `r`).
- Updated README GIF-provider section with the same rating-option guidance.

## 2026-02-18 - GIF Control Init Regression Fix

- Fixed `DOMTokenList.add` crash caused by an empty CSS class token during GIF provider button creation.
- Updated GIF button class composition to avoid empty class values.
- Hardened `dom()` helper class handling to ignore empty/invalid class tokens globally.
- This unblocks normal room initialization and prevents downstream file-list/scroller errors triggered by aborted chatbox init.

## 2026-02-18 - GIF API CSP Allowlist

- Updated server CSP header to include `connect-src` allowlist entries for GIF provider APIs.
- Added `https://api.giphy.com` and `https://tenor.googleapis.com` so live GIF search requests are allowed by browser CSP.

## 2026-02-18 - Status Control Ordering (Emoji/GIF)

- Reordered status bar controls so emoji button appears before GIF segmented controls.
- Provider segment order remains `Giphy` first, `Tenor` second.

## 2026-02-18 - GIF Search Debounce Tuning

- Increased GIF search debounce from `180ms` to `800ms` after last keystroke.
- Reduces aggressive request bursts while typing and makes live search behavior calmer.

## 2026-02-18 - GIF Result Send Flow

- Changed GIF picker result click action from “insert URL in textarea” to immediate chat send.
- Keeps overlay workflow but matches expected behavior of directly adding GIF content into chat stream.

## Project Overview

Dicefiles is a self-hosted, open-source file sharing platform originally forked from dicefiles and rebranded for hobby communities. It provides real-time chat rooms with ephemeral file sharing capabilities, designed for sharing roleplaying books, digital maps, board games, STL models, fiction, and other hobby resources.

## Development Timeline

### Phase 1: Initial Setup and Forking (Feb 17, 2026)

#### GitHub Forking

- Forked `https://github.com/dicefiles/dicefiles` to `https://github.com/apoapostolov/dicefiles`
- Cloned to local workspace: `/home/apoapostolov/git-public/dicefiles`
- Repository structure preserved with all original files

#### Redis Installation

- Installed Redis server on Ubuntu system
- Verified Redis is running on default port (6379)
- Confirmed Redis CLI connectivity with `redis-cli ping`

#### Node.js Environment Setup

- Discovered Node.js v24.13.1 incompatible with project dependencies
- Installed Node Version Manager (nvm)
- Installed Node.js v18.20.8 (LTS) for compatibility
- Updated yarn package manager
- Verified GCC compiler availability for native modules

#### Dependency Installation

- Resolved blake2 native module compilation issues with Node 18
- Successfully installed all dependencies: `yarn install`
- Built client-side assets: `yarn prestart`
- Configured server port to 9090 in `.config.json`

### Phase 2: Complete Project Rebranding (Feb 17, 2026)

#### Core Identity Changes

- **Package Name**: Updated `package.json` name from "dicefiles" to "dicefiles"
- **Description**: Changed to "Ephemereal Filesharing for Hobby Communities"
- **Site Name**: Updated `defaults.js` name from "dicefiles" to "Dicefiles"
- **Tagline**: Changed motto to "Ephemereal Filesharing for Hobby Communities"

#### Configuration Updates

- Modified `lib/config.js` to use "dicefiles.json" and "dicefiles" config paths
- Updated HMAC secret in `webpack.config.js` from "dicefiles" to "dicefiles"
- Changed jail profile name from "dicefiles-jail" to "dicefiles-jail"
- Updated internal worker ID from "DICEFILES_EXPIRATION_WORKER" to "DICEFILES_EXPIRATION_WORKER"
- Modified gitignore archive pattern to "dicefiles-v\*.tgz"

#### User Agent and Headers

- Updated User-Agent string in `lib/user.js` from "dicefiles/1.0 like irc" to "dicefiles/1.0 like irc"

#### Service Templates

- Renamed `contrib/dicefiles.service` to `contrib/dicefiles.service`
- Updated systemd service description, paths, and identifiers
- Modified working directory and executable paths for Dicefiles

#### Documentation Rebranding

- Updated `CONTRIBUTING.md` title from "dicefiles" to "Dicefiles"
- Modified `docs/message-removal.md` references
- Updated legacy `Readme.md` with pointer to new README.md

#### Footer Links

- Updated GitHub link to point to fork: `https://github.com/apoapostolov/dicefiles`
- Changed Twitter link to X: `https://x.com/apoapostolov`

### Phase 3: Homepage and User Experience Improvements (Feb 17, 2026)

#### Landing Page Redesign

- Completely rewrote `views/index.ejs` with welcoming content
- Added clear purpose statement: "A self-hosted file sharing platform designed for hobby communities"
- Included Quick Start guide with bullet points
- Added Room Management instructions
- Listed key features (file previews, accounts, moderation, ephemerality)
- Included help section with links to documentation

#### Server-Side Route Enhancements

- Enhanced `/terms` and `/rules` page titles in `lib/httpserver.js`
- Added proper pagename context for "Terms of Service and Privacy Policy" and "The Rules"
- Verified all footer links work correctly

### Phase 4: Documentation Creation (Feb 17, 2026)

#### INTRODUCTION.md

- Created comprehensive platform guide (5361 bytes)
- Documented project purpose and philosophy
- Listed use cases for different hobby communities (RPG, board games, makers, fiction)
- Added getting started guides for users and hosts
- Included configuration options reference
- Explained ephemereal nature and security features

#### CHANGELOG.md

- Created detailed v1.0.0 release notes (6293 bytes)
- Documented all core features and capabilities
- Listed platform features (file sharing, chat, moderation, etc.)
- Added performance, security, and compatibility notes
- Included roadmap for future versions

#### README.md Updates

- Updated title to "Dicefiles - Ephemereal Filesharing for Hobby Communities"
- Added documentation section linking to INTRODUCTION.md and CHANGELOG.md
- Updated Windows 11 setup instructions
- Added Node.js version compatibility warnings
- Updated all clone URLs to point to fork repository

### Phase 5: GitHub Repository Configuration (Feb 17, 2026)

#### Repository Metadata Updates

- Updated repository description via GitHub CLI
- Set homepage URL to <http://127.0.0.1:9090>
- Description: "Dicefiles - Ephemereal filesharing platform for hobby communities. Share RPG books, maps, board games, STL models, fiction, and more."

### Phase 6: Testing and Verification (Feb 17, 2026)

#### Server Testing

- Verified server starts successfully on port 9090
- Confirmed homepage loads with new Dicefiles branding
- Tested `/terms` and `/rules` endpoints return correct content with proper titles
- Validated footer links work in both homepage and room contexts

#### Build Verification

- Confirmed client-side webpack build completes successfully
- Verified all EJS templates render correctly
- Checked configuration loading and application of Dicefiles branding

#### Git Operations

- Committed all changes with descriptive commit messages
- Pushed updates to fork repository
- Maintained clean git history with logical commits

## Current State (Feb 17, 2026)

### Active Services

- **Dicefiles Server**: Running on <http://127.0.0.1:9090>
- **Redis**: Running on localhost:6379
- **Node.js**: v18.20.8 (via nvm)

### File Structure

```
dicefiles/
├── client/          # Frontend code
├── common/          # Shared utilities
├── contrib/         # Service templates
├── docs/            # Documentation
├── entries/         # Webpack entry points
├── lib/             # Server-side code
├── static/          # Built assets
├── uploads/         # File storage (configurable)
├── views/           # EJS templates
├── CHANGELOG.md     # Release history
├── INTRODUCTION.md  # Platform guide
├── README.md        # Setup instructions
├── package.json     # Dependencies and metadata
├── defaults.js      # Default configuration
├── server.js        # Main application entry point
├── webpack.config.js # Build configuration
└── .config.json     # Local configuration
```

### Key Features Implemented

- ✅ Real-time chat rooms with WebSocket support
- ✅ File upload and sharing with configurable limits
- ✅ File previews (images, videos, audio, PDFs)
- ✅ User accounts and session management
- ✅ Room ownership and moderation
- ✅ Ephemeral file storage (TTL-based expiration)
- ✅ Responsive web interface
- ✅ Multi-platform deployment (Linux, Windows, macOS)
- ✅ Comprehensive documentation
- ✅ Hobby-focused branding and user experience

### Configuration Options

```json
{
  "name": "Dicefiles",
  "motto": "Ephemereal Filesharing for Hobby Communities",
  "port": 9090,
  "maxFileSize": 10737418240,
  "TTL": 48,
  "requireAccounts": false,
  "roomCreation": true,
  "jail": false
}
```

### Development Notes

- Node.js 18 LTS required (20+ not supported due to native module compatibility)
- Redis required for session and room state management
- Webpack builds client assets for production deployment
- Service can be run via systemd or Windows NSSM
- All user-facing text rebranded to Dicefiles theme

## Next Steps for Future Development

### Immediate Priorities

1. **User Testing**: Have hobby community members test the platform
2. **Performance Tuning**: Monitor memory usage and optimize file handling
3. **Security Audit**: Review authentication and file upload security
4. **Mobile Optimization**: Test and improve mobile interface

### Potential Enhancements

1. **Advanced Moderation**: Custom room rules, ban appeals, moderation queues
2. **File Categories**: Tagging, search, and organization features
3. **User Profiles**: Avatars, bios, favorite rooms
4. **API Endpoints**: REST API for integrations
5. **Backup System**: Automated Redis and file backups
6. **Analytics**: Usage statistics and room activity metrics
7. **Themes**: Custom CSS themes for different communities
8. **Notifications**: Email/webhook notifications for new files

### Deployment Considerations

- **Production Redis**: Configure Redis persistence and replication
- **File Storage**: Consider external storage (S3, NFS) for larger deployments
- **Load Balancing**: Multiple server instances behind reverse proxy
- **SSL/TLS**: Certificate management and HTTPS enforcement
- **Monitoring**: Logging, metrics, and alerting setup

This development log provides a complete overview of the Dicefiles project transformation from dicefiles. The platform is now ready for hobby community use with a clean, welcoming interface and comprehensive documentation.

## 2026-02-18 - Welcome Room Naming Prompt Visibility Fix

- Fixed welcome intro "Name this room" prompt visibility logic.
- Root cause: client checked `chatbox.role === "owner"`, but owner is delivered via separate `owner` socket event/body class.
- Updated condition to allow rename when user is moderator or body has `owner` class.
- Added listener for `owner` socket updates so visibility refreshes immediately after state changes.
- Behavior now: prompt appears only for default random-named rooms and hides after first custom room naming.

## 2026-02-18 - Welcome Name Control Style Alignment

- Restyled welcome intro "Name this room" field/button to match the visual language of the URL/copy row.
- Applied same bordered translucent container treatment and lighter inline action style.
- Kept functionality unchanged (visibility and submit behavior remain the same).

## 2026-02-18 - Welcome Name Control Icon + Size Match

- Updated welcome room-name action from text button to icon-only submit (same interaction style as copy-link action).
- Increased name-row sizing to align with URL row typography and visual weight.
- Kept behavior unchanged; this is a presentation-only polish pass.

## 2026-02-18 - Welcome Name Field Placement + Width Match

- Moved conditional room-naming control above the intro sentence block.
- Added "Name this room" label above the naming input as requested.
- Matched naming row width to share-URL row width using the same responsive width rule.

## 2026-02-18 - Refresh Login Persistence Fix (HTTP/LAN)

- Fixed cookie parsing for `verifier` in `client/socket.js` (proper cookie parser instead of query-string parsing).
- Added websocket auth fallback for environments where WebCrypto (`crypto.subtle`) is unavailable on insecure origins.
  - Client now sends `v=<verifier>` when signed `s/n` verifier cannot be produced.
  - Server now accepts either signed verifier (`s/n`) or plain verifier match (`v`) against expected value.
- Goal: keep user authenticated after `F5` / `Ctrl+F5` refresh on LAN HTTP room URLs.

## 2026-02-18 - Welcome Rename Input Spacing

- Added `margin-bottom: 2px` to `.welcome_nameinput` in `entries/css/room.css` to improve vertical spacing/alignment inside the room rename panel.

## 2026-02-18 - Rename Button Hover Cleanup

- Removed inherited white hover/focus visuals from `.welcome_namebtn` by overriding global button hover styles in `entries/css/room.css`.
- Rename button now keeps transparent background and no hover border/ring while preserving icon color feedback.

## 2026-02-18 - TODO-5 Native Browser Notifications

- Implemented room-scoped native notifications for new files and new requests.
- Added explicit opt-in workflow (no permission prompt on page load).
- Added per-room settings dialog in hamburger menu: `Enable desktop notifications`, `Notify for new files`, `Notify for new requests`, `Mute this room`.
- Added persistent de-duplication for notification keys across reconnect/reload to avoid re-notifying old items.
- Added notification click behavior: focuses the tab/window and highlights the related file/request row in the file list.
- Added light visual highlight style for notification-targeted file rows.

## 2026-02-18 - Notifications Modal UX Polish

- Reworked Notifications modal layout so each option is displayed on its own dedicated row.
- Added clearer visual hierarchy: option title + helper text, aligned toggle control, and consistent row spacing.
- Improved panel styling with subtle borders/background cards and a clearer permission status area.

## 2026-02-18 - Notifications Modal Row Layout Fix

- Enforced strict vertical row layout for notification options.
- Each setting now renders as exactly one row (label left, checkbox right) to prevent inline wrapping into a single line.
- Kept the gear icon in a left column and settings panel on the right.

## 2026-02-18 - Notifications Modal Icon Removal

- Removed the gear icon from the Notifications modal content area.
- Kept only the settings rows and permission status text in the dialog body.

## 2026-02-18 - Notifications Modal Width Tightening

- Reduced Notifications modal width to fit content (`width: fit-content`) with a sensible max width cap.
- Removed fixed minimum width in the modal body so the dialog no longer stretches wider than needed.

## 2026-02-18 - Modal Polish (Room Options / Room Owners)

- Applied surgical visual polish to Room Options and Room Owners/Invitees dialogs.
- Improved field readability with subtle borders/radius and better spacing.
- Refined action chips (Manage Owners/Invited Users) with gentler rounded styling.
- Enhanced owners list readability with bordered list container, row striping, and cleaner remove button style.

## 2026-02-18 - Room Options Row Compaction

- Renamed `Invite-Only Room` label to `Invite-Only` in Room Options.
- Moved `Invite-Only` and `Adult Content` checkboxes into the same primary row as `Manage Owners`/`Manage Invited Users` to reduce dialog height.
- Added minimal Room Options row styling for consistent alignment and spacing.

## 2026-02-18 - Room Options Button Vertical Trim

- Tightened `Manage Owners` row button metrics in Room Options to remove perceived extra bottom whitespace.
- Applied only to `.roomopts-primary-row > button` with inline-flex alignment and reduced vertical padding.

## 2026-02-18 - Global Modal Action Button Polish

- Refined action buttons across all modal dialogs (`Save`, `Cancel`, `Create`, `Close`, etc.) with consistent shape, spacing, and contrast.
- Added subtle hover/focus transition polish and clearer default/cancel button differentiation.
- Kept behavior unchanged; styling-only update scoped to modal footer actions.

## 2026-02-18 - PDF Metadata Pill Sanitization

- Hardened metadata ingestion in `lib/meta.js` to strip HTML and Markdown syntax from extracted metadata values before they are stored as tags/meta.
- Applies to PDF-derived metadata (and other exiftool-derived metadata paths using the same sanitizer), preventing rendered pills from showing markup artifacts.

## 2026-02-18 - Outbound Tag Sanitization Fallback

- Added outbound tag sanitization in `lib/upload.js` (`Upload.toClientJSON`) so legacy/previously-stored metadata is cleaned before reaching file-list pills/tooltips.
- This complements ingest-time sanitization in `lib/meta.js` and fixes existing room data showing markdown/HTML artifacts.

## 2026-02-18 - File Tag Pill Order and Tooltip Prefix Polish

- Reordered file-list metadata pills to prioritize `author` (`user`/`usernick`) first, then `title`, then `description`, with all other tags following.
- Updated file tooltip metadata labels so `Title:` and `Description:` render as bold, capitalized prefixes for clearer readability.

## 2026-02-18 - Changelog Section Consolidation

- Removed standalone `Post-merge Additions in 1.0.0` and `Post-merge UI Changes in 1.0.0` sections from `CHANGELOG.md`.
- Integrated those entries into relevant `Core Features` subsections (`Room Management` and `Web Interface -> User Experience`).

## 2026-02-18 - Modal Checkbox Greytone Styling

- Applied a shared custom checkbox style for modal dialogs to match Dicefiles greytone UI (neutral dark gradient, subtle borders, soft focus ring, and readable checked mark).
- Scope includes Room Options, Notifications, and other modal checkbox controls without behavior changes.

## 2026-02-18 - Advanced Batch Downloads (TODO-6)

- Implemented retry-on-failure for batch downloads with per-file live status rows in the download modal.
- Added a `Skip existing filenames` option to batch download runs (stored per-room in browser settings).
- Added resumable batch queue persistence in browser storage; unfinished queue resumes after refresh when files list is restored.
- Added final batch report summary in modal with success/failed/skipped counts and per-file terminal statuses.

## 2026-02-18 - Better Library Metadata (TODO-7)

- Extended metadata extraction for document/PDF uploads to include richer book-oriented tags such as `bookauthor` and `pages` when available from exiftool metadata.
- Added optional `suggestedTags` derivation from filename/title/description/author metadata and exposed it in file tooltip metadata.
- Added a one-click copy action in each file row to copy a direct link plus a metadata snippet (title/author/pages/description/suggested tags/link).

## 2026-02-18 - File Metadata Label/Order Corrections

- Normalized metadata label semantics by format: document/book-like files show `Author` for creator metadata, while image/video continue to show `Artist`.
- Enforced file-list metadata pill order as `author`, `title`, `description`, `uploader` (left to right).
- Replaced native pill `title` hover with a styled in-app hover label using capitalized/bold metadata prefixes.

## 2026-02-18 - Page Count Hover + Copy Button Placement

- Added robust page-count extraction fallback across metadata keys and surfaced it as both tag/meta so PDF/EPUB hovers can display page count when present.
- Moved the metadata copy action from the filename cluster to the final detail/TTL column as requested.

## 2026-02-18 - Batch Download Start Gating + Retry Field

- Batch downloads no longer start immediately when opening Download All/New modal; user must press `Start`.
- Defaulted `Skip existing filenames` to enabled for safer repeat runs.
- Made `Retries per file` editable and right-aligned on the same options row before start.

## 2026-02-21 - Release v1.1.0 — Link Archive + PDF/ePub Streaming Reader

- `CHANGELOG.md`: Promoted `[Unreleased]` section to `[1.1.0] - 2026-02-21` with full feature entries for Link Archive and Streaming PDF/ePub Reader.
- `README.md`: Updated version badge from `1.2.0` → `1.1.0`; added Links Archive bullet to the Features list.
- `package.json`: Updated version from `2.0.0` → `1.1.0` to match release.
- Redis: Removed hardcoded test link (`testlink001`) from `map:links:links` hash.
- Git: Committed all staged changes and tagged `v1.1.0`; pushed to origin.

## 2026-02-21 - GIF Overlay Width + Infinite Scroll

- `entries/css/room.css`: Reduced `.gif-menu` width from `calc(100% - 0.3rem)` to `95%` and adjusted `left` from `0.15rem` to `2.5%`.
- `client/chatbox.js`: Added `gifPagQuery`, `gifPagProvider`, `gifPagNext`, `gifPagLoading` pagination state fields.
- `client/chatbox.js`: Attached scroll listener to `gifGridEl` in `initGifMenu`; triggers `loadMoreGifs()` when scrolled within 60px of the bottom.
- `client/chatbox.js`: `searchGifRealtime` now resets pagination state and stores the `next` cursor returned by the provider.
- `client/chatbox.js`: New `loadMoreGifs()` method fetches the next page using the stored cursor and appends results via `renderGifGrid(..., true)`.
- `client/chatbox.js`: `searchGiphy(query, offset=0)` — added `offset` param, threads `&offset=N` into the URL, returns `{ results, next }`.
- `client/chatbox.js`: `searchTenor(query, pos="")` — added `pos` param, threads `&pos=` into Tenor v2 URL, captures `body.next`, returns `{ results, next }`.
- `client/chatbox.js`: `searchTenorLegacy(query, key, limit, pos="")` — added `pos` param, threads `&next=` into Tenor v1 URL, returns `{ results, next }`.
- `client/chatbox.js`: `renderGifGrid` — added `append=false` param; when `true`, appends items without clearing the grid or updating the status text.

## 2026-02-21 - GIF Overlay Vertical Alignment with Chat Sidebar

- `entries/css/room.css`: Added `position: relative` to `#chat` to create a positioning context.
- `entries/css/room.css`: Replaced `.gif-menu` absolute positioning (`left/bottom/width/max-height/transition/border/border-radius/box-shadow`) with `inset: 0; border-radius: 0` so the overlay fills `#chat` exactly.
- `entries/css/room.css`: Removed `.gif-menu.has-results { max-height: 20rem }` override (no longer needed).
- `entries/css/room.css`: Changed `.gif-grid` from `max-height: 14rem` to `flex: 1; min-height: 0` so the grid fills all remaining space in the menu panel.
- `client/chatbox.js`: Added `this.chat = document.querySelector("#chat")` to constructor (before Object.seal).
- `client/chatbox.js`: Changed gif-menu append target from `this.status` to `this.chat`.

## 2026-02-21 - Links Archive: Skip GIF Provider URLs

- `lib/client.js`: Modified chat message handler before calling `Link.create`.
  - Parse the URL and inspect hostname.
  - If the host ends with `giphy.com`, `tenor.com`, or `tenor.googleapis.com`, skip link creation entirely.
  - Added try/catch around `new URL()` to avoid throwing on malformed URLs.

This ensures GIFs inserted via the GIF picker are not stored in the Links Archive.

---

## 2026-02-21 - Chore: workspace sanitation guidance & cleanup

### Summary

Added explicit instructions to `AGENTS.md` for removing temporary usage
files during playtesting. This covers the uploads directory, log files,
cache directories, and optional Redis state flush. Then performed a
cleanup of the current workspace by deleting all contents of `uploads/`
and truncating `server.log` and `ops.log`.

### Files Modified

- **`AGENTS.md`** — new "Temporary Usage Cleanup (Playtesting)"
  section describing which directories and files agents should delete
  when the user requests a clean workspace.
- **`DEVELOPMENT_LOG.md`** — this entry.

### Actions Taken

- `uploads/` directory emptied (gitignored).
- `server.log` and `ops.log` truncated and committed.

The repository now resembles a fresh clone with no user-generated
artifacts.

### Changed Files

- **`lib/meta.js`**

---

## 2026-02-21 - Chore: ignore runtime logs and reinforce cleanup policy

### Summary

Added `server.log` and `ops.log` to `.gitignore` and untracked them from git.
This prevents accidental commits of log output as the files fill. Also
expanded the Temporary Usage Cleanup section in `AGENTS.md` to emphasise
that cleanup must be performed _before any major commit or push_ so that
transient files never make it into the repository.

### Files Modified

- **`.gitignore`** — added `server.log` and `ops.log` entries.
- **`AGENTS.md`** — enhanced cleanup policy text with pre-push requirement.

### Actions Taken

- Executed `git rm --cached server.log ops.log` to remove logs from index
  (they remain on disk until next log write but are now ignored).
- Committed and pushed the `.gitignore` change.

This closes the loop on the earlier workspace sanitation guidance.

---

## 2026-02-21 - Chore: ignore .vscode and update cleanup docs

### Summary

Added `.vscode/` to `.gitignore` and removed its only tracked file
(`settings.json`). Updated the Temporary Usage Cleanup section in
`AGENTS.md` to mention editor metadata directories specifically. This
keeps personal IDE settings out of the repository and reinforces the
pre-push cleanup requirement.

### Files Modified

- **`.gitignore`** — added `.vscode/`.
- **`AGENTS.md`** — added bullet about ignoring/deleting `.vscode`.

### Actions Taken

- Executed `git rm --cached -r .vscode` to untrack existing file.
- Committed and pushed the ignore rule.

---

## 2026-02-21 - Release: v1.1.0 retagged & GitHub release reissued

### Summary

The original GitHub release v1.1.0 was removed and the tag moved to the
current HEAD (commit `e95af3d` which includes log/.vscode cleanup). The
release was then recreated with the same title and notes as before. This
ensures the published archive does not contain any of the temporary log or
editor metadata files that were present when the first release was drafted.

### Details

- Deleted remote release via `gh release delete v1.1.0`.
- Removed old tag locally and on origin; then re-annotated it at HEAD.
- Pushed new tag to origin.
- Used existing `/tmp/release-notes-v1.1.0.md` file (same contents as first
  time) to recreate the GitHub release with `gh release create`.

The public release now matches the current repository state and omits
transient artifacts.
