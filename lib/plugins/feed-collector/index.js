"use strict";

const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { defineCollector } = require("../collection/engine");
const { approvedUrl } = require("../collection/network");

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === "object" ? String(value?.["#text"] || "") : String(value || "");

function parseFeed(xml, base, allowedOrigins, enclosures, net) {
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw Object.assign(new Error("Feed XML is invalid or uses unsupported document entities. Use a valid RSS or Atom feed."), { retryable: false });
  }
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false, removeNSPrefix: true, maxNestedTags: 32 });
  const doc = parser.parse(xml);
  const entries = list(doc.feed?.entry || doc.rss?.channel?.item || doc.RDF?.item);
  if (entries.length > 500) {
    throw Object.assign(new Error("Feed contains more than 500 entries. Choose a smaller feed."), { retryable: false });
  }
  return entries.flatMap(entry => {
    const links = list(entry.link); const alternate = links.find(link => typeof link === "object" && (!link["@_rel"] || link["@_rel"] === "alternate"));
    const url = text(alternate?.["@_href"] || links.find(link => typeof link === "string") || "");
    const id = text(entry.id || entry.guid || url); if (!id || !url) {
      return [];
    }
    const title = text(entry.title).replace(/<[^>]*>/g, "").trim() || "Feed entry";
    const output = [{ id, revision: "", name: title, kind: "link", url: approvedUrl(url, allowedOrigins, base) }];
    if (enclosures) {
      for (const item of [...list(entry.enclosure), ...links.filter(link => link["@_rel"] === "enclosure")].slice(0, 5)) {
        const href = approvedUrl(item["@_url"] || item["@_href"], allowedOrigins, base);
        output.push({ id: `${id}:${href}`, revision: String(item["@_length"] || ""), name: decodeURIComponent(new URL(href).pathname.split("/").pop() || title), size: Number(item["@_length"]) || 0,
          open: maxBytes => net.stream(href, {}, { maxBytes, allowedUrl: url => approvedUrl(url, allowedOrigins) }) });
      }
    }
    return output;
  });
}

module.exports = defineCollector({ id: "feed-collector", name: "Feed Collector", provider: "feed", description: "Collect links from approved RSS and Atom feeds, with optional enclosure imports.",
  required: ["feedUrl", "allowedOrigins"], properties: {
    feedUrl: { type: "string", title: "Feed URL" },
    allowedOrigins: { type: "array", title: "Allowed origins", description: "Exact origins for the feed, links and enclosures, for example https://example.org", multiline: true },
    importEnclosures: { type: "boolean", title: "Import enclosures", description: "Also download approved feed attachments" },
  },
  async page({ config, checkpoint, net }) {
    const url = approvedUrl(config.feedUrl, config.allowedOrigins);
    const response = await net.response(url, { headers: { ...(checkpoint.etag ? { "if-none-match": checkpoint.etag } : {}), ...(checkpoint.modified ? { "if-modified-since": checkpoint.modified } : {}) } }, { allowedUrl: value => approvedUrl(value, config.allowedOrigins) });
    if (response.status === 304) {
      return { entries: [], checkpoint, hasMore: false };
    }
    const entries = parseFeed(await response.text(), url, config.allowedOrigins, config.importEnclosures, net);
    return { entries, checkpoint: { etag: response.headers.get("etag") || "", modified: response.headers.get("last-modified") || "" }, hasMore: false };
  },
});
module.exports.parseFeed = parseFeed;
