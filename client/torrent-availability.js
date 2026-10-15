"use strict";

import { dom } from "./util";
import { availabilityView } from "../common/torrent-presentation";

export function torrentAvailability(torrent, onopen) {
  const view = availabilityView(torrent);
  const pill = dom("button", { classes: ["tag", "torrent-availability", `is-${view.state}`], attrs: {
    "type": "button", "aria-label": `${view.label}. Open torrent details`, "title": `${view.label}. ${view.explanation}`,
  } });
  const metric = (glyph, value) => {
    const group = dom("span"); group.append(dom("span", { text: glyph, attrs: { "aria-hidden": "true" } }), dom("span", { text: value })); return group;
  };
  pill.append(metric("↑", view.seeders), metric("↓", view.peers));
  if (view.state === "stale") {
    pill.appendChild(dom("span", { text: "◷", attrs: { "aria-hidden": "true" } }));
  }
  pill.onclick = event => {
    event.preventDefault(); event.stopPropagation(); onopen();
  };
  return pill;
}
