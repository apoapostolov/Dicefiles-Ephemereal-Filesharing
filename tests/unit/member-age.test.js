"use strict";

const {
  DAY_MS,
  decorateNewRoomMember,
  getNewRoomMemberDays,
  isNewRoomMember,
  memberJoinedAtKey,
} = require("../../lib/room/member-age");

describe("new room member age", () => {
  test("uses seven days by default and clamps invalid values", () => {
    expect(getNewRoomMemberDays(undefined)).toBe(7);
    expect(getNewRoomMemberDays("3")).toBe(3);
    expect(getNewRoomMemberDays(-1)).toBe(0);
    expect(getNewRoomMemberDays("invalid")).toBe(7);
  });

  test("recognizes members inside the configured window", () => {
    const now = Date.now();
    expect(isNewRoomMember(now - 6 * DAY_MS, now, 7)).toBe(true);
    expect(isNewRoomMember(now - 7 * DAY_MS, now, 7)).toBe(false);
    expect(isNewRoomMember(now - DAY_MS, now, 0)).toBe(false);
  });

  test("uses stable hashed keys without exposing the identity", () => {
    const key = memberJoinedAtKey(
      "room-one",
      "account",
      "alice@example.test",
    );
    expect(key).toMatch(/^memberJoinedAt:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain("alice");
    expect(
      memberJoinedAtKey("room-one", "account", "alice@example.test"),
    ).toBe(key);
    expect(
      memberJoinedAtKey("room-one", "token", "alice@example.test"),
    ).not.toBe(key);
    expect(
      memberJoinedAtKey("room-two", "account", "alice@example.test"),
    ).not.toBe(key);
  });

  test("exposes only the new-member state to the browser", () => {
    const now = Date.now();
    const file = {
      meta: {
        account: "alice",
        roomMemberJoinedAt: now - DAY_MS,
      },
    };

    decorateNewRoomMember(file, now, 7);

    expect(file.meta).toEqual({
      account: "alice",
      newRoomMember: true,
      newRoomMemberDays: 7,
    });
  });

  test("removes expired join metadata without adding an indicator", () => {
    const now = Date.now();
    const file = {
      meta: {
        roomMemberJoinedAt: now - 8 * DAY_MS,
      },
    };

    decorateNewRoomMember(file, now, 7);

    expect(file.meta).toEqual({});
  });
});
