<div align="center">
  <a href="https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing">
    <img src="images/hero.png" width="100%"
      alt="Dicefiles: ephemeral file sharing for hobby communities"></a>
</div>

# Dicefiles — Ephemeral Filesharing for Hobby Communities

*A self-hosted community room for sharing, discovering, requesting, and reading files together.*

[![License](https://img.shields.io/badge/license-MIT-green)](./package.json)
[![Version](https://img.shields.io/badge/version-1.4.5-blue)](./CHANGELOG.md)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933)](./package.json)
[![Redis](https://img.shields.io/badge/redis-v4%20client-DC382D)](./package.json)
[![Package manager](https://img.shields.io/badge/package%20manager-yarn%201.x-2C8EBB)](./yarn.lock)
[![Status](https://img.shields.io/badge/status-active-brightgreen)](./CHANGELOG.md)

Dicefiles is built for collections people actively browse and discuss: RPG
books and maps, board games, STL models, comics, fiction, and other hobby media.
Each room combines live chat, temporary file sharing, requests, readers,
moderation, and optional automation without feeling like a generic cloud-drive
dashboard. You host it; there is no public Dicefiles service.

<p align="center">
  <img src="images/dicefiles-room-gallery.png" alt="A Dicefiles room with live chat, filters, and a gallery of shared files" width="100%">
</p>

## What's New in 1.4.5

- Protect a room with a shared password that rotates monthly or on a fixed schedule.
- Prepare the next credential or rotate immediately when access needs to change.
- Spread new uploads across several storage volumes using balanced or fallback placement.
- Reserve capacity before writes so concurrent uploads cannot overcommit a drive.
- Inspect privacy-safe storage health and manage access through scoped REST and MCP tools.

Existing rooms stay unprotected and single-volume unless an operator enables
the new options. See the [upgrade notes and full changelog](./CHANGELOG.md).

## What You Can Do

- **Share around a live conversation.** Combine chat, uploads, inline media, Giphy, moderation, and configurable retention in one room.
- **Browse instead of digging through filenames.** Switch between compact lists and galleries with generated covers, filters, search, tags, and remembered views.
- **Read without downloading first.** Open PDF, ePub, MOBI/AZW, and CBZ/CBR/CB7 comics in the room with progress and keyboard navigation.
- **Look inside archives.** Browse ZIP, RAR, 7Z, TAR, multipart archives, and comics, then extract only the entry you need.
- **Ask the community for missing material.** Post requests, attach reference links or images, and let an upload fulfill the request directly.
- **Join libraries without copying them.** Link approved rooms locally or across trusted independent hosts while the source keeps control.
- **Protect private communities.** Use expiring guest invites, optional rotating room passwords, consent boundaries, and role-based moderation.
- **Connect tools and room bots.** Use scoped REST, webhooks, 36 MCP tools,
  and bounded automation for imports, releases, requests, and commands.
- **Grow beyond one drive.** Add several volumes, set free-space floors,
  monitor health, and keep legacy content where it already lives.

<p align="center">
  <img src="images/dicefiles-books-gallery.png" alt="A Dicefiles gallery with generated book and comic covers" width="49%">
  <img src="images/dicefiles-archive-browser.png" alt="The in-room archive browser listing package contents" width="49%">
</p>

## Rooms Made for Communities

Room owners can control visibility, retention, requests, deep links, linked
libraries, plugins, invitations, and access without leaving the room. Members
can quickly switch to files added since their last visit or download All, New,
or Since Last Visit through a resumable queue.

The optional public directory exposes only rooms that opt in. Profiles collect
activity, contribution statistics, and achievement tracks for uploads,
downloads, and fulfilled requests.

<p align="center">
  <img src="images/dicefiles-request-board.png" alt="The request board with open requests ready to be fulfilled" width="49%">
  <img src="images/dicefiles-room-options.png" alt="Room options for identity, retention, privacy, linking, and themes" width="49%">
</p>

## Built-in Readers

- **PDF:** lazy page rendering, range requests, zoom, progress, and download.
- **ePub:** A5-style pages, chapter navigation, typography controls, and soft page curls.
- **MOBI / AZW / AZW3:** browser-side parsing with the same paginated reading view.
- **Comics:** sequential CBZ, CBR, and CB7 pages with keyboard navigation.

PDF, ePub, and MOBI reading runs in the browser. Native tools are used only for
server-generated previews and formats such as RAR/7Z extraction.

<p align="center">
  <img src="images/dicefiles-epub-reader.png" alt="An ePub chapter open in the in-room reader" width="49%">
  <img src="images/dicefiles-comic-reader.png" alt="A comic page open in the in-room reader" width="49%">
</p>

## Quick Start

Requirements: Node.js 22 or newer, Yarn 1.x, Redis, and a Linux, macOS, WSL, or
Windows host. Yarn is the supported package manager; use the committed
`yarn.lock`.

```bash
git clone https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing.git
cd Dicefiles-Ephemereal-Filesharing
yarn install
cp .config.json.example .config.json
yarn prestart
yarn start
```

Edit `.config.json` before the first start. At minimum, replace `secret` with a
long random value and choose the listening port. The default address is
`http://127.0.0.1:9090`.

On Ubuntu, Debian, or WSL, `yarn setup:ubuntu` installs dependencies, checks the
native preview stack, and builds the client. On other systems, install ExifTool,
GraphicsMagick with Ghostscript, Poppler, FFmpeg, and 7-Zip for the broadest
preview and archive support; then run `yarn check:preview-tools`.

Verify the live service:

```bash
curl -s http://127.0.0.1:9090/healthz
```

Production deployments should place Dicefiles behind an HTTPS reverse proxy.
Never commit `.config.json`, API keys, room credentials, federation private
keys, or generated capability URLs.

## Automation and Operations

The REST API and MCP server cover room discovery, uploads, metadata, requests,
archives, links, guest invites, federation, bots, storage, and protected-room
access. Permissions are split into scopes, rate limited, and audited.

- [REST API reference](./API.md)
- [MCP setup and 36-tool reference](./MCP.md)
- [Trusted-host federation](./docs/FEDERATION.md)
- [Plugin development](./core/plugins/DEVELOPING_PLUGINS.md)
- [Security policy](./SECURITY.md)

The protected operator dashboard reports capacity, uptime, traffic, requests,
and service health without exposing filesystem paths or secrets.

<p align="center">
  <img src="images/dicefiles-status-dashboard.png" alt="The operator dashboard with service health, capacity, and activity" width="100%">
</p>

## Development

```bash
yarn lint
yarn test
yarn prestart
```

Contributor workflow and release checks live in [`dev/README.md`](./dev/README.md).
The complete documentation index is [`docs/README.md`](./docs/README.md).

Dicefiles is licensed under MIT. It began as a fork of
[droppy](https://github.com/silverwind/droppy) and now includes substantial new
community, reading, automation, storage, and federation systems.
