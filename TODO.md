# Dicefiles TODO (New Feature Roadmap)

Last updated: 2026-02-21

## Product Direction

Build Dicefiles into the best lightweight collaboration room for ephemeral files, requests, and fast archival workflows.

## P0 - Validate and Ship High-Impact Features

### 1) In-browser PDF / Book Reader ✅ Done (v1.1.0)

- [x] Add a first-class "Read" action for PDF files.
- [x] Render PDFs in a modal viewer with page navigation, zoom, fit-width, and fullscreen.
- [x] Keep "Download" as a separate explicit action.
- [x] Streaming/range support — only pages near the viewport are fetched.
- [x] Graceful fallback when PDF fails to render (OBS.trackPreviewFailure everywhere).
- [x] EPUB and MOBI reader shipped alongside PDF in same drawer component.
- [x] Persist last-read page per user per file — WebtoonReader uses `offsetHeight`-based scroll restoration with debounced save; BookReader restores page index on re-open.

### 2) File Preview Reliability — Mostly Done (v1.1.0)

- [x] Add preview health checks and fallback chain for PDF/EPUB/MOBI cover generation.
- [x] Expose diagnostics for failed preview jobs (`OBS.trackPreviewFailure` + metrics counters).
- [x] Add retry queue for transient preview failures — `lib/previewretry.js`; Redis sorted set with exponential backoff (5/15/45 min), max 3 retries; per-hash distributed lock; started per HTTP worker.

### 3) Request Workflow Maturity — Mostly Done

**Status states**: `open` (default), `fulfilled`, removed (deleted outright — no tombstone).

**Click-to-manage modal** — clicking any request (open or fulfilled) opens a `RequestViewModal`:

- Displays: requester's name, request text, optional reference image.
- **Fulfill** (visible when `open`): accepts file drops/picks (any type); uploads them with a
  progress bar inside the modal, then marks the request as fulfilled and closes.
  If no files are dropped, marks as fulfilled immediately (useful for out-of-band uploads).
- **Reopen** (visible when `fulfilled`): resets status to `open` — for correcting wrong
  fulfillments.
- **Remove** (mod-only): deletes the request entirely from the room.

**Fulfilled-request styling**: strikethrough name text + dark grey colour. Clicking still works
so Reopen is always discoverable.

**Fulfillment file linking**: files uploaded through the Fulfill flow carry
`meta.fulfilledRequestKey` (the request key) and `meta.requesterNick` (the original requester's
display name). These files show an extra tooltip entry: **"Requested by: {requester_name}"**
— only appears on files that were uploaded as fulfillments.

**Implementation checklist**:

- [x] `lib/request.js` — add `status` (`"open"` default) and `fulfilledByNick` fields;
      add `EMITTER.setStatus(key, status, byNick)`.
- [x] `lib/client.js` — add `requeststatus` socket event handler; Fulfilled/Reopen by any
      connected user; Remove by mod only.
- [x] `lib/upload.js` — read `req.query.fulfillsRequest`; if valid, look up requester name and
      store `meta.fulfilledRequestKey` + `meta.requesterNick` on the new upload.
- [x] `client/files/requestmodal.js` — add `RequestViewModal` class (named export); upload
      zone accepts any MIME; progress bar; resolves with `{ action, files }`.
- [x] `client/files/upload.js` — add optional `fulfillsRequest` property; included in PUT
      query string when set.
- [x] `client/files/file.js` — route request clicks to `owner.openRequestView()`; apply
      `.request-fulfilled` CSS class when `status === "fulfilled"`.
- [x] `client/files.js` — add `openRequestView(fileInst)` method; orchestrates modal +
      upload-queue + requeststatus emit.
- [x] `client/file.js` — `FileTooltip` shows "Requested by: {nick}" when
      `meta.requesterNick` is present.
- [x] CSS — `.request-file.request-fulfilled > .name`: strikethrough + `#888` colour;
      `RequestViewModal` layout (progress bar, staged files list, preview).
- [ ] Add "Show only open requests" quick filter button.
- [x] Wire webhook `request_fulfilled` event on status transition (currently fires on
      request deletion only; should also fire when `setStatus("fulfilled")` is called).

