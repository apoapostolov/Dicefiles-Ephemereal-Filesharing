"use strict";

const { createPluginStateFactory } = require("../../lib/plugins/state");
const { createPluginReport } = require("../../lib/plugins/reports");
const { createWorkflowApi, revision } = require("../../lib/plugins/workflow-api");
const { scopedPluginApi } = require("../../lib/plugins/scoped-api");
const { localTime, similarity } = require("../../lib/plugins/workflows");

function context(id, files = [], requests = [], config = {}) {
  const state = createPluginStateFactory({ memory: true })({ pluginId: id, roomId: "room" });
  return { pluginId: id, config: { roomId: "room", quietStart: 0, quietEnd: 0, ...config }, state, report: createPluginReport(state),
    dicefiles: { listFilesPage: async () => ({ files }), listRequests: async spec => requests.filter(request => !spec.status || request.status === spec.status),
      postMessage: jest.fn(async () => ({ ok: true })), getRoomGuide: async () => ({ name: "Example", motd: "Be kind", allowRequests: true, ttlHours: 24 }), fulfillRequest: jest.fn(async () => ({})), releaseRequest: jest.fn(async () => ({})),
      curateFile: jest.fn(async () => ({ revision: "updated" })), quarantineFile: jest.fn(async () => ({ revision: "updated" })),
    }, signal: new AbortController().signal };
}

test("welcome suppresses reconnects durably and observes quiet hours and daily limits", async () => {
  const plugin = require("../../lib/plugins/welcome-guide");

  const ctx = context(plugin.id, [], [], { postToChat: true, maxWelcomesPerDay: 1 });
  expect((await plugin.run(ctx, { job: { event: "member_joined", key: "member1" } })).delivered).toBe(1);
  expect((await plugin.run(ctx, { job: { event: "member_joined", key: "member1" } })).delivered).toBe(0);
  expect((await plugin.run(ctx, { job: { event: "member_joined", key: "member2" } })).delivered).toBe(0);
  expect(ctx.dicefiles.postMessage).toHaveBeenCalledTimes(1);
  expect(localTime({ timezone: "Europe/Sofia", quietStart: 22, quietEnd: 8 }, Date.UTC(2026, 0, 1, 23)).quiet).toBe(true);
  await expect(plugin.run({ ...ctx, config: { ...ctx.config, timezone: "invalid-zone" } })).rejects.toThrow("valid IANA");
});

test("triage uses deterministic matches and requires an explicit current report action", async () => {
  const plugin = require("../../lib/plugins/request-triage");

  const ctx = context(plugin.id, [{ key: "one", name: "Practical astronomy.pdf", href: "/g/one" }], [{ key: "req", name: "Practical astronomy", status: "open", revision: "initial" }]);
  const scan = await plugin.run(ctx, { mode: "preview" }); expect(scan.flagged).toBe(1);
  expect(ctx.dicefiles.fulfillRequest).not.toHaveBeenCalled();
  const report = await ctx.report.write(scan.report);
  await expect(plugin.run(ctx, { review: { reportId: "stale", itemId: report.items[0].id, action: "fulfill" } })).rejects.toMatchObject({ status: 409 });
  await plugin.run(ctx, { review: { reportId: report.id, itemId: report.items[0].id, action: "fulfill" } });
  expect(ctx.dicefiles.fulfillRequest).toHaveBeenCalledWith({ key: "req", expectedRevision: "initial", fileKey: "one" });
  await expect(plugin.run(ctx, { review: { reportId: report.id, itemId: report.items[0].id, action: "fulfill" } })).rejects.toMatchObject({ status: 409 });
  expect(similarity("astronomy", "unrelated title")).toBe(0);
});

test("curation review retains private undo data without exposing it in the public report", async () => {
  const plugin = require("../../lib/plugins/collection-curator");

  const ctx = context(plugin.id, [{ key: "one", name: "Book.pdf", tags: { series: "Space" }, meta: {}, revision: "initial" }]);
  const scan = await plugin.run(ctx, { mode: "preview" }); const report = await ctx.report.write(scan.report);
  expect(report.items[0]).not.toHaveProperty("data");
  await plugin.run(ctx, { review: { reportId: report.id, itemId: "0", action: "apply" } });
  expect((await ctx.report.read()).items[0].data.expectedRevision).toBe("updated");
  await plugin.run(ctx, { review: { reportId: report.id, itemId: "0", action: "undo" } });
  expect(ctx.dicefiles.curateFile).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: "updated", undo: true }));
});

