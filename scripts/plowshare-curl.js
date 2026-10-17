#!/usr/bin/env node
"use strict";

// Operator-installed modules use normal curl semantics through a pinned proxy.
const { spawn } = require("child_process");

const proxy = process.env.HOBBYFILES_EGRESS_PROXY;
if (!proxy) {
  process.exit(2);
}
const args = process.argv.slice(2);
const forbidden = /^(--(proxy|preproxy|noproxy|next|config|resolve|connect-to|unix-socket|abstract-unix-socket|proto|proto-redir)|-[Kx])(?:=|$)/;
if (args.some(arg => forbidden.test(arg) || /^-[Kx]/.test(arg) || /^--proxy/.test(arg))) {
  process.exit(2);
}
const child = spawn("/usr/bin/curl", ["-q", ...args, "--proxy", proxy, "--noproxy", "", "--proto", "=https", "--proto-redir", "=https", "--max-time", "60", "--connect-timeout", "10"], { stdio: "inherit", shell: false });
child.on("error", () => process.exit(2));
child.on("exit", code => process.exit(code == null ? 2 : code));
