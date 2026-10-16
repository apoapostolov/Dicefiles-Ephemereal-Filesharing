"use strict";

import Modal from "./modal";
import registry from "./registry";
import { dom } from "./util";
import { filenameQuery, mediaTitle, watchKey } from "../common/video";
import { subtitleLanguages } from "../common/subtitle-languages";

export const movieReference = (file, index = -1, kind = "file") => ({ kind, key: file.key || file.id, index });
export const movieCall = (reference, operation, input) => registry.socket.makeCall("media", `mv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, reference, operation, input);
export const moviePath = reference => `/api/v1/media/${reference.kind}/${encodeURIComponent(reference.key)}/${reference.index}`;

function button(label, action, cls = "") {
  const el = dom("button", { text: label, classes: ["movie-action", ...cls.split(/\s+/)].filter(Boolean), attrs: { type: "button" } });
  el.onclick = action; return el;
}

export function movieHero(movie, fallback, compact = false, watchButton, displayTitle) {
  const hero = dom("section", { classes: ["movie-hero", ...(compact ? ["movie-compact"] : []), ...(watchButton ? ["has-watch-action"] : []), ...(!movie?.poster ? ["movie-no-poster"] : [])] });
  if (movie?.backdrop) {
    hero.appendChild(dom("img", { classes: ["movie-backdrop"], attrs: { src: movie.backdrop, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }));
  }
  const content = dom("div", { classes: ["movie-hero-content"] });
  if (movie?.poster) {
    content.appendChild(dom("img", { classes: ["movie-poster"], attrs: { src: movie.poster, alt: `${movie.title} poster`, loading: "lazy", referrerpolicy: "no-referrer" } }));
  }
  const intro = dom("div", { classes: ["movie-intro"] });
  if (movie?.logo) {
    intro.appendChild(dom("img", { classes: ["movie-logo"], attrs: { src: movie.logo, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }));
  }
  intro.appendChild(dom("p", { classes: ["movie-eyebrow"], text: movie ? movie.kind === "episode" ? "Episode" : movie.kind === "tv" ? "Series" : "Movie" : "Your video" }));
  intro.appendChild(dom("h2", { text: displayTitle || mediaTitle(movie, fallback) }));
  const facts = [movie?.runtime ? `${movie.runtime} min` : null, movie?.rating ? `★ ${Number(movie.rating).toFixed(1)}` : null, ...(movie?.genres || []).slice(0, 3)].filter(Boolean);
  if (facts.length) {
    intro.appendChild(dom("p", { classes: ["movie-facts"], text: facts.join(" · ") }));
  }
  if (movie?.overview) {
    intro.appendChild(dom("p", { classes: ["movie-overview"], text: movie.overview }));
  }
  let links;
  if (movie || watchButton) {
    links = dom("div", { classes: ["movie-actions"] });
    for (const [label, href] of [["Watch trailer ↗", !watchButton && movie?.trailer], [watchButton ? "Title ↗" : "Title page ↗", movie?.url], ["IMDb ↗", movie?.imdb]]) {
      if (href) {
        links.appendChild(dom("a", { classes: ["movie-action"], text: label, attrs: { href, target: "_blank", rel: "noopener noreferrer" } }));
      }
    }
    if (watchButton) {
      links.appendChild(watchButton);
    }
    else {
      intro.appendChild(links);
    }
  }
  if (compact && movie?.cast?.length) {
    intro.appendChild(dom("p", { classes: ["movie-hint"], text: `Starring ${movie.cast.slice(0, 3).map(person => person.name).join(", ")}` }));
  }
  if (compact && movie?.screenshots?.length) {
    const scenes = dom("div", { classes: ["movie-hover-scenes"], attrs: { "aria-label": "Scenes" } });
    for (const src of movie.screenshots.slice(0, 2)) {
      scenes.appendChild(dom("img", { attrs: { src, alt: "Scene", loading: "lazy", referrerpolicy: "no-referrer" } }));
    }
    intro.appendChild(scenes);
  }
  content.appendChild(intro);
  if (watchButton) {
    content.appendChild(links);
  }
  hero.appendChild(content); return hero;
}

function movieMedia(movie) {
  if (!movie?.trailer && !movie?.screenshots?.length) {
    return null;
  }
  const section = dom("section", { classes: ["movie-media"] });
  section.appendChild(dom("h3", { text: movie.trailer ? movie.screenshots?.length ? "Trailer & scenes" : "Trailer" : "Scenes" }));
  const row = dom("div", { classes: ["movie-scenes"], attrs: { "aria-label": "Trailers and scenes" } });
  if (movie.trailer) {
    const trailer = dom("a", { classes: ["movie-trailer"], attrs: { "href": movie.trailer, "target": "_blank", "rel": "noopener noreferrer", "aria-label": "Watch trailer" } });
    const image = movie.backdrop || movie.screenshots?.[0];
    if (image) {
      trailer.appendChild(dom("img", { attrs: { src: image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }));
    }
    trailer.append(dom("span", { classes: ["movie-trailer-play"], text: "▶", attrs: { "aria-hidden": "true" } }), dom("span", { classes: ["movie-trailer-label"], text: "Trailer ↗" }));
    row.appendChild(trailer);
  }
  for (const image of movie.screenshots || []) {
    const scene = dom("a", { attrs: { "href": image, "target": "_blank", "rel": "noopener noreferrer", "aria-label": "Open scene image" } });
    scene.appendChild(dom("img", { attrs: { src: image, alt: "Scene", loading: "lazy", referrerpolicy: "no-referrer" } }));
    row.appendChild(scene);
  }
  section.appendChild(row); return section;
}

export class MovieModal extends Modal {
  constructor(file, reference = movieReference(file)) {
    super("movie", "Video Information", { text: "Close", cancel: true });
    this.file = file; this.reference = reference; this.closed = false; this.busy = false;
    this.feedback = dom("p", { classes: ["movie-feedback"], attrs: { "role": "status", "aria-live": "polite" }, text: "Loading video details…" });
    this.body.appendChild(this.feedback);
  }

  async onshown() {
    super.onshown();
    await this.run(async () => {
      this.data = await movieCall(this.reference, "get"); this.render();
    });
  }

  onhidden() {
    this.closed = true;
  }

  async run(action) {
    if (this.busy || this.closed) {
      return;
    }
    this.busy = true; this.el.setAttribute("aria-busy", "true");
    try {
      await action();
    }
    catch (error) {
      if (!this.closed) {
        this.feedback.textContent = error.message || String(error);
      }
    }
    finally {
      this.busy = false; this.el.removeAttribute("aria-busy");
    }
  }

  render() {
    if (this.closed) {
      return;
    }
    this.body.replaceChildren();
    const {movie} = this.data;
    const watch = button("▶ Watch", async () => {
      try {
        await openMoviePlayer(this.file, this.reference, this.data);
      }
      catch (_) { /* Closing the player is expected. */ }
    }, "movie-primary movie-watch-action");
    watch.disabled = this.reference.index >= 0 && !this.data.torrentPlayback;
    this.body.appendChild(movieHero(movie, this.data.name || this.file.name, false, watch));
    if (this.data.autoMatch?.state === "matched") {
      this.body.appendChild(dom("p", { classes: ["movie-hint"], text: "Matched automatically with high confidence. You can review or change this match below." }));
    }
    else if (this.reference.index >= 0 && !movie && this.data.autoMatchEnabled) {
      const reason = this.data.autoMatch?.reason;
      const message = reason === "library-full" ? "The video library is full. Ask the site operator to remove expired entries." : this.data.autoMatch?.state === "retry" ? "Automatic lookup will retry later. You can search or paste a provider URL now." : this.data.autoMatch ? "No confident automatic match was found. Search below or paste a provider URL to choose the correct title." : "Automatic matching is queued. You can also search or paste a provider URL below.";
      this.body.appendChild(dom("p", { classes: ["movie-hint"], text: message }));
    }
    const media = movieMedia(movie);
    if (media) {
      this.body.appendChild(media);
    }
    if (movie?.cast?.length) {
      this.body.appendChild(dom("h3", { text: "Cast" }));
      const cast = dom("div", { classes: ["movie-cast"] });
      for (const person of movie.cast) {
        const card = dom("div", { classes: ["movie-person"] });
        if (person.image) {
          card.appendChild(dom("img", { attrs: { src: person.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }));
        }
        card.append(dom("strong", { text: person.name }), dom("span", { text: person.role })); cast.appendChild(card);
      }
      this.body.appendChild(cast);
    }
    if (movie?.attribution) {
      this.body.appendChild(dom("p", { classes: ["movie-attribution"], text: movie.attribution }));
    }
    this.feedback = dom("p", { classes: ["movie-feedback"], attrs: { "role": "status", "aria-live": "polite" } });
    this.body.appendChild(this.feedback);
    if (this.data.editable) {
      this.renderMatching();
    }
    else {
      this.body.appendChild(dom("p", { classes: ["movie-hint"], text: "The uploader or a room moderator can update the match and subtitles." }));
    }
    this.renderSubtitles();
  }

  renderMatching() {
    const details = dom("details", { classes: ["movie-matching"] }); details.open = !this.data.movie;
    details.appendChild(dom("summary", { text: this.data.movie ? "Change match" : "Find movie or episode" }));
    const parsed = filenameQuery(this.data.name || this.file.name);
    const label = dom("label", { text: "Title or provider URL" });
    const query = dom("input", { attrs: { "type": "text", "placeholder": "Movie title, IMDb, TVDB or Trakt URL", "maxlength": 2048, "aria-label": "Title or provider URL" } });
    query.value = parsed.query; label.appendChild(query); details.appendChild(label);
    const results = dom("div", { classes: ["movie-candidates"], attrs: { "aria-label": "Matching titles" } });
    const search = button("Find matches", () => this.run(async () => {
      results.replaceChildren(); this.feedback.textContent = "Finding titles…";
      let result;
      if (/^https?:/i.test(query.value.trim())) {
        const response = await movieCall(this.reference, "preview", query.value.trim());
        result = { candidates: [{ ...response.movie, selection: query.value.trim() }], warnings: [] };
      }
      else {
        result = await movieCall(this.reference, "search", query.value.trim());
      }
      if (this.closed) {
        return;
      }
      this.feedback.textContent = result.candidates.length ? `Choose the correct title. ${result.warnings?.join(" ") || ""}` : result.warnings?.join(" ") || "No matches. Try a shorter title or paste a provider page URL.";
      for (const candidate of result.candidates) {
        const card = button("", () => this.run(async () => {
          this.feedback.textContent = "Saving title details…";
          const saved = await movieCall(this.reference, "match", candidate.selection || candidate);
          Object.assign(this.data, saved); this.render();
          this.file.meta ||= {}; this.file.meta.cinema ||= {}; this.file.meta.cinema[this.reference.index] = saved;
          if (this.reference.index === -1 && this.file.nameTextEl) {
            this.file.nameTextEl.textContent = mediaTitle(saved.movie, this.file.name);
          }
        }), "movie-candidate");
        if (candidate.poster) {
          card.appendChild(dom("img", { attrs: { src: candidate.poster, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }));
        }
        const text = dom("span"); text.append(dom("strong", { text: mediaTitle(candidate, candidate.title) }), dom("small", { text: `${candidate.provider.toUpperCase()} · ${candidate.kind === "episode" ? `S${candidate.season} E${candidate.episode}` : candidate.kind === "tv" ? "Series" : "Movie"}` })); card.appendChild(text); results.appendChild(card);
      }
    }));
    query.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault(); search.click();
      }
    });
    details.append(search, results);
    if (this.data.movie) {
      details.appendChild(button("Remove match", () => this.run(async () => {
        const saved = await movieCall(this.reference, "unmatch");
        Object.assign(this.data, saved); this.render();
        this.file.meta ||= {}; this.file.meta.cinema ||= {}; this.file.meta.cinema[this.reference.index] = saved;
        if (this.reference.index === -1 && this.file.nameTextEl) {
          this.file.nameTextEl.textContent = this.file.name;
        }
      })));
    }
    this.body.appendChild(details);
  }

  renderSubtitles() {
    const section = dom("section", { classes: ["movie-subtitles"] }); section.appendChild(dom("h3", { text: "Subtitles" }));
    if (this.data.editable) {
      const form = dom("div", { classes: ["movie-subtitle-form"] });
      const languageLabel = dom("label", { text: "Language" });
      const language = dom("select", { attrs: { "aria-label": "Subtitle language" } });
      for (const option of subtitleLanguages) {
        language.appendChild(dom("option", { text: option.label, attrs: { value: option.language } }));
      }
      language.value = "en";
      languageLabel.appendChild(language);
      const fileLabel = dom("label", { classes: ["movie-subtitle-picker"], text: "SRT or VTT · up to 256 KiB" });
      const picker = dom("span", { classes: ["movie-action"], text: "Add file…" });
      const input = dom("input", { attrs: { "type": "file", "accept": ".srt,.vtt", "aria-label": "Subtitle file" } });
      fileLabel.append(picker, input);
      input.onchange = async () => {
        if (this.busy) {
          input.value = ""; return;
        }
        await this.run(async () => {
          const file = input.files?.[0];
          if (!file || file.size > 256 * 1024) {
            this.feedback.textContent = "Choose a UTF-8 SRT or VTT file smaller than 256 KiB."; return;
          }
          this.feedback.textContent = "Adding subtitles…";
          const text = await file.text(); const result = await movieCall(this.reference, "subtitle", { text, language: language.value, filename: file.name });
          Object.assign(this.data, result); this.render(); this.feedback.textContent = "Subtitles added. Choose the language in the player's subtitles menu.";
        });
        input.value = "";
      };
      form.append(languageLabel, fileLabel); section.appendChild(form);
    }
    const list = dom("ul", { classes: ["movie-subtitle-list"], attrs: { "aria-label": "Uploaded subtitles" } });
    for (const track of this.data.subtitles || []) {
      const row = dom("li", { classes: ["movie-subtitle-row"] });
      const pair = dom("span", { classes: ["movie-subtitle-pair"] });
      pair.append(dom("strong", { text: track.label }), dom("span", { text: track.filename || "Converted subtitles (VTT)" }));
      row.appendChild(pair);
      if (this.data.editable) {
        const remove = button("×", () => this.run(async () => {
          Object.assign(this.data, await movieCall(this.reference, "remove-subtitle", track.id)); this.render();
        }));
        remove.setAttribute("aria-label", `Remove ${track.label}${track.filename ? ` · ${track.filename}` : ""}`);
        row.appendChild(remove);
      }
      list.appendChild(row);
    }
    section.appendChild(list);
    if (!list.children.length) {
      section.appendChild(dom("p", { classes: ["movie-hint"], text: "No subtitles added." }));
    }
    this.body.appendChild(section);
  }
}

export async function openMoviePlayer(file, reference = movieReference(file), data) {
  const { MoviePlayer } = await import(/* webpackChunkName: "cinema-player" */ "./movie-player");
  return registry.roomie.showModal(new MoviePlayer(file, reference, data));
}

export function showMovieInfo(file, reference = movieReference(file)) {
  return registry.roomie.showModal(new MovieModal(file, reference)).catch(() => {});
}

export function movieRecord(file, index = -1) {
  return file.meta?.cinema?.[index];
}

export function mediaIdentity(file, reference) {
  return watchKey(reference, reference.index);
}
