"use strict";

/**
 * Archive listing and extraction helpers.
 *
 * Supported formats:
 *   ZIP  — yauzl (streaming fd-based reader)
 *   RAR  — spawn unrar (v7.00 at /usr/bin/unrar)
 *   7z   — spawn 7z  (p7zip-full at /usr/bin/7z)
 *   TAR  — spawn tar (GNU tar, auto-detects .tar, .tar.gz, .tgz, .tar.bz2)
 *   .001 — treated as multi-part RAR
 *
 * Security:
 *   - Path traversal is rejected before any extraction.
 *   - Single-entry extraction is capped at MAX_ENTRY_SIZE (50 MB).
 *   - Entry count is capped at MAX_ENTRIES (10 000).
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PromisePool } = require("./util");
const CONFIG = require("./config");

const wrap = PromisePool.wrapNew;

const UNRAR_BIN = "/usr/bin/unrar";
const P7ZIP_BIN = "/usr/bin/7z";

/** Maximum bytes extracted for a single file. */
const MAX_ENTRY_SIZE = 50 * 1024 * 1024;

/** Maximum number of entries returned by listArchive(). */
const MAX_ENTRIES = 10_000;

// ── Format detection ─────────────────────────────────────────────────────────

/**
 * Detect archive container format by reading the first 8 magic bytes.
 * Returns "zip", "rar", "7z", or null.
 */
function detectFormat(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return null;
  }
  const buf = Buffer.alloc(8);
  try {
    fs.readSync(fd, buf, 0, 8, 0);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
  // ZIP: PK\x03\x04
  if (
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    return "zip";
  }
  // RAR: Rar!\x1a\x07
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x61 &&
    buf[2] === 0x72 &&
    buf[3] === 0x21
  ) {
    return "rar";
  }
  // 7z: 7z\xBC\xAF\x27\x1C
  if (
    buf[0] === 0x37 &&
    buf[1] === 0x7a &&
    buf[2] === 0xbc &&
    buf[3] === 0xaf &&
    buf[4] === 0x27 &&
    buf[5] === 0x1c
  ) {
    return "7z";
  }
  return null;
}

/**
 * Determine which tool to use for the given upload.
 * @param {string} filePath  Absolute path to the stored file.
 * @param {string} uploadName  Original filename (for extension fallback).
 * @returns {"zip"|"rar"|"7z"|"tar"|null}
 */
function resolveFormat(filePath, uploadName) {
  const magic = detectFormat(filePath);
  if (magic) {
    return magic;
  }
  const name = (uploadName || filePath).toLowerCase();
  if (/\.(tar\.gz|tgz|tar\.bz2|tbz2?|tar\.xz|txz|tar)$/.test(name)) {
    return "tar";
  }
  if (/\.(rar|r\d{2}|001)$/.test(name)) {
    return "rar";
  }
  if (/\.7z$/.test(name)) {
    return "7z";
  }
  if (/\.zip$/.test(name)) {
    return "zip";
  }
  return null;
}

// ── Spawn helpers ─────────────────────────────────────────────────────────────

function spawnCollect(cmd, args) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("close", () => resolve(Buffer.concat(chunks)));
    proc.on("error", reject);
  });
}

function spawnStream(cmd, args) {
  return spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
}

// ── Archive listing ───────────────────────────────────────────────────────────

/** @returns {Promise<Array<{path:string, size:number, isDir:boolean}>>} */
function listZip(filePath) {
  return new Promise((resolve, reject) => {
    const yauzl = require("yauzl");
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        return reject(err);
      }
      const entries = [];
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const isDir = /\/$/.test(entry.fileName);
        entries.push({
          path: entry.fileName,
          size: isDir ? 0 : entry.uncompressedSize,
          isDir,
        });
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });
}

/** @returns {Promise<Array<{path:string, size:number, isDir:boolean}>>} */
async function listRar(filePath) {
  // "unrar l -p-" to list with sizes without password prompts
  const out = await spawnCollect(UNRAR_BIN, ["l", "-p-", filePath]);
  const text = out.toString("utf8");
  const lines = text.split(/\r?\n/);
  const entries = [];
  let inBody = false;

  for (const line of lines) {
    // Separator line separates header/footer from entry block
    if (/^-{5,}/.test(line.trim())) {
      if (!inBody) {
        inBody = true;
      } else {
        break;
      }
      continue;
    }
    if (!inBody || !line.trim()) {
      continue;
    }
    // RAR5 format: " .....     123456  9876  80% 2024-01-01 12:00 ABCDEF12  path"
    // Directories have "F" as first attr char.
    const m = line.match(
      /^\s*([A-Z.]{5})\s+(\d+)\s+\d+\s+\d+%\s+\S+\s+\S+\s+\S+\s+(.+)$/,
    );
    if (m) {
      const attrs = m[1];
      const size = parseInt(m[2], 10);
      const entryPath = m[3].trim().replace(/\\/g, "/");
      const isDir =
        attrs.charAt(0) === "F" ||
        entryPath.endsWith("/") ||
        entryPath.endsWith("\\");
      entries.push({ path: entryPath, size: isDir ? 0 : size, isDir });
    }
  }
  return entries;
}

