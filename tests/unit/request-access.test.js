"use strict";

const { requireRequestAccess } = require("../../lib/http/request-access");

describe("request claim authorization", () => {
  test("waits for restoration before resolving the source room", async () => {
    let restored = false;
    const request = { roomid: "protected" };
    const requests = {
      loaded: Promise.resolve().then(() => {
        restored = true;
      }),
      get: jest.fn(() => {
        expect(restored).toBe(true); return request;
      }),
    };
    const req = { automationKeyScopes: ["requests:write"] };
    const authorize = jest.fn().mockRejectedValue(Object.assign(new Error("Protected"), { status: 403 }));
    await expect(requireRequestAccess(req, "r1", requests, authorize)).rejects.toMatchObject({ status: 403 });
    expect(authorize).toHaveBeenCalledWith(req, request);
  });

  test("allows a claim only after authorization succeeds", async () => {
    const request = { roomid: "public" };
    const authorize = jest.fn().mockResolvedValue();
    await expect(requireRequestAccess({}, "r1", {
      loaded: Promise.resolve(), get: () => request,
    }, authorize)).resolves.toBe(request);
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  test("returns 404 for missing requests", async () => {
    const authorize = jest.fn();
    await expect(requireRequestAccess({}, "missing", {
      loaded: Promise.resolve(), get: () => null,
    }, authorize)).rejects.toMatchObject({ status: 404 });
    expect(authorize).not.toHaveBeenCalled();
  });
});
