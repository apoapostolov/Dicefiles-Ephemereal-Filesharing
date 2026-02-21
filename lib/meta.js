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
async function extractMobiCoverNative(filePath) {
  const buf = await fsPromises.readFile(filePath);
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

  if (r0.length < mobiOff + 80) return null;
  const mobiHeaderLen = r0.readUInt32BE(mobiOff + 4);
  if (mobiHeaderLen < 68) return null;

  // first_image_record at MOBI header byte 56 (calibre-documented offset)
  const firstImageRecord = r0.readUInt32BE(mobiOff + 56);
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

async function generateAssetsEpubMobi(storage) {
  const fileType = (storage.meta && storage.meta.type) || "";
  const isMobiFamily = ["MOBI", "AZW", "AZW3"].includes(fileType.toUpperCase());
  let coverBinary = null;

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
      coverBinary = await extractMobiCoverNative(storage.full);
    } catch (ex) {
      console.error("Failed to extract MOBI/AZW cover natively", ex);
      OBS.trackPreviewFailure(storage, "mobi-cover-native", ex);
    }
  }

  if (!coverBinary || coverBinary.length < 100) {
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

    if (!MIMEType) {
      MIMEType =
        (await detectMime(file)) || rv.mime || "application/octet-stream";
    }

    const m = MIMEType.match(/^(image|video|audio)\//);
    if (m) {
      rv.mime = MIMEType;
      [, rv.type] = m;
    } else if (MIMEType.startsWith("text/")) {
      rv.mime = "text/plain";
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
};
