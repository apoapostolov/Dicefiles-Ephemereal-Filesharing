# Dicefiles - Ephemereal Filesharing for Hobby Communities

![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-1.2.0-blue)
![Node](https://img.shields.io/badge/node-LTS-339933)
![Redis](https://img.shields.io/badge/redis-required-DC382D)
![Status](https://img.shields.io/badge/status-active-brightgreen)

Dicefiles is a self-hosted, open-source file sharing platform for hobby communities, forked from Volafile and Kregfile, and extended with new automation features, quick downloading for archival purposes, and an improved in-room request flow. It is ideal for sharing roleplaying books, digital maps, board games, STL models, fiction, and more.

<p align="center">
  <img src="images/dicefiles_01.png" width="32%" />
  <img src="images/dicefiles_02.png" width="32%" />
</p>

> **Note:** This is a self-hosted application. You must host it yourself - there is no public service provided.

## Features

- Real-time chat rooms with file sharing
- User accounts and moderation
- File previews (images, videos, audio, PDFs)
- Configurable limits and flood control
- TLS/HTTPS support
- Room creation and management
- Request system in rooms (including optional links and image references)
- NEW badges for unseen files and requests
- Batch download actions for All files or NEW files with progress modal
- Request-only filter in the room toolbar
- Per-user file cleanup (users can remove their own uploads/requests)
- Expanded profile page with editable profile message (owner-only), markdown rendering, and achievement grid
- Achievement progression across uploaded files, uploaded size, and downloaded size (rarity-tier visual system)
- Per-user downloaded-bytes tracking shown on profile (`Total Downloaded`)

## User-Facing Room Features

- **Requests in file list**: Create a request from the room toolbar; requests appear in the file list with distinct styling.
- **Request links**: Optional product/reference URL per request, opened in a new tab from the request row.
- **Request images**: Optional cover/reference image in request creation, shown in request hover preview.
- **NEW awareness**: Files and requests newer than your last seen state are highlighted with `NEW!`.
- **Fast batch downloads**: `Download NEW` and `Download All` buttons with count badges and progress tracking.
- **Request filtering**: Dedicated request icon in the filter strip to isolate request entries quickly.

## User Profiles

- **Profile message**: If you are viewing your own profile while logged in, you can set a multiline markdown message for visitors.
- **Achievement trophy room**: Achievements unlock across three tracks:
  - Uploaded file count
  - Uploaded total size
  - Downloaded total size
- **Rarity visuals**: Achievement cards use progressive MMO-style rarity colors from common tiers to mythic/ascendant tiers.
- **Stats snapshot**: Profile cards show Total Uploaded, Total Downloaded, Files Uploaded, and unlocked achievement count.

## Documentation

- **[INTRODUCTION.md](INTRODUCTION.md)** - Complete guide to Dicefiles, use cases, and getting started
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[API.md](API.md)** - Automation API reference for agentic clients (OpenClaw / skills.sh style)

## Quick Start (Choose Your OS)

### Linux / macOS

**Node.js:**

- Use a current Node.js LTS release
- If you use `nvm`: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`

**Windows users: skip to [Windows 11 Setup](#windows-11-setup) below.**

#### 1. Install Redis

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

**macOS:**

```bash
brew install redis
brew services start redis
```

Verify Redis is running:

```bash
redis-cli ping
# Should return: PONG
```

#### 1.5 Install Preview Tooling (recommended)

For reliable file previews (especially PDFs), install:

```bash
sudo apt update
sudo apt install -y exiftool ffmpeg graphicsmagick ghostscript
```

Notes:

- PDF preview generation uses GraphicsMagick; after install, verify the `gm` command is available (`gm version`).
- If you prefer ImageMagick, install it together with Ghostscript so PDF rendering delegates are available.

#### 2. Clone and Install

```bash
# Clone the repository
git clone https://github.com/apoapostolov/dicefiles.git
cd dicefiles

# Install dependencies
yarn install

# Build client-side code (production mode)
yarn prestart
```

#### 3. Configure

Create a `.config.json` file in the Dicefiles directory:

```json
{
  "name": "My File Share",
  "motto": "Share freely",
  "port": 9090,
  "maxFileSize": 5368709120,
  "jail": false
}
```

#### 4. Start the Server

```bash
yarn start
```

Access at `http://127.0.0.1:9090`

---

### Windows 11 Setup

#### 1. Install Prerequisites

**Node.js (LTS version):**

1. Download a current Node.js LTS release from <https://nodejs.org/>
2. Run the installer (accept defaults)
3. Verify installation:

   ```powershell
   node --version
   ```

**Yarn:**

```powershell
npm install -g yarn
yarn --version
```

**Redis (for Windows):**

**Option A - WSL2 (Recommended for full compatibility):**

1. Enable WSL2: `wsl --install`
2. Install Ubuntu from Microsoft Store
3. In WSL Ubuntu terminal:

   ```bash
   sudo apt update
   sudo apt install redis-server
   sudo service redis-server start
   ```

4. Dicefiles will need to connect to WSL's Redis (IP changes on restart)

**Option B - Memurai (Native Windows Redis):**

1. Download Memurai from <https://www.memurai.com/get-memurai>
2. Install with default settings
3. Memurai installs as a Windows service automatically
4. Verify: `redis-cli ping` (should return `PONG`)

**C++ Compiler (for native modules):**

1. Install Visual Studio Build Tools:
   - Download from <https://visualstudio.microsoft.com/downloads/>
   - Select "Build Tools for Visual Studio 2022"
   - During install, check "Desktop development with C++"

**Optional Preview Tools:**

```powershell
# Install exiftool
# Download from https://exiftool.org/ and extract to a folder in PATH

# Install ffmpeg
# Download from https://ffmpeg.org/download.html
# Extract and add bin folder to PATH

# Install GraphicsMagick (preferred) or ImageMagick + Ghostscript (for PDF previews)
# GraphicsMagick: https://sourceforge.net/projects/graphicsmagick/files/graphicsmagick-binaries/
# ImageMagick: https://imagemagick.org/script/download.php#windows
# Ghostscript: https://ghostscript.com/releases/gsdnld.html
```

#### 2. Clone and Install

Open PowerShell or Command Prompt:

```powershell
# Clone the repository
git clone https://github.com/apoapostolov/dicefiles.git
cd dicefiles

# Install dependencies
yarn install

# Build client-side code
yarn prestart
```

#### 3. Configure

Create `.config.json` in the Dicefiles directory:

```json
{
  "name": "My File Share",
  "motto": "Share freely",
  "port": 9090,
  "maxFileSize": 5368709120,
  "jail": false
}
```

**Note:** `jail` is always disabled on Windows (firejail is Linux-only).

#### 4. Start the Server

```powershell
yarn start
```

Access at `http://127.0.0.1:9090`

---

## Configuration

Configuration files are loaded in this order (last value wins):

1. `defaults.js` - Built-in defaults (do not edit, use as reference)
2. `$HOME/.config/Dicefiles.json`
3. `$HOME/.config/Dicefiles.js`
4. `$PWD/.config.js`
5. `$PWD/.config.json`

**Example `.config.json`:**

```json
{
  "name": "My File Share",
  "motto": "Share freely",
  "port": 9090,
  "maxFileSize": 5368709120,
  "jail": false
}
```

**Key options:**

| Option                  | Default        | Description                                                     |
| ----------------------- | -------------- | --------------------------------------------------------------- |
| `port`                  | `8080`         | HTTP listen port                                                |
| `workers`               | `CPU + 1`      | Number of web workers                                           |
| `secret`                | `"Dicefiles"`  | Secret for crypto (change in production)                        |
| `uploads`               | `"uploads"`    | Upload directory path                                           |
| `maxFileSize`           | `10GB`         | Max file size in bytes (0 = unlimited)                          |
| `requireAccounts`       | `false`        | Require accounts to chat/upload                                 |
| `roomCreation`          | `true`         | Allow room creation                                             |
| `TTL`                   | `48`           | Hours before finished downloads expire                          |
| `downloadMaxConcurrent` | `3`            | Max concurrent downloads for room toolbar batch downloads (1-4) |
| `automationApiKeys`     | `[]`           | API keys for automation API (supports scoped key objects)        |
| `automationApiRateLimit` | `{windowMs,max}` | Default automation API rate limit (fixed window)               |
| `automationApiRateLimitByScope` | `{}`  | Per-scope rate limit overrides for automation API                |
| `automationAuditLog`    | `"automation.log"` | JSONL audit log file for automation API calls                 |
| `observabilityLog`      | `"ops.log"`    | JSONL lifecycle log for uploads/downloads/requests/previews      |
| `webhooks`              | `[]`           | Outbound webhook targets/events for upload/request lifecycle     |
| `webhookRetry`          | `{...}`        | Webhook retry policy defaults (retries/backoff)                  |
| `webhookDeadLetterLog`  | `"webhook-dead-letter.log"` | JSONL sink for failed webhook deliveries            |
| `jail`                  | `true` (Linux) | Use firejail for preview commands (always false on Windows)     |

## Automation API

The stable automation API prefix is `/api/v1` (legacy `/api/automation` is kept as a compatibility alias).
The complete reference lives in [`API.md`](API.md), structured for agentic tools and skill generation.

## Health Endpoint

Dicefiles exposes a lightweight health endpoint:

- `GET /healthz`

It returns:

- Redis check status/latency
- Upload storage writeability check status/latency
- In-memory ops counters (`uploadsCreated`, `uploadsDeleted`, `downloadsServed`, `downloadsBytes`, `requestsCreated`, `requestsFulfilled`, `previewFailures`)

HTTP status is:

- `200` when checks pass
- `503` when a dependency check fails

`TTL` and `downloadMaxConcurrent` are administrator-only settings configured in source/config files (`defaults.js` or your `.config.json` override), not from the room UI.

See `defaults.js` for all available options.

### GIF Provider API Keys (Giphy/Tenor)

GIF search in the chat overlay uses provider APIs and requires keys.

1. Edit `core/gif-providers.json` only for non-secret defaults (`limit`, `rating`, etc.).
2. Create a local secret override file in the project root:

```json
{
  "giphy": {
    "apiKey": "YOUR_GIPHY_API_KEY"
  },
  "tenor": {
    "apiKey": "YOUR_TENOR_API_KEY"
  }
}
```

Use file name: `.gif-providers.local.json`

- This file is git-ignored and should not be committed.
- Webpack merges `.gif-providers.local.json` into `core/gif-providers.json` at build time.
- `giphy.rating` defaults to `r` (mature). Valid values are: `g`, `pg`, `pg-13`, `r`.
- Rebuild client assets after changing keys:

```bash
yarn prestart
```

## Windows Service Setup (NSSM)

To run Dicefiles as a Windows service that starts automatically and stays alive:

### 1. Install NSSM (Non-Sucking Service Manager)

1. Download from <https://nssm.cc/download>
2. Extract the archive
3. Run `nssm.exe` from the `win64` folder (or move it to a folder in your PATH)

### 2. Create the Service

Open Command Prompt as Administrator and run:

```cmd
nssm install Dicefiles
```

This will open the NSSM GUI. Configure:

**Path:**

- Path to `node.exe`:

  ```
  C:\Program Files\nodejs\node.exe
  ```

  (or wherever Node.js is installed)

**Startup directory:**

- The Dicefiles directory:

  ```
  C:\path\to\Dicefiles
  ```

**Arguments:**

- The server script:

  ```
  C:\path\to\Dicefiles\server.js
  ```

### 3. Configure Service Settings (Optional but Recommended)

In the NSSM GUI, click the tabs:

**Details tab:**

- Display name: `Dicefiles`
- Description: `File sharing chat platform`
- Startup type: `Automatic`

**Log on tab:**

- Use the default "Local System account" (recommended for file access)
- Or use a dedicated service account if you prefer

**I/O tab (for logging):**

- **Output (stdout):** `C:\path\to\Dicefiles\Dicefiles-out.log`
- **Error (stderr):** `C:\path\to\Dicefiles\Dicefiles-err.log`

This will capture logs for troubleshooting.

### 4. Start and Test the Service

```cmd
nssm start Dicefiles
```

Check the status:

```cmd
nssm status Dicefiles
```

Access at `http://127.0.0.1:9090`

### 5. Managing the Service

```cmd
# Stop the service
nssm stop Dicefiles

# Restart the service
nssm restart Dicefiles

# Remove the service (will stop it first)
nssm remove Dicefiles confirm
```

### 6. Configure Redis as a Service

**If using Memurai:** It should already be installed as a Windows service.

**If using WSL2 Redis:** Redis won't survive WSL restarts. Consider:

- Using Memurai instead for production
- Setting up a startup script that launches WSL and starts Redis

### Troubleshooting Windows Service Issues

1. **Service won't start:** Check the error log at `Dicefiles-err.log`
2. **Port already in use:** Change port in `.config.json` and restart service
3. **Redis connection refused:** Verify Redis is running before starting Dicefiles
4. **Permission errors on uploads:** Ensure the service account has write access to the uploads directory

## Development

### Setting Up Development Mode

Run these commands in separate terminals:

**Terminal 1:**

```bash
yarn pack
```

This starts webpack in watch mode and rebuilds client code automatically when files change.

**Terminal 2:**

```bash
npx nodemon server.js
```

This restarts the server automatically when server files change.

Client browsers will automatically reconnect and pull new code on reload.

## Usage

### Creating Rooms

Rooms are created automatically when someone navigates to a room URL (e.g., `http://localhost:9090/yourroomname`).

To force-create a room manually:

```bash
redis-cli set rooms:<alias> 1
# Example:
redis-cli set rooms:gentoomen 1
```

### Creating Moderators

Use the included script to promote a user to moderator:

```bash
node setRole.js <username> mod
```

The user should refresh their browser tab to see the new role.

## Production Deployment

### Linux Process Management (PM2)

Use PM2 to keep Dicefiles running:

```bash
npm install -g pm2
pm2 start server.js --name Dicefiles
pm2 startup
pm2 save
```

### Using TLS/HTTPS

Update your config file:

```json
{
  "tls": true,
  "tlsonly": false,
  "tlsport": 8443,
  "tlskey": "/path/to/privkey.pem",
  "tlscert": "/path/to/cert.pem"
}
```

Use certbot (Let's Encrypt) or your certificate authority to get certificates.

**Windows users:** Use IIS ARR or nginx on WSL2 as a reverse proxy for HTTPS termination.

### Using a Reverse Proxy (Recommended for Linux/macOS)

For production, use nginx or Apache as a reverse proxy. Example nginx config:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Troubleshooting

### Previews don't work

1. Verify all prerequisites are installed:

   ```bash
   which exiftool ffmpeg file
   ```

2. If using a container/VPS/Docker, firejail may refuse to run. Disable it in config:

   ```json
   {
     "jail": false
   }
   ```

3. Windows users: Ensure exiftool, ffmpeg, and imagemagick are in your PATH.

4. Check server logs for preview-related errors.

### Files don't upload

1. Check upload directory permissions
2. Verify `maxFileSize` config is sufficient
3. Check available disk space
4. Windows service users: Verify the service account has write access

### Can't connect

1. Verify Redis is running: `redis-cli ping`
2. Check port is not blocked by firewall
3. Review server logs for startup errors
4. Windows: Check Windows Firewall is allowing Node.js

### Windows-specific Issues

**"redis-cli not found":** Make sure Memurai is installed and in PATH, or use WSL2 Redis.

**"gyp ERR! stack Error: `msbuild` not found":** Install Visual Studio Build Tools with C++ workload.

**Service fails to start:** Check the error log at `Dicefiles-err.log`.

## Code Structure

```
Dicefiles/
├── client/          # Client-side code
├── common/          # Shared code between frontend and backend
├── entries/         # Webpack entry points for client code
├── lib/             # Server-side code
├── static/          # Static assets and webpack bundles
├── uploads/         # Uploaded files (configurable)
├── views/           # EJS templates
├── server.js        # Main server entry point
├── webpack.config.js # Webpack configuration
└── defaults.js      # Default configuration (reference)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

## Credits

Inspired by [volafile](https://volafile.org).
