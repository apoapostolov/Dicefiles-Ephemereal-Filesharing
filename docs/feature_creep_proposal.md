# Feature creep proposals (Dicefiles)

Working backlog of product ideas that fit self-hosted room chat + ephemeral filesharing.
Checked = shipped / done. Unchecked = proposal only (not implemented unless marked later).

Last updated: 2026-07-27 (v1.4.2 multi-room / board / deep links + cross-link permission + tools spacing).

---

## Priority shortlist (build order if you care)

- [x] Multi-room linking (files mirror, one-way, badge, source ownership) — **v1.4.2**; source must **Allow Room Cross-Linking**
- [x] Deep links with intent (`filter` / `sort` / `request` / file open) — room admin panel opt-in — **v1.4.2**
- [ ] Resume strip + “what’s new since last visit” productization
- [ ] Session kit pack (select → zip + index)
- [x] Request board polish (if requests are core to your users) — **v1.4.2** first-class board + filters
- [ ] Spoiler / delayed reveal
- [ ] Room templates + clone
- [ ] Guest invite links for exactly one person (expires after use), for up to X users, for up to X hours
- [ ] Operator dashboard beyond `/healthz`
- [ ] Webhooks/automation events for real bots (incl. linked-file events) - this is important, plugin system that allows to add plugins that - download files from Mega.nz folders, as first example first-class plugin

---

## Multi-room linking

**Idea:** Admin links room A → room B. Files from B appear in A marked as linked, without users needing to join B.

- [x] One-way mirror: A subscribes to B (A owner/mod configures **Linked rooms**; B owner enables **Allow Room Cross-Linking**)
- [x] Linked badge (source room name / “linked”) — not native A uploads
- [x] Download / Read Now through source ownership
- [x] Delete/moderation stays on **source** room
- [x] Linked rooms accept **room id or exact room name** (comma-separated; multi-word names OK)
- [x] Source opt-in gate: without **Allow Room Cross-Linking**, destination lists zero files from that source (knowing id/name is not enough)
- [x] Optional filters / rules per link — filename contains, tag contains, allowed type(s), max age (no older than), min age (older than); empty = all finished files
- [x] TTL / pruning follow **source** room (no second disk copy — view/fetch-through)
- [ ] ACL: richer rules (who can see linked rows, hellban/private rooms beyond source opt-in)
- [x] List noise / virtualization when A pulls many from B — general large-room virtualization applies to merged list
- [x] Explicit non-goal for v1: open requests cross-room (files only)
- [x] Failures: B gone / cross-link off → Linking table status (Missing / Cross-link off); file list contributes zero until fixed
- [ ] Automation API: list / create / remove links
- [x] Design / pure helpers + unit tests (`lib/room/room-links.js`: entries, rules match, status, resolve)
- [x] Room Options **Linking** tab with table of linked rooms (add/edit/remove + per-row rules editor)

**v1 sketch (shipped)**

| Piece | v1 (shipped) |
|-------|----------------|
| Who configures | Owner/mod of A: **Linking** tab table; B owner enables **Allow Room Cross-Linking** (default off) |
| What appears | Finished uploads from B matching per-link rules, `linked` + source room name — only if B allows cross-linking |
| What doesn’t | Chat, users, bans, open requests |
| Actions in A | Open, Read Now, download, filter; trash stays source-owned |
| Storage model | View / metadata mirror, not a second filesystem |
| Link tokens | Room ids **or** exact room names (resolved on save) |
| Per-link rules | nameContains, tagContains, types[], maxAgeHours, minAgeHours |

---

## Continuity & discovery

- [ ] **Continue where I left off** — resume PDF/comic strip + “N new since last visit” that jumps filter
- [x] **Shareable deep links with intent** — query/hash `file` / `filter` / `sort` / `request` when room option **Shareable deep links** is on; bare gallery `#fileKey` always works. Open intents wait for file list (`resolveDeepLinkOpenPlan`) so config-before-files does not drop the open.
- [ ] **What’s new while I was away** digest — file-level (new uploads, fulfilled requests, linked-room deltas); not full chat AI summary

---

## Requests

- [x] **Request board that scales** — first-class board (open/fulfilled filters, Open → existing request view); hidden when **Allow Requests** is off

---

## Packs & exports

- [ ] **Session kit pack** — multi-select → zip (or named batch) + short HTML/text index (titles, tags, room)

---

## Room ops & privacy

- [ ] **Spoiler / delayed reveal** — owner/mod-only until time or manual reveal (or password)
- [ ] **Room templates + clone** — tools bar, rules pin, request on, link archive on
- [ ] **Guest join friction** — one-time invite link with role/expiry (e.g. upload-only, no chat)

---

## Operator & automation

- [ ] **Operator dashboard** — disk, room count, prune candidates, automation rate-limit hits, preview queue (beyond `/healthz`)
- [ ] **Webhooks / automation events** — `file.uploaded`, `request.opened/fulfilled`, `room.pruned`, `linked.file.appeared`

---

## UI polish (room shell)

- [x] Sticky type filters / text filter / show-new / sort across reloads (**v1.4.1**)
- [x] Gallery Read Now loading + keyboard **R**; archive empty/error honesty; batch download empty-queue honesty (**v1.4.1**)
- [x] Giphy-only GIF search after Tenor API sunset (**v1.4.1**)
- [x] Stable filter field width (no focus grow/shrink) (**v1.4.1**)
- [x] Tools bar spacing: uniform gap between buttons, pills, and fields (`--tools-gap`) — ad-hoc side margins removed

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
- **v1.4.2** — multi-room linking, request board, admin-gated deep links (+ deep-link open race fix). Tag: `v1.4.2` / commit includes race fix.
- **Post-1.4.2 (unreleased / working tree):** **Allow Room Cross-Linking** source opt-in; linked rooms by **id or exact name**; tools-bar margin standardization.
- Still open from multi-room v1 sketch: per-link type filters, grey-out unlink UX, richer ACL, automation API for links.
