# Plugin cookbook: 27 examples from the core

**Hobbyfiles 1.4.7 · Plugin context API 2**

Use these recipes with the [developer reference](./PLUGIN_API.md). Each example
names a real bundled module and its extension pattern. Configuration objects
are invitation `config` values: the room UI and scoped API supply `roomId`.
Global configuration must include it. Placeholder URLs, IDs and commits must be
replaced before use. Secrets belong in private operator configuration.

The recipes deliberately use manual scan intervals. Read a preview before
enabling a schedule. Publisher Test and Digest modes send real external messages.

## Collectors

### 1. mega-folder: a focused Mega library

[Source](../../lib/plugins/mega-folder/index.js) · [Operator guide](./MEGA_FOLDER.md)

```json
{
  "folderUrl": "https://mega.nz/folder/replace-id#replace-decryption-key",
  "includeExtensions": ["pdf", "epub"],
  "excludeNameContains": ["sample"],
  "pollIntervalMinutes": 0, "maxFilesPerRun": 10,
  "maxBytesPerFile": 268435456, "maxBytesPerRun": 1073741824
}
```

**Pattern:** keep secret-bearing source URLs out of public provenance. Study
the Mega adapter for stream cleanup, source memory and preview behavior. Its
SDK integration differs from the newer shared collector engine.

### 2. remote-import: multiple supported hosts

[Source](../../lib/plugins/remote-import/index.js) · [Provider contract](./REMOTE_HOST_IMPORTS.md)

```json
{
  "urls": ["https://pixeldrain.com/u/replace-id"],
  "providers": ["pixeldrain"], "pollIntervalMinutes": 0,
  "includeExtensions": ["zip"], "maxFilesPerRun": 5
}
```

**Pattern:** resolve an allowlisted provider rather than fetching an arbitrary
room-supplied URL. The registry offers availability, provider circuits and paged
stream traversal. A registered provider may still require installation or credentials.

### 3. feed-collector: release links first

[Source](../../lib/plugins/feed-collector/index.js)

```json
{
  "feedUrl": "https://example.org/releases.atom",
  "allowedOrigins": ["https://example.org", "https://downloads.example.org"],
  "importEnclosures": false, "pollIntervalMinutes": 0
}
```

**Pattern:** parse bounded metadata, reject XML entities, preserve stable entry
IDs and use cache validators. `parseFeed` is exported for focused parser checks.
Its link entries use `kind: "link"`; enclosures use `open(maxBytes)`.

### 4. s3-collection: one approved prefix

[Source](../../lib/plugins/s3-collection/index.js)

```json
{
  "connectionId": "community-s3", "prefix": "releases/books/",
  "includeExtensions": ["pdf", "epub"], "pollIntervalMinutes": 0
}
```

**Pattern:** derive an object revision from provider metadata and make a
conditional read. The connection owns `bucket`, `region`, `prefixes` and any
custom endpoint. Use read-only IAM; room config cannot choose an arbitrary endpoint.

### 5. nextcloud-collection: a direct WebDAV folder

[Source](../../lib/plugins/nextcloud-collection/index.js)

```json
{
  "connectionId": "community-webdav", "folder": "Releases",
  "pollIntervalMinutes": 0, "maxFilesPerRun": 20
}
```

**Pattern:** constrain relative paths to an approved base, list depth one and
read using ETag conditions. Do not describe this adapter as recursive sync.

### 6. drive-collection: snapshot followed by changes

[Source](../../lib/plugins/drive-collection/index.js)

```json
{
  "connectionId": "community-drive", "folderId": "replace-folder-id",
  "pollIntervalMinutes": 0, "includeExtensions": ["pdf"]
}
```

**Pattern:** get a change token before the initial binary-file snapshot, then
reconcile changes. Preserve the page checkpoint only after successful imports.
Native Google document exports are outside this adapter's implementation.

### 7. dropbox-collection: recursive revision tracking

[Source](../../lib/plugins/dropbox-collection/index.js)

```json
{
  "connectionId": "community-dropbox", "folder": "/Community",
  "pollIntervalMinutes": 0, "maxFilesPerRun": 25
}
```

**Pattern:** handle continued listing and reset reconciliation while deduplicating
file revisions. An empty path needs an explicit operator grant for the app root.

### 8. onedrive-collection: selected-folder delta

