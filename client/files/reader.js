"use strict";

import { dom, nukeEvent } from "../util";

/**
 * Streaming PDF / EPUB / MOBI / CBZ in-page reader.
 *
 * PDF rendering: Mozilla PDF.js (Apache-2.0 / FOSS)
 *   - Streams pages via HTTP Range requests
 *   - Renders pages lazily via IntersectionObserver as user scrolls
 *
 * EPUB rendering: native — fetches the EPUB ZIP, parses with JSZip, renders
 *   chapters in a sandboxless iframe with blob: image/CSS URLs.
 *
 * MOBI rendering: native — @lingo-reader/mobi-parser (browser build),
 *   returns chapter HTML with blob: image URLs, rendered in a sandboxless iframe.
 *
 * CBZ rendering: native — fetches each page as a server-transcoded JPEG from
 *   /api/v1/comic/:key/page/:n, displays one page at a time, preloads adjacent.
 */

// Append the client build version so the browser fetches a fresh copy
// whenever the build changes (pdf.worker.js is served immutable/30-day cached
// and Chrome applies the worker script's own cached response headers as its
// CSP context — stale cache = stale CSP without 'unsafe-eval').
const PDF_WORKER_SRC = "/pdf.worker.js?v=" + (window.__CV__ || "1");

// ── debug helpers ─────────────────────────────────────────────────────────────

function dbg(label, ...args) {
  console.log(`[Reader] ${label}`, ...args);
}
function dbgErr(label, err) {
  console.error(`[Reader] ${label}`, err);
}

