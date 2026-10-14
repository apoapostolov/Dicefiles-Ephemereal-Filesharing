"use strict";

const { guardedFetch } = require("./net-guard");
const { parseMagnet, parseTorrent, MAX_TORRENT_BYTES } = require("./torrent");

function httpUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  }
  catch (_) {
    return null;
  }
}

function htmlMeta(html, base) {
  const fields = Object.create(null);
  const decode = value => value.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  for (const tag of html.match(/<meta\b[^>]{0,4096}>/gi) || []) {
    const attrs = Object.create(null);
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
    }
    const key = attrs.property || attrs.name;
    if (key && attrs.content) {
      fields[key.toLowerCase()] = attrs.content.slice(0, 2048);
    }
  }
  const title = fields["og:title"] || decode((html.match(/<title[^>]*>([^<]{0,2048})<\/title>/i) || [])[1] || "");
  return { title: title.trim(), description: fields["og:description"] || fields.description || "", siteName: fields["og:site_name"] || "", imageUrl: httpUrl(fields["og:image"] || fields["twitter:image"], base) };
}

async function fetchTorrent(url, options = {}) {
  const target = httpUrl(url);
  if (!target) {
    throw new Error("Enter a public HTTP or HTTPS torrent URL.");
  }
  const response = await (options.fetcher || guardedFetch)(target, {}, { maxBytes: MAX_TORRENT_BYTES, timeoutMs: 8000, signal: options.signal });
  if (!response.ok) {
    throw new Error("The torrent source could not be read. Check the URL or upload the .torrent file instead.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, torrent: parseTorrent(buffer) };
}

async function discoverImage(metadata, fetcher, signal) {
  const candidates = [metadata.imageSource, metadata.publisherUrl, metadata.source,
    ...(String(metadata.comment || "").match(/https?:\/\/[^\s<>"']+/g) || []), ...(metadata.exactSources || [])];
  for (const raw of candidates.filter(Boolean).slice(0, 2)) {
    const url = httpUrl(raw);
    if (!url) {
      continue;
    }
    try {
      let response = await fetcher(url, {}, { timeoutMs: 5000, maxBytes: 2 * 1024 * 1024, signal });
      if (!response.ok) {
        continue;
      }
      let bytes = Buffer.from(await response.arrayBuffer());
      if (/html/i.test(response.headers.get("content-type") || "")) {
        const {imageUrl} = htmlMeta(bytes.toString("utf8").slice(0, 256 * 1024), url);
        if (!imageUrl) {
          continue;
        }
        response = await fetcher(imageUrl, {}, { timeoutMs: 5000, maxBytes: 2 * 1024 * 1024, signal });
        if (!response.ok) {
          continue;
        }
        bytes = Buffer.from(await response.arrayBuffer());
      }
      const image = await require("sharp")(bytes, { limitInputPixels: 16000000 }).timeout({ seconds: 3 }).resize(400, 400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      if (image.length <= 128 * 1024) {
        metadata.imageDataUrl = `data:image/jpeg;base64,${image.toString("base64")}`; return;
      }
    }
    catch (_) { /* Optional discovery must not prevent storing valid metadata. */ }
  }
}

async function enrichTorrent(torrent, options = {}) {
  const fetcher = options.fetcher || guardedFetch;
  const signal = options.signal || AbortSignal.timeout(12000);
  if (torrent.kind === "magnet") {
    for (const source of torrent.exactSources.slice(0, 2)) {
      try {
        const { torrent: resolved } = await fetchTorrent(source, { fetcher, signal });
        if (torrent.infoHashV1 && resolved.infoHashV1 !== torrent.infoHashV1 || torrent.infoHashV2 && resolved.infoHashV2 !== torrent.infoHashV2) {
          continue;
        }
        torrent = { ...resolved, ...torrent, files: resolved.files, fileCount: resolved.fileCount, totalSize: resolved.totalSize,
          pieceLength: resolved.pieceLength, pieceCount: resolved.pieceCount, private: resolved.private,
          comment: resolved.comment, publisherUrl: resolved.publisherUrl, source: resolved.source,
          imageSource: resolved.imageSource, metadataStatus: "verified-source" };
        break;
      }
      catch (_) { /* A magnet remains useful without HTTP metadata. */ }
    }
  }
  await discoverImage(torrent, fetcher, signal);
  return torrent;
}

async function linkMetadata(url, options = {}) {
  if (url.startsWith("magnet:")) {
    const torrent = await enrichTorrent(parseMagnet(url), options);
    return { name: torrent.name, meta: { torrent } };
  }
  const target = httpUrl(url);
  if (!target) {
    return {};
  }
  const response = await (options.fetcher || guardedFetch)(target, {}, { maxBytes: MAX_TORRENT_BYTES, timeoutMs: 8000 });
  if (!response.ok) {
    return {};
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (/\.torrent(?:$|\?)/i.test(target) || /bittorrent/i.test(response.headers.get("content-type") || "")) {
    const torrent = await enrichTorrent(parseTorrent(buffer), options);
    return { name: torrent.name, meta: { torrent } };
  }
  const metadata = htmlMeta(buffer.toString("utf8").slice(0, 256 * 1024), target);
  if (options.opengraphKey) {
    try {
      const api = new URL(`https://opengraph.io/api/1.1/site/${encodeURIComponent(target)}`);
      api.searchParams.set("app_id", options.opengraphKey);
      const result = await (options.fetcher || guardedFetch)(api.href, {}, { timeoutMs: 5000, maxBytes: 256 * 1024, maxRedirects: 0 });
      if (result.ok) {
        const body = await result.json();
        const graph = body.hybridGraph || body.openGraph || body.htmlInferred;
        if (typeof graph?.title === "string") {
          metadata.title = graph.title.slice(0, 2048);
        }
      }
    }
    catch (_) { /* The guarded HTML result remains available. */ }
  }
  return { name: metadata.title || url, meta: metadata };
}

module.exports = { httpUrl, htmlMeta, fetchTorrent, enrichTorrent, linkMetadata };
