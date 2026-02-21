# Dicefiles UI Style Guide

This document outlines the standard UI components and styling rules for Dicefiles. When adding new features, always refer to this guide to ensure consistency across the application.

> **Agreed standard (Feb 2026):** The filter buttons, select/delete pill, view-mode pill, and Upload button are the canonical reference for size and shape. All new buttons must match them.

## 1. Header Buttons (`#tools .btn`)

The header buttons (located in the `#tools` navigation bar) are the primary way users interact with room features (filtering, downloading, view modes, etc.).

### Toolbar padding

`#room > #tools` has `padding: 3px 0.35rem` — 3 px of breathing room above and below the button row. Do not reduce this to 0.

### Base Styling

All header buttons must use the `.btn` class and be placed inside `#tools`.

```html
<div id="my-new-feature" class="btn i-icon-name" title="Tooltip text"></div>
```

**CSS Properties (applied automatically via `#tools .btn`):**

- `font-size: 12pt;`
- `width: 34px;`
- `text-align: center;`
- `background: var(--surface-2);`
- `border: 1px solid var(--hairline);`
- `color: var(--text-fg);`
- `border-radius: 6px;`
- `cursor: pointer;`
- `transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;`

### Hover State

Buttons automatically get a hover state that slightly elevates them and changes the background:

- `background: var(--surface-3);`
- `border-color: rgba(255, 255, 255, 0.24);`
- `transform: translateY(-1px);`

### Active/Toggled State

If a button represents a toggleable state (like view modes or the links archive), use the `.active` class when it is turned on.

```css
#my-new-feature.btn.active {
  background: rgba(255, 255, 255, 0.5);
  box-shadow: rgb(0 0 0 / 75%) 0px 0px 6px 0px inset;
}
```

### Spacing and Margins

- Buttons and pills are separated by the `gap: 0.35rem` of the `#tools` flex row.
- Use `margin-left: 0.85rem` on a button or `.btn-pill` to create a larger visual break between groups.

### Segmented Pill Groups (`.btn-pill`)

When two or more related buttons must appear as a single connected control, wrap them in a `<div class="btn-pill">`. The CSS automatically:

- Rounds the **outer** corners of the first and last child only (6 px) — inner segments are fully square
- Collapses the shared inner border (right border of non-last segments is 0)
- Suppresses `translateY` hover lift on individual segments (would break the pill look)
- Raises the hovered segment with `z-index: 1` so its border highlights above neighbours

> **Specificity note:** The pill overrides are scoped as `#tools .btn-pill .btn` (specificity 120) to beat the base `#tools .btn` rule (specificity 110) which sets `border-radius: 6px`. If you ever move pills outside `#tools`, you must re-scope those rules accordingly.

```html
<!-- View mode pill (always visible) -->
<div class="btn-pill viewmode-pill">
  <div id="nailoff" class="btn i-list active"></div>
  <div id="nailon" class="btn i-grid"></div>
</div>

<!-- Selection pill (hidden for regular users, shown for mod/owner) -->
<div class="btn-pill selection-pill">
  <div id="selectall" class="btn i-plus" title="Select all"></div>
  <div id="clearselection" class="btn i-clear" title="Clear selection"></div>
  <div id="trash" class="btn i-trash" title="Remove files"></div>
</div>
```

Use `class="btn-pill viewmode-pill"` for permanently visible pills (adds `margin-left: 0.85rem`).
Use `class="btn-pill selection-pill"` for the select/action group (CSS hides for regular, shows for mod/owner).

**Do not** put pill segments in separate flex items — they must be direct children of the `.btn-pill` wrapper so the outer `gap` does not create visual gaps between segments.

### Filter Buttons (`.filterbtn`)

The filter type buttons (image, video, audio, document, etc.) are `<button>` HTML elements that use the `.filterbtn` class. They must be styled identically to `#tools .btn` to look consistent:

```css
.filterbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 34px;
  padding: 0.5ex;
  font-size: 12pt;
  box-sizing: border-box;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  /* plus background, border, border-radius, color, transition same as .btn */
}
```

