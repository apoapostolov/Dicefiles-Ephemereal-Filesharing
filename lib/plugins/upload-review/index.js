"use strict";

const { defineWorkflow, filesFor, reviewKey, dismissedReviews, dismissReview } = require("../workflows");

module.exports = defineWorkflow({ id: "upload-review", name: "Upload Review", description: "Review explicit file policies; optional quarantine is reversible and always reviewed.", events: ["file_uploaded"], fields: {
  maxFileBytes: { type: "number", title: "Maximum file size (bytes)", default: 1073741824, minimum: 1, maximum: 21474836480 },
  blockedExtensions: { type: "array", title: "Blocked extensions", description: "Literal extensions such as exe or scr; no defaults" },
  blockedTerms: { type: "array", title: "Blocked filename terms" },
  allowQuarantine: { type: "boolean", title: "Allow reviewed quarantine", description: "Owners can hide a flagged file and restore it from this report. Nothing is quarantined automatically." },
}, async scan(ctx) {
  const files = await filesFor(ctx); const items = []; const dismissed = await dismissedReviews(ctx);
  for (const file of files) {
    const quarantined = file.meta?.pluginQuarantine?.pluginId === ctx.pluginId;
    const key = reviewKey([file.key, file.revision, ctx.config.blockedExtensions, ctx.config.blockedTerms, ctx.config.maxFileBytes]);
    if (!quarantined && dismissed.has(key)) {
      continue;
    }
    const reasons = []; const name = file.name.toLocaleLowerCase();
    if (file.size > ctx.config.maxFileBytes) {
      reasons.push("Exceeds configured size limit");
    }
    if (ctx.config.blockedExtensions.some(extension => name.endsWith(`.${extension.replace(/^\./, "").toLocaleLowerCase()}`))) {
      reasons.push("Blocked extension");
    }
    if (ctx.config.blockedTerms.some(term => name.includes(term.toLocaleLowerCase()))) {
      reasons.push("Filename matches a configured rule");
    }
    if (quarantined || reasons.length) {
      items.push({ title: file.name, detail: quarantined ? "Quarantined by Upload Review" : reasons.join(" · "), href: file.href, status: "warning", data: { key: file.key, expectedRevision: file.revision, reviewKey: key }, actions: ctx.config.allowQuarantine ? [{ id: quarantined ? "release" : "quarantine", label: quarantined ? "Restore file" : "Quarantine" }] : [{ id: "dismiss", label: "Reviewed" }] });
    }
  }
  return { checked: files.length, flagged: items.length, report: { title: "Upload review", summary: `${items.length} files need review. Rules flag candidates; they do not establish that a file is unsafe.`, items } };
}, actions: {
  quarantine: async (ctx, data) => {
    const result = await ctx.dicefiles.quarantineFile(data); return { detail: "Hidden from members. Restore reverses this action.", data: { expectedRevision: result.revision }, actions: [{ id: "release", label: "Restore file" }] };
  },
  release: (ctx, data) => ctx.dicefiles.quarantineFile({ ...data, release: true }).then(() => ({ detail: "Upload Review quarantine released." })),
  dismiss: dismissReview,
} });
