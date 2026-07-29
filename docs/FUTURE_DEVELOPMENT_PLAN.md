# Future Development Plan (Dicefiles)

Working backlog of product ideas that fit self-hosted room chat + ephemeral filesharing.

| Mark | Meaning |
| ---- | ------- |
| `[x]` | Shipped / done (in a released tag unless noted) |
| `[ ]` | Future proposal — not implemented and not a release blocker |

Plugin docs: `core/plugins/`. Formerly `feature_creep_proposal.md`.

**Last updated:** 2026-07-29 — v1.4.4 completes the trusted-host federation
operator lifecycle (source-side rules, durable push invalidation, peer
telemetry, guided key rotation, audit, and two-host smoke test) and makes room
bots remotely manageable, bounded, observable, and optionally
provider-authenticated for safe community commands.

---

## v1.4.4 release gate

This is the finite release backlog. Open checkboxes elsewhere in this document
are longer-term proposals, optional extensions, or explicit non-goals; they do
not silently expand the scope of v1.4.4.

- [x] Complete trusted-host federation phases F0–F5 and the isolated two-host
  acceptance smoke
- [x] Expose scoped room-bot REST and 30-tool MCP administration
- [x] Bound plugin runs with leases, streamed ingest, import caps, stable
  identity/content dedupe, run status, and confirmed sync-memory clearing
- [x] Ship the multi-host importer foundation with Mega.nz and Pixeldrain;
  retain Gofile and legacy shell-bridge providers as future provider work
- [x] Finish advanced linking rules, status charts, account achievements,
  mobile picker/layout fixes, reader imports, and ePub page-turn polish
- [x] Document configuration, setup, federation, plugins, APIs, MCP, upgrades,
  rollback, and future proposals
- [x] Complete release security/privacy scan, full tests, production rebuild,
  stable-service restart, dual health checks, and in-app browser verification
- [x] Prepare matching v1.4.4 package, changelog, README, tag, and GitHub
  release metadata

---

## Priority shortlist

- [x] Multi-room linking (files mirror, one-way, badge, source ownership) — **v1.4.2**; source must **Allow Room Cross-Linking**
- [x] Deep links with intent (`filter` / `sort` / `request` / file open) — room option — **v1.4.2**
- [x] Resume strip + “what’s new since last visit” productization — **v1.4.3**
- [ ] Multi-volume storage with balanced and threshold-based placement —
  proposal: `docs/MULTI_VOLUME_STORAGE.md`
- [ ] Password-protected rooms with rotating shared and personal credentials —
  proposal: `docs/PASSWORD_PROTECTED_ROOMS.md`
- [x] Request board polish — **v1.4.2** first-class board + filters + segmented toolbar pill
- [x] Guest invite links (single-use / max X / max Y hours) — Room Options → **Invites** — **v1.4.2**
- [x] Privacy-safe operator dashboard beyond `/healthz`, protected by a generated capability link by default — **v1.4.3**
- [x] Webhooks + plugin system (Mega.nz Autoshare, BOT pills, Room Options → **Plugins**) — **v1.4.2**
- [x] Durable plugin sync skip-log (stable provider id with legacy name+size,
  Redis, configurable retention) — **v1.4.3**, strengthened in **v1.4.4**
- [ ] Multi-host remote import — shared downloader registry plus Mega.nz and
  Pixeldrain are shipped; Gofile and long-tail providers remain — design:
  `core/plugins/REMOTE_HOST_IMPORTS.md`
- [x] Plugin import safety: per-file/per-run caps and cross-worker run leases
- [x] Plugin dedupe upgrade: stable provider identity plus existing-room
  content-hash check
- [x] **Federated multi-server mesh** — pinned peers, RFC 9421 authentication,
  bilateral room consent, remote room linking, status probes, and ranged
  fetch-through (see full section)

---

## Multi-room linking

**Idea:** Admin links room A → room B. Files from B appear in A marked as linked, without users needing to join B.

- [x] One-way mirror: A subscribes to B (**Linking** tab; B enables **Allow Room Cross-Linking**)
- [x] Linked badge (source room name / “linked”)
- [x] Download / Read Now through source ownership
- [x] Delete/moderation stays on **source** room
- [x] Linked rooms accept **room id or exact room name**
- [x] Source opt-in gate
- [x] Per-link filters: filename, tag, and uploader username expressions
  (comma/OR, AND, or regex), types grid, max/min age hours
