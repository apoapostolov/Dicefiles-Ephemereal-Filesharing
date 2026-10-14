"use strict";

const passwords = require("../../lib/room/password-access");
const credentials = require("../../lib/room/access-credentials");

async function room() {
  const value = { roomid: "synthetic-room", config: new Map(), pconfig: new Map() };
  await passwords.configure(value, { enabled: true, password: "community-secret", prepareDays: 0 });
  return value;
}

test("cohort credentials revoke independently and never expose verifiers or secrets in lists", async () => {
  const value = await room();
  const first = await credentials.create(value, { mode: "cohort", label: "Editors", password: "editors-synthetic-secret", rotation: "manual" });
  const second = await credentials.create(value, { mode: "cohort", label: "Guests", password: "guests-synthetic-secret", rotation: "manual" });
  const a = await passwords.authenticate(value, "editors-synthetic-secret", "browser-a");
  const b = await passwords.authenticate(value, "guests-synthetic-secret", "browser-b");
  expect(await passwords.allowed(value, null, "browser-a", { [a.name]: a.value })).toBe(true);
  await credentials.remove(value, first.id);
  expect(await passwords.allowed(value, null, "browser-a", { [a.name]: a.value })).toBe(false);
  expect(await passwords.allowed(value, null, "browser-b", { [b.name]: b.value })).toBe(true);
  expect(await credentials.list(value)).toEqual([expect.objectContaining({ id: second.id, label: "Guests" })]);
  const publicJSON = JSON.stringify(await credentials.list(value));
  expect(publicJSON).not.toMatch(/verifier|encrypted|selector|synthetic-secret/);
  expect(JSON.stringify(await credentials.readAudit(value))).not.toContain("guests-synthetic-secret");
});

test("personal credentials bind to the first account and bound browser activations", async () => {
  const value = await room();
  const entry = await credentials.create(value, { mode: "personal", label: "Member", password: "member-synthetic-secret", rotation: "manual", maxActivations: 1 });
  expect(await passwords.authenticate(value, "member-synthetic-secret", "browser-a", null)).toBeNull();
  const grant = await passwords.authenticate(value, "member-synthetic-secret", "browser-a", { account: "account-a" });
  expect(grant).toBeTruthy();
  expect(await passwords.authenticate(value, "member-synthetic-secret", "browser-b", { account: "account-a" })).toBeNull();
  expect(await passwords.allowed(value, { account: "account-b" }, "browser-a", { [grant.name]: grant.value })).toBe(false);
  expect(await passwords.allowed(value, { account: "account-a" }, "browser-a", { [grant.name]: grant.value })).toBe(true);
  await credentials.mutate(value, entry.id, { rotate: true, password: "replacement-synthetic-secret" });
  expect(await passwords.allowed(value, { account: "account-a" }, "browser-a", { [grant.name]: grant.value })).toBe(false);
  expect((await credentials.reveal(value, entry.id)).password).toBe("replacement-synthetic-secret");
});

test("browser personal binding and expiry use generic authentication failures", async () => {
  const value = await room();
  const entry = await credentials.create(value, { mode: "personal", binding: "browser", label: "Visitor", password: "visitor-synthetic-secret", rotation: "manual" });
  const grant = await passwords.authenticate(value, "visitor-synthetic-secret", "browser-a");
  expect(grant).toBeTruthy();
  expect(await passwords.authenticate(value, "visitor-synthetic-secret", "browser-b")).toBeNull();
  const stored = value.pconfig.get("accessCredentials");
  stored[0].expiresAt = Date.now() - 1000;
  expect(await passwords.allowed(value, null, "browser-a", { [grant.name]: grant.value })).toBe(false);
  expect(await credentials.list(value)).toEqual([expect.objectContaining({ id: entry.id })]);
});
