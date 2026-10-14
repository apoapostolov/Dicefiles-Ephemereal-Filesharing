"use strict";

export default class ToolbarDropdown {
  constructor(trigger, items, onChange) {
    this.trigger = trigger;
    this.items = items;
    this.onChange = onChange;
    this.value = null;
    this.menu = document.createElement("div");
    this.menu.id = `${trigger.id}-menu`;
    this.menu.className = "toolbar-dropdown-menu";
    this.menu.hidden = true;
    this.menu.setAttribute("role", "menu");
    this.menu.setAttribute("aria-label", trigger.dataset.label);
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-controls", this.menu.id);
    trigger.setAttribute("aria-expanded", "false");
    this.buttons = items.map(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.textContent = item.label;
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", "false");
      button.addEventListener("click", () => {
        if (!button.disabled) {
          onChange(item.value);
          this.close(true);
        }
      });
      this.menu.appendChild(button);
      return button;
    });
    document.body.appendChild(this.menu);
    trigger.addEventListener("click", () => this.menu.hidden ? this.open() : this.close(true));
    trigger.addEventListener("keydown", event => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.open(event.key === "ArrowUp");
      }
    });
    this.menu.addEventListener("keydown", event => this.onKey(event));
    document.addEventListener("pointerdown", event => {
      if (!trigger.contains(event.target) && !this.menu.contains(event.target)) {
        this.close(false);
      }
    });
    addEventListener("resize", () => this.close(false));
  }

  setSelected(value) {
    const index = this.items.findIndex(item => item.value === value);
    if (index < 0) {
      return;
    }
    this.value = value;
    const item = this.items[index];
    const glyph = item.glyph();
    glyph.setAttribute("aria-hidden", "true");
    this.trigger.replaceChildren(glyph);
    this.trigger.setAttribute("aria-label", `${this.trigger.dataset.label}: ${item.label}`);
    this.buttons.forEach((button, i) => button.setAttribute("aria-checked", String(i === index)));
  }

  setDisabled(value, disabled) {
    const index = this.items.findIndex(item => item.value === value);
    if (index >= 0) {
      this.buttons[index].disabled = disabled;
    }
  }

  open(last = false) {
    this.menu.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    const bounds = this.trigger.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    this.menu.style.left = `${Math.max(8, Math.min(bounds.left, width - this.menu.offsetWidth - 8))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - this.menu.offsetHeight - 8))}px`;
    const enabled = this.buttons.filter(button => !button.disabled);
    const selected = this.buttons[this.items.findIndex(item => item.value === this.value)];
    const target = last ? enabled[enabled.length - 1] : selected?.disabled ? enabled[0] : selected || enabled[0];
    target?.focus();
  }

  close(restoreFocus) {
    if (this.menu.hidden) {
      return;
    }
    this.menu.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) {
      this.trigger.focus();
    }
  }

  onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close(true);
      return;
    }
    if (event.key === "Tab") {
      this.close(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const enabled = this.buttons.filter(button => !button.disabled);
    const current = enabled.indexOf(document.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
    enabled[index]?.focus();
  }
}
