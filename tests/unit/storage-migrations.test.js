"use strict";

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { createStorageMover } = require("../../lib/storage-migrations");

class MemoryMap extends Map {
  get loaded() {
    return Promise.resolve();
  }
  async getFresh(key) {
    return structuredClone(this.get(key));
  }
  async setDurable(key, value) {
    this.set(key, structuredClone(value));
  }
  async updateAtomic(key, update) {
    const next = update(await this.getFresh(key)); await this.setDurable(key, next); return next;
  }
}

describe("resumable storage moves", () => {
  let directory;
  let volumes;
  let storage;
  let jobs;
  let mover;
  let reserve;
  let release;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "dice-move-"));
    volumes = { source: { id: "source", path: path.join(directory, "source"), enabled: true }, target: { id: "target", path: path.join(directory, "target"), enabled: true } };
    for (const volume of Object.values(volumes)) {
      await fs.mkdir(path.join(volume.path, "f", "i"), { recursive: true });
    }
    await fs.writeFile(path.join(volumes.source.path, "f", "i", "file1"), "synthetic blob");
    await fs.writeFile(path.join(volumes.source.path, "f", "i", "file1.jpg"), "synthetic preview");
    storage = new MemoryMap([["hash1", { hash: "hash1", name: "file1", volumeId: "source", assets: [[".jpg", { ext: ".jpg" }]], size: 14, tags: { protected: true } }]]);
    jobs = new MemoryMap();
    reserve = jest.fn(async () => ({ volumeId: "target" })); release = jest.fn(async () => 1);
    mover = createStorageMover({ storage, jobs, getVolume: id => volumes[id], reserve, release, lease: async (_key, action) => action(async () => {}), bytesPerSecond: 1e9 });
  });
  afterEach(async () => {
    mover.stop(); await fs.rm(directory, { recursive: true, force: true });
  });
  test("dry runs do not change metadata; copy/cutover preserves bytes, assets and source grace", async () => {
    const preview = await mover.plan({ hashes: ["hash1"], targetVolumeId: "target" });
    expect(preview.dryRun).toBe(true); expect(jobs.size).toBe(0);
    const plan = await mover.plan({ hashes: ["hash1"], targetVolumeId: "target", dryRun: false });
    const job = await mover.move(plan.jobs[0].id);
    expect(job.state).toBe("metadata-switched");
    expect(storage.get("hash1").volumeId).toBe("target");
    expect(storage.get("hash1").tags.protected).toBe(true);
    expect(await fs.readFile(path.join(volumes.target.path, "f", "i", "file1.jpg"), "utf8")).toBe("synthetic preview");
    expect(await fs.readFile(path.join(volumes.source.path, "f", "i", "file1"), "utf8")).toBe("synthetic blob");
    expect(release).toHaveBeenCalledWith(`migration:${job.id}`, "target");
    await jobs.setDurable(job.id, { ...job, committedAt: Date.now() - 2 * 86400000 });
    expect((await mover.move(job.id)).state).toBe("complete");
    await expect(fs.access(path.join(volumes.source.path, "f", "i", "file1"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("rollback restores metadata during grace and removes only verified destination files", async () => {
    const plan = await mover.plan({ hashes: ["hash1"], targetVolumeId: "target", dryRun: false });
    await mover.move(plan.jobs[0].id);
    await mover.control(plan.jobs[0].id, "rollback");
    expect(storage.get("hash1").volumeId).toBe("source");
    expect(jobs.get(plan.jobs[0].id).state).toBe("rolled-back");
    await expect(fs.access(path.join(volumes.target.path, "f", "i", "file1"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("duplicate active plans are rejected", async () => {
    await mover.plan({ hashes: ["hash1"], targetVolumeId: "target", dryRun: false });
    await expect(mover.plan({ hashes: ["hash1"], targetVolumeId: "target", dryRun: false })).rejects.toMatchObject({ status: 409 });
  });
  test("expired blobs still release retained source files after cutover grace", async () => {
    const plan = await mover.plan({ hashes: ["hash1"], targetVolumeId: "target", dryRun: false });
    const job = await mover.move(plan.jobs[0].id);
    storage.delete("hash1");
    await jobs.setDurable(job.id, { ...job, committedAt: Date.now() - 2 * 86400000 });
    expect((await mover.move(job.id)).state).toBe("complete");
    await expect(fs.access(path.join(volumes.source.path, "f", "i", "file1"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("conflicting destination content is preserved and reservations are released", async () => {
    await fs.writeFile(path.join(volumes.target.path, "f", "i", "file1"), "different content");
    const plan = await mover.plan({ hashes: ["hash1"], targetVolumeId: "target", dryRun: false });
    await expect(mover.move(plan.jobs[0].id)).rejects.toThrow("different content");
    expect(storage.get("hash1").volumeId).toBe("source");
    expect(await fs.readFile(path.join(volumes.target.path, "f", "i", "file1"), "utf8")).toBe("different content");
    expect(release).toHaveBeenCalled();
  });
});

test("a move requires an explicit target volume", async () => {
  const mover = createStorageMover({ storage: new Map(), jobs: new Map(), getVolume: jest.fn(), lease: async (_key, action) => action(async () => {}) });
  await expect(mover.plan({ hashes: [] })).rejects.toMatchObject({ status: 400 });
});
