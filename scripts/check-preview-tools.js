#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");

const warnOnly = process.argv.includes("--warn");
const commands = [
  ["file", ["--version"], "MIME detection"],
  ["exiftool", ["-ver"], "image and document metadata"],
  ["gm", ["version"], "PDF thumbnail rendering"],
  ["gs", ["--version"], "PDF rendering delegate"],
  ["pdftoppm", ["-v"], "PDF thumbnail fallback"],
  ["ffmpeg", ["-version"], "video and audio previews"],
  ["7z", ["i"], "7z and CB7 archive support"],
];

const missing = [];
for (const [command, args, purpose] of commands) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    missing.push(`${command} (${purpose})`);
  }
}

try {
  require("sharp");
}
catch (_) {
  missing.push("sharp (image thumbnail generation; install Node dependencies)");
}

if (!missing.length) {
  console.log("Preview tooling OK: images, PDFs, media, and archives are supported.");
  process.exit(0);
}

console.error(`Missing preview tooling:\n- ${missing.join("\n- ")}`);
if (process.platform === "linux") {
  console.error(
    "\nUbuntu/WSL: run `yarn setup:ubuntu` or install " +
      "`libimage-exiftool-perl graphicsmagick ghostscript poppler-utils " +
      "ffmpeg p7zip-full file`.",
  );
}
else {
  console.error("\nSee README.md > Install Preview Tooling for this platform.");
}
process.exitCode = warnOnly ? 0 : 1;
