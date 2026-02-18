"use strict";

const form = document.querySelector("#profile-message-form");

if (!form) {
  throw new Error("No profile message form");
}

const input = document.querySelector("#profile-message-input");
const token = document.querySelector("#profile-token");
const status = document.querySelector("#profile-message-status");

function setStatus(msg, isError) {
  status.textContent = msg || "";
  status.classList.toggle("error", !!isError);
}

form.addEventListener("submit", async event => {
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
  }
  catch (ex) {
    setStatus(ex.message || ex.toString(), true);
  }
});

