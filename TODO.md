# Dicefiles TODO

Last updated: 2026-02-22

## P1.5 — Archive Viewer

Spec: [docs/archive-viewer.md](docs/archive-viewer.md)

### Server — metadata at upload

- [ ] Add `indexArchive(storage)` to `lib/meta.js`: list entries, write `meta.archive_count` and `meta.archive_ext_sample` via `addAssets([])`.
- [ ] ZIP listing branch: use yauzl for archives ≥ 100 MB, jszip for smaller.
- [ ] RAR listing branch: spawn `unrar lb`.
- [ ] TAR listing branch: spawn `tar tf` (handles `.tar`, `.tar.gz`, `.tar.bz2`).
- [ ] Call `indexArchive` during ingest for zip/rar/tar type uploads.

### Server — API endpoints

- [ ] Add `GET /api/v1/archive/:hash/ls` → `{ files, format, count }`.
- [ ] Add `GET /api/v1/archive/:hash/file?path=...` → stream extracted bytes.
- [ ] Path traversal guard: reject paths not present in the manifest or containing `..`.
- [ ] File size guard: reject single-file extraction > 50 MB with 413.
- [ ] Rate-limit extraction endpoint using existing `wrap(maxAssetsProcesses, ...)` pattern.
- [ ] Encrypted archive detection: return 400 on password-protected entries.

### Client UI

- [ ] Gallery card: archive icon, file-count badge, ext-sample tag (e.g. "STLs · 42 files").
- [ ] Archive Contents panel component (`client/files/archivepanel.js`) — flat scrollable entry list with path, size, per-row download button.
- [ ] Integrate panel with file viewer open/close pattern (same as reader).

### 7z support (blocked on operator action)

- [ ] Add 7z listing + extraction once `p7zip-full` is installed: `7z l -slt` for listing, `7z x -so` for extraction.

## Execution Order

| Step | Section                   | Why first                                              |
| ---- | ------------------------- | ------------------------------------------------------ |
| 1    | Archive Viewer (P1.5)     | Highest user-visible impact; server tools already present. |

