# Multi-volume storage backend proposal

**Status:** Proposal — not shipped
**Scope:** Local filesystem directories and mounted drives on one Dicefiles host

## Summary

Dicefiles should support several storage locations without exposing storage
topology to rooms, users, or plugins. Each physical content blob is assigned to
one configured volume when its upload begins. That volume identifier is stored
with the blob and remains stable for its lifetime. Downloads, previews,
archives, deduplication, expiry, and deletion continue to work through
`StorageLocation`; callers do not choose or search drives.

Two placement policies cover the main operator needs:

1. **Balanced** — place each new blob on the eligible primary volume with the
   lowest projected fill ratio. This keeps differently sized drives at a
   similar percentage full and accounts for uploads already in progress.
2. **Primary then fallback** — write to primary volumes normally. Allow
   fallback volumes only after primary storage crosses a soft watermark, such
   as 75%, or cannot fit the incoming file. Stop new writes to any volume at a
   hard watermark, such as 90%.

Every policy also enforces an absolute free-space reserve. Placement is made for
new physical blobs, not for every room reference: deduplicated uploads continue
to point to the existing blob on its existing volume.

The recommended first release adds safe placement and visibility, but not
automatic background migration. A later release can add an explicit,
journalled drain/rebalance operation after the basic multi-volume path has
proven reliable.

## Goals

- Support multiple local directories, partitions, mounted drives, and network
  mounts that present normal filesystem semantics.
- Balance new content according to remaining capacity and operator policy.
- Keep temporary upload data, the finished blob, and all generated assets on
  the same volume.
- Preserve resumable uploads, content deduplication, TTL expiry, previews,
  archive readers, byte-range downloads, and current room APIs.
- Make an unavailable volume a visible degraded state rather than making its
  files look deleted.
- Prevent concurrent workers from overcommitting the same remaining space.
- Upgrade existing installations without relocating existing content.
- Provide dry-run, auditable tools for later drain and rebalance operations.

## Non-goals

The first implementation is not:

- RAID, erasure coding, replication, or a backup system;
- striping one file across several drives;
- shared multi-host storage or a replacement for Dicefiles federation;
- an object-storage abstraction for S3-compatible services;
- automatic recovery from physical media failure;
- an automatic hot/cold lifecycle manager.

A blob has one authoritative physical location. Operators who need redundancy
must continue to provide it beneath Dicefiles or through backups.

## Current architecture and compatibility seam

Today `lib/storage.js` reads the single `uploads` directory and derives every
blob path from it:

```text
<uploads>/<first character>/<second character>/<storage name>
```

The rest of the application generally consumes the absolute `storage.full`
path. That is a useful compatibility boundary: a volume registry can change how
`StorageLocation` resolves its root while preview, archive, media, download, and
deletion code continue to use the same interface.

The serialized storage record currently contains the blob name, content hash,
media metadata, size, tags, and assets. Add one optional field:

```json
{
  "name": "opaque-storage-name",
  "hash": "content-hash",
  "volumeId": "primary-a"
}
```

Records without `volumeId` resolve to a synthetic `legacy` volume backed by the
existing `uploads` setting. This makes the schema additive and permits a
no-move upgrade.

## Terminology

- **Volume** — one configured storage directory with a stable, operator-chosen
  identifier. Several volume directories may be on different drives.
- **Primary volume** — normal destination for new writes.
- **Fallback volume** — a spill destination activated by the selected policy.
- **Blob** — the unique physical content object in `STORAGE`; several upload
  records may reference one blob through deduplication.
- **Asset** — a generated preview, cover, index, or other sidecar belonging to
  a blob.
- **Reservation** — temporary capacity held for an incomplete upload.
- **Soft watermark** — pressure level at which placement changes and operators
  are warned.
- **Hard watermark** — level beyond which no new allocation is allowed.
- **Drain** — stop new placement on a volume and deliberately move its existing
  blobs elsewhere.

## Configuration contract

Keep `uploads` for backward compatibility. Add a new `storage` object:

```json
{
  "uploads": "uploads",
  "storage": {
    "volumes": [
      {
        "id": "primary-a",
        "path": "/srv/dicefiles-a",
        "role": "primary",
        "enabled": true,
        "readOnly": false,
        "weight": 1,
        "softWatermarkPercent": 75,
        "hardWatermarkPercent": 90,
        "resumeWatermarkPercent": 70,
        "minFreeBytes": 10737418240
      },
      {
        "id": "primary-b",
        "path": "/mnt/dicefiles-b",
        "role": "primary",
        "enabled": true,
        "readOnly": false,
        "weight": 1,
        "softWatermarkPercent": 75,
        "hardWatermarkPercent": 90,
        "resumeWatermarkPercent": 70,
        "minFreeBytes": 10737418240
      },
      {
        "id": "fallback",
        "path": "/mnt/archive/dicefiles",
        "role": "fallback",
        "enabled": true,
        "readOnly": false,
        "weight": 1,
        "softWatermarkPercent": 85,
        "hardWatermarkPercent": 95,
        "resumeWatermarkPercent": 80,
        "minFreeBytes": 21474836480
      }
    ],
    "placement": {
      "policy": "balanced",
      "fallbackActivationPercent": 75,
      "allocationHeadroomBytes": 268435456,
      "unknownUploadReservationBytes": 1073741824,
      "capacityRefreshMs": 15000,
      "reservationTtlMinutes": 60
    },
    "rebalance": {
      "enabled": false,
      "targetPercent": 70,
      "maxBytesPerHour": 10737418240
    }
  }
}
```

### Backward-compatible normalization

- If `storage.volumes` is absent or empty, create an in-memory volume with
  `id: "legacy"` and `path: CONFIG.get("uploads")`.
- If `storage.volumes` is present, require stable unique identifiers. The old
  `uploads` path may be included explicitly as the `legacy` volume.
- Never rewrite `.config.json` merely to normalize legacy configuration.
- Unknown configuration fields are rejected with a clear startup error rather
  than silently ignored.
- Watermarks accept integer percentages from 1 through 99, with
  `resume < soft < hard`.
- `minFreeBytes`, headroom, weights, and timeouts must be finite non-negative
  numbers within documented bounds.

### Path validation

At startup, the registry must:

- resolve every configured path to an absolute canonical path;
- reject duplicate, nested, or overlapping volume roots;
- reject an identifier change if stored blobs still reference the old id;
- create the volume root only when explicitly permitted by configuration;
- verify read access for enabled volumes and write access for writable ones;
- verify temporary and final paths live under the selected root;
- prevent symlink traversal outside the canonical root;
- record filesystem identity so two aliases for the same mounted filesystem can
  be detected and reported;
- warn if a configured volume is the filesystem root or appears to be a system
  directory.

Paths are operator configuration. No room, upload, plugin, or public API may
supply an arbitrary filesystem path.

## Internal component boundaries

Introduce a small storage subsystem behind `StorageLocation`:

```text
StorageConfig
  validates and normalizes operator configuration

VolumeRegistry
  resolves volume ids, paths, health, state, and capacity snapshots

CapacityReservations
  atomically reserves and releases in-progress bytes across workers

PlacementPolicy
  returns a volume id from eligible capacity snapshots

StorageLocation
  resolves blob and asset paths using its durable volume id

StorageMover
  later performs journalled copy, verification, cutover, and cleanup
```

The placement interface should be deterministic and side-effect free:

```js
selectVolume({
  expectedBytes,
  volumes,
  policy,
  preferredVolumeId: null
}) => {
  volumeId,
  reason,
  snapshotVersion
}
```

Only the reservation service changes shared state. Keeping the policy pure makes
threshold and scoring behavior straightforward to test.

## Volume state model

Each volume has a runtime state:

| State | Reads | New writes | Meaning |
| --- | --- | --- | --- |
| `healthy` | yes | yes | Accessible and below the soft watermark |
| `soft-full` | yes | policy-dependent | Above soft watermark; warn or spill |
| `hard-full` | yes | no | Above hard watermark or absolute reserve |
| `read-only` | yes | no | Explicit operator setting |
| `draining` | yes | no | Existing blobs are being moved away |
| `unreachable` | no | no | Mount missing, timed out, or unreadable |
| `disabled` | yes when mounted | no | Excluded from placement by configuration |

