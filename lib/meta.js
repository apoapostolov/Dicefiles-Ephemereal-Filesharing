"use strict";

const fs = require("fs");

const fsPromises = fs.promises;
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const XRegExp = require("xregexp");
const { PromisePool } = require("./util");
const sharp = require("sharp");
const CONFIG = require("./config");
const OBS = require("./observability");

let gm;

try {
  const gmlib = require("gm");
  const gmInstalled =
    spawnSync("gm", ["version"], { stdio: "ignore" }).status === 0;
  gm = gmInstalled ? gmlib : gmlib.subClass({ imageMagick: true });
} catch (er) {
  gm = null;
}

const JAIL = CONFIG.get("jail");
if (!JAIL) {
  console.warn("Not jailing");
}
const EXIFTOOL = CONFIG.get("exiftool");
const FILETOOL = CONFIG.get("filetool");
const FFMPEG = CONFIG.get("ffmpeg");

const PROFILE = path.join(__dirname, "..", "jail.profile");
const PIXEL_LIMIT = Math.pow(8000, 2);

const wrap = PromisePool.wrapNew;

const SHARP_DIMENSIONS = [
  [3840, 2160],
  [2560, 1440],
  [800, 1800],
  [400, 400],
];

const DOC_TYPES = Object.freeze(
  new Set([
    "DOC",
    "DOCX",
    "PDF",
    "RTF",
    "XLS",
    "XLSX",
    "PPT",
    "PPTX",
    "EPUB",
    "MOBI",
    "AZW",
    "AZW3",
  ]),
);

const ARCHIVE_TYPES = Object.freeze(new Set(["ZIP", "GZIP", "BZ2", "RAR"]));

/**
 * Comic book archive types (ZIP/RAR/TAR with specific extension).
 * Detection is extension-based: exiftool reports the container format ("ZIP"),
 * not the comic sub-format ("CBZ"). We override rv.meta.type after exiftool.
 */
const COMIC_TYPES = Object.freeze(new Set(["CBZ", "CBR", "CBT"]));

/** Image file extensions accepted as comic pages. */
const COMIC_IMAGE_EXTS = Object.freeze(
  new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp"]),
);

const FALLBACK_TYPEMAP = Object.freeze(
  new Map([
    [".7z", "archive"],
    [".xz", "archive"],
    [".lz", "archive"],
    [".ace", "archive"],
    [".tex", "document"],
  ]),
);

const SHARP_OPTIONS = {
  jpeg: { force: true, quality: 70 },
  png: { force: true },
};

const RE_SANI = new XRegExp("\\p{C}+", "g");

