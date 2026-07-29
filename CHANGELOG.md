# Changelog

## [1.4.5] - 2026-07-29 [Community Access and Storage Tiers]

Dicefiles can now protect a community room with a rotating shared password and
place new content safely across multiple storage directories. Both features are
opt-in and preserve existing single-volume, unprotected-room behavior.

### Upgrade notes

- Node.js **22 or newer** and Yarn 1.x remain required. Run `yarn install`,
  then `yarn prestart`, and restart Dicefiles normally.
- Existing installations need no storage migration. With no `storage.volumes`
  entries, Dicefiles continues using the existing `uploads` directory. Add
  volumes only after their directories are mounted and writable.
- Existing rooms remain unprotected. Owners explicitly enable a community
  password from Room Options → Access; generated secrets are stored in Redis
  using the instance's existing secret material.
- Automation clients need the new `storage:read`, `room-access:read`,
  `room-access:write`, `room-access:secrets`, or `room-access:bypass` scopes
  only for the corresponding new operations.
- Rollback to v1.4.4 is code-only when no new volumes were enabled. If content
  was written outside the legacy `uploads` root, retain the v1.4.5 storage
  configuration or move those blobs back before rollback. Password-protected
  rooms should be disabled before returning to v1.4.4.

### Added

- **Multi-volume storage:** operators can configure several durable storage
  roots and choose balanced or primary-then-fallback placement. New physical
  blobs retain their selected `volumeId`; deduplicated files remain on their
  existing volume and legacy records continue resolving through `uploads`.
- **Capacity-safe uploads:** resumable browser uploads and programmatic
  buffer/stream ingestion use Redis-backed, expiring per-volume reservations.
  Hard fill limits and absolute free-space reserves fail closed before a write
  is accepted.
- **Storage operations:** `/healthz` reports privacy-safe per-volume state.
  Scoped operator endpoints and MCP tools inspect volume health and preview
  placement without writing or exposing paths to public status telemetry.
- **Rotating room passwords:** Room Options includes an Access tab for an
  opt-in shared community password, calendar-month or fixed-day periods,
  prepared-next credentials, custom passwords, and emergency rotation.
- **Period-bound access grants:** successful visitors receive an HTTP-only,
  browser-bound grant that expires at the credential boundary. Owners and
  moderators bypass the prompt; invite-only rooms require both checks.
- **Protected content boundaries:** page entry, live sockets, downloads,
  archive browsing, comic reading, local linking, and federation enforce the
  room gate. Protected rooms cannot become linked or federated sources.
- **Scoped automation:** REST and MCP surfaces separate password policy reads,
  policy changes, and raw credential reveal into `room-access:read`,
  `room-access:write`, and `room-access:secrets`.

### Changed

- **Clearer Access controls:** rotation settings use compact aligned fields,
  password actions sit beside the credential entry, and generated current/next
  credentials appear in a normalized period table. Rooms with no generated
  credential show a clean empty row instead of an epoch date.

### Security

- Room passwords are verified with Argon2id. Revealable owner copies are
  encrypted with AES-256-GCM under an instance-derived key and never enter
  exported room configuration, public telemetry, logs, or ordinary API reads.

## [1.4.4] - 2026-07-29 [Federated Communities]

Dicefiles can now link approved rooms across trusted independent hosts and
gives room owners safer, observable ways to run community automation.

### Upgrade notes

- Node.js **22 or newer** is required. Continue using Yarn 1.x and the committed
  `yarn.lock`; run `yarn install`, then `yarn setup:ubuntu` on Ubuntu/WSL hosts
  that need preview tooling.
- Federation and authenticated bot commands remain opt-in. Existing rooms,
  local room links, files, and plugin configurations continue to work without
  enabling either feature.
- Existing account password hashes remain valid and are transparently upgraded
  to the current Argon2id format after a successful sign-in.
- Rollback to v1.4.3 is code-only: stop Dicefiles, check out `v1.4.3`, run
  `yarn install` and `yarn prestart`, then restart the service. The new room and
  operator configuration fields are additive and are ignored by v1.4.3.

### Added

- **EPUB page curls:** page navigation now uses a soft, book-like curl
  transition that also works across chapter boundaries. Rapid turns are
  safely queued, while reduced-motion preferences retain instant navigation.
- **Advanced linked-file rules:** destination links can now filter filename,
  tag keys/values, and uploader usernames with backward-compatible comma/OR
  terms, explicit AND logic, or validated regular expressions. Inline syntax
  help and API/MCP validation keep complex rules understandable and fail
  closed when an expression is invalid.
- **Trusted-host federation:** independent Dicefiles servers can form a small,
  manually pinned trust group and link approved remote rooms without sharing
  Redis, accounts, or storage. RFC 9421 signatures, replay protection,
  operator room allowlists, source-room consent, cursor lists, remote TTL,
  ranged fetch-through, per-peer limits, and circuit isolation protect the
  cross-host path.
- **Federation controls:** Room Options can add a trusted peer room and opt a
  source room into federation. Scoped REST and MCP operations manage links,
  source policy, and peer health without exposing private keys to browsers or
  automation clients.
- **Federation operations:** durable ActivityStreams invalidations, aggregate
  peer health on the protected status page, a bounded audit API, guided
  two-phase key rotation, additive old/new key acceptance, and an isolated
  two-host smoke test cover the complete operator lifecycle.
