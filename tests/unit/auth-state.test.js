"use strict";

const { EventEmitter } = require("events");
const { captureAuthentication, applyAuthentication } = require("../../common/auth-state");

test("early auth events survive component startup and update on logout/reconnect", () => {
  const socket = new EventEmitter();
  captureAuthentication(socket);
  socket.emit("authed", "synthetic-account");
  const classes = new Set();
  const body = { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } };
  const sync = account => applyAuthentication(body, account);
  socket.on("authed", sync);
  sync(socket.authState);
  expect([...classes]).toEqual(["authed"]);
  socket.emit("authed", null);
  expect([...classes]).toEqual(["unauthed"]);
  socket.emit("authed", "synthetic-account");
  expect([...classes]).toEqual(["authed"]);
});
