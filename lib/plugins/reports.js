"use strict";

const { randomUUID } = require("node:crypto");
const { safeErrorMessage } = require("./metadata");

function publicReport(record) {
  if (!record) {
    return null;
  }
  return { ...record, items: record.items.map(({ data, ...item }) => item) };
}

function createPluginReport(state, config) {
  const clean = (value, length) => safeErrorMessage(String(value || ""), config).slice(0, length);
  return {
    async write(input) {
      const record = { id: randomUUID(), createdAt: Date.now(), title: clean(input?.title || "Bot report", 100), summary: clean(input?.summary, 500), items: [], truncated: false };
      for (const [index, item] of (Array.isArray(input?.items) ? input.items : []).entries()) {
        const row = { id: /^[a-zA-Z0-9_-]{1,80}$/.test(item.id || "") ? item.id : String(index), title: clean(item.title, 180), detail: clean(item.detail, 300), status: ["info", "success", "warning", "error"].includes(item.status) ? item.status : "info" };
        if (/^\/(?:g|q|r)\/[a-zA-Z0-9_-]+(?:\/[^?#]*)?$/.test(item.href || "")) {
          row.href = item.href;
        }
        if (item.data && typeof item.data === "object" && Buffer.byteLength(JSON.stringify(item.data)) <= 1024) {
          row.data = structuredClone(item.data);
        }
        if (Array.isArray(item.actions)) {
          row.actions = item.actions.filter(action => /^[a-z][a-z0-9-]{0,31}$/.test(action.id || "")).slice(0, 3).map(action => ({ id: action.id, label: clean(action.label, 50) }));
        }
        record.items.push(row);
        if (record.items.length > 40 || Buffer.byteLength(JSON.stringify(record)) > 14000) {
          record.items.pop(); record.truncated = true; break;
        }
      }
      await state.set("report:last", record, { ttlSeconds: 30 * 86400 });
      return publicReport(record);
    },
    async read() {
      return (await state.get("report:last"))?.value || null;
    },
  };
}

module.exports = { createPluginReport, publicReport };
