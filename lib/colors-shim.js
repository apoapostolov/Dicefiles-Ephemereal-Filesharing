"use strict";

/**
 * Minimal String color helpers replacing the abandoned `colors` package.
 * Supports chained styles used by this codebase (e.g. str.bold.blue, str.red).
 *
 * Note: Node still has legacy HTML wrappers on String.prototype (bold, fontcolor…).
 * We intentionally override those getters for console styling.
 */

const pc = require("picocolors");

const STYLE_FNS = {
  bold: pc.bold,
  dim: pc.dim,
  red: pc.red,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  white: pc.white,
  gray: pc.gray,
  grey: pc.gray,
};

function makeColorProxy(value) {
  const str = String(value);
  // Use a plain object with valueOf/toString so chaining works without hitting
  // native String HTML methods on the prototype chain of boxed strings.
  const target = {
    toString() {
      return str;
    },
    valueOf() {
      return str;
    },
    [Symbol.toPrimitive]() {
      return str;
    },
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) {
        return t[prop];
      }
      if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(STYLE_FNS, prop)) {
        return makeColorProxy(STYLE_FNS[prop](str));
      }
      // Allow string methods when needed
      const v = str[prop];
      return typeof v === "function" ? v.bind(str) : v;
    },
  });
}

function install() {
  if (global.__dicefilesColorsInstalled) {
    return;
  }
  for (const name of Object.keys(STYLE_FNS)) {
    Object.defineProperty(String.prototype, name, {
      configurable: true,
      enumerable: false,
      get() {
        return makeColorProxy(STYLE_FNS[name](String(this)));
      },
    });
  }
  global.__dicefilesColorsInstalled = true;
}

install();
module.exports = { install, makeColorProxy };
