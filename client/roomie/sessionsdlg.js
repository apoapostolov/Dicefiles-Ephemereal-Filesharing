"use strict";

import Modal from "../modal";
import registry from "../registry";
import { dom } from "../util";

export class SessionsModal extends Modal {
  constructor() {
    super("sessions", "Room sessions", { text: "Close", cancel: true });
    this.status = dom("p", { classes: ["roomopts-hint"], attrs: { role: "status" } });
    const refresh = dom("button", { text: "Refresh", attrs: { type: "button" } }); refresh.onclick = () => this.load();
    this.list = dom("section", { classes: ["sessions-list"], attrs: { "aria-label": "Upcoming sessions" } });
    this.plan = dom("details", { attrs: { hidden: "" } }); this.plan.appendChild(dom("summary", { text: "Plan a session" }));
    this.fields = {};
    for (const [key, label, type] of [["title", "Title", "text"], ["startsAt", "Starts (your local time)", "datetime-local"], ["timezone", "Display timezone", "text"], ["description", "Description", "textarea"], ["links", "Preparation links", "textarea"]]) {
      const field = dom(type === "textarea" ? "textarea" : "input", { attrs: { id: `session-${key}`, ...(type === "textarea" ? {} : { type }) } });
      if (["title", "startsAt", "timezone"].includes(key)) {
        field.required = true;
      }
      field.maxLength = key === "description" ? 1000 : key === "links" ? 2000 : 120;
      this.fields[key] = field; this.plan.append(dom("label", { text: label, attrs: { for: `session-${key}` } }), field);
    }
    this.fields.links.placeholder = "/g/file-key, /q/request-key";
    const create = dom("button", { text: "Create session", attrs: { type: "button" } });
    create.onclick = async () => {
      if (!Object.values(this.fields).every(field => field.reportValidity())) {
        return;
      }
      await this.load("create", { title: this.fields.title.value, description: this.fields.description.value, startsAt: new Date(this.fields.startsAt.value).getTime(), timezone: this.fields.timezone.value,
        links: this.fields.links.value.split(/[,\n]/).map(value => value.trim()).filter(Boolean) });
    };
    this.plan.appendChild(create); this.body.append(refresh, this.status, this.list, this.plan);
  }

  onshown() {
    super.onshown(); this.load();
  }

  async load(operation = "list", input) {
    this.status.textContent = "Loading…";
    try {
      const data = await registry.socket.makeCall("roomsessions", `ss${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, operation, input);
      this.status.textContent = data.unavailable ? "A room owner can invite Session Organizer in Room Options to enable sessions." : data.sessions.length ? "Times use each session's display timezone. Your RSVP is private; only totals are shown." : "No sessions planned yet.";
      this.plan.hidden = !data.editable; this.fields.timezone.value ||= data.timezone || "UTC";
      this.list.replaceChildren();
      for (const session of data.sessions) {
        const row = dom("article", { classes: ["session-item"] });
        row.append(dom("h3", { text: session.title }), dom("p", { text: `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: session.timezone }).format(session.startsAt)} · ${session.timezone}${session.cancelled ? " · Cancelled" : ""}` }));
        if (session.description) {
          row.appendChild(dom("p", { text: session.description }));
        }
        const pack = dom("div", { classes: ["session-pack"] });
        for (const [index, href] of session.links.entries()) {
          pack.appendChild(dom("a", { text: `Preparation ${index + 1}`, attrs: { href, target: "_blank", rel: "noopener" } }));
        }
        row.appendChild(pack); row.appendChild(dom("p", { text: `${session.counts.going} going · ${session.counts.maybe} maybe · ${session.counts.declined} declined` }));
        const actions = dom("div", { classes: ["session-actions"] });
        const select = dom("select", { attrs: { "aria-label": `Your RSVP for ${session.title}` } });
        for (const [value, label] of [["none", "Choose RSVP"], ["going", "Going"], ["maybe", "Maybe"], ["declined", "Declined"]]) {
          select.appendChild(dom("option", { text: label, attrs: { value } }));
        }
        select.value = session.rsvp; select.disabled = session.cancelled || session.endsAt <= Date.now();
        select.onchange = () => this.load("rsvp", { id: session.id, value: select.value }); actions.appendChild(select);
        if (data.editable) {
          const cancel = dom("button", { text: session.cancelled ? "Restore session" : "Cancel session", attrs: { type: "button" } });
          cancel.onclick = () => this.load("cancel", { id: session.id, revision: session.revision, cancelled: !session.cancelled }); actions.appendChild(cancel);
        }
        row.appendChild(actions); this.list.appendChild(row);
      }
      if (operation === "create") {
        this.fields.title.value = ""; this.fields.description.value = ""; this.fields.links.value = ""; this.plan.open = false;
      }
    }
    catch (error) {
      this.status.textContent = error.message || "Sessions could not load. Refresh and try again.";
    }
  }
}
