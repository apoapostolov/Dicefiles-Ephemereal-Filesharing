"use strict";

const { createHash } = require("node:crypto");

const MAX_TORRENT_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 2000;
const text = value => Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function parseMagnet(raw) {
  if (typeof raw !== "string" || raw.length > 16384) {
    throw new Error("Magnet link is too long (maximum 16 KiB).");
  }
  const url = new URL(raw);
  if (url.protocol !== "magnet:") {
    throw new Error("Use a magnet link beginning with magnet:?.");
  }
  const parameters = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.keys(parameters).length > 100 || (parameters[key]?.length || 0) >= 100) {
      throw new Error("Magnet link has too many parameters.");
    }
    (parameters[key] ||= []).push(value.slice(0, 2048));
  }
  let infoHashV1 = null; let infoHashV2 = null;
  for (const topic of parameters.xt || []) {
    if (/^urn:btih:[a-f0-9]{40}$/i.test(topic)) {
      infoHashV1 = topic.slice(9).toLowerCase();
    }
    else if (/^urn:btih:[a-z2-7]{32}$/i.test(topic)) {
      let bits = "";
      for (const char of topic.slice(9).toUpperCase()) {
        bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0");
      }
      infoHashV1 = bits.match(/.{8}/g).map(byte => parseInt(byte, 2).toString(16).padStart(2, "0")).join("");
    }
    if (/^urn:btmh:1220[a-f0-9]{64}$/i.test(topic)) {
      infoHashV2 = topic.slice(13).toLowerCase();
    }
  }
  if (!infoHashV1 && !infoHashV2) {
    throw new Error("Magnet link needs a valid BitTorrent v1 or v2 info hash. Copy the complete link from its source.");
  }
  const size = Number(parameters.xl?.[0]);
  return { kind: "magnet", name: parameters.dn?.[0] || infoHashV1 || infoHashV2, infoHashV1, infoHashV2,
    totalSize: parameters.xl ? number(size) : null, trackers: parameters.tr || [], webSeeds: parameters.ws || [],
    exactSources: parameters.xs || [], acceptableSources: parameters.as || [], keywords: parameters.kt || [],
    selectedFiles: parameters.so || [], parameters, magnet: url.href, metadataStatus: "link-only", files: [] };
}

