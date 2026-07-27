"use strict";

const {
  isValidRoomId,
  normalizeLinkedRooms,
  addLinkedRoom,
  removeLinkedRoom,
  markLinkedClientFile,
  isLinkableSourceFile,
  includeLinkedForRole,
} = require("../../lib/room/room-links");

describe("room-links (shipped)", () => {
  test("isValidRoomId", () => {
    expect(isValidRoomId("QV39BPLjcz")).toBe(true);
    expect(isValidRoomId("ab")).toBe(false);
    expect(isValidRoomId("../x")).toBe(false);
    expect(isValidRoomId("")).toBe(false);
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
});
