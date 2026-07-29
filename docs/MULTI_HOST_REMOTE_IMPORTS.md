# Multi-host remote imports

**Status:** Proposal for Dicefiles 1.4.6
**Audience:** Maintainers, plugin authors, and self-hosting operators
**Existing foundation:** Mega.nz, Pixeldrain, the shared downloader registry,
the Remote Host Import room bot, streamed ingestion, run leases, and durable
deduplication are already shipped.

## 1. Outcome

Dicefiles 1.4.6 should turn the current remote-import foundation into a
predictable provider platform:

1. Ship a first-party **Gofile** adapter using Gofile's official REST API.
2. Harden the downloader contract so providers expose capabilities, stable
   identities, pagination, structured errors, and bounded streams consistently.
3. Add a separately disabled **Plowshare bridge** for MediaFire, 4shared, and
   other long-tail file hosts that do not have a suitable maintained Node.js
   API.
4. Give room owners and operators useful provider availability, validation,
   run progress, skip reasons, and retry information without exposing secrets.

This remains an import feature: remote bytes are copied into Dicefiles storage
and receive the destination room's TTL. It is not Dicefiles federation, a
general-purpose download manager, or a way to bypass a provider's access
controls.

## 2. Release scope

### Required for 1.4.6

- Gofile public and authenticated folder imports.
- Password-protected Gofile folder support when the operator supplies the
  password through protected plugin configuration.
- Recursive traversal with depth, page, file-count, per-file byte, and per-run
  byte limits.
- A versioned provider contract shared by Mega.nz, Pixeldrain, and Gofile.
- Stable provider entry identities and content-hash deduplication.
- Per-provider concurrency, timeouts, retry-after handling, and circuit
  breaking.
- Provider health/capability reporting in Room Options and operator APIs.
- A disabled-by-default Plowshare adapter for explicitly allowlisted modules.
- MediaFire and 4shared coverage through the Plowshare adapter where installed.
- Upgrade compatibility for every existing `remote-import` room configuration.

### Useful follow-ups, not release blockers

- Catbox/Litterbox and direct public-file adapters.
- Optional premium debrid adapter.
- Native MediaFire support if a maintained official/library path becomes
  dependable.
- Bandwidth schedules and operator-wide import quotas.
- Cross-room coordination that downloads one remote object once and safely
  fans it into multiple rooms.

## 3. Product behavior

Room Options → **Plugins** continues to expose one **Remote Host Import** bot.
The owner supplies one or more remote links, selects the providers allowed in
that room, and chooses whether imports run manually or on a schedule.

The settings panel should show:

- installed providers and whether each is ready;
- the link types each provider accepts;
- whether credentials are optional, required, or unavailable;
- the last successful provider check;
- the most recent run, its duration, imported bytes, and skip/error counts;
- a validation result for every configured source without downloading it;
- plain-language recovery guidance such as “Gofile token missing,” “Plowshare
  module not installed,” or “Provider asked Dicefiles to retry later.”

Provider secrets remain write-only. A saved token or password is represented
as **Configured**, never returned to the browser.

## 4. Architecture

```text
Room configuration
       |
       v
Remote Import orchestrator
       |
       +--> Provider registry --> Mega.nz adapter
       |                     --> Pixeldrain adapter
       |                     --> Gofile adapter
       |                     --> Plowshare adapter (optional)
       |
       +--> traversal + limits + retry policy
       |
       +--> bounded temporary stream + hash
       |
       +--> existing Dicefiles upload/storage placement
       |
       +--> sync log + run summary + events
```

Provider adapters only understand remote services. They do not create
Dicefiles uploads, decide room TTL, write plugin state, or emit chat messages.
The orchestrator owns those product decisions once for every provider.

## 5. Provider contract v1

The existing contract should grow additively. Existing adapters can be wrapped
until they adopt the full contract.

