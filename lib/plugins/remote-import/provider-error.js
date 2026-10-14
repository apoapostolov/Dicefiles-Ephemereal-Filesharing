"use strict";

class RemoteProviderError extends Error {
  constructor(code, { status, retryAfterMs = 0 } = {}) {
    super(`Remote provider: ${code}`);
    this.code = code;
    this.status = status;
    this.retryAfterMs = Math.min(300000, Math.max(0, retryAfterMs));
    this.retryable = ["RATE_LIMITED", "TEMPORARILY_UNAVAILABLE", "TIMEOUT"].includes(code);
  }
}

function responseError(response) {
  const {status} = response;
  const retryAfter = response.headers && response.headers.get("retry-after");
  const retryAfterMs = /^\d+$/.test(retryAfter || "") ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
  return new RemoteProviderError(status === 401 ? "AUTH_REQUIRED" : status === 403 ? "AUTH_REJECTED" : status === 404 ? "NOT_FOUND" : status === 429 ? "RATE_LIMITED" : status >= 500 ? "TEMPORARILY_UNAVAILABLE" : "RESPONSE_INVALID", { status, retryAfterMs });
}

module.exports = { RemoteProviderError, responseError };