function stripHtmlAndMarkdown(input) {
  if (!input) {
    return "";
  }
  let out = input.toString();

  // Drop HTML tags entirely.
  out = out.replace(/<[^>]*>/g, " ");

  // Markdown links/images: keep label text, drop URL.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Inline code and fenced code markers.
  out = out.replace(/```+/g, " ");
  out = out.replace(/`([^`]*)`/g, "$1");

  // Emphasis/heading/quote/list markers.
  out = out.replace(/(^|\s)[*_~#>]+(?=\S)/g, "$1");
  out = out.replace(/^\s*[-+*]\s+/gm, "");

  return out;
}

const SUGGESTION_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "that",
  "this",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "will",
  "would",
  "could",
  "should",
  "can",
  "not",
  "but",
  "all",
  "any",
  "its",
  "it's",
  "pdf",
  "book",
  "edition",
  "vol",
  "volume",
  "part",
  "file",
  "new",
]);

function extractSuggestedTags(...values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (!value) {
      continue;
    }
    const clean = stripHtmlAndMarkdown(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ");
    for (const token of clean.split(/\s+/)) {
      if (!token || token.length < 3 || token.length > 24) {
        continue;
      }
      if (SUGGESTION_STOPWORDS.has(token)) {
        continue;
      }
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      out.push(token);
      if (out.length >= 8) {
        return out;
      }
    }
  }
  return out;
}

function extractPageCount(meta) {
  const candidates = [
    meta.PageCount,
    meta.NumberOfPages,
    meta.Pages,
    meta.Page_Count,
    meta["Page Count"],
    meta["Number Of Pages"],
    meta.PDFPageCount,
  ];
  for (const v of candidates) {
    if (v === null || v === undefined) {
      continue;
    }
    const m = v.toString().match(/\d{1,6}/);
    if (!m) {
      continue;
    }
    return m[0];
  }
  for (const [k, v] of Object.entries(meta)) {
    if (!/page/i.test(k) || !/count|pages?/i.test(k)) {
      continue;
    }
    const m = (v || "").toString().match(/\d{1,6}/);
    if (m) {
      return m[0];
    }
  }
  return "";
}

async function runcmd(cmdargs, encoding) {
  let cmd = cmdargs.shift();
  cmd = spawn(cmd, cmdargs, {
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await new Promise((resolve, reject) => {
    let out;
    let err;
    if (encoding) {
      out = "";
      err = "";
      cmd.stdout.on("data", (d) => (out += d));
      cmd.stderr.on("data", (d) => (err += d));
    } else {
      out = [];
      err = [];
      cmd.stdout.on("data", (d) => out.push(d));
      cmd.stderr.on("data", (d) => err.push(d));
    }
    cmd.on("error", reject);
    cmd.on("exit", (code, signal) => {
      if (code || signal) {
        reject(code || signal);
        return;
      }
      if (!encoding) {
        out = Buffer.concat(out);
        err = Buffer.concat(err);
      }
      resolve([out, err]);
    });
  });
}

async function generateAssetsPdf(storage) {
  const assets = [];
  const known = new Set();
  const prev = await (async () => {
    const fromPath = () =>
      new Promise((resolve, reject) => {
        gm(`${storage.full}[0]`)
          .density(120, 120)
          .toBuffer("jpg", function (err, res) {
            if (err) {
              reject(err);
              return;
            }
            resolve(res);
          });
      });
    const fromBuffer = async () => {
      const pdfBuffer = await fsPromises.readFile(storage.full);
      return await new Promise((resolve, reject) => {
        gm(pdfBuffer, "input.pdf")
          .selectFrame(0)
          .density(120, 120)
          .toBuffer("jpg", function (err, res) {
            if (err) {
              reject(err);
              return;
            }
            resolve(res);
          });
      });
    };
    try {
      return await fromPath();
    } catch (pathErr) {
      console.warn(
        `PDF preview path render failed for ${storage.full}`,
        pathErr,
      );
      return await fromBuffer();
    }
  })();

  const base = await sharp(prev, { limitInputPixels: PIXEL_LIMIT }).rotate();

  for (const [w, h] of SHARP_DIMENSIONS) {
    const s = base
      .clone()
      .resize(w, h, { fit: "inside", withoutEnlargement: true })
      .flatten();

    for (const [method, opts] of Object.entries(SHARP_OPTIONS)) {
      try {
        const {
          data,
          info: { width, height },
        } = await s.clone()[method](opts).toBuffer({ resolveWithObject: true });

        if (data.length > storage.size) {
          continue;
        }
        const k = `${width}x${height}`;
        if (known.has(k)) {
          break;
        }
        assets.push({
          ext: `.${k}.${method}`,
          type: "image",
          mime: `image/${method}`,
          width,
          height,
          data,
        });
        known.add(k);
        break;
      } catch (ex) {
        console.error(ex);
      }
    }
  }
  await storage.addAssets(assets);
}

async function generateAssetsImage(storage) {
  const { meta: { width, height } = {} } = storage;
  if (!width || !height || width * height > PIXEL_LIMIT) {
    console.warn(
      `skipping ${storage} previews due to invalid/large dimensions`,
    );
    return;
  }
  const assets = [];
  const known = new Set();
  const base = await sharp(storage.full, {
    limitInputPixels: PIXEL_LIMIT,
  }).rotate();
  for (const [w, h] of SHARP_DIMENSIONS) {
    const s = base
      .clone()
      .resize(w, h, { fit: "inside", withoutEnlargement: true })
      .flatten();
    for (const [method, opts] of Object.entries(SHARP_OPTIONS)) {
      try {
        const {
          data,
          info: { width, height },
        } = await s.clone()[method](opts).toBuffer({ resolveWithObject: true });
        if (data.length > storage.size) {
          continue;
        }
        const k = `${width}x${height}`;
        if (known.has(k)) {
          break;
        }
        assets.push({
          ext: `.${k}.${method}`,
          type: "image",
          mime: `image/${method}`,
          width,
          height,
          data,
        });
        known.add(k);
        break;
      } catch (ex) {
        console.error(ex);
      }
    }
  }
  await storage.addAssets(assets);
}

async function generateAssetsVideo(storage) {
  let args;
  const ffargs = [
    "-t",
    "10",
    "-map",
    "v:0",
    "-map_metadata",
    "-1",
    "-c:v",
    "libx264",
    "-preset:v",
    "veryfast",
    "-crf",
    "27",
    "-profile:v",
    "baseline",
    "-movflags",
    "+faststart",
    "-fflags",
    "+bitexact",
    "-vf",
    "scale=400:-1,crop=iw-'mod(iw,4)':ih-'mod(ih,4)'",
  ];
  const inf = storage.full;
  const outf = `${inf}.mp4`;
  if (JAIL) {
    const i = path.parse(inf);
    const o = path.parse(outf);
    args = [
      "firejail",
      "--quiet",
      `--profile=${PROFILE}`,
      `--private=${i.dir}`,
      FFMPEG,
      "-y",
      "-ss",
      "2",
      "-i",
      i.base,
    ].concat(ffargs);
    args.push(o.base);
  } else {
    args = [FFMPEG, "-y", "-ss", "2", "-i", inf].concat(ffargs);
    args.push(outf);
  }
  try {
    await runcmd(args, "utf-8");
    await storage.addAssets([
      {
        ext: ".mp4",
        type: "video",
        mime: "video/mp4",
        file: outf,
      },
    ]);
  } catch (ex) {
    console.error(ex);
    OBS.trackPreviewFailure(storage, "video-preview", ex);
    // Don't really care, not even sure the file exists
    fs.unlink(outf, () => {});
  }
}

/**
 * Extract the cover image from an EPUB file.
 *
 * Strategy:
 *  1. Open the EPUB ZIP with jszip.
 *  2. Find the OPF file via META-INF/container.xml.
 *  3. Parse the OPF manifest to locate the cover image entry:
 *     - EPUB3: manifest item with properties="cover-image"
 *     - EPUB2: manifest item whose id matches <meta name="cover" content="…"/>
 *  4. Extract that file's binary content from the ZIP.
 *  5. Process through sharp and save as a preview asset.
 */
async function extractEpubCover(filePath) {
  let JSZip;
  try {
    JSZip = require("jszip");
  } catch (ex) {
    console.warn("jszip not available, skipping EPUB cover extraction");
    return null;
  }
  const buf = await fsPromises.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);

  // 1. Find OPF path via META-INF/container.xml
  const containerXml = zip.file("META-INF/container.xml");
  if (!containerXml) {
    return null;
  }
  const containerText = await containerXml.async("text");
  const opfMatch = containerText.match(/full-path="([^"]+\.opf)"/i);
  if (!opfMatch) {
    return null;
  }
  const opfPath = opfMatch[1];
  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    return null;
  }
  const opfText = await opfFile.async("text");
  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  // 2. Try EPUB3: <item properties="cover-image" …>
  let coverHref = null;
  const epub3Match =
    opfText.match(
      /<item[^>]+properties="[^"]*cover-image[^"]*"[^>]+href="([^"]+)"/i,
    ) ||
    opfText.match(
      /<item[^>]+href="([^"]+)"[^>]+properties="[^"]*cover-image[^"]*"/i,
    );
  if (epub3Match) {
    coverHref = epub3Match[1];
  }

  // 3. Try EPUB2: <meta name="cover" content="cover_id"/> → find matching item
  if (!coverHref) {
    const metaMatch =
      opfText.match(/<meta[^>]+name="cover"[^>]+content="([^"]+)"/i) ||
      opfText.match(/<meta[^>]+content="([^"]+)"[^>]+name="cover"/i);
    if (metaMatch) {
      const coverId = metaMatch[1];
      const idHrefMatch =
        new RegExp(`<item[^>]+id="${coverId}"[^>]+href="([^"]+)"`, "i").exec(
          opfText,
        ) ||
        new RegExp(`<item[^>]+href="([^"]+)"[^>]+id="${coverId}"`, "i").exec(
          opfText,
        );
      if (idHrefMatch) {
        coverHref = idHrefMatch[1];
      }
    }
  }

  if (!coverHref) {
    return null;
  }

  // Decode any URL-encoded path characters
  const coverPath = opfDir + decodeURIComponent(coverHref);
  const coverFile = zip.file(coverPath) || zip.file(coverHref);
  if (!coverFile) {
    return null;
  }
  return Buffer.from(await coverFile.async("arraybuffer"));
}

