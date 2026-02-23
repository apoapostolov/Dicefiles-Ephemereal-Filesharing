"use strict";

/**
 * Unit tests for lib/archive.js
 *
 * Coverage:
 *   - detectFormat()   — magic-byte detection (mocked fs)
 *   - resolveFormat()  — magic bytes + extension fallback
 *   - isViewableArchive() — type and extension checks
 *   - extractEntry()   — path-traversal security rejection
 *   - listArchive()    — unsupported format rejection
 */

const path = require("path");

// ── detectFormat ──────────────────────────────────────────────────────────────

describe("detectFormat", () => {
  let detectFormat;
  let fsMock;

  beforeEach(() => {
    jest.resetModules();
    fsMock = {
      openSync: jest.fn().mockReturnValue(42),
      readSync: jest.fn(),
      closeSync: jest.fn(),
      // config.js loads at module init: return false so no file is read
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    };
    jest.doMock("fs", () => fsMock);
    // yauzl must also be available (not used in detectFormat but required at module level)
    jest.doMock("yauzl", () => ({}));
    ({ detectFormat } = require("../../lib/archive"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("detects ZIP magic bytes", () => {
    fsMock.readSync.mockImplementation((fd, buf) => {
      buf[0] = 0x50;
      buf[1] = 0x4b;
      buf[2] = 0x03;
      buf[3] = 0x04;
    });
    expect(detectFormat("/fake/file.zip")).toBe("zip");
  });

  test("detects RAR magic bytes", () => {
    fsMock.readSync.mockImplementation((fd, buf) => {
      buf[0] = 0x52;
      buf[1] = 0x61;
      buf[2] = 0x72;
      buf[3] = 0x21;
    });
    expect(detectFormat("/fake/archive.rar")).toBe("rar");
  });

  test("detects 7z magic bytes", () => {
    fsMock.readSync.mockImplementation((fd, buf) => {
      buf[0] = 0x37;
      buf[1] = 0x7a;
      buf[2] = 0xbc;
      buf[3] = 0xaf;
      buf[4] = 0x27;
      buf[5] = 0x1c;
    });
    expect(detectFormat("/fake/archive.7z")).toBe("7z");
  });

  test("returns null for unknown magic", () => {
    fsMock.readSync.mockImplementation((fd, buf) => {
      buf[0] = 0x25;
      buf[1] = 0x50;
      buf[2] = 0x44;
      buf[3] = 0x46; // %PDF
    });
    expect(detectFormat("/fake/doc.pdf")).toBeNull();
  });

  test("returns null when file cannot be opened", () => {
    fsMock.openSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(detectFormat("/nonexistent/path")).toBeNull();
  });
});

// ── resolveFormat ─────────────────────────────────────────────────────────────

describe("resolveFormat", () => {
  let resolveFormat;
  let fsMock;

  beforeEach(() => {
    jest.resetModules();
    fsMock = {
      openSync: jest.fn().mockReturnValue(42),
      readSync: jest.fn(),
      closeSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    };
    jest.doMock("fs", () => fsMock);
    jest.doMock("yauzl", () => ({}));
    ({ resolveFormat } = require("../../lib/archive"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function withMagic(type) {
    const byteMaps = {
      zip: [0x50, 0x4b, 0x03, 0x04],
      rar: [0x52, 0x61, 0x72, 0x21],
      "7z": [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    };
    const bytes = byteMaps[type] || [];
    fsMock.readSync.mockImplementation((fd, buf) => {
      bytes.forEach((b, i) => {
        buf[i] = b;
      });
    });
  }

  test("magic bytes win over extension", () => {
    withMagic("zip");
    // Extension says .rar but magic says ZIP
    expect(resolveFormat("/path/file", "looks-like.rar")).toBe("zip");
  });

  test("falls back to .tar.gz extension when no magic", () => {
    fsMock.readSync.mockImplementation(() => {}); // no magic match
    expect(resolveFormat("/path/file", "archive.tar.gz")).toBe("tar");
  });

  test("falls back to .tgz extension when no magic", () => {
    fsMock.readSync.mockImplementation(() => {});
    expect(resolveFormat("/path/file", "data.tgz")).toBe("tar");
  });

  test("falls back to .001 extension as rar", () => {
    fsMock.readSync.mockImplementation(() => {});
    expect(resolveFormat("/path/file", "part1.001")).toBe("rar");
  });

  test("falls back to .7z extension when no magic", () => {
    fsMock.readSync.mockImplementation(() => {});
    expect(resolveFormat("/path/file", "archive.7z")).toBe("7z");
  });

  test("returns null for unrecognised extension and no magic", () => {
    fsMock.readSync.mockImplementation(() => {});
    expect(resolveFormat("/path/file", "document.docx")).toBeNull();
  });
});

// ── isViewableArchive ─────────────────────────────────────────────────────────

describe("isViewableArchive", () => {
  let isViewableArchive;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock("fs", () => ({
      openSync: jest.fn(() => 1),
      readSync: jest.fn(),
      closeSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    }));
    jest.doMock("yauzl", () => ({}));
    ({ isViewableArchive } = require("../../lib/archive"));
  });

  test("returns true for up.type === 'archive'", () => {
    expect(isViewableArchive({ type: "archive", name: "file" })).toBe(true);
  });

  test("returns true for .zip extension via name", () => {
    expect(isViewableArchive({ type: "file", name: "photo-album.zip" })).toBe(
      true,
    );
  });

  test("returns true for .7z extension", () => {
    expect(isViewableArchive({ type: "file", name: "backup.7z" })).toBe(true);
  });

  test("returns true for .rar extension", () => {
    expect(isViewableArchive({ type: "file", name: "archive.rar" })).toBe(true);
  });

  test("returns true for .001 multi-part extension", () => {
    expect(isViewableArchive({ type: "file", name: "split.001" })).toBe(true);
  });

  test("returns true for .tar.gz extension", () => {
    expect(isViewableArchive({ type: "file", name: "src.tar.gz" })).toBe(true);
  });

  test("returns false for PDF (document type)", () => {
    expect(isViewableArchive({ type: "document", name: "book.pdf" })).toBe(
      false,
    );
  });

  test("returns false for image type without archive extension", () => {
    expect(isViewableArchive({ type: "image", name: "photo.jpg" })).toBe(false);
  });

  test("returns false for null/undefined name", () => {
    expect(isViewableArchive({ type: "file", name: null })).toBe(false);
    expect(isViewableArchive({ type: "file" })).toBe(false);
  });
});

// ── extractEntry — security ───────────────────────────────────────────────────

describe("extractEntry path-traversal security", () => {
  let extractEntry;
  let fsMock;

  beforeEach(() => {
    jest.resetModules();
    fsMock = {
      openSync: jest.fn().mockReturnValue(42),
      readSync: jest.fn().mockImplementation((fd, buf) => {
        // Report as ZIP so format resolves
        buf[0] = 0x50;
        buf[1] = 0x4b;
        buf[2] = 0x03;
        buf[3] = 0x04;
      }),
      closeSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    };
    jest.doMock("fs", () => fsMock);
    jest.doMock("yauzl", () => ({}));
    ({ extractEntry } = require("../../lib/archive"));
  });

  const rejected = [
    ["path with ..", "../etc/passwd"],
    ["absolute unix path", "/etc/passwd"],
    ["absolute windows path", "\\windows\\system32"],
    ["path starting with slash", "/foo/bar"],
    ["path with control char", "foo\x00bar"],
    ["path with null byte", "\x00"],
    ["path with double-dot inside", "sub/../../escape"],
  ];

  test.each(rejected)("rejects %s", async (_, badPath) => {
    await expect(
      extractEntry("/archive.zip", "archive.zip", badPath),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects empty string entry path", async () => {
    await expect(
      extractEntry("/archive.zip", "archive.zip", ""),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("rejects non-string entry path", async () => {
    await expect(
      extractEntry("/archive.zip", "archive.zip", null),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ── listArchive — unsupported format ─────────────────────────────────────────

describe("listArchive unsupported format", () => {
  let listArchive;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock("fs", () => ({
      openSync: jest.fn().mockReturnValue(42),
      // Return zeroes → no magic match, no ext match
      readSync: jest.fn(),
      closeSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    }));
    jest.doMock("yauzl", () => ({}));
    ({ listArchive } = require("../../lib/archive"));
  });

  test("throws 400 for unrecognised file", async () => {
    await expect(
      listArchive("/path/to/file.bin", "unknown.bin"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