- [x] TTL follows source (view/fetch-through, no second disk copy)
- [x] Status **Active** / **Cross-link off** / **Missing**
- [x] Linking tab UI + **?** help; General **?** on cross-linking
- [x] Unit tests (`lib/room/room-links.js`)
- [x] Explicit non-goal for v1: open requests cross-room
- [x] ACL: richer destination visibility rules + bilateral private-source opt-in (source room and destination link); hidden/hellbanned rows never cross
- [x] Automation API: list / create / remove links (`room-links:read` / `room-links:write`)
- [x] Linked-file “NEW” / digest integration (including old files newly mirrored into the room)

**v1 sketch (shipped in v1.4.2)** — see Linking tab + CHANGELOG.

---

## Continuity & discovery

- [x] **Continue where I left off** — most-recent reader resume + “N new since last visit”
- [x] **Shareable deep links with intent** — **v1.4.2**; open waits for file list
- [x] **What’s new while I was away** digest — files, new/fulfilled requests, linked-room deltas
- [x] Digest includes **plugin bot uploads** and linked mirrors as first-class “new” sources

---

## Requests

- [x] **Request board that scales** — **v1.4.2**
- [x] Request board deep-link polish / share and restore open/fulfilled/all board state
- [x] Cross-room request visibility rule: request cards remain source-room local; finished fulfillment uploads may mirror as ordinary files

---

## Room ops & privacy

- [x] **Guest join friction** — guest invite links — **v1.4.2**

### Guest invite links (shipped — v1.4.2)

- [x] Modes: single-use, max X uses, max Y hours (90-day cap)
- [x] Pure helpers + unit tests (`lib/room/guest-invites.js`)
- [x] Room config + guest pass after redeem
- [x] Owner mint / list / revoke RPC; setconfig return payload
- [x] HTTP + WS redeem (`?invite=` / `guestInvite`)
- [x] Room Options → **Invites** (generate + limits panel + list + copy + revoke)
- [x] Webhooks `guest_invite_created` / `guest_invite_redeemed`
- [x] Configurable max concurrent active invites per room; privacy-safe redemption audit in UI — **v1.4.3**
- [x] REST automation endpoints for mint/list/revoke (`guest-invites:read` / `guest-invites:write`) — **v1.4.3**

---

## Operator & automation

- [x] **Operator dashboard** — privacy-safe service/storage/activity history,
  request status, federation peer aggregate, and protected capability URL
- [ ] Operator dashboard additions: prune candidates, rate-limit hits, preview
  queue, and per-plugin last-run/error cards (last-run data is available by API)
- [x] **Webhooks + plugin system** — **v1.4.2** (+ sync log hardening below)

### Webhooks (shipped)

- [x] Core: `file_uploaded`, `request_*`, `file_deleted`, …
- [x] `linked_file_appeared`
- [x] `guest_invite_created` / `guest_invite_redeemed`
- [x] Unit tests + API docs
- [ ] Optional: webhook UI in Room Options or admin (today: `.config.json` only)
- [ ] Optional: per-room webhook overrides (global hooks only today)

### Plugin system + Mega.nz Autoshare (shipped — v1.4.2)

- [x] `PluginRegistry` + lifecycle (`startAll` / `run` / `onEvent`)
- [x] Builtin **mega-folder** (Mega.nz Autoshare) + injectable Mega.nz I/O + production adapters
- [x] Room Options → **Plugins**: catalog invite, settings, enable, Run now, remove
- [x] Per-room `roomPlugins` + `room-runtime` pollers (`pollIntervalMinutes`)
- [x] Bot identity: cyan **BOT** pill + `botName`
- [x] Docs: `core/plugins/DEVELOPING_PLUGINS.md`, `MEGA_FOLDER.md`
- [x] Unit tests: registry, adapters, room-plugins, mega inject
- [x] `megajs` optionalDependency
- [x] **Durable sync log** — Redis ZSET per plugin/room/source; stable provider
  identities plus legacy name+size compatibility survive restarts
  (`lib/plugins/sync-log.js`)
- [x] **App config** `pluginSyncLogRetentionDays` (default **30**, clamp 1–730) — prune expired skip records
- [x] In-process cache mirrors durable log for hot polls

### Plugin / bot follow-ups

These are not covered by a clear backlog item yet; add them before calling plugins “production-hard.”

