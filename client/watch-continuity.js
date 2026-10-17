"use strict";

import { dom } from "./util";
import { openMoviePlayer } from "./movie";
import { WATCH_PREFIX, mediaTitle, timeLabel, watchRecords, watchCompleted, episodeIdentity } from "../common/video";

export function renderWatchContinuity(container, files, links = []) {
  container.replaceChildren();
  let storage;
  try {
    storage = localStorage;
  }
  catch (_) {
    return false;
  }
  let count = 0;
  for (const progress of watchRecords(storage)) {
    if (progress.dismissed || progress.position < 1) {
      continue;
    }
    const [kind, key, rawIndex] = progress.key.split(":"); const index = Number(rawIndex);
    const file = (kind === "file" ? files : links).find(file => (file.key || file.id) === key && !file.expired);
    if (!file || !Number.isInteger(index)) {
      continue;
    }
    const episode = !!episodeIdentity(index >= 0 ? file.meta?.torrent?.files?.[index]?.path : file.name, file.meta?.cinema?.[index]?.movie, file.meta?.torrent?.name);
    if (watchCompleted(progress, episode)) {
      continue;
    }
    const title = mediaTitle(file.meta?.cinema?.[index]?.movie, index >= 0 ? file.meta?.torrent?.files?.[index]?.path || file.name : file.name);
    const card = dom("div", { classes: ["watch-resume-card"] });
    const resume = dom("button", { classes: ["watch-resume"], attrs: { type: "button", title: `Resume ${title} at ${timeLabel(progress.position)}` } });
    resume.append(dom("span", { classes: ["continuity-kicker"], text: "Continue watching" }), dom("span", { classes: ["watch-resume-name"], text: title }), dom("small", { text: `${timeLabel(progress.position)} / ${timeLabel(progress.duration)}` }));
    resume.onclick = () => openMoviePlayer(file, { kind, key, index }).catch(() => {});
    const dismiss = dom("button", { classes: ["watch-dismiss"], text: "×", attrs: { "type": "button", "aria-label": `Dismiss ${title} from Continue watching` } });
    dismiss.onclick = () => {
      try {
        storage.setItem(WATCH_PREFIX + progress.key, JSON.stringify({ ...progress, dismissed: true }));
      }
      catch (_) { /* Dismiss in this view even if browser storage is full. */ }
      card.remove(); dispatchEvent(new CustomEvent("dicefiles:watch-dismissed"));
    };
    card.append(resume, dismiss); container.appendChild(card);
    if (++count >= 3) {
      break;
    }
  }
  return count > 0;
}
