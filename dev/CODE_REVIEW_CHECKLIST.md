# Code Review Checklist

Use the relevant sections for AI-generated and human changes. Security failures
or stale generated output block handoff.

## Scope And Structure

- [ ] Preserve unrelated changes in the existing working tree.
- [ ] Put browser behavior in `client/`, entry points/styles in `entries/`,
      server behavior in `lib/`, and shared pure helpers in `common/`.
- [ ] Reuse existing room, upload, plugin, and broker boundaries instead of
      bypassing them.
- [ ] Generate browser output from source; do not hand-edit bundles or maps.

## Correctness And Concurrency

- [ ] Handle empty, malformed, missing, expired, and partially restored Redis
      state.
- [ ] Await Redis, filesystem, network, and plugin operations and surface useful
      failures.
- [ ] Consider multiple workers, duplicate events, reconnects, retries, and
      service restarts.
- [ ] Preserve backward compatibility for existing rooms, uploads, requests,
      readers, and configuration defaults.

## Security And Privacy

- [ ] Validate and normalize user-controlled names, URLs, paths, tags, and
      archive entries.
- [ ] Preserve owner/member/moderator, invite-only, hidden-file, and linked-room
      access boundaries.
- [ ] Do not expose room names, user names, file names, IPs, tokens, passwords,
      bot credentials, webhook secrets, or local paths in public telemetry.
- [ ] Review upload parsing, remote fetches, webhooks, and native tool execution
      for traversal, SSRF, injection, resource-exhaustion, and unsafe redirects.
- [ ] Keep `.config`, `.config.json`, local provider configuration, uploads, and
      logs out of Git.

## UI And Accessibility

- [ ] Preserve the greytone theme and existing interaction patterns unless a
      redesign was explicitly requested.
- [ ] Check desktop and mobile layouts, focus order, keyboard operation,
      labels, overflow, empty states, and long content.
- [ ] Use the Codex in-app browser and inspect console/network failures.

## Validation And Operations

- [ ] Run the narrowest relevant Jest suite, then broader tests when the change
      crosses modules.
- [ ] For preview work, verify native dependencies and upload real image, PDF,
      and archive samples.
- [ ] Run `yarn prestart`; review the source and generated diffs together.
- [ ] Restart `dicefiles.service` and require `/healthz` HTTP `200` from WSL and
      Windows before a runtime-change handoff.
- [ ] Update public docs, API/plugin docs, configuration examples, and
      `CHANGELOG.md` when user-visible behavior changed.
