"use strict";

import Modal from "../modal";
import { dom } from "../util";
import {
  buildRequestBoard,
  summarizeRequestBoard,
  requestStatus,
} from "../../lib/room/request-board";
import {
  REQUEST_BOARD_STATUSES,
  buildRequestBoardShareUrl,
  isDeepLinksEnabled,
} from "../../lib/room/deep-links";
import { RequestViewModal } from "./requestmodal";
import registry from "../registry";

/**
 * First-class request board over existing request file objects.
 */
export default class RequestBoardModal extends Modal {
  constructor(owner, opts = {}) {
    super(
      "requestboard",
      "Request board",
      {
        text: "Close",
        cancel: true,
      },
    );
    this.owner = owner;
    this.onFilesChanged = this.renderList.bind(this);
    this.listening = false;
    this.storageKey = `dicefiles:requestboard:${owner.getRoomId()}`;
    this.filterStatus = this.loadFilterStatus(opts.status);

    this.summaryEl = dom("div", { classes: ["rb-summary"] });
    this.filterRow = dom("div", { classes: ["rb-filters"] });
    for (const [id, label] of [
      ["all", "All"],
      ["open", "Open"],
      ["fulfilled", "Fulfilled"],
    ]) {
      const btn = dom("button", {
        classes: [
          "rb-filter-btn",
          ...(id === this.filterStatus ? ["active"] : []),
        ],
        attrs: { type: "button", "data-status": id },
        text: label,
      });
      btn.addEventListener("click", () => {
        this.setFilterStatus(id);
      });
      this.filterRow.appendChild(btn);
    }
    this.shareBtn = dom("button", {
      classes: ["rb-share"],
      attrs: { type: "button" },
      text: "Copy view link",
    });
    const deepLinksEnabled = isDeepLinksEnabled(
      registry.config.get("deepLinks"),
    );
    this.shareBtn.disabled = !deepLinksEnabled;
    this.shareBtn.title = deepLinksEnabled
      ? "Copy a link that opens this request-board view"
      : "Enable shareable deep links in Room Options first";
    this.shareBtn.addEventListener("click", () => this.copyShareLink());
    this.filterRow.appendChild(this.shareBtn);

    this.listEl = dom("div", { classes: ["rb-list"] });
    this.body.appendChild(this.summaryEl);
    this.body.appendChild(this.filterRow);
    this.body.appendChild(this.listEl);
    this.renderList();
  }

  onshown() {
    super.onshown();
    if (!this.listening) {
      this.owner.on("files-changed", this.onFilesChanged);
      this.listening = true;
    }
  }

  onhidden() {
    if (this.listening) {
      this.owner.removeListener("files-changed", this.onFilesChanged);
      this.listening = false;
    }
  }

  loadFilterStatus(preferred) {
    if (REQUEST_BOARD_STATUSES.includes(preferred)) {
      return preferred;
    }
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (REQUEST_BOARD_STATUSES.includes(stored)) {
        return stored;
      }
    } catch (ex) {
      // ignored
    }
    return "all";
  }

  setFilterStatus(status) {
    if (!REQUEST_BOARD_STATUSES.includes(status)) {
      return;
    }
    this.filterStatus = status;
    try {
      localStorage.setItem(this.storageKey, status);
    } catch (ex) {
      // ignored
    }
    for (const btn of this.filterRow.querySelectorAll(".rb-filter-btn")) {
      btn.classList.toggle("active", btn.dataset.status === status);
    }
    this.renderList();
  }

  async copyShareLink() {
    if (this.shareBtn.disabled) {
      return;
    }
    const url = buildRequestBoardShareUrl(
      document.location.href,
      this.filterStatus,
    );
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      } else {
        const input = dom("textarea", {
          attrs: {
            style: "position:fixed;left:-99999px;top:0;opacity:0",
          },
          text: url,
        });
        document.body.appendChild(input);
        input.select();
        copied = document.execCommand("copy");
        input.remove();
      }
    } catch (ex) {
      copied = false;
    }
    const original = "Copy view link";
    this.shareBtn.textContent = copied ? "Link copied" : "Copy failed";
    setTimeout(() => {
      this.shareBtn.textContent = original;
    }, 1800);
  }

  getFiles() {
    return this.owner.files || [];
  }

  renderList() {
    const allow = registry.config.get("allowRequests") !== false;
    if (!allow) {
      this.summaryEl.textContent = "Requests are disabled in this room.";
      this.listEl.textContent = "";
      return;
    }
    const all = this.getFiles();
    const summary = summarizeRequestBoard(all);
    this.summaryEl.textContent = `${summary.open} open · ${summary.fulfilled} fulfilled · ${summary.total} total`;
    const board = buildRequestBoard(all, {
      status: this.filterStatus,
      allowRequests: true,
    });
    this.listEl.textContent = "";
    if (!board.length) {
      this.listEl.appendChild(
        dom("div", {
          classes: ["rb-empty"],
          text: "No requests in this view.",
        }),
      );
      return;
    }
    for (const f of board) {
      const status = requestStatus(f);
      const row = dom("div", {
        classes: ["rb-row", `rb-status-${status}`],
      });
      row.appendChild(
        dom("span", {
          classes: ["rb-status"],
          text: status === "fulfilled" ? "Fulfilled" : "Open",
        }),
      );
      row.appendChild(
        dom("span", {
          classes: ["rb-name"],
          text: f.name || f.key,
          attrs: { title: f.name || f.key },
        }),
      );
      const openBtn = dom("button", {
        classes: ["rb-open"],
        attrs: { type: "button" },
        text: status === "fulfilled" ? "View" : "Fulfill",
      });
      openBtn.addEventListener("click", async () => {
        try {
          const file = this.owner.get(f.key) || f;
          await registry.roomie.showModal(new RequestViewModal(file));
          this.renderList();
        } catch (ex) {
          if (ex) {
            console.error(ex);
          }
        }
      });
      row.appendChild(openBtn);
      this.listEl.appendChild(row);
    }
  }
}