## P0.5 - Security and Reliability Hardening (Audit-Derived)

### 3.1) Secret Management and Token Safety

- [x] Remove the shared default secret from runtime usage; require a unique per-installation secret via env/config.
- [x] Add startup validation that refuses to run with weak/default secret values.
- [x] Document secure secret generation and rotation procedure.

### 3.2) Authentication Hardening

- [x] Strengthen password policy (length + character classes + basic entropy/reuse checks).
- [x] Add optional progressive login throttling/cooldown by account and IP.
- [x] Add explicit security event logs for failed login attempts and lockout/throttle actions.

### 3.3) Dependency and API Modernization

- [x] Replace deprecated `request` / `request-promise-native` usage with `fetch`/`undici`.
- [x] Audit and upgrade high-risk dependencies (Express/Helmet and related middleware path).
- [x] Add automated dependency scanning in CI (audit/SCA) with fail thresholds.

### 3.4) Input Validation and Content Safety

- [x] Centralize server-side input validation for room/user/request/chat payloads.
- [x] Add stricter validation for upload metadata and user-generated text fields.
- [x] Add regression tests for XSS-safe rendering in chat/file/request surfaces.

### 3.5) Runtime Stability and Memory Hygiene

- [x] Add lifecycle cleanup and size caps for long-lived Maps/Sets (e.g. reconnect/resume trackers).
- [x] Add periodic diagnostics for in-memory structures (counts, high-water marks).
- [x] Add targeted stress tests for reconnect/disconnect churn.

### 3.6) Flood/Rate Control Improvements

- [x] Review current flood controls for bypass vectors; combine account + IP + room scopes.
- [x] Add distributed-safe rate limits for multi-worker behavior.
- [x] Add operator-tunable token-bucket limits for chat/upload/api endpoints.

### 3.7) Configuration and Security Posture Consistency

- [x] Align documented/default ports and deployment examples to avoid ambiguity.
- [x] Verify effective Helmet/CSP/HSTS behavior in production and document expected headers.
- [x] Validate Firejail/jail profile behavior at startup and clearly report fallback mode.

### 3.8) Crypto Hygiene Notes

- [x] Keep MD5 usage only where externally required (Gravatar hashing); avoid MD5 for any security-sensitive purpose.
- [x] Add code comments/docs clarifying why that MD5 usage is non-authentication and non-integrity-critical.

## P1 - Collaboration and Download Power Features

### 4) Smart Collections and Saved Filters

- [ ] Save filter presets per user (e.g. "Books", "Images", "Requests").
- [ ] Add one-click "Only NEW since last visit" view.
- [ ] Add optional sort presets (newest, largest, expiring soon).

### 5) Native Browser Notifications (Chrome/Firefox)

- [x] Add native notifications for new files and new requests via the Web Notifications API.
- [x] Ask notification permission only after explicit user opt-in (not on page load).
- [x] Add per-room toggles: `notify files`, `notify requests`, `mute room`.
- [x] De-duplicate notifications on reconnect/reload so old items are not re-notified.
- [x] Clicking a notification should focus/open the room and highlight the related item.

### 6) Advanced Batch Downloads (Done)

- [x] Add retry-on-failure with per-file status list.
- [x] Add "skip existing filename" option.
- [x] Add resumable queue persistence in browser (recover after refresh).
- [x] Add post-download report (success/failed/skipped).

### 7) Better Metadata for Library Use ✅ Done (v1.0.0 + v1.1.0)

- [x] Detect and display richer book metadata: title, author, pages — PDF (exiftool), EPUB (OPF spine walk), MOBI/AZW/AZW3 (PalmDoc text_length).
- [x] Cover thumbnails for images, video, audio, PDF, EPUB, MOBI, AZW, AZW3.
- [x] Add optional tag suggestion from filename/metadata.
- [x] Add quick copy for direct file link + metadata snippet.

## P2 - Automation and Ecosystem

### 8) Automation API Hardening (Agent-ready)

- [x] Stabilize API versioning (`/api/v1`).
- [x] Publish machine-friendly API examples for skill builders.
- [x] Add scoped API keys (read-only, upload, mod actions).
- [x] Add per-endpoint rate limiting + audit logs.

