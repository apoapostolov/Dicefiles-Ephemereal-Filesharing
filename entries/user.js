"use strict";

// Tab switching
const tabs = document.querySelectorAll(".profile-tab");
const panels = document.querySelectorAll(".profile-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === target);
      t.setAttribute("aria-selected", t.dataset.tab === target ? "true" : "false");
    });
    panels.forEach((p) => {
      p.classList.toggle("hidden", p.dataset.panel !== target);
    });
  });
});

// Profile message form (owner only)
const form = document.querySelector("#profile-message-form");

if (form) {
  const input = document.querySelector("#profile-message-input");
  const token = document.querySelector("#profile-token");
  const status = document.querySelector("#profile-message-status");

  function setStatus(msg, isError) {
    status.textContent = msg || "";
    status.classList.toggle("error", !!isError);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Saving...");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: token.value,
          realm: "acct",
          message: input.value || "",
        }),
      });
      const payload = await response.json();
      if (payload.err) {
        throw new Error(payload.err);
      }
      setStatus("Saved");
      window.location.reload();
    } catch (ex) {
      setStatus(ex.message || ex.toString(), true);
    }
  });
}
