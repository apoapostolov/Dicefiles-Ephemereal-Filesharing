# Dicefiles TODO (New Feature Roadmap)

Last updated: 2026-02-22

## Product Direction

Build Dicefiles into the best lightweight collaboration room for ephemeral files,
requests, and fast archival workflows.

## P2 — AI Automation Infrastructure

### MCP Server Wrapper

- [x] `scripts/mcp-server.js` — thin Node.js MCP server wrapping all v1.1 REST
      endpoints as tools. See `docs/mcp.md` for the full implementation guide, tool
      definitions, Claude Desktop config, and deployment instructions.
      Transport: stdio (Claude Desktop / Cursor / local) and HTTP/SSE (OpenClaw, AutoGen, CrewAI).
      Dep to add: `npm install @modelcontextprotocol/sdk`.
      Tools: `list_files`, `get_file`, `get_room_snapshot`, `download_file`,
      `upload_file_from_urls`, `create_request`, `claim_request`, `release_request`,
      `update_file_metadata`, `post_room_chat`, `save_subscription`, `list_subscriptions`,
      `server_health` (13 total).
- [x] `tests/unit/mcp-tools.test.js` — unit tests for each MCP tool handler using
      mocked `fetch` responses.

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
- [x] Evaluate `yauzl` (streaming ZIP reader) for archives > 100 MB to replace jszip heap-load.

  **Evaluation result (2026-02-22):**

  `yauzl` (MIT, npm) is a production-quality streaming ZIP reader that opens a ZIP via file descriptor and streams each entry on demand using `fs.createReadStream` internally. It never loads the full archive into a heap buffer — only the central directory (end of file, a few KB) is read upfront to build the entry list.

  **Memory model comparison:**

  | Scenario | jszip | yauzl |
  | --- | --- | --- |
  | Full file loaded into heap | Yes — `loadAsync(buf)` requires entire file in RAM | No — central directory only (~KB) |
  | 500 MB CBZ peak heap usage | ~1–1.5 GB | ~10–25 MB |
  | 5 MB EPUB peak heap usage | ~15–20 MB | ~5–10 MB (marginal gain) |

  **Per-callsite recommendation (`lib/meta.js`):**

  | Site | Function | Typical size | Recommendation |
  | --- | --- | --- | --- |
  | CBZ cover + index (`generateAssetsComic`) | ZIP branch | 10 MB – 2 GB | **yauzl first choice** — must stream all image entries; large archives common |
  | CBZ page extraction (`extractComicPage`) | ZIP fallback branch | same | **yauzl first choice** — needs only one entry but avoids heap-loading 500 MB to serve one page |
  | EPUB cover (`extractEpubCover`) | ZIP branch | 1–30 MB | **jszip only** — EPUBs are almost always < 50 MB; streaming adds complexity with no meaningful gain |
  | EPUB page count (`countEpubPages`) | ZIP branch | 1–30 MB | **jszip only** — reads all spine chapters regardless; no streaming benefit |

  **Implementation plan (when Archive Viewer is built):**

  1. `npm install yauzl` — add to `package.json` as a direct dependency.
  2. Add a `yauzlListImages(filePath)` helper that promisifies yauzl's entry-event API and returns a sorted array of comic image paths.
  3. Add a `yauzlExtractEntry(filePath, entryPath)` helper that opens the ZIP, seeks to the matching entry, and returns the raw `Buffer` via piped stream.
  4. In `generateAssetsComic` and `extractComicPage`, check `stat.size`; if `>= YAUZL_THRESHOLD` (100 MB), use yauzl helpers. Otherwise fall through to jszip (avoids promisification overhead for small files).
  5. Stability: yauzl has been in active use for 8+ years with no known ABI breaks between Node LTS versions. Safe to depend on.

  **Files to change when implementing:** `lib/meta.js` (4 call sites), `package.json`.

---

## P1.5 — Archive Viewer

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
  < 100 MB archives. For larger CBZ files (10 MB – 2 GB scan packs), use `yauzl`
  (streaming ZIP reader) — see Research Backlog evaluation above for the full
  implementation plan. The `yauzl`-first / jszip-fallback threshold is **100 MB**.
- **RAR streaming**: `unrar p` pipes to stdout, which works well, but very large
  RAR entries (> 1 GB single file) will be slow to start. No workaround without
  a seek-capable RAR library.
- **Nested archives**: do not recurse. Only list and extract top-level entries.
- **RAR with passwords**: fail clearly at extraction with 400.
- **Archive modification time**: `unrar l` gives a date field; parse it for
  display but do not require it.
- **Concurrent extractions**: without the `wrap` rate limiter duplicate
  simultaneous `unrar` spawns for the same archive could spike CPU.

## Execution Order

1. MCP server wrapper (P2 — enables AI orchestrators to use Dicefiles via Claude Desktop and remote agents).
2. Archive Viewer (P1.5 — ZIP + RAR listing and per-file extraction).
3. Profile and achievement polish (P3).
