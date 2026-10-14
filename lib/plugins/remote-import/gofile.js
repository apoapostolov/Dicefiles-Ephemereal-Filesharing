"use strict";

const { createHash } = require("crypto");
const { Readable } = require("stream");
const { guardedFetch, guardedStream } = require("../../net-guard");
const { readBoundedJson } = require("../../bounded-json");
const { RemoteProviderError, responseError } = require("./provider-error");

function parseSource(value) {
  const url = value instanceof URL ? value : new URL(value);
  const match = url.pathname.match(/^\/d\/([a-zA-Z0-9_-]{1,128})\/?$/);
  if (url.protocol !== "https:" || !["gofile.io", "www.gofile.io"].includes(url.hostname) || !match) {
    return null;
  }
  return { providerId: "gofile", sourceKind: "folder", sourceId: match[1], canonicalUrl: `https://gofile.io/d/${match[1]}` };
}

function createGofileDownloader({ fetchImpl, streamImpl } = {}) {
  const request = fetchImpl || ((url, init) => guardedFetch(url, init, { httpsOnly: true, allowedUrl: candidate => candidate.hostname === "api.gofile.io", maxBytes: 4 * 1024 * 1024, timeoutMs: 30000, signal: init.signal }));
  const download = streamImpl || guardedStream;
  const provider = {
    id: "gofile", name: "Gofile", contractVersion: 1, apiRevision: "contents-v1",
    capabilities: ["single-file", "folder", "recursive", "password", "account-token", "declared-size", "pagination"],
    parseSource, canHandle: value => !!parseSource(value),
    async validateCredentials(credentials = {}) {
      return { available: true, authenticated: !!credentials.apiToken };
    },
    async list(source, { credentials = {}, cursor, pageSize = 100, signal } = {}) {
      const page = cursor ? Number(cursor) : 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) {
        throw new RemoteProviderError("INVALID_SOURCE");
      }
      const url = new URL(`https://api.gofile.io/contents/${encodeURIComponent(source.sourceId)}`);
      url.searchParams.set("page", page);
      url.searchParams.set("pageSize", Math.max(1, Math.min(100, pageSize)));
      url.searchParams.set("sortField", "createTime");
      url.searchParams.set("sortDirection", "1");
      if (credentials.password) {
        url.searchParams.set("password", createHash("sha256").update(credentials.password).digest("hex"));
      }
      const response = await request(url.href, { signal, headers: { accept: "application/json", ...(credentials.apiToken ? { authorization: `Bearer ${credentials.apiToken}` } : {}) } });
      if (!response.ok) {
        throw responseError(response);
      }
      let body;
      try {
        body = await readBoundedJson(response);
      }
      catch (_) {
        throw new RemoteProviderError("RESPONSE_INVALID");
      }
      if (body.status === "error-notPremium") {
        throw new RemoteProviderError("PREMIUM_REQUIRED");
      }
      if (body.status !== "ok") {
        throw new RemoteProviderError(/password/i.test(body.status || "") ? "PASSWORD_REQUIRED" : /token|account/i.test(body.status || "") ? "AUTH_REQUIRED" : "RESPONSE_INVALID");
      }
      const {data} = body;
      if (!data || !["folder", "file"].includes(data.type) || data.type === "folder" && (!data.children || typeof data.children !== "object" || Array.isArray(data.children))) {
        throw new RemoteProviderError("RESPONSE_INVALID");
      }
      const children = data.type === "file" ? [data] : Object.values(data.children);
      if (children.length > 100) {
        throw new RemoteProviderError("RESPONSE_INVALID");
      }
      const entries = children.map(file => {
        if (!file || !/^[a-zA-Z0-9_-]{1,128}$/.test(file.id || "") || typeof file.name !== "string" || file.name.length > 256) {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        if (file.type === "folder") {
          return { name: file.name, kind: "folder", isDir: true, sourceId: file.id, source: { ...source, sourceId: file.id, canonicalUrl: `https://gofile.io/d/${file.id}` } };
        }
        if (file.type !== "file" || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.link !== "string") {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        let link;
        try {
          link = new URL(file.link);
        }
        catch (_) {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        const allowedUrl = candidate => candidate.protocol === "https:" && /^[a-z0-9-]+\.gofile\.io$/.test(candidate.hostname) && !candidate.username && !candidate.password;
        if (!allowedUrl(link)) {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        return {
          name: file.name, size: file.size, kind: "file", isDir: false,
          sourceId: `gofile:file:${file.id}:${file.md5 || `${file.size}:${file.createTime || ""}`}`,
          async openStream(downloadSignal) {
            const response = await download(link.href, {}, { signal: downloadSignal, httpsOnly: true, allowedUrl, maxBytes: file.size + 1, timeoutMs: 60000 });
            if (!response.ok) {
              response.body.destroy(); throw responseError(response);
            }
            let received = 0;
            const {body} = response;
            return Readable.from((async function *() {
              for await (const chunk of body) {
                received += chunk.length; yield chunk;
              }
              if (received !== file.size) {
                throw new RemoteProviderError("DOWNLOAD_TRUNCATED");
              }
            })());
          },
        };
      });
      const total = Number(data.childrenCount);
      const hasMore = body.metadata && body.metadata.hasNextPage === true || Number.isFinite(total) && page * pageSize < total;
      return { entries, ...(hasMore ? { nextCursor: String(page + 1) } : {}) };
    },
    async listFolder(sourceUrl, credentials) {
      const source = parseSource(sourceUrl);
      if (!source) {
        throw new RemoteProviderError("INVALID_SOURCE");
      }
      return (await provider.list(source, { credentials })).entries;
    },
  };
  return provider;
}

module.exports = { parseSource, createGofileDownloader };