State transitions use hysteresis. For example, a volume that becomes
`soft-full` at 75% does not become `healthy` again until it falls below 70%.
Without this gap, small uploads can repeatedly activate and deactivate fallback
storage.

An operator setting takes precedence over capacity-derived state. A read-only,
draining, disabled, or unreachable volume is never selected for a new upload.

## Capacity calculation

For each volume:

```text
physicalFree = statfs available blocks × block size
reserved     = bytes promised to incomplete uploads
effectiveFree =
  physicalFree
  - reserved
  - minFreeBytes
  - allocationHeadroomBytes

projectedUsedPercent =
  (totalBytes - physicalFree + reserved + incomingBytes)
  / totalBytes
  × 100
```

A volume is eligible only when:

- it is writable and in an allowed state;
- `effectiveFree >= incomingBytes`;
- projected use remains below its hard watermark;
- any policy-specific role and soft-watermark rules pass.

Both percentage and absolute limits are required. A 10 GB reserve is material
on a small root filesystem but nearly invisible as a percentage on a large
array. Conversely, a percentage watermark preserves operating margin as drives
grow.

`statfs` data should be cached briefly, but refreshed immediately after
`ENOSPC`, `EDQUOT`, mount errors, or an administrative capacity request.
Capacity sampling must have a timeout so a stalled network mount cannot stall
all placement decisions.

## Placement policies

### 1. Balanced

**Configuration:** `"policy": "balanced"`
**Recommended default when several primary volumes are configured.**

For every eligible primary volume, calculate its projected fill after the
incoming blob and its active reservations. Select the lowest projected fill.
This naturally puts more bytes on larger or emptier volumes and balances by
capacity rather than by file count.

For weighted volumes, divide projected pressure by the configured weight:

```text
placementScore = projectedUsedRatio / weight
```

A weight above 1 deliberately attracts more writes; a weight below 1 attracts
fewer. Weight does not bypass free-space or hard-watermark gates.

Tie-break with a stable hash of the upload key and volume id. This distributes
simultaneous equal scores without making results depend on process order.

Balanced mode initially considers primary volumes only. It admits fallback
volumes when:

- every primary is at or above `fallbackActivationPercent`;
- no primary can fit the incoming upload; or
- every primary is temporarily unavailable.

Once fallback is active, select the eligible volume with the lowest score from
the combined set. Operators who want all volumes used equally from the start can
mark all of them `primary`.

### 2. Primary then fallback

**Configuration:** `"policy": "primary-then-fallback"`

Use only eligible primary volumes while at least one can accept the upload
below the fallback activation watermark. Among those primaries, choose the
lowest projected fill.

Activate fallback storage when:

- all writable primaries would be at least 75% full after placement;
- the incoming file does not fit safely on any primary; or
- primary storage is unreachable.

The 75% threshold is a routing decision, not a stop condition. A primary may
remain readable and may receive already-reserved resumable writes. At 90%, or
when its absolute free-space reserve would be violated, it is hard-full and
receives no new reservations.

This policy suits a fast local SSD plus a larger slower disk. It does not move
old SSD content automatically; it only changes where new unique blobs land.

### Policies intentionally omitted from the first release

- **Round robin** balances file count, not bytes or risk of exhaustion.
- **Most free bytes** can fill small drives disproportionately and produces
  poor percentage balance.
- **Random weighted by free bytes** spreads contention but is harder to explain
  and reproduce during incidents.
- **Fill one drive completely, then the next** creates avoidable failure risk
  and complicates maintenance.

These can be added later behind the same policy contract if an actual deployment
needs them.

## Upload and reservation flow

### Registration

Placement should occur when the server first has a useful expected size:

1. Register the upload key as today.
2. On the first upload request, calculate
   `expectedBytes = offset + Content-Length` when trustworthy.
