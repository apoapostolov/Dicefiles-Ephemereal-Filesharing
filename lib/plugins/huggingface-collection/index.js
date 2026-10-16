"use strict";

const { defineCollector } = require("../collection/engine");

async function page({ config, connection, net, checkpoint }) {
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(config.repository) || !/^[a-f0-9]{40}$/i.test(config.revision)) {
    throw Object.assign(new Error("Choose an owner/repository and a full 40-character commit revision. Branch names are not pinned releases."), { retryable: false });
  }
  if (connection.credentials.accessToken && !connection.settings.repositories?.includes(config.repository)) {
    throw Object.assign(new Error("This repository is outside the token connection's grant. Ask the operator to approve it."), { retryable: false });
  }
  const token = connection.credentials.accessToken;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const base = `https://huggingface.co/api/${config.repositoryType}/${config.repository}/tree/${config.revision}`;
  const url = checkpoint.cursor || `${base}?recursive=true&expand=false&limit=100`;
  if (!url.startsWith(`${base}?`)) {
    throw Object.assign(new Error("The saved repository page is invalid. Reset the collection checkpoint."), { retryable: false });
  }
  const response = await net.response(url, { headers });
  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("The repository response is invalid. Check its access permissions.");
  }
  const entries = rows.filter(file => file.type === "file" && config.files.includes(file.path)).map(file => ({
    id: file.path, name: file.path.split("/").pop(), size: file.lfs?.size || file.size, revision: `${config.revision}:${file.lfs?.oid || file.oid}`, license: config.license,
    open: maxBytes => net.stream(`https://huggingface.co/${config.repositoryType === "datasets" ? "datasets/" : ""}${config.repository}/resolve/${config.revision}/${file.path.split("/").map(encodeURIComponent).join("/")}`, { headers }, { maxBytes, allowedUrl: url => {
      const host = new URL(url).hostname; return host === "huggingface.co" || host.endsWith(".huggingface.co") || host.endsWith(".hf.co");
    } }),
  }));
  const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") || "")?.[1];
  return { entries, checkpoint: { cursor: next || "" }, hasMore: !!next };
}

module.exports = defineCollector({ id: "huggingface-collection", name: "Dataset Releases", provider: "huggingface", description: "Collect explicitly selected model or dataset files at a pinned Hub commit. Gated access requires an approved token.", required: ["repository", "revision", "files"], properties: {
  connectionId: { type: "string", title: "Connection (optional)", connectionProvider: "huggingface" }, repositoryType: { type: "string", title: "Repository type", enum: ["datasets", "models"], default: "datasets" }, repository: { type: "string", title: "Repository", description: "owner/repository" }, revision: { type: "string", title: "Commit revision" }, files: { type: "array", title: "Selected file paths", multiline: true }, license: { type: "string", title: "License", description: "Record the repository license; review its terms before collecting" },
}, page });
module.exports.page = page;
