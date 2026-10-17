# Magnet and torrent metadata

## Share and inspect

Use **Upload → Import link** for a magnet URI or a public HTTP/HTTPS
`.torrent` URL. **Choose files from this device** also accepts `.torrent` and
`.magnet` files. Imports use the ordinary upload queue, room policy, account
requirements, bans, rate limits and storage quotas. Automation batch uploads
accept the same links. Chat recognizes magnets and collects them in Links Archive.

Open an uploaded torrent's name/cover, or its details button in Links Archive.
The details view shows:

- Content category, name, available artwork and description.
- Total size, file count, seeders and downloading peers, when known.
- A searchable file list with folders and individual sizes; large lists expand
  in groups of 50.
- Tracker hosts, protocols, reported availability and the time of the check.
- Source-supplied publisher/date information, when present.

Contents use one compact header with the category summary and a right-aligned
file search. Video filenames, Play and Info controls stay in one row. Matching
a video in Info adds its poster, backdrop and available clear logo to the main
torrent header too. For multiple confirmed videos, the largest matched video is
featured and identified by filename. Unmatched torrents retain the ordinary
content header; removing the match removes its artwork. Matches also work for
magnet entries in Links Archive.

**Open magnet** launches your torrent application; **Copy link** copies the
magnet. Download retains the original metadata file. Details checks do not download
or seed payloads. A video's separate Play action can fetch selected pieces for
in-page playback; see [movie playback and limits](./MOVIES.md). Hashes, piece roots and protocol extension dumps
are retained in structured metadata/original files rather than filling the UI.
A dash means unknown, not zero. Tracker counts may overlap; the summary uses
reported maxima rather than adding duplicate peer counts. Counts are snapshots,
not a promise that a download will complete.

### Availability pills and background checks

Torrent uploads and Links Archive entries show a compact **↑ seeders / ↓ peers**
pill. Peers here means downloading peers, excluding seeders. Select the pill for
full details. Unknown counts show a dash; zero means a tracker actually reported
zero. A clock marks an older report. Failed checks retain the last known counts
with their original reporting time rather than replacing them with zero.

The maintenance worker checks due torrents once per minute in batches of up to
four distinct swarms, scraping at most six supported trackers per swarm with an
eight-second budget. Successful checks are scheduled 12–18 minutes later;
failures back off to 27–33 minutes. Busy installations take longer to complete
the queue. Reports older than 45 minutes are marked stale. Duplicate entries
with the same hash, private flag and tracker addresses share a check; tracker
credentials remain scoped to their source. A Redis lease coordinates workers.
Expired/deleted entries are skipped and current movie metadata is preserved.

These checks use HTTP(S)/UDP scrape only, including supplied private trackers
that support scraping. They do not announce participation, contact peers, query
DHT, or fetch torrent payloads. Trackers may still observe the server IP and
requested hash. Unsupported WebSocket/announce-only trackers show unknown.
Disable background checks with `HOBBYFILES_TORRENT_MONITOR=false`, or disable
all protocol discovery with `HOBBYFILES_TORRENT_DISCOVERY=false`.

## Server discovery

With `HOBBYFILES_TORRENT_DISCOVERY=true` (default), ingestion and details checks
can retrieve metadata from public services. This needs outbound DNS, UDP and TCP;
no inbound listening port is opened.

1. Public HTTP `xs` exact sources are tried. Info hashes must match the magnet.
2. Up to eight supplied trackers are queried through HTTP(S) scrape or UDP
   scrape. Trackers that require announce/authentication, do not implement scrape,
   or cannot be reached show **No report**.
3. An unresolved public magnet queries DHT and announces briefly to up to eight
   supplied HTTP(S)/UDP trackers to obtain peer addresses. Tracker and DHT contacts
   are interleaved, deduplicated and checked against public-address rules. The
   server requests only the info dictionary through BEP 9/10, verifies SHA-1 and/or
   SHA-256, and sends a best-effort stopped event to responding trackers afterwards.
   This temporarily registers the server as a peer; ingestion, manual checks and
   unresolved-magnet background retries can perform this lookup. The metadata
   client never requests payload pieces. V1 and v2 metadata parsing is supported;
   discovery depends on compatible peers and reachable services.
