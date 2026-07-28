# AGENTS.md

- Preserve unrelated user changes; this checkout commonly has a dirty working tree.
- Node.js must be `>=22`; use Yarn 1.x and `yarn.lock`, never `package-lock.json`.
- Run the user-test instance through WSL `Ubuntu-24.04` on port `10005`.
- Never use hot reload, Webpack watch mode, Nodemon, or polling watchers.
- After runtime-affecting changes: `yarn prestart`, restart the user service with `systemctl --user restart dicefiles.service`, wait for Redis restoration, then require `/healthz` HTTP `200` from WSL and Windows.
- For visual validation, use the browser built into Codex; do not launch Linux Chrome or substitute an external browser.
- Edit browser source under `client/` and `entries/`; generated JS/CSS/maps under `static/` and `lib/clientversion.js` must come from `yarn prestart`.
- Static source media such as `static/404.jpg`, `static/HAL9000.svg`, and `static/loader.png` are hand-maintained exceptions.
- Preview support requires `sharp` plus `exiftool`, `gm`, `gs`, `pdftoppm`, `ffmpeg`, `file`, and `7z`.
- Run `yarn check:preview-tools`; on Ubuntu/WSL use `yarn setup:ubuntu`.
- After preview changes, test real image, PDF, and archive uploads in gallery view and check browser console/network.
- Run the narrowest relevant Jest suite first; run broader tests for cross-cutting changes.
- Treat `.config`, `.config.json`, uploads, logs, bot credentials, invite/status tokens, and real room/user/file data as private.
- `docs/FUTURE_DEVELOPMENT_PLAN.md` is the product backlog; `CHANGELOG.md` contains user-visible outcomes only.
- Read `dev/README.md` for the handoff, generated-file, review, release, and decision-record workflows.
