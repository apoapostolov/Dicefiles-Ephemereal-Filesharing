"use strict";

/**
 * Owner/mod setconfig socket RPC reply path.
 *
 * Client makeCall("setconfig", name, arg) waits on event `setconfig-${name}` and
 * resolves with the payload. Success with a return value (createGuestInvite,
 * listGuestInvites, linkedRooms, …) MUST emit that value — not a bare event —
 * or the UI receives undefined.
 *
 * @param {object} socket — socket.io-like { emit(event, payload?) }
 * @param {string} name — config key / RPC name
 * @param {unknown} rv — return value from setConfig (undefined = void)
 */
function emitSetConfigResult(socket, name, rv) {
  const event = `setconfig-${name}`;
  if (rv === undefined) {
    socket.emit(event);
  } else {
    socket.emit(event, rv);
  }
}

/**
 * Run setConfig and emit the makeCall reply (success payload or { err }).
 * Mirrors Client.onsetconfig so unit tests can drive the real reply path
 * without constructing a full Client (Redis / nicknames / channels).
 *
 * @param {(name: string, arg: unknown) => Promise<unknown>|unknown} setConfigFn
 * @param {object} socket
 * @param {string} name
 * @param {unknown} arg
 * @returns {Promise<void>}
 */
async function runSetConfigRpc(setConfigFn, socket, name, arg) {
  try {
    const rv = await setConfigFn(name, arg);
    emitSetConfigResult(socket, name, rv);
  } catch (ex) {
    socket.emit(`setconfig-${name}`, {
      err: (ex && ex.message) || String(ex),
    });
  }
}

module.exports = {
  emitSetConfigResult,
  runSetConfigRpc,
};
