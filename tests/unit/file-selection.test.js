"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
