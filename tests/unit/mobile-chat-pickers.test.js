"use strict";
/* eslint-env jest */

const fs = require("fs");
const path = require("path");
const { Linter } = require("eslint");

const ROOT = path.join(__dirname, "..", "..");

describe("mobile chat picker placement", () => {
  test("chat picker module has no unresolved browser globals", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "client", "chatbox.js"),
      "utf8",
    );
    const messages = new Linter().verify(source, {
      env: {
        browser: true,
        es2022: true,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      rules: {
        "no-undef": "error",
      },
    });

    expect(messages).toEqual([]);
  });

  test("mobile variants anchor below the toolbar and remain viewport-bound", () => {
    const css = fs.readFileSync(
      path.join(ROOT, "entries", "css", "room.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.emoji-menu-down\s*\{[^}]*top:\s*calc\(100% \+ 0\.4rem\);[^}]*bottom:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.gif-menu-down\s*\{[^}]*top:\s*calc\(100% \+ 0\.4rem\);[^}]*bottom:\s*auto;/s,
    );
    expect(css).toMatch(/\.emoji-menu-down\s*\{[^}]*100vw/s);
    expect(css).toMatch(/\.gif-menu-down\.has-results\s*\{[^}]*45dvh/s);
  });
});
