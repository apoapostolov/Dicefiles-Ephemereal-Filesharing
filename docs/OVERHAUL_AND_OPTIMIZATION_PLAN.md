# Dicefiles — Code Overhaul & Optimization Plan

**Version:** 1.1  
**Target codebase:** Dicefiles 1.4.0 (`apoapostolov/Dicefiles-Ephemereal-Filesharing`)  
**Date:** 2026-07-27  
**Status:** Phases 0–5 implemented (2026-07-27)

---

## 1. Executive summary

Dicefiles is a mature, feature-rich fork of Volafile/Kregfile: real-time rooms, ephemeral uploads, previews, in-browser readers, archive viewer, automation API, MCP server, achievements, and moderation. The product surface is strong; the engineering substrate is a **layered monolith of large CommonJS/ESM modules**, an **aging dependency graph** (especially Redis 3.x and webpack loaders), and **weak continuous verification** (CI workflows intentionally removed).

This plan is an **incremental, risk-bounded overhaul** — not a rewrite. Goals, in order:

1. **Safety net** — reproducible installs, test baseline, optional CI  
2. **Structural modularity** — shrink god-files without behavior change  
3. **Dependency modernization** — security and maintainability  
4. **Runtime & client performance** — hot paths under real room load  
5. **Ops & DX** — observability, release, contributor friction  

**Non-goals for this plan:**

- Rewriting in TypeScript end-to-end in one go  
- Replacing Express / Socket.IO / Redis with different stacks  
- Redesigning the product UI or chat protocol  
- Restoring CI against maintainer intent without explicit approval  

---

## 2. Architecture snapshot (as-is)

```text
                    ┌─────────────────────────────────────┐
                    │  server.js (cluster master)         │
                    │  N × HTTP workers + 1 expiration    │
                    └──────────────┬──────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
   lib/httpserver.js         lib/expiration.js        lib/client.js
   Express + routes +        TTL / room prune         Socket.IO session
   automation API                                       │
          │                        │                    ▼
          │                        │              lib/room/* + upload
          ▼                        ▼                    │
   lib/upload.js ◄────────── lib/meta.js          Redis broker
   lib/storage.js            previews/covers       lib/broker/*
   lib/archive.js            comics/docs           Lua scripts
          │
          ▼
   filesystem uploads/   +   Redis state (maps/sets/rate limits)

Client (webpack → static/):
  entries/main.js → client/* (files.js, reader, chat, roomie, …)
  views/*.ejs
```

### 2.1 Size & concentration risk

| Area | Approx. LOC | Role | Risk |
|------|-------------|------|------|
| `lib/httpserver.js` | ~2,200 | All HTTP routes, automation, pages, WS setup | Hard to test, review, and reason about |
| `client/files/reader.js` | ~2,274 | PDF/EPUB/MOBI/comic reader | Bundle weight; change blast radius |
| `lib/meta.js` | ~1,961 | Metadata + preview generation | Process spawning; security surface |
| `client/files.js` | ~1,940 | File list, filters, batch DL, gallery glue | DOM thrash under large rooms |
| `lib/client.js` | ~1,398 | Socket protocol / privileges / requests | Core real-time correctness |
| `lib/upload.js` | ~1,080 | Upload lifecycle, hashing, serve | Data integrity |
| **All JS (lib/client/common/tests)** | ~34k | — | Manageable if modularized |

### 2.2 Stack facts that drive the plan

| Layer | Current | Notes |
|-------|---------|--------|
| Runtime | Node 20+ guard in `server.js` | No `engines` field in `package.json` |
| HTTP | Express 4.x | Fine; routes not modularized |
| Real-time | Socket.IO 4.7 | Solid; client protocol is custom |
| Redis | **`redis` 3.1.2** (callback API) | Major modernization gate; Dependabot ignores major |
| Build | Webpack 5 + **css-loader 2 / mini-css-extract 0.5 / optimize-css-assets 5** | Plugin stack is Webpack 4-era |
| Client | Vanilla ES modules, no framework | Correct choice for this product |
| Tests | Jest unit + integration + views | Good islands; god-files barely unit-tested |
| Lockfiles | **Both** `yarn.lock` and `package-lock.json` | Reproducibility hazard |
| CI | **None** (workflows removed; `docs/proposed_git_actions.md` remains) | Manual quality gate only |
| Artifacts | Built chunks under `static/` committed | Repo noise; cache-bust via custom HashPlugin |

