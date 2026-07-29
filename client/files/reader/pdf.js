"use strict";

import { dom } from "../../util";
import { loadProgress, saveProgress } from "./opts";

function dbg(label, ...args) { console.log(`[Reader] ${label}`, ...args); }
function dbgErr(label, err) { console.error(`[Reader] ${label}`, err); }
function dbgShow(container, text, isError = false) {
  if (!container) return;
  const el = document.createElement("div");
  el.style.cssText = `font:12px/1.6 monospace;padding:4px 10px;color:${isError ? "#f87171" : "#94a3b8"};white-space:pre-wrap;word-break:break-all;`;
  el.textContent = text;
  container.appendChild(el);
}
const PDF_WORKER_SRC = `/pdf.worker.js?v=${window.__CV__ || "1"}`;

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

    // PDF.js 4 is ESM. Keep the default fallback for compatibility with
    // distributions that expose the API object as a default export.
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
        isEvalSupported: false,
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
    if (this.onPageChange) {
      this.onPageChange(current);
    }
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
export { PDFReader };
