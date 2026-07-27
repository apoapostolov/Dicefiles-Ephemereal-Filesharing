# AI guide: UI audit, polish, rework, and themes

**Audience:** coding agents (Codex, Claude Code, Cursor, Pi, Hermes, etc.) working on Dicefiles UI.  
**Product type:** dense **Operate**-mode interface (real-time room: chat + files + gallery + readers + modals). Not a marketing landing page.

Read this before changing colors, layout, chrome, or “themes.” Pair it with:

| Doc | Role |
|-----|------|
| [UI_STYLE.md](./UI_STYLE.md) | **Law** for buttons, pills, icons, tokens, modals, tooltips |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Yarn, build, PR bar, greytone consistency |
| [PERF_NOTES.md](./PERF_NOTES.md) | Large-room / virtualization constraints |
| `entries/css/base.css` | **Token source of truth** (`:root` custom properties) |

---

## 0. Non-negotiables (Dicefiles-specific)

1. **Stack is vanilla client JS + EJS + Webpack CSS.** There is no React/Next/Tailwind app shell. Do not introduce a framework “just for theming.” Prefer editing `entries/css/*` and existing DOM patterns in `client/` + `views/`.
2. **Greytone product chrome is intentional.** CONTRIBUTING: keep visual changes consistent with the current greytone theme unless the human explicitly asks for a new theme or a redesign.
3. **All themeable color goes through CSS variables** in `entries/css/base.css`. Never hard-code `black` / `white` / random hex for chrome that should re-theme. Feature-only accents (e.g. green `is-new` pills) may stay fixed; document why.
4. **Canonical toolbar size/shape** is defined in UI_STYLE.md (`#tools .btn`, `.filterbtn`, `.btn-pill`). Match those; do not invent a second button system.
5. **Icons:** custom `symbols.woff` + `entries/css/symbols.css` (`.i-*`). No emoji in UI chrome. New glyphs require font + CSS, or a rare inline SVG exception.
6. **Body role classes drive chrome:** `mod`, `owner`, `regular`, `authed`, `unauthed`, `noips`, `noreports`, `newroom` (see `client/roomie.js`). Theme CSS must not break `body.mod` / `body.owner` visibility rules (e.g. `.selection-pill`).
7. **Build path:** source CSS is under `entries/css/`; webpack entry `style` packs to `/style.css`. After CSS edits run `yarn prestart` (or `yarn pack` while iterating) and verify the room page loads the new bundle.
8. **Performance:** file list virtualization and reader lazy-render are sacred. Theme work must not force layout thrash on every row, animate thousands of nodes, or replace virtualized lists with full DOM dumps.
9. **Do not edit `static/*.css` or minified bundles as source of truth.** Edit `entries/css/`, rebuild.

### CSS map (edit these, not `static/`)

```
entries/css/style.css          # import graph only
  rubik.css, cairo.css         # @font-face
  symbols.css                  # icon font
  base.css                     # :root tokens + global chrome
  page.css                     # non-room pages (index, account, …)
  room.css                     # room shell grid + tools + chat chrome
    context.css, files.css, gallery.css, modal.css, tooltip.css
  reader.css                   # in-page PDF/ePub/comic reader chrome
```

Webpack: `webpack.config.js` entry `"style": "./css/style.css"` (cwd under `entries/`). Linked from `views/head.ejs` as `/style.css?v=…`.

### Surfaces you must smoke-test after UI work

| Surface | How to hit it | CSS / code hotspots |
|---------|---------------|---------------------|
| Room shell | Open a room | `room.css`, grid on `body#room` |
| Tools bar | Filters, view mode, upload | `room.css` + UI_STYLE §1 |
| File list + selection | List/grid, select as mod | `files.css`, `body.mod` / `body.owner` |
| Gallery + lightbox | Grid + cover | `gallery.css` |
| Reader | PDF/ePub “Read Now” | `reader.css`, `client/files/reader/*` (some **inline** colors) |
| Modals / messagebox | Login, confirm, settings | `modal.css`, `client/modal.js` |
| Tooltips | Hover nick / file | `tooltip.css`, `client/tooltip.js` |
| Context menu | Right-click | `context.css` |
| Account / index / discover | Logged-out and account pages | `page.css`, `views/*.ejs` |
| Mobile / narrow | Resize splitter + viewport | `client/splitter.js`, room grid |

---

## 1. Skill pack (what to load)

Skills live in the operator’s agent skill trees (examples: `~/.agents/skills/`, `~/.codex/skills/`, `~/.pi/agent/skills/`). Manifest of the curated pack: `WEBDEV-INTERFACE-PACK.md` in those trees.

