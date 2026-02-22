"use strict";

import { APOOL } from "../animationpool";
import BaseFile from "../file";
import registry from "../registry";
import { dom, nukeEvent, sort, toPrettyDuration, toPrettySize } from "../util";
import { REMOVALS, TTL } from "./tracker";

const META = Object.freeze(["duration", "codec", "bitrate", "type"]);

export default class File extends BaseFile {
  constructor(owner, file) {
    super(file);
    this.owner = owner;
    this.isRequest = !!(this.meta && this.meta.request);

    this.el = dom("div", { classes: ["file"] });
    if (this.isRequest) {
      this.el.classList.add("request-file");
      if ((file.status || "open") === "fulfilled") {
        this.el.classList.add("request-fulfilled");
      }
    }

    this.iconEl = dom("a", {
      attrs: {
        download: this.name,
        rel: "nofollow,noindex",
        href: this.url,
      },
      classes: ["icon", `i-${this.type}`],
    });
    this.iconEl.addEventListener("click", this.oniconclick.bind(this));
    this.el.appendChild(this.iconEl);

    this.downloadEl = dom("a", {
      attrs: {
        download: this.name,
        rel: "nofollow,noindex",
        href: this.url,
      },
      classes: ["hidden"],
    });
    this.el.appendChild(this.downloadEl);

    this.nameEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url,
      },
      classes: ["name"],
    });
    this.nameTextEl = dom("span", {
      classes: ["name-text"],
      text: this.name,
    });
    this.nameEl.appendChild(this.nameTextEl);
    this.nameEl.appendChild(
      dom("span", {
        classes: ["file-new-pill"],
        text: "NEW!",
      }),
    );
    this.requestUrlEl = null;
    // Fulfilled-request pill — appended after nameEl is ready
    if (this.isRequest && (file.status || "open") === "fulfilled") {
      this.fulfilledPillEl = dom("span", {
        classes: ["request-fulfilled-pill"],
        text: "Fulfilled",
      });
      this.nameEl.appendChild(this.fulfilledPillEl);
    }
    else {
      this.fulfilledPillEl = null;
    }
    this.copyMetaEl = null;
    this.ttlValueEl = null;
    this.nameEl.addEventListener("mouseenter", this.onenter.bind(this), {
      passive: true,
    });
    this.nameEl.addEventListener("click", this.onclick.bind(this));
    this.el.appendChild(this.nameEl);

    this.linkEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url,
      },
      classes: ["hidden"],
    });
    this.el.appendChild(this.linkEl);

    this.previewContEl = dom("a", {
      attrs: {
        target: "_blank",
        rel: "nofollow,noindex",
        href: this.url,
      },
      classes: ["preview", "galleryonly"],
    });
    this.previewContEl.addEventListener("click", this.onclick.bind(this));
    this.previewEl = dom("img", {
      classes: ["loading"],
      attrs: {
        src: "/loader.png",
      },
    });
    this.previewContEl.appendChild(this.previewEl);
    this.el.appendChild(this.previewContEl);

    this.tagsEl = dom("span", { classes: ["tags"] });
    this.el.appendChild(this.tagsEl);
    this.setupTags();

    this.detailEl = dom("span", { classes: ["detail"] });
    this.detailEl.addEventListener("click", this.ondetailclick.bind(this));
    this.el.appendChild(this.detailEl);
    this.el.addEventListener("mouseenter", this.onenter.bind(this), {
      passive: true,
    });
    this.typeEl = dom("span", {
      classes: ["galleryonly", "type-pill", `type-${this.type}`],
      text: this.getTypeLabel(),
    });
    this.detailEl.appendChild(this.typeEl);

    const { meta = {}, resolution } = this;
    if (resolution) {
      this.detailEl.appendChild(
        dom("span", {
          classes: ["galleryonly"],
          text: resolution,
        }),
      );
    }
    for (const k of META) {
      if (!meta[k]) {
        continue;
      }
      this.detailEl.appendChild(
        dom("span", {
          classes: ["galleryonly"],
          text: meta[k],
        }),
      );
    }

    if (this.isRequest) {
      const requestUrl = this.meta && this.meta.requestUrl;
      this.iconEl.classList.remove(`i-${this.type}`);
      this.iconEl.classList.add("i-question");
      this.iconEl.removeAttribute("download");
      this.iconEl.removeAttribute("href");
      this.nameEl.removeAttribute("href");
      this.linkEl.removeAttribute("href");
      this.downloadEl.removeAttribute("href");
      this.previewContEl.removeAttribute("href");
      if (requestUrl) {
        this.requestUrlEl = dom("a", {
          attrs: {
            href: requestUrl,
            target: "_blank",
            rel: "noopener noreferrer nofollow noindex",
            title: "Open request link",
          },
          classes: ["request-url", "i-info"],
        });
        this.requestUrlEl.addEventListener("click", e => {
          e.stopPropagation();
        });
        this.nameEl.appendChild(this.requestUrlEl);
      }
      this.sizeEl = dom("span", { classes: ["size", "size-placeholder"] });
      this.detailEl.appendChild(this.sizeEl);

      this.ttlEl = dom("span", {
        classes: ["ttl"],
      });
      this.ttlValueEl = dom("span", {
        classes: ["ttl-value"],
        text: "ttl",
      });
      this._updateTTL();
      TTL.add(this);
      this.ttlEl.appendChild(dom("span", { classes: ["i-clock"] }));
      this.ttlEl.appendChild(this.ttlValueEl);
      this.detailEl.appendChild(this.ttlEl);
    }
    else {
      this.copyMetaEl = dom("a", {
        attrs: {
          href: "#",
          title: "Copy file link + metadata",
        },
        classes: ["file-copy-meta-detail", "icon", "i-copy"],
      });
      this.copyMetaEl.addEventListener("click", this.oncopymeta.bind(this));

      this.sizeEl = dom("span", {
        classes: ["size"],
        text: toPrettySize(file.size),
      });
      this.detailEl.appendChild(this.sizeEl);

      this.ttlEl = dom("span", {
        classes: ["ttl"],
      });
      this.ttlValueEl = dom("span", {
        classes: ["ttl-value"],
        text: "ttl",
      });
      this._updateTTL();
      TTL.add(this);

      this.ttlEl.appendChild(dom("span", { classes: ["i-clock"] }));
      this.ttlEl.appendChild(this.ttlValueEl);
      this.ttlEl.appendChild(this.copyMetaEl);
      this.detailEl.appendChild(this.ttlEl);
    }

    // Gallery-mode per-tile download button (hidden in list mode via CSS)
    this.galleryDlEl = dom("a", {
      attrs: {
        download: this.name,
        rel: "nofollow,noindex",
        href: this.isRequest ? "" : this.url || "",
        title: "Download",
      },
      classes: ["gallery-dl", "i-download"],
    });
    this.galleryDlEl.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      if (!this.isRequest) {
        this.download();
      }
    });
    this.el.appendChild(this.galleryDlEl);

    this.setNew(!!file.isNew);
  }

  adjustPreview() {
    if (!this.previewEl.classList.contains("loading")) {
      return;
    }
    this.previewEl.classList.remove("loading");
    const preview = this.findPreview() || { type: "none" };
    const url = this.href + preview.ext;
    switch (preview.type) {
    case "video": {
      const video = dom("video", {
        attrs: {
          loop: "true",
          preload: "auto",
        },
      });
      video.appendChild(
        dom("source", {
          attrs: {
            type: preview.mime,
            src: url,
          },
        }),
      );
      this.previewContEl.replaceChild(video, this.previewEl);
      this.previewEl = video;
      this.previewContEl.addEventListener(
        "mouseenter",
        () => {
          video.currentTime = 0;
          video.play();
        },
        { passive: true },
      );
      this.previewContEl.addEventListener(
        "mouseleave",
        () => {
          video.pause();
          video.currentTime = 0;
        },
        { passive: true },
      );
      return;
    }

    case "image": {
      const loaded = new Image();
      loaded.onload = () => {
        this.previewContEl.replaceChild(loaded, this.previewEl);
        this.previewEl = loaded;
      };
      loaded.src = url;
      return;
    }

    default: {
      const faticon = dom("span", {
        classes: ["faticon", "icon", `i-${this.type}`],
      });
      this.previewContEl.replaceChild(faticon, this.previewEl);
      this.previewEl = faticon;
      return;
    }
    }
  }

  update(file) {
    const { isNew } = file;
    super.update(file);
    if (!this.el) {
      return;
    }
    if (this.isRequest) {
      const isFulfilled = (this.status || "open") === "fulfilled";
      this.el.classList.toggle("request-fulfilled", isFulfilled);
      if (isFulfilled && !this.fulfilledPillEl) {
        this.fulfilledPillEl = dom("span", {
          classes: ["request-fulfilled-pill"],
          text: "Fulfilled",
        });
        this.nameEl.appendChild(this.fulfilledPillEl);
      }
      else if (!isFulfilled && this.fulfilledPillEl) {
        this.fulfilledPillEl.remove();
        this.fulfilledPillEl = null;
      }
    }
    this.setupTags();
    if (typeof isNew === "boolean") {
      this.setNew(isNew);
    }
    this.previewEl.classList.add("loading");
    if (this.owner.galleryMode) {
      APOOL.schedule(null, () => this.adjustPreview());
    }
  }

  setNew(isNew) {
    this.el.classList.toggle("is-new", !!isNew);
  }

  setupTags() {
    const order = {
      bookauthor: 0,
      artist: 0,
      title: 1,
      description: 2,
      user: 3,
      usernick: 3,
      pages: 4,
    };
    const tags = sort(Array.from(this.tagsMap.entries()), ([tag]) => {
      if (Object.prototype.hasOwnProperty.call(order, tag)) {
        return `${order[tag]}:${tag}`;
      }
      return `9:${tag}`;
    });
    this.el.classList.remove("hidden-file");
    this.tagsEl.textContent = "";
    const bookLike = this.isBookLike();
    for (const [tn, tv] of tags) {
      if (tn === "request") {
        continue;
      }
      if (bookLike && tn === "artist" && this.tagsMap.has("bookauthor")) {
        continue;
      }
      if (tn === "hidden") {
        if (!tv || tv === "false") {
          continue;
        }
        this.el.classList.add("hidden-file");
      }
      const label = this.getTagLabel(tn);
      const tag = dom("span", {
        attrs: {
          "aria-label": `${label}: ${tv}`,
          "title": `${label}: ${tv}`,
        },
        classes: ["tag", `tag-${tn}`],
        text:
          tv === "true" || tv === "false" ?
            tn :
            tn === "pages" ?
              `${tv} ${Number(tv) === 1 ? "page" : "pages"}` :
              tv,
      });
      tag.dataset.tag = tn;
      tag.dataset.tagValue = tv;
      tag.dataset.tagLabel = label;
      if (tn === "usernick" && this.meta && this.meta.account) {
        tag.classList.add("tag-user");
      }
      if (
        (tn === "usernick" || tn === "user") &&
        this.meta &&
        this.meta.account
      ) {
        const {account} = this.meta;
        tag.classList.add("tag-user-link");
        tag.addEventListener("click", e => {
          e.stopPropagation();
          e.preventDefault();
          window.open(`/u/${account}`, "_blank");
        });
      }
      this.tagsEl.appendChild(tag);
    }
  }

  getTypeLabel() {
    if (this.isRequest) {
      return "Request";
    }
    const m = (this.name || "").match(/\.([a-z0-9]{1,8})$/i);
    if (m && m[1]) {
      return m[1].toUpperCase();
    }
    return (this.type || "file").toUpperCase();
  }

  isBookLike() {
    if (this.type !== "document") {
      return false;
    }
    const t = ((this.meta && this.meta.type) || "").toLowerCase();
    const n = (this.name || "").toLowerCase();
    if (/pdf|epub|mobi|azw|azw3|fb2|djvu|cbz|cbr|chm/.test(t)) {
      return true;
    }
    return /\.(pdf|epub|mobi|azw|azw3|fb2|djvu|cbz|cbr|chm)$/i.test(n);
  }

  getTagLabel(tag) {
    if (tag === "bookauthor") {
      return "Author";
    }
    if (tag === "artist") {
      return this.isBookLike() ? "Author" : "Artist";
    }
    if (tag === "user" || tag === "usernick") {
      return "Uploader";
    }
    return tag.replace(/\b\w/g, l => l.toUpperCase());
  }

  onenter(e) {
    this.showTooltip(e);
  }

  onclick(e) {
    try {
      if (this.isRequest) {
        if (e.altKey || e.shiftKey || e.metaKey || e.optionKey) {
          return true;
        }
        this.owner.openRequestView(this);
        return nukeEvent(e);
      }
      if (e.altKey || e.shiftKey || e.metaKey || e.optionKey) {
        return true;
      }
      if (this.owner.galleryMode && e.currentTarget === this.nameEl) {
        this.download();
        return nukeEvent(e);
      }
      if (this.getGalleryInfo()) {
        this.owner.openGallery(this);
        return nukeEvent(e);
      }
    }
    catch (ex) {
      console.error(ex);
    }
    return true;
  }

  ondetailclick(e) {
    if (this.isRequest || !this.owner.galleryMode) {
      return true;
    }
    if (e.altKey || e.shiftKey || e.metaKey || e.optionKey) {
      return true;
    }
    this.download();
    return nukeEvent(e);
  }

  oniconclick(e) {
    nukeEvent(e);
    const { classList } = document.body;
    if (classList.contains("mod") || classList.contains("owner")) {
      this.owner.select(this, e);
    }
    if (!this.isRequest) {
      this.download();
    }
  }

  buildMetadataSnippet() {
    const title = this.tagsMap.get("title") || this.name;
    const author =
      this.tagsMap.get("bookauthor") ||
      this.tagsMap.get("artist") ||
      this.tagsMap.get("usernick") ||
      this.tagsMap.get("user") ||
      "Unknown";
    const description = this.tagsMap.get("description") || "";
    const pages = this.tagsMap.get("pages") || "";
    const suggestedTags = Array.isArray(this.meta && this.meta.suggestedTags) ?
      this.meta.suggestedTags.join(", ") :
      "";
    const link = new URL(this.url, document.location.origin).href;
    return [
      `Title: ${title}`,
      `Author: ${author}`,
      pages ? `Pages: ${pages}` : "",
      description ? `Description: ${description}` : "",
      suggestedTags ? `Suggested tags: ${suggestedTags}` : "",
      `Link: ${link}`,
    ].
      filter(Boolean).
      join("\n");
  }

  async copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = dom("textarea", {
      attrs: { style: "position:fixed;left:-99999px;top:0;opacity:0" },
      text,
    });
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    }
    catch (ex) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  async oncopymeta(e) {
    nukeEvent(e);
    try {
      const payload = this.buildMetadataSnippet();
      const copied = await this.copyText(payload);
      if (!copied) {
        throw new Error("copy command failed");
      }
      registry.messages.addSystemMessage(
        `Copied metadata snippet for ${this.name}`,
      );
    }
    catch (ex) {
      registry.messages.addSystemMessage(
        `Failed to copy metadata snippet for ${this.name}`,
      );
      console.error("copy metadata failed", ex);
    }
  }

  open(e) {
    if (e) {
      this.linkEl.dispatchEvent(e);
      return;
    }
    this.linkEl.click();
  }

  download(e) {
    if (e) {
      this.downloadEl.dispatchEvent(e);
      return;
    }
    this.downloadEl.click();
  }

  getGalleryInfo() {
    if (this.isRequest) {
      return null;
    }
    if (this.type === "audio") {
      return null;
    }

    // Allow readable documents (PDF/EPUB/MOBI) into the gallery even when no
    // preview asset was generated (e.g. EPUB without embedded cover image).
    // The gallery will show title + "Read Now" button with no cover image.
    if (!this.assets.size) {
      const rtype = this.getReadableType ? this.getReadableType() : null;
      if (!rtype) {
        return null;
      }
      const infos = [
        toPrettySize(this.size),
        this.tags.user || this.tags.usernick,
      ].filter(Boolean);
      if (this.meta && this.meta.pages) {
        infos.unshift(`${this.meta.pages} pages`);
      }
      return { infos, noCover: true };
    }

    const infos = [
      toPrettySize(this.size),
      this.tags.user || this.tags.usernick,
    ];
    const { resolution, duration } = this;
    if (duration) {
      infos.unshift(duration);
    }
    if (resolution) {
      infos.unshift(resolution);
    }

    // Just display GIF files inline, to allow animated ones
    if (this.meta.type === "GIF") {
      return {
        img: this.url,
        infos,
      };
    }

    if (this.type === "video") {
      if (this.meta.type === "WEBM") {
        // Play webms inline
        return {
          video: this.url,
          infos,
        };
      }
      if (this.meta.type === "MP4" && this.meta.codec === "avc1") {
        // Play mp4+h264 inline
        return {
          video: this.url,
          infos,
        };
      }
    }

    // Prepare assets
    const { innerWidth, innerHeight } = window;
    const assets = Array.from(this.assets.values()).filter(
      e => e.type === "image",
    );
    if (!assets.length) {
      return null;
    }
    sort(assets, e => e.width * e.height);

    // Pick the best asset according to current display size
    const bestAssets = assets.filter(e => {
      if (e.width > innerWidth * 1.4) {
        return false;
      }
      if (e.height > innerHeight * 1.4) {
        return false;
      }
      return true;
    });
    const sorter = e => {
      return [
        !(
          Math.abs(e.width - innerWidth) < 100 &&
          Math.abs(e.height - innerHeight) < 100
        ),
        e.width * e.height,
      ];
    };
    sort(bestAssets, sorter);

    // Bring it all together
    const img = this.href + bestAssets.pop().ext;
    const srcset = assets.
      map(e => `${this.href}${e.ext} ${e.width}w`).
      join(", ");
    const largest = assets.pop();
    const sizes = `${assets.map(e => `(max-width: ${e.width}px) ${e.width}px`).join(", ")}, ${largest.width}px`;
    return {
      img,
      srcset,
      sizes,
      infos,
    };
  }

  _updateTTL() {
    if (!this.ttlValueEl) {
      return;
    }
    const diff = Math.max(0, this.ttl);
    this.ttlValueEl.textContent = toPrettyDuration(diff, true);
  }

  remove() {
    TTL.delete(this);
    REMOVALS.add(this);
    this.owner.maybeCloseGallery(this);
    super.remove();
  }
}

File.prototype.updateTTL = APOOL.wrap(File.prototype._updateTTL);
