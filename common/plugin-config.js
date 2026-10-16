"use strict";

/** JSON-schema defaults agree between operator forms and runtime defaults. */
function defaultPluginConfig(schema) {
  const config = {};
  for (const [key, definition] of Object.entries(schema?.properties || {})) {
    if (key === "roomId") {
      continue;
    }
    if (definition?.default !== undefined) {
      config[key] = JSON.parse(JSON.stringify(definition.default));
    }
    else {
      config[key] = definition?.type === "boolean" ? false : definition?.type === "array" ? [] : "";
    }
  }
  return config;
}

module.exports = { defaultPluginConfig };
