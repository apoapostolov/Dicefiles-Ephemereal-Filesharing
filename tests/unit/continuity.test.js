"use strict";

const {
  buildActivityDigest,
  buildResumeEntries,
  didCompleteCatchUpDownload,
  isLinkedDelta,
  normalizeVisitState,
} = require("../../lib/room/continuity");

function file(key, uploaded, extra = {}) {
  return Object.assign(
    {
      key,
      name: `${key}.pdf`,
      uploaded,
      meta: {},
    },
    extra,
  );
}

describe("room continuity and discovery", () => {
  test("normalizes old visit records without inventing a linked baseline", () => {
    expect(
      normalizeVisitState({ lastSeenServerTime: 100 }, 50),
    ).toEqual({
      lastSeenServerTime: 100,
      knownLinkedKeys: null,
      knownLinkedRooms: null,
    });
  });

  test("classifies local, bot, linked, request, and fulfillment activity once", () => {
    const digest = buildActivityDigest(
      [
        file("local", 120),
        file("bot", 121, { meta: { bot: true, botName: "Indexer" } }),
        file("linked-new-upload", 122, {
          meta: { linkedFrom: "source" },
        }),
        file("linked-old-new-mirror", 20, {
          meta: { linkedFrom: "source" },
        }),
        file("linked-known", 20, {
          meta: { linkedFrom: "source" },
        }),
        file("request", 123, { meta: { request: true }, status: "open" }),
        file("fulfilled", 10, {
          meta: { request: true },
          status: "fulfilled",
          fulfilledAt: 124,
        }),
      ],
      {
        lastSeenServerTime: 100,
        knownLinkedKeys: ["linked-known"],
      },
    );

    expect(digest.uploads.map((f) => f.key)).toEqual(["local"]);
    expect(digest.bots.map((f) => f.key)).toEqual(["bot"]);
    expect(digest.linked.map((f) => f.key)).toEqual([
      "linked-new-upload",
      "linked-old-new-mirror",
    ]);
    expect(digest.requests.map((f) => f.key)).toEqual(["request"]);
    expect(digest.fulfilledRequests.map((f) => f.key)).toEqual([
      "fulfilled",
    ]);
    expect(digest.total).toBe(6);
    expect(new Set(digest.keys).size).toBe(digest.total);
  });

  test("does not call an old mirror new before a linked baseline exists", () => {
    const oldMirror = file("linked", 50, {
      meta: { linkedFrom: "source" },
    });
    expect(
      isLinkedDelta(oldMirror, {
        lastSeenServerTime: 100,
        knownLinkedKeys: null,
      }),
    ).toBe(false);
  });

  test("excludes the current user's uploads by account or room nickname", () => {
    const digest = buildActivityDigest(
      [
        file("own-account", 120, {
          meta: { account: "Alice" },
          tags: { usernick: "Different display" },
        }),
        file("own-nick", 121, {
          tags: { usernick: "Room Alice" },
        }),
        file("own-linked", 122, {
          meta: { account: "alice", linkedFrom: "source-room" },
          tags: { usernick: "Alice", linked: "Source room" },
        }),
        file("someone-else", 123, {
          meta: { account: "bob" },
          tags: { usernick: "Bob" },
        }),
      ],
      {
        lastSeenServerTime: 100,
        knownLinkedKeys: [],
        knownLinkedRooms: [],
      },
      { account: "alice", nick: "room alice" },
    );

    expect(digest.uploads.map((f) => f.key)).toEqual(["someone-else"]);
    expect(digest.linked).toEqual([]);
    expect(digest.total).toBe(1);
  });

  test("treats every file from a newly linked room as new", () => {
    const oldFileFromNewRoom = file("already-known-key", 20, {
      meta: { linkedFrom: "New-Source" },
    });
    expect(
      isLinkedDelta(oldFileFromNewRoom, {
        lastSeenServerTime: 100,
        knownLinkedKeys: ["already-known-key"],
        knownLinkedRooms: ["existing-source"],
      }),
    ).toBe(true);
  });

  test("only clears catch-up state after a complete download", () => {
    expect(
      didCompleteCatchUpDownload({
        done: 2,
        skipped: 1,
        failed: 0,
        cancelled: false,
      }),
    ).toBe(true);
    expect(
      didCompleteCatchUpDownload({
        done: 1,
        skipped: 0,
        failed: 1,
        cancelled: false,
      }),
    ).toBe(false);
    expect(
      didCompleteCatchUpDownload({
        done: 1,
        skipped: 0,
        failed: 0,
        cancelled: true,
      }),
    ).toBe(false);
    expect(didCompleteCatchUpDownload(null)).toBe(false);
  });

  test("ranks resumable live files by most recent reader use", () => {
    const readable = (key) =>
      file(key, 1, { getReadableType: () => "pdf" });
    const result = buildResumeEntries(
      [readable("a"), readable("b"), readable("c")],
      [
        { fileKey: "a", page: 2, updatedAt: 10 },
        { fileKey: "missing", page: 2, updatedAt: 99 },
        { fileKey: "b", page: 4, updatedAt: 30 },
        { fileKey: "c", page: 1 },
      ],
      2,
    );
    expect(result.map((entry) => entry.file.key)).toEqual(["b", "a"]);
  });

  test("keeps pre-upgrade reader progress resumable", () => {
    const readable = (key) =>
      file(key, 1, { getReadableType: () => "pdf" });
    const result = buildResumeEntries(
      [readable("legacy"), readable("current")],
      [
        { fileKey: "legacy", page: 7 },
        { fileKey: "current", page: 2, updatedAt: 50 },
      ],
      3,
    );
    expect(result.map((entry) => entry.file.key)).toEqual([
      "current",
      "legacy",
    ]);
    expect(result[1].progress.page).toBe(7);
  });

  test("linked baselines are exact rather than silently truncated", () => {
    const keys = Array.from({ length: 5005 }, (_, i) => `linked-${i}`);
    const state = normalizeVisitState(
      {
        lastSeenServerTime: 100,
        knownLinkedKeys: keys,
        knownLinkedRooms: ["Room-A", "room-a", ""],
      },
      50,
    );
    expect(state.knownLinkedKeys).toHaveLength(5005);
    expect(state.knownLinkedKeys[5004]).toBe("linked-5004");
    expect(state.knownLinkedRooms).toEqual(["room-a"]);
  });
});
