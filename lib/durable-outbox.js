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
    const result = Number(await this.command(...this.keys, "enqueue", Date.now(), job.id, JSON.stringify(job)));
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
  complete(job) {
    return this.command(...this.keys, "ack", Date.now(), job.id, job.owner);
  }
  renew(job) {
    return this.command(...this.keys, "renew", Date.now(), job.id, job.owner, this.leaseMs);
  }
  retry(job, delayMs) {
    const next = { ...job, attempt: job.attempt + 1, owner: null };
    return this.command(...this.keys, "retry", Date.now(), job.id, job.owner, JSON.stringify(next), Date.now() + delayMs);
  }
  deadLetter(job, error) {
    const record = { ...job, owner: null, failedAt: Date.now(), error: String(error.message || error).slice(0, 2048) };
    return this.command(...this.keys, "dead", Date.now(), job.id, job.owner, JSON.stringify(record));
  }
}

module.exports = { DurableOutbox };
