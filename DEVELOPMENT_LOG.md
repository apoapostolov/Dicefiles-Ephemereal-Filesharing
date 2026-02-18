# Dicefiles Development Log

## 2026-02-18 - Changelog Release Consolidation (1.0.0)

- Folded all previously pending `Unreleased` feature notes into the current `1.0.0` changelog entry.
- Simplified release notes to user-facing capabilities plus a concise API/integrations section.
- Removed incremental unreleased deltas so changelog reflects a single coherent baseline release view.

## 2026-02-18 - API.md Full Sync Pass

- Reworked `API.md` into a complete, code-aligned API spec for current Dicefiles behavior.
- Documented stable `/api/v1` namespace and `/api/automation` compatibility alias.
- Added full scope model details, key configuration patterns, and scope matching rules.
- Added complete endpoint matrix and per-endpoint examples (auth, rooms, requests, uploads, files, downloads, delete).
- Added automation rate-limit/audit headers and status behavior.
- Added `GET /healthz` contract with dependency checks and metrics payload.
- Expanded webhook section with signing details, event semantics, retries, and dead-letter behavior.
- Added agent workflow recipes and explicit skill-builder mapping for automation tooling.

## 2026-02-18 - TODO 13: Observability and Ops Baseline

- Added new shared observability module (`lib/observability.js`) for lifecycle logs, counters, and health checks.
- Added structured JSONL lifecycle logging for:
  - upload created / deleted
  - request created / fulfilled
  - download served
  - preview generation failures
- Added in-memory metrics counters:
  - `uploadsCreated`, `uploadsDeleted`
  - `downloadsServed`, `downloadsBytes`
  - `requestsCreated`, `requestsFulfilled`
  - `previewFailures`
- Added lightweight `GET /healthz` endpoint with:
  - Redis ping + latency check
  - upload storage writeability probe + latency
  - current metrics snapshot
- Added new default config key:
  - `observabilityLog` (default `ops.log`)
- Updated roadmap/docs to mark TODO-13 completed and document health/observability settings.

## 2026-02-18 - TODO 8/9: Automation API Hardening + Webhooks

- Added a stable versioned automation API namespace: `/api/v1/*` with compatibility alias `/api/automation/*`.
- Added scoped automation API key support:
  - legacy string keys still map to full access
  - object keys support scoped permissions (`files:read`, `uploads:write`, `requests:write`, `files:delete`, etc.)
- Added per-scope fixed-window rate limiting for automation routes with standard response headers and `429` handling.
- Added structured automation audit logging (JSON lines) to configurable `automationAuditLog`.
- Implemented outbound webhook dispatcher with event coverage:
  - `file_uploaded`
  - `request_created`
  - `request_fulfilled` (on non-expiry request removal)
  - `file_deleted`
- Added signed webhook delivery (`X-Dicefiles-Signature`, HMAC-SHA256), retry/backoff policy, and dead-letter JSONL logging.
- Updated API and README documentation to reflect new config and integration flow for agentic tooling.
- Marked roadmap TODO items 8 and 9 as done in `TODO.md`.

## 2026-02-18 - Unreleased squashed into 1.0.0

- Squashed player/API-facing Unreleased items into `CHANGELOG.md` under `1.0.0` (emoji picker, GIF search/post flow, batch-download features, file view-mode persistence, preview quality, file metadata and CSP/API fixes).
- Dropped non-essential visual polish and micro-alignment changes per request.

## 2026-02-18 - Restart script & runbook update

- Added `scripts/restart-server.sh` (canonical restart helper; builds with explicit Node 18 and starts the server in foreground — run inside a persistent PTY).
- Added `npm run restart` (runs `scripts/restart-server.sh`).
- Updated `AGENTS.md` to recommend `tail -F server.log` as an additional verification step when running the server in background.

## 2026-02-18 - First-Switch Gallery-to-Table Width Leak Hardening

- Prevented fixed file-row style capture while gallery mode is active.
- Added a list-mode row normalization pass (`normalizeListRows`) that runs immediately and again on the next frame when switching from gallery to table mode.
- Normalization now explicitly resets row width/flex and clears stale min/height inline properties before table rendering settles.

## 2026-02-18 - Batch Download Controls Right Alignment

- Right-aligned both numeric controls on the Download All/New options row.
- `Retries` and `Concurrent` controls now anchor to the right edge of the row for cleaner visual grouping.

## 2026-02-18 - Batch Download Options: Concurrent Control

- Added `Concurrent` setting to Download All/New modal options, on the same row as `Retries`.
- Default concurrent downloads is now `4`.
- Concurrent value is persisted with download preferences and queued-batch restore state.
- Batch runner now uses per-batch configured concurrency (clamped `1..4`) instead of fixed script default only.
- Polished modal row layout with compact labels: `Retries` and `Concurrent`, centered as a controls group.

