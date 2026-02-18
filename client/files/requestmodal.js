"use strict";

import Modal from "../modal";
import {dom} from "../util";

const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const PREVIEW_SIZE = 320;
const MAX_DATAURL_LENGTH = 2_500_000;

export default class RequestModal extends Modal {
  constructor() {
    super("requestcreate", "Create Request", {
      id: "create",
      text: "Create",
      default: true,
    }, {
      id: "cancel",
      text: "Cancel",
      cancel: true,
    });
    this.el.classList.add("modal-requestcreate");
    this.imageDataUrl = "";
    this.dragActive = false;
    this.dragDepth = 0;
    this.dragHandlers = null;
    this._makeLifecycleSafe();

    this.previewEl = dom("div", {
      classes: ["request-image-drop"],
      attrs: {title: "Drop image here or click to choose"},
    });
    this.previewTextEl = dom("div", {
      classes: ["request-image-drop-text"],
      text: "Drop stuff here",
    });
    this.previewEl.appendChild(this.previewTextEl);
    this.previewEl.addEventListener("click", this.onpick.bind(this));
    this.body.appendChild(this.previewEl);

    this.filePickerEl = dom("input", {
      attrs: {
        type: "file",
        accept: "image/*",
        style: "display:none",
      }
    });
    this.filePickerEl.addEventListener("change", this.onpickfile.bind(this));
    this.body.appendChild(this.filePickerEl);

    this.fieldsEl = dom("div", {classes: ["request-fields"]});
    this.fieldsEl.appendChild(dom("label", {text: "What do you want someone to upload?"}));
    this.inputEl = dom("textarea", {
      attrs: {
        maxlength: "200",
        rows: "5",
        placeholder: "e.g. Looking for Player's Handbook PDF",
      }
    });
    this.fieldsEl.appendChild(this.inputEl);

    this.fieldsEl.appendChild(dom("label", {
      text: "Optional product/reference URL",
    }));
    this.urlEl = dom("input", {
      attrs: {
        type: "url",
        maxlength: "500",
        placeholder: "https://example.com/product-page",
      }
    });
    this.fieldsEl.appendChild(this.urlEl);
    this.body.appendChild(this.fieldsEl);
  }

  onshown() {
    this.installDragDrop();
    this.inputEl.focus();
  }

  _makeLifecycleSafe() {
    const {resolve, reject} = this;
    this.resolve = v => {
      this.uninstallDragDrop();
      resolve(v);
    };
    this.reject = v => {
      this.uninstallDragDrop();
      reject(v);
    };
  }

  installDragDrop() {
    if (this.dragHandlers) {
      return;
    }
    this.dragHandlers = {
      dragenter: this.ondragenter.bind(this),
      dragover: this.ondragover.bind(this),
      dragleave: this.ondragleave.bind(this),
      drop: this.ondrop.bind(this),
    };
    const opts = {capture: true};
    addEventListener("dragenter", this.dragHandlers.dragenter, opts);
    addEventListener("dragover", this.dragHandlers.dragover, opts);
    addEventListener("dragleave", this.dragHandlers.dragleave, opts);
    addEventListener("drop", this.dragHandlers.drop, opts);
  }

  uninstallDragDrop() {
    if (!this.dragHandlers) {
      return;
    }
    const opts = {capture: true};
    removeEventListener("dragenter", this.dragHandlers.dragenter, opts);
    removeEventListener("dragover", this.dragHandlers.dragover, opts);
    removeEventListener("dragleave", this.dragHandlers.dragleave, opts);
    removeEventListener("drop", this.dragHandlers.drop, opts);
    this.dragHandlers = null;
    this.dragDepth = 0;
    this.setDragActive(false);
  }

  setDragActive(active) {
    this.dragActive = !!active;
    this.previewEl.classList.toggle("dragging", this.dragActive);
  }

  hasFileDrag(e) {
    const dt = e.dataTransfer;
    if (!dt || !dt.types) {
      return false;
    }
    return Array.from(dt.types).includes("Files");
  }