### 9) Webhooks and Integrations

- [x] Add outbound webhooks for `file_uploaded`, `request_created`, `request_fulfilled`, `file_deleted`.
- [x] Add signed webhook payloads.
- [x] Add simple webhook retry policy and dead-letter logging.

## P3 - Profile and Community Layer

### 10) Profile Evolution

- [ ] Add profile tabs: Overview, Achievements, Activity.
- [ ] Add recent uploads panel with filters.
- [ ] Add optional public "favorite tags" or "currently looking for" block.
- [ ] Persist last-read page per user per file (deferred from P0 reader).

### 11) Achievement System Improvements

- [ ] Replace placeholder icons with a consistent high-quality icon set.
- [ ] Add hover tooltips with unlock rationale and progress.
- [ ] Add seasonal/limited achievements behind feature flags.

## Technical and Platform Improvements

### 12) Node Runtime and Dependency Safety

- [x] Node 18 runtime policy documented in `AGENTS.md`.
- [ ] Add startup guard that warns/fails on unsupported Node major.
- [ ] Add CI matrix for Node 18 plus future-canary check jobs.

### 13) Observability and Ops

- [x] Add structured logs for upload/download/request lifecycle.
- [x] Add metrics counters (uploads, downloads, preview failures, request conversions).
- [x] Add lightweight health endpoint that checks Redis and storage writeability.

## Research Backlog

- [ ] Evaluate server-side PDF text extraction for in-room search.
- [ ] Evaluate optional OCR pipeline for scanned PDFs.
- [ ] Evaluate deduplicated "read cache" for very popular files.
- [ ] Evaluate `yauzl` (streaming ZIP reader) for archives > 100 MB to replace jszip heap-load.

---

## P1.5 — Archive Viewer and Comic Book Reader

Last updated: 2026-02-21

Two related features sharing most of the same infrastructure: a generic archive
contents browser (useful for STL packs, asset bundles, mod archives) and a
dedicated page-flip comic reader for CBZ/CBR/CBT comic files.

---

### Feature A — Archive Contents Viewer (ZIP / RAR / TAR for STL packs etc.)

#### What it is

Users who upload a `.zip` or `.rar` full of `.stl` / `.obj` / `.blend` files
can browse the contents in-browser and download individual files without
extracting the whole archive locally.

#### Feasibility — Green

| Format                                               | Listing tool                                           | Extraction tool       | Deps needed                   |
| ---------------------------------------------------- | ------------------------------------------------------ | --------------------- | ----------------------------- |
| `.zip` / `.cbz`                                      | `jszip` (pure JS, already installed)                   | `jszip`               | none                          |
| `.rar` / `.cbr`                                      | spawn `unrar lb` (installed at `/usr/bin/unrar` v7.00) | spawn `unrar p -inul` | none                          |
| `.tar` / `.tar.gz` / `.tar.bz2` / `.cbz` (tarballed) | spawn `tar tf` (GNU tar 1.35 installed)                | spawn `tar xOf`       | none                          |
| `.7z` / `.cb7`                                       | none without binary                                    | none                  | `sudo apt install p7zip-full` |

**7z is the only blocked format.** ZIP, RAR, TAR all work with tools already on
the system. Adding p7zip-full is a small `apt install` but requires operator
action and is out of scope for the first iteration.

#### New server endpoints

```
GET  /api/v1/archive/:hash/ls
     → JSON: { files: [{ path, size, packed, date, isDir }], format, count }
     Auth: same as room file access (no extra auth needed beyond hash)

GET  /api/v1/archive/:hash/file?path=<encoded-path>
     → Streams the extracted file bytes with correct Content-Disposition header
     Security: MUST validate path against archive manifest — reject any path
               containing `..` or starting with `/` after normalization
```

#### At-upload behavior (metadata)

No new assets are generated for plain archives. The only metadata additions:

- `meta.archive_count` — total entry count (files only, not dirs)
- `meta.archive_ext_sample` — comma list of unique extensions of top-level
  entries (e.g. `"stl,obj,png"`) — used by gallery to hint contents
- These are written via `addAssets([])` (same pattern as pages-only persist)

#### Security constraints (critical)

