"use strict";

/**
 * Incremental keyspace scan.
 *
 * `KEYS` walks the whole keyspace inside one command, which blocks the
 * single-threaded Redis server for the duration. A request that calls it stalls
 * every other caller, so a growing instance pays for one lookup. `SCAN`
 * returns a bounded slice per round trip and never blocks, at the cost of
 * possibly repeating or missing keys that move during the walk. For the
 * listings that use it here, a rare duplicate is cheaper than a stall.
 */

const BROKER = require("./broker");

/** Keys requested per round trip. */
const DEFAULT_COUNT = 500;

/**
 * Collect every key matching a pattern, incrementally.
 * @param {string} pattern glob pattern, for example `rooms:*`
 * @param {object} [opts]
 * @param {number} [opts.count] keys requested per round trip
 * @param {number} [opts.max] stop after this many keys
 * @returns {Promise<string[]>}
 */
async function scanKeys(pattern, opts = {}) {
  const count = opts.count > 0 ? opts.count : DEFAULT_COUNT;
  const max = opts.max > 0 ? opts.max : Infinity;
  const { scan } = BROKER.getMethods("scan");
  const keys = [];
  let cursor = "0";
  do {
    const page = await scan(cursor, { MATCH: pattern, COUNT: count });
    const next = page[0];
    const batch = page[1] || [];
    cursor = typeof next === "string" ? next : String(next);
    for (const key of batch) {
      keys.push(key);
      if (keys.length >= max) {
        return keys;
      }
    }
  } while (cursor !== "0");
  return keys;
}

module.exports = {
  scanKeys,
  DEFAULT_COUNT,
};
