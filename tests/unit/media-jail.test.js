"use strict";

/**
 * Unit tests for lib/media/jail.js
 *
 * Coverage:
 *   - maybeJail()   — wraps in firejail only when the config asks for it, and
 *                     exposes privateDir as the jail's private home
 *   - spawnBounded() — collects stdout, and kills the child the moment it
 *                     outgrows the byte cap or the wall-clock timeout
 *
 * The child processes are ordinary Node one-liners, so no external tool and no
 * network is involved.
 */

function loadJail(jail) {
  jest.resetModules();
  jest.doMock("../../lib/config", () => ({
    get: key => (key === "jail" ? jail : undefined),
  }));
  return require("../../lib/media/jail");
}

describe("maybeJail", () => {
  test("passes the command through when the jail is off", () => {
    const { maybeJail } = loadJail(false);
    expect(maybeJail(["7z", "l", "a.7z"])).toEqual(["7z", "l", "a.7z"]);
  });

  test("wraps the command in firejail when the jail is on", () => {
    const { maybeJail } = loadJail(true);
    const argv = maybeJail(["7z", "l", "a.7z"]);
    expect(argv[0]).toBe("firejail");
    expect(argv).toContain("--");
    expect(argv.slice(-3)).toEqual(["7z", "l", "a.7z"]);
  });

  test("gives the jail a private home when a directory is named", () => {
    const { maybeJail } = loadJail(true);
    const argv = maybeJail(["7z", "l", "a.7z"], { privateDir: "/uploads/ab" });
    expect(argv.some(a => a === "--private=/uploads/ab")).toBe(true);
  });

  test("never wraps a command that already carries the jail", () => {
    const { wrapArgs } = loadJail(true);
    const alreadyJailed = [
      "firejail",
      "--quiet",
      "--profile=/p",
      "pdftoppm",
      "-f",
      "1",
    ];
    // A second wrapper would be a firejail inside a firejail.
    expect(wrapArgs(alreadyJailed)).toEqual(alreadyJailed);
    expect(wrapArgs(["7z", "l", "a.7z"])[0]).toBe("firejail");
  });
});

describe("spawnBounded", () => {
  const node = process.execPath;

  test("collects stdout and the exit code", async () => {
    const { spawnBounded } = loadJail(false);
    const result = await spawnBounded(
      [node, "-e", "process.stdout.write('hello')"],
      { timeoutMs: 10000 },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.toString()).toBe("hello");
    expect(result.truncated).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test("keeps stderr for diagnostics", async () => {
    const { spawnBounded } = loadJail(false);
    const result = await spawnBounded(
      [node, "-e", "process.stderr.write('warn'); process.stdout.write('ok')"],
      { timeoutMs: 10000 },
    );
    expect(result.stderr).toBe("warn");
    expect(result.stdout.toString()).toBe("ok");
  });

  test("kills a child that outgrows the byte cap", async () => {
    const { spawnBounded } = loadJail(false);
    const result = await spawnBounded(
      [
        node,
        "-e",
        "const b = Buffer.alloc(1024, 65); for (;;) process.stdout.write(b);",
      ],
      { maxBytes: 4096, timeoutMs: 10000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
  });

  test("kills a child that outlasts the timeout", async () => {
    const { spawnBounded } = loadJail(false);
    const result = await spawnBounded(
      [node, "-e", "setTimeout(() => {}, 60000)"],
      { timeoutMs: 300 },
    );
    expect(result.timedOut).toBe(true);
  });

  test("surfaces a spawn failure instead of hanging", async () => {
    const { spawnBounded } = loadJail(false);
    await expect(
      spawnBounded(["/nonexistent/dicefiles-tool"], { timeoutMs: 5000 }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