/** Append a visible debug line to the reader content area. */
function dbgShow(container, text, isError = false) {
  if (!container) {
    return;
  }
  const el = document.createElement("div");
  el.style.cssText =
    "font:12px/1.6 monospace;padding:4px 10px;color:" +
    (isError ? "#f87171" : "#94a3b8") +
    ";white-space:pre-wrap;word-break:break-all;";
  el.textContent = text;
  container.appendChild(el);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getReadableType(file) {
  if (!file || file.type !== "document") {
    return null;
  }
  const t = ((file.meta && file.meta.type) || "").toUpperCase();
  const n = (file.name || "").toLowerCase();
  if (t === "PDF" || /\.pdf$/i.test(n)) {
    return "pdf";
  }
  if (t === "EPUB" || /\.epub$/i.test(n)) {
    return "epub";
  }
  if (t === "MOBI" || /\.(mobi|azw|azw3)$/i.test(n)) {
    return "mobi";
  }
  if (
    t === "CBZ" ||
    t === "CBR" ||
    t === "CBT" ||
    /\.(cbz|cbr|cbt)$/i.test(n)
  ) {
    return "comic";
  }
  return null;
}

// ── PDF renderer ─────────────────────────────────────────────────────────────

class PDFReader {
  constructor(container, infoEl) {
    this.container = container;
    this.infoEl = infoEl;
    this.pdfDoc = null;
    this.totalPages = 0;
    this.renderedPages = new Set();
    this.observer = null;
    this.canvases = [];
    this.scale = 1.4;
    this._pageHeight = 0;
    this._currentPageNum = 1;
    this._destroyed = false;
    this._fileKey = null;
    this.onPageChange = null; // callback(page) — set by Reader
  }

  async open(url, fileKey) {
    this._fileKey = fileKey || null;
    dbg("PDFReader.open() url =", url);
    dbgShow(this.container, `Opening PDF: ${url}`);

    // pdfjs-dist is a UMD/CJS bundle; webpack 5 wraps CJS modules so that the
    // full API object lands on .default. Fall back to the namespace itself for
    // any future ESM builds of pdfjs that expose named exports directly.
    let pdfjsLib;
    try {
      const pdfModule = await import("pdfjs-dist");
      pdfjsLib = pdfModule.default || pdfModule;
      dbg(
        "pdfjs-dist imported, typeof getDocument =",
        typeof pdfjsLib.getDocument,
      );
      dbgShow(
        this.container,
        `pdfjs-dist loaded, getDocument=${typeof pdfjsLib.getDocument}`,
      );
    } catch (ex) {
      dbgErr("pdfjs-dist import failed", ex);
      dbgShow(
        this.container,
        `FATAL: pdfjs-dist import failed: ${ex.message}`,
        true,
      );
      throw ex;
    }

    dbg("Setting workerSrc =", PDF_WORKER_SRC);
    dbgShow(this.container, `workerSrc: ${PDF_WORKER_SRC}`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

    dbg("Calling getDocument…");
    dbgShow(this.container, "Calling pdfjsLib.getDocument()…");
    try {
      this.pdfDoc = await pdfjsLib.getDocument({
        url,
        disableAutoFetch: false,
        disableStream: false,
        rangeChunkSize: 65536,
      }).promise;
    } catch (ex) {
      dbgErr("getDocument failed", ex);
      dbgShow(
        this.container,
        `FATAL: getDocument failed: ${ex.message || ex}`,
        true,
      );
      throw ex;
    }

    this.totalPages = this.pdfDoc.numPages;
    dbg("PDF loaded, pages =", this.totalPages);
    dbgShow(this.container, `PDF loaded: ${this.totalPages} pages`);

    // Auto-compute scale so pages fill the container width exactly,
    // avoiding any CSS scaling that can cause blank-canvas issues.
    const containerWidth = this.container.clientWidth;
    dbg(
      "container.clientWidth =",
      containerWidth,
      "clientHeight =",
      this.container.clientHeight,
    );
    dbgShow(
      this.container,
      `Container size: ${containerWidth} x ${this.container.clientHeight}`,
    );

    if (containerWidth > 0) {
      const firstPage = await this.pdfDoc.getPage(1);
      const naturalViewport = firstPage.getViewport({ scale: 1 });
      // A5 aspect ratio (148 × 210 mm, w:h = 148/210).
      // Compute the page display width constrained by BOTH container width AND height
      // (so one full page fits in the viewport without scrolling = book-like view).
      const A5_W_TO_H = 148 / 210;
      const containerHeight = this.container.clientHeight;
      const maxByWidth = containerWidth - 32;
      const maxByHeight = Math.floor((containerHeight - 24) * A5_W_TO_H);
      const pageDisplayW = Math.max(200, Math.min(maxByWidth, maxByHeight));
      this.scale = pageDisplayW / naturalViewport.width;
      // Pre-compute placeholder height so IntersectionObserver thresholds are accurate
      this._pageHeight = Math.ceil(naturalViewport.height * this.scale);
      dbg(
        "auto scale (A5) =",
        this.scale,
        "natural page width =",
        naturalViewport.width,
        "pageDisplayW =",
        pageDisplayW,
        "pageHeight =",
        this._pageHeight,
      );
      dbgShow(
        this.container,
        `Scale (A5): ${this.scale.toFixed(3)} (displayW=${pageDisplayW}px, h=${this._pageHeight}px)`,
      );
    } else {
      dbg("WARN: container has zero width, using fallback scale", this.scale);
      dbgShow(
        this.container,
        `WARN: container width is 0 — using fallback scale ${this.scale}`,
        true,
      );
    }

    // Load saved position BEFORE calling _updateInfo — otherwise _updateInfo
    // would immediately fire onPageChange(0) and overwrite the stored progress.
    const saved = loadProgress(this._fileKey);
    const startPage =
      saved && saved.page >= 1 && saved.page <= this.totalPages
        ? saved.page
        : 1;
    this._updateInfo(startPage, this.totalPages);
    this._buildPagePlaceholders(startPage);
    this._setupObserver();
  }

  _updateInfo(current, total) {
    if (this.infoEl) {
      this.infoEl.textContent = total ? `Page ${current} / ${total}` : "";
    }
    saveProgress(this._fileKey, { page: current });
    if (this.onPageChange) this.onPageChange(current);
  }

  _buildPagePlaceholders(startPage = 0) {
    this.container.textContent = "";
    this.canvases = [];
    this._startPage = startPage;

    for (let i = 1; i <= this.totalPages; i++) {
      const wrapper = dom("div", { classes: ["reader-page-wrap"] });
      wrapper.dataset.page = String(i);

      // Placeholder keeps layout height before render (uses computed height so
      // IntersectionObserver rootMargin thresholds trigger correctly)
      const placeholder = dom("div", { classes: ["reader-page-placeholder"] });
      placeholder.style.height = `${this._pageHeight || 1100}px`;
      wrapper.appendChild(placeholder);

      this.container.appendChild(wrapper);
      this.canvases.push(wrapper);
    }

    dbg(
      "_buildPagePlaceholders: created",
      this.canvases.length,
      "placeholders",
    );
  }

  _setupObserver() {
    dbg(
      "_setupObserver: root =",
      this.container,
      "scrollHeight =",
      this.container.scrollHeight,
      "offsetHeight =",
      this.container.offsetHeight,
    );

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10);
            dbg("IntersectionObserver: page", pageNum, "is intersecting");
            if (!this.renderedPages.has(pageNum)) {
              this._renderPage(pageNum, entry.target);
            }
          }
        }
      },
      {
        // root must be the SCROLLABLE element, not its parent
        root: this.container,
        rootMargin: "300px 0px 300px 0px",
        threshold: 0,
      },
    );

    for (const wrapper of this.canvases) {
      this.observer.observe(wrapper);
    }
    dbg("_setupObserver: observing", this.canvases.length, "wrappers");

    // Immediately render the start page and one page ahead
    const sp = this._startPage || 1;
    const startIdx = sp - 1;
    if (this.canvases[startIdx]) {
      dbg("_setupObserver: force-rendering start page", sp);
      this._renderPage(sp, this.canvases[startIdx]);
      requestAnimationFrame(() => this.scrollToPage(sp, "instant"));
    }
    if (this.canvases[startIdx + 1]) {
      dbg("_setupObserver: force-rendering page", sp + 1);
      this._renderPage(sp + 1, this.canvases[startIdx + 1]);
    }
  }

  async _renderPage(pageNum, wrapperEl) {
    if (this.renderedPages.has(pageNum) || this._destroyed) {
      return;
    }
    this.renderedPages.add(pageNum);
    dbg("_renderPage: rendering page", pageNum);

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale });

      dbg(
        `_renderPage: page ${pageNum} viewport ${viewport.width.toFixed(0)}x${viewport.height.toFixed(0)}`,
      );

      const canvas = dom("canvas", { classes: ["reader-page-canvas"] });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Replace placeholder
      wrapperEl.textContent = "";
      wrapperEl.appendChild(canvas);
      wrapperEl.style.minHeight = "";

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error(`getContext('2d') returned null for page ${pageNum}`);
      }

      await page.render({ canvasContext: ctx, viewport }).promise;
      dbg(`_renderPage: page ${pageNum} rendered OK`);

      // Scroll-tracking: which page is visible
      this._trackVisible(wrapperEl, pageNum);
    } catch (ex) {
      dbgErr(`_renderPage page ${pageNum} failed`, ex);
      // Show the error on the page placeholder itself
      wrapperEl.textContent = "";
      const errEl = document.createElement("div");
      errEl.style.cssText =
        "padding:1rem;color:#f87171;font:13px monospace;background:#1a0000;border-radius:4px;";
      errEl.textContent = `Page ${pageNum} render error: ${ex.message || ex}`;
      wrapperEl.appendChild(errEl);
    }
  }

  _trackVisible(wrapperEl, pageNum) {
    const vis = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this._currentPageNum = pageNum;
          this._updateInfo(pageNum, this.totalPages);
        }
      },
      {
        // same scrollable root
        root: this.container,
        threshold: 0.3,
      },
    );
    vis.observe(wrapperEl);
  }

  setZoom(delta) {
    const savedPage = this._currentPageNum;
    this.scale = Math.max(0.6, Math.min(3.0, this.scale + delta));
    // Re-render visible pages at new scale
    this.renderedPages.clear();
    this._buildPagePlaceholders();
    if (this.observer) {
      this.observer.disconnect();
    }
    this._setupObserver();
    // Restore scroll position after placeholders are rebuilt
    requestAnimationFrame(() => this.scrollToPage(savedPage, "instant"));
  }

  /** Scroll the reader to a specific 1-based page number. */
  scrollToPage(pageNum, behavior = "smooth") {
    const clamped = Math.max(1, Math.min(pageNum, this.totalPages));
    const wrapper = this.canvases[clamped - 1];
    if (!wrapper) {
      return;
    }
    // Scroll the scrollable container to the top of that wrapper
    this.container.scrollTo({ top: wrapper.offsetTop - 8, behavior });
    this._currentPageNum = clamped;
    this._updateInfo(clamped, this.totalPages);
    // Trigger render if not yet rendered
    if (!this.renderedPages.has(clamped)) {
      this._renderPage(clamped, wrapper);
    }
  }

  prevPage() {
    this.scrollToPage(this._currentPageNum - 1);
  }

  nextPage() {
    this.scrollToPage(this._currentPageNum + 1);
  }

  destroy() {
    this._destroyed = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pdfDoc) {
      this.pdfDoc.destroy();
      this.pdfDoc = null;
    }
    this.container.textContent = "";
    this.canvases = [];
    this.renderedPages.clear();
  }
}

