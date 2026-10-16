# Community and maintenance bots

Dicefiles includes 27 trusted built-in bots: four existing publishers/importers,
seven [collectors](./COLLECTION_BOTS.md), eight community bots and eight maintenance
bots. Installation does not invite or enable them in rooms. Open **Room Options →
Plugins**, select a bot, configure it and Save. Rooms accept up to 32 invitations;
the shared configuration size limit still applies.

## Owner workflow

1. Leave **Post summaries to chat** off while evaluating a bot. Set its scan
   interval to 0 for manual-only work; timezone and quiet hours control notices.
2. Choose **preview**, then **Queue job**. Refresh activity to see the report,
   attempts and cancellation/replay controls. Run now is an immediate run.
3. Review individual report actions. Refresh after an item changes: old report
   IDs or file revisions cannot authorize a new mutation. Reports show up to
   40 results; narrow a scan when its report is truncated.
4. Enable a schedule only after reviewing results. Disabling a bot stops future
   work; cancellation is cooperative and cannot undo completed external requests.

Previews never import, publish, quarantine, apply tags, advance integrity cursors
or restore backup samples. They can query providers and prepare a review report.
Choosing a report action is a separate explicit write. Report-only bots need no
external credentials. Changes appear in **Recent changes** (last 20 displayed,
50 retained per bot/room, with private-state retention).

## Community bots

| Bot | Useful behavior | Review and limits |
| --- | --- | --- |
| Welcome Guide | Room rules, file/request help for a joining member | Opt-in messages; hashed member cooldown, reconnect suppression and daily limit; no member identity list |
| Request Triage | Deterministic filename matches for open requests | Confirm Fulfill on a suggestion; verifies current request, room file and human claim; never fabricates a match |
| Request Steward | Aging requests and stale claims | Human claims remain untouched; only this bot's own expired claims can be released |
| Community Digest | Recent files, fulfilled requests and collection highlights | Weekly local-time window, durable watermark and quiet hours; chat delivery is opt-in |
| Collection Curator | Group metadata into a collection tag | Apply/Undo; fills absent values, preserves manual tags and rejects conflicting undo |
| Duplicate Review | Exact content hashes and similar names | Dismiss persists for unchanged candidates; no file deletion |
| Upload Review | Explicit size, extension and filename policy rules | Report-only by default; separate owner opt-in enables reviewed Quarantine/Restore; changed revisions/rules return for review |
| Session Organizer | Room-local sessions, preparation links and reminders | Owner planning/cancellation, member RSVP, local display timezone; no external calendar writes |

### Sessions

Enable Session Organizer, then open **Sessions** in the room menu. Owners can
Plan a session; members choose Going, Maybe, Declined or no response. Public
lists show aggregate counts and the current member's own choice, not attendees.
A session accepts up to 20 local file/request/room preparation links, starts
within 60 days, and lasts at most 24 hours. Rooms retain at most 100 sessions;
each accepts 100 responses and expires seven days after its end. Cancel/Restore
uses the current revision. Display timezone is an IANA name such as Europe/Sofia;
the planning field uses the browser's local clock. Reminder notices require
Post summaries to chat and observe the configured quiet hours.

## Maintenance bots

| Bot | Behavior | Bounds and recovery |
| --- | --- | --- |
| Expiry Concierge | Curated files nearing expiry | Daily opt-in notices; does not extend TTL |
| Preview Repair | Missing blobs/previews and reviewable retry actions | Uses existing native preview worker and retry limits; install missing preview tools before retrying |
| File Integrity | Incremental stored-byte checksum checks | Default 32 MiB budget, at most five files per scan, throttled reads; preview reads no payload; mismatch reports never delete/repair files |
| Storage Capacity | Aggregate used/free capacity and measured growth | Operator grant required; 85% alert / 75% clear defaults, hysteresis and cooldown; no deletion |
| Backup Verification | Manifest freshness and isolated sampled restore | Operator grant required; two samples and 32 MiB I/O by default; reads restored copies back and checks SHA-256; no production restore |
| Link Health | Relaxed checks of collected links | Ten links per run by default; public HTTP only, capped redirects/body, Retry-After, no deletion |
| Access Review | Invite age, bot state and connection grant recommendations | Redacted administrative summary; no raw tokens, attendee identities or automatic revocation |
| Metadata Steward | Missing embedded book metadata and unmatched torrent video metadata | Reviewed retries reuse existing extraction/matching queues; manual values and confirmed matches take precedence |

Most reports scan a bounded newest-file window (default 100, maximum 500).
File Integrity persists a pagination checkpoint to reach older files. Larger
libraries require repeated scans or a narrower scope; reports are not exhaustive
proof that every file, backup or external link is healthy.

### Operator grants

Use the same private pluginConnections configuration as collectors. Storage
Capacity requires a connection with provider **maintenance**, its bot/room IDs,
and settings **capabilities: ["storage:read"]**. Only aggregate volume metrics
reach its report; filesystem paths do not.

Backup Verification requires provider **backup**, the bot/room grant and settings:

~~~json
{
  "directory": "/srv/backups/dicefiles",
  "manifest": "manifest.json"
}
~~~

The manifest is at most 1 MiB and names 1–500 regular files relative to that
approved directory. Parent traversal and paths escaping its real directory are
rejected. Generate it as part of your existing backup job:

~~~json
{
  "createdAt": "2026-10-16T12:00:00Z",
  "files": [
    { "path": "sample.bin", "size": 4,
      "sha256": "replace-with-the-64-character-sha256-of-the-backed-up-file" }
  ]
}
~~~

Verification copies samples to a private temporary directory, reads them back,
checks size/checksum and removes the temporary copies. The byte budget counts
both source and restored reads. This proves those sampled bytes can be restored;
it does not prove full-database recovery or create a backup. Keep production
restore procedures, encryption keys and backup credentials under operator control.

## API and validation

[Plugin API v2](./PLUGIN_API.md), [REST](../../API.md) and [MCP](../../MCP.md)
expose typed review/session operations and scoped job inspection. Trusted modules
are not sandboxed; capabilities describe intent. Room wrappers, operator grants,
revision checks and owner review constrain these built-in workflows.

Automated acceptance uses synthetic rooms, provider responses and temporary
files. Provider-account collectors and real Discord/Telegram publication need
operator-owned test destinations before live rollout; fixture success is not a
claim of authenticated provider acceptance.