/**
 * Extract the cover image from a MOBI/AZW/AZW3 file using direct binary
 * PalmDB/MOBI record parsing. Does not need exiftool.
 *
 * Strategy:
 *  1. Read the PalmDB record list from the file header.
 *  2. In record 0, locate the MOBI header ("MOBI" magic) and EXTH section.
 *  3. Find EXTH record type 201 (CoverOffset) — an integer offset into the
 *     image record list relative to first_image_record.
 *  4. Extract that Palm record as raw bytes; validate JPEG/PNG/GIF/BMP magic.
 */
async function extractMobiCoverNative(filePath, buf = null) {
  if (!buf) buf = await fsPromises.readFile(filePath);
  if (buf.length < 80) return null;

  // PalmDB: number of records at offset 76 (2 bytes big-endian)
  const numRecords = buf.readUInt16BE(76);
  if (numRecords < 2) return null;

  // Build record offset table (each entry: 4-byte offset + 4-byte attrs = 8 bytes, starting at 78)
  const recordOffsets = [];
  for (let i = 0; i < numRecords; i++) {
    recordOffsets.push(buf.readUInt32BE(78 + i * 8));
  }

  const r0End = recordOffsets[1] || buf.length;
  const r0 = buf.subarray(recordOffsets[0], r0End);

  // Find "MOBI" magic in record 0 (PalmDOC header is 16 bytes, so MOBI is usually at r0[16])
  let mobiOff = -1;
  for (let i = 0; i < Math.min(r0.length - 4, 48); i++) {
    if (
      r0[i] === 0x4d &&
      r0[i + 1] === 0x4f &&
      r0[i + 2] === 0x42 &&
      r0[i + 3] === 0x49
    ) {
      mobiOff = i;
      break;
    }
  }
  if (mobiOff < 0) return null;

  if (r0.length < mobiOff + 96) return null;
  const mobiHeaderLen = r0.readUInt32BE(mobiOff + 4);
  if (mobiHeaderLen < 96) return null;

  // first_image_record at MOBI header byte +92 (from MOBI magic).
  // MOBI header layout: +0 "MOBI", +4 headerLen, +8 type, +12 encoding,
  // +16 uid, +20 fileVersion, +24..+60 index fields (6 extra), +64 firstNonBook,
  // +68 fullNameOffset, +72 fullNameLen, +76 language, +80 inputLang,
  // +84 outputLang, +88 minVersion, +92 firstImageRecord.
  // (offset +56 is extra_index_4 which is 0xFFFFFFFF in most files — wrong!)
  if (mobiHeaderLen < 96) return null;
  const firstImageRecord = r0.readUInt32BE(mobiOff + 92);
  if (firstImageRecord === 0xffffffff || firstImageRecord >= numRecords)
    return null;

  // EXTH section starts right after the MOBI header
  const exthOff = mobiOff + mobiHeaderLen;
  if (r0.length < exthOff + 12) return null;
  // Check "EXTH" magic
  if (
    r0[exthOff] !== 0x45 ||
    r0[exthOff + 1] !== 0x58 ||
    r0[exthOff + 2] !== 0x54 ||
    r0[exthOff + 3] !== 0x48
  )
    return null;

  const exthRecordCount = r0.readUInt32BE(exthOff + 8);
  let coverOffset = null;
  let pos = exthOff + 12;
  for (let i = 0; i < exthRecordCount && pos + 8 <= r0.length; i++) {
    const recType = r0.readUInt32BE(pos);
    const recLen = r0.readUInt32BE(pos + 4);
    if (recLen < 8) break;
    if (recType === 201 && recLen === 12) {
      // CoverOffset: 4-byte integer (index relative to firstImageRecord)
      coverOffset = r0.readUInt32BE(pos + 8);
    }
    pos += recLen;
  }
  if (coverOffset === null) return null;

  const coverRecordIdx = firstImageRecord + coverOffset;
  if (coverRecordIdx >= numRecords) return null;

  const imgStart = recordOffsets[coverRecordIdx];
  const imgEnd =
    coverRecordIdx + 1 < numRecords
      ? recordOffsets[coverRecordIdx + 1]
      : buf.length;
  const imgData = buf.subarray(imgStart, imgEnd);
  if (imgData.length < 100) return null;

  // Validate image signature
  const sig2 = imgData.readUInt16BE(0);
  const sig4 = imgData.readUInt32BE(0);
  const isJpeg = sig2 === 0xffd8;
  const isPng = sig4 === 0x89504e47;
  const isGif = sig4 === 0x47494638;
  const isBmp = sig2 === 0x424d;
  if (!isJpeg && !isPng && !isGif && !isBmp) return null;

  return Buffer.from(imgData);
}

