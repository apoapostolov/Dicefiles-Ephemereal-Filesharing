"use strict";

const { readBoundedJson } = require("../../lib/bounded-json");

test("bounds declared and chunked JSON before buffering", async () => {
  await expect(readBoundedJson(new Response("{}", { headers: { "content-length": "1000" } }), 10)).rejects.toThrow(/byte limit/);
  const cancelled = jest.fn();
  const body = new ReadableStream({ pull(c) {
    c.enqueue(Buffer.alloc(8, 32));
  }, cancel: cancelled }, { highWaterMark: 0 });
  await expect(readBoundedJson(new Response(body), 10)).rejects.toThrow(/byte limit/);
  expect(cancelled).toHaveBeenCalled();
});
