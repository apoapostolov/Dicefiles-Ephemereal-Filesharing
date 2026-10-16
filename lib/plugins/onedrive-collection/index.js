"use strict";

const { defineCollector } = require("../collection/engine");
const { accessToken, grantFolder } = require("../collection/oauth");

const ROOT = "https://graph.microsoft.com/v1.0";

async function page({ config, connection, checkpoint, net }) {
  grantFolder(connection, config.folderId);
  const driveId = String(connection.settings.driveId || "");
  if (!/^[a-zA-Z0-9_!-]{1,200}$/.test(driveId) || !/^[a-zA-Z0-9_!-]{1,200}$/.test(config.folderId)) {
    throw Object.assign(new Error("The drive or folder ID is invalid. Check the approved connection."), { retryable: false });
  }
  const base = `${ROOT}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(config.folderId)}`;
  const headers = { authorization: `Bearer ${await accessToken(connection, "onedrive", net)}` };
  const url = checkpoint.cursor || `${base}/delta?$top=100`;
  if (new URL(url).origin !== "https://graph.microsoft.com" || !new URL(url).pathname.startsWith(new URL(base).pathname)) {
    throw Object.assign(new Error("The saved OneDrive continuation is invalid. Reset the collection checkpoint."), { retryable: false });
  }
  let response;
  try {
    response = await net.json(url, { headers }, { maxRedirects: 0 });
  }
  catch (error) {
    if (error.status === 410) {
      return { entries: [], checkpoint: {}, hasMore: true };
    } throw error;
  }
  const entries = (response.value || []).filter(file => file.id !== config.folderId && (file.file || file.deleted)).map(file => ({
    id: file.id, name: file.name, size: file.size, revision: file.cTag || file.eTag, removed: !!file.deleted,
    open: maxBytes => net.stream(`${ROOT}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(file.id)}/content`, { headers: { ...headers, ...(file.eTag ? { "if-match": file.eTag } : {}) } }, { maxBytes, allowedUrl: url => {
      const host = new URL(url).hostname; return host === "graph.microsoft.com" || host.endsWith(".sharepoint.com") || host.endsWith(".1drv.com") || host.endsWith(".live.com");
    } }),
  }));
  return { entries, checkpoint: { cursor: response["@odata.nextLink"] || response["@odata.deltaLink"] }, hasMore: !!response["@odata.nextLink"] };
}

module.exports = defineCollector({ id: "onedrive-collection", name: "OneDrive Collection", provider: "onedrive", description: "Collect an approved OneDrive folder using Microsoft Graph delta tracking.", required: ["connectionId", "folderId"], properties: {
  connectionId: { type: "string", title: "Connection", connectionProvider: "onedrive" }, folderId: { type: "string", title: "Folder ID" },
}, page });
module.exports.page = page;
