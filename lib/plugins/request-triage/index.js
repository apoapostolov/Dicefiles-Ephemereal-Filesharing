"use strict";

const { defineWorkflow, filesFor, similarity } = require("../workflows");

module.exports = defineWorkflow({ id: "request-triage", name: "Request Triage", description: "Suggest existing files for open requests; fulfillment always requires moderator review.", events: ["request_created", "file_uploaded"],
  async scan(ctx) {
    const files = await filesFor(ctx); const requests = await ctx.dicefiles.listRequests({ status: "open", limit: 100 }); const items = [];
    for (const request of requests) {
      const matches = files.filter(file => !file.tags?.hidden).map(file => ({ file, score: similarity(request.name, `${file.name} ${file.tags?.title || ""}`) })).filter(row => row.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 3);
      for (const { file, score } of matches) {
        items.push({ title: request.name, detail: `${file.name} · ${Math.round(score * 100)}% title overlap`, href: file.href, data: { key: request.key, expectedRevision: request.revision, fileKey: file.key }, actions: [{ id: "fulfill", label: "Fulfill with this file" }] });
      }
    }
    return { checked: requests.length, flagged: items.length, report: { title: "Request suggestions", summary: `${items.length} possible matches. Review the file before marking a request fulfilled.`, items } };
  }, actions: { fulfill: (ctx, data) => ctx.dicefiles.fulfillRequest(data).then(() => ({ detail: "Request fulfilled with the reviewed file." })) },
});
