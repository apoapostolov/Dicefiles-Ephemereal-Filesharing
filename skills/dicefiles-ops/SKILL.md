---
name: dicefiles-ops
description: Operate a Dicefiles instance. Install, configure, run as a service, upgrade, back up and restore, wire the MCP server, manage room bots, and diagnose a degraded server.
---

# Dicefiles Operations

Operator skill for running a Dicefiles instance. For *using* rooms through the
MCP tools, see `scripts/openclaw-dicefiles-skill/SKILL.md`. This document covers
the instance itself: install, config, service, upgrades, backups, and diagnosis.

## When to use

- Standing up, moving, or restoring a Dicefiles instance
- Wiring the MCP server into an agent, IDE, or orchestrator
- An upgrade, a node or Redis problem, or a `/healthz` that is not 200
- Backing up or restoring rooms, uploads, and federation identity

## Non-negotiables

| Rule | Why |
| ---- | --- |
| Node.js 22 or newer | `server.js` exits before any require when the major is below 22 |
| Yarn 1.x with `yarn.lock` | `package.json` pins `packageManager`; never create `package-lock.json` |
| No hot reload, no `webpack --watch`, no Nodemon | The service owns the port; watchers make the app vanish mid-edit |
| Browser code is edited in `client/` and `entries/` | `static/*.js`, `static/*.css`, their maps, and `lib/clientversion.js` are build output from `yarn prestart` |
| `.config.json`, `.config/`, uploads, logs, and tokens stay out of git | They hold secrets and private room data |

## Doc map

| Need | File |
| ---- | ---- |
| Install, ports, first run | `docs/INTRODUCTION.md`, `docs/CONTRIBUTING.md` |
| Every config key with its default | `.config.json.example` (annotated), `defaults.js` |
| REST contract and scopes | `API.md` |
| MCP server and tools | `MCP.md` |
| Automation use cases | `docs/ai_automation.md` |
| Plugin design and operator guides | `core/plugins/` |
| Service handoff, review, release | `dev/README.md` |
| Multi-volume storage | `docs/MULTI_VOLUME_STORAGE.md` |
| Federation trust model | `docs/FEDERATION.md` |
| Room password policy | `docs/PASSWORD_PROTECTED_ROOMS.md` |
| Remote host imports | `docs/MULTI_HOST_REMOTE_IMPORTS.md`, `core/plugins/REMOTE_HOST_IMPORTS.md` |

## Install and first run

```bash
yarn install --frozen-lockfile
yarn prestart          # webpack build of browser assets, required before serving
node server.js         # foreground; use a service for anything long-lived
```

Redis is a hard dependency. The broker keeps room state, bans, plugin state, and
request claims there, so a Dicefiles instance without Redis starts and then fails
its first real operation. `yarn check:preview-tools` reports the optional native
tools used for thumbnails, PDF rendering, and archive browsing; `yarn setup:ubuntu`
installs the Ubuntu set.

## Configuration

Config loads in this order, last value wins: `defaults.js`, then
`~/.config/dicefiles.json`, then `.config.json` in the project directory, then a
`.config` module if present. Only the keys you set need to appear.

Keys that decide whether an instance works:

| Key | Default | Notes |
| --- | ------- | ----- |
| `port` | `8080`, or `HTTP_PORT` | Set it explicitly. Personal dev instances live in the 10000-19999 band. |
| `secret` | `dicefiles` | Must be unique and at least 16 characters. Production refuses to start on a weak or default value. |
| `uploads` | `uploads` | Blob root. Set `storage.volumes` to place content across several roots. |
| `redis_host`, `redis_port` | `127.0.0.1`, `6379` | Broker connection. |
| `jail` | `true` on Linux | Wraps every external preview and archive command in firejail. Set `false` only where firejail is absent, and know what you give up. |
| `automationApiKeys` | `[]` | Empty disables every `/api/v1` route. Entries accept a preset (`read-only`, `upload`, `mod`) or an explicit scope list. |
| `statusPagePrivate` | `true` | The public status page stays off until an operator turns it on. |
| `maxFileSize`, `maxAssetsProcesses`, `roomPruning` | see `defaults.js` | Upload cap, preview concurrency, room pruning. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`/healthz` reports `ok`, uptime, and per-dependency checks for Redis and storage.
Treat `ok: false` as a stop condition: do not write against a degraded instance.

## Running as a service

A user-level unit keeps the instance with the operator account and restarts it on
crash:

```ini
[Unit]
Description=Dicefiles Ephemeral Filesharing
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/Dicefiles-Ephemereal-Filesharing
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

`contrib/dicefiles.service` is the shipped template. Put absolute paths in it, since
a unit never inherits an interactive shell `PATH`.

```bash
systemctl --user daemon-reload
systemctl --user enable --now dicefiles.service
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<port>/healthz
journalctl --user -u dicefiles.service -n 80 --no-pager
```

`server.js` starts a cluster plus an expiration worker, so several `node` processes
belong to one unit. Judge health by `/healthz`, not by process count.

## Upgrade

```bash
yarn install --frozen-lockfile
yarn prestart
systemctl --user restart dicefiles.service
# then require 200 from /healthz before handing the instance over
```

Run the narrowest relevant Jest suite first, and the full suite for anything that
crosses modules:

```bash
yarn test:unit
yarn test
```

Restart and wait for Redis room restoration before serving traffic. Read the
release notes in `CHANGELOG.md` for migration steps that involve storage volumes,
password-protected rooms, or federation peers.

## Backup and restore

Three things hold the state of an instance:

| State | Where | Notes |
| ----- | ----- | ----- |
| Rooms, bans, requests, plugin state, sessions | Redis | Configure `appendonly yes` or an RDB `save` policy; the default Debian config snapshots every few minutes at best |
| Blobs | `uploads/`, or each `storage.volumes[].path` | Not in Redis. Copy the files. |
| Secret, status token, federation identity, automation keys | `.config.json` | Losing the secret invalidates every session and invite. Losing the federation key drops the peer relationship. |

A consistent backup stops the service, copies the Redis dump or runs
`redis-cli BGSAVE`, copies the blob roots, then copies `.config.json`. Restore in
the same shape: blobs in place, Redis loaded, config file present, then start and
check `/healthz`.

## MCP wiring

```bash
# stdio, the default
DICEFILES_BASE_URL=http://localhost:<port> \
DICEFILES_API_KEY=<key> \
node scripts/mcp-server.js

# stateless Streamable HTTP
MCP_TRANSPORT=http MCP_PORT=3001 node scripts/mcp-server.js
```

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `DICEFILES_BASE_URL` | `http://localhost:10005` | Dicefiles instance the tools call |
| `DICEFILES_API_KEY` | empty | Automation key; without it most tools return 401 |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` | `3001` | HTTP port |
| `MCP_HOST` | `127.0.0.1` | Bind address for HTTP mode |
| `MCP_API_TIMEOUT_MS` | `30000` | Timeout for each Dicefiles API call |

HTTP mode speaks MCP 2026-07-28, whose protocol core is stateless: no
`initialize` handshake, no `Mcp-Session-Id`, and a fresh server instance per
request, so any request can land on any instance behind a round-robin load
balancer. Each `POST /mcp` must carry `MCP-Protocol-Version`, `Mcp-Method`, and
`Mcp-Name` for methods that name a tool or resource. The server validates `Host`
and `Origin` on every request, which is what stops a browser page from rebinding
its own domain onto the local port.

Scope the automation key to the least the agent needs. The `read-only` preset
covers inspection; `upload` adds ingest and requests; `mod` adds deletion,
moderation, plugin control, and room access management. `MCP.md` maps every tool
to its scope and endpoint.

## Room bots

Bots are per-room plugins. Design and operator guides live in `core/plugins/`;
the shipped examples are `mega-folder`, `remote-import`, `discord-release`, and
`telegram-release`.

- Secrets such as a Mega password or a bot token belong in the room settings, which
  are stored in Redis, never in git and never in room chat.
- The API surface is `GET/PUT/DELETE /api/v1/rooms/:id/plugins` and
  `POST /api/v1/rooms/:id/plugins/:pluginId/run`, gated by `room-plugins:*`.
- The MCP equivalents are `list_room_plugins`, `configure_room_plugin`,
  `run_room_plugin`, `remove_room_plugin`, `inspect_room_plugin_sync_memory`, and
  `clear_room_plugin_sync_memory`.
- Enable the optional `megajs` dependency before relying on live Mega folder sync.
  In tests, fakes are injected through `buildPluginRuntimeCtx`.

## Diagnostics

| Symptom | Look at |
| ------- | ------- |
| `/healthz` 503 | The `checks` object names the failing dependency, Redis or storage |
| `ok: false` from every tool | `DICEFILES_API_KEY` unset, or the key lacks the scope for that route |
| Port already in use | Another worker or a stale process still holds the port; the unit owns exactly one |
| Node exits at once | Node below 22, or a weak `secret` while `NODE_ENV=production` |
| Browser assets stale or 404 | `yarn prestart`, then restart the service |
| Thumbnails missing for PDFs or archives | `yarn check:preview-tools`; install the native tools |
| Lint fails on line endings only | The working tree is CRLF. See the pitfall below. |

## Pitfalls

- **CRLF working trees.** A Windows checkout made before `.gitattributes` existed
  rewrites every tracked file, `yarn lint` then reports tens of thousands of
  `linebreak-style` errors, and `yarn prestart` marks generated bundles as
  modified. Run `git add --renormalize .` once, re-check the tree out, and set
  `core.autocrlf false` in the clone so the repo's own policy is the only one in
  charge.
- **Editing generated files.** `static/*.js`, `static/*.css`, the `.map` files, and
  `lib/clientversion.js` are build output. Edit `client/` and `entries/`.
- **Running two servers.** One service owns the port. A second foreground process
  produces `EADDRINUSE` and a confusing half-broken UI.
- **Public status page.** It aggregates counts and deliberately excludes room,
  user, and file names. Leave `statusPagePrivate` on unless the community wants the
  numbers visible.
- **Weak secrets in production.** The startup guard is a hard exit, not a warning.
- **Archive tooling.** `tar`, `7z`, and `unrar` run under the same firejail wrapper
  as the metadata tools, with the archive's directory as their private home, under
  a byte cap and a wall-clock timeout. Keep the jail enabled and the instance on a
  host you can rebuild: archive parsers remain the highest-risk dependency in the
  stack.
- **Server-side URL fetches.** Anything that fetches a user-supplied URL goes
  through `lib/net-guard.js`, which refuses private and link-local destinations
  and pins the resolved address. A new remote ingest path should call
  `guardedFetch` rather than `fetch`, or it reintroduces a read SSRF.
