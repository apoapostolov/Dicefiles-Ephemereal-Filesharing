"use strict";

const { Readable } = require("stream");
const { guardedFetch, guardedStream } = require("../../net-guard");
const { readBoundedJson } = require("../../bounded-json");
const { responseError } = require("./provider-error");

const HOSTS = new Set(["pixeldrain.com", "www.pixeldrain.com"]);
const API_ORIGIN = "https://pixeldrain.com/api";

function parseSource(value) {
  const url = value instanceof URL ? value : new URL(String(value));
  if (!HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }
  const match = url.pathname.match(/^\/(u|l)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) {
    return null;
  }
  return {
    kind: match[1] === "u" ? "file" : "list",
    id: match[2],
  };
}

function authHeaders(apiKey) {
  if (!apiKey) {
    return {};
  }
  return {
    authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`,
  };
}

function createPixeldrainDownloader(opts) {
  const fetchImpl = (opts && opts.fetchImpl) || ((url, init) => guardedFetch(url, init, {
    httpsOnly: true, allowedUrl: candidate => HOSTS.has(candidate.hostname),
    maxBytes: 4 * 1024 * 1024, timeoutMs: 30000, signal: init.signal,
  }));
  if (typeof fetchImpl !== "function") {
    throw new Error("Pixeldrain downloader requires fetch");
  }

  async function requestJson(path, apiKey) {
    const response = await fetchImpl(`${API_ORIGIN}${path}`, {
      headers: Object.assign(
        { accept: "application/json" },
        authHeaders(apiKey),
      ),
      redirect: "follow",
    });
    const body = await readBoundedJson(response).catch(() => null);
    if (!response.ok || !body || body.success === false) {
      if (!response.ok) {
        throw responseError(response);
      }
      throw new Error(
        `Pixeldrain returned HTTP ${response.status}${
          body && body.value ? ` (${body.value})` : ""}`,
      );
    }
    return body;
  }

  function makeEntry(file, apiKey) {
    const id = String(file.id || "").trim();
    return {
      name: String(file.name || id || "pixeldrain-file"),
      size: Number(file.size) || undefined,
      sourceId:
        `pixeldrain:file:${id}:${
          String(file.hash_sha256 || "").toLowerCase()}`,
      isDir: false,
      async openStream(signal) {
        const download = opts && opts.fetchImpl || ((url, init) => guardedStream(url, init, {
          httpsOnly: true, allowedUrl: candidate => HOSTS.has(candidate.hostname),
          maxBytes: Number(file.size) || 256 * 1024 * 1024, timeoutMs: 60000, signal,
        }));
        const response = await download(
          `${API_ORIGIN}/file/${encodeURIComponent(id)}`,
          {
            headers: authHeaders(apiKey),
            signal,
            redirect: "follow",
          },
        );
        if (!response.ok || !response.body) {
          if (response.body && response.body.destroy) {
            response.body.destroy();
          }
          throw new Error(
            `Pixeldrain download returned HTTP ${response.status}`,
          );
        }
        return typeof response.body.pipe === "function" ?
          response.body :
          Readable.fromWeb(response.body);
      },
    };
  }

  return {
    id: "pixeldrain",
    contractVersion: 1,
    capabilities: ["single-file", "folder", "account-token", "declared-size", "content-hash"],
    name: "Pixeldrain",
    canHandle(value) {
      return !!parseSource(value);
    },
    async listFolder(sourceUrl, credentials) {
      const source = parseSource(sourceUrl);
      if (!source) {
        throw new Error("Unsupported Pixeldrain link");
      }
      const apiKey = credentials && credentials.apiKey;
      if (source.kind === "file") {
        const info = await requestJson(
          `/file/${encodeURIComponent(source.id)}/info`,
          apiKey,
        );
        return [makeEntry(info, apiKey)];
      }
      const list = await requestJson(
        `/list/${encodeURIComponent(source.id)}`,
        apiKey,
      );
      return (list.files || []).map(file => makeEntry(file, apiKey));
    },
  };
}

module.exports = {
  API_ORIGIN,
  HOSTS,
  parseSource,
  createPixeldrainDownloader,
};
