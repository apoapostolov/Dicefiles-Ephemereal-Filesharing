"use strict";

/**
 * Socket client protocol facade.
 * Implementation remains in lib/client.js for behavior stability; this module
 * documents the public surface used by httpserver / room wiring.
 */

const { Client } = require("../client");

module.exports = {
  Client,
  create: (socket, rtoken) => Client.create(socket, rtoken),
};
