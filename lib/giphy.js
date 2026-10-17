"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { guardedFetch } = require("./net-guard");

function giphyConfig(config) {
  let legacy = {};
  try {
    legacy = JSON.parse(fs.readFileSync(path.resolve(".gif-providers.local.json"), "utf8")).giphy || {};
  }
  catch (_) { /* optional legacy configuration */ }
  return { key: config.get("giphyApiKey") || legacy.apiKey || "", rating: legacy.rating || "pg-13", limit: 20 };
}

async function searchGiphy(config, query, offset = 0, fetcher = guardedFetch) {
  const { key, rating, limit } = giphyConfig(config);
  if (!key) {
    throw Object.assign(new Error("GIF search is not configured. Ask the site operator to set HOBBYFILES_GIPHY_API_KEY and restart Hobbyfiles."), { status: 503 });
  }
  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.search = new URLSearchParams({ api_key: key, q: String(query).slice(0, 100), limit, offset: Math.max(0, Math.min(4999, Number(offset) || 0)), rating });
  const response = await fetcher(url.href, {}, { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, httpsOnly: true, maxRedirects: 0 });
  if (!response.ok) {
    throw Object.assign(new Error("GIF search is temporarily unavailable. Try again later or ask the site operator to check the Giphy key and quota."), { status: response.status === 429 ? 429 : 502 });
  }
  const body = await response.json();
  const safeImage = raw => {
    try {
      const u = new URL(raw);
      return u.protocol === "https:" && /(^|\.)giphy\.com$/.test(u.hostname) ? u.href : null;
    }
    catch (_) {
      return null;
    }
  };
  const results = (Array.isArray(body.data) ? body.data : []).slice(0, limit).map(item => ({
    preview: safeImage(item.images?.fixed_width?.url), url: safeImage(item.images?.original?.url),
  })).filter(item => item.preview && item.url);
  return { results, next: results.length ? Number(offset) + results.length : null };
}

module.exports = { searchGiphy };
