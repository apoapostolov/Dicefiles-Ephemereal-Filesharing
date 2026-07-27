# Future Development Plan (Dicefiles)

Working backlog of product ideas that fit self-hosted room chat + ephemeral filesharing.
Checked = shipped / done. Unchecked = proposal only (not implemented unless marked later).

Formerly `feature_creep_proposal.md`. Plugin docs: `core/plugins/`.

Last updated: 2026-07-27 (Invites tab, Room Options Plugins, bots, guest invites, multi-room linking 1.4.2).

---

## Priority shortlist (build order if you care)

- [x] Multi-room linking (files mirror, one-way, badge, source ownership) — **v1.4.2**; source must **Allow Room Cross-Linking**
- [x] Deep links with intent (`filter` / `sort` / `request` / file open) — room admin panel opt-in — **v1.4.2**
- [ ] Resume strip + “what’s new since last visit” productization
- [ ] Session kit pack (select → zip + index)
- [x] Request board polish (if requests are core to your users) — **v1.4.2** first-class board + filters + segmented toolbar pill
- [ ] Spoiler / delayed reveal
- [ ] Room templates + clone
- [x] Guest invite links for exactly one person (expires after use), for up to X users, for up to X hours — Room Options → **Invites** tab; `/r/:id?invite=`; guest pass after redeem; owner RPC returns mint/list payload (**working tree**, not yet in a tagged release)
- [ ] Operator dashboard beyond `/healthz`
- [x] Webhooks/automation events for real bots (incl. linked-file events) + first-class plugin system (Mega Autoshare) — Room Options → **Plugins**; docs in `core/plugins/`; production `startAll` + room bot runtime (**working tree**)
- [ ] Multi-host remote import (MediaFire, 4shared, Pixeldrain, Gofile, …) on shared `RemoteDownloader` + optional plowshare shell bridge — design: `core/plugins/REMOTE_HOST_IMPORTS.md`

---

## Multi-room linking

**Idea:** Admin links room A → room B. Files from B appear in A marked as linked, without users needing to join B.

- [x] One-way mirror: A subscribes to B (A owner/mod configures **Linking** tab; B owner enables **Allow Room Cross-Linking**)
- [x] Linked badge (source room name / “linked”) — not native A uploads
- [x] Download / Read Now through source ownership
- [x] Delete/moderation stays on **source** room
- [x] Linked rooms accept **room id or exact room name** (resolved on save; multi-word names OK)
- [x] Source opt-in gate: without **Allow Room Cross-Linking**, destination lists zero files from that source (knowing id/name is not enough)
- [x] Optional filters / rules per link:
  - filename contains — **comma-separated terms, match any**
  - tag contains
  - allowed type(s) — Image / Video / Audio / Document / Archive / Other (**3×2 grid**; none = all)
  - max age (no older than hours) / min age (at least this old hours)
  - empty rules = all finished files
- [x] TTL / pruning follow **source** room (no second disk copy — view/fetch-through)
- [ ] ACL: richer rules (who can see linked rows, hellban/private rooms beyond source opt-in)
- [x] List noise / virtualization when A pulls many from B — general large-room virtualization applies to merged list
- [x] Explicit non-goal for v1: open requests cross-room (files only)
- [x] Failures: B gone / cross-link off → Linking table status (**Active** / **Cross-link off** / **Missing**); file list contributes zero until fixed
- [ ] Automation API: list / create / remove links
- [x] Design / pure helpers + unit tests (`lib/room/room-links.js`: entries, rules match, multi-term name, status, resolve)
- [x] Room Options **Linking** tab with table of linked rooms (add/edit/remove + per-row rules editor)
- [x] Linking tab **?** help panel (how it works, status, filters, short examples)
- [x] General tab: **?** after **Allow room cross-linking** label (source opt-in explanation; not always-visible blurb)

**v1 sketch (shipped)**

| Piece | v1 (shipped) |
|-------|----------------|
| Who configures | Owner/mod of A: **Linking** tab table; B owner enables **Allow Room Cross-Linking** (default off) |
| What appears | Finished uploads from B matching per-link rules, `linked` + source room name — only if B allows cross-linking |
| What doesn’t | Chat, users, bans, open requests |
| Actions in A | Open, Read Now, download, filter; trash stays source-owned |
| Storage model | View / metadata mirror, not a second filesystem |
| Link tokens | Room ids **or** exact room names (resolved on save) |
| Per-link rules | `nameContains` (comma OR), `tagContains`, `types[]`, `maxAgeHours`, `minAgeHours` |
| Status | Active / Cross-link off / Missing (`probelinks`) |

