# Feature creep proposals (Dicefiles)

Working backlog of product ideas that fit self-hosted room chat + ephemeral filesharing.
Checked = shipped / done. Unchecked = proposal only (not implemented unless marked later).

Last updated: 2026-07-27 (from product discussion after v1.4.1 UI polish).

---

## Priority shortlist (build order if you care)

- [ ] Multi-room linking (files mirror, one-way, badge, source ownership)
- [ ] Deep links with intent (`filter` / `sort` / `request` / resume) — room admin panel opt-in
- [ ] Resume strip + “what’s new since last visit” productization
- [ ] Session kit pack (select → zip + index)
- [ ] Request board polish (if requests are core to your users)
- [ ] Spoiler / delayed reveal
- [ ] Room templates + clone
- [ ] Guest invite links
- [ ] Operator dashboard beyond `/healthz`
- [ ] Webhooks/automation events for real bots (incl. linked-file events)

---

## Multi-room linking

**Idea:** Admin links room A → room B. Files from B appear in A marked as linked, without users needing to join B.

- [ ] One-way mirror: A subscribes to B (A owner/mod + permission from B)
- [ ] Linked badge (source room name / “linked”) — not native A uploads
- [ ] Download / Read Now through source ownership
- [ ] Delete/moderation stays on **source** room
- [ ] Optional filters (e.g. docs/images only; finished uploads only)
- [ ] TTL / pruning follow **source** room (no second disk copy)
- [ ] ACL: who can link, who can see, hellban/private rooms
- [ ] List noise / virtualization when A pulls many from B
- [ ] Explicit non-goal for v1: open requests cross-room (files only)
- [ ] Failures: B gone / unlinked → grey out then drop
- [ ] Automation API: list / create / remove links
- [ ] Design doc (permissions + list UX + engine storage) before code

**v1 sketch**

| Piece | v1 |
|-------|----|
| Who configures | Owner/mod of A; allow-link from B owner (or server admin) |
| What appears | Finished uploads from B in A’s list, `linked` + source room |
| What doesn’t | Chat, users, bans, open requests |
| Actions in A | Open, Read Now, download, filter; no trash unless also B mod |
| Storage model | View / metadata mirror, not a second filesystem |

---

## Continuity & discovery

- [ ] **Continue where I left off** — resume PDF/comic strip + “N new since last visit” that jumps filter
- [ ] **Shareable deep links with intent** — e.g. `/r/room#file=…`, `?filter=docs&sort=newest`, `?request=…` (only if enabled in room admin panel)
- [ ] **What’s new while I was away** digest — file-level (new uploads, fulfilled requests, linked-room deltas); not full chat AI summary

---

## Requests

- [ ] **Request board that scales** — first-class board (status, claim, age, fulfill-with-upload), not only file-list tiles

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

---

## Notes

- Shipped recently (not on this backlog as open work): v1.4.1 room UI polish (sticky filters/sort, Read Now / archive / batch feedback, Giphy-only GIF search after Tenor API sunset, stable filter field width).
- Goal in flight at discussion time: multi-room linking + request board + shareable deep links (admin-panel gated) → release 0.0.+1.