- Path traversal: normalize every requested path against the archive's own
  manifest. Reject if the normalized path is not in the manifest.
- Serve extracted bytes directly to response — never write to temp file.
- Limit extraction to files ≤ 50 MB per request (configurable). Reject others
  with 413 and a hint to download the full archive.
- Rate-limit the extract endpoint to prevent archive-bombing (many concurrent
  large extractions). Reuse the existing `wrap(maxAssetsProcesses, ...)` pattern.
- Encrypted archives: listing may work, extraction returns 400 with clear error.

#### Client UI

- Gallery card for archive file: shows archive icon, file count badge, ext
  sample tag ("STLs · 42 files").
- Clicking opens a lightweight "Archive Contents" panel (same sliding-drawer as
  the book reader) listing all paths in a scrollable tree.
- Each row has: filename, size, a single "↓" download-file button.
- Full-archive download button stays at the top (existing behavior).

#### Effort estimate

| Task                                                                   | Complexity              |
| ---------------------------------------------------------------------- | ----------------------- |
| `lib/meta.js` — `indexArchive(storage)` at upload (list + write meta)  | Low                     |
| `lib/meta.js` / `server.js` — `/archive/:hash/ls` endpoint             | Low                     |
| `lib/meta.js` / `server.js` — `/archive/:hash/file` streaming endpoint | Medium                  |
| Client archive panel component                                         | Medium                  |
| Security: path validation + rate limiting                              | Medium                  |
| 7z support (blocked on p7zip install)                                  | Low once binary present |

#### Known limitations / risks

- **Memory**: `jszip.loadAsync` loads the whole ZIP into Node heap. Fine for
  < 200 MB archives. Larger archives should use `yauzl` (streaming ZIP reader),
  which is not yet installed. Add `yauzl` as a future dep upgrade for ZIP files
  ≥ 100 MB.
- **RAR streaming**: `unrar p` pipes to stdout, which works well, but very large
  RAR entries (> 1 GB single file) will be slow to start. No workaround without
  a seek-capable RAR library.
- **Nested archives**: do not recurse. Only list and extract top-level entries.
- **RAR with passwords**: fail clearly at extraction with 400.
- **Archive modification time**: `unrar l` gives a date field; parse it for
  display but do not require it.
- **Concurrent extractions**: without the `wrap` rate limiter duplicate
  simultaneous `unrar` spawns for the same archive could spike CPU.

---

### Feature B — Comic Book Reader (CBZ / CBR / CBT)

#### What it is

Comic books distributed as image archives (one image per page, alphabetically
sorted) are displayed as a fullscreen page-flip reader — the same drawer
component used by the book reader, but showing images instead of text.

#### Format overview

| Extension          | Container     | Status                      |
| ------------------ | ------------- | --------------------------- |
| `.cbz`             | ZIP           | ✅ jszip, pure JS           |
| `.cbr`             | RAR           | ✅ unrar v7.00 installed    |
| `.cbt`             | TAR           | ✅ GNU tar installed        |
| `.cb7`             | 7-Zip         | ⛔ needs p7zip-full         |
| `.cbacbz`          | ZIP variant   | ✅ same as cbz              |
| `.webp` inline CBZ | ZIP with WebP | ✅ jszip + sharp can decode |

CBZ covers ~80% of all freely circulating digital comics. CBR covers most of
the remainder. CB7 is rare.

#### At-upload behavior

For a file detected as CBZ/CBR/CBT (by extension or magic bytes):

1. **Index pages** — list all entries whose extension is in
   `{.jpg, .jpeg, .png, .webp, .gif, .avif, .bmp}`, natural-sort by filename.
   Store the sorted name list in a compact form in `meta.comic_index`
   (newline-separated, persisted via `addAssets([])`).
1. **Page count** — `meta.pages = String(imageEntries.length)` (same field as
   PDF/EPUB — gallery already knows to render it).
1. **Cover thumbnail** — extract the first page image (page 0), pipe through
   `sharp` at 400×600 with `fit: inside`, save as `.cover.jpg` asset via
   `addAssets([{ ext: ".cover.jpg", ... }])`. Exactly the pattern used for EPUB.

**No persistent temp files**: pages are extracted on demand at read time via
the streaming endpoint below.

