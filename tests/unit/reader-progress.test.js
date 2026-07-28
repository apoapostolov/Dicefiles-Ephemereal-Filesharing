"use strict";

const {
  PROGRESS_PREFIX,
  listProgressRecords,
  pruneProgressStorage,
} = require("../../lib/room/reader-progress");

class MemoryStorage {
  constructor(entries = {}) {
    this.data = new Map(Object.entries(entries));
  }

  get length() {
    return this.data.size;
  }

  key(index) {
    return Array.from(this.data.keys())[index] || null;
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, String(value));
  }

  removeItem(key) {
    this.data.delete(key);
  }
}

function progressKey(fileKey) {
  return `${PROGRESS_PREFIX}${fileKey}`;
}

describe("reader progress storage", () => {
  test("lists current-room records without deleting other rooms", () => {
    const storage = new MemoryStorage({
      [progressKey("room-a-file")]: JSON.stringify({
        page: 7,
        updatedAt: 200,
      }),
      [progressKey("room-b-file")]: JSON.stringify({
        page: 3,
        updatedAt: 100,
      }),
    });
    expect(
      listProgressRecords(storage, new Set(["room-a-file"])).map(
        (record) => record.fileKey,
      ),
    ).toEqual(["room-a-file"]);

    pruneProgressStorage(storage, {
      now: 300,
      maxAgeMs: 1000,
      maxEntries: 10,
    });
    expect(storage.getItem(progressKey("room-b-file"))).not.toBeNull();
  });

  test("keeps valid legacy positions and sorts them after timestamped ones", () => {
    const storage = new MemoryStorage({
      [progressKey("legacy")]: JSON.stringify({ page: 9 }),
      [progressKey("current")]: JSON.stringify({
        page: 2,
        updatedAt: 500,
      }),
    });
    expect(
      listProgressRecords(storage, new Set(["legacy", "current"])).map(
        (record) => record.fileKey,
      ),
    ).toEqual(["current", "legacy"]);
  });

  test("prunes corrupt, expired, and excess records only", () => {
    const storage = new MemoryStorage({
      unrelated: "keep",
      [progressKey("corrupt")]: "{",
      [progressKey("expired")]: JSON.stringify({
        page: 1,
        updatedAt: 10,
      }),
      [progressKey("newest")]: JSON.stringify({
        page: 2,
        updatedAt: 950,
      }),
      [progressKey("older")]: JSON.stringify({
        page: 3,
        updatedAt: 900,
      }),
    });
    const removed = pruneProgressStorage(storage, {
      now: 1000,
      maxAgeMs: 200,
      maxEntries: 1,
    });
    expect(new Set(removed)).toEqual(
      new Set([
        progressKey("corrupt"),
        progressKey("expired"),
        progressKey("older"),
      ]),
    );
    expect(storage.getItem(progressKey("newest"))).not.toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
  });
});
