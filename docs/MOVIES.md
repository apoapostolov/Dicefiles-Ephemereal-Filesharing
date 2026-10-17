# Movies, episodes and subtitles

## Watching

Open an uploaded video to use the in-page Shaka Player. It provides seeking,
ten-second skip controls, speed, volume, fullscreen, picture in picture where
the browser supports it, and a subtitle selector. Shaka supports progressive
video as well as HLS/DASH; uploaded MP4 and WebM files use normal HTTP range
playback. It loads only when a video is opened. All interface colors use the
selected Hobbyfiles theme.
Opening the player starts buffering immediately and leaves playback paused until
Play is pressed. Loading failures offer a retry without reporting a playback
failure before Play. Close uses the × button in the header or Escape; there is
no footer action row. The video and controls fit the available window height.
On small screens, controls fill equal-width rows. The player follows the video's
intrinsic proportions and available height, narrowing its controls with the
frame instead of adding empty side panels. The frame is not cropped; black
pixels encoded into the source video remain part of that source.

For videos strictly longer than ten minutes, position is saved every five
seconds while playing, and again on pause, close, backgrounding and page exit.
Continue watching cards resume at that position and can be dismissed without
deleting the position. Finished videos leave the strip. History stays in this
browser, is limited to 1,000 entries/180 days, and only appears for files still
available in the room. Reading progress remains separate.

## Matching a title

Use **Video Information** on a long video, or the info action next to a torrent's
video entry. Its accented Watch action follows the provider links in the same
action bar. Search uses a cleaned filename with year/episode hints. Choose a
candidate to apply a manual match.
Alternatively paste an HTTPS IMDb title, TVDB movie/series/episode, or Trakt
movie/series/episode page and confirm the returned title.

### Automatic torrent matching

After a torrent or magnet gains its file list, the maintenance worker attempts
each video in small batches. It applies exact, unique title/year matches and
verified series/season/episode matches. A bare movie title additionally needs
agreement from two configured catalogues on the same edition. Competing same-name
editions or multiple same-provider IDs are left for review. Samples, trailers
and combined-episode files are not assigned a misleading full-title match.
Unresolved magnets retry bounded metadata discovery at roughly fifteen-minute
intervals when torrent discovery is enabled. Only one unresolved torrent is
considered per maintenance minute; available file lists can be matched immediately.

Provider failures retry after five and then thirty minutes, with three attempts
before review. Queue state persists with each room item and resumes after a
restart; expired/deleted files are skipped. Manual matches and explicit removals
are never overwritten, including when a lookup finishes after the user's edit.
Subtitles are preserved. Open torrent dialogs update their main artwork when a
match arrives. Uncertain entries can always be matched through Video Information.

Configure `HOBBYFILES_MOVIE_AUTO_MATCH=false` to disable background matching.
This sends file-title queries to the configured catalogues; it does not download
torrent payloads. Provider credentials and licensing still apply.

TMDB supplies rich movie/series metadata and resolves IMDb external IDs.
TVDB v4 and Trakt add provider search/page resolution when configured. These
are catalogue adapters, not website scraping. No provider credentials are
embedded in browser code. See [environment configuration](./ENVIRONMENT.md).

Confirmed movies display title and year; episodes display series, season and
episode (season zero is shown as a special). The original uploaded filename
and download name stay intact. Details and file hovers use the available
poster, tinted backdrop, clear logo, overview, genres, runtime, rating, cast,
trailer and scenes. Missing assets are omitted. Catalogue coverage varies;
the interface does not invent artwork or ratings. Provider attribution is
shown in details. TMDB attribution does not imply endorsement.

Video Information groups the trailer first and scene images after it in one
horizontal media row, above Cast. Trailer cards open the provider's video page.

The uploader, room owner or moderator can change the match and subtitles.
Other room members can search and preview candidates. Matches persist with
the room item; they do not change another upload of the same underlying bytes.

## Subtitles

In **Video Information → Subtitles**, select a language in the left dropdown,
then choose **Add file…** on the right. English is first; major world languages
and European national/regional languages, including Bulgarian, are available.
Choosing a UTF-8 `.srt` or `.vtt` file uploads it immediately in that language.
The list below pairs each language with its original filename and a Remove
button. Older tracks without stored filenames show “Converted subtitles (VTT)”.
Up to four tracks of 256 KiB each are accepted. SRT is converted to WebVTT; cue times are checked and markup,
styles and regions are removed. Choose the language in the player's Subtitles
menu. Reopen the player after adding or removing tracks.

Subtitle requests use the same room access checks as playback. Subtitle bodies
are stored in Redis separately from the public file list. Expired media records
are pruned every five minutes. The shared library has a 10,000-item limit. Keep
Redis persistence enabled to retain movie matches and subtitles across restarts.

## Torrent playback and resource limits

In torrent details, select Watch beside a video. Ordinary details checks remain
metadata-only. Opening the player starts buffering through a separate, bounded
payload session on the server, even before pressing Play.
This reveals the server IP and torrent hash to public peers and up to four
supplied HTTP(S)/UDP trackers. Explicit playback makes a bounded started announce
to obtain reachable peers and sends a best-effort stopped event on cleanup.
Routine availability checks never announce participation. Unresolved public
magnets can also announce briefly to obtain metadata peers, without requesting
video pieces; see [torrent discovery](./TORRENTS.md). The
server does not seed payloads, use web seeds, accept incoming peers,
or connect to local/private peers. Only the selected file's requested ranges
are downloaded, with small protocol read-ahead. Piece hashes are verified.

