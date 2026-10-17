"use strict";

const { filenameQuery, mediaTitle, episodeIdentity, watchKey, watchCompleted } = require("./video");

const VIDEO = /\.(mp4|mkv|avi|mov|webm|m4v|mpeg|mpg|ts|m2ts)$/i;
const normalize = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const extra = path => /(?:^|[ /_.-])(?:samples?|trailers?|featurettes?|extras?|behind[ ._-]+the[ ._-]+scenes)(?:[ /_.-]|$)/i.test(path);

function mediaFileTitle(movie, fallback) {
  if (movie?.kind === "episode" && movie.title && Number.isInteger(movie.season) && Number.isInteger(movie.episode)) {
    return `${movie.series || movie.title} · ${movie.season === 0 ? "Special" : `Season ${movie.season}`} Episode ${movie.episode}`;
  }
  return mediaTitle(movie, fallback);
}

function torrentContentsSize(torrent) {
  if (!torrent) {
    return null;
  }
  if (Array.isArray(torrent.files) && torrent.files.length && torrent.files.every(file => Number.isSafeInteger(file.size) && file.size >= 0)) {
    const total = torrent.files.reduce((sum, file) => sum + file.size, 0);
    if (Number.isSafeInteger(total)) {
      return total;
    }
  }
  return Number.isSafeInteger(torrent.totalSize) && torrent.totalSize >= 0 ? torrent.totalSize : null;
}

function episodePack(torrent, cinema = {}) {
  const entries = (torrent.files || []).map((file, index) => ({ file, index, movie: cinema[index]?.movie })).filter(row => VIDEO.test(row.file.path || "") && !extra(row.file.path));
  if (!entries.length) {
    return null;
  }
  const matched = entries.filter(row => row.movie?.kind === "episode");
  const first = matched[0]?.movie; const series = first?.series || first?.title;
  const titleKeys = new Set(matched.map(row => normalize(row.movie.series || row.movie.title)));
  if (titleKeys.size > 1 || entries.some(row => row.movie && row.movie.kind !== "episode")) {
    return null;
  }
  const providerIds = new Map();
  for (const { movie } of matched) {
    if (!movie.seriesId) {
      continue;
    }
    const ids = providerIds.get(movie.provider) || new Set(); ids.add(String(movie.seriesId)); providerIds.set(movie.provider, ids);
    if (ids.size > 1) {
      return null;
    }
  }
  const seasons = new Map();
  for (const { file, movie } of entries) {
    const parsed = filenameQuery(file.path, torrent.name);
    const season = movie?.season ?? parsed.season; const episode = movie?.episode ?? parsed.episode;
    if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 1 || episode > 999) {
      return null;
    }
    if (!movie && series && parsed.query.length > 1 && normalize(parsed.query) !== normalize(series) && normalize(parsed.query) !== normalize(filenameQuery(`${torrent.name || ""}.mkv`).query)) {
      return null;
    }
    const group = seasons.get(season) || new Set(); group.add(episode);
    const combined = /S\d{1,2}[ ._-]*E\d{1,3}(?:[ ._-]*-[ ._-]*(?:S\d{1,2})?E?([0-9]{1,3})|[ ._-]*E([0-9]{1,3}))/i.exec(file.path);
    const end = Number(combined?.[1] || combined?.[2]);
    if (end > episode && end - episode <= 50) {
      for (let value = episode + 1; value <= end; value++) {
        group.add(value);
      }
    }
    seasons.set(season, group);
  }
  const counts = new Map(matched.flatMap(({ movie }) => movie.seriesSeasons || []).filter(row => Number.isInteger(row.season) && Number.isInteger(row.episodes) && row.episodes > 0).map(row => [row.season, row.episodes]));
  const groups = [...seasons].sort(([a], [b]) => a - b).map(([season, numbers]) => {
    const episodes = [...numbers].sort((a, b) => a - b); const expected = counts.get(season) || null;
    const contiguous = episodes[0] === 1 && episodes.every((episode, index) => episode === index + 1);
    return { season, episodes, contiguous, expected, complete: !!expected && contiguous && episodes.length === expected };
  });
  const regular = groups.filter(group => group.season > 0); const totalEpisodes = groups.reduce((sum, group) => sum + group.episodes.length, 0);
  const completeSeries = !!first?.seriesEnded && regular.length > 0 && regular.every(group => group.complete) && [...counts].filter(([season]) => season > 0).length === regular.length && [...counts].every(([season]) => season === 0 || regular.some(group => group.season === season));
  return { type: totalEpisodes === 1 ? "episode" : regular.length > 1 ? "series-pack" : "season-pack", series, movie: first || null, groups, totalEpisodes, matched: matched.length, videoFiles: entries.length, completeSeries };
}

function torrentMedia(torrent, cinema = {}, fallback = "Torrent") {
  if (!torrent) {
    return null;
  }
  const pack = episodePack(torrent, cinema);
  if (pack?.movie && pack.type !== "episode") {
    const regular = pack.groups.filter(group => group.season > 0); const numbers = regular.map(group => group.season);
    const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
    const range = contiguous && numbers.length > 1 ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(", ");
    const seasons = regular.length === 1 ? `Season ${numbers[0]}` : regular.length ? `Seasons ${range}` : "Specials";
    return { ...pack, title: `${pack.series} · ${pack.completeSeries ? "Complete series · " : ""}${seasons}`, summary: `${pack.totalEpisodes} episodes${pack.groups.some(group => !group.contiguous) ? " · Gaps in episode sequence" : ""}${regular.length && regular.every(group => group.complete) ? " · Season contents verified" : " · Season completeness unverified"}` };
  }
  if (pack?.type === "episode" && pack.movie) {
    return { ...pack, title: mediaFileTitle(pack.movie, fallback), summary: "Matched episode" };
  }
  const videos = (torrent.files || []).map((file, index) => ({ file, movie: cinema[index]?.movie })).filter(row => VIDEO.test(row.file.path || "") && !extra(row.file.path));
  const movies = videos.filter(row => row.movie?.kind === "movie");
  if (movies.length === 1 && videos.every(row => row === movies[0] || row.file.size <= movies[0].file.size * 0.05)) {
    return { type: "movie", title: mediaFileTitle(movies[0].movie, fallback), movie: movies[0].movie, summary: "Matched movie" };
  }
  return null;
}

function torrentWatchTarget(torrent, cinema, reference, records = []) {
  if (!reference) {
    return null;
  }
  const history = new Map(records.map(record => [record.key, record]));
  const videos = (torrent.files || []).map((file, index) => ({ file, index, episode: episodeIdentity(file.path, cinema[index]?.movie, torrent.name), progress: history.get(watchKey(reference, index)) })).filter(row => VIDEO.test(row.file.path || "") && row.file.size > 0 && !extra(row.file.path));
  if (!videos.length) {
    return null;
  }
  if (episodePack(torrent, cinema)) {
    videos.sort((a, b) => (a.episode.season === 0) - (b.episode.season === 0) || a.episode.season - b.episode.season || a.episode.episode - b.episode.episode || b.file.size - a.file.size || a.index - b.index);
    const identity = row => `${row.episode.season}:${row.episode.episode}`;
    const watched = new Set(videos.filter(row => watchCompleted(row.progress, true)).map(identity));
    const next = videos.find(row => !watched.has(identity(row)));
    return { ...(next || videos[0]), replay: !next };
  }
  videos.sort((a, b) => b.file.size - a.file.size || a.index - b.index);
  return { ...videos[0], replay: false };
}

module.exports = { mediaFileTitle, torrentContentsSize, episodePack, torrentMedia, torrentWatchTarget };