- **Room-bot automation:** scoped REST endpoints and four new MCP tools list,
  configure, remove, and run invited room bots. Stored credentials are redacted
  from reads, omitted secrets survive partial updates, and recent run outcome
  and counts are retained for operators.
- **Authenticated community commands:** Discord signed interactions and
  Telegram secret-token webhooks can execute an explicit per-room command and
  caller allowlist for status, open-request viewing, request creation, and
  bot-attributed chat. Arbitrary command or code execution is not exposed.
- **Remote host import foundation:** a shared, allowlisted downloader registry
  now powers Mega.nz and the new Remote Host Import bot. Pixeldrain file and
  list links are the first additional provider, using its official API with
  bounded, streamed downloads.
- **Plugin import controls:** Room Options now shows each bot's latest run and
  remembered import count, with refresh and explicitly confirmed “Forget
  imports” controls. Matching REST and MCP operations expose the same bounded
  state without returning credentials.

### Changed

- **Mobile chat pickers:** emoji and Giphy selectors now open below the chat
  toolbar in the stacked mobile layout, keeping the upper chat history clear.
- **Clearer status charts:** the operator dashboard now shows five days of
  uploaded and downloaded transfer volume in smooth, solid two-hour lines with
  readable MB/GB/TB axes. Request history uses two-hour stacked availability
  bars split into unfulfilled and fulfilled requests.
- **Account achievements:** `/account` now exposes the existing achievement
  trophy room as a first-class tab, using the same milestone progress, rarity
  styling, and public-profile cards as `/u/:username`.
- **Safer bulk deletion:** deleting every visible file from the room header now
  requires an explicit confirmation that includes the affected file count. The
  dialog gives keyboard focus to Cancel, while the server continues to enforce
  moderator/owner privileges and limits ordinary users to their own uploads.
- **Supported runtime:** Node.js 22 or newer is now required by the federation
  stack. Yarn 1.x and `yarn.lock` remain the supported install path.
- **Maintained dependency baseline:** PDF.js, Sharp, the MCP SDK, federation
  libraries, Webpack, EJS, and their exposed runtime dependencies have been
  moved to maintained security-patched versions.
- **Production-hard plugins:** scheduled room bots use cross-worker leases.
  Mega.nz Autoshare defaults to 50 files, 256 MiB per file, and 1 GiB per run,
  with configurable positive limits and reasoned skip counts.
- **Safer importer memory:** Mega.nz uses stable provider node identities when
  available, keeps compatibility with old name-and-size records, and checks
  existing room content hashes before creating another file. Remote downloads
  flow through a size-limited temporary file instead of being buffered in RAM.
- **Responsive Room Options:** compact tab sizing, denser cards, centered
  actions, inline plugin validation, and a reduced plugin table keep the modal
  usable on narrow screens.
- **Automation file views:** `GET /api/v1/files` now includes local, linked, and
  federated rows subject to the same destination visibility rules as the room.

### Security

- The unmaintained password wrapper has been replaced with a local,
  compatibility-preserving Argon2id implementation. Legacy plaintext-wrapper,
  PBKDF2, and earlier Argon2 records can still authenticate once and are then
  rehashed with the stronger current policy.
- PDF.js now runs with runtime code generation disabled, allowing the browser
  policy to remove `unsafe-eval` from `script-src`.
- Remote filename/tag/uploader rules are evaluated by the source host before
  privacy-safe rows cross the network; source uploader and tag metadata remain
  private.
- Federated proxy downloads now re-check destination-room membership and
  per-link visibility instead of treating possession of a proxy URL as access.
- Federation network timeouts start after local signature creation, and remote
  key/signature/protocol errors preserve stable diagnostic codes.

### Fixed

- **Document readers:** PDF, ePub, MOBI, AZW, and AZW3 readers now import their
  client helpers explicitly, preventing the `dom is not defined` failure when a
  document is opened.
- **Federated lists:** the source list endpoint now reads the upload emitter
  correctly; the previous raw-map call could terminate a worker on the first
  remote file-list request.
- **Room restoration:** concurrent first requests for a restored room now share
  one in-flight load, preventing duplicate room objects, event listeners, and
  startup listener warnings. The room-scaled file, request, and link emitters
  also declare their intentional unbounded listener model.

### Documentation

- Added implementation-ready, explicitly unshipped proposals for
  [multi-volume storage](docs/MULTI_VOLUME_STORAGE.md) and
  [password-protected rooms](docs/PASSWORD_PROTECTED_ROOMS.md).

## [1.4.3] - 2026-07-28 [Since Your Last Visit]

Dicefiles now remembers the useful context around a room: what arrived while
you were away, what you were reading, which requests changed, and which linked
rooms contributed new material.

### Highlights

- **Since Your Last Visit:** a compact return strip counts only other people’s
  uploads, bot releases, linked-room arrivals, new requests, and newly
  fulfilled requests. The grouped digest can download every new file, mark the
  room seen, and clears itself when the user catches up.
- **Continue reading:** PDF, ePub, MOBI/AZW, and comic progress is timestamped
  per room and survives the pre-1.4.3 storage format.
- **Operator dashboard:** `/status` visualizes service health, segmented uptime
  history, storage, files, users, downloads, traffic, preview failures, and
  request creation/fulfillment without exposing room, account, or file names.
  A generated capability link protects it by default.

