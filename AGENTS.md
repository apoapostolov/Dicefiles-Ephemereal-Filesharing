# AGENTS.md

## Runtime Requirement

Use Node.js 20 for this project runtime in this workspace.

- Required path: `/home/apoapostolov/.nvm/versions/node/v20.20.0/bin/node`
- Always use the explicit Node 20 binary path for build/start/test commands.

## Agent Rule

If an automated agent (Codex/Claude/etc.) is working in this repo, it must:

1. Check current `node -v` first.
2. If current shell Node is not 20, run commands with the explicit Node 20 path above.
3. Never start/restart Dicefiles with Bun or a different Node major.

## Strict Server Startup Procedure (Mandatory)

Use this exact sequence every time:

1. Verify node in shell:
   - `node -v`
2. Build client bundle:
   - `/home/apoapostolov/.nvm/versions/node/v20.20.0/bin/node ./node_modules/webpack-cli/bin/cli.js --mode=production`
3. **Check if server is already running before touching it:**
   - `ss -ltnp | grep 9090`
   - `curl -sI http://127.0.0.1:9090/ | head -1`
   - If already running and you only need a restart after a build: `fuser -k 9090/tcp 2>/dev/null; sleep 1 && /home/apoapostolov/.nvm/versions/node/v20.20.0/bin/node server.js >> server.log 2>&1 &`
   - If not running at all: same start command as above.
4. Verify server is actually up:
   - `curl -I http://127.0.0.1:9090/`
   - `ss -ltnp | grep 9090`
   - (recommended) `tail -F server.log` — monitor `./server.log` if you redirected stdout/stderr when starting the server in background; prefer running the server in a persistent PTY (tmux/screen) and use `tail -F server.log` for live logs.

### Forbidden Startup Patterns

- `node server.js` without the explicit Node 20 path
- `bun run --bun dist/server.js`
- Starting from other projects/paths like `server/server.js`

## Failure Modes We Hit (Do Not Repeat)

- Shell default Node can be a different major (for example `v25.x`), which caused inconsistent runtime behavior. Always force the explicit Node 20 binary path.
- A different service instance (`server/server.js` from another project path) and Bun runtime (`bun run --bun dist/server.js`) were running and caused confusion about which app answered requests.
- Detached `nohup` starts were unreliable in this environment and repeatedly resulted in a dead service; use a persistent PTY session for `node server.js`.
- "Built successfully" does not mean "server is running": always verify with both `curl -I http://127.0.0.1:9090/` and `ss -ltnp | grep 9090`.
- Port ownership may belong to processes started by another user/session, so killing blindly can fail; verify process origin/path before restart.

## Shared Redis Policy (Mandatory)

This server environment is **shared between multiple AI agents** (and possibly the operator). Redis is already running as a background system service managed by the OS (systemd or equivalent). **Agents must never start Redis.** Only restart it if it is confirmed down.

### Rules

1. **Never run `redis-server` or `redis-server --daemonize yes`** — Redis is a shared dependency; starting a second instance will collide with the existing one.
2. Before assuming Redis is down, verify: `redis-cli ping` — if it returns `PONG`, leave it alone.
3. If Redis is confirmed unreachable, restart the existing service only: `sudo systemctl restart redis` (Linux) or `sudo service redis-server restart`.
4. Do not change Redis configuration, flush databases (`FLUSHALL`/`FLUSHDB`), or rename/delete keys outside of what Dicefiles code normally writes.
5. Treat Redis data as shared state that other agents and the operator may be reading or writing concurrently.

### Quick check

```bash
redis-cli ping           # should return PONG
redis-cli info server | grep uptime
```

## Shared Dicefiles Server Policy

The Dicefiles Node.js server (port 9090) also runs in the **shared background** and may be managed by another agent or the operator at the same time.

- Always check `ss -ltnp | grep 9090` **before** killing or restarting the server.
- Only restart when you have just rebuilt the client bundle and a restart is necessary to serve the new assets.
- Do not start a second instance: if `ss` shows port 9090 occupied and `curl -sI http://127.0.0.1:9090/` returns `200 OK`, the server is healthy — skip the restart.
- If you must restart: `fuser -k 9090/tcp 2>/dev/null; sleep 1 && /home/apoapostolov/.nvm/versions/node/v20.20.0/bin/node server.js >> server.log 2>&1 &`

