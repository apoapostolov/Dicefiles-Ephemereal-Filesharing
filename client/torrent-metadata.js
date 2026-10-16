"use strict";

import Modal from "./modal";
import registry from "./registry";
import { dom, toPrettySize } from "./util";
import { fileKind, presentTorrent, availabilityView, featuredMovie } from "../common/torrent-presentation";
import { userError } from "../common/user-error";
import { openMoviePlayer, showMovieInfo } from "./movie";
import { mediaFileTitle } from "../common/torrent-media";

export class TorrentMetadataModal extends Modal {
  constructor(torrent, name, downloadUrl, reference) {
    super("torrent", "Torrent", { text: "Close", cancel: true });
    this.torrent = torrent; this.name = name; this.downloadUrl = downloadUrl; this.reference = reference;
    this.closed = false; this.loading = false;
    this.cinema = null;
    this.cinemaSignature = JSON.stringify(this.cinemaRecords());
    this.onData = () => {
      this.cinema = null;
      const signature = JSON.stringify(this.cinemaRecords());
      if (!this.closed && signature !== this.cinemaSignature) {
        this.cinemaSignature = signature; this.render();
      }
    };
    this.render();
  }

  onshown() {
    super.onshown();
    registry.files?.on?.("files-changed", this.onData); registry.links?.on?.("links-changed", this.onData);
    if (this.reference) {
      this.refresh(false);
    }
  }

  onhidden() {
    this.closed = true;
    registry.files?.removeListener?.("files-changed", this.onData); registry.links?.removeListener?.("links-changed", this.onData);
  }

  cinemaRecords() {
    const item = this.reference?.kind === "file" ? registry.files?.filemap?.get(this.reference.key) : registry.links?.linkmap?.get(this.reference?.key);
    return this.cinema || item?.meta?.cinema || {};
  }

  async refresh(force) {
    if (this.loading || !this.reference) {
      return;
    }
    this.loading = true; this.refreshButton.disabled = true;
    this.feedback.textContent = "Checking contents and availability…";
    try {
      const result = await registry.socket.makeCall("torrentdetails", `td${Date.now().toString(36)}`, this.reference, force);
      if (this.closed) {
        return;
      }
      Object.assign(this.torrent, result.torrent); this.render();
    }
    catch (error) {
      if (!this.closed) {
        this.feedback.textContent = userError(error);
      }
    }
    finally {
      this.loading = false;
      if (!this.closed) {
        this.refreshButton.disabled = false;
      }
    }
  }