## 2026-02-18 - Table-Mode Width Leak Hard Fix

- Added explicit per-row inline layout reset when switching to table mode:
  - `width: 100%`
  - `max-width: 100%`
  - `flex: 0 0 auto`
- Added corresponding inline cleanup when switching back to gallery mode.
- This removes any residual gallery tile sizing even if class toggling timing races on first reload/switch.

## 2026-02-18 - Table View Hover Tooltip Recovery

- Restored reliable file hover behavior in table mode by binding tooltip activation to the full file row (`.file`) in addition to filename anchor hover.
- This prevents tooltip loss caused by layout/targeting changes where hovering non-name row regions no longer triggered tooltip display.

## 2026-02-18 - Pages Pill Wording Update

- Replaced abbreviated pages suffix with natural English singular/plural wording:
  - `1 page`
  - `N pages`

## 2026-02-18 - Pages Pill Suffix + List-Mode Width Guard

- Added `pg.` suffix to the pages metadata pill text in file list (`e.g. 312 pg.`) for immediate clarity without hover.
- Added explicit list/table-mode layout guards in `entries/css/files.css`:
  - `#files.listmode` is forced to block layout
  - list-mode file rows are forced to `width: 100%`
- Purpose: prevent gallery tile width leakage during first switch from restored gallery mode back to table mode.

## 2026-02-18 - CSP Allowlist Update for Tenor Legacy Endpoint

- Added `https://g.tenor.com` to `connect-src` in `lib/httpserver.js`.
- Required for Tenor legacy fallback search requests to pass browser CSP checks.

## 2026-02-18 - Gallery-to-Table First-Switch Regression Fix

- Replaced mode-button toggle behavior with explicit mode setters:
  - `nailOff` now always applies table/list mode
  - `nailOn` now always applies gallery mode
- This prevents post-restore state desync where first switch could leave gallery sizing rules visually stuck in table mode.

## 2026-02-18 - Tenor Search Compatibility Fallback

- Fixed Tenor search returning no results with legacy/public keys that fail Tenor v2 validation.
- `searchTenor()` now auto-falls back to Tenor legacy endpoint (`g.tenor.com/v1/search`) when v2 returns key-validation errors or unparseable/empty results.
- Added robust parsing for both v2 (`media_formats`) and v1 (`media[]`) response shapes.

## 2026-02-18 - View Mode Persistence Hardening

- Normalized room-id key derivation for view-mode storage (trailing slash-safe) to avoid room-key mismatches.
- Added global fallback key for view mode, so last-used mode can still restore if room-specific key is missing.
- Added a second restore attempt on first `files` sync to ensure mode is applied immediately on reload.

## 2026-02-18 - Persist File View Mode Per Room

- Added per-room persistence for file list view mode (`list` vs `gallery`) in browser localStorage.
- Refreshing or reopening the same room now restores the last used mode automatically.
- Refactored mode switching through a shared `applyViewMode()` path for consistent class/button/state updates.

## 2026-02-18 - GIF Auto-Scroll Load-Timing Fix

- Added secondary scroll-to-bottom hooks on chat media load events (`img load/error`, `video loadeddata/canplay`) for posted GIF/media messages.
- This addresses cases where initial auto-scroll fired before media dimensions were finalized, leaving chat above the latest message.

## 2026-02-18 - GIF Auto-Scroll Reliability Fix

- Reworked GIF auto-scroll trigger to detect rendered media blocks (`.chatgif-wrap`) instead of relying on message flags.
- This ensures chat reliably scrolls to bottom after GIF/media posts even when upstream message metadata varies.

## 2026-02-18 - Auto-Scroll on Posted GIF

- Added sender-side auto-scroll for GIF/media chat posts.
- When a message is authored by the current user and includes an embeddable media URL, chat now scrolls to bottom after flush/render.
- Keeps GIF posting flow visible without manual scrolling.

## 2026-02-18 - Gallery Overlay Click-to-Download

- In gallery mode, clicking on white overlay rows now downloads the file.
- Applied to both filename overlay (`.name`) and bottom metadata overlay (`.detail`) for non-request files.
- Preserved special overlay actions:
  - metadata copy button keeps copy behavior
  - request URL icon keeps link-open behavior

## 2026-02-18 - Centered Chat GIF Alignment

- Updated chat media wrapper styling so posted GIF/video embeds are centered in chat messages.
- Applied via `entries/css/room.css` by switching `.chatgif-wrap` to a centered flex container.

## 2026-02-18 - Gallery NEW Pill Visibility Fix

- Fixed gallery mode regression where `NEW!` badge appeared on every file.
- Scoped gallery `NEW!` badge display to `.file.is-new` only, matching table-mode behavior.

## 2026-02-18 - Gallery TTL/Size Alignment Correction

