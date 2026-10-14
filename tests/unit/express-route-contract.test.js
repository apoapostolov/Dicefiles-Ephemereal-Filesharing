"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

test("literal HTTP route paths register with the real Express router", () => {
  for (const file of ["lib/httpserver.js", "lib/http/federation.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
    const app = express();
    for (const match of source.matchAll(/app\.(get|post|patch|delete|all)\(\s*["']([^"']+)["']/g)) {
      expect(() => app[match[1]](match[2], (_req, res) => res.end())).not.toThrow();
    }
  }
});
