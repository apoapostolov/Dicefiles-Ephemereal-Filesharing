"use strict";

const {
  createGuestInvite,
  redeemGuestInvite,
  inviteRedeemability,
  normalizeGuestInvites,
  findGuestInvite,
  revokeGuestInvite,
  guestInvitePath,
  serializeGuestInvite,
} = require("../../lib/room/guest-invites");

describe("guest-invites (shipped)", () => {
  const now = 1_700_000_000_000;

  test("createGuestInvite single-use defaults", () => {
    const inv = createGuestInvite({ singleUse: true, now, createdBy: "alice" });
    expect(inv.maxUses).toBe(1);
    expect(inv.singleUse).toBe(true);
    expect(inv.uses).toBe(0);
    expect(inv.token.length).toBeGreaterThanOrEqual(16);
    expect(inv.createdBy).toBe("alice");
    expect(inviteRedeemability(inv, now).ok).toBe(true);
  });

  test("createGuestInvite maxUses and maxAgeHours", () => {
    const inv = createGuestInvite({
      maxUses: 5,
      maxAgeHours: 2,
      now,
      label: "con weekend",
    });
    expect(inv.maxUses).toBe(5);
    expect(inv.expiresAt).toBe(now + 2 * 3600 * 1000);
    expect(inv.label).toBe("con weekend");
  });

  test("single-use: redeem once then exhausted", () => {
    const inv = createGuestInvite({ singleUse: true, now, token: "tok_single_use_01" });
    const r1 = redeemGuestInvite([inv], "tok_single_use_01", now);
    expect(r1.ok).toBe(true);
    expect(r1.invite.uses).toBe(1);
    const r2 = redeemGuestInvite(r1.invites, "tok_single_use_01", now + 1000);
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("exhausted");
  });

  test("maxUses allows X redemptions", () => {
    let list = [
      createGuestInvite({ maxUses: 3, now, token: "tok_multi_use_xx" }),
    ];
    for (let i = 0; i < 3; i++) {
      const r = redeemGuestInvite(list, "tok_multi_use_xx", now + i);
      expect(r.ok).toBe(true);
      list = r.invites;
    }
    const last = redeemGuestInvite(list, "tok_multi_use_xx", now + 10);
    expect(last.ok).toBe(false);
    expect(last.reason).toBe("exhausted");
  });

  test("expiresAt rejects after TTL", () => {
    const inv = createGuestInvite({
      maxUses: 10,
      maxAgeHours: 1,
      now,
      token: "tok_expire_soon_",
    });
    expect(inviteRedeemability(inv, now + 30 * 60 * 1000).ok).toBe(true);
    expect(inviteRedeemability(inv, now + 2 * 3600 * 1000).ok).toBe(false);
    expect(inviteRedeemability(inv, now + 2 * 3600 * 1000).reason).toBe(
      "expired",
    );
    const r = redeemGuestInvite([inv], "tok_expire_soon_", now + 2 * 3600 * 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("expired");
  });

  test("not_found and invalid tokens", () => {
    const inv = createGuestInvite({ now, token: "tok_exists_here_" });
    expect(redeemGuestInvite([inv], "nope", now).reason).toBe("not_found");
    expect(redeemGuestInvite([inv], "", now).reason).toBe("invalid");
  });

  test("normalize / find / revoke / path / serialize", () => {
    const a = createGuestInvite({ now, token: "abc12345tokenXX", maxUses: 2 });
    const list = normalizeGuestInvites([a, { token: "x" }, a]);
    expect(list).toHaveLength(1);
    expect(findGuestInvite(list, "abc12345tokenXX").maxUses).toBe(2);
    expect(revokeGuestInvite(list, "abc12345tokenXX")).toEqual([]);
    expect(guestInvitePath("roomId12", "tok")).toBe("/r/roomId12?invite=tok");
    const ser = serializeGuestInvite(a, { fullToken: true });
    expect(ser.tokenFull).toBe("abc12345tokenXX");
    expect(ser.remaining).toBe(2);
  });
});
