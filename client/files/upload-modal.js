"use strict";

import Modal from "../modal";
import registry from "../registry";
import { dom } from "../util";
import { normalizeMagnetInput } from "../../common/torrent-input";
import { collectDroppedFiles } from "../../common/drop-input";

export default class UploadModal extends Modal {
  constructor(files) {
    super("upload", "Upload", { text: "Cancel", cancel: true }, { text: "Import link", default: true });
    this.files = files;
    this.closed = false;
    this.choose = dom("button", { classes: ["upload-dropzone"], attrs: { "type": "button", "aria-label": "Choose files from this device", "title": "Choose files from this device" } });
    this.choose.append(
      dom("span", { classes: ["i-upload", "upload-dropzone-icon"], attrs: { "aria-hidden": "true" } }),
      dom("strong", { text: "Drop files here" }),
      dom("span", { text: "or choose files" }),
    );
    this.choose.onclick = () => {
      files.ubutton.click(); this.dismiss();
    };
    this.body.appendChild(this.choose);
    this.body.appendChild(dom("div", { classes: ["upload-divider"], text: "Torrent link" }));
    const label = dom("label", { text: "Magnet or torrent URL", attrs: { for: "torrent-upload-url" } });
    this.input = dom("input", { attrs: { id: "torrent-upload-url", type: "text", placeholder: "magnet:?xt=… or https://…/file.torrent", maxlength: "16384", autocomplete: "off" } });
    this.status = dom("p", { classes: ["upload-feedback"], attrs: { role: "status", id: "torrent-upload-status" } });
    const hint = dom("p", { classes: ["upload-hint"], attrs: { id: "torrent-upload-hint" }, text: "Import a torrent, then browse its files or play a supported video." });
    this.input.setAttribute("aria-describedby", "torrent-upload-hint torrent-upload-status");
    this.input.addEventListener("input", () => {
      this.default.btn.disabled = !this.input.value.trim(); this.input.removeAttribute("aria-invalid"); this.status.textContent = "";
    });
    this.input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault(); this.default.btn.click();
      }
    });
    this.default.btn.disabled = true;
    this.body.append(label, this.input, hint, this.status);
    this.choose.addEventListener("dragenter", event => this.dragOver(event));
    this.el.addEventListener("dragover", event => this.dragOver(event));
    this.choose.addEventListener("dragleave", event => {
      if (!this.choose.contains(event.relatedTarget)) {
        this.choose.classList.remove("is-dragging");
      }
    });
    this.el.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      this.choose.classList.remove("is-dragging");
      if (!this.files.canUpload) {
        this.status.textContent = "Uploads unavailable. Check your connection or sign in."; return;
      }
      const { files, entries } = collectDroppedFiles(event.dataTransfer);
      if (files.length || entries.length) {
        this.files.queueUploads(entries, files);
        this.dismiss();
      }
      else {
        const url = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
        if (/^(magnet:|https?:)/i.test(url.trim())) {
          this.input.value = url.trim().split(/\r?\n/)[0]; this.default.btn.disabled = false; this.input.focus();
        }
        else {
          this.status.textContent = "Drop files or a torrent link.";
        }
      }
    });
    this.el.addEventListener("keydown", event => {
      if (event.key !== "Tab") {
        return;
      }
      const controls = Array.from(this.el.querySelectorAll("button:not([disabled]), input:not([disabled])"));
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      }
      else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
  }
  dragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = this.files.canUpload ? "copy" : "none";
    this.choose.classList.toggle("is-dragging", this.files.canUpload);
  }
  onshown() {
    this.choose.focus();
  }
  onhidden() {
    this.closed = true;
  }
  enable() {
    super.enable();
    this.default.btn.disabled = !this.input.value.trim();
  }
  async validate() {
    this.disable();
    this.cancel.btn.disabled = false;
    this.status.classList.remove("is-error");
    try {
      const url = this.input.value.trim();
      let file;
      if (url.startsWith("magnet:")) {
        const { name, magnet } = normalizeMagnetInput(url);
        file = new File([magnet], `${name}.magnet`, { type: "text/plain" });
      }
      else {
        if (!/^https?:\/\//i.test(url)) {
          throw new Error("Enter a complete magnet link or HTTP/HTTPS torrent URL.");
        }
        this.status.textContent = "Reading torrent metadata…";
        const result = await registry.socket.makeCall("fetchtorrent", `t${Date.now()}`, url);
        file = new File([Uint8Array.from(atob(result.data), char => char.charCodeAt(0))], result.name, { type: "application/x-bittorrent" });
      }
      if (this.closed) {
        return false;
      }
      this.files.queueUploads([], [file]);
      return true;
    }
    catch (error) {
      this.status.classList.add("is-error");
      this.input.setAttribute("aria-invalid", "true");
      this.status.textContent = error.message || "The torrent link could not be imported. Check the source and try again."; return false;
    }
    finally {
      this.enable();
    }
  }
}
