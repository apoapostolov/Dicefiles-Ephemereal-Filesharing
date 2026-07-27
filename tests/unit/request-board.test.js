"use strict";

const {
  isRequestFile,
  requestStatus,
  buildRequestBoard,
  summarizeRequestBoard,
} = require("../../lib/room/request-board");

describe("request-board (shipped)", () => {
  const files = [
    { key: "u1", name: "a.pdf", uploaded: 10, meta: {} },
    {
      key: "r1",
      name: "need map",
      uploaded: 30,
      status: "open",
      meta: { request: true },
    },
    {
      key: "r2",
      name: "old",
      uploaded: 20,
      status: "fulfilled",
      meta: { request: true },
    },
    {
      key: "r3",
      name: "newer open",
      uploaded: 40,
      status: "open",
      meta: { request: true },
    },
  ];

  test("isRequestFile / requestStatus", () => {
    expect(isRequestFile(files[0])).toBe(false);
    expect(isRequestFile(files[1])).toBe(true);
    expect(requestStatus(files[1])).toBe("open");
    expect(requestStatus(files[2])).toBe("fulfilled");
  });

  test("buildRequestBoard open first then fulfilled, newest within", () => {
    const board = buildRequestBoard(files);
    expect(board.map((f) => f.key)).toEqual(["r3", "r1", "r2"]);
  });

  test("buildRequestBoard status filter + allowRequests off", () => {
    expect(buildRequestBoard(files, { status: "fulfilled" }).map((f) => f.key)).toEqual([
      "r2",
    ]);
    expect(buildRequestBoard(files, { allowRequests: false })).toEqual([]);
  });

  test("summarizeRequestBoard", () => {
    expect(summarizeRequestBoard(files)).toEqual({
      open: 2,
      fulfilled: 1,
      total: 3,
    });
  });
});