### Added

- **Discord and Telegram publishers:** room owners can invite distinct release
  bots that announce direct and linked-room arrivals with safe file links,
  optional topic/thread targeting, bot-upload suppression, retries, and
  Redis-backed one-time delivery.
- **Reactive plugin API:** plugins can subscribe to room lifecycle events and
  use injected HTTP, event-lease, room/file read, chat-write, and upload
  capabilities instead of importing core internals.
- **Linked-room access controls:** each destination link can be visible to
  everyone, authenticated users, members, owners, or moderators. Invite-only
  sources require explicit consent from both rooms.
- **Room automation:** scoped REST and MCP operations can list, add, and remove
  room links and list, mint, and revoke guest invites.
- **Guest-invite operations:** configurable active-link caps and bounded,
  privacy-safe create/redeem/revoke history now appear in Room Options.
- **Preview installation and repair:** repository diagnostics, Ubuntu/WSL setup,
  Poppler PDF fallback, safer media classification, backfill tooling, and
  purposeful archive placeholders make gallery covers more reliable.
- **New-member marker:** uploads identify users who joined the room within the
  configurable `newRoomMemberDays` window (seven days by default).
- **AI development scaffold:** concise agent instructions, stable-server and
  generated-file rules, review/release checklists, decision template, and
  security-reporting policy.

### Improved

- **Request Board:** filters persist per room, deep links restore board state,
  and the fulfillment action reads **Fulfill**.
- **Room Options:** invite tables use compact one-line values, centered rows and
  actions, responsive columns, inline generated-link copying, stable
  bottom-first dialog resizing, and theme-compatible plugin settings.
- **Mobile rooms:** filters and view modes occupy two centered logical rows;
  chat/file separation, banner scrollbar clearance, compact room banners, and
  gallery spacing are clearer on thin displays.
- **Account and dialogs:** the original account layout is polished without a
  redesign; two-factor controls share one row; Report Room has clearer labels,
  validation, spacing, and responsive sizing.
- **Default retention:** new room content now defaults to five days (`TTL: 120`)
  instead of 48 hours.
- **MCP server:** the tool inventory grows from 14 to 20 and now covers linked
  rooms and guest invites with typed schemas.
- **Development handoff:** one stable WSL service replaces hot reload, Webpack
  watch mode, and Nodemon for user testing.

### Security

- Guest credentials are removed from the address bar after capture, and
  generated deep links discard invite tokens and unrelated intents.
- Hidden and hellbanned rows, request cards, and unauthorized private-source
  files never cross room-link boundaries.
- Local configuration, environment files, credentials, uploads, Redis state,
  logs, databases, browser artifacts, and private keys are excluded from new
  commits; `SECURITY.md` documents private reporting.

### Fixed

- Own uploads no longer make the Since Your Last Visit strip appear.
- Newly linked rooms contribute arrivals against the prior visit baseline
  without repeatedly rediscovering older mirrors.
- Fulfilled requests carry a fulfillment timestamp instead of being mistaken
  for newly created requests.
- Existing reader positions remain resumable, and opening one room no longer
  deletes progress belonging to another.
- Redis 5 sorted-set range compatibility restores Top Users pages.
- Image and PDF thumbnails fall back cleanly when optional native tools are
  missing, while archives retain recognizable gallery placeholders.

### Upgrade Notes

- Protected status access is enabled by default. On first start, Dicefiles
  writes `statusPageToken` to local `.config.json`; use `/status/<token>`.
  Set `statusPagePrivate: false` only when intentionally publishing telemetry.
- Deployments that relied on the 48-hour default should set `"TTL": 48`
  explicitly; otherwise the default is now 120 hours.
- Install or verify preview tools with `yarn setup:ubuntu` and
  `yarn check:preview-tools`. No Redis or upload migration is required.

## [1.4.2] - 2026-07-27 [Rooms that link, invite, and run bots]

Multi-room file mirrors, a real request board, shareable deep links, guest invite links, in-process plugins (Mega.nz Autoshare), and a Room Options UI that power users can live in.

### Added

- **Multi-room linking:** Destination rooms list finished uploads from other rooms (view/fetch-through, not a second disk copy), marked **Linked · &lt;name&gt;**. Open, Read Now, and download use the source file; trash and moderation stay with the source room.
- **Allow room cross-linking** (source opt-in, default off): other rooms may mirror this room’s finished uploads only when enabled. Knowing a room id or name alone is not enough.
- **Linking tab (Room Options):** Table of linked sources (add by room id or exact name, edit, remove). Per-link filters/rules: filename contains (comma-separated, match any), tag contains, file types (3×2 grid; none = all), no older than / at least this old (hours). Status column: Active, Cross-link off, or Missing. In-panel **?** help for power users.
- **Request board:** First-class open/fulfilled board when Allow Requests is on, with Create Request and Request board as a segmented toolbar pill.
- **Shareable deep links** (room option, default off): query/hash intents for `file`, `filter`, `sort`, and `request` when enabled. Bare gallery `#fileKey` still works when the option is off.
- **Guest invite links (Invites tab):** Mint single-use, max-uses, and/or max-hours links for invite-only rooms; list active invites with copy-to-clipboard and revoke; redeem at `/r/:id?invite=TOKEN` with a guest pass so multi-use links are not re-burned on every refresh.
- **Plugins & bots (Plugins tab):** Invite bots from the server registry into a room, set config, enable/disable, and **Run now**. Plugin uploads show a cyan **BOT** pill and bot display name (not a fake human account).
- **Mega.nz Autoshare:** First-party plugin that monitors a Mega.nz folder on a poll interval, downloads new files, and shares them into the room as the Mega.nz Autoshare bot (`megajs` optional dependency).
- **Webhook events:** `linked_file_appeared`, `guest_invite_created`, `guest_invite_redeemed` (plus existing upload/request/delete events) for external bots and automation.

