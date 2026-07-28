"use strict";

/**
 * Resolve a one-page book navigation request without touching reader state.
 *
 * Cross-chapter targets use page -1 when moving backwards; BookReader resolves
 * that marker to the final page after the preceding chapter is laid out.
 */
function resolveBookPageTurn(
    { chapter, page, pagesInChapter, chapters },
    direction,
) {
  if (direction === "next") {
    if (page + 1 < pagesInChapter) {
      return { chapter, page: page + 1, crossesChapter: false };
    }
    if (chapter + 1 < chapters) {
      return { chapter: chapter + 1, page: 0, crossesChapter: true };
    }
    return null;
  }

  if (direction === "prev") {
    if (page > 0) {
      return { chapter, page: page - 1, crossesChapter: false };
    }
    if (chapter > 0) {
      return { chapter: chapter - 1, page: -1, crossesChapter: true };
    }
  }

  return null;
}

module.exports = { resolveBookPageTurn };
