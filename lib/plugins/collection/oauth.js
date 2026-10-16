"use strict";

const { createSign } = require("node:crypto");

const cache = new WeakMap();
const endpoints = {
  drive: "https://oauth2.googleapis.com/token",
  dropbox: "https://api.dropboxapi.com/oauth2/token",
};

async function accessToken(connection, provider, net) {
  const cached = cache.get(connection);
  if (cached && cached.until > Date.now() + 60000) {
    return cached.token;
  }
  const { settings } = connection;
  const stored = await connection.tokens?.read();
  if (stored?.accessToken && stored.expiresAt > Date.now() + 60000) {
    return stored.accessToken;
  }
  const c = { ...connection.credentials, ...(stored?.refreshToken ? { refreshToken: stored.refreshToken } : {}) };
  if (!c.refreshToken && !c.privateKey && c.accessToken) {
    return c.accessToken;
  }
  let endpoint = endpoints[provider];
  const body = new URLSearchParams();
  if (provider === "drive" && c.privateKey && c.clientEmail) {
    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: c.clientEmail, scope: "https://www.googleapis.com/auth/drive.readonly", aud: endpoint, iat: now, exp: now + 3600 })}`;
    const signature = createSign("RSA-SHA256").update(payload).sign(c.privateKey, "base64url");
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"); body.set("assertion", `${payload}.${signature}`);
  }
  else {
    if (!c.refreshToken || !c.clientId) {
      throw Object.assign(new Error("This connection needs a read-only access token or OAuth refresh credentials. Ask the operator to reconnect the provider."), { retryable: false });
    }
    if (provider === "onedrive") {
      const tenant = String(settings.tenant || "consumers");
      if (!/^[a-zA-Z0-9.-]{1,100}$/.test(tenant)) {
        throw Object.assign(new Error("The Microsoft tenant is invalid. Check the connection settings."), { retryable: false });
      }
      endpoint = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    }
    body.set("grant_type", "refresh_token"); body.set("refresh_token", c.refreshToken); body.set("client_id", c.clientId);
    if (c.clientSecret) {
      body.set("client_secret", c.clientSecret);
    }
  }
  const result = await net.json(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }, { maxRedirects: 0 });
  if (typeof result.access_token !== "string") {
    throw Object.assign(new Error("The provider did not issue an access token. Reconnect the account with read-only access."), { retryable: false });
  }
  cache.set(connection, { token: result.access_token, until: Date.now() + Math.min(3600, Number(result.expires_in) || 300) * 1000 });
  await connection.tokens?.write({ accessToken: result.access_token, refreshToken: result.refresh_token || c.refreshToken || "", expiresAt: Date.now() + Math.min(3600, Number(result.expires_in) || 300) * 1000 });
  return result.access_token;
}

function grantFolder(connection, id, key = "folderIds") {
  if (!Array.isArray(connection.settings[key]) || !connection.settings[key].includes(id)) {
    throw Object.assign(new Error("The selected folder is outside this connection's grant. Ask the operator to approve the exact folder."), { retryable: false });
  }
}

module.exports = { accessToken, grantFolder };
