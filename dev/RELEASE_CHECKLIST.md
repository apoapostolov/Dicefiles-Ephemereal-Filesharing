# Release Checklist

## User-Testing Handoff

- [ ] Run relevant lint and Jest suites.
- [ ] Run `yarn prestart` and review generated output with its source changes.
- [ ] Restart the WSL user service; do not start a second server or watcher.
- [ ] Wait for Redis restoration and verify `/healthz` returns `200` from WSL
      and Windows.
- [ ] Exercise the affected flow in the Codex in-app browser at relevant
      desktop and mobile widths.
- [ ] Report any skipped validation or residual risk.

## Public Release Preflight

- [ ] Confirm `package.json`, `yarn.lock`, release metadata, and
      `CHANGELOG.md` agree on the intended release.
- [ ] Run the complete appropriate test suite and `yarn prestart`.
- [ ] Run `yarn check:preview-tools` when preview behavior or installation
      guidance changed.
- [ ] Inspect the full Git diff for unrelated changes and stale generated
      bundles.
- [ ] Confirm local config, environment files, uploads, databases, Redis state,
      logs, browser output, and packaged tarballs are excluded.
- [ ] Scan staged content for credentials, tokens, private URLs, IP addresses,
      and real room/user/file data.
- [ ] Confirm setup, API, MCP, plugin, and migration documentation matches the
      shipped behavior.

## Publish

- [ ] Commit only the release's related source, tests, docs, and intentionally
      tracked generated output.
- [ ] Tag, push, publish, or rewrite history only when explicitly authorized.
- [ ] After publishing, verify the remote tag/release and repeat the deployed
      health and primary-flow smoke checks.