3. If size is unknown, reserve
   `unknownUploadReservationBytes`, bounded by `maxFileSize`.
4. Select a volume and atomically create a reservation in Redis.
5. Persist `volumeId`, reserved bytes, and a reservation id in the pending
   upload hash.
6. Construct temporary `StorageLocation` from that persisted volume id.

Every resumed request reads the original pending `volumeId`; it must not run
placement again. This preserves partial data and prevents a retry from changing
drives.

### Cross-worker reservations

Filesystem free-space samples alone are racy when several Node workers accept
uploads simultaneously. Use Redis for shared reservations:

```text
storage:reservation:<uploadKey>
  volumeId
  bytes
  createdAt
  expiresAt
```

An atomic Redis script creates, extends, or releases the reservation and updates
the volume's reserved-byte total. The script must be idempotent by upload key.
The pending upload TTL and reservation TTL should align. A reconciler removes
expired reservations and repairs aggregate totals after unclean shutdown.

Reservations are conservative, not accounting records. If a streaming upload
grows beyond its reservation:

1. attempt to extend the reservation before accepting more bytes;
2. refresh the capacity sample;
3. stop cleanly with a retryable insufficient-storage error if extension fails.

Never silently continue until the filesystem returns `ENOSPC`.

### Finalization and deduplication

After hashing completes:

- If the hash is new, promote the temporary file in place on its selected
  volume, persist `volumeId` on the finished storage record, and release any
  unused reservation.
- If the hash already exists, delete the temporary file and reservation, then
  reference the existing blob on its existing volume.
- Do not copy a deduplicated blob to the newly selected volume merely because
  it would improve balance. Deduplication should still mean one physical blob.
- Generate preview and archive assets beside the authoritative blob so they are
  deleted and migrated as one unit.

The temporary file and final blob must share a filesystem, making final
promotion an atomic rename. Never stage all uploads in a global temporary
directory on another drive.

### Programmatic ingestion

`ingestFromBuffer`, plugin imports, bot uploads, and future federation caching
must call the same allocator and reservation path. No ingestion entry point
should instantiate an unplaced temporary `StorageLocation` directly.

The internal API should accept an expected byte count but not a caller-selected
volume. A future operator-only migration tool may request a destination
explicitly through a separate privileged interface.

## Read, asset, and delete behavior

- Resolve the volume directly from persisted `volumeId`.
- Never scan all volumes on the normal read path.
- For a legacy record without `volumeId`, resolve through the `legacy` volume.
- If its volume is unavailable, return a retryable service error, not `404`.
  The file still exists logically and must not be presented as expired.
- New writes may continue on other healthy volumes while affected reads report
  degraded storage.
- Assets remain addressed as sidecars of their blob and resolve through the
  same volume.
- Reference counting and deduplication remain global across volumes.
- When the final reference expires, delete the blob and assets from their
  recorded volume, then remove now-empty sharding directories there.

An optional repair command may scan configured volumes for a missing blob, but
that is diagnostic recovery, never ordinary request behavior. If it finds a
blob under a different root, it should propose or perform an explicit metadata
repair with an audit record.

## Error contract

Storage errors should use stable machine codes and human-readable messages:

| HTTP | Code | When |
| --- | --- | --- |
| `507` | `STORAGE_CAPACITY_EXHAUSTED` | No writable volume can safely reserve the upload |
| `503` | `STORAGE_VOLUME_UNAVAILABLE` | A known blob's volume cannot currently be read |
| `503` | `STORAGE_PLACEMENT_UNAVAILABLE` | Capacity could not be established safely |
| `409` | `STORAGE_RESERVATION_CONFLICT` | Pending upload state conflicts with its reservation |
| `422` | `STORAGE_CONFIG_INVALID` | Operator or admin configuration fails validation |

Example:

```json
{
  "error": {
    "code": "STORAGE_CAPACITY_EXHAUSTED",
    "message": "No storage location has enough safe free space for this upload.",
    "requestId": "opaque-correlation-id"
  }
}
```

