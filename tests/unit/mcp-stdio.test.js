"use strict";

const { spawn } = require("child_process");
const readline = require("readline");
const path = require("path");

test("real stdio server initializes and lists tools for existing clients", async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "../../scripts/mcp-server.js")], {
    env: { ...process.env, MCP_TRANSPORT: "stdio", HOBBYFILES_API_KEY: "test-unused-key" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on("line", line => {
    const data = JSON.parse(line);
    if (data.id != null && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  });
  const call = (id, method, params) => new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  try {
    const init = await call(1, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" },
    });
    expect(init.result.serverInfo.name).toBe("hobbyfiles");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listing = await call(2, "tools/list", {});
    expect(listing.result.tools).toHaveLength(57);
    expect(listing.result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "queue_room_plugin_job" }), expect.objectContaining({ name: "inspect_room_plugin_operations" })]));
  }
  finally {
    lines.close();
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    await exited;
  }
});
