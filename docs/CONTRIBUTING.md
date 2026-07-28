# Contributing to Dicefiles

Thanks for contributing to Dicefiles.

This document defines the expected workflow and quality bar for code, documentation, and UX changes.

AI-assisted contributors should also read [`AGENTS.md`](../AGENTS.md) and the
project-specific [`dev/README.md`](../dev/README.md) workflow index.

## Scope

Contributions are welcome for:

- Bug fixes
- Performance and reliability improvements
- Security hardening
- UX improvements aligned with the current product direction
- Documentation and developer experience updates

## Ground Rules

- Be respectful and professional in discussions and reviews.
- Keep feedback technical and specific.
- Prioritize correctness and user impact over personal preference.

## Development Setup

Prerequisites:

- Node.js **≥ 22** (see `package.json` `engines`)
- **Yarn 1.x only** (`yarn.lock` is the install source of truth; do not commit `package-lock.json`)
- Redis running locally or remotely

Install and build:

```bash
yarn install
yarn prestart
```

Run the server:

```bash
node server.js
```

The app uses the port configured in `.config.json` (the maintained WSL
user-test service uses port `10005`).

Optional preview tooling (recommended for richer file previews):

- `exiftool`
- `ffmpeg`
- `graphicsmagick` (`gm` command)
- `ghostscript`
- Poppler (`pdftoppm` command)
- `file`
- 7-Zip (`7z` command)

Run `yarn check:preview-tools` to verify the toolchain. On Ubuntu/WSL,
`yarn setup:ubuntu` installs the supported dependencies.

## Branching and Commits

- Create feature branches from `main`.
- Keep changes focused; avoid mixing unrelated refactors.
- Use clear, imperative commit messages.

Examples:

- `fix: handle request-image decode failures`
- `upload: support resumable hashing without state snapshots`
- `docs: clarify preview dependencies`

## Pull Request Expectations

A PR should include:

- Problem statement (what is broken or missing)
- Proposed solution (what changed and why)
- Risk assessment (possible regressions)
- Verification notes (what you tested)
- Screenshots/video for UI changes

Keep PRs reviewable:

- Prefer small to medium PRs over very large bundles.
- Split major efforts into incremental PRs when possible.

## Quality Checklist (Before Opening a PR)

- `yarn prestart` succeeds.
- App starts and serves pages without runtime crashes.
- Redis-backed flows still work:
  - room creation
  - chat connection
  - file upload/download
  - request creation (if touched)
- No unrelated files were changed.
- Documentation updated if behavior/config changed.

## UI/UX Change Requirements

For room or account UI changes:

- Preserve existing interaction patterns unless intentionally redesigned.
- Keep visual changes consistent with the current greytone theme.
- Validate desktop and mobile behavior.
- Do not regress critical workflows (upload, select/delete, requests, downloads).
- Component rules: [UI_STYLE.md](./UI_STYLE.md). Agents auditing, polishing, reworking, or implementing themes: [AI_UI_SKILLS.md](./AI_UI_SKILLS.md).

## Security and Privacy

- Never commit secrets, tokens, private keys, or local credentials.
- Avoid adding new external services without maintainers’ approval.
- If you identify a security issue, disclose it privately before public discussion.

## Documentation Changes

If your change modifies user-facing behavior or setup:

- Update `README.md`.
- Update `CHANGELOG.md`.
- Add migration notes when behavior changes can affect existing deployments.
- Docs index: [README.md](./README.md). Product backlog: [FUTURE_DEVELOPMENT_PLAN.md](./FUTURE_DEVELOPMENT_PLAN.md). Plugins: `../core/plugins/`.

## Review Criteria

Maintainers will evaluate:

- Correctness
- Reliability under edge cases
- Backward compatibility
- Readability and maintainability
- Operational impact (deploy/run/debug)

PRs that do not meet the baseline may be asked to revise before merge.
