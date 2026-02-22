# Archive Viewer — Full Spec

## What it is

Users who upload a `.zip` or `.rar` full of `.stl` / `.obj` / `.blend` files
can browse the contents in-browser and download individual files without
extracting the whole archive locally.

## Format Support

| Format                                               | Listing tool                                           | Extraction tool       | Deps needed                   |
| ---------------------------------------------------- | ------------------------------------------------------ | --------------------- | ----------------------------- |
| `.zip` / `.cbz`                                      | `jszip` (pure JS, already installed)                   | `jszip`               | none                          |
| `.rar` / `.cbr`                                      | spawn `unrar lb` (installed at `/usr/bin/unrar` v7.00) | spawn `unrar p -inul` | none                          |
| `.tar` / `.tar.gz` / `.tar.bz2` / `.cbz` (tarballed) | spawn `tar tf` (GNU tar 1.35 installed)                | spawn `tar xOf`       | none                          |
| `.7z` / `.cb7`                                       | none without binary                                    | none                  | `sudo apt install p7zip-full` |

**7z is the only blocked format.** ZIP, RAR, TAR all work with tools already on
the system. 7z support is deferred until operator installs `p7zip-full`.

## New Server Endpoints

```
GET  /api/v1/archive/:hash/ls
     → JSON: { files: [{ path, size, packed, date, isDir }], format, count }
     Auth: same as room file access (no extra auth needed beyond hash)

GET  /api/v1/archive/:hash/file?path=<encoded-path>
     → Streams the extracted file bytes with correct Content-Disposition header
     Security: MUST validate path against archive manifest — reject any path
               containing `..` or starting with `/` after normalization
```

## At-Upload Behavior (metadata)

No new assets are generated for plain archives. The only metadata additions:

- `meta.archive_count` — total entry count (files only, not dirs)
- `meta.archive_ext_sample` — comma list of unique extensions of top-level
  entries (e.g. `"stl,obj,png"`) — used by gallery to hint contents
- These are written via `addAssets([])` (same pattern as pages-only persist)

## Memory Considerations

- `jszip.loadAsync` loads the whole ZIP into Node heap. Fine for < 100 MB archives.
- For larger ZIP files (e.g. large CBZ scan packs), use `yauzl` (streaming ZIP reader).
  Threshold is **100 MB**: if `stat.size >= 100 * 1024 * 1024`, use yauzl helpers.
- `yauzl` implementation: `yauzlListImages(filePath)` → sorted entry array;
  `yauzlExtractEntry(filePath, entryPath)` → raw Buffer via piped stream.
- `npm install yauzl` required; add to `package.json`.

## Security Constraints

- **Path traversal**: normalize every requested path against the archive's own manifest.
  Reject if the normalized path is not in the known-good manifest.
- **Size limit**: do not serve single-entry extractions > 50 MB per request (configurable).
  Respond with 413 and hint to download the full archive.
- **Rate limiting**: reuse `wrap(maxAssetsProcesses, ...)` to cap concurrent extractions.
- **Encrypted archives**: listing may work; extraction returns 400 with clear error.
- **Temp files**: serve extracted bytes directly to response — never write to disk.
- **Nested archives**: do not recurse. Only list and extract top-level entries.

## Client UI

- Gallery card: archive icon + file count badge + ext sample tag ("STLs · 42 files").
- Clicking opens a lightweight "Archive Contents" panel (same sliding-drawer pattern as
  the book reader) listing all paths in a scrollable tree.
- Each row: filename, size, "↓" download-file button.
- Full-archive download button stays at top (existing behavior unchanged).

## Known Limitations / Risks

- **RAR streaming**: `unrar p` pipes to stdout, which works well, but very large
  RAR entries (> 1 GB single file) will be slow to start.
- **RAR with passwords**: fail clearly at extraction with 400.
- **Concurrent extractions**: without the `wrap` rate limiter, duplicate simultaneous
  `unrar` spawns for the same archive could spike CPU.
- **Archive modification time**: `unrar l` gives a date field; parse it for display
  but do not require it.
