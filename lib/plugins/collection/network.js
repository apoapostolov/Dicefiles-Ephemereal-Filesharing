"use strict";

const { guardedFetch, guardedStream } = require("../../net-guard");

function retryableResponse(response) {
  if (response.ok || response.status === 304) {
    return;
  }
  const hints = { 401: "Reconnect the provider account.", 403: "Check the account's read access and approved folder.", 404: "Check that the selected source still exists.", 429: "The provider is limiting requests. The job will retry later." };
  const value = response.headers.get ? response.headers.get("retry-after") : response.headers["retry-after"];
  throw Object.assign(new Error(`Source returned HTTP ${response.status}. ${hints[response.status] || "Check the provider status and try again."}`), {
    status: response.status, retryable: response.status === 429 || response.status >= 500,
    retryAfterMs: Math.max(0, /^\d+$/.test(value || "") ? Number(value) * 1000 : Date.parse(value) - Date.now() || 0),
  });
}

function createCollectionNetwork(ctx) {
  return {
    async response(url, init = {}, limits = {}) {
      const response = await (ctx.collectionFetch || guardedFetch)(url, { ...init, signal: ctx.signal }, { maxBytes: 4 * 1024 * 1024, timeoutMs: 20000, maxRedirects: 3, ...limits, signal: ctx.signal });
      retryableResponse(response); return response;
    },
    async json(url, init, limits) {
      return (await this.response(url, init, limits)).json();
    },
    async stream(url, init = {}, limits = {}) {
      const response = await (ctx.collectionStream || guardedStream)(url, { ...init, signal: ctx.signal }, { timeoutMs: 120000, maxRedirects: 3, ...limits, signal: ctx.signal });
      try {
        retryableResponse(response);
      }
      catch (error) {
        response.body?.destroy(); throw error;
      }
      return response.body;
    },
  };
}

function approvedUrl(value, origins, base) {
  const url = new URL(value, base);
  if (!Array.isArray(origins) || !origins.includes(url.origin) || url.username || url.password || !["https:", "http:"].includes(url.protocol)) {
    throw Object.assign(new Error("The source points outside the approved origins. Add its exact origin to Allowed origins after reviewing it."), { retryable: false });
  }
  return url.href;
}

module.exports = { createCollectionNetwork, approvedUrl, retryableResponse };