#### New server endpoint

```
GET /api/v1/comic/:hash/page/:n
    → Streams the n-th page image (0-indexed) with Content-Type: image/jpeg
      (always transcoded via sharp to normalize format and strip EXIF)
    → n out of range → 404
    → archive unreadable → 500

GET /api/v1/comic/:hash/index
    → JSON: { pages: number, hash: string }
      (summary for client initialization; full index stays server-side)
```

Page images are **transcoded on the fly** through sharp (resize to 1200px wide,
quality 85) to:

- Normalize TIFF/BMP/weird formats the browser can't display
- Strip EXIF
- Prevent raw multi-megapixel images from stalling mobile browsers
- Keep a consistent byte stream interface regardless of source format

#### Client reader UI

CBZ/CBR reader reuses the existing book-reader drawer component with a new
`ComicReader` mode:

- Full-width image fill, centered in the page area
- Prev/Next buttons + left/right arrow keys
- Page indicator: "Page 12 / 240"
- Double-page spread toggle (show 2 pages side by side at desktop widths)
- Preload: background-load next page image as soon as current page is shown
- Mobile: swipe left/right gesture
- Lazy: does not fetch any pages until the reader is actually opened

#### Natural sort (critical for correct page order)

Many CBZ files contain pages named `001.jpg`, `01.jpg`, `1.jpg`, or mixed
`Chapter_01_Page_012.png`. Lexicographic sort is wrong here ("10" < "2").
Use a natural-sort algorithm (already available in `common/sorting.js` —
check if it handles numeric segments; add if not).

#### Effort estimate

| Task                                                      | Complexity              |
| --------------------------------------------------------- | ----------------------- |
| `lib/meta.js` — `generateAssetsComic(storage)` at upload  | Medium                  |
| `server.js` — `/comic/:hash/page/:n` streaming endpoint   | Medium                  |
| `server.js` — `/comic/:hash/index` endpoint               | Low                     |
| Client `ComicReader` component (reuse book-reader drawer) | Medium                  |
| Natural sort for page ordering                            | Low                     |
| CBR support (spawn unrar for listing + per-page extract)  | Medium                  |
| CBT support (spawn tar)                                   | Low                     |
| CB7 support (blocked on p7zip)                            | Low once binary present |

#### Known limitations / risks

- **On-demand transcoding cost**: each page request runs sharp. A fast reader
  clicking through pages quickly will queue many concurrent sharp jobs. Solution:
  apply the same `wrap(maxAssetsProcesses, ...)` rate limit.
- **Large comics (> 500 pages)**: `meta.comic_index` stored as a newline block
  could be a few KB for long series but is fine for Redis.
- **CBR extraction latency**: `unrar p` must decompress up to page N serially
  from the beginning of the archive for RAR4 (no random access). RAR5 has
  better seeking. This is inherent to the format; acceptable for reasonable
  page counts.
- **Page 0 cover at upload for CBR**: spawns unrar once during `generateAssets`.
  Same resource budget as existing PDF/EPUB cover generation.
- **Double-page spread**: purely client-side (load pages N and N+1, render
  side-by-side). No server changes needed.
- **Right-to-left manga mode**: reading direction toggle stored in user prefs.
  Nice-to-have, not P1.

---

### Feature C — Comic Reader Viewing Modes (Manga + Webtoon)

Both modes add a toggle button to the reader bar header. They are mutually
exclusive. State is stored in `localStorage` so preference persists across
sessions.

---

#### Mode 1 — Manga (Right-to-Left)

**What it is**

Japanese manga reads from right to left. In a standard LTR comic reader,
"Next" advances the page index by +1. In Manga mode, "Next" instead decrements
the index (page index −1), so pressing "→" or clicking "Next" moves _left_
through the archive, matching the natural reading direction.

**Button spec**

- Label: `漫 Manga` (or simply `RTL`)
- Placement: in `#reader-bar`, after `#reader-next`, visible only when a comic
  is open
- Active state: button gets `.active` class → highlighted background
- Persisted: `localStorage.setItem("reader_manga", "1")`

**Keyboard behaviour when Manga mode is on**

