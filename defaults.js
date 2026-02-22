"use strict";

const os = require("os");

const { HTTP_PORT: port = 8080 } = process.env;
const { HTTPS_PORT: tlsport = 8443 } = process.env;
const NUM_CPUS = os.cpus().length;

const LINUX = os.platform() === "linux";

// Do not edit here.
// Overwrite with a .config.json or config.js (module)

module.exports = {
  // Your site's name
  name: "Dicefiles",

  // Your site's motto
  motto: "Ephemereal Filesharing for Hobby Communities",

  // redis_* = options for redis

  /****************/
  /* Server stuff */
  /****************/

  // Listen port
  port,

  // how many web workers to run
  workers: Math.max(NUM_CPUS + 1, 2),

  // Session signing secret.
  // MUST be changed to a unique, high-entropy value (≥16 random chars) in production.
  // The default "dicefiles" value triggers a startup warning if not overridden.
  // Override in ~/.config/dicefiles.json or ./.config.json:
  //   { "secret": "your-long-random-secret-here" }
  secret: "dicefiles",

  // Path to upload directory
  uploads: "uploads",

  // Path to keep the moderation log
  modlog: "mod.log",

  // Optional bearer keys for automation API clients (agents/tools).
  // Keep empty to disable automation API routes.
  // Example:
  // automationApiKeys: [
  //   "legacy-full-access-key",
  //   { id: "readonly", key: "replace-read-key", scopes: ["files:read"] },
  //   {
  //     id: "uploader",
  //     key: "replace-upload-key",
  //     scopes: ["files:read", "rooms:write", "uploads:write", "requests:write"],
  //   },
  //   { id: "moderator", key: "replace-mod-key", scopes: ["mod:*"] },
  // ]
  automationApiKeys: [],

  // Default fixed-window API rate limiting for automation routes
  // (`/api/automation/*` and `/api/v1/*`).
  // Limits are Redis-backed across all workers; per-scope overrides below.
  automationApiRateLimit: {
    windowMs: 60000,
    max: 180,
  },

  // Optional per-scope rate-limit overrides for operator tuning.
  // Keys are scope names (for example: "files:read", "uploads:write", "mod:*")
  // and values are {windowMs, max}.
  // Example:
  // automationApiRateLimitByScope: {
  //   "uploads:write": { windowMs: 60000, max: 30 },
  //   "mod:*":         { windowMs: 60000, max: 60 },
  // }
  automationApiRateLimitByScope: {},

  // Path to append structured automation API audit logs (JSON lines).
  automationAuditLog: "automation.log",

  // Path to append structured lifecycle observability logs (JSON lines):
  // upload/create-delete, request/create-fulfill, download served, preview failures.
  observabilityLog: "ops.log",

  // Outbound webhook integrations.
  // Example:
  // webhooks: [{
  //   id: "ops-bot",
  //   url: "https://example.org/dicefiles-webhook",
  //   secret: "replace-with-long-random-secret",
  //   events: ["file_uploaded", "request_created", "request_fulfilled", "file_deleted"],
  //   retries: 3,
  //   timeoutMs: 7000,
  // }]
  webhooks: [],

  // Retry policy defaults for webhooks.
  webhookRetry: {
    retries: 3,
    baseDelayMs: 1500,
    maxDelayMs: 30000,
  },

  // JSON-lines dead-letter sink for permanently failed webhook deliveries.
  webhookDeadLetterLog: "webhook-dead-letter.log",

  // Allow X-Forwarded-For to set client IP if found
  considerProxyForwardedForHeaders: false,

  // Run tls server
  tls: false,
  tlsonly: false,
  // Path to the TLS key
  tlskey: "",
  // Path to the TLS cert
  tlscert: "",
  // Path to the tls port
  tlsport,

  /**********/
  /* Limits */
  /**********/

  // Default chat history size for this instance (kept in browser only)
  historySize: 500,

  // Require an account for chatting and uploads
  // implies roomCreationRequiresAccount if true
  requireAccounts: false,

  // Enable disable creating new rooms
  roomCreation: true,

  // Require registered accounts when creating rooms
  roomCreationRequiresAccount: false,

  // Number of hours a finished download takes to expire
  // Mods can override this per room
  TTL: 48,

  // Number of simultaneous client-side downloads for "Download New/All" (1-4)
  downloadMaxConcurrent: 3,

  // Maximal file size in bytes.
  // Set to 0 to disable.
  maxFileSize: 10 * 1024 * 1024 * 1024,

  /*****************/
  /* Flood control */
  /*****************/

  // Number of messages before considered flooding
  chatFloodTrigger: 5,
  // Number of ms to block messages from flooding user
  chatFloodDuration: 10000,

  // Number of reports before considered flooding
  reportFloodTrigger: 1,
  // Number of ms to block reports from flooding user
  reportFloodDuration: 120000,

  // Number of uploads before considered flooding
  uploadFloodTrigger: 60,
  // Number of ms to block uploads from flooding user
  uploadFloodDuration: 60000,

  // Number of login attempts before considered flooding
  loginFloodTrigger: 5,
  // Number of ms to block login attempts from flooding user
  loginFloodDuration: 900000,

  // Number of failed login attempts per account before per-account lockout
  loginAccountFloodTrigger: 10,
  // Number of ms to keep the per-account lockout active
  loginAccountFloodDuration: 900000,

  // Number of created account before considered flooding
  accountFloodTrigger: 3,
  // Number of ms to block login attempts from flooding user
  accountFloodDuration: 21600000,

  // Number of created rooms before considered flooding
  roomFloodTrigger: 10,
  // Number of ms to block new rooms from flooding user
  roomFloodDuration: 60 * 60 * 1000,

  /************/
  /* Previews */
  /************/

  // Use firejail when calling potential dangerous external commands,
  // see jail.profile
  jail: LINUX,

  // For meta data and asset generation, path to ffmpeg exiftool
  exiftool: "exiftool",

  // For asset generation, path to ffmpeg binary
  ffmpeg: "ffmpeg",

  // For further checking the file type, if exiftool fails
  filetool: "file",

  // Max number of concurrent asset generators
  maxAssetsProcesses: 2,

  // Max number of concurrent metadata extractor processes
  maxMetaProcesses: 5,

  /***************/
  /* Fine tuning */
  /***************/

  // Number of hours an interrupted pending donwload may be resumed before
  // garbage collected
  pendingTTL: 12,

  // Session TTL for logged in users, in seconds
  sessionTTL: 2592000,

  // For testing mostly, delay serving of assets and downloads
  delayServe: 0,
  // For testing mostly, always create a new storage
  // (leaking old ones, potentially)
  forceNewStorage: false,

  /***********************/
  /* Per-room Capability */
  /***********************/

  // Whether new rooms allow request creation.
  // Room owners can override this per room via Room Options.
  allowRequests: true,

  // Whether new rooms enable the link-collection archive (URLs shared in chat).
  // Room owners can override this per room via Room Options.
  linkCollection: true,

  /*****************************/
  /* Optional External Services */
  /*****************************/

  // opengraph.io API key for enriched link title + OG metadata resolution.
  // When set, link titles are fetched via the opengraph.io API (better accuracy
  // than raw HTML scraping). Falls back to HTML <title> scraping when unset or
  // when the API call fails. Get a key at https://www.opengraph.io/
  opengraphIoKey: "",

  // Enable seasonal/event achievements. When false (default) seasonal
  // achievements are not computed or displayed. Set true to activate.
  seasonalAchievements: false,
};
