"use strict";

function normalizePluginId(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (id === "mega" || id === "mega.nz") {
    return "mega-folder";
  }
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ? id : "";
}

module.exports = { normalizePluginId };
