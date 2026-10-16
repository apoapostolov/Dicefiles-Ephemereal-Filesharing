"use strict";

const { randomUUID } = require("crypto");

/** Leased jobs stay scheduled until acknowledgement, including across restarts. */
class DurableOutbox {
  constructor(name, { broker, leaseMs = 125000 } = {}) {
    this.command = (...args) => (broker || require("./broker")).getMethod("outbox")(...args);
    const prefix = `outbox:{${name}}`;
    this.keys = ["jobs", "due", "dead", "seen", "deadjobs", "bytes"].map(k => `${prefix}:${k}`);
    this.leaseMs = leaseMs;
  }
  async enqueue(job) {
    const result = Number(await this.command(...this.keys, "enqueue", Date.now(), job.id, JSON.stringify(job), job.dueAt || Date.now()));
    if (result < 0) {
      throw new Error("Outbox capacity exceeded");
    }
    return result === 1;
  }
  async claim() {
    const raw = await this.command(...this.keys, "claim", Date.now(), "", randomUUID(), this.leaseMs);
    if (!raw) {
      return null;
    }
    const leased = JSON.parse(raw);
    return { ...JSON.parse(leased.value), owner: leased.owner };
  }
  complete(job, result) {
    if (result !== undefined) {
      const { owner, ...record } = job;
      return this.command(...this.keys, "finish", Date.now(), job.id, owner, JSON.stringify({ ...record, status: "completed", finishedAt: Date.now(), result }));
    }
    return this.command(...this.keys, "ack", Date.now(), job.id, job.owner);
  }
  renew(job) {
    return this.command(...this.keys, "renew", Date.now(), job.id, job.owner, this.leaseMs);
  }
  retry(job, delayMs, { increment = true } = {}) {
    const dueAt = Date.now() + delayMs;
    const next = { ...job, attempt: job.attempt + (increment ? 1 : 0), owner: null, dueAt };
    return this.command(...this.keys, "retry", Date.now(), job.id, job.owner, JSON.stringify(next), dueAt);
  }
  deadLetter(job, error) {
    const record = { ...job, owner: null, status: "failed", failedAt: Date.now(), error: String(error.message || error).slice(0, 2048) };
    return this.command(...this.keys, "dead", Date.now(), job.id, job.owner, JSON.stringify(record));
  }
  async get(id) {
    const raw = await this.command(...this.keys, "get", Date.now(), id, "");
    if (!raw) {
      return null;
    }
    const record = JSON.parse(raw);
    return record.value ? { ...JSON.parse(record.value), status: record.owner ? "running" : "queued" } : record;
  }
  async list(options = {}) {
    return JSON.parse(await this.command(...this.keys, "list", Date.now(), "", JSON.stringify(options)));
  }
  cancel(id) {
    return this.command(...this.keys, "cancel", Date.now(), id, "");
  }
  replay(job) {
    return this.command(...this.keys, "replay", Date.now(), job.id, JSON.stringify(job));
  }
}

module.exports = { DurableOutbox };
