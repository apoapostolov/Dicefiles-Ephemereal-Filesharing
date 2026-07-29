"use strict";

class RemoteDownloaderRegistry {
  constructor(providers) {
    this.providers = new Map();
    for (const provider of providers || []) {
      this.register(provider);
    }
  }

  register(provider) {
    if (
      !provider ||
      !provider.id ||
      typeof provider.canHandle !== "function" ||
      typeof provider.listFolder !== "function"
    ) {
      throw new Error("Remote downloader has an invalid contract");
    }
    const id = String(provider.id).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
      throw new Error(`Invalid remote downloader id: ${id}`);
    }
    this.providers.set(id, Object.assign({}, provider, { id }));
    return this;
  }

  listProviders() {
    return Array.from(this.providers.values()).map((provider) => ({
      id: provider.id,
      name: provider.name || provider.id,
    }));
  }

  resolve(sourceUrl, allowedProviders) {
    let parsed;
    try {
      parsed = new URL(String(sourceUrl || ""));
    } catch (_) {
      throw new Error("Remote import source must be a valid URL");
    }
    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error("Remote import sources must use HTTP or HTTPS");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Credentials are not allowed inside remote import URLs");
    }
    const allow = new Set(
      (allowedProviders || []).map((id) => String(id).toLowerCase()),
    );
    for (const provider of this.providers.values()) {
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
