# The Hobbyfiles core plugin guide

**Hobbyfiles 1.4.7 · All 27 bundled plugins · For room owners and power users**

Want a room that collects new releases, catches forgotten requests and gives you
a useful maintenance report? Start here. This guide covers every bot shipped
with Hobbyfiles, what to give it, and what to expect when you press Run.

The bots are included with the server. You still choose which ones to invite.
An operator may need to approve a connection before a collector can read a
private library. You can try the report-based bots without connecting another
service.

For code, see the [developer reference](../core/plugins/PLUGIN_API.md) and the
[27-plugin cookbook](../core/plugins/PLUGIN_COOKBOOK.md). Portable HTML editions
are linked from the [1.4.7 release](https://github.com/apoapostolov/Hobbyfiles/releases/tag/v1.4.7).

## Start with one useful job

Open **Room Options → Plugins** (the Bots & plugins area), invite a bot and save
its settings. A room can hold 32 invitations, subject to the shared 8,000-character
configuration limit. Large URL lists and credentials can use that space quickly.

For collectors, use **Connection test**, then **Preview**, then **Import**. For
community and maintenance bots, start with **Preview** and read the activity
report. **Queue job** gives you work that can survive a service restart; **Run
now** starts immediately. Refresh activity to see results, retries and review
buttons.

Keep **Post summaries to chat** off while trying things. Reports are available
without chat messages. When you want notices, set the timezone and quiet hours
first. The common workflow defaults are UTC and 22:00–08:00. Set the scan interval
to `0` for manual scans; an event-driven bot can still react to its subscribed
events.

Preview can contact a provider and save a report. It does not import files,
advance import checkpoints, post notices or apply suggested changes. Pressing a
report's action button is a separate write, even if Preview produced the report.
Check the suggested file before confirming it.

### Pick a starting set

| Your room | A useful first set |
| --- | --- |
| Books, papers or shared research | Feed Collector, Request Triage, Collection Curator, Expiry Concierge |
| A library mirrored from cloud storage | One matching collector, Duplicate Review, File Integrity |
| A Discord or Telegram community | One publisher, Welcome Guide, Community Digest |
| A film or episode collection | Metadata Steward, Session Organizer, Preview Repair |
| A room you operate yourself | Storage Capacity, Backup Verification, Access Review, Link Health |

Most workflow reports examine the newest 100 files by default, with a maximum
of 500. Reports display at most 40 rows. File Integrity rotates through older
files with its own checkpoint. A clean report describes the checked window;
it does not certify the whole server.

## Collect files and links

Collectors copy material into the room, where normal Hobbyfiles expiry applies.
Deleting something at the source does not remove the room copy. The seven newer
collectors track source revisions: a changed source file can create a new room
copy while the older copy remains available.

Their shared defaults are 25 items, 256 MiB per file and 1 GiB per scan. They
scan every 30 minutes after being enabled, except S3, which defaults to 60.
Mega.nz Autoshare and Remote Host Import default to manual operation, with
50 files per run and the same byte defaults. Check these settings before Save.

Use extension filters for a focused collection, such as `pdf` and `epub`.
Filename exclusions are literal, case-insensitive terms. A filter change keeps
the source checkpoint. Switching the actual source or approved grant creates a
different source identity.

<a id="mega-folder"></a>
### 1. Mega.nz Autoshare

**Plugin ID: `mega-folder`**

Give this bot a Mega folder and let it bring new files into your room. It is
handy for a release folder that you want to check occasionally without clicking
through every download yourself.

Set `folderUrl`; add account `email` and `password` only if your source needs
them. An operator can supply `MEGA_PASSWORD` instead. `namePrefix` helps distinguish
imports, and `botName` controls their uploader label. Preview first, then run the
import. `pollIntervalMinutes: 0` is the default.

The server needs the optional Mega SDK. If the bot reports that it is unavailable,
ask the operator to install the supported dependency. Treat a Mega folder URL as
a secret: its fragment can contain the decryption key. For setup and source
memory details, see [Mega.nz Autoshare](../core/plugins/MEGA_FOLDER.md).

<a id="remote-import"></a>
### 2. Remote Host Import

**Plugin ID: `remote-import`**

Use this when people give you a handful of supported host links and you want the
files collected in one place. Put the links in `urls`, optionally restrict
`providers`, and preview the result before importing.

The adapters cover Mega, Pixeldrain and Gofile. Gofile access needs the provider's
supported API credentials. MediaFire and 4shared use the optional Plowshare
bridge, which the operator must explicitly enable and install. A host appearing
in a provider list does not guarantee that its adapter is ready on this server.

Keep scans small when collecting from several hosts. Provider limits and retries
still apply; this bot cannot bypass private files, paid access or provider
restrictions. See [remote host imports](../core/plugins/REMOTE_HOST_IMPORTS.md)
for credentials, provider availability and bridge setup.

<a id="feed-collector"></a>
### 3. Feed Collector

**Plugin ID: `feed-collector`**

Turn an RSS or Atom feed into a room's release shelf. By default it saves links.
Enable `importEnclosures` when you also want feed attachments copied into the
room.

Set `feedUrl` and list the exact origins in `allowedOrigins`. Include the feed
origin and any separate origins used by its item links or attachments, for
example `https://example.org`. An origin is the scheme and host, with a port if
needed. A path or wildcard is not a substitute.

The collector remembers feed IDs and uses HTTP cache validators. A title edit
does not create another copy of the same link. Feeds with more than 500 entries
need a narrower source. If an attachment is skipped, check its origin, extension
filter and byte limits before raising the scan budget.

<a id="s3-collection"></a>
### 4. S3 Collection

**Plugin ID: `s3-collection`**

Collect a release prefix from an S3 or approved S3-compatible bucket. Choose
`connectionId`, then set `prefix` inside the operator's allowed prefixes.

The operator supplies the bucket, region, optional endpoint and read credentials.
The bot lists objects and conditionally reads their content. Source revisions
use ETag, modification time and size. It does not write back to the bucket.

The default hourly scan is a sensible place to start. If a prefix is rejected,
ask for a narrower grant that contains your release folder; changing room
settings cannot expand the operator's permission. See the
[connection setup table](../core/plugins/COLLECTION_BOTS.md#providers).

<a id="nextcloud-collection"></a>
### 5. Nextcloud Collection

**Plugin ID: `nextcloud-collection`**

Bring files from an approved WebDAV folder into the room. Select `connectionId`
and a relative `folder`. This collector reads direct children only, so put the
files you want together in that folder.

The operator supplies the WebDAV root and a read-only app account. ETags identify
changes. Public-network checks reject private network destinations; a Nextcloud
instance available only on a LAN needs an operator deployment decision before
this collector can use it. Nested folders are not recursively mirrored.

<a id="drive-collection"></a>
### 6. Google Drive Collection

**Plugin ID: `drive-collection`**

Pick an approved Drive connection and `folderId` to collect ordinary binary
files from that folder. It takes an initial snapshot, then follows Drive changes.
This is useful for PDFs, archives, images and other files already stored in Drive.

The operator must grant the folder and provision OAuth credentials, an access
token or a service account with access. Hobbyfiles does not provide an OAuth
consent screen. Native Google Docs, Sheets and Slides are excluded; export them
to a regular file if you want a room copy. Source removals never delete room files.

<a id="dropbox-collection"></a>
### 7. Dropbox Collection

**Plugin ID: `dropbox-collection`**

Use Dropbox for a source tree that includes subfolders. Set `connectionId` and
an approved `folder`, such as `/Community`. The bot lists recursively and follows
Dropbox's continuation cursor and file revisions.

An empty folder means the app root only when the operator explicitly granted
that empty path. If Dropbox expires or resets a cursor, the collector reconciles
the source again and skips known revisions. Raising limits is usually more
useful than repeatedly forgetting imports on a large tree.

<a id="onedrive-collection"></a>
### 8. OneDrive Collection

**Plugin ID: `onedrive-collection`**

Collect an approved OneDrive folder with `connectionId` and `folderId`. The
connection supplies the drive ID, allowed folders and account credentials. The
collector follows Microsoft Graph delta changes and can take a new snapshot
when its delta token expires.

Folder and download-host checks still apply when Graph returns a download URL.
If a source becomes unavailable, repair the connection or its folder grant, then
retry. A missing source item is reported without removing the room copy.

<a id="huggingface-collection"></a>
### 9. Hugging Face Collection

**Plugin ID: `huggingface-collection`**

Collect a few specific dataset or model files at a reproducible version. Set
`repositoryType` to `datasets` or `models`, `repository` to `owner/name`,
`revision` to the full 40-character commit, and `files` to the exact paths.
Record the license in `license` after reading its terms.

Public sources can work without a connection. Private or gated sources need an
approved `huggingface` connection and the account's normal access. A branch name
such as `main` is not a pinned commit. Choose individual files and suitable byte
limits before collecting large model weights.

## Keep the outside community connected

The two publishers send updates to destinations you configure. Their **Test**
mode sends a real test message. **Digest** sends a real summary. Unlike collector
Preview, these modes deliberately publish outside Hobbyfiles.

Both can announce uploads, optionally include requests, and accept a restricted
set of authenticated inbound commands. Inbound commands start disabled. Configure
the destination, allowed users and command list before enabling them.

<a id="discord-release"></a>
### 10. Discord Release Publisher

**Plugin ID: `discord-release`**

Set `webhookUrl` and a public `baseUrl` so Discord members can open shared files.
Use `threadId` for a particular thread, and `ignoreBotUploads` if imported files
would make the channel too busy. `notifyRequests` is off by default.

For inbound slash commands, the operator must configure signed interaction
handling. Set the application public key, allowed users or roles, and an explicit
`inboundCommands` list. Responses are caller-only by default. Start with `help`,
`status` and `find`; add `request` or `say` only when those writes are wanted.

Queued delivery survives restarts, but an interrupted external request can have
an uncertain outcome. Check the destination before replaying a failed delivery.
Full setup is in [release publishers](../core/plugins/RELEASE_PUBLISHERS.md).

<a id="telegram-release"></a>
### 11. Telegram Release Publisher

**Plugin ID: `telegram-release`**

Set `chatId`, the bot token and public `baseUrl`. `messageThreadId` targets a
forum topic. Give the Telegram bot permission to post in the chosen destination,
then use Test to confirm that it reaches the right place.

Inbound commands require `inboundEnabled`, `inboundWebhookSecret`, an explicit
command list and allowed Telegram user IDs. `botUsername` lets the bot distinguish
commands addressed to it in a group. Ordinary conversation and other bots'
commands are ignored. Keep the token in operator environment configuration when
possible. See [release publishers](../core/plugins/RELEASE_PUBLISHERS.md).

## Help people use the room

These bots work with room files, requests and metadata. Suggested changes live
in activity reports, where you can inspect them before applying anything.

<a id="welcome-guide"></a>
### 12. Welcome Guide

**Plugin ID: `welcome-guide`**

Give newcomers the room rules, expiry information and a hint to search before
requesting a file. Add a short `welcomeText`, preview it, then enable
`postToChat` if you want it delivered when members join.

The default scan interval is zero because joining is the useful trigger. A
30-day cooldown suppresses repeat welcomes on reconnect; the default daily cap
is ten. Quiet hours can suppress a greeting. Manual Preview shows the message
without pretending that a new member joined.

<a id="request-triage"></a>
### 13. Request Triage

**Plugin ID: `request-triage`**

Find files that may already answer open requests. It compares request text with
file names and existing titles, then shows up to three suggestions per request.
Open the file and decide whether it is the right edition or item before pressing
**Fulfill with this file**.

Matching is based on text overlap. It does not know whether two similarly named
works are interchangeable. Applying a suggestion checks the current request,
the selected room file and any active human claim. A stale report needs a refresh.

<a id="request-steward"></a>
### 14. Request Steward

**Plugin ID: `request-steward`**

Review old requests and expired claims before the board becomes hard to use.
`staleDays` defaults to seven. The report distinguishes an active claim from an
expired one so you can follow up with the right context.

Human claims remain assigned. The bot can release only its own expired claim
through a review action. Optional chat reminders follow the normal quiet hours
and daily suppression.

<a id="community-digest"></a>
### 15. Community Digest

**Plugin ID: `community-digest`**

Publish a weekly room roundup of new files, fulfilled requests and collection
highlights. Set `publishDay`, `publishHour` and `timezone`; the defaults are
Sunday at 18:00 UTC, checked hourly. Turn on `postToChat` when the preview reads
well.

The watermark advances after a successful post. Hidden files are excluded. Keep
the scan window large enough for your room's weekly activity; this is a bounded
roundup, so a busy room can have more new files than the report examines.

<a id="collection-curator"></a>
### 16. Collection Curator

**Plugin ID: `collection-curator`**

Build collection tags from metadata you already have. `groupBy` defaults to
`series`; you can also choose author, genre, language or file type. Review a
proposal and press **Add to collection** to fill the missing collection tag.

Existing manual collection values are preserved. An **Undo curation** action
lets you reverse the bot's own change while its receipt remains valid. If someone
edits the file afterward, refresh rather than trying to force an old undo.

<a id="duplicate-review"></a>
### 17. Duplicate Review

**Plugin ID: `duplicate-review`**

Find identical content hashes and suspiciously similar titles. Exact copies and
title-only similarities are described separately; different editions can have
nearly identical names.

Mark a candidate **Reviewed** to dismiss that unchanged finding. File deletion
is still a separate moderation action. The bot does not choose which edition to
keep or remove files for you.

<a id="upload-review"></a>
### 18. Upload Review

**Plugin ID: `upload-review`**

Flag uploads against rules you choose: `maxFileBytes`, `blockedExtensions` and
`blockedTerms`. The size default is 1 GiB; extension and term blocklists start
empty. It also reacts to new-upload events.

Reports are the default. If you enable `allowQuarantine`, an owner can press
**Quarantine** on a flagged item and later **Restore file**. Each action checks
the file revision. A filename rule is a moderation aid, not a malware scan or a
proof that content is unsafe.

<a id="session-organizer"></a>
### 19. Session Organizer

**Plugin ID: `session-organizer`**

Plan a reading group, screening or file-review session from **Sessions** in the
room menu. Add up to 20 local preparation links. Members can RSVP, and the room
sees counts rather than an attendee list.

Owners can plan, cancel and restore sessions. Starts must be within 60 days;
duration is at most 24 hours. The planning field uses your browser's local clock,
while the selected IANA timezone controls displayed times. Reminders default to
60 minutes before the start, checked every 15 minutes, and require `postToChat`.
No external calendar is updated.

## Look after the collection

Most maintenance bots default to a daily scan. Storage Capacity checks hourly.
Use reports first, then opt into notices where they help. The two operator-backed
bots need explicit grants even when the room owner already has broad room access.

<a id="expiry-concierge"></a>
### 20. Expiry Concierge

**Plugin ID: `expiry-concierge`**

Get a chance to save useful files before they expire. `withinHours` defaults to
24. `valuableOnly` starts enabled, selecting files with a collection or series
tag; disable it to review every expiring file in the scan window.

The report links to the files and shows expiry times. Optional notices are
suppressed after the daily bulletin. Download anything you need to keep: this
bot does not extend retention.

<a id="preview-repair"></a>
### 21. Preview Repair

**Plugin ID: `preview-repair`**

Find missing previews and queue a reviewed retry through Hobbyfiles' existing
preview worker. A missing stored file gets a different explanation, because a
thumbnail retry cannot restore lost content.

If retries keep failing, ask the operator to run `yarn check:preview-tools` and
install the missing native tools. Repeatedly pressing Retry will not fix an
unavailable renderer. Existing worker concurrency and attempt limits still apply.

<a id="file-integrity"></a>
### 22. File Integrity

**Plugin ID: `file-integrity`**

Check stored bytes against the checksum recorded at upload. Each run examines
up to five files with a shared 32 MiB read budget by default, throttled to
8 MiB/s. Its saved page cursor moves through the inventory across runs.

Preview shows which files fit the budget without reading their payload. Large
files may need a higher `maxBytesPerRun`, up to 1 GiB. A mismatch is reported for
operator investigation; no file is repaired or deleted. Keep a verified backup
before deciding how to replace damaged content.

<a id="storage-capacity"></a>
### 23. Storage Capacity

**Plugin ID: `storage-capacity`**

See aggregate used and free storage for operator-approved volumes. Choose a
`maintenance` connection granting `storage:read`. The default alert threshold
is 85%; an alert clears below 75%, which avoids flapping near one threshold.

After samples are far enough apart, the report can estimate remaining days from
observed growth. Treat that estimate as planning help: a large upload can change
it quickly. The bot does not delete files or expose filesystem paths.

<a id="backup-verification"></a>
### 24. Backup Verification

**Plugin ID: `backup-verification`**

Check whether an existing backup is recent and whether a few files can be
restored into a temporary directory. Choose an operator-approved `backup`
connection with a directory and manifest. Preview inspects the manifest; Run
performs sample restores and reads them back to verify size and SHA-256.

Defaults are a 48-hour freshness limit, two samples and 32 MiB of combined source
and restored-file reads. This bot does not create backups or restore production
storage. A successful sample check is useful evidence, but you still need a full
recovery procedure. The [operator recipe](../core/plugins/WORKFLOW_BOTS.md#operator-grants)
shows the manifest format.

<a id="link-health"></a>
### 25. Link Health

**Plugin ID: `link-health`**

Check a few collected links each day without hammering their hosts. The default
is ten per scan. Checks use public HTTP destinations with bounded HEAD requests
and a small GET fallback where needed.

The report distinguishes removed links, restricted access, temporary trouble and
rate limits. A 403 does not prove a link is dead. Rate limiting delays further
checks. Unsupported schemes are left alone, and the bot never removes links.

<a id="access-review"></a>
### 26. Access Review

**Plugin ID: `access-review`**

Review old invitations, disabled bots, missing connection credentials and broad
connection grants. It is a useful occasional check after a room changes hands
or stops using a provider.

You get counts and connection labels, not raw invitation tokens or secret keys.
Use the room's invitation settings or ask the operator to narrow a connection
grant after reviewing the finding. Nothing is revoked automatically.

<a id="metadata-steward"></a>
### 27. Metadata Steward

**Plugin ID: `metadata-steward`**

Find books missing a title or author, unmatched torrent video entries and ordinary
videos that need catalogue information. Book retries re-read embedded metadata;
torrent retries reuse the existing movie/episode matching worker.

For an ordinary video, the report directs you to **Video Information** to search
and confirm the match. Existing manual fields and confirmed movie choices take
precedence. This bot helps you finish metadata work; it cannot infer details
that the source file and configured catalogues do not provide.

## When something needs attention

| What you see | What to do next |
| --- | --- |
| Connection missing or unavailable | Ask the operator to check the connection ID, provider, bot ID and room grant. Save the corrected selection and test again. |
| Credentials missing or access denied | Check the environment reference, token expiry and provider permissions. Restart after operator configuration changes. |
| Preview is empty | Check the source, filters, known revisions and the file window. Try a smaller known source before increasing limits. |
| Import stops at a budget | Let the next scan continue, or raise a limit after checking storage capacity. Completed revisions are skipped. |
| Report is truncated | It contains at most 40 rows. Resolve a focused set and refresh; the displayed rows are not a full inventory export. |
| Review returns a conflict | Refresh activity and scan again. The file, request or report changed since the proposal was made. |
| Job keeps retrying | Read the latest safe error and respect its retry time. Repair credentials or settings before replaying failed work. |
| No chat notice | Check `postToChat`, timezone, quiet hours, schedule and suppression. A successful report does not always mean a notice was due. |

Cancel active work before changing a source or forgetting imports. Cancellation
is cooperative: a completed upload or external message remains completed.
Disabling a bot stops future execution; changing settings invalidates its older
queued jobs. Private history expires according to its retention.

**Forget imports** clears remembered revisions and the source cursor. Existing
room provenance still protects current copies; expired imports may return. Use
it when deliberately reconciling a source, rather than as a routine retry button.

## Read next

- [Developer API reference](../core/plugins/PLUGIN_API.md): exact callable contracts and limits.
- [Plugin cookbook](../core/plugins/PLUGIN_COOKBOOK.md): configuration and code patterns from all 27 bots.
- [Collection setup](../core/plugins/COLLECTION_BOTS.md): operator connections and provider requirements.
- [Community and maintenance setup](../core/plugins/WORKFLOW_BOTS.md): review actions, sessions and backup manifests.
- [REST API](../API.md) and [MCP guide](../MCP.md): manage invited bots from external tools.

This guide describes the implementation shipped in Hobbyfiles 1.4.7. Provider
credentials and live destinations must be checked in your own deployment;
bundling a connector does not establish access to an external account.
