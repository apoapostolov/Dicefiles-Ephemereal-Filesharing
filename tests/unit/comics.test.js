"use strict";

/**
 * tests/unit/comics.test.js
 *
 * Unit + integration tests for comic-archive support in lib/meta.js.
 *
 * Covers:
 *   - parseComicInfoXml       — XML metadata extraction
 *   - detectComicContainer    — magic-byte ZIP vs RAR detection
 *   - zipReadComicInfo        — ComicInfo.xml extraction from a JSZip object
 *   - generateAssets (CBZ)    — end-to-end with a real on-disk ZIP archive
 *   - generateAssets (CBR)    — end-to-end with mocked RAR helpers
 *   - extractComicPage (ZIP)  — page extraction + JPEG transcoding
 *   - extractComicPage (RAR)  — with mocked helpers
 *   - ensureComicAssets       — skip-if-indexed, run-if-missing
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const JSZip = require("jszip");
const sharp = require("sharp");

const meta = require("../../lib/meta");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid PNG buffer via sharp (50×50 = ~178 bytes, safely > 100). */
async function makeTinyPng() {
  return sharp({
    create: { width: 50, height: 50, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
}

/** Build an in-memory CBZ with two pages and an optional ComicInfo.xml. */
async function buildCbzBuffer({ withComicInfo = true } = {}) {
  const zip = new JSZip();
  const imgBuf = await makeTinyPng();
  zip.file("0001.png", imgBuf);
  zip.file("0002.png", imgBuf);
  if (withComicInfo) {
    const ci =
      `<?xml version="1.0"?>\n<ComicInfo>\n` +
      `  <Title>Test Comic</Title>\n` +
      `  <PageCount>2</PageCount>\n` +
      `  <Page Image="1" Type="FrontCover" />\n` +
      `</ComicInfo>`;
    zip.file("ComicInfo.xml", ci);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dice-comic-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseComicInfoXml
// ---------------------------------------------------------------------------

describe("parseComicInfoXml", () => {
  test("extracts standard metadata fields", () => {
    const xml = `<?xml version="1.0"?>
<ComicInfo>
  <Title>Test Title</Title>
  <Series>My Series</Series>
  <Number>42</Number>
  <Year>2025</Year>
  <Publisher>Publisher Inc</Publisher>
  <Writer>Jane Author</Writer>
  <PageCount>12</PageCount>
</ComicInfo>`;
    const r = meta.parseComicInfoXml(xml);
    expect(r.title).toBe("Test Title");
    expect(r.series).toBe("My Series");
    expect(r.number).toBe("42");
    expect(r.year).toBe("2025");
    expect(r.publisher).toBe("Publisher Inc");
    expect(r.writer).toBe("Jane Author");
    expect(r.pagecount).toBe("12");
  });

  test("extracts frontCoverImageIdx from Page element", () => {
    const xml = `<ComicInfo>
  <Page Image="0" />
  <Page Image="1" Type="FrontCover" />
  <Page Image="2" />
</ComicInfo>`;
    const r = meta.parseComicInfoXml(xml);
    expect(r.frontCoverImageIdx).toBe(1);
  });

  test("returns null frontCoverImageIdx when no FrontCover page exists", () => {
    const xml = `<ComicInfo><Title>No Cover</Title></ComicInfo>`;
    const r = meta.parseComicInfoXml(xml);
    expect(r.frontCoverImageIdx).toBeNull();
    expect(r.title).toBe("No Cover");
  });

  test("handles empty XML gracefully", () => {
    const r = meta.parseComicInfoXml("<ComicInfo />");
    expect(r.title).toBeUndefined();
    expect(r.frontCoverImageIdx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectComicContainer
// ---------------------------------------------------------------------------

describe("detectComicContainer", () => {
  test("detects ZIP by magic bytes (50 4B 03 04)", () => {
    const f = path.join(tmpDir, `zip-${Date.now()}.bin`);
    fs.writeFileSync(f, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
    expect(meta.detectComicContainer(f)).toBe("zip");
  });

  test("detects RAR by magic bytes (52 61 72 21)", () => {
    const f = path.join(tmpDir, `rar-${Date.now()}.bin`);
    fs.writeFileSync(f, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));
    expect(meta.detectComicContainer(f)).toBe("rar");
  });

  test("detects 7z by magic bytes (37 7A BC AF 27 1C)", () => {
    const f = path.join(tmpDir, `7z-${Date.now()}.bin`);
    fs.writeFileSync(
      f,
      Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x00]),
    );
    expect(meta.detectComicContainer(f)).toBe("7z");
  });

  test("returns null for unknown file", () => {
    const f = path.join(tmpDir, `unk-${Date.now()}.bin`);
    fs.writeFileSync(f, Buffer.from([0x00, 0x00, 0x00, 0x00]));
    expect(meta.detectComicContainer(f)).toBeNull();
  });

  test("returns null for nonexistent file", () => {
    expect(meta.detectComicContainer("/nonexistent/path.bin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// zipReadComicInfo
// ---------------------------------------------------------------------------

describe("zipReadComicInfo", () => {
  test("returns ComicInfo.xml string when present in archive", async () => {
    const zip = new JSZip();
    const xmlContent = `<ComicInfo><Title>Zip Title</Title></ComicInfo>`;
    zip.file("ComicInfo.xml", xmlContent);
    zip.file("images/001.jpg", "dummy");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const loadedZip = await JSZip.loadAsync(buf);
    const result = await meta.zipReadComicInfo(loadedZip);
    expect(result).toBe(xmlContent);
  });

  test("returns null when ComicInfo.xml is absent", async () => {
    const zip = new JSZip();
    zip.file("page1.jpg", "dummy");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const loadedZip = await JSZip.loadAsync(buf);
    const result = await meta.zipReadComicInfo(loadedZip);
    expect(result).toBeNull();
  });

  test("handles nested ComicInfo.xml path", async () => {
    const zip = new JSZip();
    const xmlContent = `<ComicInfo><Title>Nested</Title></ComicInfo>`;
    zip.file("subdir/ComicInfo.xml", xmlContent);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const loadedZip = await JSZip.loadAsync(buf);
    const result = await meta.zipReadComicInfo(loadedZip);
    expect(result).toBe(xmlContent);
  });
});

// ---------------------------------------------------------------------------
// generateAssets — CBZ (end-to-end with real file)
// ---------------------------------------------------------------------------

describe("generateAssets — CBZ", () => {
  test("produces page index, count, and cover asset", async () => {
    const cbzPath = path.join(tmpDir, `test-${Date.now()}.cbz`);
    const buf = await buildCbzBuffer({ withComicInfo: true });
    fs.writeFileSync(cbzPath, buf);

    const storage = {
      full: cbzPath,
      mime: "application/zip",
      meta: { type: "CBZ" },
      tags: {},
      addAssets: jest.fn(),
    };

    await meta.generateAssets(storage);

    expect(storage.meta.pages).toBe("2");
    expect(storage.meta.comic_index).toMatch(/0001\.png/);
    expect(storage.meta.comic_title).toBe("Test Comic");
    // ComicInfo says FrontCover is Image="1" (0-indexed → page index 1)
    expect(storage.meta.comic_cover_idx).toBe("1");
    expect(storage.addAssets).toHaveBeenCalledTimes(1);

    const [assets] = storage.addAssets.mock.calls[0];
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBe(1);
    expect(assets[0].ext).toBe(".cover.jpg");
    expect(assets[0].mime).toBe("image/jpeg");
    expect(Buffer.isBuffer(assets[0].data)).toBe(true);
  });

  test("works without ComicInfo.xml (no crash, index still populated)", async () => {
    const cbzPath = path.join(tmpDir, `noci-${Date.now()}.cbz`);
    const buf = await buildCbzBuffer({ withComicInfo: false });
    fs.writeFileSync(cbzPath, buf);

    const storage = {
      full: cbzPath,
      mime: "application/zip",
      meta: { type: "CBZ" },
      tags: {},
      addAssets: jest.fn(),
    };
    await meta.generateAssets(storage);

    expect(storage.meta.pages).toBe("2");
    expect(storage.meta.comic_index).toBeTruthy();
    expect(storage.meta.comic_title).toBeUndefined();
    expect(storage.addAssets).toHaveBeenCalled();
  });

  test("addAssets receives empty array when archive has no images", async () => {
    const cbzPath = path.join(tmpDir, `empty-${Date.now()}.cbz`);
    const zip = new JSZip();
    zip.file("readme.txt", "no images");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync(cbzPath, buf);

    const storage = {
      full: cbzPath,
      mime: "application/zip",
      meta: { type: "CBZ" },
      tags: {},
      addAssets: jest.fn(),
    };
    await meta.generateAssets(storage);

    expect(storage.addAssets).toHaveBeenCalledWith([]);
  });
});

// ---------------------------------------------------------------------------
// generateAssets — CBR (mocked RAR helpers via module.exports)
// ---------------------------------------------------------------------------

describe("generateAssets — CBR", () => {
  test("produces page index, count, title, and cover asset using mocked helpers", async () => {
    const tmpRar = path.join(tmpDir, `test-${Date.now()}.rar`);
    // Write RAR magic so detectComicContainer returns "rar"
    fs.writeFileSync(tmpRar, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));

    const dummyImg = await makeTinyPng();

    jest
      .spyOn(meta, "rarListImages")
      .mockResolvedValue(["cover.png", "page2.png"]);
    jest
      .spyOn(meta, "rarReadComicInfo")
      .mockResolvedValue(
        `<?xml version="1.0"?><ComicInfo><Title>RAR Comic</Title></ComicInfo>`,
      );
    jest.spyOn(meta, "rarExtractFile").mockResolvedValue(dummyImg);

    const storage = {
      full: tmpRar,
      mime: "application/octet-stream",
      meta: { type: "CBR" },
      tags: {},
      addAssets: jest.fn(),
    };

    await meta.generateAssets(storage);

    expect(meta.rarListImages).toHaveBeenCalledWith(tmpRar);
    expect(meta.rarReadComicInfo).toHaveBeenCalledWith(tmpRar);
    expect(storage.meta.pages).toBe("2");
    expect(storage.meta.comic_index).toBe("cover.png\npage2.png");
    expect(storage.meta.comic_title).toBe("RAR Comic");
    expect(storage.addAssets).toHaveBeenCalled();
    const [assets] = storage.addAssets.mock.calls[0];
    expect(assets.length).toBe(1);
    expect(assets[0].ext).toBe(".cover.jpg");
  });

  test("returns early and calls addAssets([]) when rarListImages returns empty list", async () => {
    const tmpRar = path.join(tmpDir, `empty-${Date.now()}.rar`);
    fs.writeFileSync(tmpRar, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));

    jest.spyOn(meta, "rarListImages").mockResolvedValue([]);
    jest.spyOn(meta, "rarReadComicInfo").mockResolvedValue(null);

    const storage = {
      full: tmpRar,
      mime: "application/octet-stream",
      meta: { type: "CBR" },
      tags: {},
      addAssets: jest.fn(),
    };

    await meta.generateAssets(storage);

    expect(storage.addAssets).toHaveBeenCalledWith([]);
  });
});

// ---------------------------------------------------------------------------
// generateAssets — CB7 (mocked 7z helpers via module.exports)
// ---------------------------------------------------------------------------

describe("generateAssets — CB7", () => {
  test("produces page index, count, title, and cover asset using mocked helpers", async () => {
    const tmp7z = path.join(tmpDir, `test-${Date.now()}.7z`);
    // Write 7z magic so detectComicContainer returns "7z"
    fs.writeFileSync(tmp7z, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));

    const dummyImg = await makeTinyPng();

    jest
      .spyOn(meta, "sevenZListImages")
      .mockResolvedValue(["cover.png", "page2.png"]);
    jest
      .spyOn(meta, "sevenZReadComicInfo")
      .mockResolvedValue(
        `<?xml version="1.0"?><ComicInfo><Title>7z Comic</Title></ComicInfo>`,
      );
    jest.spyOn(meta, "sevenZExtractFile").mockResolvedValue(dummyImg);

    const storage = {
      full: tmp7z,
      mime: "application/octet-stream",
      meta: { type: "CB7" },
      tags: {},
      addAssets: jest.fn(),
    };

    await meta.generateAssets(storage);

    expect(meta.sevenZListImages).toHaveBeenCalledWith(tmp7z);
    expect(meta.sevenZReadComicInfo).toHaveBeenCalledWith(tmp7z);
    expect(storage.meta.pages).toBe("2");
    expect(storage.meta.comic_index).toBe("cover.png\npage2.png");
    expect(storage.meta.comic_title).toBe("7z Comic");
    expect(storage.addAssets).toHaveBeenCalled();
    const [assets] = storage.addAssets.mock.calls[0];
    expect(assets.length).toBe(1);
    expect(assets[0].ext).toBe(".cover.jpg");
  });

  test("returns early and calls addAssets([]) when 7zListImages returns empty list", async () => {
    const tmp7z = path.join(tmpDir, `empty-${Date.now()}.7z`);
    fs.writeFileSync(tmp7z, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));

    jest.spyOn(meta, "sevenZListImages").mockResolvedValue([]);
    jest.spyOn(meta, "sevenZReadComicInfo").mockResolvedValue(null);

    const storage = {
      full: tmp7z,
      mime: "application/octet-stream",
      meta: { type: "CB7" },
      tags: {},
      addAssets: jest.fn(),
    };

    await meta.generateAssets(storage);

    expect(storage.addAssets).toHaveBeenCalledWith([]);
  });
});

describe("extractComicPage — ZIP", () => {
  test("returns a JPEG buffer for a valid page index", async () => {
    const cbzPath = path.join(tmpDir, `extract-${Date.now()}.cbz`);
    const buf = await buildCbzBuffer({ withComicInfo: false });
    fs.writeFileSync(cbzPath, buf);

    // First build the index via generateAssets
    const storage = {
      full: cbzPath,
      mime: "application/zip",
      meta: { type: "CBZ" },
      tags: {},
      addAssets: jest.fn(),
    };
    await meta.generateAssets(storage);

    const page = await meta.extractComicPage(storage, 0);
    expect(Buffer.isBuffer(page)).toBe(true);
    expect(page.length).toBeGreaterThan(0);
  });

  test("returns null for out-of-range page index", async () => {
    const cbzPath = path.join(tmpDir, `oob-${Date.now()}.cbz`);
    const buf = await buildCbzBuffer({ withComicInfo: false });
    fs.writeFileSync(cbzPath, buf);

    const storage = {
      full: cbzPath,
      mime: "application/zip",
      meta: { type: "CBZ" },
      tags: {},
      addAssets: jest.fn(),
    };
    await meta.generateAssets(storage);

    const page = await meta.extractComicPage(storage, 999);
    expect(page).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractComicPage — RAR (mocked helpers)
// ---------------------------------------------------------------------------

describe("extractComicPage — RAR", () => {
  test("returns JPEG buffer when helpers return valid data", async () => {
    const tmpRar = path.join(tmpDir, `page-${Date.now()}.rar`);
    fs.writeFileSync(tmpRar, Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));
    const dummyImg = await makeTinyPng();

    // Simulate a pre-indexed storage (as if generateAssets already ran)
    const storage = {
      full: tmpRar,
      mime: "application/octet-stream",
      meta: { type: "CBR", comic_index: "cover.png\npage2.png" },
      tags: {},
      addAssets: jest.fn(),
    };

    jest.spyOn(meta, "rarExtractFile").mockResolvedValue(dummyImg);

    const page = await meta.extractComicPage(storage, 0);
    expect(meta.rarExtractFile).toHaveBeenCalledWith(tmpRar, "cover.png");
    expect(Buffer.isBuffer(page)).toBe(true);
    expect(page.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractComicPage — 7z (mocked helpers)
// ---------------------------------------------------------------------------

describe("extractComicPage — 7z", () => {
  test("returns JPEG buffer when helpers return valid data", async () => {
    const tmp7z = path.join(tmpDir, `page-${Date.now()}.7z`);
    fs.writeFileSync(tmp7z, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
    const dummyImg = await makeTinyPng();

    // Simulate a pre-indexed storage (as if generateAssets already ran)
    const storage = {
      full: tmp7z,
      mime: "application/octet-stream",
      meta: { type: "CB7", comic_index: "cover.png\npage2.png" },
      tags: {},
      addAssets: jest.fn(),
    };

    jest.spyOn(meta, "sevenZExtractFile").mockResolvedValue(dummyImg);

    const page = await meta.extractComicPage(storage, 0);
    expect(meta.sevenZExtractFile).toHaveBeenCalledWith(tmp7z, "cover.png");
    expect(Buffer.isBuffer(page)).toBe(true);
    expect(page.length).toBeGreaterThan(0);
  });
});

describe("ensureComicAssets", () => {
  test("skips asset generation when comic_index already exists", async () => {
    const storage = {
      full: "/nonexistent/path.cbz",
      mime: "application/zip",
      meta: { type: "CBZ", comic_index: "page1.png\npage2.png" },
      tags: {},
      addAssets: jest.fn(),
    };

    // When comic_index is already set the function returns early;
    // addAssets should never be invoked.
    await meta.ensureComicAssets(storage);
    expect(storage.addAssets).not.toHaveBeenCalled();
  });

  test("runs asset generation when comic_index is absent", async () => {
    const cbzPath = path.join(tmpDir, `ensure-${Date.now()}.cbz`);
    const buf = await buildCbzBuffer({ withComicInfo: false });
    fs.writeFileSync(cbzPath, buf);

    const storage = {
      full: cbzPath,
      mime: "application/zip",
      meta: { type: "CBZ" },
      tags: {},
      addAssets: jest.fn(),
    };

    await meta.ensureComicAssets(storage);

    // After ensureComicAssets, the index should be populated
    expect(storage.meta.comic_index).toBeTruthy();
    expect(storage.meta.pages).toBe("2");
  });
});
