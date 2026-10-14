"use strict";

const fs = require("fs");
const path = require("path");

function fixture() {
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.dataset = {}; this.disabled = false; this.textContent = ""; this.offsetWidth = 176; this.offsetHeight = 144;
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    appendChild(child) {
      this.children.push(child); child.parentElement = this; return child;
    }
    replaceChildren(...children) {
      this.children = []; children.forEach(child => this.appendChild(child));
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    contains(target) {
      return target === this || this.children.some(child => child.contains(target));
    }
    focus() {
      document.activeElement = this;
    }
    getBoundingClientRect() {
      return { left: 300, bottom: 40 };
    }
  }

  const document = { createElement: tag => new Element(tag), body: new Element("body"), documentElement: { clientWidth: 320 }, listeners: {}, addEventListener(name, fn) {
    this.listeners[name] = fn;
  } };
  const source = fs.readFileSync(path.join(__dirname, "../../client/files/toolbar-dropdown.js"), "utf8").replace("export default", "return");
  const Dropdown = require("vm").compileFunction(source, ["document", "addEventListener", "innerHeight"])(document, jest.fn(), 200);

  const trigger = new Element("button"); trigger.id = "sort"; trigger.dataset.label = "Sort files";
  const items = ["newest", "largest", "expiring"].map(value => ({ value, label: value, glyph: () => new Element("svg") }));
  const onChange = jest.fn(); const dropdown = new Dropdown(trigger, items, onChange);
  dropdown.setSelected("largest");
  return { dropdown, trigger, document, onChange };
}

test("selected buttons contain a glyph and expose their label to assistive technology", () => {
  const { dropdown, trigger } = fixture();
  expect(trigger.textContent).toBe(""); expect(trigger.children).toHaveLength(1);
  expect(trigger.children[0].attributes["aria-hidden"]).toBe("true");
  expect(trigger.attributes["aria-label"]).toBe("Sort files: largest");
  expect(dropdown.buttons.map(button => button.textContent)).toEqual(["newest", "largest", "expiring"]);
  expect(dropdown.buttons[1].attributes["aria-checked"]).toBe("true");
});

test("menus stay within a narrow viewport and focus the current selection", () => {
  const { dropdown, trigger, document } = fixture(); dropdown.open();
  expect(dropdown.menu.style.left).toBe("136px"); expect(dropdown.menu.style.top).toBe("44px");
  expect(document.activeElement).toBe(dropdown.buttons[1]);
  expect(trigger.attributes["aria-expanded"]).toBe("true");
});

test("arrow navigation skips disabled choices and Escape restores trigger focus", () => {
  const { dropdown, trigger, document } = fixture(); dropdown.setDisabled("expiring", true); dropdown.open();
  dropdown.onKey({ key: "ArrowDown", preventDefault: jest.fn() });
  expect(document.activeElement).toBe(dropdown.buttons[0]);
  dropdown.onKey({ key: "Escape", preventDefault: jest.fn() });
  expect(document.activeElement).toBe(trigger); expect(dropdown.menu.hidden).toBe(true);
});

test("choosing a mode calls the handler and closes the menu", () => {
  const { dropdown, trigger, document, onChange } = fixture(); dropdown.open(); dropdown.buttons[0].listeners.click();
  expect(onChange).toHaveBeenCalledWith("newest"); expect(dropdown.menu.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

test("outside clicks dismiss the menu while inside clicks retain it", () => {
  const { dropdown, document } = fixture(); dropdown.open();
  document.listeners.pointerdown({ target: dropdown.buttons[1] }); expect(dropdown.menu.hidden).toBe(false);
  document.listeners.pointerdown({ target: document.body }); expect(dropdown.menu.hidden).toBe(true);
});
