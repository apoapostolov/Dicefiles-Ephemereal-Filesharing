"use strict";

import { APOOL } from "../animationpool";
import { nukeEvent } from "../util";
import Reader from "./reader";

export default class Gallery {
  constructor(owner) {
    this.owner = owner;
    this.el = document.querySelector("#gallery");
    this.imgEl = document.querySelector("#gallery_img");
    this.closeEl = document.querySelector("#gallery_close");
    this.titleEl = document.querySelector("#gallery_title");
    this.infoEl = document.querySelector("#gallery_info");
    this.prevEl = document.querySelector("#gallery_prev");
    this.nextEl = document.querySelector("#gallery_next");
    this.readNowEl = document.querySelector("#gallery_read_now");
    this.file = null;

    this.reader = new Reader();

    this.auxTimer = 0;
    this.startHideAux = this.startHideAux.bind(this);
    this.hideAux = this.hideAux.bind(this);
    this.showAux = this.showAux.bind(this);

    this.onimgclick = this.onimgclick.bind(this);
    this.ontitleclick = this.ontitleclick.bind(this);
    this.onpress = this.onpress.bind(this);
    this.onwheel = this.onwheel.bind(this);
    this.onreadnow = this.onreadnow.bind(this);

    Object.seal(this);

    this.el.addEventListener("mousemove", this.startHideAux, { passive: true });
    this.el.addEventListener("click", this.onclose.bind(this), true);
    this.closeEl.addEventListener("click", this.close.bind(this), true);
    this.titleEl.addEventListener("click", this.ontitleclick);

    this.prevEl.addEventListener("click", this.prev.bind(this), true);
    this.nextEl.addEventListener("click", this.next.bind(this), true);

    if (this.readNowEl) {
      this.readNowEl.addEventListener("click", this.onreadnow);
    }

    this.owner.on("replaced", () => {
      if (document.location.hash) {
        const key = document.location.hash.slice(1);
        const file = this.owner.get(key);
        if (!file || !this.open(file)) {
          this.close();
        }
      }
    });
  }

  onimgclick(e) {
    this.file.open(new e.constructor(e.type, e));
    e.preventDefault();
    e.stopPropagation();
  }

  onreadnow(e) {
    nukeEvent(e);
    const file = this.file;
    this.close();
    this.reader.open(file);
  }

  ontitleclick(e) {
    this.file.download(new e.constructor(e.type, e));
    e.preventDefault();
    e.stopPropagation();
  }

  onpress(e) {
    const {
      key,
      target: { localName },
    } = e;
    if (key === "Escape") {
      this.close();
      return nukeEvent(e);
    }
    if (localName === "textarea" || localName === "input") {
      return true;
    }
    if (key === "ArrowLeft") {
      this.next();
      return nukeEvent(e);
    }
    if (key === "ArrowRight") {
      this.prev();
      return nukeEvent(e);
    }
    return true;
  }

  onwheel(e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.deltaY > 0) {
      this.next();
    } else {
      this.prev();
    }
  }

  onclose(e) {
    if (e.target !== this.el) {
      return;
    }
    this.close();
    e.preventDefault();
  }

  close() {
    // Unhook navigation (see .open for counterpart)
    document.body.removeEventListener("keydown", this.onpress, true);
    document.body.removeEventListener("wheel", this.onwheel, {
      passive: false,
      capture: true,
    });

    // Turn off gallery mode and garbage collect
    this.el.parentElement.classList.remove("gallery");
    this.imgEl.src = "";
    this.file = null;

    // Drop history back to base room link
    if (document.location.hash) {
      const u = new URL(document.location);
      u.hash = "";
      history.replaceState(null, "", u.href);
    }
  }

  maybeClose(file) {
    // Only close when the current file is actually the active only
    if (this.file !== file) {
      return;
    }

    this.close();
  }

  _next(iter) {
    if (!iter) {
      this.close();
      return;
    }
    for (const i of iter) {
      if (i === this.file) {
        continue;
      }
      if (this.open(i)) {
        return;
      }
    }
  }

  prev() {
    this._next(this.owner.riterfrom(this.file));
  }

  next() {
    this._next(this.owner.iterfrom(this.file));
  }

  startHideAux() {
    this.showAux();
    if (this.auxTimer) {
      clearTimeout(this.auxTimer);
    }
    this.auxTimer = setTimeout(this.hideAux, 1500);
  }

  hideAux() {
    if (this.auxTimer) {
      clearTimeout(this.auxTimer);
    }
    this.auxTimer = 0;
    this.el.classList.remove("aux");
  }

  showAux() {
    this.el.classList.add("aux");
  }

  open(file) {
    const info = file.getGalleryInfo();
    if (!info) {
      return false;
    }

    this.file = file;

    // Set up placeholder loader image
    const to = setTimeout(() => {
      const loader = new Image();
      loader.src = "/loader.png";
      loader.id = this.imgEl.id;
      this.imgEl.parentElement.replaceChild(loader, this.imgEl);
      this.imgEl = loader;
    }, 60);

    if (info.img) {
      // Set up new image (and swap on load)
      const img = new Image();
      img.id = this.imgEl.id;
      img.onload = () => {
        if (this.file !== file) {
          return;
        }
        clearTimeout(to);
        this.imgEl.parentElement.replaceChild(img, this.imgEl);
        this.imgEl = img;
        this.imgEl.addEventListener("click", this.onimgclick);
      };
      if (info.srcset && info.sizes) {
        img.setAttribute("srcset", info.srcset);
        img.setAttribute("sizes", info.sizes);
      }
      img.src = info.img;
    } else if (info.video) {
      const video = document.createElement("video");
      video.id = this.imgEl.id;
      video.src = info.video;
      video.setAttribute("controls", "controls");
      video.setAttribute("loop", "loop");
      video.oncanplay = () => {
        if (this.file !== file) {
          return;
        }
        clearTimeout(to);
        this.imgEl.parentElement.replaceChild(video, this.imgEl);
        this.imgEl = video;
        this.imgEl.addEventListener("click", this.onimgclick);
        video.play();
      };
    } else {
      // No cover image (e.g. EPUB/MOBI without embedded cover) —
      // cancel the loader.png placeholder and replace imgEl with a
      // clean empty element so the previous file's cover does not persist.
      clearTimeout(to);
      const blank = new Image();
      blank.id = this.imgEl.id;
      this.imgEl.parentElement.replaceChild(blank, this.imgEl);
      this.imgEl = blank;
    }

    // Set up additional info elements straight away
    this.titleEl.classList.add("visible");
    this.infoEl.textContent = info.infos.join(" — ");
    this.showAux();

    // Show "Read Now" button only for PDF/EPUB files
    if (this.readNowEl) {
      const readable = file.getReadableType && file.getReadableType();
      this.readNowEl.classList.toggle("hidden", !readable);
    }

    // Push gallery link (hash) into history
    const u = new URL(document.location);
    u.hash = `#${file.key}`;
    if (document.location.hash) {
      history.replaceState(null, "", u.href);
    } else {
      history.pushState(null, "", u.href);
    }

    // Activate on next anim frame
    APOOL.schedule(null, () => {
      this.el.parentElement.classList.add("gallery");
      this.titleEl.textContent = file.name;
      this.startHideAux();
    });

    // Hook up gallery navigation (see counterpart in .close)
    document.body.addEventListener("keydown", this.onpress, true);
    document.body.addEventListener("wheel", this.onwheel, {
      passive: false,
      capture: true,
    });
    return true;
  }
}
