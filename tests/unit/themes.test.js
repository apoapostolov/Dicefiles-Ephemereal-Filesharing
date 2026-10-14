"use strict";

const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const { THEMES, normalizeTheme, themeCSS } = require("../../common/themes");

function luminance(hex) {
  const linear = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("at least 30 unique palettes, mostly dark, with safe persisted IDs", () => {
  expect(THEMES.length).toBeGreaterThanOrEqual(30);
  expect(new Set(THEMES.map(t => t.id)).size).toBe(THEMES.length);
  expect(THEMES.filter(t => t.mode === "dark").length).toBeGreaterThan(THEMES.length / 2);
  expect(normalizeTheme("bad\"<script>")).toBe("graphite");
});
test.each(THEMES)("$name text meets WCAG AA on each core surface", theme => {
  for (const surface of [theme.canvas, theme.panel, theme.chrome]) {
    expect(contrast(theme.text, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.muted, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent, surface)).toBeGreaterThanOrEqual(4.5);
  }
});
test("palette CSS matches the source catalogue", () => {
  expect(fs.readFileSync(path.join(__dirname, "../../entries/css/themes.css"), "utf8")).toBe(themeCSS());
});
test("component CSS has no literal colors outside token declarations", () => {
  const directory = path.join(__dirname, "../../entries/css");
  for (const file of fs.readdirSync(directory).filter(f => f.endsWith(".css"))) {
    const root = postcss.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    root.walkDecls(declaration => {
      if (declaration.prop.startsWith("--theme-") || declaration.prop === "--shadow-color") {
        return;
      }
      expect({ file, property: declaration.prop, literal: /#[\da-f]{3,8}\b|rgba?\(|(?:^|\s)(?:white|black|red|green|blue|orchid|lightgreen)(?:\s|$)/i.test(declaration.value) }).toMatchObject({ literal: false });
    });
  }
});
