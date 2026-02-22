"use strict";

/**
 * Unit tests for Room.prune() and Room.destroy() logic.
 *
 * The Room class depends on Redis, DistributedMap, and the upload emitter,
 * so we mock those boundaries rather than requiring a live environment.
 */

// ── mock lib/broker ──────────────────────────────────────────────────────────
// Must be declared before requiring lib/room/index.js
const mockKeys = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockExists = jest.fn();
const mockSet = jest.fn();

jest.mock("../../lib/broker", () => {
  const emitter = { on: jest.fn(), off: jest.fn(), emit: jest.fn() };
  return Object.assign(emitter, {
    getMethods: () => ({
      keys: mockKeys,
      get: mockGet,
      del: mockDel,
      exists: mockExists,
      set: mockSet,
    }),
  });
});

// ── mock DistributedMap / DistributedTracking ─────────────────────────────────
const mockPconfigGet = jest.fn();
const mockPconfigSet = jest.fn();
const mockPconfigKill = jest.fn();

jest.mock("../../lib/broker/collections", () => {
  class DistributedMap {
    constructor() {
      this.loaded = Promise.resolve();
    }
    get(k) {
      return mockPconfigGet(k);
    }
    set(k, v) {
      return mockPconfigSet(k, v);
    }
    has() {
      return false;
    }
    delete() {}
    kill() {
      mockPconfigKill();
    }
    on() {}
    [Symbol.iterator]() {
      return [][Symbol.iterator]();
    }
  }

  class DistributedTracking {
    constructor() {
      this.loaded = Promise.resolve();
      this.size = 0;
    }
    on() {}
    incr() {
      return Promise.resolve(1);
    }
    decr() {
      return Promise.resolve(0);
    }
    kill() {}
  }

  return { DistributedMap, DistributedTracking };
});

// ── mock lib/upload ───────────────────────────────────────────────────────────
const mockFor = jest.fn();
const mockTrash = jest.fn();

jest.mock("../../lib/upload", () => ({
  EMITTER: {
    loaded: Promise.resolve(),
    for: mockFor,
    trash: mockTrash,
  },
}));

// ── mock lib/config ───────────────────────────────────────────────────────────
let configValues = {};
jest.mock("../../lib/config", () => ({
  get: (k) => configValues[k],
}));

// ── mock other lib/room deps that aren't under test ───────────────────────────
jest.mock("../../lib/bans", () => ({}));
jest.mock("../../lib/nicknames", () => ({ randomRN: () => "Test Room" }));
jest.mock("../../lib/tracking", () => ({ FloodProtector: class {} }));
jest.mock("../../lib/util", () => ({
  CoalescedUpdate: class {
    add() {}
  },
  debounce: (fn) => fn,
  sort: (a) => a,
  toMessage: async (s) => s,
  token: async () => "testid",
}));
jest.mock("../../lib/room/filelister", () => ({
  FileLister: class {
    constructor() {
      this.loaded = Promise.resolve();
    }
    kill() {}
    for() {
      return Promise.resolve([]);
    }
  },
}));
jest.mock(
  "../../lib/room/linklister",
  () =>
    class {
      constructor() {}
      kill() {}
    },
);

const { Room } = require("../../lib/room/index");

// ─────────────────────────────────────────────────────────────────────────────
// Room.prune()
// ─────────────────────────────────────────────────────────────────────────────

