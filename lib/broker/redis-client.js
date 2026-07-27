"use strict";

/**
 * Redis v4 helpers for the Dicefiles broker.
 * Promise-only surface — never mix callback + promise on the same call.
 */

const { createClient } = require("redis");

/**
 * Map historical redis_* config keys (v3 style) to node-redis v4 options.
 * @param {Record<string, unknown>} conn
 * @returns {import("redis").RedisClientOptions}
 */
function mapConnToV4Options(conn) {
  const c = conn || {};
  /** @type {import("redis").RedisClientOptions} */
  const options = {};

  if (c.url) {
    options.url = String(c.url);
  }
  else {
    options.socket = {
      host: c.host ? String(c.host) : "127.0.0.1",
      port: c.port != null ? Number(c.port) : 6379,
      connectTimeout:
        c.connectTimeout != null ? Number(c.connectTimeout) : 10000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    };
  }

  if (c.password != null && c.password !== "") {
    options.password = String(c.password);
  }
  if (c.username != null && c.username !== "") {
    options.username = String(c.username);
  }
  if (c.db != null && c.db !== "") {
    options.database = Number(c.db);
  }
  else if (c.database != null && c.database !== "") {
    options.database = Number(c.database);
  }

  return options;
}

/**
 * Convert redis v3 SET varargs into node-redis v4 (key, value, options).
 * Supports: set(k,v), set(k,v,"EX",n), set(k,v,"NX"), set(k,v,"NX","EX",n), etc.
 * @param {unknown[]} args
 * @returns {unknown[]}
 */
function convertSetArgs(args) {
  if (!args || args.length <= 2) {
    return args;
  }
  const key = args[0];
  const value = args[1];
  const opts = {};
  for (let i = 2; i < args.length; i++) {
    const t = String(args[i]).toUpperCase();
    if (t === "EX" || t === "PX" || t === "EXAT" || t === "PXAT") {
      opts[t] = Number(args[++i]);
    }
    else if (t === "NX" || t === "XX" || t === "KEEPTTL" || t === "GET") {
      opts[t] = true;
    }
  }
  return Object.keys(opts).length ? [key, value, opts] : [key, value];
}

/**
 * Map lowercase redis command names to node-redis v4 camelCase methods.
 */
const CMD_MAP = Object.freeze({
  get: "get",
  set: "set",
  del: "del",
  exists: "exists",
  expire: "expire",
  ttl: "ttl",
  pttl: "pTTL",
  pexpire: "pExpire",
  ping: "ping",
  publish: "publish",
  hget: "hGet",
  hset: "hSet",
  hsetnx: "hSetNX",
  hgetall: "hGetAll",
  hdel: "hDel",
  hexists: "hExists",
  hincrby: "hIncrBy",
  sadd: "sAdd",
  srem: "sRem",
  smembers: "sMembers",
  sismember: "sIsMember",
  zadd: "zAdd",
  zscore: "zScore",
  zrevrank: "zRevRank",
  zincrby: "zIncrBy",
  zrevrange: "zRevRange",
  zremrangebyrank: "zRemRangeByRank",
  rpush: "rPush",
  lpush: "lPush",
  lrange: "lRange",
  config: "configSet",
  script: "scriptLoad",
  evalsha: "evalSha",
});

/**
 * Resolve a v4 method on the client for a lowercase command name.
 * @param {import("redis").RedisClientType} client
 * @param {string} name
 * @returns {Function|null}
 */
function resolveCommand(client, name) {
  const n = String(name || "");
  const mapped = CMD_MAP[n] || n;
  if (typeof client[mapped] === "function") {
    return client[mapped].bind(client);
  }
  if (typeof client[n] === "function") {
    return client[n].bind(client);
  }
  return null;
}

/**
 * Invoke a redis command with v3-compatible argument shapes.
 * Single promise completion path only.
 * @param {import("redis").RedisClientType} client
 * @param {string} name
 * @param {unknown[]} args
 */
/**
 * node-redis v4 RESP2 encoder rejects non-string/Buffer args.
 * Legacy code often passes numbers into HSET/HSETNX (offset, ttl).
 */
function stringifyRedisArgs(args) {
  return args.map((a) => {
    if (a === null || a === undefined) {
      return "";
    }
    if (typeof a === "string" || Buffer.isBuffer(a) || typeof a === "number" || typeof a === "boolean") {
      // numbers/bools → string; leave Buffer/string as-is for binary safety where already Buffer
      if (typeof a === "number" || typeof a === "boolean") {
        return String(a);
      }
      return a;
    }
    if (typeof a === "object") {
      // options objects (SET EX etc.) stay objects for dedicated converters
      return a;
    }
    return String(a);
  });
}

