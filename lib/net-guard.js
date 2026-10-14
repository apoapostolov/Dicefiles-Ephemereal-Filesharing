"use strict";

/**
 * Outbound network guard.
 *
 * One place decides whether Dicefiles may talk to a remote URL, and the same
 * place performs the request. Splitting those two steps is what makes DNS
 * rebinding work: a hostname that resolves to a public address during the
 * check can resolve to 127.0.0.1 a moment later, when the socket is opened. So
 * every request here pins the address that was validated, per hop, and refuses
 * to follow a redirect it has not re-validated.
 */

const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");

/** Statuses that must not carry a body. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** Default ceiling on a response body, in bytes. */
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** Default wall-clock ceiling for one request, in ms. */
const DEFAULT_TIMEOUT_MS = 30000;

/** How many redirects to follow before giving up. */
const DEFAULT_MAX_REDIRECTS = 3;

class NetGuardError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "NetGuardError";
    this.code = code;
  }
}

/**
 * Report whether an address belongs to a network Dicefiles refuses to reach
 * from user-supplied input: loopback, private, link-local, unspecified, or an
 * IPv6 unique-local or link-local range.
 * @param {string} address
 * @returns {boolean}
 */
function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0 ||
      // Carrier-grade NAT, and the 100.64/10 shared address space.
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  const value = String(address).toLowerCase();
  if (net.isIP(value) === 0) {
    // Not an address at all. Treat it as unusable rather than public.
    return true;
  }
  return (
    value === "::1" ||
    value === "::" ||
    // IPv4-mapped and IPv4-compatible forms keep the IPv4 answer honest.
    value.startsWith("::ffff:") && isPrivateIp(value.slice(7)) ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

/**
 * Resolve a hostname and reject any private answer.
 * @param {string} hostname
 * @param {object} [opts]
 * @param {boolean} [opts.allowPrivate] operator-set escape hatch for a peer or
 *   source that is genuinely on a private network
 * @returns {Promise<{address:string, family:number}>}
 */
async function resolvePublicAddress(hostname, opts = {}) {
  let addresses;
  // A URL keeps the brackets around an IPv6 literal, `net.isIP` does not.
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ?
    hostname.slice(1, -1) :
    hostname;
  const literal = net.isIP(bare);
  if (literal) {
    addresses = [{ address: bare, family: literal }];
  }
  else {
    try {
      addresses = await dns.lookup(bare, { all: true, verbatim: true });
    }
    catch (err) {
      throw new NetGuardError(
        `${hostname} could not be resolved: ${err.message}`,
        "DESTINATION_UNAVAILABLE",
      );
    }
  }
  if (!addresses || !addresses.length) {
    throw new NetGuardError(
      `${hostname} resolved to no address`,
      "DESTINATION_UNAVAILABLE",
    );
  }
  if (!opts.allowPrivate && addresses.some(row => isPrivateIp(row.address))) {
    throw new NetGuardError(
      `${hostname} resolves to a private or unavailable address`,
      "DESTINATION_BLOCKED",
    );
  }
  return { address: addresses[0].address, family: addresses[0].family };
}

/**
 * Parse and validate a URL, returning the address to pin.
 * @param {string|URL} rawUrl
 * @param {object} [opts] see {@link resolvePublicAddress}
 * @returns {Promise<{url:URL, address:{address:string, family:number}}>}
 */
async function validateOutboundUrl(rawUrl, opts = {}) {
  let url;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
  }
  catch {
    throw new NetGuardError("Destination is not a valid URL", "DESTINATION_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new NetGuardError(
      "Only http and https destinations are allowed",
      "DESTINATION_BLOCKED",
    );
  }
  if (url.username || url.password) {
    throw new NetGuardError(
      "Credentials in a destination URL are not allowed",
      "DESTINATION_BLOCKED",
    );
  }
  const address = await resolvePublicAddress(url.hostname, opts);
  return { url, address };
}

/**
 * A `lookup` implementation that always answers with the pinned address, so the
 * socket cannot land somewhere the guard did not approve.
 * @param {{address:string, family:number}} pinned
 * @returns {Function}
 */