Key: `-webkit-appearance: none; appearance: none;` must be set to strip browser-native button styling. `display: inline-flex` with `align-items: center` ensures the icon is centered just like `.btn` divs.

### Selection / Action Pill (`#selectall`, `#clearselection`, `#trash`)

These buttons are wrapped in `<div class="btn-pill selection-pill">` and render as a single connected pill, identical in style to the view-mode pill. The `.selection-pill` class hides the group for regular users and shows it for mod/owner via CSS (`body.mod .selection-pill`, `body.owner .selection-pill`).

### Icons

Always use the custom icon font (`symbols.woff`) for button icons. Do not use emojis or inline SVGs for standard UI buttons.

- Add the appropriate `.i-*` class to the button element or to an inner `<span>`.
- If the icon class is on the outer `.btn` div, the `::before` pseudo-element carries the icon. Prefer using an inner `<span class="i-*">` to avoid `line-height` inheritance issues.
- If a new icon glyph is not available in the font, use an inline SVG (see `#links-toggle` for reference).
- If a new icon is needed in the font, it must be added to `symbols.woff` and defined in `entries/css/symbols.css`.

## 2. Download/Action Buttons with Pills (`.btn-download`)

For buttons that require displaying a count (like "Download New"), use the `.btn-download` modifier class.

```html
<div id="downloadnew" class="btn btn-download" title="Download all new files">
  <span class="i-arrow-down"></span>
  <span class="count-pill">0</span>
</div>
```

**CSS Properties:**

- `width: auto;`
- `min-width: 44px;`
- `gap: 0.4rem;`
- `padding: 0.45ex 0.55rem;`

The `.count-pill` inside will automatically be styled as a rounded badge.

## 3. Colors and Variables

All colors must use CSS custom properties defined in `entries/css/base.css`. Never hard-code a color that should respond to theming.

### Palette

| Variable                          | Hex / value                   | Usage                                                    |
| --------------------------------- | ----------------------------- | -------------------------------------------------------- |
| `--main-bg`                       | `#333333`                     | Primary surface — navbars, modal headers, footer         |
| `--dark-bg`                       | `#101010`                     | Deepest background — chat, file panel                    |
| `--lite-bg`                       | `#4f4f4f`                     | Raised surface — modal header/footer bars, tooltip names |
| `--odd-bg`                        | `#202020`                     | Alternating row tint in list views                       |
| `--sel-bg`                        | `#444444`                     | Selected row background                                  |
| `--odd-sel-bg`                    | `#555555`                     | Selected row background on even rows                     |
| `--upload-bg`                     | `rgb(66,66,66)`               | Upload-in-progress row background                        |
| `--err-bg`                        | `#f75353`                     | Error state (e.g. failed upload row)                     |
| `--text-fg`                       | `#fefefe`                     | Primary text                                             |
| `--dark-fg`                       | `#aeaeae`                     | Muted / secondary text, default link color               |
| `--hi-fg` / `--hi-bg`             | `#f4f3f3` / `#282828`         | Highlighted message (mention, ping)                      |
| `--disabled-fg` / `--disabled-bg` | `white` / `#221818`           | Disabled input states                                    |
| `--surface-1`                     | `rgba(255,255,255,0.06)`      | Subtle overlay                                           |
| `--surface-2`                     | `rgba(255,255,255,0.12)`      | Default button fill                                      |
| `--surface-3`                     | `rgba(255,255,255,0.18)`      | Hover fill for buttons                                   |
| `--hairline`                      | `rgba(255,255,255,0.14)`      | All borders and dividers                                 |
| `--focus-ring`                    | `rgba(255,255,255,0.32)`      | Keyboard focus outline                                   |
| `--soft-shadow`                   | `0 4px 14px rgba(0,0,0,0.22)` | Elevation shadow                                         |
| `--role-user-fg`                  | `#23d16f`                     | Registered user nick colour                              |
| `--role-mod-fg`                   | `#d880fc`                     | Moderator nick colour                                    |
| `--role-system-fg`                | `#ff6c00`                     | System message colour                                    |

