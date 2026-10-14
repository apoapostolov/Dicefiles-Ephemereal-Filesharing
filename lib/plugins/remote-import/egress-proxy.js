"use strict";

const http = require("http");
const net = require("net");
const { randomBytes, timingSafeEqual } = require("crypto");
const { validateOutboundUrl } = require("../../net-guard");

/** Local authenticated CONNECT proxy: resolve once and pin every TLS tunnel. */
async function createEgressProxy({ timeoutMs = 60000, maxBytes = 32 * 1024 * 1024 } = {}) {
  const secret = randomBytes(24).toString("base64url");
  const expected = Buffer.from(`Basic ${Buffer.from(`dicefiles:${secret}`).toString("base64")}`);
  const sockets = new Set();
  const server = http.createServer((_req, res) => {
    res.writeHead(403); res.end("HTTPS is required");
  });
  server.on("connection", socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
  });
  server.on("connect", async (req, client, head) => {
    let remote;
    try {
      const actual = Buffer.from(req.headers["proxy-authorization"] || "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error("Unauthorized proxy");
      }
      const url = new URL(`https://${req.url}`);
      if ((url.port && url.port !== "443") || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Invalid tunnel");
      }
      const target = await Promise.race([
        validateOutboundUrl(url),
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("DNS timed out")), 5000); timer.unref();
        }),
      ]);
      if (client.destroyed) {
        return;
      }
      remote = net.connect({ host: target.address.address, family: target.address.family, port: 443 });
      sockets.add(remote);
      remote.on("close", () => sockets.delete(remote));
      remote.on("error", () => client.destroy());
      client.on("error", () => remote.destroy());
      client.on("close", () => remote.destroy());
      remote.setTimeout(timeoutMs, () => remote.destroy());
      const deadline = setTimeout(() => {
        remote.destroy(); client.destroy();
      }, timeoutMs);
      deadline.unref();
      remote.on("close", () => {
        clearTimeout(deadline); client.destroy();
      });
      let bytes = 0;
      for (const socket of [remote, client]) {
        socket.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            remote.destroy(); client.destroy();
          }
        });
      }
      remote.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) {
          remote.write(head);
        }
        client.pipe(remote); remote.pipe(client);
      });
    }
    catch (_) {
      if (remote) {
        remote.destroy();
      }
      if (!client.destroyed) {
        client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://dicefiles:${secret}@127.0.0.1:${server.address().port}`,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createEgressProxy };
