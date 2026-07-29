#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");
const {
  spawn,
  spawnSync,
} = require("child_process");
const { createClient } = require("redis");
const {
  generateIdentity,
} = require("../lib/federation/identity");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(REPO_ROOT, "server.js");
const API_KEY = "federation-smoke-api-key";
const SOURCE_BYTES = Buffer.from(
  "%PDF-1.4\nDicefiles federation smoke fixture\n",
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedRoom(roomId) {
  require.main.require = createRequire(SERVER);
  const { Room } = require("./lib/room");
  const { ingestFromBuffer } = require("./lib/upload");
  const room = await Room.get(roomId);
  if (!room) {
    throw new Error(`Seed room not found: ${roomId}`);
  }
  const common = {
    roomid: roomId,
    ip: "127.0.0.1",
    user: "Federation Bot",
    account: "",
    role: "bot",
    ttl: room.fileTTL,
    meta: { plugin: "federation-smoke" },
  };
  await ingestFromBuffer(Object.assign({}, common, {
    name: "pf2-federation-smoke.pdf",
    buffer: SOURCE_BYTES,
  }));
  await ingestFromBuffer(Object.assign({}, common, {
    name: "unrelated-release.txt",
    buffer: Buffer.from("This file must be removed by source-side rules.\n"),
  }));
  await sleep(1000);
}

async function redisDatabaseSize(url) {
  const client = createClient({ url });
  await client.connect();
  try {
    return await client.dbSize();
  }
  finally {
    await client.quit();
  }
}

async function flushRedisDatabase(url) {
  const client = createClient({ url });
  await client.connect();
  try {
    await client.flushDb();
  }
  finally {
    await client.quit();
  }
}

function peerRecord(peerId, baseUrl, identity) {
  return {
    peerId,
    displayName: peerId,
    baseUrl,
    keyId: `${baseUrl}/federation/actor#main-key`,
    publicKeyJwk: identity.publicKeyJwk,
    publicKeyPem: identity.publicKeyPem,
    allowedRooms: ["*"],
    allowInsecureHttp: true,
    allowPrivateNetwork: true,
  };
}

function hostConfig(spec, identity, peer) {
  return {
    name: `Dicefiles Federation Smoke ${spec.peerId}`,
    port: spec.port,
    workers: 1,
    secret: `federation-smoke-secret-${spec.peerId}-2026`,
    jail: false,
    tls: false,
    uploads: path.join(spec.directory, "uploads"),
    modlog: path.join(spec.directory, "mod.log"),
    observabilityLog: path.join(spec.directory, "ops.log"),
    automationAuditLog: path.join(spec.directory, "automation.log"),
    statusPagePrivate: false,
    roomPruning: false,
    redis_url: spec.redisUrl,
    automationApiKeys: [{
      id: "federation-smoke",
      key: API_KEY,
      scopes: [
        "files:read",
        "federation-links:read",
        "federation-links:write",
      ],
    }],
    federation: Object.assign({
      enabled: true,
      publicBaseUrl: spec.baseUrl,
      peerId: spec.peerId,
      displayName: spec.peerId,
      auditLog: path.join(spec.directory, "federation.log"),
      peers: [peer],
      limits: {
        timeoutMs: 30000,
        cacheTtlMs: 1000,
        requestsPerMinute: 1000,
        downloadsPerMinute: 1000,
      },
    }, identity),
  };
}

function startHost(spec) {
  const logPath = path.join(spec.directory, "server.log");
  const log = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [SERVER], {
    cwd: spec.directory,
    detached: true,
    env: Object.assign({}, process.env, {
      NODE_ENV: "development",
    }),
    stdio: ["ignore", log, log],
  });
  fs.closeSync(log);
  return Object.assign(child, { logPath });
}

async function stopHost(child) {
  if (!child || !child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  }
  catch (_) {
    return;
  }
  await sleep(1500);
  try {
    process.kill(-child.pid, "SIGKILL");
  }
  catch (_) {
    // The process group already exited.
  }
}

async function waitForHealth(baseUrl, logPath) {
  const deadline = Date.now() + 120000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.status === 200) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    }
    catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  let log = "";
  try {
    log = fs.readFileSync(logPath, "utf8").slice(-4000);
  }
  catch (_) {
    // No log was produced.
  }
  throw new Error(
    `Host ${baseUrl} did not become healthy: ${lastError}\n${log}`,
  );
}

