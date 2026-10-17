"use strict";

function registerMediaRoutes(app, { getUser, aroute, rtoken }) {
  const route = "/api/v1/media/:kind/:key/:index";
  app.use(route, getUser, aroute(async (req, res, next) => {
    const library = require("../media/library");

    const reference = { kind: req.params.kind, key: req.params.key, index: Number(req.params.index) };
    library.validateReference(reference);
    const item = reference.kind === "file" ? await require("../upload").Upload.get(reference.key) : await require("../links").Link.get(reference.key);
    const room = item && await require("../room").Room.get(item.roomid);
    res.setHeader("Cache-Control", "private, no-store");
    if (!room || item.expired) {
      res.status(404).json({ error: "This video is no longer available. Refresh the room for current files." }); return;
    }
    if (!room.invited(req.user, rtoken(req)) || !await room.passwordAccessAllowed(req.user, rtoken(req), req.cookies)) {
      res.status(403).json({ error: "Open the video from its room and unlock access before playing it." }); return;
    }
    const role = req.user?.role === "mod" ? "mod" : "white";
    req.media = await library.resolveReference(reference, { room, roomid: item.roomid, role, ip: req.ip });
    req.mediaReference = reference;
    next();
  }));
  app.get(`${route}/subtitle/:id`, aroute(async (req, res) => {
    const { RECORDS, validateReference } = require("../media/library");

    const record = await RECORDS.getFresh(validateReference(req.mediaReference));
    const subtitle = record?.subtitles?.find(track => track.id === req.params.id);
    if (!subtitle) {
      res.status(404).json({ error: "This subtitle was removed. Open video details and choose another track." }); return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff"); res.type("text/vtt").send(subtitle.text);
  }));
  const playback = resource => aroute(async (req, res) => {
    if (require("../config").get("torrentPlayback") === false) {
      res.status(503).json({ error: "Torrent playback is disabled on this server. Open the magnet in a torrent app or upload the video." }); return;
    }
    if (req.mediaReference.index < 0) {
      res.status(400).json({ error: "Choose a video inside the torrent contents." }); return;
    }
    try {
      const target = typeof resource === "function" ? resource(req) : resource;
      await require("../media/torrent-stream").serveTorrent(req, res, req.media, req.mediaReference.index, target);
    }
    catch (error) {
      if (!res.headersSent) {
        res.status(503).json({ error: /^(This|Both|No peers|The torrent)/.test(error.message || "") ? error.message : "Streaming could not start. Check the torrent's peers or upload its video file." });
      }
      else {
        res.destroy();
      }
    }
  });
  app.get(`${route}/stream`, playback(""));
  app.get(`${route}/hls.m3u8`, playback("hls.m3u8"));
  app.get(`${route}/segment/:segment`, playback(req => {
    if (!/^\d{1,4}\.ts$/.test(req.params.segment)) {
      throw new Error("This video section is invalid. Reopen the player and try again.");
    }
    return `segment/${req.params.segment}`;
  }));
}

module.exports = { registerMediaRoutes };
