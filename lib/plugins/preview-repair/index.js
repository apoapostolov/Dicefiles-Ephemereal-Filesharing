"use strict";

const { defineWorkflow, filesFor } = require("../workflows");

module.exports = defineWorkflow({ id: "preview-repair", name: "Preview Repair", category: "Maintenance", description: "Inspect missing previews and submit reviewed retries to the existing bounded preview worker.", async scan(ctx) {
  const files = await filesFor(ctx); const items = [];
  for (const file of files) {
    const inspection = await ctx.dicefiles.inspectFile({ key: file.key });
    if (inspection.preview.state === "missing" || !inspection.exists) {
      items.push({ title: file.name, detail: inspection.exists ? "Preview missing. The worker retries using installed native tools; ask the operator to run yarn check:preview-tools if failures persist." : "Stored file is missing. Restore it from a verified backup before retrying previews.", href: file.href, status: "warning", data: { key: file.key, expectedRevision: file.revision }, actions: inspection.exists ? [{ id: "retry", label: "Queue preview retry" }] : [] });
    }
  }
  return { checked: files.length, flagged: items.length, report: { title: "Preview repair", summary: `${items.length} missing previews or files. Retries are reviewed and use the existing worker's concurrency and attempt limits.`, items } };
}, actions: { retry: (ctx, data) => ctx.dicefiles.retryFilePreview(data).then(result => ({ detail: result.detail })) } });
