"use strict";

const { PluginJobs, configFingerprint } = require("../../lib/plugins/jobs");
const { createMemoryEventLease } = require("../../lib/plugins/event-lease");
const { createPluginConnections } = require("../../lib/plugins/connections");
const { createPluginReport, publicReport } = require("../../lib/plugins/reports");
const { createPluginStateFactory } = require("../../lib/plugins/state");

function harness() {
  const records = new Map(); const claimed = new Set();
  const outbox = {
    enqueue: jest.fn(async job => {
      if (records.has(job.id)) {
        return false;
      } records.set(job.id, structuredClone(job)); return true;
    }),
    get: async id => records.get(id),
    list: async options => ({ records: [...records.values()].filter(job => job.roomId === options.roomId && job.pluginId === options.pluginId && job.global === options.global) }),
    claim: async () => {
      const job = [...records.values()].find(job => !claimed.has(job.id) && !job.status); if (!job) {
        return null;
      } claimed.add(job.id); return job;
    },
    renew: async () => 1,
    complete: jest.fn(async (job, result) => Object.assign(job, { status: "completed", result })),
    retry: jest.fn(async () => 1),
    deadLetter: jest.fn(async (job, error) => Object.assign(job, { status: "failed", error: error.message })),
    cancel: async id => {
      Object.assign(records.get(id), { status: "cancelled" }); return 1;
    },
    replay: async job => {
      records.set(job.id, job); return 1;
    },
  };
  const config = { roomId: "room1", token: "private-token" };
  const execute = jest.fn(async () => ({ imported: 1 }));
  const jobs = new PluginJobs({ outbox, resolve: async () => ({ enabled: true, config }), execute, roomLeases: createMemoryEventLease() });
  const scope = jobs.scope({ pluginId: "feed-collector", roomId: "room1", config });
  return { jobs, outbox, records, config, execute, scope };
}

test("jobs are idempotent per mode, scoped, and never store config or credentials", async () => {
  const h = harness();
  const first = await h.scope.enqueue({ idempotencyKey: "same", mode: "preview" });
  expect((await h.scope.enqueue({ idempotencyKey: "same", mode: "preview" })).added).toBe(false);
  expect((await h.scope.enqueue({ idempotencyKey: "same", mode: "run" })).id).not.toBe(first.id);
  expect(JSON.stringify([...h.records.values()])).not.toContain("private-token");
  expect(JSON.stringify(first)).not.toContain("fingerprint");
  await expect(h.jobs.scope({ pluginId: "other", roomId: "room1" }).get(first.id)).rejects.toMatchObject({ status: 404 });
  await expect(h.jobs.scope({ pluginId: "feed-collector", roomId: "room1", global: true }).get(first.id)).rejects.toMatchObject({ status: 404 });
  expect((await h.scope.list()).jobs).toHaveLength(2);
  expect(configFingerprint({ b: 1, a: { c: 2 } })).toBe(configFingerprint({ a: { c: 2 }, b: 1 }));
});

test("workers resolve current settings, reject stale invitations, and summarize success", async () => {
  const h = harness();
  await h.scope.enqueue(); await h.jobs.pump();
  expect(h.outbox.complete).toHaveBeenCalledWith(expect.anything(), { imported: 1 });
  await h.scope.enqueue(); h.config.token = "rotated"; await h.jobs.pump();
  expect(h.execute).toHaveBeenCalledTimes(1);
  expect(h.outbox.deadLetter.mock.calls[0][1].message).toContain("settings changed");
});

test("provider Retry-After and room concurrency do not exhaust attempts", async () => {
  const h = harness();
  h.execute.mockRejectedValue(Object.assign(new Error("Rate limited"), { retryAfterMs: 600000 }));
  await h.scope.enqueue(); await h.jobs.pump();
  expect(h.outbox.retry).toHaveBeenCalledWith(expect.anything(), 600000);
  await h.jobs.roomLeases.begin("plugin-job-room", "room1");
  await h.scope.enqueue(); await h.jobs.pump();
  expect(h.outbox.retry).toHaveBeenLastCalledWith(expect.anything(), 30000, { increment: false });
});

test("cancel and replay are explicit and only available within the owning bot", async () => {
  const h = harness(); const job = await h.scope.enqueue();
  await expect(h.scope.replay(job.id)).rejects.toThrow("failed or cancelled");
  expect(await h.scope.cancel(job.id)).toEqual({ cancelled: true });
  expect((await h.scope.get(job.id)).status).toBe("cancelled");
  expect(await h.scope.replay(job.id)).toEqual({ replayed: true });
  expect(h.records.get(job.id).attempt).toBe(0);
});

test("connection references require operator room, plugin and provider grants; reads contain no secrets", () => {
  const env = { EXAMPLE_TOKEN: "private-secret" };
  const connections = [{ id: "example", label: "Team files", provider: "drive", roomIds: ["room1"], pluginIds: ["drive-collection"], credentials: { accessTokenEnv: "EXAMPLE_TOKEN" } }];
  const factory = createPluginConnections({ env, getConfig: () => connections });
  const own = factory({ roomId: "room1", pluginId: "drive-collection" });
  expect(own.resolve("example", "drive").credentials.accessToken).toBe("private-secret");
  expect(JSON.stringify(own.list())).not.toContain("private-secret");
  expect(() => own.resolve("example", "dropbox")).toThrow("unavailable");
  expect(factory({ roomId: "room2", pluginId: "drive-collection" }).list()).toEqual([]);
  expect(factory({ roomId: "room1", pluginId: "other" }).list()).toEqual([]);
  env.EXAMPLE_TOKEN = "rotated";
  expect(own.resolve("example").credentials.accessToken).toBe("rotated");
  delete env.EXAMPLE_TOKEN;
  expect(own.list()[0].configured).toBe(false);
  expect(() => own.resolve("example")).toThrow("credential is missing");
});

test("reports are bounded, redact secrets and expose only safe links and review actions", async () => {
  const state = createPluginStateFactory({ memory: true })({ pluginId: "reviewer", roomId: "room1" });
  const report = createPluginReport(state, { token: "private-token" });
  const result = await report.write({ title: "Review", items: [{ title: "private-token", href: "https://private.example/?token=secret", data: { key: "one" }, actions: [{ id: "accept", label: "Approve" }] }, { title: "File", href: "/g/one" }] });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(result.items[0]).not.toHaveProperty("href");
  expect(result.items[0]).not.toHaveProperty("data");
  expect((await report.read()).items[0].data).toEqual({ key: "one" });
  expect(publicReport(await report.read()).items[1].href).toBe("/g/one");
  expect((await report.write({ items: Array.from({ length: 80 }, () => ({ title: "File" })) })).truncated).toBe(true);
});

test("OAuth vault survives fresh connections, encrypts tokens and invalidates on operator rotation", async () => {
  const { credentialVault } = require("../../lib/plugins/credential-vault");

  const rows = new Map(); const storage = { get: async key => rows.get(key), set: async (key, value) => rows.set(key, value) };
  await credentialVault("test", { refreshToken: "operator-secret" }, storage).write({ accessToken: "access-private", refreshToken: "rotated-private" });
  expect(JSON.stringify([...rows])).not.toContain("private");
  expect(await credentialVault("test", { refreshToken: "operator-secret" }, storage).read()).toEqual({ accessToken: "access-private", refreshToken: "rotated-private" });
  expect(await credentialVault("test", { refreshToken: "different-secret" }, storage).read()).toBeNull();
});
