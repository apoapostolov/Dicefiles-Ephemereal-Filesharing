"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fileKind, presentTorrent } = require("../../common/torrent-presentation");

function fixture(mobile = true) {
  const document = { listeners: {}, activeElement: null, addEventListener(name, fn) {
    this.listeners[name] = fn;
  } };

  class Element {
    constructor() {
      this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.classes = []; this.value = "";
      this.classList = { add: value => this.classes.push(value) };
    }
    setAttribute(key, value) {
      this.attributes[key] = value;
    }
    removeAttribute(key) {
      delete this.attributes[key];
    }
    appendChild(child) {
      this.children.push(child); child.parent = this; return child;
    }
    append(...children) {
      children.forEach(child => this.appendChild(child));
    }
    replaceChildren() {
      this.children = [];
    }
    remove() {
      this.parent.children = this.parent.children.filter(child => child !== this);
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    contains(target) {
      return target === this || this.children.some(child => child.contains(target));
    }
    getBoundingClientRect() {
      return { left: 310, top: 100, bottom: 130, width: 200, height: 70 };
    }
    focus() {
      document.activeElement = this;
    }
    click() {
      this.listeners.click?.({ preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() });
    }
  }

  document.createElement = () => new Element(); document.body = new Element();
  const dom = (_tag, { classes = [], text = "", attrs = {} } = {}) => {
    const el = new Element(); el.classes = classes; el.textContent = text; el.attributes = attrs; return el;
  };
  const source = fs.readFileSync(path.join(__dirname, "../../client/compact-tag.js"), "utf8").replace("export function", "function");
  const compactTag = vm.compileFunction(`${source}\nreturn compactTag;`, ["document", "addEventListener", "matchMedia", "innerWidth", "innerHeight"])(document, jest.fn(), () => ({ matches: mobile }), 360, 640);
  return { document, Element, dom, compactTag };
}

test("mobile poster pills reveal the full name, stay in the viewport and dismiss with Escape", () => {
  const { document, Element, compactTag } = fixture(); const tag = new Element();
  const fullName = "A complete poster name with no truncation"; compactTag(tag, fullName);
  tag.click(); const popup = document.body.children[0];
  expect(popup.textContent).toBe(fullName); expect(popup.style.left).toBe("152px");
  expect(tag.attributes["aria-expanded"]).toBe("true");
  document.listeners.keydown({ key: "Escape", preventDefault: jest.fn(), stopPropagation: jest.fn() });
  expect(document.body.children).toHaveLength(0); expect(tag.attributes["aria-expanded"]).toBe("false");
});

test("page pills support keyboard activation and desktop clicks retain their existing behavior", () => {
  const mobile = fixture(); const tag = new mobile.Element(); mobile.compactTag(tag, "12 pages");
  tag.listeners.keydown({ key: "Enter", preventDefault: jest.fn() });
  expect(mobile.document.body.children[0].textContent).toBe("12 pages");
  mobile.document.listeners.pointerdown({ target: mobile.document.body }); expect(mobile.document.body.children).toHaveLength(0);
  const desktop = fixture(false); const poster = new desktop.Element(); desktop.compactTag(poster, "Poster"); poster.click();
  expect(desktop.document.body.children).toHaveLength(0);
});

test("torrent refresh preserves the contents search and keyboard focus", async () => {
  const { document, dom } = fixture();

  class Modal {
    constructor() {
      this.body = dom("div");
    }
  }

  const registry = { socket: { makeCall: jest.fn(async () => ({ torrent: { availability: { seeders: 2 } } })) } };
  const source = fs.readFileSync(path.join(__dirname, "../../client/torrent-metadata.js"), "utf8").replace(/^import .*;$/gm, "").replace("export class", "class");
  const TorrentModal = vm.compileFunction(`${source}\nreturn TorrentMetadataModal;`, ["Modal", "registry", "dom", "toPrettySize", "fileKind", "presentTorrent", "document", "userError"])(Modal, registry, dom, n => `${n} B`, fileKind, presentTorrent, document, require("../../common/user-error").userError);
  const modal = new TorrentModal({ name: "Books", files: [{ path: "a.pdf", size: 4 }, { path: "b.epub", size: 8 }], trackers: [] }, "books.torrent", "/download", { kind: "file", key: "synthetic" });
  modal.search.value = "epub"; modal.search.oninput(); modal.search.focus();
  await modal.refresh(true);
  expect(modal.search.value).toBe("epub"); expect(document.activeElement).toBe(modal.search);
  expect(modal.refreshButton.disabled).toBe(false);
  expect(registry.socket.makeCall.mock.calls[0][0]).toBe("torrentdetails");
  const treeText = el => [el.textContent, ...el.children.map(treeText)].join(" ");
  expect(treeText(modal.body)).toContain("b.epub"); expect(treeText(modal.body)).not.toContain("a.pdf");
  expect(treeText(modal.body)).not.toContain("Info hash");
});

test("Appearance uses a palette SVG and mobile page count uses a document glyph", () => {
  const theme = fs.readFileSync(path.join(__dirname, "../../entries/theme.js"), "utf8");
  expect(theme).toContain("theme-icon"); expect(theme).toContain("<svg"); expect(theme).not.toContain("theme-launcher i-pref");
  const css = fs.readFileSync(path.join(__dirname, "../../entries/css/files.css"), "utf8");
  expect(css).toContain(".compact-tag.tag-pages::before"); expect(css).toContain("content: attr(data-tag-value)");
  expect(css).toContain("flex: 0 0 26px; width: 26px; min-width: 26px; max-width: 26px");
  expect(css).not.toContain("max-width: 15%");
});