test("duplicate and upload reviews never delete; quarantine is opt-in and explicit", async () => {
  const duplicate = require("../../lib/plugins/duplicate-review");

  const files = [{ key: "one", name: "one.exe", hash: "same", size: 10, meta: {}, revision: "initial" }, { key: "two", name: "two.exe", hash: "same", size: 10, meta: {}, revision: "initial" }];
  expect((await duplicate.run(context(duplicate.id, files))).flagged).toBe(1);
  const upload = require("../../lib/plugins/upload-review");

  const ctx = context(upload.id, files, [], { blockedExtensions: ["exe"] });
  let report = await ctx.report.write((await upload.run(ctx)).report);
  expect(report.items[0].actions[0].id).toBe("dismiss"); expect(ctx.dicefiles.quarantineFile).not.toHaveBeenCalled();
  ctx.config.allowQuarantine = true; report = await ctx.report.write((await upload.run(ctx)).report);
  await upload.run(ctx, { review: { reportId: report.id, itemId: "0", action: "quarantine" } });
  expect((await ctx.report.read()).items[0].actions[0].id).toBe("release");
  await upload.run(ctx, { review: { reportId: report.id, itemId: "0", action: "release" } });
  expect(ctx.dicefiles.quarantineFile).toHaveBeenLastCalledWith(expect.objectContaining({ release: true, expectedRevision: "updated" }));
});

test("request stewardship preserves human claims and digests publish once in their local window", async () => {
  const steward = require("../../lib/plugins/request-steward");

  const requests = [{ key: "one", name: "Request", status: "open", claimedBy: "human", claimedUntil: Date.now() - 1000 }];
  const ctx = context(steward.id, [], requests);
  const result = await steward.run(ctx); expect(result.flagged).toBe(1); expect(result.report.items[0].actions).toEqual([]);
  expect(ctx.dicefiles.releaseRequest).not.toHaveBeenCalled();
  const digest = require("../../lib/plugins/community-digest");

  const day = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format();
  const digestCtx = context(digest.id, [{ key: "one", name: "New.pdf", uploaded: Date.now(), href: "/g/one" }], [], { publishDay: day, publishHour: 0, postToChat: true });
  expect((await digest.run(digestCtx)).delivered).toBe(1);
  expect((await digest.run(digestCtx)).delivered).toBe(0);
  expect(digestCtx.dicefiles.postMessage).toHaveBeenCalledTimes(1);
});

class Item {
  constructor(data) {
    Object.assign(this, data);
  }
  toJSON() {
    return { ...this };
  }
  toClientJSON() {
    return this.toJSON();
  }
}

function apiFixture() {
  const records = new Map([["one", new Item({ key: "one", roomid: "room", name: "One.pdf", tags: {}, meta: {}, expires: Date.now() + 100000 })], ["foreign", new Item({ key: "foreign", roomid: "other", name: "Other.pdf", tags: {}, meta: {}, expires: Date.now() + 100000 })]]);
  const uploads = { getFresh: async key => records.get(key), updateAtomic: async (key, update) => {
    const next = update(records.get(key)); records.set(key, next); return next;
  } };
  const room = { roomid: "room", config: { get: () => "" }, getRoomPlugins: () => [{ id: "upload-review", enabled: true, config: { allowQuarantine: true } }] };
  const broker = { emit: jest.fn() };
  const api = createWorkflowApi({ getRoom: async id => id === "room" ? room : null, uploads, broker });
  return { api, records, room, broker };
}

test("typed curation rejects foreign/stale files, preserves manual values and reverses its own change", async () => {
  const { api, records, broker } = apiFixture(); const own = { roomId: "room", pluginId: "collection-curator", key: "one" };
  await expect(api.curateFile({ ...own, key: "foreign" })).rejects.toMatchObject({ status: 404 });
  await expect(api.curateFile({ ...own, expectedRevision: "stale", tags: { collection: "Books" } })).rejects.toMatchObject({ status: 409 });
  const result = await api.curateFile({ ...own, expectedRevision: revision(records.get("one")), tags: { collection: "Books" } });
  expect(records.get("one").tags.collection).toBe("Books");
  await api.curateFile({ ...own, expectedRevision: result.revision, undo: true });
  expect(records.get("one").tags.collection).toBeUndefined();
  records.get("one").tags.collection = "Manual";
  await expect(api.curateFile({ ...own, expectedRevision: revision(records.get("one")), tags: { collection: "Replace" } })).rejects.toMatchObject({ status: 409 });
  expect(broker.emit).toHaveBeenCalledTimes(2);
  const scoped = scopedPluginApi(api, { roomId: "room", pluginId: "collection-curator" });
  expect(() => scoped.curateFile({ roomId: "other" })).toThrow("invited room");
});

test("quarantine requires the correct enabled invitation and restores prior hidden state", async () => {
  const { api, records, room } = apiFixture(); const spec = { roomId: "room", pluginId: "upload-review", key: "one" };
  await expect(api.quarantineFile({ ...spec, pluginId: "other" })).rejects.toMatchObject({ status: 403 });
  const quarantined = await api.quarantineFile({ ...spec, expectedRevision: revision(records.get("one")) });
  expect(records.get("one").tags.hidden).toBe(true);
  await api.quarantineFile({ ...spec, expectedRevision: quarantined.revision, release: true });
  expect(records.get("one").tags.hidden).toBeUndefined();
  room.getRoomPlugins = () => [];
  await expect(api.quarantineFile(spec)).rejects.toMatchObject({ status: 403 });
});