```ts
type ProviderCapability =
  | "single-file"
  | "folder"
  | "recursive"
  | "password"
  | "account-token"
  | "declared-size"
  | "content-hash"
  | "pagination";

type RemoteSource = {
  providerId: string;
  canonicalUrl: string;
  sourceKind: "file" | "folder";
  sourceId: string;
};

type RemoteEntry = {
  providerId: string;
  sourceId: string;
  parentSourceId?: string;
  name: string;
  relativePath?: string;
  kind: "file" | "folder";
  size?: number;
  contentHash?: {
    algorithm: "sha256" | "sha1" | "md5" | "provider";
    value: string;
  };
  modifiedAt?: string;
  download?: {
    openStream(signal: AbortSignal): Promise<NodeJS.ReadableStream>;
  };
};

type RemotePage = {
  entries: RemoteEntry[];
  nextCursor?: string;
};

type RemoteDownloaderV1 = {
  contractVersion: 1;
  id: string;
  name: string;
  capabilities: ProviderCapability[];

  parseSource(url: URL): RemoteSource | null;
  validateCredentials(credentials: unknown): Promise<ProviderCredentialState>;
  list(
    source: RemoteSource,
    request: {
      credentials: ProviderCredentials;
      cursor?: string;
      pageSize: number;
      signal: AbortSignal;
    }
  ): Promise<RemotePage>;
  probe?(request: ProviderProbeRequest): Promise<ProviderProbeResult>;
};
```

Contract rules:

- `parseSource` must only recognize exact provider hostnames and documented
  path shapes.
- `canonicalUrl` must remove trackers and fragments but retain identifiers
  required for access.
- `sourceId` must be stable across scans and must not contain a credential.
- `list` returns one bounded page; the orchestrator owns recursion and limits.
- Files expose a lazy stream. Adapters must not buffer whole files in memory.
- Adapter responses are untrusted and are schema-validated at the boundary.
- `relativePath` is informational; the existing filename sanitizer remains
  authoritative before upload.
- Providers never follow an arbitrary URL supplied by their API without
  passing the shared outbound-network policy.

## 6. Structured error model

Providers should throw one common error type:

```ts
type RemoteProviderErrorCode =
  | "INVALID_SOURCE"
  | "AUTH_REQUIRED"
  | "AUTH_REJECTED"
  | "PASSWORD_REQUIRED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TEMPORARILY_UNAVAILABLE"
  | "UNSUPPORTED_CONTENT"
  | "RESPONSE_INVALID"
  | "DOWNLOAD_TOO_LARGE"
  | "DOWNLOAD_TRUNCATED"
  | "TIMEOUT"
  | "TOOL_UNAVAILABLE"
  | "TOOL_FAILED";

type RemoteProviderError = {
  code: RemoteProviderErrorCode;
  providerId: string;
  retryable: boolean;
  retryAfterMs?: number;
  safeMessage: string;
  cause?: unknown; // logs only; never serialized to clients
};
```

The bot and APIs return stable codes and safe messages. Provider response
bodies, shell output, tokens, passwords, signed download URLs, and internal
paths never enter client-visible errors.

## 7. Gofile adapter

### 7.1 Supported sources

- `https://gofile.io/d/{shareCode}` public folder links.
- Account-owned folder/content identifiers represented through an explicitly
  documented URL form rather than accepting raw API URLs.
- Public, private, and password-protected folders when valid protected
  credentials are configured.

The adapter must not infer or scrape arbitrary Gofile pages. Resolving a share
code to the current content identifier is isolated behind a small function and
fixture-tested because Gofile marks its API as beta.

### 7.2 Authentication

Gofile currently documents bearer-token authentication and does not publish
fixed rate-limit values. The plugin schema adds write-only fields:

```json
{
  "gofileApiToken": "write-only",
  "gofileFolderPassword": "write-only"
}
```

Environment fallbacks remain supported:

```text
GOFILE_API_TOKEN
GOFILE_FOLDER_PASSWORD
```

The folder password is SHA-256 transformed only when the current Gofile API
requires that representation. Dicefiles stores the original value only in the
same protected plugin configuration used for other credentials and never puts
it in a URL, log, sync key, or uploaded metadata.

### 7.3 Listing and traversal

- Use `GET https://api.gofile.io/contents/{contentId}`.
- Send `Authorization: Bearer …`.
- Request deterministic pages sorted by creation time and stable provider id.
- Validate every response page before traversing it.
- Let the orchestrator recurse breadth-first.
- Default maximum depth: `8`.
- Default provider page size: `100`.
- Stop listing as soon as any global run limit makes further traversal
  unnecessary.

Each file maps to a stable identity:

```text
gofile:file:{contentId}:{providerHashOrRevision}
```

If no provider hash/revision exists, the fallback identity includes content id,
size, and modification time. Dicefiles still computes its own content hash
before final upload.

