"use strict";

// bittorrent-tracker imports the unmaintained `ip` package solely for toString
// in its UDP server parser. Hobbyfiles does not run that server. Supply only the
// required formatting API; never import its vulnerable address classification.
function toString(value, offset = 0, length) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new TypeError("Expected an unsigned IPv4 integer");
    }
    return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255].join(".");
  }
  if (!ArrayBuffer.isView(value) || !Number.isInteger(offset) || offset < 0) {
    throw new TypeError("Expected address bytes");
  }
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  length ??= bytes.length - offset;
  if (![4, 16].includes(length) || offset + length > bytes.length) {
    throw new TypeError("Expected four or sixteen address bytes");
  }
  if (length === 4) {
    return [...bytes.subarray(offset, offset + length)].join(".");
  }
  return Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(offset + i * 2).toString(16)).join(":");
}

module.exports = { toString };
