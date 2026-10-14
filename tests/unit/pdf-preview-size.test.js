"use strict";

let mockRenderedPage;
jest.mock("../../lib/media/jail", () => ({ spawnBounded: async () => ({ code: 0, stdout: mockRenderedPage, truncated: false, timedOut: false }) }));
jest.mock("../../lib/config", () => ({ get: key => key.startsWith("max") ? 2 : false }));
jest.mock("../../lib/observability", () => ({ setPreviewQueue: jest.fn(), trackPreviewFailure: jest.fn() }));
const sharp = require("sharp");
const { generateAssets } = require("../../lib/media/pipeline");

test("small PDFs retain a cover even when it exceeds the source file size", async () => {
  mockRenderedPage = await sharp({ create: {
    width: 80, height: 60, channels: 3, background: { r: 80, g: 100, b: 150 },
  } }).png().toBuffer();
  const assets = [];
  await generateAssets({
    full: "synthetic-small.pdf", mime: "application/pdf", meta: { type: "PDF" }, size: 80,
    addAssets: async generated => assets.push(...generated),
  });
  expect(assets.length).toBeGreaterThan(0);
  expect(assets.some(asset => asset.data.length > 80)).toBe(true);
  expect(assets.every(asset => asset.data.length <= 4 * 1024 * 1024)).toBe(true);
});
