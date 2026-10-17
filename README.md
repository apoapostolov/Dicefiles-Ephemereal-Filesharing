<!-- markdownlint-disable MD033 -->

<div align="center">

  <h1>Hobbyfiles</h1>

  <p>Host a community room where people can share, find, request, and read files together.</p>

  <p>
    <a href="#readme"><img src="https://img.shields.io/badge/Type-Self-hosted%20app-555" alt="Type: Self-hosted app"></a>
    <a href="./package.json"><img src="https://img.shields.io/badge/Language-JavaScript-555" alt="Language: JavaScript"></a>
    <a href="https://github.com/apoapostolov/Hobbyfiles/releases/latest"><img src="https://img.shields.io/github/v/release/apoapostolov/Hobbyfiles" alt="Latest stable release version"></a>
    <a href="https://github.com/apoapostolov/Hobbyfiles/releases/latest"><img src="https://img.shields.io/github/release-date/apoapostolov/Hobbyfiles?display_date=published_at&amp;label=last%20release" alt="Published date of latest stable release"></a>
  </p>

</div>

<div align="center">
  <a href="https://github.com/apoapostolov/Hobbyfiles">
    <img src="images/hero.png" width="100%"
      alt="Hobbyfiles: ephemeral file sharing for hobby communities"></a>
</div>

Hobbyfiles is built for collections people actively browse and discuss: RPG
books and maps, board games, STL models, comics, fiction, and other hobby media.
Each room combines live chat, temporary file sharing, requests, readers,
moderation, and optional automation without feeling like a generic cloud-drive
dashboard. You host it; there is no public Hobbyfiles service.

## What's New in 1.4.7

Rooms can collect from approved feeds and cloud folders, review uploads and
requests, and plan sessions with private RSVPs. The catalog now includes 27
built-in bots with durable jobs and activity reports. Movie and TV torrents
gain streaming playback, subtitles, remembered progress, readable episode names
and verified season-pack coverage.