4. Cover fields or publisher/source pages may supply artwork. Guarded HTTP
   discovery pins DNS and rechecks redirects. Images are decoded and resized
   to bounded JPEG data before reaching the browser.

A known private torrent never queries DHT or announces for metadata. A bare magnet cannot disclose its private
flag before metadata is available. Lookups expose the server's public IP and
requested info hash to trackers/DHT/peers; tracker URLs can contain operator or
uploader credentials. The UI displays hosts, never tracker paths or passkeys.
Disable online protocol discovery with `HOBBYFILES_TORRENT_DISCOVERY=false` where
that outbound traffic is unsuitable. Guarded HTTP exact-source and cover lookup
are separate features and remain available. Discovery failure never invalidates
an otherwise valid upload or prevents opening the magnet.

There is no general protocol source for ratings, trusted-release status, genres,
language, screenshots or reviews. Hobbyfiles does not invent them from a filename
or hash. Artwork is best effort; no paid lookup or image-search key is required.

## Resource and access limits

- Protocol discovery: 30-second lookup deadline plus up to 1.5 seconds for tracker
  cleanup, at most two concurrent lookups
  across workers, six details checks per minute per client IP.
- DHT: at most 36 queries, four concurrent requests, bounded node/peer lists.
  Peer metadata: at most 48 contacts tried, four concurrent, two seconds to connect,
  3.5 seconds without verified metadata progress and 15 seconds total per peer,
  maximum 2 MiB of metadata. Private/loopback/link-local destinations are
  refused; HTTP requests and UDP hostname connections use validated pinned DNS.
- Per-worker cache: 32 entries / 8 MiB; successful contents for ten minutes,
  incomplete results for two. **Check again** respects a minimum one-minute
  cache interval. Identical pending lookups coalesce while retaining each item's
  source name, description, artwork and magnet parameters.
- Details requests are restricted to the caller's visible room files or live
  links belonging to that room; items hidden from that caller, foreign items and
  expired links cannot trigger lookup.
- Parsing: 16 KiB magnet URI, 2 MiB `.torrent`, 2,000 files, 40 bencode levels,
  100,000 values and 512 KiB structured display metadata. Network messages have
  separate smaller bounds. Unsafe paths, duplicate/unsorted torrent dictionary
  keys, invalid sizes and incomplete piece hashes are rejected.

V1/v2 hashes, tracker tiers, web/HTTP seeds, source fields and extension parameters
remain in the structured metadata. Bulk piece hashes/layers stay in the original
file. Invalid uploaded metadata remains downloadable with a warning. Live checks
update the open details view and discovery cache; the original file is unchanged.

## Protocol references

[BEP 3: metainfo](https://www.bittorrent.org/beps/bep_0003.html),
[BEP 5: DHT](https://www.bittorrent.org/beps/bep_0005.html),
[BEP 9: metadata exchange](https://www.bittorrent.org/beps/bep_0009.html),
[BEP 10: extension protocol](https://www.bittorrent.org/beps/bep_0010.html),
[BEP 15: UDP tracker](https://www.bittorrent.org/beps/bep_0015.html),
[BEP 48: tracker scrape](https://www.bittorrent.org/beps/bep_0048.html),
[BEP 52: v2](https://www.bittorrent.org/beps/bep_0052.html).


## Movie and television torrent presentation

Recognized movie torrents show **Title (Year)** in the main file list and link
archive. Episodes show **Show · Season X Episode Y**. Season packs show the
series and season; multi-season packs show the included season range. Original
release filenames remain available in the contents list and downloads. Size
columns and Largest first sorting use the sum of torrent contents, with an
unknown dash until contents or an advertised magnet length is available. The
small descriptor/magnet file size is never shown as the content size.

Pack recognition reads SXXEXX, season folders with EXX or numbered episodes,
and multiple season folders. Samples/trailers/extras are excluded from episode
coverage. Duplicate encodes do not increase episode counts. Gaps are shown; a
Complete series label requires an ended/cancelled catalogue series and every
regular season matching its expected episode count. Unknown catalogue coverage
is explicitly unverified. Mixed shows retain their original torrent title.

Earlier ambiguous episode matches receive one retry with the improved parser.
Manual matches/removals remain authoritative. Combined-episode files contribute
coverage when identifiable but still require manual metadata confirmation.