- Restored gallery file-size placement to right alignment at the end of the metadata row.
- Converted TTL segment into a centered middle flex region (`flex: 1`) so clock + TTL value stay centered.
- Result: left = type pill, center = TTL, right = file size.

## 2026-02-18 - Gallery Name Row Bottom Alignment + Type Pill Reset Fix

- Bottom-aligned filename row content (`name-text` + `NEW!` badge) in gallery mode for cleaner overlay anchoring.
- Scoped the generic gallery detail `span` reset so it excludes `.type-pill`, preventing the type pill's horizontal padding from being stripped.
- Result: file type label remains properly centered inside the pill while other detail spans keep compact spacing.

## 2026-02-18 - 2x Thumbnail Resolution Upgrade

- Doubled generated preview dimensions in `lib/meta.js` for image/PDF thumbnail assets.
- Upgraded video preview transcode scale from width `200` to `400` for sharper gallery playback previews.
- Upgraded embedded audio cover extraction from `200x200` to `400x400`.
- Result: significantly cleaner previews in gallery mode, especially on larger and high-DPI displays.

## 2026-02-18 - Gallery Bottom Overlay + TTL Alignment Polish

- Unified the two bottom gallery overlays to the same (more opaque) transparency level for consistent appearance.
- Fixed gallery file-type pill label centering by switching the pill to explicit flex centering.
- Repositioned gallery TTL to center between type and size, and tuned TTL icon/value to dark grey for better balance on the light overlay.

## 2026-02-18 - Agent Runbook Lessons Captured

- Expanded `AGENTS.md` with a dedicated "Failure Modes We Hit" section so repeated operational mistakes are prevented.
- Documented concrete pitfalls:
  - wrong default Node major in shell
  - conflicting server processes from other runtimes/paths
  - unreliable detached `nohup` starts in this environment
  - mandatory dual health verification (`curl` + `ss`)
  - process ownership/path checks before kill/restart
- Updated `TODO.md` labels to explicitly mark items 6 and 7 as done.

## 2026-02-18 - Server Runbook Hardening

- Added strict startup instructions to `AGENTS.md`:
  - always use explicit Node 18 binary path
  - mandatory build/start/health-check sequence
  - explicit forbidden patterns (`bun`, wrong node path, wrong project path)
- Purpose: prevent recurring "server down" incidents caused by inconsistent runtime/start methods.

## 2026-02-18 - GIF Chat Cleanup

- Updated chat link rendering so GIF/video messages no longer show the raw URL above the media.
- For embeddable GIF/media links, chat now renders only the media block for cleaner conversation flow.
- Non-embeddable links continue to render as clickable text links.

## 2026-02-18 - GIF Panel Width + Density Tweak

- Widened the GIF search panel from `26rem` to `32rem`.
- Increased GIF result grid density from 4 to 5 columns so one more item appears per row.

## 2026-02-18 - GIF Send Reliability Fix

- Normalized selected GIF URLs before sending to chat (strip query/hash, keep direct media URL).
- Added Giphy media-id canonicalization to `https://i.giphy.com/media/<id>/giphy.gif` for shorter and more stable chat links.
- This fixes cases where GIF search results appeared but clicking a result did not reliably post/render in chat due overly long or noisy provider URLs.

## 2026-02-18 - Chat Emoji + GIF Injection

- Added a native in-chat emoji picker button next to the message textarea for quick emoji insertion at cursor position.
- Added `/gif <url>` chat command for quickly posting GIF/media URLs.
- Added inline GIF/media embedding in chat messages for:
  - direct `.gif`, `.mp4`, `.webm` links
  - Giphy page/media links (auto-converted to embeddable GIF source)
  - Tenor direct media hosts (`media.tenor.com`, `c.tenor.com`)
- Styled embedded chat GIFs/videos with bounded dimensions and greytone-compatible framing.

## 2026-02-18 - Cover Mode Polish

- Reworked cover/gallery tiles so media dominates each item and fills the full frame with top-aligned cover presentation.
- Added soft translucent white gradient overlays for the title layer and bottom metadata layer to improve readability on bright/dark covers.
- Consolidated gallery bottom metadata into a single line with file type pill, file size, TTL, uploader tag, and metadata copy action.

## 2026-02-18 - Emoji Control Placement Update

- Relocated emoji picker trigger from the chat input area to the status/account row above chat, left-aligned as requested.
- Kept emoji insertion flow unchanged (inserts at cursor in chat textarea), while keeping the picker popover anchored to the new status-bar button.

## 2026-02-18 - Gallery Metadata Contrast Pass

- Increased gradient strength behind gallery title and bottom metadata for better readability on bright covers.
- Updated gallery title color to dark grey for higher contrast with the light overlay.
- Switched gallery type pill text from generic item type to file extension (e.g., `PDF`, `EPUB`, `PNG`) and styled it as a dark pill with light text.
- Restored uploader pill to dark-green background with white text for consistent visibility.
- Centered file size visually between the left-aligned type pill and right-aligned uploader pill.