  isAllowedImageType(type) {
    if (!type) {
      return true;
    }
    return /^image\//i.test(type);
  }

  ondragenter(e) {
    if (!this.hasFileDrag(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.dragDepth++;
    this.setDragActive(true);
  }

  ondragover(e) {
    if (!this.hasFileDrag(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    this.setDragActive(true);
  }

  ondragleave(e) {
    if (!this.hasFileDrag(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) {
      this.setDragActive(false);
    }
  }

  async ondrop(e) {
    if (!this.hasFileDrag(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.dragDepth = 0;
    this.setDragActive(false);
    const file = this.pickFirstImage(e.dataTransfer);
    if (!file) {
      this.previewTextEl.textContent = "No image found";
      return;
    }
    await this.setImageFile(file);
  }

  pickFirstImage(dt) {
    if (dt.items && dt.items.length) {
      for (const item of Array.from(dt.items)) {
        if (item.kind !== "file") {
          continue;
        }
        const file = item.getAsFile();
        if (!file || !this.isAllowedImageType(file.type)) {
          continue;
        }
        return file;
      }
    }
    for (const file of Array.from(dt.files || [])) {
      if (this.isAllowedImageType(file.type)) {
        return file;
      }
    }
    return null;
  }

  onpick() {
    this.filePickerEl.click();
  }

  async onpickfile() {
    const [file] = Array.from(this.filePickerEl.files || []);
    this.filePickerEl.value = "";
    if (!file) {
      return;
    }
    await this.setImageFile(file);
  }

  async setImageFile(file) {
    try {
      if (!this.isAllowedImageType(file.type)) {
        throw new Error("Use an image file");
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw new Error("Image is too large");
      }
      const dataUrl = await this.toDataUrl(file);
      this.imageDataUrl = dataUrl;
      this.previewEl.style.backgroundImage = `url(${dataUrl})`;
      this.previewEl.classList.add("has-image");
      this.previewTextEl.textContent = "Image ready";
    }
    catch (ex) {
      this.imageDataUrl = "";
      this.previewEl.style.backgroundImage = "";
      this.previewEl.classList.remove("has-image");
      this.previewTextEl.textContent = ex.message || "Invalid image";
    }
  }

  async toDataUrl(file) {
    const sourceUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("Failed to read image"));
      fr.readAsDataURL(file);
    });
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Failed to decode image"));
        i.src = sourceUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = PREVIEW_SIZE;
      canvas.height = PREVIEW_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas not available");
      }
      ctx.fillStyle = "#1f1f1f";
      ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      const ratio = Math.min(PREVIEW_SIZE / img.width, PREVIEW_SIZE / img.height);
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const x = Math.floor((PREVIEW_SIZE - w) / 2);
      const y = Math.floor((PREVIEW_SIZE - h) / 2);
      ctx.drawImage(img, x, y, w, h);
      let out = canvas.toDataURL("image/webp", 0.84);
      if (!out.startsWith("data:image/webp;base64,")) {
        out = canvas.toDataURL("image/jpeg", 0.86);
      }
      if (out.length > MAX_DATAURL_LENGTH) {
        out = canvas.toDataURL("image/jpeg", 0.72);
      }
      if (out.length > MAX_DATAURL_LENGTH) {
        throw new Error("Image is too detailed, please use a smaller one");
      }
      return out;
    }
    catch (ex) {
      if (
        typeof sourceUrl === "string" &&
        sourceUrl.startsWith("data:image/") &&
        sourceUrl.length <= MAX_DATAURL_LENGTH
      ) {
        return sourceUrl;
      }
      throw ex;
    }
  }

  async onclick(button, e) {
    if (button.id !== "create") {
      return super.onclick(button, e);
    }
    e.preventDefault();
    e.stopPropagation();
    const text = this.inputEl.value.trim();
    if (!text) {
      this.inputEl.focus();
      return;
    }
    const url = this.urlEl.value.trim();
    this.resolve({
      text,
      url,
      requestImage: this.imageDataUrl,
    });
  }
}
