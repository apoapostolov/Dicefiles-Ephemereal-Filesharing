"use strict";

/**
 * Owner RPC path: setconfig reply must forward setConfig return values so
 * client makeCall("setconfig", "createGuestInvite"|"listGuestInvites") resolves
 * with path/tokenFull (not undefined).
 *
 * Drives the shipped runSetConfigRpc + real guest-invite helpers (same mint/list
 * bodies as Room / Client.setConfig), without constructing full Client
 * (Redis / nicknames / channels).
 */

const {
  runSetConfigRpc,
  emitSetConfigResult,
} = require("../../lib/client/setconfig-rpc");
const {
  createGuestInvite,
  normalizeGuestInvites,
  serializeGuestInvite,
  guestInvitePath,
  revokeGuestInvite,
} = require("../../lib/room/guest-invites");

/**
 * Room-shaped invite store using shipped pure helpers (mirrors Room methods).
 */
function makeInviteRoom(roomid) {
  let invites = [];
  return {
    roomid,
    getGuestInvites() {
      return normalizeGuestInvites(invites);
    },
    createGuestInviteLink(opts) {
      const inv = createGuestInvite(opts || {});
      invites = this.getGuestInvites().concat(inv);
      return {
        invite: serializeGuestInvite(inv, { fullToken: true }),
        path: guestInvitePath(this.roomid, inv.token),
        urlPath: guestInvitePath(this.roomid, inv.token),
      };
    },
    listGuestInviteLinks() {
      return this.getGuestInvites().map((i) => {
        const s = serializeGuestInvite(i, { fullToken: true });
        return Object.assign({}, s, {
          token: s.token,
          tokenFull: i.token,
        });
      });
    },
    revokeGuestInviteLink(token) {
      invites = revokeGuestInvite(this.getGuestInvites(), token);
      return invites.map((i) => serializeGuestInvite(i));
    },
  };
}

/**
 * setConfig cases that mint/list/revoke guest invites — same return values as
 * lib/client.js setConfig switch arms.
 */
function makeGuestSetConfig(room, opts) {
  const o = opts || {};
  return async function setConfig(name, arg) {
    if (o.denyPrivilege) {
      throw new Error("You cannot do that!");
    }
    switch (name) {
      case "createGuestInvite": {
        const a = arg && typeof arg === "object" ? arg : {};
        return room.createGuestInviteLink({
          singleUse: a.singleUse === true,
          maxUses: a.maxUses,
          maxAgeHours: a.maxAgeHours,
          label: a.label,
          createdBy: o.createdBy || "owner1",
        });
      }
      case "listGuestInvites":
        return room.listGuestInviteLinks();
      case "revokeGuestInvite":
        return room.revokeGuestInviteLink(
          typeof arg === "string" ? arg : arg && arg.token,
        );
      case "allowRequests":
        // void config — RPC must still emit bare event
        return undefined;
      default:
        throw new Error(`Invalid config name '${name}'`);
    }
  };
}

/**
 * Simulate client makeCall resolution for setconfig-${name}.
 * Mirrors client/socket.js makeCall callbackKey handling.
 */
function makeCallSetconfig(setConfigFn, name, arg) {
  return new Promise((resolve, reject) => {
    const key = `setconfig-${name}`;
    const emits = [];
    const socket = {
      emit(event, payload) {
        emits.push({ event, payload });
      },
    };
    runSetConfigRpc(setConfigFn, socket, name, arg)
      .then(() => {
        const hit = emits.find((e) => e.event === key);
        if (!hit) {
          reject(new Error(`no emit for ${key}`));
          return;
        }
        const rv = hit.payload;
        if (rv && rv.err) {
          reject(new Error(rv.err));
          return;
        }
        resolve(rv);
      })
      .catch(reject);
  });
}

describe("guest invite owner RPC (setconfig → makeCall payload)", () => {
  test("emitSetConfigResult forwards defined payloads", () => {
    const got = [];
    const socket = {
      emit(event, payload) {
        got.push({ event, payload, argc: arguments.length });
      },
    };
    emitSetConfigResult(socket, "createGuestInvite", {
      path: "/r/x?invite=t",
    });
    expect(got[0].event).toBe("setconfig-createGuestInvite");
    expect(got[0].payload.path).toBe("/r/x?invite=t");
    expect(got[0].argc).toBe(2);

    emitSetConfigResult(socket, "allowRequests", undefined);
    expect(got[1].event).toBe("setconfig-allowRequests");
    expect(got[1].argc).toBe(1);
  });

  test("createGuestInvite returns path + full token to makeCall", async () => {
    const room = makeInviteRoom("RoomIdAb12");
    const setConfig = makeGuestSetConfig(room);

    const rv = await makeCallSetconfig(setConfig, "createGuestInvite", {
      singleUse: true,
      label: "con guest",
    });

    expect(rv).toBeDefined();
    expect(rv.path).toMatch(/^\/r\/RoomIdAb12\?invite=/);
    expect(rv.urlPath).toBe(rv.path);
    expect(rv.invite).toBeDefined();
    expect(rv.invite.tokenFull).toBeTruthy();
    expect(rv.invite.tokenFull.length).toBeGreaterThanOrEqual(16);
    expect(rv.invite.maxUses).toBe(1);
    expect(rv.invite.singleUse).toBe(true);
    expect(rv.invite.label).toBe("con guest");
  });

  test("listGuestInvites returns array with tokenFull after mint", async () => {
    const room = makeInviteRoom("ListRoom99");
    const setConfig = makeGuestSetConfig(room);

    const minted = await makeCallSetconfig(setConfig, "createGuestInvite", {
      maxUses: 3,
      maxAgeHours: 24,
    });
    expect(minted.invite.tokenFull).toBeTruthy();

    const list = await makeCallSetconfig(setConfig, "listGuestInvites");
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].tokenFull).toBe(minted.invite.tokenFull);
    expect(list[0].maxUses).toBe(3);
    expect(list[0].remaining).toBe(3);
  });

  test("void setConfig still emits bare event (makeCall resolves undefined)", async () => {
    const room = makeInviteRoom("VoidRoom01");
    const setConfig = makeGuestSetConfig(room);
    const rv = await makeCallSetconfig(setConfig, "allowRequests", true);
    expect(rv).toBeUndefined();
  });

  test("errors still emit { err } for makeCall reject", async () => {
    const room = makeInviteRoom("ErrRoom001");
    const setConfig = makeGuestSetConfig(room, { denyPrivilege: true });

    await expect(
      makeCallSetconfig(setConfig, "createGuestInvite", { singleUse: true }),
    ).rejects.toThrow(/cannot do that/i);
  });
});
