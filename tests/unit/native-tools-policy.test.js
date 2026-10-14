"use strict";

test("a container's disabled native-tools policy prevents spawning parsers", () => {
  jest.resetModules();
  const spawn = jest.fn();
  jest.doMock("../../lib/config", () => ({ get: key => key === "nativeTools" ? false : true }));
  jest.doMock("child_process", () => ({ spawn, spawnSync: jest.fn() }));
  const { spawnBounded, spawnJailed } = require("../../lib/media/jail");

  expect(() => spawnBounded(["pdftoppm", "untrusted.pdf"])).toThrow("disabled");
  expect(() => spawnJailed(["7z", "untrusted.zip"])).toThrow("disabled");
  expect(spawn).not.toHaveBeenCalled();
  jest.dontMock("../../lib/config");
  jest.dontMock("child_process");
});