## Temporary Usage Cleanup (Playtesting)

Before performing any major commit or push, agents must run a workspace sanitation procedure to ensure no temporary artifacts end up in source control. During playtesting or development it is common to accumulate ephemeral state (uploaded files, previews, room data, and log entries) that can bloat the workspace. When the user asks to "reset" the repo to a clean slate, agents should perform the following deletions/cleanups:

1. **Uploads directory** (`uploads/`): remove all subdirectories and their contents. This is the primary storage for files and generated thumbnails. The directory is gitignored and can be emptied freely.
2. **Log files** (`server.log`, `ops.log`, `mod.log`): truncate or delete to remove historical events.
3. **Temporary caches**: any other runtime cache directories may be removed; for example, look for `tmp/`, `cache/`, or similar depending on configuration.
4. **Editor metadata**: `.vscode/` or similar local IDE folders often contain personal settings; add them to `.gitignore` and remove any tracked files before committing.
5. **Redis state** (if accessible and safe): either coordinate with the operator to flush the database (`FLUSHALL`) or selectively delete keys prefixed by this workspace (e.g. `dicefiles:*`). _Only flush when explicitly authorized._
6. **Avoid deleting**: source code, configuration files, `node_modules/`, `.git/`, or any other project-level persistent artifacts.

Agents should confirm with the user before touching Redis or other shared services. After cleanup, the repository should resemble a fresh clone with only the source tree and configuration files present.

_(This section is intended to guide agents when the user requests workspace sanitation.)_

## Documentation Workflow (Mandatory)

**DEVELOPMENT_LOG.md must be updated as the final step of every response that changes any code, UX, or behavior. No exceptions. If you skip this step, you have not completed the response.**

For every feature-change request response:

1. **Always update `DEVELOPMENT_LOG.md` as the last action in the same response.** One entry per response minimum. Do not batch entries across multiple responses. If you shipped it, log it before you stop.
2. Each entry must include: date header (`## YYYY-MM-DD - Title`), root cause if a bug fix, and a bullet list of every changed file with a one-line summary of what changed and why.
3. If the user approves implementation of a feature, add it to `CHANGELOG.md` under an `Unreleased` section.
4. Keep `Unreleased` entries user-facing and grouped by type (`Added`, `Changed`, `Fixed`, `Removed`).
5. Do not wait for final release to record approved feature work.
6. If history is squashed to a single "Initial release" commit, rewrite `CHANGELOG.md` so all shipped functionality is represented as implemented in version `1.0.0`.
7. During that squash rewrite, do not keep incremental "changes", "polishes", partial steps, or feedback iteration notes as version-to-version deltas, because an initial release has no prior released baseline.

### Failure Mode: Log Debt

If `DEVELOPMENT_LOG.md` has fallen behind (changes shipped without log entry), backfill all missing entries immediately in the next response before doing any other work. Skipping log updates is the same class of failure as skipping server verification — it degrades continuity for all future agents.

## TODO.md Hygiene (Mandatory)

`TODO.md` is the single source of truth for remaining work. Every section must consist exclusively of actionable, trackable items: things that have a clear "implemented / not implemented" state and that can be checked off when done.

### Rules for every agent editing TODO.md

1. **No design documents in TODO.md.** Lengthy spec text (effort tables, layout diagrams, API field descriptions, implementation notes) belongs in `docs/`. A TODO section may link to a doc; it may not duplicate it.
2. **Every section must contain at least one `- [ ]` checkbox.** If a section has no remaining checkboxes, it is fully implemented — remove the section entirely.
3. **Never add a section titled "Research Backlog", "Open Questions", "Design Notes", or equivalent** unless every item in it is a concrete `- [ ]` action with a specific owner or trigger. Pure "evaluate X someday" bullets without a clear next step go in `docs/` instead.
4. **Remove fully completed sections immediately.** When the last `- [ ]` in a section is checked, delete the section header and all its content in the same commit. Do not leave `- [x]` items in the file.
5. **P-level assignments must be real.** Only assign a `P0`/`P1`/`P2` label to a section if it represents concrete engineering work the team intends to prioritize. Do not create P-level sections for aspirational feature brainstorming — use `docs/` for that.
6. **Execution Order must stay in sync.** Any time a section is added or removed from the TODO, update the Execution Order table at the bottom of the file in the same commit.

