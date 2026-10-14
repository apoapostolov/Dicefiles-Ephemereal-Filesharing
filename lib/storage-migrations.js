"use strict";

const fs = require("fs/promises");
const { createReadStream, createWriteStream } = require("fs");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { setTimeout: delay } = require("timers/promises");
const { withLease } = require("./redis-lease");

const read = (map, key) => map.getFresh ? map.getFresh(key) : map.get(key);
const write = (map, key, value) => map.setDurable ? map.setDurable(key, value) : map.set(key, value);
const json = value => value.toJSON ? value.toJSON() : value;

async function checkedPath(volume, name, suffix = "", optional = false) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name) || suffix && !/^\.[a-zA-Z0-9._-]{1,100}$/.test(suffix)) {
    throw new Error("Invalid storage filename");
  }
  const root = await fs.realpath(volume.path);
  const full = path.join(root, name[0], name[1], name + suffix);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const parent = await fs.realpath(path.dirname(full));
  if (!parent.startsWith(root + path.sep)) {
    throw new Error("Storage path escaped its volume");
  }
  try {
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Storage must be a regular file");
    }
  }
  catch (error) {
    if (!optional || error.code !== "ENOENT") {
      throw error;
    }
  }
  return full;
}

async function checksum(full) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(full)) {
    hash.update(chunk); size += chunk.length;
  }
  return { checksum: hash.digest("hex"), size };
}

