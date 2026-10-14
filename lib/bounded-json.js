"use strict";

async function readBoundedJson(response, maxBytes = 4 * 1024 * 1024) {
  if (!response.body) {
    const value = await response.json();
    if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
      throw new Error("JSON response exceeded its byte limit");
    }
    return value;
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body.cancel();
    throw new Error("JSON response exceeded its byte limit");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("JSON response exceeded its byte limit");
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  }
  finally {
    reader.releaseLock();
  }
}

module.exports = { readBoundedJson };