### Improved

- **Room Options:** Tabbed **General / Invites / Linking / Plugins** layout, capped dialog width, section cards, and compact **?** help next to cross-linking.
- **Toolbar:** Uniform control height, icon size, and gaps; filter field fills space to the action pills; clear (X) sits inside the filter field.
- **Dark-theme scrollbars** for native and custom scrollers across the product.
- **README** rewritten for operators and power users (1.3→1.4 story, room capabilities, automation without internal jargon).

### Docs / tests

- Plugin guides under `core/plugins/`; product docs under `docs/` with `FUTURE_DEVELOPMENT_PLAN.md` and `docs/archive/` for historical material.
- Unit coverage for link helpers, deep-links, request-board, guest invites (pure + owner RPC), webhooks events, plugin registry/adapters, and room-plugin runtime.

## [1.4.1] - 2026-07-27 [Room UI polish]

Surgical room UI polish — no redesign. Clearer feedback, sticky preferences, dead GIF provider removed.

### Improvements

- **Filters & sort stick across reloads** in each room (type filters, text filter, “show new only,” sort mode). Active sort / show-new buttons use the same selected look as list/gallery/links.
- **Gallery “Read Now”** shows a loading state while the in-page reader loads, avoids double-open, and supports keyboard **R**.
- **Archive browser** has clearer loading / empty / search-empty / error messages when listing zip/rar/etc.
- **Batch download** handles the empty queue honestly (no fake “preparing…”) and exposes progress more clearly.
- **GIF search is Giphy only.** Google discontinued the public **Tenor API** on **2026-06-30**. Tenor is removed from the chat GIF control (single Giphy button — no multi-provider pill), search code, `core/gif-providers.json`, and CSP `connect-src`. Old Tenor media URLs in chat still embed when the CDN serves them.

### Fixes

- **Filter text field no longer grows/shrinks** on focus/blur (removed legacy `flex: 5` animation on `#filter:focus` / `:valid`).

### Tests

- Expanded unit coverage for shipped list-state helpers (sort/filter serialize/restore).

## [1.4.0] - 2026-07-27 [Code Overhaul & Redis v4 Migration]

This release is a **platform overhaul**: cleaner internal architecture, a supported Redis client stack, faster large rooms, and deeper operator health signals. Product features and public automation API paths stay compatible with the 1.3.x line.

### Highlights for operators

- **Redis v4** — Dicefiles now talks to Redis through **node-redis 4** with a dedicated broker adapter. Existing Lua scripts (distributed maps/sets, rate limits, tracking, message removal) keep working; connect/load is explicit and promise-based.
- **Yarn-only install** — `yarn.lock` is the single source of truth. `package-lock.json` is removed; Node **≥ 20** is required (`package.json` `engines`).
- **Smarter large rooms** — the file list virtualizes when there are many files, so scrolling stays responsive instead of mounting every row at once.
- **Lighter first paint** — PDF/EPUB/MOBI readers and the archive browser load on demand instead of inside the initial room shell.
- **Richer `/healthz`** — Redis latency, storage writability, disk free/total (when available), preview-queue depth, process pid/uptime, plus existing counters.

### Improvements

- Modularized server HTTP helpers, automation auth/rate limits, WebSocket setup, media pipeline, and client reader formats into focused modules (easier upgrades without changing public routes).
- Webpack CSS pipeline modernized for Webpack 5 (`css-loader` 6, `mini-css-extract` 2, `css-minimizer-webpack-plugin`).
- Replaced abandoned or awkward dependencies (`colors` → `picocolors`, recursive `fs.mkdir` instead of `mkdirp`, current `lru-cache` API).
- Default worker count capped more conservatively so small hosts are not oversubscribed (still override with `"workers"` in `.config.json`).
- Upload tag sanitization extracted for reuse and testing; expanded unit coverage (windowing, list-window scroll re-window, Redis adapter, live broker, session verifier, health ops).

### Fixes

- File-list re-windowing on scroll uses the **full** filtered file list, not only currently mounted DOM rows (so large rooms keep virtualizing while you scroll).
- Redis command path no longer mixes callback + promise settles (eliminates hung `set`/`get` and client queue desync under load).
- **Upload key registration under Redis v4**: coerce hash field values to strings so `HSETNX` accepts numeric `offset`/`ttl` (node-redis v4 encoder).
- **Virtualization on sealed Files controller**: declare `_virtStart` / `_virtEnd` / `_rowHeightHint` before `Object.seal` so scroll re-windowing does not throw.

### Verification

- Live systemd deployment on port 10005; browser + API E2E covered Redis-backed room/session/upload/list/request/socket paths.

### Upgrade notes

