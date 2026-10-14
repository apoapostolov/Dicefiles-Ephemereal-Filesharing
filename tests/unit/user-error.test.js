"use strict";

const { userError } = require("../../common/user-error");

test.each([
  ["Invalid username or password", "Check your username"],
  ["Invalid two-factor authentication code!", "authenticator"],
  ["Invalid request token", "Refresh this page"],
  ["cannot have params", "contact the site operator"],
  ["Call timeout", "Check your connection"],
  ["ENOENT /private/secret.env", "contact the site operator"],
])("provides recovery for %s", (input, expected) => {
  expect(userError(input)).toContain(expected);
});
test("does not expose exception paths or URLs", () => {
  expect(userError(new Error("invalid https://host/?key=secret"))).not.toContain("secret");
});
test("recovery messages are stable across API and dialog formatting", () => {
  const message = userError("Invalid username or password");
  expect(userError(message)).toBe(message);
});