async function createRoom(baseUrl) {
  const response = await fetch(`${baseUrl}/new`, { redirect: "manual" });
  assert.strictEqual(response.status, 302);
  const location = response.headers.get("location") || "";
  const match = /^\/r\/([^/?#]+)$/.exec(location);
  assert(match, `Unexpected room redirect: ${location}`);
  return decodeURIComponent(match[1]);
}

async function api(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      accept: "application/json",
      ...(body == null ? {} : { "content-type": "application/json" }),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.err || value.error) {
    throw new Error(
      `${method} ${pathname} failed (${response.status}): ` +
        JSON.stringify(value),
    );
  }
  return value;
}

async function waitForRemoteFile(baseUrl, roomId) {
  const deadline = Date.now() + 60000;
  let latest;
  while (Date.now() < deadline) {
    latest = await api(
      baseUrl,
      "GET",
      `/files?roomid=${encodeURIComponent(roomId)}`,
    );
    const match = (latest.files || []).find(
      (file) => file.name === "pf2-federation-smoke.pdf",
    );
    if (match) {
      return { match, latest };
    }
    await sleep(500);
  }
  throw new Error(
    `Federated file did not appear: ${JSON.stringify(latest)}`,
  );
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error(
      "Run this smoke test through WSL/Linux so child process groups are isolated",
    );
  }
  const sourceRedis =
    process.env.DICEFILES_FEDERATION_SOURCE_REDIS ||
    "redis://127.0.0.1:6379/14";
  const destinationRedis =
    process.env.DICEFILES_FEDERATION_DEST_REDIS ||
    "redis://127.0.0.1:6379/15";
  if (sourceRedis === destinationRedis) {
    throw new Error("The two hosts require separate Redis databases");
  }
  const sizes = await Promise.all([
    redisDatabaseSize(sourceRedis),
    redisDatabaseSize(destinationRedis),
  ]);
  if (sizes.some((size) => size !== 0)) {
    throw new Error(
      "Federation smoke Redis databases must be empty and dedicated to this test",
    );
  }

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "dicefiles-federation-smoke-"),
  );
  const source = {
    peerId: "smoke-source",
    port: Number(process.env.DICEFILES_FEDERATION_SOURCE_PORT) || 19141,
    redisUrl: sourceRedis,
    directory: path.join(root, "source"),
  };
  const destination = {
    peerId: "smoke-destination",
    port: Number(process.env.DICEFILES_FEDERATION_DEST_PORT) || 19142,
    redisUrl: destinationRedis,
    directory: path.join(root, "destination"),
  };
  source.baseUrl = `http://127.0.0.1:${source.port}`;
  destination.baseUrl = `http://127.0.0.1:${destination.port}`;
  fs.mkdirSync(source.directory, { recursive: true });
  fs.mkdirSync(destination.directory, { recursive: true });

  const sourceIdentity = generateIdentity();
  const destinationIdentity = generateIdentity();
  fs.writeFileSync(
    path.join(source.directory, ".config.json"),
    `${JSON.stringify(
      hostConfig(
        source,
        sourceIdentity,
        peerRecord(
          destination.peerId,
          destination.baseUrl,
          destinationIdentity,
        ),
      ),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(destination.directory, ".config.json"),
    `${JSON.stringify(
      hostConfig(
        destination,
        destinationIdentity,
        peerRecord(source.peerId, source.baseUrl, sourceIdentity),
      ),
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  let sourceProcess;
  let destinationProcess;
  try {
    sourceProcess = startHost(source);
    destinationProcess = startHost(destination);
    await Promise.all([
      waitForHealth(source.baseUrl, sourceProcess.logPath),
      waitForHealth(destination.baseUrl, destinationProcess.logPath),
    ]);

    const sourceRoom = await createRoom(source.baseUrl);
    const destinationRoom = await createRoom(destination.baseUrl);
    await api(
      source.baseUrl,
      "PATCH",
      `/rooms/${encodeURIComponent(sourceRoom)}/federation`,
      { allowFederation: true, allowPrivateFederation: false },
    );

    const seeded = spawnSync(
      process.execPath,
      [__filename, "--seed", sourceRoom],
      {
        cwd: source.directory,
        env: process.env,
        encoding: "utf8",
        timeout: 60000,
      },
    );
    if (seeded.status !== 0) {
      throw new Error(
        `Fixture seeding failed: ${seeded.stderr || seeded.stdout}`,
      );
    }
    const sourceFiles = await api(
      source.baseUrl,
      "GET",
      `/files?roomid=${encodeURIComponent(sourceRoom)}`,
    );
    assert.deepStrictEqual(
      (sourceFiles.files || []).map((file) => file.name).sort(),
      ["pf2-federation-smoke.pdf", "unrelated-release.txt"],
      "Both source fixtures must be visible before federation begins",
    );

    const linked = await api(
      destination.baseUrl,
      "POST",
      `/rooms/${encodeURIComponent(destinationRoom)}/federation-links`,
      {
        peerId: source.peerId,
        roomId: sourceRoom,
        name: "Federation smoke source",
        rules: {
          nameContains: "/^pf2-.*\\.pdf$/i",
          userContains: "Federation Bot",
        },
      },
    );
    assert.strictEqual(linked.statuses[0].status, "active");

    const { match, latest } = await waitForRemoteFile(
      destination.baseUrl,
      destinationRoom,
    );
    assert.strictEqual(
      (latest.files || []).some(
        (file) => file.name === "unrelated-release.txt",
      ),
      false,
      "Source-side rules must remove non-matching files",
    );
    assert.strictEqual(
      JSON.stringify(match).includes("Federation Bot"),
      false,
      "Source uploader identity must not cross hosts",
    );
    assert.strictEqual(match.federated, true);

    const range = await fetch(`${destination.baseUrl}${match.href}`, {
      headers: { range: "bytes=0-7" },
    });
    assert.strictEqual(range.status, 206);
    assert.deepStrictEqual(
      Buffer.from(await range.arrayBuffer()),
      SOURCE_BYTES.subarray(0, 8),
    );

    process.stdout.write(
      "Federation two-host smoke passed: signed trust, source-side rules, " +
        "privacy-safe metadata, and ranged proxy streaming.\n",
    );
  }
  catch (error) {
    const logs = [sourceProcess, destinationProcess]
      .filter(Boolean)
      .map((child) => {
        try {
          return fs.readFileSync(child.logPath, "utf8").slice(-6000);
        }
        catch (_) {
          return "";
        }
      })
      .filter(Boolean);
    if (logs.length) {
      error.message += `\nServer log tails:\n${logs.join("\n---\n")}`;
    }
    throw error;
  }
  finally {
    await Promise.all([
      stopHost(sourceProcess),
      stopHost(destinationProcess),
    ]);
    await Promise.all([
      flushRedisDatabase(sourceRedis),
      flushRedisDatabase(destinationRedis),
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--seed") {
  seedRoom(process.argv[3])
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