### 2.3 What is already good (preserve)

- Cluster + dedicated expiration worker  
- Redis-backed distributed maps/sets + Lua scripts  
- Firejail-aware preview path + startup secret checks  
- Automation scopes, Redis rate limits, audit log, webhooks  
- XSS / security-hardening / memory-hygiene test suites  
- Streaming PDF Range reads; yauzl threshold for large ZIPs  
- Client webpack chunk for `xregexp`; PDF worker separate entry  
- Health endpoint + structured ops log hooks  
- Rich API/MCP docs (`API.md`, `MCP.md`)  

---

## 3. Problem catalog (prioritized)

### P0 — Correctness, security, supply chain

| ID | Issue | Impact |
|----|-------|--------|
| P0-1 | Redis client v3 is end-of-life / callback-era | Security patches lag; blocks Node ecosystem |
| P0-2 | Dual lockfiles (`yarn` + `npm`) | Different trees on different machines |
| P0-3 | No automated test gate | Regressions slip on large refactors |
| P0-4 | `gm` optional dep is sunset | Preview path will rot |
| P0-5 | Monolithic route file mixes auth, automation, pages | Privilege bugs hard to spot |
| P0-6 | Secrets / default secret still a footgun for new deploys | Mitigated in prod; DX still fragile |

### P1 — Maintainability / velocity

| ID | Issue | Impact |
|----|-------|--------|
| P1-1 | God-files (`httpserver`, `meta`, `client`, `files`, `reader`) | Slow features, risky PRs |
| P1-2 | Webpack asset pipeline outdated | Slow builds; hard dep bumps |
| P1-3 | Inconsistent module style (CJS server / ESM client) | Fine long-term if boundaries stay clean |
| P1-4 | Committed webpack output in `static/` | Merge noise; unclear source of truth |
| P1-5 | Sparse tests on upload/serve/broker/session paths | Refactors unsafe |
| P1-6 | Dependabot majors blocked without a planned upgrade path | Debt accumulates |

### P2 — Performance & scale

| ID | Issue | Impact |
|----|-------|--------|
| P2-1 | File list appears to rebuild/insert full DOM sets (`insertFilesIntoDOM`) | Lag with hundreds–thousands of files |
| P2-2 | Reader monolith loads heavy parsers into room bundle paths | First interaction cost |
| P2-3 | Preview generation (`meta.js`) is process-heavy | CPU spikes; queue fairness |
| P2-4 | Default `workers = max(cpus+1, 2)` | Oversubscribe small hosts; Redis contention |
| P2-5 | Broker pub/sub JSON-stringifies all events | Extra CPU/bandwidth under chat floods |
| P2-6 | Per-worker in-memory metrics only | Incomplete observability under cluster |
| P2-7 | Automation rate-limit fallback Map per process | OK with Redis; noisy when Redis fails |

### P3 — Product polish / DX

| ID | Issue | Impact |
|----|-------|--------|
| P3-1 | README vs CONTRIBUTING package manager mismatch (`npm` vs `yarn`) | Contributor confusion |
| P3-2 | No `engines` / Node matrix documented in package | Support ambiguity |
| P3-3 | Integration tests need live server patterns | Flaky / forceExit |
| P3-4 | Typo in product name “Ephemereal” | Branding only; leave unless rebranding |

---

## 4. Guiding principles

1. **Behavior freeze first.** Extract and reorganize with golden tests before optimizing.  
2. **Vertical slices over big-bang.** Each PR shippable; version remains 1.x.  
3. **No framework rewrite.** Keep vanilla client + Express + Socket.IO + Redis.  
4. **Prefer extraction over abstraction.** Split files; introduce DI only where tests need it.  
5. **Measure hot paths.** File list, upload hash, preview, download, socket fan-out.  
6. **Respect operator intent on CI.** Propose optional workflows; enable only if approved.  
7. **Adult hobby hosting realism.** Optimize for multi-room self-host boxes, not hyperscale SaaS.

