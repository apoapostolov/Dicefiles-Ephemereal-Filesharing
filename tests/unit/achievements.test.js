"use strict";

/**
 * Unit tests for lib/achievements.js — computeAchievements.
 * Pure computation — no external dependencies.
 *
 * computeAchievements returns:
 *  { files, uploaded, downloaded, unlocked, total, all,
 *    unlockedList, lockedList,
 *    filesOnly, bytesOnly, downloadsOnly, requestsOnly, requestsCreatedOnly }
 */

const { computeAchievements } = require("../../lib/achievements.js");

describe("computeAchievements", () => {
  // ── return shape ──────────────────────────────────────────────────────────
  test("returns object with expected keys including array groups", () => {
    const result = computeAchievements({ files: 0, uploaded: 0, downloaded: 0 });
    expect(Array.isArray(result.all)).toBe(true);
    expect(Array.isArray(result.filesOnly)).toBe(true);
    expect(Array.isArray(result.bytesOnly)).toBe(true);
    expect(Array.isArray(result.downloadsOnly)).toBe(true);
    expect(Array.isArray(result.requestsOnly)).toBe(true);
    expect(Array.isArray(result.requestsCreatedOnly)).toBe(true);
    expect(typeof result.unlocked).toBe("number");
    expect(typeof result.total).toBe("number");
  });

  test("each achievement has required fields", () => {
    const result = computeAchievements({ files: 10, uploaded: 0, downloaded: 0 });
    for (const ach of result.filesOnly) {
      expect(ach).toHaveProperty("key");
      expect(ach).toHaveProperty("kind");
      expect(ach).toHaveProperty("icon");
      expect(ach).toHaveProperty("rarity");
      expect(ach).toHaveProperty("title");
      expect(ach).toHaveProperty("description");
      expect(ach).toHaveProperty("required");
      expect(typeof ach.unlocked).toBe("boolean");
    }
  });

  // ── zero stats — nothing unlocked ─────────────────────────────────────────
  test("zero stats produce no unlocked achievements", () => {
    const result = computeAchievements({ files: 0, uploaded: 0, downloaded: 0 });
    expect(result.unlocked).toBe(0);
    expect(result.unlockedList).toHaveLength(0);
  });

  // ── files milestones ──────────────────────────────────────────────────────
  test("10 files unlocks first file achievement (First Stack)", () => {
    const result = computeAchievements({ files: 10, uploaded: 0, downloaded: 0 });
    const first = result.filesOnly[0];
    expect(first.unlocked).toBe(true);
    expect(first.title).toBe("First Stack");
  });

  test("9 files does not unlock first file achievement", () => {
    const result = computeAchievements({ files: 9, uploaded: 0, downloaded: 0 });
    expect(result.filesOnly[0].unlocked).toBe(false);
  });

  test("more files unlocks more achievements", () => {
    const r100 = computeAchievements({ files: 100, uploaded: 0, downloaded: 0 });
    const r10  = computeAchievements({ files: 10,  uploaded: 0, downloaded: 0 });
    expect(r100.unlocked).toBeGreaterThan(r10.unlocked);
  });

  // ── byte milestones ───────────────────────────────────────────────────────
  test("50 MiB uploaded unlocks first byte achievement", () => {
    const MiB = 1024 * 1024;
    const result = computeAchievements({ files: 0, uploaded: 50 * MiB, downloaded: 0 });
    expect(result.bytesOnly[0].unlocked).toBe(true);
  });

  test("49 MiB does not unlock first byte achievement", () => {
    const MiB = 1024 * 1024;
    const result = computeAchievements({ files: 0, uploaded: 49 * MiB, downloaded: 0 });
    expect(result.bytesOnly[0].unlocked).toBe(false);
  });

  // ── download milestones ───────────────────────────────────────────────────
  test("50 MiB downloaded unlocks first download achievement", () => {
    const MiB = 1024 * 1024;
    const result = computeAchievements({ files: 0, uploaded: 0, downloaded: 50 * MiB });
    expect(result.downloadsOnly[0].unlocked).toBe(true);
  });

  // ── completed request milestones ─────────────────────────────────────────
  test("1 completed request unlocks first request achievement", () => {
    const result = computeAchievements({
      files: 0,
      uploaded: 0,
      downloaded: 0,
      fulfilledRequests: 1,
    });
    expect(result.requestsOnly[0].unlocked).toBe(true);
    expect(result.requestsOnly[0].title).toBe("First Responder");
  });

  test("0 completed requests does not unlock first request achievement", () => {
    const result = computeAchievements({
      files: 0,
      uploaded: 0,
      downloaded: 0,
      fulfilledRequests: 0,
    });
    expect(result.requestsOnly[0].unlocked).toBe(false);
  });

  // ── created request milestones ───────────────────────────────────────────
  test("5 created requests unlocks first created-request achievement", () => {
    const result = computeAchievements({
      files: 0,
      uploaded: 0,
      downloaded: 0,
      createdRequests: 5,
    });
    expect(result.requestsCreatedOnly[0].unlocked).toBe(true);
    expect(result.requestsCreatedOnly[0].title).toBe("Testing the Waters");
  });

  test("4 created requests does not unlock first created-request achievement", () => {
    const result = computeAchievements({
      files: 0,
      uploaded: 0,
      downloaded: 0,
      createdRequests: 4,
    });
    expect(result.requestsCreatedOnly[0].unlocked).toBe(false);
  });

  // ── missing stats fields default to 0 ────────────────────────────────────
  test("empty stats object produces zero unlocked", () => {
    const result = computeAchievements({});
    expect(result.unlocked).toBe(0);
  });

  // ── rarity correctness ────────────────────────────────────────────────────
  test("rarity is one of the expected tier names", () => {
    const validRarities = new Set([
      "common", "uncommon", "rare", "epic", "legendary", "mythic", "ascendant",
    ]);
    const result = computeAchievements({ files: 0, uploaded: 0, downloaded: 0 });
    for (const ach of result.all) {
      expect(validRarities.has(ach.rarity)).toBe(true);
    }
  });

  // ── key uniqueness ────────────────────────────────────────────────────────
  test("each achievement key is unique within its group", () => {
    const result = computeAchievements({ files: 0, uploaded: 0, downloaded: 0 });
    for (const group of [
      result.filesOnly,
      result.bytesOnly,
      result.downloadsOnly,
      result.requestsOnly,
      result.requestsCreatedOnly,
    ]) {
      const keys = group.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("achievement count rounds to 80 with the new request-creation track", () => {
    const result = computeAchievements({});
    expect(result.total).toBe(80);
  });

  // ── totals consistency ────────────────────────────────────────────────────
  test("total = unlocked + locked", () => {
    const result = computeAchievements({ files: 50, uploaded: 0, downloaded: 0 });
    expect(result.total).toBe(result.unlockedList.length + result.lockedList.length);
    expect(result.all).toHaveLength(result.total);
  });
});