[Source](../../lib/plugins/onedrive-collection/index.js)

```json
{
  "connectionId": "community-onedrive", "folderId": "replace-folder-id",
  "pollIntervalMinutes": 0
}
```

**Pattern:** validate delta and download URLs, and resnapshot an expired token.
The connection fixes `driveId` and `folderIds`. Never forward an access token
to an unapproved download host.

### 9. huggingface-collection: reproducible selected files

[Source](../../lib/plugins/huggingface-collection/index.js)

```json
{
  "repositoryType": "datasets", "repository": "example/community-data",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "files": ["README.md", "samples/example.json"],
  "license": "replace-with-reviewed-license", "pollIntervalMinutes": 0
}
```

**Pattern:** pin an immutable full commit and an explicit file list. This commit
is a format placeholder, not an existing release. Private sources also
need `connectionId` with an approved repository and token. Gated access and
license terms remain provider requirements.

### A complete new collector using the shared engine

This example imports at most one JSON manifest per scan from a fixed approved
public origin. It shows the actual `page` signature and Node streaming
contract. Replace the illustrative service and register `manifest-collector`
before deployment. The service contract is a small `/latest.json` index with
`{"revision":"release-1"}` and an immutable
`/releases/release-1/manifest.json` file. The origin is fixed in reviewed code.

```js
"use strict";
const { defineCollector } = require("../collection/engine");
const { approvedUrl } = require("../collection/network");

const origin = "https://releases.example.org";
const allowedUrl = value => approvedUrl(value, [origin]);

module.exports = defineCollector({
  id: "manifest-collector", name: "Manifest Collector", provider: "manifest",
  description: "Collect the current approved release manifest.",
  properties: {},
  async page({ checkpoint, net, signal }) {
    signal?.throwIfAborted();
    const response = await net.response(allowedUrl(`${origin}/latest.json`), {
      headers: checkpoint.etag ? { "if-none-match": checkpoint.etag } : {},
    }, { allowedUrl, maxBytes: 262144 });
    if (response.status === 304) {
      return { entries: [], checkpoint, hasMore: false };
    }
    const manifest = await response.json();
    if (typeof manifest.revision !== "string" || !manifest.revision ||
        manifest.revision.length > 200) {
      throw Object.assign(new Error("The manifest needs a short revision. Check the release source."), {
        retryable: false,
      });
    }
    const downloadUrl = allowedUrl(
      `${origin}/releases/${encodeURIComponent(manifest.revision)}/manifest.json`,
    );
    return {
      entries: [{
        id: "current-manifest", name: "manifest.json", revision: manifest.revision,
        open: maxBytes => net.stream(downloadUrl, {}, {
          allowedUrl, maxBytes,
        }),
      }],
      checkpoint: { etag: response.headers.get("etag") || "" }, hasMore: false,
    };
  },
});
```

The revision-specific download URL keeps discovery and download consistent.
If a different provider uses mutable URLs, enforce If-Match or its equivalent.
Unknown sizes are enforced while streaming. Preview/test read the small release
index without calling `open` or downloading the selected file.

## Publishers

### 10. discord-release: authenticated publication and commands

[Source](../../lib/plugins/discord-release/index.js) · [Setup](./RELEASE_PUBLISHERS.md)

```json
{
  "baseUrl": "https://files.example.org", "ignoreBotUploads": true,
  "notifyRequests": true, "inboundEnabled": false,
  "discordEphemeralResponses": true
}
```

The operator can provide `HOBBYFILES_DISCORD_WEBHOOK_URL`. Inbound mode requires
an application public key, allowed users/roles and explicit commands.
**Pattern:** verify the raw signed request, deduplicate delivery, queue work by
event/key and reconstruct current room data. Never treat a public inbound URL
as authorization by itself.

### 11. telegram-release: a topic-specific destination

[Source](../../lib/plugins/telegram-release/index.js) · [Setup](./RELEASE_PUBLISHERS.md)

```json
{
  "chatId": "replace-chat-id", "messageThreadId": 42,
  "baseUrl": "https://files.example.org", "ignoreBotUploads": true,
  "notifyRequests": false, "inboundEnabled": false
}
```

The operator can provide `HOBBYFILES_TELEGRAM_BOT_TOKEN`.
**Pattern:** check webhook secret, destination and user allowlists before command
dispatch; ignore unrelated conversation. Preserve provider Retry-After and send
safe reply parameters instead of assembling deprecated fields.

