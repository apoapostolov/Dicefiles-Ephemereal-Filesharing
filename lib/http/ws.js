"use strict";

const cookie = require("cookie");
const sio = require("socket.io");

/**
 * Bind Socket.IO to an HTTP(S) server.
 * @param {import("http").Server} server
 * @param {object} deps
 * @param {typeof import("../room").Room} deps.Room
 * @param {typeof import("../user").User} deps.User
 * @param {typeof import("../client").Client} deps.Client
 * @param {(req: any) => string} deps.rtoken
 */
function setupWS(server, deps) {
  const { Room, User, Client, rtoken } = deps;
  const io = sio(server, {
    path: "/w",
    transports: ["websocket"],
    serveClient: false,
    pingInterval: 10000,
    pingTimeout: 10000,
  });

  io.use(async (socket, next) => {
    socket.handshake.cookies = cookie.parse(
      socket.handshake.headers.cookie || "",
    );
    if (!socket.handshake.cookies.kft) {
      next(new Error("Invalid kft"));
      return;
    }
    const { roomid } = socket.handshake.query;
    socket.room = await Room.get(roomid);
    if (!socket.room) {
      next(new Error("Invalid room"));
      return;
    }
    if (socket.room.config.get("inviteonly")) {
      const user =
        socket.handshake.cookies.session &&
        (await User.load(socket.handshake.cookies.session));
      if (!user || user.role !== "mod") {
        const token = rtoken(socket.handshake);
        const guestInvite =
          (socket.handshake.query &&
            (socket.handshake.query.invite ||
              socket.handshake.query.guestInvite)) ||
          "";
        if (!socket.room.invited(user, token, guestInvite)) {
          next(new Error("You're not invited!"));
          return;
        }
        if (guestInvite && !socket.room.hasGuestPass(token)) {
          const redeemed = socket.room.redeemGuestInviteToken(
            guestInvite,
            token,
          );
          if (!redeemed.ok && !socket.room.hasGuestPass(token)) {
            next(new Error("Invite link is invalid or exhausted"));
            return;
          }
        }
      }
    }
    next();
  });

  io.on("connection", function (socket) {
    Client.create(socket, rtoken(socket.handshake));
  });

  return io;
}

module.exports = { setupWS };