This release also adds 34 themes, compact phone and tablet controls, 57 scoped
MCP tools, and container deployment through GHCR. Operators should review the
[upgrade notes](CHANGELOG.md#operator-notes) and configure provider connections
before enabling collectors. See the full [changelog](CHANGELOG.md).

## What You Can Do

- **Share around a live conversation.** Combine chat, uploads, inline media, Giphy, moderation, and configurable retention in one room.
- **Browse instead of digging through filenames.** Switch between compact lists and galleries with generated covers, filters, search, tags, and remembered views.
- **Read without downloading first.** Open PDF, ePub, MOBI/AZW, and CBZ/CBR/CB7 comics in the room with progress and keyboard navigation.
- **Look inside archives.** Browse ZIP, RAR, 7Z, TAR, multipart archives, and comics, then extract only the entry you need.
- **Ask the community for missing material.** Post requests, attach reference links or images, and let an upload fulfill the request directly.
- **Join libraries without copying them.** Link approved rooms locally or across trusted independent hosts while the source keeps control.
- **Protect private communities.** Use expiring guest invites, optional rotating room passwords, consent boundaries, and role-based moderation.
- **Connect tools and room bots.** Use scoped REST, webhooks, 57 MCP tools,
  and bounded automation for imports, releases, requests, and commands.
- **Grow beyond one drive.** Add several volumes, set free-space floors,
  monitor health, and keep legacy content where it already lives.
- **Choose your workspace colors.** Pick from 34 persistent themes, including
  26 dark palettes, using Appearance.
- **Explore torrents.** Import magnets and `.torrent` files, browse searchable
  contents and artwork, check reported availability, and stream supported videos.
- **Watch movies and episodes.** Resume long videos, match clear torrent titles automatically or choose a catalogue result,
  browse artwork and cast, and add subtitles in your language.
- **Preview 3D print and mesh files.** Open STL, 3MF, OBJ, glTF/GLB, PLY,
  FBX, and USD models in the browser. ZIP-contained glTF/GLB, OBJ, and 3MF
  previews load linked buffers, materials, and textures from their archives.

![The Indie Adventurer room with community chat beside a gallery of RPG books, archives, maps, and a matched torrent](images/hobbyfiles-room-gallery.png)

![An STL miniature rendered in the in-browser 3D model viewer](images/hobbyfiles-3d-model-viewer.png)

## Rooms Made for Communities

Room owners can control visibility, retention, requests, deep links, linked
libraries, plugins, invitations, and access without leaving the room. Members
can quickly switch to files added since their last visit or download All, New,
or Since Last Visit through a resumable queue.

The optional public directory exposes only rooms that opt in. Profiles collect
activity, contribution statistics, and achievement tracks for uploads,
downloads, and fulfilled requests.

Room owners manage room behavior, access, and automation in one place:

![General room options for the Indie Adventurer community](images/hobbyfiles-room-options.png)

![Room access settings for password rotation and shared credentials](images/hobbyfiles-room-access.png)

![The room plugin picker with collection, community, and publishing bots](images/hobbyfiles-room-plugins.png)

![A full-size dungeon map opened in the room's image preview](images/hobbyfiles-map-viewer.png)

## Built-in Readers

- **PDF:** lazy page rendering, range requests, zoom, progress, and download.
- **ePub:** A5-style pages, chapter navigation, typography controls, and soft page curls.
- **MOBI / AZW / AZW3:** browser-side parsing with the same paginated reading view.
- **Comics:** sequential CBZ, CBR, and CB7 pages with keyboard navigation.

PDF, ePub, and MOBI reading runs in the browser. Native tools are used only for
server-generated previews and formats such as RAR/7Z extraction.

![The PDF reader open to an illustrated page in Designers & Dragons: Origins](images/hobbyfiles-pdf-reader.png)

![The ePub reader with its dark page color and typography controls open](images/hobbyfiles-epub-reader.png)

![The Witcher comic open to an illustrated interior page in Webtoon mode](images/hobbyfiles-comic-reader.png)

The same room lets members browse an archive and open supported files before
extracting them. The action column stays aligned alongside each file's size:

![A 3D-printing ZIP archive with aligned View and 3D View actions beside its files](images/hobbyfiles-archive-browser.png)

## Torrent and Video Support

Magnet links and torrent files expose searchable contents, tracker status,
availability estimates, and matched movie or episode details. Movie and TV
season packs can be streamed when peers and codecs allow it.

![Torrent details showing a matched movie, artwork, content size, file count, and peer estimates](images/hobbyfiles-torrent-details.png)

Opening a supported video starts buffering immediately. Long videos keep their
resume position and expose playback and subtitle controls:

![A matched movie torrent opened in the video player while its stream buffers](images/hobbyfiles-torrent-player-buffering.png)

![A long video ready to resume at 22:09 with playback and subtitle controls](images/hobbyfiles-video-player-ready.png)

## Quick Start

Requirements: Node.js 22.13+ or 24+, Yarn 1.x, Redis, and a Linux, macOS, WSL, or
Windows host. Yarn is the supported package manager; use the committed
`yarn.lock`.

```bash
git clone https://github.com/apoapostolov/Hobbyfiles.git
cd Hobbyfiles
yarn install --production=false
cp .env.example .env
```

Edit `.env` before the first start: set a unique random `HOBBYFILES_SECRET`
and `HTTP_PORT=8080`. Generate a secret with `openssl rand -hex 32`.
Then run `yarn start` (which builds assets before starting). Open
`http://127.0.0.1:8080`. See [environment configuration](docs/ENVIRONMENT.md)
for ordered flags/keys and precedence. Advanced settings remain in strict JSON
`.config.json`; the annotated `.config.json.example` requires removing its comments.

On Ubuntu, Debian, or WSL, `yarn setup:ubuntu` installs dependencies, checks the
native preview stack, and builds the client. On other systems, install ExifTool,
Ghostscript, Poppler, FFmpeg, and 7-Zip for the broadest
preview and archive support; then run `yarn check:preview-tools`.
Linux sandboxing also needs firejail, and RAR extraction needs unrar. Debian
installations may need to enable non-free repositories for unrar.

Build with development dependencies installed, even when `NODE_ENV=production`.
The webpack toolchain is in `devDependencies`; a production-only install is
appropriate after assets have been built.

Verify the live service:

```bash
curl -s http://127.0.0.1:8080/healthz
```

Production deployments should place Hobbyfiles behind an HTTPS reverse proxy.
Never commit `.config.json`, API keys, room credentials, federation private
keys, or generated capability URLs.

## Docker: build and run

For a new installation, copy this into `compose.yaml` to run the published
Hobbyfiles 1.4.7 image with Docker Compose:

```yaml
services:
  hobbyfiles:
    image: ghcr.io/apoapostolov/dicefiles-ephemereal-filesharing:1.4.7
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HTTP_PORT: "8080"
      REDIS_URL: redis://redis:6379/0
      HOBBYFILES_SECRET: ${HOBBYFILES_SECRET:?Set HOBBYFILES_SECRET in .env}
    ports:
      - "127.0.0.1:${HOBBYFILES_PORT:-8080}:8080"
    volumes:
      - hobbyfiles-data:/data
    read_only: true
    tmpfs:
      - /tmp:rw,nosuid,nodev,size=512m
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 256
    mem_limit: 2g
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20
    security_opt:
      - no-new-privileges:true
    pids_limit: 64
    mem_limit: 512m

volumes:
  hobbyfiles-data:
  redis-data:
```

Create a `.env` file beside `compose.yaml`. Generate a private secret with
`openssl rand -hex 32`, then put the generated value here:

```dotenv
HOBBYFILES_SECRET=paste-generated-value-here
HOBBYFILES_PORT=8080
```

Then start Hobbyfiles and check that it is healthy:

```bash
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
```

Docker Desktop shows the **Hobbyfiles** project in Containers. The app listens
on loopback port 8080. To expose it beyond this computer, put it behind an HTTPS
reverse proxy as described in the [Docker guide](docs/DOCKER.md).
For an existing Docker installation, keep its current Compose project and
follow the guide's upgrade steps so its volumes remain attached.

To build from the repository instead, use Docker Engine with Compose or Docker
Desktop in Linux-container mode:

```bash
docker build -t hobbyfiles:local .
cp .env.docker.example .env.docker
```

Set a unique random `HOBBYFILES_SECRET` in `.env.docker`, then start the stack:

```bash
docker compose --env-file .env.docker up -d --no-build
docker compose --env-file .env.docker ps
curl -fsS http://127.0.0.1:8080/healthz
```

For a newer published build, change the `image` line in the Compose example to
`ghcr.io/apoapostolov/hobbyfiles:TAG` using a tag that has been published to
GHCR.

The [Docker guide](docs/DOCKER.md) covers the complete recipe, GHCR publication,
configuration, backups, upgrades and preview sandbox limitations. The default
container disables external file tools until a dedicated sandbox policy is
validated. Browser readers and image previews remain available. Do not use
privileged containers to bypass this limitation.

## Automation and Operations

The REST API and MCP server cover room discovery, uploads, metadata, requests,
archives, links, guest invites, federation, bots, storage, and protected-room
access. Permissions are split into scopes, rate limited, and audited.

- [REST API reference](./API.md)
- [MCP setup and 57-tool reference](./MCP.md)
- [Trusted-host federation](./docs/FEDERATION.md)
- [Plugin development](./core/plugins/DEVELOPING_PLUGINS.md)
- [Core plugin power-user guide](./docs/CORE_PLUGINS.md) — practical setup for all 27 bundled bots
- [Plugin API v2 reference](./core/plugins/PLUGIN_API.md) — callable contracts, complete modules and limits
- [27-plugin developer cookbook](./core/plugins/PLUGIN_COOKBOOK.md) — configuration recipes and implementation patterns
- [Offline power-user handbook](./docs/handbooks/hobbyfiles-core-plugins-1.4.7.html) and [developer handbook](./docs/handbooks/hobbyfiles-plugin-developer-1.4.7.html) — self-contained HTML; also attached to the [1.4.7 release](https://github.com/apoapostolov/Hobbyfiles/releases/tag/v1.4.7)
- [Collection bots: provider setup and recovery](./core/plugins/COLLECTION_BOTS.md)
- [Community and maintenance bots: reviews, sessions and operator grants](./core/plugins/WORKFLOW_BOTS.md)
- [Bots audit and ordered development checklist](./docs/BOTS_AND_PLUGINS.md)
- [Operations skill for AI agents](./skills/hobbyfiles-ops/SKILL.md)
- [Environment flags and private provider keys](./docs/ENVIRONMENT.md)
- [Appearance and theme tokens](./docs/THEMES.md)
- [Magnet and torrent metadata](./docs/TORRENTS.md)
- [Movies, streaming and subtitles](./docs/MOVIES.md)
- [Security policy](./SECURITY.md)

The protected operator dashboard reports capacity, uptime, traffic, requests,
and service health without exposing filesystem paths or secrets.

![The operator health page showing service status and the Drive horizon capacity dashboard](images/hobbyfiles-status-dashboard.png)

## Development

```bash
yarn lint
yarn test
yarn prestart
```

Contributor workflow and release checks live in [`dev/README.md`](./dev/README.md).
The complete documentation index is [`docs/README.md`](./docs/README.md).

Hobbyfiles is licensed under MIT. It began as a fork of
[droppy](https://github.com/silverwind/droppy) and now includes substantial new
community, reading, automation, storage, and federation systems.
