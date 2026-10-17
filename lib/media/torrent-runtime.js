"use strict";

let pending;

async function loadTorrentRuntime() {
  if (!pending) {
    pending = import("webtorrent").then(module => module.default).catch(error => {
      pending = null;
      const code = /^[A-Z_0-9]{1,60}$/.test(error.code || "") ? error.code : error.name || "Error";
      console.warn("Torrent client initialization failed", code);
      throw Object.assign(new Error("The torrent client could not start. Ask the site operator to run yarn install in the server's operating system and restart Hobbyfiles, then reopen the video."), { code: "TORRENT_RUNTIME_UNAVAILABLE" });
    });
  }
  return pending;
}

module.exports = { loadTorrentRuntime };