---

## 5. Target architecture (to-be, still one process)

```text
server.js
  └─ workers → lib/http/app.js
                 ├─ middleware/ (session, csrf/kft, helmet, errors)
                 ├─ routes/
                 │    pages.js
                 │    auth.js
                 │    rooms.js
                 │    uploads.js
                 │    automation/  (v1 routers by scope domain)
                 │    archive.js
                 │    comics.js
                 │    health.js
                 └─ ws.js (socket.io bind)

lib/domain/
  upload/  room/  user/  request/  bans/  links/  archive/

lib/infra/
  broker/  storage/  config/  observability/  validate/

lib/media/
  meta/  (image, video, pdf, comic, archive extractors)

client/
  room/files/  (list, filter, batch, gallery)
  room/reader/ (pdf, epub, mobi, comic) — lazy entries
  room/chat/
  shell/       (roomie dialogs, registry, socket)
```

Public APIs (`/api/v1/*`, socket events, storage layout) stay stable.

---

## 6. Phased development plan

### Phase 0 — Baseline & safety net (1–2 weeks)

**Objective:** Make every later change measurable and reversible.

| Task | Detail | Done when |
|------|--------|-----------|
| 0.1 Single package manager | Pick **one**: Yarn 1.x (per CONTRIBUTING) *or* npm. Delete the other lockfile. Document in README + CONTRIBUTING. | One lockfile; clean install on Linux/macOS/Windows |
| 0.2 `engines` field | `"node": ">=20 <23"` (or current LTS policy) | `npm`/`yarn` warn on wrong Node |
| 0.3 Test baseline | Run full suite; record pass list & duration. Fix only blockers. | Documented baseline in this doc or CHANGELOG |
| 0.4 Coverage snapshot | `npm run test:coverage` on unit tests; note % for `lib/` | Baseline numbers stored |
| 0.5 Golden fixtures | Capture sample automation API responses + room file JSON shapes | Fixtures under `tests/fixtures/` |
| 0.6 Optional CI | If maintainer allows: restore minimal workflow from `docs/proposed_git_actions.md` — unit tests only, Node 20 | Green on PR |
| 0.7 Secret hygiene check | Ensure `.config.json` never tracked; example only | `.gitignore` audit |

**Exit criteria:** Reproducible install + known-green test suite + decision on CI.

---

### Phase 1 — Structural modularization (2–4 weeks)

**Objective:** Shrink blast radius **without** changing external behavior.

#### 1A. Split `lib/httpserver.js` (highest ROI)

Suggested extraction order:

1. `lib/http/middleware.js` — `aroute`, `jroute`, `rjquery`, helmet, kft, getUser  
2. `lib/http/automation/auth.js` — API keys, scopes, rate limit, audit  
3. `lib/http/routes/automation/*.js` — files, rooms, requests, admin, auth  
4. `lib/http/routes/pages.js` — `/`, `/r/:room`, account, register, toplists  
5. `lib/http/routes/archive.js` + `comics.js`  
6. `lib/http/ws.js` — `setupWS`  
7. Thin `lib/httpserver.js` or `lib/http/app.js` that only wires modules  

**Rules:** no route path changes; no response shape changes; move tests with code.

#### 1B. Split `lib/meta.js`

Domain extractors:

- `lib/media/detect.js` — type detection  
- `lib/media/image.js` / `video.js` / `pdf.js` / `ebook.js` / `comic.js` / `archive.js`  
- `lib/media/jail.js` — firejail spawn helpers  
- Keep `generateAssets` / `getMetaData` facades for callers  

#### 1C. Split `lib/client.js` (careful — real-time core)

- Privileges / ban / nuke handlers  
- Chat & commands  
- Request create/status  
- File list push handlers  
- Keep single `Client` class facade initially (composition over inheritance)

#### 1D. Client file surface

