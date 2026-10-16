"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const { createPluginStateFactory } = require("../../lib/plugins/state");
const { createWorkflowApi, revision } = require("../../lib/plugins/workflow-api");
const { inspectBackup, verifyBackup, inside } = require("../../lib/plugins/backup-reader");

jest.mock("../../lib/meta", () => ({ getMetaData: jest.fn(async () => ({ tags: { author: "Extracted author", title: "Extracted title" }, meta: { isbn: "123" } })) }));
jest.mock("../../lib/previewretry", () => ({ scheduleRetry: jest.fn(async () => {}) }));
jest.mock("../../lib/links", () => ({ EMITTER: { for: jest.fn(async () => [{ id: "one", name: "Example", url: "https://example.org/page" }]) } }));
jest.mock("../../lib/net-guard", () => ({ guardedStream: jest.fn() }));

let directory;
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "dicefiles-maintenance-test-"));
});
afterAll(async () => {
  if (!path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}dicefiles-maintenance-test-`)) {
    throw new Error("Invalid test cleanup target");
  }
  await fs.rm(directory, { recursive: true, force: true });
});

class File {
  constructor(data) {
    Object.assign(this, data);
  }
  toJSON() {
    const { storage, ...data } = this; return data;
  }
  toClientJSON() {
    return this.toJSON();
  }
}

async function apiFixture() {
  const body = Buffer.from("Synthetic book content"); const full = path.join(directory, "book.pdf"); await fs.writeFile(full, body);
  const file = new File({ key: "one", roomid: "room", name: "Book.pdf", type: "document", hash: createHash("blake2b512").update(body).digest().subarray(0, 30).toString("base64"), size: body.length, tags: { title: "Manual title" }, meta: {}, expires: Date.now() + 100000, storage: { full, assets: new Map() } });
  const records = new Map([["one", file]]);
  const uploads = { getFresh: async key => records.get(key), updateAtomic: async (key, update) => {
    const next = update(records.get(key)); next.storage ||= records.get(key).storage; records.set(key, next); return next;
  } };
  const room = { roomid: "room", config: { get: () => "" }, getRoomPlugins: () => [] };
  const api = createWorkflowApi({ getRoom: async id => id === "room" ? room : null, uploads, broker: { emit() {} } });
  return { api, file, records, spec: { roomId: "room", pluginId: "file-integrity", key: "one" } };
}

test("integrity reads verify real bytes, bound I/O and distinguish missing/corrupt files", async () => {
  const { api, file, spec } = await apiFixture();
  expect(await api.verifyFile(spec)).toMatchObject({ state: "verified", bytes: file.size });
  expect(await api.verifyFile({ ...spec, maxBytes: 1 })).toMatchObject({ state: "over-budget", bytes: 0 });
  await fs.writeFile(file.storage.full, "Corrupt"); expect((await api.verifyFile(spec)).state).toBe("mismatch");
  await fs.unlink(file.storage.full); expect((await api.verifyFile(spec)).state).toBe("missing");
  await expect(api.verifyFile({ ...spec, roomId: "other" })).rejects.toMatchObject({ status: 404 });
  const controller = new AbortController(); controller.abort(); await apiFixture();
  await expect(api.verifyFile({ ...spec, signal: controller.signal })).rejects.toThrow();
});

test("preview inspection recognizes document PDFs and queues only a current local file", async () => {
  const { api, file, spec } = await apiFixture();
  expect(await api.inspectFile(spec)).toMatchObject({ exists: true, preview: { supported: true, state: "missing" } });
  await expect(api.retryFilePreview({ ...spec, expectedRevision: "stale" })).rejects.toMatchObject({ status: 409 });
  expect(await api.retryFilePreview({ ...spec, expectedRevision: revision(file.toClientJSON()) })).toMatchObject({ queued: true });
  expect(require("../../lib/previewretry").scheduleRetry).toHaveBeenCalledWith(file.hash);
});

test("metadata retries fill absent fields while preserving manual values and movie choices", async () => {
  const { api, file, records, spec } = await apiFixture();
  await api.retryFileMetadata({ ...spec, pluginId: "metadata-steward", expectedRevision: revision(file.toClientJSON()) });
  expect(records.get("one").tags).toMatchObject({ title: "Manual title", author: "Extracted author" });
  const current = records.get("one"); current.meta = { torrent: { files: [{ path: "Show.S01E01.mkv" }, { path: "Show.S01E02.mkv" }] }, cinema: { 0: { autoMatch: { state: "manual" } }, 1: { autoMatch: { state: "review" } } } };
  await api.retryFileMetadata({ ...spec, pluginId: "metadata-steward" });
  expect(records.get("one").meta.cinema[0].autoMatch.state).toBe("manual");
  expect(records.get("one").meta.cinema[1].autoMatch.state).toBe("retry");
});

test("link probes distinguish removed, restricted and rate-limited addresses without exposing URLs", async () => {
  const { api } = await apiFixture(); const fetch = require("../../lib/net-guard").guardedStream;

  const response = status => ({ body: Readable.from([]), status, ok: status >= 200 && status < 300, headers: { "retry-after": "600" } });
  for (const [status, state] of [[200, "reachable"], [404, "broken"], [410, "broken"], [403, "restricted"], [429, "rate-limited"], [503, "temporary"]]) {
    fetch.mockResolvedValueOnce(response(status)); expect(await api.probeLink({ roomId: "room", id: "one" })).toMatchObject({ state, status });
  }
  fetch.mockResolvedValueOnce(response(405)).mockResolvedValueOnce(response(200));
  expect((await api.probeLink({ roomId: "room", id: "one" })).state).toBe("reachable");
  expect(fetch.mock.calls[fetch.mock.calls.length - 1][1].headers.range).toBe("bytes=0-1023");
  fetch.mockRejectedValueOnce(new Error("Private URL https://secret.example/token"));
  expect(await api.probeLink({ roomId: "room", id: "one" })).toEqual({ state: "unreachable", status: 0 });
  await expect(api.probeLink({ roomId: "room", id: "foreign" })).rejects.toMatchObject({ status: 404 });
});

test("backup samples restore in isolation, read back checksums, detect mismatches and respect I/O budgets", async () => {
  const body = Buffer.from("Backup sample"); await fs.writeFile(path.join(directory, "sample.bin"), body);
  const manifest = { createdAt: new Date().toISOString(), files: [{ path: "sample.bin", size: body.length, sha256: createHash("sha256").update(body).digest("hex") }] };
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  const settings = { directory };
  expect(await inspectBackup(settings)).toMatchObject({ files: 1, bytes: body.length });
  const verified = await verifyBackup(settings); expect(verified.checked).toBe(1); expect(verified.bytes).toBe(body.length * 2); expect(verified.items[0].status).toBe("success");
  expect((await verifyBackup(settings, { maxBytes: 1 })).checked).toBe(0);
  manifest.files[0].sha256 = "0".repeat(64); await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  expect((await verifyBackup(settings)).items[0].status).toBe("error");
  expect(await fs.readFile(path.join(directory, "sample.bin"))).toEqual(body);
  await expect(inside(directory, "../outside")).rejects.toThrow("relative path");
  await fs.writeFile(path.join(directory, "manifest.json"), "invalid"); await expect(inspectBackup(settings)).rejects.toThrow("valid JSON");
});

function workflowContext(id, config = {}) {
  const state = createPluginStateFactory({ memory: true })({ roomId: "room", pluginId: id });
  return { pluginId: id, config: { roomId: "room", ...config }, state, signal: new AbortController().signal, dicefiles: { postMessage: jest.fn(async () => ({})) } };
}

test("integrity workflow persists opaque pagination across scans and preview never reads payloads", async () => {
  const plugin = require("../../lib/plugins/file-integrity");

  const ctx = workflowContext(plugin.id, { maxChecksPerRun: 1 });
  const calls = []; ctx.dicefiles.listFilesPage = async spec => {
    calls.push(spec.cursor); return spec.cursor ? { files: [{ key: "two", name: "Two", size: 1 }], nextCursor: null } : { files: [{ key: "one", name: "One", size: 1 }], nextCursor: "next" };
  };
  ctx.dicefiles.verifyFile = jest.fn(async () => ({ state: "verified", bytes: 1 }));
  await plugin.run(ctx, { mode: "preview" }); expect(ctx.dicefiles.verifyFile).not.toHaveBeenCalled(); expect((await ctx.state.list()).entries).toHaveLength(0);
  await plugin.run(ctx); await plugin.run(ctx);
  expect(calls).toEqual([undefined, undefined, "next"]);
  expect(ctx.dicefiles.verifyFile).toHaveBeenLastCalledWith(expect.objectContaining({ key: "two" }));
});

test("relaxed link health persists Retry-After and suppresses early checks", async () => {
  const plugin = require("../../lib/plugins/link-health");

  const ctx = workflowContext(plugin.id);
  ctx.dicefiles.listLinks = async () => [{ id: "one", name: "Example" }];
  ctx.dicefiles.probeLink = jest.fn(async () => ({ state: "rate-limited", status: 429, retryAfterMs: 86400000 }));
  await plugin.run(ctx); expect(ctx.dicefiles.probeLink).toHaveBeenCalledTimes(1);
  expect((await plugin.run(ctx)).report.summary).toContain("backoff"); expect(ctx.dicefiles.probeLink).toHaveBeenCalledTimes(1);
});

test("capacity uses hysteresis and a measured trend, and requires operator-granted metrics", async () => {
  const plugin = require("../../lib/plugins/storage-capacity");

  const ctx = workflowContext(plugin.id, { connectionId: "metrics" });
  let usedPercent = 90; ctx.dicefiles.getStorageMetrics = async () => [{ id: "volume", total: 100, used: usedPercent, free: 100 - usedPercent, usedPercent, ok: true }];
  expect((await plugin.run(ctx)).flagged).toBe(1); usedPercent = 80; expect((await plugin.run(ctx)).flagged).toBe(1);
  usedPercent = 70; expect((await plugin.run(ctx)).flagged).toBe(0);
  expect((await plugin.run(workflowContext(plugin.id))).report.summary).toContain("operator connection");
});

test("all maintenance bots expose useful bounded reports without requiring automatic mutations", async () => {
  const expiry = require("../../lib/plugins/expiry-concierge");

  const ctx = workflowContext(expiry.id);
  ctx.dicefiles.listFilesPage = async () => ({ files: [{ name: "Book.pdf", key: "one", tags: { collection: "Books" }, expires: Date.now() + 3600000 }] });
  expect((await expiry.run(ctx, { mode: "preview" })).flagged).toBe(1);
  const preview = require("../../lib/plugins/preview-repair");

  ctx.pluginId = preview.id; ctx.dicefiles.inspectFile = async () => ({ exists: true, preview: { state: "missing" } });
  expect((await preview.run(ctx)).report.items[0].actions[0].id).toBe("retry");
  const metadata = require("../../lib/plugins/metadata-steward");

  ctx.pluginId = metadata.id;
  expect((await metadata.run(ctx)).report.items[0].actions[0].id).toBe("retry");
  const backup = require("../../lib/plugins/backup-verification");

  expect((await backup.run(workflowContext(backup.id))).report.summary).toContain("operator-approved");
  const access = require("../../lib/plugins/access-review");

  const ac = workflowContext(access.id); ac.dicefiles.getAccessSummary = async () => ({ activeInvites: 1, expiredInvites: 0, unusedInvites: 1, enabledBots: 2, disabledBots: 1, connections: [{ id: "example", provider: "drive", configured: false, allRooms: true }] });
  const report = await access.run(ac); expect(report.flagged).toBe(2); expect(report.report.items[2]).toMatchObject({ title: "example", status: "warning" });
});
