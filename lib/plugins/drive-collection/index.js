"use strict";

const { defineCollector } = require("../collection/engine");
const { accessToken, grantFolder } = require("../collection/oauth");

const ROOT = "https://www.googleapis.com/drive/v3";
const fields = "id,name,size,version,md5Checksum,modifiedTime,mimeType,parents,trashed";

async function page({ config, connection, checkpoint, net }) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(config.folderId)) {
    throw Object.assign(new Error("Choose a valid Google Drive folder ID."), { retryable: false });
  }
  grantFolder(connection, config.folderId);
  const headers = { authorization: `Bearer ${await accessToken(connection, "drive", net)}` };
  let response; let next;
  const query = new URLSearchParams({ pageSize: "100", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  if (checkpoint.changeToken) {
    query.set("pageToken", checkpoint.changeToken); query.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,file(${fields}))`);
    try {
      response = await net.json(`${ROOT}/changes?${query}`, { headers });
    }
    catch (error) {
      if (error.status === 410) {
        return { entries: [], checkpoint: {}, hasMore: true };
      } throw error;
    }
    const tracked = checkpoint.tracked || [];
    response.files = (response.changes || []).flatMap(change => change.removed || change.file?.trashed ? tracked.includes(change.fileId) ? [{ id: change.fileId, removed: true }] : [] : change.file?.parents?.includes(config.folderId) ? [change.file] : []);
    next = { changeToken: response.nextPageToken || response.newStartPageToken || checkpoint.changeToken, tracked: [...new Set([...tracked, ...response.files.filter(file => !file.removed).map(file => file.id)])].slice(-100) };
  }
  else {
    const start = checkpoint.startToken || (await net.json(`${ROOT}/changes/startPageToken?supportsAllDrives=true`, { headers })).startPageToken;
    query.set("q", `'${config.folderId}' in parents and trashed = false`); query.set("fields", `nextPageToken,files(${fields})`);
    if (checkpoint.cursor) {
      query.set("pageToken", checkpoint.cursor);
    }
    response = await net.json(`${ROOT}/files?${query}`, { headers });
    const tracked = [...new Set([...(checkpoint.tracked || []), ...(response.files || []).map(file => file.id)])].slice(-100);
    next = response.nextPageToken ? { startToken: start, cursor: response.nextPageToken, tracked } : { changeToken: start, tracked };
  }
  const entries = (response.files || []).filter(file => file.removed || !String(file.mimeType).startsWith("application/vnd.google-apps.")).map(file => ({
    id: file.id, name: file.name, size: Number(file.size), removed: file.removed, revision: `${file.version}:${file.md5Checksum || file.modifiedTime}`,
    open: maxBytes => net.stream(`${ROOT}/files/${encodeURIComponent(file.id)}?alt=media`, { headers }, { maxBytes, allowedUrl: url => new URL(url).origin === "https://www.googleapis.com" }),
  }));
  return { entries, checkpoint: next, hasMore: !!response.nextPageToken };
}

module.exports = defineCollector({ id: "drive-collection", name: "Google Drive Collection", provider: "drive", description: "Collect binary files from an approved Drive folder and follow changes. Native Google documents are excluded.", required: ["connectionId", "folderId"], properties: {
  connectionId: { type: "string", title: "Connection", connectionProvider: "drive" }, folderId: { type: "string", title: "Folder ID" },
}, page });
module.exports.page = page;
