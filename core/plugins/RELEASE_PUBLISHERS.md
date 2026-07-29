# Discord and Telegram release publishers

Dicefiles ships two room-invited publisher bots:

- **Discord Release Publisher** (`discord-release`)
- **Telegram Release Publisher** (`telegram-release`)

Both publish a message when a file is uploaded directly to the room or appears
through a linked room. They do not require an extra Node package or a separate
bot process; Node's built-in `fetch` talks directly to the official HTTP APIs.

Both may also accept narrowly scoped community commands. Inbound operation is
off by default, provider-authenticated, restricted to explicit Discord or
Telegram caller IDs, and limited to commands selected by the room owner.

## Before you start

Set the public Dicefiles origin in `.config.json`:

```json
{
  "publicBaseUrl": "https://files.example.org"
}
```

The URL must be reachable by the people using Discord or Telegram. A
`localhost` URL is only useful for local testing. Each plugin can override this
with its own `baseUrl`.

## Discord

1. In Discord, open the destination channel settings.
2. Open **Integrations → Webhooks**, create a webhook, and copy its URL.
3. In Dicefiles, open the room and choose **Room Options → Plugins**.
4. Invite **Discord Release Publisher**.
5. Paste the webhook URL. Optionally set:
   - `baseUrl` when the server-wide public URL is not configured
   - `botName` and an HTTPS `avatarUrl`
   - `threadId` for a forum or existing thread
   - `ignoreBotUploads` to suppress releases added by other plugins
6. Save, then choose **Run now**. Discord should receive a connection test.

The webhook URL contains a secret token. Treat it like a password. For a
single global destination, set `DICEFILES_DISCORD_WEBHOOK_URL` in the service
environment and leave the room field blank.

### Optional Discord slash commands

1. In the Discord Developer Portal, create/select the application that owns
   the slash command and copy its 64-character **Public Key**.
2. Configure the `/dicefiles` command with subcommands `help`, `status`,
   `requests`, `request`, and/or `say`. `request` and `say` use a string option
   named `text`.
3. In the room plugin settings set:
   - `inboundEnabled`: true
   - `applicationPublicKey`: the Developer Portal public key
   - `inboundCommands`: a comma-separated subset of the commands above
   - `allowedInboundUserIds` and/or `allowedInboundRoleIds`: explicit numeric
     Discord snowflakes
4. Save the plugin, list it through Room Options or
   `GET /api/v1/rooms/:id/plugins`, and copy `inboundPath`.
5. Set the application's **Interactions Endpoint URL** to
   `https://files.example.org<inboundPath>`. Discord's validation PING is
   answered automatically.

Dicefiles verifies Discord's Ed25519 signature over the exact raw body and
timestamp, rejects stale requests, checks the caller allowlist, and deduplicates
interaction IDs. Responses are visible only to the caller unless
`discordEphemeralResponses` is explicitly false.

## Telegram

1. Message `@BotFather` in Telegram, create a bot, and copy its token.
2. Add the bot to the target group/channel and grant permission to post.
3. Find the target `chatId`. Channel and supergroup ids normally start with
   `-100`.
4. In Dicefiles, open **Room Options → Plugins** and invite
   **Telegram Release Publisher**.
5. Enter `botToken` and `chatId`. Optionally set:
   - `messageThreadId` for a forum topic
   - `baseUrl` when the server-wide public URL is not configured
   - `ignoreBotUploads` to suppress releases added by other plugins
6. Save, then choose **Run now**. Telegram should receive a connection test.

For a single global bot identity, set `DICEFILES_TELEGRAM_BOT_TOKEN` in the
service environment and leave the room token field blank.

### Optional Telegram commands

1. Generate a random webhook secret using only letters, numbers, `_`, and `-`
   (16–256 characters).
2. Set `inboundEnabled`, `inboundWebhookSecret`, a comma-separated
   `inboundCommands` subset, and `allowedInboundUserIds` containing the numeric
   Telegram IDs allowed to act.
3. Save the plugin and copy its `inboundPath`.
4. Register the HTTPS URL with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://files.example.org<INBOUND_PATH>" \
  -d "secret_token=<INBOUND_WEBHOOK_SECRET>"
```

Dicefiles requires Telegram's `X-Telegram-Bot-Api-Secret-Token`, the configured
chat ID, the configured forum topic when present, and an allowed user ID.
Updates are deduplicated by `update_id`. Supported forms include `/status`,
`/requests`, `/request text`, `/say text`, and `/dicefiles command text`.

## What gets published

Each notification contains:

- original filename
- file type and human-readable size
- room name (or linked source room)
- a direct file link
- a button/link back to Dicefiles

User-controlled filenames are sent with Discord mentions disabled and as plain
Telegram text. The bot tokens and webhook URLs are never included in logs or
error messages.

## Delivery behavior

Dicefiles runs several HTTP workers. A Redis-backed event lease ensures only
one worker publishes each `<plugin, room, event, file>` combination. Remote
delivery is attempted up to three times; a final failure releases the lease so
a later event replay can try again. Successful deliveries are remembered for
the configured `pluginSyncLogRetentionDays`.

Scheduled and manual bot runs also expose a bounded last-run record (success,
time, duration, delivered/uploaded/skipped counts, or a sanitized error)
through the room-plugin automation API. Provider tokens and webhook URLs are
redacted.

## Inbound command boundary

| Command | Allowed effect |
| --- | --- |
| `help` | Show this room's enabled commands |
| `status` | Aggregate file and open-request counts |
| `requests` | Up to eight open request titles |
| `request <text>` | Create a request as the publisher bot |
| `say <text>` | Post a bot-attributed room message naming the remote caller |

There is deliberately no arbitrary REST call, shell command, plugin install,
file deletion, moderation action, or code execution command. Keep `say`
disabled unless the remote community genuinely needs a chat bridge.

## Global configuration

The same plugins can be enabled globally in `.config.json`:

```json
{
  "plugins": [
    {
      "id": "discord-release",
      "enabled": true,
      "config": {
        "roomId": "ROOM_ID",
        "webhookUrl": "https://discord.com/api/webhooks/…",
        "baseUrl": "https://files.example.org"
      }
    },
    {
      "id": "telegram-release",
      "enabled": true,
      "config": {
        "roomId": "ROOM_ID",
        "botToken": "123456:REPLACE_ME",
        "chatId": "-100123456789",
        "baseUrl": "https://files.example.org"
      }
    }
  ]
}
```

Do not configure the same publisher for the same destination both globally and
as a room invitation. Inbound commands require a room invitation because the
room owns their command and caller allowlists.

## Troubleshooting

- **Run now says `baseUrl is required`:** set `publicBaseUrl` in
  `.config.json` or set the plugin's `baseUrl`.
- **Discord rejects the URL:** use an incoming webhook URL created by Discord,
  not a normal channel URL.
- **Telegram says chat not found:** add the bot to the chat/channel and verify
  the `chatId`.
- **Telegram cannot post:** grant the bot permission to send messages.
- **No release appears:** confirm the plugin is enabled in Room Options and
  check the stable server log for a sanitized remote HTTP status.
- **Provider rejects the inbound endpoint:** it must be public HTTPS; confirm
  the plugin is saved and `inboundEnabled` validation passes.
- **Command says unauthorized:** use provider numeric IDs, not display names,
  and ensure both the caller and command are explicitly allowlisted.
