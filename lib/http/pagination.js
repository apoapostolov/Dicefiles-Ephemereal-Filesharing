"use strict";

const crypto = require("crypto");

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_SIZE = 500;
const CURSOR_TTL_MS = 30 * 60 * 1000;

function badCursor(message = "Invalid or expired cursor") {
  return Object.assign(new Error(message), { status: 400 });
}

function tuple(item) {
  return [Number(item.uploaded) || 0, String(item.key || item.path || "")];
}

function compare(a, b) {
  return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
}

function encodeCursor(state, secret) {
  const data = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`pagination:v1:${data}`).digest("base64url");
  return `${data}.${signature}`;
}

function decodeCursor(cursor, context, secret, now) {
  if (typeof cursor !== "string" || cursor.length > 4096) {
    throw badCursor();
  }
  const [data, signature, extra] = cursor.split(".");
  if (!data || !signature || extra) {
    throw badCursor();
  }
  const expected = crypto.createHmac("sha256", secret).update(`pagination:v1:${data}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw badCursor();
  }
  let state;
  try {
    state = JSON.parse(Buffer.from(data, "base64url").toString());
  }
  catch (_) {
    throw badCursor();
  }
  if (state.v !== 1 || state.context !== context || state.expires <= now ||
      !Array.isArray(state.after) || !Array.isArray(state.ceiling) ||
      state.after.length !== 2 || state.ceiling.length !== 2) {
    throw badCursor();
  }
  return state;
}

/** Stable keyset pages: deleting/expiring the last item never shifts an offset. */
function paginate(items, query, context, secret, now = Date.now()) {
  if (query.limit == null && !query.cursor) {
    return { items, pagination: null };
  }
  const limit = query.limit == null ? 100 : Number(query.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw badCursor(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  const ordered = items.slice().sort((a, b) => compare(tuple(a), tuple(b)));
  const state = query.cursor ? decodeCursor(query.cursor, context, secret, now) : {
    v: 1, context, expires: now + CURSOR_TTL_MS,
    ceiling: ordered.length ? tuple(ordered[ordered.length - 1]) : [0, ""],
    after: null,
  };
  const eligible = ordered.filter(item =>
    compare(tuple(item), state.ceiling) <= 0 &&
    (!state.after || compare(tuple(item), state.after) > 0),
  );
  const page = [];
  let bytes = 0;
  for (const item of eligible) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (itemBytes > MAX_JSON_BYTES / 2) {
      throw Object.assign(new Error("An item exceeds the response limit; retrieve its metadata individually"), { status: 413 });
    }
    if (page.length === limit || bytes + itemBytes > MAX_JSON_BYTES / 2) {
      break;
    }
    page.push(item);
    bytes += itemBytes;
  }
  const nextCursor = page.length && page.length < eligible.length ?
    encodeCursor({ ...state, after: tuple(page[page.length - 1]) }, secret) : null;
  return { items: page, pagination: { limit, nextCursor, hasMore: !!nextCursor, total: ordered.length } };
}

function boundedJson(res, data) {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
    throw Object.assign(new Error("Response exceeds 8 MiB; use limit and cursor pagination"), { status: 413 });
  }
  res.type("application/json").send(text);
}

module.exports = { paginate, boundedJson, MAX_JSON_BYTES };