function pinnedLookup(pinned) {
  return function lookup(hostname, options, callback) {
    const done = typeof options === "function" ? options : callback;
    const opts = typeof options === "function" ? {} : options || {};
    if (opts.all) {
      done(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    done(null, pinned.address, pinned.family);
  };
}

/**
 * Perform one request against an already-validated target, with the validated
 * address pinned into the socket.
 * @param {{url:URL, address:{address:string, family:number}}} target
 * @param {object} [init] method, headers, body
 * @param {object} [opts] maxBytes, timeoutMs
 * @returns {Promise<Buffer>}
 */

function abortError(signal) {
  const timedOut = signal.reason && signal.reason.name === "TimeoutError";
  return new NetGuardError(timedOut ? "Request deadline exceeded" : "Request cancelled", timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED");
}

function abortable(promise, signal) {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw abortError(signal);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function requestStreamOnce(target, init = {}, opts = {}) {
  const { Transform } = require("stream");

  const { url, address } = target;
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const signal = opts.signal || AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (signal.aborted) {
    throw abortError(signal);
  }
  const transport = url.protocol === "https:" ? https : http;
  const headers = Object.assign({}, init.headers);
  if (init.body != null && !Object.keys(headers).some(key => key.toLowerCase() === "content-length")) {
    headers["content-length"] = Buffer.byteLength(init.body);
  }
  return new Promise((resolve, reject) => {
    let body;
    let size = 0;
    const req = transport.request({
      protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search, method: init.method || "GET", headers,
      lookup: pinnedLookup(address), servername: url.hostname, rejectUnauthorized: true,
    }, incoming => {
      if (Number(incoming.headers["content-length"]) > maxBytes) {
        reject(new NetGuardError("Response exceeded the byte limit", "RESPONSE_TOO_LARGE"));
        incoming.destroy(); req.destroy(); return;
      }
      body = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > maxBytes) {
            callback(new NetGuardError("Response exceeded the byte limit", "RESPONSE_TOO_LARGE"));
          }
          else {
            callback(null, chunk);
          }
        },
      });
      body.on("error", () => {});
      const cleanup = () => {
        signal.removeEventListener("abort", cancel); incoming.destroy(); req.destroy();
      };
      body.once("close", cleanup);
      incoming.once("aborted", () => body.destroy(new NetGuardError("Response aborted", "REQUEST_FAILED")));
      incoming.once("error", error => body.destroy(error));
      incoming.pipe(body);
      resolve({ status: incoming.statusCode || 0, headers: incoming.headers, body });
    });
    const cancel = () => {
      const error = abortError(signal);
      if (body) {
        body.destroy(error);
      }
      req.destroy(error);
      reject(error);
    };
    signal.addEventListener("abort", cancel, { once: true });
    req.once("error", error => {
      signal.removeEventListener("abort", cancel);
      if (body) {
        body.destroy(error);
      }
      reject(error instanceof NetGuardError ? error : new NetGuardError(error.message, "REQUEST_FAILED"));
    });
    req.once("close", () => {
      if (!body) {
        signal.removeEventListener("abort", cancel);
      }
    });
    if (init.body != null) {
      req.write(init.body);
    }
    req.end();
  });
}

async function requestOnce(target, init = {}, opts = {}) {
  const result = await requestStreamOnce(target, init, opts);
  const chunks = [];
  for await (const chunk of result.body) {
    chunks.push(chunk);
  }
  return { ...result, body: Buffer.concat(chunks) };
}

/** The same deadline covers DNS, every redirect, and the final streamed body. */
async function guardedStream(rawUrl, init = {}, opts = {}) {
  const deadline = AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let current = String(rawUrl);
  let headers = Object.assign({}, init.headers);
  let { method = "GET", body } = init;
  let origin;
  for (let hop = 0; ; hop++) {
    const target = await abortable(validateOutboundUrl(current, opts), signal);
    if ((opts.httpsOnly && target.url.protocol !== "https:") || (opts.allowedUrl && !opts.allowedUrl(target.url))) {
      throw new NetGuardError("Destination escaped the provider allowlist", "DESTINATION_BLOCKED");
    }
    if (origin && target.url.origin !== origin) {
      headers = {};
      if (method !== "GET" && method !== "HEAD") {
        method = "GET"; body = undefined;
      }
    }
    origin ||= target.url.origin;
    const response = await requestStreamOnce(target, { method, headers, body }, { ...opts, signal });
    const {location} = response.headers;
    if (response.status >= 300 && response.status < 400 && location && hop < maxRedirects) {
      response.body.destroy();
      if (response.status === 303 && method !== "HEAD" || [301, 302].includes(response.status) && method === "POST") {
        method = "GET"; body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !["content-length", "content-type", "transfer-encoding"].includes(key.toLowerCase())));
      }
      current = new URL(location, target.url).toString();
      continue;
    }
    return { ...response, ok: response.status >= 200 && response.status < 300, signal };
  }
}

async function guardedFetch(rawUrl, init = {}, opts = {}) {
  const response = await guardedStream(rawUrl, init, opts);
  const chunks = [];
  for await (const chunk of response.body) {
    chunks.push(chunk);
  }
  return new Response(NULL_BODY_STATUS.has(response.status) ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers });
}

module.exports = { NetGuardError, isPrivateIp, resolvePublicAddress, validateOutboundUrl, pinnedLookup, requestOnce, guardedFetch, guardedStream, abortable, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_REDIRECTS };
