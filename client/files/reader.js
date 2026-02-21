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

const PDF_WORKER_SRC = "/pdf.worker.js";

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
    this._destroyed = false;
  }

  async open(url) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

    this.pdfDoc = await pdfjsLib.getDocument({
      url,
      disableAutoFetch: false,
      disableStream: false,
      rangeChunkSize: 65536,
    }).promise;

    this.totalPages = this.pdfDoc.numPages;
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

      // Placeholder keeps layout height before render
      const placeholder = dom("div", { classes: ["reader-page-placeholder"] });
      placeholder.style.height = "1100px"; // approx A4 at scale 1.4
      wrapper.appendChild(placeholder);

      this.container.appendChild(wrapper);
      this.canvases.push(wrapper);
    }
  }

  _setupObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10);
            if (!this.renderedPages.has(pageNum)) {
              this._renderPage(pageNum, entry.target);
            }
          }
        }
      },
      {
        root: this.container.parentElement,
        rootMargin: "200px 0px 200px 0px",
        threshold: 0,
      },
    );

    for (const wrapper of this.canvases) {
      this.observer.observe(wrapper);
    }

    // Immediately render first 2 pages
    if (this.canvases[0]) {
      this._renderPage(1, this.canvases[0]);
    }
    if (this.canvases[1]) {
      this._renderPage(2, this.canvases[1]);
    }
  }

  async _renderPage(pageNum, wrapperEl) {
    if (this.renderedPages.has(pageNum) || this._destroyed) {
      return;
    }
    this.renderedPages.add(pageNum);

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.scale });

      const canvas = dom("canvas", { classes: ["reader-page-canvas"] });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Replace placeholder
      wrapperEl.textContent = "";
      wrapperEl.appendChild(canvas);
      wrapperEl.style.minHeight = "";

      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Scroll-tracking: which page is visible
      this._trackVisible(wrapperEl, pageNum);
    } catch (ex) {
      console.error("PDF render page error:", ex);
    }
  }

  _trackVisible(wrapperEl, pageNum) {
    const vis = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this._updateInfo(pageNum, this.totalPages);
        }
      },
      {
        root: this.container.parentElement,
        threshold: 0.3,
      },
    );
    vis.observe(wrapperEl);
  }

  setZoom(delta) {
    this.scale = Math.max(0.6, Math.min(3.0, this.scale + delta));
    // Re-render visible pages at new scale
    this.renderedPages.clear();
    this._buildPagePlaceholders();
    if (this.observer) {
      this.observer.disconnect();
    }
    this._setupObserver();
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
    const Epub = (await import("epubjs")).default;

    this.book = new Epub(url, { openAs: "epub" });

    const iframeWrap = dom("div", { classes: ["reader-epub-wrap"] });
    this.container.textContent = "";
    this.container.appendChild(iframeWrap);

    this.rendition = this.book.renderTo(iframeWrap, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: "paginated",
    });

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

    await this.rendition.display();

    this.book.loaded.spine.then(() => {
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

    this.file = null;
    this._renderer = null;
    this._readerType = null;

    this._onKey = this._onKey.bind(this);

    if (this.closeEl) {
      this.closeEl.addEventListener("click", this.close.bind(this));
    }
    if (this.zoomInEl) {
      this.zoomInEl.addEventListener("click", () => this._zoom(0.2));
    }
    if (this.zoomOutEl) {
      this.zoomOutEl.addEventListener("click", () => this._zoom(-0.2));
    }
    if (this.prevEl) {
      this.prevEl.addEventListener("click", () => this._epub("prev"));
    }
    if (this.nextEl) {
      this.nextEl.addEventListener("click", () => this._epub("next"));
    }

    Object.seal(this);
  }

  /** Returns "pdf", "epub", or null */
  static getType(file) {
    return getReadableType(file);
  }

  /** Open the reader overlay for `file`. */
  async open(file) {
    const rtype = getReadableType(file);
    if (!rtype || !this.el) {
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

    try {
      if (isPdf) {
        this._renderer = new PDFReader(this.contentEl, this.infoEl);
        await this._renderer.open(file.url);
      } else {
        this._renderer = new EpubReader(this.contentEl, this.infoEl);
        await this._renderer.open(file.url);
      }
    } catch (ex) {
      console.error("Reader open error:", ex);
      if (this.infoEl) {
        this.infoEl.textContent = "Failed to load — " + (ex.message || ex);
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

  _onKey(e) {
    if (e.key === "Escape") {
      this.close();
      nukeEvent(e);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      this._epub("prev");
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      this._epub("next");
    }
  }
}
