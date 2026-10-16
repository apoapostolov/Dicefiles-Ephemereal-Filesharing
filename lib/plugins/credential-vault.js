"use strict";

const { createHash, randomBytes, createCipheriv, createDecipheriv } = require("node:crypto");

const memory = new Map();

/** Rotated OAuth credentials are encrypted with the operator's original secret.
 * Changing that secret invalidates the old cache. No room API exposes it. */
function credentialVault(id, credentials, storage) {
  const key = createHash("sha256").update(JSON.stringify(Object.entries(credentials).sort())).digest();
  const address = `plugin:credential:${createHash("sha256").update(id).update(key).digest("hex")}`;
  const backend = () => storage || (process.env.NODE_ENV === "test" ? {
    get: async name => memory.get(name), set: async (name, value) => memory.set(name, value),
  } : require("../broker").getMethods("get", "set"));
  return {
    async read() {
      const value = await backend().get(address); if (!value) {
        return null;
      }
      try {
        const raw = Buffer.from(value, "base64"); const cipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        cipher.setAuthTag(raw.subarray(12, 28));
        return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString("utf8"));
      }
      catch (_) {
        throw Object.assign(new Error("The saved provider credential could not be read. Reconnect the operator connection."), { retryable: false });
      }
    },
    async write(value) {
      const input = JSON.stringify(value);
      if (Buffer.byteLength(input) > 8192) {
        throw new Error("Provider credentials exceed the supported limit. Reconnect the account.");
      }
      const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
      await backend().set(address, Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"), "EX", 30 * 86400);
    },
  };
}

module.exports = { credentialVault };
