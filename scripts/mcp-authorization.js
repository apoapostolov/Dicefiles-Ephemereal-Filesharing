"use strict";

const fs = require("fs");

function scopeAllowed(scopes, needed) {
  return scopes.includes("*") || scopes.includes(needed) || scopes.includes(`${needed.split(":")[0]}:*`);
}

function loadOAuthConfig(file) {
  if (!file) {
    return null;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) {
    throw new Error("Invalid MCP OAuth config file");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077)) {
    throw new Error("MCP OAuth config must be private (chmod 600)");
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function createOAuthAuthorization(config, { keySet } = {}) {
  const { requireBearerAuth, OAuthError, OAuthErrorCode } = require("@modelcontextprotocol/server");

  const resource = new URL(config.resource);
  const issuer = new URL(config.issuer);
  const jwks = config.jwks ? new URL(config.jwks) : null;
  if ([resource, issuer, ...(jwks ? [jwks] : [])].some(url => url.protocol !== "https:" || url.username || url.password || url.hash)) {
    throw new Error("MCP OAuth resource, issuer and JWKS must use HTTPS without credentials or fragments");
  }
  if (resource.pathname !== "/mcp" || resource.search) {
    throw new Error("MCP OAuth resource must end in /mcp");
  }
  if (!keySet && !jwks) {
    throw new Error("MCP OAuth JWKS URL is required");
  }
  const metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource/mcp`;
  let josePromise;
  let keys;
  const verifier = {
    async verifyAccessToken(token) {
      try {
        const jose = await (josePromise ||= import("jose"));
        keys ||= keySet || jose.createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000 });
        const { payload } = await jose.jwtVerify(token, keys, {
          issuer: issuer.href, audience: resource.href,
          algorithms: ["RS256", "ES256", "EdDSA"], requiredClaims: ["sub", "exp", "iat"],
          clockTolerance: 5,
        });
        const principal = config.principals && Object.hasOwn(config.principals, payload.sub) ? config.principals[payload.sub] : null;
        if (!principal || !principal.apiKey || !Array.isArray(principal.scopes)) {
          throw new Error("Unknown caller");
        }
        const granted = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
        const scopes = principal.scopes.filter(scope => granted.includes(scope));
        return { token, clientId: payload.sub, scopes, expiresAt: payload.exp, resource, extra: { apiKey: principal.apiKey } };
      }
      catch (_) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      }
    },
  };
  return {
    resource, metadataUrl,
    metadata: { resource: resource.href, authorization_servers: [issuer.href], bearer_methods_supported: ["header"], scopes_supported: [...new Set(Object.values(config.principals || {}).flatMap(p => p.scopes || []))] },
    gate: requireBearerAuth({ verifier, requiredScopes: ["mcp"], expectedResource: resource, resourceMetadataUrl: metadataUrl }),
  };
}

module.exports = { scopeAllowed, loadOAuthConfig, createOAuthAuthorization };
