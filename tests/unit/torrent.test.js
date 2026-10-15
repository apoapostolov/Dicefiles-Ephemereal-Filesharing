"use strict";

const { createHash } = require("crypto");
const { parseTorrent, parseMagnet, MAX_TORRENT_BYTES } = require("../../lib/torrent");
const { enrichTorrent, htmlMeta, fetchTorrent, httpUrl } = require("../../lib/link-metadata");
const { normalizeMagnetInput, messageLimit } = require("../../common/torrent-input");
const { toMessage } = require("../../common/message");

function encode(value) {
  if (typeof value === "number") {
    return Buffer.from(`i${value}e`);
  }
  if (typeof value === "string") {
    value = Buffer.from(value);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("l"), ...value.map(encode), Buffer.from("e")]);
  }
  return Buffer.concat([Buffer.from("d"), ...Object.keys(value).sort().flatMap(key => [encode(key), encode(value[key])]), Buffer.from("e")]);
}

const info = { "name": "Synthetic fixture.txt", "length": 4, "piece length": 16384, "pieces": Buffer.alloc(20, 1) };
const fixture = encode({ "announce": "https://tracker.example/announce", "comment": "Synthetic metadata", "created by": "Dicefiles fixture", "creation date": 1234567890, info });

test("v1 hashes the original encoded info and exposes full file metadata", () => {
  const torrent = parseTorrent(fixture);
  expect(torrent.infoHashV1).toBe(createHash("sha1").update(encode(info)).digest("hex"));
  expect(torrent).toMatchObject({ totalSize: 4, fileCount: 1, files: [{ path: info.name, size: 4 }], pieceCount: 1, createdBy: "Dicefiles fixture" });
  expect(parseMagnet(torrent.magnet).infoHashV1).toBe(torrent.infoHashV1);
});
test("multi-file, private torrents and tracker tiers are retained", () => {
  const torrent = parseTorrent(encode({ "announce-list": [["udp://tracker.example:80"]], "info": { "name": "folder", "files": [{ path: ["a", "b.txt"], length: 4 }], "piece length": 16384, "pieces": Buffer.alloc(20), "private": 1 } }));
  expect(torrent.files[0].path).toBe("a/b.txt");
  expect(torrent.private).toBe(true);
  expect(torrent.trackerTiers).toEqual([["udp://tracker.example:80"]]);
});
test("v2 file tree and SHA-256 hashes are retained", () => {
  const torrent = parseTorrent(encode({ info: { "name": "v2", "meta version": 2, "piece length": 16384, "file tree": { "file.txt": { "": { "length": 4, "pieces root": Buffer.alloc(32, 1) } } } } }));
  expect(torrent.infoHashV1).toBeNull();
  expect(torrent.infoHashV2).toHaveLength(64);
  expect(parseMagnet(torrent.magnet).infoHashV2).toBe(torrent.infoHashV2);
  expect(torrent.files[0].piecesRoot).toHaveLength(64);
});
test.each([
  Buffer.from("d4:infoi1ee"), Buffer.from("d4:infod4:name1:aeejunk"),
  Buffer.from("d4:infod4:name1:a4:name1:bee"), Buffer.from("i-0e"),
  Buffer.alloc(MAX_TORRENT_BYTES + 1),
  encode({ info: { ...info, name: "../escape" } }),
  encode({ info: { ...info, pieces: Buffer.alloc(19) } }),
  encode({ info: { "name": "folder", "piece length": 1, "pieces": Buffer.alloc(20), "files": [{ path: ["..", "escape"], length: 1 }] } }),
])("rejects malformed or unsafe metadata %#", value => {
  expect(() => parseTorrent(value)).toThrow();
});
test("magnets preserve extension parameters, v1 base32 and v2 hashes", () => {
  const magnet = parseMagnet(`magnet:?xt=urn:btih:${"A".repeat(32)}&dn=Demo&tr=udp%3A%2F%2Ft.example&xl=42&x.custom=kept`);
  expect(magnet).toMatchObject({ infoHashV1: "0".repeat(40), name: "Demo", totalSize: 42 });
  expect(magnet.parameters["x.custom"]).toEqual(["kept"]);
  expect(normalizeMagnetInput(magnet.magnet).name).toBe("Demo");
  expect(() => parseMagnet("magnet:?xt=wrong")).toThrow();
  expect(messageLimit("hello")).toBe(300);
});
test("chat recognizes magnet URLs without treating them as HTTPS", async () => {
  const url = `magnet:?xt=urn:btih:${"a".repeat(40)}&dn=Test`;
  const result = await toMessage(URL, () => null, () => null, url);
  expect(result).toEqual([{ t: "u", v: url }]);
});
test("HTTP metadata must match the magnet hash and never calls tracker or webseed URLs", async () => {
  const parsed = parseTorrent(fixture);
  const magnet = parseMagnet(`${parsed.magnet}&xs=https://source.example/file.torrent`);
  const fetcher = jest.fn(async () => new Response(fixture));
  const enriched = await enrichTorrent(magnet, { fetcher });
  expect(enriched.metadataStatus).toBe("verified-source");
  expect(enriched.files).toHaveLength(1);
  expect(fetcher.mock.calls.every(call => call[0].startsWith("https://source.example/"))).toBe(true);
  const wrong = parseMagnet(`magnet:?xt=urn:btih:${"f".repeat(40)}&xs=https://source.example/file.torrent`);
  expect((await enrichTorrent(wrong, { fetcher })).metadataStatus).toBe("link-only");
});
test("source URLs reject credentials and non-HTTP schemes", async () => {
  expect(httpUrl("https://user:pass@example.test/a")).toBeNull();
  await expect(fetchTorrent("file:///secret")).rejects.toThrow("HTTP");
});

test("legacy live-worker metadata with an empty-object source list remains usable", async () => {
  const torrent = parseMagnet(`magnet:?xt=urn:btih:${"c".repeat(40)}`);
  torrent.exactSources = {};
  await expect(enrichTorrent(torrent)).resolves.toMatchObject({ name: torrent.name, metadataStatus: "link-only" });
});
test("image discovery reads Open Graph attributes in either order", () => {
  expect(htmlMeta("<meta content=\"/cover.jpg\" property=\"og:image\"><meta property=\"og:title\" content=\"A &amp; B\">", "https://example.test/page")).toMatchObject({ title: "A & B", imageUrl: "https://example.test/cover.jpg" });
});
test("discovered covers are bounded JPEG data, never a browser request to the source", async () => {
  const image = await require("sharp")({ create: { width: 10, height: 10, channels: 3, background: "grey" } }).png().toBuffer();
  const fetcher = jest.fn(async () => new Response(image, { headers: { "content-type": "image/png" } }));
  const torrent = parseTorrent(encode({ image: "https://cover.example/cover.png", info }));
  const result = await enrichTorrent(torrent, { fetcher });
  expect(result.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(result.imageDataUrl.length).toBeLessThan(128 * 1024);
  expect(fetcher.mock.calls[0][2]).toMatchObject({ timeoutMs: 5000, maxBytes: 2 * 1024 * 1024 });
});