### 7.4 Downloads

- Download URLs are accepted only from Gofile response fields documented for
  file content.
- HTTPS is mandatory.
- Redirects are bounded and revalidated at every hop.
- Authentication headers are sent only to approved Gofile hosts and are
  stripped before any cross-origin redirect.
- Declared size is checked before opening the stream.
- Actual bytes remain bounded by the existing plugin upload limit.
- A truncated stream is an error and is never marked imported.

### 7.5 API drift

Because Gofile labels its API beta:

- keep request and response mapping in one adapter module;
- store sanitized fixtures for successful, empty, paginated, protected, rate
  limited, and malformed responses;
- expose `apiRevision` in provider diagnostics;
- fail closed with `RESPONSE_INVALID` when the response shape changes;
- do not silently fall back to HTML scraping.

## 8. Long-tail provider bridge

### 8.1 Boundary

The bridge is one adapter, `plowshare`, within the shared registry. It delegates
provider resolution to an operator-installed Plowshare and its separately
installed modules.

It is:

- disabled by default;
- operator-enabled globally;
- independently allowlisted per room;
- limited to configured host modules such as `mediafire` and `4shared`;
- unavailable when the exact binary or required module cannot be verified.

It is not a general shell plugin.

### 8.2 Configuration

```json
{
  "remoteImport": {
    "plowshare": {
      "enabled": false,
      "binary": "/usr/bin/plowdown",
      "probeBinary": "/usr/bin/plowprobe",
      "listBinary": "/usr/bin/plowlist",
      "allowedModules": ["mediafire", "4shared"],
      "timeoutSeconds": 900,
      "maxStdoutBytes": 1048576,
      "maxStderrBytes": 262144,
      "workingDirectory": "/var/tmp/dicefiles-remote-import"
    }
  }
}
```

`binary`, `probeBinary`, and `listBinary` are operator configuration, resolved
at startup, and never editable in Room Options. Room configuration chooses only
from the server-published module allowlist.

### 8.3 Process execution

- Use `spawn(binary, argv, { shell: false })`.
- Never accept a command template, shell fragment, environment assignment, or
  free-form argument list from a room owner.
- Pass the remote URL as one argv value after strict provider parsing.
- Start with a minimal environment and a plugin-specific temporary directory.
- Do not inherit interactive stdin.
- Disable Plowshare configuration discovery unless the operator explicitly
  provides a dedicated protected config path.
- Cap stdout/stderr, wall time, output bytes, retries, and child processes.
- Kill the complete process group on abort or timeout.
- Use a unique `0700` work directory and `0600` files.
- Delete partial files after failure; successful files enter Dicefiles through
  the same bounded, hashing upload path as native providers.
- On Linux, optionally run through the existing Dicefiles sandbox strategy
  when available.

CAPTCHA solvers, interactive prompts, browser automation, and remote hooks are
unsupported. A provider requiring them returns `UNSUPPORTED_CONTENT`.

### 8.4 Discovery and output

The bridge should prefer machine-readable `plowprobe` output for filename and
size. Folder support uses `plowlist` to produce a bounded list of links, after
which each link is reparsed and checked against the configured module
allowlist.

The bridge must not parse verbose human logs as trusted metadata. If a tool
version cannot provide the fields safely, that module is reported unavailable.

### 8.5 Licensing and packaging

Plowshare is GPL-3.0 and is not vendored or linked into Dicefiles. Operators
install it and its host modules separately. `yarn setup:ubuntu` may detect and
explain the optional integration, but it must not silently install or enable
third-party host modules.

## 9. Network and SSRF protections

Every remote provider uses a shared outbound request layer:

- exact source-host allowlists;
- HTTPS by default, with no downgrade redirects;
- DNS resolution checked against loopback, link-local, private, multicast, and
  reserved address ranges;
- every redirect re-resolved and revalidated;
- maximum redirect count;
- connection, headers, idle-stream, and total-run timeouts;
- response-header and metadata-body size caps;
- provider credentials scoped to approved origins only;
- proxy behavior disabled unless configured by the operator;
- no `file:`, `ftp:`, `data:`, `javascript:`, UNC, or local-path sources.

Signed download URLs may use provider-operated delivery hosts. Each native
adapter publishes a narrow download-host matcher distinct from its source-host
matcher. The matcher must never be `*` or arbitrary suffix matching.

