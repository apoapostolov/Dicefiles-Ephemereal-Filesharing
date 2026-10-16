"use strict";

const { defineWorkflow } = require("../workflows");

module.exports = defineWorkflow({ id: "access-review", name: "Access Review", category: "Maintenance", description: "Review stale invites, inactive bots and broad connection grants without revealing credentials.", async scan(ctx) {
  const summary = await ctx.dicefiles.getAccessSummary();
  const items = [{ title: "Guest invitations", detail: `${summary.activeInvites} active · ${summary.expiredInvites} expired/exhausted · ${summary.unusedInvites} unused for over 30 days. Review Invites before revoking anything.`, status: summary.unusedInvites ? "warning" : "info" },
    { title: "Room bots", detail: `${summary.enabledBots} enabled · ${summary.disabledBots} disabled. Remove unused invitations after reviewing their history.` }];
  for (const connection of summary.connections) {
    items.push({ title: connection.id, detail: `${connection.provider} · ${connection.configured ? "credentials present" : "credentials missing"}${connection.allRooms ? " · grants every room; consider narrowing it" : ""}${connection.usedByInvitedBots === false ? " · no invited bot uses this connection" : ""}`, status: !connection.configured || connection.allRooms || connection.usedByInvitedBots === false ? "warning" : "info" });
  }
  return { checked: items.length, flagged: items.filter(item => item.status === "warning").length, report: { title: "Room access review", summary: "Review recommendations only. Credentials, invite tokens and personal identities are excluded; no access is revoked automatically.", items } };
} });
