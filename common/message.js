"use strict";

// P0.5 — 3.3: Replace url-regex (ReDoS-vulnerable, no fix) with url-regex-safe.
// The API is identical: calling the function returns a RegExp; we use .source
// to embed it into the composite splitting regex.
const SCHEME_REGEX = /^(?:https?|ftp|irc):/;
const WHITE_REGEX = /^[\r\n]+$/;
const URL_REGEX = new RegExp(
  `([\r\n]+|[#@][a-z0-9_-]+|${require("url-regex-safe")({ exact: false }).source})`,
  "ig",
);

function normalizeURL(URL, url) {
  if (!url.match(SCHEME_REGEX)) {
    url = `https://${url}`;
  }
  url = new URL(url, "https://reddit.com/");
  url.username = url.password = "";
  return url.toString();
}

async function mapMessagePart(v, i, rec) {
  if (!(i % 2)) {
    if (!v.trim()) {
      return null;
    }
    rec.previousText = true;
    return { t: "t", v };
  }
  try {
    if (v.startsWith("#")) {
      if (rec.rooms < 10) {
        let r = rec.resolveRoom(v.slice(1));
        if (r && r.then) {
          r = await r;
        }
        if (r) {
          rec.rooms++;
          rec.previousText = true;
          return Object.assign({ t: "r" }, r);
        }
      }
      rec.previousText = true;
      return { t: "t", v };
    }
    if (v.startsWith("@")) {
      if (rec.files < 5) {
        let f = rec.resolveFile(v.slice(1));
        if (f && f.then) {
          f = await f;
        }
        if (f) {
          rec.files++;
          rec.previousText = false;
          return Object.assign({ t: "f" }, f);
        }
      }
      rec.previousText = true;
      return { t: "t", v };
    }
    if (WHITE_REGEX.test(v)) {
      if (!rec.previousText || rec.breaks++ > 1) {
        rec.previousText = true;
        return { t: "t", v: " " };
      }
      rec.previousText = false;
      return { t: "b" };
    }
    rec.previousText = true;
    return { t: "u", v: normalizeURL(rec.URL, v) };
  } catch (ex) {
    console.error(ex);
  }
  rec.previousText = true;
  return { t: "t", v };
}

async function toMessage(URL, resolveRoom, resolveFile, msg) {
  msg = msg.trim();
  if (msg.length > 300) {
    throw new Error("Message too long");
  }

  const records = {
    breaks: 0,
    files: 0,
    rooms: 0,
    previousText: true,
    URL,
    resolveFile,
    resolveRoom,
  };
  let i = 0;
  const rv = [];
  for (const p of msg.split(URL_REGEX)) {
    const part = await mapMessagePart(p, i++, records);
    if (part) {
      rv.push(part);
    }
  }
  return rv;
}

module.exports = {
  normalizeURL,
  toMessage,
};
