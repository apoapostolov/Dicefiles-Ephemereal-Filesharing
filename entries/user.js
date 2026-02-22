"use strict";

// ── Tab switching ──────────────────────────────────────────────────────────

const tabs = document.querySelectorAll(".profile-tab");
const panels = document.querySelectorAll(".profile-panel");

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
    panels.forEach((p) => {
      p.classList.toggle("hidden", p.dataset.panel !== target);
    });
  });
});

// ── Activity timestamps ────────────────────────────────────────────────────

function formatRelativeTime(ts) {
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)}h ago`;
  if (delta < 2592000_000) return `${Math.floor(delta / 86400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

document.querySelectorAll(".activity-time[data-ts]").forEach((el) => {
  const ts = parseInt(el.dataset.ts, 10);
  if (ts) el.textContent = formatRelativeTime(ts);
});

// ── Profile message form ───────────────────────────────────────────────────

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.value,
          realm: "acct",
          message: input.value || "",
        }),
      });
      const payload = await response.json();
      if (payload.err) throw new Error(payload.err);
      setStatus("Saved");
    } catch (ex) {
      setStatus(ex.message || ex.toString(), true);
    }
  });
}

// ── Interests form ────────────────────────────────────────────────────────

const interestsForm = document.querySelector("#profile-interests-form");

if (interestsForm) {
  const interestsInput = document.querySelector("#profile-interests-input");
  const interestsToken = document.querySelector("#profile-interests-token");
  const interestsStatus = document.querySelector("#profile-interests-status");

  function setInterestsStatus(msg, isError) {
    interestsStatus.textContent = msg || "";
    interestsStatus.classList.toggle("error", !!isError);
  }

  interestsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setInterestsStatus("Saving...");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: interestsToken.value,
          realm: "acct",
          interests: interestsInput.value || "",
        }),
      });
      const payload = await response.json();
      if (payload.err) throw new Error(payload.err);
      setInterestsStatus("Saved");
    } catch (ex) {
      setInterestsStatus(ex.message || ex.toString(), true);
    }
  });
}
