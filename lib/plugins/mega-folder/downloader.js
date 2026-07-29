"use strict";

/**
 * Mega.nz folder downloader adapter for the mega-folder plugin.
 *
 * Uses the optional `megajs` package when installed. Unit tests inject a fake
 * megaDownloader instead; production `startAll` wires createMegaDownloader().
 *
 * Contract:
 *   listFolder(folderUrl, credentials) →
 *     Promise<Array<{ name, size, isDir?, download?: () => Promise<Buffer> }>>
 */

/**
 * Try to load megajs without making it a hard dependency of the server boot.
 * @returns {object|null}
 */
function tryRequireMegajs() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    return require("megajs");
  }
  catch (_) {
    return null;
  }
}

/**
 * Collect file entries from a loaded megajs File (folder).
 * @param {object} node — megajs File
 * @param {string} [prefix]
 * @returns {Array<object>}
 */
function flattenEntries(node, prefix) {
  const out = [];
  if (!node) {
    return out;
  }
  const children = node.children || (node.directory && node.children) || null;
  if (!Array.isArray(children)) {
    // Single file link
    if (node.name && !node.directory) {
      out.push(makeEntry(node, prefix));
    }
    return out;
  }
  for (const child of children) {
    if (!child || !child.name) {
      continue;
    }
    const pathName = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.directory) {
      out.push({
        name: pathName,
        size: 0,
        isDir: true,
      });
      // One level of nesting is enough for folder import; recurse shallow dirs
      out.push(...flattenEntries(child, pathName));
    }
    else {
      out.push(makeEntry(child, prefix));
    }
  }
  return out;
}

function makeEntry(fileNode, prefix) {
  const name = prefix ? `${prefix}/${fileNode.name}` : fileNode.name;
  const sourceId =
    fileNode.nodeId ||
    (Array.isArray(fileNode.downloadId) ?
      fileNode.downloadId.join("/") :
      fileNode.downloadId) ||
    fileNode.handle ||
    "";
  return {
    name,
    size: typeof fileNode.size === "number" ? fileNode.size : undefined,
    sourceId: sourceId ? String(sourceId) : undefined,
    isDir: false,
    openStream() {
      if (typeof fileNode.download !== "function") {
        return null;
      }
      const stream = fileNode.download();
      return stream && typeof stream.pipe === "function" ? stream : null;
    },
    async download() {
      if (typeof fileNode.downloadBuffer === "function") {
        return fileNode.downloadBuffer();
      }
      if (typeof fileNode.download === "function") {
        return new Promise((resolve, reject) => {
          const chunks = [];
          const stream = fileNode.download();
          if (stream && typeof stream.on === "function") {
            stream.on("data", c => chunks.push(c));
            stream.on("end", () => resolve(Buffer.concat(chunks)));
            stream.on("error", reject);
            return;
          }
          // download() may return a Promise<Buffer> in some megajs versions
          Promise.resolve(stream).
            then(buf => {
              if (Buffer.isBuffer(buf)) {
                resolve(buf);
              }
              else if (buf && typeof buf.on === "function") {
                const parts = [];
                buf.on("data", c => parts.push(c));
                buf.on("end", () => resolve(Buffer.concat(parts)));
                buf.on("error", reject);
              }
              else {
                reject(new Error("megajs download returned unsupported type"));
              }
            }).
            catch(reject);
        });
      }
      throw new Error("megajs File has no download / downloadBuffer");
    },
  };
}

/**
 * Create a megaDownloader that uses megajs when available.
 * @param {{megajs?: object|null, requireMegajs?: () => object|null}} [opts]
 * @returns {{listFolder: Function, sdkAvailable: boolean, sdkName: string}}
 */
function createMegaDownloader(opts) {
  const load =
    opts && typeof opts.requireMegajs === "function" ?
      opts.requireMegajs :
      tryRequireMegajs;
  const mega = opts && opts.megajs !== undefined ? opts.megajs : load();

  return {
    sdkAvailable: !!mega,
    sdkName: mega ? "megajs" : "none",
    /**
     * @param {string} folderUrl
     * @param {{email?: string, password?: string}} [credentials]
     */
    async listFolder(folderUrl, credentials) {
      if (!mega) {
        throw new Error(
          "mega-folder: megajs is not installed. Add optional dependency `megajs` (yarn add megajs) or inject ctx.megaDownloader for tests.",
        );
      }
      const File = mega.File || (mega.default && mega.default.File);
      if (!File || typeof File.fromURL !== "function") {
        throw new Error("mega-folder: megajs.File.fromURL is unavailable");
      }

      const creds = credentials || {};
      // Public folder/file links
      if (!creds.email) {
        const file = File.fromURL(folderUrl);
        if (typeof file.loadAttributes === "function") {
          await file.loadAttributes();
        }
        return flattenEntries(file);
      }

      // Account-backed folder: log in then resolve URL within storage
      const Storage = mega.Storage || (mega.default && mega.default.Storage);
      if (!Storage) {
        throw new Error(
          "mega-folder: account login requires megajs.Storage (upgrade megajs)",
        );
      }
      const storage = new Storage({
        email: creds.email,
        password: creds.password || "",
      });
      if (storage.ready && typeof storage.ready.then === "function") {
        await storage.ready;
      }
      else if (typeof storage.login === "function") {
        await storage.login();
      }
      const file = File.fromURL(folderUrl);
      // Attach storage when API supports it
      if (storage && file) {
        file.storage = storage;
      }
      if (typeof file.loadAttributes === "function") {
        await file.loadAttributes();
      }
      return flattenEntries(file);
    },
  };
}

module.exports = {
  createMegaDownloader,
  tryRequireMegajs,
  flattenEntries,
};
