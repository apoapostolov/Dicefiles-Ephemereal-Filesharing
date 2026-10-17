"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function selectionFixture() {
  const source = fs.readFileSync(path.join(__dirname, "../../client/files.js"), "utf8");
  const method = source.match(/ {2}select\(file, e\) \{[\s\S]*?\n {2}\}/)?.[0];
  if (!method) {
    throw new Error("Could not find the file selection method");
  }
  const select = vm.compileFunction(`return ({${method}}).select;`, [])();
  const files = Array.from({ length: 5 }, (_, index) => {
    const selected = new Set();
    return {
      name: `file-${index}`,
      el: {
        classList: {
          add: name => {
            selected.add(name);
          },
          remove: name => {
            selected.delete(name);
          },
          contains: name => {
            return selected.has(name);
          },
          toggle: name => {
            return selected.has(name) ? selected.delete(name) : selected.add(name);
          },
        },
      },
    };
  });
  const owner = {
    files,
    selectionStart: null,
    get visible() {
      return this.files;
    },
    get selection() {
      return this.files.filter(file => file.el.classList.contains("selected"));
    },
    _clearSelection() {
      this.selection.forEach(file => file.el.classList.remove("selected"));
    },
    select,
  };
  const click = (file, modifiers = {}) => owner.select(file, modifiers);
  return { owner, files, click };
}

function fixture(role = "owner") {
  const source = fs.readFileSync(path.join(__dirname, "../../client/files/file.js"), "utf8").replace(/^import .*;$/gm, "").replace("export default class File", "class File");
  const document = { body: { classList: { contains: name => name === role } } };
  const registry = { roomie: { showModal: jest.fn(async () => {}) } };
  const nukeEvent = event => {
    event.preventDefault(); event.stopPropagation(); return false;
  };
  const File = vm.compileFunction(`${source}\nreturn File;`, ["BaseFile", "document", "nukeEvent", "registry", "APOOL"])(class {}, document, nukeEvent, registry, { wrap: fn => fn });
  const file = Object.create(File.prototype);
  Object.assign(file, { owner: { select: jest.fn(), openGallery: jest.fn(), openRequestView: jest.fn() }, meta: {}, name: "synthetic.pdf", type: "document", download: jest.fn() });
  const event = properties => ({ button: 0, preventDefault: jest.fn(), stopPropagation: jest.fn(), ...properties });
  return { file, event, registry, source };
}

test.each(["owner", "mod"])("%s modifier clicks select before any file action", role => {
  for (const modifier of ["ctrlKey", "shiftKey", "metaKey"]) {
    const { file, event, registry } = fixture(role);
    const e = event({ [modifier]: true });
    // Browser propagation reaches child links only if capture did not stop it.
    file.onselectionclick(e);
    if (!e.stopPropagation.mock.calls.length) {
      file.onclick(e); file.download();
    }
    expect(e.preventDefault).toHaveBeenCalled(); expect(e.stopPropagation).toHaveBeenCalled();
    expect(file.owner.select).toHaveBeenCalledWith(file, e);
    expect(file.download).not.toHaveBeenCalled(); expect(file.owner.openGallery).not.toHaveBeenCalled();
    expect(registry.roomie.showModal).not.toHaveBeenCalled();
  }
});

test("selection capture applies to every row control before its click handler", () => {
  const { file, event, source } = fixture();
  expect(source).toContain("this.el.addEventListener(\"click\", this.onselectionclick.bind(this), true)");
  for (const target of ["name", "icon", "preview", "detail", "gallery-dl", "tag"]) {
    const e = event({ target: { className: target }, ctrlKey: true });
    file.onselectionclick(e); expect(e.preventDefault).toHaveBeenCalled();
  }
});

test("ordinary and non-primary clicks keep their existing actions", () => {
  const { file, event } = fixture();
  for (const properties of [{}, { altKey: true }, { button: 1, ctrlKey: true }, { button: 2, shiftKey: true }]) {
    const e = event(properties); file.onselectionclick(e);
    expect(e.preventDefault).not.toHaveBeenCalled(); expect(file.owner.select).not.toHaveBeenCalled();
  }
});

test.each(["owner", "mod"])("%s icon clicks select without downloading", role => {
  const { file, event } = fixture(role); const e = event(); file.oniconclick(e);
  expect(file.owner.select).toHaveBeenCalledWith(file, e); expect(file.download).not.toHaveBeenCalled();
  expect(e.preventDefault).toHaveBeenCalled();
});

test("selection permissions stay unchanged and ordinary guest icon clicks still download", () => {
  const { file, event } = fixture("guest"); const modified = event({ ctrlKey: true });
  file.onselectionclick(modified); expect(modified.preventDefault).not.toHaveBeenCalled();
  expect(file.owner.select).not.toHaveBeenCalled();
  file.oniconclick(event()); expect(file.download).toHaveBeenCalledTimes(1);
});

test("Ctrl/Command click selects only the inclusive range from the first selected file", () => {
  const { owner, files, click } = selectionFixture();
  click(files[1], {});
  click(files[3], { ctrlKey: true });
  expect(owner.selection).toEqual(files.slice(1, 4));
  click(files[0], { metaKey: true });
  expect(owner.selection).toEqual(files.slice(0, 2));
});

test("Ctrl/Command click without a visible anchor selects only the clicked file", () => {
  const { owner, files, click } = selectionFixture();
  click(files[2], { ctrlKey: true });
  expect(owner.selection).toEqual([files[2]]);
  expect(owner.selectionStart).toBe(files[2]);
});

test("Ctrl/Command click with a filtered-out anchor does not select the visible list", () => {
  const { owner, files, click } = selectionFixture();
  owner.selectionStart = files[0];
  owner.files = files.slice(1);
  click(files[3], { ctrlKey: true });
  expect(owner.selection).toEqual([files[3]]);
  expect(owner.selectionStart).toBe(files[3]);
});

test("Shift-click toggles individual files without changing an existing anchor", () => {
  const { owner, files, click } = selectionFixture();
  click(files[1], {});
  const anchor = owner.selectionStart;
  click(files[3], { shiftKey: true });
  expect(owner.selection).toEqual([files[1], files[3]]);
  expect(owner.selectionStart).toBe(anchor);
  click(files[1], { shiftKey: true });
  expect(owner.selection).toEqual([files[3]]);
});