## 2026-02-18 - Batch Download Auto-Resume Regression Fix

- Fixed a regression where the Download All/New modal could appear automatically on room open.
- Queue state is now persisted only after the user explicitly presses `Start`.
- Queue restore now resumes only previously started batches; stale pre-start entries are cleared.
- Cancelling before `Start` now guarantees queue cleanup and prevents auto-resume on next room load.

## 2026-02-18 - Searchable Full Emoji Picker

- Expanded emoji picker from a small static set to a broad Unicode emoji set generated from emoji codepoint ranges.
- Added in-picker search bar for filtering emojis by query.
- Search field now auto-focuses whenever the emoji panel opens.
- Kept insertion behavior unchanged (emoji inserted at cursor in chat textarea).

## 2026-02-18 - Gallery Overlay and Pill Alignment Pass

- Reworked gallery text overlays from soft gradients to mostly solid translucent light overlays with only the top 20% faded.
- Tuned gallery text for light-background readability.
- Restyled extension/type pill to a centered grey theme.
- Kept uploader pill right-aligned with centered pill content and improved contrast.
- Increased gallery file size text by +2px and preserved center positioning between type and uploader.

## 2026-02-18 - Emoji Set Curation and Descriptor Search

- Replaced the very large generated emoji list with a smaller curated set tailored to typical forum/Discord communication.
- Changed emoji search behavior to match human-readable descriptors/aliases (e.g. `laugh`, `party`, `thumbs up`, `heart`) instead of codepoint-based labels.
- Preserved autofocus and insertion behavior of the emoji panel.

## 2026-02-18 - Gallery Name + Metadata Vertical Alignment

- Switched gallery filename row to flex alignment so filename text and `NEW!` badge align vertically on one row.
- Constrained gallery filename text width to preserve space for `NEW!`, mirroring table-mode behavior.
- Normalized gallery filename tone to dark grey for both regular and new files.
- Tightened vertical alignment of gallery metadata row elements (`type`, centered `size`, right-side `uploader`).

## 2026-02-18 - Core Editable Emoji Catalog

- Moved emoji picker content into project core config file: `core/emoji-list.json`.
- Chat picker now reads the emoji catalog from this file at build/runtime bundle load.
- Added validation/normalization so invalid entries are ignored safely.
- Added fallback default emoji entry to avoid picker breakage if config is empty/invalid.

## 2026-02-18 - Gallery Overlay + Pill Contrast Tweaks

- Changed gallery second/bottom metadata overlay to solid translucent light background (removed fade in this row).
- Updated extension/type pill sizing to content-based width for short labels like `PDF`/`EPUB`.
- Reversed gallery `NEW!` pill contrast for light overlays: darker green fill with white text.

## 2026-02-18 - Gallery Metadata Simplification

- Darkened gallery type pill styling to grey background with white text for stronger contrast.
- Increased `NEW!` badge contrast in gallery mode (darker green with white text).
- Removed uploader pill from gallery metadata row.
- Moved file size to right-aligned position to replace uploader slot.

## 2026-02-18 - Gallery Overlay Edge + Pill Tone

- Fixed slight overlap between upper title overlay and lower metadata overlay by aligning their row boundary.
- Adjusted extension/type pill from dark grey to an above-mid grey tone.
- Enforced centered short extension labels inside the type pill (e.g. `PDF`, `EPUB`).

## 2026-02-18 - Gallery Pill Centering + Width Pass

- Removed remaining 1–2px overlay seam by forcing matching fixed heights for title and metadata rows.
- Increased extension pill minimum width slightly (+4px) while keeping pill left-aligned in row.
- Enforced true vertical centering for gallery pill text (`type`, `NEW!`, and any remaining tags).

## 2026-02-18 - Live GIF Search Overlay (Giphy/Tenor)

- Added segmented GIF controls (Giphy/Tenor) beside emoji controls in the status bar.
- Buttons use provider favicons and open a GIF search overlay with centered search input.
- Implemented real-time query updates with debounced live search and animated preview tiles.
- Selecting a GIF inserts its direct URL into chat input at cursor position.
- Added editable provider configuration in `core/gif-providers.json` for API keys and search options.
- Implemented in-overlay status feedback for missing/invalid API key or empty result sets.
- Removed old `/gif` command path so GIF insertion flow is now overlay-driven.

## 2026-02-18 - Gallery Extension Pill Centering Fix

- Corrected extension pill text alignment in gallery mode (`PDF`/`EPUB` labels).
- Switched pill internals to strict center-placement layout and removed selector override that was re-left-biasing content.

## 2026-02-18 - GIF API Key Local Secret Config

