"use strict";

const { normalizePluginId } = require("./plugin-id");

function createPluginConnections({ getConfig, env = process.env } = {}) {
  const configured = () => getConfig ? getConfig() : require("../config").get("pluginConnections");
  return ({ pluginId, roomId }) => {
    pluginId = normalizePluginId(pluginId);
    const allowed = () => (Array.isArray(configured()) ? configured() : []).filter(connection =>
      connection && /^[a-z0-9][a-z0-9-]{0,63}$/.test(connection.id) && connection.enabled !== false &&
      Array.isArray(connection.pluginIds) && connection.pluginIds.includes(pluginId) &&
      Array.isArray(connection.roomIds) && (connection.roomIds.includes(roomId) || connection.roomIds.includes("*")),
    );
    const find = (id, provider) => {
      const connection = allowed().find(item => item.id === id && (!provider || item.provider === provider));
      if (!connection) {
        throw Object.assign(new Error("This connection is unavailable to this bot and room. Ask the operator to configure its provider and room grant."), { code: "PLUGIN_CONNECTION_UNAVAILABLE", retryable: false });
      }
      return connection;
    };
    const resolve = (id, provider) => {
      const connection = find(id, provider);
      const credentials = {};
      for (const [key, value] of Object.entries(connection.credentials || {})) {
        if (key.endsWith("Env")) {
          const name = String(value || "");
          if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || !env[name]) {
            throw Object.assign(new Error("A connection credential is missing. Ask the operator to check its environment reference and restart the service."), { code: "PLUGIN_CREDENTIAL_MISSING", retryable: false });
          }
          credentials[key.slice(0, -3)] = env[name];
        }
        else if (typeof value === "string") {
          credentials[key] = value;
        }
      }
      return { id: connection.id, provider: connection.provider, credentials, settings: structuredClone(connection.settings || {}), tokens: require("./credential-vault").credentialVault(connection.id, credentials) };
    };
    return Object.freeze({
      list(provider) {
        return allowed().filter(item => !provider || item.provider === provider).map(item => {
          let configured = true;
          try {
            resolve(item.id, item.provider);
          }
          catch (_) {
            configured = false;
          }
          return { id: item.id, provider: item.provider, label: String(item.label || item.id).slice(0, 100), configured };
        });
      },
      resolve,
      settings(id, provider) {
        return structuredClone(find(id, provider).settings || {});
      },
    });
  };
}

module.exports = { createPluginConnections };