// ── A5 page-count estimation ────────────────────────────────────────────────
//
// The in-browser reader renders at 420 × 595 px, HP=40 VP=28 padding,
// Georgia 1.05em/1.75 line-height.  Empirically that works out to roughly
// 1400–1800 plain-text characters per page.  We use 1600 as the calibration
// constant (same as most ebook converters).
//
const A5_CHARS_PER_PAGE = 1600;
const RE_HTML_TAGS = /<[^>]*>/g;
const RE_WHITESPACE = /\s+/g;

/**
 * Count A5 pages for an EPUB by stripping HTML from all spine chapters and
 * dividing total characters by A5_CHARS_PER_PAGE.
 * @returns {number} estimated page count, or 0 if unable to parse
 */
async function countEpubPages(filePath) {
  let JSZip;
  try {
    JSZip = require("jszip");
  } catch (ex) {
    return 0;
  }
  try {
    const buf = await fsPromises.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);

    // Locate the OPF
    const containerXml = zip.file("META-INF/container.xml");
    if (!containerXml) return 0;
    const containerText = await containerXml.async("text");
    const opfMatch = containerText.match(/full-path="([^"]+\.opf)"/i);
    if (!opfMatch) return 0;
    const opfPath = opfMatch[1];
    const opfFile = zip.file(opfPath);
    if (!opfFile) return 0;
    const opfText = await opfFile.async("text");
    const opfDir = opfPath.includes("/")
      ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
      : "";

    // Build manifest href map
    const manifestMap = {};
    let m;
    const itemRe = /<item\b([^>]+)>/gi;
    while ((m = itemRe.exec(opfText)) !== null) {
      const attrs = m[1];
      const idM = attrs.match(/\bid="([^"]+)"/i);
      const hrefM = attrs.match(/\bhref="([^"]+)"/i);
      const mediaM = attrs.match(/\bmedia-type="([^"]+)"/i);
      if (idM && hrefM) {
        manifestMap[idM[1]] = {
          href: hrefM[1],
          mediaType: mediaM ? mediaM[1] : "",
        };
      }
    }

    // Walk the spine in order
    const spineRe = /<itemref\b[^>]+\bidref="([^"]+)"/gi;
    let totalChars = 0;
    while ((m = spineRe.exec(opfText)) !== null) {
      const item = manifestMap[m[1]];
      if (!item) continue;
      const mt = item.mediaType.toLowerCase();
      if (!mt.includes("html") && !mt.includes("xhtml") && mt !== "") continue;
      const chapterPath = opfDir + decodeURIComponent(item.href);
      const chFile = zip.file(chapterPath) || zip.file(item.href);
      if (!chFile) continue;
      const html = await chFile.async("text");
      // Strip HTML tags and collapse whitespace to count readable characters
      const text = html
        .replace(RE_HTML_TAGS, " ")
        .replace(RE_WHITESPACE, " ")
        .trim();
      totalChars += text.length;
    }
    if (totalChars < 100) return 0;
    return Math.max(1, Math.round(totalChars / A5_CHARS_PER_PAGE));
  } catch (ex) {
    console.warn("countEpubPages failed:", ex.message);
    return 0;
  }
}

