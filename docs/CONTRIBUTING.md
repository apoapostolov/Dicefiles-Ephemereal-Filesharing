# Contributing to Dicefiles

Thanks for contributing to Dicefiles.

This document defines the expected workflow and quality bar for code, documentation, and UX changes.

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
- Node.js (current LTS)
- Yarn (`1.x`)
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

The app defaults to port `9090` in this project setup.

Optional preview tooling (recommended for richer file previews):
- `exiftool`
- `ffmpeg`
- `graphicsmagick` (`gm` command)
- `ghostscript`

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

## Security and Privacy

- Never commit secrets, tokens, private keys, or local credentials.
- Avoid adding new external services without maintainers’ approval.
- If you identify a security issue, disclose it privately before public discussion.

## Documentation Changes

If your change modifies user-facing behavior or setup:
- Update `README.md`.
- Update `CHANGELOG.md`.
- Add migration notes when behavior changes can affect existing deployments.

## Review Criteria

Maintainers will evaluate:
- Correctness
- Reliability under edge cases
- Backward compatibility
- Readability and maintainability
- Operational impact (deploy/run/debug)

PRs that do not meet the baseline may be asked to revise before merge.

