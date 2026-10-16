"use strict";

import { dom } from "./util";
import { availabilityView } from "../common/torrent-presentation";

export function torrentAvailability(torrent, onopen) {
  const view = availabilityView(torrent);
  const pill = dom("button", { classes: ["tag", "torrent-availability", `is-${view.state}`], attrs: {
    "type": "button", "aria-label": `${view.label}. Open torrent details`, "title": `${view.label}. ${view.explanation}`,
  } });
  const metric = (kind, value) => {
    const group = dom("span", { classes: ["torrent-metric"] });
    group.append(dom("span", { classes: ["torrent-metric-icon", `is-${kind}`], attrs: { "aria-hidden": "true" } }), dom("span", { classes: ["torrent-metric-value"], text: value })); return group;
  };
  pill.append(metric("seeders", view.seeders), metric("peers", view.peers));
  if (view.state === "stale") {
    pill.appendChild(dom("span", { classes: ["torrent-report-age"], text: "◷", attrs: { "aria-hidden": "true" } }));
  }
  pill.onclick = event => {
    event.preventDefault(); event.stopPropagation(); onopen();
  };
  return pill;
}
