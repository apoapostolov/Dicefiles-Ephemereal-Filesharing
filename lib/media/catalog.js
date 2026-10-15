"use strict";

const { guardedFetch } = require("../net-guard");
const { filenameQuery } = require("../../common/video");
const { LRUCache } = require("lru-cache");

const clean = (value, max = 2000) => String(value || "").replace(/<[^>]*>/g, "").slice(0, max);
const tmdbImage = (path, size = "w780") => /^\/[\w.-]+$/.test(path || "") ? `https://image.tmdb.org/t/p/${size}${path}` : null;
const safeImage = value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["artworks.thetvdb.com", "image.tmdb.org", "static.tvmaze.com"].includes(url.hostname) ? url.href : null;
  }
  catch (_) {
    return null;
  }
};

function parseMediaPage(value) {
  let url;
  try {
    url = new URL(value);
  }
  catch (_) {
    throw new Error("Enter an IMDb, TVDB or Trakt movie or episode page URL.");
  }
  const host = url.hostname.replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Use the original HTTPS movie or episode page URL.");
  }
  const path = url.pathname.replace(/\/$/, "");
  if (host === "imdb.com" && /^\/title\/tt\d{5,12}$/.test(path)) {
    return { provider: "imdb", id: path.split("/")[2] };
  }
  if (host === "trakt.tv") {
    const episode = path.match(/^\/shows\/([a-z0-9-]+)\/seasons\/(\d{1,2})\/episodes\/(\d{1,3})$/);
    if (episode) {
      return { provider: "trakt", id: episode[1], kind: "episode", season: +episode[2], episode: +episode[3] };
    }
    const movie = path.match(/^\/(movies|shows)\/([a-z0-9-]+)$/);
    if (movie) {
      return { provider: "trakt", id: movie[2], kind: movie[1] === "movies" ? "movie" : "tv" };
    }
  }
  if (["thetvdb.com", "tvdb.com"].includes(host)) {
    const episode = path.match(/^\/series\/[a-z0-9-]+\/episodes\/(\d+)$/);
    if (episode) {
      return { provider: "tvdb", id: episode[1], kind: "episode" };
    }
    const direct = path.match(/^\/dereferrer\/(movie|series|episode)\/(\d+)$/);
    if (direct) {
      return { provider: "tvdb", id: direct[2], kind: { series: "tv", movie: "movie", episode: "episode" }[direct[1]] };
    }
    const slug = path.match(/^\/(series|movies)\/([a-z0-9-]+)$/);
    if (slug) {
      return { provider: "tvdb", slug: slug[2], kind: slug[1] === "series" ? "tv" : "movie" };
    }
  }
  throw new Error("Use an IMDb title, TVDB movie or episode, or Trakt movie or episode page.");
}