function parseTorrent(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_TORRENT_BYTES) {
    throw new Error("Torrent metadata must be between 1 byte and 2 MiB.");
  }
  let offset = 0; let nodes = 0; let infoStart = -1; let infoEnd = -1;

  function decode(depth = 0) {
    if (++nodes > 100000 || depth > 40 || offset >= buffer.length) {
      throw new Error("Torrent metadata is too complex or incomplete.");
    }
    const marker = buffer[offset];
    if (marker === 105) {
      const end = buffer.indexOf(101, ++offset);
      if (end < 0) {
        throw new Error("Torrent integer is incomplete.");
      }
      const raw = buffer.subarray(offset, end).toString("ascii");
      if (!/^(0|-?[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        throw new Error("Torrent integer is invalid or too large.");
      }
      offset = end + 1;
      return Number(raw);
    }
    if (marker === 108 || marker === 100) {
      offset++;
      const value = marker === 108 ? [] : Object.create(null);
      let previous;
      while (offset < buffer.length && buffer[offset] !== 101) {
        if (marker === 108) {
          value.push(decode(depth + 1)); continue;
        }
        const key = decode(depth + 1);
        if (!Buffer.isBuffer(key) || previous && Buffer.compare(previous, key) >= 0) {
          throw new Error("Torrent dictionary keys must be unique and sorted.");
        }
        previous = key;
        const name = key.toString("utf8");
        const start = offset;
        value[name] = decode(depth + 1);
        if (depth === 0 && name === "info") {
          infoStart = start; infoEnd = offset;
        }
      }
      if (buffer[offset++] !== 101) {
        throw new Error("Torrent container is incomplete.");
      }
      return value;
    }
    const colon = buffer.indexOf(58, offset);
    if (colon < 0 || colon - offset > 8) {
      throw new Error("Torrent string length is invalid.");
    }
    const raw = buffer.subarray(offset, colon).toString("ascii");
    if (!/^(0|[1-9]\d*)$/.test(raw)) {
      throw new Error("Torrent string length is invalid.");
    }
    const length = Number(raw);
    offset = colon + 1;
    if (offset + length > buffer.length) {
      throw new Error("Torrent string is incomplete.");
    }
    const value = buffer.subarray(offset, offset + length);
    offset += length;
    return value;
  }

  const root = decode();
  if (offset !== buffer.length || infoStart < 0 || !root.info || Buffer.isBuffer(root.info) || Array.isArray(root.info)) {
    throw new Error("Torrent is missing a valid info dictionary.");
  }
  const {info} = root;
  const version = info["meta version"] === 2 ? 2 : 1;
  const name = text(info["name.utf-8"] || info.name);
  if (!name || name.length > 1024) {
    throw new Error("Torrent name is missing or too long.");
  }

  function component(value) {
    const result = text(value);
    if (!result || result === "." || result === ".." || /[/\\\p{Cc}]/u.test(result) || result.length > 1024) {
      throw new Error("Torrent contains an unsafe file path.");
    }
    return result;
  }

  component(name);
  const files = [];

  function addFile(parts, value) {
    if (files.length >= MAX_FILES || number(value.length) === null) {
      throw new Error("Torrent has invalid file sizes or more than 2,000 files.");
    }
    const file = { path: parts.map(component).join("/"), size: value.length };
    if (version === 2 && value.length > 0 && (!Buffer.isBuffer(value["pieces root"]) || value["pieces root"].length !== 32)) {
      throw new Error("Torrent v2 file root must contain 32 bytes.");
    }
    if (value["pieces root"]) {
      file.piecesRoot = value["pieces root"].toString("hex");
    }
    if (value.attr) {
      file.attributes = text(value.attr);
    }
    if (value.md5sum) {
      file.md5 = text(value.md5sum);
    }
    if (!file.path || file.path.length > 4096) {
      throw new Error("Torrent file path is too long.");
    }
    files.push(file);
  }

  if (version === 2) {
    function walk(tree, parts = [], depth = 0) {
      if (!tree || Buffer.isBuffer(tree) || depth > 32) {
        throw new Error("Torrent v2 file tree is invalid.");
      }
      for (const [key, value] of Object.entries(tree)) {
        if (key === "") {
          addFile(parts, value);
        }
        else {
          walk(value, [...parts, component(key)], depth + 1);
        }
      }
    }

    walk(info["file tree"]);
  }
  else if (Array.isArray(info.files)) {
    if (info.length !== undefined) {
      throw new Error("Torrent cannot contain both length and files.");
    }
    for (const file of info.files) {
      const parts = file["path.utf-8"] || file.path;
      if (!Array.isArray(parts) || !parts.length) {
        throw new Error("Torrent file path is missing.");
      }
      addFile(parts, file);
    }
  }
  else {
    addFile([name], info);
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(totalSize) || !files.length || number(info["piece length"]) === null || !info["piece length"]) {
    throw new Error("Torrent file totals or piece length are invalid.");
  }
  const {pieces} = info;
  if (version === 2 && (info["piece length"] < 16384 || !Number.isInteger(Math.log2(info["piece length"])))) {
    throw new Error("Torrent v2 piece length must be a power of two of at least 16 KiB.");
  }
  if (version === 1 && (!Buffer.isBuffer(pieces) || pieces.length % 20 !== 0 || pieces.length / 20 !== Math.ceil(totalSize / info["piece length"]))) {
    throw new Error("Torrent piece hashes do not match the content size.");
  }
  const rawInfo = buffer.subarray(infoStart, infoEnd);
  const infoHashV1 = version === 1 || pieces ? createHash("sha1").update(rawInfo).digest("hex") : null;
  const infoHashV2 = version === 2 ? createHash("sha256").update(rawInfo).digest("hex") : null;
  const tiers = Array.isArray(root["announce-list"]) ? root["announce-list"].map(tier => (Array.isArray(tier) ? tier : [tier]).map(text)) : [];
  const trackers = [...new Set([root.announce && text(root.announce), ...tiers.flat()].filter(Boolean))];
  const list = value => (Array.isArray(value) ? value : value ? [value] : []).map(text);
  const result = { kind: "torrent", version, name, infoHashV1, infoHashV2, totalSize, fileCount: files.length,
    files, trackers, trackerTiers: tiers, webSeeds: list(root["url-list"]), httpSeeds: list(root.httpseeds),
    comment: text(root["comment.utf-8"] || root.comment), createdBy: text(root["created by"]),
    creationDate: number(root["creation date"]), encoding: text(root.encoding), private: info.private === 1,
    source: text(info.source || root.source), publisher: text(root.publisher), publisherUrl: text(root["publisher-url"]),
    pieceLength: info["piece length"], pieceCount: pieces ? pieces.length / 20 : Math.ceil(totalSize / info["piece length"]),
    metadataStatus: "complete", imageSource: text(root.image || root.cover),
  };
  const magnet = new URL("magnet:?");

  // Keep extension metadata while leaving bulk binary hash payloads in the original.
  function display(value) {
    if (Buffer.isBuffer(value)) {
      const utf8 = value.toString("utf8");
      return utf8.includes("\ufffd") || /\p{Cc}/u.test(utf8) ? { encoding: "hex", bytes: value.length, value: value.subarray(0, 512).toString("hex"), truncated: value.length > 512 } : utf8;
    }
    if (Array.isArray(value)) {
      return value.map(display);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, display(item)]));
    }
    return value;
  }

  const knownRoot = new Set(["info", "announce", "announce-list", "url-list", "httpseeds", "comment", "comment.utf-8", "created by", "creation date", "encoding", "source", "publisher", "publisher-url", "image", "cover", "piece layers"]);
  const knownInfo = new Set(["name", "name.utf-8", "length", "files", "file tree", "piece length", "pieces", "private", "meta version", "source"]);
  result.extensions = {
    metainfo: Object.fromEntries(Object.entries(root).filter(([key]) => !knownRoot.has(key)).map(([key, value]) => [key, display(value)])),
    info: Object.fromEntries(Object.entries(info).filter(([key]) => !knownInfo.has(key)).map(([key, value]) => [key, display(value)])),
  };
  if (root["piece layers"] && typeof root["piece layers"] === "object") {
    result.pieceLayerCount = Object.keys(root["piece layers"]).length;
  }
  if (infoHashV1) {
    magnet.searchParams.append("xt", `urn:btih:${infoHashV1}`);
  }
  if (infoHashV2) {
    magnet.searchParams.append("xt", `urn:btmh:1220${infoHashV2}`);
  }
  magnet.searchParams.set("dn", name);
  for (const tracker of trackers) {
    magnet.searchParams.append("tr", tracker);
  }
  result.magnet = magnet.href;
  if (Buffer.byteLength(JSON.stringify(result)) > 512 * 1024) {
    throw new Error("Torrent display metadata exceeds the 512 KiB limit.");
  }
  return result;
}

module.exports = { MAX_TORRENT_BYTES, parseMagnet, parseTorrent };