/** @returns {Promise<Array<{path:string, size:number, isDir:boolean}>>} */
async function listSevenZ(filePath) {
  const out = await spawnCollect(P7ZIP_BIN, ["l", filePath]);
  const lines = out.toString("utf8").split(/\r?\n/);
  const entries = [];
  let inFiles = false;
  let pastFirstSep = false;

  for (const line of lines) {
    // "----" separator lines bound the entry table
    if (/^-{5,}/.test(line.trim())) {
      if (!pastFirstSep) {
        pastFirstSep = true;
        inFiles = true;
        continue;
      } else {
        break;
      }
    }
    if (!inFiles || !line.trim()) {
      continue;
    }
    // Format: "2024-01-01 00:00:00 .....       123456       100000  path"
    //    dirs: "2024-01-01 00:00:00 D....            0            0  path"
    const m = line.match(
      /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+([A-Z.]{5})\s+(\d+)\s+\d+\s{2}(.+)$/,
    );
    if (m) {
      const attrs = m[1];
      const size = parseInt(m[2], 10);
      const entryPath = m[3].trim().replace(/\\/g, "/");
      const isDir = attrs.charAt(0) === "D" || entryPath.endsWith("/");
      entries.push({ path: entryPath, size: isDir ? 0 : size, isDir });
    }
  }
  return entries;
}

/** @returns {Promise<Array<{path:string, size:number, isDir:boolean}>>} */
async function listTar(filePath) {
  // "tar tvf" lists with verbose info; GNU tar auto-detects compression
  const out = await spawnCollect("tar", ["tvf", filePath]);
  const text = out.toString("utf8");
  const lines = text.split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    // Format: "-rw-r--r-- user/group  123456 2024-01-01 00:00 path/to/file"
    const m = line.match(
      /^([dlrwxst-]{10})\s+\S+\s+(\d+)\s+\d{4}[-/]\d{2}[-/]\d{2}\s+\S+\s+(.+)$/,
    );
    if (m) {
      const perms = m[1];
      const size = parseInt(m[2], 10);
      const entryPath = m[3].trim().replace(/^\.\//, "");
      const isDir = perms.charAt(0) === "d";
      if (entryPath) {
        entries.push({ path: entryPath, size: isDir ? 0 : size, isDir });
      }
    }
  }
  return entries;
}

/**
 * List all entries in an archive.
 *
 * @param {string} filePath    Absolute path to the on-disk file.
 * @param {string} uploadName  Original filename (used for extension fallback).
 * @returns {Promise<{format:string, files:Array<{path:string,size:number,isDir:boolean}>}>}
 */
async function listArchive(filePath, uploadName) {
  const fmt = resolveFormat(filePath, uploadName);
  if (!fmt) {
    throw Object.assign(new Error("Unsupported archive format"), {
      status: 400,
    });
  }

  let entries;
  switch (fmt) {
    case "zip":
      entries = await listZip(filePath);
      break;
    case "rar":
      entries = await listRar(filePath);
      break;
    case "7z":
      entries = await listSevenZ(filePath);
      break;
    case "tar":
      entries = await listTar(filePath);
      break;
    default:
      throw Object.assign(new Error(`Unknown format: ${fmt}`), { status: 400 });
  }

  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }

  return { format: fmt, files: entries };
}

// ── Entry extraction ──────────────────────────────────────────────────────────

function extractZipEntry(filePath, entryPath) {
  return new Promise((resolve, reject) => {
    const yauzl = require("yauzl");
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: false },
      (err, zipfile) => {
        if (err) {
          return reject(err);
        }
        let found = false;
        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          if (entry.fileName === entryPath) {
            found = true;
            zipfile.openReadStream(entry, (err2, stream) => {
              if (err2) {
                zipfile.close();
                return reject(err2);
              }
              const chunks = [];
              stream.on("data", (c) => chunks.push(c));
              stream.on("end", () => {
                zipfile.close();
                resolve(Buffer.concat(chunks));
              });
              stream.on("error", (e) => {
                zipfile.close();
                reject(e);
              });
            });
          } else {
            zipfile.readEntry();
          }
        });
        zipfile.on("end", () => {
          zipfile.close();
          if (!found) {
            resolve(null);
          }
        });
        zipfile.on("error", (e) => {
          zipfile.close();
          reject(e);
        });
      },
    );
  });
}

