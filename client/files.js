"use strict";

import EventEmitter from "events";
import { APOOL } from "./animationpool";
import DownloadBatchModal from "./files/downloadmodal";
import File from "./files/file";
import * as filesfilter from "./files/filter";
import Gallery from "./files/gallery";
// Reader is lazy-loaded; progress cleanup uses dynamic import.
import RequestModal, { RequestViewModal } from "./files/requestmodal";
import RequestBoardModal from "./files/requestboard";
import {
  resolveDeepLinkNavigation,
  applyDeepLinkIntents,
  resolveDeepLinkOpenPlan,
  shouldApplyDeepLinkListIntents,
} from "../lib/room/deep-links";
import {
  buildActivityDigest,
  buildResumeEntries,
  didCompleteCatchUpDownload,
  isLinkedDelta,
  isLinkedFile,
  isOwnUpload,
  linkedSourceId,
  normalizeVisitState,
  wasFulfilledSince,
} from "../lib/room/continuity";
import ScrollState from "./files/scrollstate";
import { REMOVALS } from "./files/tracker";
import Upload from "./files/upload";
import {
  computeWindow,
  shouldVirtualize,
  sliceWindow,
} from "./files/windowing";
import { getVisibleWindow as computeVisibleWindow } from "./files/list-window";
import {
  SORT_MODES as LIST_SORT_MODES,
  applyFilterButtonState,
  collectFilterButtonState,
  normalizeSortMode,
  parseFilterState,
  serializeFilterState,
  sortFiles,
} from "./files/list-state";
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
const PRESETS_PREFIX = "dicefiles:filterpresets:room:";
const SORT_MODE_PREFIX = "dicefiles:sortmode:room:";
const FILTER_STATE_PREFIX = "dicefiles:filterstate:room:";
const SORT_MODES = LIST_SORT_MODES;

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
    this.requestBoardEl = document.querySelector("#requestboard");
    this.requestPillEl =
      document.querySelector(".request-pill") ||
      (this.createRequestEl && this.createRequestEl.closest(".btn-pill"));
    this._deepLinkListApplied = false;
    this._deepLinkOpenDone = false;
    this._requestBoardOpened = false;
    this._legacyGalleryOpened = false;
    this._filesListReady = false;
    this.files = [];
    this.filemap = new Map();
    this.elmap = new WeakMap();
    this.scrollState = new ScrollState(this);
    this.newFiles = false;
    this.selectionStart = null;
    this.galleryMode = false;
    this.linksMode = false;
    this.ownUploadKeys = new Set();
    this.newFileKeys = new Set();
    this.forceNewKeys = new Set();
    this.newSinceServerTime = 0;
    this.newStateKey = null;
    this.knownLinkedKeys = null;
    this.knownLinkedRooms = null;
    this.continuityDigest = null;
    this.resumeEntries = [];
    this._continuityRefreshVersion = 0;
    this.continuityEl = document.querySelector("#continuity");
    this.continuityResumeEl = document.querySelector("#continuity-resume");
    this.continuityResumeNameEl = document.querySelector(
      "#continuity-resume-name",
    );
    this.continuityDigestToggleEl = document.querySelector(
      "#continuity-digest-toggle",
    );
    this.continuityDigestControlEl = document.querySelector(
      "#continuity-digest-control",
    );
    this.continuityDigestCountEl = document.querySelector(
      "#continuity-digest-count",
    );
    this.continuityDownloadAllEl = document.querySelector(
      "#continuity-download-all",
    );
    this.continuityDigestEl = document.querySelector("#continuity-digest");
    this.continuityMarkSeenEl = document.querySelector(
      "#continuity-mark-seen",
    );
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
    // Saved filters and sort state
    this.presetsKey = null;
    this.sortModeKey = null;
    this.filterStateKey = null;
    this.sortMode = "newest"; // newest | largest | expiring
    this.showingNewOnly = false;
    this._restoringFilter = false;
    this.presetsEl = document.querySelector("#presets-row");
    this.presetsListEl = document.querySelector("#presets-list");
    this.presetSaveEl = document.querySelector("#preset-save");
    this.sortNewestEl = document.querySelector("#sort-newest");
    this.sortLargestEl = document.querySelector("#sort-largest");
    this.sortExpiringEl = document.querySelector("#sort-expiring");
    this.showNewBtnEl = document.querySelector("#show-new-btn");

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
    if (this.requestBoardEl) {
      this.requestBoardEl.addEventListener(
        "click",
        this.openRequestBoard.bind(this),
        true,
      );
    }

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

    // Filter preset button wiring
    if (this.presetSaveEl) {
      this.presetSaveEl.addEventListener(
        "click",
        this.onPresetSave.bind(this),
        true,
      );
    }
    if (this.sortNewestEl) {
      this.sortNewestEl.addEventListener(
        "click",
        () => this.setSortMode("newest"),
        true,
      );
    }
    if (this.sortLargestEl) {
      this.sortLargestEl.addEventListener(
        "click",
        () => this.setSortMode("largest"),
        true,
      );
    }
    if (this.sortExpiringEl) {
      this.sortExpiringEl.addEventListener(
        "click",
        () => this.setSortMode("expiring"),
        true,
      );
    }
    if (this.showNewBtnEl) {
      this.showNewBtnEl.addEventListener(
        "click",
        this.toggleNewOnly.bind(this),
        true,
      );
    }
    if (this.continuityResumeEl) {
      this.continuityResumeEl.addEventListener(
        "click",
        this.resumeReading.bind(this),
      );
    }
    if (this.continuityDigestToggleEl) {
      this.continuityDigestToggleEl.addEventListener(
        "click",
        this.toggleContinuityDigest.bind(this),
      );
    }
    if (this.continuityDownloadAllEl) {
      this.continuityDownloadAllEl.addEventListener(
        "click",
        this.downloadContinuity.bind(this),
      );
    }
    if (this.continuityMarkSeenEl) {
      this.continuityMarkSeenEl.addEventListener(
        "click",
        this.markContinuitySeen.bind(this),
      );
    }
    if (this.continuityDigestEl) {
      this.continuityDigestEl.addEventListener(
        "click",
        this.onContinuityItem.bind(this),
      );
    }

    // Virtualized list state (must be declared before seal())
    this._rowHeightHint = 52;
    this._virtStart = null;
    this._virtEnd = null;
    this._virtRefreshScheduled = false;

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
      this.presetsKey = `${PRESETS_PREFIX}${roomid}`;
      this.sortModeKey = `${SORT_MODE_PREFIX}${roomid}`;
      this.filterStateKey = `${FILTER_STATE_PREFIX}${roomid}`;
    }
    this.initSortMode();
    this.renderPresets();
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
    this.restoreFilterState();
    this.restoreViewMode();
    registry.socket.on("files", this.onfiles);
    registry.socket.on("files-deleted", this.onfilesdeleted);
    registry.socket.on("files-updated", this.onfilesupdated);
    registry.socket.on("nick", () => this.refreshContinuity());
    registry.socket.on("authed", () => this.refreshContinuity());
    registry.roomie.on("tooltip-hidden", () => this.adjustEmpty());
    registry.socket.on("config", () => {
      this.updateCapabilityButtons();
      this.maybeApplyDeepLinks();
    });
    this.updateCapabilityButtons();
    // File list often arrives after config — retry open intents on every replace
    // until open is resolved (see resolveDeepLinkOpenPlan).
    this.on("replaced", () => {
      this._filesListReady = true;
      this.maybeApplyDeepLinks();
    });
    addEventListener("pagehide", this.onleave, { passive: true });
    addEventListener("beforeunload", this.onleave, { passive: true });
    addEventListener(
      "dicefiles:reader-progress",
      debounce(() => this.refreshContinuity(), 500),
    );
  }

  updateCapabilityButtons() {
    const allowRequests = registry.config.get("allowRequests");
    const linkCollection = registry.config.get("linkCollection");
    // undefined = config not yet received from server; default to showing the pill
    const hideRequests = allowRequests === false;
    if (this.requestPillEl) {
      this.requestPillEl.classList.toggle("hidden", hideRequests);
    }
    if (this.createRequestEl) {
      this.createRequestEl.classList.toggle("hidden", hideRequests);
    }
    if (this.requestBoardEl) {
      this.requestBoardEl.classList.toggle("hidden", hideRequests);
    }
    if (this.linkModeEl) {
      this.linkModeEl.classList.toggle("hidden", linkCollection === false);
      // If we're in links mode and it just got disabled, exit links mode
      if (linkCollection === false && this.linksMode) {
        this.normalMode();
      }
    }
  }

  openRequestBoard(initialStatus) {
    if (registry.config.get("allowRequests") === false) {
      return;
    }
    const status =
      typeof initialStatus === "string" ? initialStatus : undefined;
    registry.roomie
      .showModal(new RequestBoardModal(this, { status }))
      .catch((ex) => {
        if (ex) {
          console.error(ex);
        }
      });
  }

  /**
   * Admin-gated shareable deep links + always-on legacy gallery #key.
   * Config often arrives before files — list intents apply once; open intents
   * stay pending until the filemap has the key (or list is ready and missing).
   */
  maybeApplyDeepLinks() {
    const nav = resolveDeepLinkNavigation({
      search: document.location.search,
      hash: document.location.hash,
      deepLinksEnabled: !!registry.config.get("deepLinks"),
    });

    // Legacy gallery hash always works when bare #fileKey (retry until found)
    if (nav.legacyGalleryKey && !this._legacyGalleryOpened) {
      const file = this.get(nav.legacyGalleryKey);
      if (file) {
        this.gallery.open(file);
        this._legacyGalleryOpened = true;
      }
    }

    if (!nav.applyIntents) {
      return;
    }

    const next = applyDeepLinkIntents(
      {
        filter: this.filter ? this.filter.value : "",
        sortMode: this.sortMode,
        openFileKey: null,
        openRequestKey: null,
        requestBoardStatus: null,
      },
      nav.intents,
      true,
    );

    if (
      next.requestBoardStatus &&
      this._filesListReady &&
      !this._requestBoardOpened
    ) {
      this._requestBoardOpened = true;
      this.openRequestBoard(next.requestBoardStatus);
    }

    if (
      shouldApplyDeepLinkListIntents({
        applyIntents: true,
        listAlreadyApplied: this._deepLinkListApplied,
      })
    ) {
      this._deepLinkListApplied = true;
      if (next.sortMode && next.sortMode !== this.sortMode) {
        this.setSortMode(next.sortMode);
      }
      if (this.filter && typeof next.filter === "string") {
        this.filter.value = next.filter;
        this.doFilter();
      }
    }

    const openPlan = resolveDeepLinkOpenPlan({
      openFileKey: next.openFileKey,
      openRequestKey: next.openRequestKey,
      filesReady: this._filesListReady,
      openAlreadyDone: this._deepLinkOpenDone,
      lookup: (key) => this.get(key) || null,
    });

    if (openPlan.tryOpenRequest) {
      const req = this.get(openPlan.tryOpenRequest);
      if (req && req.isRequest) {
        registry.roomie.showModal(new RequestViewModal(req)).catch(() => {});
      }
    } else if (openPlan.tryOpenFile) {
      const file = this.get(openPlan.tryOpenFile);
      if (file && !file.isRequest) {
        this.gallery.open(file);
      }
    }
    if (openPlan.openDone) {
      this._deepLinkOpenDone = true;
    }
  }

  initNewState() {
    const fallback = registry.roomie.toServerTime(Date.now());
    try {
      const raw = localStorage.getItem(this.newStateKey);
      if (!raw) {
        this.newSinceServerTime = fallback;
        this.knownLinkedKeys = null;
        this.knownLinkedRooms = null;
        return;
      }
      const state = normalizeVisitState(JSON.parse(raw), fallback);
      this.newSinceServerTime = state.lastSeenServerTime;
      this.knownLinkedKeys = state.knownLinkedKeys;
      this.knownLinkedRooms = state.knownLinkedRooms;
    } catch (ex) {
      this.newSinceServerTime = fallback;
      this.knownLinkedKeys = null;
      this.knownLinkedRooms = null;
    }
  }

  persistNewState() {
    const seenAt = registry.roomie.toServerTime(Date.now());
    const linkedKeys = this.currentLinkedKeys();
    const linkedRooms = this.currentLinkedRooms();
    try {
      localStorage.setItem(
        this.newStateKey,
        JSON.stringify({
          lastSeenServerTime: seenAt,
          knownLinkedKeys: linkedKeys,
          knownLinkedRooms: linkedRooms,
        }),
      );
    } catch (ex) {
      // ignored
    }
    return { seenAt, linkedKeys, linkedRooms };
  }

  onleave() {
    this.persistNewState();
  }

  currentLinkedKeys() {
    return this.files
      .filter((file) => isLinkedFile(file))
      .map((file) => file.key)
      .filter(Boolean);
  }

  currentLinkedRooms() {
    return Array.from(
      new Set(this.files.map(linkedSourceId).filter(Boolean)),
    );
  }

  get continuityViewer() {
    const chatbox = registry.chatbox || {};
    return {
      account: chatbox.authed || "",
      nick:
        chatbox.currentNick ||
        (chatbox.nick && chatbox.nick.value) ||
        "",
    };
  }

  get continuityState() {
    return {
      lastSeenServerTime: this.newSinceServerTime,
      knownLinkedKeys: this.knownLinkedKeys,
      knownLinkedRooms: this.knownLinkedRooms,
    };
  }

  async refreshContinuity() {
    if (!this.continuityEl) {
      return;
    }
    const refreshVersion = ++this._continuityRefreshVersion;
    const viewer = this.continuityViewer;
    let clearedOwnMarkers = false;
    for (const file of this.files) {
      if (
        file &&
        !file.isRequest &&
        (this.ownUploadKeys.has(file.key) ||
          isOwnUpload(file, viewer)) &&
        (this.newFileKeys.delete(file.key) ||
          this.forceNewKeys.delete(file.key) ||
          file.el.classList.contains("is-new"))
      ) {
        this.forceNewKeys.delete(file.key);
        file.setNew(false);
        clearedOwnMarkers = true;
      }
    }
    if (clearedOwnMarkers) {
      this.delayedUpdateStatus();
    }
    const digest = buildActivityDigest(
      this.files.filter((file) => !this.ownUploadKeys.has(file.key)),
      this.continuityState,
      viewer,
    );
    let resumeEntries;
    try {
      const { listProgress } = await import(
        /* webpackChunkName: "reader" */ "./files/reader/opts"
      );
      resumeEntries = buildResumeEntries(
        this.files,
        listProgress(new Set(this.filemap.keys())),
        3,
      );
    } catch (ex) {
      resumeEntries = [];
    }
    // Multiple file/progress events may overlap while the reader chunk loads.
    // Only the newest snapshot may render.
    if (refreshVersion !== this._continuityRefreshVersion) {
      return;
    }
    this.continuityDigest = digest;
    this.resumeEntries = resumeEntries;

    const resume = this.resumeEntries[0];
    const newCount = this.continuityDigest.total;
    const downloadCount = this.continuityDownloadable.length;
    this.continuityResumeEl.classList.toggle("hidden", !resume);
    this.continuityDigestControlEl.classList.toggle("hidden", !newCount);
    this.continuityMarkSeenEl.classList.toggle("hidden", !newCount);
    this.continuityDownloadAllEl.disabled = downloadCount === 0;
    this.continuityDownloadAllEl.title = downloadCount
      ? `Download all ${downloadCount} new upload${
          downloadCount === 1 ? "" : "s"
        }`
      : "No downloadable uploads";
    this.continuityDownloadAllEl.setAttribute(
      "aria-label",
      this.continuityDownloadAllEl.title,
    );
    if (resume) {
      this.continuityResumeNameEl.textContent = resume.file.name;
      this.continuityResumeEl.title = `Resume ${resume.file.name}`;
    }
    if (newCount) {
      this.continuityDigestCountEl.textContent = `${newCount} new ${
        newCount === 1 ? "upload" : "uploads"
      }`;
    } else {
      this.continuityDigestEl.classList.add("hidden");
      this.continuityDigestToggleEl.setAttribute("aria-expanded", "false");
    }

    this.renderContinuityDigest();
    const visible = !!resume || newCount > 0;
    this.continuityEl.classList.toggle("hidden", !visible);
    const filelist = this.continuityEl.closest("#filelist");
    if (filelist) {
      filelist.classList.toggle("continuity-visible", visible);
    }
  }

  get continuityDownloadable() {
    if (!this.continuityDigest) {
      return [];
    }
    return this.continuityDigest.keys
      .map((key) => this.filemap.get(key))
      .filter(
        (file) =>
          file &&
          !file.expired &&
          !file.isRequest &&
          !(file.meta && file.meta.request),
      );
  }

  renderContinuityDigest() {
    if (!this.continuityDigestEl || !this.continuityDigest) {
      return;
    }
    this.continuityDigestEl.textContent = "";
    const sections = [
      ["fulfilledRequests", "Fulfilled requests"],
      ["requests", "New requests"],
      ["linked", "Linked-room arrivals"],
      ["bots", "Bot uploads"],
      ["uploads", "Uploads"],
    ];
    for (const [key, label] of sections) {
      const files = this.continuityDigest[key];
      if (!files.length) {
        continue;
      }
      const section = dom("section", { classes: ["continuity-section"] });
      section.appendChild(
        dom("h3", {
          classes: ["continuity-section-title"],
          text: `${label} · ${files.length}`,
        }),
      );
      for (const file of files) {
        const source =
          key === "linked"
            ? (file.meta &&
                (file.meta.linkedRoomName || file.meta.linkedFrom)) ||
              file.linkedFrom ||
              "linked room"
            : key === "bots"
              ? (file.meta &&
                  (file.meta.botName || file.meta.plugin)) ||
                "bot"
              : key === "fulfilledRequests"
                ? file.fulfilledByNick || "fulfilled"
                : "";
        const row = dom("button", {
          attrs: {
            type: "button",
            "data-file-key": file.key,
          },
          classes: ["continuity-item"],
        });
        row.appendChild(
          dom("span", {
            classes: ["continuity-item-name"],
            text: file.name || file.key,
          }),
        );
        if (source) {
          row.appendChild(
            dom("span", {
              classes: ["continuity-item-source"],
              text: source,
            }),
          );
        }
        section.appendChild(row);
      }
      this.continuityDigestEl.appendChild(section);
    }
  }

  toggleContinuityDigest() {
    if (!this.continuityDigestEl || !this.continuityDigestToggleEl) {
      return;
    }
    const open = this.continuityDigestEl.classList.contains("hidden");
    this.continuityDigestEl.classList.toggle("hidden", !open);
    this.continuityDigestToggleEl.setAttribute(
      "aria-expanded",
      open ? "true" : "false",
    );
  }

  async resumeReading() {
    const entry = this.resumeEntries[0];
    if (!entry || !entry.file) {
      return;
    }
    try {
      await this.gallery.read(entry.file);
    } catch (ex) {
      console.error(ex);
    }
  }

  async downloadContinuity() {
    const targets = this.continuityDownloadable;
    if (!targets.length) {
      return;
    }
    const result = await this.downloadBatch(
      targets,
      "Download Since Your Last Visit",
      { autoStart: true },
    );
    if (didCompleteCatchUpDownload(result)) {
      this.markContinuitySeen();
    }
  }

  onContinuityItem(e) {
    const item = e.target.closest("[data-file-key]");
    if (!item || !this.continuityDigestEl.contains(item)) {
      return;
    }
    const file = this.get(item.dataset.fileKey);
    if (!file) {
      return;
    }
    if (file.isRequest) {
      registry.roomie.showModal(new RequestViewModal(file)).catch(() => {});
      return;
    }
    if (this.linksMode) {
      this.linkMode();
    }
    if (this.showingNewOnly) {
      this.showingNewOnly = false;
      this.showNewBtnEl.classList.remove("active");
    }
    if (this.filter && this.filter.value) {
      this.filter.value = "";
    }
    this.doFilter();
    requestAnimationFrame(() => {
      file.el.scrollIntoView({ block: "center", behavior: "smooth" });
      file.el.classList.remove("continuity-focus");
      requestAnimationFrame(() => file.el.classList.add("continuity-focus"));
    });
    this.continuityDigestEl.classList.add("hidden");
    this.continuityDigestToggleEl.setAttribute("aria-expanded", "false");
  }

  markContinuitySeen() {
    const { seenAt, linkedKeys, linkedRooms } = this.persistNewState();
    this.newSinceServerTime = seenAt;
    this.knownLinkedKeys = linkedKeys;
    this.knownLinkedRooms = linkedRooms;
    this.newFileKeys.clear();
    this.forceNewKeys.clear();
    this.ownUploadKeys.clear();
    for (const file of this.files) {
      file.setNew(false);
    }
    this.delayedUpdateStatus();
    this.refreshContinuity();
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
    if (
      this.ownUploadKeys.has(file.key) ||
      (!((file.meta && file.meta.request) || file.isRequest) &&
        isOwnUpload(file, this.continuityViewer))
    ) {
      this.forceNewKeys.delete(file.key);
      this.newFileKeys.delete(file.key);
      return false;
    }
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
    const state = {
      lastSeenServerTime: this.newSinceServerTime,
      knownLinkedKeys: this.knownLinkedKeys,
      knownLinkedRooms: this.knownLinkedRooms,
    };
    if (
      wasFulfilledSince(file, this.newSinceServerTime) ||
      isLinkedDelta(file, state)
    ) {
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

  markOwnUpload(key) {
    if (!key) {
      return;
    }
    this.ownUploadKeys.add(key);
    this.forceNewKeys.delete(key);
    this.newFileKeys.delete(key);
    const existing = this.filemap.get(key);
    if (existing) {
      existing.setNew(false);
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
    // Re-window the virtualized file list as the user scrolls so only a
    // viewport-bounded set of rows stays mounted.
    this.scheduleVirtualWindowRefresh();
  }

  scheduleVirtualWindowRefresh() {
    if (this._virtRefreshScheduled) {
      return;
    }
    this._virtRefreshScheduled = true;
    requestAnimationFrame(() => {
      this._virtRefreshScheduled = false;
      this.refreshVirtualWindow();
    });
  }

  /**
   * Remount the viewport window for large filtered lists.
   * No-op when virtualization is off (small lists / gallery / links).
   */
  refreshVirtualWindow() {
    try {
      if (this.galleryMode || this.linksMode) {
        return;
      }
      // Pass the full standing list — never null/visible (mounted-only slice).
      const windowed = this.getVisibleWindow(this.files);
      if (!windowed.virtualized) {
        return;
      }
      // Skip if the window indices did not change (same mounted range).
      if (
        this._virtStart === windowed.start &&
        this._virtEnd === windowed.end
      ) {
        return;
      }
      this._virtStart = windowed.start;
      this._virtEnd = windowed.end;

      // Remove currently mounted file rows (keep spacers / uploads).
      const toRemove = [];
      for (const child of Array.from(this.el.children)) {
        if (
          child.classList &&
          child.classList.contains("file") &&
          !child.classList.contains("upload")
        ) {
          toRemove.push(child);
        }
      }
      // Re-insert only the windowed slice via the same DOM path.
      this.insertFilesIntoDOM(this.files, toRemove);
    }
    catch (ex) {
      console.error(ex);
    }
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
    if (!this._restoringFilter) {
      this.persistFilterState();
    }
    REMOVALS.trigger();
    if (!this.applying) {
      this.applying = this.applyFilter().then(() => (this.applying = null));
    }
  }

  persistFilterState() {
    if (!this.filterStateKey) {
      return;
    }
    try {
      const payload = serializeFilterState({
        buttons: collectFilterButtonState(this.filterButtons),
        query: this.filter ? this.filter.value : "",
        showingNewOnly: this.showingNewOnly,
      });
      localStorage.setItem(this.filterStateKey, payload);
    } catch (_) {
      /* no-op */
    }
  }

  restoreFilterState() {
    if (!this.filterStateKey) {
      return;
    }
    let raw = null;
    try {
      raw = localStorage.getItem(this.filterStateKey);
    } catch (_) {
      return;
    }
    const state = parseFilterState(raw);
    if (!state) {
      return;
    }
    this._restoringFilter = true;
    try {
      applyFilterButtonState(this.filterButtons, state.buttons);
      if (this.filter && typeof state.query === "string") {
        this.filter.value = state.query;
      }
      this.showingNewOnly = !!state.showingNewOnly;
      if (this.showNewBtnEl) {
        this.showNewBtnEl.classList.toggle("active", this.showingNewOnly);
        this.showNewBtnEl.setAttribute(
          "aria-pressed",
          this.showingNewOnly ? "true" : "false",
        );
      }
      this.doFilter();
    } finally {
      this._restoringFilter = false;
      this.persistFilterState();
    }
  }

  filtered(files) {
    const { filterFunc } = this;
    let result;
    if (filterFunc === filesfilter.NONE) {
      result = [];
    } else if (filterFunc) {
      result = files.filter(filterFunc);
    } else {
      result = files;
    }
    if (this.showingNewOnly) {
      result = result.filter(
        (f) => Number(f.uploaded) > this.newSinceServerTime,
      );
    }
    return result;
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

  async openRequestView(fileInst) {
    try {
      await registry.init();
      const isMod = document.body.classList.contains("mod");
      const modal = new RequestViewModal(fileInst, { isMod });
      let result;
      try {
        result = await registry.roomie.showModal(modal);
      } catch (ex) {
        if (!ex || ex.message === "cancelled") {
          return;
        }
        throw ex;
      }
      if (!result || !result.action) {
        return;
      }
      const { action } = result;
      if (action === "remove" || action === "fulfill" || action === "reopen") {
        const status =
          action === "reopen"
            ? "open"
            : action === "remove"
              ? "removed"
              : "fulfilled";
        const ack = await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Request timeout")),
            10000,
          );
          registry.socket.emit(
            "requeststatus",
            { key: fileInst.key, status },
            (rv) => {
              clearTimeout(timeout);
              resolve(rv || {});
            },
          );
        });
        if (ack.err) {
          throw new Error(ack.err);
        }
      }
    } catch (ex) {
      if (!ex || ex.message === "cancelled") {
        return;
      }
      registry.messages.addSystemMessage(
        `Failed to update request: ${ex.message || ex}`,
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
    if (options.autoStart && modal.startBtn) {
      modal.startBtn.click();
    }
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
      return null;
    }

    queueState.started = true;
    queueState.startedAt = Date.now();
    this.persistBatchQueue(queueState);

    let result = null;
    try {
      result = await this.runBatchDownload(targets, modal, queueState);
    } catch (ex) {
      console.error(ex);
    }
    await modalPromise;
    this.batchRunning = false;
    return result;
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
    const result = {
      done,
      failed,
      skipped,
      cancelled: modal.cancelRequested,
      report,
    };
    modal.finish(done, failed, skipped, result.cancelled, report);
    return result;
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
    return !!(
      document.querySelector(".modal-requestcreate") ||
      document.querySelector(".modal-requestview")
    );
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
        // First visit (and pre-v2 visit records) starts with the current mirrors
        // as its baseline. Newly arriving mirrors after this point are deltas.
        if (this.knownLinkedKeys === null) {
          this.knownLinkedKeys = this.currentLinkedKeys();
        }
        if (this.knownLinkedRooms === null) {
          this.knownLinkedRooms = this.currentLinkedRooms();
        }
        // Bound old reader history without erasing progress from other rooms.
        import(
          /* webpackChunkName: "reader" */ "./files/reader/opts"
        ).then(({ pruneProgress }) => {
          pruneProgress();
        }).catch(() => {});
        this.emit("replaced");
      }
    }
    this.sortFiles();
    this.tryRestoreBatchQueue().catch(console.error);
    this.refreshContinuity();
    this.emit("files-changed");
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
    this.refreshContinuity();
    this.emit("files-changed");
  }

  onfilesdeleted(files) {
    for (const key of files) {
      const existing = this.filemap.get(key);
      if (!existing) {
        continue;
      }
      this.newFileKeys.delete(key);
      this.forceNewKeys.delete(key);
      this.ownUploadKeys.delete(key);
      existing.remove();
    }
    this.refreshContinuity();
    this.emit("files-changed");
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
      const [first] = this.visible;
      if (first) {
        this.setFileStyle(first);
      }
    }
  }

  /**
   * Active window of filtered files for virtualized list rendering.
   * When the filtered set is large, only a viewport-bounded slice is mounted.
   */
  getVisibleWindow(files = null) {
    return computeVisibleWindow(this, files);
  }

  insertFilesIntoDOM(files, remove) {
    if (remove) {
      remove.forEach((el) => {
        if (el && el.parentElement) {
          el.parentElement.removeChild(el);
        }
      });
    }
    const windowed = this.getVisibleWindow(files);
    const toInsert = windowed.virtualized
      ? windowed.items
      : Array.from(this.filtered(files));
    if (windowed.virtualized) {
      this._virtStart = windowed.start;
      this._virtEnd = windowed.end;
    }
    else {
      this._virtStart = null;
      this._virtEnd = null;
    }

    // Spacer maintains scroll height when only a window is mounted.
    let topSpacer = this.el.querySelector(".filelist-spacer-top");
    let bottomSpacer = this.el.querySelector(".filelist-spacer-bottom");
    if (windowed.virtualized) {
      if (!topSpacer) {
        topSpacer = document.createElement("div");
        topSpacer.className = "filelist-spacer-top";
        topSpacer.setAttribute("aria-hidden", "true");
        this.el.insertBefore(topSpacer, this.el.firstChild);
      }
      if (!bottomSpacer) {
        bottomSpacer = document.createElement("div");
        bottomSpacer.className = "filelist-spacer-bottom";
        bottomSpacer.setAttribute("aria-hidden", "true");
        this.el.appendChild(bottomSpacer);
      }
      topSpacer.style.height = `${windowed.offsetY}px`;
      const bottom = Math.max(
        0,
        windowed.totalHeight - windowed.offsetY - windowed.items.length * (this._rowHeightHint || 52),
      );
      bottomSpacer.style.height = `${bottom}px`;
    }
    else {
      if (topSpacer) {
        topSpacer.remove();
      }
      if (bottomSpacer) {
        bottomSpacer.remove();
      }
    }

    let head = this.el.querySelector(".file:not(.upload)");
    for (const f of toInsert) {
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

    // Sample row height for subsequent windows.
    if (toInsert.length && toInsert[0].el) {
      const h = toInsert[0].el.offsetHeight;
      if (h > 20) {
        this._rowHeightHint = h;
      }
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
    if (this.sortMode === "largest") {
      sort(visible, (e) => e.size || 0).reverse();
    } else if (this.sortMode === "expiring") {
      sort(visible, (e) => Number(e.expires) || Infinity);
    } else {
      sort(visible, (e) => e.uploaded).reverse(); // newest (default)
    }
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

  // ----- Sort Modes -----
  initSortMode() {
    try {
      const saved = this.sortModeKey && localStorage.getItem(this.sortModeKey);
      this.sortMode = normalizeSortMode(saved, this.sortMode);
    } catch (_) {
      /* no-op */
    }
    this.updateSortButtons();
  }

  setSortMode(mode) {
    if (!SORT_MODES.includes(mode)) {
      return;
    }
    this.sortMode = mode;
    try {
      if (this.sortModeKey) {
        localStorage.setItem(this.sortModeKey, mode);
      }
    } catch (_) {
      /* no-op */
    }
    this.updateSortButtons();
    this.sortFiles();
  }

  updateSortButtons() {
    if (this.sortNewestEl) {
      const on = this.sortMode === "newest";
      this.sortNewestEl.classList.toggle("active", on);
      this.sortNewestEl.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.sortLargestEl) {
      const on = this.sortMode === "largest";
      this.sortLargestEl.classList.toggle("active", on);
      this.sortLargestEl.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (this.sortExpiringEl) {
      const on = this.sortMode === "expiring";
      this.sortExpiringEl.classList.toggle("active", on);
      this.sortExpiringEl.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  // ----- Show-New toggle -----
  toggleNewOnly() {
    this.showingNewOnly = !this.showingNewOnly;
    if (this.showNewBtnEl) {
      this.showNewBtnEl.classList.toggle("active", this.showingNewOnly);
      this.showNewBtnEl.setAttribute(
        "aria-pressed",
        this.showingNewOnly ? "true" : "false",
      );
    }
    this.persistFilterState();
    if (!this.applying) {
      this.applying = this.applyFilter().then(() => (this.applying = null));
    }
  }

  // ----- Filter Presets -----
  loadPresets() {
    if (!this.presetsKey) {
      return [];
    }
    try {
      return JSON.parse(localStorage.getItem(this.presetsKey) || "[]");
    } catch (_) {
      return [];
    }
  }

  _savePresets(presets) {
    if (!this.presetsKey) {
      return;
    }
    try {
      localStorage.setItem(this.presetsKey, JSON.stringify(presets));
    } catch (_) {
      /* no-op */
    }
  }

  onPresetSave() {
    const name = window.prompt("Save current filter as preset:", "");
    if (!name || !name.trim()) {
      return;
    }
    const trimmed = name.trim();
    const buttonState = {};
    if (this.filterButtons) {
      this.filterButtons.forEach((b) => {
        buttonState[b.id.replace(/^filter-/, "")] =
          !b.classList.contains("disabled");
      });
    }
    const presets = this.loadPresets().filter((p) => p.name !== trimmed);
    presets.push({
      name: trimmed,
      query: this.filter ? this.filter.value : "",
      buttons: buttonState,
    });
    this._savePresets(presets);
    this.renderPresets();
  }

  applyPreset(preset) {
    if (this.filter) {
      this.filter.value = preset.query || "";
    }
    if (this.filterButtons && preset.buttons) {
      this.filterButtons.forEach((b) => {
        const key = b.id.replace(/^filter-/, "");
        b.classList.toggle("disabled", !preset.buttons[key]);
      });
    }
    this.doFilter();
  }

  deletePreset(name) {
    const presets = this.loadPresets().filter((p) => p.name !== name);
    this._savePresets(presets);
    this.renderPresets();
  }

  renderPresets() {
    if (!this.presetsListEl) {
      return;
    }
    const presets = this.loadPresets();
    this.presetsListEl.innerHTML = "";
    for (const preset of presets) {
      const pill = document.createElement("button");
      pill.className = "preset-pill";
      pill.title = preset.query || "";
      pill.textContent = preset.name;
      pill.addEventListener("click", () => this.applyPreset(preset));
      const del = document.createElement("button");
      del.className = "preset-pill-del i-clear";
      del.title = `Delete "${preset.name}"`;
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deletePreset(preset.name);
      });
      pill.appendChild(del);
      this.presetsListEl.appendChild(pill);
    }
    if (this.presetsEl) {
      this.presetsEl.classList.toggle("hidden", presets.length === 0);
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
    // Linked mirrors are owned by the source room — never trash from destination.
    const keys = files
      .filter((e) => e && e.key && !e.isLinked)
      .map((e) => e.key);
    if (!keys.length) {
      registry.messages.addSystemMessage(
        "Linked files cannot be removed here — manage them in the source room.",
      );
      return;
    }
    registry.socket.emit("trash", keys);
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
      if (registry.links) {
        registry.links.hide();
      }
      if (this.linkModeEl) {
        this.linkModeEl.classList.remove("active");
      }
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
      if (registry.links) {
        registry.links.hide();
      }
      if (this.linkModeEl) {
        this.linkModeEl.classList.remove("active");
      }
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
    if (registry.links) {
      registry.links.show();
    }
    if (this.linkModeEl) {
      this.linkModeEl.classList.add("active");
    }
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