/**
 * Count A5 pages for a MOBI/AZW/AZW3 file using the PalmDoc text_length field.
 * PalmDoc header in record 0 (before the MOBI magic):
 *   bytes 0–1: compression type
 *   bytes 2–3: reserved
 *   bytes 4–7: text_length (total uncompressed text bytes)
 *
 * We divide by A5_CHARS_PER_PAGE (assuming 1 byte ≈ 1 char for Latin/UTF-8
 * prose, which is conservative — Cyrillic/CJK will over-estimate).
 * @param {Buffer} buf  the full MOBI file buffer (already loaded)
 * @returns {number} estimated page count, or 0 if unable to parse
 */
function countMobiPages(buf) {
  try {
    if (buf.length < 80) return 0;
    const numRecords = buf.readUInt16BE(76);
    if (numRecords < 1) return 0;
    const r0Start = buf.readUInt32BE(78);
    if (r0Start + 8 > buf.length) return 0;
    // PalmDoc header starts at the beginning of record 0 (bytes 0-15)
    const textLength = buf.readUInt32BE(r0Start + 4);
    if (textLength < 100) return 0;
    return Math.max(1, Math.round(textLength / A5_CHARS_PER_PAGE));
  } catch (ex) {
    console.warn("countMobiPages failed:", ex.message);
    return 0;
  }
}

async function generateAssetsEpubMobi(storage) {
  const fileType = (storage.meta && storage.meta.type) || "";
  const isMobiFamily = ["MOBI", "AZW", "AZW3"].includes(fileType.toUpperCase());
  let coverBinary = null;
  let mobiBuffer = null; // kept alive so countMobiPages reuses it

  if (fileType === "EPUB") {
    // EPUBs are ZIP files — extract cover from the OPF manifest
    try {
      coverBinary = await extractEpubCover(storage.full);
    } catch (ex) {
      console.error("Failed to extract EPUB cover via ZIP parsing", ex);
      OBS.trackPreviewFailure(storage, "epub-cover-zip", ex);
    }
  } else if (isMobiFamily) {
    // MOBI/AZW/AZW3: parse PalmDB records directly to extract the cover image.
    // exiftool's -CoverImage tag for MOBI returns only the integer record offset,
    // not the actual image bytes, so we must parse the binary ourselves.
    try {
      mobiBuffer = await fsPromises.readFile(storage.full);
      coverBinary = await extractMobiCoverNative(storage.full, mobiBuffer);
    } catch (ex) {
      console.error("Failed to extract MOBI/AZW cover natively", ex);
      OBS.trackPreviewFailure(storage, "mobi-cover-native", ex);
    }
  }

  // ── Page count estimation ────────────────────────────────────────────────
  // Always recalculate for EPUB/MOBI — exiftool does not provide reliable page
  // counts for these formats, and any previously stored value may be stale.
  try {
    let pageCount = 0;
    if (fileType === "EPUB") {
      pageCount = await countEpubPages(storage.full);
    } else if (isMobiFamily) {
      if (!mobiBuffer) {
        mobiBuffer = await fsPromises.readFile(storage.full);
      }
      pageCount = countMobiPages(mobiBuffer);
    }
    if (pageCount > 0) {
      storage.meta.pages = String(pageCount);
      storage.tags.pages = String(pageCount);
    }
  } catch (ex) {
    console.warn("Failed to estimate book page count:", ex.message);
  }

  if (!coverBinary || coverBinary.length < 100) {
    // No usable cover art, but still persist any page count we computed
    if (storage.meta.pages) {
      await storage.addAssets([]);
    }
    return;
  }

  try {
    const {
      data,
      info: { width, height },
    } = await sharp(coverBinary, { limitInputPixels: Math.pow(8000, 2) })
      .rotate()
      .resize(400, 600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ force: true, quality: 75 })
      .toBuffer({ resolveWithObject: true });
    await storage.addAssets([
      {
        ext: ".cover.jpg",
        type: "image",
        mime: "image/jpeg",
        width,
        height,
        data,
      },
    ]);
  } catch (ex) {
    console.error("Failed to process epub/mobi cover image", ex);
    OBS.trackPreviewFailure(storage, "epub-mobi-cover-sharp", ex);
  }
}

