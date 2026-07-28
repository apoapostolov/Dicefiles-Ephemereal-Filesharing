"use strict";

import { dom } from "../../util";
import {
  FONT_FAMILIES,
  loadProgress,
  loadReaderOpts,
  READER_OPTS_DEFAULTS,
  saveProgress,
  saveReaderOpts,
} from "./opts";

function dbg(label, ...args) { console.log(`[Reader] ${label}`, ...args); }
function dbgErr(label, err) { console.error(`[Reader] ${label}`, err); }
function dbgShow(container, text, isError = false) {
  if (!container) return;
  const el = document.createElement("div");
  el.style.cssText = `font:12px/1.6 monospace;padding:4px 10px;color:${isError ? "#f87171" : "#94a3b8"};white-space:pre-wrap;word-break:break-all;`;
  el.textContent = text;
  container.appendChild(el);
}

function epubResolve(basePath, relative) {
  const rel = (relative || "").split(/[?#]/)[0];
  if (!rel || /^(data:|blob:|https?:|\/\/)/i.test(rel)) {
    return relative;
  }
  try {
    return new URL(rel, `epub://x/${basePath}`).pathname.slice(1);
  } catch {
    return basePath + rel;
  }
}

function zipFile(zip, p) {
  return zip.file(p) || zip.file(decodeURIComponent(p));
}

async function zipToBlob(zip, p, mime) {
  const f = zipFile(zip, p);
  if (!f) {
    return null;
  }
  const data = await f.async("arraybuffer");
  return URL.createObjectURL(
    new Blob([data], { type: mime || "application/octet-stream" }),
  );
}

const EXT_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

function extMime(p) {
  return (
    EXT_MIME[(p || "").split(".").pop().toLowerCase()] ||
    "application/octet-stream"
  );
}

async function parseEpubChapters(zip) {
  const blobUrls = [];
  const track = (u) => {
    if (u) {
      blobUrls.push(u);
    }
    return u;
  };

  // container.xml → OPF path
  const cf = zipFile(zip, "META-INF/container.xml");
  if (!cf) {
    throw new Error("Not a valid EPUB: missing META-INF/container.xml");
  }
  const containerXml = await cf.async("string");
  const opfPathM = containerXml.match(/full-path="([^"]+)"/i);
  if (!opfPathM) {
    throw new Error("EPUB container.xml missing full-path");
  }
  const opfPath = decodeURIComponent(opfPathM[1]);
  const opfBase = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  // Parse OPF
  const opfXml = await (zipFile(zip, opfPath) || { async: () => "" }).async(
    "string",
  );

  const manifest = {};
  for (const m of opfXml.matchAll(/<item\s[^>]+>/gi)) {
    const tag = m[0];
    const idM = tag.match(/\bid="([^"]+)"/i);
    const hrefM = tag.match(/\bhref="([^"]+)"/i);
    const mediaM = tag.match(/\bmedia-type="([^"]+)"/i);
    if (idM && hrefM) {
      manifest[idM[1]] = {
        href: epubResolve(opfBase, decodeURIComponent(hrefM[1])),
        type: mediaM ? mediaM[1] : "",
      };
    }
  }

  const spineIds = [];
  for (const m of opfXml.matchAll(/<itemref\s[^>]+>/gi)) {
    const idrefM = m[0].match(/\bidref="([^"]+)"/i);
    if (idrefM) {
      spineIds.push(idrefM[1]);
    }
  }

  const chapters = [];
  for (const id of spineIds) {
    const item = manifest[id];
    if (!item) {
      continue;
    }
    const htmlFile = zipFile(zip, item.href);
    if (!htmlFile) {
      continue;
    }
    const htmlStr = await htmlFile.async("string");
    const chapterBase = item.href.includes("/")
      ? item.href.slice(0, item.href.lastIndexOf("/") + 1)
      : "";

    // Collect + blob-ify CSS links
    const cssUrls = [];
    for (const lm of htmlStr.matchAll(/<link([^>]+)>/gi)) {
      const tag = lm[1];
      if (!/rel=["']?stylesheet["']?/i.test(tag)) {
        continue;
      }
      const hrefM =
        tag.match(/href="([^"]+)"/i) || tag.match(/href='([^']+)'/i);
      if (!hrefM) {
        continue;
      }
      const cssPath = epubResolve(
        chapterBase,
        decodeURIComponent(hrefM[1].split(/[?#]/)[0]),
      );
      const cssFile = zipFile(zip, cssPath);
      if (!cssFile) {
        continue;
      }
      let cssText = await cssFile.async("string");
      const cssBase = cssPath.includes("/")
        ? cssPath.slice(0, cssPath.lastIndexOf("/") + 1)
        : "";
      // Replace url() references in CSS
      const urlRefs = [
        ...cssText.matchAll(/url\(\s*["']?([^)"'\s]+)["']?\s*\)/g),
      ].reverse();
      for (const um of urlRefs) {
        const ref = um[1];
        if (/^(data:|blob:|https?:)/i.test(ref)) {
          continue;
        }
        const resPath = epubResolve(
          cssBase,
          decodeURIComponent(ref.split(/[?#]/)[0]),
        );
        const bu = track(await zipToBlob(zip, resPath, extMime(resPath)));
        if (bu) {
          cssText = `${cssText.slice(0, um.index)}url("${bu}")${cssText.slice(
            um.index + um[0].length,
          )}`;
        }
      }
      const cssUrl = URL.createObjectURL(
        new Blob([cssText], { type: "text/css" }),
      );
      blobUrls.push(cssUrl);
      cssUrls.push(cssUrl);
    }

    // Extract body HTML and replace image src with blob: URLs
    const bodyM = htmlStr.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let body = bodyM ? bodyM[1] : htmlStr;

    // Helper: replace one attribute match with a blob: URL
    const replaceAttr = async (attrName, matches) => {
      for (const sm of matches) {
        const ref = sm[1];
        if (/^(data:|blob:|https?:)/i.test(ref)) {
          continue;
        }
        const imgPath = epubResolve(
          chapterBase,
          decodeURIComponent(ref.split(/[?#]/)[0]),
        );
        const bu = track(await zipToBlob(zip, imgPath, extMime(imgPath)));
        if (bu) {
          body = `${body.slice(0, sm.index)}${attrName}="${bu}"${body.slice(
            sm.index + sm[0].length,
          )}`;
        }
      }
    };

    // 1. Replace src="..." (HTML <img>, <video>, etc.) — process in reverse
    //    to preserve string indices across replacements.
    await replaceAttr("src", [...body.matchAll(/\bsrc="([^"]+)"/g)].reverse());

    // 2. Replace xlink:href="..." on SVG <image> elements — Calibre EPUB covers
    //    and many EPUB3 files use <image xlink:href="cover.jpeg" …/>.
    await replaceAttr(
      "xlink:href",
      [...body.matchAll(/\bxlink:href="([^"]+)"/g)].reverse(),
    );

    // 3. Replace href="..." on SVG <image> elements (EPUB3 without xlink prefix).
    //    Guard: only rewrite href when it belongs to an <image> tag so we don't
    //    accidentally blow up anchor links.
    const hrefMatches = [...body.matchAll(/(<image\b[^>]*)\bhref="([^"]+)"/gi)]
      .reverse()
      .map((m) => {
        // Build a synthetic match object compatible with replaceAttr:
        // index must point to the start of href="..." within `body`.
        const hrefStart = m.index + m[1].length;
        return Object.assign([`href="${m[2]}"`, m[2]], {
          index: hrefStart,
        });
      });
    await replaceAttr("href", hrefMatches);

    chapters.push({ html: body, css: cssUrls });
  }

  return { chapters, blobUrls };
}

/**
 * Build an iframe srcdoc for book pagination.
 *
 * Approach: render content at natural height inside #scroller.
 * The iframe is A5-sized (overflow: hidden) and we reveal each page by
 * applying translateY(-pageIdx * pageHeight) to #scroller.
 * Total pages = ceil(scroller.offsetHeight / pageHeight) measured after load.
 */
/** Vertical gap (px) between the A5 page frame and the container edges. */
const BOOK_VMARGIN = 10;
/**
 * Top/bottom padding (px) inside the book iframe.
 * This IS the book's top and bottom page margin — the CSS column height is
 * (pageHeight - 2 * BOOK_VP) so every column has this space above and below.
 */
const BOOK_VP = 40;

/**
 * Build the srcdoc for a BookReader chapter iframe.
 *
 * Pagination strategy: CSS multi-column layout (column-fill: auto).
 * The browser lays text into columns of exactly (usableHeight) px, respecting
 * line boundaries natively — no half-line bleed at the page boundary.
 * Each "column" is one A5 page.  Translation per page = pageWidth.
 *
 * Column geometry:
 *   padding-left = HP              ← left margin of every page
 *   column-width = pageWidth−2·HP  ← text area
 *   column-gap   = 2·HP            ← right margin of page N + left margin of page N+1
 *   ∴ step = column-width + gap = pageWidth  ✓
 *
 * Page N is revealed by: scroller.style.transform = translateX(−N · pageWidth).
 * Total pages: measured from a sentinel span appended at the end of scroller.
 */
function buildSrcdoc(html, cssUrls, pageWidth, pageHeight, opts) {
  const o = opts || READER_OPTS_DEFAULTS;
  const HP = o.margin != null ? o.margin : 56; // horizontal padding (px)
  const VP = BOOK_VP; // top/bottom padding (px)
  const textW = pageWidth - 2 * HP; // text column width
  const colH = pageHeight - 2 * VP; // column / usable height
  const fontFamily = FONT_FAMILIES[o.fontFamily] || FONT_FAMILIES.georgia;
  const fontSize = `${o.fontSize || 1.05}em`;
  const lineHeight = o.lineSpacing || 1.75;
  const linkTags = cssUrls
    .map((h) => `<link rel="stylesheet" href="${h}">`)
    .join("\n");

  // ── Column-stretching fix ─────────────────────────────────────────────────
  // CSS multi-column distributes the container's content-box width evenly
  // across N columns.  If content-box is not a perfect multiple of
  // (column-width + column-gap), the browser stretches columns slightly so
  // they tile exactly, making the actual step > pageWidth.  Each page turn
  // then drifts by that fractional pixel, accumulating visibly by page 3–5.
  //
  // Fix: use box-sizing:content-box on #scroller so padding-left doesn't
  // reduce the content width, then set width = COLS*pageWidth - 2*HP so that:
  //   N = floor((contentBoxWidth + gap) / (textW + gap))
  //     = floor((COLS*pageWidth - 2*HP + 2*HP) / pageWidth) = COLS  ✓
  //   actualColumnWidth = (contentBoxWidth − (N−1)·gap) / N
  //     = (COLS·pageWidth − 2·HP − (COLS−1)·2·HP) / COLS
  //     = (COLS·pageWidth − 2·COLS·HP) / COLS
  //     = pageWidth − 2·HP = textW  ✓  (exact, zero remainder)
  //
  // Column positions (in element coord space, including padding-left offset):
  //   col N text: [HP + N·pageWidth, HP + N·pageWidth + textW]
  // translateX(−N·pageWidth) brings col N into viewport [0, pageWidth]:
  //   left margin = HP, right margin = pageWidth − (HP + textW) = HP  ✓
  const COLS = 500; // max pages per chapter (generous upper bound)
  const scrollerContentW = COLS * pageWidth - 2 * HP;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
${linkTags}
<style>
  html, body {
    margin: 0; padding: 0;
    width: ${pageWidth}px;
    height: ${pageHeight}px;
    overflow: hidden;
    /* contain:paint clips the wide multi-column scroller so only the
       current page column is visible in the iframe viewport. */
    contain: paint;
    background: #1a1a1a;
  }
  #scroller {
    /* ── CSS multi-column pagination ─────────────────────────────────── */
    /* box-sizing:content-box is required: padding-left must NOT reduce the
       content-box width, otherwise the column count changes and the browser
       stretches columns — see comment above. */
    box-sizing: content-box !important;
    width: ${scrollerContentW}px;   /* content-box = COLS*pageWidth − 2*HP */
    height: ${colH}px;
    margin-top: ${VP}px;
    /* Column geometry — each column = exactly one A5 page (no stretching) */
    column-count: auto;
    column-width: ${textW}px;
    column-gap: ${2 * HP}px;
    column-fill: auto;
    /* Provides the left margin for every page (column N sits at HP + N*pageWidth) */
    padding-left: ${HP}px;
    /* Typography */
    color: #e8e8e8;
    font-family: ${fontFamily};
    font-size: ${fontSize};
    line-height: ${lineHeight};
  }
  img, svg, video { max-width: ${textW}px; height: auto; display: block; }
  /* Force all inline text colours to a readable light value, overriding
     publisher styles that may embed dark-on-dark colour declarations. */
  *:not(a) { color: #e8e8e8 !important; background-color: transparent !important; }
  a { color: #7ec8e3 !important; }
  p { margin: 0 0 0.85em; text-align: justify; }
  h1,h2,h3,h4,h5,h6 { color: #f0f0f0 !important; margin-top: 0; break-after: avoid; }
  /* Avoid orphan lines at column boundaries */
  p { orphans: 2; widows: 2; }
  * { box-sizing: border-box; }
</style>
</head><body><div id="scroller">${html}</div></body></html>`;
}


class BookReader {
  constructor(container, infoEl) {
    this.container = container;
    this.infoEl = infoEl;
    this._type = null; // "epub" | "mobi"
    this._parser = null; // mobi-parser instance
    this._mobiSpine = []; // mobi spine items
    this._chapters = []; // epub chapters [{html, css}]
    this._blobUrls = []; // blob: URLs to revoke on destroy
    this._currentIdx = 0;
    this._total = 0;
    this._pageWidth = 0;
    this._pageHeight = 0;
    this._pageInChapter = 0;
    this._totalPagesInChapter = 1;
    this._iframe = null;
    this._loaded = false; // true once current chapter iframe fires 'load'
    this._destroyed = false;
    this._fileKey = null;
    this._opts = null; // reader typography options (set in open())
    this.onPageChange = null; // callback(chapterIdx) — set by Reader
  }

  /** Compute A5-proportioned page size constrained by the container.
   * BOOK_VMARGIN px is reserved above and below the page so it never
   * touches the container edge. */
  _computePageSize() {
    const cW = this.container.clientWidth;
    const cH = Math.max(0, this.container.clientHeight - 2 * BOOK_VMARGIN);
    const A5 = 148 / 210; // width-to-height ratio
    if (cH > 0 && cW > 0) {
      if (cW / cH > A5) {
        // Container wider than A5 → height is the constraint
        this._pageHeight = cH;
        this._pageWidth = Math.floor(cH * A5);
      } else {
        // Container taller than A5 → width is the constraint
        this._pageWidth = cW;
        this._pageHeight = Math.floor(cW / A5);
      }
    } else {
      this._pageWidth = 420;
      this._pageHeight = 595;
    }
    dbg("_computePageSize:", this._pageWidth, "×", this._pageHeight);
  }

  async open(url, type, fileKey) {
    this._type = type;
    this._fileKey = fileKey || null;
    this._opts = loadReaderOpts();
    dbg("BookReader.open() url =", url, "type =", type);
    this.container.textContent = "";
    this._computePageSize();
    if (type === "mobi") {
      await this._openMobi(url);
    } else {
      await this._openEpub(url);
    }
    // Restore saved chapter + page
    const saved = loadProgress(this._fileKey);
    const startChapter =
      saved && saved.chapter >= 0 && saved.chapter < this._total
        ? saved.chapter
        : 0;
    const startPage = saved && saved.page >= 0 ? saved.page : 0;
    await this._renderChapter(startChapter, startPage);
  }

  async _openMobi(url) {
    const { initMobiFile } = await import("@lingo-reader/mobi-parser");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching MOBI`);
    }
    this._parser = await initMobiFile(response, "");
    this._mobiSpine = this._parser.getSpine();
    this._total = this._mobiSpine.length;
    dbg("MOBI loaded, chapters =", this._total);
  }

  async _openEpub(url) {
    const JSZip = (await import("jszip")).default;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching EPUB`);
    }
    const buffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const { chapters, blobUrls } = await parseEpubChapters(zip);
    this._chapters = chapters;
    this._blobUrls = blobUrls;
    this._total = chapters.length;
    dbg("EPUB loaded, chapters =", this._total);
  }

  async _getChapter(idx) {
    if (this._type === "mobi") {
      const ch = await this._parser.loadChapter(this._mobiSpine[idx].id);
      if (!ch) {
        return { html: "<p>(chapter unavailable)</p>", css: [] };
      }
      return { html: ch.html, css: (ch.css || []).map((c) => c.href) };
    }
    return (
      this._chapters[idx] || { html: "<p>(chapter unavailable)</p>", css: [] }
    );
  }

  /**
   * Render chapter `idx`.
   * @param {number} startAtPage  0 = first page; -1 = last page (going backwards)
   */
  async _renderChapter(idx, startAtPage = 0) {
    if (idx < 0 || idx >= this._total) {
      return;
    }
    this._currentIdx = idx;
    this._pageInChapter = 0;
    this._totalPagesInChapter = 1;
    this._loaded = false;

    const { html, css } = await this._getChapter(idx);
    this.container.textContent = "";
    this._iframe = null;

    const iframe = dom("iframe", { classes: ["reader-book-iframe"] });
    iframe.style.width = `${this._pageWidth}px`;
    iframe.style.height = `${this._pageHeight}px`;
    this._iframe = iframe;

    iframe.addEventListener("load", () => {
      if (this._destroyed || this._iframe !== iframe) {
        return;
      }
      // Defer the sentinel measurement by one animation frame so the browser
      // finishes computing CSS multi-column layout before we read geometry.
      // Without this, getBoundingClientRect() can return 0 on the first load
      // after a font-size change, making totalPages = 1 and breaking pagination.
      requestAnimationFrame(() => {
        if (this._destroyed || this._iframe !== iframe) {
          return;
        }
        try {
          const doc = iframe.contentDocument;
          if (!doc || !doc.body) {
            // Document not accessible — mark loaded with a single page so
            // buttons are always functional even in degraded state.
            this._totalPagesInChapter = 1;
            this._pageInChapter = 0;
            this._loaded = true;
            this._updateInfo();
            return;
          }
          const scroller = doc.getElementById("scroller");
          if (!scroller) {
            this._totalPagesInChapter = 1;
            this._pageInChapter = 0;
            this._loaded = true;
            this._updateInfo();
            return;
          }

          // ── Measure total pages using a sentinel element ────────────────
          // With CSS multi-column, the scroller DOM width is fixed at 30 000 px.
          // We measure the rightmost extent of actual content via a sentinel
          // appended at the end.  getBoundingClientRect().left inside the iframe
          // document returns the absolute column-layout x coordinate even beyond
          // the clipped viewport.
          //
          // Column geometry (matching buildSrcdoc):
          //   page N text starts at: HP + N * pageWidth
          //   sentinel on last page: HP + N*pageWidth ≤ x < (N+1)*pageWidth
          //   ∴ N = floor((sentinel.left − HP) / pageWidth)  →  total = N+1
          const HP =
            this._opts && this._opts.margin != null ? this._opts.margin : 56;
          let totalPages = 1;
          try {
            const sentinel = doc.createElement("span");
            sentinel.style.cssText =
              "display:inline-block;width:1px;height:1px;visibility:hidden;";
            scroller.appendChild(sentinel);
            const sl = sentinel.getBoundingClientRect().left;
            scroller.removeChild(sentinel);
            if (isFinite(sl) && sl >= 0) {
              totalPages = Math.max(
                1,
                Math.floor((sl - HP) / this._pageWidth) + 1,
              );
            }
          } catch (_) {
            /* no-op */
          }

          this._totalPagesInChapter = totalPages;
          const target =
            startAtPage < 0
              ? totalPages - 1
              : Math.min(startAtPage, totalPages - 1);
          this._pageInChapter = target;
          if (target > 0) {
            scroller.style.transform = `translateX(${-target * this._pageWidth}px)`;
          }
          this._loaded = true;
          this._updateInfo();
          dbg(
            `Chapter ${idx + 1}: ${totalPages} pages (sentinel-based, HP=${HP})`,
          );
        } catch (ex) {
          dbgErr("iframe rAF measure", ex);
          // Ensure buttons are always functional even if measurement throws.
          this._totalPagesInChapter = 1;
          this._loaded = true;
          this._updateInfo();
        }
      });
    });

    iframe.srcdoc = buildSrcdoc(
      html,
      css,
      this._pageWidth,
      this._pageHeight,
      this._opts,
    );
    this.container.appendChild(iframe);
    this._updateInfo();
  }

  _scrollToPage(pageIdx) {
    if (!this._iframe || !this._loaded) {
      return;
    }
    try {
      const scroller =
        this._iframe.contentDocument &&
        this._iframe.contentDocument.getElementById("scroller");
      if (!scroller) {
        return;
      }
      scroller.style.transform =
        pageIdx === 0 ? "" : `translateX(${-pageIdx * this._pageWidth}px)`;
    } catch (ex) {
      dbgErr("_scrollToPage", ex);
    }
  }

  /**
   * Update reader typography options and re-render the current chapter
   * at the current page position.
   * @param {object} newOpts — partial or full options object
   */
  applyOpts(newOpts) {
    this._opts = { ...this._opts, ...newOpts };
    // Recompute page dimensions before re-rendering.
    this._computePageSize();
    // Font size / margin changes alter the number of pages per chapter, so the
    // old page index is no longer meaningful.  Re-render from page 0 so the
    // user sees a clean, correctly-paginated chapter start.
    //
    // _renderChapter sets _loaded = false synchronously (before its first await).
    // Restore it right after so that Prev/Next buttons and arrow-key navigation
    // remain responsive during the re-flow.  The load-event handler will update
    // _totalPagesInChapter once the new layout has settled.
    const wasLoaded = this._loaded;
    this._renderChapter(this._currentIdx, 0);
    if (wasLoaded) {
      this._loaded = true;
    }
  }

  /** Navigate one page forward; wraps to next chapter at chapter end. */
  nextPage() {
    if (!this._loaded) {
      return;
    }
    const newPage = this._pageInChapter + 1;
    if (newPage >= this._totalPagesInChapter) {
      if (this._currentIdx < this._total - 1) {
        this._renderChapter(this._currentIdx + 1, 0);
      }
      return;
    }
    this._pageInChapter = newPage;
    this._scrollToPage(newPage);
    this._updateInfo();
  }

  /** Navigate one page back; wraps to prev chapter (last page) at chapter start. */
  prevPage() {
    if (!this._loaded) {
      return;
    }
    const newPage = this._pageInChapter - 1;
    if (newPage < 0) {
      if (this._currentIdx > 0) {
        this._renderChapter(this._currentIdx - 1, -1);
      }
      return;
    }
    this._pageInChapter = newPage;
    this._scrollToPage(newPage);
    this._updateInfo();
  }

  /** Jump to the next chapter (first page). */
  nextChapter() {
    if (this._currentIdx < this._total - 1) {
      this._renderChapter(this._currentIdx + 1, 0);
    }
  }

  /** Jump to the previous chapter (first page). */
  prevChapter() {
    if (this._currentIdx > 0) {
      this._renderChapter(this._currentIdx - 1, 0);
    }
  }

  _updateInfo() {
    if (this.infoEl) {
      this.infoEl.textContent = `Chapter ${this._currentIdx + 1} / ${this._total}  ·  Page ${this._pageInChapter + 1} / ${this._totalPagesInChapter}`;
    }
    saveProgress(this._fileKey, {
      chapter: this._currentIdx,
      page: this._pageInChapter,
    });
    if (this.onPageChange) {
      this.onPageChange(this._currentIdx);
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._parser) {
      this._parser.destroy();
      this._parser = null;
    }
    for (const u of this._blobUrls) {
      URL.revokeObjectURL(u);
    }
    this._blobUrls = [];
    this._chapters = [];
    this._mobiSpine = [];
    this._iframe = null;
    this.container.textContent = "";
  }
}

// ── Comic reader ──────────────────────────────────────────────────────────────

/**
 * Paged comic book reader for CBZ archives.
 *
 * Pages are fetched on-demand from /api/v1/comic/:key/page/:n (server-side
 * JPEG transcode, 1 400 px width cap).  Adjacent pages are preloaded into
 * the browser image cache after every navigation.
 *
 * Manga mode: calling setMangaMode(true) swaps left/right so that "next"
 * physically moves to the left and "previous" to the right, matching right-to-
 * left Japanese reading order without changing server-side page numbering.
 */
export { BookReader };