### Failure mode: Spec-creep in TODO

A common failure pattern is adding large design specs (format tables, endpoint signatures, client UI sketches) directly into TODO.md as "context for implementors." This bloats the file and makes it hard to scan for remaining work. When you notice this pattern in existing content, migrate the spec text to a `docs/` file and replace it with a concise checklist that links to the doc.

## Dependency & Documentation Sync (Mandatory)

Whenever an npm dependency is **added, removed, or replaced**, the following must all be updated in the same response — no exceptions:

1. **`package.json`** — reflects only packages actually imported by the codebase. Remove packages no longer imported; add packages newly imported as direct dependencies (do not rely on transitive availability).
2. **`README.md`** — the _In-Page Document Reader_ npm packages table (and any other prose that names specific packages) must match `package.json`. Remove rows for dropped packages; add rows for new ones with correct version, license, and purpose.
3. **`DEVELOPMENT_LOG.md`** — include the dependency change in the log entry along with the reason.

### What counts as a dependency change

- Removing an `import` / `require` of a package from all source files (even if the package remains in `node_modules` transitively).
- Adding a new `import` / `require` to a package not previously used in source.
- Replacing one package with another for the same purpose.

### Failure mode: Stale docs after dep change

If `README.md` or `package.json` still references a removed package after the change ships, it misleads future agents (and users) about actual runtime requirements. Treat stale dependency docs as the same class of error as a broken build.

---

## GitHub Release Protocol (Mandatory)

Every version bump that is recorded in `CHANGELOG.md` under a dated version heading **must** have a matching GitHub release created in the same response. No exceptions.

### Pre-flight checks

Before creating any release:

```bash
# 1. Confirm CLI is authenticated
gh auth status

# 2. Confirm no release already exists for the target tag
gh release list --repo apoapostolov/Dicefiles-Ephemereal-Filesharing

# 3. Confirm the target tag exists locally and is pushed
git tag -l | grep <version>
git ls-remote origin refs/tags/<version>
```

### Tag placement rules

- The annotated tag **must** point to the commit that represents the fully stable state of the release — i.e., the latest commit on `main` after all bug-fix follow-ups for that version have been merged.
- If a tag was placed at an earlier commit (before follow-up fixes), **move the tag** before creating the release:

  ```bash
  git tag -d <version>                         # delete local
  git push origin :refs/tags/<version>         # delete remote
  git tag -a <version> HEAD -m "<summary>"     # re-create at HEAD
  git push origin <version>                    # push new tag
  ```

- Tag annotation message format: `vX.Y.Z — <one-line summary of major highlights>`

### Creating the release

Use `gh release create`. Always supply notes from a local file written from `CHANGELOG.md`:

```bash
# Write notes file from changelog section
cat > /tmp/release-notes-<version>.md << 'EOF'
## What's New in <version>

<one-paragraph intro>

---

### Added
...

### Changed
...

### Fixed
...

---

### Upgrading
<migration notes or "No database migrations required.">

---

**Full Changelog**: https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing/compare/<prev>...<version>
EOF

# Create the release
gh release create <version> \
  --repo apoapostolov/Dicefiles-Ephemereal-Filesharing \
  --title "<version> — <short title>" \
  --notes-file /tmp/release-notes-<version>.md \
  --latest
```

### Release body quality requirements

| Section                             | Required?         | Notes                                          |
| ----------------------------------- | ----------------- | ---------------------------------------------- |
| **One-paragraph intro**             | Yes               | Plain English summary of the release theme     |
| **Added** (subsections per feature) | Yes, if any added | `#### Feature Name` heading per major feature  |
| **Changed**                         | Yes, if any       | List form                                      |
| **Fixed**                           | Yes, if any       | List form with brief root-cause note           |
| **Upgrading**                       | Yes               | At minimum: "No database migrations required." |
| **Full Changelog link**             | Yes               | `compare/<prev>...<version>` URL               |

### Post-release verification

