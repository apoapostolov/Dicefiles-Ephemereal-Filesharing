"use strict";

const { THEMES, normalizeTheme } = require("../common/themes");

const KEY = "dicefiles:theme";

function applyTheme(id, persist = false) {
  document.documentElement.dataset.theme = normalizeTheme(id);
  if (persist) {
    try {
      localStorage.setItem(KEY, normalizeTheme(id));
    }
    catch (_) { /* Appearance still works when storage is unavailable. */ }
  }
  dispatchEvent(new CustomEvent("dicefiles:theme", { detail: normalizeTheme(id) }));
}

try {
  applyTheme(localStorage.getItem(KEY));
}
catch (_) {
  applyTheme(null);
}
addEventListener("storage", event => {
  if (event.key === KEY) {
    applyTheme(event.newValue);
  }
});

addEventListener("DOMContentLoaded", () => {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "theme-launcher i-pref";
  trigger.title = "Appearance";
  trigger.setAttribute("aria-label", "Appearance");
  const host = document.querySelector("#main-right") || document.body;
  if (host === document.body) {
    trigger.classList.add("theme-launcher-floating");
  }
  host.appendChild(trigger);
  let dialog;
  trigger.addEventListener("click", () => {
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "theme-dialog";
      dialog.setAttribute("aria-labelledby", "theme-title");
      dialog.innerHTML = "<header><div><h2 id=\"theme-title\">Appearance</h2><p>Choose your reading room. Saved on this device.</p></div><button type=\"button\" class=\"theme-close\" aria-label=\"Close appearance\">×</button></header><label class=\"theme-search-label\">Find a theme<input type=\"search\" class=\"theme-search\" placeholder=\"Name, color or mood\" /></label><div class=\"theme-choices\" role=\"group\" aria-label=\"Color themes\"></div><p class=\"theme-status\" role=\"status\"></p>";
      document.body.appendChild(dialog);
      dialog.querySelector(".theme-close").onclick = () => dialog.close();
      dialog.addEventListener("close", () => trigger.focus());
      const choices = dialog.querySelector(".theme-choices");
      for (const theme of THEMES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "theme-choice";
        button.dataset.themeId = theme.id;
        button.setAttribute("aria-pressed", "false");
        const swatches = document.createElement("span");
        swatches.className = "theme-swatches";
        swatches.setAttribute("aria-hidden", "true");
        for (const color of [theme.canvas, theme.chrome, theme.text, theme.accent]) {
          const swatch = document.createElement("i");
          swatch.style.setProperty("--swatch", color);
          swatches.appendChild(swatch);
        }
        const name = document.createElement("strong");
        name.textContent = theme.name;
        const description = document.createElement("small");
        description.textContent = `${theme.mode === "dark" ? "Dark" : "Light"} · ${theme.description}`;
        button.append(swatches, name, description);
        button.onclick = () => {
          applyTheme(theme.id, true); sync();
        };
        choices.appendChild(button);
      }
      dialog.querySelector(".theme-search").addEventListener("input", event => {
        const query = event.target.value.toLowerCase().trim();
        for (const button of choices.children) {
          button.hidden = !button.textContent.toLowerCase().includes(query);
        }
      });
    }

    function sync() {
      const id = document.documentElement.dataset.theme;
      for (const button of dialog.querySelectorAll(".theme-choice")) {
        button.setAttribute("aria-pressed", String(button.dataset.themeId === id));
      }
      dialog.querySelector(".theme-status").textContent = `${THEMES.find(t => t.id === id).name} selected · ${THEMES.length} themes`;
    }

    sync();
    dialog.showModal();
    dialog.querySelector(".theme-search").focus();
  });
});
