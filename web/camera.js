"use strict";
// Local camera preview with deliberate still capture. Nothing here sends frames
// anywhere; a captured frame is a JPEG data URL the app treats like an upload.
// See docs/LIVE_CAMERA_CONTRACT.md.
(function (global) {
  const MAX_DIMENSION = 1440;
  const JPEG_QUALITY = 0.86;
  const MAX_DECODED_BYTES = 2 * 1024 * 1024; // Same limit as the local server.
  const FRAME_TIMEOUT_MS = 8000;
  const JPEG_PREFIX = "data:image/jpeg;base64,";
  const HAVE_CURRENT_DATA = 2;
  const noop = () => {};

  const START_MESSAGES = {
    NotAllowedError:
      "Camera access was denied or blocked. Allow the camera for this page in your browser's site settings, or upload photos instead.",
    SecurityError:
      "Camera access is blocked on this page. Upload photos instead.",
    NotFoundError:
      "No camera was found. Connect a webcam or upload photos instead.",
    NotReadableError:
      "The camera could not be opened. It may be in use by another app; close it and try again.",
    AbortError:
      "The camera could not be opened. It may be in use by another app; close it and try again.",
    OverconstrainedError:
      "The selected camera is not available any more. Choose another camera.",
  };

  const START_FAILURES = {
    "play-failed":
      "The camera preview could not play. Choose Start camera again.",
    "not-playing":
      "The camera preview did not start within 8 seconds. Check that no other app is using the camera, then choose Start camera again.",
    "no-picture":
      "The camera started but sent no picture. Check that it is uncovered and not used by another app.",
  };

  function startMessage(error) {
    return (
      START_MESSAGES[error && error.name] ||
      "The camera could not be started. You can still upload photos."
    );
  }

  function safeText(value, fallback) {
    if (typeof value !== "string" || !value.trim()) return fallback;
    return value.trim().slice(0, 300);
  }

  function stopTracks(stream) {
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      // A broken stream object must not prevent the remaining cleanup.
    }
  }

  function hasFrame(video) {
    return (
      video.readyState >= HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    );
  }

  function decodedLength(dataUrl) {
    const encoded = dataUrl.length - JPEG_PREFIX.length;
    const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
    return Math.floor((encoded * 3) / 4) - padding;
  }

  class ReverseStepsCamera {
    constructor({ video, onState, onError } = {}) {
      if (!video || typeof video.play !== "function")
        throw new TypeError("ReverseStepsCamera needs a video element.");
      this.video = video;
      this.onState = typeof onState === "function" ? onState : noop;
      this.onError = typeof onError === "function" ? onError : noop;
      this.state = "off";
      this.deviceId = null;
      this.stream = null;
      this.track = null;
      this.generation = 0;
      this.disposed = false;
      this._onTrackEnded = null;
      this._cancelStartup = null;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute?.("playsinline", "");
      // Only an active or pending camera is stopped, so an earlier error message
      // (for example a denied permission) is not replaced by a pause message.
      const active = () => this.state === "starting" || this.state === "live";
      this._onVisibility = () => {
        if (global.document.visibilityState === "hidden" && active())
          this.stop(
            "Camera paused while the page was hidden. Choose Start camera to resume.",
          );
      };
      this._onPageHide = () => {
        if (active()) this.stop("Camera stopped when the page was left.");
      };
      global.document.addEventListener("visibilitychange", this._onVisibility);
      global.addEventListener("pagehide", this._onPageHide);
    }

    get live() {
      return this.state === "live";
    }

    async start(deviceId) {
      if (this.disposed) return false;
      const media = global.navigator?.mediaDevices;
      const generation = ++this.generation;
      this._release();
      if (!media || typeof media.getUserMedia !== "function") {
        this._fail(
          "Camera is not available here. Open this same app address in Chrome or Edge, or upload photos instead.",
        );
        return false;
      }
      const requested =
        typeof deviceId === "string" && deviceId && deviceId.length <= 512
          ? deviceId
          : null;
      const video = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      if (requested) video.deviceId = { exact: requested };
      else video.facingMode = { ideal: "environment" };
      this._publish("starting", "Waiting for camera permission…", requested);

      let stream;
      try {
        stream = await media.getUserMedia({ audio: false, video });
      } catch (error) {
        if (generation === this.generation) this._fail(startMessage(error));
        return false;
      }
      if (generation !== this.generation) {
        // Stopped, hidden or superseded while the permission prompt was open.
        stopTracks(stream);
        return false;
      }
      const track = stream?.getVideoTracks?.()[0];
      if (!track || track.readyState === "ended") {
        stopTracks(stream);
        this._fail(
          "The camera did not provide a video picture. Try another camera.",
        );
        return false;
      }
      this.stream = stream;
      this.track = track;
      this._onTrackEnded = () => {
        if (this.track !== track) return;
        this.generation++;
        this._fail(
          "The camera stopped or was disconnected. Choose Start camera to try again.",
        );
      };
      track.addEventListener("ended", this._onTrackEnded);
      this.video.srcObject = stream;

      // One deadline covers both play() and the first frame. The permission
      // prompt above is not timed: the user may take as long as they need.
      const outcome = await this._awaitPlayback(generation);
      if (generation !== this.generation || outcome === "cancelled")
        return false;
      if (outcome !== "ready") {
        this._fail(START_FAILURES[outcome]);
        return false;
      }
      let settings = {};
      try {
        settings = track.getSettings?.() || {};
      } catch {
        settings = {};
      }
      this._publish(
        "live",
        "Camera is live on this computer. Frames stay here until you capture one.",
        typeof settings.deviceId === "string" && settings.deviceId
          ? settings.deviceId
          : requested,
      );
      return true;
    }

    stop(message) {
      this.generation++;
      this._release();
      if (this.state !== "off")
        this._publish("off", safeText(message, "Camera is off."), null);
    }

    capture() {
      const video = this.video;
      const fail = (message) => {
        this._report(message);
        return null;
      };
      if (
        this.state !== "live" ||
        !this.track ||
        this.video.srcObject !== this.stream
      )
        return fail(
          "Start the camera and wait until it is live before capturing.",
        );
      if (this.track.readyState !== "live")
        return fail("The camera stopped. Choose Start camera to try again.");
      if (this.track.muted || !hasFrame(video))
        return fail(
          "The camera has no picture yet. Wait a moment and capture again.",
        );
      const scale = Math.min(
        1,
        MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight),
      );
      const canvas = global.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        const context = canvas.getContext("2d");
        if (!context)
          return fail("This browser could not capture the camera frame.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        // drawImage uses the camera's own orientation; CSS mirroring of the preview is not applied.
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        if (
          typeof data !== "string" ||
          !data.startsWith(JPEG_PREFIX) ||
          data.length === JPEG_PREFIX.length
        )
          return fail(
            "This browser could not produce a JPEG from the camera frame.",
          );
        if (decodedLength(data) > MAX_DECODED_BYTES)
          return fail(
            "This frame is too detailed to store. Move closer to a plainer background and capture again.",
          );
        return data;
      } catch {
        return fail("The camera frame could not be captured. Try again.");
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    async listCameras() {
      const media = global.navigator?.mediaDevices;
      if (!media || typeof media.enumerateDevices !== "function") {
        this._report("Camera selection is not available in this browser.");
        return [];
      }
      let devices;
      try {
        devices = await media.enumerateDevices();
      } catch {
        this._report(
          "The camera list could not be read. The default camera can still be used.",
        );
        return [];
      }
      const cameras = [];
      const seen = new Set();
      for (const device of Array.isArray(devices) ? devices : []) {
        if (!device || device.kind !== "videoinput") continue;
        const deviceId =
          typeof device.deviceId === "string" ? device.deviceId : "";
        if (seen.has(deviceId)) continue;
        seen.add(deviceId);
        // Labels stay blank until camera permission has been granted.
        cameras.push({
          deviceId,
          label: safeText(device.label, `Camera ${cameras.length + 1}`).slice(
            0,
            120,
          ),
        });
      }
      return cameras;
    }

    dispose() {
      if (this.disposed) return;
      this.stop();
      this.disposed = true;
      global.document.removeEventListener(
        "visibilitychange",
        this._onVisibility,
      );
      global.removeEventListener("pagehide", this._onPageHide);
      this.onState = noop;
      this.onError = noop;
    }

    // Resolves "ready" once play() has resolved and a frame is present, or
    // "play-failed", "no-picture", "not-playing" or "cancelled". Settles once;
    // later events, timers and play() outcomes are ignored.
    _awaitPlayback(generation) {
      const video = this.video;
      return new Promise((resolve) => {
        const events = ["loadeddata", "resize", "playing"];
        let played = false;
        let settled = false;
        let timer = null;
        const finish = (outcome) => {
          if (settled) return;
          settled = true;
          global.clearTimeout(timer);
          events.forEach((name) => video.removeEventListener(name, check));
          // Clear only this waiter; a newer start may already own the slot.
          if (this._cancelStartup === cancel) this._cancelStartup = null;
          resolve(outcome);
        };
        const check = () => {
          if (generation !== this.generation) finish("cancelled");
          else if (played && hasFrame(video)) finish("ready");
        };
        const cancel = () => finish("cancelled");
        this._cancelStartup = cancel;
        events.forEach((name) => video.addEventListener(name, check));
        timer = global.setTimeout(() => {
          if (generation !== this.generation) finish("cancelled");
          else if (played && hasFrame(video)) finish("ready");
          else finish(played ? "no-picture" : "not-playing");
        }, FRAME_TIMEOUT_MS);
        let playing;
        try {
          playing = Promise.resolve(video.play());
        } catch (error) {
          playing = Promise.reject(error);
        }
        // Both branches are handled, so a late rejection after stop is never unhandled.
        playing.then(
          () => {
            played = true;
            check();
          },
          () =>
            finish(
              generation === this.generation ? "play-failed" : "cancelled",
            ),
        );
      });
    }

    _release() {
      const cancel = this._cancelStartup;
      this._cancelStartup = null;
      cancel?.();
      if (this.track && this._onTrackEnded)
        this.track.removeEventListener("ended", this._onTrackEnded);
      this._onTrackEnded = null;
      const stream = this.stream;
      this.stream = null;
      this.track = null;
      stopTracks(stream);
      if (this.video.srcObject) {
        try {
          this.video.pause?.();
        } catch {
          // Pausing is best effort; detaching the stream is what releases the preview.
        }
        this.video.srcObject = null;
      }
    }

    _fail(message) {
      this._release();
      this._publish("error", message, null);
      this._report(message);
    }

    _publish(state, message, deviceId) {
      this.state = state;
      this.deviceId = deviceId || null;
      try {
        this.onState({ state, message, deviceId: this.deviceId });
      } catch {
        // A UI callback failure must not interrupt camera cleanup.
      }
    }

    _report(message) {
      try {
        this.onError(message);
      } catch {
        // See _publish.
      }
    }
  }

  global.ReverseStepsCamera = ReverseStepsCamera;
})(window);
