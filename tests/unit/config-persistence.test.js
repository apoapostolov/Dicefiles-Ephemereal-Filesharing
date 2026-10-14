"use strict";

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { persistConfig } = require("../../lib/config-persistence");

test("concurrent config patches merge, preserve secrets and mode, and reject corrupt input", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dice-config-"));
  const file = path.join(directory, "config.json");
  try {
    await fs.writeFile(file, JSON.stringify({ private: "synthetic-secret" }), { mode: 0o600 });
    await Promise.all([persistConfig({ name: "test" }, file), persistConfig({ motto: "test" }, file)]);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ private: "synthetic-secret", name: "test", motto: "test" });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await fs.writeFile(file, "invalid");
    await expect(persistConfig({ name: "replacement" }, file)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("invalid");
    expect(await fs.readdir(directory)).toEqual(["config.json"]);
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
