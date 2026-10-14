"use strict";

const { mutableConfigValue } = require("../../lib/http/config-input");

test.each([[true, false, true], ["true", false, false], [null, 0, false], [Infinity, 10, false], [-1, 10, false], [10, 1, true], [{}, true, false], ["New title", "Title", true]])("runtime config validates value %p", (value, current, valid) => {
  expect(mutableConfigValue(value, current)).toBe(valid);
});
