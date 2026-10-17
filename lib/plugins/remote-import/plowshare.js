"use strict";

const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { createHash } = require("crypto");
const { guardedStream, validateOutboundUrl } = require("../../net-guard");
const { createEgressProxy } = require("./egress-proxy");
const { RemoteProviderError } = require("./provider-error");

const MODULE_HOSTS = { "mediafire": ["mediafire.com", "www.mediafire.com"], "4shared": ["4shared.com", "www.4shared.com"] };

function parseSource(value, allowedModules) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    return null;
  }
  const module = (allowedModules || []).find(id => MODULE_HOSTS[id] && MODULE_HOSTS[id].includes(url.hostname));
  if (!module) {
    return null;
  }
  if (module === "mediafire" && !/^\/(file|folder)\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname) && !/^\?[a-zA-Z0-9_-]+$/.test(url.search)) {
    return null;
  }
  if (module === "4shared" && !/^\/(file|folder|photo|video|music)\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname)) {
    return null;
  }
  url.hash = "";
  return { providerId: "plowshare", module, sourceKind: url.pathname.includes("/folder/") ? "folder" : "file", canonicalUrl: url.href, sourceId: createHash("sha256").update(url.href).digest("hex") };
}

async function runBounded(binary, args, { cwd, env, signal, timeoutMs = 60000, maxBytes = 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, detached: process.platform !== "win32", cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const kill = () => {
      try {
        if (process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        }
        else {
          child.kill("SIGKILL");
        }
      }
      catch (_) { /* Already exited. */ }
    };
    let size = 0;
    let stderrSize = 0;
    const chunks = [];
    const timer = setTimeout(kill, timeoutMs);
    const abort = () => kill();
    if (signal) {
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) {
        kill();
      }
    }
    child.stdout.on("data", chunk => {
      size += chunk.length; if (size > maxBytes) {
        kill();
      }
      else {
        chunks.push(chunk);
      }
    });
    child.stderr.on("data", chunk => {
      stderrSize += chunk.length; if (stderrSize > 262144) {
        kill();
      }
    });
    const cleanup = () => {
      clearTimeout(timer); if (signal) {
        signal.removeEventListener("abort", abort);
      }
    };
    child.on("error", () => {
      cleanup(); reject(new RemoteProviderError("TOOL_UNAVAILABLE"));
    });
    child.on("close", code => {
      cleanup();
      if (code !== 0 || size > maxBytes || stderrSize > 262144) {
        reject(new RemoteProviderError(code === 11 ? "PASSWORD_REQUIRED" : code === 12 ? "AUTH_REQUIRED" : code === 7 ? "UNSUPPORTED_CONTENT" : "TOOL_FAILED"));
      }
      else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

function createPlowshareDownloader(config = {}, { run = runBounded, validate = validateOutboundUrl, download = guardedStream, proxyFactory = createEgressProxy } = {}) {
  const modules = (config.allowedModules || []).filter(id => Object.hasOwn(MODULE_HOSTS, id));
  const enabled = config.enabled === true;
  const binaries = { binary: config.binary || "/usr/bin/plowdown", probeBinary: config.probeBinary || "/usr/bin/plowprobe", listBinary: config.listBinary || "/usr/bin/plowlist" };
  for (const binary of Object.values(binaries)) {
    if (!path.isAbsolute(binary)) {
      throw new Error("Plowshare binaries must be absolute operator paths");
    }
  }

  if (config.moduleConfigDirectory && !path.isAbsolute(config.moduleConfigDirectory)) {
    throw new Error("Plowshare module config directory must be absolute");
  }

  async function inWorkspace(action, signal) {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "hobbyfiles-plow-"));
    await fs.chmod(cwd, 0o700);
    let proxy;
    try {
      proxy = await proxyFactory();
      const wrapper = path.join(cwd, "guarded-curl");
      const script = await fs.readFile(path.resolve(__dirname, "../../../scripts/plowshare-curl.js"), "utf8");
      await fs.writeFile(wrapper, `#!${process.execPath}\n${script.split("\n").slice(1).join("\n")}`, { mode: 0o700 });
      const env = { PATH: "/usr/bin:/bin", HOME: cwd, XDG_CONFIG_HOME: config.moduleConfigDirectory || path.join(cwd, ".config"), TMPDIR: cwd, LC_ALL: "C", PLOWSHARE_CURL: wrapper, HOBBYFILES_EGRESS_PROXY: proxy.url };
      return await action({ cwd, env, signal, timeoutMs: Math.min(120000, Number(config.timeoutMs) || 60000) });
    }
    finally {
      if (proxy) {
        await proxy.close();
      } await fs.rm(cwd, { recursive: true, force: true });
    }
  }

  const common = ["--no-plowsharerc", "--no-curlrc", "--no-color", "--quiet"];
  const provider = {
    id: "plowshare", name: "Plowshare", contractVersion: 1, capabilities: ["single-file", "folder", "declared-size"], apiRevision: "plowshare-2",
    enabled, allowedModules: modules,
    canHandle: url => enabled && !!parseSource(url, modules),
    async probe() {
      if (!enabled) {
        return { available: false, code: "DISABLED" };
      }
      try {
        return await inWorkspace(async options => {
          for (const binary of Object.values(binaries)) {
            if (!/^v?2\./m.test(await run(binary, ["--version"], options))) {
              throw new RemoteProviderError("TOOL_UNAVAILABLE");
            }
            const installed = (await run(binary, ["--modules"], options)).trim().split(/\s+/);
            if (modules.some(module => !installed.includes(module))) {
              throw new RemoteProviderError("TOOL_UNAVAILABLE");
            }
          }
          return { available: true, modules };
        });
      }
      catch (error) {
        return { available: false, code: error.code || "TOOL_UNAVAILABLE" };
      }
    },
    async listFolder(sourceUrl, _credentials, { signal } = {}) {
      const source = parseSource(sourceUrl, modules);
      if (!enabled || !source) {
        throw new RemoteProviderError("INVALID_SOURCE");
      }
      const availability = await provider.probe();
      if (!availability.available) {
        throw new RemoteProviderError(availability.code);
      }
      await validate(source.canonicalUrl);
      return inWorkspace(async options => {
        const links = source.sourceKind === "folder" ? (await run(binaries.listBinary, [...common, "--printf", "%u%n", source.canonicalUrl], options)).trim().split("\n") : [source.canonicalUrl];
        if (links.length > 1000) {
          throw new RemoteProviderError("RESPONSE_INVALID");
        }
        const entries = [];
        for (const link of links) {
          const parsed = parseSource(link, modules);
          if (!parsed || parsed.sourceKind !== "file") {
            throw new RemoteProviderError("RESPONSE_INVALID");
          }
          await validate(link);
          const actualModule = (await run(binaries.probeBinary, [...common, "--get-module", link], options)).trim();
          if (actualModule !== parsed.module) {
            throw new RemoteProviderError("RESPONSE_INVALID");
          }
          // Approximate or absent size is refused; files still receive an actual byte cap on ingest.
          const size = Number((await run(binaries.probeBinary, [...common, "--printf", "%s%n", link], options)).trim());
          if (!Number.isSafeInteger(size) || size <= 0) {
            throw new RemoteProviderError("UNSUPPORTED_CONTENT");
          }
          const name = path.basename(new URL(link).pathname) || `${parsed.module}-${parsed.sourceId.slice(0, 12)}`;
          entries.push({ name, size, sourceId: `plowshare:${parsed.module}:${parsed.sourceId}:${size}`, isDir: false,
            async openStream(downloadSignal) {
              const finalUrl = await inWorkspace(async downloadOptions => {
                const output = (await run(binaries.binary, [...common, "--captchamethod=none", "--cache=none", "--max-retries=0", "--timeout=60", "--skip-final", "--printf", "%D%n", link], downloadOptions)).trim();
                try {
                  return JSON.parse(`"${output}"`);
                }
                catch (_) {
                  throw new RemoteProviderError("RESPONSE_INVALID");
                }
              }, downloadSignal);
              const response = await download(finalUrl, {}, { httpsOnly: true, maxBytes: size, timeoutMs: 60000, signal: downloadSignal });
              if (!response.ok) {
                response.body.destroy(); throw new RemoteProviderError("TOOL_FAILED");
              }
              return response.body;
            },
          });
        }
        return entries;
      }, signal);
    },
  };
  return provider;
}

module.exports = { createPlowshareDownloader, parseSource, runBounded };