`HOBBYFILES_TORRENT_PLAYBACK=false` disables this independently of
`HOBBYFILES_TORRENT_DISCOVERY`. Supported torrents are public v1/hybrid torrents;
private torrents and v2-only torrents must use an external torrent app. Discovery
uses supplied trackers plus the existing bounded public DHT client. Availability depends on reachable
TCP peers; a tracker seeder count does not prove such a peer is reachable.
Playback rotates through up to 48 validated contacts with four concurrent
metadata requests and a 20-second deadline. Contacts are interleaved across
trackers and DHT so one stale tracker cannot monopolize startup.

Limits: two cluster-wide sessions, twelve connections per session, 8 MiB/s
download ceiling per session, 8 GiB total torrent size, 4 GiB selected video/cache,
4 MiB pieces, 65,536 pieces, four-hour lifetime, and 90 seconds of idle time.
Requests stop after 90 seconds without data. Temporary piece files use generated
directories and numeric filenames, never torrent-supplied paths. They are removed
when the session ends. A crashed process can leave its temporary directory; the
operator's temporary-directory cleanup policy should remove old abandoned data.
HTTP workers on the same host reuse the torrent owner through an authenticated
local socket relay. The relay socket lives in the private cache directory, with
its capability kept in private Redis state; it is never exposed to the browser.
Seeks reuse that owner regardless of which HTTP worker receives the range request.
No sticky proxy routing is required.

### Browser-compatible conversion

H.264/AAC MP4 and supported WebM files use direct range playback. Torrent MKV,
AVI, MOV and transport-stream files use an HLS playlist with H.264 video and AAC
stereo audio. A direct torrent file that fails preparation also retries through
this conversion path. This covers HEVC and audio formats that the browser
cannot decode itself. Uploaded videos still depend on native browser codecs.

FFprobe reads the duration through the private range relay. FFmpeg converts
six-second sections only as the player requests them, so seeking can jump to a
later section without encoding everything before it. Output is capped at 720p,
3 Mbit/s video and 128 kbit/s audio. Each section starts independently; the
playlist exposes the full duration for seeking and watch progress.

Conversion requires enabled native tools, FFmpeg with libx264/AAC, and FFprobe.
The `ffmpeg` and `ffprobe` settings can name custom installed binaries. With
the configured Firejail sandbox, a trusted helper provides an isolated loopback
HTTP source backed by the owner's authenticated Unix socket. FFmpeg cannot
contact torrent peers or external media URLs; input protocols and demuxers are
restricted. The browser never receives the private socket capability.

The existing two-session limit also bounds conversion: one native job per owner,
at most eight queued jobs, two encoding threads, 120 seconds per job, 12 MiB per
output section and 128 MiB of shared output cache per session. Videos over four
hours or 8K dimensions are rejected. Ending a session kills its native process
group. Docker deployments that disable native tools must enable an appropriate
sandbox policy before using conversion. Preparation failures display recovery
steps in the player instead of leaving an indefinite buffering message.

## Implementation references

- [Shaka UI and playback](https://shaka-project.github.io/shaka-player/docs/api/tutorial-ui.html)
- [Shaka Player API](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html)
- [WebTorrent streaming and file API](https://webtorrent.io/docs)
- [BitTorrent tracker protocol](https://www.bittorrent.org/beps/bep_0003.html)
- [UDP tracker peer discovery](https://www.bittorrent.org/beps/bep_0015.html)
- [TMDB external-ID lookup](https://developer.themoviedb.org/reference/find-by-id)
- [TMDB artwork](https://developer.themoviedb.org/reference/movie-images)
- [TVDB v4 API](https://thetvdb.github.io/v4-api/)
- [Trakt API](https://trakt.docs.apiary.io/)

Shaka is used with Hobbyfiles' own theme-aware controls, without remote player
fonts, SDKs, analytics or CDN scripts. WebTorrent's tracker dependency is pinned
as a local MIT snapshot to remove its unpatched `ip` package; the small patch is
documented in `vendor/bittorrent-tracker/HOBBYFILES.md`.

The server's TCP-only runtime also resolves the unused WebRTC polyfill to a
small [disabled-capability adapter](../vendor/webrtc-disabled/README.md). This
prevents an eager native WebRTC import from breaking playback when Windows and
WSL use the same checkout. Run `yarn check:torrent-runtime` on the server to
verify the installed client starts; this performs no public peer discovery.
The integration suite additionally transfers a synthetic byte range between
two local clients using the production piece store.


### Season and complete-series packs

Torrent file rows, collected links, hover details and the main torrent dialog
share recognized movie/show titles. Television content rows use Season X
Episode Y; pack headings summarize all included seasons. Episode-only filenames
inherit an unambiguous season from their folder or torrent name. Bare episodes
in a multi-season root without a season folder stay unmatched for review.

TMDB series details supply season episode counts and ended/cancelled status.
Only verified coverage earns Complete series; other packs show their season
range and an unverified/incomplete coverage message. Series requests are cached
across episode lookups to avoid repeating artwork and cast requests per file.
See [torrent presentation](./TORRENTS.md#movie-and-television-torrent-presentation).
