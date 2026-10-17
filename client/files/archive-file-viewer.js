"use strict";

import Modal from "../modal";
import { dom } from "../util";

const API_ROOT = "/api/v1/archive";
const IMAGE_TYPES = {
  ".avif": "image/avif", ".bmp": "image/bmp", ".gif": "image/gif",
  ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp",
};
const VIDEO_TYPES = {
  ".m4v": "video/mp4", ".mov": "video/quicktime", ".mp4": "video/mp4",
  ".ogv": "video/ogg", ".webm": "video/webm",
};
const AUDIO_TYPES = {
  ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
};

function extensionOf(name) {
  const match = String(name || "").toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match ? match[0] : "";
}

function entryUrl(key, entryPath, extra = {}) {
  const url = new URL(`${API_ROOT}/${encodeURIComponent(key)}/file`, location.origin);
  url.searchParams.set("path", entryPath);
  for (const [name, value] of Object.entries(extra)) {
    url.searchParams.set(name, String(value));
  }
  return url.href;
}

function comicUrl(key, entryPath, extra = {}) {
  const url = new URL(`${API_ROOT}/${encodeURIComponent(key)}/comic`, location.origin);
  url.searchParams.set("path", entryPath);
  for (const [name, value] of Object.entries(extra)) {
    url.searchParams.set(name, String(value));
  }
  return url.href;
}

class ArchiveFileViewerModal extends Modal {
  constructor({ name, archiveKey, archivePath }) {
    super("modelviewer", name, { text: "Close", cancel: true });
    this.name = name;
    this.archiveKey = archiveKey;
    this.archivePath = archivePath;
    this.extension = extensionOf(archivePath || name);
    this.objectUrl = null;
    this.reader = null;
    this.abortController = new AbortController();
    this.el.classList.add("archive-content-viewer");
    this.el.setAttribute("aria-label", `File viewer: ${name}`);
    this.statusEl = dom("div", {
      classes: ["model-viewer-status"],
      attrs: { "role": "status", "aria-live": "polite" },
    });
    this.statusTextEl = dom("span", { text: "Opening file…" });
    this.statusEl.appendChild(this.statusTextEl);
    this.body.appendChild(this.statusEl);
    this.viewerHost = dom("div", { classes: ["model-viewer-host", "archive-content-host"] });
    this.body.appendChild(this.viewerHost);
    this.downloadButton = dom("button", {
      classes: ["modal-button", "modal-button-default"],
      attrs: { type: "button", title: `Download ${name}` },
      text: "Download",
    });
    this.downloadButton.addEventListener("click", () => {
      const link = dom("a", { attrs: { href: entryUrl(this.archiveKey, this.archivePath) } });
      link.download = this.archivePath.split("/").pop() || this.name;
      link.hidden = true;
      this.el.appendChild(link);
      link.click();
      link.remove();
    });
    this.buttonsEl.insertBefore(this.downloadButton, this.buttonsEl.firstChild);
  }

  onshown() {
    super.onshown();
    this.openFile().catch(error => {
      if (error.name === "AbortError") {
        return;
      }
      console.error("Archive content preview failed:", error);
      this.showError(error.message || "This file could not be opened.");
    });
  }

  async loadObjectUrl(mimeType) {
    const response = await fetch(entryUrl(this.archiveKey, this.archivePath), {
      credentials: "same-origin",
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 413 ?
        "This file is too large to preview in the browser. Download it from the archive instead." :
        `The archive file could not be read (server returned ${response.status}).`);
    }
    const bytes = await response.arrayBuffer();
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    return this.objectUrl;
  }

