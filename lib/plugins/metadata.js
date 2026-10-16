"use strict";

const crypto = require("crypto");

function sourceFingerprint(source) {
  return crypto.createHash("sha256").update(String(source || "")).digest("hex");
}

function publicMetadata(meta) {
  if (!meta || typeof meta !== "object") {
    return meta;
  }
  const clean = Object.assign({}, meta);
  // Older imports stored a Mega folder URL including its decryption key.
  if (clean.megaFolder) {
    clean.megaFolderHash = sourceFingerprint(clean.megaFolder);
    delete clean.megaFolder;
  }
  return clean;
}

function safeErrorMessage(error, config) {
  let message = String(error?.message || error || "The bot could not finish. Check its settings and try again.");
  const visit = (value, key, depth) => {
    if (depth > 4 || value == null) {
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([name, item]) => visit(item, name, depth + 1)); return;
    }
    if (/(password|secret|token|key|url)/i.test(key) && String(value).length >= 4) {
      message = message.split(String(value)).join("[redacted]");
      try {
        const fragment = new URL(String(value)).hash.slice(1);
        if (fragment.length >= 4) {
          message = message.split(fragment).join("[redacted]");
        }
      }
      catch (_) { /* Not a URL. */ }
    }
  };
  visit(config, "", 0);
  return message.replace(/https?:\/\/[^\s<>"']+/gi, "[remote address]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}

module.exports = { sourceFingerprint, publicMetadata, safeErrorMessage };