| Gap | Why it matters | Suggested direction |
| --- | -------------- | ------------------- |
| ~~Skip key is name+size only~~ | **Shipped:** provider node identity is primary; legacy name+size remains readable | Extend the same contract to each provider |
| ~~No skip against existing room files~~ | **Shipped:** completed content hashes are checked before a new room row is created | Preserve the check in every importer |
| ~~Multi-worker race~~ | **Shipped v1.4.4:** scheduled room and global runs share Redis event leases | Keep lease duration aligned with maximum bounded run |
| ~~Large-file memory~~ | **Shipped:** importer streams are hashed into bounded temporary storage | Keep provider adapters stream-first |
| ~~Import caps~~ | **Shipped v1.4.4:** max files, bytes/file, and bytes/run with reasoned skips | Consider a per-day cooldown/budget later |
| ~~Operator visibility~~ | **Shipped:** Room Options renders last run time, success/error, and bounded counts | Add site-wide cards only if operators request them |
| ~~Sync log admin~~ | **Shipped:** owner UI plus scoped REST/MCP inspect and confirmed clear | Keep list results bounded |
| ~~REST for room plugins~~ | **Shipped v1.4.4:** list/configure/remove/run/sync memory plus 30-tool MCP surface | Keep credentials redacted and scopes split |
| ~~Cross-worker poll timers~~ | **Shipped v1.4.4:** workers may schedule, but one lease-holder runs each bucket | Consider a dedicated runner only if scale requires it |
| **megajs unavailable** | Yarn installs the optional dependency normally, but an intentionally skipped optional install disables live sync | Add Plugins-tab/health diagnostics using existing catalog availability |

### Multi-host remote import (proposal — not shipped)

Design: **`core/plugins/REMOTE_HOST_IMPORTS.md`**.

- [x] Shared **`RemoteDownloaderRegistry`** (`canHandle` / `listFolder`) —
  Mega.nz and Pixeldrain providers
- [x] **`remote-import` plugin** — multi-URL list, caps, streamed ingest
- [ ] Pixeldrain shipped; Gofile remains pending
- [ ] Long-tail MediaFire / 4shared via plowshare shell bridge
- [x] Reuse **durable sync log** for all import plugins (same retention config)
- [ ] Non-goals: untrusted scraper marketplace; Playwright captcha farms; yt-dlp as file-locker core

---

## Federated multi-server mesh (v1 backbone shipped)

**Idea:** Independent Dicefiles operators (each with their own Node + Redis + disk) can **opt in** to a small trust mesh so a room on host **A** can mirror finished files from a room on host **B** the way today’s multi-room linking works *within* one server — without merging databases or requiring a shared filesystem.

This is **not** a single global network, crypto currency, or “join the public Dicefiles cloud.” It is **bilateral (or small-club) federation** between self-hosted peers that already trust each other (same org, allied hobby groups, backup host).

### Why

| Today | Gap |
| ----- | --- |
| Multi-room linking | Same server, same Redis, same file store |
| Automation API + webhooks | External bots can move files, but no first-class “linked row” UX across hosts |
| Plugins (Mega.nz Autoshare) | Pull from third-party lockers, not from another Dicefiles room |

Federation reuses the **linking mental model** users already know: Linked badge, fetch-through download/Read Now, source owns trash/moderation, destination never silently copies unless an explicit “materialize” tool is added later.

### Principles (mesh-specific)

1. **Opt-in both ways** — destination subscribes; remote source allows federation (mirror of “Allow room cross-linking,” but for peer hosts).
2. **Least privilege** — peer keys are scoped (e.g. `federation:read` + room allowlist), rotatable, never full admin.
3. **Ephemeral-honest** — remote TTL still wins; missing/denied/remote-down surfaces as Linking-style status, not silent empty forever.
4. **No shared Redis** — each host remains autonomous; mesh is HTTP(S) (+ optional signed webhooks), not a multi-master DB.
5. **Same UX chrome as local linking** where possible — one Linking table with a **Peer** column or `peerId::roomId` tokens.
6. **Human-scale mesh** — design for 2–20 peers, not open internet discovery.

### Identity & trust

| Piece | Proposal |
| ----- | -------- |
| **Peer id** | Stable slug or UUID configured by operator (`peerId`) |
| **Base URL** | `https://files.example.org` (TLS required for production peers) |
| **Auth** | RFC 9421 HTTP Message Signatures using a pinned RSA-3072 public key; no bearer peer secret |
| **Discovery** | Manual config only for v1 (no public peer directory) |
| **Handshake** | Public `GET /.well-known/dicefiles-federation`; signed `GET /api/federation/v1/hello` confirms bilateral trust |
| **Pairing** | Operator on A adds peer B (URL + key); operator on B allows peer A + optional room allowlist |

