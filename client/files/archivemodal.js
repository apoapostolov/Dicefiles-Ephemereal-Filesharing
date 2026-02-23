"use strict";

/**
 * Archive viewer modal.
 *
 * Opens when the user clicks on an archive file (.zip, .rar, .7z, .001, etc.).
 * Shows a two-panel layout:
 *   Left  — folder tree with checkboxes (select folder → selects all its files)
 *   Right — flat file list for selected folders, with per-file checkboxes
 *
 * "Download Selected" opens the existing DownloadBatchModal with synthetic
 * file objects that point to /api/v1/archive/:key/file?path=<encoded-path>.
 */

import Modal from "../modal";
import registry from "../registry";
import { dom, nukeEvent, toPrettySize } from "../util";
import DownloadBatchModal from "./downloadmodal";

// Extensions that can be inline-previewed on hover
const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
  ".svg",
]);

function isImageEntry(filePath) {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTS.has(filePath.slice(dot).toLowerCase());
}

// ── Folder-tree helpers ───────────────────────────────────────────────────────

/**
 * Build a tree from a flat listing.
 * Each node: { name, fullPath, children: Map<string, node>, files: entry[] }
 */
function buildTree(files) {
  const root = { name: "", fullPath: "", children: new Map(), files: [] };

  for (const entry of files) {
    if (entry.isDir) {
      continue; // derive dirs from file paths
    }
    const parts = entry.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) {
        continue;
      }
      if (!node.children.has(part)) {
        const fullPath = node.fullPath ? `${node.fullPath}/${part}` : part;
        node.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
          files: [],
        });
      }
      node = node.children.get(part);
    }
    node.files.push(entry);
  }

  // Add explicitly listed directories that may have no files
  for (const entry of files) {
    if (!entry.isDir) {
      continue;
    }
    const dirPath = entry.path.replace(/\/$/, "");
    if (!dirPath) {
      continue;
    }
    const parts = dirPath.split("/").filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        const fullPath = node.fullPath ? `${node.fullPath}/${part}` : part;
        node.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
          files: [],
        });
      }
      node = node.children.get(part);
    }
  }

  return root;
}

/**
 * Collect all file entries under a tree node (recursively).
 */
function collectFiles(node) {
  const out = [];
  for (const f of node.files) {
    out.push(f);
  }
  for (const child of node.children.values()) {
    out.push(...collectFiles(child));
  }
  return out;
}

// ── ArchiveModal ──────────────────────────────────────────────────────────────

export default class ArchiveModal extends Modal {
  /**
   * @param {object} fileInst — the File instance from client/files/file.js
   */
  constructor(fileInst) {
    const dlBtn = { id: "download", text: "Download Selected", default: true };
    const closeBtn = { id: "close", text: "Close", cancel: true };
    super("archiveviewer", `Archive: ${fileInst.name}`, dlBtn, closeBtn);

    this.fileInst = fileInst;
    // Extract the upload key from the file href  (e.g. /g/<key> or /g/<key>/name)
    const parts = (fileInst.href || "").split("/").filter(Boolean);
    const gi = parts.indexOf("g");
    this.archiveKey =
      gi >= 0 ? parts[gi + 1] || null : parts[parts.length - 1] || null;

    this._tree = null; // root tree node after load
    this._allFiles = []; // flat Array<{path,size,isDir}>
    this._format = null;

    // UI state
    this._folderChecked = new Map(); // fullPath → boolean
    this._fileChecked = new Map(); // entry.path → boolean
    this._folderExpanded = new Map(); // fullPath → boolean

    // DOM elements built in _buildUI()
    this._treeEl = null;
    this._fileListEl = null;
    this._folderInfoEl = null;
    this._fileInfoEl = null;
    this._dlBtn = dlBtn.btn;

    // Set by mountInto()
    this._holder = null;
    this._subHolder = null;
    this._onKeyDown = null;

    // Search filter state
    this._searchQuery = "";

    // Image preview popup (created in _buildUI, shared across all rows)
    this._imgPopupEl = null;
    this._imgPopupImgEl = null;

    this._buildUI();
    this._loadListing();
  }

  // ── Custom mounting (inside #filelist, not in a global fixed modal-holder) ──

