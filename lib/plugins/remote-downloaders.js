"use strict";

const { setTimeout: delay } = require("timers/promises");
const { RemoteProviderError } = require("./remote-import/provider-error");

class RemoteDownloaderRegistry {
  constructor(providers) {
    this.providers = new Map();
    this.circuits = new Map();
    for (const provider of providers || []) {
      this.register(provider);
    }
  }

  register(provider) {
    if (
      !provider ||
      !provider.id ||
      typeof provider.canHandle !== "function" ||
      (typeof provider.listFolder !== "function" && typeof provider.list !== "function")
    ) {
      throw new Error("Remote downloader has an invalid contract");
    }
    const id = String(provider.id).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
      throw new Error(`Invalid remote downloader id: ${id}`);
    }
    if (provider.contractVersion && provider.contractVersion !== 1) {
      throw new Error("Unsupported remote provider contract version");
    }
    this.providers.set(id, Object.assign({}, provider, { id, contractVersion: 1 }));
    return this;
  }

  listProviders() {
    return Array.from(this.providers.values()).map(provider => ({
      id: provider.id,
      name: provider.name || provider.id,
      contractVersion: provider.contractVersion,
      capabilities: provider.capabilities || ["folder"],
      apiRevision: provider.apiRevision || "legacy-adapter",
      enabled: provider.enabled !== false,
      allowedModules: provider.allowedModules || [],
      circuitOpenUntil: this.circuits.get(provider.id)?.openUntil || 0,
    }));
  }

  async nextTurn(scope, count) {
    const digest = require("crypto").createHash("sha256").update(scope).digest("hex");

    return Number(await require("../broker").getMethod("fairturn")(`remote-import:turn:${digest}`)) % count;
  }

  async callProvider(provider, operation, signal) {
    const state = this.circuits.get(provider.id) || { failures: 0, openUntil: 0 };
    this.circuits.set(provider.id, state);
    if (state.openUntil > Date.now()) {
      throw new RemoteProviderError("TEMPORARILY_UNAVAILABLE");
    }
    for (let attempt = 0; ; attempt++) {
      if (signal) {
        signal.throwIfAborted();
      }
      try {
        const result = await operation();
        state.failures = 0; state.openUntil = 0;
        return result;
      }
      catch (error) {
        if (!error.retryable || attempt >= 2) {
          if (error.retryable && ++state.failures >= 5) {
            state.openUntil = Date.now() + 60000;
          }
          throw error;
        }
        await delay(Math.min(300000, Math.max(error.retryAfterMs || 0, 500 * 2 ** attempt * (0.75 + Math.random() * 0.5))), undefined, { signal });
      }
    }
  }

  /** Breadth-first traversal with page, depth, folder and metadata limits. */
  async *entries(sourceUrl, credentials, allowedProviders, { signal, pageSize = 100 } = {}) {
    const provider = this.resolve(sourceUrl, allowedProviders);
    if (!provider.list || !provider.parseSource) {
      const entries = await this.callProvider(provider, () => provider.listFolder(String(sourceUrl), credentials || {}, { signal }), signal);
      if (!Array.isArray(entries) || entries.length > 10000) {
        throw new RemoteProviderError("RESPONSE_INVALID");
      }
      try {
        for (const entry of entries) {
          yield { provider, entry };
        }
      }
      finally {
        if (typeof entries.close === "function") {
          await Promise.resolve(entries.close()).catch(() => {});
        }
      }
      return;
    }
    const initial = provider.parseSource(new URL(sourceUrl));
    if (!initial) {
      throw new RemoteProviderError("INVALID_SOURCE");
    }
    const folders = [{ source: initial, depth: 0 }];
    const seen = new Set();
    let count = 0;
    for (let folderIndex = 0; folderIndex < folders.length; folderIndex++) {
      const { source, depth } = folders[folderIndex];
      if (seen.has(source.sourceId)) {
        continue;
      }
      seen.add(source.sourceId);
      let cursor;
      const cursors = new Set();
      do {
        const page = await this.callProvider(provider, () => provider.list(source, { credentials, cursor, pageSize, signal }), signal);
        if (!page || !Array.isArray(page.entries) || page.entries.length > pageSize) {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        for (const entry of page.entries) {
          if (++count > 10000 || !entry || typeof entry.name !== "string" || entry.name.length > 256 || !entry.sourceId) {
            throw new RemoteProviderError("RESPONSE_INVALID");
          }
          if (entry.kind === "folder") {
            if (depth < 8 && folders.length < 1000 && entry.source) {
              folders.push({ source: entry.source, depth: depth + 1 });
            }
          }
          else {
            if (typeof entry.openStream !== "function" || entry.size != null && (!Number.isSafeInteger(entry.size) || entry.size < 0)) {
              throw new RemoteProviderError("RESPONSE_INVALID");
            }
            yield { provider, entry };
          }
        }
        cursor = page.nextCursor;
        if (cursor && (typeof cursor !== "string" || cursor.length > 2048 || cursors.has(cursor))) {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        if (cursor) {
          cursors.add(cursor);
        }
      } while (cursor);
    }
  }

  resolve(sourceUrl, allowedProviders) {
    let parsed;
    try {
      parsed = new URL(String(sourceUrl || ""));
    }
    catch (_) {
      throw new Error("Remote import source must be a valid URL");
    }
    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Remote import sources must use HTTP or HTTPS");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Credentials are not allowed inside remote import URLs");
    }
    const allow = new Set(
      (allowedProviders || []).map(id => String(id).toLowerCase()),
    );
    for (const provider of this.providers.values()) {
      if (provider.enabled === false) {
        continue;
      }
      if (allow.size && !allow.has(provider.id)) {
        continue;
      }
      if (provider.canHandle(parsed)) {
        return provider;
      }
    }
    throw new Error(`No enabled downloader handles ${parsed.hostname}`);
  }

  async listFolder(sourceUrl, credentials, allowedProviders) {
    const provider = this.resolve(sourceUrl, allowedProviders);
    const entries = await provider.listFolder(
      String(sourceUrl),
      credentials || {},
    );
    if (!Array.isArray(entries)) {
      throw new Error(`${provider.id} downloader returned an invalid file list`);
    }
    return { provider, entries };
  }
}

module.exports = {
  RemoteDownloaderRegistry,
};
