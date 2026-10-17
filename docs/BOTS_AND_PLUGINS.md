# Bots and plugins: audit and expansion plan

Audit date: 2026-10-16. Implementation shipped in Hobbyfiles 1.4.7.
For current usage, read the [power-user guide](./CORE_PLUGINS.md),
[API reference](../core/plugins/PLUGIN_API.md) and
[cookbook](../core/plugins/PLUGIN_COOKBOOK.md). The audit below records the
implementation findings and acceptance boundaries.
The registry includes 27 built-in bots: the four existing modules and all
23 retained collectors, community workflows and maintenance bots below. Provider
access still requires operator grants and credential-bound live acceptance.
See the [collection guide](../core/plugins/COLLECTION_BOTS.md) and
[workflow guide](../core/plugins/WORKFLOW_BOTS.md) for configuration.

## Audit scope and findings

Reviewed registry/loading, room invitations, timers, event delivery, leases,
run status, sync memory, upload/HTTP adapters, inbound commands, REST/MCP
administration, provider resolution and operator documentation.

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | Mega source URLs, including decryption keys, were copied into upload metadata | New imports store a SHA-256 source fingerprint; public upload and webhook serialization also filters the legacy field without changing stored imports |
| High | JSON requests stopped their timeout after headers, and read unlimited response bodies | Timeout now covers body consumption; streamed responses are capped at 1 MiB by default, configurable up to 8 MiB; redirects are rejected |
| High | Provider error bodies could echo credentials into errors | HTTP errors use bounded status-specific recovery messages; run errors remove configured secrets and remote addresses |
| High | Plugin module IDs could contain filesystem paths | Shared ID normalization rejects paths and handles the former Mega aliases consistently |
| High | Simultaneous manual/scheduled runs could duplicate work | Room and global runs share a per-bot active lease; local overlap is also suppressed; production lease completion/unlock checks ownership atomically |
| Medium | Room hooks scheduled a rerun without the invitation list | Scheduled work resolves the latest room invitation; revoked/disabled invitations cannot run |
| Medium | Repeated room synchronization restarted unchanged timers and startup scans | Unchanged timer configurations retain their timer; pending work rechecks current invitations |
| Medium | Legacy events bypassed leases/status, and synchronous hook failures escaped isolation | Legacy events use the run path; room event hooks record bounded status and isolate failures |
| Medium | Disabled providers remained resolvable; partial API updates could enable disabled bots | Provider resolution honors disabled state; omitted `enabled` preserves its prior value; disabled run requests return 409 |
| Medium | Buffered imports bypassed stream size limits | Both upload paths enforce the supplied byte limit; streaming defaults to a bounded limit |
| Medium | Mega's process cache outlived durable retention/reset | Durable sync memory is authoritative on each scan; the per-run mirror is bounded |
| Medium | Mega account login was attached through an unused `File.storage` property | The installed SDK's authenticated `api` is passed into `File.fromURL`; account folder enumeration/keepalive are disabled, cleanup is exposed, and fetches share a scan deadline |
| Medium | Discord commands could exceed the initial-response deadline | Slow authenticated interactions defer, then edit the original response; caller allowlists and mention suppression remain in force |
| Medium | Telegram treated ordinary chat as commands and used older reply fields | Plain chat, bot messages and commands addressed elsewhere are ignored; replies use `reply_parameters` and `link_preview_options` |
| Medium | Rate limits retried too early; Telegram JSON-level errors were not classified | Retry-After is respected within the bounded retry budget; longer waits fail for later recovery rather than retrying early; Telegram failures carry retryability |
| Medium | Bot file reads lacked stable pagination/search; request actions lost bot identity | `listFilesPage` adds stable timestamp/key cursors and filters; room API/upload wrappers enforce room and bot identity, and request creation respects room policy |
| Medium | REST config redaction ignored schema secrets and nested credentials | Write-only schema fields, source folder URLs and nested secret-like fields are redacted; partial updates retain omitted credentials |
| Medium | New bot forms invented zero import limits/topic IDs and false privacy defaults | Forms honor schema defaults; imports start with valid limits and manual-only polling, Telegram topics stay blank, and Discord replies default to caller-only |
| Medium | Mega aliases used different active-run keys in room execution | Canonical IDs now apply before module loading, leases and status records |
| Medium | Partial room-UI updates could replace credentials or re-enable disabled bots | The shared upsert merges saved config, preserves omitted enabled state and checks the combined size; explicit blank non-secret fields clear settings |
| Medium | Plugins throwing non-Error values could replace the useful failure with a TypeError | Room/global execution normalize and redact failures before recording status and releasing leases |
| High | Room hook failure status did not apply configured-secret redaction before persistence | Hook status now sanitizes Error, string and null failures using the invited configuration before saving or exposing them |
| Documentation | Remote import documentation still described implemented Gofile/Plowshare adapters as future work | Operator guides now distinguish implemented adapters from proposed providers |