**Dicefiles is Operate-mode product UI.** Prefer skills built for apps/tools over landing-page aesthetics.

### Tier A — always consider for UI work here

| Skill | When |
|-------|------|
| **impeccable** | Primary craft skill. Use **Operate** mode (task completion, density, native affordances). Refinement vs redesign: see skill. Run its `context.mjs` only if PRODUCT.md/DESIGN.md exist; otherwise treat UI_STYLE + this doc as the brief. |
| **frontend-ui-engineering** | Building or changing components, layout, focus, a11y while shipping production chrome. |
| **frontend-design** | Distinctive visual direction without generic “AI purple / Inter / three-card hero” defaults. Use carefully: do not force landing aesthetics onto the room. |
| **redesign-existing-projects** | Audit-then-upgrade path on **existing** CSS without a full rewrite. |
| **design-taste-frontend** | Only for **marketing-ish** pages (index/discover pitch), and only after brief inference. Its own text says it is **not** for dashboards/multi-step product UI. |
| **ui-audit** | Structured UX audit + ship verdict after larger visual passes. |
| **web-design-guidelines** | Compliance-style review (a11y, layout, interface guidelines). |
| **accessibility-wcag** / **accessibility-compliance** / **wcag-audit-patterns** | Focus, contrast, keyboard, roles, labels. |
| **typography-audit** | Hierarchy, sizes, weight — map findings onto `--base-size`, `--files-size`, `--detail-size`, Rubik/Cairo. |
| **webapp-testing** / **playwright** / **playwright-interactive** / **browser-testing-with-devtools** | Verify in a real browser after CSS/JS changes. |
| **modern-web-guidance** | When touching platform APIs (dialogs, scroll, `content-visibility`, focus, modern CSS). Lookup-first for unfamiliar APIs. |

### Tier B — themes, systems, motion

| Skill | When |
|-------|------|
| **visual-design-foundations** | Token systems, spacing, color roles (align with `base.css` vocabulary). |
| **design-system-patterns** | If expanding tokens into a fuller theme system (multi-theme, dark/light). Still ship as CSS variables, not a React design system. |
| **interaction-design** / **ui-animation** | Hover, focus, micro-motion. Keep transitions short; respect reduced motion; do not animate virtualized lists en masse. |
| **product-design** | Before a large rework: clarify jobs-to-be-done of room/reader/mod tools. |
| **high-end-visual-design** / **minimalist-ui** / **gpt-taste** | Optional **direction** references. Strip landing-only patterns (huge heroes, bento marketing grids). Translate into denser greytone / hobby-tool language. |
| **stitch-design-taste** | Only if generating a DESIGN.md for external generators; not required for in-repo CSS. |
| **web-quality-audit** / **core-web-vitals** / **web-performance** / **performance-optimization** | After visual changes that might hurt LCP/INP/CLS or large-room scroll. |
| **figma-implement-design** | Only when implementing from Figma; still map paints to CSS variables. |

### Tier C — usually wrong for this repo (unless stack changes)

| Skill | Why skip by default |
|-------|---------------------|
| **react-best-practices**, **composition-patterns**, **react-view-transitions**, **react-state-management**, **nextjs-app-router-patterns**, **tailwind-design-system** | No React/Next/Tailwind shell. Use only if a deliberate migration exists. |
| **web-component-design** | Patterns may inspire structure; do not force Web Components without need. |
| **image-to-code** / **imagegen-frontend-*** | Overkill for chrome polish; OK for brand/marketing assets only. |

### How an agent should “load” skills

1. Identify the job: **audit** | **polish** | **rework** | **theme**.
2. Load **Tier A** skills that match (impeccable Operate + UI_STYLE always for visual work).
3. Load **Tier B** only if the task needs systems/motion/theme architecture.
4. Ignore Tier C unless the user is changing the frontend stack.
5. Prefer **one** aesthetic skill as lead (usually **impeccable** Operate). Do not stack five taste skills and average them into mush.

---

## 2. Project identity (for design skills)

Use this as the **brief** whenever a skill asks for mode, audience, or constraints:

