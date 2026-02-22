# Dicefiles TODO

Last updated: 2026-02-22

## P2 — Profile Completion

- [x] Activity tab (third tab alongside Overview and Achievements) with paginated recent-upload list
- [ ] Persist last-read page server-side, synced via API (currently localStorage-only)
- [x] Optional "currently looking for" interests block on profile (owner-editable)

---

## P3 — CB7 Comic Support

CB7 (7z-based) comic archives are currently blocked in the archive viewer. Add server-side support for CB7 comics, mirroring CBR implementation.

- [x] Install `p7zip-full` on server (`sudo apt install p7zip-full`)
- [x] `lib/meta.js` — Add CB7 detection and 7z command integration for file listing (`7z l`) and extraction (`7z e`)
- [x] `lib/meta.js` — Extend comic indexing to handle CB7 archives, including ComicInfo.xml parsing and cover thumbnail generation
- [x] `lib/httpserver.js` — Ensure `/api/v1/comic/:key/*` endpoints work with CB7 (pages listing and extraction)
- [x] Tests — Add CB7 comic test cases to `tests/integration/routes.test.js` and unit tests in `tests/unit/`
- [x] Documentation — Update `docs/archive-viewer.md` format support table to mark CB7 as supported

---

## P3 — Archive Viewer

See `docs/archive-viewer.md` for full spec, format support table, and security constraints.

### Server

- [ ] `lib/meta.js` — `indexArchive(storage)` — list ZIP/RAR/TAR contents at upload, write `meta.archive_count` and `meta.archive_ext_sample`
- [ ] `lib/httpserver.js` — `GET /api/v1/archive/:hash/ls` endpoint returning entry manifest as JSON
- [ ] `lib/httpserver.js` — `GET /api/v1/archive/:hash/file?path=` streaming extraction endpoint

### Memory / Deps

- [ ] `npm install yauzl` — add to `package.json`; implement `yauzlListImages` and `yauzlExtractEntry` helpers in `lib/meta.js` for ZIP files ≥ 100 MB

### Security

- [ ] Validate every requested extraction path against the archive manifest (reject `..` and absolute paths after normalization)
- [ ] Reject single-entry extractions > 50 MB with 413
- [ ] Apply `wrap(maxAssetsProcesses, ...)` to the extraction endpoint to cap concurrent spawns

### Client

- [ ] Gallery card badge: file count + ext sample ("STLs · 42 files") for archive files
- [ ] Archive Contents panel (sliding drawer) listing all entry paths with file sizes
- [ ] Per-entry download button in the panel rows

---

## Execution Order

| Priority | Section            |
| -------- | ------------------ |
| P2       | Profile Completion |
| P3       | Archive Viewer     |
| P3       | CB7 Comic Support  |
| P3       | Achievement Polish |
