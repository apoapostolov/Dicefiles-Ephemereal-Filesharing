"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("PDF teardown uses the loading task and cancels render/observer work", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../client/files/reader/pdf.js"), "utf8").replace(/^import .*;$/gm, "").replace(/export \{\s*PDFReader\s*\};/, "return PDFReader;");
  const PDFReader = vm.compileFunction(source, ["window"])({});
  const reader = new PDFReader({ textContent: "preview" }, {});
  const destroy = jest.fn(() => Promise.resolve()); const cancel = jest.fn(); const disconnect = jest.fn();
  reader.pdfDoc = { numPages: 1 }; reader.loadingTask = { destroy }; reader.renderTasks.add({ cancel }); reader.visibilityObservers.add({ disconnect });
  expect(() => reader.destroy()).not.toThrow(); expect(destroy).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalled(); expect(disconnect).toHaveBeenCalled(); expect(reader.container.textContent).toBe("");
  reader.destroy(); expect(destroy).toHaveBeenCalledTimes(1);
});