### What federates (v1 scope)

| Layer | In v1 | Out of v1 |
| ----- | ----- | --------- |
| Finished **file metadata** list | Yes (paginated) | Full chat history mesh |
| **Download / range / Read Now** bytes | Yes (proxy or signed redirect) | Transparent write-through of uploads to remote |
| Linked badge + source peer+room name | Yes | Unified global user accounts |
| Remote open **requests** | No (same non-goal as local linking v1) | Cross-host request fulfillment board |
| Bans / hellban / owners | No (local only) | Shared ban lists (maybe later, explicit product) |
| Guest invites | No | Cross-host invite redeem |
| Plugins run on remote | No | Remote triggers local Mega.nz bot |

### API sketch (on each peer)

Peer traffic uses the dedicated signed `/api/federation/v1/...` namespace.
Room-link management uses the ordinary scoped `/api/v1/...` automation API.

| Endpoint (illustrative) | Role |
| ----------------------- | ---- |
| `GET /api/federation/v1/hello` | Version, peerId, authenticated peer, capabilities |
| `GET /api/federation/v1/rooms/:roomId` | Privacy-safe metadata after peer allowlist and room consent |
| `GET /api/federation/v1/rooms/:roomId/files` | Finished files, cursor page, strict response shape |
| `GET/HEAD /api/federation/v1/files/:key?roomId=` | Same-origin signed stream with Range support |
| `POST /api/federation/v1/inbox` | Idempotent ActivityStreams invalidation receiver |

Destination host stores **federation link entries** analogous to `linkedRooms`:

```text
{ peerId, remoteRoomId, rules, nameHint, status }
```

Status: **Active** / **Peer unreachable** / **Denied** / **Room missing** / **Key invalid**.

### Client / product UX

- [x] Room Options → **Linking**: add source as **Local room** *or* **Remote peer + room**
- [x] File rows identify the trusted peer and remote source room
- [x] Open/download/Read Now use destination proxy so browser cookies stay local
- [ ] Operator config UI or `.config.json` for peers (URL, key, enabled)
- [x] Protected operator dashboard includes privacy-safe aggregate peer
  reachability and latency on its five-minute sampling interval

### Config sketch

```json
{
  "federation": {
    "enabled": false,
    "peerId": "my-site",
    "displayName": "Karlovo Files",
    "peers": [
      {
        "peerId": "allied-host",
        "baseUrl": "https://files.allied.example",
        "keyId": "https://files.allied.example/federation/actor#main-key",
        "publicKeyJwk": { "kty": "RSA", "alg": "RS256", "n": "...", "e": "AQAB" },
        "allowedRooms": ["*"],
        "enabled": true
      }
    ]
  }
}
```

Room-level: destination still needs an explicit link row (no automatic mesh of all rooms). Source rooms need **Allow federation** (or reuse/expand cross-linking with a “peers may link” flag).

### Implementation phases

| Phase | Deliverable |
| ----- | ----------- |
| **F0 — Spec & security** | **Shipped:** contract, SSRF boundary, pinned keys, replay protection, scope matrix |
| **F1 — Read API** | **Shipped:** hello, room metadata, cursor list, ranged file stream |
| **F2 — Destination linker** | **Shipped:** remote list merge, TTL enforcement, cache, status probe |
| **F3 — Client chrome** | **Shipped:** trusted-peer picker and local fetch-through URL |
| **F4 — Push optional** | **Shipped:** signed inbox plus durable, deduplicated Redis outbox with retry/backoff |
| **F5 — Ops** | **Shipped:** peer probes, aggregate status telemetry, bounded audit API, additive-key overlap, guided two-phase rotation |

### Security checklist (non-negotiable)

- [x] SSRF: only operator-configured peer base URLs; no user-supplied fetch targets
- [x] Rate limit federated list/download per peer identity
- [x] Cap max concurrent remote range streams; timeout + circuit breaker
- [x] Do not expose private rooms unless allowlisted and source flag on
- [x] Strip sensitive meta (uploader IP, accounts) from federated list
- [x] TLS for peer traffic outside explicit local/lab exceptions
- [x] Destination proxy keeps peer credentials and source cookies out of browsers

### Explicit non-goals

