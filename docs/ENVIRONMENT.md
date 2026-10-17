# Environment configuration

Hobbyfiles reads `.env` from its working directory at startup. Copy
[.env.example](../.env.example) and uncomment only the settings you need.
The file is private and ignored by Git. Protect it with `chmod 600 .env` on Linux.
Do not use real credentials in examples, screenshots, support logs or build arguments.

## Precedence and validation

From lowest to highest priority: built-in `defaults.js`, user configuration
(`~/.config/hobbyfiles.json`, then `~/.config/hobbyfiles`), project `.config.json`,
project `.config`, `.env` overrides, then existing process/service environment.
An empty environment setting leaves the corresponding configuration value unchanged.
`HOBBYFILES_ENV_FILE=/absolute/path` selects another file instead of `.env`;
a missing explicitly selected file is a startup error. Relative paths resolve
against the working directory. Files are limited to 1 MiB. Node's native env
parser supports quoted values and comments; it does not run shell commands or
expand `$VARIABLE` references. Flags accept `true` or `false`; ports accept
1–65535; workers accept 1–64. Invalid typed values stop startup without printing
secrets. Restart the service after changes; rebuilding assets is unnecessary.

Existing installs can keep their `~/.config/dicefiles.json` and
`~/.config/dicefiles` files. Hobbyfiles checks the new names first, then falls
back to the old names. The same compatibility rule applies to environment
settings: use `HOBBYFILES_*` for new installs; `DICEFILES_*` aliases continue to
work. If both prefixes define a setting, `HOBBYFILES_*` wins. The old
`DICEFILES_ENV_FILE` name is also accepted.

## Settings

| Group | Variables | Configuration keys |
| --- | --- | --- |
| Network | `HTTP_PORT`, `HTTPS_PORT`, `HOBBYFILES_WORKERS` | `port`, `tlsport`, `workers` |
| Identity | `HOBBYFILES_NAME`, `HOBBYFILES_MOTTO`, `HOBBYFILES_PUBLIC_BASE_URL` | `name`, `motto`, `publicBaseUrl` |
| Credentials | `HOBBYFILES_SECRET`, `HOBBYFILES_STATUS_TOKEN` | `secret`, `statusPageToken` |
| Storage | `HOBBYFILES_UPLOADS`, `REDIS_URL` | `uploads`, `redis_url` |
| Flags | `HOBBYFILES_JAIL`, `HOBBYFILES_NATIVE_TOOLS`, `HOBBYFILES_PUBLIC_ROOMS`, `HOBBYFILES_LINK_COLLECTION`, `HOBBYFILES_STATUS_PRIVATE`, `HOBBYFILES_TORRENT_DISCOVERY` | `jail`, `nativeTools`, `publicRooms`, `linkCollection`, `statusPagePrivate`, `torrentDiscovery` |
| Providers | `HOBBYFILES_GIPHY_API_KEY`, `HOBBYFILES_OPENGRAPH_API_KEY` | `giphyApiKey`, `opengraphIoKey` |
| Automation | `HOBBYFILES_AUTOMATION_KEYS` | `automationApiKeys` (JSON array) |
| Bot connections | `HOBBYFILES_PLUGIN_CONNECTIONS` | `pluginConnections` (JSON array of operator grants and credential references) |
| Background media | `HOBBYFILES_TORRENT_MONITOR`, `HOBBYFILES_MOVIE_AUTO_MATCH` | `torrentMonitor`, `movieAutoMatch` |
| Video playback | `HOBBYFILES_TORRENT_PLAYBACK` | `torrentPlayback` |
| Movie metadata | `HOBBYFILES_TMDB_TOKEN`, `HOBBYFILES_TMDB_API_KEY`, `HOBBYFILES_TVDB_API_KEY`, `HOBBYFILES_TVDB_PIN`, `HOBBYFILES_TRAKT_CLIENT_ID` | `tmdbToken`, `tmdbApiKey`, `tvdbApiKey`, `tvdbPin`, `traktClientId` |

`NODE_ENV=production` enables the production signing-secret check. Use a unique
random secret of at least 32 bytes. Keep it stable across workers and restarts.
Advanced nested settings (storage volumes, federation peers, plugins, credentials)
remain in `.config.json`; see `defaults.js` and the relevant operator guides.
Runtime UI changes to a setting overridden by env will revert on restart.

