# Magnet and torrent metadata

Use **Upload → Import link** for a magnet URI or public HTTP/HTTPS
`.torrent` URL. **Choose files from this device** accepts `.torrent` and `.magnet`
files alongside ordinary uploads. Imported links go through the normal upload
queue, room policy, account requirements, bans, rate limits and storage quotas.
The automation batch-upload API accepts magnet URIs and torrent URLs as well.

Shared magnet links are clickable in chat and collected in Links Archive.
Torrent URLs receive metadata when discovery succeeds. Use the details glyph
in Links Archive, or open an uploaded torrent's name/cover, to see metadata.
Download retains the original metadata file; Open magnet hands the link to the
user's torrent application.

Metadata includes v1 SHA-1 and v2 SHA-256 info hashes, name, total size, paths and
sizes, tracker tiers, web/HTTP seeds, creation date, creator, comment, source,
publisher, private flag, piece size/count and v2 file roots. Magnet parameters,
including repeated extension parameters, and additional metainfo/info extension
fields are retained. Binary extension values include their size and a bounded
hex preview; complete bytes remain in the original file. Bare magnets accurately
show **link-only** metadata; file lists cannot be inferred from a hash alone.
Public HTTP `xs` sources are tried under a deadline, and results are accepted
only when their info hashes match. Dicefiles never contacts trackers, DHT or
peers, and never downloads or seeds the referenced payload.

Explicit cover fields and publisher/source pages may provide an image. Discovery
uses the guarded HTTP layer, including DNS pinning and redirect checks, with
small byte/time limits. Images are decoded and resized to a bounded JPEG before
reaching the browser; arbitrary remote image URLs are not embedded. Discovery
failure does not prevent sharing. No image search provider or paid lookup is
required, and source pages may not have a usable cover.

Limits: 16 KiB magnet URI, 2 MiB `.torrent`, 2,000 files, 40 bencode levels,
100,000 parsed values and 512 KiB display metadata. Unsafe paths, unsorted or
duplicate dictionary keys, invalid sizes and incomplete piece hashes are
rejected. Bulk piece-hash arrays and piece layers remain in the downloadable
original file; the UI displays their counts/roots rather than megabytes of
binary hashes. Invalid uploaded files remain downloadable with a metadata warning.

Protocol references: [BEP 3](https://www.bittorrent.org/beps/bep_0003.html),
[BEP 9](https://www.bittorrent.org/beps/bep_0009.html),
[BEP 52](https://www.bittorrent.org/beps/bep_0052.html).
