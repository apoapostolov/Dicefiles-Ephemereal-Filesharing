"use strict";

function captureAuthentication(socket) {
  socket.authState = null;
  socket.on("authed", account => {
    socket.authState = account || false;
  });
}

function applyAuthentication(body, account) {
  body.classList.toggle("authed", !!account);
  body.classList.toggle("unauthed", !account);
}

module.exports = { captureAuthentication, applyAuthentication };
