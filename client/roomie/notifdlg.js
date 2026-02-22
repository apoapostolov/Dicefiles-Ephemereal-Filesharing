"use strict";

import Modal from "../modal";
import { dom } from "../util";

export const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  enabled: false,
  notifyFiles: true,
  notifyRequests: true,
  muteRoom: false,
});

export class NotificationModal extends Modal {
  constructor(owner, settings) {
    super(
      "notifydlg",
      "Notifications",
      {
        text: "Save",
        default: true,
      },
      {
        text: "Cancel",
        cancel: true,
      },
    );

    this.owner = owner;
    this.settings = Object.assign(
      {},
      DEFAULT_NOTIFICATION_SETTINGS,
      settings || {},
    );
    this.panel = dom("div", { classes: ["notify-panel"] });
    this.body.appendChild(this.panel);

    this.enabledEl = this.addToggleRow(
      "notify-enabled",
      "Enable desktop notifications",
      !!this.settings.enabled,
    );
    this.notifyFilesEl = this.addToggleRow(
      "notify-files",
      "Notify for new files",
      !!this.settings.notifyFiles,
    );
    this.notifyRequestsEl = this.addToggleRow(
      "notify-requests",
      "Notify for new requests",
      !!this.settings.notifyRequests,
    );
    this.muteRoomEl = this.addToggleRow(
      "notify-mute",
      "Mute this room",
      !!this.settings.muteRoom,
    );

    this.permissionStatusEl = dom("p", {
      classes: ["notify-permission-status"],
    });
    this.panel.appendChild(this.permissionStatusEl);
    this.updatePermissionStatus();

    this.enabledEl.addEventListener("change", () =>
      this.updatePermissionStatus(),
    );
  }

  addToggleRow(id, text, checked) {
    const row = dom("div", { classes: ["notify-row"] });
    const label = dom("label", {
      classes: ["notify-text"],
      attrs: { for: id },
      text,
    });
    const input = dom("input", {
      attrs: {
        id,
        type: "checkbox",
      },
      classes: ["notify-toggle"],
    });
    input.checked = !!checked;

    row.appendChild(label);
    row.appendChild(input);

    row.addEventListener("click", e => {
      if (e.target === input) {
        return;
      }
      input.checked = !input.checked;
      if (id === "notify-enabled") {
        this.updatePermissionStatus();
      }
    });

    this.panel.appendChild(row);
    return input;
  }

  get values() {
    return {
      enabled: this.enabledEl.checked,
      notifyFiles: this.notifyFilesEl.checked,
      notifyRequests: this.notifyRequestsEl.checked,
      muteRoom: this.muteRoomEl.checked,
    };
  }

  updatePermissionStatus() {
    if (!("Notification" in window)) {
      this.permissionStatusEl.textContent =
        "Your browser does not support desktop notifications.";
      return;
    }

    const perm = Notification.permission;
    if (!this.enabledEl.checked) {
      this.permissionStatusEl.textContent =
        "Desktop notifications are disabled for this room.";
      return;
    }
    if (perm === "granted") {
      this.permissionStatusEl.textContent = "Browser permission is granted.";
      return;
    }
    if (perm === "denied") {
      this.permissionStatusEl.textContent =
        "Browser permission is denied. Enable notifications in browser site settings.";
      return;
    }
    this.permissionStatusEl.textContent =
      "Permission will be requested after you save.";
  }

  validate() {
    return true;
  }
}