1. **Node 20+** and **Yarn 1.x** (`yarn install`).
2. **Redis** remains required; Redis 6/7 servers work with the new client. Restart Dicefiles after deploy so workers pick up the new broker.
3. Rebuild the client: `yarn prestart` (or `yarn start` after prestart).
4. Confirm health: `curl -s http://127.0.0.1:<port>/healthz` should report `ok: true` with `checks.redis` and `checks.storage`.

### Docs

- README install path clarified (Yarn, engines, Redis v4, health checks).
- [docs/PERF_NOTES.md](docs/PERF_NOTES.md) — virtualization and payload notes.
- [docs/archive/OVERHAUL_AND_OPTIMIZATION_PLAN.md](docs/archive/OVERHAUL_AND_OPTIMIZATION_PLAN.md) — architecture plan (phases 0–5; archived).

### Supply chain

- Prefer `yarn audit` on a schedule. High-severity **dev-only** transitive findings (e.g. Jest → `js-yaml`) are not on the production server path; upgrade Jest when convenient.

## [1.3.2] - 2026-03-17 [Request Achievements & Manual Release Posture]

### Added

- **Completed-request achievements**: User profiles now include a new achievement track for fulfilling requests. Logged-in users progress through dedicated milestones as they resolve open requests for others, giving the request workflow its own visible progression instead of folding everything into raw upload/download stats.

- **Request-creation achievements**: A lightweight three-step achievement track now rewards users for trying the request system itself, with milestones at **5**, **25**, and **100** created requests. This is intentionally a simple discovery-oriented track to encourage room members to use and test the feature.

### Changed

- **Achievement roster rounded to 80 total milestones**: the profile trophy room now includes both request-based tracks, bringing the full achievement count to an even 80 while keeping the rest of the progression system unchanged.

- **Release posture is explicitly manual**: repository docs now consistently reflect that GitHub Actions workflows have been removed and that testing, tagging, and publishing releases are performed manually by the maintainer.

## [1.3.1] - 2026-02-23 [Security Hardening]

### Security

- **Admin config endpoint no longer exposes third-party API keys**: `opengraphIoKey` has been removed from the `ADMIN_CONFIG_WHITELIST`. `GET /api/v1/admin/config` now returns only runtime-mutable feature flags and thresholds; API keys configured in `.config.json` are no longer reflected back through this endpoint, preventing accidental exposure to any client that holds an `admin:config`-scoped key.

- **HTTPS reverse-proxy requirement documented**: The _Security Posture_ section in `README.md` now includes a mandatory HTTPS section that clearly states sessions, bearer tokens, and file content travel in plaintext over plain HTTP. The section provides a complete nginx config block for TLS termination via reverse proxy, a built-in TLS (`tlsCert`/`tlsKey`) alternative, and a table listing the specific assets and their associated risk when deployed without TLS.

- **All automation API keys rotated to 64-character hex values**: The three keys in `.config.json` (`test-read`, `test-upload`, `test-mod`) have been replaced with cryptographically random 256-bit hex strings. The previous short, guessable keys (`dicefiles-test-read-2026` etc.) are no longer valid.

- **Session secret set to a strong 64-character hex value**: The `secret` field is now explicitly set in `.config.json`, replacing the `"dicefiles"` hard-coded default that was previously used for session and CSRF signing.

- **opengraph.io API key cleared from runtime config**: The key has been removed from `.config.json`. Link title enrichment falls back to the built-in HTML scraper automatically; the operator should obtain a fresh key from their opengraph.io dashboard and re-add it when ready.

## [1.3.0] - 2026-02-23 [Archive Viewer, MCP Server, Security & Activity]

### Added

- **Archive Viewer**: Clicking on an archive file (.zip, .rar, .7z, .001, .tar, .tar.gz, and multi-part RAR) now opens an interactive archive browser modal instead of downloading the file immediately. The modal shows a collapsible folder tree on the left and a flat file list on the right. Folders and individual files can be selected via checkboxes; selecting a folder automatically includes all files it contains. The "Download Selected" button passes the chosen files to the existing batch download modal, preserving concurrency, retry, and skip-existing controls. Each archive file in the list shows a compact pill badge (e.g. "ZIP · 42 files") in the tags column so the file count is visible at a glance. Powered by `lib/archive.js` (ZIP via yauzl, RAR/7z/TAR via system tools) and two new API endpoints: `GET /api/v1/archive/:key/ls` and `GET /api/v1/archive/:key/file?path=...`.

- **Public room directory**: When `publicRooms: true` is set in the project configuration, the home page becomes a live directory of all registered rooms sorted by file count. Each entry links directly to the room and shows its current file count and number of online users. Disabled by default so existing deployments are unaffected.

- **Automatic room pruning**: Rooms that have received no file uploads or chat messages within the last 21 days are automatically deleted, including all their files and Redis state. The prune cycle runs once at startup (60 s delay) then every 24 hours. Configurable via `roomPruning` (on/off) and `roomPruningDays` (default 21) in the project configuration file.

- **Latest Activity tab on user profiles**: Each user's profile page now includes a "Latest Activity" tab showing their most recent 20 uploads and downloads. Each row displays an upload or download icon, the file name (linked to the file's share page), human-readable file size, and a relative timestamp. The tab is hidden when there is no activity yet. Activity recording can be disabled site-wide with `profileActivity: false` in the project configuration file.

