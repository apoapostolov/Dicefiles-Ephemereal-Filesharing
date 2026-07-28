"use strict";

const {
  resolveBookPageTurn,
} = require("../../common/reader-page-turn");

describe("EPUB page-turn navigation", () => {
  const state = {
    chapter: 2,
    page: 3,
    pagesInChapter: 7,
    chapters: 5,
  };

  test("moves within the current chapter", () => {
    expect(resolveBookPageTurn(state, "next")).toEqual({
      chapter: 2,
      page: 4,
      crossesChapter: false,
    });
    expect(resolveBookPageTurn(state, "prev")).toEqual({
      chapter: 2,
      page: 2,
      crossesChapter: false,
    });
  });

  test("moves forward to the first page of the next chapter", () => {
    expect(
      resolveBookPageTurn(
        { ...state, chapter: 2, page: 6, pagesInChapter: 7 },
        "next",
      ),
    ).toEqual({
      chapter: 3,
      page: 0,
      crossesChapter: true,
    });
  });

  test("moves backward to the final page marker of the previous chapter", () => {
    expect(
      resolveBookPageTurn({ ...state, chapter: 2, page: 0 }, "prev"),
    ).toEqual({
      chapter: 1,
      page: -1,
      crossesChapter: true,
    });
  });

  test("stops at the first and final page of the book", () => {
    expect(
      resolveBookPageTurn(
        { chapter: 0, page: 0, pagesInChapter: 4, chapters: 5 },
        "prev",
      ),
    ).toBeNull();
    expect(
      resolveBookPageTurn(
        { chapter: 4, page: 3, pagesInChapter: 4, chapters: 5 },
        "next",
      ),
    ).toBeNull();
  });
});