/**
 * Generate assets for a comic book archive (CBZ for Phase 1).
 *
 * - Lists all image entries, natural-sorts by basename.
 * - Stores sorted name list in `storage.meta.comic_index` (newline-separated).
 * - Stores page count in `storage.meta.pages` and `storage.tags.pages`.
 * - Extracts the first page and saves a 400×600 JPEG cover asset.
 *
 * CBR and CBT support (spawn unrar / tar) is deferred to Phase 2.
 */
async function generateAssetsComic(storage) {
  const fileType = (storage.meta && storage.meta.type) || "";
  if (!COMIC_TYPES.has(fileType)) {
    return;
  }
  if (fileType !== "CBZ") {
    console.info(
      `generateAssetsComic: ${fileType} support not yet implemented — skipping`,
    );
    return;
  }

  let JSZip;
  try {
    JSZip = require("jszip");
  } catch (ex) {
    console.warn("jszip not available, skipping CBZ asset generation");
    return;
  }

  let zip;
  try {
    const buf = await fsPromises.readFile(storage.full);
    zip = await JSZip.loadAsync(buf);
  } catch (ex) {
    console.error("generateAssetsComic: failed to load CBZ ZIP:", ex.message);
    OBS.trackPreviewFailure(storage, "cbz-zip-load", ex);
    return;
  }

  // Collect all image entries and natural-sort by basename.
  const { naturalSort } = require("../common/sorting");
  const imageFiles = [];
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      const ext = path.extname(relativePath).toLowerCase();
      if (COMIC_IMAGE_EXTS.has(ext)) {
        imageFiles.push(relativePath);
      }
    }
  });
  imageFiles.sort((a, b) =>
    naturalSort(path.basename(a).toLowerCase(), path.basename(b).toLowerCase()),
  );

  const pageCount = imageFiles.length;
  if (pageCount === 0) {
    console.warn(
      `generateAssetsComic: no image files found in ${storage.full}`,
    );
    return;
  }

  // Persist sorted page index and count into mutable meta/tags.
  storage.meta.pages = String(pageCount);
  storage.tags.pages = String(pageCount);
  storage.meta.comic_index = imageFiles.join("\n");

  // Extract first page as cover thumbnail.
  let coverBinary = null;
  try {
    const firstEntry = zip.file(imageFiles[0]);
    if (firstEntry) {
      coverBinary = Buffer.from(await firstEntry.async("arraybuffer"));
    }
  } catch (ex) {
    console.warn("generateAssetsComic: failed to read first page:", ex.message);
  }

  if (!coverBinary || coverBinary.length < 100) {
    // No usable cover — still persist page count and index.
    await storage.addAssets([]);
    return;
  }

  try {
    const {
      data,
      info: { width, height },
    } = await sharp(coverBinary, { limitInputPixels: PIXEL_LIMIT })
      .rotate()
      .resize(400, 600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ force: true, quality: 75 })
      .toBuffer({ resolveWithObject: true });

    await storage.addAssets([
      {
        ext: ".cover.jpg",
        type: "image",
        mime: "image/jpeg",
        width,
        height,
        data,
      },
    ]);
  } catch (ex) {
    console.error(
      "generateAssetsComic: cover sharp processing failed:",
      ex.message,
    );
    OBS.trackPreviewFailure(storage, "cbz-cover-sharp", ex);
    // Still persist page count / index.
    await storage.addAssets([]);
  }
}

/**
 * Extract the n-th page (0-indexed) from a comic archive, transcode it to
 * JPEG via sharp, and return the Buffer.  Returns null when n is out of range.
 *
 * Called on every page-view request from the /api/v1/comic/:key/page/:n route.
 *
 * Phase 1: CBZ only (pure jszip, no binary spawn required).
 * Phase 2 will add CBR (unrar p -inul) and CBT (tar xOf) support.
 */