## 10. Scheduling and fairness

Remote imports continue to use a cross-worker run lease. Version 1.4.6 adds:

- one active run per room/plugin configuration;
- configurable global and per-provider concurrency;
- default provider concurrency of `2`;
- exponential backoff with jitter for retryable provider failures;
- exact `Retry-After` preference for HTTP 429/503 when safe;
- a short provider circuit breaker after repeated upstream failures;
- no retries for authentication, invalid-source, unsupported, or size errors;
- cancellation propagation through listing, downloads, and child processes;
- fair round-robin traversal across configured sources so one large folder
  cannot starve every other source.

Run limits are evaluated before scheduling another download. Storage placement
reservations remain authoritative for local capacity.

## 11. Deduplication and provenance

The existing sync log remains compatible. New entries use:

```text
remote-import:v1:{providerId}:{sourceId}
```

The import sequence is:

1. Check stable provider identity in the sync log.
2. Check declared size and run limits.
3. Stream into the bounded temporary ingest path while hashing.
4. Check destination-room content hash.
5. Create the Dicefiles upload.
6. Mark the provider identity imported only after successful creation, or
   after a confirmed existing-room hash match.

Safe file metadata may record:

- provider id;
- stable source id;
- import plugin id;
- bot identity.

It must not record the original signed URL, account token, folder password,
shell command, local temporary path, or full provider response.

## 12. Configuration and compatibility

Existing configuration remains valid:

```json
{
  "urls": ["https://mega.nz/…", "https://pixeldrain.com/…"],
  "providers": ["mega", "pixeldrain"]
}
```

Version 1.4.6 only adds provider ids and optional settings:

```json
{
  "urls": [
    "https://mega.nz/…",
    "https://pixeldrain.com/…",
    "https://gofile.io/d/…",
    "https://www.mediafire.com/…"
  ],
  "providers": ["mega", "pixeldrain", "gofile", "plowshare"],
  "gofileApiToken": "write-only",
  "gofileFolderPassword": "write-only",
  "plowshareModules": ["mediafire"],
  "maxTraversalDepth": 8,
  "providerConcurrency": 2
}
```

Migration rules:

- no provider field means every installed provider except disabled bridges;
- existing Mega.nz/Pixeldrain behavior and sync-log scopes do not change;
- unavailable providers do not prevent the plugin catalog from loading;
- a configuration referencing an unavailable provider is saved but disabled
  with an actionable status;
- secret fields preserve their existing value when omitted during an update;
- deleting a credential requires an explicit clear action.

## 13. Operator and automation surfaces

Provider status is additive to the existing plugin APIs:

```json
{
  "id": "gofile",
  "name": "Gofile",
  "contractVersion": 1,
  "available": true,
  "enabled": true,
  "capabilities": ["folder", "recursive", "password", "account-token"],
  "credentialState": "configured",
  "lastProbeAt": "2026-07-29T12:00:00.000Z",
  "lastProbeStatus": "healthy"
}
```

Suggested endpoints:

```text
GET  /api/v1/plugins/remote-import/providers
POST /api/v1/plugins/remote-import/sources/validate
```

Both require existing plugin-read permissions; validation is read-like,
rate-limited, never downloads file bodies, and returns one bounded result per
submitted source. No secret-read endpoint is added.

Matching MCP tools should wrap these endpoints rather than creating a second
provider protocol.

## 14. Observability

Run summaries add bounded provider-level metrics:

- sources checked;
- pages listed;
- files discovered;
- files imported;
- bytes imported;
- files skipped by stable reason;
- provider retries and rate-limit events;
- provider time spent;
- circuit-breaker state;
- partial versus complete run.

Public `/status` remains aggregate and must not name providers, source URLs,
rooms, remote files, or accounts. Operator health may show provider ids and
availability but never credentials or source links.

Logs use structured fields and redact:

- URL query strings and fragments;
- authorization/cookie headers;
- Gofile tokens and folder passwords;
- signed download URLs;
- Plowshare argv values containing source links;
- stdout/stderr lines likely to contain credentials or final URLs.

## 15. Testing strategy

### Contract tests

Run the same suite against every provider:

- exact source recognition and near-miss rejection;
- canonicalization without credential leakage;
- stable entry identity;
- bounded pagination;
- cancellation;
- malformed metadata rejection;
- declared-size and actual-size enforcement;
- download error normalization;
- no whole-file buffering.

