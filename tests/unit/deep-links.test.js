"use strict";

const {
  isDeepLinksEnabled,
  parseHash,
  parseSearch,
  resolveDeepLinkNavigation,
  applyDeepLinkIntents,
  buildRequestBoardShareUrl,
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
    expect(parseSearch("?requests=fulfilled")).toEqual({
      requestBoard: "fulfilled",
    });
    expect(parseSearch("?requests=invalid")).toEqual({});
  });

  test("buildRequestBoardShareUrl keeps room context and strips other intents and invite tokens", () => {
    expect(
      buildRequestBoardShareUrl(
        "https://dice.test/r/room123?file=f1&filter=pdf&invite=secret#f1",
        "open",
      ),
    ).toBe("https://dice.test/r/room123?requests=open");
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
        requestBoardStatus: null,
      },
    );
    expect(applyDeepLinkIntents(base, { filter: "a", file: "k" }, true)).toEqual(
      {
        filter: "a",
        sortMode: "newest",
        openFileKey: "k",
        openRequestKey: null,
        requestBoardStatus: null,
      },
    );
  });

  test("applyDeepLinkIntents carries request-board view state", () => {
    expect(
      applyDeepLinkIntents(
        { filter: "", sortMode: "newest" },
        { requestBoard: "fulfilled" },
        true,
      ).requestBoardStatus,
    ).toBe("fulfilled");
  });

  test("resolveDeepLinkOpenPlan: config-before-files leaves open pending", () => {
    const {
      resolveDeepLinkOpenPlan,
      shouldApplyDeepLinkListIntents,
    } = require("../../lib/room/deep-links");
    const map = new Map();
    const lookup = (k) => map.get(k) || null;

    // Phase 1: config arrived, filemap empty — must NOT mark open done
    const pending = resolveDeepLinkOpenPlan({
      openFileKey: "doc1",
      openRequestKey: null,
      filesReady: false,
      openAlreadyDone: false,
      lookup,
    });
    expect(pending.tryOpenFile).toBeNull();
    expect(pending.openDone).toBe(false);

    // List intents can still apply once on config
    expect(
      shouldApplyDeepLinkListIntents({
        applyIntents: true,
        listAlreadyApplied: false,
      }),
    ).toBe(true);
    expect(
      shouldApplyDeepLinkListIntents({
        applyIntents: true,
        listAlreadyApplied: true,
      }),
    ).toBe(false);

    // Phase 2: files replace populates map — open resolves
    map.set("doc1", { isRequest: false, key: "doc1" });
    const ready = resolveDeepLinkOpenPlan({
      openFileKey: "doc1",
      openRequestKey: null,
      filesReady: true,
      openAlreadyDone: false,
      lookup,
    });
    expect(ready.tryOpenFile).toBe("doc1");
    expect(ready.openDone).toBe(true);

    // If list ready but key missing, give up (do not hang forever)
    const missing = resolveDeepLinkOpenPlan({
      openFileKey: "nope",
      openRequestKey: null,
      filesReady: true,
      openAlreadyDone: false,
      lookup,
    });
    expect(missing.tryOpenFile).toBeNull();
    expect(missing.openDone).toBe(true);

    // Request path
    map.set("rq1", { isRequest: true, key: "rq1" });
    const req = resolveDeepLinkOpenPlan({
      openFileKey: null,
      openRequestKey: "rq1",
      filesReady: true,
      openAlreadyDone: false,
      lookup,
    });
    expect(req.tryOpenRequest).toBe("rq1");
    expect(req.openDone).toBe(true);
  });

  test("config-before-files full navigation sequence (shipped helpers)", () => {
    const {
      resolveDeepLinkNavigation,
      applyDeepLinkIntents,
      resolveDeepLinkOpenPlan,
      shouldApplyDeepLinkListIntents,
    } = require("../../lib/room/deep-links");

    const nav = resolveDeepLinkNavigation({
      search: "?file=secretDoc&filter=maps&sort=largest",
      hash: "",
      deepLinksEnabled: true,
    });
    expect(nav.applyIntents).toBe(true);

    const next = applyDeepLinkIntents(
      { filter: "", sortMode: "newest" },
      nav.intents,
      true,
    );
    expect(next.openFileKey).toBe("secretDoc");
    expect(next.filter).toBe("maps");

    const filemap = new Map();
    let listApplied = false;
    let openDone = false;
    let opened = null;

    function tick(filesReady) {
      if (
        shouldApplyDeepLinkListIntents({
          applyIntents: nav.applyIntents,
          listAlreadyApplied: listApplied,
        })
      ) {
        listApplied = true;
      }
      const plan = resolveDeepLinkOpenPlan({
        openFileKey: next.openFileKey,
        openRequestKey: next.openRequestKey,
        filesReady,
        openAlreadyDone: openDone,
        lookup: (k) => filemap.get(k) || null,
      });
      if (plan.tryOpenFile) {
        opened = plan.tryOpenFile;
      }
      if (plan.openDone) {
        openDone = true;
      }
      return plan;
    }

    // config first
    const p1 = tick(false);
    expect(listApplied).toBe(true);
    expect(p1.openDone).toBe(false);
    expect(opened).toBeNull();

    // files arrive
    filemap.set("secretDoc", { isRequest: false });
    const p2 = tick(true);
    expect(p2.tryOpenFile).toBe("secretDoc");
    expect(opened).toBe("secretDoc");
    expect(openDone).toBe(true);

    // further ticks no re-open needed
    const p3 = tick(true);
    expect(p3.tryOpenFile).toBeNull();
    expect(p3.openDone).toBe(true);
  });
});
