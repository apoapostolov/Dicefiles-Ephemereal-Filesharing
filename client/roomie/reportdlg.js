"use strict";

import registry from "../registry";
import Modal from "../modal";

export class ReportModal extends Modal {
  constructor(owner) {
    super("report", "Report this room", {
      text: "Send report",
      default: true
    }, {
      text: "Cancel",
      cancel: true
    });
    this.owner = owner;
    this.body.innerHTML = document.querySelector("#report-tmpl").innerHTML;
    this.el.elements.room.value = `#${registry.roomid}`;
    this.messageEl = this.el.elements.msg;
    this.agreementEl = this.el.elements.agreement;
    this.errorEl = this.body.querySelector("#report-error");
    this.messageEl.addEventListener("input", () => this.clearError());
    this.agreementEl.addEventListener("change", () => this.clearError());
  }

  onshown() {
    this.messageEl.focus();
  }

  clearError() {
    this.messageEl.removeAttribute("aria-invalid");
    this.agreementEl.removeAttribute("aria-invalid");
    this.errorEl.hidden = true;
    this.errorEl.textContent = "";
  }

  showError(message, field) {
    this.clearError();
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
    if (field) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
    }
  }

  async validate() {
    this.clearError();
    this.disable();
    try {
      if (!this.agreementEl.checked) {
        this.showError(
          "Accept the report rules before sending.",
          this.agreementEl);
        return false;
      }
      const msg = this.messageEl.value.trim();
      if (!msg) {
        this.showError("Describe what you are reporting.", this.messageEl);
        return false;
      }
      await registry.socket.emit("report", msg);
      return true;
    }
    catch (ex) {
      this.showError(
        `Report could not be sent: ${ex.message || ex}`,
        this.messageEl);
      return false;
    }
    finally {
      this.enable();
    }
  }
}
