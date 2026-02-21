"use strict";

import EventEmitter from "events";
import { APOOL } from "./animationpool";
import DownloadBatchModal from "./files/downloadmodal";
import File from "./files/file";
import * as filesfilter from "./files/filter";
import Gallery from "./files/gallery";
import { flushStaleProgress } from "./files/reader";
import RequestModal from "./files/requestmodal";
import ScrollState from "./files/scrollstate";
import { REMOVALS } from "./files/tracker";
import Upload from "./files/upload";
import registry from "./registry";
import Scroller from "./scroller";
import {
    PromisePool,
    debounce,
    dom,
    idle,
    iter,
    naturalCaseSort,
    riter,
    sort,
} from "./util";

const ROBOCOPFILES =
  /^(?:thumbs.*\.db|\.ds_store.*|.*\.ds_store|.\tthn|desktop.*.ini)$/i;
const NEW_STATE_PREFIX = "dicefiles:lastseen:room:";
const VIEW_MODE_PREFIX = "dicefiles:viewmode:room:";
const VIEW_MODE_GLOBAL_KEY = "dicefiles:viewmode:last";
const BATCH_PREFS_PREFIX = "dicefiles:downloadprefs:room:";
const BATCH_QUEUE_PREFIX = "dicefiles:downloadqueue:room:";
const DOWNLOADED_NAMES_PREFIX = "dicefiles:downloadednames:room:";

