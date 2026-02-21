"use strict";

import { dom, nukeEvent } from "../util";

/**
 * Streaming PDF / ePub in-page reader.
 *
 * PDF rendering: Mozilla PDF.js (Apache-2.0 / FOSS)
 *   - Streams pages via HTTP Range requests (server already supports these)
 *   - Renders pages lazily via IntersectionObserver as user scrolls
 *
 * ePub rendering: epub.js (BSD-2)
 *   - Fetches and parses the epub ZIP client-side
 *   - Renders chapters in an iframe, with prev/next navigation
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
    return "epub"; // best-effort: attempt to render with epub.js
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
  }

  async open(url) {
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

    this._updateInfo(0, this.totalPages);
    this._buildPagePlaceholders();
    this._setupObserver();
  }

  _updateInfo(current, total) {
    if (this.infoEl) {
      this.infoEl.textContent = total ? `Page ${current} / ${total}` : "";
    }
  }

  _buildPagePlaceholders() {
    this.container.textContent = "";
    this.canvases = [];

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

    // Immediately render first 2 pages
    if (this.canvases[0]) {
      dbg("_setupObserver: force-rendering page 1");
      this._renderPage(1, this.canvases[0]);
    }
    if (this.canvases[1]) {
      dbg("_setupObserver: force-rendering page 2");
      this._renderPage(2, this.canvases[1]);
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

// ── ePub renderer ─────────────────────────────────────────────────────────────

class EpubReader {
  constructor(container, infoEl) {
    this.container = container;
    this.infoEl = infoEl;
    this.book = null;
    this.rendition = null;
    this._destroyed = false;
  }

  async open(url) {
    dbg("EpubReader.open() url =", url);

    let Epub;
    try {
      Epub = (await import("epubjs")).default;
      dbg("epubjs imported, Epub =", typeof Epub);
    } catch (ex) {
      dbgErr("epubjs import failed", ex);
      dbgShow(
        this.container,
        `FATAL: epubjs import failed: ${ex.message}`,
        true,
      );
      throw ex;
    }

    this.book = new Epub(url, { openAs: "epub" });
    dbg("Epub book created");

    const iframeWrap = dom("div", { classes: ["reader-epub-wrap"] });
    this.container.textContent = "";
    this.container.appendChild(iframeWrap);

    this.rendition = this.book.renderTo(iframeWrap, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: "paginated",
      allowScriptedContent: true,
    });
    // After epubjs creates the iframe, remove the sandbox attribute entirely.
    // Without it there's no "allow-scripts + allow-same-origin" browser warning,
    // and the same-origin epub content still runs correctly.
    this.rendition.on("rendered", (_section, view) => {
      if (view && view.iframe) {
        view.iframe.removeAttribute("sandbox");
      }
    });
    dbg("rendition created");

    this.rendition.themes.default({
      body: {
        "font-size": "1.05em",
        "line-height": "1.7",
        color: "#e8e8e8",
        background: "#1a1a1a",
        padding: "1.5em 2em",
      },
      a: { color: "#7ec8e3" },
    });

    try {
      await this.rendition.display();
      dbg("rendition.display() complete");
    } catch (ex) {
      dbgErr("rendition.display() failed", ex);
      dbgShow(
        this.container,
        `FATAL: epub display failed: ${ex.message}`,
        true,
      );
      throw ex;
    }

    this.book.loaded.spine.then(() => {
      dbg("epub spine loaded");
      this._updateInfo();
    });

    this.rendition.on("relocated", () => {
      this._updateInfo();
    });
  }

  _updateInfo() {
    if (!this.infoEl || !this.book || !this.rendition) {
      return;
    }
    try {
      const loc = this.rendition.currentLocation();
      if (!loc || !loc.start) {
        return;
      }
      const spineItems = this.book.spine.items;
      const idx = spineItems.findIndex((i) => i.href === loc.start.href);
      this.infoEl.textContent = `Chapter ${Math.max(0, idx) + 1} / ${spineItems.length}`;
    } catch (ex) {
      // location info unavailable yet
    }
  }

  next() {
    if (this.rendition) {
      this.rendition.next();
    }
  }

  prev() {
    if (this.rendition) {
      this.rendition.prev();
    }
  }

  destroy() {
    this._destroyed = true;
    if (this.book) {
      this.book.destroy();
      this.book = null;
    }
    this.rendition = null;
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
      this.prevEl.addEventListener("click", () => this._epub("prev"));
    }
    if (this.nextEl) {
      this.nextEl.addEventListener("click", () => this._epub("next"));
    }
    if (this.downloadEl) {
      this.downloadEl.addEventListener("click", this._ondownload.bind(this));
    }

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

    // Toggle zoom / prev-next controls
    const isPdf = rtype === "pdf";
    if (this.zoomInEl) {
      this.zoomInEl.classList.toggle("hidden", !isPdf);
    }
    if (this.zoomOutEl) {
      this.zoomOutEl.classList.toggle("hidden", !isPdf);
    }
    if (this.prevEl) {
      this.prevEl.classList.toggle("hidden", isPdf);
    }
    if (this.nextEl) {
      this.nextEl.classList.toggle("hidden", isPdf);
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
        await this._renderer.open(file.url);
      } else {
        this._renderer = new EpubReader(this.contentEl, this.infoEl);
        // Use the pre-converted EPUB asset URL for MOBI files; fall back to
        // the raw file URL for native EPUB files.
        await this._renderer.open(file.readableUrl || file.url);
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

  close() {
    if (this._renderer) {
      this._renderer.destroy();
      this._renderer = null;
    }
    this.file = null;
    this._readerType = null;
    document.body.classList.remove("reading");
    document.body.removeEventListener("keydown", this._onKey, true);
  }

  _zoom(delta) {
    if (this._renderer instanceof PDFReader) {
      this._renderer.setZoom(delta);
    }
  }

  _epub(dir) {
    if (this._renderer instanceof EpubReader) {
      this._renderer[dir]();
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
      this.close();
      nukeEvent(e);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      if (this._readerType === "pdf") {
        this._pdf("prev");
        nukeEvent(e);
      } else {
        this._epub("prev");
      }
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      if (this._readerType === "pdf") {
        this._pdf("next");
        nukeEvent(e);
      } else {
        this._epub("next");
      }
    }
  }
}
