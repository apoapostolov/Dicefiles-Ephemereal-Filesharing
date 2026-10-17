# Collection bots

**Hobbyfiles 1.5.0.** See the [power-user guide](../../docs/CORE_PLUGINS.md) for
practical examples, or the [developer cookbook](./PLUGIN_COOKBOOK.md) to extend
a provider. This page covers operator grants and recovery.

Invite collectors in **Room Options → Bots & plugins**. Choose a connection,
save settings, then use **Connection test** and **Preview** before **Import**.
**Queue job** survives a service restart; Refresh activity shows job history and
the latest report. Failed/cancelled jobs can be replayed with current settings.
Changing an invitation invalidates its old queued jobs.

Nothing is invited or enabled by installation. Interval `0` means manual only.
New collection forms default to 30 minutes (60 for S3). Each scan has item,
file-byte and total-byte limits, up to ten pages, and cancellation. Preview/test
never import, advance checkpoints or publish messages. Source deletion never
deletes a room copy.

## Operator connections

Set `HOBBYFILES_PLUGIN_CONNECTIONS` to a JSON array, or `pluginConnections` in the
private `.config.json`. The array replaces earlier values. Restart after changes.

```json
{
  "id": "community-drive",
  "provider": "drive",
  "label": "Community library",
  "pluginIds": ["drive-collection"],
  "roomIds": ["replace-with-room-id"],
  "credentials": {
    "clientIdEnv": "DRIVE_CLIENT_ID",
    "clientSecretEnv": "DRIVE_CLIENT_SECRET",
    "refreshTokenEnv": "DRIVE_REFRESH_TOKEN"
  },
  "settings": { "folderIds": ["replace-with-folder-id"] }
}
```

Every connection requires explicit bot and room IDs. `roomIds: ["*"]` grants
all rooms; use it intentionally. Fields ending in `Env` resolve the named
environment variable at run time. Room API/MCP reads return only ID, provider,
label and whether credentials exist. **Connection test** verifies source access.
Direct string credentials are supported in operator configuration; environment
references are preferred. No OAuth consent callback is provided: operators
provision approved credentials and folder grants.

Rotated OAuth access/refresh tokens are cached in Redis for 30 days, encrypted
using material derived from the original operator credentials. Changing those
credentials invalidates the cache. Back up operator secrets separately from
Redis. Revocation prevents future runs. Cancellation cannot undo a completed
provider request.

## Providers

| Bot | Connection provider / settings | Credentials | Scope and behavior |
| --- | --- | --- | --- |
| `feed-collector` | None; exact `allowedOrigins` for feed, links and enclosures | None | RSS/Atom; ETag/Last-Modified; stable IDs; links first; optional attachments |
| `s3-collection` | `s3`: `bucket`, `region`, `prefixes`; optional operator-owned `endpoint` | `accessKeyId`, `secretAccessKey`, optional `sessionToken` | ListObjectsV2 pages; ETag/modified/size revisions; If-Match reads; AWS SDK checksum handling |
| `nextcloud-collection` | `nextcloud`: approved WebDAV `baseUrl` | `username`, read-only app `password` | Depth-1 direct files; ETag changes and conditional reads |
| `drive-collection` | `drive`: `folderIds` | `accessToken`, or OAuth `clientId`, `clientSecret`, `refreshToken`; or shared service-account `clientEmail`, `privateKey` | Direct folder snapshot, then change tokens; binary files only; native Google documents excluded |
| `dropbox-collection` | `dropbox`: approved `paths` | Access token or OAuth refresh credentials | Recursive listing; revisions, continued cursors and reset reconciliation |
| `onedrive-collection` | `onedrive`: `driveId`, `folderIds`, optional `tenant` (default `consumers`) | Access token or OAuth refresh credentials | Selected-folder Graph delta, removals and expired-token resnapshot |
| `huggingface-collection` | Public: none. Private `huggingface`: approved `repositories` | Optional `accessToken` | Exact selected paths at a full 40-character commit; size preview and license provenance |

Use prefix-scoped `s3:ListBucket` and `s3:GetObject`, without write/delete
permissions. Use dedicated read-only accounts and minimal approved scopes.
Google `drive.file` covers explicitly opened/shared files; broader `drive.readonly`
may need provider approval. Dropbox needs metadata/content read. Graph needs
approved file read and offline access for refresh. Gated Hub access and license
terms still apply. An empty Dropbox root must be explicitly granted as `""`.

Feed, WebDAV and cloud HTTP requests use DNS pinning, private-network denial,
body limits and bounded redirects. S3 uses the official SDK and operator IAM
grant; never let an untrusted room choose its endpoint. Cross-origin redirects
drop authorization. Feed XML rejects DTD/entities and caps depth and size.

## Revisions and recovery

Files carry hashed source/revision provenance. The sync log remembers successful
revisions; existing room provenance closes the upload/checkpoint interruption
window. New revisions create separate files, preserving older copies. Changing
limits/filters keeps source identity; changing the source/grant creates another
checkpoint. Tokens and source secrets stay out of job payloads and public metadata.

Cursors commit after an entire page succeeds. A limit leaves the page for the
next scan, skipping completed imports. Feeds/WebDAV responses above 500 entries
require a narrower source. Feed entry IDs create one link; title changes do not
duplicate it. Drive removal notices cover recently tracked IDs, never deletion.
Fixtures validate contracts; authenticated live acceptance needs operator accounts.

## Provider references

- [Atom](https://www.rfc-editor.org/rfc/rfc4287)
- [AWS SDK S3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)
- [Nextcloud WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/index.html)
- [Drive changes](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
- [Dropbox HTTP API](https://www.dropbox.com/developers/documentation/http/documentation)
- [Graph delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0)
- [Hub API](https://huggingface.co/docs/hub/api)


**Resetting imports:** pause/cancel active work, then choose Forget imports in
bot activity. This clears the source's revision log and provider cursor. Existing
room provenance still prevents duplicate copies; expired imports may return.
Inspection works without a valid token when the operator connection grant still
exists. Repair a missing/revoked connection before inspecting its source memory.