- Reworked GIF provider key handling to use a local git-ignored file (`.gif-providers.local.json`) for secrets.
- Kept `core/gif-providers.json` in-repo with non-secret defaults only.
- Added build-time merge in `webpack.config.js` so local keys override defaults without committing secrets.
- Documented setup steps in `README.md`.

## 2026-02-18 - Giphy Rating Default to Mature

- Changed default `giphy.rating` to `r` (mature) in `core/gif-providers.json`.
- Added inline note in config listing supported rating values (`g`, `pg`, `pg-13`, `r`).
- Updated README GIF-provider section with the same rating-option guidance.

## 2026-02-18 - GIF Control Init Regression Fix

- Fixed `DOMTokenList.add` crash caused by an empty CSS class token during GIF provider button creation.
- Updated GIF button class composition to avoid empty class values.
- Hardened `dom()` helper class handling to ignore empty/invalid class tokens globally.
- This unblocks normal room initialization and prevents downstream file-list/scroller errors triggered by aborted chatbox init.

## 2026-02-18 - GIF API CSP Allowlist

- Updated server CSP header to include `connect-src` allowlist entries for GIF provider APIs.
- Added `https://api.giphy.com` and `https://tenor.googleapis.com` so live GIF search requests are allowed by browser CSP.

## 2026-02-18 - Status Control Ordering (Emoji/GIF)

- Reordered status bar controls so emoji button appears before GIF segmented controls.
- Provider segment order remains `Giphy` first, `Tenor` second.

## 2026-02-18 - GIF Search Debounce Tuning

- Increased GIF search debounce from `180ms` to `800ms` after last keystroke.
- Reduces aggressive request bursts while typing and makes live search behavior calmer.

## 2026-02-18 - GIF Result Send Flow

- Changed GIF picker result click action from “insert URL in textarea” to immediate chat send.
- Keeps overlay workflow but matches expected behavior of directly adding GIF content into chat stream.

## Project Overview

Dicefiles is a self-hosted, open-source file sharing platform originally forked from dicefiles and rebranded for hobby communities. It provides real-time chat rooms with ephemeral file sharing capabilities, designed for sharing roleplaying books, digital maps, board games, STL models, fiction, and other hobby resources.

## Development Timeline

### Phase 1: Initial Setup and Forking (Feb 17, 2026)

#### GitHub Forking

- Forked `https://github.com/dicefiles/dicefiles` to `https://github.com/apoapostolov/dicefiles`
- Cloned to local workspace: `/home/apoapostolov/git-public/dicefiles`
- Repository structure preserved with all original files

#### Redis Installation

- Installed Redis server on Ubuntu system
- Verified Redis is running on default port (6379)
- Confirmed Redis CLI connectivity with `redis-cli ping`

#### Node.js Environment Setup

- Discovered Node.js v24.13.1 incompatible with project dependencies
- Installed Node Version Manager (nvm)
- Installed Node.js v18.20.8 (LTS) for compatibility
- Updated yarn package manager
- Verified GCC compiler availability for native modules

#### Dependency Installation

- Resolved blake2 native module compilation issues with Node 18
- Successfully installed all dependencies: `yarn install`
- Built client-side assets: `yarn prestart`
- Configured server port to 9090 in `.config.json`

### Phase 2: Complete Project Rebranding (Feb 17, 2026)

#### Core Identity Changes

- **Package Name**: Updated `package.json` name from "dicefiles" to "dicefiles"
- **Description**: Changed to "Ephemereal Filesharing for Hobby Communities"
- **Site Name**: Updated `defaults.js` name from "dicefiles" to "Dicefiles"
- **Tagline**: Changed motto to "Ephemereal Filesharing for Hobby Communities"

#### Configuration Updates

- Modified `lib/config.js` to use "dicefiles.json" and "dicefiles" config paths
- Updated HMAC secret in `webpack.config.js` from "dicefiles" to "dicefiles"
- Changed jail profile name from "dicefiles-jail" to "dicefiles-jail"
- Updated internal worker ID from "DICEFILES_EXPIRATION_WORKER" to "DICEFILES_EXPIRATION_WORKER"
- Modified gitignore archive pattern to "dicefiles-v\*.tgz"

#### User Agent and Headers

- Updated User-Agent string in `lib/user.js` from "dicefiles/1.0 like irc" to "dicefiles/1.0 like irc"

#### Service Templates

- Renamed `contrib/dicefiles.service` to `contrib/dicefiles.service`
- Updated systemd service description, paths, and identifiers
- Modified working directory and executable paths for Dicefiles

#### Documentation Rebranding

- Updated `CONTRIBUTING.md` title from "dicefiles" to "Dicefiles"
- Modified `docs/message-removal.md` references
- Updated legacy `Readme.md` with pointer to new README.md

#### Footer Links

- Updated GitHub link to point to fork: `https://github.com/apoapostolov/dicefiles`
- Changed Twitter link to X: `https://x.com/apoapostolov`

### Phase 3: Homepage and User Experience Improvements (Feb 17, 2026)

