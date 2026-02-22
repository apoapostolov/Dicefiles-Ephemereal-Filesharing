# Changelog

## [Unreleased]

### Added

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