describe("Room.prune()", () => {
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.clearAllMocks();
    configValues = { roomPruning: true, roomPruningDays: 21 };
    mockFor.mockResolvedValue([]);
    mockTrash.mockResolvedValue();
    mockDel.mockResolvedValue();
    mockGet.mockResolvedValue(null);
  });

  test("returns 0 and does nothing when roomPruning is disabled", async () => {
    configValues.roomPruning = false;
    mockKeys.mockResolvedValue(["rooms:abc123"]);

    const pruned = await Room.prune();

    expect(pruned).toBe(0);
    expect(mockDel).not.toHaveBeenCalled();
  });

  test("returns 0 when all rooms are recently active (lastActivity in pconfig)", async () => {
    mockKeys.mockResolvedValue(["rooms:activeroom"]);
    // lastActivity is NOW — well within the cutoff window
    mockPconfigGet.mockImplementation((k) =>
      k === "lastActivity" ? Date.now() : undefined,
    );

    const pruned = await Room.prune();

    expect(pruned).toBe(0);
    expect(mockDel).not.toHaveBeenCalled();
  });

  test("prunes a room whose lastActivity is older than roomPruningDays", async () => {
    mockKeys.mockResolvedValue(["rooms:oldroom"]);
    // lastActivity was 30 days ago — exceeds default 21-day cutoff
    const staleTime = Date.now() - 30 * DAY;
    mockPconfigGet.mockImplementation((k) =>
      k === "lastActivity" ? staleTime : undefined,
    );

    const pruned = await Room.prune();

    expect(pruned).toBe(1);
    // destroy() must wipe the three Redis keys
    expect(mockDel).toHaveBeenCalledWith(
      "rooms:oldroom",
      "map:rco:oldroom",
      "map:rpco:oldroom",
    );
  });

  test("falls back to room creation timestamp when pconfig has no lastActivity", async () => {
    mockKeys.mockResolvedValue(["rooms:newishroom"]);
    // pconfig has no lastActivity entry
    mockPconfigGet.mockReturnValue(undefined);
    // creation timestamp stored as Redis key value — 30 days ago
    const staleTime = Date.now() - 30 * DAY;
    mockGet.mockImplementation((k) =>
      k === "rooms:newishroom" ? String(staleTime) : null,
    );

    const pruned = await Room.prune();

    expect(pruned).toBe(1);
    expect(mockDel).toHaveBeenCalledWith(
      "rooms:newishroom",
      "map:rco:newishroom",
      "map:rpco:newishroom",
    );
  });

  test("leaves a room alone when neither lastActivity nor creation timestamp can be read", async () => {
    mockKeys.mockResolvedValue(["rooms:unknownroom"]);
    mockPconfigGet.mockReturnValue(undefined);
    // Redis get returns null — no creation time stored
    mockGet.mockResolvedValue(null);

    const pruned = await Room.prune();

    expect(pruned).toBe(0);
    expect(mockDel).not.toHaveBeenCalled();
  });

  test("skips a room if pconfig load throws, continues with others", async () => {
    mockKeys.mockResolvedValue(["rooms:broken", "rooms:stale"]);
    const staleTime = Date.now() - 30 * DAY;

    // First call (broken): throw during pconfig construction → the mock's
    // `get` will throw for the first roomid by checking a call counter.
    let callCount = 0;
    mockPconfigGet.mockImplementation((k) => {
      callCount++;
      if (callCount === 1) throw new Error("Redis timeout");
      return k === "lastActivity" ? staleTime : undefined;
    });

    const pruned = await Room.prune();

    // "broken" skipped, "stale" pruned
    expect(pruned).toBe(1);
  });

  test("respects custom roomPruningDays (7 days)", async () => {
    configValues.roomPruningDays = 7;
    mockKeys.mockResolvedValue(["rooms:room10days"]);
    // 10 days ago — older than 7-day cutoff
    mockPconfigGet.mockImplementation((k) =>
      k === "lastActivity" ? Date.now() - 10 * DAY : undefined,
    );

    const pruned = await Room.prune();
    expect(pruned).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Room.touchActivity()
// ─────────────────────────────────────────────────────────────────────────────

describe("Room.touchActivity()", () => {
  test("writes lastActivity to pconfig when no prior value exists", async () => {
    mockExists.mockResolvedValue(1);
    mockKeys.mockResolvedValue([]);
    // Construct a room by using the internal constructor path is complex
    // due to LOADING; test the method logic directly via a minimal stub.
    const pconfig = {
      get: jest.fn().mockReturnValue(undefined),
      set: jest.fn(),
    };
    const room = Object.create(Room.prototype);
    room.pconfig = pconfig;

    room.touchActivity();

    expect(pconfig.set).toHaveBeenCalledWith(
      "lastActivity",
      expect.any(Number),
    );
  });

  test("does NOT write again within the 5-minute debounce window", () => {
    const now = Date.now();
    const pconfig = {
      // last write happened 1 minute ago — within 5-min window
      get: jest.fn().mockReturnValue(now - 60 * 1000),
      set: jest.fn(),
    };
    const room = Object.create(Room.prototype);
    room.pconfig = pconfig;

    room.touchActivity();

    expect(pconfig.set).not.toHaveBeenCalled();
  });

  test("writes again after the 5-minute debounce window has elapsed", () => {
    const now = Date.now();
    const pconfig = {
      // last write happened 6 minutes ago — outside 5-min window
      get: jest.fn().mockReturnValue(now - 6 * 60 * 1000),
      set: jest.fn(),
    };
    const room = Object.create(Room.prototype);
    room.pconfig = pconfig;

    room.touchActivity();

    expect(pconfig.set).toHaveBeenCalledWith(
      "lastActivity",
      expect.any(Number),
    );
  });
});
