"use strict";

const properties = {
  includeExtensions: { type: "array", items: { type: "string" }, description: "Import only these filename extensions, for example pdf, epub, zip; empty means all" },
  excludeNameContains: { type: "array", items: { type: "string" }, description: "Skip filenames containing these literal terms (case insensitive)" },
  dryRun: { type: "boolean", description: "Preview eligible files without downloading, uploading or remembering them" },
};

function validate(config) {
  const errors = [];
  for (const field of ["includeExtensions", "excludeNameContains"]) {
    if (config[field] != null && (!Array.isArray(config[field]) || config[field].length > 50 || config[field].some(value => typeof value !== "string" || !value.trim() || value.length > 100))) {
      errors.push(`${field} must contain at most 50 non-empty text values`);
    }
  }
  if (Array.isArray(config.includeExtensions) && config.includeExtensions.some(value => typeof value !== "string" || !/^\.?[a-z0-9]{1,16}$/i.test(value))) {
    errors.push("includeExtensions must contain extensions such as pdf or epub");
  }
  if (config.dryRun != null && typeof config.dryRun !== "boolean") {
    errors.push("dryRun must be true or false");
  }
  if (config.pollIntervalMinutes != null && (!Number.isFinite(Number(config.pollIntervalMinutes)) || Number(config.pollIntervalMinutes) < 0 || Number(config.pollIntervalMinutes) > 10080)) {
    errors.push("pollIntervalMinutes must be between 0 and 10080 minutes");
  }
  return errors;
}

function accepts(config, name) {
  const lower = String(name).toLocaleLowerCase();
  const extensions = config.includeExtensions || [];
  if (extensions.length && !extensions.some(extension => lower.endsWith(`.${extension.replace(/^\./, "").toLowerCase()}`))) {
    return false;
  }
  return !(config.excludeNameContains || []).some(term => lower.includes(term.toLocaleLowerCase()));
}

module.exports = { properties, validate, accepts };