#### Landing Page Redesign

- Completely rewrote `views/index.ejs` with welcoming content
- Added clear purpose statement: "A self-hosted file sharing platform designed for hobby communities"
- Included Quick Start guide with bullet points
- Added Room Management instructions
- Listed key features (file previews, accounts, moderation, ephemerality)
- Included help section with links to documentation

#### Server-Side Route Enhancements

- Enhanced `/terms` and `/rules` page titles in `lib/httpserver.js`
- Added proper pagename context for "Terms of Service and Privacy Policy" and "The Rules"
- Verified all footer links work correctly

### Phase 4: Documentation Creation (Feb 17, 2026)

#### INTRODUCTION.md

- Created comprehensive platform guide (5361 bytes)
- Documented project purpose and philosophy
- Listed use cases for different hobby communities (RPG, board games, makers, fiction)
- Added getting started guides for users and hosts
- Included configuration options reference
- Explained ephemereal nature and security features

#### CHANGELOG.md

- Created detailed v1.0.0 release notes (6293 bytes)
- Documented all core features and capabilities
- Listed platform features (file sharing, chat, moderation, etc.)
- Added performance, security, and compatibility notes
- Included roadmap for future versions

#### README.md Updates

- Updated title to "Dicefiles - Ephemereal Filesharing for Hobby Communities"
- Added documentation section linking to INTRODUCTION.md and CHANGELOG.md
- Updated Windows 11 setup instructions
- Added Node.js version compatibility warnings
- Updated all clone URLs to point to fork repository

### Phase 5: GitHub Repository Configuration (Feb 17, 2026)

#### Repository Metadata Updates

- Updated repository description via GitHub CLI
- Set homepage URL to http://127.0.0.1:9090
- Description: "Dicefiles - Ephemereal filesharing platform for hobby communities. Share RPG books, maps, board games, STL models, fiction, and more."

### Phase 6: Testing and Verification (Feb 17, 2026)

#### Server Testing

- Verified server starts successfully on port 9090
- Confirmed homepage loads with new Dicefiles branding
- Tested `/terms` and `/rules` endpoints return correct content with proper titles
- Validated footer links work in both homepage and room contexts

#### Build Verification

- Confirmed client-side webpack build completes successfully
- Verified all EJS templates render correctly
- Checked configuration loading and application of Dicefiles branding

#### Git Operations

- Committed all changes with descriptive commit messages
- Pushed updates to fork repository
- Maintained clean git history with logical commits

## Current State (Feb 17, 2026)

### Active Services

- **Dicefiles Server**: Running on http://127.0.0.1:9090
- **Redis**: Running on localhost:6379
- **Node.js**: v18.20.8 (via nvm)

### File Structure

```
dicefiles/
├── client/          # Frontend code
├── common/          # Shared utilities
├── contrib/         # Service templates
├── docs/            # Documentation
├── entries/         # Webpack entry points
├── lib/             # Server-side code
├── static/          # Built assets
├── uploads/         # File storage (configurable)
├── views/           # EJS templates
├── CHANGELOG.md     # Release history
├── INTRODUCTION.md  # Platform guide
├── README.md        # Setup instructions
├── package.json     # Dependencies and metadata
├── defaults.js      # Default configuration
├── server.js        # Main application entry point
├── webpack.config.js # Build configuration
└── .config.json     # Local configuration
```

### Key Features Implemented

- ✅ Real-time chat rooms with WebSocket support
- ✅ File upload and sharing with configurable limits
- ✅ File previews (images, videos, audio, PDFs)
- ✅ User accounts and session management
- ✅ Room ownership and moderation
- ✅ Ephemeral file storage (TTL-based expiration)
- ✅ Responsive web interface
- ✅ Multi-platform deployment (Linux, Windows, macOS)
- ✅ Comprehensive documentation
- ✅ Hobby-focused branding and user experience

### Configuration Options

```json
{
  "name": "Dicefiles",
  "motto": "Ephemereal Filesharing for Hobby Communities",
  "port": 9090,
  "maxFileSize": 10737418240,
  "TTL": 48,
  "requireAccounts": false,
  "roomCreation": true,
  "jail": false
}
```

### Development Notes

- Node.js 18 LTS required (20+ not supported due to native module compatibility)
- Redis required for session and room state management
- Webpack builds client assets for production deployment
- Service can be run via systemd or Windows NSSM
- All user-facing text rebranded to Dicefiles theme

## Next Steps for Future Development

### Immediate Priorities

1. **User Testing**: Have hobby community members test the platform
2. **Performance Tuning**: Monitor memory usage and optimize file handling
3. **Security Audit**: Review authentication and file upload security
4. **Mobile Optimization**: Test and improve mobile interface

### Potential Enhancements

