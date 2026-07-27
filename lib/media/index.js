"use strict";

/**
 * Media pipeline facade.
 * Types and jail helpers live here; generateAssets/getMetaData remain in lib/meta.js
 * until further extractor splits land.
 */

const types = require("./types");
const jail = require("./jail");
const meta = require("../meta");

module.exports = Object.assign(
  {
    getMetaData: meta.getMetaData,
    generateAssets: meta.generateAssets,
  },
  types,
  jail,
  meta,
);
