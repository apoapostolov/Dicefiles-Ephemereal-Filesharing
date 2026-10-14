# Appearance and themes

Open **Appearance** (the preferences glyph at the top right of a room, or the
bottom right on other pages). Choose from 34 palettes: 26 dark and 8 light.
Search by name, mood or color. Selection applies immediately, persists on this
device, and synchronizes between tabs. Graphite retains the neutral grey default.
The picker supports keyboard navigation, visible focus, Escape to close and
focus return. If browser storage is blocked, selection works for the current page.

Themes cover room chrome, file lists and galleries, menus, modals, account and
status pages, scrollbars and reader controls. EPUB/MOBI text uses the selected
palette and updates without resetting the reading position. Original image,
comic and PDF page colors remain faithful to their source files.

## Color system

`common/themes.js` is the curated palette catalogue. Each palette supplies
canvas, panel, chrome, text, muted text and accent colors. Build generates
`entries/css/themes.css`; edit the catalogue, then run `yarn prestart`.
`entries/css/base.css` maps those primitives to semantic variables:

| Role | Variables |
| --- | --- |
| Surfaces | `--dark-bg`, `--panel-bg`, `--main-bg`, `--lite-bg` |
| Text | `--text-fg`, `--dark-fg` |
| Interaction | `--accent`, `--accent-soft`, `--sel-bg`, `--focus-ring` |
| Borders / overlays | `--hairline`, `--control-border-hover`, `--surface-1` through `--surface-3`, `--overlay-bg`, `--shadow-color` |
| Meaning | `--success`, `--warning`, `--danger` and their `-soft` variants |
| Roles | `--role-user-fg`, `--role-mod-fg`, `--role-system-fg`, `--role-bot-fg` |

Components must consume semantic variables. Avoid new literal colors, separate
palette copies and color-only status labels. Surface overlays use `color-mix`
so light and dark themes share the same components. Swatches intentionally use
palette primitives. Uploaded media and content pixels are not theme tokens.

The theme regression suite checks unique IDs, the generated catalogue,
absence of component color literals, and WCAG AA contrast (at least 4.5:1) for
primary, secondary and accent text on all three core surfaces. This is a
palette check; rendered controls and interactions still require browser review.

## Adding a theme

Add a row to `common/themes.js`, with a stable lowercase ID, descriptive name,
mood, three surfaces, two text colors, accent, and optional `true` for light
mode. Keep ramps restrained and text readable on every surface. Run
`yarn test --runInBand tests/unit/themes.test.js`, build, and inspect a room,
gallery, picker, reader and non-room page at phone/tablet/desktop widths.
