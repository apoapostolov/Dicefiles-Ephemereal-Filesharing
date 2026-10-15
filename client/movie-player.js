"use strict";

import shaka from "shaka-player";
import Modal from "./modal";
import { dom } from "./util";
import { movieCall, moviePath, movieReference, showMovieInfo } from "./movie";
import { WATCH_PREFIX, mediaTitle, saveWatch, timeLabel, watchKey, watchRecords, fittedPlayerWidth } from "../common/video";

export class MoviePlayer extends Modal {
  constructor(file, reference = movieReference(file), data) {
    super("watch", "Video player", { text: "Close", cancel: true });
    this.file = file; this.reference = reference; this.data = data; this.closed = false; this.player = null; this.interval = null;
    this.key = watchKey(reference, reference.index); this.tracks = [];
    this.video = dom("video", { classes: ["movie-video"], attrs: { "playsinline": "", "preload": "metadata", "aria-label": file.name } });
    this.video.controls = false;
    this.title = dom("h2", { classes: ["movie-player-title"], text: file.name });
    this.feedback = dom("p", { classes: ["movie-feedback"], attrs: { "role": "status", "aria-live": "polite" }, text: reference.index >= 0 ? "Connecting to video peers…" : "Loading video…" });
    this.stage = dom("div", { classes: ["movie-stage"] }); this.stage.appendChild(this.video);
    this.body.append(this.title, this.stage, this.feedback);
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
        this.feedback.textContent = "Picture in picture is unavailable for this video. Try fullscreen.";
      }), viewActions);
    }
    action("Fullscreen", "⛶", () => {
      const target = this.el;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      else if (target.requestFullscreen) {
        target.requestFullscreen().catch(() => {
          this.feedback.textContent = "Fullscreen is unavailable. Expand the browser panel to watch at a larger size.";
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
    this.fitObserver?.observe(this.controls); this.fitObserver?.observe(this.feedback);
    this.onVisibility = () => {
      if (document.hidden) {
        this.flush();
      }
    };
    this.video.addEventListener("timeupdate", () => this.update());
    this.video.addEventListener("loadedmetadata", this.onResize);
    this.video.addEventListener("resize", this.onResize);
    this.video.addEventListener("play", () => this.update());
    this.video.addEventListener("pause", () => {
      this.update(); this.flush();
    });
    this.video.addEventListener("ended", () => {
      this.flush(); this.feedback.textContent = "Finished watching.";
    });
    this.video.addEventListener("waiting", () => {
      this.feedback.textContent = "Buffering…";
    });
    this.video.addEventListener("playing", () => {
      this.feedback.textContent = "";
    });
    this.video.addEventListener("error", () => this.playbackError());
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

  async onshown() {
    super.onshown();
    addEventListener("pagehide", this.onPageHide); document.addEventListener("visibilitychange", this.onVisibility);
    addEventListener("resize", this.onResize); document.addEventListener("fullscreenchange", this.onResize);
    try {
      this.data ||= await movieCall(this.reference, "get");
      if (this.closed) {
        return;
      }
      this.title.textContent = mediaTitle(this.data.movie, this.data.name || this.file.name);
      this.video.setAttribute("aria-label", this.title.textContent);
      if (this.data.movie?.backdrop) {
        this.video.poster = this.data.movie.backdrop;
      }
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        this.video.controls = true; this.controls.hidden = true;
      }
      this.player = new shaka.Player();
      this.player.configure({ mediaSource: { useSourceElements: false } });
      // Progressive videos do not need an empty MediaSource. Deferring that
      // initialization also avoids sourceopen stalls in embedded browsers.
      await this.player.attach(this.video, false);
      if (this.closed) {
        return;
      }
      this.player.configure({ streaming: { bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 20 }, manifest: { retryParameters: { maxAttempts: 2 } } });
      this.player.addEventListener("error", event => this.playbackError(event.detail));
      const saved = watchRecords(localStorage).find(record => record.key === this.key);
      const start = saved && !saved.completed ? saved.position : 0;
      const source = this.reference.index >= 0 ? `${moviePath(this.reference)}/stream` : this.file.url;
      const name = this.data.name || this.file.name;
      const mime = /\.webm$/i.test(name) ? "video/webm" : /\.m3u8$/i.test(name) ? "application/x-mpegurl" : /\.mpd$/i.test(name) ? "application/dash+xml" : /\.mkv$/i.test(name) ? "video/x-matroska" : /\.avi$/i.test(name) ? "video/x-msvideo" : /\.(ts|m2ts)$/i.test(name) ? "video/mp2t" : "video/mp4";
      await this.player.load(source, start, mime);
      if (this.closed) {
        return;
      }
      for (const subtitle of this.data.subtitles || []) {
        try {
          const track = await this.player.addTextTrackAsync(`${moviePath(this.reference)}/subtitle/${subtitle.id}`, subtitle.language, "subtitles", "text/vtt", undefined, subtitle.label);
          if (this.closed) {
            return;
          }
          this.tracks.push(track); this.captions.appendChild(dom("option", { text: subtitle.label, attrs: { value: track.id } }));
        }
        catch (_) {
          this.feedback.textContent = "A subtitle could not be loaded. Reopen video details and upload it again.";
        }
      }
      this.interval = setInterval(() => {
        if (!this.video.paused) {
          this.flush();
        }
      }, 5000);
      this.feedback.textContent = start ? `Resumed at ${timeLabel(start)}.` : "Ready to watch.";
      this.playButton.focus(); this.update();
      this.fit();
      await this.video.play().catch(() => {
        this.feedback.textContent = "Ready. Press Play to start.";
      });
    }
    catch (error) {
      if (!this.closed) {
        this.playbackError(error);
      }
    }
  }

  playbackError(error) {
    if (this.closed) {
      return;
    }
    if (Number.isFinite(error?.code)) {
      // Codes only: provider URLs, room IDs and response bodies stay private.
      console.warn(`Video playback unavailable (code ${error.code}, category ${error.category || 0})`);
    }
    this.feedback.textContent = this.reference.index >= 0 ? "This video could not play. Peers may be unavailable, the stream may exceed server limits, or its codec may be unsupported. Retry later, or download it and use a compatible player." : "This video could not play. Its format or codec may be unsupported by your browser. Download it and use a compatible player, or upload an H.264 MP4 or WebM version.";
  }

  toggle() {
    if (this.video.paused) {
      this.video.play().catch(() => this.playbackError());
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
    if (this.closed || !this.video.videoWidth || !this.video.videoHeight || this.fitFrame !== null) {
      return;
    }
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = null;
      if (this.closed) {
        return;
      }
      this.el.style.setProperty("--movie-aspect", `${this.video.videoWidth} / ${this.video.videoHeight}`);
      if (document.fullscreenElement === this.el) {
        this.el.style.width = ""; return;
      }
      const padding = getComputedStyle(this.body);
      const inset = parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight) + 2;
      const interfaceHeight = this.head.offsetHeight + this.buttonsEl.offsetHeight + Math.max(0, this.body.scrollHeight - this.stage.offsetHeight) + 2;
      const width = fittedPlayerWidth(this.video.videoWidth, this.video.videoHeight, innerWidth, innerHeight, interfaceHeight, inset);
      if (width !== null && Math.abs(this.el.getBoundingClientRect().width - width) > 1) {
        this.el.style.width = `${width}px`;
      }
    });
  }

  flush() {
    if (saveWatch(localStorage, this.key, this.video.currentTime, this.video.duration)) {
      dispatchEvent(new CustomEvent("dicefiles:watch-progress", { detail: { key: this.key } }));
    }
  }

  onhidden() {
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
