"use strict";

/**
 * Shared media type sets used by the preview/meta pipeline.
 * Extracted so callers need not import the full meta module.
 */

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

const COMIC_TYPES = Object.freeze(new Set(["CBZ", "CBR", "CBT", "CB7"]));

/** Image file extensions accepted as comic pages. */
const COMIC_PAGE_EXTS = Object.freeze(
  new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".tif",
    ".tiff",
  ]),
);

const YAUZL_THRESHOLD = 100 * 1024 * 1024; // 100 MB

function isDocType(t) {
  return DOC_TYPES.has(String(t || "").toUpperCase());
}

function isArchiveType(t) {
  return ARCHIVE_TYPES.has(String(t || "").toUpperCase());
}

function isComicType(t) {
  return COMIC_TYPES.has(String(t || "").toUpperCase());
}

module.exports = {
  DOC_TYPES,
  ARCHIVE_TYPES,
  COMIC_TYPES,
  COMIC_PAGE_EXTS,
  YAUZL_THRESHOLD,
  isDocType,
  isArchiveType,
  isComicType,
};
