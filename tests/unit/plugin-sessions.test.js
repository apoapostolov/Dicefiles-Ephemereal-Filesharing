"use strict";

const { createSessionService, sessionAction } = require("../../lib/plugins/sessions");
const { createPluginStateFactory } = require("../../lib/plugins/state");

function fixture() {
  const now = Date.now(); const service = createSessionService({ stateFactory: createPluginStateFactory({ memory: true }), now: () => now });
  return { now, service, input: { title: "Reading session", startsAt: now + 3600000, timezone: "Europe/Sofia", links: ["/g/example"] } };
}

test("session scope, private RSVP identities, repeat votes and reversible cancellation", async () => {
  const { service, input } = fixture(); const session = await service.create("room1", input);
  expect(await service.list("room2")).toEqual([]);
  const member = "private-member-hash-123456";
  const going = await service.rsvp("room1", session.id, member, "going");
  expect(going.counts.going).toBe(1); expect(going.rsvp).toBe("going"); expect(JSON.stringify(going)).not.toContain(member);
  expect((await service.rsvp("room1", session.id, member, "going")).counts.going).toBe(1);
  const maybe = await service.rsvp("room1", session.id, member, "maybe"); expect(maybe.counts).toEqual({ going: 0, maybe: 1, declined: 0 });
  await expect(service.cancel("room1", session.id, session.revision)).rejects.toMatchObject({ status: 409 });
  const cancelled = await service.cancel("room1", session.id, maybe.revision); expect(cancelled.cancelled).toBe(true);
  await expect(service.rsvp("room1", session.id, member, "going")).rejects.toThrow("cancelled");
  expect((await service.cancel("room1", session.id, cancelled.revision, false)).cancelled).toBe(false);
});

test("session validation rejects unsafe preparation URLs, invalid times and timezones", async () => {
  const { service, input, now } = fixture();
  await expect(service.create("room", { ...input, startsAt: now - 1 })).rejects.toThrow("within 60 days");
  await expect(service.create("room", { ...input, startsAt: now + 61 * 86400000 })).rejects.toThrow("within 60 days");
  await expect(service.create("room", { ...input, links: ["https://external.example/private"] })).rejects.toThrow("local");
  await expect(service.create("room", { ...input, timezone: "invalid" })).rejects.toThrow("IANA");
});

test("session RPC enforces membership/password and owner-only planning", async () => {
  const client = { socket: { handshake: { cookies: {} } }, invited: true, privileged: false, roomid: "room", room: { passwordAccessAllowed: async () => true, getRoomPlugins: () => [{ id: "session-organizer", enabled: true, config: {} }] } };
  await expect(sessionAction(client, "create", {})).rejects.toThrow("Only a room owner");
  client.invited = false; await expect(sessionAction(client, "list")).rejects.toThrow("session expired");
});
