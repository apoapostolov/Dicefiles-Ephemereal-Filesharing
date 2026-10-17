"use strict";

// Trusted helper run inside the native-tool sandbox. FFmpeg sees only an
// isolated loopback HTTP source; its byte ranges go through the owner's
// authenticated Unix socket. No torrent URLs or filenames enter argv.
const http = require("node:http");
const { spawn } = require("node:child_process");

const [binary, socket, secret, index, mode, start, length] = process.argv.slice(2);
const connections = new Set();
let child;
let stopping = false;
const server = http.createServer((req, res) => {
  if (req.url !== "/media" || !["GET", "HEAD"].includes(req.method) || req.headers.authorization !== `Bearer ${secret}`) {
    res.writeHead(403); res.end(); return;
  }
  const headers = { authorization: `Bearer ${secret}` };
  if (req.headers.range) {
    headers.range = req.headers.range;
  }
  const upstream = http.request({ socketPath: socket, path: `/${index}`, method: req.method, headers }, source => {
    res.writeHead(source.statusCode, Object.fromEntries(["content-type", "content-length", "content-range", "accept-ranges"].filter(name => source.headers[name]).map(name => [name, source.headers[name]])));
    source.on("error", () => res.destroy()); source.pipe(res);
  });
  upstream.on("error", () => res.destroy());
  res.once("close", () => upstream.destroy()); upstream.end();
});
server.on("connection", socket => {
  connections.add(socket); socket.once("close", () => connections.delete(socket));
});
const stop = code => {
  if (stopping) {
    return;
  }
  stopping = true;
  child?.kill("SIGKILL"); connections.forEach(socket => socket.destroy());
  process.exitCode = code; server.close();
};
server.on("error", () => stop(1));
process.on("SIGTERM", () => stop(1));
server.listen(0, "127.0.0.1", () => {
  const input = ["-protocol_whitelist", "http,tcp", "-format_whitelist", "matroska,webm,mov,avi,mpegts", "-headers", `Authorization: Bearer ${secret}\r\n`, "-rw_timeout", "90000000", "-probesize", "4194304", "-analyzeduration", "5000000"];
  const url = `http://127.0.0.1:${server.address().port}/media`;
  const args = mode === "probe" ? ["-v", "error", ...input, "-i", url, "-show_entries", "format=duration:stream=codec_type,width,height,duration", "-of", "json"] : [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-filter_threads", "1", ...input,
    "-ss", start, "-i", url, "-t", length, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
    "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "3000k", "-bufsize", "6000k", "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000", "-muxdelay", "0", "-muxpreload", "0",
    "-output_ts_offset", start, "-f", "mpegts", "pipe:1",
  ];
  child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.on("error", () => stop(1)); child.on("close", code => stop(Number.isInteger(code) ? code : 1));
});
