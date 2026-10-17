#!/usr/bin/env node
"use strict";

const { loadTorrentRuntime } = require("../lib/media/torrent-runtime");

async function main() {
  const WebTorrent = await loadTorrentRuntime();
  const client = new WebTorrent({ dht: false, tracker: false, lsd: false, utPex: false, natUpnp: false, natPmp: false, utp: false, webSeeds: false });
  try {
    await new Promise((resolve, reject) => {
      client.once("error", reject); client.once("listening", resolve);
    });
    console.log("Torrent runtime OK: TCP client starts without native WebRTC dependencies.");
  }
  finally {
    if (!client.destroyed) {
      await new Promise(resolve => client.destroy(resolve));
    }
  }
}

main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