| Key              | Standard       | Manga mode         |
| ---------------- | -------------- | ------------------ |
| `→` (ArrowRight) | Next page (+1) | Previous page (−1) |
| `←` (ArrowLeft)  | Prev page (−1) | Next page (+1)     |
| `Next` button    | +1             | −1                 |
| `Prev` button    | −1             | +1                 |

No other changes. Page display stays left-to-right (no CSS mirroring needed —
the page image is just shown in reverse sequence order).

**Implementation**

- `ComicReader._mangaMode` boolean flag
- `ComicReader.setMangaMode(enabled)` — updates flag; updates info display
- `ComicReader.nextPage()` / `prevPage()` — check `_mangaMode` and swap delta
- `Reader._mangaMode` held on the Reader instance; passed to ComicReader via
  `setMangaMode` whenever the toggle fires, and re-applied on `open()`
- `Reader._onKey()` — for `comic` type: `ArrowLeft` = `"prev"` direction (not
  page decrement); `reader.nextPage()` / `prevPage()` internally handle the
  manga flip
- `_manga()` helper on Reader class, same pattern as `_bookPage()` / `_pdf()`

**Effort**: ~15 min — only ComicReader, no server changes.

---

#### Mode 2 — Webtoon (Vertical Infinite Scroll)

**What it is**

Korean webtoons are full-width vertical strips — one continuous scroll, no
page turns. In Webtoon mode the paged single-image view is replaced by a
vertically stacked list of all pages, separated by a 4 px gap. The user scrolls
with the scrollbar or keyboard. Pages are loaded lazily as they enter the
viewport.

**Button spec**

- Label: `⬆ Webtoon`
- Placement: in `#reader-bar`, after Manga toggle, visible only when a comic is
  open
- Active state: `.active` class
- Disables Manga mode automatically if both would be on simultaneously
- Persisted: `localStorage.setItem("reader_webtoon", "1")`

**Layout spec**

```
┌─────────────────────────────────┐
│  reader-bar (unchanged header)  │
├─────────────────────────────────┤
│  #reader-content (overflow-y)   │  ← same scrollable container
│                                 │
│  [  page 0 image, full-width  ] │
│  [  4 px gap                  ] │
│  [  page 1 image, full-width  ] │
│  [  4 px gap                  ] │
│  [  page 2 image, full-width  ] │
│   …                             │
└─────────────────────────────────┘
```

- Each page `<img>` is `width: 100%; height: auto; display: block`
- Between pages: `margin-bottom: 4px` on each wrapper
- Container `#reader-content` keeps its existing `overflow-y: auto` scroll
- `.reader-comic-webtoon` class added to `#reader-content` when active;
  controls page img sizing rules distinct from paged mode

**Lazy loading (IntersectionObserver pattern)**

Identical to `PDFReader._setupObserver()`:

1. Build all `<img>` wrappers upfront with a fixed-height placeholder
   (`height: 400px; background: #1e1e1e`) to give IntersectionObserver
   meaningful geometry before images load.
2. `observer = new IntersectionObserver(callback, { root: container,
rootMargin: "300px 0px 300px 0px", threshold: 0 })` — fires 300 px before
   entry reaches viewport.
3. On intersection: set `img.src` only if not already set.
4. Dedicated visibility observer (`threshold: 0.3`) updates info counter
   `"Page X / Y"` as pages come into view — same as `PDFReader._trackVisible`.

**Scroll-by-half-page keyboard navigation**

- `ArrowUp` / `ArrowDown` while webtoon is active:
  scroll `container.scrollBy({ top: ±container.clientHeight * 0.5,
behavior: "smooth" })`
- `Prev` / `Next` buttons hidden in webtoon mode (replaced by scroll)
- Manga mode toggle is greyed out / force-disabled when webtoon is active
  (mutually exclusive)

**Preload ahead**

- Beyond the IntersectionObserver, eagerly preload the next `WEBTOON_PRELOAD`
  (configurable constant, default 3) images past the last observer-loaded page
  by creating detached `new Image()` with the page URL.

**Implementation classes / methods**

