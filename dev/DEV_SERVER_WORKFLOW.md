# Development Server Workflow

Dicefiles uses one stable production-mode test server. Source watchers caused
the app to disappear during edits and made interactive testing unreliable, so
hot reload is intentionally not part of this checkout's workflow.

## Stable Test Instance

| Setting | Value |
| --- | --- |
| WSL distribution | `Ubuntu-24.04` |
| Repository in WSL | `/mnt/c/git-public/Dicefiles-Ephemereal-Filesharing` |
| Service | user-level `dicefiles.service` |
| Test URL | `http://localhost:10005` |
| Health URL | `http://localhost:10005/healthz` |

Do not run `webpack --watch`, Nodemon, polling watchers, a second
Node server, or the legacy foreground restart helper for the user-test
instance. The user service owns port `10005`.

## Runtime Change Handoff

Use this sequence after changes to application code, styles, templates,
dependencies, runtime configuration, or generated browser assets:

1. Run the narrowest relevant lint or Jest tests.
2. Build all browser assets from source:

   ```powershell
   wsl -d Ubuntu-24.04 -e bash -lc "cd /mnt/c/git-public/Dicefiles-Ephemereal-Filesharing && yarn prestart"
   ```

3. Restart the single service:

   ```powershell
   wsl -d Ubuntu-24.04 -e bash -lc "systemctl --user restart dicefiles.service"
   ```

4. Wait for startup and Redis room restoration, then verify from WSL:

   ```powershell
   wsl -d Ubuntu-24.04 -e bash -lc "curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:10005/healthz"
   ```

5. Verify from Windows:

   ```powershell
   (Invoke-WebRequest -UseBasicParsing http://localhost:10005/healthz).StatusCode
   ```

Both checks must return `200` before handing the app to the user.

Documentation-only and repository-metadata changes do not require a rebuild or
restart. If a runtime change cannot be handed off, leave the stable service in
its last working state and report the failed step.

## Visual Validation

Use the browser built into Codex. Do not launch Linux Chrome or substitute an
external browser. For UI changes, inspect the real affected flow at desktop and
mobile widths and check browser console and network errors.

Preview changes require real image, PDF, and archive uploads in gallery view.
Run `yarn check:preview-tools` before diagnosing missing native preview support.
