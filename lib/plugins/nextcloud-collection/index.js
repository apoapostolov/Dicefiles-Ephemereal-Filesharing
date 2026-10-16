"use strict";

const { XMLParser } = require("fast-xml-parser");
const { defineCollector } = require("../collection/engine");

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];

async function page({ config, connection, net }) {
  const root = new URL(connection.settings.baseUrl);
  if (String(config.folder).split("/").some(part => part === "." || part === "..")) {
    throw Object.assign(new Error("Use a folder inside the approved WebDAV root. Parent path segments are not supported."), { retryable: false });
  }
  const folder = new URL(`${root.href.replace(/\/$/, "")}/${String(config.folder).split("/").filter(Boolean).map(encodeURIComponent).join("/")}/`);
  const allowedUrl = value => {
    const url = new URL(value); return url.origin === root.origin && url.pathname.startsWith(folder.pathname);
  };
  const headers = { "authorization": `Basic ${Buffer.from(`${connection.credentials.username}:${connection.credentials.password}`).toString("base64")}`, "depth": "1", "content-type": "application/xml" };
  const response = await net.response(folder.href, { method: "PROPFIND", headers, body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:displayname/><d:getetag/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>" }, { allowedUrl });
  const xml = await response.text();
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) {
    throw Object.assign(new Error("The WebDAV response contains unsupported entities. Check the server configuration."), { retryable: false });
  }
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false, maxNestedTags: 32 }).parse(xml);
  const entries = list(doc.multistatus?.response).flatMap(item => {
    const props = list(item.propstat).find(stat => /\s200\s/.test(stat.status))?.prop;
    if (!props || props.resourcetype?.collection != null) {
      return [];
    }
    const url = new URL(item.href, root);
    if (!allowedUrl(url)) {
      throw Object.assign(new Error("WebDAV returned an item outside the selected folder. Check the folder grant."), { retryable: false });
    }
    const relative = url.pathname.slice(folder.pathname.length);
    if (!relative || relative.includes("/")) {
      return [];
    }
    return [{ id: url.pathname, name: props.displayname || decodeURIComponent(relative), size: Number(props.getcontentlength), revision: String(props.getetag || ""), open: maxBytes => net.stream(url.href, { headers: { authorization: headers.authorization, ...(props.getetag ? { "if-match": props.getetag } : {}) } }, { maxBytes, allowedUrl }) }];
  });
  return { entries, hasMore: false };
}

module.exports = defineCollector({ id: "nextcloud-collection", name: "Nextcloud Collection", provider: "nextcloud", description: "Collect files from one approved WebDAV folder with ETag revision tracking.", required: ["connectionId"], properties: {
  connectionId: { type: "string", title: "Connection", connectionProvider: "nextcloud" }, folder: { type: "string", title: "Folder", description: "Folder relative to the connection's approved WebDAV root; direct children only" },
}, page });
module.exports.page = page;