class MediaCatalog {
  constructor(config, fetcher = guardedFetch) {
    this.config = config; this.fetcher = fetcher;
    this.cache = new LRUCache({ max: 128, maxSize: 8 * 1024 * 1024, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value)), ttl: 3600000 });
    this.tvdbAuth = null;
  }

  get providers() {
    return { tmdb: !!(this.config.get("tmdbToken") || this.config.get("tmdbApiKey")), tvdb: !!this.config.get("tvdbApiKey"), trakt: !!this.config.get("traktClientId") };
  }

  async request(provider, path, query = {}, init = {}) {
    const bases = { tmdb: "https://api.themoviedb.org/3/", trakt: "https://api.trakt.tv/", tvdb: "https://api4.thetvdb.com/v4/" };
    const headers = { Accept: "application/json", ...init.headers };
    if (provider === "tmdb") {
      if (!this.providers.tmdb) {
        throw new Error("Movie matching needs a TMDB credential. Ask the site operator to configure it in the environment file.");
      }
      if (this.config.get("tmdbToken")) {
        headers.Authorization = `Bearer ${this.config.get("tmdbToken")}`;
      }
      else {
        query.api_key = this.config.get("tmdbApiKey");
      }
    }
    if (provider === "trakt") {
      if (!this.providers.trakt) {
        throw new Error("Trakt lookup is unavailable. Ask the site operator to configure a Trakt client ID, or use an IMDb page.");
      }
      headers["trakt-api-key"] = this.config.get("traktClientId"); headers["trakt-api-version"] = "2";
    }
    if (provider === "tvdb" && path !== "login") {
      if (!this.providers.tvdb) {
        throw new Error("TVDB lookup needs a provider key. Use an IMDb page or ask the site operator to configure TVDB.");
      }
      if (!this.tvdbAuth || this.tvdbAuth.expires < Date.now()) {
        const auth = await this.request("tvdb", "login", {}, { method: "POST", body: JSON.stringify({ apikey: this.config.get("tvdbApiKey"), ...(this.config.get("tvdbPin") ? { pin: this.config.get("tvdbPin") } : {}) }), headers: { "Content-Type": "application/json" } });
        this.tvdbAuth = { token: auth.data?.token, expires: Date.now() + 20 * 3600000 };
        if (!this.tvdbAuth.token) {
          throw new Error("TVDB sign-in was not accepted. Ask the site operator to check the API key and subscriber PIN.");
        }
      }
      headers.Authorization = `Bearer ${this.tvdbAuth.token}`;
    }
    const url = new URL(path, bases[provider]);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await this.fetcher(url.href, { ...init, headers }, { timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, maxRedirects: 0 });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        this.tvdbAuth = null;
        throw new Error("The metadata provider did not accept its credentials. Ask the site operator to check the key and provider access.");
      }
      throw new Error(response.status === 404 ? "No matching title was found. Try another provider page or search by title." : "The metadata provider is unavailable. Wait a moment and try again.");
    }
    return response.json();
  }

  async search(name, query) {
    const parsed = filenameQuery(name); const term = clean(query || parsed.query, 150).trim();
    if (term.length < 2) {
      throw new Error("Enter at least two characters of the movie or series title.");
    }
    const key = `search:${term}:${parsed.season}:${parsed.episode}`;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const candidates = []; const warnings = [];
    const tasks = [];
    if (this.providers.tmdb) {
      tasks.push(this.request("tmdb", "search/multi", { query: term, include_adult: false }).then(data => {
        for (const item of (data.results || []).filter(item => ["movie", "tv"].includes(item.media_type)).slice(0, 10)) {
          candidates.push({ provider: "tmdb", id: String(item.id), kind: item.media_type === "tv" && parsed.episode !== null ? "episode" : item.media_type, season: parsed.season, episode: parsed.episode, title: clean(item.title || item.name, 200), year: (item.release_date || item.first_air_date || "").slice(0, 4), poster: tmdbImage(item.poster_path, "w342"), url: `https://www.themoviedb.org/${item.media_type}/${item.id}` });
        }
      }));
    }
    if (this.providers.tvdb) {
      tasks.push(this.request("tvdb", "search", { query: term, limit: 8 }).then(data => {
        for (const item of (data.data || []).filter(item => ["movie", "series"].includes(item.type)).slice(0, 8)) {
          candidates.push({ provider: "tvdb", id: String(item.tvdb_id), kind: item.type === "series" && parsed.episode !== null ? "episode" : item.type === "series" ? "tv" : "movie", season: parsed.season, episode: parsed.episode, seriesId: item.type === "series" ? String(item.tvdb_id) : undefined, title: clean(item.name, 200), year: clean(item.year, 4), poster: safeImage(item.image_url), url: `https://thetvdb.com/dereferrer/${item.type}/${item.tvdb_id}` });
        }
      }));
    }
    if (this.providers.trakt) {
      tasks.push(this.request("trakt", "search/movie,show", { query: term, limit: 8, extended: "full" }).then(data => {
        for (const result of data.slice(0, 8)) {
          const item = result.movie || result.show;
          if (item) {
            candidates.push({ provider: "trakt", id: String(item.ids.slug || item.ids.trakt), kind: result.movie ? "movie" : parsed.episode !== null ? "episode" : "tv", season: parsed.season, episode: parsed.episode, title: clean(item.title, 200), year: item.year, url: `https://trakt.tv/${result.movie ? "movies" : "shows"}/${item.ids.slug || item.ids.trakt}` });
          }
        }
      }));
    }
    if (!tasks.length) {
      throw new Error("Movie matching is not configured. Ask the site operator to add a TMDB, TVDB or Trakt credential.");
    }
    for (const result of await Promise.allSettled(tasks)) {
      if (result.status === "rejected") {
        warnings.push(result.reason.message);
      }
    }
    const result = { candidates, warnings, providers: this.providers, query: term };
    if (candidates.length) {
      this.cache.set(key, result, { ttl: 300000 });
    }
    return result;
  }

  async resolve(selection) {
    if (typeof selection === "string") {
      selection = parseMediaPage(selection);
    }
    if (!selection || !["tmdb", "imdb", "tvdb", "trakt"].includes(selection.provider) || !["movie", "tv", "episode", undefined].includes(selection.kind) || selection.id && !/^[a-z0-9-]{1,180}$/.test(selection.id) || selection.slug && !/^[a-z0-9-]{1,180}$/.test(selection.slug)) {
      throw new Error("Invalid title selection. Search again and choose a title from the results.");
    }
    for (const number of [selection.season, selection.episode]) {
      if (number != null && (!Number.isInteger(number) || number < 0 || number > 999)) {
        throw new Error("Invalid episode number. Search again or use the episode page.");
      }
    }
    const cacheKey = JSON.stringify(selection);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    let result;
    if (selection.provider === "imdb") {
      if (!/^tt\d{5,12}$/.test(selection.id || "")) {
        throw new Error("Invalid IMDb title. Copy the title page URL again.");
      }
      const data = await this.request("tmdb", `find/${selection.id}`, { external_source: "imdb_id" });
      const episode = data.tv_episode_results?.[0]; const movie = data.movie_results?.[0]; const series = data.tv_results?.[0];
      if (episode) {
        result = await this.tmdb({ id: String(episode.show_id), kind: "episode", season: episode.season_number, episode: episode.episode_number });
      }
      else if (movie || series) {
        result = await this.tmdb({ id: String((movie || series).id), kind: movie ? "movie" : "tv" });
      }
    }
    else if (selection.provider === "tmdb") {
      result = await this.tmdb(selection);
    }
    else if (selection.provider === "trakt") {
      const prefix = selection.kind === "movie" ? "movies" : "shows";
      const suffix = selection.kind === "episode" ? `/seasons/${selection.season}/episodes/${selection.episode}` : "";
      const item = await this.request("trakt", `${prefix}/${selection.id}${suffix}`, { extended: "full" });
      if (item.ids?.tmdb && this.providers.tmdb && selection.kind !== "episode") {
        result = await this.tmdb({ id: String(item.ids.tmdb), kind: selection.kind });
      }
      else if (selection.kind === "episode" && this.providers.tmdb) {
        const series = await this.request("trakt", `shows/${selection.id}`);
        if (series.ids?.tmdb) {
          result = await this.tmdb({ id: String(series.ids.tmdb), kind: "episode", season: selection.season, episode: selection.episode });
        }
      }
      result ||= { provider: "trakt", kind: selection.kind, id: String(item.ids?.trakt), title: clean(item.title, 200), year: item.year, season: item.season, episode: item.number, overview: clean(item.overview), runtime: item.runtime, rating: item.rating, genres: item.genres || [], cast: [], screenshots: [], url: `https://trakt.tv/${prefix}/${selection.id}${suffix}`, trailer: /^https:\/\/(?:www\.)?youtube.com\//.test(item.trailer || "") ? item.trailer : null };
    }
    else {
      result = await this.tvdb(selection);
    }
    if (!result?.title) {
      throw new Error("No matching title was found. Try searching by title or use another provider page.");
    }
    this.cache.set(cacheKey, result);
    return result;
  }

  async tmdb(selection) {
    if (!/^\d+$/.test(selection.id || "")) {
      throw new Error("Invalid movie database selection. Search again.");
    }
    const isEpisode = selection.kind === "episode";
    const base = selection.kind === "movie" ? "movie" : "tv";
    const series = await this.request("tmdb", `${base}/${selection.id}`, { append_to_response: "images,videos,credits,external_ids", include_image_language: "en,null" });
    const item = isEpisode ? await this.request("tmdb", `tv/${selection.id}/season/${selection.season}/episode/${selection.episode}`, { append_to_response: "images,videos,credits,external_ids" }) : series;
    const trailer = [...(item.videos?.results || []), ...(series.videos?.results || [])].find(video => video.site === "YouTube" && video.type === "Trailer" && /^[\w-]{6,20}$/.test(video.key));
    const cast = [...(item.credits?.cast || []), ...(item.credits?.guest_stars || []), ...(series.credits?.cast || [])];
    const seen = new Set();
    return { provider: "tmdb", id: String(item.id), kind: selection.kind, series: isEpisode ? clean(series.name, 200) : null, title: clean(item.title || item.name, 200), year: (item.release_date || item.air_date || item.first_air_date || "").slice(0, 4), season: isEpisode ? item.season_number : null, episode: isEpisode ? item.episode_number : null, overview: clean(item.overview || series.overview), tagline: clean(item.tagline, 250), runtime: item.runtime || item.episode_run_time?.[0] || null, rating: item.vote_count ? item.vote_average : null, votes: item.vote_count || 0, genres: (series.genres || []).map(genre => clean(genre.name, 60)), poster: tmdbImage(series.poster_path, "w500"), backdrop: tmdbImage(series.backdrop_path, "w1280"), logo: tmdbImage(series.images?.logos?.find(image => image.iso_639_1 === "en")?.file_path || series.images?.logos?.[0]?.file_path, "w500"), screenshots: (item.images?.stills || item.images?.backdrops || []).slice(0, 8).map(image => tmdbImage(image.file_path, "w780")).filter(Boolean), cast: cast.filter(person => !seen.has(person.id) && seen.add(person.id)).slice(0, 10).map(person => ({ name: clean(person.name, 100), role: clean(person.character, 100), image: tmdbImage(person.profile_path, "w185") })), trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null, url: `https://www.themoviedb.org/${base}/${selection.id}${isEpisode ? `/season/${item.season_number}/episode/${item.episode_number}` : ""}`, imdb: /^tt\d+$/.test(item.external_ids?.imdb_id || "") ? `https://www.imdb.com/title/${item.external_ids.imdb_id}/` : null, attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB." };
  }

  async tvdb(selection) {
    let {id} = selection; const {kind} = selection;
    if (selection.slug) {
      const result = await this.request("tvdb", "search", { query: selection.slug.replace(/-/g, " "), type: kind === "movie" ? "movie" : "series", limit: 20 });
      const item = result.data?.find(item => item.slug === selection.slug);
      if (!item) {
        throw new Error("TVDB could not identify this page. Use its numeric dereferrer URL or search by title.");
      }
      id = item.tvdb_id;
    }
    if (!/^\d+$/.test(String(id || ""))) {
      throw new Error("Invalid TVDB title. Search again or copy its page URL.");
    }
    if (kind === "episode" && selection.seriesId) {
      if (!/^\d+$/.test(selection.seriesId)) {
        throw new Error("Invalid TVDB series. Search again.");
      }
      const episodes = await this.request("tvdb", `series/${selection.seriesId}/episodes/default`, { season: selection.season, episodeNumber: selection.episode });
      const episode = episodes.data?.episodes?.find(item => item.seasonNumber === selection.season && item.number === selection.episode);
      id = episode?.id;
      if (!id) {
        throw new Error("This episode was not found. Use its exact TVDB episode page.");
      }
    }
    const prefix = { movie: "movies", tv: "series", episode: "episodes" }[kind];
    const {data: item} = await this.request("tvdb", `${prefix}/${id}/extended`);
    const series = kind === "episode" && item.seriesId ? (await this.request("tvdb", `series/${item.seriesId}/extended`)).data : item;
    const artworks = series.artworks || [];
    const remote = item.remoteIds?.find(item => /imdb/i.test(item.sourceName));
    if (this.providers.tmdb && /^tt\d+$/.test(remote?.id || "")) {
      try {
        return await this.resolve({ provider: "imdb", id: remote.id });
      }
      catch (_) { /* Preserve available TVDB data if cross-provider matching fails. */ }
    }
    return { provider: "tvdb", kind, id: String(id), title: clean(item.name, 200), series: kind === "episode" ? clean(series.name, 200) : null, season: item.seasonNumber ?? null, episode: item.number ?? null, year: (item.firstAired || item.year || series.firstAired || "").toString().slice(0, 4), overview: clean(item.overview || series.overview), runtime: item.runtime || series.averageRuntime, genres: (series.genres || []).map(genre => clean(genre.name, 60)), poster: safeImage(series.image), backdrop: safeImage(artworks.find(image => [3, 14].includes(image.type))?.image), logo: safeImage(artworks.find(image => [23, 25].includes(image.type))?.image), screenshots: [safeImage(item.image)].filter(Boolean), cast: (series.characters || []).filter(person => person.personName).slice(0, 10).map(person => ({ name: clean(person.personName, 100), role: clean(person.name, 100), image: safeImage(person.personImgURL || person.image) })), url: `https://thetvdb.com/dereferrer/${{ movie: "movie", tv: "series", episode: "episode" }[kind]}/${id}`, attribution: "Metadata from TheTVDB." };
  }
}

module.exports = { MediaCatalog, parseMediaPage, safeImage };
