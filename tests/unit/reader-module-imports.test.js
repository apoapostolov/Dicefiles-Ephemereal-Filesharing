"use strict";
/* eslint-env jest */

const fs = require("fs");
const path = require("path");
const { Linter } = require("eslint");

const readerModules = ["pdf.js", "book.js", "comic.js"];

describe("reader modules", () => {
  test.each(readerModules)("%s has no unresolved browser globals", filename => {
    const file = path.join(
      __dirname,
      "..",
      "..",
      "client",
      "files",
      "reader",
      filename,
    );
    const source = fs.readFileSync(file, "utf8");
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
});
