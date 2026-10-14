"use strict";

const { searchGiphy } = require("../../lib/giphy");

test("proxy exposes only safe image URLs and pagination", async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ data: [
    { images: { fixed_width: { url: "https://media.giphy.com/a.gif" }, original: { url: "https://i.giphy.com/b.gif" } } },
    { images: { fixed_width: { url: "https://evil.test/a" }, original: { url: "javascript:alert(1)" } } },
  ] })));
  const result = await searchGiphy(new Map([["giphyApiKey", "private-test-value"]]), "dice", 0, fetcher);
  expect(result.results).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("private-test-value");
  expect(fetcher.mock.calls[0][2]).toMatchObject({ timeoutMs: 8000, maxRedirects: 0 });
});
