"use strict";

const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  createRedisClient,
  invokeCommand,
  createMultiProxy,
} = require("./redis-client");

const CONN = {};
require("../config").forEach((v, k) => {
  if (!k.startsWith("redis_")) {
    return;
  }
  CONN[k.slice("redis_".length)] = v;
});

const PUB = createRedisClient(CONN);
PUB.on("error", (err) => {
  console.error("[redis] pub error", err && err.message ? err.message : err);
});

/** @type {Map<string, {sha: string, arity: number, src: string}>} */
const SCRIPT_REG = new Map();

// Synchronously register Lua script helper names (needed at require-time).
(function registerLuaHelpers() {
  const dir = path.join(__dirname, "redis");
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const file of fs.readdirSync(dir).map((e) => path.join(dir, e))) {
    const p = path.parse(file);
    if (p.ext !== ".lua") {
      continue;
    }
    const m = p.name.match(/^([a-z]+)-(\d+)$/);
    if (!m) {
      throw new Error(`bad script name: ${p.name}`);
    }
    const name = m[1];
    const arity = parseInt(m[2], 10);
    if (!Number.isFinite(arity) || arity < 0) {
      throw new Error(`bad script arity: ${p.name}`);
    }
    const src = fs.readFileSync(file, { encoding: "utf-8" });
    if (!src) {
      throw new Error(`bad source: ${file}`);
    }
    const sum = crypto.createHash("sha1").update(src).digest("hex");
    SCRIPT_REG.set(name, { sha: sum, arity, src });

    // Fire-and-forget or promise helper used by DistributedMap/Set.
    Object.defineProperty(PUB, name, {
      value(...args) {
        const last = args[args.length - 1];
        const hasCb = typeof last === "function";
        const callArgs = hasCb ? args.slice(0, -1) : args;
        const cb = hasCb ? last : null;
        const meta = SCRIPT_REG.get(name);
        if (!meta || callArgs.length < meta.arity) {
          const err = new Error(`not enough args for ${name}`);
          if (cb) {
            cb(err);
            return undefined;
          }
          throw err;
        }
        const keys = callArgs.slice(0, meta.arity).map(String);
        const argv = callArgs.slice(meta.arity).map((a) =>
          a === undefined || a === null ? "" : String(a),
        );

        const run = async () => {
          await ensureConnected();
          const sha = SCRIPT_REG.get(name).sha;
          return PUB.evalSha(sha, { keys, arguments: argv });
        };

        if (cb) {
          // Exactly one completion path: promise → single callback.
          run().then(
            (data) => cb(null, data),
            (err) => cb(err),
          );
          return undefined;
        }
        // Collections call without callback (fire-and-forget).
        run().catch((err) => {
          console.error(
            `[redis] ${name} failed`,
            err && err.message ? err.message : err,
          );
        });
        return undefined;
      },
      enumerable: true,
      configurable: true,
    });
  }
})();

let connectPromise = null;

function ensureConnected() {
  if (!connectPromise) {
    connectPromise = (async () => {
      if (!PUB.isOpen) {
        await PUB.connect();
      }
      for (const [name, meta] of SCRIPT_REG.entries()) {
        const loaded = await PUB.scriptLoad(meta.src);
        meta.sha = String(loaded || meta.sha);
        SCRIPT_REG.set(name, meta);
      }
      return SCRIPT_REG;
    })().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }
  return connectPromise;
}

// Kick off connection as soon as the module loads.
ensureConnected().catch((err) => {
  console.error(
    "[redis] initial connect failed",
    err && err.message ? err.message : err,
  );
});

