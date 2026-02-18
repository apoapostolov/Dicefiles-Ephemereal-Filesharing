# Changelog

Short, power-user focused summary — only major features and the public API are listed.

## [Unreleased]

- None

## [1.0.0] - 2026-02-17

Overview

Dicefiles 1.0.0 is an initial stable release focused on ephemeral, high-throughput file sharing, real-time collaboration, and operability for self-hosted deployments.

### Major features

- Ephemeral file sharing platform
  - Multi-file uploads (drag & drop) and support for large files (up to 10 GB)
  - TTL-based automatic file expiry and configurable retention policies

- High-fidelity previews & streaming
  - Server-generated previews for images, video, audio, and PDFs (for quick inspection and streaming)

- Advanced download & automation
  - Batch downloads with configurable concurrency, resumable queues, per-file retry, and skip-existing behavior
  - Commandable download workflow suitable for automation and scripted retrievals

- Real-time collaboration & inline media
  - Socket.io-based chat with inline media embedding and GIF provider integrations (Giphy/Tenor)
  - Searchable emoji picker and direct GIF posting (provider keys via local config)

- Programmatic API & moderation
  - Public endpoints for uploads, downloads, and message removal (see `API.md`) for automation and moderation integrations
  - Room-level and global moderation controls with rate-limiting and audit logging

- Deployment & operations
  - Redis-backed state (sessions, room/file metadata) and production-ready systemd service template
  - Operational tooling: `scripts/restart-server.sh` and `npm run restart`; repo requires Node.js 18 for production runs

Security & privacy

- Ephemeral-by-design storage model; secure cookies, token verification, and optional sandboxing for preview generation.

Docs & integration

- See `API.md` for API usage and `README.md` for deployment/runbook and systemd instructions.

---

(Changelog intentionally lists only major, user- or API-facing features; UI micro-polish and non-functional tweaks are omitted.)
