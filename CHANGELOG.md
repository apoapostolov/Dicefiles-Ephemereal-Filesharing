# Changelog

## [1.1.0] - 2026-02-21

### Added

- **Streaming PDF / ePub Reader**: PDF and ePub files now have a "Read Now" button in the gallery lightbox. Clicking it opens an in-page reader filling the file-list area. PDFs stream lazily via HTTP Range requests (only pages near the viewport are decoded). ePub chapters render in a dark-themed iframe with prev/next navigation. Zoom in/out supported for PDFs. Press Escape or click ✕ to close.

- Links Archive functionality to collect and display links posted in chat.
  - All URLs posted in chat (including by non-logged-in users) are captured and stored with a 1-year TTL.
  - Dedicated toggle button (link icon) in the toolbar, to the left of the Requests button.
  - Clicking the toggle switches the file list view to the Links Archive and back.
  - Links displayed in table form: resolved title, truncated URL, NEW pill, sharer nick, age.

### Changed

- GIF popup selector now stretches to fill the full chat column width (99% with small side margins).

### Fixed

- Links Archive toggle button was non-functional due to a CSS specificity conflict: `#files.listmode { display: block !important }` overrode `.hidden { display: none !important }`. Fixed by scoping the rule to `:not(.hidden)`.
- Link rows in the archive were unstyled; the element class names now match the existing file row CSS (`.name`, `.name-text`, `.file-new-pill`, `.tags`, `.tag`, `.detail`).

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
