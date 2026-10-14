"use strict";

const mockScan = jest.fn();
jest.mock("../../lib/broker", () => ({ getMethods: () => ({ scan: mockScan }) }));
const { scanKeys } = require("../../lib/redis-scan");

beforeEach(() => mockScan.mockReset());
test("modern Redis cursors are preserved without losing integer precision", async () => {
  mockScan.mockResolvedValueOnce({ cursor: "9223372036854775807", keys: ["a"] }).mockResolvedValueOnce({ cursor: "0", keys: ["b"] });
  expect(await scanKeys("rooms:*", { count: 1 })).toEqual(["a", "b"]);
  expect(mockScan.mock.calls[1][0]).toBe("9223372036854775807");
});
test("legacy tuple replies remain supported", async () => {
  mockScan.mockResolvedValue(["0", ["a"]]); expect(await scanKeys("*")).toEqual(["a"]);
});
test("invalid cursor replies fail before a second Redis call", async () => {
  mockScan.mockResolvedValue({ keys: [] }); await expect(scanKeys("*")).rejects.toThrow("Invalid Redis scan response"); expect(mockScan).toHaveBeenCalledTimes(1);
});