- **MCP server for AI clients** (`scripts/mcp-server.js`): A Model Context Protocol server is now bundled with the project, wrapping all automation API endpoints as 13 named, schema-validated tools. AI clients — Claude Desktop, Cursor, Continue, OpenClaw, AutoGen — can discover and call Dicefiles operations directly without writing HTTP code. Stdio mode (default) works out of the box with Claude Desktop; Streamable HTTP mode supports remote orchestrators. See `MCP.md` for setup instructions, Claude Desktop config JSON, and the full tool reference.

- **Per-tile download button in gallery mode**: Each cover tile in the gallery grid now shows a circular download button in its top-right corner, visible on tile hover. Clicking it downloads the file directly without opening the lightbox. The icon color adjusts automatically between light and dark based on the cover art's average brightness so it stays readable on any thumbnail.

- **Sort controls redesigned with icons**: The sort buttons in the file browser (newest / largest / expiring) now display compact inline icons instead of text labels. A lightning bolt indicates newest-first, a descending bar chart indicates largest-first, and an hourglass indicates expiring-soon. The active sort method is always highlighted with an accent background.

- **"Show new files" button integrated into the filter bar**: The "Show only files newer than your last visit" toggle is now part of the filter pill as its rightmost button, placing all file-type and visibility controls in one consistent row.

- **Per-account login lockout**: failed login attempts against the same account now trigger a configurable cool-down. After 10 failures (default) within a 15-minute window the account is temporarily locked and further attempts are rejected with a clear error. Both thresholds are tunable via `loginAccountFloodTrigger` and `loginAccountFloodDuration` in the project configuration file.

