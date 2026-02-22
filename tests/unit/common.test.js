"use strict";

/**
 * Unit tests for common/index.js utilities.
 * These are pure functions with no external dependencies.
 */

const {
  toPrettySize,
  toPrettyInt,
  toPrettyDuration,
  toPrettyETA,
  ofilter,
  parseCommand,
  CoalescedUpdate,
  debounce,
  plural,
  shuffle,
  randint,
  sleep,
  memoize,
} = require("../../common/index.js");

// ─────────────────────────────────────────────────────────────────────────────
// toPrettySize
// ─────────────────────────────────────────────────────────────────────────────
describe("toPrettySize", () => {
  test("0 bytes", () => expect(toPrettySize(0)).toBe("0 B"));
  test("512 bytes", () => expect(toPrettySize(512)).toBe("512 B"));
  // Note: toPrettySize uses strict '>' so 1024 stays in bytes; 1025 crosses to KiB
  test("1024 bytes stays as bytes (boundary is exclusive)", () =>
    expect(toPrettySize(1024)).toBe("1024 B"));
  test("1025 bytes enters KiB range", () =>
    expect(toPrettySize(1025)).toMatch(/KiB/));
  test("2560 bytes shows KiB", () => expect(toPrettySize(2560)).toMatch(/KiB/));
  test("1 MiB value shows KiB (boundary exclusive)", () =>
    expect(toPrettySize(1024 * 1024)).toMatch(/KiB/));
  test("slightly above 1 MiB shows MiB", () =>
    expect(toPrettySize(1024 * 1024 + 1)).toMatch(/MiB/));
  test("slightly above 1 GiB shows GiB", () =>
    expect(toPrettySize(1024 ** 3 + 1)).toMatch(/GiB/));
  test("slightly above 1 TiB shows TiB", () =>
    expect(toPrettySize(1024 ** 4 + 1)).toMatch(/TiB/));
  test("large size uses extra decimal (>1 TiB)", () => {
    const result = toPrettySize(1.5 * 1024 ** 4);
    expect(result).toMatch(/TiB/);
  });
  test("returns a string", () =>
    expect(typeof toPrettySize(100)).toBe("string"));
  test("non-integer bytes", () => {
    const result = toPrettySize(1500);
    expect(result).toMatch(/KiB/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toPrettyInt
// ─────────────────────────────────────────────────────────────────────────────
describe("toPrettyInt", () => {
  test("zero", () => expect(toPrettyInt(0)).toBe("0"));
  test("small number", () => expect(toPrettyInt(42)).toBe("42"));
  test("thousands grouped", () => {
    const result = toPrettyInt(1234);
    // Locale-dependent separator (comma in en-US) but should contain 1 and 234
    expect(result).toMatch(/1.234/);
  });
  test("million", () => {
    const result = toPrettyInt(1_000_000);
    expect(result).toMatch(/1/);
  });
  test("returns string", () => expect(typeof toPrettyInt(5)).toBe("string"));
});

// ─────────────────────────────────────────────────────────────────────────────
// toPrettyDuration
// ─────────────────────────────────────────────────────────────────────────────
describe("toPrettyDuration", () => {
  test("60 seconds (1 minute)", () =>
    expect(toPrettyDuration(60000)).toContain("min"));
  test("1 hour", () => expect(toPrettyDuration(3600000)).toContain("hour"));
  test("1 day", () => expect(toPrettyDuration(86400000)).toContain("day"));
  test("1 week", () =>
    expect(toPrettyDuration(7 * 86400000)).toContain("week"));
  test("short mode — 1 hour", () =>
    expect(toPrettyDuration(3600000, true)).toContain("hour"));
  test("short mode — 1 min", () =>
    expect(toPrettyDuration(90000, true)).toContain("min"));
  test("short mode — seconds", () =>
    expect(toPrettyDuration(5000, true)).toBe("5 s"));
  test("zero duration", () => expect(toPrettyDuration(0)).toBe(""));
});

// ─────────────────────────────────────────────────────────────────────────────
// toPrettyETA
// ─────────────────────────────────────────────────────────────────────────────
describe("toPrettyETA", () => {
  test("zero", () => expect(toPrettyETA(0)).toBe("00:00"));
  test("one minute", () => expect(toPrettyETA(60)).toBe("01:00"));
  // Hours use zero-padded 2-digit format
  test("one hour", () => expect(toPrettyETA(3600)).toBe("01:00:00"));
  // Days use "DD::HH:MM:SS" (double colon after day part)
  test("one day", () => expect(toPrettyETA(86400)).toBe("01::00:00"));
  test("two minutes", () => expect(toPrettyETA(120)).toBe("02:00"));
  test("returns string", () => expect(typeof toPrettyETA(120)).toBe("string"));
});

// ─────────────────────────────────────────────────────────────────────────────
// ofilter
// ─────────────────────────────────────────────────────────────────────────────
describe("ofilter", () => {
  test("keeps only keys in set", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = ofilter(obj, new Set(["a", "c"]));
    expect(result).toEqual({ a: 1, c: 3 });
    expect(result.b).toBeUndefined();
  });

  test("returns empty object when no keys match", () => {
    const obj = { x: 1 };
    expect(ofilter(obj, new Set(["y"]))).toEqual({});
  });

  test("does not include prototype keys", () => {
    class Foo {
      constructor() {
        this.a = 1;
      }
    }
    Foo.prototype.proto = "inherited";
    const result = ofilter(new Foo(), new Set(["proto"]));
    expect(result.proto).toBeUndefined();
  });

  test("empty input object returns empty", () => {
    expect(ofilter({}, new Set(["a"]))).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCommand
// ─────────────────────────────────────────────────────────────────────────────
describe("parseCommand", () => {
  test("non-command returns null", () => {
    expect(parseCommand("hello world")).toBeNull();
  });

  test("double-slash is not a command", () => {
    expect(parseCommand("//url.com")).toBeNull();
  });

  test("command with no args", () => {
    const result = parseCommand("/kick");
    expect(result).not.toBeNull();
    expect(result.cmd).toBe("kick");
    expect(result.args).toBe("");
    expect(result.str).toBe("/kick");
  });

  test("command with args", () => {
    const result = parseCommand("/ban SomeUser flood");
    expect(result.cmd).toBe("ban");
    expect(result.args).toBe("SomeUser flood");
  });

  test("command is lowercased", () => {
    const result = parseCommand("/KICK user");
    expect(result.cmd).toBe("kick");
  });

  test("empty string returns null", () => {
    expect(parseCommand("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// plural
// ─────────────────────────────────────────────────────────────────────────────
describe("plural", () => {
  test("1 gives singular", () =>
    expect(plural(1, "file", "files")).toBe("1 file"));
  test("0 gives plural", () =>
    expect(plural(0, "file", "files")).toBe("0 files"));
  test("2 gives plural", () =>
    expect(plural(2, "file", "files")).toBe("2 files"));
  test("large number gives plural", () =>
    expect(plural(100, "item", "items")).toBe("100 items"));
});

// ─────────────────────────────────────────────────────────────────────────────
// shuffle
// ─────────────────────────────────────────────────────────────────────────────
describe("shuffle", () => {
  test("returns the same array reference", () => {
    const arr = [1, 2, 3];
    expect(shuffle(arr)).toBe(arr);
  });

  test("returns same elements (just reordered)", () => {
    const arr = [1, 2, 3, 4, 5];
    shuffle(arr);
    expect(arr.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("empty array is safe", () => {
    expect(() => shuffle([])).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// randint
// ─────────────────────────────────────────────────────────────────────────────
describe("randint", () => {
  test("result within [min, max)", () => {
    for (let i = 0; i < 200; i++) {
      const n = randint(5, 10);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThan(10);
    }
  });

  test("returns integer", () => {
    expect(Number.isInteger(randint(0, 100))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sleep
// ─────────────────────────────────────────────────────────────────────────────
describe("sleep", () => {
  test("resolves after approximately the given ms", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// debounce
// ─────────────────────────────────────────────────────────────────────────────
describe("debounce", () => {
  test("throws when wrapped function has parameters", () => {
    expect(() => debounce((x) => x)).toThrow();
  });

  test("fires the callback after the timeout", async () => {
    let called = 0;
    const fn = debounce(() => {
      called++;
    }, 20);
    fn();
    fn();
    fn();
    await sleep(50);
    expect(called).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CoalescedUpdate
// ─────────────────────────────────────────────────────────────────────────────
describe("CoalescedUpdate", () => {
  test("fires callback with all recorded items", async () => {
    const items = [];
    const cu = new CoalescedUpdate(30, (batch) => items.push(...batch));
    cu.add("a");
    cu.add("b");
    cu.add("c");
    await sleep(80);
    expect(items.sort()).toEqual(["a", "b", "c"]);
  });

  test("deduplicates items (it is a Set)", async () => {
    const items = [];
    const cu = new CoalescedUpdate(30, (batch) => items.push(...batch));
    cu.add("x");
    cu.add("x");
    await sleep(80);
    expect(items).toHaveLength(1);
    expect(items[0]).toBe("x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// memoize
// ─────────────────────────────────────────────────────────────────────────────
describe("memoize", () => {
  // memoize requires at least 1 argument; it caches by first argument
  test("caches result for single-arg functions", () => {
    let calls = 0;
    const fn = memoize((x) => {
      calls++;
      return x * 2;
    });
    expect(fn(5)).toBe(10);
    expect(fn(5)).toBe(10);
    expect(calls).toBe(1); // only computed once
    expect(fn(3)).toBe(6);
    expect(calls).toBe(2); // new argument = new computation
  });

  test("different args return different cached values", () => {
    const fn = memoize((x) => x + 1);
    expect(fn(1)).toBe(2);
    expect(fn(2)).toBe(3);
  });
});