- **Mode:** Operate (primary). Read mode only inside the document/comic reader content surface.
- **Audience:** hobby communities sharing books, maps, STLs, media; long sessions; mods and owners with extra tools.
- **Density:** high. Multi-pane room (chat | splitter | files). Toolbar is icon-dense.
- **Tone:** utilitarian greytone, slightly soft surfaces (`--surface-*`), not glassmorphism SaaS, not neon cyberpunk unless explicitly requested.
- **Type:** Rubik + Cairo; base ~12pt; file rows ~11pt; details ~8pt.
- **Motion:** short ease transitions on buttons (see UI_STYLE); no cinematic scroll-jacking on the room.
- **Constraints:** self-hosted, Redis-backed, Webpack-built CSS, custom icon font, role-based body classes, virtualized file list, in-browser readers with some hardcoded dark colors today.

---

## 3. Workflow A — Audit (no or minimal code)

**Goal:** evidence-backed list of issues ranked by user impact. Do not “fix” everything in the same breath unless asked.

### Skills

impeccable (critique/audit posture), **ui-audit**, **web-design-guidelines**, **typography-audit**, **accessibility-wcag** / **wcag-audit-patterns**, browser QA skills.

### Procedure

1. **Inventory tokens**  
   Read `:root` in `entries/css/base.css`. List semantic roles (bg ladder, text, roles, surfaces, focus).
2. **Scan for theme leaks**  
   Search hard-coded colors outside intentional accents:
   ```bash
   rg -n '#[0-9a-fA-F]{3,8}|rgb\(|hsl\(' entries/css client --glob '!**/fonts/**'
   ```
   Known hotspots: `reader.css`, parts of `files.css` (new/request pills), `modal.css`, inline styles in `client/files/reader/*.js`.
3. **Component compliance**  
   Diff live markup/CSS against UI_STYLE.md (`.btn`, `.btn-pill`, `.filterbtn`, tooltips, modals).
4. **State matrix**  
   For each critical control, note: default, hover, active/toggled, disabled, focus-visible, mod-only, owner-only, empty, error, loading.
5. **Contrast & keyboard**  
   Chat text on `--dark-bg`, muted `--dark-fg` links, role colors, modal forms, reader iframe content (forced light-on-dark in book reader).
6. **Perf & layout**  
   Room grid + splitter; file virtualization; reader lazy pages. Flag CSS that triggers expensive effects on `.file` rows.
7. **Deliverable format**
   ```markdown
   ## Audit summary
   - Severity S0–S3 counts
   - Top 5 user-visible issues

   ## Findings
   | ID | Sev | Surface | Evidence (file:line) | User impact | Suggested fix class |
   |----|-----|---------|----------------------|-------------|---------------------|

   ## Theme readiness
   - % of chrome on tokens vs hard-coded
   - Blockers for multi-theme

   ## Out of scope / do not touch
   ```
8. **Optional:** run Playwright/DevTools against a local server (`yarn prestart && node server.js`, default port often `9090`) for screenshots and focus order. Do not invent browser results.

---

## 4. Workflow B — Polish (refinement, preserve identity)

**Goal:** raise craft without changing product identity. Same greytone world, better hierarchy, spacing, states, contrast.

### Skills

**impeccable** (refinement / preserve), **frontend-ui-engineering**, **redesign-existing-projects**, **interaction-design**, a11y skills, browser QA.

### Procedure

1. Confirm human wants **polish**, not a new brand.
2. Produce a short **Design Read** (one paragraph): what stays, what tightens.
3. Prefer edits that:
   - replace hard-coded chrome colors with existing or new **tokens** in `base.css`;
   - align orphan controls to `#tools .btn` / `.filterbtn` patterns;
   - fix focus rings via `--focus-ring`;
   - unify borders to `--hairline` / `--lite-bg` consistently;
   - improve empty/error/disabled states already present in CSS.
4. **Do not:**
   - swap Rubik/Cairo for Inter/Geist without explicit ask;
   - add heavy shadows, mesh gradients, or marketing bento sections inside the room;
   - restyle the entire modal system in one PR unless scoped.
5. Keep PRs small: e.g. “tools bar + filters”, “file row states”, “reader chrome tokens”.
6. After edits: `yarn prestart`, manual smoke of the surface table, note screenshots in the PR description.
7. Update UI_STYLE.md if you introduce a **new** reusable pattern (new modifier class, new token).

### Polish checklist (ship gate)

- [ ] No new hard-coded chrome colors that belong on tokens  
- [ ] Buttons match 34px / 6px radius / surface tokens  
- [ ] Focus visible on keyboard  
- [ ] `body.mod` / `body.owner` tool visibility unchanged  
- [ ] File list still scrolls smoothly with many files  
- [ ] Reader still opens/closes; Escape works  
- [ ] `yarn prestart` OK  

---

## 5. Workflow C — Rework (replace visual world or major IA)

