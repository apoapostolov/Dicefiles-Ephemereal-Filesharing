"use strict";

const {
  mapConnToV4Options,
  convertSetArgs,
  resolveCommand,
  invokeCommand,
} = require("../../lib/broker/redis-client");

describe("redis adapter surface (shipped)", () => {
  test("mapConnToV4Options sets socket defaults without legacyMode", () => {
    const opts = mapConnToV4Options({});
    expect(opts.legacyMode).toBeUndefined();
    expect(opts.socket.host).toBe("127.0.0.1");
    expect(opts.socket.port).toBe(6379);
  });

  test("mapConnToV4Options maps password and db", () => {
    const opts = mapConnToV4Options({
      host: "redis.local",
      port: "6380",
      password: "s3cret",
      db: "2",
    });
    expect(opts.socket.host).toBe("redis.local");
    expect(opts.socket.port).toBe(6380);
    expect(opts.password).toBe("s3cret");
    expect(opts.database).toBe(2);
  });

  test("mapConnToV4Options accepts url", () => {
    const opts = mapConnToV4Options({ url: "redis://localhost:6379/0" });
    expect(opts.url).toBe("redis://localhost:6379/0");
  });

  test("convertSetArgs maps EX/NX v3 style to options object", () => {
    expect(convertSetArgs(["k", "v"])).toEqual(["k", "v"]);
    expect(convertSetArgs(["k", "v", "EX", 30])).toEqual([
      "k",
      "v",
      { EX: 30 },
    ]);
    expect(convertSetArgs(["k", "v", "NX", "EX", 10])).toEqual([
      "k",
      "v",
      { NX: true, EX: 10 },
    ]);
  });

  test("resolveCommand maps hgetall to hGetAll", () => {
    const fake = {
      hGetAll: () => "ok",
      get: () => "g",
    };
    expect(resolveCommand(fake, "hgetall")).toBeTruthy();
    expect(resolveCommand(fake, "get")).toBeTruthy();
    expect(resolveCommand(fake, "nosuch")).toBeNull();
  });

  test("invokeCommand uses pure promise path on mock client", async () => {
    const calls = [];
    const client = {
      set: async (...a) => {
        calls.push(["set", a]);
        return "OK";
      },
      get: async (k) => {
        calls.push(["get", k]);
        return "val";
      },
    };
    await expect(invokeCommand(client, "set", ["k", "v", "EX", 5])).resolves.toBe(
      "OK",
    );
    expect(calls[0][1]).toEqual(["k", "v", { EX: 5 }]);
    await expect(invokeCommand(client, "get", ["k"])).resolves.toBe("val");
  });
});
