"use strict";

/**
 * Shared HTTP helpers extracted from the former httpserver monolith.
 * Pure/transport glue only — no route registration.
 */

const path = require("path");
const CONFIG = require("../config");
const verifier = require("../sessionverifier");
const { User } = require("../user");
const { token } = require("../util");

const NAME = CONFIG.get("name");
const MOTTO = CONFIG.get("motto");
const sekrit = CONFIG.get("secret");

function hmactoken(d) {
  return d ? verifier.generate(sekrit, d) : "";
}

function rtoken(req) {
  return hmactoken(req.cookies && req.cookies.kft);
}

function rtokenize(fn) {
  return async function (req, res) {
    try {
      const e = hmactoken(req.cookies.kft);
      if (e !== req.body.token) {
        throw new Error("Invalid request token");
      }
      delete req.body.token;
      let rv = fn(req, res);
      if (rv && rv.then) {
        rv = await rv;
      }
      res.json(rv);
    }
    catch (ex) {
      console.error(fn.name || "<wrapped handler>", ex);
      res.json({ err: ex.message || ex.toString() });
    }
  };
}

function render(res, page, ctx) {
  const v = require("../clientversion");
  ctx = Object.assign(
    {
      NAME,
      MOTTO,
      v,
      get token() {
        return rtoken(res.req);
      },
    },
    ctx,
  );
  return res.render(page, ctx);
}

async function injectkft(req, res, next) {
  try {
    if (!req.cookies) {
      req.cookies = {};
    }
    if (!req.cookies.kft) {
      req.cookies.kft = await token();
      res.cookie("kft", req.cookies.kft, {
        httpOnly: true,
        secure: req.secure,
        sameSite: "Strict",
      });
    }
  }
  catch (ex) {
    console.error(ex);
  }
  if (next) {
    next();
  }
}

async function getUser(req, _, next) {
  const user = req.cookies.session && (await User.load(req.cookies.session));
  req.user = user || null;
  if (next) {
    next();
  }
}

function aroute(fn) {
  return async function (req, res, next) {
    try {
      return await fn(req, res, next);
    }
    catch (ex) {
      return next && next(ex);
    }
  };
}

function requireMod(req) {
  if (!req.user || req.user.role !== "mod") {
    throw new Error("Not authorized");
  }
}

function asArray(v) {
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim()) {
    return [v.trim()];
  }
  return [];
}

function appendJSONLine(file, payload) {
  if (!file) {
    return;
  }
  require("fs").appendFile(file, `${JSON.stringify(payload)}\n`, () => {});
}

function asPositiveInt(v, fallback, min = 1, max = 1000000) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sendApiError(res, status, err) {
  res.status(status);
  res.json({ err });
}

function jroute(fn) {
  return async function (req, res) {
    try {
      let rv = fn(req, res);
      if (rv && rv.then) {
        rv = await rv;
      }
      if (rv !== undefined) {
        res.json(rv);
      }
    }
    catch (ex) {
      const status = ex.status || 400;
      console.error(fn.name || "<jroute>", ex);
      sendApiError(res, status, ex.message || ex.toString());
    }
  };
}

function v1(pathname) {
  return [`/api/automation${pathname}`, `/api/v1${pathname}`];
}

module.exports = {
  NAME,
  MOTTO,
  sekrit,
  hmactoken,
  rtoken,
  rtokenize,
  render,
  injectkft,
  getUser,
  aroute,
  requireMod,
  asArray,
  appendJSONLine,
  asPositiveInt,
  sendApiError,
  jroute,
  v1,
  staticBase: path.join(__dirname, "..", "..", "static"),
};
