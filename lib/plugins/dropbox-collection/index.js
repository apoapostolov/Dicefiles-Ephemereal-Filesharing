"use strict";

const { defineCollector } = require("../collection/engine");
const { accessToken } = require("../collection/oauth");

const ROOT = "https://api.dropboxapi.com/2/files";

async function page({ config, connection, checkpoint, net }) {
  const folder = config.folder.replace(/\/$/, "").toLocaleLowerCase();
  if (folder && !folder.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(folder) || !connection.settings.paths?.some(path => folder === path.toLocaleLowerCase() || folder.startsWith(`${path.replace(/\/$/, "").toLocaleLowerCase()}/`))) {
    throw Object.assign(new Error("The Dropbox folder is outside this connection's approved paths. Ask the operator to grant the folder."), { retryable: false });
  }
  const headers = { "authorization": `Bearer ${await accessToken(connection, "dropbox", net)}`, "content-type": "application/json" };
  let response;
  try {
    response = await net.json(`${ROOT}/${checkpoint.cursor ? "list_folder/continue" : "list_folder"}`, { method: "POST", headers, body: JSON.stringify(checkpoint.cursor ? { cursor: checkpoint.cursor } : { path: folder, recursive: true, include_deleted: true, limit: 100 }) });
  }
  catch (error) {
    if (error.status === 409 && checkpoint.cursor) {
      return { entries: [], checkpoint: {}, hasMore: true };
    } throw error;
  }
  const entries = (response.entries || []).filter(file => file[".tag"] !== "folder" && (file.path_lower === folder || file.path_lower?.startsWith(`${folder}/`))).map(file => ({
    id: file.id || file.path_lower, name: file.name, size: file.size, revision: file.rev || file.content_hash, removed: file[".tag"] === "deleted",
    open: maxBytes => net.stream("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: { "authorization": headers.authorization, "dropbox-api-arg": JSON.stringify({ path: file.id, rev: file.rev }) } }, { maxBytes, maxRedirects: 0 }),
  }));
  return { entries, checkpoint: { cursor: response.cursor }, hasMore: !!response.has_more };
}

module.exports = defineCollector({ id: "dropbox-collection", name: "Dropbox Collection", provider: "dropbox", description: "Collect an approved Dropbox folder and follow revision-aware cursor updates.", required: ["connectionId"], properties: {
  connectionId: { type: "string", title: "Connection", connectionProvider: "dropbox" }, folder: { type: "string", title: "Folder", description: "Approved path, such as /Community; empty for a separately granted app root" },
}, page });
module.exports.page = page;
