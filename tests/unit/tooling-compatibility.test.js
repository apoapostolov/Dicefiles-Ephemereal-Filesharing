"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { loadNycConfig } = require("@istanbuljs/load-nyc-config");

test("Istanbul reads YAML configuration using the maintained js-yaml API", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dice-yaml-"));
  try {
    await fs.writeFile(path.join(directory, ".nycrc.yml"), "include:\n  - lib/**/*.js\nall: true\n");
    const config = await loadNycConfig({ cwd: directory });
    expect(config.include).toEqual(["lib/**/*.js"]); expect(config.all).toBe(true);
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("container smoke and multi-architecture publication keep separate caches", async () => {
  const workflow = (await fs.readFile(path.join(__dirname, "../../.github/workflows/container.yml"), "utf8")).replace(/\r\n/g, "\n");
  const scopes = [...workflow.matchAll(/cache-to: type=gha,scope=([\w-]+),mode=max/g)].map(match => match[1]);
  expect(scopes).toEqual(["hobbyfiles-smoke", "hobbyfiles-multiarch"]);
  for (const scope of scopes) {
    expect(workflow).toContain(`type=gha,scope=${scope}\n`);
  }
});