  render() {
    const focused = document.activeElement;
    const focusSearch = focused === this.search;
    const focusRefresh = focused === this.refreshButton;
    this.body.replaceChildren();
    const {torrent} = this; const view = presentTorrent(torrent, this.name);
    const featured = featuredMovie(torrent, this.cinemaRecords());
    const movie = featured?.movie;
    const media = featured?.presentation;
    const hero = dom("section", { classes: ["torrent-hero", ...(movie ? ["torrent-cinema-hero"] : [])] });
    if (movie?.backdrop) {
      hero.appendChild(dom("img", { classes: ["torrent-backdrop"], attrs: { src: movie.backdrop, alt: "", referrerpolicy: "no-referrer" } }));
    }
    const artwork = dom("div", { classes: ["torrent-artwork"], attrs: { "aria-hidden": "true" } });
    if (movie?.poster) {
      artwork.appendChild(dom("img", { attrs: { src: movie.poster, alt: "", referrerpolicy: "no-referrer" } }));
    }
    else if (torrent.imageDataUrl?.startsWith("data:image/jpeg;base64,")) {
      artwork.appendChild(dom("img", { attrs: { src: torrent.imageDataUrl, alt: "" } }));
    }
    else {
      artwork.appendChild(dom("span", { classes: [`i-${view.categories[0]?.icon || "link"}`] }));
    }
    const intro = dom("div", { classes: ["torrent-intro"] });
    if (movie?.logo) {
      intro.appendChild(dom("img", { classes: ["torrent-movie-logo"], attrs: { src: movie.logo, alt: "", referrerpolicy: "no-referrer" } }));
    }
    intro.appendChild(dom("p", { classes: ["torrent-eyebrow"], text: `${media?.type === "series-pack" ? "TV series pack" : media?.type === "season-pack" ? "TV season pack" : movie ? movie.kind === "episode" ? "TV episode" : movie.kind === "tv" ? "TV series" : "Movie" : view.category}${torrent.private ? " · Private torrent" : ""}` }));
    intro.appendChild(dom("h2", { text: media?.title || mediaFileTitle(movie, view.name) }));
    if (media?.summary) {
      intro.appendChild(dom("p", { classes: ["torrent-subtitle"], text: media.summary }));
    }
    if (movie) {
      const facts = [movie.runtime ? `${movie.runtime} min` : "", ...(movie.genres || []).slice(0, 3)].filter(Boolean);
      if (facts.length) {
        intro.appendChild(dom("p", { classes: ["torrent-subtitle"], text: facts.join(" · ") }));
      }
      if (movie.overview) {
        intro.appendChild(dom("p", { classes: ["torrent-movie-overview"], text: movie.overview }));
      }
      intro.appendChild(dom("p", { classes: ["torrent-match-source"], text: featured.count > 1 ? `${featured.count} matched videos · Featured: ${featured.file.path.split("/").pop()}` : `Matched video · ${featured.file.path.split("/").pop()}` }));
    }
    else {
      intro.appendChild(dom("p", { classes: ["torrent-subtitle"], text: view.known ? "Browse the contents. Play a video here, or open the torrent in your app." : "A file list is not available yet. Check again or open the link in your torrent app." }));
    }
    const actions = dom("div", { classes: ["torrent-actions"] });
    if (torrent.magnet?.startsWith("magnet:?")) {
      actions.appendChild(dom("a", { classes: ["torrent-action", "torrent-action-primary"], text: "Open magnet", attrs: { href: torrent.magnet, rel: "noreferrer" } }));
      const copy = dom("button", { classes: ["torrent-action"], text: "Copy link", attrs: { type: "button" } });
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(torrent.magnet); this.feedback.textContent = "Magnet link copied.";
        }
        catch (_) {
          this.feedback.textContent = "Copy is unavailable. Use your browser's copy-link action on Open magnet.";
        }
      };
      actions.appendChild(copy);
    }
    if (this.downloadUrl) {
      actions.appendChild(dom("a", { classes: ["torrent-action"], text: /\.torrent$/i.test(this.name) ? "Download .torrent" : "Save link", attrs: { href: this.downloadUrl, download: this.name } }));
    }
    intro.appendChild(actions); hero.append(artwork, intro); this.body.appendChild(hero);
    if (movie?.attribution) {
      this.body.appendChild(dom("p", { classes: ["movie-attribution"], text: movie.attribution }));
    }
    const metrics = dom("dl", { classes: ["torrent-metrics"] });
    const stats = torrent.availability || {};
    for (const [label, value] of [["Total size", view.size === null ? "—" : toPrettySize(view.size)], ["Files", view.known ? view.files.length.toLocaleString() : "—"], ["Seeders", stats.seeders == null ? "—" : stats.seeders.toLocaleString()], ["Downloading", stats.leechers == null ? "—" : stats.leechers.toLocaleString()]]) {
      const group = dom("div"); group.append(dom("dt", { text: label }), dom("dd", { text: String(value) })); metrics.appendChild(group);
    }
    this.body.appendChild(metrics);
    const update = dom("div", { classes: ["torrent-update"] });
    const checked = stats.checkedAt;
    const availabilityText = availabilityView(torrent).explanation;
    update.appendChild(dom("p", { text: `${availabilityText}${checked ? ` Last check ${new Date(checked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ""}` }));
    this.refreshButton = dom("button", { classes: ["torrent-action"], attrs: { type: "button" }, text: "Check again" });
    this.refreshButton.hidden = !this.reference;
    this.refreshButton.onclick = () => this.refresh(true); update.appendChild(this.refreshButton); this.body.appendChild(update);
    this.feedback = dom("p", { classes: ["torrent-feedback"], attrs: { "role": "status", "aria-live": "polite" } });
    if (torrent.discovery?.state === "disabled") {
      this.feedback.textContent = "Online lookup is disabled on this server. Upload a matching .torrent file to add its contents.";
    }
    else if (torrent.discovery?.state === "busy") {
      this.feedback.textContent = "Other torrents are being checked. Try again shortly.";
    }
    else if (!view.known && torrent.discovery?.state === "unavailable") {
      this.feedback.textContent = torrent.discovery.reason === "metadata-unavailable" ? "Peer addresses were found, but none shared a verified file list during this check. Some peers may be unreachable or not sharing metadata. Try again, or upload the matching .torrent file." : "No peers could be found for the file list during this check. Try again later, or upload the matching .torrent file. Seeder counts alone do not guarantee reachable peers.";
    }
    this.body.appendChild(this.feedback);
    this.contents(view);
    if (torrent.comment) {
      this.section("About this torrent").appendChild(dom("p", { classes: ["torrent-description"], text: torrent.comment }));
    }
    if (torrent.publisher || torrent.creationDate) {
      const facts = [];
      if (torrent.publisher) {
        facts.push(`Publisher: ${torrent.publisher}`);
      }
      if (torrent.creationDate && Number.isFinite(new Date(torrent.creationDate * 1000).getTime())) {
        facts.push(`Created: ${new Date(torrent.creationDate * 1000).toLocaleDateString()}`);
      }
      this.section("Source information").appendChild(dom("p", { classes: ["torrent-description"], text: facts.join(" · ") }));
    }
    this.trackers(torrent);
    if (focusSearch && this.search) {
      this.search.focus({ preventScroll: true });
    }
    else if (focusRefresh) {
      this.refreshButton.focus({ preventScroll: true });
    }
  }

  section(title) {
    const section = dom("section", { classes: ["torrent-section"] });
    section.appendChild(dom("h3", { text: title })); this.body.appendChild(section); return section;
  }

  contents(view) {
    const section = dom("section", { classes: ["torrent-section", "torrent-contents"] }); this.body.appendChild(section);
    const header = dom("div", { classes: ["torrent-contents-header"] });
    header.appendChild(dom("h3", { text: view.known ? `Contents · ${view.files.length.toLocaleString()} ${view.files.length === 1 ? "file" : "files"}` : "Contents" })); section.appendChild(header);
    if (!view.known) {
      section.appendChild(dom("p", { classes: ["torrent-empty"], text: "Waiting for a file list from peers. Upload the matching .torrent file to provide its contents directly." })); return;
    }
    const summary = view.categories.map(row => `${row.label} · ${row.count} ${row.count === 1 ? "file" : "files"} · ${toPrettySize(row.size)}`).join("  /  ");
    header.appendChild(dom("span", { classes: ["torrent-content-types"], text: summary, attrs: { title: summary } }));
    const search = dom("input", { classes: ["torrent-file-search"], attrs: { "type": "search", "placeholder": "Find a file…", "aria-label": "Find a file in this torrent" } });
    this.search = search;
    search.value = this.query || "";
    header.appendChild(search);
    const list = dom("ul", { classes: ["torrent-file-list"], attrs: { "aria-label": "Torrent contents" } });
    const status = dom("p", { classes: ["torrent-file-count"], attrs: { role: "status" } });
    const more = dom("button", { classes: ["torrent-action"], text: "Show more files", attrs: { type: "button" } });
    let limit = this.limit || 50;
    const draw = () => {
      const query = search.value.trim().toLocaleLowerCase();
      const matches = view.files.filter((file, index) => `${file.path} ${mediaFileTitle(this.cinemaRecords()[index]?.movie, "")}`.toLocaleLowerCase().includes(query));
      list.replaceChildren();
      for (const file of matches.slice(0, limit)) {
        const row = dom("li", { classes: ["torrent-file-row"] });
        row.appendChild(dom("span", { classes: [`i-${fileKind(file.path).icon}`], attrs: { "aria-hidden": "true" } }));
        const description = dom("span", { classes: ["torrent-file-path"] });
        const parts = file.path.split("/"); const filename = parts.pop();
        const index = view.files.indexOf(file);
        const cinema = this.cinemaRecords()[index];
        const displayName = mediaFileTitle(cinema?.movie, filename);
        description.appendChild(dom("strong", { text: displayName, attrs: { title: filename } }));
        if (parts.length) {
          description.appendChild(dom("small", { text: parts.join(" / ") }));
        }
        const controls = dom("span", { classes: ["torrent-file-controls"] });
        row.append(description, controls, dom("span", { classes: ["torrent-file-size"], text: toPrettySize(file.size) }));
        if (this.reference && fileKind(file.path).icon === "video") {
          const reference = { ...this.reference, index };
          const mediaFile = { name: filename, meta: { torrent: this.torrent, cinema: this.cinemaRecords() }, key: reference.key };
          const watch = dom("button", { classes: ["movie-action"], text: "▶", attrs: { "type": "button", "aria-label": `Watch ${filename}`, "title": "Watch video" } });
          watch.onclick = () => openMoviePlayer(mediaFile, reference).catch(() => {});
          const info = dom("button", { classes: ["movie-action"], text: "ⓘ", attrs: { "type": "button", "aria-label": `Video information for ${filename}`, "title": "Video information and subtitles" } });
          info.onclick = async () => {
            await showMovieInfo(mediaFile, reference);
            if (!this.closed) {
              this.cinema = mediaFile.meta.cinema; this.render();
            }
          }; controls.append(watch, info);
        }
        list.appendChild(row);
      }
      status.textContent = matches.length ? matches.length === 1 ? "1 file shown" : `${Math.min(limit, matches.length)} of ${matches.length} files shown` : "No files match your search.";
      more.hidden = matches.length <= limit;
    };
    search.oninput = () => {
      this.query = search.value; this.limit = limit = 50; draw();
    };
    more.onclick = () => {
      this.limit = limit += 50; draw();
    };
    section.append(list, status, more); draw();
  }

  trackers(torrent) {
    const section = this.section("Trackers");
    const known = new Map((torrent.trackerStatus || []).map(row => [`${row.protocol}:${row.host}`, row]));
    for (const raw of (torrent.trackers || []).slice(0, 32)) {
      try {
        const url = new URL(raw); const protocol = url.protocol.replace(":", "");
        if (!known.has(`${protocol}:${url.hostname}`)) {
          known.set(`${protocol}:${url.hostname}`, { host: url.hostname, protocol, state: "not-checked" });
        }
      }
      catch (_) { /* Invalid entries do not become browser links. */ }
    }
    if (!known.size) {
      section.appendChild(dom("p", { classes: ["torrent-empty"], text: "No trackers were included. Public magnets can still discover peers automatically." })); return;
    }
    const list = dom("ul", { classes: ["torrent-tracker-list"] });
    for (const tracker of known.values()) {
      const row = dom("li", { classes: ["torrent-tracker-row"] });
      row.appendChild(dom("span", { classes: ["torrent-tracker-dot", tracker.state === "responding" ? "is-online" : ""], attrs: { "aria-hidden": "true" } }));
      const source = dom("span", { classes: ["torrent-tracker-source"] }); source.append(dom("strong", { text: tracker.host, attrs: { title: tracker.host } }), dom("small", { text: tracker.protocol.toUpperCase() }));
      const status = tracker.state === "responding" ? `${tracker.seeders.toLocaleString()} seeders · ${tracker.leechers.toLocaleString()} downloading` : tracker.state === "not-checked" ? "Not checked" : "No report";
      row.append(source, dom("span", { classes: ["torrent-tracker-state"], text: status, attrs: { title: status } })); list.appendChild(row);
    }
    section.appendChild(list);
  }
}
