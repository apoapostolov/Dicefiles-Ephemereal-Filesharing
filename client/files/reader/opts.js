"use strict";

/** localStorage keys and helpers for reading progress + typography options. */

export const PROGRESS_PREFIX = "dicefiles:readprogress:";
export const READER_OPTS_KEY = "dicefiles:readeropts";

/**
 * Default reader typography options (Kindle-style).
 * fontFamily: key into FONT_FAMILIES
 * fontSize:   em multiplier (relative to root)
 * lineSpacing: CSS line-height value
 * margin:     horizontal padding in px
 */
export const READER_OPTS_DEFAULTS = {
  fontFamily: "georgia",
  fontSize: 1.05,
  lineSpacing: 1.75,
  margin: 56,
};

export const FONT_FAMILIES = {
  georgia: 'Georgia,"Times New Roman",serif',
  bookerly: '"Bookerly","Palatino Linotype","Palatino","Book Antiqua",serif',
  helvetica: "Helvetica,Arial,sans-serif",
  dyslexic: 'OpenDyslexic,"Comic Sans MS",cursive',
};

/** Load persisted reader options, falling back to defaults. */
export function loadReaderOpts() {
  try {
    const raw = localStorage.getItem(READER_OPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...READER_OPTS_DEFAULTS, ...parsed };
    }
  }
  catch (_) {
    // ignore
  }
  return { ...READER_OPTS_DEFAULTS };
}

/** Persist reader options. */
export function saveReaderOpts(opts) {
  try {
    localStorage.setItem(READER_OPTS_KEY, JSON.stringify(opts));
  }
  catch (_) {
    // ignore
  }
}

/**
 * Persist the reading position for `fileKey`.
 * `state` shape: { page: number, chapter?: number }
 */
export function saveProgress(fileKey, state) {
  if (!fileKey) {
    return;
  }
  try {
    localStorage.setItem(PROGRESS_PREFIX + fileKey, JSON.stringify(state));
  }
  catch (_) {
    // quota / private browsing — ignore
  }
}

/** Retrieve previously saved progress. Returns null if none. */
export function loadProgress(fileKey) {
  if (!fileKey) {
    return null;
  }
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + fileKey);
    return raw ? JSON.parse(raw) : null;
  }
  catch (_) {
    return null;
  }
}
