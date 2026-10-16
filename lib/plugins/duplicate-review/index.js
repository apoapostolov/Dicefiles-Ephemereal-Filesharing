"use strict";

const { defineWorkflow, filesFor, similarity, reviewKey, dismissedReviews, dismissReview } = require("../workflows");

module.exports = defineWorkflow({ id: "duplicate-review", name: "Duplicate Review", description: "Review exact hashes and likely title duplicates. Never deletes files.", async scan(ctx) {
  const files = await filesFor(ctx); const hashes = new Map(); const items = []; const dismissed = await dismissedReviews(ctx);
  for (const file of files) {
    if (!file.hash) {
      continue;
    }
    const group = hashes.get(file.hash) || []; group.push(file); hashes.set(file.hash, group);
  }
  for (const group of hashes.values()) {
    if (group.length > 1) {
      const key = reviewKey(group.map(file => [file.key, file.name, file.hash]).sort());
      if (!dismissed.has(key)) {
        items.push({ title: `${group.length} exact copies`, detail: group.map(file => file.name).join(" · "), href: group[0].href, status: "warning", data: { reviewKey: key }, actions: [{ id: "dismiss", label: "Reviewed" }] });
      }
    }
  }
  for (let i = 0; i < files.length && items.length < 40; i++) {
    const candidate = files.slice(i + 1).find(other => other.hash !== files[i].hash && similarity(other.name, files[i].name) >= 0.85);
    if (candidate) {
      const key = reviewKey([files[i], candidate].map(file => [file.key, file.name, file.hash]).sort());
      if (!dismissed.has(key)) {
        items.push({ title: files[i].name, detail: `Similar title: ${candidate.name}. Contents differ; compare editions before acting.`, href: files[i].href, data: { reviewKey: key }, actions: [{ id: "dismiss", label: "Reviewed" }] });
      }
    }
  }
  return { checked: files.length, flagged: items.length, report: { title: "Duplicate review", summary: `${items.length} candidate groups. Deletion remains a separate moderator action.`, items } };
}, actions: { dismiss: dismissReview } });
