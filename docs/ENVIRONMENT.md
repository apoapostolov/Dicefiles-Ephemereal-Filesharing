# Environment configuration

Dicefiles reads `.env` from its working directory at startup. Copy
[.env.example](../.env.example) and uncomment only the settings you need.
The file is private and ignored by Git. Protect it with `chmod 600 .env` on Linux.
Do not use real credentials in examples, screenshots, support logs or build arguments.

## Precedence and validation

From lowest to highest priority: built-in `defaults.js`, user configuration
(`~/.config/dicefiles.json`, then `~/.config/dicefiles`), project `.config.json`,
project `.config`, `.env` overrides, then existing process/service environment.
An empty environment setting leaves the corresponding configuration value unchanged.
`DICEFILES_ENV_FILE=/absolute/path` selects another file instead of `.env`;
a missing explicitly selected file is a startup error. Relative paths resolve
against the working directory. Files are limited to 1 MiB. Node's native env
parser supports quoted values and comments; it does not run shell commands or
expand `$VARIABLE` references. Flags accept `true` or `false`; ports accept
1–65535; workers accept 1–64. Invalid typed values stop startup without printing
secrets. Restart the service after changes; rebuilding assets is unnecessary.

## Settings

| Group | Variables | Configuration keys |
| --- | --- | --- |
| Network | `HTTP_PORT`, `HTTPS_PORT`, `DICEFILES_WORKERS` | `port`, `tlsport`, `workers` |
| Identity | `DICEFILES_NAME`, `DICEFILES_MOTTO`, `DICEFILES_PUBLIC_BASE_URL` | `name`, `motto`, `publicBaseUrl` |
| Credentials | `DICEFILES_SECRET`, `DICEFILES_STATUS_TOKEN` | `secret`, `statusPageToken` |
| Storage | `DICEFILES_UPLOADS`, `REDIS_URL` | `uploads`, `redis_url` |
| Flags | `DICEFILES_JAIL`, `DICEFILES_NATIVE_TOOLS`, `DICEFILES_PUBLIC_ROOMS`, `DICEFILES_LINK_COLLECTION`, `DICEFILES_STATUS_PRIVATE`, `DICEFILES_TORRENT_DISCOVERY` | `jail`, `nativeTools`, `publicRooms`, `linkCollection`, `statusPagePrivate`, `torrentDiscovery` |
| Providers | `DICEFILES_GIPHY_API_KEY`, `DICEFILES_OPENGRAPH_API_KEY` | `giphyApiKey`, `opengraphIoKey` |
| Automation | `DICEFILES_AUTOMATION_KEYS` | `automationApiKeys` (JSON array) |

`NODE_ENV=production` enables the production signing-secret check. Use a unique
random secret of at least 32 bytes. Keep it stable across workers and restarts.
Advanced nested settings (storage volumes, federation peers, plugins, credentials)
remain in `.config.json`; see `defaults.js` and the relevant operator guides.
Runtime UI changes to a setting overridden by env will revert on restart.

## Torrent discovery

`DICEFILES_TORRENT_DISCOVERY=true` (default) enables bounded public tracker,
DHT and peer metadata queries on torrent ingestion and details checks. This
reveals the server's IP and requested torrent hash to those services. No payload
is downloaded or seeded. Private `.torrent` files never use DHT. A bare magnet
cannot reveal its private flag before metadata is available. Disable the flag
where that outbound traffic is unsuitable. HTTP exact-source and cover discovery
remain guarded HTTP features. See [torrent metadata](./TORRENTS.md) for limits.

## Giphy

Set `DICEFILES_GIPHY_API_KEY` to an operator-owned Giphy API key and restart.
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
upstream `DICEFILES_API_KEY`. Do not expose a plain HTTP listener publicly.