**Goal:** intentional redesign of look and/or information architecture. Higher risk.

### Skills

**impeccable** (redesign path: treat old look as anti-reference after commit), **product-design**, **frontend-design**, **visual-design-foundations**, **ui-audit**, browser QA. Landing taste skills only for public marketing pages.

### Procedure

1. **Stop and get a written brief** if missing: target vibe, must-keep workflows, light/dark, brand constraints, “still greytone hobby tool vs new identity.”
2. Write `docs/DESIGN_DIRECTION.md` (or extend this section in the PR) with:
   - mode (Operate), palette roles mapped to **token names**, type scale, density rules, motion rules, anti-patterns.
3. Implement **token-first**:
   - redefine `:root` in `base.css` (or add `[data-theme="…"]` / `.theme-…` scopes — see Workflow D);
   - only then touch component CSS.
4. Preserve interaction contracts:
   - room grid areas (`nav`, `chat`, `files`, `tools`, `chatbox`, `status`, splitter);
   - class names used from JS (`client/**`); do not rename DOM contracts casually;
   - icon font classes.
5. Split work:
   - PR1 tokens + global  
   - PR2 room shell + tools  
   - PR3 files/gallery  
   - PR4 modals/tooltips  
   - PR5 reader + inline JS colors  
6. Full ui-audit after the last visual PR; fix S0/S1 before calling it done.
7. CHANGELOG + screenshots mandatory.

---

## 6. Workflow D — Implement themes (single or multi)

Dicefiles today is effectively **one greytone theme** driven by `:root` in `base.css`. “Implement themes” means making that system explicit and switchable without forking every rule.

### Skills

**design-system-patterns**, **visual-design-foundations**, **impeccable** Operate, **frontend-ui-engineering**, a11y (contrast per theme), browser QA.

### D1 — Theme as token sets (preferred)

**Architecture**

```css
/* base.css */
:root,
[data-theme="greytone"] {
  --main-bg: #333333;
  /* …full token set… */
}

[data-theme="midnight"] {
  --main-bg: …;
  /* override only tokens; avoid duplicating component rules */
}

[data-theme="paper"] {
  /* light theme: invert surface ladder carefully */
}
```

**Rules**

1. Component CSS continues to use `var(--…)` only.
2. New themes = new token blocks, not copy-paste of `room.css`.
3. Light themes need a full ladder (bg, text, hairline, surfaces, role colors, selection, error). Spot-check reader iframe styles and any `color: #fff` leftovers.
4. Persistence (if requested): `localStorage` key + set `document.documentElement.dataset.theme` early in room bootstrap (`client/roomie.js` or layout script) to avoid flash. Account-level preference only if product asks.
5. Default remains greytone when attribute missing (`:root` = greytone).

### D2 — What must become tokens before multi-theme

Promote these before advertising theme support:

| Area | Today | Action |
|------|--------|--------|
| Reader chrome | many hex in `reader.css` + inline JS | map to `--reader-*` or reuse `--dark-bg` / `--text-fg` |
| New/request pills | fixed greens/yellows in `files.css` | optional `--accent-new`, `--accent-request` or keep as fixed brand accents |
| Modal deep panels | some `#111` | map to `--dark-bg` / `--hi-bg` |
| Context menu | `#111111` text | map to tokens |
| Book reader srcdoc | forced `#1a1a1a` / `#e8e8e8` in JS | theme-aware injection if light theme is required |

### D3 — Theme implementation procedure

1. Freeze token **names** (do not rename existing vars without a migration note). Adding vars is fine.
2. Grep component CSS for remaining hard-coded colors; convert chrome to vars.
3. Add second theme token block; keep greytone bit-identical at first (proves plumbing).
4. Wire selector (`data-theme` on `<html>`).
5. Build + visual diff greytone vs new theme on full surface table.
6. Contrast check both themes (role colors on both backgrounds).
7. Document how to add a third theme in UI_STYLE.md § Colors (pointer back here).
8. Tests: prefer a small unit/integration assert that `/style.css` still serves; optional snapshot of computed CSS vars is enough. Do not require pixel CI unless the human wants it.

### D4 — Anti-patterns for themes

- Separate full stylesheets per theme that diverge forever  
- Theme via scattered `filter: invert()` on the whole app  
- Tailwind/`oklch` rewrite mid-flight without asking  
- Theming only the room and leaving account/index broken  
- Breaking mod-only CSS that keys off `body.mod` not theme  

---

## 7. Mapping common human asks → skills + first files