1. **Advanced Moderation**: Custom room rules, ban appeals, moderation queues
2. **File Categories**: Tagging, search, and organization features
3. **User Profiles**: Avatars, bios, favorite rooms
4. **API Endpoints**: REST API for integrations
5. **Backup System**: Automated Redis and file backups
6. **Analytics**: Usage statistics and room activity metrics
7. **Themes**: Custom CSS themes for different communities
8. **Notifications**: Email/webhook notifications for new files

### Deployment Considerations

- **Production Redis**: Configure Redis persistence and replication
- **File Storage**: Consider external storage (S3, NFS) for larger deployments
- **Load Balancing**: Multiple server instances behind reverse proxy
- **SSL/TLS**: Certificate management and HTTPS enforcement
- **Monitoring**: Logging, metrics, and alerting setup

This development log provides a complete overview of the Dicefiles project transformation from dicefiles. The platform is now ready for hobby community use with a clean, welcoming interface and comprehensive documentation.

## 2026-02-18 - Welcome Room Naming Prompt Visibility Fix

- Fixed welcome intro "Name this room" prompt visibility logic.
- Root cause: client checked `chatbox.role === "owner"`, but owner is delivered via separate `owner` socket event/body class.
- Updated condition to allow rename when user is moderator or body has `owner` class.
- Added listener for `owner` socket updates so visibility refreshes immediately after state changes.
- Behavior now: prompt appears only for default random-named rooms and hides after first custom room naming.

## 2026-02-18 - Welcome Name Control Style Alignment

- Restyled welcome intro "Name this room" field/button to match the visual language of the URL/copy row.
- Applied same bordered translucent container treatment and lighter inline action style.
- Kept functionality unchanged (visibility and submit behavior remain the same).

## 2026-02-18 - Welcome Name Control Icon + Size Match

- Updated welcome room-name action from text button to icon-only submit (same interaction style as copy-link action).
- Increased name-row sizing to align with URL row typography and visual weight.
- Kept behavior unchanged; this is a presentation-only polish pass.

## 2026-02-18 - Welcome Name Field Placement + Width Match

- Moved conditional room-naming control above the intro sentence block.
- Added "Name this room" label above the naming input as requested.
- Matched naming row width to share-URL row width using the same responsive width rule.

## 2026-02-18 - Refresh Login Persistence Fix (HTTP/LAN)

- Fixed cookie parsing for `verifier` in `client/socket.js` (proper cookie parser instead of query-string parsing).
- Added websocket auth fallback for environments where WebCrypto (`crypto.subtle`) is unavailable on insecure origins.
  - Client now sends `v=<verifier>` when signed `s/n` verifier cannot be produced.
  - Server now accepts either signed verifier (`s/n`) or plain verifier match (`v`) against expected value.
- Goal: keep user authenticated after `F5` / `Ctrl+F5` refresh on LAN HTTP room URLs.

## 2026-02-18 - Welcome Rename Input Spacing

- Added `margin-bottom: 2px` to `.welcome_nameinput` in `entries/css/room.css` to improve vertical spacing/alignment inside the room rename panel.

## 2026-02-18 - Rename Button Hover Cleanup

- Removed inherited white hover/focus visuals from `.welcome_namebtn` by overriding global button hover styles in `entries/css/room.css`.
- Rename button now keeps transparent background and no hover border/ring while preserving icon color feedback.

## 2026-02-18 - TODO-5 Native Browser Notifications

- Implemented room-scoped native notifications for new files and new requests.
- Added explicit opt-in workflow (no permission prompt on page load).
- Added per-room settings dialog in hamburger menu: `Enable desktop notifications`, `Notify for new files`, `Notify for new requests`, `Mute this room`.
- Added persistent de-duplication for notification keys across reconnect/reload to avoid re-notifying old items.
- Added notification click behavior: focuses the tab/window and highlights the related file/request row in the file list.
- Added light visual highlight style for notification-targeted file rows.

## 2026-02-18 - Notifications Modal UX Polish

- Reworked Notifications modal layout so each option is displayed on its own dedicated row.
- Added clearer visual hierarchy: option title + helper text, aligned toggle control, and consistent row spacing.
- Improved panel styling with subtle borders/background cards and a clearer permission status area.

## 2026-02-18 - Notifications Modal Row Layout Fix

- Enforced strict vertical row layout for notification options.
- Each setting now renders as exactly one row (label left, checkbox right) to prevent inline wrapping into a single line.
- Kept the gear icon in a left column and settings panel on the right.

## 2026-02-18 - Notifications Modal Icon Removal

- Removed the gear icon from the Notifications modal content area.
- Kept only the settings rows and permission status text in the dialog body.

## 2026-02-18 - Notifications Modal Width Tightening

- Reduced Notifications modal width to fit content (`width: fit-content`) with a sensible max width cap.
- Removed fixed minimum width in the modal body so the dialog no longer stretches wider than needed.

