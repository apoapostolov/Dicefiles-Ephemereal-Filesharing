"use strict";

const {
  isValidRoomId,
  isCrossLinkingAllowed,
  normalizeLinkedRooms,
  splitLinkedRoomInput,
  resolveLinkedRoomTokens,
  addLinkedRoom,
  removeLinkedRoom,
  markLinkedClientFile,
  isLinkableSourceFile,
  includeLinkedForRole,
  sourceAllowsCrossLink,
} = require("../../lib/room/room-links");

describe("room-links (shipped)", () => {
  test("isValidRoomId", () => {
    expect(isValidRoomId("QV39BPLjcz")).toBe(true);
    expect(isValidRoomId("ab")).toBe(false);
    expect(isValidRoomId("../x")).toBe(false);
    expect(isValidRoomId("")).toBe(false);
  });

  test("isCrossLinkingAllowed default denied", () => {
    expect(isCrossLinkingAllowed(undefined)).toBe(false);
    expect(isCrossLinkingAllowed(null)).toBe(false);
    expect(isCrossLinkingAllowed(false)).toBe(false);
    expect(isCrossLinkingAllowed(0)).toBe(false);
    expect(isCrossLinkingAllowed("0")).toBe(false);
    expect(isCrossLinkingAllowed(true)).toBe(true);
    expect(isCrossLinkingAllowed(1)).toBe(true);
    expect(isCrossLinkingAllowed("1")).toBe(true);
  });

  test("sourceAllowsCrossLink reads config get or plain object", () => {
    expect(sourceAllowsCrossLink(null)).toBe(false);
    expect(sourceAllowsCrossLink({ allowCrossLinking: false })).toBe(false);
    expect(sourceAllowsCrossLink({ allowCrossLinking: true })).toBe(true);
    const map = {
      get(k) {
        return k === "allowCrossLinking" ? true : undefined;
      },
    };
    expect(sourceAllowsCrossLink(map)).toBe(true);
    const off = {
      get() {
        return false;
      },
    };
    expect(sourceAllowsCrossLink(off)).toBe(false);
  });

  test("normalizeLinkedRooms unique + valid", () => {
    expect(normalizeLinkedRooms(null)).toEqual([]);
    expect(normalizeLinkedRooms("a1b2c3d4e5, a1b2c3d4e5, bad")).toEqual([
      "a1b2c3d4e5",
    ]);
    expect(normalizeLinkedRooms(["room_one12", "room_one12", "x"])).toEqual([
      "room_one12",
    ]);
  });

  test("splitLinkedRoomInput keeps multi-word names", () => {
    expect(splitLinkedRoomInput("Campaign Maps, abCdEf12Gh")).toEqual([
      "Campaign Maps",
      "abCdEf12Gh",
    ]);
    expect(splitLinkedRoomInput("Only Name")).toEqual(["Only Name"]);
    expect(splitLinkedRoomInput(["a", " b "])).toEqual(["a", "b"]);
  });

  test("resolveLinkedRoomTokens by id and by name", () => {
    const catalog = [
      { roomid: "sourceRoomA1", name: "Dump Room" },
      { roomid: "sourceRoomB2", name: "Campaign Maps" },
      { roomid: "hubRoom9999", name: "Hub" },
    ];

    const byId = resolveLinkedRoomTokens(
      "sourceRoomA1, sourceRoomB2",
      catalog,
      "hubRoom9999",
    );
    expect(byId.ids).toEqual(["sourceRoomA1", "sourceRoomB2"]);
    expect(byId.unresolved).toEqual([]);

    const byName = resolveLinkedRoomTokens(
      "Campaign Maps, Dump Room",
      catalog,
      "hubRoom9999",
    );
    expect(byName.ids).toEqual(["sourceRoomB2", "sourceRoomA1"]);
    expect(byName.unresolved).toEqual([]);

    const mixed = resolveLinkedRoomTokens(
      "campaign maps, sourceRoomA1",
      catalog,
    );
    expect(mixed.ids).toEqual(["sourceRoomB2", "sourceRoomA1"]);

    const unknown = resolveLinkedRoomTokens("No Such Room, sourceRoomA1", catalog);
    expect(unknown.ids).toEqual(["sourceRoomA1"]);
    expect(unknown.unresolved).toEqual(["No Such Room"]);

    const self = resolveLinkedRoomTokens("Hub, sourceRoomA1", catalog, "hubRoom9999");
    expect(self.ids).toEqual(["sourceRoomA1"]);
    expect(self.unresolved).toEqual(["Hub"]);

    // Valid id form not in catalog is kept (room may exist later)
    const stale = resolveLinkedRoomTokens("zzzzRoom99", catalog);
    expect(stale.ids).toEqual(["zzzzRoom99"]);
    expect(stale.unresolved).toEqual([]);
  });

  test("resolveLinkedRoomTokens ambiguous name unresolved", () => {
    const catalog = [
      { roomid: "roomAlpha01", name: "Dup" },
      { roomid: "roomBeta002", name: "Dup" },
    ];
    const r = resolveLinkedRoomTokens("Dup", catalog);
    expect(r.ids).toEqual([]);
    expect(r.unresolved).toEqual(["Dup"]);
  });

  test("addLinkedRoom / removeLinkedRoom", () => {
    const a = addLinkedRoom([], "sourceRoom1");
    expect(a).toEqual(["sourceRoom1"]);
    expect(addLinkedRoom(a, "sourceRoom1")).toEqual(["sourceRoom1"]);
    expect(() => addLinkedRoom([], "selfRoom12", "selfRoom12")).toThrow(
      /itself/,
    );
    expect(removeLinkedRoom(["roomAlpha1", "roomBeta22"], "roomAlpha1")).toEqual([
      "roomBeta22",
    ]);
  });

  test("markLinkedClientFile stamps meta and tags", () => {
    const f = markLinkedClientFile(
      { key: "k1", name: "x.pdf", meta: { type: "PDF" }, tags: { user: "a" } },
      "srcRoom99",
      "Dump Room",
    );
    expect(f.linked).toBe(true);
    expect(f.linkedFrom).toBe("srcRoom99");
    expect(f.meta.linkedFrom).toBe("srcRoom99");
    expect(f.meta.linkedRoomName).toBe("Dump Room");
    expect(f.tags.linked).toBe("Dump Room");
    expect(f.meta.type).toBe("PDF");
  });

  test("isLinkableSourceFile excludes requests", () => {
    expect(isLinkableSourceFile({ key: "1", meta: {} })).toBe(true);
    expect(
      isLinkableSourceFile({ key: "1", meta: { request: true } }),
    ).toBe(false);
    expect(isLinkableSourceFile({ key: "1", hidden: true, meta: {} })).toBe(
      false,
    );
  });

  test("includeLinkedForRole", () => {
    expect(
      includeLinkedForRole({ key: "1", meta: {}, hidden: false }, "white"),
    ).toBe(true);
    expect(
      includeLinkedForRole({ key: "1", meta: {}, hidden: true }, "white"),
    ).toBe(false);
    expect(
      includeLinkedForRole({ key: "1", meta: {}, hidden: true }, "mod"),
    ).toBe(true);
    expect(
      includeLinkedForRole({ key: "1", meta: { request: true } }, "mod"),
    ).toBe(false);
  });

  test("collect gate: no files when source denies cross-link", () => {
    // Pure contract used by collectLinkedClientFiles
    const allowedSrc = { get: (k) => (k === "allowCrossLinking" ? true : null) };
    const deniedSrc = { get: (k) => (k === "allowCrossLinking" ? false : null) };
    expect(sourceAllowsCrossLink(allowedSrc)).toBe(true);
    expect(sourceAllowsCrossLink(deniedSrc)).toBe(false);
    // Destination may still store the id; gate is at collect time.
    const stored = normalizeLinkedRooms(["sourceRoomA1"]);
    expect(stored).toEqual(["sourceRoomA1"]);
  });
});