Public errors must not contain filesystem paths, mount names, device ids, or
free-space values. Operator logs may include volume ids and internal details,
but secrets and user filenames should remain out of capacity telemetry.

## Health, status, and observability

### `/healthz`

Extend health data additively:

```json
{
  "checks": {
    "storage": {
      "ok": true,
      "writableVolumes": 2,
      "readableVolumes": 3,
      "totalVolumes": 3,
      "degraded": false,
      "volumes": [
        {
          "id": "primary-a",
          "role": "primary",
          "state": "healthy",
          "writable": true,
          "totalBytes": 1000000000000,
          "freeBytes": 400000000000,
          "reservedBytes": 1200000000,
          "usedPercent": 60,
          "probeLatencyMs": 2
        }
      ]
    }
  }
}
```

Do not expose absolute paths. Preserve the current single-volume fields for at
least one release so existing health consumers do not break.

Overall health rules:

- **healthy:** Redis works and every required volume is readable, with at least
  one writable destination;
- **degraded:** one optional/fallback volume is unavailable or soft-full, but
  reads and safe writes can continue;
- **unhealthy:** no writable volume remains, a required volume is inaccessible,
  or storage state cannot be determined safely.

### Protected status page

Show aggregate capacity plus per-volume cards identified by configured display
name or id. Never show filesystem paths. Useful additions include:

- used, free, reserved, and protected bytes;
- current volume state and soft/hard watermark markers;
- placements and written bytes by volume over time;
- allocation failures and `ENOSPC` events;
- fallback activations;
- rebalance/drain progress;
- capacity trend and estimated time to the soft watermark.

The existing protected status capability continues to gate this detail. A
fully public status page should aggregate volumes and omit identifiers unless
the operator explicitly opts in.

### Metrics and logs

Use bounded volume ids as metric labels:

- `dicefiles_storage_total_bytes{volumeId}`
- `dicefiles_storage_free_bytes{volumeId}`
- `dicefiles_storage_reserved_bytes{volumeId}`
- `dicefiles_storage_state{volumeId,state}`
- `dicefiles_storage_placements_total{volumeId,reason}`
- `dicefiles_storage_write_failures_total{volumeId,code}`
- `dicefiles_storage_rebalance_bytes_total{sourceId,destinationId}`

Do not use room ids, filenames, upload keys, paths, or device ids as metric
labels. Emit structured lifecycle events for state changes, reservation leaks,
fallback activation, move start/completion, and failed verification.

## Operator interface

Configuration remains file-based in the first release. Add read-only automation
API visibility only if there is a clear operator need:

| Route | Scope | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/storage/volumes` | `storage:read` | Paginated volume health and capacity |
| `POST /api/v1/admin/storage/placement-preview` | `storage:read` | Explain where a hypothetical size would be placed |
| `POST /api/v1/admin/storage/moves` | `storage:write` | Start a validated, explicit move in a later phase |
| `GET /api/v1/admin/storage/moves/:id` | `storage:read` | Inspect move progress and audit state |

All responses use the existing structured API error shape. Mutation endpoints
require a dedicated write scope; `mod:*` should not implicitly grant host
storage control. List endpoints are cursor-paginated from their first release.

Dangerous operations require a dry-run plan followed by an explicit plan id.
They must not accept raw filesystem paths.

## Moving, draining, and rebalancing

### First-release boundary

Do not automatically move existing blobs in the first multi-volume release.
Operators can add volumes and immediately direct new writes without risking a
large background migration. Existing legacy content remains readable from its
current directory.

### Later mover design

Add an idempotent move journal with these stages:

```text
planned -> copying -> verified -> metadata-switched -> source-cleaned -> complete
                                    \-> cleanup-pending