test("dismissed reviews persist across scans while changed rules return for review", async () => {
  for (const id of ["duplicate-review", "upload-review"]) {
    const plugin = require(`../../lib/plugins/${id}`);

    const files = [{key: "one", name: "One.exe", hash: "same", size: 10, revision: "initial"}, {key: "two", name: "Two.exe", hash: "same", size: 10, revision: "initial"}];
    const ctx = context(id, files, [], {blockedExtensions: ["exe"]});
    const scan = await plugin.run(ctx); const report = await ctx.report.write(scan.report);
    for (const item of report.items) {
      await plugin.run(ctx, {review: {reportId: report.id, itemId: item.id, action: "dismiss"}});
    }
    expect((await plugin.run(ctx)).flagged).toBe(0);
    if (id === "upload-review") {
      files[0].revision = "changed"; expect((await plugin.run(ctx)).flagged).toBe(1);
    }
  }
});

test("request fulfillment guards human claims and foreign files and persists a scoped audit", async () => {
  const fixture = apiFixture(); const stateFactory = createPluginStateFactory({memory: true});
  const records = new Map([["req", new Item({key: "req", roomid: "room", name: "One", status: "open", expires: Date.now() + 100000, claimedBy: "human", claimedUntil: Date.now() + 50000})]]);
  const requests = {REQUESTS: {updateAtomic: async (key, update) => {
    const item = update(records.get(key)); records.set(key, item); return item;
  }}};
  const fulfilled = jest.fn();
  const api = createWorkflowApi({getRoom: async() => fixture.room, uploads: {getFresh: async key => fixture.records.get(key)}, requests, broker: fixture.broker, onRequestFulfilled: fulfilled, auditStateFactory: stateFactory});
  const spec = {roomId: "room", pluginId: "request-triage", key: "req", fileKey: "one", botName: "Triage"};
  await expect(api.fulfillRequest({...spec, fileKey: "foreign", expectedRevision: revision(records.get("req"))})).rejects.toMatchObject({status: 404});
  await expect(api.fulfillRequest({...spec, expectedRevision: revision(records.get("req"))})).rejects.toThrow("active human claim");
  records.get("req").claimedUntil = Date.now() - 1;
  await expect(api.fulfillRequest({...spec, expectedRevision: "stale"})).rejects.toMatchObject({status: 409});
  const result = await api.fulfillRequest({...spec, expectedRevision: revision(records.get("req"))});
  expect(result).toMatchObject({status: "fulfilled", hints: {fileKey: "one", plugin: "request-triage"}});
  expect(fulfilled).toHaveBeenCalledTimes(1);
  expect((await stateFactory(spec).get("audit:actions")).value).toEqual([expect.objectContaining({operation: "request.fulfill", key: "req"})]);
  expect(await stateFactory({...spec, roomId: "foreign"}).get("audit:actions")).toBeNull();
});


test("room runtime permits consecutive report actions in the same time bucket", async () => {
  const {createRoomPluginRuntime} = require("../../lib/plugins/room-runtime");

  const stateFactory = createPluginStateFactory({memory: true}); const completed = new Set(); const leases = new Set();
  const plugin = {id: "review-fixture", name: "Review fixture", run: jest.fn(async (_ctx, args) => ({action: args.review.action}))};
  const runtime = createRoomPluginRuntime({now: () => 1000, loadModule: () => ({ok: true, plugin}), buildCtx: () => ({createPluginState: stateFactory, events: {begin: async (scope, id) => {
    const key = scope + id; if (completed.has(key) || leases.has(key)) {
      return null;
    } leases.add(key); return key;
  }, renew: async() => true, complete: async key => {
    leases.delete(key); completed.add(key);
  }, fail: async key => leases.delete(key)}}), runStatus: {record: async() => {}}});
  const invited = [{id: plugin.id, enabled: true, config: {}}];
  expect(runtime._scheduledRunEventId("review", {}, {})).toBe("");
  expect(await runtime.runRoomPlugin("room", plugin.id, {reason: "review", review: {action: "apply"}}, invited)).toEqual({action: "apply"});
  expect(await runtime.runRoomPlugin("room", plugin.id, {reason: "review", review: {action: "undo"}}, invited)).toEqual({action: "undo"});
  expect(plugin.run).toHaveBeenCalledTimes(2);
});


test("file review revisions ignore room-member display decoration but retain real edits", () => {
  const {decorateNewRoomMember} = require("../../lib/room/member-age");

  const file = {key: "one", name: "One.pdf", tags: {}, meta: {title: "One", roomMemberJoinedAt: Date.now()}};
  const view = decorateNewRoomMember(structuredClone(file));
  expect(revision(view)).toBe(revision(file));
  view.meta.title = "Changed"; expect(revision(view)).not.toBe(revision(file));
  const {userError} = require("../../common/user-error");

  const message = "This item changed after the report was prepared. Refresh the report before applying this action.";
  expect(userError(new Error(message))).toBe(message);
});