---

## Continuity & discovery

- [ ] **Continue where I left off** — resume PDF/comic strip + “N new since last visit” that jumps filter
- [x] **Shareable deep links with intent** — query/hash `file` / `filter` / `sort` / `request` when room option **Shareable deep links** is on; bare gallery `#fileKey` always works. Open intents wait for file list (`resolveDeepLinkOpenPlan`) so config-before-files does not drop the open.
- [ ] **What’s new while I was away** digest — file-level (new uploads, fulfilled requests, linked-room deltas); not full chat AI summary

---

## Requests

- [x] **Request board that scales** — first-class board (open/fulfilled filters, Open → existing request view); hidden when **Allow Requests** is off; Create + Board as a segmented toolbar pill

---

## Packs & exports

- [ ] **Session kit pack** — multi-select → zip (or named batch) + short HTML/text index (titles, tags, room)

---

## Room ops & privacy

- [ ] **Spoiler / delayed reveal** — owner/mod-only until time or manual reveal (or password)
- [ ] **Room templates + clone** — tools bar, rules pin, request on, link archive on
- [x] **Guest join friction** — guest invite links (invite-only rooms)

### Guest invite links (shipped in working tree)

- [x] Modes: single-use (max 1), max X uses, max Y hours from mint (90-day cap)
- [x] Pure token helpers + unit tests (`lib/room/guest-invites.js`, `tests/unit/guest-invites.test.js`)
- [x] Room config storage (`guestInvites` + guest pass after redeem)
- [x] Owner/mod mint / list / revoke via `setconfig` (`createGuestInvite`, `listGuestInvites`, `revokeGuestInvite`)
- [x] Redeem on HTTP + WS join: `/r/:id?invite=TOKEN` (also `guestInvite` query alias)
- [x] Guest pass so multi-use invites are not re-consumed on every refresh of the same session key
- [x] Room Options → **Invites** tab: generate field + limits panel + list with `i-copy` + revoke
- [x] Webhook events: `guest_invite_created`, `guest_invite_redeemed`
- [x] API notes: `API.md` § guest invites
- [x] Owner RPC: `onsetconfig` forwards `setConfig` return so `makeCall("setconfig", "createGuestInvite"|"listGuestInvites")` resolves with path/tokenFull (`tests/unit/guest-invite-rpc.test.js`)

---

## Operator & automation

- [ ] **Operator dashboard** — disk, room count, prune candidates, automation rate-limit hits, preview queue (beyond `/healthz`)
- [x] **Webhooks / automation events** + **plugin system** (working tree)

### Webhooks (expanded)

- [x] Existing events retained: `file_uploaded`, `request_*`, `file_deleted`, …
- [x] `linked_file_appeared` — when a source upload becomes visible on a destination via multi-room link (`notifyLinkedDestinations`)
- [x] `guest_invite_created` / `guest_invite_redeemed`
- [x] `VALID_EVENTS` + normalize/dispatch unit tests (`tests/unit/webhooks-events.test.js`)
- [x] Defaults / `API.md` event list updated

### Plugin system + Mega.nz

- [x] First-class `PluginRegistry` (`lib/plugins/registry.js`): load from config, hooks, `startAll` / `run`
- [x] Builtin id `mega-folder` (`lib/plugins/mega-folder/index.js`) with injectable `megaDownloader` + `uploadFile` for tests / workers
- [x] Server bootstrap: `buildPluginRuntimeCtx` wires **`uploadFile`** (`ingestFromBuffer` + `Room.get`) and **`megaDownloader`** (`createMegaDownloader` / optional `megajs`) on `startAll` so `scheduleRun` → `run` does not miss adapters
- [x] Room Options → **Plugins** tab: invite bots from catalog, per-room settings, enable/run/remove (`roomPlugins` + `room-runtime`)
- [x] Bot identity: cyan **BOT** pill + bot display name on plugin uploads
- [x] Developer docs: `core/plugins/DEVELOPING_PLUGINS.md`, `core/plugins/MEGA_FOLDER.md`
- [x] Unit tests: registry + Mega inject (`tests/unit/plugins.test.js`); adapters + room-plugins (`tests/unit/runtime-adapters.test.js`, `tests/unit/room-plugins.test.js`)
- [x] `megajs` listed under `optionalDependencies` for live Mega folder sync