function createStorageMover({ storage, jobs, getVolume, reserve, release, renewReservation = async () => {}, lease = withLease, queue, graceMs = 86400000, bytesPerSecond = 16 * 1024 * 1024 }) {
  const active = new Map();
  let timer;
  let running = false;

  async function save(job, updates) {
    const current = await read(jobs, job.id);
    Object.assign(job, current || {}, updates, { updatedAt: Date.now() });
    await write(jobs, job.id, job);
    return job;
  }

  async function planUnlocked({ hashes, targetVolumeId, dryRun = true }) {
    await storage.loaded;
    await jobs.loaded;
    if (!Array.isArray(hashes) || hashes.length > 500) {
      throw new Error("Select at most 500 blobs per plan");
    }
    if (typeof targetVolumeId !== "string" || !targetVolumeId.trim()) {
      throw Object.assign(new Error("targetVolumeId is required"), { status: 400 });
    }
    const target = getVolume(targetVolumeId);
    if (!target.enabled || target.readOnly) {
      throw new Error("Destination is not writable");
    }
    let existingJobs = jobs.entriesFresh ? await jobs.entriesFresh() : [...jobs];
    if (!dryRun) {
      const expired = existingJobs.filter(([, job]) => ["complete", "rolled-back"].includes(job.state) && Date.now() - job.updatedAt > 7 * 86400000);
      for (const [id] of expired) {
        if (jobs.deleteDurable) {
          await jobs.deleteDurable(id);
        }
        else {
          jobs.delete(id);
        }
      }
      const ids = new Set(expired.map(([id]) => id));
      existingJobs = existingJobs.filter(([id]) => !ids.has(id));
    }
    if (!dryRun && existingJobs.length + hashes.length > 10000) {
      throw new Error("Migration journal is full; finished jobs are retained for seven days");
    }
    const planned = [];
    for (const hash of [...new Set(hashes)]) {
      if (existingJobs.some(([, job]) => job.hash === hash && !["complete", "rolled-back"].includes(job.state))) {
        throw Object.assign(new Error("A migration already exists for this blob"), { status: 409 });
      }
      const current = await read(storage, hash);
      if (current) {
        current.hash ||= hash; current.volumeId ||= "legacy";
      }
      if (!current || !current.hash || current.name.startsWith("tmp") && !current.size) {
        throw new Error("Only completed blobs can move");
      }
      if (current.volumeId === targetVolumeId) {
        continue;
      }
      const source = getVolume(current.volumeId);
      const files = [];
      for (const suffix of ["", ...(current.assets || []).map(([ext]) => ext)]) {
        const full = await checkedPath(source, current.name, suffix);
        const stat = await fs.stat(full);
        files.push({ suffix, size: stat.size });
      }
      const job = { id: randomUUID(), hash, name: current.name, sourceVolumeId: current.volumeId, targetVolumeId, files, bytes: files.reduce((sum, file) => sum + file.size, 0), state: "planned", paused: false, createdAt: Date.now(), updatedAt: Date.now() };
      planned.push(job);
      if (!dryRun) {
        await write(jobs, job.id, job); if (queue) {
          await queue.enqueue({ id: job.id, jobId: job.id, attempt: 0, createdAt: Date.now() });
        }
      }
    }
    return { dryRun, jobs: planned, bytes: planned.reduce((sum, job) => sum + job.bytes, 0) };
  }

  async function plan(options) {
    return lease("lock:storage-migration-plan", () => planUnlocked(options));
  }

  async function move(id, { signal } = {}) {
    let job = await read(jobs, id);
    if (!job) {
      throw Object.assign(new Error("Migration not found"), { status: 404 });
    }
    if (job.paused || ["complete", "rolled-back"].includes(job.state)) {
      return job;
    }
    return lease(`lock:storage-blob:${job.hash}`, async assertOwned => {
      job = await read(jobs, id);
      if (job.paused || ["complete", "rolled-back"].includes(job.state)) {
        return job;
      }
      let current = await read(storage, job.hash);
      if (current) {
        current.hash ||= job.hash; current.volumeId ||= "legacy";
      }
      if ((!current && !job.committedAt) || current && current.name !== job.name) {
        throw new Error("Storage changed during migration");
      }
      const source = getVolume(job.sourceVolumeId);
      const target = getVolume(job.targetVolumeId);
      if (current && current.volumeId === job.targetVolumeId && !job.committedAt) {
        await save(job, { state: "metadata-switched", committedAt: Date.now() });
      }
      if (current && current.volumeId === job.sourceVolumeId) {
        const files = [];
        for (const suffix of ["", ...(current.assets || []).map(([ext]) => ext)]) {
          const full = await checkedPath(source, job.name, suffix);
          files.push({ suffix, ...await checksum(full) });
        }
        await save(job, { state: "copying", files, bytes: files.reduce((sum, file) => sum + file.size, 0) });
        const reservation = await reserve(`migration:${job.id}`, job.bytes, job.targetVolumeId);
        let reservationError;
        let renewingReservation = false;
        const reservationTimer = setInterval(async () => {
          if (renewingReservation) {
            return;
          }
          renewingReservation = true;
          try {
            await renewReservation(`migration:${job.id}`, reservation.volumeId);
          }
          catch (error) {
            reservationError = error;
          }
          finally {
            renewingReservation = false;
          }
        }, 30000);
        reservationTimer.unref();
        try {
          for (const file of files) {
            if (signal) {
              signal.throwIfAborted();
            }
            if ((await read(jobs, id)).paused) {
              return save(job, { state: "paused" });
            }
            const from = await checkedPath(source, job.name, file.suffix);
            const to = await checkedPath(target, job.name, file.suffix, true);
            try {
              const existing = await checksum(to);
              if (existing.checksum !== file.checksum || existing.size !== file.size) {
                throw new Error("Destination contains different content");
              }
              continue;
            }
            catch (error) {
              if (error.code !== "ENOENT") {
                throw error;
              }
            }
            const temporary = `${to}.migration-${job.id}`;
            await fs.unlink(temporary).catch(error => {
              if (error.code !== "ENOENT") {
                throw error;
              }
            });
            let copied = 0;
            const started = Date.now();
            const limiter = new Transform({ transform(chunk, _encoding, callback) {
              if (reservationError) {
                callback(reservationError); return;
              }
              copied += chunk.length;
              if (copied > file.size) {
                callback(new Error("Source grew during copy")); return;
              }
              const waitMs = Math.max(0, copied / bytesPerSecond * 1000 - (Date.now() - started));
              delay(waitMs, undefined, { signal }).then(() => callback(null, chunk), callback);
            } });
            try {
              await pipeline(createReadStream(from), limiter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal });
              const handle = await fs.open(temporary, "r+");
              try {
                await handle.sync();
              }
              finally {
                await handle.close();
              }
              const verified = await checksum(temporary);
              if (verified.size !== file.size || verified.checksum !== file.checksum) {
                throw new Error("Migration checksum mismatch");
              }
              await assertOwned();
              try {
                await fs.link(temporary, to);
              }
              catch (error) {
                if (error.code !== "EEXIST") {
                  throw error;
                }
                const existing = await checksum(to);
                if (existing.checksum !== file.checksum || existing.size !== file.size) {
                  throw new Error("Destination contains different content");
                }
              }
              const directory = await fs.open(path.dirname(to), "r");
              try {
                await directory.sync();
              }
              finally {
                await directory.close();
              }
            }
            finally {
              await fs.unlink(temporary).catch(error => {
                if (error.code !== "ENOENT") {
                  throw error;
                }
              });
            }
          }
          await save(job, { state: "verified" });
          if ((await read(jobs, id)).paused) {
            return save(job, { state: "paused" });
          }
          if (reservationError) {
            throw reservationError;
          }
          await renewReservation(`migration:${job.id}`, reservation.volumeId);
          await assertOwned();
          await storage.updateAtomic(job.hash, value => {
            const data = json(value);
            if (data.volumeId !== job.sourceVolumeId || data.name !== job.name) {
              throw new Error("Storage cutover conflict");
            }
            return { ...data, volumeId: job.targetVolumeId };
          });
          await save(job, { state: "metadata-switched", committedAt: Date.now() });
        }
        finally {
          clearInterval(reservationTimer);
          await release(`migration:${job.id}`, reservation.volumeId);
        }
      }
      else if (current && current.volumeId !== job.targetVolumeId) {
        throw new Error("Storage location changed during migration");
      }
      if (Date.now() < job.committedAt + graceMs) {
        return job;
      }
      current = await read(storage, job.hash);
      if (current && current.volumeId !== job.targetVolumeId) {
        throw new Error("Storage cleanup conflict");
      }
      for (const file of job.files) {
        const full = await checkedPath(source, job.name, file.suffix, true);
        try {
          const existing = await checksum(full);
          if (existing.checksum !== file.checksum || existing.size !== file.size) {
            throw new Error("Source changed before cleanup");
          }
          await assertOwned(); await fs.unlink(full);
        }
        catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
      }
      return save(job, { state: "complete", completedAt: Date.now() });
    });
  }

  async function control(id, action) {
    const job = await read(jobs, id);
    if (!job) {
      throw Object.assign(new Error("Migration not found"), { status: 404 });
    }
    if (action === "pause") {
      active.get(id)?.abort();
      return save(job, { paused: true });
    }
    if (action === "resume") {
      if (["complete", "rolled-back"].includes(job.state)) {
        throw new Error("Migration is already finished");
      }
      await save(job, { paused: false, state: job.committedAt ? "metadata-switched" : "planned", error: null });
      if (queue) {
        await queue.enqueue({ id: `${job.id}:${randomUUID()}`, jobId: job.id, attempt: 0, createdAt: Date.now() });
      }
      return job;
    }
    if (action !== "rollback") {
      throw new Error("Unsupported migration action");
    }
    active.get(id)?.abort();
    return lease(`lock:storage-blob:${job.hash}`, async assertOwned => {
      const current = await read(storage, job.hash);
      if (!current || current.name !== job.name) {
        throw new Error("Storage rollback conflict");
      }
      if (current.volumeId === job.targetVolumeId) {
        const source = getVolume(job.sourceVolumeId);
        for (const suffix of ["", ...(current.assets || []).map(([ext]) => ext)]) {
          const from = await checkedPath(source, job.name, suffix);
          const target = await checkedPath(getVolume(job.targetVolumeId), job.name, suffix);
          const [original, copied] = await Promise.all([checksum(from), checksum(target)]);
          if (original.checksum !== copied.checksum) {
            throw new Error("Source cannot safely restore all current assets");
          }
        }
        await assertOwned();
        await storage.updateAtomic(job.hash, value => {
          const data = json(value);
          if (data.volumeId !== job.targetVolumeId) {
            throw new Error("Storage rollback conflict");
          }
          return { ...data, volumeId: job.sourceVolumeId };
        });
      }
      else if (current.volumeId !== job.sourceVolumeId) {
        throw new Error("Storage rollback conflict");
      }
      for (const file of job.files) {
        const full = await checkedPath(getVolume(job.targetVolumeId), job.name, file.suffix, true);
        try {
          const existing = await checksum(full);
          if (file.checksum && existing.checksum === file.checksum) {
            await assertOwned(); await fs.unlink(full);
          }
        }
        catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
      }
      await release(`migration:${job.id}`, job.targetVolumeId);
      return save(job, { state: "rolled-back", paused: true });
    });
  }

  function start() {
    if (!queue || timer) {
      return;
    }
    const pump = async () => {
      if (running) {
        return;
      }
      running = true;
      try {
        const queued = await queue.claim();
        if (!queued) {
          return;
        }
        const controller = new AbortController();
        active.set(queued.jobId, controller);
        const renew = setInterval(() => {
          queue.renew(queued).then(value => {
            if (!Number(value)) {
              controller.abort();
            }
          }).catch(() => controller.abort());
        }, 30000);
        renew.unref();
        try {
          const job = await move(queued.jobId, { signal: controller.signal });
          if (["complete", "rolled-back"].includes(job.state)) {
            await queue.complete(queued);
          }
          else {
            await queue.retry(queued, job.paused ? 60000 : Math.max(1000, job.committedAt + graceMs - Date.now()));
          }
        }
        catch (error) {
          const job = await read(jobs, queued.jobId);
          if (job?.paused || error.status === 409) {
            await queue.retry(queued, 60000); return;
          }
          if (job) {
            await save(job, { error: "Migration stopped; resume or rollback after inspecting storage", state: job.committedAt ? "cleanup-pending" : "failed" });
          }
          await queue.deadLetter(queued, new Error("Migration stopped"));
        }
        finally {
          clearInterval(renew); active.delete(queued.jobId);
        }
      }
      finally {
        running = false;
      }
    };
    timer = setInterval(() => {
      pump().catch(error => console.error("Storage mover failed", error.message));
    }, 1000);
    timer.unref();
  }

  return { plan, move, control, start, stop() {
    clearInterval(timer); timer = null; for (const controller of active.values()) {
      controller.abort();
    }
  }, jobs };
}

let defaultMover;

function getDefaultStorageMover() {
  if (defaultMover) {
    return defaultMover;
  }
  const { STORAGE } = require("./storage");
  const { DistributedMap } = require("./broker/collections");
  const { getVolume } = require("./storage-volumes");
  const { reserveUpload, releaseUpload, renewUpload } = require("./storage-reservations");
  const { DurableOutbox } = require("./durable-outbox");

  defaultMover = createStorageMover({ storage: STORAGE, jobs: new DistributedMap("storage:migrations"), getVolume, reserve: reserveUpload, release: releaseUpload, renewReservation: renewUpload, queue: new DurableOutbox("storage-migrations") });
  return defaultMover;
}

module.exports = { createStorageMover, getDefaultStorageMover, checksum, checkedPath };
