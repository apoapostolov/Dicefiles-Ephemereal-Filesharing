"use strict";

import Modal from "../modal";
import registry from "../registry";
import { dom } from "../util";

const MAX_IMAGE_BYTES = 35 * 1024 * 1024;
const PREVIEW_SIZE = 320;
const MAX_DATAURL_LENGTH = 2_500_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export default class RequestModal extends Modal {
  constructor() {
    super(
      "requestcreate",
      "Create Request",
      {
        id: "create",
        text: "Create",
        default: true,
      },
      {
        id: "cancel",
        text: "Cancel",
        cancel: true,
      },
    );
    this.el.classList.add("modal-requestcreate");
    this.imageDataUrl = "";
    this.dragActive = false;
    this.dragDepth = 0;
    this.dragHandlers = null;
    this._makeLifecycleSafe();

    this.previewEl = dom("div", {
      classes: ["request-image-drop"],
      attrs: { title: "Drop image here or click to choose" },
    });
    this.previewTextEl = dom("div", {
      classes: ["request-image-drop-text"],
    });
    this.previewTextEl.innerHTML = "Drop Cover<br>or Image";
    this.previewEl.appendChild(this.previewTextEl);
    this.previewEl.addEventListener("click", this.onpick.bind(this));
    this.body.appendChild(this.previewEl);

    this.filePickerEl = dom("input", {
      attrs: {
        type: "file",
        accept: "image/*",
        style: "display:none",
      },
    });
    this.filePickerEl.addEventListener("change", this.onpickfile.bind(this));
    this.body.appendChild(this.filePickerEl);

    this.fieldsEl = dom("div", { classes: ["request-fields"] });
    this.fieldsEl.appendChild(
      dom("label", { text: "What do you want someone to upload?" }),
    );
    this.inputEl = dom("textarea", {
      attrs: {
        maxlength: "200",
        rows: "5",
        placeholder: "e.g. Looking for Player's Handbook PDF",
      },
    });
    this.fieldsEl.appendChild(this.inputEl);

    this.fieldsEl.appendChild(
      dom("label", {
        text: "Optional product/reference URL",
      }),
    );
    this.urlEl = dom("input", {
      attrs: {
        type: "url",
        maxlength: "500",
        placeholder: "https://example.com/product-page",
      },
    });
    this.fieldsEl.appendChild(this.urlEl);
    this.body.appendChild(this.fieldsEl);
  }

  onshown() {
    this.installDragDrop();
    this.inputEl.focus();
  }

  _makeLifecycleSafe() {
    const { resolve, reject } = this;
    this.resolve = (v) => {
      this.uninstallDragDrop();
      resolve(v);
    };
    this.reject = (v) => {
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
    const opts = { capture: true };
    addEventListener("dragenter", this.dragHandlers.dragenter, opts);
    addEventListener("dragover", this.dragHandlers.dragover, opts);
    addEventListener("dragleave", this.dragHandlers.dragleave, opts);
    addEventListener("drop", this.dragHandlers.drop, opts);
  }

  uninstallDragDrop() {
    if (!this.dragHandlers) {
      return;
    }
    const opts = { capture: true };
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
    } catch (ex) {
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
      const ratio = Math.min(
        PREVIEW_SIZE / img.width,
        PREVIEW_SIZE / img.height,
      );
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
    } catch (ex) {
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

// ---------------------------------------------------------------------------
// RequestViewModal — manage an existing request (fulfill / reopen / remove)
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ""; // accept all file types

export class RequestViewModal extends Modal {
  constructor(requestFile, { isMod = false } = {}) {
    const status = requestFile.status || "open";
    const isFulfilled = status === "fulfilled";

    const primaryBtn = isFulfilled
      ? {
          id: "reopen",
          text: "Reopen",
          default: !isMod,
          cls: "modal-button-reopen",
        }
      : {
          id: "fulfill",
          text: "Fulfill",
          default: true,
          cls: "modal-button-fulfill",
        };

    const buttons = [primaryBtn];
    if (isMod) {
      buttons.push({
        id: "remove",
        text: "Remove",
        cls: "modal-button-remove",
      });
    }
    buttons.push({ id: "cancel", text: "Cancel", cancel: true });

    super("requestview", "Request", ...buttons);
    this.el.classList.add("modal-requestview");

    this.requestFile = requestFile;
    this.isMod = isMod;
    this.isFulfilled = isFulfilled;
    this.stagedFiles = [];
    this.dragDepth = 0;
    this.dragHandlers = null;
    this._uploading = false;

    this._buildBody();
    this._makeLifecycleSafe();
  }

  _buildBody() {
    const { requestFile, isFulfilled } = this;
    const requester =
      (requestFile.tags &&
        (requestFile.tags.usernick || requestFile.tags.user)) ||
      "";

    // ── Content area: info + action area ──────────────────────────────────
    this.rightEl = dom("div", { classes: ["requestview-right"] });
    this.body.appendChild(this.rightEl);

    // Request text — shown first so the fulfiller immediately sees what is needed
    this.rightEl.appendChild(
      dom("p", {
        classes: ["requestview-text"],
        text: requestFile.name,
      }),
    );

    // Requester attribution — secondary info below the request description
    if (requester) {
      this.rightEl.appendChild(
        dom("p", {
          classes: ["requestview-requester"],
          text: `Requested by: ${requester}`,
        }),
      );
    }

    // Reference URL
    const refUrl = requestFile.meta && requestFile.meta.requestUrl;
    if (refUrl) {
      const a = dom("a", {
        classes: ["requestview-refurl"],
        attrs: {
          href: refUrl,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
        text: refUrl.length > 60 ? `${refUrl.slice(0, 57)}…` : refUrl,
      });
      this.rightEl.appendChild(a);
    }

    // Fulfilled‑by notice
    if (isFulfilled && requestFile.fulfilledByNick) {
      this.rightEl.appendChild(
        dom("p", {
          classes: ["requestview-fulfilled-by"],
          text: `Fulfilled by: ${requestFile.fulfilledByNick}`,
        }),
      );
    }

    if (!isFulfilled) {
      this._buildUploadZone();
    }
  }

  _buildUploadZone() {
    this.uploadZoneEl = dom("div", {
      classes: ["requestview-upload-zone"],
      attrs: { title: "Drop files here or click to choose" },
    });
    // Three-line "Drop / Files / Here" label — mirrors the dropminder overlay
    this.uploadZoneLabelEl = dom("span", {
      classes: ["requestview-upload-label"],
      text: "Drop\u00a0Files\u00a0Here",
    });
    this.uploadZoneEl.appendChild(this.uploadZoneLabelEl);
    this.uploadZoneEl.appendChild(
      dom("span", {
        classes: ["requestview-upload-hint"],
        text: "or click to choose",
      }),
    );
    this.uploadZoneEl.addEventListener("click", this._onZoneClick.bind(this));
    this.rightEl.appendChild(this.uploadZoneEl);

    this.filePickerEl = dom("input", {
      attrs: {
        type: "file",
        multiple: true,
        accept: ACCEPTED_TYPES,
        style: "display:none",
      },
    });
    this.filePickerEl.addEventListener("change", this._onPickFile.bind(this));
    this.rightEl.appendChild(this.filePickerEl);

    this.stagedListEl = dom("ul", {
      classes: ["requestview-staged-list", "hidden"],
    });
    this.rightEl.appendChild(this.stagedListEl);

    // Progress bar (hidden until upload starts)
    this.progressWrapEl = dom("div", {
      classes: ["requestview-progress-wrap", "hidden"],
    });
    this.progressBarEl = dom("div", { classes: ["requestview-progress-bar"] });
    this.progressWrapEl.appendChild(this.progressBarEl);
    this.progressLabelEl = dom("span", {
      classes: ["requestview-progress-label"],
    });
    this.progressWrapEl.appendChild(this.progressLabelEl);
    this.rightEl.appendChild(this.progressWrapEl);
  }

  _makeLifecycleSafe() {
    const { resolve, reject } = this;
    this.resolve = (v) => {
      this._uninstallDragDrop();
      resolve(v);
    };
    this.reject = (v) => {
      this._uninstallDragDrop();
      reject(v);
    };
  }

  onshown() {
    this._installDragDrop();
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────
  _installDragDrop() {
    if (this.isFulfilled || this.dragHandlers) {
      return;
    }
    this.dragHandlers = {
      dragenter: this._onDragEnter.bind(this),
      dragover: this._onDragOver.bind(this),
      dragleave: this._onDragLeave.bind(this),
      drop: this._onDrop.bind(this),
    };
    const opts = { capture: true };
    addEventListener("dragenter", this.dragHandlers.dragenter, opts);
    addEventListener("dragover", this.dragHandlers.dragover, opts);
    addEventListener("dragleave", this.dragHandlers.dragleave, opts);
    addEventListener("drop", this.dragHandlers.drop, opts);
  }

  _uninstallDragDrop() {
    if (!this.dragHandlers) {
      return;
    }
    const opts = { capture: true };
    removeEventListener("dragenter", this.dragHandlers.dragenter, opts);
    removeEventListener("dragover", this.dragHandlers.dragover, opts);
    removeEventListener("dragleave", this.dragHandlers.dragleave, opts);
    removeEventListener("drop", this.dragHandlers.drop, opts);
    this.dragHandlers = null;
    this.dragDepth = 0;
    this._setDragActive(false);
  }

  _hasDragFiles(e) {
    return (
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")
    );
  }

  _setDragActive(active) {
    this.uploadZoneEl &&
      this.uploadZoneEl.classList.toggle("dragging", !!active);
  }

  _onDragEnter(e) {
    if (!this._hasDragFiles(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.dragDepth++;
    this._setDragActive(true);
  }

  _onDragOver(e) {
    if (!this._hasDragFiles(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  _onDragLeave(e) {
    if (!this._hasDragFiles(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) {
      this._setDragActive(false);
    }
  }

  _onDrop(e) {
    if (!this._hasDragFiles(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.dragDepth = 0;
    this._setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    this._stageFiles(files);
  }

  _onZoneClick() {
    this.filePickerEl && this.filePickerEl.click();
  }

  _onPickFile() {
    const files = Array.from(this.filePickerEl.files || []);
    this.filePickerEl.value = "";
    this._stageFiles(files);
  }

  _stageFiles(files) {
    if (!files.length) {
      return;
    }
    for (const f of files) {
      if (
        !this.stagedFiles.some((s) => s.name === f.name && s.size === f.size)
      ) {
        this.stagedFiles.push(f);
      }
    }
    this._renderStagedList();
  }

  _renderStagedList() {
    if (!this.stagedListEl) {
      return;
    }
    this.stagedListEl.textContent = "";
    if (!this.stagedFiles.length) {
      this.stagedListEl.classList.add("hidden");
      if (this.uploadZoneLabelEl) {
        this.uploadZoneLabelEl.textContent = "Drop\u00a0Files\u00a0Here";
      }
      return;
    }
    this.stagedListEl.classList.remove("hidden");
    for (const [i, f] of this.stagedFiles.entries()) {
      const li = dom("li", { classes: ["requestview-staged-item"] });
      li.appendChild(
        dom("span", { classes: ["requestview-staged-name"], text: f.name }),
      );
      const rm = dom("button", {
        classes: ["requestview-staged-remove"],
        attrs: { type: "button", title: "Remove" },
        text: "×",
      });
      rm.onclick = () => {
        this.stagedFiles.splice(i, 1);
        this._renderStagedList();
      };
      li.appendChild(rm);
      this.stagedListEl.appendChild(li);
    }
    if (this.uploadZoneLabelEl) {
      this.uploadZoneLabelEl.textContent = `${this.stagedFiles.length} file${this.stagedFiles.length !== 1 ? "s" : ""} ready — drop more or click to add`;
    }
  }

  // ── Button handler ───────────────────────────────────────────────────────
  async onclick(button, e) {
    e.preventDefault();
    e.stopPropagation();
    if (button.cancel) {
      this.reject(new Error("cancelled"));
      return;
    }
    if (button.id === "remove") {
      this.resolve({ action: "remove" });
      return;
    }
    if (button.id === "reopen") {
      this.resolve({ action: "reopen" });
      return;
    }
    if (button.id === "fulfill") {
      if (this._uploading) {
        return;
      }
      if (this.stagedFiles.length === 0) {
        // No files — just mark as fulfilled immediately
        this.resolve({ action: "fulfill", files: [] });
        return;
      }
      // Upload files first
      await this._doUploads();
      return;
    }
  }

  // ── Upload machinery ─────────────────────────────────────────────────────
  async _doUploads() {
    this._uploading = true;
    // Disable all buttons during upload
    this.buttons.forEach((b) => b.setAttribute("disabled", "disabled"));
    this.progressWrapEl.classList.remove("hidden");
    this.uploadZoneEl && this.uploadZoneEl.classList.add("hidden");
    this.stagedListEl && this.stagedListEl.classList.add("hidden");

    const total = this.stagedFiles.length;
    let done = 0;
    let failed = 0;
    const uploadedKeys = [];

    const setProgress = (label, pct) => {
      this.progressBarEl.style.width = `${Math.min(100, pct * 100).toFixed(1)}%`;
      this.progressLabelEl.textContent = label;
    };

    setProgress(`Uploading 0 / ${total}…`, 0);

    for (const file of this.stagedFiles) {
      try {
        const key = await this._uploadFile(file, (loaded, total) => {
          const overall = (done + loaded / total) / this.stagedFiles.length;
          setProgress(`Uploading ${done + 1} / ${total}…`, overall);
        });
        uploadedKeys.push(key);
        done++;
        setProgress(`Uploaded ${done} / ${total}`, done / total);
      } catch (ex) {
        console.error("Failed to upload fulfillment file", file.name, ex);
        failed++;
        done++;
      }
    }

    if (failed === total) {
      setProgress("All uploads failed", 0);
      this._uploading = false;
      this.buttons.forEach((b) => b.removeAttribute("disabled"));
      this.progressWrapEl.classList.add("hidden");
      this.uploadZoneEl && this.uploadZoneEl.classList.remove("hidden");
      this.stagedListEl && this.stagedListEl.classList.remove("hidden");
      return;
    }

    setProgress(`Done (${done - failed} uploaded)`, 1);
    // Short delay so the user can see "Done"
    await new Promise((r) => setTimeout(r, 600));
    this.resolve({ action: "fulfill", files: uploadedKeys });
  }

  async _uploadFile(file, onprogress) {
    await registry.init();
    await registry.chatbox.ensureNick();

    // Get upload key
    let keyResult;
    await new Promise((resolve, reject) => {
      const to = setTimeout(
        () => reject(new Error("Upload key timeout")),
        UPLOAD_TIMEOUT_MS,
      );
      const id = Date.now() + Math.random();
      registry.socket
        .makeCall("uploadkey", id)
        .then((d) => {
          clearTimeout(to);
          resolve(d);
        })
        .catch((err) => {
          clearTimeout(to);
          reject(err);
        });
    }).then((d) => {
      keyResult = d;
    });

    if (!keyResult || keyResult.err) {
      throw new Error(keyResult ? keyResult.err : "No upload key");
    }
    if (keyResult.wait) {
      throw new Error("Upload queue is full, try again later");
    }
    const key = typeof keyResult === "string" ? keyResult : keyResult.key || "";
    if (!key) {
      throw new Error("Invalid upload key");
    }

    const params = new URLSearchParams();
    params.set("name", file.name);
    params.set("offset", "0");
    params.set("now", Date.now());
    params.set("fulfillsRequest", this.requestFile.key);

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.responseType = "json";
      xhr.onerror = () => reject(new Error("Connection lost"));
      xhr.onabort = () => reject(new Error("Aborted"));
      xhr.onload = () => {
        if (xhr.response && xhr.response.err) {
          reject(new Error(xhr.response.err));
        } else {
          resolve(xhr.response);
        }
      };
      if (onprogress) {
        xhr.upload.addEventListener(
          "progress",
          (e) => {
            if (e.lengthComputable) {
              onprogress(e.loaded, e.total);
            }
          },
          { passive: true },
        );
      }
      xhr.open("PUT", `/api/upload/${key}?${params.toString()}`);
      xhr.send(file);
    });

    return key;
  }
}
