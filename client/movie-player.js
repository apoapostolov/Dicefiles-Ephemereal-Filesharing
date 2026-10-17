"use strict";

import shaka from "shaka-player";
import Modal from "./modal";
import { dom } from "./util";
import { movieCall, moviePath, movieReference, showMovieInfo } from "./movie";
import { WATCH_PREFIX, mediaTitle, saveWatch, timeLabel, watchKey, watchRecords, fittedPlayerWidth, bufferingStatus } from "../common/video";

export class MoviePlayer extends Modal {
  constructor(file, reference = movieReference(file), data) {
    super("watch", "Video player", { text: "Close", cancel: true });
    this.file = file; this.reference = reference; this.data = data; this.closed = false; this.player = null; this.interval = null;
    this.playbackAttempted = false; this.loadFailed = false; this.loading = null;
    this.prepareAbort = null; this.forceCompatible = false;
    this.progressInterval = null; this.progressAbort = null; this.buffering = false;
    this.closeButton = this.buttons[0];
    this.closeButton.textContent = "×";
    this.closeButton.classList.add("movie-player-close");
    this.closeButton.setAttribute("aria-label", "Close video player");
    this.closeButton.setAttribute("title", "Close video player");
    this.head.appendChild(this.closeButton); this.buttonsEl.remove();
    this.key = watchKey(reference, reference.index); this.tracks = [];
    this.video = dom("video", { classes: ["movie-video"], attrs: { "playsinline": "", "preload": "auto", "aria-label": file.name } });
    this.video.controls = false;
    this.title = dom("h2", { classes: ["movie-player-title"], text: file.name });
    this.head.replaceChildren(this.title, this.closeButton);
    this.feedback = dom("p", { classes: ["movie-feedback"], attrs: { "role": "status", "aria-live": "polite" }, text: reference.index >= 0 ? "Connecting to video peers…" : "Loading video…" });
    this.stage = dom("div", { classes: ["movie-stage"] }); this.stage.appendChild(this.video);
    this.body.append(this.stage, this.feedback);
    this.controls = dom("div", { classes: ["movie-controls"], attrs: { "aria-label": "Playback controls" } });
    const timeline = dom("div", { classes: ["movie-control-group", "movie-timeline"] });
    const transport = dom("div", { classes: ["movie-control-group", "movie-transport"] });
    const preferences = dom("div", { classes: ["movie-control-group", "movie-preferences"] });
    const viewActions = dom("div", { classes: ["movie-control-group", "movie-view-actions"] });
    this.controls.append(transport, timeline, preferences, viewActions);
    const action = (label, text, handler, group = transport) => {
      const button = dom("button", { text, classes: ["movie-action"], attrs: { "type": "button", "aria-label": label, "title": label } }); button.onclick = handler; group.appendChild(button); return button;
    };
    this.playButton = action("Play", "▶", () => this.toggle());
    action("Back 10 seconds", "↶ 10", () => {
      this.video.currentTime = Math.max(0, this.video.currentTime - 10);
    });
    action("Forward 10 seconds", "10 ↷", () => {
      this.video.currentTime = Math.min(this.video.duration || 0, this.video.currentTime + 10);
    });
    this.time = dom("output", { classes: ["movie-time"], text: "0:00 / 0:00" }); timeline.appendChild(this.time);
    this.seek = dom("input", { classes: ["movie-seek"], attrs: { "type": "range", "min": 0, "max": 1000, "value": 0, "step": 1, "aria-label": "Playback position" } });
    this.seek.oninput = () => {
      if (Number.isFinite(this.video.duration)) {
        this.video.currentTime = Number(this.seek.value) / 1000 * this.video.duration;
      }
    };
    timeline.appendChild(this.seek);
    this.mute = action("Mute", "♪", () => {
      this.video.muted = !this.video.muted; this.mute.setAttribute("aria-pressed", String(this.video.muted));
    });
    const volume = dom("input", { classes: ["movie-volume"], attrs: { "type": "range", "min": 0, "max": 1, "step": 0.05, "value": 1, "aria-label": "Volume" } });
    volume.oninput = () => {
      this.video.volume = Number(volume.value); this.video.muted = false;
    }; transport.appendChild(volume);
    this.captions = dom("select", { attrs: { "aria-label": "Subtitles" } });
    this.captions.appendChild(dom("option", { text: "Subtitles off", attrs: { value: "" } }));
    this.captions.onchange = () => {
      const track = this.tracks.find(track => String(track.id) === this.captions.value);
      this.player.selectTextTrack(track || null);
    };
    preferences.appendChild(this.captions);
    const speed = dom("select", { attrs: { "aria-label": "Playback speed" } });
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      speed.appendChild(dom("option", { text: `${rate}×`, attrs: { value: rate } }));
    }
    speed.value = "1"; speed.onchange = () => {
      this.video.playbackRate = Number(speed.value);
    }; preferences.appendChild(speed);
    if (document.pictureInPictureEnabled) {
      action("Picture in picture", "▣", () => this.video.requestPictureInPicture().catch(() => {
        this.setFeedback("Picture in picture is unavailable for this video. Try fullscreen.");
      }), viewActions);
    }
    action("Fullscreen", "⛶", () => {
      const target = this.el;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      else if (target.requestFullscreen) {
        target.requestFullscreen().catch(() => {
          this.setFeedback("Fullscreen is unavailable. Expand the browser panel to watch at a larger size.");
        });
      }
      else if (this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      }
    }, viewActions);
    action("Video information and subtitles", "ⓘ", () => {
      this.video.pause(); showMovieInfo(this.file, this.reference);
    }, viewActions);
    this.body.appendChild(this.controls);
    this.onPageHide = () => this.flush();
    this.fitFrame = null;
    this.onResize = () => this.fit();
    this.fitObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.onResize);
    this.fitObserver?.observe(this.controls); this.fitObserver?.observe(this.feedback); this.fitObserver?.observe(this.title); this.fitObserver?.observe(this.head);
    this.onVisibility = () => {
      if (document.hidden) {
        this.flush();
      }
    };
    this.video.addEventListener("timeupdate", () => this.update());
    this.video.addEventListener("loadedmetadata", this.onResize);
    this.video.addEventListener("resize", this.onResize);
    this.video.addEventListener("play", () => {
      this.playbackAttempted = true; this.update();
    });
    this.video.addEventListener("pause", () => {
      this.update(); this.flush();
    });
    this.video.addEventListener("ended", () => {
      this.flush(); this.setFeedback("Finished watching.");
    });
    this.video.addEventListener("waiting", () => {
      if (!this.loadFailed) {
        this.startBuffering();
      }
    });
    this.video.addEventListener("playing", () => {
      this.setFeedback("");
    });
    this.video.addEventListener("canplay", () => {
      if (!this.loadFailed) {
        this.setFeedback("");
      }
    });
    this.video.addEventListener("error", () => {
      if (this.video.error) {
        this.playbackError(this.video.error);
      }
    });
    this.stage.addEventListener("click", event => {
      if (event.target === this.video) {
        this.toggle();
      }
    });
    this.el.addEventListener("keydown", event => {
      if (["INPUT", "SELECT", "BUTTON"].includes(event.target.tagName)) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault(); this.toggle();
      }
      else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault(); this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, this.video.currentTime + (event.key === "ArrowLeft" ? -10 : 10)));
      }
    });
  }

  setFeedback(message, buffering = false) {
    this.buffering = buffering;
    this.feedback.textContent = message;
    this.feedback.hidden = !message;
    this.feedback.setAttribute("data-buffering", String(buffering));
    if (!buffering) {
      clearInterval(this.progressInterval); this.progressInterval = null;
      this.progressAbort?.abort(); this.progressAbort = null;
    }
    this.fit();
  }

  startBuffering() {
    if (this.closed || this.loadFailed) {
      return;
    }
    this.setFeedback(bufferingStatus({ phase: this.reference.index >= 0 ? "connecting" : "buffering" }), true);
    if (!this.progressInterval) {
      this.progressInterval = setInterval(() => this.refreshProgress(), 2000);
    }
  }

  async refreshProgress() {
    if (this.closed || !this.buffering || this.progressAbort || document.hidden) {
      return;
    }
    const controller = new AbortController(); this.progressAbort = controller;
    try {
      let buffered = 0;
      for (let i = 0; i < (this.video.buffered?.length || 0); i++) {
        if (this.video.buffered.start(i) <= this.video.currentTime && this.video.buffered.end(i) >= this.video.currentTime) {
          buffered = this.video.buffered.end(i) - this.video.currentTime; break;
        }
      }
      let progress = {};
      if (this.reference.index >= 0) {
        const response = await fetch(`${moviePath(this.reference)}/progress`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1800)]) });
        if (!response.ok) {
          return;
        }
        progress = await response.json();
      }
      else {
        const stats = this.player?.getStats?.();
        const bytesPerSecond = (stats?.estimatedBandwidth || 0) / 8;
        const missing = Math.max(0, 2 - buffered) * (stats?.streamBandwidth || 0) / 8;
        progress = { bytesPerSecond, etaSeconds: bytesPerSecond > 0 && missing > 0 ? missing / bytesPerSecond : null };
      }
      if (!this.closed && this.buffering && !controller.signal.aborted) {
        this.setFeedback(bufferingStatus(progress, buffered), true);
      }
    }
    catch (_) { /* A missed progress sample must never interrupt playback. */ }
    finally {
      if (this.progressAbort === controller) {
        this.progressAbort = null;
      }
    }
  }

  async onshown() {
    super.onshown();
    addEventListener("pagehide", this.onPageHide); document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("resize", this.onResize); document.addEventListener("fullscreenchange", this.onResize);
    this.fit();
    this.loading = this.prepare();
    await this.loading;
  }

  async prepare() {
    this.prepareAbort?.abort(); this.prepareAbort = new AbortController();
    this.loadFailed = false; this.playButton.disabled = true;
    this.startBuffering();
    try {
      this.data ||= await movieCall(this.reference, "get");
      if (this.closed) {
        return;
      }
      this.title.textContent = mediaTitle(this.data.movie, this.data.name || this.file.name);
      this.title.setAttribute("title", this.title.textContent);
      this.video.setAttribute("aria-label", this.title.textContent);
      if (this.data.movie?.backdrop) {
        this.video.poster = this.data.movie.backdrop;
      }
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        this.video.controls = true; this.controls.hidden = true;
      }
      if (!this.player) {
        this.player = new shaka.Player();
        this.player.configure({ mediaSource: { useSourceElements: false } });
        // Progressive videos do not need an empty MediaSource. Deferring that
        // initialization also avoids sourceopen stalls in embedded browsers.
        await this.player.attach(this.video, false);
        this.player.addEventListener("error", event => {
          // Recoverable network retries are handled by Shaka while buffering.
          if (event.detail?.severity === shaka.util.Error.Severity.CRITICAL) {
            this.playbackError(event.detail);
          }
        });
        this.player.addEventListener("buffering", event => {
          if (event.buffering) {
            this.startBuffering();
          }
          else if (!this.loadFailed) {
            this.setFeedback("");
          }
        });
      }
      if (this.closed) {
        return;
      }
      const retryParameters = { maxAttempts: 2, timeout: 150000, stallTimeout: 120000, connectionTimeout: 60000 };
      this.player.configure({ streaming: { bufferingGoal: 18, rebufferingGoal: 2, bufferBehind: 20, loadTimeout: this.reference.index >= 0 ? 150 : 30, retryParameters }, manifest: { retryParameters } });
      const saved = watchRecords(localStorage).find(record => record.key === this.key);
      const start = saved && !saved.completed ? saved.position : 0;
      const name = this.data.name || this.file.name;
      const compatible = this.reference.index >= 0 && (this.forceCompatible || /\.(mkv|avi|mov|ts|m2ts)$/i.test(name));
      this.usingCompatible = compatible;
      const source = this.reference.index >= 0 ? `${moviePath(this.reference)}/${compatible ? "hls.m3u8" : "stream"}` : this.file.url;
      const mime = compatible || /\.m3u8$/i.test(name) ? "application/x-mpegurl" : /\.webm$/i.test(name) ? "video/webm" : /\.mpd$/i.test(name) ? "application/dash+xml" : /\.mkv$/i.test(name) ? "video/x-matroska" : /\.avi$/i.test(name) ? "video/x-msvideo" : /\.(ts|m2ts)$/i.test(name) ? "video/mp2t" : "video/mp4";
      if (compatible) {
        this.setFeedback("Preparing video for your browser…", true);
        const response = await fetch(source, { signal: this.prepareAbort.signal, cache: "no-store" });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw Object.assign(new Error("Video preparation failed"), { userMessage: typeof detail.error === "string" ? detail.error.slice(0, 500) : "The video could not be prepared. Wait a moment and retry." });
        }
        // Consume the small playlist; Shaka requests it again and reuses the
        // owner's cached duration. Preparation errors stay readable to users.
        await response.text();
      }
      await this.player.load(source, start, mime);
      if (this.closed) {
        return;
      }
      this.tracks = [];
      this.captions.replaceChildren(dom("option", { text: "Subtitles off", attrs: { value: "" } }));
      for (const subtitle of this.data.subtitles || []) {
        try {
          const track = await this.player.addTextTrackAsync(`${moviePath(this.reference)}/subtitle/${subtitle.id}`, subtitle.language, "subtitles", "text/vtt", undefined, subtitle.label);
          if (this.closed) {
            return;
          }
          this.tracks.push(track); this.captions.appendChild(dom("option", { text: subtitle.label, attrs: { value: track.id } }));
        }
        catch (_) {
          this.setFeedback("A subtitle could not be loaded. Reopen video details and upload it again.");
        }
      }
      clearInterval(this.interval);
      this.interval = setInterval(() => {
        if (!this.video.paused) {
          this.flush();
        }
      }, 5000);
      this.loadFailed = false;
      if (this.buffering) {
        this.setFeedback("");
      }
      this.playButton.focus(); this.update();
      this.fit();
    }
    catch (error) {
      if (!this.closed && this.reference.index >= 0 && this.usingCompatible === false && !this.forceCompatible) {
        this.forceCompatible = true;
        return await this.prepare();
      }
      if (!this.closed) {
        this.playbackError(error);
      }
    }
    finally {
      this.playButton.disabled = false; this.fit();
    }
  }

  playbackError(error) {
    if (this.closed) {
      return;
    }
    this.loadFailed = true;
    if (Number.isFinite(error?.code)) {
      // Codes only: provider URLs, room IDs and response bodies stay private.
      console.warn(`Video playback unavailable (code ${error.code}, category ${error.category || 0})`);
    }
    this.setFeedback(error?.userMessage || (!this.playbackAttempted ? "Video preparation did not finish. Press Play to retry, or download the video to watch locally." : this.reference.index >= 0 ? "Playback stopped. Peers may be unavailable or the format may be unsupported. Press Play to retry, or download the video to watch locally." : "Playback stopped. Press Play to retry, or download the video and open it in a compatible player."));
  }

  async toggle() {
    if (this.closed || this.playButton.disabled) {
      return;
    }
    if (this.video.paused || this.loadFailed) {
      this.playbackAttempted = true;
      if (this.loadFailed) {
        this.loading = this.prepare(); await this.loading;
      }
      if (this.closed || this.loadFailed) {
        return;
      }
      await this.video.play().catch(error => {
        if (error?.name === "NotAllowedError") {
          this.setFeedback("Your browser paused playback. Press Play again to start.");
        }
        else if (error?.name !== "AbortError") {
          this.playbackError(error);
        }
      });
    }
    else {
      this.video.pause();
    }
  }

  update() {
    const duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.playButton.textContent = this.video.paused ? "▶" : "Ⅱ"; this.playButton.setAttribute("aria-label", this.video.paused ? "Play" : "Pause");
    this.time.textContent = `${timeLabel(this.video.currentTime)} / ${timeLabel(duration)}`;
    this.seek.value = duration ? Math.round(this.video.currentTime / duration * 1000) : 0;
    this.seek.setAttribute("aria-valuetext", this.time.textContent);
  }

  fit() {
    if (this.closed || this.fitFrame !== null) {
      return;
    }
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = null;
      if (this.closed) {
        return;
      }
      const videoWidth = this.video.videoWidth || 16; const videoHeight = this.video.videoHeight || 9;
      this.el.style.setProperty("--movie-aspect", `${videoWidth} / ${videoHeight}`);
      if (document.fullscreenElement === this.el) {
        this.el.style.width = ""; this.el.style.height = ""; return;
      }
      const padding = getComputedStyle(this.body);
      const inset = parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight) + 2;
      const outerHeight = el => {
        if (el.hidden) {
          return 0;
        }
        const style = getComputedStyle(el);
        return el.offsetHeight + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
      };
      const interfaceHeight = this.head.offsetHeight + outerHeight(this.feedback) + this.controls.offsetHeight + parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom) + 2;
      const width = fittedPlayerWidth(videoWidth, videoHeight, innerWidth, innerHeight, interfaceHeight, inset);
      if (width !== null && Math.abs(this.el.getBoundingClientRect().width - width) > 1) {
        this.el.style.width = `${width}px`;
      }
      this.el.style.height = `${Math.min(innerHeight - 24, Math.ceil((width - inset) * videoHeight / videoWidth + interfaceHeight))}px`;
    });
  }

  flush() {
    if (saveWatch(localStorage, this.key, this.video.currentTime, this.video.duration)) {
      dispatchEvent(new CustomEvent("dicefiles:watch-progress", { detail: { key: this.key } }));
    }
  }

  onhidden() {
    this.prepareAbort?.abort();
    clearInterval(this.progressInterval); this.progressAbort?.abort(); this.buffering = false;
    this.flush(); this.closed = true; clearInterval(this.interval);
    if (this.fitFrame !== null) {
      cancelAnimationFrame(this.fitFrame);
    }
    this.fitObserver?.disconnect();
    removeEventListener("pagehide", this.onPageHide); document.removeEventListener("visibilitychange", this.onVisibility);
    removeEventListener("resize", this.onResize); document.removeEventListener("fullscreenchange", this.onResize);
    this.video.pause();
    this.player?.destroy().catch(() => {});
    this.video.removeAttribute("src"); this.video.load();
  }
}

export { WATCH_PREFIX };
