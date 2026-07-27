"use strict";

const {
  isDeepLinksEnabled,
  parseHash,
  parseSearch,
  resolveDeepLinkNavigation,
  applyDeepLinkIntents,
} = require("../../lib/room/deep-links");

describe("deep-links (shipped)", () => {
  test("isDeepLinksEnabled", () => {
    expect(isDeepLinksEnabled(true)).toBe(true);
    expect(isDeepLinksEnabled(false)).toBe(false);
    expect(isDeepLinksEnabled(undefined)).toBe(false);
    expect(isDeepLinksEnabled("1")).toBe(true);
  });

  test("parseHash bare key is legacy gallery", () => {
    expect(parseHash("#abc123")).toEqual({
      legacyFileKey: "abc123",
      intents: {},
    });
  });

  test("parseHash structured intents", () => {
    const { legacyFileKey, intents } = parseHash(
      "#file=fk1&filter=pdf&sort=largest&request=rq1",
    );
    expect(legacyFileKey).toBeNull();
    expect(intents).toEqual({
      file: "fk1",
      filter: "pdf",
      sort: "largest",
      request: "rq1",
    });
  });

  test("parseSearch", () => {
    expect(parseSearch("?file=x&sort=bogus")).toEqual({ file: "x" });
    expect(parseSearch("sort=newest")).toEqual({ sort: "newest" });
  });

  test("resolveDeepLinkNavigation option off: no query intents", () => {
    const r = resolveDeepLinkNavigation({
      search: "?file=secret&filter=x",
      hash: "#legacyKey",
      deepLinksEnabled: false,
    });
    expect(r.applyIntents).toBe(false);
    expect(r.intents).toEqual({});
    expect(r.legacyGalleryKey).toBe("legacyKey");
  });

  test("resolveDeepLinkNavigation option on: applies intents", () => {
    const r = resolveDeepLinkNavigation({
      search: "?filter=maps&sort=newest",
      hash: "#file=doc1",
      deepLinksEnabled: true,
    });
    expect(r.applyIntents).toBe(true);
    expect(r.intents.filter).toBe("maps");
    expect(r.intents.sort).toBe("newest");
    expect(r.intents.file).toBe("doc1");
  });

  test("applyDeepLinkIntents respects apply flag", () => {
    const base = { filter: "", sortMode: "newest", openFileKey: null };
    expect(applyDeepLinkIntents(base, { filter: "a", file: "k" }, false)).toEqual(
      {
        filter: "",
        sortMode: "newest",
        openFileKey: null,
        openRequestKey: null,
      },
    );
    expect(applyDeepLinkIntents(base, { filter: "a", file: "k" }, true)).toEqual(
      {
        filter: "a",
        sortMode: "newest",
        openFileKey: "k",
        openRequestKey: null,
      },
    );
  });
});
