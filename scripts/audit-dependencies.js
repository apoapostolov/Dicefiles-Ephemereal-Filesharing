"use strict";

// Yarn 1 reports dependency paths, often mislabelling development dependencies.
// Summarize unique advisories and classify each path by its manifest root.
const { spawn } = require("child_process");
const readline = require("readline");
const manifest = require("../package.json");

const productionOnly = process.argv.includes("--production");
const severities = ["info", "low", "moderate", "high", "critical"];
const threshold = process.argv.find(arg => arg.startsWith("--fail-on="))?.split("=")[1] || "high";
if (!severities.includes(threshold)) {
  throw new Error("--fail-on must be info, low, moderate, high, or critical");
}
const runtimeRoots = new Set([
  ...Object.keys(manifest.dependencies || {}),
  ...Object.keys(manifest.optionalDependencies || {}),
]);
const advisories = new Map();
let summary;
let failed = false;
const child = spawn(process.platform === "win32" ? "yarn.cmd" : "yarn", ["audit", "--json"], {
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.on("data", () => {});
const lines = readline.createInterface({ input: child.stdout });
lines.on("line", line => {
  let entry;
  try {
    entry = JSON.parse(line);
  }
  catch (_) {
    return;
  }
  if (entry.type === "error") {
    failed = true;
    console.error(entry.data);
  }
  if (entry.type === "auditSummary") {
    summary = entry.data.vulnerabilities;
  }
  if (entry.type !== "auditAdvisory") {
    return;
  }
  const { advisory, resolution } = entry.data;
  const production = runtimeRoots.has(resolution.path.split(">")[0]);
  if (productionOnly && !production) {
    return;
  }
  const id = advisory.github_advisory_id || String(advisory.id);
  if (!advisories.has(id)) {
    advisories.set(id, {
      id, package: advisory.module_name, severity: advisory.severity,
      patched: advisory.patched_versions, url: advisory.url,
      production: false, paths: new Set(),
    });
  }
  const record = advisories.get(id);
  record.production ||= production;
  record.paths.add(resolution.path);
});
child.on("error", error => {
  console.error(error.message);
  process.exitCode = 2;
});
child.on("close", () => {
  if (!summary || failed) {
    console.error("Dependency audit did not complete; no clean result is available.");
    process.exitCode = 2;
    return;
  }
  const findings = Array.from(advisories.values(), entry => ({ ...entry, paths: [...entry.paths].sort() }));
  findings.sort((a, b) => severities.indexOf(b.severity) - severities.indexOf(a.severity) || a.id.localeCompare(b.id));
  console.log(JSON.stringify({
    scope: productionOnly ? "production" : "all",
    fullGraphYarnPathCounts: summary,
    uniqueAdvisories: findings.length,
    findings,
  }, null, 2));
  process.exitCode = findings.some(f => severities.indexOf(f.severity) >= severities.indexOf(threshold)) ? 1 : 0;
});