### Multi-host remote import (proposal — not shipped)

Communities paste locker links, not only Mega. Design sketch: **`core/plugins/REMOTE_HOST_IMPORTS.md`**.

- [ ] Shared **`RemoteDownloader`** contract (`canHandle` / `listFolder` / per-entry `download`) — Mega becomes first provider; stop special-casing `ctx.megaDownloader` long-term
- [ ] **`remote-import` plugin** — multi-URL list → room, size/file caps, source URL in upload meta
- [ ] Easy hosts first (official HTTP APIs): **Pixeldrain**, **Gofile** (no heavy SDK)
- [ ] **Mega** remains first-class via **megajs** (optionalDep; already wired)
- [ ] Long-tail free lockers (**MediaFire**, **4shared** / “4storage”): prefer **shell bridge** to [plowshare](https://github.com/mcrapet/plowshare) / host CLIs rather than fragile in-repo scrapers
- [ ] Optional MEGAcmd shell path for operators who already install Mega’s official CLI
- [ ] Explicit non-goals: untrusted scraper marketplace in core; Playwright for captcha farms; yt-dlp as primary file-locker path

---

## UI polish (room shell)

- [x] Sticky type filters / text filter / show-new / sort across reloads (**v1.4.1**)
- [x] Gallery Read Now loading + keyboard **R**; archive empty/error honesty; batch download empty-queue honesty (**v1.4.1**)
- [x] Giphy-only GIF search after Tenor API sunset (**v1.4.1**)
- [x] Stable filter field width (no focus grow/shrink) (**v1.4.1**)
- [x] Tools bar spacing: uniform gap tokens (`--tools-gap`); no double-gap spacer (**v1.4.2**)
- [x] Tools bar control height / icon size / radius tokens; request + board as segmented pill (**v1.4.2**)
- [x] Filter clear (X) **inside** the filter field (no toolbar width jump) (**v1.4.2**)
- [x] Filter field flex-grows to fill space before action pills (**v1.4.2**)
- [x] Room Options overhaul: tabbed General / Linking, section cards, capped width (**v1.4.2**)
- [x] Dark-theme product scrollbars (native + custom scroller thumb) (**v1.4.2**)
- [x] Number inputs in Linking rules: no vertical scrollbars / spin gutters (**v1.4.2**)

---

## Explicitly lower priority (usually skip)

- [ ] Full mobile app
- [ ] Full-text content search of PDF bodies
- [ ] AI auto-tag / summarize
- [ ] E2E encryption of all files (breaks previews/readers/TTL story)
- [ ] Federated multi-server mesh
- [ ] Crypto / NFT anything

---

## Design principles for any creep

1. Rooms stay rooms; linking is a **view**, not a second FS.
2. Prefer opt-in room admin / server config over global surprises.
3. Prefer sticky daily habits (resume, deep links, digests) over novelty.
4. Automation/API should match how communities already glue Discord bots.
5. Source rooms must **opt in** before others can mirror their files (id/name alone is not consent).

---

## Notes

- **v1.4.1** — room UI polish (sticky filters/sort, Read Now / archive / batch feedback, Giphy-only GIF search after Tenor API sunset, stable filter field width).
- **v1.4.2** (tagged): multi-room linking with source opt-in, **Linking** tab + per-link rules/status/help, request board pill, shareable deep links, Room Options redesign, toolbar polish, dark scrollbars.
- **Post-v1.4.2 working tree (not tagged yet):** Room Options **Invites** + **Plugins** tabs; guest invite mint/list/revoke/redeem + `i-copy`; bots with cyan BOT pill; Mega Autoshare; webhooks `linked_file_appeared` + `guest_invite_*`; plugin docs in `core/plugins/`.
- **Still open (multi-room):** richer ACL beyond cross-link opt-in; automation API for list/create/remove links.
- **Still open (product):** resume / “what’s new” digests, session kits, spoiler/delayed reveal, room templates + clone, operator dashboard beyond `/healthz`.
- **Still open (import hosts):** multi-host remote import beyond Mega — Pixeldrain/Gofile native, MediaFire/4shared via shell/plowshare; see `core/plugins/REMOTE_HOST_IMPORTS.md`.

