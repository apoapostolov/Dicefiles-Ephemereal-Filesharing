# Dicefiles TODO (New Feature Roadmap)

Last updated: 2026-02-22

## Product Direction

Build Dicefiles into the best lightweight collaboration room for ephemeral files,
requests, and fast archival workflows.

## P0 — Complete

### Request Workflow — Open Filter

The last outstanding item from the request workflow feature:

- [ ] Add "Show only open requests" quick filter button in the files panel.

---

## P1 — Collaboration Features

### Smart Collections and Saved Filters

- [ ] Save filter presets per user (e.g. "Books", "Images", "Requests").
- [ ] Add one-click "Only NEW since last visit" view.
- [ ] Add optional sort presets (newest, largest, expiring soon).

---

## P2 — AI Automation Infrastructure

Based on `docs/ai_automation.md`. Server-side building blocks that unlock agent
integration. Polling, webhooks, upload, and request-fulfillment APIs are already
implemented — these are the gaps.

### Server API Gaps

- [ ] `GET /api/v1/file/:hash` — single-file metadata lookup (agents need a point
      query; the only current read path is the full-list scan).
- [ ] `PATCH /api/v1/file/:hash` — post-upload metadata update: tags, description,
      `ai_caption`, `ocr_text_preview`. Requires a separate `files:write` API scope
      distinct from upload scope to prevent over-privileged keys.
- [ ] `POST /api/v1/file/:hash/asset/cover` — accept a JPEG from an agent as the
      file's cover thumbnail; served through the existing gallery thumbnail pipeline.
- [ ] `POST /api/v1/room/:id/chat` — agents post a chat message (`text`, `nick`,
      optional `replyTo`). Enables conversational agent integration.
- [ ] `GET /api/v1/room/:id/snapshot` — compact room summary: file count, total bytes,
      open requests, unique uploaders, oldest expiry.
- [ ] `GET /api/v1/metrics` — Prometheus text-format (or JSON) metrics export from the
      counters already tracked in `lib/observability.js`.
- [ ] `GET /api/v1/audit` — paginated JSON audit log (uploads, deletes, rate-limit
      hits, auth failures) with `since` and `limit` params; `admin:read` scope required.

### Upload and Ingestion

- [ ] `POST /api/v1/batch-upload` — accept a JSON array of `{url, name, roomid}`
      objects; server fetches each URL with size cap and timeout, stores as normal uploads.
- [ ] Structured request hints — extend request creation to accept a `hints` object
      (`{type, keywords, max_size_mb}`) alongside free text for agent pattern-matching.

### Workflow and Coordination

- [ ] Agent request claiming — `claimedBy` field with TTL auto-release; visible in the
      request UI while the agent processes it.
- [ ] `POST /api/v1/agent/subscriptions` — save named server-side filter presets;
      server evaluates at upload time and routes only matching webhook events to each
      subscriber.

---

## P3 — Profile and Community Layer

### Profile Evolution

- [ ] Add profile tabs: Overview, Achievements, Activity.
- [ ] Add recent uploads panel with filters.
- [ ] Add optional public "favorite tags" or "currently looking for" block.
- [ ] Persist last-read page per user per file.

### Achievement System Improvements

- [ ] Replace placeholder icons with a consistent high-quality icon set.
- [ ] Add hover tooltips with unlock rationale and progress.
- [ ] Add seasonal/limited achievements behind feature flags.

---

## Technical and Platform Improvements

### Node Runtime and Dependency Safety

- [ ] Add startup guard that warns/fails on unsupported Node major version.

---

## Research Backlog

- [ ] Evaluate server-side PDF text extraction for in-room search.
- [ ] Evaluate optional OCR pipeline for scanned PDFs.
- [ ] Evaluate deduplicated "read cache" for very popular files.
- [ ] Evaluate `yauzl` (streaming ZIP reader) for archives > 100 MB to replace jszip heap-load.

---

## P1.5 — Archive Viewer and Comic Book Reader

Last updated: 2026-02-22

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

## Execution Order

1. Open requests filter (P0 — final item completing the request workflow).
2. Comic reader Phase 1 (P1.5 — CBZ, pure JS, zero new deps).
3. Archive browser Phase 3 (P1.5 — ZIP + RAR listing and per-file extraction).
4. AI Automation server API gaps (P2 — start with the high-value endpoints).
5. Smart Collections (P1).
6. Profile and achievement polish (P3).
