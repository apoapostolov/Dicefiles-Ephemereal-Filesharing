"use strict";

const { Readable } = require("stream");
const http = require("http");
const { createPlowshareDownloader, parseSource } = require("../../lib/plugins/remote-import/plowshare");
const { createEgressProxy } = require("../../lib/plugins/remote-import/egress-proxy");

test("Plowshare is disabled by default and accepts only exact allowlisted hosts", () => {
  expect(createPlowshareDownloader().canHandle(new URL("https://mediafire.com/file/abc/guide.pdf"))).toBe(false);
  expect(parseSource("https://mediafire.com.attacker.invalid/file/abc/file", ["mediafire"])).toBeNull();
  expect(parseSource("https://4shared.com/file/abc/file", ["mediafire"])).toBeNull();
  expect(() => createPlowshareDownloader({ binary: "relative-command" })).toThrow("absolute");
});

test("bridge probes versions/modules and uses fixed argv with guarded streaming", async () => {
  const run = jest.fn(async (_binary, args) => {
    if (args.includes("--version")) {
      return "v2.1.7\n";
    }
    if (args.includes("--modules")) {
      return "mediafire\n";
    }
    if (args.includes("--get-module")) {
      return "mediafire\n";
    }
    if (args.includes("%s%n")) {
      return "5\n";
    }
    return "https://download.mediafire.com/synthetic/file\n";
  });
  const download = jest.fn(async () => ({ ok: true, body: Readable.from([Buffer.from("bytes")]) }));
  const provider = createPlowshareDownloader({ enabled: true, allowedModules: ["mediafire"] }, { run, validate: async () => {}, download, proxyFactory: async () => ({ url: "http://synthetic-proxy", close: async () => {} }) });
  const [entry] = await provider.listFolder("https://mediafire.com/file/abc/guide.pdf", {});
  expect(entry.name).toBe("guide.pdf");
  expect(entry.size).toBe(5);
  const stream = await entry.openStream();
  expect(stream).toBeInstanceOf(Readable);
  expect(run.mock.calls.at(-1)[1]).toContain("--captchamethod=none");
  expect(run.mock.calls.at(-1)[1]).toContain("--no-plowsharerc");
  expect(download.mock.calls[0][2].httpsOnly).toBe(true);
  expect(run.mock.calls.every(([, , options]) => options.env.HOME.includes("hobbyfiles-plow-"))).toBe(true);
});

test("egress proxy refuses private targets and anonymous tunnels", async () => {
  const proxy = await createEgressProxy();
  const url = new URL(proxy.url);

  async function tunnel(target, authenticated) {
    return new Promise((resolve, reject) => {
      const request = http.request({ host: url.hostname, port: url.port, method: "CONNECT", path: target, headers: authenticated ? { "proxy-authorization": `Basic ${Buffer.from(`${url.username}:${url.password}`).toString("base64")}` } : {} });
      request.on("connect", (response, socket) => {
        socket.destroy(); resolve(response.statusCode);
      });
      request.on("error", reject); request.end();
    });
  }

  try {
    expect(await tunnel("127.0.0.1:443", true)).toBe(403);
    expect(await tunnel("example.org:443", false)).toBe(403);
    expect(await tunnel("example.org:80", true)).toBe(403);
  }
  finally {
    await proxy.close();
  }
});
