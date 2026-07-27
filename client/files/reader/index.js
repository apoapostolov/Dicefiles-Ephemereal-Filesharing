"use strict";

/**
 * Lazy-friendly reader entry. Re-exports the full Reader implementation so
 * webpack can chunk `client/files/reader` independently of the room shell.
 */
export { default, flushStaleProgress } from "../reader";