## Community workflows

These modules use `defineWorkflow`. All recipes keep `postToChat: false`.
Their scans return reports; declared action handlers perform reviewed mutations.

### 12. welcome-guide: event-driven onboarding

[Source](../../lib/plugins/welcome-guide/index.js)

```json
{
  "welcomeText": "Search before requesting. Add a clear title and edition to requests.",
  "cooldownDays": 30, "maxWelcomesPerDay": 10,
  "pollIntervalMinutes": 0, "postToChat": false, "timezone": "Europe/Sofia"
}
```

**Pattern:** subscribe to `member_joined`, queue only its opaque identity and
use daily private-state buckets to suppress reconnects. Enable chat delivery
only after the owner reviews the composed welcome text.

### 13. request-triage: a proposal with a current revision

[Source](../../lib/plugins/request-triage/index.js)

```json
{ "maxItems": 200, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** put request key, file key and request revision in private row data.
Only the review handler calls `fulfillRequest`. Similarity scores help ranking;
they are not evidence that a file satisfies the request.

```js
async function applyRequestSuggestion(ctx, data) {
  await ctx.hobbyfiles.fulfillRequest({
    key: data.key, fileKey: data.fileKey, expectedRevision: data.expectedRevision,
  });
  return { detail: "Request fulfilled with the reviewed file." };
}
```

### 14. request-steward: respect claim ownership

[Source](../../lib/plugins/request-steward/index.js)

```json
{ "staleDays": 14, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** distinguish age from ownership. `releaseRequest` can release only
this plugin's claim, even when another claim is stale. Do not make a review
button promise a mutation its adapter will reject.

### 15. community-digest: publish then advance the watermark

[Source](../../lib/plugins/community-digest/index.js)

```json
{
  "publishDay": "Sun", "publishHour": 18, "timezone": "Europe/Sofia",
  "quietStart": 22, "quietEnd": 8, "maxItems": 250,
  "pollIntervalMinutes": 0, "postToChat": false
}
```

**Pattern:** exclude hidden files, use a bounded file window, publish only in the
configured window and advance the watermark after acceptance. To activate this
recipe, choose an hourly scan and enable chat summaries. A failed post must not
mark the week's content as already delivered.

### 16. collection-curator: apply and undo without overwriting

[Source](../../lib/plugins/collection-curator/index.js)

```json
{ "groupBy": "author", "maxItems": 200, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** fill an absent collection from existing metadata. Keep the returned
revision in private report data and offer Undo. The reference contains a
[complete custom curation module](./PLUGIN_API.md#8-reports-and-review-actions).

### 17. duplicate-review: dismiss unchanged findings

[Source](../../lib/plugins/duplicate-review/index.js)

```json
{ "maxItems": 300, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** fingerprint the candidate group rather than suppressing a filename
forever. `reviewKey`, `dismissedReviews` and `dismissReview` in `workflows.js`
support bounded dismissal memory. The current helper keeps up to 150 keys for
30 days. Changed candidates can return for review.

### 18. upload-review: a separately granted reversible action

[Source](../../lib/plugins/upload-review/index.js)

```json
{
  "maxFileBytes": 1073741824, "blockedExtensions": ["exe", "scr"],
  "blockedTerms": [], "allowQuarantine": false,
  "pollIntervalMinutes": 0, "postToChat": false
}
```

**Pattern:** flags are recommendations. Quarantine needs a saved owner opt-in
and a reviewed file revision. The host adapter restricts this operation to
`upload-review`; copying this handler into a new plugin does not grant access.
Restore retains the pre-existing hidden state rather than blindly unhiding.

### 19. session-organizer: aggregate social features

[Source](../../lib/plugins/session-organizer/index.js)

```json
{
  "reminderMinutes": 60, "pollIntervalMinutes": 0,
  "postToChat": false, "timezone": "Europe/Sofia"
}
```

**Pattern:** read aggregate sessions and counts; use per-session notice IDs.
Planning/cancellation uses owner REST/MCP actions, while RSVP stays in the room
UI. A plugin does not need an attendee list to post a useful reminder. Set a
15-minute scan and opt into chat when reminders are wanted.

## Maintenance

### 20. expiry-concierge: report a lifecycle decision

[Source](../../lib/plugins/expiry-concierge/index.js)

```json
{
  "withinHours": 48, "valuableOnly": true,
  "pollIntervalMinutes": 0, "postToChat": false
}
```

**Pattern:** identify relevant expiring files without silently changing TTL.
Use local-time daily notice IDs. Explain how users can save files while keeping
the room's retention policy intact.

### 21. preview-repair: reuse a bounded worker

[Source](../../lib/plugins/preview-repair/index.js)

```json
{ "maxItems": 100, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** inspect first, then offer `retryFilePreview` with the current file
revision. If the blob is missing, a preview retry is not a recovery action.
Delegate heavy work to the existing queue instead of spawning a renderer in a hook.

### 22. file-integrity: rotate through old files

[Source](../../lib/plugins/file-integrity/index.js)

```json
{
  "maxChecksPerRun": 5, "maxBytesPerRun": 33554432,
  "pollIntervalMinutes": 0, "postToChat": false
}
```

**Pattern:** request one page item at a time, account for actual read bytes and
save the next cursor only in Run mode. An over-budget result needs a larger
deliberate budget, not an unchecked read. See `verifyFile` in the reference.

### 23. storage-capacity: hysteresis for useful alerts

[Source](../../lib/plugins/storage-capacity/index.js)

```json
{
  "connectionId": "room-storage", "warnPercent": 85, "resumePercent": 75,
  "pollIntervalMinutes": 0, "postToChat": false
}
```

**Pattern:** retain the prior high/normal state to avoid threshold flapping.
An operator `maintenance` connection must include
`settings.capabilities: ["storage:read"]`. Growth estimates need spaced samples;
they are estimates, not a guarantee of remaining time.

### 24. backup-verification: a sample restore you can account for

[Source](../../lib/plugins/backup-verification/index.js)

```json
{
  "connectionId": "room-backup", "maxAgeHours": 48,
  "sampleFiles": 2, "maxBytesPerRun": 33554432,
  "pollIntervalMinutes": 0, "postToChat": false
}
```

**Pattern:** separate manifest preview from read/copy/readback work. Store the
sample cursor only after verification. The operator connection fixes the backup
directory and manifest; report rows never reveal server paths. Read both source
and restored bytes against the same I/O budget.

### 25. link-health: distinguish failure types

[Source](../../lib/plugins/link-health/index.js)

```json
{ "checksPerRun": 10, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** rotate through collected links and persist rate-limit backoff.
Use `probeLink` instead of generic fetching for a user-supplied destination.
Do not label a restricted response as a removed resource or delete it automatically.

### 26. access-review: useful administration without secrets

[Source](../../lib/plugins/access-review/index.js)

```json
{ "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** use `getAccessSummary` to report stale invitations, unused
connections and broad grants. Keep revocation in explicit owner/operator flows.
A credential-presence flag is not an authenticated provider health check.

### 27. metadata-steward: preserve manual decisions

[Source](../../lib/plugins/metadata-steward/index.js)

```json
{ "maxItems": 200, "pollIntervalMinutes": 0, "postToChat": false }
```

**Pattern:** propose a retry only where an existing extraction/matching worker
can help. Preserve confirmed movie choices and populated book fields. Ordinary
videos link the user to Video Information instead of promising an unsupported
automatic match.

## Use these examples as a development checklist

1. Pick the closest source module and read its adapter/helper too.
2. Define the data it can read, the exact mutation it may make, and who approves it.
3. Add a schema and authoritative server validation with bounded inputs.
4. Implement Preview before writes; keep source discovery separate from ingest.
5. Use private data/revisions for review and stable identities for deduplication.
6. Pass cancellation through every I/O path and clean up streams on errors.
7. Verify partial success, retries, stale actions and secret redaction with injected adapters.
8. Validate a real operator-owned provider destination before enabling a schedule.
9. Add operator instructions, an API example and a user-visible changelog entry.

## Reproduce the portable handbooks

The Markdown sources are canonical. From the repository root, with Python 3.10+ and
the `Markdown` package installed, run:

```sh
python3 scripts/export-plugin-docs.py
```

This writes self-contained, searchable, printable HTML editions under
`docs/handbooks/`. The developer edition combines the reference and this cookbook.
It has no external fonts, JavaScript or network assets. Reading it needs no server.
