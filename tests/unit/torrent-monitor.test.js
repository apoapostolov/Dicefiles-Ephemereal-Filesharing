"use strict";

const { checkTorrent, identity, dueGroups, runBatch, supportedTrackers } = require("../../lib/torrent-monitor");
const { availabilityView } = require("../../common/torrent-presentation");

const NOW = 2000000000000;
const torrent = { infoHashV1: "a".repeat(40), trackers: ["udp://tracker.example:80", "https://other.example/announce"] };

test("relaxed checks scrape only, use maxima and preserve real zero counts", async () => {
  const scrape = jest.fn(async raw => raw.startsWith("udp:") ? { seeders: 4, leechers: 0, completed: 10 } : { seeders: 2, leechers: 0, completed: 6 });
  const result = await checkTorrent(torrent, { now: NOW, scrape });
  expect(scrape).toHaveBeenCalledTimes(2);
  expect(result.availability).toMatchObject({ seeders: 4, leechers: 0, completed: 10, reportedAt: NOW, checkedAt: NOW, state: "current" });
  expect(result.availability.nextCheckAt - NOW).toBeGreaterThanOrEqual(12 * 60000);
  expect(result.availability.nextCheckAt - NOW).toBeLessThanOrEqual(18 * 60000);
});

test("unavailable trackers retain last known counts and back off without inventing zero", async () => {
  const scrape = jest.fn(async () => {
    throw new Error("offline");
  });
  const result = await checkTorrent({ ...torrent, availability: { seeders: 5, leechers: 2, checkedAt: NOW - 900000, responding: 1 } }, { now: NOW, scrape });
  expect(result.availability).toMatchObject({ seeders: 5, leechers: 2, state: "stale", reportedAt: NOW - 900000, responding: 0 });
  expect(result.availability.nextCheckAt - NOW).toBeGreaterThanOrEqual(27 * 60000);
  const unknown = await checkTorrent(torrent, { now: NOW, scrape });
  expect(unknown.availability).toMatchObject({ seeders: null, leechers: null, state: "unknown", reportedAt: null });
});

test("scheduling deduplicates swarms, isolates tracker credentials and bounds each batch", () => {
  const ref = (t, extra = {}) => ({ item: { expires: NOW + 1, meta: { torrent: t }, ...extra } });
  const refs = [ref(torrent), ref(torrent), ref({ ...torrent, availability: { nextCheckAt: NOW + 1 } }), ref(torrent, { expires: NOW })];
  expect(dueGroups(refs, NOW)).toHaveLength(0);
  expect(dueGroups(refs.slice(0, 2), NOW)[0].refs).toHaveLength(2);
  const many = Array.from({ length: 10 }, (_, i) => ref({ ...torrent, infoHashV1: i.toString(16).repeat(40) }));
  expect(dueGroups(many, NOW)).toHaveLength(4);
  expect(identity(torrent)).not.toBe(identity({ ...torrent, trackers: ["https://other.example/announce?passkey=private"] }));
  expect(identity(torrent)).toBe(identity({ ...torrent, trackers: [...torrent.trackers].reverse() }));
  expect(supportedTrackers({ trackers: ["wss://example.org", "file:///etc/passwd", "https://user:pass@example.org/announce", "https://example.org/no-scrape"] })).toHaveLength(0);
  expect(dueGroups([ref({ ...torrent, trackers: { legacy: true } }), ref(torrent)], NOW)).toHaveLength(1);
  expect(supportedTrackers({ trackers: { legacy: true } })).toHaveLength(0);
});

test("pill distinguishes unknown, zero and stale reports and compacts large counts", () => {
  expect(availabilityView({}, NOW)).toMatchObject({ seeders: "—", peers: "—", state: "unknown" });
  expect(availabilityView({ availability: { seeders: 0, leechers: 0, reportedAt: NOW } }, NOW)).toMatchObject({ seeders: "0", peers: "0", state: "current" });
  const large = availabilityView({ availability: { seeders: 12345, leechers: 99, reportedAt: NOW - 46 * 60000 } }, NOW);
  expect(large.seeders.length).toBeLessThan(6); expect(large.state).toBe("stale"); expect(large.label).toContain("downloading peers");
});

test("batch writes current authoritative metadata and broadcasts through the normal maps", async () => {
  class Item {
    constructor(value) {
      Object.assign(this, value);
    }
    toJSON() {
      return { ...this };
    }
  }

  const current = new Item({ expires: Date.now() + 60000, meta: { torrent, cinema: { movie: "preserved" } } });
  const map = { entriesFresh: async () => [["key", current]], updateAtomic: jest.fn(async (_key, update) => update(current)) };
  const assertOwned = jest.fn(); const lease = jest.fn(async (_name, action) => action(assertOwned));
  const check = jest.fn(async () => ({ availability: { seeders: 3, leechers: 2, checkedAt: NOW } }));
  await runBatch({ sources: [{ map, Type: Item }], lease, check, now: Date.now() });
  expect(check).toHaveBeenCalledTimes(1); expect(assertOwned).toHaveBeenCalledTimes(2);
  const updated = map.updateAtomic.mock.results[0].value;
  expect((await updated).meta).toMatchObject({ cinema: { movie: "preserved" }, torrent: { availability: { seeders: 3 } } });
});

test("deleted items are skipped and a changed torrent cannot receive an old report", async () => {
  const current = { expires: Date.now() + 60000, meta: { torrent } };
  const map = { entriesFresh: async () => [["key", current]], updateAtomic: jest.fn(async (_key, update) => update({ ...current, meta: { torrent: { ...torrent, infoHashV1: "b".repeat(40) } } })) };
  const lease = async (_name, action) => action(async () => {});
  await expect(runBatch({ sources: [{ map, Type: Object }], lease, check: async () => ({}), now: Date.now() })).resolves.toBe(1);
  map.updateAtomic = async () => {
    throw Object.assign(new Error("deleted"), { status: 404 });
  };
  await expect(runBatch({ sources: [{ map, Type: Object }], lease, check: async () => ({}), now: Date.now() })).resolves.toBe(1);
});
