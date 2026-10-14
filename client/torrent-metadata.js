"use strict";

import Modal from "./modal";
import { dom, toPrettySize } from "./util";

export class TorrentMetadataModal extends Modal {
  constructor(torrent, name, downloadUrl) {
    super("torrent", "Torrent details", { text: "Close", cancel: true });
    this.body.appendChild(dom("h3", { text: torrent.name || name }));
    if (torrent.imageDataUrl?.startsWith("data:image/jpeg;base64,")) {
      this.body.appendChild(dom("img", { classes: ["torrent-cover"], attrs: { src: torrent.imageDataUrl, alt: `Cover for ${torrent.name || name}` } }));
    }
    const summary = dom("p", { text: torrent.metadataStatus === "link-only" ? "This magnet contains link metadata only. Upload the matching .torrent file to see its file list. Open it in your torrent application to download the content." : `${torrent.fileCount || torrent.files?.length || 0} files · ${toPrettySize(torrent.totalSize || 0)} · ${torrent.private ? "Private torrent" : "Public torrent"}` });
    this.body.appendChild(summary);
    const actions = dom("div", { classes: ["torrent-actions"] });
    if (torrent.magnet?.startsWith("magnet:?")) {
      actions.appendChild(dom("a", { text: "Open magnet in torrent application", attrs: { href: torrent.magnet, rel: "noreferrer" } }));
    }
    if (downloadUrl) {
      actions.appendChild(dom("a", { text: "Download metadata file", attrs: { href: downloadUrl, download: name } }));
    }
    this.body.appendChild(actions);
    const list = dom("dl", { classes: ["torrent-fields"] });
    for (const [key, value] of Object.entries(torrent)) {
      if (["files", "imageDataUrl", "magnet"].includes(key) || value === null || value === "" || typeof value === "object" && !Object.keys(value).length) {
        continue;
      }
      list.appendChild(dom("dt", { text: key.replace(/([a-z])([A-Z])/g, "$1 $2") }));
      list.appendChild(dom("dd", { text: typeof value === "object" ? JSON.stringify(value, null, 2) : String(value) }));
    }
    this.body.appendChild(list);
    if (torrent.files?.length) {
      const details = dom("details");
      details.appendChild(dom("summary", { text: `File list (${torrent.files.length})` }));
      details.appendChild(dom("pre", { text: torrent.files.map(file => `${file.path}  —  ${toPrettySize(file.size)}${file.attributes ? ` [${file.attributes}]` : ""}${file.piecesRoot ? `\n  Pieces root: ${file.piecesRoot}` : ""}`).join("\n") }));
      this.body.appendChild(details);
    }
  }
}
