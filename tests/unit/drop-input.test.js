"use strict";

const { collectDroppedFiles } = require("../../common/drop-input");

test("captures directory entries synchronously without reading their contents", () => {
  const entry = { isDirectory: true, name: "folder" };
  expect(collectDroppedFiles({ items: [{ kind: "file", webkitGetAsEntry: () => entry }], files: [] })).toEqual({ entries: [entry], files: [] });
});
test("falls back when an entry API returns null, without duplicating the FileList", () => {
  const file = { name: "fixture.pdf" };
  expect(collectDroppedFiles({ items: [{ kind: "file", webkitGetAsEntry: () => null, getAsFile: () => file }], files: [file] })).toEqual({ entries: [], files: [file] });
});
test("supports FileList-only browsers and ignores dragged text", () => {
  const file = { name: "fixture.png" };
  expect(collectDroppedFiles({ files: [file] }).files).toEqual([file]);
  expect(collectDroppedFiles({ items: [{ kind: "string" }], files: [] })).toEqual({ entries: [], files: [] });
});
