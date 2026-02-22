# Changelog

## [Unreleased]

### Added

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

- **Manga/Webtoon as a pill**: The two view-mode buttons are now a single segmented pill (`#reader-view-pill`) placed to the left of the download button.

- **Webtoon PageDown / PageUp**: In webtoon mode PageDown/PageUp scroll by exactly one full page height rather than jumping to the next chapter.

- **Webtoon stream-ahead loading**: The webtoon lazy-loader now preloads the next 10 pages as each image enters the viewport (previously one at a time), with a 600 px scroll margin. This eliminates the blank-image flash during fast continuous scrolling.

- **API file-listing filters**: `GET /api/v1/files` and `GET /api/v1/downloads` accept new `name_contains` (case-insensitive substring match) and `ext` (comma-separated extension list) query parameters, combinable with existing `type`, `scope`, and `since` filters.

- Switched to serving a full `/favicon` directory of multiple icon sizes and manifest; updated templates and CSS to point at new paths.

### Fixed

- **EPUB/MOBI page navigation after typography changes**: Adjusting font size, line spacing, or margins in the reader options panel previously caused Left/Right arrow navigation to stop working for the remainder of the session. Root cause: the CSS multi-column geometry sentinel was measured inside the iframe `load` event before the browser had resolved column widths, so `totalPages` was always computed as 1. Fixed by deferring the measurement to a `requestAnimationFrame` callback so layout is fully settled before the page count is taken.

- **"Comic archive has no readable pages"** for the Batman Dark Designs .cbz — on-demand index rebuild now kicks in automatically.
- **CBZ override** — `.cbz` files with internal RAR containers were stored as `meta.type = "RAR"` and rejected by the reader API. Extension now always wins over detected container format.
- **EPUB/MOBI dark text on dark background**: Publisher-embedded colour declarations no longer render as dark-on-dark. All body text is now overridden to light grey (`#e8e8e8`); link colours remain distinct.

## [1.1.0] - 2026-02-21

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
- Links Archive toggle button was non-functional due to a CSS specificity conflict: `#files.listmode { display: block !important }` overrode `.hidden { display: none !important }`. Fixed by scoping the rule to `:not(.hidden)`.
- Link rows in the archive were unstyled; the element class names now match the existing file row CSS (`.name`, `.name-text`, `.file-new-pill`, `.tags`, `.tag`, `.detail`).
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
