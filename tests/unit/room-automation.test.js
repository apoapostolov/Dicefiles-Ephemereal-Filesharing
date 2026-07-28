"use strict";

const {
  getRequiredRoom,
  listRoomLinks,
  createRoomLink,
  removeRoomLink,
  listGuestInvites,
  createGuestInvite,
  revokeGuestInvite,
} = require("../../lib/http/room-automation");
const {
  normalizeLinkedRoomEntries,
  resolveLinkedRoomEntries,
} = require("../../lib/room/room-links");
const {
  createGuestInvite: mintGuestInvite,
  serializeGuestInvite,
  revokeGuestInvite: removeGuestInvite,
  appendGuestInviteAudit,
} = require("../../lib/room/guest-invites");

function makeRoom({ privateSourceConsent = true } = {}) {
  let links = [];
  let invites = [];
  let audit = [];
  const catalog = [
    { roomid: "sourceRoomA1", name: "Campaign Maps" },
    { roomid: "sourceRoomB2", name: "Private Vault" },
  ];
  return {
    roomid: "destination1",
    config: {
      get(key) {
        return key === "linkedRooms" ? links : undefined;
      },
    },
    async setLinkedRooms(raw) {
      const result = resolveLinkedRoomEntries(raw, catalog, this.roomid);
      if (result.unresolved.length) {
        throw new Error(`Unknown room(s): ${result.unresolved.join(", ")}`);
      }
      links = normalizeLinkedRoomEntries(result.entries);
      return links;
    },
    async probeLinkedRooms() {
      return links.map((entry) =>
        Object.assign({}, entry, {
          status:
            entry.roomId === "sourceRoomB2" &&
            (!entry.allowPrivateSource || !privateSourceConsent)
              ? "private"
              : "ok",
        }),
      );
    },
    getGuestInvites() {
      return invites;
    },
    createGuestInviteLink(opts) {
      const invite = mintGuestInvite(
        Object.assign({ token: `invite_token_${invites.length + 1}` }, opts),
      );
      invites = invites.concat(invite);
      audit = appendGuestInviteAudit(audit, "created", {
        token: invite.token,
        label: invite.label,
        actor: invite.createdBy,
        uses: invite.uses,
        maxUses: invite.maxUses,
      });
      return { invite: serializeGuestInvite(invite, { fullToken: true }) };
    },
    revokeGuestInviteLink(token, actor) {
      const invite = invites.find((item) => item.token === token);
      invites = removeGuestInvite(invites, token);
      audit = appendGuestInviteAudit(audit, "revoked", {
        token,
        actor,
        maxUses: invite.maxUses,
        uses: invite.uses,
      });
    },
    getGuestInviteAdminState() {
      return {
        invites: invites.map((invite) =>
          serializeGuestInvite(invite, { fullToken: true }),
        ),
        audit: audit.slice().reverse(),
        activeCount: invites.length,
        maxActive: 25,
      };
    },
  };
}

describe("room automation helpers", () => {
  test("requires an existing room with HTTP-friendly status", async () => {
    const Room = { get: jest.fn(async () => null) };
    await expect(getRequiredRoom(Room, "missingRoom")).rejects.toMatchObject({
      status: 404,
    });
  });

  test("creates, lists, and removes a link with ACL fields intact", async () => {
    const room = makeRoom();
    const created = await createRoomLink(room, {
      source: "Campaign Maps",
      visibility: "members",
      rules: { types: ["document"] },
    });
    expect(created.links).toEqual([
      {
        roomId: "sourceRoomA1",
        name: "Campaign Maps",
        visibility: "members",
        rules: { types: ["document"] },
      },
    ]);

    const listed = await listRoomLinks(room);
    expect(listed.links[0].status).toBe("ok");

    const removed = await removeRoomLink(room, "sourceRoomA1");
    expect(removed.removed).toBe("sourceRoomA1");
    expect(removed.links).toEqual([]);
  });

  test("accepts advanced linked-file rules and rejects invalid regex", async () => {
    const room = makeRoom();
    const created = await createRoomLink(room, {
      source: "Campaign Maps",
      rules: {
        nameContains: "pf2 AND /\\.pdf$/i",
        userContains: "alice OR bob",
      },
    });
    expect(created.links[0].rules).toMatchObject({
      nameContains: "pf2 AND /\\.pdf$/i",
      userContains: "alice OR bob",
    });

    const anotherRoom = makeRoom();
    await expect(
      createRoomLink(anotherRoom, {
        source: "Campaign Maps",
        rules: { tagContains: "/[/" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects duplicate links and reports missing removal", async () => {
    const room = makeRoom();
    await createRoomLink(room, { source: "Campaign Maps" });
    await expect(
      createRoomLink(room, { source: "sourceRoomA1" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(removeRoomLink(room, "sourceRoomB2")).rejects.toMatchObject({
      status: 404,
    });
  });

  test("private-source opt-in survives API normalization", async () => {
    const room = makeRoom();
    const created = await createRoomLink(room, {
      source: "Private Vault",
      visibility: "owners",
      allowPrivateSource: true,
    });
    expect(created.statuses[0]).toMatchObject({
      roomId: "sourceRoomB2",
      visibility: "owners",
      allowPrivateSource: true,
      status: "ok",
    });
  });

  test("destination opt-in cannot override missing source consent", async () => {
    const room = makeRoom({ privateSourceConsent: false });
    const created = await createRoomLink(room, {
      source: "Private Vault",
      allowPrivateSource: true,
    });
    expect(created.statuses[0]).toMatchObject({
      roomId: "sourceRoomB2",
      allowPrivateSource: true,
      status: "private",
    });
  });

  test("guest invite automation returns bounded admin state and audit", () => {
    const room = makeRoom();
    const created = createGuestInvite(
      room,
      { maxUses: 3, label: "Session guest" },
      "api:test-agent",
    );
    expect(created.created.invite.tokenFull).toBe("invite_token_1");
    expect(created.activeCount).toBe(1);
    expect(created.audit[0]).toMatchObject({
      event: "created",
      actor: "api:test-agent",
    });

    const listed = listGuestInvites(room);
    expect(listed.invites).toHaveLength(1);

    const revoked = revokeGuestInvite(room, "invite_token_1", "api:test-agent");
    expect(revoked.invites).toEqual([]);
    expect(revoked.audit[0]).toMatchObject({
      event: "revoked",
      actor: "api:test-agent",
    });
  });

  test("guest invite automation reports missing token", () => {
    const room = makeRoom();
    let caught;
    try {
      revokeGuestInvite(room, "missing-token", "api:test");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 404 });
  });
});
