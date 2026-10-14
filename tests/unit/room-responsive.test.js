"use strict";

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const root = path.join(__dirname, "../..");

function splitter(saved) {
  const properties = new Map();
  const body = { clientWidth: 1024, style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) } };
  const chat = { style: { removeProperty: jest.fn() } };
  const handle = { style: {}, classList: { add: jest.fn(), remove: jest.fn() }, addEventListener: jest.fn() };
  const storage = { getItem: () => saved, setItem: jest.fn(), removeItem: jest.fn() };
  const document = { body, querySelector: selector => selector === "#chat" ? chat : handle };
  const window = { matchMedia: () => ({ matches: false }) };
  const source = fs.readFileSync(path.join(root, "client/splitter.js"), "utf8").replace(/^import .*;$/gm, "").replace("export default", "return");
  const instance = require("vm").compileFunction(source, ["EventEmitter", "document", "window", "localStorage", "registry", "nukeEvent", "addEventListener", "removeEventListener"])(EventEmitter, document, window, storage, { roomie: new EventEmitter() }, () => {}, jest.fn(), jest.fn());

  return { instance, body, chat, properties, storage };
}

test("tablet widths retain two panes; phone layout is scoped below 761px", () => {
  const css = fs.readFileSync(path.join(root, "entries/css/room.css"), "utf8");
  expect(css).toMatch(/@media \(max-width: 760px\)\s*\{\s*body#room\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  expect(css).toContain("var(--chat-width, 32%)");
});
test("saved pane sizes cannot override the responsive grid", () => {
  const { instance, body, chat, properties } = splitter(JSON.stringify({ width: 400, page: 1024 }));
  instance.restore(); expect(properties.get("--chat-width")).toBe("400px");
  expect(body.style.gridTemplateColumns).toBeUndefined(); expect(chat.style.width).toBeUndefined();
  instance.onresize(); expect(chat.style.removeProperty).toHaveBeenCalledWith("width");
});
test("corrupt pane preferences are discarded", () => {
  const { instance, storage } = splitter("{");
  expect(() => instance.restore()).not.toThrow(); expect(storage.removeItem).toHaveBeenCalledWith("clientWidth");
});

test("wide toolbars stay on one line and phones use three deliberate rows", () => {
  const css = fs.readFileSync(path.join(root, "entries/css/room.css"), "utf8");
  const toolbarRules = [...css.matchAll(/#room > #tools\s*\{([^}]+)\}/g)].map(match => match[1]).join("\n");
  expect(toolbarRules).not.toMatch(/flex-wrap:\s*wrap/);
  expect(css).toContain("grid-template-rows: repeat(3, auto)");
  expect(css).toContain("overflow-x: auto");
  expect(css).toContain("#tools > .tools-row { display: contents; }");
  expect(css).toMatch(/@media \(max-width: 760px\)\s*\{\s*#room > #tools\s*\{\s*display: grid;/);
  expect(css).toContain("#tools .tools-search-row { grid-row: 3; grid-column: 1 / -1; }");
  expect(css).toContain("content: attr(data-compact-text)");
  expect(css).toContain("#tools > .tools-filters-row { display: contents; }");
  const template = fs.readFileSync(path.join(root, "views/room.ejs"), "utf8");
  const searchGroup = template.split("class=\"tools-row tools-search-row\"")[1].split("class=\"spacer\"")[0];
  expect(searchGroup).toContain("id=\"filter\"");
  expect(searchGroup).toContain("id=\"filter-status\"");
  expect(searchGroup).toContain("id=\"up\"");
  const actionsGroup = template.split("class=\"tools-row tools-modes-row\"")[1].split("</nav>")[0];
  expect(actionsGroup).not.toContain("id=\"up\"");
});

test("Continue reading has a separate dismiss button and token-based neutral surfaces", () => {
  const template = fs.readFileSync(path.join(root, "views/room.ejs"), "utf8");
  expect(template).toContain("id=\"continuity-resume-card\"");
  expect(template).toContain("id=\"continuity-resume-dismiss\"");
  expect(template).not.toContain("id=\"continuity-resume\" class=\"hidden\"");
  const css = fs.readFileSync(path.join(root, "entries/css/files.css"), "utf8");
  expect(css).toContain("background: var(--panel-bg)");
  expect(css).not.toContain("rgba(22, 25, 30");
  expect(css).not.toContain("rgba(87, 196, 255");
  expect(css).not.toContain("#c7d0ff");
  expect(css).not.toContain("rgba(143, 162, 255");
});

test("reader-progress listeners keep the debounce callback argument-free", () => {
  const source = fs.readFileSync(path.join(root, "client/files.js"), "utf8");
  expect(source).toContain("const refreshProgress = debounce(() => this.refreshContinuity(), 500)");
  expect(source).not.toContain("debounce(event =>");
});
test("tablet rows and compact phone filename space are explicit", () => {
  const room = fs.readFileSync(path.join(root, "entries/css/room.css"), "utf8");
  const files = fs.readFileSync(path.join(root, "entries/css/files.css"), "utf8");
  const gallery = fs.readFileSync(path.join(root, "entries/css/gallery.css"), "utf8");
  expect(room).toContain("@media (min-width: 761px) and (max-width: 1350px)");
  expect(room).toContain("grid-template-rows: repeat(2, auto)");
  expect(room).toContain("#status > div { margin-left: 0; white-space: nowrap; }");
  expect(files).toContain("max-width: 35%");
  expect(files).toContain("flex: 1 1 0; min-width: 0");
  expect(gallery).toContain("#gallery_close,\n#gallery_download");
  expect(gallery).toContain("inset-inline-end: calc(0.75rem + 50px); opacity: 1;");
  expect(fs.readFileSync(path.join(root, "views/room.ejs"), "utf8")).toContain("id=\"gallery_download\" class=\"i-download\" type=\"button\"");
});

test("gallery paging does not inherit the global nav full height", () => {
  const css = fs.readFileSync(path.join(root, "entries/css/files.css"), "utf8");
  expect(css).toMatch(/\.gallery-pager\s*\{[^}]*height:\s*auto;/s);
  expect(css).toMatch(/\.gallery-pager\s*\{[^}]*grid-area:\s*auto;/s);
});

test("mobile dropdowns retain all sort and view choices and filters shrink to fit", () => {
  const template = fs.readFileSync(path.join(root, "views/room.ejs"), "utf8");
  expect(template).toContain("id=\"sort-mode-mobile\" type=\"button\"");
  expect(template).toContain("id=\"view-mode-mobile\" type=\"button\"");
  const source = fs.readFileSync(path.join(root, "client/files.js"), "utf8");
  for (const value of ["newest", "largest", "expiring", "list", "gallery", "links"]) {
    expect(source).toContain(`value: "${value}"`);
  }
  const css = fs.readFileSync(path.join(root, "entries/css/room.css"), "utf8");
  expect(css).toContain("flex: 1 1 0");
  expect(css).toContain("grid-auto-columns: minmax(0, 1fr)");
  expect(css).toContain("#tools .tools-modes-row .viewmode-pill { display: none; }");
});

test("mobile view selection follows desktop, persisted and links state", () => {
  const source = fs.readFileSync(path.join(root, "client/files.js"), "utf8");
  const method = source.split("  syncMobileViewMode() {")[1].split("\n  nailOff()")[0];
  const sync = require("vm").compileFunction(`return function() {${method}`)();

  const state = { viewDropdown: { setSelected: jest.fn() }, linksMode: false, galleryMode: false };
  sync.call(state); expect(state.viewDropdown.setSelected).toHaveBeenLastCalledWith("list");
  state.galleryMode = true; sync.call(state); expect(state.viewDropdown.setSelected).toHaveBeenLastCalledWith("gallery");
  state.linksMode = true; sync.call(state); expect(state.viewDropdown.setSelected).toHaveBeenLastCalledWith("links");
  expect(source).not.toContain("this.normalMode()");
  expect(source).toContain("this.viewDropdown?.setDisabled(\"links\", linkCollection === false)");
  const render = source.split("  insertFilesIntoDOM(files, remove) {")[1].split("  async addFileElements")[0];
  expect(render).toContain("this.delayedUpdateStatus()");
});

test("list-to-gallery transitions append tiles after removing list spacers", () => {
  const source = fs.readFileSync(path.join(root, "client/files.js"), "utf8");
  const method = source.split("  insertFilesIntoDOM(files, remove) {")[1].split("\n  async addFileElements")[0];
  const document = { activeElement: null };
  const render = require("vm").compileFunction(`return function(files, remove) {${method}`, ["document", "dom"])(document, jest.fn());

  const container = { children: [], classList: { toggle: jest.fn() }, insertBefore(child, anchor) {
    if (anchor && !this.children.includes(anchor)) {
      throw new Error("Detached anchor");
    }
    this.children.push(child);
  } };
  const node = isFile => ({ classList: { contains: name => isFile && name === "file" }, remove() {
    container.children = container.children.filter(child => child !== this);
  } });
  const top = node(false); const bottom = node(false); const oldRow = node(true);
  container.children.push(top, oldRow, bottom);
  container.querySelector = selector => selector.endsWith("top") ? top : bottom;
  const files = [1, 2].map(() => ({ el: node(true), adjustPreview: jest.fn() }));
  const owner = { el: container, files, galleryMode: true, linksMode: false, galleryPager: {}, galleryPrevious: {}, galleryNext: {}, galleryPageStatus: {}, setFileStyle: jest.fn(), delayedUpdateStatus: jest.fn(), getVisibleWindow: () => ({ items: files, virtualized: false, galleryPaged: true, page: 0, pages: 11, total: 1003 }) };
  expect(() => render.call(owner, files)).not.toThrow();
  expect(container.children).toEqual(files.map(file => file.el));
  expect(owner.delayedUpdateStatus).toHaveBeenCalled();
});
