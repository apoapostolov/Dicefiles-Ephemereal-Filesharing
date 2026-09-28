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
function requestOnce(target, init = {}, opts = {}) {
  const { url, address } = target;
  const maxBytes = opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const transport = url.protocol === "https:" ? https : http;
  const headers = Object.assign({}, init.headers);
  if (init.body != null && headers["content-length"] == null &&
      !Object.keys(headers).some(k => k.toLowerCase() === "content-length")) {
    headers["content-length"] = Buffer.byteLength(init.body);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: init.method || "GET",
      headers,
      lookup: pinnedLookup(address),
      // Keep certificate validation against the hostname, not the pinned IP.
      servername: url.hostname,
      rejectUnauthorized: true,
    }, res => {
      const chunks = [];
      let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          // Settle before destroying, so the abort cannot overwrite the reason.
          finish(
            reject,
            new NetGuardError(
              `Response exceeded the ${maxBytes} byte limit`,
              "RESPONSE_TOO_LARGE",
            ),
          );
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("aborted", () => {
        finish(reject, new NetGuardError("Response aborted", "REQUEST_FAILED"));
      });
      res.on("end", () => {
        finish(resolve, {
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    const timer = setTimeout(() => {
      finish(
        reject,
        new NetGuardError(`Request timed out after ${timeoutMs} ms`, "REQUEST_TIMEOUT"),
      );
      req.destroy();
    }, timeoutMs);

    req.on("error", err => {
      finish(
        reject,
        new NetGuardError(err.message, "REQUEST_FAILED"),
      );
    });
    if (init.body != null) {
      req.write(init.body);
    }
    req.end();
  });
}

/**
 * Fetch a URL after validating its destination, with a Response-compatible
 * result. Drop-in for `fetch` wherever the destination is influenced by a user,
 * a room, or a remote host.
 *
 * Redirects are followed manually so every hop is validated, and a hop that
 * leaves the original origin never carries the original headers.
 *
 * @param {string|URL} rawUrl
 * @param {object} [init] method, headers, body
 * @param {object} [opts] maxBytes, timeoutMs, maxRedirects, allowPrivate
 * @returns {Promise<Response>}
 */
async function guardedFetch(rawUrl, init = {}, opts = {}) {
  const maxRedirects = opts.maxRedirects != null ?
    opts.maxRedirects :
    DEFAULT_MAX_REDIRECTS;
  let current = String(rawUrl);
  let headers = Object.assign({}, init.headers);
  let { method = "GET" } = init;
  let { body } = init;
  let origin = null;

  for (let hop = 0; ; hop++) {
    const target = await validateOutboundUrl(current, opts);
    if (origin === null) {
      ({ origin } = target.url);
    }
    else if (target.url.origin !== origin) {
      // Never forward credentials or a body to a different origin.
      headers = Object.fromEntries(
        Object.entries(headers).filter(([key]) => {
          const lower = key.toLowerCase();
          return lower !== "authorization" && lower !== "cookie";
        }),
      );
      if (method !== "GET" && method !== "HEAD") {
        method = "GET";
        body = undefined;
      }
    }

    const res = await requestOnce(target, { method, headers, body }, opts);
    const isRedirect = res.status >= 300 && res.status < 400;
    const { location } = res.headers;
    if (isRedirect && location && hop < maxRedirects) {
      current = new URL(location, target.url).toString();
      continue;
    }
    const bodyBuffer = NULL_BODY_STATUS.has(res.status) ? null : res.body;
    return new Response(bodyBuffer, {
      status: res.status,
      headers: res.headers,
    });
  }
}

module.exports = {
  NetGuardError,
  isPrivateIp,
  resolvePublicAddress,
  validateOutboundUrl,
  pinnedLookup,
  requestOnce,
  guardedFetch,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_REDIRECTS,
};
