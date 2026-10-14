"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { tinyPdf } = require("../fixtures/tiny-pdf");

jest.mock("../../lib/config", () => ({ get: key => key === "nativeTools" ? true : key.startsWith("max") ? 2 : false }));
jest.mock("../../lib/observability", () => ({ setPreviewQueue: jest.fn(), trackPreviewFailure: jest.fn() }));
const { generateAssets } = require("../../lib/media/pipeline");

(process.platform === "linux" ? test : test.skip)("real Poppler output produces bounded PDF covers", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dice-pdf-"));
  const full = path.join(directory, "synthetic.pdf");
  const source = tinyPdf();
  try {
    await fs.writeFile(full, source);
    const assets = [];
    await generateAssets({ full, size: source.length, mime: "application/pdf", meta: { type: "PDF" }, addAssets: async values => assets.push(...values) });
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every(asset => asset.data.length < 4 * 1024 * 1024)).toBe(true);
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("PDF.js parses the same fixture with its actual worker", async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(tinyPdf()), useSystemFonts: true });
  try {
    expect((await task.promise).numPages).toBe(1);
  }
  finally {
    await task.destroy();
  }
});

(process.platform === "linux" ? test : test.skip)("the actual PDF fixture renders through firejail", async () => {
  const directory = await fs.mkdtemp(path.join(os.homedir(), "dicefiles-preview-fixture-"));
  const full = path.join(directory, "synthetic.pdf");
  try {
    await fs.writeFile(full, tinyPdf());
    const { spawnBounded, PROFILE } = require("../../lib/media/jail");

    const result = await spawnBounded(["firejail", "--quiet", `--profile=${PROFILE}`, `--private=${directory}`, "--", "pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-jpeg", "-scale-to", "2048", full], { maxBytes: 4 * 1024 * 1024, timeoutMs: 30000 });
    if (result.code !== 0) {
      throw new Error(`Firejail PDF fixture failed: ${result.stderr}`);
    }
    expect(result.code).toBe(0);
    expect(result.stdout.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
    expect(result.stdout.length).toBeGreaterThan(100);
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