async function extractComicPage(storage, n) {
  const fileType = (storage.meta && storage.meta.type) || "";
  if (!COMIC_TYPES.has(fileType)) {
    throw new Error(`extractComicPage: unsupported type ${fileType}`);
  }
  if (fileType !== "CBZ") {
    throw new Error(`extractComicPage: ${fileType} not yet supported`);
  }

  let JSZip;
  try {
    JSZip = require("jszip");
  } catch (ex) {
    throw new Error("jszip not available");
  }

  // Resolve the sorted page list.
  let pageFiles;
  if (storage.meta && storage.meta.comic_index) {
    pageFiles = storage.meta.comic_index.split("\n").filter(Boolean);
  } else {
    // Fallback: reconstruct index from ZIP listing (e.g. old files uploaded
    // before generateAssetsComic ran).
    const { naturalSort } = require("../common/sorting");
    const buf = await fsPromises.readFile(storage.full);
    const zip = await JSZip.loadAsync(buf);
    const files = [];
    zip.forEach((p, e) => {
      if (!e.dir && COMIC_IMAGE_EXTS.has(path.extname(p).toLowerCase())) {
        files.push(p);
      }
    });
    files.sort((a, b) =>
      naturalSort(
        path.basename(a).toLowerCase(),
        path.basename(b).toLowerCase(),
      ),
    );
    pageFiles = files;
  }

  const pageIdx = parseInt(n, 10);
  if (!isFinite(pageIdx) || pageIdx < 0 || pageIdx >= pageFiles.length) {
    return null; // → 404
  }

  const buf = await fsPromises.readFile(storage.full);
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file(pageFiles[pageIdx]);
  if (!entry) {
    return null; // → 404
  }

  const raw = Buffer.from(await entry.async("arraybuffer"));

  // Transcode: normalize format, strip EXIF, cap width to 1400 px, return JPEG.
  return sharp(raw, { limitInputPixels: PIXEL_LIMIT })
    .rotate()
    .resize(1400, null, { fit: "inside", withoutEnlargement: true })
    .jpeg({ force: true, quality: 85 })
    .toBuffer();
}

async function generateAssetsAudio(storage) {
  if (!storage.meta.haspic) {
    return;
  }
  let exiftool;
  if (JAIL) {
    const p = path.parse(storage.full);
    exiftool = [
      "firejail",
      "--quiet",
      `--profile=${PROFILE}`,
      `--private=${p.dir}`,
      EXIFTOOL,
      "-b",
      "-Picture",
      `./${p.base}`,
    ];
  } else {
    exiftool = [EXIFTOOL, "-b", "-Picture", storage.full];
  }

  try {
    const [binary] = await runcmd(exiftool, null);
    const {
      data,
      info: { width, height },
    } = await sharp(binary, { limitInputPixels: Math.pow(8000, 2) })
      .rotate()
      .resize(400, 400, { fit: "inside", withoutEnlargement: true })
      .flatten()
      .jpeg({ force: true, quality: 70 })
      .toBuffer({ resolveWithObject: true });
    storage.addAssets([
      {
        ext: ".cover.jpg",
        type: "image",
        mime: "image/jpeg",
        width,
        height,
        data,
      },
    ]);
  } catch (ex) {
    console.error("Failed to extract cover", ex);
    OBS.trackPreviewFailure(storage, "audio-cover", ex);
  }
}

async function generateAssets(storage) {
  try {
    const { mime } = storage;
    if (gm && storage.meta.type === "PDF") {
      return await generateAssetsPdf(storage);
    }
    if (
      storage.meta.type === "EPUB" ||
      ["MOBI", "AZW", "AZW3"].includes(storage.meta.type)
    ) {
      return await generateAssetsEpubMobi(storage);
    }
    if (COMIC_TYPES.has(storage.meta.type)) {
      return await generateAssetsComic(storage);
    }
    if (mime.startsWith("image/")) {
      return await generateAssetsImage(storage);
    }
    if (mime.startsWith("video/")) {
      return await generateAssetsVideo(storage);
    }
    if (mime.startsWith("audio/")) {
      return await generateAssetsAudio(storage);
    }
    return null;
  } catch (ex) {
    OBS.trackPreviewFailure(storage, "generate-assets", ex);
    throw ex;
  }
}

async function detectMime(file) {
  if (!FILETOOL) {
    return null;
  }
  try {
    let filetool;
    if (JAIL) {
      const p = path.parse(file);
      filetool = [
        "firejail",
        "--quiet",
        `--profile=${PROFILE}`,
        `--private=${p.dir}`,
        FILETOOL,
        "-d",
        "--mime-type",
        `./${p.base}`,
      ];
    } else {
      filetool = [FILETOOL, "-d", "--mime-type", file];
    }
    const [fileinfo] = await runcmd(filetool, "utf-8");
    if (fileinfo) {
      return fileinfo.split(/: /g).pop();
    }
  } catch (ex) {
    // ignored
  }
  return null;
}

