"use strict";

// Curated surface ramps: id, display name, mood, canvas, panel, chrome,
// primary text, secondary text, accent. Components consume semantic variables.
const rows = [
  ["graphite", "Graphite", "Quiet neutral grey", "#101010", "#202020", "#333333", "#f4f4f4", "#b4b4b4", "#dedede"],
  ["obsidian", "Obsidian", "Deep black, silver edges", "#08090b", "#14161a", "#22252b", "#f0f2f5", "#b0b6c0", "#c6d2e5"],
  ["slate", "Slate", "Cool architectural stone", "#111820", "#1c2732", "#2b3b49", "#edf3f7", "#b0c0ce", "#9bc9e8"],
  ["midnight", "Midnight", "Inky blue and moonlight", "#0c1223", "#161f36", "#26334d", "#edf1ff", "#b5c2e0", "#a9bcff"],
  ["navy", "Navy", "Classic maritime blue", "#0b1726", "#13283c", "#203e55", "#eaf4fc", "#a9c3d8", "#83c9ee"],
  ["abyss", "Abyss", "Ocean depths", "#07191c", "#102c31", "#1c4249", "#e8f6f5", "#a8cacb", "#78d3cf"],
  ["fjord", "Fjord", "Muted Nordic water", "#111d24", "#1e3039", "#304651", "#eef5f7", "#b0c7d0", "#97ccda"],
  ["pine", "Pine", "Evergreen, low light", "#0e1b15", "#1b2d23", "#2b4133", "#edf6ed", "#b3c8b7", "#9ccea6"],
  ["moss", "Moss", "Soft woodland greens", "#171c12", "#293020", "#3b452e", "#f0f4e8", "#bdc9ab", "#bfd18f"],
  ["olive", "Olive", "Earthy and restrained", "#1c1d13", "#2c2e20", "#414331", "#f4f3e7", "#c8c8ac", "#d2d095"],
  ["espresso", "Espresso", "Roasted warm browns", "#1b1411", "#2c211c", "#44332a", "#f7eee7", "#cdb8a8", "#e6bd92"],
  ["cocoa", "Cocoa", "Soft chocolate and linen", "#211916", "#332824", "#493b34", "#f7eee9", "#cfbdb3", "#e7bfa8"],
  ["ember", "Ember", "Warm copper glow", "#201410", "#34221b", "#4c3327", "#fff0e6", "#d8b9a6", "#f0b283"],
  ["terracotta", "Terracotta", "Fired clay at dusk", "#241714", "#392621", "#523a31", "#fff0e9", "#d8b9ac", "#edb095"],
  ["oxblood", "Oxblood", "Dark leather and rose", "#211014", "#361c23", "#502b35", "#ffedf0", "#d7aeb9", "#eda6ba"],
  ["burgundy", "Burgundy", "Wine and parchment", "#20121d", "#331e2d", "#4b2c42", "#f9edf5", "#ceb1c5", "#e3a9cf"],
  ["plum", "Plum", "Smoked purple", "#1c1423", "#2d2238", "#42334e", "#f5eefc", "#c5b3d4", "#cdb0ed"],
  ["amethyst", "Amethyst", "Clear violet highlights", "#171326", "#27213c", "#3a3154", "#f1efff", "#bdb4dc", "#c4b0ff"],
  ["ink", "Ink", "Indigo reading room", "#121624", "#20273a", "#303b53", "#eff2ff", "#b5c0dc", "#b0c4ff"],
  ["storm", "Storm", "Rain clouds and steel", "#191c23", "#282d38", "#3b4351", "#f0f3f9", "#bcc5d4", "#c0d0ee"],
  ["charcoal", "Charcoal", "Warm studio charcoal", "#191817", "#292724", "#3c3934", "#f6f3ed", "#c3bdb1", "#dfd0b3"],
  ["carbon", "Carbon", "Precise high contrast", "#050505", "#151515", "#292929", "#ffffff", "#c4c4c4", "#ffffff"],
  ["eclipse", "Eclipse", "Black with amber", "#10100e", "#22211a", "#373428", "#faf5e4", "#cfc6a8", "#efcf85"],
  ["aubergine", "Aubergine", "Velvet evening", "#1b151c", "#2d2430", "#443549", "#f8eef9", "#cab6ce", "#ddb5e4"],
  ["petrol", "Petrol", "Blue-green machinery", "#0c1b1e", "#193036", "#29464e", "#ebf8fa", "#aecbd0", "#91d0d8"],
  ["sage-night", "Sage Night", "Dusty garden after dark", "#171e1b", "#27322d", "#3b4841", "#f0f6f1", "#bbccc0", "#bdd8c1"],
  ["paper", "Paper", "Clean neutral daylight", "#fafaf8", "#f0f0ed", "#e3e4df", "#242623", "#555b53", "#3f5c48", true],
  ["ivory", "Ivory", "Warm editorial white", "#fcf8ee", "#f2ebdc", "#e5dcc8", "#302b23", "#655b4a", "#76542f", true],
  ["linen", "Linen", "Natural flax", "#f7f3ec", "#ede6db", "#ded3c3", "#302c27", "#62594d", "#685132", true],
  ["mist", "Mist", "Cool silver daylight", "#f4f7fa", "#e8eef3", "#d8e1e9", "#23313c", "#506575", "#365f7f", true],
  ["sea-glass", "Sea Glass", "Quiet coastal green", "#f1f8f5", "#e1eee8", "#cbdfd5", "#20362d", "#405f50", "#28674d", true],
  ["rose-quartz", "Rose Quartz", "Soft mineral rose", "#fcf4f4", "#f1e5e7", "#e6d2d7", "#39272e", "#6e4d59", "#8b435d", true],
  ["lavender", "Lavender", "Pale violet paper", "#f7f5fc", "#ebe6f4", "#dcd4eb", "#30283e", "#655775", "#6d4c91", true],
  ["sand", "Sand", "Sunlit stone", "#f9f5ea", "#eee7d5", "#ded4bb", "#342f22", "#5d543e", "#684f1e", true],
];

const THEMES = rows.map(([id, name, description, canvas, panel, chrome, text, muted, accent, light]) =>
  Object.freeze({ id, name, description, canvas, panel, chrome, text, muted, accent, mode: light ? "light" : "dark" }));
const DEFAULT_THEME = "graphite";

function normalizeTheme(id) {
  return THEMES.some(theme => theme.id === id) ? id : DEFAULT_THEME;
}

function themeCSS() {
  return THEMES.map(t => `:root[data-theme="${t.id}"] {\n  color-scheme: ${t.mode};\n  --theme-canvas: ${t.canvas};\n  --theme-panel: ${t.panel};\n  --theme-chrome: ${t.chrome};\n  --theme-text: ${t.text};\n  --theme-muted: ${t.muted};\n  --theme-accent: ${t.accent};\n  --theme-danger: ${t.mode === "dark" ? "#ff9b9b" : "#a62435"};\n  --theme-success: ${t.mode === "dark" ? "#a1dbac" : "#28663a"};\n  --theme-warning: ${t.mode === "dark" ? "#efd08c" : "#755109"};\n}\n`).join("\n");
}

module.exports = { THEMES, DEFAULT_THEME, normalizeTheme, themeCSS };