class Broker extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);

    const sub = PUB.duplicate();
    sub.on("error", (err) => {
      console.error(
        "[redis] sub error",
        err && err.message ? err.message : err,
      );
    });
    const subs = new Map();
    let subReady = null;

    const ensureSub = () => {
      if (!subReady) {
        subReady = ensureConnected().then(async () => {
          if (!sub.isOpen) {
            await sub.connect();
          }
        });
      }
      return subReady;
    };

    // node-redis v4: message event is (message, channel) when using subscribe listeners,
    // but the EventEmitter style with .on('message') may differ. Use subscribe callback form.
    this._sub = sub;
    this._subs = subs;
    this._ensureSub = ensureSub;

    // For pmessage/keyspace we still need the message event
    sub.on("message", (channel, message) => {
      // v4 duplicate client: ('message', channel, message) in some versions;
      // handle both orderings if message looks like JSON array.
      let ch = channel;
      let msg = message;
      if (typeof channel === "string" && channel.startsWith("[")) {
        // swapped
        msg = channel;
        ch = message;
      }
      try {
        const parsed = JSON.parse(msg);
        super.emit(ch, ...parsed);
      }
      catch (ex) {
        console.error("[redis] bad pubsub message", ch, ex);
      }
    });

    sub.on("pmessage", (pattern, _channel, event) => {
      super.emit(pattern, event);
    });

    this.on("newListener", (event) => {
      if (event === "newListener" || event === "removeListener") {
        return;
      }
      let count = subs.get(event) || 0;
      if (count) {
        subs.set(event, ++count);
        return;
      }
      subs.set(event, 1);
      ensureSub().
        then(async () => {
          if (event.startsWith("__keyspace*__:")) {
            console.debug("psub", event);
            await PUB.configSet("notify-keyspace-events", "KEA").catch(() => {});
            await sub.pSubscribe(event, (message, channel) => {
              super.emit(event, message);
              void channel;
            });
          }
          else {
            console.debug("sub", event);
            await sub.subscribe(event, (message, channel) => {
              // Prefer direct emit from subscribe callback (v4 primary path).
              try {
                const parsed = JSON.parse(message);
                super.emit(channel || event, ...parsed);
              }
              catch (ex) {
                console.error("[redis] bad sub message", event, ex);
              }
            });
          }
        }).
        catch((err) => {
          console.error("[redis] subscribe failed", event, err);
        });
    });

    this.on("removeListener", (event) => {
      let count = (subs.get(event) || 0);
      --count;
      if (count > 0) {
        subs.set(event, count);
        return;
      }
      subs.delete(event);
      ensureSub().
        then(async () => {
          try {
            if (event.startsWith("__keyspace*__:")) {
              await sub.pUnsubscribe(event);
            }
            else {
              await sub.unsubscribe(event);
            }
          }
          catch (_e) {
            // ignore
          }
        }).
        catch(() => {});
    });
  }

  onKey(key, listener) {
    this.on(`__keyspace*__:${key}`, listener);
  }

  removeKeyListener(key, listener) {
    this.removeListener(`__keyspace*__:${key}`, listener);
  }

  emit(event, ...args) {
    if (event === "newListener" || event === "removeListener") {
      return super.emit(event, ...args);
    }
    const payload = JSON.stringify(args);
    ensureConnected().
      then(() => PUB.publish(event, payload)).
      catch((err) => {
        console.error("[redis] publish failed", event, err);
      });
    return true;
  }

  /**
   * Return a promisified redis command (single promise path, no callback mix).
   * @param {string} m
   */
  getMethod(m) {
    if (m === "multi") {
      return () => {
        // multi requires connected client
        if (!PUB.isOpen) {
          // Synchronously wrapping is hard — return a deferred multi.
          const pending = [];
          let real = null;
          const proxy = {
            exec(cb) {
              return ensureConnected().then(() => {
                real = real || createMultiProxy(PUB);
                for (const [method, args] of pending) {
                  real[method](...args);
                }
                pending.length = 0;
                return real.exec(cb);
              });
            },
          };
          return new Proxy(proxy, {
            get(target, prop) {
              if (prop in target) {
                return target[prop];
              }
              return (...args) => {
                if (real) {
                  real[prop](...args);
                }
                else {
                  pending.push([prop, args]);
                }
                return proxy;
              };
            },
          });
        }
        return createMultiProxy(PUB);
      };
    }

    // Custom Lua helpers on PUB
    if (SCRIPT_REG.has(m)) {
      return async (...args) => {
        await ensureConnected();
        const meta = SCRIPT_REG.get(m);
        const keys = args.slice(0, meta.arity).map(String);
        const argv = args.slice(meta.arity).map((a) =>
          a === undefined || a === null ? "" : String(a),
        );
        return PUB.evalSha(meta.sha, { keys, arguments: argv });
      };
    }

    return async (...args) => {
      await ensureConnected();
      return invokeCommand(PUB, m, args);
    };
  }

  getMethods(...methods) {
    const rv = Object.create(null);
    for (const m of methods) {
      rv[m] = this.getMethod(m);
    }
    return rv;
  }

  /** @returns {Promise<void>} */
  ready() {
    return ensureConnected().then(() => undefined);
  }
}

const BROKER = new Broker();
BROKER.PUB = PUB;
BROKER.ensureConnected = ensureConnected;
module.exports = BROKER;