- `client/files/list.js` — DOM insert/sort/filter  
- `client/files/batch.js` — download queue  
- `client/files/state.js` — localStorage keys / new badges  
- Leave `files.js` as orchestrator until list virtualization (Phase 3)

#### 1E. Reader split + lazy entries

Webpack entries (or dynamic `import()`):

- `reader-pdf` / `reader-epub` / `reader-mobi` / `reader-comic`  
- Shared shell: toolbar, progress, focus mode  

**Exit criteria:** No file > ~800 lines in `lib/http` or `lib/media`; all existing tests green; manual smoke of room/upload/chat/automation.

---

### Phase 2 — Dependency & build modernization (2–3 weeks)

**Objective:** Reduce CVE surface and unstick Dependabot.

| Wave | Packages | Approach |
|------|----------|----------|
| 2.1 Safe minors | body-parser, cookie, uuid, send, serve-static, sharp minor, helmet already 7 | Land grouped Dependabot PRs after tests |
| 2.2 Webpack CSS stack | Replace `optimize-css-assets-webpack-plugin` + ancient `css-loader`/`mini-css-extract` with current Webpack 5-compatible set (`css-minimizer-webpack-plugin`, css-loader 6/7, mini-css-extract 2.x) | Visual regression smoke on room CSS |
| 2.3 Remove/replace dead weight | `colors` → native ANSI or `picocolors`; `mkdirp` → `fs.mkdir({recursive})`; evaluate `passlib`/`speakeasy` currency | Grep-driven |
| 2.4 **Redis 4.x major** | Dedicated sub-project (see §7) | Staging only until Lua + collections verified |
| 2.5 Sharp current | Bump toward current major when Node ABI allows | Preview golden images |
| 2.6 `gm` sunset | Prefer `sharp` + ImageMagick CLI where needed; document binary deps | No runtime require of abandoned API if avoidable |
| 2.7 pdfjs-dist | Stay on 3.x until reader has isolated entry; then evaluate 4.x | Reader-only regression |

**Lockfile policy after Phase 0:** Dependabot config updated to match chosen package manager only.

**Exit criteria:** `npm audit` / `yarn audit` high-severity clean or explicitly waived; production build size not worse by >10% without justification.

---

### Phase 3 — Performance optimization (2–4 weeks)

**Objective:** Improve latency and resource use under realistic hobby-community load.

#### 3.1 Client: file list virtualization (P2-1)

- Windowed rendering for file rows (render ~50–80 DOM nodes + buffers)  
- Preserve selection, keyboard nav, filter, sort, NEW badges, request tiles  
- Keep gallery path separate (already grid-oriented)  
- Measure: time-to-interactive with 500 / 2,000 synthetic files  

#### 3.2 Client: code-splitting for readers & archive modal (P2-2)

- Dynamic import on first “Read Now” / archive open  
- Ensure PDF worker still separate  
- Measure: initial `client.js` transferred size  

#### 3.3 Server: preview pipeline fairness (P2-3)

- Global/process `PromisePool` caps already exist — audit limits vs CPU count  
- Queue metrics in observability (depth, wait time, failure reason)  
- Skip/requeue policy for huge archives already partial — document and tune  

#### 3.4 Server: worker sizing defaults (P2-4)

- Change default workers toward `Math.min(NUM_CPUS, 4)` or `Math.max(2, NUM_CPUS - 1)` with README guidance  
- Document Redis as the real scale limit  

#### 3.5 Broker efficiency (P2-5) — optional / later

- Evaluate msgpack for pub/sub payloads (breaking for multi-version cluster deploys → versioned channel or dual-decode window)  
- Connection: ensure one shared client pattern remains correct under Redis 4  

#### 3.6 Upload path

- Confirm blake2 hashing is streaming (it is oriented that way) — add microbench  
- Avoid double-read where meta + hash can share streams  

#### 3.7 Caching

- HTTP cache headers for immutable assets (`s~[hash].*` already content-hashed)  
- Review `send` options for `/g/:key` (range already required for PDF)  

**Exit criteria:** Documented before/after numbers for list render and cold room load; no functional regressions in batch download or filters.

