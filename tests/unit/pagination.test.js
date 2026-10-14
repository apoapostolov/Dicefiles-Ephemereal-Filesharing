"use strict";

const { paginate } = require("../../lib/http/pagination");

const secret = "synthetic-pagination-secret";
const files = Array.from({ length: 1000 }, (_, index) => ({ key: String(index).padStart(4, "0"), uploaded: index }));
test("keyset pages survive expiration of the boundary item and exclude later uploads", () => {
  const first = paginate(files, { limit: 100 }, "room-a", secret, 1000);
  expect(first.items).toHaveLength(100);
  const changed = files.filter(f => f.key !== "0099").concat({ key: "new", uploaded: 2000 });
  const next = paginate(changed, { limit: 100, cursor: first.pagination.nextCursor }, "room-a", secret, 1001);
  expect(next.items[0].key).toBe("0100");
  expect(next.items).not.toContainEqual({ key: "new", uploaded: 2000 });
});
test("rejects cursor tampering, expiry, cross-room replay and invalid page sizes", () => {
  const cursor = paginate(files, { limit: 1 }, "room-a", secret, 1000).pagination.nextCursor;
  expect(() => paginate(files, { cursor }, "room-b", secret, 1001)).toThrow(/cursor/);
  expect(() => paginate(files, { cursor: `${cursor}x` }, "room-a", secret, 1001)).toThrow(/cursor/);
  expect(() => paginate(files, { cursor }, "room-a", secret, 2000000)).toThrow(/cursor/);
  expect(() => paginate(files, { limit: 501 }, "room-a", secret)).toThrow(/limit/);
});
test("legacy small responses preserve ordering and page-free shape", () => {
  expect(paginate(files, {}, "room", secret)).toEqual({ items: files, pagination: null });
});