- **opengraph.io link title enrichment**: The Links Archive now optionally uses [opengraph.io](https://www.opengraph.io/) to resolve link titles. When `opengraphIoKey` is set in the project configuration, titles are fetched via the opengraph.io API (which follows redirects, handles JavaScript-rendered pages, and returns the OG `title` field when present) instead of the built-in HTML `<title>` scraper. Falls back to inline scraping automatically when the API key is unset or when the API call fails, so existing deployments keep working without any configuration change.

- **Centralized input validation** (`lib/validate.js`): all register, login, and password-change routes now route their inputs through typed validation helpers (`requireString`, `optionalString`, `requireRoomId`, `requireNick`, `validatePassword`). Malformed requests receive explicit 400 responses instead of silent no-ops or server errors.

- **CI security audit** (`.github/workflows/security.yml`): every push and pull request to `main`, as well as a weekly scheduled run, now executes `npm audit --audit-level=high` to surface newly disclosed high-severity vulnerabilities automatically.

- **XSS regression test suite** (`tests/unit/xss.test.js`): covers `<script>` injection, `onerror=` attribute injection, `javascript:` and `data:` URI href patterns in chat rendering, plus full unit tests for all `lib/validate.js` helpers.

- **Memory-hygiene test suite** (`tests/unit/memory-hygiene.test.js`): covers ObservableMap event-lifecycle correctness under 1,000-cycle churn, and automation rate-state size-cap enforcement.

- **Security Posture documentation**: `README.md` now includes a dedicated _Security Posture_ section covering the effective Helmet 7 headers table, default HTTP/HTTPS ports, and Firejail sandboxing behaviour.

### Changed

- **Uploader pill now opens the uploader's profile page**: Clicking an uploader or requester name pill in the file list now opens that user's profile page in a new browser tab. Previously, clicking the pill set a username filter on the file list.

- **File type icon consistently downloads the file**: The coloured icon preceding each file name in the file list now triggers a download for all users. Previously it only acted as a download shortcut for room moderators; regular users received a plain navigation to the file's share URL instead.

- **Stronger password requirements**: minimum raised to 12 characters and must include at least one uppercase letter, one lowercase letter, and one digit (previously 10-character minimum with letter + digit rule). Validation is now handled centrally by `lib/validate.js`.

- **Startup secret enforcement in production**: the server now calls `process.exit(1)` during startup when `NODE_ENV=production` and the configured `secret` is weak or matches a known default. In development mode a warning is still printed but startup continues.

- **Helmet upgraded from 3.x to 7.x**: the `HSTS` header is now sent only when `req.secure` (`https:` request); `X-Powered-By` is suppressed; deprecated `xssFilter` and `ieNoOpen` options removed. `Cross-Origin-Opener-Policy`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff` are now active by default.

- **`url-regex` replaced with `url-regex-safe`**: eliminates a ReDoS vulnerability in the URL-detection regex used during chat message rendering. The replacement is API-compatible.

- **Firejail sandbox logging**: the server now probes for the Firejail binary during startup and logs its status — `[security] Firejail sandbox: active` or a warning when the binary is not found and sandboxing falls back to direct execution.

- **Distributed automation rate limiting**: `checkAutomationRateLimit` is now Redis-backed using the same Lua sliding-window script used elsewhere in the server. Per-scope limits are configurable by operators. Falls back gracefully to in-process limiting when Redis is unreachable.

- **Automation rate-state size cap**: the in-process fallback rate-limit map is now capped at 50,000 entries; when the cap is reached a diagnostic warning is emitted and the request is rejected. This prevents unbounded memory growth under adversarial traffic.

### Fixed

- **`request_fulfilled` webhook now fires on status transition**: the webhook was previously only dispatched when an unfulfilled request was deleted. It now also fires when `setStatus("fulfilled")` is called — i.e. when a participant fulfills a request through the UI. The delete path is guarded to prevent double-firing for already-fulfilled items.

- **`BROKER` not imported in automation rate-limit path**: `BROKER.emit()` was called in `lib/httpserver.js` before `BROKER` was ever imported. The module import was missing; this caused a `ReferenceError` (silently masked in single-worker setups where the import-time evaluation path was not reached). Added as part of the distributed rate-limiting work.

## [1.2.0] - 2026-02-22 [Comics, Links, Polished Reading Experience]

### Added

- **Allow Requests room option**: Room owners now have an "Allow Requests" checkbox in Room Options (on by default). When disabled, the "Create Request" button disappears for all users and the server rejects any attempt to create requests in that room. The site-wide default can be set via `allowRequests: true|false` in the project configuration file.

- **Link Collection room option**: Room owners now have a "Link Collection" checkbox in Room Options (on by default). When disabled, the Links Archive button is hidden, no new chat URLs are archived for that room, and the links view exits automatically if it was open when the setting was changed. The site-wide default can be set via `linkCollection: true|false` in the project configuration file.

- **Request Fulfillment Workflow**: Request tiles are now fully interactive. Clicking any open request opens a management overlay where participants can drag-and-drop or browse for files that fulfill it. Uploaded files are linked to the original request at upload time, recording the requester's name in the upload metadata. After all files are confirmed, the request transitions to "fulfilled" state automatically. Any user can reopen a fulfilled request; moderators can remove one outright. Drag-and-drop into the management overlay is fully intercepted so dropped files go directly to the request rather than the general room upload queue.

- **Fulfilled Request Pill**: Fulfilled requests now display a compact grey "Fulfilled" badge inline after the request title, replacing the previous strikethrough text decoration. The request title is also muted to mid-grey, giving fulfilled items a clearly resolved appearance without cluttering the list.

- **Reading Progress Persistence**: All reader formats — PDF, EPUB/MOBI (chapter + page), comics, and webtoon — now save the current reading position to `localStorage` as each page changes. Re-opening the same file resumes from exactly where you left off, surviving page refreshes and browser restarts.

- **CBR / RAR comic support**: CBR files (and `.cbz` archives with internal RAR containers) now work end-to-end. Pages are listed via `unrar lb` and extracted per-request via `unrar p -inul`. Cover thumbnails are generated at index time.

- **ComicInfo.xml metadata**: Comic archives are scanned for `ComicInfo.xml`. The `FrontCover` page index is used to select the correct cover thumbnail. Fields `title`, `series`, `number`, `year`, `publisher`, and `writer` are stored in `meta`.

- **On-demand comic index rebuild**: The `/api/v1/comic/:key/index` endpoint now rebuilds a missing `comic_index` on first request instead of returning `pages: 0`. This recovers any comic file whose initial indexing was interrupted.

- **Focus reading mode**: Pressing `F` or clicking the ⛎ button in the reader bar switches to an immersive full-screen reading experience using the browser's native fullscreen API. The toolbar fades out and reappears for two seconds on mouse movement. Pressing `Escape`, clicking ✕, or pressing `F` again exits focus mode and dismisses native fullscreen.

- **EPUB/MOBI reader typography options**: An **Aa** button (book files only) in the reader bar opens a Kindle-style panel: choose font family (Georgia, Bookerly, Helvetica, OpenDyslexic), step font size from 80 % to 200 %, pick line spacing (Compact / Normal / Relaxed), and pick margins (Narrow / Normal / Wide). All settings persist in `localStorage` across reloads.

- **Gallery mode hides request tiles**: Files posted as requests have no cover art and are now hidden when gallery view is active, keeping the grid clean.

### Changed

- **Fulfill Request modal — request description shown first**: The request view overlay (opened when clicking a request tile to fulfill it) now shows the request text prominently as the first piece of information, so the fulfiller immediately sees what needs uploading. The "Requested by" attribution is shown below as secondary context.

- **Stronger password requirements**: New accounts and password changes now require a minimum of 10 characters (up from 8) and must include at least one letter and one digit. The strength check was also applied to password changes, which previously had no strength validation.

- **EPUB/MOBI focus-mode centering**: The A5 page frame is now vertically centered in the viewport when focus reading mode is active, rather than being pinned to the top edge.

- **API file-listing filters**: `GET /api/v1/files` and `GET /api/v1/downloads` accept new `name_contains` (case-insensitive substring match) and `ext` (comma-separated extension list) query parameters, combinable with existing `type`, `scope`, and `since` filters.

- Switched to serving a full `/favicon` directory of multiple icon sizes and manifest; updated templates and CSS to point at new paths.

- **Failed login security logging**: Invalid login attempts (wrong password or 2FA code) are now recorded in the server log at `[WARN]` level with the originating IP address and account name, making brute-force attempts visible to operators without impacting normal users.

- **Startup weak-secret warning**: Server startup now prints a prominent `[WARN]` when the configured `secret` value matches a known default (e.g. `"dicefiles"`) or is shorter than 16 characters. This is advisory only — existing deployments continue to operate, but operators are prompted to set a proper secret before going to production.

- **Replaced `request`/`request-promise-native` with native `fetch`**: The two deprecated HTTP client packages have been removed. Gravatar profile lookups in user account settings now use the Node 18 built-in `fetch` API.

### Fixed

- **EPUB/MOBI dark text on dark background**: Publisher-embedded colour declarations no longer render as dark-on-dark. All body text is now overridden to light grey (`#e8e8e8`); link colours remain distinct.

- **EPUB cover page blank on first open**: Calibre-generated EPUBs (and many EPUB3 files) use an SVG cover page with `<image xlink:href="cover.jpeg"/>`. The reader now rewrites `xlink:href` and bare `href` attributes on SVG `<image>` elements to blob: URLs, so the cover renders correctly instead of producing a 404.

## [1.1.0] - 2026-02-21 [PDF, Epub, Mobi Reading]

### Added

- **Streaming PDF / ePub / MOBI Reader**: PDF, ePub, and MOBI files now have a "Read Now" button in the gallery lightbox. Clicking it opens an in-page reader filling the file-list area. PDFs stream lazily via HTTP Range requests (only pages near the viewport are decoded). ePub and MOBI files are rendered client-side in a dark-themed iframe. Zoom in/out supported for PDFs. Press Escape or click ✕ to close.

- **A5 paginated book layout**: ePub and MOBI chapters are laid out as A5 pages. ← / → arrow keys (or Prev/Next buttons) scroll pages within a chapter. PageUp / PageDown jump between chapters. A chapter+page counter is shown in the reader toolbar.

- **EPUB/MOBI/AZW cover thumbnails**: Cover images are extracted server-side at upload time and shown in the gallery. EPUB covers are parsed from the OPF manifest (`jszip`). MOBI, AZW, and AZW3 covers are extracted via a pure Node.js PalmDB binary parser that reads the EXTH record 201 (CoverOffset) and resolves the correct image record directly. Files without an embedded cover open the gallery with the title and Read Now button on a dark backdrop.

- **A5 page count for EPUB/MOBI/AZW**: Server-side page count is estimated at upload time and stored in file metadata. MOBI/AZW/AZW3 uses the PalmDoc `text_length` header field (record 0, bytes 4–7); EPUB walks the full OPF spine, strips HTML tags, and sums character counts. Both divide by 1600 chars/page (calibrated for A5 at Georgia 1.05 em / 1.75 line-height). The count appears in the gallery the same way PDF page counts do.

- **Links Archive**: All URLs posted in chat are automatically captured and stored with a 1-year TTL. Browse them via the link-icon toggle in the room toolbar. Links are displayed in table form: resolved title, truncated URL, NEW pill, sharer nick, age.

### Changed

- GIF popup selector now stretches to fill the full chat column width (99% with small side margins).

### Fixed

- Gallery overlay retained the previous file's cover image when navigating to a file that has no cover. The image element is now replaced wholesale with a fresh `<img>` to clear all cached source state.
- Asset/preview generation gracefully degrades when helper binaries (GraphicsMagick, ffmpeg, etc.) are missing. Missing tooling simply causes no previews or covers; there is no crash.
- PDF (and all file) serving returned HTTP 403 Forbidden after a workspace cleanup wiped the uploads directory. Stale deduplication entries in Redis caused the server to discard a freshly-uploaded file and attempt to stream the deleted one. Fix: verify the physical file exists before reusing a dedup entry; re-upload and regenerate metadata/thumbnails when stale. Additionally, ENOENT stream errors in the serve handler now yield 404 Not Found instead of 403.

## [1.0.0] - 2026-02-17

Overview

Dicefiles 1.0.0 is the initial stable release for ephemeral, high-throughput file sharing and real-time collaboration, including integrated request workflows, batch archival downloads, and automation-ready API support.

### User-facing Features

- Ephemeral file sharing platform
  - Multi-file uploads (drag & drop) and support for large files (up to 10 GB)
  - TTL-based automatic file expiry and configurable retention policies
  - Per-user file cleanup (users can remove their own uploads/requests)

- Advanced download & automation
  - Batch downloads with configurable concurrency, resumable queues, per-file retry, and skip-existing behavior
  - Download New / Download All workflows for quick archival pulls

- Real-time collaboration & inline media
  - Socket.io-based chat with inline media embedding and GIF provider integrations (Giphy/Tenor)
  - Searchable emoji picker and direct GIF posting (provider keys via local config)
  - Request creation flow with URL/image support and request-aware list behavior

- File list and gallery experience
  - Server-generated previews for images, video, audio, and PDFs
  - NEW-state highlighting for newly seen files/requests
  - Improved metadata display (author/title/description/pages) for library-style usage

- Profile and achievements
  - Profile page improvements and user message support
  - Achievement progression for uploaded files/bytes and downloaded bytes

### API and Integrations

- Stable automation API namespace (`/api/v1`, with `/api/automation` compatibility alias)
- Scoped API keys, per-scope rate limiting, and automation audit logging
- Webhook integrations for upload/request lifecycle events with signing, retries, and dead-letter logging
- Health endpoint (`/healthz`) with Redis/storage checks and ops counters
- Full machine-friendly API spec in `API.md`

Security & privacy

- Ephemeral-by-design storage model; secure cookies, token verification, and optional sandboxing for preview generation.

Docs & integration

- See `API.md` for API usage and `README.md` for deployment/runbook and systemd instructions.

---

(Changelog intentionally lists only major, user- or API-facing features; UI micro-polish and non-functional tweaks are omitted.)
