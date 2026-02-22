"use strict";

export async function xregexp(...args) {
  const { default: XRegExp } = await import(
    /* webpackChunkName: "xregexp", webpackPrefetch: true */
    "xregexp"
  );
  return new XRegExp(...args);
}