---

### Phase 4 — Test & quality hardening (ongoing, spike 1–2 weeks)

| Area | Action |
|------|--------|
| Upload/serve | Unit tests for hash, sanitize tags, resolve, blacklist gates |
| Broker collections | Contract tests with Redis testcontainer or fakeredis strategy |
| Session verifier | Cryptographic fixture tests |
| Route modules | Move integration tests to hit routers via `supertest` without full cluster where possible |
| XSS | Keep and extend for new markdown/HTML sinks |
| Reader | Headless smoke is hard — at least pure parse helpers tested |
| MCP | Keep schema/tool inventory tests in sync with `MCP.md` |

Target: unit coverage of `lib/` critical paths **≥60%** statements within two quarters; integration suite stable without `forceExit` if handles closed properly.

---

### Phase 5 — Observability & operations (1–2 weeks)

| Task | Detail |
|------|--------|
| 5.1 Cluster metrics | Aggregate counters in Redis (INCR) for healthz |  
| 5.2 Structured logs | JSON line logger with `requestId` / `roomid` / `apiKeyId` |  
| 5.3 Health depth | Redis latency, uploads disk free, preview queue depth |  
| 5.4 Runbooks | Operator short doc: backup Redis + uploads, rotate keys, firejail |  
| 5.5 systemd unit | Review `contrib/dicefiles.service` for Node 20 + restart policy |  

---

### Phase 6 — Optional strategic tracks (only if needed)

| Track | When to consider | Cost |
|-------|------------------|------|
| Gradual JSDoc → TypeScript `allowJs` | After modularization | Medium; high long-term payoff |
| Express 5 | After route split + tests | Low–medium |
| Replace Socket.IO with raw WS | Rarely justified | High; protocol rewrite |
| Object storage (S3) backend | Multi-node storage | High; storage abstraction exists partially |
| Full SPA rewrite | Never for this product | Extreme; rejects plan principles |

---

## 7. Redis 4 migration (dedicated mini-plan)

Highest-risk dependency upgrade. Treat as its own release candidate.

1. **Inventory** all `BROKER.getMethod(s)` call sites and Lua scripts under `lib/broker/redis/`.  
2. **Adapter layer:** implement `lib/broker/redis-client.js` that exposes the *same* promisified method surface.  
3. Swap `createClient` to node-redis v4; handle `connect()`, error events, auth URL form.  
4. Re-validate Lua `SCRIPT LOAD` / `EVALSHA` and keyspace notifications.  
5. Test DistributedMap/Set, rate limit, message removal, tracking scripts under multi-worker.  
6. Canary on staging instance; dual-running not required if adapter is solid.  
7. Bump Dependabot to allow redis majors after success.

**Rollback:** pin redis@3 and adapter no-op.

---

## 8. Performance measurement plan

| Metric | How | Target (initial) |
|--------|-----|------------------|
| Cold `/r/:room` HTML+JS | Chrome Lighthouse / Network | No regression >10% after code-split (should improve) |
| 500-file list apply | Performance.now around `insertFilesIntoDOM` | p95 < 100ms DOM work after virtualization |
| Upload 100 MB hash+store | Server timer logs | Baseline then improve ≥15% if double-read found |
| Preview queue | ops metrics | No unbounded growth; visible depth |
| Automation RPS | existing rate-limit tests | Same limits, lower Redis RTT variance |
| Jest unit suite | CI timing | < 60s on GitHub-hosted runner |

Add a lightweight `scripts/bench-filelist.js` (synthetic) if needed — keep out of default test path.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Redis 4 breaks Lua/collections | Medium | High | Adapter + multi-worker integration tests |
| File list virtualization breaks selection/batch | Medium | High | Feature flag `fileListVirtualization` |
| Route split introduces CSRF/token misses | Medium | High | Shared middleware module; integration tests |
| Webpack CSS upgrade breaks fonts/symbols | Medium | Medium | Visual checklist (room, gallery, reader, account) |
| CI restore conflicts with operator policy | Low | Low | Keep optional; document manual checklist |
| Scope creep into product redesign | High | Medium | Enforce non-goals in PR template |

