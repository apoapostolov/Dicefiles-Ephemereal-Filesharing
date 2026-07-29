"use strict";

import { dom, nukeEvent } from "../util";
import { PDFReader } from "./reader/pdf";
import { BookReader } from "./reader/book";
import { ComicReader, WebtoonReader } from "./reader/comic";
import {
  loadReaderOpts,
  saveReaderOpts,
  pruneProgress,
} from "./reader/opts";

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
// whenever the build changes (pdf.worker.js is served immutable/30-day
// cached).
const PDF_WORKER_SRC = `/pdf.worker.js?v=${window.__CV__ || "1"}`;

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
  el.style.cssText = `font:12px/1.6 monospace;padding:4px 10px;color:${
    isError ? "#f87171" : "#94a3b8"
  };white-space:pre-wrap;word-break:break-all;`;
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

export function flushStaleProgress() {
  // Backward-compatible export. The old implementation deleted every reader
  // position not present in the currently open room, erasing other rooms.
  pruneProgress();
}

// ── Webtoon reader ───────────────────────────────────────────────────────────

/**
 * Webtoon mode: all pages rendered as a continuous vertical strip.
 * Up / down keys and the Prev/Next buttons scroll by 25% of a page's
 * natural rendered height instead of jumping to the next discrete page.
 */
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
    this._focusTransitioning = false; // true while requestFullscreen is in-flight
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
        if (this.webtoonEl) {
          this.webtoonEl.classList.remove("active");
        }
        // Re-open the current comic in the new mode
        if (this.file && this._readerType === "comic") {
          this._openComicRenderer();
        }
      });
    }
    if (this.webtoonEl) {
      this.webtoonEl.addEventListener("click", () => {
        this._webtoonMode = !this._webtoonMode;
        if (this._webtoonMode) {
          this._mangaMode = false;
        }
        try {
          localStorage.setItem("reader_webtoon", this._webtoonMode ? "1" : "0");
          localStorage.setItem("reader_manga", "0");
        } catch (_) {
          // ignore private-browsing quota errors
        }
        this.webtoonEl.classList.toggle("active", this._webtoonMode);
        if (this.mangaEl) {
          this.mangaEl.classList.remove("active");
        }
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
      if (!this._focusMode) {
        return;
      }
      document.body.classList.add("focus-bar-visible");
      clearTimeout(this._focusMouseTimer);
      this._focusMouseTimer = setTimeout(() => {
        document.body.classList.remove("focus-bar-visible");
      }, 2000);
    };

    // Sync focus mode when native browser fullscreen is dismissed externally
    // (e.g. user presses Escape or F11 to exit fullscreen).  Guard against the
    // transition window where fullscreenElement momentarily reads null while the
    // browser is still completing entry.
    this._onFullscreenChange = () => {
      if (
        !this._focusTransitioning &&
        this._focusMode &&
        !document.fullscreenElement
      ) {
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
        this.infoEl.textContent = `Failed to load — ${ex.message || ex}`;
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
    if (!this.file) {
      return;
    }
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
    if (!this.readerOptsModalEl) {
      return;
    }
    this._optsOpen = true;
    this._updateOptsUI();
    this.readerOptsModalEl.classList.remove("hidden");
    if (this.readerOptsEl) {
      this.readerOptsEl.classList.add("active");
    }
  }

  _closeOptsModal() {
    if (!this.readerOptsModalEl) {
      return;
    }
    this._optsOpen = false;
    this.readerOptsModalEl.classList.add("hidden");
    if (this.readerOptsEl) {
      this.readerOptsEl.classList.remove("active");
    }
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
    if (!this.readerOptsModalEl) {
      return;
    }
    const opts = loadReaderOpts();

    // Font family
    this.readerOptsModalEl.querySelectorAll(".rom-font-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.font === opts.fontFamily);
    });

    // Font size display
    const sizeValEl = this.readerOptsModalEl.querySelector("#rom-size-val");
    if (sizeValEl) {
      sizeValEl.textContent = `${Math.round(opts.fontSize * 100)}%`;
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
    // Guard against re-entrant calls fired by fullscreenchange events that
    // occur during the browser's own transition animation.
    if (this._focusTransitioning) {
      return;
    }

    this._focusMode = !this._focusMode;
    document.body.classList.toggle("focus-reading", this._focusMode);

    if (this._focusMode) {
      document.addEventListener("mousemove", this._onFocusMouseMove);
      // Attach exit-sync listener now; _focusTransitioning blocks it from
      // acting on any spurious null events during the transition window.
      document.addEventListener("fullscreenchange", this._onFullscreenChange);

      // Fullscreen the whole document so the OS viewport == full screen.
      // body.focus-reading already has #reader at position:fixed;inset:0;
      // z-index:9000, which covers the chat/sidebar in CSS.
      this._focusTransitioning = true;
      try {
        const req = document.documentElement.requestFullscreen();
        const done = () => {
          // Small delay lets all transition fullscreenchange events settle
          // before the exit-sync listener starts trusting its state.
          setTimeout(() => {
            this._focusTransitioning = false;
          }, 300);
        };
        if (req && typeof req.then === "function") {
          req.then(done).catch(() => {
            this._focusTransitioning = false;
          });
        } else {
          done();
        }
      } catch (_) {
        this._focusTransitioning = false;
      }
    } else {
      document.removeEventListener("mousemove", this._onFocusMouseMove);
      document.removeEventListener(
        "fullscreenchange",
        this._onFullscreenChange,
      );
      clearTimeout(this._focusMouseTimer);
      document.body.classList.remove("focus-bar-visible");
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen();
        } catch (_) {
          /* no-op */
        }
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
    if (this._focusMode) {
      this._toggleFocus();
    }
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
      if (dir === "prev") {
        this._renderer.prevPage();
      } else {
        this._renderer.nextPage();
      }
    }
  }

  /** Navigate comics by one page (or scroll 25% in webtoon mode). */
  _comicPage(dir) {
    if (
      this._renderer instanceof ComicReader ||
      this._renderer instanceof WebtoonReader
    ) {
      if (dir === "prev") {
        this._renderer.prevPage();
      } else {
        this._renderer.nextPage();
      }
    }
  }

  /** Jump to the previous or next chapter. */
  _bookChapter(dir) {
    if (this._renderer instanceof BookReader) {
      if (dir === "prev") {
        this._renderer.prevChapter();
      } else {
        this._renderer.nextChapter();
      }
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
      if (this._readerType === "pdf") {
        this._pdf("prev");
      } else if (this._readerType === "comic") {
        this._comicPage("prev");
      } else {
        this._bookPage("prev");
      }
      nukeEvent(e);
    } else if (e.key === "ArrowRight") {
      // Right arrow: next page (PDF/comic) or next page within chapter (book)
      if (this._readerType === "pdf") {
        this._pdf("next");
      } else if (this._readerType === "comic") {
        this._comicPage("next");
      } else {
        this._bookPage("next");
      }
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