| Human ask | Lead skills | First files |
|-----------|-------------|-------------|
| “Audit the UI” | ui-audit, web-design-guidelines, impeccable | base.css, room.css, files.css, modal.css, UI_STYLE.md |
| “Polish the toolbar” | impeccable refine, frontend-ui-engineering | room.css, UI_STYLE.md §1 |
| “Make it less AI-looking” | frontend-design, impeccable Operate | base.css tokens + type; not a new hero section |
| “Improve accessibility” | accessibility-*, wcag-audit-patterns | focus styles in base/room/modal; titles; forms |
| “Redesign the room” | product-design, impeccable redesign | brief → tokens → room.css grid |
| “Add a light theme” | design-system-patterns + D workflow | base.css token blocks; reader/modal leaks |
| “Match this screenshot” | figma-implement-design or image-to-code sparingly | map colors to tokens; implement in CSS |
| “Animate the UI” | ui-animation, interaction-design | short transitions on `.btn`; respect reduced-motion |
| “Something feels slow after CSS” | web-performance, core-web-vitals, PERF_NOTES | files list, gallery, reader |

---

## 8. Implementation discipline (all workflows)

### Do

- Edit `entries/css/**` and `client/**` / `views/**` as needed.  
- Use existing class names and DOM structure from EJS + client modules.  
- Add tokens before one-off colors.  
- Keep UI_STYLE.md and this doc honest when patterns change.  
- Run `yarn prestart` and smoke the touched surfaces.  
- Prefer small, reversible commits.

### Don’t

- Hand-edit `static/style.css` as source.  
- Commit secrets or operator `.env`.  
- Expand scope into Redis/protocol refactors during a “theme” task.  
- Replace the icon font with Lucide/emoji.  
- Apply landing-page skill defaults (huge padding, Inter, purple gradient, 3 feature cards) to `body#room`.  
- Claim browser verification without running a browser tool or the human confirming.

### Verification commands

```bash
yarn install          # if needed; Yarn 1.x only
yarn prestart         # production webpack build including CSS
node server.js        # default port often 9090; confirm in config
yarn test:unit        # if JS touched
yarn lint             # if JS touched
```

For pure CSS token changes, unit tests may not cover visuals; manual/Playwright smoke is the real gate.

---

## 9. Suggested agent output shapes

### After audit

Findings table + theme readiness + ordered fix plan (S0 first). No drive-by restyle.

### After polish / rework / theme

```markdown
## What changed
- tokens: …
- components: …

## Skills applied
- …

## Surfaces verified
- [ ] room tools
- [ ] file list (user + mod)
- [ ] gallery + reader
- [ ] modal
- [ ] account/index (if tokens global)

## Residual risk
- …

## Follow-ups
- …
```

---

## 10. Quick reference: token palette (default greytone)

From `entries/css/base.css` / UI_STYLE.md (authoritative values live in CSS):

| Token | Role |
|-------|------|
| `--main-bg` | Primary surface (nav, bars) |
| `--dark-bg` | Deepest bg (chat, panels) |
| `--lite-bg` | Raised bars, tooltip name |
| `--odd-bg` / `--sel-bg` / `--odd-sel-bg` | List zebra + selection |
| `--text-fg` / `--dark-fg` | Primary / muted text |
| `--hi-fg` / `--hi-bg` | Highlighted messages |
| `--surface-1..3` | Overlay fills (buttons) |
| `--hairline` / `--focus-ring` / `--soft-shadow` | Borders, focus, elevation |
| `--role-user-fg` / `--role-mod-fg` / `--role-system-fg` | Nick / system colors |
| `--err-bg` / `--upload-bg` / `--disabled-*` | States |
| `--base-font` / `--base-size` / `--files-size` / `--detail-size` | Type |

When adding a theme, **override these names**; do not invent a parallel private palette in component files.

---

## 11. Related product docs

- [UI_STYLE.md](./UI_STYLE.md) — component law  
- [CONTRIBUTING.md](./CONTRIBUTING.md) — workflow and greytone rule  
- [PERF_NOTES.md](./PERF_NOTES.md) — performance  
- [ARCHIVE_VIEWER.md](./ARCHIVE_VIEWER.md) / reader notes in README — reader behavior  
- Operator skill pack manifest (outside repo): `WEBDEV-INTERFACE-PACK.md` under agent `skills/` trees  

---

*This document teaches agents how to apply external UI skills **to this codebase**. Product visual law remains UI_STYLE.md; when they conflict, UI_STYLE.md and base.css tokens win unless the human explicitly supersedes them.*
