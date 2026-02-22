# Dicefiles TODO

Last updated: 2026-02-22

## P1 — Public Servers

- [ ] Add config setting to make all rooms public (off by default)
  - [ ] Add `publicRooms` boolean config in `defaults.js` with default `false`
  - [ ] Update config validation in `lib/config.js` if needed (though it's optional)
- [ ] When enabled, change home page from placeholder text to directory of all registered rooms ordered by number of files (descending)
  - [ ] Create API endpoint `GET /api/v1/rooms` in `lib/httpserver.js` that calls `Room.list()` and returns sorted rooms
  - [ ] Modify `views/index.ejs` to conditionally render room directory when `publicRooms` is true
  - [ ] Add client-side JavaScript in `entries/main.js` or new script to fetch and display rooms
  - [ ] Implement sorting by file count descending in the API response
  - [ ] Style the room directory list in `static/style.css` to match site design

---

## P2 — Profile Completion

- [x] Activity tab (third tab alongside Overview and Achievements) with paginated recent-upload list
- [ ] Persist last-read page server-side, synced via API (currently localStorage-only)
- [x] Optional "currently looking for" interests block on profile (owner-editable)

---

## P2 — Room Pruning

- [ ] Add config setting to turn on or off pruning (on by default)
  - [ ] Add `roomPruningEnabled` boolean config in `defaults.js` with default `true`
  - [ ] Add `roomPruningDays` number config in `defaults.js` with default `21`
- [ ] Implement pruning logic to delete rooms that have not received a new file or chat message in the last X days
  - [ ] Add `lastActivity` timestamp field to room config in `lib/room/index.js` Room constructor
  - [ ] Update `lastActivity` on file upload in `lib/upload.js` or room file addition
  - [ ] Update `lastActivity` on chat message in `lib/room/index.js` message handling
  - [ ] Create `pruneRooms()` function in `lib/room/index.js` to scan all rooms and delete inactive ones
  - [ ] Add scheduled pruning call in `server.js` using `setInterval` to run daily
  - [ ] Ensure complete deletion: remove Redis keys, files, and all room data

---

## P3 — Achievement Polish

- [ ] Seasonal / limited-time achievements behind feature flag (`SEASONAL_ACHIEVEMENTS=1` env var)

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
| P1       | Public Servers     |
| P2       | Profile Completion |
| P2       | Room Pruning       |
| P3       | Archive Viewer     |
| P3       | Achievement Polish |