### Expanded capabilities implemented in this round

- **Mega.nz and Remote Host Import:** `includeExtensions`,
  `excludeNameContains`, `dryRun`, and a `preview` run mode. Previews list bounded
  eligible files without downloading bodies, uploading or marking imports as
  completed. Listing the provider still makes metadata/API requests.
- **Discord and Telegram:** opt-in `files`, `find` and `expiring` inbound
  commands; `expiring` covers the next 24 hours. Commands still require the
  configured authenticated caller and explicit command allowlist.
- **Publishers:** `notifyRequests` optionally announces new/fulfilled requests;
  `digest` publishes up to eight recent room files. Defaults retain file-only
  announcements and a connection test for manual Run now.
- **Administration:** REST and MCP can select supported run modes without
  rewriting bot settings. Catalog/invitation responses advertise `runModes`.
  Room Options offers the same mode selector. New importer invitations default
  to manual-only scans; existing configured intervals are retained.
- **Developer API:** `listFilesPage({roomId, query, since, expiresBefore, cursor,
  limit})` returns `{files, nextCursor}`; existing `listFiles` still returns an
  array. Pagination is stable across tied timestamps, not a frozen snapshot.
- **API v2 foundations:** private Redis checkpoint storage with atomic versions,
  expiry and quotas; room-scoped individual file reads and inventory summaries;
  bounded text/binary HTTP; renewable execution leases with cooperative
  cancellation. [The current contract](../core/plugins/PLUGIN_API.md)
  documents callable jobs, collection, review and maintenance adapters. Historical
  extension proposals remain separate from that reference; the
  [cookbook](../core/plugins/PLUGIN_COOKBOOK.md) shows the implemented patterns.

## Architecture limits and required foundations

First-party modules remain trusted code running inside a server worker.
Capabilities describe intent; they are not a sandbox. Room-scoped injected
adapters prevent accidental cross-room actions but cannot stop a trusted module
from importing server internals. External service credentials and permissions
must be configured by the operator; this audit does not activate destinations.

Delivery uses scoped durable jobs with renewable ownership, current invitation
checks, retry-at/Retry-After, cancellation and explicit replay. A crash after a
provider accepts a publication can still leave an uncertain outcome; no external
exactly-once guarantee is claimed. Successful source revisions are remembered;
new revisions create separate copies. Provider quotas and permissions remain
external constraints.

The shared foundations are implemented: durable jobs, operator connection
references and encrypted refresh-token storage, typed link ingest, provider
cursors, reviewed mutations, bounded maintenance adapters and activity controls.
Rooms accept up to 32 bot invitations within the existing total config-size cap.
Reports/actions are rendered by the host; trusted plugins cannot inject arbitrary
UI through this contract. Built-in mutations check their room and revision and
retain a bounded action audit. Quarantine additionally requires owner opt-in;
storage/backup readers require explicit operator grants.

## 23 retained bots

Original proposal numbers are retained for review. Proposals 2, 3, 9, 10 and
12–16 were removed from the development scope. Proposals 17 onward remain.

The tables preserve the delivery order and original acceptance criteria.
Cadences are defaults, not provider guarantees.
Every bot needs fixture coverage for authorization, pagination, rate limits,
duplicate events, restart recovery and redaction, plus a manual acceptance run
with operator-owned credentials before being advertised as production ready.

### External services and file collection

