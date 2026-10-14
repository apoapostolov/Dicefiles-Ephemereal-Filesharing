# Performance notes (overhaul 1.4.0)

## File list virtualization

- Pure helpers: `client/files/windowing.js` (`computeWindow`, `sliceWindow`, `shouldVirtualize`).
- Threshold: virtualize when filtered count ≥ **120** (gallery uses 100-tile pages; links retain their existing rendering).
- Unit tests (`tests/unit/windowing.test.js`) drive a **500-file** synthetic set and assert the mounted window stays well under 80 rows for a 600px viewport / 40px row height with overscan 5.

## Cold room payload

- Production webpack (`yarn prestart`) emits async chunks:
  - `reader` (webpack chunk name / `static/reader.js`)
  - `archivemodal`
  - `xregexp` (existing prefetch)
- Gallery constructs the Reader only on first **Read Now** (`ensureReader` dynamic import).
- Archive modal was already dynamic-imported from `client/files/file.js`.

## Workers

- Default `workers` is now `min(max(NUM_CPUS - 1, 2), 4)` (was `max(NUM_CPUS + 1, 2)`).
- Operators with dedicated multi-core hosts should set `workers` explicitly in `.config.json`.

## Redis

- node-redis **v6** with Lua scripts loaded at connect; rate-limit and distributed maps use the same script surface as 1.3.x.

## Unreleased bounded work

Disk probes use async filesystem calls, coalesce concurrent probes and fail closed
after two seconds. Gallery paging bounds mounted tiles to 100 while preserving
global sorting. Continue Reading reads its small local history directly and does
not load the reader bundle. These resource bounds do not establish a production
throughput improvement; measure on the deployment workload.