export default new (class Files extends EventEmitter {
  constructor() {
    super();
    this.el = document.querySelector("#files");
    this.scroller = new Scroller(
      this.el,
      document.querySelector("#filelist-scroller"),
    );
    this.ubutton = document.querySelector("#upload-button");
    this.gallery = new Gallery(this);
    this.filterButtons = Array.from(document.querySelectorAll(".filterbtn"));
    this.filterFunc = null;
    this.filter = document.querySelector("#filter");
    this.filterClear = document.querySelector("#filter-clear");
    this.filterStatus = document.querySelector("#filter-status");
    this.newStatus = document.querySelector("#new-status");
    this.downloadNewEl = document.querySelector("#downloadnew");
    this.downloadAllEl = document.querySelector("#downloadall");
    this.createRequestEl = document.querySelector("#createrequest");
    this.files = [];
    this.filemap = new Map();
    this.elmap = new WeakMap();
    this.scrollState = new ScrollState(this);
    this.newFiles = false;
    this.selectionStart = null;
    this.galleryMode = false;
    this.linksMode = false;
    this.newFileKeys = new Set();
    this.forceNewKeys = new Set();
    this.newSinceServerTime = 0;
    this.newStateKey = null;
    this.viewModeKey = null;
    this.viewModeRestored = false;
    this.scriptSettings = {
      maxConcurrentDownloads: 4,
    };
    this.pendingNotificationHighlightKey = null;
    this.batchPrefsKey = null;
    this.batchQueueKey = null;
    this.downloadedNamesKey = null;
    this.batchRunning = false;
    this.batchRestoreChecked = false;
    this.downloadedNameSet = null;
    this.fileStyleLocked = false;
    this._pendingLinksRestore = false;

    this.onfiles = this.onfiles.bind(this);
    this.filesQueue = [];
    this.onfilesdeleted = this.onfilesdeleted.bind(this);
    this.onfilesupdated = this.onfilesupdated.bind(this);
    this.applying = null;
    this.clear = APOOL.wrap(this.clear);
    this.insertFilesIntoDOM = APOOL.wrap(this.insertFilesIntoDOM);
    this.addUploadElements = APOOL.wrap(this.addUploadElements);
    this.uploadOne = PromisePool.wrapNew(1, this, this.uploadOne);
    this.delayedUpdateStatus = debounce(
      idle(this.updateStatus.bind(this)),
      100,
    );
    this.setFileStyle = idle(this.setFileStyle);
    this.onfilterbutton = this.onfilterbutton.bind(this);
    this.onuploadbutton = this.onuploadbutton.bind(this);
    this.ondragenter = this.ondragenter.bind(this);
    this.ondragleave = this.ondragleave.bind(this);
    this.onleave = this.onleave.bind(this);
    this.dragging = false;

    addEventListener("drop", this.ondrop.bind(this), true);
    addEventListener("dragenter", this.ondragenter, true);
    addEventListener("dragover", this.ondragenter, true);
    addEventListener("dragleave", this.ondragleave, true);
    addEventListener("mouseout", this.ondragleave, true);

    this.filterButtons.forEach((e) => {
      e.addEventListener("click", this.onfilterbutton, true);
      e.addEventListener("contextmenu", this.onfilterbutton, true);
    });
    this.filter.addEventListener(
      "input",
      debounce(idle(this.onfilter.bind(this), 2000), 200),
    );
    this.filterClear.addEventListener(
      "click",
      this.clearFilter.bind(this),
      true,
    );

    this.ubutton.addEventListener("change", this.onuploadbutton.bind(this));

    this.newStatus.addEventListener("click", () => {
      this.el.scrollTop = 0;
      this.delayedUpdateStatus();
    });

    this.el.addEventListener("click", this.onclick.bind(this));
    this.el.addEventListener("contextmenu", this.onclick.bind(this));
    this.el.addEventListener("scroll", this.onscroll.bind(this), {
      passive: true,
    });

    document
      .querySelector("#selectall")
      .addEventListener("click", this.selectAll.bind(this));
    document
      .querySelector("#clearselection")
      .addEventListener("click", this.clearSelection.bind(this));
    this.downloadNewEl.addEventListener("click", this.downloadNew.bind(this));
    this.downloadAllEl.addEventListener("click", this.downloadAll.bind(this));
    this.createRequestEl.addEventListener(
      "click",
      this.createRequest.bind(this),
    );

    const actions = [
      "banFiles",
      "unbanFiles",
      "whitelist",
      "blacklist",
      "trash",
      "nailOff",
      "nailOn",
    ];
    for (const a of actions) {
      const e = document.querySelector(`#${a.toLowerCase()}`);
      e.addEventListener("click", this[a].bind(this));
      this[`${a}El`] = e;
    }

    this.linkModeEl = document.querySelector("#linkmode");
    if (this.linkModeEl) {
      this.linkModeEl.addEventListener("click", this.linkMode.bind(this));
    }

    Object.seal(this);
  }

  get visible() {
    return Array.from(document.querySelectorAll(".file:not(.upload)"))
      .map((e) => this.elmap.get(e))
      .filter((e) => e);
  }

  init() {
    if (!this.newStateKey) {
      const roomid = this.getRoomId();
      this.newStateKey = `${NEW_STATE_PREFIX}${roomid}`;
      this.viewModeKey = `${VIEW_MODE_PREFIX}${roomid}`;
      this.batchPrefsKey = `${BATCH_PREFS_PREFIX}${roomid}`;
      this.batchQueueKey = `${BATCH_QUEUE_PREFIX}${roomid}`;
      this.downloadedNamesKey = `${DOWNLOADED_NAMES_PREFIX}${roomid}`;
    }
    const configuredMaxConcurrent = Number(
      registry.config && registry.config.get("downloadMaxConcurrent"),
    );
    if (Number.isFinite(configuredMaxConcurrent)) {
      this.scriptSettings.maxConcurrentDownloads = Math.min(
        4,
        Math.max(1, configuredMaxConcurrent),
      );
    }
    this.initNewState();
    this.restoreViewMode();
    registry.socket.on("files", this.onfiles);
    registry.socket.on("files-deleted", this.onfilesdeleted);
    registry.socket.on("files-updated", this.onfilesupdated);
    registry.roomie.on("tooltip-hidden", () => this.adjustEmpty());
    addEventListener("pagehide", this.onleave, { passive: true });
    addEventListener("beforeunload", this.onleave, { passive: true });
  }

  initNewState() {
    const fallback = registry.roomie.toServerTime(Date.now());
    try {
      const raw = localStorage.getItem(this.newStateKey);
      if (!raw) {
        this.newSinceServerTime = fallback;
        this.persistNewState();
        return;
      }
      const parsed = JSON.parse(raw);
      const v = Number(parsed && parsed.lastSeenServerTime);
      this.newSinceServerTime = Number.isFinite(v) && v > 0 ? v : fallback;
    } catch (ex) {
      this.newSinceServerTime = fallback;
    }
  }

  persistNewState() {
    try {
      localStorage.setItem(
        this.newStateKey,
        JSON.stringify({
          lastSeenServerTime: registry.roomie.toServerTime(Date.now()),
        }),
      );
    } catch (ex) {
      // ignored
    }
  }

  onleave() {
    this.persistNewState();
  }

  getRoomId() {
    const raw = document.location.pathname || "";
    const normalized = raw.replace(/^\/r\//, "").replace(/\/+$/, "");
    return normalized || "default";
  }

  persistViewMode() {
    const value = this.linksMode
      ? "links"
      : this.galleryMode
        ? "gallery"
        : "list";
    try {
      if (this.viewModeKey) {
        localStorage.setItem(this.viewModeKey, value);
      }
      localStorage.setItem(VIEW_MODE_GLOBAL_KEY, value);
    } catch (ex) {
      // ignored
    }
  }

  restoreViewMode() {
    let mode = null;
    try {
      mode = this.viewModeKey && localStorage.getItem(this.viewModeKey);
      if (mode !== "gallery" && mode !== "list" && mode !== "links") {
        mode = localStorage.getItem(VIEW_MODE_GLOBAL_KEY);
      }
    } catch (ex) {
      mode = null;
    }
    if (mode !== "gallery" && mode !== "list" && mode !== "links") {
      return;
    }
    this.viewModeRestored = true;
    if (mode === "links") {
      // Links mode restore is deferred to after links.init() runs
      // We store the intent and apply after init
      this._pendingLinksRestore = true;
    } else {
      this.applyViewMode(mode === "gallery", false);
    }
  }

  isFileNew(file, existing) {
    if (existing && existing.el.classList.contains("is-new")) {
      return true;
    }
    if (this.newFileKeys.has(file.key)) {
      return true;
    }
    if (this.forceNewKeys.has(file.key)) {
      this.forceNewKeys.delete(file.key);
      this.newFileKeys.add(file.key);
      return true;
    }
    const uploaded = Number(file.uploaded);
    if (!Number.isFinite(uploaded) || uploaded <= 0) {
      return false;
    }
    const isNew = uploaded > this.newSinceServerTime;
    if (isNew) {
      this.newFileKeys.add(file.key);
    }
    return isNew;
  }

  markFileAsNew(key) {
    if (!key) {
      return;
    }
    this.forceNewKeys.add(key);
    this.newFileKeys.add(key);
    const existing = this.filemap.get(key);
    if (existing) {
      existing.setNew(true);
    }
    this.delayedUpdateStatus();
  }

  onclick(e) {
    const { target: el } = e;
    if (el.classList.contains("tag")) {
      e.preventDefault();
      e.stopPropagation();
      const { tag, tagValue } = el.dataset;
      let val = /[\s'"]/.test(tagValue)
        ? `'${tagValue.replace(/'/g, "\\'")}'`
        : tagValue;
      if (val === "true") {
        val = "";
      }
      if (e.button || e.shiftKey) {
        this.filter.value = `${this.filter.value} -${tag}:${val}`.trim();
      } else {
        this.filter.value = `${tag}:${val}`.trim();
      }
      this.doFilter();
      return false;
    }
    return true;
  }

  onscroll() {
    this.delayedUpdateStatus();
    registry.roomie.hideTooltip();
  }

  onfilterbutton(e) {
    e.preventDefault();
    e.stopPropagation();

    try {
      const { target: btn } = e;
      const { filterButtons: btns } = this;
      if (e.button) {
        const anyEnabled = btns.some(
          (e) => e !== btn && !e.classList.contains("disabled"),
        );
        btns.forEach((e) => {
          e.classList[e === btn || !anyEnabled ? "remove" : "add"]("disabled");
        });
      } else {
        const act = btn.classList.contains("disabled") ? "remove" : "add";
        btn.classList[act]("disabled");
      }
    } catch (ex) {
      console.error(ex);
    }
    this.doFilter();
  }

  onfilter() {
    this.doFilter();
  }

  clearFilter() {
    this.filterButtons.forEach((e) => e.classList.remove("disabled"));
    this.filter.value = "";

    this.doFilter();
  }

  setFilter(value) {
    this.filter.value = value;
    this.doFilter();
  }

  doFilter() {
    this.filterFunc = filesfilter.toFilterFuncs(
      this.filterButtons,
      this.filter.value,
    );
    this.filterClear.classList[this.filterFunc ? "remove" : "add"]("disabled");
    REMOVALS.trigger();
    if (!this.applying) {
      this.applying = this.applyFilter().then(() => (this.applying = null));
    }
  }

  filtered(files) {
    const { filterFunc } = this;
    if (filterFunc === filesfilter.NONE) {
      return [];
    }
    if (filterFunc) {
      return files.filter(filterFunc);
    }
    return files;
  }

  applyFilter() {
    const files = this.filtered(this.files);
    if (!files || !files.length) {
      return APOOL.schedule(null, () => {
        this.visible.forEach((e) => e.el.parentElement.removeChild(e.el));
      });
    }

    const { visible } = this;
    const fileset = new Set(files);
    // Remove now hidden
    let diff = false;
    const remove = [];
    visible.forEach((e) => {
      if (fileset.has(e)) {
        return;
      }
      diff = true;
      remove.push(e.el);
    });
    // unchanged
    if (visible.length === fileset.size && !diff) {
      return Promise.resolve();
    }

    // Add all matching files
    this.adjustEmpty();
    this.scrollState.push();
    return this.insertFilesIntoDOM(files, remove).then(async () => {
      this.sortFiles();
      this.adjustEmpty();
      await this.scrollState.pop();
      this.delayedUpdateStatus();
    });
  }

  openGallery(file) {
    registry.roomie.hideTooltip();
    this.gallery.open(file);
  }

  maybeCloseGallery(file) {
    this.gallery.maybeClose(file);
  }

  updateStatus() {
    if (!this.files.length) {
      this.filterStatus.classList.add("hidden");
    } else {
      const text = `${this.visible.length} of ${this.files.length} files`;
      if (this.filterStatus.textContent !== text) {
        this.filterStatus.textContent = text;
      }
      this.filterStatus.classList.remove("hidden");
    }

    if (!this.el.scrollTop) {
      this.newFiles = false;
    }

    if (!this.newFiles) {
      this.newStatus.classList.add("hidden");
    } else {
      this.newStatus.classList.remove("hidden");
    }
    this.updateDownloadButtons();
  }

  get allDownloadable() {
    return this.files.filter((f) => !f.expired && !(f.meta && f.meta.request));
  }

  get newDownloadable() {
    return this.allDownloadable.filter((f) =>
      f.el.classList.contains("is-new"),
    );
  }

  updateDownloadButtons() {
    const allCount = this.allDownloadable.length;
    const newCount = this.newDownloadable.length;
    const setCount = (el, count) => {
      const badge = el.querySelector(".count-pill");
      if (badge) {
        badge.textContent = count.toString();
      }
      el.classList[count > 0 ? "remove" : "add"]("disabled");
    };
    setCount(this.downloadAllEl, allCount);
    setCount(this.downloadNewEl, newCount);
  }

  async downloadNew() {
    await this.downloadBatch(this.newDownloadable, "Download New Files");
  }

  async downloadAll() {
    await this.downloadBatch(this.allDownloadable, "Download All Files");
  }

  async createRequest() {
    try {
      await registry.init();
      const modal = new RequestModal();
      const payload = await registry.roomie.showModal(modal);
      const text =
        typeof payload === "string"
          ? payload.trim()
          : ((payload && payload.text) || "").trim();
      const requestUrl =
        payload && typeof payload === "object"
          ? (payload.url || "").trim()
          : "";
      const requestImage =
        payload && typeof payload === "object"
          ? (payload.requestImage || "").trim()
          : "";
      if (!text) {
        return;
      }
      const ack = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Request timeout")),
          10000,
        );
        registry.socket.emit(
          "request",
          {
            text,
            url: requestUrl,
            requestImage,
          },
          (rv) => {
            clearTimeout(timeout);
            resolve(rv || {});
          },
        );
      });
      if (ack.err) {
        throw new Error(ack.err);
      }
    } catch (ex) {
      if (!ex || ex.message === "cancelled") {
        return;
      }
      registry.messages.addSystemMessage(
        `Failed to create request: ${ex.message || ex}`,
      );
    }
  }

  readLocalJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (ex) {
      return fallback;
    }
  }

  writeLocalJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (ex) {
      // ignored
    }
  }

  getDownloadPrefs() {
    return Object.assign(
      {
        skipExisting: true,
        maxRetries: 2,
        maxConcurrent: 4,
      },
      this.readLocalJSON(this.batchPrefsKey, {}),
    );
  }

  saveDownloadPrefs(prefs) {
    const merged = Object.assign(this.getDownloadPrefs(), prefs || {});
    merged.maxRetries = Math.max(
      0,
      Math.min(5, Number(merged.maxRetries) || 0),
    );
    merged.maxConcurrent = Math.max(
      1,
      Math.min(4, Number(merged.maxConcurrent) || 4),
    );
    merged.skipExisting = !!merged.skipExisting;
    this.writeLocalJSON(this.batchPrefsKey, merged);
    return merged;
  }

  getDownloadedNameSet() {
    if (this.downloadedNameSet) {
      return this.downloadedNameSet;
    }
    const data = this.readLocalJSON(this.downloadedNamesKey, { names: [] });
    this.downloadedNameSet = new Set(
      (data.names || []).map((e) => e.toString().toLowerCase()),
    );
    return this.downloadedNameSet;
  }

  persistDownloadedNames() {
    const names = Array.from(this.getDownloadedNameSet()).slice(-300);
    this.writeLocalJSON(this.downloadedNamesKey, { names });
  }

  markFilenameDownloaded(name) {
    if (!name) {
      return;
    }
    this.getDownloadedNameSet().add(name.toLowerCase());
    this.persistDownloadedNames();
  }

  hasDownloadedFilename(name) {
    if (!name) {
      return false;
    }
    return this.getDownloadedNameSet().has(name.toLowerCase());
  }

  createBatchQueueState(files, title, options) {
    return {
      version: 1,
      title,
      skipExisting: !!options.skipExisting,
      maxRetries: Math.max(0, Math.min(5, Number(options.maxRetries) || 0)),
      maxConcurrent: Math.max(
        1,
        Math.min(4, Number(options.maxConcurrent) || 4),
      ),
      remainingKeys: files.map((f) => f.key),
      createdAt: Date.now(),
      started: false,
    };
  }

  persistBatchQueue(state) {
    if (
      !state ||
      !Array.isArray(state.remainingKeys) ||
      !state.remainingKeys.length
    ) {
      this.clearBatchQueue();
      return;
    }
    this.writeLocalJSON(this.batchQueueKey, state);
  }

  loadBatchQueue() {
    return this.readLocalJSON(this.batchQueueKey, null);
  }

  clearBatchQueue() {
    try {
      localStorage.removeItem(this.batchQueueKey);
    } catch (ex) {
      // ignored
    }
  }

  async tryRestoreBatchQueue() {
    if (this.batchRestoreChecked || this.batchRunning) {
      return;
    }
    this.batchRestoreChecked = true;
    const queue = this.loadBatchQueue();
    if (
      !queue ||
      !Array.isArray(queue.remainingKeys) ||
      !queue.remainingKeys.length
    ) {
      return;
    }
    if (!queue.started) {
      this.clearBatchQueue();
      return;
    }
    const files = queue.remainingKeys
      .map((key) => this.filemap.get(key))
      .filter((f) => f && !f.expired && !(f.meta && f.meta.request));
    if (!files.length) {
      this.clearBatchQueue();
      return;
    }
    registry.messages.addSystemMessage(
      `Resuming previous batch download (${files.length} file${files.length === 1 ? "" : "s"}).`,
    );
    await this.downloadBatch(files, queue.title || "Download Resume", {
      resumeState: queue,
      restored: true,
    });
  }

  async downloadBatch(targets, title, options = {}) {
    if (!targets.length || this.batchRunning) {
      return;
    }
    this.batchRunning = true;
    const prefs = this.getDownloadPrefs();
    const queueState =
      options.resumeState ||
      this.createBatchQueueState(targets, title, {
        skipExisting: prefs.skipExisting,
        maxRetries: prefs.maxRetries,
        maxConcurrent: prefs.maxConcurrent,
      });
    const modal = new DownloadBatchModal(title, targets.length, {
      skipExisting: queueState.skipExisting,
      retries: queueState.maxRetries,
      concurrent: queueState.maxConcurrent,
      onOptionsChange: (values) => {
        this.saveDownloadPrefs(values);
        queueState.skipExisting = !!values.skipExisting;
        queueState.maxRetries = Math.max(
          0,
          Math.min(5, Number(values.maxRetries) || 0),
        );
        queueState.maxConcurrent = Math.max(
          1,
          Math.min(4, Number(values.maxConcurrent) || 4),
        );
        if (queueState.started) {
          this.persistBatchQueue(queueState);
        }
      },
    });

    const modalPromise = registry.roomie.showModal(modal).catch(() => {
      modal.cancelRequested = true;
    });
    try {
      const values = await modal.waitForStart();
      queueState.skipExisting = !!values.skipExisting;
      queueState.maxRetries = Math.max(
        0,
        Math.min(5, Number(values.maxRetries) || 0),
      );
      queueState.maxConcurrent = Math.max(
        1,
        Math.min(4, Number(values.maxConcurrent) || 4),
      );
      this.saveDownloadPrefs(values);
      this.persistBatchQueue(queueState);
    } catch (ex) {
      // Cancelled before start
      modal.cancelRequested = true;
      this.clearBatchQueue();
      await modalPromise;
      this.batchRunning = false;
      return;
    }

    queueState.started = true;
    queueState.startedAt = Date.now();
    this.persistBatchQueue(queueState);

    const workers = this.runBatchDownload(targets, modal, queueState).catch(
      console.error,
    );
    await workers;
    await modalPromise;
    this.batchRunning = false;
  }

  async runBatchDownload(targets, modal, queueState) {
    const files = Array.from(targets);
    const total = files.length;
    let done = 0;
    let failed = 0;
    let skipped = 0;
    let idx = 0;
    const report = {
      success: [],
      failed: [],
      skipped: [],
    };
    const concurrency = Math.min(
      Math.max(
        1,
        Number(queueState.maxConcurrent) ||
          this.scriptSettings.maxConcurrentDownloads,
      ),
      4,
      total,
    );

    const removeRemaining = (key) => {
      if (!queueState || !Array.isArray(queueState.remainingKeys)) {
        return;
      }
      queueState.remainingKeys = queueState.remainingKeys.filter(
        (k) => k !== key,
      );
      this.persistBatchQueue(queueState);
    };

    const worker = async () => {
      for (;;) {
        if (modal.cancelRequested) {
          return;
        }
        const cur = idx++;
        if (cur >= total) {
          return;
        }
        const file = files[cur];
        modal.setCurrent(`Downloading: ${file.name}`);

        if (modal.skipExisting && this.hasDownloadedFilename(file.name)) {
          skipped++;
          report.skipped.push(file.name);
          modal.upsertFileStatus(file.name, "skipped", 1, "existing filename");
          removeRemaining(file.key);
          modal.update(done, failed, skipped);
          continue;
        }

        const maxRetries = Math.max(
          0,
          Math.min(5, Number(queueState.maxRetries) || 0),
        );
        const maxAttempts = maxRetries + 1;
        let success = false;
        let lastErr = null;
        for (let attempt = 1; attempt <= maxAttempts; ++attempt) {
          modal.upsertFileStatus(
            file.name,
            attempt === 1 ? "running" : "retrying",
            attempt,
          );
          try {
            await this.fetchAndTriggerDownload(file);
            done++;
            success = true;
            report.success.push(file.name);
            this.markFilenameDownloaded(file.name);
            modal.upsertFileStatus(file.name, "success", attempt);
            break;
          } catch (ex) {
            lastErr = ex;
            if (attempt < maxAttempts) {
              modal.upsertFileStatus(
                file.name,
                "retrying",
                attempt,
                ex.message || "failed",
              );
            }
          }
        }

        if (!success) {
          failed++;
          report.failed.push(file.name);
          modal.upsertFileStatus(
            file.name,
            "failed",
            maxAttempts,
            (lastErr && lastErr.message) || "download failed",
          );
          console.error(`failed to download ${file.name}`, lastErr);
        }

        removeRemaining(file.key);
        modal.update(done, failed, skipped);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    if (!modal.cancelRequested) {
      this.clearBatchQueue();
    }
    modal.finish(done, failed, skipped, modal.cancelRequested, report);
  }

  async fetchAndTriggerDownload(file) {
    const res = await fetch(file.url, { credentials: "same-origin" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = dom("a", {
        attrs: {
          href: url,
          download: file.name,
          style: "display:none",
        },
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2500);
    }
  }

  async onuploadbutton() {
    try {
      await registry.init();
      let files = [];
      let entries = [];
      if (this.ubutton.webkitEntries && this.ubutton.webkitEntries.length) {
        entries = Array.from(this.ubutton.webkitEntries);
      } else {
        files = Array.from(this.ubutton.files);
      }
      this.ubutton.parentElement.reset();
      this.queueUploads(entries, files);
    } catch (ex) {
      console.error("failed to handle button upload", ex);
    }
  }

  get canUpload() {
    const disabled =
      registry.config.get("requireAccounts") &&
      registry.chatbox.role === "white";
    return (
      !registry.config.get("disabled") && !disabled && registry.roomie.connected
    );
  }

  get requestModalOpen() {
    return !!document.querySelector(".modal-requestcreate");
  }

  ondragenter(e) {
    if (this.requestModalOpen) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "none";
      return;
    }
    registry.roomie.hideTooltip();

    if (!this.canUpload) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "none";
      return;
    }

    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!this.dragging) {
      this.adjustEmpty(true);
      this.dragging = true;
    }
  }

  ondragleave(e) {
    if (this.requestModalOpen) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.relatedTarget) {
      return;
    }
    this.dragging = false;
    this.adjustEmpty();
  }

  async ondrop(e) {
    if (this.requestModalOpen) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "none";
      return;
    }
    this.dragging = false;
    this.adjustEmpty();

    if (!this.canUpload) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "none";
      return;
    }

    if (!e.dataTransfer.types.includes("Files")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    try {
      await registry.init();
      const files = [];
      const entries = [];
      const { dataTransfer: data } = e;
      if (data.items && data.items.length) {
        for (const file of Array.from(data.items)) {
          if (file.kind !== "file") {
            continue;
          }
          if (file.webkitGetAsEntry) {
            entries.push(file.webkitGetAsEntry());
            continue;
          }
          files.push(file.getAsFile());
        }
        data.items.clear();
      }
      if (!entries.length) {
        for (const file of Array.from(data.files)) {
          files.push(file);
        }
        data.clearData();
      }
      console.log(entries, files);
      this.queueUploads(entries, files);
    } catch (ex) {
      console.error("failed to handle drop", ex);
    }
  }

  async processEntries(entries, files) {
    for (const entry of entries) {
      if (entry.isFile) {
        try {
          files.push(await this.toFile(entry));
        } catch (ex) {
          console.error("failed to get file for entry", entry);
        }
        continue;
      }
      if (entry.isDirectory) {
        try {
          await this.readDir(entry, files);
        } catch (ex) {
          console.error("failed to read directory", entry);
        }
        continue;
      }
      console.debug("unhandled entry", entry);
    }
  }

  async readDir(entry, files) {
    const reader = entry.createReader();
    await new Promise((resolve) => {
      reader.readEntries(async (entries) => {
        await this.processEntries(entries, files);
        resolve();
      });
    });
  }

  toFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  async queueUploads(entries, files) {
    try {
      await registry.init();
      await this.processEntries(entries, files);
      sort(files, (f) => f.name, naturalCaseSort).reverse();
      const uploads = files
        .filter((f) => !ROBOCOPFILES.test(f.name))
        .map((f) => new Upload(this, f));
      if (!uploads.length) {
        return;
      }
      uploads.forEach((u) => this.uploadOne(u));
      await this.addUploadElements(uploads);
      this.adjustEmpty();
      uploads[0].el.scrollIntoView(false);
    } catch (ex) {
      console.error(ex);
    }
  }

  onfiles(data) {
    if (!this.viewModeRestored) {
      this.restoreViewMode();
    }
    this.filesQueue.push(data);
    if (this.filesQueue.length === 1) {
      this.runOnFiles();
    }
  }

  async runOnFiles() {
    while (this.filesQueue.length) {
      const ridx = this.filesQueue.findIndex((e, i) => i && e.replace);
      if (ridx > 0) {
        // drop everything before
        this.filesQueue.splice(0, ridx);
        continue;
      }
      const data = this.filesQueue.shift();

      const { replace = false } = data;
      if (replace) {
        await this.clear();
      }
      const files = data.files
        .filter((f) => {
          const existing = this.filemap.get(f.key);
          if (!existing) {
            return true;
          }
          existing.update(
            Object.assign({}, f, {
              isNew: this.isFileNew(f, existing),
            }),
          );
          return false;
        })
        .map((f) => {
          f = Object.assign({}, f, { isNew: this.isFileNew(f) });
          f = new File(this, f);
          if (f.expired) {
            return null;
          }
          this.elmap.set(f.el, f);
          this.emit("file-added", f, replace);
          this.emit(`file-added-${f.key}`, f, replace);
          return f;
        })
        .filter((e) => e);
      if (files.length) {
        await this.addFileElements(files);
      }
      if (replace) {
        // Flush localStorage reading-progress entries for files no longer in the room
        flushStaleProgress(new Set(this.filemap.keys()));
        this.emit("replaced");
      }
    }
    this.sortFiles();
    this.tryRestoreBatchQueue().catch(console.error);
  }

  onfilesupdated(files) {
    for (const f of files) {
      const existing = this.filemap.get(f.key);
      if (!existing) {
        continue;
      }
      existing.update(
        Object.assign({}, f, {
          isNew: this.isFileNew(f, existing),
        }),
      );
    }
    this.delayedUpdateStatus();
  }

  onfilesdeleted(files) {
    for (const key of files) {
      const existing = this.filemap.get(key);
      if (!existing) {
        continue;
      }
      this.newFileKeys.delete(key);
      this.forceNewKeys.delete(key);
      existing.remove();
    }
  }

  get(key) {
    return this.filemap.get(key);
  }

  has(key) {
    return this.filemap.has(key);
  }

  clear() {
    Array.from(this.el.querySelectorAll(".file:not(.upload)")).forEach((f) => {
      try {
        this.el.removeChild(f);
      } catch (ex) {
        // ignored
      }
    });
    this.files = [];
    this.filemap.clear();
    this.adjustEmpty();
    this.updateStatus();
  }

  adjustEmpty(forceOn) {
    if (!forceOn && this.el.childElementCount) {
      document.body.classList.remove("empty");
    } else {
      document.body.classList.add("empty");
    }
  }

  setFileStyle(file) {
    if (document.location.hostname === "localhost") {
      return;
    }
    if (this.galleryMode || this.fileStyleLocked) {
      return;
    }
    const rules = [];
    const height = getComputedStyle(file.el, null).getPropertyValue("height");
    rules.push(`#files > .file { height: ${height}; }`);
    const nameHeight = getComputedStyle(file.nameEl, null).getPropertyValue(
      "height",
    );
    rules.push(`#files > .file > .name { height: ${nameHeight}; }`);
    const iconHeight = getComputedStyle(file.iconEl, null).getPropertyValue(
      "height",
    );
    rules.push(`#files > .file > .icon { height: ${iconHeight}; }`);
    const tagsHeight = getComputedStyle(file.tagsEl, null).getPropertyValue(
      "height",
    );
    rules.push(`#files > .file > .tags { height: ${tagsHeight}; }`);
    const detailHeight = getComputedStyle(file.detailEl, null).getPropertyValue(
      "height",
    );
    rules.push(`#files > .file > .detail { height: ${detailHeight}; }`);
    document.body.appendChild(
      dom("style", {
        text: rules.join("\n"),
      }),
    );
    this.fileStyleLocked = true;
  }

  normalizeListRows() {
    this.visible.forEach((f) => {
      f.el.style.width = "100%";
      f.el.style.maxWidth = "100%";
      f.el.style.flex = "0 0 auto";
      f.el.style.removeProperty("min-width");
      f.el.style.removeProperty("min-height");
      f.el.style.removeProperty("height");
    });
    if (!this.fileStyleLocked) {
      const first = this.visible[0];
      if (first) {
        this.setFileStyle(first);
      }
    }
  }

  insertFilesIntoDOM(files, remove) {
    if (remove) {
      remove.forEach((el) => el.parentElement.removeChild(el));
    }
    let head = this.el.querySelector(".file:not(.upload)");
    for (const f of this.filtered(files)) {
      if (head) {
        this.el.insertBefore(f.el, head);
      } else {
        this.el.appendChild(f.el);
        this.setFileStyle(f);
      }
      if (this.galleryMode) {
        f.adjustPreview();
      }
      head = f.el;
    }
  }

  async addFileElements(files) {
    try {
      REMOVALS.trigger();
      // XXX not restore save
      if (!this.files.length) {
        this.files = files;
        this.filemap = new Map(this.files.map((f) => [f.key, f]));
      } else {
        this.files.push(...files);
        if (files.length > 5) {
          this.filemap = new Map(this.files.map((f) => [f.key, f]));
        } else {
          files.forEach((e) => this.filemap.set(e.key, e));
        }
      }
      this.adjustEmpty();
      this.scrollState.push();
      await this.insertFilesIntoDOM(files);
      this.adjustEmpty();
      await this.scrollState.pop();
      if (!this.newFiles) {
        const { scrollTop, offsetTop: ot } = this.el;
        for (const file of files) {
          const { offsetHeight, offsetTop } = file.el;
          const top = offsetTop - ot;
          const bottom = top + offsetHeight;
          if (bottom <= scrollTop) {
            this.newFiles = true;
          }
        }
      }
      this.delayedUpdateStatus();
      if (this.pendingNotificationHighlightKey) {
        this.highlightFromNotification(this.pendingNotificationHighlightKey);
      }
    } catch (ex) {
      console.error(ex);
    }
  }

  highlightFromNotification(key) {
    if (!key) {
      return false;
    }
    const file = this.get(key);
    if (!file || !file.el || !file.el.parentElement) {
      this.pendingNotificationHighlightKey = key;
      return false;
    }
    this.pendingNotificationHighlightKey = null;
    try {
      file.el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (ex) {
      file.el.scrollIntoView(false);
    }
    file.el.classList.add("notification-focus");
    setTimeout(() => {
      if (file && file.el) {
        file.el.classList.remove("notification-focus");
      }
    }, 2200);
    return true;
  }

  sortFiles() {
    const { visible } = this;
    if (!visible.length) {
      return;
    }
    const [head] = visible;
    sort(visible, (e) => e.uploaded).reverse();
    let idx = 0;
    const { el } = this;
    for (; idx < el.childElementCount; ++idx) {
      if (el.children[idx] === head.el) {
        break;
      }
    }
    for (const v of visible) {
      if (el.children[idx] === v.el) {
        ++idx;
        continue;
      }
      el.insertBefore(v.el, el.children[idx]);
      ++idx;
    }
  }

  iterfrom(file) {
    const idx = this.files.indexOf(file);
    if (idx < 0) {
      return null;
    }
    return iter(this.files, idx);
  }

  riterfrom(file) {
    const idx = this.files.indexOf(file);
    if (idx < 0) {
      return null;
    }
    return riter(this.files, idx);
  }

  removeFileElements(files) {
    try {
      if (files.length > 3) {
        for (const f of files) {
          this.filemap.delete(f.key);
        }
        this.files = Array.from(this.filemap.values());
        return;
      }
      for (const f of files) {
        if (this.filemap.delete(f.key)) {
          this.files.splice(this.files.indexOf(f), 1);
        }
      }
    } finally {
      this.adjustEmpty();
      this.delayedUpdateStatus();
    }
  }

  addUploadElements(uploads) {
    try {
      for (const u of uploads) {
        this.el.insertBefore(u.el, this.el.firstChild);
      }
    } catch (ex) {
      console.error(ex);
    }
  }

  get selection() {
    return Array.from(document.querySelectorAll(".file.selected"))
      .map((e) => this.elmap.get(e))
      .filter((e) => e);
  }

  select(file, e) {
    const { metaKey: meta, ctrlKey: ctrl, shiftKey: shift } = e;
    // Windows style of engagement
    if (shift) {
      const { visible } = this;
      let startIdx;
      if (!this.selectionStart) {
        [this.selectionStart] = visible;
        startIdx = 0;
      } else {
        startIdx = visible.indexOf(this.selectionStart);
        if (startIdx < 0) {
          [this.selectionStart] = visible;
          startIdx = 0;
        }
      }
      let endIdx = visible.indexOf(file);
      if (startIdx > endIdx) {
        [startIdx, endIdx] = [endIdx, startIdx];
      }
      this._clearSelection();
      visible
        .slice(startIdx, endIdx + 1)
        .forEach((e) => e.el.classList.add("selected"));
    } else if (ctrl || meta) {
      file.el.classList.toggle("selected");
    } else {
      const already = file.el.classList.contains("selected");
      this._clearSelection();
      if (!already) {
        file.el.classList.add("selected");
        this.selectionStart = file;
      } else {
        this.selectionStart = null;
      }
    }
  }

  _clearSelection() {
    this.selection.forEach((e) => e.el.classList.remove("selected"));
  }

  selectAll() {
    this.selectionStart = null;
    this.visible.forEach((f) => f.el.classList.add("selected"));
  }

  clearSelection() {
    this.selectionStart = null;
    this._clearSelection();
  }

  trash() {
    const { selection } = this;
    if (!selection.length) {
      registry.messages.addSystemMessage(
        "Select some files by (shift-, ctrl-)clicking on their icon first",
      );
      return;
    }
    this.clearSelection();
    this.trashFiles(selection);
  }

  trashFiles(files) {
    registry.socket.emit(
      "trash",
      files.map((e) => e.key).filter((e) => e),
    );
  }

  subjectsFromSelection() {
    const { selection } = this;
    const subjects = {
      ips: [],
      accounts: [],
    };
    if (!selection.length) {
      return subjects;
    }
    selection.forEach((f) => {
      if (f.ip) {
        subjects.ips.push(f.ip);
      }
      if (f.meta && f.meta.account) {
        subjects.accounts.push(f.meta.account);
      }
    });
    subjects.ips = Array.from(new Set(subjects.ips));
    subjects.accounts = Array.from(new Set(subjects.accounts));
    return subjects;
  }

  banFiles() {
    const subjects = this.subjectsFromSelection();
    registry.roomie.showBanModal(subjects, "greyzone");
  }

  unbanFiles() {
    const subjects = this.subjectsFromSelection();
    registry.roomie.showUnbanModal(subjects);
  }

  blacklist() {
    const selected = this.selection.map((e) => e.key);
    if (!selected.length) {
      return;
    }
    registry.roomie.showBlacklistModal(selected);
  }

  whitelist() {
    const selected = this.selection
      .filter((e) => e.tagsMap.has("hidden"))
      .map((e) => e.key);
    if (!selected.length) {
      return;
    }
    registry.socket.emit("whitelist", selected);
  }

  purgeFrom(subjects) {
    const ips = new Set(subjects.ips);
    const accounts = new Set(subjects.accounts);
    const a = accounts.size > 0;
    const purges = this.files.filter((f) => {
      return ips.has(f.ip) || (a && f.meta && accounts.has(f.meta.account));
    });
    this.trashFiles(purges);
  }

  applyViewMode(galleryMode, persist = true) {
    // Deactivate links mode if we're switching back to file view
    if (this.linksMode) {
      this.linksMode = false;
      if (registry.links) registry.links.hide();
      if (this.linkModeEl) this.linkModeEl.classList.remove("active");
      this.el.classList.remove("hidden");
    }

    this.galleryMode = !!galleryMode;
    if (this.galleryMode) {
      this.nailOffEl.classList.remove("active");
      this.el.classList.remove("listmode");
      this.nailOnEl.classList.add("active");
      this.el.classList.add("gallerymode");
      this.visible.forEach((f) => {
        f.el.style.removeProperty("width");
        f.el.style.removeProperty("max-width");
        f.el.style.removeProperty("flex");
      });

      APOOL.schedule(null, () =>
        this.visible.forEach((f) => f.adjustPreview()),
      );
    } else {
      this.nailOffEl.classList.add("active");
      this.el.classList.add("listmode");
      this.nailOnEl.classList.remove("active");
      this.el.classList.remove("gallerymode");
      this.normalizeListRows();
      requestAnimationFrame(() => this.normalizeListRows());
    }

    if (persist) {
      this.persistViewMode();
    }
    APOOL.schedule(null, () => this.scroller.update());
  }

  linkMode() {
    if (this.linksMode) {
      // Toggle off — restore previous list/gallery state
      this.linksMode = false;
      if (registry.links) registry.links.hide();
      if (this.linkModeEl) this.linkModeEl.classList.remove("active");
      this.el.classList.remove("hidden");
      // Restore correct nail active state
      if (this.galleryMode) {
        this.nailOnEl.classList.add("active");
      } else {
        this.nailOffEl.classList.add("active");
      }
      this.persistViewMode();
      return;
    }
    // Activate links mode — deactivate list/gallery nail buttons
    this.nailOffEl.classList.remove("active");
    this.nailOnEl.classList.remove("active");
    this.linksMode = true;
    this.el.classList.add("hidden");
    if (registry.links) registry.links.show();
    if (this.linkModeEl) this.linkModeEl.classList.add("active");
    this.persistViewMode();
  }

  nailOff() {
    this.applyViewMode(false, true);
  }

  nailOn() {
    this.applyViewMode(true, true);
  }

  async uploadOne(u) {
    await u.upload();
  }
})();
