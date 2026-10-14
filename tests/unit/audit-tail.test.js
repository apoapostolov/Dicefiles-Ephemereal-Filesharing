"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { readAuditTail } = require("../../lib/audit-tail");

test("bounded tails skip partial and malformed records and filter by time", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dice-tail-"));
  const file = path.join(directory, "audit.jsonl");
  try {
    await fs.writeFile(file, `${"x".repeat(2000)}\n{"at":"2026-01-01","id":1}\ninvalid\n{"at":"2026-01-02","id":2}\n`);
    expect(await readAuditTail(file, { maxBytes: 150, limit: 1 })).toEqual([{ at: "2026-01-02", id: 2 }]);
    expect(await readAuditTail(file, { maxBytes: 150, since: Date.parse("2026-01-01") })).toEqual([{ at: "2026-01-02", id: 2 }]);
    expect(await readAuditTail(`${file}.missing`)).toEqual([]);
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
