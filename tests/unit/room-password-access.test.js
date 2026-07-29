"use strict";

const {
  safePolicy,
  periodFor,
  configure,
  rotateNow,
  adminState,
  authenticate,
  allowed,
} = require("../../lib/room/password-access");

class MemoryMap extends Map {
  set(key, value) {
    super.set(key, value);
    return this;
  }
}

function fakeRoom() {
  return {
    roomid: "protected-room",
    config: new MemoryMap(),
    pconfig: new MemoryMap(),
    owns(account, token) {
      return account === "owner" || token === "owner-token";
    },
  };
}

describe("rotating room password access", () => {
  test("monthly periods end at the next UTC month boundary", () => {
    const now = Date.UTC(2026, 6, 29, 12);
    expect(periodFor(safePolicy({ enabled: true }), now)).toEqual({
      id: "2026-07",
      startsAt: Date.UTC(2026, 6, 1),
      endsAt: Date.UTC(2026, 7, 1),
    });
  });

  test("zero-day preparation is supported", () => {
    expect(
      safePolicy({ enabled: true, prepareDays: 0 }).prepareDays,
    ).toBe(0);
  });

  test("configuration stores only encrypted and hashed credentials", async () => {
    const room = fakeRoom();
    const state = await configure(room, {
      enabled: true,
      rotation: "monthly",
      prepareDays: 0,
      password: "community-secret",
    });
    expect(state.currentPassword).toBe("community-secret");
    const stored = room.pconfig.get("passwordAccessSecret").current;
    expect(JSON.stringify(stored)).not.toContain("community-secret");
    expect(stored.verifier).toMatch(/^\$argon2id\$/);
  });

  test("a correct password creates a browser-bound grant", async () => {
    const room = fakeRoom();
    await configure(room, {
      enabled: true,
      prepareDays: 0,
      password: "community-secret",
    });
    expect(await authenticate(room, "wrong", "browser-a")).toBeNull();
    const grant = await authenticate(room, "community-secret", "browser-a");
    expect(grant.value).toContain(".");
    expect(
      await allowed(room, null, "browser-a", { [grant.name]: grant.value }),
    ).toBe(true);
    expect(
      await allowed(room, null, "browser-b", { [grant.name]: grant.value }),
    ).toBe(false);
  });

  test("emergency rotation revokes existing grants", async () => {
    const room = fakeRoom();
    await configure(room, {
      enabled: true,
      prepareDays: 0,
      password: "before",
    });
    const oldGrant = await authenticate(room, "before", "browser-a");
    await rotateNow(room, "after");
    expect(
      await allowed(room, null, "browser-a", {
        [oldGrant.name]: oldGrant.value,
      }),
    ).toBe(false);
    expect((await adminState(room, true)).currentPassword).toBe("after");
  });

  test("owners bypass the password prompt", async () => {
    const room = fakeRoom();
    await configure(room, {
      enabled: true,
      prepareDays: 0,
      password: "secret",
    });
    expect(await allowed(room, { account: "owner" }, "", {})).toBe(true);
    expect(await allowed(room, null, "owner-token", {})).toBe(true);
  });
});