### Gofile tests

Use recorded, sanitized fixtures for:

- public folder;
- nested folder;
- empty folder;
- pagination;
- password-required and correct-password responses;
- invalid/expired token;
- 404, 429 with retry-after, and 5xx;
- malformed success payload;
- signed download redirect;
- truncated and oversized download.

One opt-in live test may use operator-provided test credentials. It is excluded
from the default suite and must not upload or delete remote content.

### Plowshare tests

Use fake executables in a temporary directory to verify:

- exact argv without a shell;
- allowlisted and denied modules;
- executable/module discovery;
- stdout/stderr limits;
- timeout, cancellation, and process-group termination;
- partial-file cleanup;
- malicious URLs treated as one argument;
- prompt/CAPTCHA rejection;
- safe error redaction.

### Integration tests

- mixed Mega.nz/Pixeldrain/Gofile run;
- one provider failing while others continue;
- dedupe across repeated and concurrent runs;
- per-provider fairness and global byte/file limits;
- multi-volume storage reservation failure;
- room deletion/disable while a run is active;
- operator/API/MCP status parity;
- upgrade from a 1.4.5 configuration and sync log.

## 16. Implementation phases

### Phase 0 — contract hardening

- Introduce contract v1 types, validation, common errors, cancellation, and
  provider diagnostics.
- Adapt Mega.nz and Pixeldrain without observable behavior changes.
- Add the shared safe outbound request layer.

### Phase 1 — Gofile

- Add source parsing, credentials, pagination, recursive listing, and streamed
  downloads.
- Add fixtures, contract tests, Room Options fields, and provider status.
- Ship Gofile enabled only when its required credential state is satisfied.

### Phase 2 — orchestration

- Add fair multi-source scheduling, retry-after, circuit breaking, and
  provider-level run summaries.
- Add source validation API/MCP surfaces.

### Phase 3 — long-tail bridge

- Add disabled-by-default Plowshare configuration and startup discovery.
- Ship MediaFire and 4shared module allowlisting.
- Add sandboxing, process limits, cleanup, redaction, and fake-binary tests.

### Phase 4 — release acceptance

- Complete dependency/security review.
- Test real Mega.nz, Pixeldrain, Gofile, MediaFire, and 4shared examples owned
  by the test operator.
- Verify files enter normal preview, TTL, dedupe, multi-volume placement, and
  download flows.
- Update setup, plugin, API, MCP, changelog, and troubleshooting docs.

## 17. 1.4.6 acceptance checklist

- [ ] Mega.nz and Pixeldrain retain existing behavior.
- [ ] Gofile public, authenticated, nested, and password-protected folders pass.
- [ ] Gofile API drift fails closed without HTML scraping.
- [ ] Remote metadata and file bodies are bounded and streamed.
- [ ] Stable identities and room-content hashes prevent duplicates.
- [ ] A failing/rate-limited provider does not abort healthy providers.
- [ ] Plowshare cannot execute a shell or unapproved module.
- [ ] MediaFire and 4shared work through an operator-installed bridge.
- [ ] Secrets, signed URLs, source links, and local paths are absent from
  client responses and ordinary logs.
- [ ] Provider status and source validation agree across UI, REST, and MCP.
- [ ] Existing 1.4.5 configurations require no migration.
- [ ] Unit, integration, opt-in provider smoke, production build, stable-service
  restart, and user-facing browser verification pass.

## 18. Explicit non-goals

- Captcha solving or captcha-service integration.
- Browser automation to imitate provider websites.
- Rate-limit, paywall, or download-limit bypasses.
- Arbitrary URLs, arbitrary binaries, or user-authored command templates.
- Bundling Plowshare modules or a full download-manager application.
- Remote archive extraction before Dicefiles ingestion.
- Importing content without applying normal room TTL, storage, moderation, and
  access rules.

## 19. References

- Existing implementation/design:
  [Remote host imports](../core/plugins/REMOTE_HOST_IMPORTS.md)
- Existing library evaluation:
  [Remote host library research](./REMOTE_HOST_LIBRARY_RESEARCH.md)
- Gofile official API documentation: https://gofile.io/api
- Pixeldrain official API documentation: https://pixeldrain.com/api
- Plowshare: https://github.com/mcrapet/plowshare
- MEGAcmd: https://github.com/meganz/MEGAcmd
