"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadEnvironment, applyEnvironment, FIELDS } = require("../../lib/environment");

test("loads private env with process precedence and no shell expansion", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hobbyfiles-env-"));
  try {
    fs.writeFileSync(path.join(directory, ".env"), "HTTP_PORT=8080\nHOBBYFILES_SECRET=\"$(never execute)\"\n");
    const env = { HTTP_PORT: "9000" };
    loadEnvironment(directory, env);
    expect(env.HTTP_PORT).toBe("9000");
    expect(env.HOBBYFILES_SECRET).toBe("$(never execute)");
  }
  finally {
    fs.rmSync(directory, { recursive: true });
  }
});
test("validates flags and numeric settings without exposing their contents", () => {
  expect(() => applyEnvironment(new Map(), { HOBBYFILES_JAIL: "secret" })).toThrow("must be true or false");
  expect(() => applyEnvironment(new Map(), { HTTP_PORT: "65536" })).toThrow("1 to 65535");
  const config = new Map();
  applyEnvironment(config, { HOBBYFILES_JAIL: "false", HOBBYFILES_WORKERS: "2", HOBBYFILES_AUTOMATION_KEYS: "[]" });
  expect(config.get("jail")).toBe(false);
  expect(config.get("workers")).toBe(2);
  expect(config.get("automationApiKeys")).toEqual([]);
});
test("accepts legacy DICEFILES settings and prefers Hobbyfiles names", () => {
  const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hobbyfiles-legacy-env-"));
  try {
    fs.writeFileSync(path.join(legacyDirectory, ".env"), "DICEFILES_SECRET=file-secret\nDICEFILES_JAIL=false\n");
    const env = { DICEFILES_SECRET: "process-secret", HOBBYFILES_SECRET: "current-secret" };
    loadEnvironment(legacyDirectory, env);
    expect(env.HOBBYFILES_SECRET).toBe("current-secret");
    expect(env.HOBBYFILES_JAIL).toBe("false");

    const config = new Map();
    applyEnvironment(config, { DICEFILES_JAIL: "false", DICEFILES_WORKERS: "3" });
    expect(config.get("jail")).toBe(false);
    expect(config.get("workers")).toBe(3);
  }
  finally {
    fs.rmSync(legacyDirectory, { recursive: true });
  }
});
test("all web environment overrides are documented", () => {
  const docs = fs.readFileSync(path.join(__dirname, "../../docs/ENVIRONMENT.md"), "utf8");
  for (const key of Object.keys(FIELDS)) {
    expect(docs).toContain(key);
  }
});