---

## 10. Suggested PR sequencing (ship order)

```text
PR-01  chore: single lockfile + engines + install docs
PR-02  test: fixtures + coverage baseline script
PR-03  refactor(http): extract middleware + automation auth (no route moves yet)
PR-04  refactor(http): move automation routes to routers
PR-05  refactor(http): move pages + archive/comic routes
PR-06  refactor(media): split meta extractors behind facade
PR-07  build: modernize webpack CSS minimizer stack
PR-08  deps: safe minor/patch wave
PR-09  feat(client): lazy-load reader modules
PR-10  feat(client): virtualized file list (flagged)
PR-11  refactor: redis client adapter + redis 4
PR-12  ops: cluster metrics + health depth
PR-13  test: upload/broker/session coverage expansion
```

Each PR: problem, risk, verification notes (per CONTRIBUTING). Prefer < ~400 LOC net conceptual change per PR when touching security paths.

---

## 11. Effort & sequencing overview

| Phase | Calendar (1 experienced contributor) | Depends on |
|-------|--------------------------------------|------------|
| 0 Baseline | 1–2 weeks | — |
| 1 Modularize | 2–4 weeks | 0 |
| 2 Dependencies | 2–3 weeks | 0; Redis after 1A helpful |
| 3 Performance | 2–4 weeks | 1D/1E strongly recommended first |
| 4 Tests | continuous | 0–1 |
| 5 Ops | 1–2 weeks | 0 |
| **Total critical path** | **~2–3 months** part-time; **~6–8 weeks** focused | |

---

## 12. Success criteria (program-level)

- [x] Single install path; Node engines declared  
- [x] HTTP helpers/automation/ws extracted (`lib/http/*`); httpserver remains route wiring  
- [x] Meta/media, socket client channels, reader formats, file-list windowing as submodules  
- [x] Redis on supported major (v4) via adapter; Lua smoke + unit tests  
- [x] Webpack CSS toolchain current; production build documented  
- [x] File-list windowing for large lists (pure helpers + DOM integration)  
- [x] Initial room JS payload reduced via reader/archive lazy load  
- [x] Critical lib paths covered by automated tests; manual smoke checklist still exists  
- [x] CHANGELOG entries for operator-visible changes only  

---

## 13. Immediate next actions (start here)

1. ~~Decide package manager~~ → **Yarn 1** + `engines.node >=20`.  
2. ~~Test baseline~~ → unit+views green; integration needs live server.  
3. ~~Extract HTTP automation/helpers/ws~~.  
4. ~~Health + upload/session/redis/windowing unit tests~~.  
5. Optional follow-ups: further shrink `httpserver.js` / `files.js` route-only shells; drop `legacyMode` once multi is fully v4-native.  

---

## 14. Appendix A — Module ownership map (proposed)

| Domain | Owns | Does not own |
|--------|------|--------------|
| `http/*` | Transport, authn/z glue, serialization | Business rules of uploads |
| `upload` | Keys, hashing, TTL, serve | HTTP framing |
| `media/*` | Previews, type detection | Storage paths |
| `broker` | Pub/sub, distributed collections | Domain semantics |
| `room` | Room config, membership, file index | Global user accounts |
| `client/*` (browser) | DOM, local state, UX | Server truth |

## 15. Appendix B — Manual smoke checklist (every phase exit)

1. Create room → chat → upload image/PDF/ZIP → see previews  
2. Open PDF reader + EPUB if available → progress restore  
3. Archive viewer selective download  
4. Create request → fulfill → achievement tick if logged in  
5. Automation: login + list files with scoped key  
6. MCP tool list still matches docs (if MCP touched)  
7. Mod actions: remove message, delete file  
8. Restart workers; existing sessions/files intact  

## 16. Appendix C — Explicitly out of scope (this plan)

- Rebranding / fixing “Ephemereal” spelling in product name  
- Mobile native apps  
- Multi-region replication  
- Replacing EJS with React/Vue  
- Public SaaS multi-tenant billing  

---

*End of plan. Update this document when phases complete or priorities change.*
