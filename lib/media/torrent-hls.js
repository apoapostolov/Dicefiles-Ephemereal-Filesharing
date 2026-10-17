"use strict";

const fs = require("node:fs");
const path = require("node:path");
const CONFIG = require("../config");
const { spawnBounded } = require("./jail");

const SEGMENT_SECONDS = 6;
const MAX_DURATION = 4 * 3600;
const MAX_SEGMENT_BYTES = 12 * 1024 ** 2;
const MAX_CACHE_BYTES = 128 * 1024 ** 2;

function durationOf(probe) {
  const video = probe.streams?.find(stream => stream.codec_type === "video");
  const duration = Number(probe.format?.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION || video.width > 8192 || video.height > 8192) {
    throw new Error("This video cannot be prepared for browser playback. Use a video under four hours with a valid duration, or download it for a compatible player.");
  }
  return duration;
}

function playlist(duration) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
  for (let part = 0; part < Math.ceil(duration / SEGMENT_SECONDS); part++) {
    if (part) {
      lines.push("#EXT-X-DISCONTINUITY");
    }
    lines.push(`#EXTINF:${Math.min(SEGMENT_SECONDS, duration - part * SEGMENT_SECONDS).toFixed(3)},`, `segment/${part}.ts`);
  }
  lines.push("#EXT-X-ENDLIST"); return `${lines.join("\n")}\n`;
}

function createCompatible(session, relay, index, { config = CONFIG, run = spawnBounded } = {}) {
  const cache = session.compatibleCache ||= { buffers: new Map(), bytes: 0 };
  const pending = new Map();
  let probe;
  const queue = session.compatibleQueue ||= { queued: 0, tail: Promise.resolve() };
  const worker = path.join(session.dir, "compatible-worker.cjs");
  let ready;
  // One native job per torrent owner; both HTTP workers and seeks share it.
  const execute = (mode, part) => {
    if (queue.queued >= 8) {
      return Promise.reject(new Error("The video is preparing several sections. Wait a few seconds and try again."));
    }
    queue.queued++;
    const job = queue.tail.then(async () => {
      if (session.signal?.aborted) {
        throw new Error("The torrent streaming session ended. Reopen the video to reconnect.");
      }
      if (config.get("nativeTools") === false) {
        throw new Error("This video needs browser conversion, but native video tools are disabled on this server. Ask the operator to enable them, or use a compatible player.");
      }
      ready ||= fs.promises.copyFile(path.join(__dirname, "torrent-hls-worker.js"), worker);
      await ready;
      const node = process.platform !== "win32" && config.get("jail") ? "node" : process.execPath;
      const tool = mode === "probe" ? "ffprobe" : "ffmpeg";
      const binary = config.get(tool) || tool;
      const args = [node, worker, binary, relay.socket, relay.secret, String(index), mode];
      if (mode !== "probe") {
        args.push(String(part * SEGMENT_SECONDS), String(Math.min(SEGMENT_SECONDS, probe.duration - part * SEGMENT_SECONDS)));
      }
      const result = await run(args, { privateDir: session.dir, signal: session.signal, processGroup: true, timeoutMs: 120000, maxBytes: mode === "probe" ? 65536 : MAX_SEGMENT_BYTES });
      if (result.code !== 0 || result.truncated || result.timedOut || !result.stdout.length) {
        console.warn("Video conversion failed", mode, result.timedOut ? "timeout" : result.truncated ? "output limit" : `exit ${result.code}`);
        throw new Error("The video could not be converted for this browser. Check that FFmpeg and FFprobe are installed and peers can supply the video, then retry.");
      }
      return result.stdout;
    }).finally(() => queue.queued--);
    queue.tail = job.catch(() => {}); return job;
  };
  const inspect = async () => {
    if (!probe) {
      const promise = execute("probe").then(output => ({ duration: durationOf(JSON.parse(output.toString("utf8"))) }));
      probe = promise;
      try {
        probe = await promise;
      }
      catch (error) {
        probe = null; throw error;
      }
    }
    return probe;
  };
  const segment = async part => {
    const { duration } = await inspect();
    if (!Number.isSafeInteger(part) || part < 0 || part >= Math.ceil(duration / SEGMENT_SECONDS)) {
      throw Object.assign(new Error("This video section does not exist. Reopen the player and seek again."), { status: 404 });
    }
    const key = `${index}:${part}`;
    if (cache.buffers.has(key)) {
      const hit = cache.buffers.get(key); cache.buffers.delete(key); cache.buffers.set(key, hit); return hit;
    }
    if (!pending.has(part)) {
      const job = execute("segment", part).then(output => {
        cache.buffers.set(key, output); cache.bytes += output.length;
        while (cache.bytes > MAX_CACHE_BYTES) {
          const oldest = cache.buffers.keys().next().value; cache.bytes -= cache.buffers.get(oldest).length; cache.buffers.delete(oldest);
        }
        return output;
      }).finally(() => pending.delete(part));
      pending.set(part, job);
    }
    return pending.get(part);
  };
  return { inspect, segment };
}

async function serveCompatible(req, res, session, relay, index, resource) {
  session.compatible ||= new Map();
  if (!session.compatible.has(index)) {
    session.compatible.set(index, createCompatible(session, relay, index));
  }
  const compatible = session.compatible.get(index);
  session.active++; session.touched = Date.now();
  try {
    const output = resource === "hls.m3u8" ? Buffer.from(playlist((await compatible.inspect()).duration)) : await compatible.segment(Number(/^segment\/(\d+)\.ts$/.exec(resource)?.[1] ?? NaN));
    res.writeHead(200, { "Content-Type": resource === "hls.m3u8" ? "application/vnd.apple.mpegurl" : "video/mp2t", "Content-Length": output.length, "Cache-Control": "private, no-store" });
    res.end(req.method === "HEAD" ? undefined : output);
  }
  finally {
    session.active--; session.touched = Date.now();
  }
}

module.exports = { createCompatible, serveCompatible, durationOf, playlist, SEGMENT_SECONDS };