  /**
   * Mount the archive viewer as an absolute overlay inside `container`.
   * Returns this.promise (resolves/rejects when the viewer is closed).
   */
  mountInto(container) {
    this._holder = dom("div", { classes: ["av-holder"] });
    this._holder.appendChild(this.el);
    container.appendChild(this._holder);

    // Escape closes the viewer (only when no sub-modal is open)
    this._onKeyDown = (e) => {
      if (e.key !== "Escape" || this._subHolder) {
        return;
      }
      e.stopPropagation();
      this._unmount();
      this.reject(new Error("cancelled"));
    };
    document.addEventListener("keydown", this._onKeyDown, true);

    // Click on the dim backdrop closes the viewer
    this._holder.addEventListener("click", (e) => {
      if (e.target === this._holder && !this._subHolder) {
        this._unmount();
        this.reject(new Error("cancelled"));
      }
    });

    this.onshown();
    return this.promise;
  }

  _unmount() {
    if (this._holder && this._holder.parentElement) {
      this._holder.parentElement.removeChild(this._holder);
    }
    this._holder = null;
    if (this._onKeyDown) {
      document.removeEventListener("keydown", this._onKeyDown, true);
      this._onKeyDown = null;
    }
  }

  // ── UI construction ─────────────────────────────────────────────────────────

