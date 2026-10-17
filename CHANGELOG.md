# Changelog

## [1.5.0] - 2026-10-17

Hobbyfiles brings reading, 3D printing models and movie nights into the same
community room. Share a collection, browse its contents, and open what you want
without leaving the conversation.

### Readers, archives and 3D printing

- Read PDFs, ePubs and comics in the room, with saved positions and up to ten
  dismissible Continue Reading cards. PDFs open at a readable width; PDF and
  comic zoom controls show the current ratio. ePub settings include white,
  dark and sepia pages.
- Browse archives and preview supported documents, comics, images, audio and
  videos inside ZIP files. Download an individual previewed file from its viewer.
  Aligned View and size columns keep archive contents easy to scan.
- Inspect STL, 3MF, OBJ, glTF/GLB, PLY, FBX and USD models with the Babylon.js
  viewer. ZIP-contained models load their linked materials, textures and buffers
  from a temporary cache. Model entries can be extracted up to 256 MB; ordinary
  archive extraction remains capped at 50 MB.

### Movies, TV and torrents

- Upload magnet links and torrent files, discover verified contents from public
  peers, search the file list, and see relaxed background seeder/peer checks.
  File sizes represent torrent contents, not the small descriptor or link.
- Match movies and episodes with catalogue information, posters, backdrops,
  clear logos, cast, trailers and scenes. Gallery cards use matched artwork;
  file names show movie years or season/episode numbers. Season and multi-season
  packs show episode coverage; complete-series labels need catalogue counts.
- Watch torrent videos in the room with seeking, subtitles, volume, speed,
  fullscreen and picture in picture where supported. MKV, AVI, MOV and transport
  streams use on-demand browser-compatible conversion when native tools are enabled.
- The torrent dialog's Watch action opens the largest movie video or the earliest
  unfinished TV episode. Videos start automatically when ready, with a Play-button
  fallback when the browser blocks autoplay. Long videos save timestamps every
  five seconds; episodes count as watched at 90% and stay watched when replayed.
- Buffering shows verified part counts, download speed and an approximate wait
  every two seconds. Its centered animated indicator disappears when ready.
  Video Information accepts language-labelled subtitles and includes major
  European languages, including Bulgarian.

### Rooms and appearance

- Choose from 34 persistent themes, with shared color variables across the room.
  Compact phone and tablet toolbars keep controls usable in narrow views.
- Upload through a dedicated drop zone, browse large galleries in bounded pages,
  and dismiss individual reading or watching cards. Ctrl/Command-click selects a
  range; Shift-click toggles one file without opening or downloading it.
- The product is now **Hobbyfiles**. Existing rooms, uploads, original download
  names and browser preferences are retained. Legacy `DICEFILES_*` variables,
  API headers, federation identifiers and plugin properties remain accepted.

### Bots, plugins and automation

- Invite 27 opt-in core bots for feed/cloud collection, community workflows and
  maintenance. Collectors support RSS/Atom, S3, Nextcloud, Google Drive, Dropbox,
  OneDrive and pinned Hugging Face files through explicitly granted connections.
- Community bots help with welcome guidance, requests, digests, curation, reviewed
  uploads and room sessions. Maintenance bots cover expiry, previews, integrity,
  capacity, backup samples, link health, access reviews and missing metadata.
- Plugin API v2 provides scoped file/request/link operations, private versioned
  checkpoints, host-rendered reports and reviewed actions. Durable jobs support
  cancellation, scheduled retries and replay; delivery queues survive restarts.
- Use 57 scoped MCP tools with stateless HTTP, OAuth caller isolation, structured
  results and bounded file/archive pagination. Automation also covers verified
  storage moves with pause/resume/rollback and revocable room access credentials.
- Read the standalone [core plugin guide](docs/CORE_PLUGINS.md),
  [Plugin API reference](core/plugins/PLUGIN_API.md) and
  [developer cookbook](core/plugins/PLUGIN_COOKBOOK.md). Self-contained HTML
  handbooks are included with this release.

### Hosting and safeguards

- Deploy with Docker Compose and published Linux amd64/arm64 GHCR images.
  The container workflow checks preview dependencies and starts the TCP torrent
  runtime before publication; images include SBOM and provenance.
- Keep flags and provider keys in the documented private environment/config files.
  Giphy requests stay server-side. Provider imports use scan/file budgets,
  revision checkpoints, bounded retries and current room permissions.
- Archive and preview parsers run with resource limits and sandbox support.
  Remote fetches reject private network destinations, validate redirects and
  avoid forwarding credentials across origins. MCP HTTP checks host/origin and
  requires explicit authentication and allowed hosts for remote bindings.

### Operator notes

- Use Node.js `^22.13.0 || >=24` and Yarn 1.x. Run `yarn install`, then
  `yarn prestart` with development dependencies before restarting the service.
  Back up uploads, Redis and private configuration before upgrading.
- Existing data needs no room or upload migration. Keep the historical Compose
  project/volume names when upgrading an existing deployment. The release image
  is `ghcr.io/apoapostolov/hobbyfiles:1.5.0`.
- Configure provider grants before enabling collection bots. Live provider access
  depends on operator-owned credentials and sources. External delivery is not
  exactly-once; sampled backup checks do not replace a full restore exercise.
- Torrent playback needs reachable public v1/hybrid TCP peers and enabled native
  tools for conversion. Private and v2-only torrents need an external torrent app.
  Tracker counts do not guarantee a working stream. Watch history is browser-local.
- MCP stdio clients keep their existing setup. HTTP clients send
  `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` on each `POST /mcp`.
  The default binding is loopback; remote access requires deliberate configuration.
- Read [environment settings](docs/ENVIRONMENT.md), [Docker deployment](docs/DOCKER.md),
  [collection setup](core/plugins/COLLECTION_BOTS.md) and
  [workflow setup](core/plugins/WORKFLOW_BOTS.md) before rollout.