## 2026-02-18 - Modal Polish (Room Options / Room Owners)

- Applied surgical visual polish to Room Options and Room Owners/Invitees dialogs.
- Improved field readability with subtle borders/radius and better spacing.
- Refined action chips (Manage Owners/Invited Users) with gentler rounded styling.
- Enhanced owners list readability with bordered list container, row striping, and cleaner remove button style.

## 2026-02-18 - Room Options Row Compaction

- Renamed `Invite-Only Room` label to `Invite-Only` in Room Options.
- Moved `Invite-Only` and `Adult Content` checkboxes into the same primary row as `Manage Owners`/`Manage Invited Users` to reduce dialog height.
- Added minimal Room Options row styling for consistent alignment and spacing.

## 2026-02-18 - Room Options Button Vertical Trim

- Tightened `Manage Owners` row button metrics in Room Options to remove perceived extra bottom whitespace.
- Applied only to `.roomopts-primary-row > button` with inline-flex alignment and reduced vertical padding.

## 2026-02-18 - Global Modal Action Button Polish

- Refined action buttons across all modal dialogs (`Save`, `Cancel`, `Create`, `Close`, etc.) with consistent shape, spacing, and contrast.
- Added subtle hover/focus transition polish and clearer default/cancel button differentiation.
- Kept behavior unchanged; styling-only update scoped to modal footer actions.

## 2026-02-18 - PDF Metadata Pill Sanitization

- Hardened metadata ingestion in `lib/meta.js` to strip HTML and Markdown syntax from extracted metadata values before they are stored as tags/meta.
- Applies to PDF-derived metadata (and other exiftool-derived metadata paths using the same sanitizer), preventing rendered pills from showing markup artifacts.

## 2026-02-18 - Outbound Tag Sanitization Fallback

- Added outbound tag sanitization in `lib/upload.js` (`Upload.toClientJSON`) so legacy/previously-stored metadata is cleaned before reaching file-list pills/tooltips.
- This complements ingest-time sanitization in `lib/meta.js` and fixes existing room data showing markdown/HTML artifacts.

## 2026-02-18 - File Tag Pill Order and Tooltip Prefix Polish

- Reordered file-list metadata pills to prioritize `author` (`user`/`usernick`) first, then `title`, then `description`, with all other tags following.
- Updated file tooltip metadata labels so `Title:` and `Description:` render as bold, capitalized prefixes for clearer readability.

## 2026-02-18 - Changelog Section Consolidation

- Removed standalone `Post-merge Additions in 1.0.0` and `Post-merge UI Changes in 1.0.0` sections from `CHANGELOG.md`.
- Integrated those entries into relevant `Core Features` subsections (`Room Management` and `Web Interface -> User Experience`).

## 2026-02-18 - Modal Checkbox Greytone Styling

- Applied a shared custom checkbox style for modal dialogs to match Dicefiles greytone UI (neutral dark gradient, subtle borders, soft focus ring, and readable checked mark).
- Scope includes Room Options, Notifications, and other modal checkbox controls without behavior changes.

## 2026-02-18 - Advanced Batch Downloads (TODO-6)

- Implemented retry-on-failure for batch downloads with per-file live status rows in the download modal.
- Added a `Skip existing filenames` option to batch download runs (stored per-room in browser settings).
- Added resumable batch queue persistence in browser storage; unfinished queue resumes after refresh when files list is restored.
- Added final batch report summary in modal with success/failed/skipped counts and per-file terminal statuses.

## 2026-02-18 - Better Library Metadata (TODO-7)

- Extended metadata extraction for document/PDF uploads to include richer book-oriented tags such as `bookauthor` and `pages` when available from exiftool metadata.
- Added optional `suggestedTags` derivation from filename/title/description/author metadata and exposed it in file tooltip metadata.
- Added a one-click copy action in each file row to copy a direct link plus a metadata snippet (title/author/pages/description/suggested tags/link).

## 2026-02-18 - File Metadata Label/Order Corrections

- Normalized metadata label semantics by format: document/book-like files show `Author` for creator metadata, while image/video continue to show `Artist`.
- Enforced file-list metadata pill order as `author`, `title`, `description`, `uploader` (left to right).
- Replaced native pill `title` hover with a styled in-app hover label using capitalized/bold metadata prefixes.

## 2026-02-18 - Page Count Hover + Copy Button Placement

- Added robust page-count extraction fallback across metadata keys and surfaced it as both tag/meta so PDF/EPUB hovers can display page count when present.
- Moved the metadata copy action from the filename cluster to the final detail/TTL column as requested.

## 2026-02-18 - Batch Download Start Gating + Retry Field

- Batch downloads no longer start immediately when opening Download All/New modal; user must press `Start`.
- Defaulted `Skip existing filenames` to enabled for safer repeat runs.
- Made `Retries per file` editable and right-aligned on the same options row before start.
