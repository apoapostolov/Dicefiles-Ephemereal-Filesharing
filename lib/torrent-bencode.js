"use strict";

// Bounded network-message codec. Binary dictionary keys (tracker info hashes)
// use latin1 so no bytes are lost through UTF-8 replacement characters.
function decode(buffer, { prefix = false, maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > maxBytes) {
    throw new Error("Metadata message exceeds its limit");
  }
  let offset = 0; let nodes = 0;

  function value(depth = 0) {
    if (++nodes > 20000 || depth > 24 || offset >= buffer.length) {
      throw new Error("Invalid metadata message");
    }
    const marker = buffer[offset++];
    if (marker === 105) {
      const end = buffer.indexOf(101, offset);
      const raw = buffer.subarray(offset, end).toString("ascii");
      if (end < 0 || !/^(0|-?[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        throw new Error("Invalid metadata integer");
      }
      offset = end + 1; return Number(raw);
    }
    if (marker === 108 || marker === 100) {
      const result = marker === 108 ? [] : Object.create(null);
      while (offset < buffer.length && buffer[offset] !== 101) {
        if (marker === 108) {
          result.push(value(depth + 1)); continue;
        }
        const key = value(depth + 1);
        if (!Buffer.isBuffer(key) || Object.hasOwn(result, key.toString("latin1"))) {
          throw new Error("Invalid metadata dictionary");
        }
        result[key.toString("latin1")] = value(depth + 1);
      }
      if (buffer[offset++] !== 101) {
        throw new Error("Incomplete metadata container");
      }
      return result;
    }
    offset--;
    const colon = buffer.indexOf(58, offset);
    const raw = buffer.subarray(offset, colon).toString("ascii");
    if (colon < 0 || colon - offset > 8 || !/^(0|[1-9]\d*)$/.test(raw)) {
      throw new Error("Invalid metadata string");
    }
    const length = Number(raw);
    offset = colon + 1;
    if (offset + length > buffer.length) {
      throw new Error("Incomplete metadata string");
    }
    const result = buffer.subarray(offset, offset + length);
    offset += length; return result;
  }

  const result = value();
  if (!prefix && offset !== buffer.length) {
    throw new Error("Trailing metadata bytes");
  }
  return { value: result, bytes: offset };
}

function encode(value) {
  if (Buffer.isBuffer(value) || typeof value === "string") {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([Buffer.from(`${data.length}:`), data]);
  }
  if (Number.isSafeInteger(value)) {
    return Buffer.from(`i${value}e`);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("l"), ...value.map(encode), Buffer.from("e")]);
  }
  if (value && typeof value === "object") {
    const entries = value instanceof Map ? [...value] : Object.entries(value);
    entries.sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return Buffer.concat([Buffer.from("d"), ...entries.flatMap(([key, item]) => [encode(key), encode(item)]), Buffer.from("e")]);
  }
  throw new Error("Unsupported metadata value");
}

module.exports = { decode, encode };
