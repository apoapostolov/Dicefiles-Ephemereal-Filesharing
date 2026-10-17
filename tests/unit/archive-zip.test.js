"use strict";

const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const JSZip = require("jszip");

jest.mock("../../lib/config", () => ({ get: key => key === "maxAssetsProcesses" ? 2 : false }));
const { listArchive, extractEntry } = require("../../lib/archive");

describe("real ZIP reader dependency contract", () => {
  let directory;
  let archivePath;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "hobbyfiles-zip-test-"));
    archivePath = path.join(directory, "sample.zip");
    const zip = new JSZip();
    zip.file("books/café.txt", "Unicode archive content");
    zip.file("manifest.json", JSON.stringify({ files: [] }));
    await fs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  });
  afterAll(async () => {
    await fs.unlink(archivePath);
    await fs.rmdir(directory);
  });
  test("lists and extracts UTF-8 entries with the installed yauzl", async () => {
    const listing = await listArchive(archivePath, "sample.zip");
    expect(listing.format).toBe("zip");
    expect(listing.files.some(entry => entry.path === "books/café.txt")).toBe(true);
    const bytes = await extractEntry(archivePath, "sample.zip", "books/café.txt");
    expect(bytes.toString()).toBe("Unicode archive content");
  });
  test("refuses paths outside the archive", async () => {
    await expect(extractEntry(archivePath, "sample.zip", "../private.txt")).rejects.toMatchObject({ status: 400 });
  });
});