// ── Book renderer (EPUB + MOBI, native client-side parsing) ─────────────────

/**
 * Resolve a relative path against a base directory using the URL API.
 * Handles ".." traversal correctly.
 */
function epubResolve(basePath, relative) {
  const rel = (relative || "").split(/[?#]/)[0];
  if (!rel || /^(data:|blob:|https?:|\/\/)/i.test(rel)) return relative;
  try {
    return new URL(rel, "epub://x/" + basePath).pathname.slice(1);
  } catch {
    return basePath + rel;
  }
}

function zipFile(zip, p) {
  return zip.file(p) || zip.file(decodeURIComponent(p));
}

async function zipToBlob(zip, p, mime) {
  const f = zipFile(zip, p);
  if (!f) return null;
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
    if (u) blobUrls.push(u);
    return u;
  };

  // container.xml → OPF path
  const cf = zipFile(zip, "META-INF/container.xml");
  if (!cf) throw new Error("Not a valid EPUB: missing META-INF/container.xml");
  const containerXml = await cf.async("string");
  const opfPathM = containerXml.match(/full-path="([^"]+)"/i);
  if (!opfPathM) throw new Error("EPUB container.xml missing full-path");
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
    if (idrefM) spineIds.push(idrefM[1]);
  }

  const chapters = [];
  for (const id of spineIds) {
    const item = manifest[id];
    if (!item) continue;
    const htmlFile = zipFile(zip, item.href);
    if (!htmlFile) continue;
    const htmlStr = await htmlFile.async("string");
    const chapterBase = item.href.includes("/")
      ? item.href.slice(0, item.href.lastIndexOf("/") + 1)
      : "";

    // Collect + blob-ify CSS links
    const cssUrls = [];
    for (const lm of htmlStr.matchAll(/<link([^>]+)>/gi)) {
      const tag = lm[1];
      if (!/rel=["']?stylesheet["']?/i.test(tag)) continue;
      const hrefM =
        tag.match(/href="([^"]+)"/i) || tag.match(/href='([^']+)'/i);
      if (!hrefM) continue;
      const cssPath = epubResolve(
        chapterBase,
        decodeURIComponent(hrefM[1].split(/[?#]/)[0]),
      );
      const cssFile = zipFile(zip, cssPath);
      if (!cssFile) continue;
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
        if (/^(data:|blob:|https?:)/i.test(ref)) continue;
        const resPath = epubResolve(
          cssBase,
          decodeURIComponent(ref.split(/[?#]/)[0]),
        );
        const bu = track(await zipToBlob(zip, resPath, extMime(resPath)));
        if (bu)
          cssText =
            cssText.slice(0, um.index) +
            `url("${bu}")` +
            cssText.slice(um.index + um[0].length);
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
    const srcMatches = [...body.matchAll(/\bsrc="([^"]+)"/g)].reverse();
    for (const sm of srcMatches) {
      const ref = sm[1];
      if (/^(data:|blob:|https?:)/i.test(ref)) continue;
      const imgPath = epubResolve(
        chapterBase,
        decodeURIComponent(ref.split(/[?#]/)[0]),
      );
      const bu = track(await zipToBlob(zip, imgPath, extMime(imgPath)));
      if (bu)
        body =
          body.slice(0, sm.index) +
          `src="${bu}"` +
          body.slice(sm.index + sm[0].length);
    }

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

function buildSrcdoc(html, cssUrls, pageWidth, pageHeight, opts) {
  const o = opts || READER_OPTS_DEFAULTS;
  const HP = o.margin != null ? o.margin : 40; // horizontal padding (px)
  const VP = 28; // top padding (px)
  const fontFamily = FONT_FAMILIES[o.fontFamily] || FONT_FAMILIES.georgia;
  const fontSize = (o.fontSize || 1.05) + "em";
  const lineHeight = o.lineSpacing || 1.75;
  const linkTags = cssUrls
    .map((h) => `<link rel="stylesheet" href="${h}">`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
${linkTags}
<style>
  html, body {
    margin: 0; padding: 0;
    width: ${pageWidth}px;
    height: ${pageHeight}px;
    overflow: hidden;
    /* contain: paint prevents GPU-composited child layers from painting
       outside the body bounds when translateY is applied to #scroller */
    contain: paint;
    background: #1a1a1a;
  }
  #scroller {
    padding: ${VP}px ${HP}px ${VP}px;
    box-sizing: border-box;
    width: ${pageWidth}px;
    color: #e8e8e8;
    font-family: ${fontFamily};
    font-size: ${fontSize};
    line-height: ${lineHeight};
    /* No will-change: transform — the hint promotes a compositor layer that can
       escape the body's overflow clip on some browsers; apply transform only. */
  }
  img, svg, video { max-width: 100%; height: auto; }
  /* Force all inline text colours to a readable light value, overriding
     publisher styles that may embed dark-on-dark colour declarations. */
  *:not(a) { color: #e8e8e8 !important; background-color: transparent !important; }
  a { color: #7ec8e3 !important; }
  p { margin: 0 0 1em; text-align: justify; }
  h1,h2,h3,h4,h5,h6 { color: #f0f0f0 !important; margin-top: 0; }
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
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching MOBI`);
    this._parser = await initMobiFile(response, "");
    this._mobiSpine = this._parser.getSpine();
    this._total = this._mobiSpine.length;
    dbg("MOBI loaded, chapters =", this._total);
  }

  async _openEpub(url) {
    const JSZip = (await import("jszip")).default;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching EPUB`);
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
      if (!ch) return { html: "<p>(chapter unavailable)</p>", css: [] };
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
    if (idx < 0 || idx >= this._total) return;
    this._currentIdx = idx;
    this._pageInChapter = 0;
    this._totalPagesInChapter = 1;
    this._loaded = false;

    const { html, css } = await this._getChapter(idx);
    this.container.textContent = "";
    this._iframe = null;

    const iframe = dom("iframe", { classes: ["reader-book-iframe"] });
    iframe.style.width = this._pageWidth + "px";
    iframe.style.height = this._pageHeight + "px";
    this._iframe = iframe;

    iframe.addEventListener("load", () => {
      if (this._destroyed || this._iframe !== iframe) return;
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        const scroller = doc.getElementById("scroller");
        if (!scroller) return;
        // Total content height — number of A5 "pages" this chapter spans
        const totalH = scroller.offsetHeight;
        this._totalPagesInChapter = Math.max(
          1,
          Math.ceil(totalH / this._pageHeight),
        );
        const target =
          startAtPage < 0
            ? this._totalPagesInChapter - 1
            : Math.min(startAtPage, this._totalPagesInChapter - 1);
        this._pageInChapter = target;
        if (target > 0) {
          scroller.style.transform = `translateY(${-target * this._pageHeight}px)`;
        }
        this._loaded = true;
        this._updateInfo();
        dbg(
          `Chapter ${idx + 1}: ${this._totalPagesInChapter} pages (contentH=${totalH}px)`,
        );
      } catch (ex) {
        dbgErr("iframe load handler", ex);
      }
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
    if (!this._iframe || !this._loaded) return;
    try {
      const scroller =
        this._iframe.contentDocument &&
        this._iframe.contentDocument.getElementById("scroller");
      if (!scroller) return;
      scroller.style.transform =
        pageIdx === 0 ? "" : `translateY(${-pageIdx * this._pageHeight}px)`;
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
    // Recompute page dimensions — font size changes alter effective content
    // height, so a fresh measurement ensures pagination stays accurate.
    this._computePageSize();
    // Re-render current chapter preserving page position
    this._renderChapter(this._currentIdx, this._pageInChapter);
  }

  /** Navigate one page forward; wraps to next chapter at chapter end. */
  nextPage() {
    if (!this._loaded) return;
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
    if (!this._loaded) return;
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
    if (this._currentIdx < this._total - 1)
      this._renderChapter(this._currentIdx + 1, 0);
  }

  /** Jump to the previous chapter (first page). */
  prevChapter() {
    if (this._currentIdx > 0) this._renderChapter(this._currentIdx - 1, 0);
  }

  _updateInfo() {
    if (this.infoEl) {
      this.infoEl.textContent = `Chapter ${this._currentIdx + 1} / ${this._total}  ·  Page ${this._pageInChapter + 1} / ${this._totalPagesInChapter}`;
    }
    saveProgress(this._fileKey, {
      chapter: this._currentIdx,
      page: this._pageInChapter,
    });
    if (this.onPageChange) this.onPageChange(this._currentIdx);
  }

  destroy() {
    this._destroyed = true;
    if (this._parser) {
      this._parser.destroy();
      this._parser = null;
    }
    for (const u of this._blobUrls) URL.revokeObjectURL(u);
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
class ComicReader {
  constructor(container, infoEl) {
    this.container = container;
    this.infoEl = infoEl;
    this._key = null;
    this._fileKey = null;
    this._totalPages = 0;
    this._currentPage = 0; // 0-indexed
    this._mangaMode = false;
    this._imgEl = null;
    this._destroyed = false;
    this.onPageChange = null; // callback(page) — set by Reader
  }

  /** Extract the upload key from a file href like "/g/<key>" or "/g/<key>/<name>". */
  static _keyFromFile(file) {
    const parts = ((file && file.href) || "").split("/").filter(Boolean);
    // href is "/g/<key>" or "/g/<key>/<name>" — key is right after "g"
    const gi = parts.indexOf("g");
    return gi >= 0 ? parts[gi + 1] || null : parts[parts.length - 1] || null;
  }

  async open(file) {
    this._key = ComicReader._keyFromFile(file);
    this._fileKey = file.key || this._key;
    dbg("ComicReader.open() key =", this._key);
    if (!this._key) {
      throw new Error("Cannot determine upload key from file href");
    }

    dbgShow(this.container, `Loading comic: ${file.name}`);

    const resp = await fetch(`/api/v1/comic/${this._key}/index`);
    if (!resp.ok) {
      throw new Error(`Comic index fetch failed: HTTP ${resp.status}`);
    }
    const { pages } = await resp.json();
    this._totalPages = pages;
    dbg("ComicReader: pages =", pages);

    if (pages === 0) {
      throw new Error("Comic archive has no readable pages");
    }

    this.container.textContent = "";
    this._imgEl = dom("img", { classes: ["reader-comic-page"] });
    this._imgEl.alt = "";
    this.container.appendChild(this._imgEl);

    // Restore saved position
    const saved = loadProgress(this._fileKey);
    const startPage =
      saved && saved.page >= 0 && saved.page < pages ? saved.page : 0;
    await this._showPage(startPage);
  }

  async _showPage(n) {
    if (this._destroyed) return;
    const clamped = Math.max(0, Math.min(n, this._totalPages - 1));
    this._currentPage = clamped;
    this._updateInfo();
    saveProgress(this._fileKey, { page: clamped });
    if (this.onPageChange) this.onPageChange(clamped);

    if (this._imgEl) {
      this._imgEl.src = `/api/v1/comic/${this._key}/page/${clamped}`;
    }
    // Preload neighbours into browser cache
    this._preloadPage(clamped + 1);
    this._preloadPage(clamped - 1);
  }

  _preloadPage(n) {
    if (n >= 0 && n < this._totalPages) {
      const img = new Image();
      img.src = `/api/v1/comic/${this._key}/page/${n}`;
    }
  }

  /** Advance by one "reading unit" (respects manga RTL mode). */
  nextPage() {
    const next = this._mangaMode
      ? this._currentPage - 1
      : this._currentPage + 1;
    this._showPage(next);
  }

  /** Go back by one "reading unit" (respects manga RTL mode). */
  prevPage() {
    const prev = this._mangaMode
      ? this._currentPage + 1
      : this._currentPage - 1;
    this._showPage(prev);
  }

  /** Toggle manga (right-to-left) reading mode. */
  setMangaMode(enabled) {
    this._mangaMode = enabled;
    this._updateInfo();
  }

  _updateInfo() {
    if (this.infoEl) {
      const rtl = this._mangaMode ? " [RTL]" : "";
      this.infoEl.textContent = `Page ${this._currentPage + 1} / ${this._totalPages}${rtl}`;
    }
  }

  destroy() {
    this._destroyed = true;
    this._imgEl = null;
    this.container.textContent = "";
  }
}

// ── Reading progress helpers ─────────────────────────────────────────────────

const PROGRESS_PREFIX = "dicefiles:readprogress:";
const READER_OPTS_KEY = "dicefiles:readeropts";

/**
 * Default reader typography options (Kindle-style).
 * fontFamily: key into FONT_FAMILIES
 * fontSize:   em multiplier (relative to root)
 * lineSpacing: CSS line-height value
 * margin:     horizontal padding in px
 */
const READER_OPTS_DEFAULTS = {
  fontFamily: "georgia",
  fontSize: 1.05,
  lineSpacing: 1.75,
  margin: 40,
};

const FONT_FAMILIES = {
  georgia: 'Georgia,"Times New Roman",serif',
  bookerly: '"Bookerly","Palatino Linotype","Palatino","Book Antiqua",serif',
  helvetica: "Helvetica,Arial,sans-serif",
  dyslexic: 'OpenDyslexic,"Comic Sans MS",cursive',
};

/** Load persisted reader options, falling back to defaults. */
function loadReaderOpts() {
  try {
    const raw = localStorage.getItem(READER_OPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...READER_OPTS_DEFAULTS, ...parsed };
    }
  } catch (_) {
    // ignore
  }
  return { ...READER_OPTS_DEFAULTS };
}

/** Persist reader options. */
function saveReaderOpts(opts) {
  try {
    localStorage.setItem(READER_OPTS_KEY, JSON.stringify(opts));
  } catch (_) {
    // ignore
  }
}

/**
 * Persist the reading position for `fileKey`.
 * `state` shape: { page: number, chapter?: number }
 */
function saveProgress(fileKey, state) {
  if (!fileKey) return;
  try {
    localStorage.setItem(PROGRESS_PREFIX + fileKey, JSON.stringify(state));
  } catch (_) {
    // quota / private browsing — ignore
  }
}

/** Retrieve previously saved progress. Returns null if none. */
function loadProgress(fileKey) {
  if (!fileKey) return null;
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + fileKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Remove progress entries whose file key is not in `liveKeys` (a Set<string>).
 * Called once per full file-list replacement.
 */
export function flushStaleProgress(liveKeys) {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PROGRESS_PREFIX)) {
        const fileKey = k.slice(PROGRESS_PREFIX.length);
        if (!liveKeys.has(fileKey)) {
          toRemove.push(k);
        }
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch (_) {
    // ignore
  }
}

// ── Webtoon reader ───────────────────────────────────────────────────────────

/**
 * Webtoon mode: all pages rendered as a continuous vertical strip.
 * Up / down keys and the Prev/Next buttons scroll by 25% of a page's
 * natural rendered height instead of jumping to the next discrete page.
 */
class WebtoonReader {
  constructor(container, infoEl) {
    this.container = container;
    this.infoEl = infoEl;
    this._key = null;
    this._totalPages = 0;
    this._pageHeight = 0; // natural rendered height of a single page (px)
    this._destroyed = false;
    this._stripEl = null;
    this._imgEls = [];
    this._observer = null;
    this._visiblePage = 0; // 0-indexed page currently most visible
    this._fileKey = null;
    this.onPageChange = null; // callback(page) — set by Reader
  }

  /** Same key extraction logic as ComicReader. */
  static _keyFromFile(file) {
    const parts = ((file && file.href) || "").split("/").filter(Boolean);
    const gi = parts.indexOf("g");
    return gi >= 0 ? parts[gi + 1] || null : parts[parts.length - 1] || null;
  }

  async open(file) {
    this._key = WebtoonReader._keyFromFile(file);
    this._fileKey = file.key || this._key;
    dbg("WebtoonReader.open() key =", this._key);
    if (!this._key)
      throw new Error("Cannot determine upload key from file href");

    dbgShow(this.container, `Loading webtoon: ${file.name}`);

    const resp = await fetch(`/api/v1/comic/${this._key}/index`);
    if (!resp.ok)
      throw new Error(`Comic index fetch failed: HTTP ${resp.status}`);
    const { pages } = await resp.json();
    this._totalPages = pages;
    dbg("WebtoonReader: pages =", pages);
    if (pages === 0) throw new Error("Comic archive has no readable pages");

    this.container.textContent = "";
    this._stripEl = dom("div", { classes: ["reader-webtoon-strip"] });
    this.container.appendChild(this._stripEl);
    this._imgEls = [];

    for (let i = 0; i < pages; i++) {
      const img = dom("img", { classes: ["reader-webtoon-page"] });
      img.alt = "";
      img.dataset.page = String(i);
      this._stripEl.appendChild(img);
      this._imgEls.push(img);
    }

    // Load first page eagerly to measure natural height, then lazy-load rest.
    await new Promise((resolve) => {
      const first = this._imgEls[0];
      first.onload = () => {
        this._pageHeight = first.naturalHeight || first.offsetHeight || 1400;
        resolve();
      };
      first.onerror = () => resolve();
      first.src = `/api/v1/comic/${this._key}/page/0`;
      first.setAttribute("data-loaded", "1");
    });

    // Estimate natural page height from outerWidth if onload height is 0
    if (!this._pageHeight) {
      this._pageHeight = Math.round(
        (this._imgEls[0].offsetWidth || this.container.clientWidth || 800) *
          1.4,
      );
    }

    // Lazy-load remaining pages via IntersectionObserver.
    // When a page enters the viewport, also eagerly load the next 10 pages so
    // reading feels continuous (streaming effect).
    const loadPage = (n) => {
      if (n < 0 || n >= this._imgEls.length) return;
      const img = this._imgEls[n];
      if (!img.getAttribute("data-loaded")) {
        img.setAttribute("data-loaded", "1");
        img.src = `/api/v1/comic/${this._key}/page/${n}`;
      }
    };

    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = parseInt(entry.target.dataset.page, 10);
          loadPage(n);
          // Stream-ahead: preload the next 10 pages
          for (let ahead = 1; ahead <= 10; ahead++) loadPage(n + ahead);
        }
      },
      { root: this.container, rootMargin: "600px 0px 600px 0px", threshold: 0 },
    );

    for (let i = 1; i < this._imgEls.length; i++) {
      this._observer.observe(this._imgEls[i]);
    }

    // Separate visibility tracker: update page counter + persist progress
    const visTracker = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this._visiblePage = parseInt(entry.target.dataset.page, 10);
            this._updateInfo();
            saveProgress(this._fileKey, { page: this._visiblePage });
            if (this.onPageChange) this.onPageChange(this._visiblePage);
          }
        }
      },
      { root: this.container, rootMargin: "0px", threshold: 0.4 },
    );
    for (const img of this._imgEls) visTracker.observe(img);

    // Restore saved position
    const saved = loadProgress(this._fileKey);
    if (saved && saved.page > 0 && saved.page < this._totalPages) {
      // Scroll to saved page after layout settles
      requestAnimationFrame(() => {
        const img = this._imgEls[saved.page];
        if (img) {
          // Ensure the saved page and up-front neighbours are loaded
          for (
            let i = Math.max(0, saved.page - 2);
            i <= Math.min(this._totalPages - 1, saved.page + 10);
            i++
          ) {
            loadPage(i);
          }
          img.scrollIntoView({ behavior: "instant", block: "start" });
        }
      });
    }

    this._updateInfo();
  }

  /** Scroll the container down by 25% of one natural page height. */
  nextPage() {
    const step = Math.round(this._pageHeight * 0.25);
    this.container.scrollBy({ top: step, behavior: "smooth" });
  }

  /** Scroll the container up by 25% of one natural page height. */
  prevPage() {
    const step = Math.round(this._pageHeight * 0.25);
    this.container.scrollBy({ top: -step, behavior: "smooth" });
  }

  _updateInfo() {
    if (this.infoEl) {
      this.infoEl.textContent = `Page ${this._visiblePage + 1} / ${this._totalPages} [Webtoon]`;
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._imgEls = [];
    this._stripEl = null;
    this.container.textContent = "";
  }
}

// ── Reader UI ─────────────────────────────────────────────────────────────────

export default class Reader {
  constructor() {
    this.el = document.querySelector("#reader");
    this.contentEl = document.querySelector("#reader-content");
    this.closeEl = document.querySelector("#reader-close");
    this.titleEl = document.querySelector("#reader-title");
    this.infoEl = document.querySelector("#reader-info");
    this.zoomInEl = document.querySelector("#reader-zoom-in");
    this.zoomOutEl = document.querySelector("#reader-zoom-out");
    this.prevEl = document.querySelector("#reader-prev");
    this.nextEl = document.querySelector("#reader-next");
    this.downloadEl = document.querySelector("#reader-download");
    this.viewPillEl = document.querySelector("#reader-view-pill");
    this.mangaEl = document.querySelector("#reader-manga");
    this.webtoonEl = document.querySelector("#reader-webtoon");
    this.fullscreenEl = document.querySelector("#reader-fullscreen");
    this.readerOptsEl = document.querySelector("#reader-opts");
    this.readerOptsModalEl = document.querySelector("#reader-opts-modal");
    this._optsOpen = false;
    this._focusMode = false;
    this._focusMouseTimer = null;
    this._onFullscreenChange = null;

    // Log which DOM elements were found / missing
    dbg(
      "Reader constructor — DOM elements:",
      "#reader",
      !!this.el,
      "#reader-content",
      !!this.contentEl,
      "#reader-close",
      !!this.closeEl,
      "#reader-zoom-in",
      !!this.zoomInEl,
      "#reader-prev",
      !!this.prevEl,
    );

    this.file = null;
    this._renderer = null;
    this._readerType = null;
    this._mangaMode = !!(
      typeof localStorage !== "undefined" &&
      localStorage.getItem("reader_manga") === "1"
    );
    this._webtoonMode = !!(
      typeof localStorage !== "undefined" &&
      localStorage.getItem("reader_webtoon") === "1"
    );

    this._onKey = this._onKey.bind(this);

    if (this.closeEl) {
      this.closeEl.addEventListener("click", this.close.bind(this));
    }
    if (this.zoomInEl) {
      this.zoomInEl.addEventListener("click", () => this._zoom(0.25));
    }
    if (this.zoomOutEl) {
      this.zoomOutEl.addEventListener("click", () => this._zoom(-0.25));
    }
    if (this.prevEl) {
      this.prevEl.addEventListener("click", () => this._paginatePage("prev"));
    }
    if (this.nextEl) {
      this.nextEl.addEventListener("click", () => this._paginatePage("next"));
    }
    if (this.downloadEl) {
      this.downloadEl.addEventListener("click", this._ondownload.bind(this));
    }
    if (this.mangaEl) {
      this.mangaEl.addEventListener("click", () => {
        this._mangaMode = !this._mangaMode;
        this._webtoonMode = false;
        try {
          localStorage.setItem("reader_manga", this._mangaMode ? "1" : "0");
          localStorage.setItem("reader_webtoon", "0");
        } catch (_) {
          // ignore private-browsing quota errors
        }
        this.mangaEl.classList.toggle("active", this._mangaMode);
        if (this.webtoonEl) this.webtoonEl.classList.remove("active");
        // Re-open the current comic in the new mode
        if (this.file && this._readerType === "comic") {
          this._openComicRenderer();
        }
      });
    }
    if (this.webtoonEl) {
      this.webtoonEl.addEventListener("click", () => {
        this._webtoonMode = !this._webtoonMode;
        if (this._webtoonMode) this._mangaMode = false;
        try {
          localStorage.setItem("reader_webtoon", this._webtoonMode ? "1" : "0");
          localStorage.setItem("reader_manga", "0");
        } catch (_) {
          // ignore private-browsing quota errors
        }
        this.webtoonEl.classList.toggle("active", this._webtoonMode);
        if (this.mangaEl) this.mangaEl.classList.remove("active");
        // Re-open the current comic in the new mode
        if (this.file && this._readerType === "comic") {
          this._openComicRenderer();
        }
      });
    }

    if (this.fullscreenEl) {
      this.fullscreenEl.addEventListener("click", () => this._toggleFocus());
    }

    // Reader options modal
    if (this.readerOptsEl && this.readerOptsModalEl) {
      this.readerOptsEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggleOptsModal();
      });

      // Font family buttons
      this.readerOptsModalEl
        .querySelectorAll(".rom-font-btn")
        .forEach((btn) => {
          btn.addEventListener("click", () => {
            const fontFamily = btn.dataset.font;
            this._applyReaderOpt({ fontFamily });
            this._updateOptsUI();
          });
        });

      // Font size stepper
      const sizeDecEl = this.readerOptsModalEl.querySelector("#rom-size-dec");
      const sizeIncEl = this.readerOptsModalEl.querySelector("#rom-size-inc");
      const SIZES = [0.8, 0.9, 1.0, 1.05, 1.15, 1.3, 1.5, 1.75, 2.0];
      if (sizeDecEl) {
        sizeDecEl.addEventListener("click", () => {
          const cur = loadReaderOpts().fontSize;
          const idx = SIZES.findIndex((s) => Math.abs(s - cur) < 0.01);
          const next = SIZES[Math.max(0, idx < 0 ? SIZES.length - 1 : idx - 1)];
          this._applyReaderOpt({ fontSize: next });
          this._updateOptsUI();
        });
      }
      if (sizeIncEl) {
        sizeIncEl.addEventListener("click", () => {
          const cur = loadReaderOpts().fontSize;
          const idx = SIZES.findIndex((s) => Math.abs(s - cur) < 0.01);
          const next = SIZES[Math.min(SIZES.length - 1, idx < 0 ? 0 : idx + 1)];
          this._applyReaderOpt({ fontSize: next });
          this._updateOptsUI();
        });
      }

      // Line spacing buttons
      this.readerOptsModalEl
        .querySelectorAll("#rom-spacing-row .rom-choice-btn")
        .forEach((btn) => {
          btn.addEventListener("click", () => {
            this._applyReaderOpt({
              lineSpacing: parseFloat(btn.dataset.spacing),
            });
            this._updateOptsUI();
          });
        });

      // Margin buttons
      this.readerOptsModalEl
        .querySelectorAll("#rom-margin-row .rom-choice-btn")
        .forEach((btn) => {
          btn.addEventListener("click", () => {
            this._applyReaderOpt({ margin: parseInt(btn.dataset.margin, 10) });
            this._updateOptsUI();
          });
        });

      // Close modal when clicking outside
      document.addEventListener("click", (e) => {
        if (
          this._optsOpen &&
          !this.readerOptsModalEl.contains(e.target) &&
          e.target !== this.readerOptsEl
        ) {
          this._closeOptsModal();
        }
      });
    }

    // Focus-mode overlay mouse-move handler — show bar, fade after 2 s
    this._onFocusMouseMove = () => {
      if (!this._focusMode) return;
      document.body.classList.add("focus-bar-visible");
      clearTimeout(this._focusMouseTimer);
      this._focusMouseTimer = setTimeout(() => {
        document.body.classList.remove("focus-bar-visible");
      }, 2000);
    };

    // Sync focus mode when native browser fullscreen is dismissed externally
    // (e.g. user presses F11 or OS shortcut to exit fullscreen)
    this._onFullscreenChange = () => {
      if (this._focusMode && !document.fullscreenElement) {
        this._toggleFocus();
      }
    };

    Object.seal(this);
  }

  /** Returns "pdf", "epub", or null */
  static getType(file) {
    return getReadableType(file);
  }

  _ondownload() {
    if (!this.file) {
      return;
    }
    const a = document.createElement("a");
    a.href = this.file.url;
    a.download = this.file.name;
    a.rel = "nofollow,noindex";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** Open the reader overlay for `file`. */
  async open(file) {
    const rtype = getReadableType(file);
    dbg(
      "Reader.open() file =",
      file && file.name,
      "url =",
      file && file.url,
      "type =",
      file && file.type,
      "meta.type =",
      file && file.meta && file.meta.type,
      "detected rtype =",
      rtype,
    );

    if (!rtype || !this.el) {
      dbg("Reader.open() early-exit: rtype =", rtype, "el =", !!this.el);
      return false;
    }

    this.close(); // Destroy any previous reader
    this.file = file;
    this._readerType = rtype;

    if (this.titleEl) {
      this.titleEl.textContent = file.name;
    }
    if (this.infoEl) {
      this.infoEl.textContent = "Loading…";
    }

    // Show reader, hide filelist
    document.body.classList.add("reading");
    document.body.addEventListener("keydown", this._onKey, true);

    // Toggle zoom / prev-next / mode controls
    const isPdf = rtype === "pdf";
    const isBook = rtype === "epub" || rtype === "mobi";
    const isComic = rtype === "comic";
    if (this.zoomInEl) {
      this.zoomInEl.classList.toggle("hidden", !isPdf);
    }
    if (this.zoomOutEl) {
      this.zoomOutEl.classList.toggle("hidden", !isPdf);
    }
    if (this.prevEl) {
      this.prevEl.classList.toggle("hidden", !(isBook || isComic));
    }
    if (this.nextEl) {
      this.nextEl.classList.toggle("hidden", !(isBook || isComic));
    }
    // Show/hide the manga+webtoon pill as a unit; initialise mode active states.
    if (this.viewPillEl) {
      this.viewPillEl.classList.toggle("hidden", !isComic);
    }
    if (this.readerOptsEl) {
      this.readerOptsEl.classList.toggle("hidden", !isBook);
    }
    // Always close opts modal on open
    this._closeOptsModal();
    if (this.mangaEl) {
      this.mangaEl.classList.toggle(
        "active",
        isComic && this._mangaMode && !this._webtoonMode,
      );
    }
    if (this.webtoonEl) {
      this.webtoonEl.classList.toggle("active", isComic && this._webtoonMode);
    }

    dbg(
      "Reader.open() starting renderer, isPdf =",
      isPdf,
      "contentEl =",
      this.contentEl,
      "contentEl dimensions:",
      this.contentEl && this.contentEl.clientWidth,
      "x",
      this.contentEl && this.contentEl.clientHeight,
    );

    try {
      if (isPdf) {
        this._renderer = new PDFReader(this.contentEl, this.infoEl);
        await this._renderer.open(file.url, file.key);
      } else if (isComic) {
        await this._openComicRenderer();
      } else {
        this._renderer = new BookReader(this.contentEl, this.infoEl);
        await this._renderer.open(file.url, rtype, file.key);
      }
    } catch (ex) {
      dbgErr("Reader open error", ex);
      if (this.infoEl) {
        this.infoEl.textContent = "Failed to load — " + (ex.message || ex);
      }
      if (this.contentEl) {
        dbgShow(this.contentEl, `OPEN ERROR: ${ex.message || ex}`, true);
        if (ex.stack) {
          dbgShow(this.contentEl, ex.stack, true);
        }
      }
    }

    return true;
  }

  /** (Re)build the comic renderer for the current file + mode. */
  async _openComicRenderer() {
    if (this._renderer) {
      this._renderer.destroy();
      this._renderer = null;
    }
    if (!this.file) return;
    if (this._webtoonMode) {
      this._renderer = new WebtoonReader(this.contentEl, this.infoEl);
      await this._renderer.open(this.file);
    } else {
      this._renderer = new ComicReader(this.contentEl, this.infoEl);
      this._renderer.setMangaMode(this._mangaMode);
      await this._renderer.open(this.file);
    }
  }

  _toggleOptsModal() {
    if (this._optsOpen) {
      this._closeOptsModal();
    } else {
      this._openOptsModal();
    }
  }

  _openOptsModal() {
    if (!this.readerOptsModalEl) return;
    this._optsOpen = true;
    this._updateOptsUI();
    this.readerOptsModalEl.classList.remove("hidden");
    if (this.readerOptsEl) this.readerOptsEl.classList.add("active");
  }

  _closeOptsModal() {
    if (!this.readerOptsModalEl) return;
    this._optsOpen = false;
    this.readerOptsModalEl.classList.add("hidden");
    if (this.readerOptsEl) this.readerOptsEl.classList.remove("active");
  }

  /**
   * Apply a partial opts update: save to localStorage and re-render the book.
   * @param {object} patch — partial opts object
   */
  _applyReaderOpt(patch) {
    const current = loadReaderOpts();
    const updated = { ...current, ...patch };
    saveReaderOpts(updated);
    // If a book is open, re-render with new opts
    if (this._renderer && this._renderer.applyOpts) {
      this._renderer.applyOpts(updated);
    }
  }

  /** Sync the active states in the opts modal UI to current persisted opts. */
  _updateOptsUI() {
    if (!this.readerOptsModalEl) return;
    const opts = loadReaderOpts();

    // Font family
    this.readerOptsModalEl.querySelectorAll(".rom-font-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.font === opts.fontFamily);
    });

    // Font size display
    const sizeValEl = this.readerOptsModalEl.querySelector("#rom-size-val");
    if (sizeValEl) {
      sizeValEl.textContent = Math.round(opts.fontSize * 100) + "%";
    }

    // Line spacing
    this.readerOptsModalEl
      .querySelectorAll("#rom-spacing-row .rom-choice-btn")
      .forEach((btn) => {
        btn.classList.toggle(
          "active",
          Math.abs(parseFloat(btn.dataset.spacing) - opts.lineSpacing) < 0.01,
        );
      });

    // Margins
    this.readerOptsModalEl
      .querySelectorAll("#rom-margin-row .rom-choice-btn")
      .forEach((btn) => {
        btn.classList.toggle(
          "active",
          parseInt(btn.dataset.margin, 10) === opts.margin,
        );
      });
  }

  _toggleFocus() {
    this._focusMode = !this._focusMode;
    document.body.classList.toggle("focus-reading", this._focusMode);
    if (this._focusMode) {
      document.addEventListener("mousemove", this._onFocusMouseMove);
      document.addEventListener("fullscreenchange", this._onFullscreenChange);
      // Enter browser native fullscreen so the OS chrome disappears too
      try {
        document.documentElement.requestFullscreen();
      } catch (_) {
        // ignore — unsupported contexts (iframes, some browsers)
      }
      // Show bar briefly on entry
      this._onFocusMouseMove();
    } else {
      document.removeEventListener("mousemove", this._onFocusMouseMove);
      document.removeEventListener(
        "fullscreenchange",
        this._onFullscreenChange,
      );
      clearTimeout(this._focusMouseTimer);
      document.body.classList.remove("focus-bar-visible");
      // Exit browser native fullscreen if it is still active
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen();
        } catch (_) {}
      }
    }
    if (this.fullscreenEl) {
      this.fullscreenEl.classList.toggle("active", this._focusMode);
    }
  }

  close() {
    if (this._renderer) {
      this._renderer.destroy();
      this._renderer = null;
    }
    // Exit focus mode if active
    if (this._focusMode) this._toggleFocus();
    // Close opts modal if open
    this._closeOptsModal();
    this.file = null;
    this._readerType = null;
    document.body.classList.remove("reading");
    document.body.removeEventListener("keydown", this._onKey, true);
  }

  /** Route "prev" or "next" click/key to the appropriate renderer. */
  _paginatePage(dir) {
    if (this._renderer instanceof BookReader) {
      this._bookPage(dir);
    } else if (
      this._renderer instanceof ComicReader ||
      this._renderer instanceof WebtoonReader
    ) {
      this._comicPage(dir);
    }
  }

  _zoom(delta) {
    if (this._renderer instanceof PDFReader) {
      this._renderer.setZoom(delta);
    }
  }

  /** Navigate one page within the current chapter (or wrap to adjacent chapter). */
  _bookPage(dir) {
    if (this._renderer instanceof BookReader) {
      if (dir === "prev") this._renderer.prevPage();
      else this._renderer.nextPage();
    }
  }

  /** Navigate comics by one page (or scroll 25% in webtoon mode). */
  _comicPage(dir) {
    if (
      this._renderer instanceof ComicReader ||
      this._renderer instanceof WebtoonReader
    ) {
      if (dir === "prev") this._renderer.prevPage();
      else this._renderer.nextPage();
    }
  }

  /** Jump to the previous or next chapter. */
  _bookChapter(dir) {
    if (this._renderer instanceof BookReader) {
      if (dir === "prev") this._renderer.prevChapter();
      else this._renderer.nextChapter();
    }
  }

  _pdf(dir) {
    if (this._renderer instanceof PDFReader) {
      if (dir === "prev") {
        this._renderer.prevPage();
      } else {
        this._renderer.nextPage();
      }
    }
  }

  _onKey(e) {
    if (e.key === "Escape") {
      if (this._focusMode) {
        this._toggleFocus();
        nukeEvent(e);
        return;
      }
      this.close();
      nukeEvent(e);
    } else if (e.key === "ArrowLeft") {
      // Left arrow: previous page (PDF/comic) or previous page within chapter (book)
      if (this._readerType === "pdf") this._pdf("prev");
      else if (this._readerType === "comic") this._comicPage("prev");
      else this._bookPage("prev");
      nukeEvent(e);
    } else if (e.key === "ArrowRight") {
      // Right arrow: next page (PDF/comic) or next page within chapter (book)
      if (this._readerType === "pdf") this._pdf("next");
      else if (this._readerType === "comic") this._comicPage("next");
      else this._bookPage("next");
      nukeEvent(e);
    } else if (e.key === "ArrowUp") {
      if (this._readerType === "pdf") {
        this._pdf("prev");
        nukeEvent(e);
      } else if (this._readerType === "comic" && this._webtoonMode) {
        this._comicPage("prev");
        nukeEvent(e);
      }
    } else if (e.key === "ArrowDown") {
      if (this._readerType === "pdf") {
        this._pdf("next");
        nukeEvent(e);
      } else if (this._readerType === "comic" && this._webtoonMode) {
        this._comicPage("next");
        nukeEvent(e);
      }
    } else if (e.key === "PageUp") {
      if (this._readerType === "comic" && this._webtoonMode) {
        // PageUp in webtoon = scroll back one full page height
        if (this._renderer instanceof WebtoonReader) {
          this._renderer.container.scrollBy({
            top: -this._renderer._pageHeight,
            behavior: "smooth",
          });
        }
        nukeEvent(e);
      } else if (this._readerType !== "pdf") {
        this._bookChapter("prev");
        nukeEvent(e);
      }
    } else if (e.key === "PageDown") {
      if (this._readerType === "comic" && this._webtoonMode) {
        // PageDown in webtoon = scroll forward one full page height
        if (this._renderer instanceof WebtoonReader) {
          this._renderer.container.scrollBy({
            top: this._renderer._pageHeight,
            behavior: "smooth",
          });
        }
        nukeEvent(e);
      } else if (this._readerType !== "pdf") {
        this._bookChapter("next");
        nukeEvent(e);
      }
    } else if (e.key === "f" || e.key === "F") {
      this._toggleFocus();
      nukeEvent(e);
    }
  }
}