async function getMetaData(storage, name) {
  const file = storage.full;
  console.debug("GMD", file);
  const rv = { type: "file", mime: "text/plain", tags: {}, meta: {} };

  function add(branch, where, what) {
    what = stripHtmlAndMarkdown(what)
      .replace(RE_SANI, "")
      .replace(/[\s\0]+/g, " ")
      .trim();
    if (
      branch === "tags" &&
      ["title", "description"].includes(where) &&
      /^input ingredient \d+$/i.test(what || "")
    ) {
      return;
    }
    if (what && what.length > 200) {
      what = `${what.slice(199)}…`;
    }
    if (what) {
      rv[branch][where] = what;
    }
  }

  try {
    if (!EXIFTOOL) {
      throw new Error("No exiftool");
    }

    let exiftool;
    if (JAIL) {
      const p = path.parse(file);
      exiftool = [
        "firejail",
        "--quiet",
        `--profile=${PROFILE}`,
        `--private=${p.dir}`,
        EXIFTOOL,
        "-j",
        "-all",
        `./${p.base}`,
      ];
    } else {
      exiftool = [EXIFTOOL, "-j", "-all", file];
    }
    const [json] = await runcmd(exiftool, "utf-8");
    const [data] = JSON.parse(json);
    let { MIMEType = null } = data;
    const {
      FileType = "Binary",
      ImageWidth,
      ImageHeight,
      Title,
      Description,
      Album,
      Artist,
      Author,
      CompressorID,
      AudioBitrate,
      Duration,
      AvgBitrate,
      Picture,
    } = data;
    rv.meta.type = FileType;

    // CBZ/CBR/CBT: exiftool sees these as ZIP/RAR/TAR, but we want the
    // specific comic format name so downstream code can treat them correctly.
    const lname_ext = path.extname((name || "").toLowerCase());
    if (lname_ext === ".cbz" && (FileType === "ZIP" || FileType === "GZIP")) {
      rv.meta.type = "CBZ";
    } else if (lname_ext === ".cbr" && FileType === "RAR") {
      rv.meta.type = "CBR";
    } else if (lname_ext === ".cbt" && FileType === "TAR") {
      rv.meta.type = "CBT";
    }

    if (!MIMEType) {
      MIMEType =
        (await detectMime(file)) || rv.mime || "application/octet-stream";
    }

    const m = MIMEType.match(/^(image|video|audio)\//); // (CBZ/CBR/CBT check comes first so ARCHIVE_TYPES doesn't swallow them)
    if (m) {
      rv.mime = MIMEType;
      [, rv.type] = m;
    } else if (MIMEType.startsWith("text/")) {
      rv.mime = "text/plain";
      rv.type = "document";
    } else if (COMIC_TYPES.has(rv.meta.type)) {
      // Comic book archives (CBZ/CBR/CBT) are classified as documents so that
      // getReadableType() can pick them up and the gallery shows a Read button.
      rv.mime = "application/octet-stream";
      rv.type = "document";
    } else if (DOC_TYPES.has(FileType)) {
      if (FileType === "PDF") {
        rv.mime = "application/pdf";
      } else if (FileType === "EPUB") {
        rv.mime = "application/epub+zip";
      } else {
        rv.mime = "application/octet-stream";
      }
      rv.type = "document";
    } else if (ARCHIVE_TYPES.has(FileType)) {
      rv.mime = "application/octet-stream";
      rv.type = "archive";
    } else {
      rv.mime = "application/octet-stream";
      // XXX docs and archives
      rv.type = "file";
    }
    if (ImageWidth && ImageHeight) {
      rv.meta.width = ImageWidth;
      rv.meta.height = ImageHeight;
    }

    add("tags", "title", Title);
    if (Description !== Title) {
      add("tags", "description", Description);
    }
    add("tags", "album", Album);
    add("tags", "artist", Author);
    add("tags", "artist", Artist);
    add("tags", "bookauthor", Author);
    add("tags", "bookauthor", Artist);
    const pageCount = extractPageCount(data);
    add("tags", "pages", pageCount);
    add("meta", "pages", pageCount);

    const suggestions = extractSuggestedTags(
      path.parse(name).name,
      Title,
      Description,
      Author,
      Artist,
    );
    if (suggestions.length) {
      rv.meta.suggestedTags = suggestions;
    }

    add("meta", "codec", CompressorID);
    add("meta", "bitrate", AudioBitrate);
    add("meta", "bitrate", AvgBitrate);
    add("meta", "duration", Duration);
    add("meta", "haspic", (!!Picture).toString());

    console.debug(rv, data);

    return rv;
  } catch (ex) {
    const { ext } = path.parse(name);
    const mapped = FALLBACK_TYPEMAP.get(ext.toLowerCase());
    const mime = (await detectMime(file)) || "";
    rv.mime = "application/octet-stream";
    console.warn("detected", rv.mime);
    if (mapped) {
      // XXX docs and archives
      rv.type = mapped;
    } else if (mime.startsWith("text/")) {
      rv.type = "document";
      rv.mime = "text/plain";
    } else {
      rv.type = "file";
      rv.mime = "application/octet-stream";
    }
    return rv;
  }
}

module.exports = {
  getMetaData: wrap(CONFIG.get("maxMetaProcesses"), null, getMetaData),
  generateAssets: wrap(CONFIG.get("maxAssetsProcesses"), null, generateAssets),
  // Rate-limited: reuses maxAssetsProcesses so concurrent page requests don't
  // spike memory (each CBZ load reads the full archive into heap).
  extractComicPage: wrap(
    CONFIG.get("maxAssetsProcesses"),
    null,
    extractComicPage,
  ),
};