- Public peer discovery / “Dicefiles network”
- Merged Redis or shared upload volume
- Cross-host chat federation or global nicks
- Guaranteed strong consistency of remote lists
- E2E encrypted mesh (same tension as full-file E2E with previews)
- Automatic recursive multi-hop (A links B links C → A sees C) in v1 — **one hop only**

### Relation to existing features

| Feature | Relation |
| ------- | -------- |
| **Local multi-room linking** | UX and status model to clone; federation = remote transport |
| **Automation API** | Reuse auth patterns (scopes, rate limits, audit) |
| **Webhooks** | Optional push path for remote “file_uploaded” |
| **Plugins** | Stay local; do not run remote plugins; may later add “federation pull” plugin as alternative thin client |
| **A2A / MCP** | Capability advertisement only; not the data path |

### Checklist (implementation backlog)

- [x] F0 threat model and contract in `docs/FEDERATION.md` + `API.md`
- [x] F1 signed federation read endpoints
- [x] F2 destination remote link entries + list merge + probe
- [x] F3 Linking UI + server-side client fetch-through
- [x] F4 durable outbound push fan-out
- [x] F5 guided key rotation, peer/key diagnostics, and bounded audit API
- [x] Unit tests for config, identity, link mapping, signatures, and MCP tools
- [x] Isolated two-process federation smoke: trust, rules, privacy, ranged proxy
- [x] README “Optional trusted-host federation” section

---

## UI polish (room shell)

- [x] Sticky filters/sort; Read Now / archive / batch honesty; Giphy-only (**v1.4.1**)
- [x] Toolbar tokens, request+board pill, filter clear inside field (**v1.4.2**)
- [x] Room Options overhaul — tabs include **Invites** + **Plugins** (**v1.4.2**)
- [x] Dark-theme scrollbars; Linking number-input gutters (**v1.4.2**)
- [x] Invite generate row copy control sized to field (not modal `.icon` 64px)
- [x] Mobile layout pass for Room Options tabs, plugin editor, and dense plugin
  table
- [x] Plugin settings form validation with inline required/range feedback

---

## Explicitly lower priority (usually skip)

- [ ] Full mobile app
- [ ] Full-text content search of PDF bodies
- [ ] AI auto-tag / summarize
- [ ] E2E encryption of all files (breaks previews/readers/TTL story)
- [ ] Crypto / NFT anything
- [ ] Open public peer discovery for federation (mesh is **manual trust clubs**, not a global network)

---

## Design principles

1. Rooms stay rooms; linking is a **view**, not a second FS — **including across federated peers**.
2. Prefer opt-in room admin / server config over global surprises.
3. Prefer sticky daily habits (resume, deep links, digests) over novelty.
4. Automation/API should match how communities already glue Discord bots.
5. Source rooms must **opt in** before others can mirror their files (local or remote peer).
6. Bots are visible as bots (identity + pill); import side effects are rate- and size-bounded.
7. Skip/dedupe for importers must survive restarts (durable log + retention).
8. Federation is **bilateral trust + least privilege**, never a shared database or public mesh.

---

## Notes by release

| Release | Shipped (high level) |
| ------- | -------------------- |
| **v1.4.0** | Redis v4, Yarn/Node 20, virtualized lists, lazy readers, richer `/healthz` |
| **v1.4.1** | Sticky filters/sort, Read Now / archive / batch honesty, Giphy-only |
| **v1.4.2** | Multi-room linking, request board, deep links, guest invites, plugins/bots/Mega.nz, Room Options tabs, webhooks expansions, docs reorg |
| **v1.4.3** | Since Your Last Visit continuity, protected status dashboard, Discord/Telegram release publishers, linked-room and guest-invite automation, 20-tool MCP |
| **v1.4.4** | Complete trusted-host federation operations, 30-tool MCP, scoped room-bot automation, streamed multi-host imports, import caps/leases/run status, authenticated Discord/Telegram commands |

### Still open (product)

- Session kits; spoiler/reveal; room templates + clone
- Operator dashboard additions for per-plugin cards (federation peer aggregate is shipped)
- Multi-host import ladder beyond Mega.nz and Pixeldrain
### Config worth remembering

| Key | Default | Role |
| --- | ------- | ---- |
| `pluginSyncLogRetentionDays` | `30` | Durable skip-log TTL for plugin imports |
| `pollIntervalMinutes` | per bot (e.g. 15) | Mega.nz (and room plugins) poll cadence; `0` = manual only |
| `plugins` / room `roomPlugins` | `[]` | Global vs per-room bot invites |
