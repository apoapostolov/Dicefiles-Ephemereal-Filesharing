"use strict";

// Tab switching — toggles .tab-<name> class on #userprofile
const profileEl = document.querySelector("#userprofile");
const tabs = document.querySelectorAll(".profile-tab");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === target);
      t.setAttribute(
        "aria-selected",
        t.dataset.tab === target ? "true" : "false",
      );
    });
    profileEl.className = profileEl.className.replace(/\btab-\w+/g, "").trim();
    if (target !== "overview") {
      profileEl.classList.add(`tab-${target}`);
    }
  });
});

// Profile message form (owner only)
const form = document.querySelector("#profile-message-form");

if (form) {
  const aboutInput = document.querySelector("#profile-about-input");
  const lookingInput = document.querySelector("#profile-looking-input");
  const token = document.querySelector("#profile-token");
  const status = document.querySelector("#profile-message-status");

  const setStatus = (msg, isError) => {
    status.textContent = msg || "";
    status.classList.toggle("error", !!isError);
  };

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
          message: aboutInput.value || "",
          looking: lookingInput.value || "",
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