| # | Bot / ID | Minimum useful behavior | Access and first acceptance gate |
| --- | --- | --- | --- |
| 1 | Feed Collector / `feed-collector` | Poll selected Atom/RSS feeds every 30 min; collect links first, import approved enclosures optionally | Public allowlisted feeds; ETag/Last-Modified; XML without external entities; duplicate entry IDs create one item. [Atom standard](https://www.rfc-editor.org/rfc/rfc4287) |
| 4 | S3 Collection / `s3-collection` | Read one bucket/prefix hourly, stream selected objects, detect revisions | Bucket/prefix-scoped list/read policy; no delete permission; continuation tokens and version/checksum tests. [ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html) |
| 5 | Nextcloud Collection / `nextcloud-collection` | Poll one selected WebDAV folder every 30 min | Dedicated read-only account/app password; depth/response caps and ETag changes. [WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/index.html) |
| 6 | Google Drive Collection / `drive-collection` | Import operator-selected folders using change tokens | OAuth or an explicitly shared service account; minimal approved access, token renewal, deleted/unshared file handling. [Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes) |
| 7 | Dropbox Collection / `dropbox-collection` | Import one selected folder; continue listing through its cursor | Scoped Dropbox app; folder selection, continuation and reset acceptance. [HTTP API](https://www.dropbox.com/developers/documentation/http/documentation) |
| 8 | OneDrive Collection / `onedrive-collection` | Follow changes in an approved drive/folder | Graph authorization approved for the selected drive; delta continuation/removals. [Graph delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0) |
| 11 | Dataset Releases / `huggingface-collection` | Collect selected model/dataset repository files at pinned revisions | Public read or minimal approved token; gated repositories remain gated; size preview before download. [Hub API](https://huggingface.co/docs/hub/api) |

### Community management

| # | Bot / ID | Minimum useful behavior | Required contract / acceptance |
| --- | --- | --- | --- |
| 17 | Welcome Guide / `welcome-guide` | Quiet onboarding with room rules, collections and request help | Add member-join event and per-member cooldown; no repeated message on reconnect |
| 18 | Request Triage / `request-triage` | Suggest existing files for a new request using deterministic title/tag matches | Read files/requests, post suggestions; never mark a request fulfilled without confirmation |
| 19 | Request Steward / `request-steward` | Remind claimants of stale claims and offer owner review | Typed claim/release API and request leases; do not steal active claims |
| 20 | Community Digest / `community-digest` | Weekly new files, fulfilled requests and collection highlights in room chat | Durable schedule/watermark and room timezone; dedupe one bulletin per period |
| 21 | Collection Curator / `collection-curator` | Propose tags and themed collections from metadata | Review queue and tag-preview API; no silent retagging of manually curated files |
| 22 | Duplicate Review / `duplicate-review` | Group exact hashes and suggest likely name/version duplicates | Read inventory and review records; deletion remains a separate owner-approved action |
| 23 | Upload Review / `upload-review` | Flag configured size/type/policy violations for moderators | Explicit moderation rules and queue; reversible quarantine only after owner opt-in |
| 24 | Session Organizer / `session-organizer` | Room-local event reminders, preparation links and session packs | Durable room-timezone schedule, RSVP/event model and quiet hours; no external calendar writes initially |

### Maintenance and collection quality

| # | Bot / ID | Minimum useful behavior | Required contract / acceptance |
| --- | --- | --- | --- |
| 25 | Expiry Concierge / `expiry-concierge` | Daily summary of valuable files nearing expiry | Read expiry data, dedupe reminders; never extend TTL automatically without a configured policy |
| 26 | Preview Repair / `preview-repair` | Find missing/failed thumbnails and enqueue bounded retries | Typed preview inspection/retry adapter; native-tool diagnostics, cancellation and load limits |
| 27 | File Integrity / `file-integrity` | Periodic bounded checksum verification and missing-blob reports | Storage read adapter, incremental checkpoints and I/O budget; report before destructive repair |
| 28 | Storage Capacity / `storage-capacity` | Alert on configured storage thresholds and predict exhaustion from measured usage | Aggregate metrics only; hysteresis/cooldown; no automatic deletion |
| 29 | Backup Verification / `backup-verification` | Check backup freshness and verify a sampled restore in an isolated location | Operator-configured backup reader; no production restore or secret export; verified recovery report |
| 30 | Link Health / `link-health` | Relaxed checks of collected external links, distinguish failures from rate limits | SSRF-safe HEAD/bounded GET adapter; private-network denial and no credential-bearing URL logs |
| 31 | Access Review / `access-review` | Report stale invites, unused automation credentials and overly broad grants | Dedicated administrative summary API; no secrets in report and no automatic revocation |
| 32 | Metadata Steward / `metadata-steward` | Retry missing bibliographic/movie metadata and report unmatched items | Reuse existing metadata/matching queues, provider budgets and manual precedence; do not duplicate torrent availability monitoring |

## Ordered development TODO

This checklist is the detailed execution order linked from the canonical
[product backlog](./FUTURE_DEVELOPMENT_PLAN.md#plugin--bot-follow-ups).
Checked items describe the implemented useful minimum with automated fixtures
and documentation. Credential-bound live rollout remains a separate gate.
Complete one bot's useful minimum and acceptance checks before moving to the
next. A provider credential gate does not justify advertising untested live
behavior or enabling an external destination automatically.

### 0. Repair the four existing plugins first

- [x] Shared runtime: safe IDs and canonical alias locks, latest invitations,
  unchanged timers, overlap prevention, renewable/atomic leases and useful errors.
- [x] Mega.nz and Remote Host Import: body/file/scan limits, account cleanup,
  durable dedupe, provider disable rules, filters and non-mutating previews.
- [x] Discord and Telegram: authenticated command allowlists, correct response
  timing/replies, bounded retries, opt-in request notices, file queries/digests.
- [x] Room UI/REST/MCP: valid defaults, partial settings that preserve credentials
  and disabled state, explicit setting clearing, run modes and sanitized status.
- [x] Add regression fixtures and update the plugin/operator/API documentation.
- [x] Run the final regression/lint/build checks and stable-service health checks:
  Regression fixtures, lint and production build pass; WSL/Windows health
  returns 200. The browser verifies disabled settings save/clear and schema
  defaults after restart, with no provider run.

### 1. Shared collection and workflow foundations

- [x] Expose the existing durable outbox through scoped plugin jobs: idempotency,
  retry-at/Retry-After, renewal, bounded attempts, cancel/replay and dead letters.
  Move existing publisher delivery onto it before adding more destinations.
- [x] Add credential references and connection checks; keep raw tokens out of
  room API reads, job payloads and diagnostic messages.
- [x] Add typed safe link/enclosure ingest and provider revision checkpoints,
  reusing the current streamed upload adapter and private state API.
- [x] Add the job/connection/preview controls needed by these workflows, with
  quiet defaults and explicit owner opt-in for writes or external publication.

### 2. File collectors, in retained proposal order

- [x] **Feed Collector (#1):** allowlisted RSS/Atom, conditional requests, stable
  entry dedupe, links first; optional bounded enclosure preview/import.
- [x] **S3 Collection (#4):** bucket/prefix read scope, continuation, streamed
  objects, version/checksum dedupe; no bucket mutation permission.
- [x] **Nextcloud Collection (#5):** selected WebDAV folder, read-only credentials,
  bounded depth and ETag-based changes.
- [x] **Google Drive Collection (#6):** selected folders, approved minimal access,
  change-token renewal and deleted/unshared file handling.
- [x] **Dropbox Collection (#7):** selected folder, continued cursors, resets and
  revision-aware import without duplicate rows.
- [x] **OneDrive Collection (#8):** selected drive/folder, Graph delta continuation,
  removals and expired-token reconciliation.
- [x] **Dataset Releases (#11):** explicitly selected Hugging Face repository
  files at pinned revisions; size preview, license/provenance and gated access.

Collector settings, preview/test, shared byte budgets, cancellation, durable
checkpoints and redaction are implemented. Provider fixtures cover listing/change
contracts; local UI checks cover catalog/forms, job controls and recovery.
Authenticated provider-account rollout remains unverified until test credentials
and destinations are supplied.

### 3. Community workflows, in retained proposal order

- [x] **Welcome Guide (#17):** add a member-join contract and durable cooldown;
  useful room/file/request help once, with reconnect suppression.
- [x] **Request Triage (#18):** deterministic file suggestions with an explicit
  review action; add typed request association APIs without false fulfillment.
- [x] **Request Steward (#19):** adapt existing claim/release APIs, revision checks
  and stale-claim review; preserve active human claims.
- [x] **Community Digest (#20):** durable room-timezone schedule/watermark;
  one quiet bulletin per period using existing file/request summaries.
- [x] **Collection Curator (#21):** add collection membership, metadata proposal
  and review APIs; preserve manual choices and make changes reversible.
- [x] **Duplicate Review (#22):** exact hashes first, name/version candidates
  second; add review records, with no automatic deletion.
- [x] **Upload Review (#23):** explicit rules, moderator queue and separately
  granted reversible quarantine; report-only by default.
- [x] **Session Organizer (#24):** room-local event/RSVP model, timezone-aware
  reminders and preparation packs; deduplicated delivery and quiet hours.

### 4. Maintenance and collection quality, in retained proposal order

- [x] **Expiry Concierge (#25):** bounded expiry summaries and cooldowns; any TTL
  extension needs an explicit owner policy and audit event.
- [x] **Preview Repair (#26):** typed inspect/retry adapter, native-tool diagnosis,
  job cancellation and bounded CPU/I/O budgets.
- [x] **File Integrity (#27):** sampled/incremental checksums, missing-blob report
  and checkpoints; report before repair.
- [x] **Storage Capacity (#28):** aggregate thresholds, measured usage trend,
  hysteresis and cooldown; no deletion.
- [x] **Backup Verification (#29):** freshness checks and a sampled restore in an
  isolated location; no production restore or credential export.
- [x] **Link Health (#30):** SSRF-safe relaxed probes with bounded redirects/body,
  rate-limit handling and redacted addresses.
- [x] **Access Review (#31):** dedicated summary scopes, stale-invite/credential
  review and grant recommendations; no raw secrets or automatic revocation.
- [x] **Metadata Steward (#32):** reuse matching/metadata queues, budgets and
  manual precedence; no duplicate torrent-availability worker.

Typed adapters, room/revision checks and audit history accompany reviewed
mutations. Community and maintenance fixtures use synthetic rooms and real
temporary file/backup bytes. Reports are bounded recommendations, not proof of
whole-library health.

## Validation and rollout

The audit's automated fixtures exercise fake provider responses and synthetic
room data. Live publication to Discord/Telegram and account-authenticated
imports require operator-owned test destinations and are not implied by passing
fixtures. No new external destinations should be enabled by the rollout.
The full automated suite passes, with focused tests for the new state, import,
publisher, scheduling and subtitle paths. Live Redis tests prove checkpoint
compare-and-set arbitration and stale-owner lease protection using disposable
keys. The stable production build and both WSL/Windows health checks pass.
In-app browser acceptance covers the real plugin catalog/editor, preview modes,
schema fields and 320/390px subtitle controls, including a synthetic subtitle
upload and language/filename listing. Credential-bound integration cases require
separate test keys and are not treated as live provider acceptance.
Keep the existing four bots and their configurations compatible; new behavior
is opt-in except the documented reliability and privacy fixes.

### Remaining live rollout gates

- [ ] Run each account-authenticated collector against an operator-owned test
  folder/bucket/repository, including token rotation, revocation and quota replies.
- [ ] Verify real Discord/Telegram publication/retry in dedicated test destinations.
- [ ] Verify Storage Capacity and Backup Verification against approved operator
  connections and the deployment's backup manifest, then exercise its full restore
  procedure separately. No production restore is performed by the bot.

Browser acceptance in this round verifies report dismissal across scans,
Quarantine/Restore with persisted action history, session creation, RSVP changes,
cancel/restore, and 320/390px layouts. The TV magnet example resolves ten matched
episodes, a verified complete season and 6.00 GiB of contents. No video payload
was downloaded for that acceptance.

Final automated acceptance: 115 suites / 1,161 tests pass; lint and production
build pass. WSL and Windows health return 200. Production dependency audit
reports zero advisories. Authenticated provider tests remain the rollout gates
above; integration fixtures with no account keys do not prove live publication.
