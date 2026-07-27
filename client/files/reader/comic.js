"use strict";

import { loadProgress, saveProgress } from "./opts";
import { dom } from "../../util";

import { loadReaderOpts, saveReaderOpts } from "./opts";

function dbg(label, ...args) { console.log(`[Reader] ${label}`, ...args); }
function dbgErr(label, err) { console.error(`[Reader] ${label}`, err); }
function dbgShow(container, text, isError = false) {
  if (!container) return;
  const el = document.createElement("div");
  el.style.cssText = `font:12px/1.6 monospace;padding:4px 10px;color:${isError ? "#f87171" : "#94a3b8"};white-space:pre-wrap;word-break:break-all;`;
  el.textContent = text;
  container.appendChild(el);
}

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

  _showPage(n) {
    if (this._destroyed) {
      return;
    }
    const clamped = Math.max(0, Math.min(n, this._totalPages - 1));
    this._currentPage = clamped;
    this._updateInfo();
    saveProgress(this._fileKey, { page: clamped });
    if (this.onPageChange) {
      this.onPageChange(clamped);
    }

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

class WebtoonReader {
  constructor(container, infoEl) {
    this.container = container;
    this.infoEl = infoEl;
    this._key = null;
    this._totalPages = 0;
    this._pageHeight = 0; // CSS-rendered height of a single page (px) — NOT naturalHeight
    this._destroyed = false;
    this._stripEl = null;
    this._imgEls = [];
    this._observer = null;
    this._visiblePage = 0; // 0-indexed page currently most visible
    this._fileKey = null;
    this._restoring = false; // true during initial position restore — blocks visTracker saves
    this._scrollSaveTimer = null; // debounce timer for scroll-stop progress save
    this._onContainerScroll = null; // stored so we can remove it in destroy()
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
    if (!this._key) {
      throw new Error("Cannot determine upload key from file href");
    }

    dbgShow(this.container, `Loading webtoon: ${file.name}`);

    const resp = await fetch(`/api/v1/comic/${this._key}/index`);
    if (!resp.ok) {
      throw new Error(`Comic index fetch failed: HTTP ${resp.status}`);
    }
    const { pages } = await resp.json();
    this._totalPages = pages;
    dbg("WebtoonReader: pages =", pages);
    if (pages === 0) {
      throw new Error("Comic archive has no readable pages");
    }

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

    // Load first page eagerly to measure CSS-rendered height, then lazy-load rest.
    // IMPORTANT: use offsetHeight, NOT naturalHeight.  naturalHeight is the image's
    // intrinsic pixel size (e.g. 2048 px); offsetHeight is what the browser actually
    // renders after applying CSS (width:100%; max-width:900px; height:auto).
    // Using naturalHeight for scrollTop calculations overshoots by the scale factor
    // (imageWidth/containerWidth), sending the user to a completely wrong position.
    await new Promise((resolve) => {
      const first = this._imgEls[0];
      first.onload = () => {
        // offsetHeight is the rendered CSS height — the correct unit for scrollTop
        this._pageHeight = first.offsetHeight || first.naturalHeight || 1400;
        resolve();
      };
      first.onerror = () => resolve();
      first.src = `/api/v1/comic/${this._key}/page/0`;
      first.setAttribute("data-loaded", "1");
    });

    // Fallback if offsetHeight is still 0 (layout not yet committed)
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
      if (n < 0 || n >= this._imgEls.length) {
        return;
      }
      const img = this._imgEls[n];
      if (!img.getAttribute("data-loaded")) {
        img.setAttribute("data-loaded", "1");
        img.src = `/api/v1/comic/${this._key}/page/${n}`;
      }
    };

    this._observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const n = parseInt(entry.target.dataset.page, 10);
          loadPage(n);
          // Stream-ahead: preload the next 10 pages
          for (let ahead = 1; ahead <= 10; ahead++) {
            loadPage(n + ahead);
          }
        }
      },
      { root: this.container, rootMargin: "600px 0px 600px 0px", threshold: 0 },
    );

    for (let i = 1; i < this._imgEls.length; i++) {
      this._observer.observe(this._imgEls[i]);
    }

    // Restore saved position BEFORE setting up the visibility tracker so that
    // the tracker does not clobber the newly-restored page with page 0.
    const saved = loadProgress(this._fileKey);
    if (saved && saved.page > 0 && saved.page < this._totalPages) {
      // Give all unloaded images a provisional min-height equal to the
      // rendered height of page 0 (offsetHeight, same coordinate space as
      // scrollTop).  scrollIntoView then lands exactly on the right page.
      // Each image clears its own min-height once it actually loads so the
      // browser's scroll-anchoring logic keeps the viewport stable.
      for (const img of this._imgEls) {
        if (!img.getAttribute("data-loaded")) {
          img.style.minHeight = `${this._pageHeight}px`;
          img.addEventListener(
            "load",
            () => {
              img.style.minHeight = "";
            },
            { once: true },
          );
        }
      }
      // Pre-load frames around the target page so they render quickly.
      for (
        let i = Math.max(0, saved.page - 2);
        i <= Math.min(this._totalPages - 1, saved.page + 10);
        i++
      ) {
        loadPage(i);
      }
      // scrollIntoView is the reliable path when placeholder heights are set.
      this._restoring = true;
      requestAnimationFrame(() => {
        const target = this._imgEls[saved.page];
        if (target) {
          target.scrollIntoView({ behavior: "instant", block: "start" });
        }
        requestAnimationFrame(() => {
          this._restoring = false;
        });
      });
    }

    // ── Debounced scroll-stop save ─────────────────────────────────────────
    // Saves the current visible page 300 ms after the user stops scrolling.
    // Covers: mousewheel, touch-drag, scrollbar use, keyboard arrows, etc.
    this._onContainerScroll = () => {
      if (this._restoring) {
        return;
      }
      clearTimeout(this._scrollSaveTimer);
      this._scrollSaveTimer = setTimeout(() => {
        saveProgress(this._fileKey, { page: this._visiblePage });
      }, 300);
    };
    this.container.addEventListener("scroll", this._onContainerScroll, {
      passive: true,
    });

    // Separate visibility tracker: update page counter + persist progress.
    // Reads _restoring so the initial position restore cannot be overwritten.
    const visTracker = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this._visiblePage = parseInt(entry.target.dataset.page, 10);
            this._updateInfo();
            if (!this._restoring) {
              saveProgress(this._fileKey, { page: this._visiblePage });
            }
            if (this.onPageChange) {
              this.onPageChange(this._visiblePage);
            }
          }
        }
      },
      { root: this.container, rootMargin: "0px", threshold: 0.4 },
    );
    for (const img of this._imgEls) {
      visTracker.observe(img);
    }

    this._updateInfo();
  }

  /** Scroll the container down by one step; save progress immediately. */
  nextPage() {
    const step = Math.round(this._pageHeight * 0.25);
    this.container.scrollBy({ top: step, behavior: "smooth" });
    // Save current page instantly so the user never loses more than one
    // press worth of progress (debounced scroll save will also fire).
    saveProgress(this._fileKey, { page: this._visiblePage });
  }

  /** Scroll the container up by one step; save progress immediately. */
  prevPage() {
    const step = Math.round(this._pageHeight * 0.25);
    this.container.scrollBy({ top: -step, behavior: "smooth" });
    saveProgress(this._fileKey, { page: this._visiblePage });
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
    if (this._onContainerScroll) {
      this.container.removeEventListener("scroll", this._onContainerScroll);
      this._onContainerScroll = null;
    }
    clearTimeout(this._scrollSaveTimer);
    this._scrollSaveTimer = null;
    this._imgEls = [];
    this._stripEl = null;
    this.container.textContent = "";
  }
}

// ── Reader UI ─────────────────────────────────────────────────────────────────

export { ComicReader, WebtoonReader };
