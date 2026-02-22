# Archive Viewer — Implementation Spec

## What it is

Users who upload a `.zip`, `.rar`, or `.tar` archive can browse the contents
in-browser and download individual files without extracting the whole archive
locally. Initial scope: ZIP, RAR, TAR. 7z requires operator action
(`apt install p7zip-full`) and is deferred.

## Server endpoints

```
GET  /api/v1/archive/:hash/ls
     → JSON: { files: [{ path, size, packed, date, isDir }], format, count }
     Auth: same as room file access

GET  /api/v1/archive/:hash/file?path=<encoded-path>
     → Streams the extracted file bytes with correct Content-Disposition
     Security: validate path against archive manifest; reject paths with `..`
               or not present in manifest
```

## At-upload metadata (lib/meta.js)

Written via `addAssets([])` at ingest time:

- `meta.archive_count` — file entry count (no dirs)
- `meta.archive_ext_sample` — comma list of unique top-level extensions (e.g. `"stl,obj,png"`)

## Supported formats and tools

| Format                            | Listing           | Extraction          |
| --------------------------------- | ----------------- | ------------------- |
| `.zip` / `.cbz`                   | yauzl (≥100 MB) or jszip | jszip / yauzl buffer |
| `.rar` / `.cbr`                   | `unrar lb`        | `unrar p -inul`     |
| `.tar` / `.tar.gz` / `.tar.bz2`   | `tar tf`          | `tar xOf`           |
| `.7z` / `.cb7`                    | blocked           | blocked             |

ZIP size threshold for yauzl: **100 MB** (see the yauzl evaluation note in DEVELOPMENT_LOG.md).

## Security constraints

- Path traversal: normalize every requested path against the archive manifest.
  Reject if not in manifest or if normalized form contains `..` or starts with `/`.
- Extract size limit: reject files > 50 MB per single request with 413.
- Rate limiting: reuse `wrap(maxAssetsProcesses, ...)` pattern.
- Encrypted archives: return 400 with a clear error message.
- Never write extracted bytes to temp files — pipe directly to response.
- Nested archives: do not recurse; only list and serve top-level entries.

## Client UI

- Gallery card for archive file: archive icon, file-count badge, ext-sample tag.
- Archive Contents panel: sliding drawer (same pattern as book reader).
  - Scrollable flat list of all entries with path, size, download button.
  - Full-archive download button remains at the top.