### Typography

| Variable        | Value                          | Usage                                    |
| --------------- | ------------------------------ | ---------------------------------------- |
| `--base-size`   | `12pt`                         | Root font size, inherited everywhere     |
| `--base-font`   | `'Rubik', 'Cairo', sans-serif` | Body and UI text                         |
| `--files-size`  | `11pt`                         | File list row font size                  |
| `--detail-size` | `8pt`                          | File row detail column (size, TTL, etc.) |

### Rules

- Always use variables when the color has semantic meaning (surface, border, text role).
- Hard-coded colors are only acceptable for feature-specific decoration that is intentionally not theme-aware (e.g. the green `is-new` pill tint `#ddf2e3`).
- Never use `color: black` or `background: white` for UI chrome.

---

## 4. Tooltips

### `title` attribute

Every interactive element (buttons, links, icons) **must** have a `title` attribute. Keep it concise, action-oriented, and written in title case.

```html
<div class="btn i-ban" title="Ban files"></div>
```

### Rich hover tooltips (`.tooltip`)

The rich tooltip (`entries/css/tooltip.css`) is used for hovering over usernames and file rows. It is a fixed-position grid with:

- A **header row** (`.tooltip-name`) that spans all columns — displays the name/nick in a `var(--lite-bg)` bar.
- An optional **preview column** (`.tooltip-preview`) on the left, `grid-row: 2 / -1`, max `200 × 200 px`.
- **Tag rows** using `.tooltip-tag-tag` (label, column 2) and `.tooltip-tag-value` (value, column 3).

```
┌────────────────────────────────────────────┐  ← .tooltip-name (span all cols)
│ 🖼  preview  │  label  │  value            │  ← grid-row 2…N
│              │  label  │  value            │
└────────────────────────────────────────────┘
```

Key CSS values:

- `font-size: 85%` relative to page
- `border-left-width: 1ex` colored accent (inherits from context)
- `border-top-left-radius: 1ex; border-bottom-right-radius: 1ex` — asymmetric corners
- Visible only when `.visible` class is added by JS

---

## 5. Modals and Dialogs

### Structure

Every modal is a `.modal` element inside a full-screen `.modal-holder` overlay:

```html
<div class="modal-holder">
  <div class="modal modal-<type>">
    <div class="modal-head">Title</div>
    <div class="modal-body">
      <!-- content -->
    </div>
    <div class="modal-buttons">
      <button class="modal-button modal-button-cancel">Cancel</button>
      <button class="modal-button modal-button-default">OK</button>
    </div>
  </div>
</div>
```

### Layout

`.modal` is a 3-row grid: `auto 1fr auto` (head / scrollable body / footer buttons).
Max size: `80%` wide, `90%` tall. Overflow hidden — the body scrolls, not the modal itself.
Left and right accent borders: `4px solid var(--lite-bg)`.

### Header (`.modal-head`)

- Background: `var(--lite-bg)`
- Font: `110%`, `font-weight: bold`
- Overflow: single line with `text-overflow: ellipsis`

### Body (`.modal-body`)

- Padding: `0.5ex 1em`; overflows vertically with `overflow-y: auto`
- Most dialog bodies use a 3-column grid: `auto 1fr 2fr` (icon | label | input)
- Each dialog type adds a `.modal-<name>` class that sets its own `grid-template-areas`

### Footer buttons (`.modal-buttons` / `.modal-button`)

Buttons are right-aligned in a flex row (`justify-content: flex-end`, `gap: 0.7em`).

| Class                   | Purpose                         | Appearance                                                      |
| ----------------------- | ------------------------------- | --------------------------------------------------------------- |
| `.modal-button`         | Base — all buttons inherit this | `border-radius: 8px`, `min-width: 5.5em`, semi-transparent fill |
| `.modal-button-default` | Primary / confirm action        | Greenish tint `rgba(192,232,205,…)`, white text `#f2fff5`       |
| `.modal-button-cancel`  | Dismiss / cancel                | More transparent, slightly muted white                          |