| Symbol                                | Change                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `ComicReader._webtoonMode`            | boolean                                                                  |
| `ComicReader.setWebtoonMode(enabled)` | tears down paged view; builds webtoon strip                              |
| `ComicReader._buildWebtoonView()`     | creates img placeholders, sets up IntersectionObserver                   |
| `ComicReader._buildPagedView()`       | restores single-image paged view from webtoon                            |
| `ComicReader.destroy()`               | disconnects both observers                                               |
| `Reader._webtoonMode`                 | held on Reader, synced to ComicReader                                    |
| `Reader._onKey()`                     | ArrowUp/Down → `scrollBy(±0.5 × container.clientHeight)` in webtoon mode |
| CSS `.reader-comic-webtoon img`       | `width: 100%; height: auto; display: block`                              |

**Server side**: no changes needed — `/api/v1/comic/:key/page/:n` already serves
individual pages on demand, and the webtoon view simply fetches all N of them
lazily via the same endpoint.

**Effort estimate**

| Task                                                      | Complexity |
| --------------------------------------------------------- | ---------- |
| `_buildWebtoonView()` with IntersectionObserver lazy load | Medium     |
| `setWebtoonMode()` / `_buildPagedView()` toggle           | Low        |
| Keyboard scroll-by-half-page                              | Low        |
| CSS `.reader-comic-webtoon` rules                         | Low        |
| Mutual exclusion with manga mode                          | Low        |
| Preload-ahead N images                                    | Low        |

**Total**: ~2–3 hours.

---

### Shared Implementation Plan (order-of-operations)

```
Phase 1 — CBZ-only, pure JS, zero new deps
  1. lib/meta.js: generateAssetsComic() for CBZ only
     - jszip index, page count, cover thumbnail
  2. server.js: GET /api/v1/comic/:hash/page/:n for CBZ
  3. server.js: GET /api/v1/comic/:hash/index
  4. client/: ComicReader component (reuse book-reader drawer)
  5. gallery shows page-count badge + "Read" button for cbz

Phase 2 — CBR/CBT support (binary spawning)
  1. lib/meta.js: generateAssetsComic() extended for CBR (unrar), CBT (tar)
  2. server.js: comic page endpoint extended for CBR/CBT

Phase 3 — Archive browser (ZIP + RAR)
  1. lib/meta.js: indexArchive() at upload (entry count, ext sample)
  2. server.js: GET /api/v1/archive/:hash/ls
  3. server.js: GET /api/v1/archive/:hash/file (with security validation)
  4. client/: ArchiveContents panel component
  5. gallery: archive card shows file count + ext hints

Phase 4 — 7z / CB7 (requires apt install p7zip-full)
  1. Operator installs p7zip-full
  2. lib/meta.js: detect + delegate to 7za spawn
```

### Open Questions Before Implementing

- [ ] Should archive file downloads require room membership (same as file
      downloads) or be hash-gated with no room check? Current auth model is
      hash-only for downloads — follow that for consistency.
- [ ] Should `meta.comic_index` (page filename list) be stored in Redis or
      reconstructed on demand from the archive? For CBZ pure JS it's cheap to
      reconstruct; for CBR it requires a spawn. Storing in Redis avoids repeated
      spawns.
- [ ] Upper bound for archive listing: should we hard-cap listing at e.g. 10,000
      entries? Past that, archives are effectively write-once drop zones and a
      UI listing is not useful.
- [ ] ComicReader: full screen mode (native Fullscreen API) — desirable for
      tablets but adds implementation surface. Defer to Phase 2?
- [ ] Should transcoded comic pages be cached as assets (write `.page-000.jpg`
      etc. to storage) for repeat read performance, or always transcode on demand?
      Caching would bloat storage for large comics; on-demand is fine given sharp
      speed and rate limiting.

---

## Execution Order Proposal

1. ~~PDF/EPUB/MOBI Reader feasibility + prototype.~~ ✅ Done (v1.1.0)
2. ~~Preview reliability.~~ ✅ Done — request status flow still outstanding.
3. Comic reader Phase 1 (CBZ, pure JS, zero new deps).
4. Archive browser Phase 3 (ZIP + RAR viewer with per-file extract).
5. Request workflow maturity (status states, fulfilled marker, open filter).
6. Security hardening P0.5 (secret mgmt, auth hardening, dep modernization).
7. Profile/achievement polish.
