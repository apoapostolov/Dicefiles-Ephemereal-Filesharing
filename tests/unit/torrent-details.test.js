"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function fixture({ files = [], link = null, count = 1 } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../../lib/client.js"), "utf8");
  const method = source.split("  async ontorrentdetails(")[1].split(/\n {2}async on(?:media|roomsessions)/)[0];
  const enrichTorrent = jest.fn(async torrent => ({ ...torrent, checked: true }));
  const get = jest.fn(async () => link);
  const ratelimit = jest.fn(async () => [count]);
  const fakeRequire = name => name === "./links" ? { Link: { get } } : name === "./link-metadata" ? { enrichTorrent } : require("../../common/user-error");
  const handler = vm.compileFunction(`return async function(${method}`, ["require", "BROKER"])(fakeRequire, { getMethods: () => ({ ratelimit }) });
  const client = { roomid: "this-room", role: "white", ip: "synthetic-client", room: { files: { for: jest.fn(async () => files) } }, emit: jest.fn() };
  return { call: (...args) => handler.call(client, ...args), client, enrichTorrent, get, ratelimit };
}

test("torrent details use the caller's visible room files", async () => {
  const torrent = { name: "Book" };
  const { call, client, enrichTorrent } = fixture({ files: [{ key: "visible", meta: { torrent } }] });
  await call("one", { kind: "file", key: "visible" }, true);
  expect(client.room.files.for).toHaveBeenCalledWith("white", "synthetic-client");
  expect(enrichTorrent).toHaveBeenCalledWith(torrent, { discovery: true, force: true });
  expect(client.emit).toHaveBeenCalledWith("torrentdetails-one", { torrent: { ...torrent, checked: true } });
  await call("two", { kind: "file", key: "foreign" });
  expect(enrichTorrent).toHaveBeenCalledTimes(1);
  expect(client.emit.mock.calls[1][1].err).toContain("no longer available");
});

test.each([{ roomid: "other-room" }, { roomid: "this-room", expired: true }, null])("foreign and expired links cannot start discovery %#", async link => {
  const { call, enrichTorrent, ratelimit } = fixture({ link: link && { ...link, meta: { torrent: { name: "Hidden" } } } });
  await call("one", { kind: "link", key: "item" });
  expect(enrichTorrent).not.toHaveBeenCalled(); expect(ratelimit).not.toHaveBeenCalled();
});

test("valid room links and rate limits are enforced before network lookup", async () => {
  const link = { roomid: "this-room", meta: { torrent: { name: "Public item" } } };
  const allowed = fixture({ link }); await allowed.call("one", { kind: "link", key: "item" });
  expect(allowed.enrichTorrent).toHaveBeenCalledTimes(1);
  const limited = fixture({ link, count: 7 }); await limited.call("two", { kind: "link", key: "item" });
  expect(limited.enrichTorrent).not.toHaveBeenCalled(); expect(limited.client.emit.mock.calls[0][1].err).toContain("Wait");
});

test("malformed callback IDs and inputs are rejected without coercion or lookup", async () => {
  const { call, client, get, enrichTorrent } = fixture();
  await call({ toString: "not callable" }, { kind: "link", key: "item" });
  await call("safe", { kind: "link", key: "x".repeat(81) });
  await call("safe", { kind: "file", key: "item" }, "true");
  expect(client.emit.mock.calls[0][0]).toBe("torrentdetails-invalid");
  expect(get).not.toHaveBeenCalled(); expect(enrichTorrent).not.toHaveBeenCalled(); expect(client.room.files.for).not.toHaveBeenCalled();
});
