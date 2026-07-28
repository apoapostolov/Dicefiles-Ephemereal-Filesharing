# Future Development Plan (Dicefiles)

Working backlog of product ideas that fit self-hosted room chat + ephemeral filesharing.

| Mark | Meaning |
| ---- | ------- |
| `[x]` | Shipped / done (in a released tag unless noted) |
| `[ ]` | Proposal only — not implemented |

Plugin docs: `core/plugins/`. Formerly `feature_creep_proposal.md`.

**Last updated:** 2026-07-28 — v1.4.3 “Since Your Last Visit” ships continuity,
protected service telemetry, release publishers, and linked-room/guest-invite
automation; **Federated multi-server mesh** remains a designed future feature.

---

## Priority shortlist

- [x] Multi-room linking (files mirror, one-way, badge, source ownership) — **v1.4.2**; source must **Allow Room Cross-Linking**
- [x] Deep links with intent (`filter` / `sort` / `request` / file open) — room option — **v1.4.2**
- [x] Resume strip + “what’s new since last visit” productization — **v1.4.3**
- [ ] Session kit pack (select → zip + index)
- [x] Request board polish — **v1.4.2** first-class board + filters + segmented toolbar pill
- [ ] Spoiler / delayed reveal
- [ ] Room templates + clone
- [x] Guest invite links (single-use / max X / max Y hours) — Room Options → **Invites** — **v1.4.2**
- [x] Privacy-safe operator dashboard beyond `/healthz`, protected by a generated capability link by default — **v1.4.3**
- [x] Webhooks + plugin system (Mega.nz Autoshare, BOT pills, Room Options → **Plugins**) — **v1.4.2**
- [x] Durable plugin sync skip-log (name+size, Redis, configurable retention) — **v1.4.3**
- [ ] Multi-host remote import (MediaFire, 4shared, Pixeldrain, Gofile, …) — design: `core/plugins/REMOTE_HOST_IMPORTS.md`
- [ ] Plugin import safety: size/file caps, worker lock, hash-level skip (see gaps below)
- [ ] **Federated multi-server mesh** — opt-in peer Dicefiles instances; remote room link + fetch-through (see full section)

---

## Multi-room linking

**Idea:** Admin links room A → room B. Files from B appear in A marked as linked, without users needing to join B.

- [x] One-way mirror: A subscribes to B (**Linking** tab; B enables **Allow Room Cross-Linking**)
- [x] Linked badge (source room name / “linked”)
- [x] Download / Read Now through source ownership
- [x] Delete/moderation stays on **source** room
- [x] Linked rooms accept **room id or exact room name**
- [x] Source opt-in gate
- [x] Per-link filters: filename (comma OR), tag, types grid, max/min age hours
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

## Packs & exports

- [ ] **Session kit pack** — multi-select → zip + short index (titles, tags, room)
- [ ] Kit pack includes linked-row awareness (export native only vs fetch-through — decide)

---

## Room ops & privacy

- [ ] **Spoiler / delayed reveal**
- [ ] **Room templates + clone** (tools, rules pin, requests, linking, invited plugins snapshot?)
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

- [ ] **Operator dashboard** — disk, room count, prune candidates, rate-limit hits, preview queue, **plugin last-run / errors**
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
- [x] **Durable sync log** — Redis ZSET of name+size per plugin/room/source; skip re-upload across restarts (`lib/plugins/sync-log.js`)
- [x] **App config** `pluginSyncLogRetentionDays` (default **30**, clamp 1–730) — prune expired skip records
- [x] In-process cache mirrors durable log for hot polls

### Plugin / bot gaps (discovered — **must plan**)

These are not covered by a clear backlog item yet; add them before calling plugins “production-hard.”

| Gap | Why it matters | Suggested direction |
| --- | -------------- | ------------------- |
| **Skip key is name+size only** | Same name, rewritten content (same size) or rename edge cases | Optional content hash after download; or Mega.nz node id if SDK exposes stable ids |
| **No skip against existing room files** | File already uploaded by a human → bot may still import | Pre-check room list / hash registry before download |
| **Multi-worker race** | Two HTTP workers can both miss the log and double-upload | Redis lock around sync run per scope (`SET NX` / short TTL) |
| **Large-file memory** | Mega.nz path buffers full file then `ingestFromBuffer` | Stream/temp-file path for big folders |
| **Import caps** | A huge Mega.nz folder can flood a room / disk | Config: max files per run, max bytes per file/run, cooldown |
| **Operator visibility** | No last-run, skip counts, or errors in UI | Plugins tab: last run time, last error, uploaded/skipped last run |
| **Sync log admin** | Operators cannot clear or inspect skip log | Admin/API or Plugins tab: “clear skip memory for this bot” |
| **REST for room plugins** | Only socket `setconfig` today | Automation scopes for list/invite/run room plugins |
| **Cross-worker poll timers** | Each process that loads the room may schedule polls | Leader election or single “plugin runner” worker |
| **megajs not installed** | Live Mega.nz sync fails until optional dep present | Clearer Plugins-tab warning / healthz plugin readiness |

### Multi-host remote import (proposal — not shipped)

Design: **`core/plugins/REMOTE_HOST_IMPORTS.md`**.

- [ ] Shared **`RemoteDownloader`** (`canHandle` / `listFolder` / `download`) — Mega.nz first provider
- [ ] **`remote-import` plugin** — multi-URL list, caps, source URL in meta
- [ ] Pixeldrain / Gofile (HTTP APIs)
- [ ] Long-tail MediaFire / 4shared via plowshare shell bridge
- [ ] Reuse **durable sync log** for all import plugins (same retention config)
- [ ] Non-goals: untrusted scraper marketplace; Playwright captcha farms; yt-dlp as file-locker core