async function invokeCommand(client, name, args) {
  const cmd = String(name || "").toLowerCase();
  let callArgs = args.slice();

  if (cmd === "set") {
    callArgs = convertSetArgs(callArgs);
  }
  else if (
    cmd === "hset" ||
    cmd === "hsetnx" ||
    cmd === "hget" ||
    cmd === "hdel" ||
    cmd === "hexists" ||
    cmd === "hincrby"
  ) {
    // hSet(key, field, value) or hSet(key, {field: value})
    if (callArgs.length >= 3 && typeof callArgs[1] !== "object") {
      callArgs = callArgs.map((a, i) =>
        i === 0 ? String(a) : typeof a === "object" && a !== null && !Buffer.isBuffer(a) ? a : String(a),
      );
    }
  }
  else if (cmd === "zrevrange" || cmd === "zrange") {
    // v3: zrevrange key start stop [WITHSCORES]
    // v4: zRevRange(key, start, stop, { REV: true, BY: 'SCORE'? no, WITHSCORES })
    const opts = {};
    if (cmd === "zrevrange") {
      // zRevRange already reverses; keep start/stop
    }
    const last = callArgs[callArgs.length - 1];
    if (typeof last === "string" && last.toUpperCase() === "WITHSCORES") {
      callArgs = callArgs.slice(0, -1);
      opts.WITHSCORES = true;
    }
    if (Object.keys(opts).length) {
      callArgs = [...callArgs, opts];
    }
  }
  else if (cmd === "zadd") {
    // v3: zadd key score member  OR zadd key score member score member ...
    // v4: zAdd(key, { score, value } | array)
    if (callArgs.length >= 3 && typeof callArgs[1] !== "object") {
      const key = callArgs[0];
      const members = [];
      for (let i = 1; i < callArgs.length; i += 2) {
        members.push({
          score: Number(callArgs[i]),
          value: String(callArgs[i + 1]),
        });
      }
      callArgs = members.length === 1 ? [key, members[0]] : [key, members];
    }
  }
  else if (cmd === "zincrby") {
    // v3: zincrby key increment member
    // v4: zIncrBy(key, increment, member)
    // same arity — ok
  }

  const fn = resolveCommand(client, cmd);
  if (!fn) {
    // Raw command fallback
    const upper = cmd.toUpperCase();
    const flat = callArgs.map((a) =>
      a && typeof a === "object" && !Buffer.isBuffer(a)
        ? JSON.stringify(a)
        : typeof a === "number" || typeof a === "boolean"
          ? String(a)
          : a,
    );
    return client.sendCommand([upper, ...flat]);
  }

  // Coerce primitive non-options args for commands that take plain redis values.
  // Keep trailing options objects intact (SET/ZRANGE options).
  if (cmd !== "set" && cmd !== "zrevrange" && cmd !== "zrange" && cmd !== "zadd") {
    callArgs = callArgs.map((a) => {
      if (typeof a === "number" || typeof a === "boolean") {
        return String(a);
      }
      return a;
    });
  }

  return fn(...callArgs);
}

/**
 * Build a multi proxy that accepts v3-style chained commands + exec([cb]).
 * @param {import("redis").RedisClientType} client
 */
function createMultiProxy(client) {
  const multi = client.multi();
  const proxy = new Proxy(
    {
      exec(cb) {
        // Always use promise exec; optionally notify callback once.
        const p = multi.exec();
        if (typeof cb === "function") {
          p.then(
            (data) => cb(null, data),
            (err) => cb(err),
          );
          return undefined;
        }
        return p;
      },
    },
    {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        if (typeof prop !== "string") {
          return undefined;
        }
        const mapped = CMD_MAP[prop] || prop;
        // Queue via multi's camelCase method when possible
        return (...args) => {
          let callArgs = args;
          if (prop === "set" || mapped === "set") {
            callArgs = convertSetArgs(args);
          }
          else if (prop === "zadd" || mapped === "zAdd") {
            if (args.length >= 3 && typeof args[1] !== "object") {
              const key = args[0];
              const members = [];
              for (let i = 1; i < args.length; i += 2) {
                members.push({
                  score: Number(args[i]),
                  value: String(args[i + 1]),
                });
              }
              callArgs =
                members.length === 1 ? [key, members[0]] : [key, members];
            }
          }
          const mfn = multi[mapped] || multi[prop];
          if (typeof mfn === "function") {
            mfn.apply(multi, callArgs);
          }
          else {
            // Fallback: addCommand
            multi.addCommand([
              String(prop).toUpperCase(),
              ...callArgs.map(String),
            ]);
          }
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function createRedisClient(conn) {
  return createClient(mapConnToV4Options(conn));
}

module.exports = {
  mapConnToV4Options,
  convertSetArgs,
  resolveCommand,
  invokeCommand,
  createMultiProxy,
  createRedisClient,
  CMD_MAP,
};
