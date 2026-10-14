"use strict";

import EventEmitter from "events";
import {nukeEvent} from "./util";
import registry from "./registry";

export default new class Splitter extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#splitter");
    this.chat = document.querySelector("#chat");
    this.onmouseup = this.onmouseup.bind(this);
    this.onmousemove = this.onmousemove.bind(this);
    this.abort = this.abort.bind(this);
    this.onresize = this.onresize.bind(this);
    this.dragging = false;
  }

  init() {
    this.el.addEventListener("mousedown", this.onmousedown.bind(this));
    this.restore();
    addEventListener("resize", this.onresize);
  }

  onmousedown(e) {
    if (window.matchMedia("(max-width: 760px)").matches) {
      return;
    }
    this.dragging = true;
    this.el.style.left = `${e.pageX}px`;
    this.el.classList.add("dragging");
    addEventListener("mouseup", this.onmouseup);
    addEventListener("mousemove", this.onmousemove);
    registry.roomie.on("hidden", this.abort);
    nukeEvent(e);
  }

  restore() {
    let item = localStorage.getItem("clientWidth");
    if (!item) {
      return;
    }
    try {
      item = JSON.parse(item);
    }
    catch {
      localStorage.removeItem("clientWidth"); return;
    }
    if (!item || !Number.isFinite(item.width) || !Number.isFinite(item.page)) {
      localStorage.removeItem("clientWidth");
      return;
    }
    if (Math.abs(document.body.clientWidth - item.page) > 32) {
      localStorage.removeItem("clientWidth");
      return;
    }
    this.adjust(item.width);
  }

  clamp(w) {
    return Math.min(750, Math.max(272, document.body.clientWidth * 0.47), Math.max(272, w));
  }

  adjust(width) {
    width = this.clamp(width);
    document.body.style.setProperty("--chat-width", `${width}px`);
    localStorage.setItem("clientWidth", JSON.stringify({
      width,
      page: document.body.clientWidth,
    }));
    this.emit("adjusted");
  }

  onresize() {
    if (this.dragging) {
      this.abort();
    }
    // Old versions persisted inline widths; CSS owns responsive sizing now.
    this.chat.style.removeProperty("width");
    this.chat.style.removeProperty("min-width");
    document.body.style.removeProperty("grid-template-columns");
    this.emit("adjusted");
  }

  abort() {
    this.el.style.left = "auto";
    this.el.classList.toggle("dragging");
    removeEventListener("mouseup", this.onmouseup);
    removeEventListener("mousemove", this.onmousemove);
    registry.roomie.removeListener("hidden", this.abort);
  }


  onmouseup(e) {
    const x = this.clamp(e.pageX);
    this.adjust(x);
    this.abort();
  }

  onmousemove(e) {
    const x = this.clamp(e.pageX);
    this.el.style.left = `${x}px`;
  }
}();