## Torrent discovery

`HOBBYFILES_TORRENT_DISCOVERY=true` (default) enables bounded public tracker,
DHT and peer metadata queries on torrent ingestion and details checks. This
reveals the server's IP and requested torrent hash to those services. No payload
is downloaded or seeded. Unresolved public magnets briefly announce to supplied
trackers to obtain peers and send best-effort stopped events afterwards. Known
private torrents never use DHT or metadata announces. A bare magnet
cannot reveal its private flag before metadata is available. Disable the flag
where that outbound traffic is unsuitable. HTTP exact-source and cover discovery
remain guarded HTTP features. See [torrent metadata](./TORRENTS.md) for limits.

`HOBBYFILES_TORRENT_MONITOR=true` (default) refreshes tracker availability in the
maintenance worker. It requires discovery to be enabled. Successful checks recur
roughly every 15 minutes; failures retry around 30 minutes. Disable this flag to
keep ingestion/manual discovery while stopping background checks. No DHT, peer
connections, announces or payload downloads are performed by the monitor.

`HOBBYFILES_MOVIE_AUTO_MATCH=true` (default) matches movie/episode filenames inside
torrents after ingestion, using configured catalogue credentials. Filenames and
title queries are sent to those providers. High-confidence results apply
automatically; ambiguous results require review. Disable this flag to keep
manual matching without background catalogue requests. It is independent of
tracker monitoring and payload playback.

## Movies and television

Set `HOBBYFILES_TMDB_TOKEN` to a TMDB API read access token, or use
`HOBBYFILES_TMDB_API_KEY` as an alternative. These enable movie/series searches,
IMDb title-page resolution, posters, backdrops, clear logos, episode scenes and
cast where supplied by the catalogue. TVDB v4 uses `HOBBYFILES_TVDB_API_KEY` and
optionally `HOBBYFILES_TVDB_PIN`; respect the license attached to your key. Trakt
uses `HOBBYFILES_TRAKT_CLIENT_ID`. Configure only the providers you use. Keys and
PINs are server-only and are never returned to clients or compiled into assets.
Searches send the entered title to configured providers. Artwork loads from the
provider's image host; trailer links open externally.

`HOBBYFILES_TORRENT_PLAYBACK=true` independently enables on-demand public torrent
payload playback. Unlike metadata discovery, pressing Play downloads selected
pieces. There are two cluster-wide slots, 4 GiB cache per session, 8 GiB torrent
limit, four-hour session limit and 90-second idle cleanup. Native video decoding
is browser-dependent; there is no automatic transcoding. See [movie support](./MOVIES.md).

## Giphy

Set `HOBBYFILES_GIPHY_API_KEY` to an operator-owned Giphy API key and restart.
Search uses `/api/gifs/search`; the server calls Giphy with an 8-second deadline,
2 MiB response cap and 30 searches per minute per client IP across workers.
The browser receives GIF URLs and pagination only. Keys are never compiled into
JavaScript or exposed in browser request URLs. Legacy
`.gif-providers.local.json` remains supported server-side (`giphy.apiKey` and
`giphy.rating`); the environment key takes precedence. The default rating is
`pg-13`. A missing or rejected key produces a recovery message in the picker.
Search queries are sent to Giphy; inserting a GIF still posts its public URL.

## MCP

The standalone `node scripts/mcp-server.js` reads the same env file. The final
section of `.env.example` lists its settings; [MCP.md](../MCP.md) documents
transport, scopes and OAuth. MCP is a separate process; the web server does not
start it automatically. Keep the incoming `MCP_AUTH_TOKEN` separate from the
upstream `HOBBYFILES_API_KEY`. Do not expose a plain HTTP listener publicly.

### Bot provider connections

`HOBBYFILES_PLUGIN_CONNECTIONS` maps to `pluginConnections`: a JSON array of
operator-owned connections with explicit pluginIds/roomIds grants and provider
settings. Room forms save connection IDs. Credential fields ending in Env read
named environment variables; no provider secret is returned by the connection
listing. Restart after changes. See the [provider table and setup example](../core/plugins/COLLECTION_BOTS.md).