  async openFile() {
    if (this.extension === ".pdf") {
      const url = await this.loadObjectUrl("application/pdf");
      this.statusTextEl.textContent = "Loading PDF…";
      const { PDFReader } = await import("./reader/pdf");
      this.reader = new PDFReader(this.viewerHost, this.statusTextEl);
      await this.reader.open(url, null);
      return;
    }
    if (this.extension === ".epub") {
      const url = await this.loadObjectUrl("application/epub+zip");
      this.statusTextEl.textContent = "Loading book…";
      const { BookReader } = await import("./reader/book");
      this.reader = new BookReader(this.viewerHost, this.statusTextEl);
      await this.reader.open(url, "epub", null);
      const controls = dom("span", { classes: ["archive-reader-controls"] });
      const prev = dom("button", { attrs: { "type": "button", "aria-label": "Previous page" }, text: "‹" });
      const next = dom("button", { attrs: { "type": "button", "aria-label": "Next page" }, text: "›" });
      prev.addEventListener("click", () => this.reader?.prevPage());
      next.addEventListener("click", () => this.reader?.nextPage());
      controls.append(prev, next);
      this.statusEl.appendChild(controls);
      return;
    }
    if ([".cbz", ".cbr", ".cbt"].includes(this.extension)) {
      await this.openComic();
      return;
    }

    const mimeType = IMAGE_TYPES[this.extension] || VIDEO_TYPES[this.extension] || AUDIO_TYPES[this.extension];
    if (!mimeType) {
      throw new Error("This file format is not supported for in-archive preview.");
    }
    if (IMAGE_TYPES[this.extension]) {
      const url = await this.loadObjectUrl(mimeType);
      const image = dom("img", {
        classes: ["archive-content-image"],
        attrs: { alt: this.name },
      });
      image.src = url;
      this.viewerHost.appendChild(image);
      this.statusTextEl.textContent = this.name;
      return;
    }
    const media = dom(VIDEO_TYPES[this.extension] ? "video" : "audio", {
      classes: ["archive-content-media"],
      attrs: { controls: true, preload: "metadata", playsinline: true },
    });
    media.src = entryUrl(this.archiveKey, this.archivePath, { inline: 1 });
    this.viewerHost.appendChild(media);
    this.statusTextEl.textContent = this.name;
  }

  async openComic() {
    this.statusTextEl.textContent = "Reading comic contents…";
    const response = await fetch(comicUrl(this.archiveKey, this.archivePath, { index: 1 }), {
      credentials: "same-origin",
      signal: this.abortController.signal,
    });
    if (!response.ok) {
      throw new Error(response.status === 413 ?
        "This comic is too large to preview in the browser." :
        `The comic could not be opened (server returned ${response.status}).`);
    }
    const { pages } = await response.json();
    if (!pages) {
      throw new Error("This comic archive does not contain readable image pages.");
    }
    this.pageCount = pages;
    this.page = 0;
    this.comicImage = dom("img", {
      classes: ["archive-content-image", "archive-comic-page"],
      attrs: { alt: `${this.name}, page 1` },
    });
    this.viewerHost.appendChild(this.comicImage);
    this.comicControls = dom("div", { classes: ["archive-comic-controls"] });
    this.prevButton = dom("button", {
      attrs: { "type": "button", "aria-label": "Previous page" }, text: "Previous",
    });
    this.nextButton = dom("button", {
      attrs: { "type": "button", "aria-label": "Next page" }, text: "Next",
    });
    this.pageLabel = dom("span", { attrs: { "aria-live": "polite" } });
    this.prevButton.addEventListener("click", () => this.showComicPage(this.page - 1));
    this.nextButton.addEventListener("click", () => this.showComicPage(this.page + 1));
    this.comicControls.append(this.prevButton, this.pageLabel, this.nextButton);
    this.viewerHost.appendChild(this.comicControls);
    this.showComicPage(0);
  }

  showComicPage(page) {
    this.page = Math.max(0, Math.min(page, this.pageCount - 1));
    this.comicImage.src = comicUrl(this.archiveKey, this.archivePath, { page: this.page });
    this.comicImage.alt = `${this.name}, page ${this.page + 1}`;
    this.pageLabel.textContent = `Page ${this.page + 1} / ${this.pageCount}`;
    this.prevButton.disabled = this.page === 0;
    this.nextButton.disabled = this.page + 1 >= this.pageCount;
    this.statusTextEl.textContent = this.name;
  }

  showError(message) {
    this.statusEl.classList.add("is-error");
    this.statusTextEl.textContent = message;
  }

  onhidden() {
    this.abortController.abort();
    this.reader?.destroy();
    this.reader = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.viewerHost.textContent = "";
  }
}

export function openArchiveFileViewer(options) {
  return import("../registry").then(({ default: registry }) =>
    registry.roomie.showModal(new ArchiveFileViewerModal(options)));
}
