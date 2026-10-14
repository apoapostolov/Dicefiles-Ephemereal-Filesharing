"use strict";

/** Authorize the request's source room before exposing or mutating its claim. */
async function requireRequestAccess(req, key, requests, authorizeFile) {
  await requests.loaded;
  const request = requests.get(key);
  if (!request) {
    throw Object.assign(new Error("Request not found"), { status: 404 });
  }
  await authorizeFile(req, request);
  return request;
}

module.exports = { requireRequestAccess };
