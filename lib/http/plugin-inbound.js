"use strict";

const express = require("express");
const BROKER = require("../broker");
const { Room } = require("../room");
const {
  defaultRoomPluginRuntime,
} = require("../plugins/room-runtime");

const INBOUND_RATE_WINDOW_MS = 60 * 1000;
const INBOUND_RATE_MAX = 120;
const rateLimiter = BROKER.getMethods("ratelimit");

function inboundError(res, status, code, message) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: false, error: { code, message } });
}

function registerPluginInboundRoutes(app, deps) {
  const d = deps || {};
  const getRoom = d.getRoom || (roomId => Room.get(roomId));
  const runtime = d.runtime || defaultRoomPluginRuntime;
  const rate = d.rateLimiter || rateLimiter;
  app.post(
    "/api/plugins/:pluginId/:roomId/inbound",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const pluginId = String(req.params.pluginId || "").
        trim().
        toLowerCase();
      const roomId = String(req.params.roomId || "").trim();
      if (!pluginId || !roomId || !Buffer.isBuffer(req.body)) {
        inboundError(res, 400, "INVALID_REQUEST", "Invalid inbound request");
        return;
      }
      try {
        const [count, ttlMs] = await rate.ratelimit(
          `rl:plugin-inbound:${roomId}:${pluginId}`,
          INBOUND_RATE_WINDOW_MS,
        );
        if (count > INBOUND_RATE_MAX) {
          res.setHeader(
            "Retry-After",
            String(Math.max(1, Math.ceil(Number(ttlMs) / 1000))),
          );
          inboundError(res, 429, "RATE_LIMITED", "Too many inbound requests");
          return;
        }
      }
      catch (error) {
        console.warn(
          "[plugin-inbound] rate limiter unavailable:",
          error && error.message,
        );
      }
      let body;
      try {
        body = JSON.parse(req.body.toString("utf8"));
      }
      catch (_) {
        inboundError(res, 400, "INVALID_JSON", "Invalid JSON body");
        return;
      }
      const room = await getRoom(roomId);
      if (!room) {
        inboundError(res, 404, "NOT_FOUND", "Not found");
        return;
      }
      try {
        const result = await runtime.handleRoomPluginInbound(
          roomId,
          pluginId,
          {
            headers: req.headers || {},
            rawBody: req.body,
            body,
          },
          room.getRoomPlugins(),
        );
        const status = Number(result && result.status) || 200;
        res.status(status);
        for (const [name, value] of Object.entries(
          result && result.headers || {},
        )) {
          res.setHeader(name, value);
        }
        res.json(
          result && Object.prototype.hasOwnProperty.call(result, "body") ?
            result.body :
            { ok: true },
        );
      }
      catch (error) {
        const status = Number(error && error.status) || 401;
        const publicMessage =
          status >= 500 ? "Inbound command failed" : "Unauthorized";
        if (status >= 500) {
          console.error(
            `[plugin-inbound] ${roomId}/${pluginId}:`,
            error && error.message,
          );
        }
        inboundError(
          res,
          status,
          status >= 500 ? "INBOUND_FAILED" : "UNAUTHORIZED",
          publicMessage,
        );
      }
    },
  );
}

module.exports = {
  INBOUND_RATE_WINDOW_MS,
  INBOUND_RATE_MAX,
  registerPluginInboundRoutes,
};