  _buildUI() {
    this.el.classList.add("modal-archiveviewer");

    const layout = dom("div", { classes: ["av-layout"] });

    // ── Left sidebar ──
    const sidebar = dom("div", { classes: ["av-sidebar"] });
    const sidebarHead = dom("div", { classes: ["av-sidebar-header"] });

    // Root "/ [all]" checkbox lives in the header, not the tree
    this._rootCbEl = dom("input", {
      attrs: { type: "checkbox", title: "Select / deselect all files" },
      classes: ["av-root-cb"],
    });
    this._rootCbEl.addEventListener("change", () => {
      this._folderChecked.set("", this._rootCbEl.checked);
      if (this._tree) {
        this._setChildFolders(this._tree, this._rootCbEl.checked);
      }
      this._syncRootCheckbox();
      this._updateFolderInfo();
      this._renderTree();
      this._renderFiles();
    });

    const rootLabel = dom("span", {
      classes: ["av-root-label"],
      text: "/ [all]",
    });
    rootLabel.addEventListener("click", () => this._rootCbEl.click());

    this._folderInfoEl = dom("span", {
      classes: ["av-select-info"],
      text: "",
    });

    // Tight expand/collapse group
    const expandGroup = dom("div", { classes: ["av-expand-group"] });
    const expandAllBtn = dom("button", {
      classes: ["av-ctrl-btn"],
      attrs: { type: "button", title: "Expand all folders" },
      text: "⊞",
    });
    expandAllBtn.addEventListener("click", () => this._expandAll(true));

    const collapseAllBtn = dom("button", {
      classes: ["av-ctrl-btn"],
      attrs: { type: "button", title: "Collapse all folders" },
      text: "⊟",
    });
    collapseAllBtn.addEventListener("click", () => this._expandAll(false));

    expandGroup.appendChild(expandAllBtn);
    expandGroup.appendChild(collapseAllBtn);

    sidebarHead.appendChild(this._rootCbEl);
    sidebarHead.appendChild(rootLabel);
    sidebarHead.appendChild(this._folderInfoEl);
    sidebarHead.appendChild(expandGroup);
    sidebar.appendChild(sidebarHead);

    this._treeEl = dom("div", { classes: ["av-tree"] });
    sidebar.appendChild(this._treeEl);

    // ── Right file list ──
    const filePanel = dom("div", { classes: ["av-filelist"] });
    const fileHead = dom("div", { classes: ["av-filelist-header"] });

    this._fileInfoEl = dom("span", {
      classes: ["av-select-info"],
      text: "",
    });

    const selectAllBtn = dom("button", {
      classes: ["av-ctrl-btn"],
      attrs: { type: "button", title: "Select all visible files" },
      text: "Select all",
    });
    selectAllBtn.addEventListener("click", () => this._selectAllFiles(true));

    const clearSelBtn = dom("button", {
      classes: ["av-ctrl-btn"],
      attrs: { type: "button", title: "Clear file selection" },
      text: "Clear",
    });
    clearSelBtn.addEventListener("click", () => this._selectAllFiles(false));

    fileHead.appendChild(this._fileInfoEl);
    fileHead.appendChild(selectAllBtn);
    fileHead.appendChild(clearSelBtn);
    filePanel.appendChild(fileHead);

    // Inline file search (below header, visible when tree content loaded)
    const searchRow = dom("div", { classes: ["av-search-row"] });
    this._searchEl = dom("input", {
      attrs: {
        type: "text",
        placeholder: "Filter files…",
        autocomplete: "off",
        spellcheck: "false",
      },
      classes: ["av-search"],
    });
    this._searchEl.addEventListener("input", () => {
      this._searchQuery = this._searchEl.value.trim().toLowerCase();
      this._renderFiles();
    });
    searchRow.appendChild(this._searchEl);
    filePanel.appendChild(searchRow);

    this._fileListEl = dom("div", { classes: ["av-files"] });
    filePanel.appendChild(this._fileListEl);

    // Shared image preview popup — absolutely positioned within the modal
    this._imgPopupEl = dom("div", { classes: ["av-img-popup"] });
    this._imgPopupImgEl = dom("img", { attrs: { alt: "" } });
    this._imgPopupEl.appendChild(this._imgPopupImgEl);
    // Appended to this.el so it overlays the modal; requires position:relative on .modal-archiveviewer
    this.el.appendChild(this._imgPopupEl);

    layout.appendChild(sidebar);
    layout.appendChild(filePanel);
    this.body.appendChild(layout);

    // Status / loading indicator
    this._statusEl = dom("div", { classes: ["av-status"], text: "Loading…" });
    this.body.appendChild(this._statusEl);
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async _loadListing() {
    if (!this.archiveKey) {
      this._setStatus("Could not determine archive key.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/archive/${this.archiveKey}/ls`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      this._format = data.format || "?";
      this._allFiles = (data.files || []).filter((f) => !f.isDir);
      this._tree = buildTree(data.files || []);
      this._setStatus("");
      this._renderTree();
      this._renderFiles();
    } catch (ex) {
      this._setStatus(`Failed to load archive: ${ex.message}`);
    }
  }

  _setStatus(text) {
    if (this._statusEl) {
      this._statusEl.textContent = text;
      this._statusEl.classList.toggle("hidden", !text);
    }
  }

  // ── Tree rendering ──────────────────────────────────────────────────────────

  _renderTree() {
    this._treeEl.textContent = "";
    if (!this._tree) {
      return;
    }
    // Root is in the sidebar header; only render its children here
    for (const child of this._tree.children.values()) {
      this._treeEl.appendChild(this._buildTreeNode(child, 0));
    }
    this._syncRootCheckbox();
    this._updateFolderInfo();
  }

  _buildTreeNode(node, depth) {
    const frag = document.createDocumentFragment();
    frag.appendChild(this._makeTreeRow(node, depth));
    if (!!this._folderExpanded.get(node.fullPath)) {
      for (const child of node.children.values()) {
        frag.appendChild(this._buildTreeNode(child, depth + 1));
      }
    }
    return frag;
  }

  _makeTreeRow(node, depth = 0) {
    const fullPath = node.fullPath;
    const isChecked = !!this._folderChecked.get(fullPath);
    const isExpanded = !!this._folderExpanded.get(fullPath);
    const hasChildren = node.children.size > 0;

    const row = dom("div", {
      classes: ["av-tree-item", ...(isChecked ? ["is-checked"] : [])],
    });
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    const cb = dom("input", {
      attrs: { type: "checkbox" },
      classes: ["av-tree-cb"],
    });
    cb.checked = isChecked;
    cb.addEventListener("change", () => {
      this._setChildFolders(node, cb.checked);
      row.classList.toggle("is-checked", cb.checked);
      this._syncRootCheckbox();
      this._updateFolderInfo();
      this._renderFiles();
    });

    const expander = dom("button", {
      classes: [
        "av-tree-expander",
        ...(hasChildren ? [] : ["av-tree-expander-leaf"]),
      ],
      attrs: {
        type: "button",
        "aria-label": isExpanded ? "Collapse" : "Expand",
      },
      text: hasChildren ? (isExpanded ? "▾" : "▸") : " ",
    });
    expander.addEventListener("click", (e) => {
      nukeEvent(e);
      if (!hasChildren) {
        return;
      }
      const nowExpanded = !this._folderExpanded.get(fullPath);
      this._folderExpanded.set(fullPath, nowExpanded);
      this._renderTree();
    });

    const icon = dom("span", { classes: ["av-tree-icon", "i-archive-b"] });
    const label = dom("span", {
      classes: ["av-tree-name"],
      text: node.name,
    });
    label.addEventListener("click", () => {
      cb.click();
    });

    const count = collectFiles(node).length;
    const countEl = dom("span", {
      classes: ["av-tree-count"],
      text: count > 0 ? `${count}` : "",
    });

    row.appendChild(cb);
    row.appendChild(expander);
    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(countEl);

    return row;
  }

  _setChildFolders(node, checked) {
    this._folderChecked.set(node.fullPath, checked);
    for (const child of node.children.values()) {
      this._setChildFolders(child, checked);
    }
  }

  /** Sync the header root checkbox to reflect current folder selection state. */
  _syncRootCheckbox() {
    if (!this._rootCbEl) {
      return;
    }
    const rootChecked = !!this._folderChecked.get("");
    this._rootCbEl.checked = rootChecked;
    this._rootCbEl.indeterminate = false;
    if (!rootChecked) {
      for (const [k, v] of this._folderChecked) {
        if (k !== "" && v) {
          this._rootCbEl.indeterminate = true;
          break;
        }
      }
    }
  }

  /**
   * Build a folder row for the right-hand file list panel.
   * Mirrors the sidebar tree checkbox so clicking either panel syncs the other.
   */
  _makeFilePanelFolderRow(node) {
    const fullPath = node.fullPath;
    const isChecked = !!this._folderChecked.get(fullPath);
    const fileCount = collectFiles(node).length;

    const row = dom("div", {
      classes: [
        "av-file-item",
        "av-file-folder",
        ...(isChecked ? ["is-checked"] : []),
      ],
    });

    const cb = dom("input", {
      attrs: { type: "checkbox" },
      classes: ["av-file-cb"],
    });
    cb.checked = isChecked;
    cb.addEventListener("change", () => {
      this._setChildFolders(node, cb.checked);
      this._syncRootCheckbox();
      this._updateFolderInfo();
      this._renderTree();
      this._renderFiles();
    });

    const nameEl = dom("span", {
      classes: ["av-file-name"],
      attrs: { title: fullPath },
    });
    nameEl.textContent = node.name + "/";
    nameEl.addEventListener("click", () => cb.click());

    const countEl = dom("span", {
      classes: ["av-file-size"],
      text:
        fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "",
    });

    row.appendChild(cb);
    row.appendChild(nameEl);
    row.appendChild(countEl);
    return row;
  }

  // ── File list rendering ─────────────────────────────────────────────────────

  /**
   * Return files visible in the right panel: those belonging to any checked
   * folder, or all files if the root ("") is checked.
   * Also applies the inline search filter if a query is set.
   */
  _getVisibleFiles() {
    if (!this._tree) {
      return [];
    }
    const rootChecked = !!this._folderChecked.get("");
    let base;
    if (rootChecked) {
      base = this._allFiles;
    } else {
      // Collect files from all checked folder nodes
      const result = [];
      const seen = new Set();
      const visit = (node) => {
        if (this._folderChecked.get(node.fullPath)) {
          for (const f of collectFiles(node)) {
            if (!seen.has(f.path)) {
              seen.add(f.path);
              result.push(f);
            }
          }
          return; // children already included by collectFiles
        }
        for (const child of node.children.values()) {
          visit(child);
        }
      };
      visit(this._tree);

      // If nothing is checked, show all files
      if (!result.length && !this._hasAnyFolderChecked()) {
        base = this._allFiles;
      } else {
        base = result;
      }
    }

    // Apply inline search filter
    const q = this._searchQuery;
    if (!q) {
      return base;
    }
    return base.filter((f) => {
      const name = (f.path.split("/").pop() || f.path).toLowerCase();
      return name.includes(q) || f.path.toLowerCase().includes(q);
    });
  }

  _hasAnyFolderChecked() {
    for (const v of this._folderChecked.values()) {
      if (v) return true;
    }
    return false;
  }

  _renderFiles() {
    this._fileListEl.textContent = "";

    // Subfolder rows at the top (root's direct children)
    if (this._tree && this._tree.children.size > 0) {
      for (const child of this._tree.children.values()) {
        this._fileListEl.appendChild(this._makeFilePanelFolderRow(child));
      }
    }

    const files = this._getVisibleFiles();

    if (!files.length) {
      if (!this._tree || this._tree.children.size === 0) {
        const empty = dom("div", {
          classes: ["av-files-empty"],
          text: this._tree ? "No files in selection." : "Loading…",
        });
        this._fileListEl.appendChild(empty);
      }
      this._updateFileInfo();
      this._updateDownloadBtn();
      return;
    }

    for (const entry of files) {
      const row = dom("div", { classes: ["av-file-item"] });

      const cb = dom("input", {
        attrs: { type: "checkbox" },
        classes: ["av-file-cb"],
      });
      cb.checked = !!this._fileChecked.get(entry.path);
      cb.addEventListener("change", () => {
        this._fileChecked.set(entry.path, cb.checked);
        row.classList.toggle("is-checked", cb.checked);
        this._updateFileInfo();
        this._updateDownloadBtn();
      });

      const name = dom("span", {
        classes: ["av-file-name"],
        text: entry.path.split("/").pop() || entry.path,
        attrs: { title: entry.path },
      });
      name.addEventListener("click", () => cb.click());

      const pathEl = dom("span", {
        classes: ["av-file-path"],
        text: entry.path.includes("/")
          ? entry.path.slice(0, entry.path.lastIndexOf("/"))
          : "",
        attrs: { title: entry.path },
      });

      const size = dom("span", {
        classes: ["av-file-size"],
        text: entry.size > 0 ? toPrettySize(entry.size) : "—",
      });

      row.classList.toggle("is-checked", !!this._fileChecked.get(entry.path));
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(pathEl);
      row.appendChild(size);

      // Image preview on hover
      if (isImageEntry(entry.path) && this._imgPopupEl) {
        const previewUrl = `/api/v1/archive/${this.archiveKey}/file?path=${encodeURIComponent(entry.path)}`;
        row.addEventListener("mouseenter", () => {
          this._imgPopupImgEl.src = previewUrl;
          // Position relative to the modal element (requires position:relative on .modal-archiveviewer)
          const rowRect = row.getBoundingClientRect();
          const modalRect = this.el.getBoundingClientRect();
          const top = Math.max(
            4,
            Math.min(rowRect.top - modalRect.top - 60, modalRect.height - 210),
          );
          this._imgPopupEl.style.top = `${top}px`;
          this._imgPopupEl.style.display = "block";
        });
        row.addEventListener("mouseleave", () => {
          this._imgPopupEl.style.display = "none";
        });
      }

      this._fileListEl.appendChild(row);
    }

    this._updateFileInfo();
    this._updateDownloadBtn();
  }

  // ── Selection counters ──────────────────────────────────────────────────────

  _updateFolderInfo() {
    let checked = 0;
    for (const [k, v] of this._folderChecked) {
      if (k !== "" && v) checked++;
    }
    if (this._folderInfoEl) {
      this._folderInfoEl.textContent =
        checked > 0
          ? `${checked} folder${checked === 1 ? "" : "s"} selected`
          : "";
    }
  }

  _updateFileInfo() {
    let checked = 0;
    for (const v of this._fileChecked.values()) {
      if (v) checked++;
    }
    const visible = this._getVisibleFiles().length;
    if (this._fileInfoEl) {
      this._fileInfoEl.textContent =
        `${visible} file${visible === 1 ? "" : "s"}` +
        (checked > 0 ? ` · ${checked} selected` : "");
    }
  }

  _updateDownloadBtn() {
    if (!this._dlBtn) {
      return;
    }
    const count = this._selectedDownloadFiles().length;
    this._dlBtn.textContent =
      count > 0
        ? `Download ${count} File${count === 1 ? "" : "s"}`
        : "Download Selected";
    this._dlBtn.disabled = count === 0;
  }

  _selectAllFiles(select) {
    const files = this._getVisibleFiles();
    for (const f of files) {
      this._fileChecked.set(f.path, select);
    }
    this._renderFiles();
  }

  _expandAll(expand) {
    if (!this._tree) {
      return;
    }
    const visit = (node) => {
      if (node.children.size > 0) {
        this._folderExpanded.set(node.fullPath, expand);
      }
      for (const child of node.children.values()) {
        visit(child);
      }
    };
    visit(this._tree);
    this._renderTree();
  }

  // ── Download logic ──────────────────────────────────────────────────────────

  /**
   * Returns a list of fake file-like objects for the download batch modal.
   * Selected files win; if no files are individually checked, use all visible.
   */
  _selectedDownloadFiles() {
    if (!this.archiveKey) {
      return [];
    }
    const visible = this._getVisibleFiles();

    // Prefer per-file checkbox selection
    const explicitly = visible.filter((f) => this._fileChecked.get(f.path));
    const targets = explicitly.length > 0 ? explicitly : visible;

    return targets.map((f) => ({
      key: `archive:${this.archiveKey}:${f.path}`,
      name: f.path.split("/").pop() || f.path,
      url: `/api/v1/archive/${this.archiveKey}/file?path=${encodeURIComponent(f.path)}`,
      size: f.size,
      expired: false,
      meta: {},
    }));
  }

  // ── Modal lifecycle ─────────────────────────────────────────────────────────

  async onclick(button, e) {
    nukeEvent(e);

    if (button.cancel || button.id === "close") {
      this._unmount();
      this.reject(new Error("cancelled"));
      return;
    }

    if (button.id === "download") {
      const targets = this._selectedDownloadFiles();
      if (!targets.length) {
        return;
      }
      // Show download modal inside the archive viewer — don't close the viewer
      this._showDownloadIn(targets);
    }
  }

  // ── Download sub-modal (mounted inside the archive viewer overlay) ──────────

  async _showDownloadIn(targets) {
    if (this._subHolder || !this._holder) {
      return;
    }
    const title = `Download from ${this.fileInst.name}`;
    const prefs = registry.files.getDownloadPrefs();

    const modal = new DownloadBatchModal(title, targets.length, {
      skipExisting: prefs.skipExisting,
      retries: prefs.maxRetries,
      concurrent: prefs.maxConcurrent,
      onOptionsChange: (values) => registry.files.saveDownloadPrefs(values),
    });

    this._subHolder = dom("div", { classes: ["av-sub-holder"] });
    this._subHolder.appendChild(modal.el);
    this._holder.appendChild(this._subHolder);
    modal.onshown();

    const modalDone = modal.promise.catch(() => {});

    // Wait for the user to press Start (or Cancel before starting)
    let values;
    try {
      values = await modal.waitForStart();
      registry.files.saveDownloadPrefs(values);
    } catch {
      modal.cancelRequested = true;
      await modalDone;
      this._removeSubHolder();
      return;
    }

    const maxRetries = Math.max(0, Math.min(5, Number(values.maxRetries) || 0));
    const maxConcurrent = Math.max(
      1,
      Math.min(4, Number(values.maxConcurrent) || 4),
    );
    let done = 0,
      failed = 0,
      idx = 0;
    const total = targets.length;

    const worker = async () => {
      for (;;) {
        if (modal.cancelRequested) {
          return;
        }
        const cur = idx++;
        if (cur >= total) {
          return;
        }
        const file = targets[cur];
        modal.setCurrent(`Downloading: ${file.name}`);

        if (
          modal.skipExisting &&
          registry.files.hasDownloadedFilename(file.name)
        ) {
          modal.upsertFileStatus(file.name, "skipped", 1, "existing filename");
          modal.update(done, failed, 0);
          continue;
        }

        let success = false;
        let lastErr = null;
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
          modal.upsertFileStatus(
            file.name,
            attempt === 1 ? "running" : "retrying",
            attempt,
          );
          try {
            await registry.files.fetchAndTriggerDownload(file);
            done++;
            success = true;
            registry.files.markFilenameDownloaded(file.name);
            modal.upsertFileStatus(file.name, "success", attempt);
            break;
          } catch (ex) {
            lastErr = ex;
          }
        }
        if (!success) {
          failed++;
          modal.upsertFileStatus(
            file.name,
            "failed",
            maxRetries + 1,
            (lastErr && lastErr.message) || "failed",
          );
        }
        modal.update(done, failed, 0);
      }
    };

    await Promise.all(Array.from({ length: maxConcurrent }, worker));

    if (!modal.cancelRequested) {
      modal.finish(done, failed, 0, false);
    }

    // Wait for the user to dismiss the finished download modal, then remove it
    await modalDone;
    this._removeSubHolder();
  }

  _removeSubHolder() {
    if (this._subHolder && this._subHolder.parentElement) {
      this._subHolder.parentElement.removeChild(this._subHolder);
    }
    this._subHolder = null;
  }
}
