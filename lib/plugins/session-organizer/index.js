"use strict";

const { defineWorkflow, bulletin } = require("../workflows");

module.exports = defineWorkflow({ id: "session-organizer", name: "Session Organizer", description: "Room sessions, preparation packs and RSVP counts, with quiet reminders.", fields: {
  reminderMinutes: { type: "number", title: "Reminder lead (minutes)", default: 60, minimum: 5, maximum: 1440 },
  pollIntervalMinutes: { type: "number", title: "Scan interval", default: 15, minimum: 0, maximum: 10080 },
}, async scan(ctx, args) {
  const sessions = await ctx.dicefiles.listSessions(); const items = []; let delivered = 0;
  for (const session of sessions.filter(item => !item.cancelled && item.endsAt > Date.now())) {
    const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: session.timezone }).format(session.startsAt);
    items.push({ title: session.title, detail: `${when} ${session.timezone} · ${session.counts.going} going · ${session.counts.maybe} maybe`, href: session.links[0], status: session.startsAt <= Date.now() + ctx.config.reminderMinutes * 60000 ? "warning" : "info" });
    if (session.startsAt > Date.now() && session.startsAt <= Date.now() + ctx.config.reminderMinutes * 60000 && await bulletin(ctx, `session-${session.id}`, `${session.title} starts ${when} (${session.timezone}). ${session.links.join(" ")} Open Sessions to RSVP and see the preparation pack.`, args.dryRun)) {
      delivered++;
    }
  }
  return { checked: sessions.length, delivered, report: { title: "Room sessions", summary: "Plan sessions and respond through Sessions in the room menu. No external calendars are changed.", items } };
} });
