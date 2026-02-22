"use strict";

import Modal from "../modal";
import { dom } from "../util";

export default class DownloadBatchModal extends Modal {
  constructor(title, total, options = {}) {
    const startBtn = {
      id: "start",
      text: "Start",
      default: true,
    };
    const cancelBtn = {
      id: "cancel",
      text: "Cancel",
      cancel: true,
    };
    super("downloadbatch", title, startBtn, cancelBtn);
    this.total = total;
    this.cancelRequested = false;
    this.started = false;
    this.onOptionsChange = options.onOptionsChange || null;
    this.startBtn = startBtn.btn;
    this.cancelBtn = cancelBtn.btn;
    this.startPromise = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });

    const defaultSkipExisting = options.skipExisting !== false;
    const retries = Number(options.retries);
    this.maxRetries = Number.isFinite(retries) ? Math.max(0, retries) : 2;
    const concurrent = Number(options.concurrent);
    this.maxConcurrent = Number.isFinite(concurrent)
      ? Math.max(1, Math.min(4, Math.floor(concurrent)))
      : 4;

    this.statusEl = dom("div", {
      classes: ["download-status"],
      text: `Preparing ${total} file downloads...`,
    });
    this.currentEl = dom("div", {
      classes: ["download-current"],
      text: "",
    });

    this.optionsEl = dom("div", { classes: ["download-options"] });
    const skipLabel = dom("label", {
      classes: ["download-option", "download-option-skip"],
    });
    this.skipExistingEl = dom("input", {
      attrs: { type: "checkbox" },
    });
    this.skipExistingEl.checked = defaultSkipExisting;
    this.skipExistingEl.addEventListener("change", () =>
      this.notifyOptionsChange(),
    );
    skipLabel.appendChild(this.skipExistingEl);
    skipLabel.appendChild(dom("span", { text: "Skip existing filenames" }));
    this.optionsEl.appendChild(skipLabel);

    this.controlsEl = dom("div", {
      classes: ["download-option-controls"],
    });

    this.retryInfoEl = dom("div", {
      classes: ["download-option", "download-option-retry"],
      text: "Retries:",
    });
    this.retryInputEl = dom("input", {
      attrs: {
        type: "number",
        min: "0",
        max: "5",
        step: "1",
        value: this.maxRetries.toString(),
      },
      classes: ["download-retry-input"],
    });
    this.retryInputEl.addEventListener("input", () =>
      this.notifyOptionsChange(),
    );
    this.retryInputEl.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.retryInputEl.blur();
      },
      { passive: false },
    );
    this.retryInfoEl.appendChild(this.retryInputEl);
    this.controlsEl.appendChild(this.retryInfoEl);

    this.concurrentInfoEl = dom("div", {
      classes: ["download-option", "download-option-concurrent"],
      text: "Concurrent:",
    });
    this.concurrentInputEl = dom("input", {
      attrs: {
        type: "number",
        min: "1",
        max: "4",
        step: "1",
        value: this.maxConcurrent.toString(),
      },
      classes: ["download-retry-input", "download-concurrent-input"],
    });
    this.concurrentInputEl.addEventListener("input", () =>
      this.notifyOptionsChange(),
    );
    this.concurrentInputEl.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.concurrentInputEl.blur();
      },
      { passive: false },
    );
    this.concurrentInfoEl.appendChild(this.concurrentInputEl);
    this.controlsEl.appendChild(this.concurrentInfoEl);
    this.optionsEl.appendChild(this.controlsEl);

    this.progressWrapEl = dom("div", {
      classes: ["download-progress-wrap"],
    });
    this.progressBarEl = dom("div", {
      classes: ["download-progress-bar"],
    });
    this.progressWrapEl.appendChild(this.progressBarEl);

    this.reportSummaryEl = dom("div", {
      classes: ["download-report-summary"],
      text: "",
    });

    this.reportListEl = dom("ul", {
      classes: ["download-report-list"],
    });
    this.reportEmptyEl = dom("li", {
      classes: ["download-report-empty"],
      text: "Download log will appear here after you press Start.",
    });
    this.reportListEl.appendChild(this.reportEmptyEl);
    this.fileRows = new Map();

    this.body.appendChild(this.statusEl);
    this.body.appendChild(this.currentEl);
    this.body.appendChild(this.optionsEl);
    this.body.appendChild(this.progressWrapEl);
    this.body.appendChild(this.reportSummaryEl);
    this.body.appendChild(this.reportListEl);
  }

  dismiss() {
    if (!this.started && this.rejectStart) {
      this.rejectStart(new Error("cancelled"));
      this.rejectStart = null;
      this.resolveStart = null;
    }
    this.cancelRequested = true;
    super.dismiss();
  }

  onclick(button, e) {
    e.preventDefault();
    e.stopPropagation();
    if (button.id === "start") {
      if (this.started) {
        return;
      }
      this.started = true;
      this.disableStartControls();
      if (this.resolveStart) {
        this.resolveStart(this.values);
        this.resolveStart = null;
        this.rejectStart = null;
      }
      return;
    }
    if (button.cancel) {
      this.cancelRequested = true;
      if (!this.started && this.rejectStart) {
        this.rejectStart(new Error("cancelled"));
        this.rejectStart = null;
        this.resolveStart = null;
      }
      this.reject();
    }
  }

  waitForStart() {
    return this.startPromise;
  }

  disableStartControls() {
    if (this.startBtn) {
      this.startBtn.setAttribute("disabled", "disabled");
      this.startBtn.textContent = "Running...";
    }
    if (this.skipExistingEl) {
      this.skipExistingEl.setAttribute("disabled", "disabled");
    }
    if (this.retryInputEl) {
      this.retryInputEl.setAttribute("disabled", "disabled");
    }
    if (this.concurrentInputEl) {
      this.concurrentInputEl.setAttribute("disabled", "disabled");
    }
  }

  notifyOptionsChange() {
    const retries = Number(this.retryInputEl && this.retryInputEl.value);
    this.maxRetries = Number.isFinite(retries)
      ? Math.max(0, Math.min(5, Math.floor(retries)))
      : 2;
    if (this.retryInputEl) {
      this.retryInputEl.value = this.maxRetries.toString();
    }
    const concurrent = Number(
      this.concurrentInputEl && this.concurrentInputEl.value,
    );
    this.maxConcurrent = Number.isFinite(concurrent)
      ? Math.max(1, Math.min(4, Math.floor(concurrent)))
      : 4;
    if (this.concurrentInputEl) {
      this.concurrentInputEl.value = this.maxConcurrent.toString();
    }
    if (typeof this.onOptionsChange === "function") {
      this.onOptionsChange({
        skipExisting: this.skipExisting,
        maxRetries: this.maxRetries,
        maxConcurrent: this.maxConcurrent,
      });
    }
  }

  get skipExisting() {
    return !!(this.skipExistingEl && this.skipExistingEl.checked);
  }

  get values() {
    this.notifyOptionsChange();
    return {
      skipExisting: this.skipExisting,
      maxRetries: this.maxRetries,
      maxConcurrent: this.maxConcurrent,
    };
  }

  setCurrent(text) {
    this.currentEl.textContent = text || "";
  }

  update(done, failed, skipped = 0) {
    const finished = done + failed + skipped;
    const percent = this.total
      ? Math.floor((finished / this.total) * 100)
      : 100;
    this.progressBarEl.style.width = `${percent}%`;
    this.statusEl.textContent = `Downloaded ${done}/${this.total} (${failed} failed, ${skipped} skipped)`;
  }

  upsertFileStatus(fileName, status, attempt = 1, detail = "") {
    if (this.reportEmptyEl && this.reportEmptyEl.parentElement) {
      this.reportListEl.removeChild(this.reportEmptyEl);
    }
    const key = `${fileName}`;
    let row = this.fileRows.get(key);
    if (!row) {
      row = dom("li", { classes: ["download-report-item"] });
      const nameEl = dom("span", {
        classes: ["download-report-name"],
        text: fileName,
      });
      const statusEl = dom("span", {
        classes: ["download-report-state"],
        text: "",
      });
      row.appendChild(nameEl);
      row.appendChild(statusEl);
      this.fileRows.set(key, row);
      this.reportListEl.appendChild(row);
    }
    const statusEl = row.lastElementChild;
    row.classList.remove(
      "is-success",
      "is-failed",
      "is-skipped",
      "is-retrying",
      "is-running",
    );
    row.classList.add(`is-${status}`);
    const attemptInfo = attempt > 1 ? ` (attempt ${attempt})` : "";
    statusEl.textContent = `${status}${attemptInfo}${detail ? ` - ${detail}` : ""}`;
  }

  finish(done, failed, skipped, cancelled, report = null) {
    this.update(done, failed, skipped);
    this.currentEl.textContent = cancelled
      ? "Cancelled by user."
      : "Completed.";
    this.statusEl.textContent = cancelled
      ? `Cancelled: ${done}/${this.total} downloaded (${failed} failed, ${skipped} skipped)`
      : `Finished: ${done}/${this.total} downloaded (${failed} failed, ${skipped} skipped)`;

    if (report) {
      this.reportSummaryEl.textContent = `Report: ${report.success.length} success, ${report.failed.length} failed, ${report.skipped.length} skipped.`;
    }

    if (this.startBtn) {
      this.startBtn.classList.add("hidden");
    }
    if (this.cancelBtn) {
      this.cancelBtn.textContent = "Close";
    }
  }
}