```bash
# Confirm the release is live and tagged correctly
gh release view v<version> --repo apoapostolov/Dicefiles-Ephemereal-Filesharing
```

### Failure modes

- **Tag on wrong commit**: if the tag was placed before bug-fix commits that are logically part of the release, the diff link will exclude them. Always verify `git log <tag>..HEAD --oneline` is empty (or only contains docs/infra commits) before publishing.
- **Release without notes file**: do not use `--notes ""` or `--generate-notes` — always write explicit notes from `CHANGELOG.md` to guarantee accuracy.
- **Draft left unpublished**: do not use `--draft`. Publish immediately or not at all; drafts silently rot.
- **Missing `--latest`**: always pass `--latest` unless the release is a backport patch for a previous major (in which case use `--latest=false` explicitly).

---

## Changelog Update Procedure (Mandatory)

When the user requests a changelog update, agents must follow this procedure exactly.

### Before writing a single line

1. Read `DEVELOPMENT_LOG.md` in full from the most recent entry backward until you reach an entry that is already represented in `CHANGELOG.md`.
2. Identify every entry that is **user-visible** — features the user can directly interact with, or bugs that would have been noticed during normal use.
3. Discard: internal refactors, build-system tweaks, CSS micro-polishes the user cannot distinguish from the prior state, code comments, and log/doc-only commits. When in doubt, ask: _"Would a user notice if this were absent?"_ If the answer is no, omit it.
4. **Never add `Changed` or `Fixed` entries for features that were first introduced in the same version.** If a feature debuts in the current version under `Added`, every fix and polish applied to it before release is already part of the base implementation — record none of it in `Changed` or `Fixed`. Only write `Changed` and `Fixed` bullets for regressions, improvements, or changes to features that shipped in a **prior released version**.
5. Group surviving entries by their natural type: `Added`, `Changed`, `Fixed`, or `Removed`.

### Writing style requirements

- Write each entry in plain English directed at the user, not at the codebase. Lead with what the user can now _do_ or _see_, not with which files changed.
- Name features clearly and consistently with the UI labels already used in the interface. Avoid internal class or function names.
- For complex features, include one compact sentence of context ("Root cause: …" is acceptable only in **Fixed** entries to orient future agents and power users).
- Keep individual bullet length to 2–4 sentences. Longer explanations belong in `DEVELOPMENT_LOG.md`.
- Do **not** add entries for: minor alignment tweaks, log file management, gitignore changes, AGENTS.md updates, README edits, or any commit whose subject line starts with `chore:`, `docs:`, or `ci:`.

### After updating the changelog

1. Record this changelog-update event in `DEVELOPMENT_LOG.md` as the final action of the same response. The entry must:
   - State which entries were reviewed in `DEVELOPMENT_LOG.md`.
   - List each new bullet added to `CHANGELOG.md` with a one-line summary.
   - Note any entries that were considered and deliberately omitted, with the reason.
2. Commit `CHANGELOG.md`, `AGENTS.md` (if updated), and `DEVELOPMENT_LOG.md` together in a single commit with message `docs: update changelog and log changelog-update event`.

### What does NOT go in the changelog

| Category                           | Example                                                                               | Decision                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Build / infra                      | webpack config change, Node version pin                                               | Omit                                                           |
| CSS micro-polish                   | 2 px alignment tweak                                                                  | Omit unless user-visible                                       |
| Dependency sync only               | `package.json` version bump matching already-logged dep change                        | Omit                                                           |
| Log / gitignore                    | `server.log` added to `.gitignore`                                                    | Omit                                                           |
| AGENTS.md updates                  | New agent rules or procedures                                                         | Omit                                                           |
| README edits                       | Corrected a badge URL                                                                 | Omit                                                           |
| Bug invisible to user              | Internal Redis key format fixed                                                       | Omit                                                           |
| Fix/change to same-version feature | EPUB options-panel navigation fix shipped in same version as typography options panel | Omit — fold into the base `Added` description or omit entirely |
| **Major feature**                  | Request Fulfillment Workflow                                                          | **Include**                                                    |
| **UX-visible bug fix**             | EPUB pagination broke after font-size change                                          | **Include**                                                    |
| **Visible state change**           | Fulfilled requests show a pill badge instead of strikethrough                         | **Include**                                                    |