---

## Federated multi-server mesh (proposal — not shipped)

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
| **Auth** | Long-lived peer API key (hashed at rest) **or** mutual mTLS later; v1 = Bearer peer key |
| **Discovery** | Manual config only for v1 (no public peer directory) |
| **Handshake** | `GET /.well-known/dicefiles-federation` or extend `/.well-known/a2a` with federation capability + version |
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

All under existing automation style (`/api/v1/...`) with new scopes, e.g. `federation:rooms:read`, `federation:files:read`.

| Endpoint (illustrative) | Role |
| ----------------------- | ---- |
| `GET /api/v1/federation/hello` | Version, peerId, public name, capabilities |
| `GET /api/v1/federation/rooms/:roomId/meta` | Room display name, allowCrossLinking-equivalent, federation allow for this peer |
| `GET /api/v1/federation/rooms/:roomId/files` | Finished files matching query (cursor page); apply remote filters server-side |
| `GET /api/v1/federation/files/:key` | Stream or 302 to short-lived signed URL; Range support |
| `GET /api/v1/federation/files/:key/meta` | Type, size, name, tags subset safe to expose |
| Optional `POST /api/v1/federation/hooks` | Peer registers for `file_uploaded` on allowed rooms (push vs poll) |

Destination host stores **federation link entries** analogous to `linkedRooms`:

```text
{ peerId, remoteRoomId, rules, nameHint, status }
```

Status: **Active** / **Peer unreachable** / **Denied** / **Room missing** / **Key invalid**.

### Client / product UX

- [ ] Room Options → **Linking**: add source as **Local room** *or* **Remote peer + room**
- [ ] File rows: `Linked · peerName/roomName` (distinct from local linked)
- [ ] Open/download/Read Now use destination proxy so browser cookies stay local
- [ ] Operator config UI or `.config.json` for peers (URL, key, enabled)
- [ ] `/healthz` (or operator dashboard) includes peer reachability summary

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
        "apiKey": "...",
        "enabled": true
      }
    ],
    "allowPeers": [
      {
        "peerId": "allied-host",
        "roomAllowlist": ["*"],
        "maxListPage": 200
      }
    ]
  }
}
```

Room-level: destination still needs an explicit link row (no automatic mesh of all rooms). Source rooms need **Allow federation** (or reuse/expand cross-linking with a “peers may link” flag).

### Implementation phases

| Phase | Deliverable |
| ----- | ----------- |
| **F0 — Spec & security** | Threat model (key leak, SSRF via baseUrl, open proxy abuse); scope matrix; handshake schema |
| **F1 — Read API** | hello + room meta + file list + file stream on one host; contract tests |
| **F2 — Destination linker** | Server-side remote list merge into room file list; status probe; unit tests with fake peer |
| **F3 — Client chrome** | Linking tab peer picker; linked badge; download/Read Now path |
| **F4 — Push optional** | Webhook or federation hook so destinations invalidate cache without polling |
| **F5 — Ops** | Health peers, key rotation, rate limits per peer, audit log of federated fetches |

### Security checklist (non-negotiable)

- [ ] SSRF: only operator-configured peer base URLs; no user-supplied fetch targets
- [ ] Rate limit federated list/download per peer key
- [ ] Cap max concurrent remote range streams; timeout + circuit breaker
- [ ] Do not expose private rooms unless allowlisted and source flag on
- [ ] Strip sensitive meta (uploader IP, accounts) from federated list by default
- [ ] TLS for peer traffic outside lab
- [ ] Signed short-lived download URLs if redirecting browsers to origin host

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

- [ ] F0 threat model + OpenAPI-ish contract in `API.md` (or `docs/FEDERATION.md` when coding starts)
- [ ] F1 federation read endpoints + scopes
- [ ] F2 destination remote link entries + list merge + probe
- [ ] F3 Linking UI + client fetch-through
- [ ] F4 optional push invalidation
- [ ] F5 ops: health, rotation, limits, audit
- [ ] Unit tests with fake peer; integration test two processes in CI-less manual recipe
- [ ] README “Federation (optional)” section when F3 lands

---

## UI polish (room shell)

- [x] Sticky filters/sort; Read Now / archive / batch honesty; Giphy-only (**v1.4.1**)
- [x] Toolbar tokens, request+board pill, filter clear inside field (**v1.4.2**)
- [x] Room Options overhaul — tabs include **Invites** + **Plugins** (**v1.4.2**)
- [x] Dark-theme scrollbars; Linking number-input gutters (**v1.4.2**)
- [x] Invite generate row copy control sized to field (not modal `.icon` 64px)
- [ ] Mobile layout pass for Room Options tabs (dense tables on small screens)
- [ ] Plugins settings form validation UX (inline errors vs modal only)

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

### Still open (product)

- Session kits; spoiler/reveal; room templates + clone
- Operator dashboard (include plugin health **and federation peer status**)
- Multi-host import ladder
- Plugin production-hardening gaps table above
- **Federated multi-server mesh** (full section; F0–F5 phases)
### Config worth remembering

| Key | Default | Role |
| --- | ------- | ---- |
| `pluginSyncLogRetentionDays` | `30` | Durable skip-log TTL for plugin imports |
| `pollIntervalMinutes` | per bot (e.g. 15) | Mega.nz (and room plugins) poll cadence; `0` = manual only |
| `plugins` / room `roomPlugins` | `[]` | Global vs per-room bot invites |