function extractRarEntry(archivePath, entryPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawnStream(UNRAR_BIN, [
      "p",
      "-inul",
      "-p-",
      archivePath,
      entryPath,
    ]);
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("close", () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.length ? buf : null);
    });
    proc.on("error", reject);
  });
}

function extractSevenZEntry(archivePath, entryPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawnStream(P7ZIP_BIN, ["e", "-so", archivePath, entryPath]);
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("close", () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.length ? buf : null);
    });
    proc.on("error", reject);
  });
}

function extractTarEntry(archivePath, entryPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawnStream("tar", ["xOf", archivePath, entryPath]);
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("close", () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.length ? buf : null);
    });
    proc.on("error", reject);
  });
}

/**
 * Extract a single entry by path from an archive.
 *
 * @param {string} filePath   On-disk path to the archive.
 * @param {string} uploadName Original upload filename (for format detection).
 * @param {string} entryPath  Path within the archive exactly as returned by listArchive().
 * @returns {Promise<Buffer>}
 * @throws {{ status: number, message: string }} on invalid path, not found, or oversized entry.
 */
async function extractEntry(filePath, uploadName, entryPath) {
  // Security: reject any path containing traversal or absolute segments
  if (
    !entryPath ||
    typeof entryPath !== "string" ||
    entryPath.includes("..") ||
    entryPath.startsWith("/") ||
    entryPath.startsWith("\\") ||
    /[\x00-\x1f]/.test(entryPath)
  ) {
    throw Object.assign(new Error("Invalid entry path"), { status: 400 });
  }

  const fmt = resolveFormat(filePath, uploadName);
  if (!fmt) {
    throw Object.assign(new Error("Unsupported archive format"), {
      status: 400,
    });
  }

  let buf;
  switch (fmt) {
    case "zip":
      buf = await extractZipEntry(filePath, entryPath);
      break;
    case "rar":
      buf = await extractRarEntry(filePath, entryPath);
      break;
    case "7z":
      buf = await extractSevenZEntry(filePath, entryPath);
      break;
    case "tar":
      buf = await extractTarEntry(filePath, entryPath);
      break;
    default:
      throw Object.assign(new Error("Unsupported format"), { status: 400 });
  }

  if (!buf || !buf.length) {
    throw Object.assign(new Error("Entry not found"), { status: 404 });
  }
  if (buf.length > MAX_ENTRY_SIZE) {
    throw Object.assign(
      new Error(
        "Entry exceeds 50 MB limit — download the full archive instead",
      ),
      { status: 413 },
    );
  }

  return buf;
}

/**
 * Quick check: is the given upload an archive that the viewer can handle?
 * Accepts by stored upload.type, meta.type, or filename extension.
 */
function isViewableArchive(up) {
  if (!up) {
    return false;
  }
  if (up.type === "archive") {
    return true;
  }
  const name = (up.name || "").toLowerCase();
  return /\.(zip|rar|7z|001|r\d{2}|tar|tar\.gz|tgz|tar\.bz2|tbz2?)$/.test(name);
}

/**
 * Index an archive's contents and store the count + extension sample in
 * storage.meta.  Called once after upload completes for type=archive files.
 *
 * Writes:
 *   storage.meta.archive_count       — total non-directory entry count (string)
 *   storage.meta.archive_ext_sample  — comma-separated list of up to 3 unique
 *                                      lowercase extensions found inside, e.g. "jpg,png,txt"
 *
 * Calls storage.addAssets([]) to persist the meta change.
 *
 * @param {import('./storage').StorageLocation} storage
 */
async function indexArchive(storage) {
  try {
    const listing = await listArchive(storage.full, storage.name || "");
    const files = (listing.files || []).filter((f) => !f.isDir);
    storage.meta.archive_count = String(files.length);

    // Collect up to 3 unique non-empty extensions (stripped of leading dot)
    const extSet = new Set();
    for (const f of files) {
      const ext = path.extname(f.path).toLowerCase().replace(/^\./, "");
      if (ext && ext.length <= 8) {
        extSet.add(ext);
      }
      if (extSet.size >= 3) {
        break;
      }
    }
    storage.meta.archive_ext_sample = Array.from(extSet).join(",");
    await storage.addAssets([]);
  } catch (ex) {
    if (ex.status !== 400) {
      // 400 = not a recognised archive format — expected occasionally, skip
      console.warn("indexArchive failed:", ex.message || ex);
    }
  }
}

module.exports = {
  listArchive,
  extractEntry: wrap(CONFIG.get("maxAssetsProcesses"), null, extractEntry),
  indexArchive,
  detectFormat,
  resolveFormat,
  isViewableArchive,
  MAX_ENTRY_SIZE,
};