All buttons animate `translateY(-1px)` on hover, same as toolbar buttons. **Do not use bare `<button>` elements** inside `.modal-buttons` — always apply `.modal-button`.

### Checkboxes (`.modal input[type="checkbox"]`)

Custom-styled: `appearance: none`, gradient background, clip-path checkmark that scales in on `:checked`. Focus ring via `box-shadow`. Already handled globally for all checkboxes inside `.modal` — no extra classes needed.

### Icon area (`.modal .icon`)

For message-box style dialogs, place a `<div class="icon">` with a font glyph (`64px`). It is grid-positioned to span all body rows via `grid-area: icon`.

---

## 6. File List Items (`.file`)

### List mode row anatomy

Each row in the file list is a flex container:

```
┌─ .name ──────────────────────┬─ .tags ──────┬─ .detail ────────────────┐
│ [icon] name-text  [NEW pill]  │  [tag] [tag] │ size │ type │ TTL  [copy]│
└───────────────────────────────┴──────────────┴──────────────────────────┘
```

#### `.name` (flex: 1, min-width 0)

- Contains `.icon` (font glyph), `.name-text` (truncates with ellipsis), optional `.file-new-pill`
- Default color: `#efefef`
- New file color: `#ddf2e3` (class `.is-new`)
- Request file color: `#f5eaa4` (class `.request-file`)

#### `.file-new-pill`

Hidden by default (`display: none`). Shown when `.is-new` is on the row.
Style: tiny rounded badge, `font-size: 9px`, green tint for files, yellow tint for requests.

#### `.tags` (flex, `max-width: 66%`, right-aligned)

- Each tag: `.tag` — `font-size: 10px`, `border-radius: 999px`, `var(--surface-2)` background, truncates at `25ex`
- User tag: `.tag-user` — green tint `rgba(90,160,90,0.4)`
- Tags are clickable (filter by tag)

#### `.detail` (fixed `width: 212px`, flex row, `font-size: var(--detail-size)` = 8pt)

- Separated items use `border-left: 1px solid rgba(255,255,255,0.24)`
- `.size` — file size, color `#f1f1f1`
- `.ttl` — expiry time, `font-weight: 600`, color `#dbdbdb`, contains `.i-clock` icon + `.ttl-value`
- `.file-copy-meta-detail` — copy metadata link, pushed right with `margin-left: auto`, `opacity: 0.74`, `font-size: 12px`

### Row states

| Class                 | Visual effect                                                                    |
| --------------------- | -------------------------------------------------------------------------------- |
| `:nth-child(even)`    | Background `var(--odd-bg)`                                                       |
| `.selected`           | Background `var(--sel-bg)` / `var(--odd-sel-bg)`                                 |
| `:hover`              | Background `rgba(255,255,255,0.06)`, left accent border `rgba(255,255,255,0.22)` |
| `.notification-focus` | Blue tint `rgba(176,219,255,0.14)`, blue left border                             |
| `.hidden-file`        | `.name` has `text-decoration: line-through`                                      |
| `.upload`             | Striped progress background, animates `background-size`                          |
| `.error`              | Background `var(--err-bg)`                                                       |
| `.is-new`             | Name text green `#ddf2e3`, new pill visible                                      |

### Gallery mode

When `#files.gallerymode` is active, rows switch to fixed-size cards (`250 × 340 px`), `border-radius: 10px`, wrapped in a flex `gap: 0.85rem` grid. Card internals use absolutely positioned overlays for the preview image and detail strip at the bottom.

### New feature rows (Links Archive)

The `#links` panel mirrors `#files` row structure exactly: same padding (`0.42rem 0.9rem`), same left-accent border, same alternating `var(--odd-bg)`, same `.name` / `.tags` / `.detail` / `.file-new-pill` classes. When adding a new list panel, copy this structure and scope it under the new panel ID.