```

For one blob:

1. Refuse temporary, incomplete, or already-moving storage.
2. Reserve destination capacity for the blob and all sidecars.
3. Copy the main blob and assets to destination-specific temporary names.
4. Flush writes and verify file lengths plus a streaming checksum.
5. Atomically rename temporary destination files into place.
6. Compare-and-set the storage record from source `volumeId` to destination
   `volumeId`.
7. Keep the source for a short grace period or until active readers drain.
8. Delete source files and release the reservation.
9. Record completion in the journal.

If the process crashes:

- before metadata cutover, reads continue from source and destination
  temporaries are safe to remove or resume;
- after metadata cutover, reads use destination and source cleanup can resume;
- a conflicting metadata version stops the move for operator review.

Use the current content identity for lookup, but verify migration copies with a
full streaming checksum such as SHA-256. A truncated application content id is
not by itself sufficient evidence that a copy operation completed correctly.

### Drain

Setting a volume to `draining` immediately prevents new allocations. The
planner chooses destination volumes with ordinary capacity gates and reports:

- number and bytes of movable blobs;
- blobs with no eligible destination;
- estimated destination fill after the plan;
- deduplicated reference counts that remain untouched;
- expected duration at the configured byte rate.

Drain completion does not remove configuration automatically. The operator
disables or removes the empty volume in a separate step.

### Rebalance

Rebalance should be opt-in, rate-limited, pausable, and restart-safe. It moves
only enough blobs to bring volumes toward a configured target; it does not seek
perfect equality after every upload.

Prefer larger, colder blobs when that reduces the number of operations, but
avoid moving a file that is currently being written, previewed, or frequently
downloaded. The first implementation may simply exclude active blobs and retry
them later.

Apply a minimum improvement threshold so a move must materially improve
projected pressure. This prevents oscillation and pointless drive wear.

## Failure behavior

| Failure | Required behavior |
| --- | --- |
| Volume disappears before placement | Mark unreachable and choose another eligible volume |
| Volume disappears during upload | Stop the stream, preserve retry state when safe, return retryable error |
| `ENOSPC` despite reservation | Stop, refresh capacity, mark hard-full, alert, release/repair reservation |
| Read volume unavailable | Return `503`, never treat blob as missing or expire its metadata |
| Fallback unavailable below threshold | Continue on eligible primary and report degraded health |
| Primary unavailable | Spill to fallback if policy and capacity allow |
| Redis unavailable | Do not make uncoordinated new reservations; existing reads may continue |
| Capacity probe times out | Exclude that volume until a successful probe |
| One worker crashes | Reservation expires/reconciles; other workers keep a consistent total |
| Process crashes during move | Recover from journal without ambiguous authoritative copies |
| Config removes referenced volume id | Fail startup validation with a count of affected blobs |

When no volume can safely accept an upload, fail before consuming its body when
possible. Dicefiles should never degrade capacity protection into best-effort
writing.

## Security and privacy

- Treat configuration, mount state, and free-space values as operator data.
- Do not include paths in public API responses or browser-rendered errors.
- Canonicalize roots and reject traversal before joining a blob name.
- Keep the existing opaque storage naming and sharded subdirectories.
- Open files with safe flags and do not follow unexpected symlinks.
- Restrict storage inspection and movement to dedicated automation scopes.
- Audit configuration validation, state changes, moves, and destructive cleanup.
- Avoid automatic mount commands or privilege escalation; Dicefiles consumes
  already-mounted paths.
- A network mount is untrusted operational infrastructure. Time out probes and
  file operations, and never let one stalled volume block unrelated reads or
  writes indefinitely.

## Upgrade and migration plan

### Phase 0 — contract and safety tests

- Define volume config, serialized `volumeId`, states, errors, and policy API.
- Add pure placement-policy tests and config-validation tests.
- Inventory all direct uses of `CONFIG.get("uploads")`; route storage paths
  through the registry.

### Phase 1 — registry with one synthetic legacy volume

- Introduce `VolumeRegistry`.
- Keep all placement on the existing directory.
- Add optional `volumeId` serialization and legacy resolution.
- Verify previews, archives, assets, range requests, deduplication, expiry, and
  deletion are behaviorally unchanged.

This phase should be safe to release independently.

### Phase 2 — multi-volume placement and reservations

- Add configuration normalization and startup probes.
- Add Redis-backed reservations.
- Route streaming and buffer/plugin ingestion through one allocator.
- Ship `balanced` and `primary-then-fallback`.
- Add structured capacity errors and degraded read behavior.

### Phase 3 — health and operator visibility

- Extend `/healthz` additively.
- Add protected status-page volume views and capacity history.
- Add read-only operator API and placement preview if required.
- Alert on soft/hard watermarks, inaccessible volumes, reservation drift, and
  fallback activation.

### Phase 4 — manual move and drain

- Add dry-run plan, move journal, checksum verification, rate limiting, and
  recovery.
- Support explicit volume drain.
- Keep automatic rebalance disabled.

### Phase 5 — optional controlled rebalance

- Add target-based rebalance with pause/resume and bandwidth limits.
- Base movement on observed operational needs.
- Consider hot/cold tiers only after access telemetry is mature.

## Test strategy

### Unit tests

- Config accepts a synthetic legacy volume and rejects duplicate or overlapping
  roots.
- `resume < soft < hard` and numeric bounds are enforced.
- Balanced policy selects the lowest projected fill for unequal drive sizes.
- Weights influence scoring without bypassing safety gates.
- Fallback stays unused below the activation threshold.
- Fallback activates at the threshold or when no primary can fit.
- Hard-full, read-only, draining, disabled, and unreachable volumes are never
  selected.
- Hysteresis prevents rapid state flapping.
- Equal scores have a stable, well-distributed tie-break.
- No policy returns a volume that violates the absolute reserve.

### Integration tests

Use isolated temporary directories and injected capacity snapshots:

- new upload, resume, finish, read, range request, expiry, and final deletion;
- one blob with multiple upload references across rooms;
- dedup hit when the second upload was initially placed on another volume;
- image/PDF preview, archive index, and all asset cleanup;
- `ingestFromBuffer` and plugin ingestion;
- restart with pending reservations;
- legacy record without `volumeId`;
- read from a read-only or soft-full volume;
- volume loss during write and during read;
- `ENOSPC`, permission failure, probe timeout, and Redis outage;
- process restart before and after migration metadata cutover.

### Concurrency and property tests

- Many workers reserve against the same small capacity without oversubscription.
- Expired reservations reconcile exactly once.
- Random volume states and file sizes never select an ineligible volume.
- Total physical blob count remains one per content hash.
- Repeated move recovery is idempotent.

### Operational acceptance

- Add a second empty volume to an existing installation without moving data.
- Demonstrate balanced placement across unequal capacities.
- Demonstrate 75% fallback activation and 90% hard stop.
- Disable and re-enable a volume without metadata loss.
- Confirm health and status never expose local paths.
- Confirm rollback to a single configured legacy volume remains possible before
  any explicit data move.

## Recommended defaults

- Preserve the current single `uploads` directory unless an operator configures
  multiple volumes.
- Use `balanced` for multiple same-purpose primary volumes.
- Use `primary-then-fallback` when storage tiers have meaning.
- Default soft/hard/resume watermarks to **75% / 90% / 70%**.
- Require an operator-chosen absolute reserve; recommend at least 10 GB, but do
  not assume that value suits every host.
- Keep assets with their blob.
- Use Redis reservations for every write path.
- Treat missing mounted storage as degraded or unavailable, never as expired
  content.
- Ship placement before migration.
- Keep automatic rebalancing off by default even after it exists.

## Decisions to make before implementation

1. Should network filesystems be supported in the first release or documented
   as best-effort until their timeout behavior is hardened?
2. Should a missing fallback volume degrade `/healthz` while a missing primary
   volume makes it unhealthy, or should `required` be a separate volume flag?
3. What default absolute reserve is safe for the smallest supported host?
4. Should an unknown-length upload reserve `maxFileSize`, a configured fixed
   amount, or be rejected when no maximum is configured?
5. Does the first operator surface need mutation APIs, or are config plus
   command-line dry-run tools sufficient?
6. How long should a migrated source copy remain during the cleanup grace
   period?
7. Should status history be sampled into Redis or derived from the existing
   observability log?

The architecture does not depend on these policy choices. They can be resolved
before their respective implementation phase without changing stored blob
identity or the `StorageLocation` contract.
