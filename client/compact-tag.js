"use strict";

let active = null;

function close() {
  if (!active) {
    return;
  }
  active.anchor.setAttribute("aria-expanded", "false");
  active.anchor.removeAttribute("aria-describedby");
  active.popup.remove(); active = null;
}

function show(anchor, text) {
  if (active?.anchor === anchor) {
    close(); return;
  }
  close();
  const popup = document.createElement("div");
  popup.className = "compact-tag-popover";
  popup.id = "compact-tag-details";
  popup.setAttribute("role", "tooltip");
  popup.textContent = text;
  document.body.appendChild(popup);
  anchor.setAttribute("aria-expanded", "true"); anchor.setAttribute("aria-describedby", popup.id);
  const box = anchor.getBoundingClientRect(); const size = popup.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(box.left, innerWidth - size.width - 8))}px`;
  popup.style.top = `${box.bottom + size.height + 12 <= innerHeight ? box.bottom + 6 : Math.max(8, box.top - size.height - 6)}px`;
  active = { anchor, popup };
}

document.addEventListener("pointerdown", event => {
  if (active && !active.anchor.contains(event.target) && !active.popup.contains(event.target)) {
    close();
  }
}, true);
document.addEventListener("keydown", event => {
  if (active && event.key === "Escape") {
    event.preventDefault(); event.stopPropagation(); close();
  }
}, true);
addEventListener("resize", close);
addEventListener("scroll", close, true);

export function compactTag(tag, text) {
  tag.classList.add("compact-tag");
  tag.setAttribute("role", "button"); tag.tabIndex = 0;
  tag.setAttribute("aria-expanded", "false");
  tag.addEventListener("click", event => {
    if (!matchMedia("(max-width: 760px)").matches) {
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    show(tag, text);
  }, true);
  tag.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); tag.click();
    }
  });
}
