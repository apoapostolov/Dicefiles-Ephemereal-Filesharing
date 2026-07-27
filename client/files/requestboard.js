"use strict";

import Modal from "../modal";
import { dom } from "../util";
import {
  buildRequestBoard,
  summarizeRequestBoard,
  requestStatus,
} from "../../lib/room/request-board";
import { RequestViewModal } from "./requestmodal";
import registry from "../registry";

/**
 * First-class request board over existing request file objects.
 */
export default class RequestBoardModal extends Modal {
  constructor(owner) {
    super(
      "requestboard",
      "Request board",
      {
        text: "Close",
        cancel: true,
      },
    );
    this.owner = owner;
    this.filterStatus = "all";

    this.summaryEl = dom("div", { classes: ["rb-summary"] });
    this.filterRow = dom("div", { classes: ["rb-filters"] });
    for (const [id, label] of [
      ["all", "All"],
      ["open", "Open"],
      ["fulfilled", "Fulfilled"],
    ]) {
      const btn = dom("button", {
        classes: ["rb-filter-btn", ...(id === "all" ? ["active"] : [])],
        attrs: { type: "button", "data-status": id },
        text: label,
      });
      btn.addEventListener("click", () => {
        this.filterStatus = id;
        for (const b of this.filterRow.querySelectorAll(".rb-filter-btn")) {
          b.classList.toggle("active", b.dataset.status === id);
        }
        this.renderList();
      });
      this.filterRow.appendChild(btn);
    }

    this.listEl = dom("div", { classes: ["rb-list"] });
    this.body.appendChild(this.summaryEl);
    this.body.appendChild(this.filterRow);
    this.body.appendChild(this.listEl);
    this.renderList();
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
        text: "Open",
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
