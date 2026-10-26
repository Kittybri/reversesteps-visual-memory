// Camera controller lifecycle checks. Media devices, tracks, video, canvas and
// timers are test doubles; these checks do not establish real camera behavior.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "../web/camera.js"),
  "utf8",
);
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const flush = async () => {
  for (let i = 0; i < 5; i++)
    await new Promise((resolve) => setImmediate(resolve));
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

function domError(
  name,
  message = "raw browser detail C:\\Users\\private\\device",
) {
  const error = new Error(message);
  error.name = name;
  return error;
}

class FakeTrack extends EventTarget {
  constructor(deviceId = "cam-default") {
    super();
    this.deviceId = deviceId;
    this.readyState = "live";
    this.muted = false;
    this.stops = 0;
  }
  stop() {
    this.stops++;
    this.readyState = "ended";
  }
  getSettings() {
    return { deviceId: this.deviceId, width: 1920, height: 1080 };
  }
  endExternally() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

function fakeStream(deviceId) {
  const track = new FakeTrack(deviceId);
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.srcObject = null;
    this.readyState = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.attributes = {};
    this.frameOnPlay = true;
    this.playImpl = null;
    this.pauses = 0;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  pause() {
    this.pauses++;
  }
  showFrame(width = 1920, height = 1080) {
    this.readyState = 4;
    this.videoWidth = width;
    this.videoHeight = height;
  }
  play() {
    if (this.playImpl) return this.playImpl();
    if (this.frameOnPlay) this.showFrame();
    return Promise.resolve();
  }
}

function setup(options = {}) {
  const documentTarget = new EventTarget();
  const windowTarget = new EventTarget();
  const timers = [];
  const canvases = [];
  const requests = [];
  const document = {
    visibilityState: "visible",
    addEventListener: documentTarget.addEventListener.bind(documentTarget),
    removeEventListener:
      documentTarget.removeEventListener.bind(documentTarget),
    dispatchEvent: documentTarget.dispatchEvent.bind(documentTarget),
    createElement(tag) {
      assert.equal(tag, "canvas");
      const calls = [];
      const canvas = {
        width: 0,
        height: 0,
        calls,
        getContext: () =>
          options.noContext
            ? null
            : {
                set fillStyle(value) {
                  calls.push(["fillStyle", value]);
                },
                fillRect: (...args) => calls.push(["fillRect", ...args]),
                drawImage: (...args) => calls.push(["drawImage", ...args]),
              },
        toDataURL(type, quality) {
          calls.push(["toDataURL", type, quality, this.width, this.height]);
          if (options.toDataURL) return options.toDataURL();
          return JPEG;
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  const mediaDevices =
    options.mediaDevices === null
      ? undefined
      : {
          getUserMedia(constraints) {
            const pending = deferred();
            requests.push({ constraints, ...pending });
            return pending.promise;
          },
          async enumerateDevices() {
            if (options.enumerate) return options.enumerate();
            return [];
          },
        };
  const context = vm.createContext({
    document,
    navigator: { mediaDevices },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
  });
  context.window = context;
  vm.runInContext(source, context);
  const states = [];
  const errors = [];
  const video = new FakeVideo();
  const camera = new context.ReverseStepsCamera({
    video,
    onState: (state) => states.push({ ...state }),
    onError: (message) => errors.push(message),
  });
  return {
    camera,
    video,
    states,
    errors,
    requests,
    timers,
    canvases,
    document,
    windowTarget,
    context,
  };
}

async function goLive(env, deviceId) {
  const started = env.camera.start(deviceId);
  await flush();
  const stream = fakeStream(deviceId || "cam-default");
  env.requests.at(-1).resolve(stream);
  assert.equal(await started, true);
  return stream;
}

const names = (states) => states.map((entry) => entry.state);

test("successful lifecycle: explicit start, live state, unmirrored scaled capture and idempotent stop", async () => {
  const env = setup();
  assert.equal(
    env.requests.length,
    0,
    "constructing the controller must not open a camera",
  );
  const stream = await goLive(env);
  assert.deepEqual(JSON.parse(JSON.stringify(env.requests[0].constraints)), {
    audio: false,
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: { ideal: "environment" },
    },
  });
  assert.deepEqual(names(env.states), ["starting", "live"]);
  assert.equal(env.states.at(-1).deviceId, "cam-default");
  assert.equal(env.camera.live, true);
  assert.equal(env.video.srcObject, stream);
  assert.equal(env.video.muted, true);
  assert.equal(env.video.playsInline, true);

  assert.equal(env.camera.capture(), JPEG);
  const calls = env.canvases[0].calls;
  assert.deepEqual(calls[0], ["fillStyle", "#fff"]);
  assert.deepEqual(calls[1], ["fillRect", 0, 0, 1440, 810]);
  assert.deepEqual(calls[2], ["drawImage", env.video, 0, 0, 1440, 810]);
  assert.deepEqual(calls[3], ["toDataURL", "image/jpeg", 0.86, 1440, 810]);
  assert.equal(env.canvases[0].width, 0, "capture canvas is released");

  env.camera.stop();
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
  assert.deepEqual(names(env.states), ["starting", "live", "off"]);
  env.camera.stop();
  assert.deepEqual(
    names(env.states),
    ["starting", "live", "off"],
    "second stop publishes nothing",
  );
  assert.equal(env.camera.capture(), null);
  assert.equal(env.errors.length, 1);
});

test("small frames are not upscaled", async () => {
  const env = setup();
  await goLive(env);
  env.video.showFrame(640, 480);
  env.camera.capture();
  assert.deepEqual(env.canvases[0].calls[1], ["fillRect", 0, 0, 640, 480]);
});

test("unsupported camera reports an error without throwing", async () => {
  const env = setup({ mediaDevices: null });
  assert.equal(await env.camera.start(), false);
  assert.deepEqual(names(env.states), ["error"]);
  assert.match(env.errors[0], /upload photos/);
  assert.equal((await env.camera.listCameras()).length, 0);
  assert.equal(env.errors.length, 2);
});

test("denied and failed starts map to safe messages without raw browser detail", async () => {
  const cases = [
    ["NotAllowedError", /denied or blocked/],
    ["SecurityError", /blocked/],
    ["NotFoundError", /No camera was found/],
    ["NotReadableError", /in use by another app/],
    ["OverconstrainedError", /not available any more/],
    ["WeirdError", /could not be started/],
  ];
  for (const [name, pattern] of cases) {
    const env = setup();
    const started = env.camera.start();
    await flush();
    env.requests[0].reject(domError(name));
    assert.equal(await started, false, name);
    assert.deepEqual(names(env.states), ["starting", "error"], name);
    assert.match(env.errors[0], pattern, name);
    assert.doesNotMatch(
      env.errors[0] + env.states[1].message,
      /private|raw browser/,
      name,
    );
    assert.equal(env.video.srcObject, null, name);
  }
});

test("a stream without a video track or with an ended track is rejected and released", async () => {
  for (const variant of ["no-track", "ended"]) {
    const env = setup();
    const started = env.camera.start();
    await flush();
    const stream = fakeStream();
    if (variant === "ended") stream.track.readyState = "ended";
    const tracks = variant === "no-track" ? [] : [stream.track];
    env.requests[0].resolve({
      getTracks: () => [stream.track],
      getVideoTracks: () => tracks,
    });
    assert.equal(await started, false);
    assert.equal(env.states.at(-1).state, "error");
    assert.equal(stream.track.stops, 1, variant);
  }
});

test("no frame: live is only reported once the video has a picture", async () => {
  const env = setup();
  env.video.frameOnPlay = false;
  const started = env.camera.start();
  await flush();
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  await flush();
  assert.deepEqual(names(env.states), ["starting"]);
  assert.equal(
    env.camera.capture(),
    null,
    "capture is refused before readiness",
  );
  env.timers.forEach((fire) => fire());
  assert.equal(await started, false);
  assert.deepEqual(names(env.states), ["starting", "error"]);
  assert.match(env.errors.at(-1), /sent no picture/);
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
});

test("a frame that arrives after play still makes the camera live", async () => {
  const env = setup();
  env.video.frameOnPlay = false;
  const started = env.camera.start();
  await flush();
  env.requests[0].resolve(fakeStream());
  await flush();
  env.video.showFrame();
  env.video.dispatchEvent(new Event("loadeddata"));
  assert.equal(await started, true);
  assert.deepEqual(names(env.states), ["starting", "live"]);
});

test("the permission prompt is not timed; one readiness timer starts when the stream arrives", async () => {
  const env = setup();
  const play = deferred();
  env.video.playImpl = () => play.promise;
  const started = env.camera.start();
  await flush();
  assert.equal(
    env.timers.length,
    0,
    "no timeout while the user answers the permission prompt",
  );
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  await flush();
  assert.equal(env.timers.length, 1);
  play.resolve(); // play() resolves, but no frame has arrived yet.
  await flush();
  assert.equal(
    env.timers.length,
    1,
    "play resolving does not restart the deadline",
  );
  assert.deepEqual(names(env.states), ["starting"]);
  env.timers[0]();
  assert.equal(await started, false);
  assert.match(env.errors.at(-1), /sent no picture/);
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
});

test("a play() promise that never settles is bounded by the readiness timeout", async () => {
  const env = setup();
  env.video.playImpl = () => new Promise(() => {});
  const started = env.camera.start();
  await flush();
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  await flush();
  env.video.showFrame(); // A frame alone is not enough while play() is pending.
  env.video.dispatchEvent(new Event("loadeddata"));
  await flush();
  assert.deepEqual(names(env.states), ["starting"]);
  env.timers[0]();
  assert.equal(await started, false);
  assert.deepEqual(names(env.states), ["starting", "error"]);
  assert.match(env.errors.at(-1), /did not start within 8 seconds/);
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
});

test("stop and dispose settle a pending startup immediately, without waiting for the timer", async () => {
  for (const action of ["stop", "dispose", "hidden"]) {
    const env = setup();
    env.video.playImpl = () => new Promise(() => {});
    const started = env.camera.start();
    await flush();
    const stream = fakeStream();
    env.requests[0].resolve(stream);
    await flush();
    if (action === "stop") env.camera.stop();
    else if (action === "dispose") env.camera.dispose();
    else {
      env.document.visibilityState = "hidden";
      env.document.dispatchEvent(new Event("visibilitychange"));
    }
    assert.equal(await started, false, action);
    assert.equal(stream.track.stops, 1, action);
    assert.equal(env.video.srcObject, null, action);
    assert.equal(env.states.at(-1).state, "off", action);
    assert.equal(env.errors.length, 0, action);
    env.timers.forEach((fire) => fire());
    await flush();
    assert.equal(
      env.states.at(-1).state,
      "off",
      `${action}: a stale timer changes nothing`,
    );
  }
});

test("a new start during pending playback wins; the stale waiter cannot detach the new stream", async () => {
  const env = setup();
  const firstPlay = deferred();
  env.video.playImpl = () => firstPlay.promise;
  const first = env.camera.start();
  await flush();
  const oldStream = fakeStream("cam-old");
  env.requests[0].resolve(oldStream);
  await flush();

  env.video.playImpl = null; // The next play() succeeds with a frame.
  const second = env.camera.start("cam-new");
  assert.equal(
    oldStream.track.stops,
    1,
    "old tracks released when the new start begins",
  );
  assert.equal(await first, false, "old startup settles promptly");
  await flush();
  const newStream = fakeStream("cam-new");
  env.requests[1].resolve(newStream);
  assert.equal(await second, true);

  firstPlay.reject(domError("AbortError")); // Late outcome of the old play().
  env.timers.forEach((fire) => fire()); // Old and new deadlines fire late.
  await flush();
  assert.equal(env.video.srcObject, newStream);
  assert.equal(newStream.track.stops, 0);
  assert.equal(env.states.at(-1).state, "live");
  assert.equal(env.states.at(-1).deviceId, "cam-new");
  assert.equal(env.errors.length, 0);
});

test("late play() rejection after stop is handled, not left unhandled", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    const env = setup();
    const play = deferred();
    env.video.playImpl = () => play.promise;
    const started = env.camera.start();
    await flush();
    env.requests[0].resolve(fakeStream());
    await flush();
    env.camera.stop();
    assert.equal(await started, false);
    play.reject(domError("AbortError"));
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("a play() that throws synchronously is reported as a play failure", async () => {
  const env = setup();
  env.video.playImpl = () => {
    throw domError("NotSupportedError");
  };
  const started = env.camera.start();
  await flush();
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  assert.equal(await started, false);
  assert.match(env.errors.at(-1), /could not play/);
  assert.equal(stream.track.stops, 1);
});

test("hiding the page after a failed start keeps the useful error message", async () => {
  const env = setup();
  const started = env.camera.start();
  await flush();
  env.requests[0].reject(domError("NotAllowedError"));
  await started;
  env.document.visibilityState = "hidden";
  env.document.dispatchEvent(new Event("visibilitychange"));
  env.windowTarget.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(names(env.states), ["starting", "error"]);
  assert.match(env.states.at(-1).message, /denied or blocked/);
});

test("multiple starts: only the newest permission result is attached; stale streams are stopped", async () => {
  const env = setup();
  const first = env.camera.start();
  const second = env.camera.start();
  await flush();
  assert.equal(env.requests.length, 2);
  const streamTwo = fakeStream("cam-two");
  env.requests[1].resolve(streamTwo);
  assert.equal(await second, true);
  const streamOne = fakeStream("cam-one");
  env.requests[0].resolve(streamOne);
  assert.equal(await first, false);
  assert.equal(streamOne.track.stops, 1, "late stale stream released");
  assert.equal(streamTwo.track.stops, 0);
  assert.equal(env.video.srcObject, streamTwo);
  assert.equal(env.states.at(-1).state, "live");
  assert.equal(env.states.filter((entry) => entry.state === "live").length, 1);
});

test("late permission after stop is released and never reported live", async () => {
  const env = setup();
  const started = env.camera.start();
  await flush();
  env.camera.stop("Stopped by user.");
  assert.deepEqual(names(env.states), ["starting", "off"]);
  assert.equal(env.states[1].message, "Stopped by user.");
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  assert.equal(await started, false);
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
  assert.deepEqual(names(env.states), ["starting", "off"]);
});

test("late permission denial after a newer start does not overwrite the newer state", async () => {
  const env = setup();
  const first = env.camera.start();
  await flush();
  const second = env.camera.start();
  await flush();
  env.requests[1].resolve(fakeStream());
  assert.equal(await second, true);
  env.requests[0].reject(domError("NotAllowedError"));
  assert.equal(await first, false);
  assert.equal(env.states.at(-1).state, "live");
  assert.equal(env.errors.length, 0);
});

test("play failure releases the stream and reports a retry message", async () => {
  const env = setup();
  env.video.playImpl = () => Promise.reject(domError("NotAllowedError"));
  const started = env.camera.start();
  await flush();
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  assert.equal(await started, false);
  assert.deepEqual(names(env.states), ["starting", "error"]);
  assert.match(env.errors[0], /could not play/);
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
});

test("stop during a pending play leaves no attached stream", async () => {
  const env = setup();
  const play = deferred();
  env.video.playImpl = () => play.promise;
  const started = env.camera.start();
  await flush();
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  await flush();
  env.camera.stop();
  play.reject(domError("AbortError"));
  assert.equal(await started, false);
  assert.equal(stream.track.stops, 1);
  assert.equal(env.video.srcObject, null);
  assert.deepEqual(names(env.states), ["starting", "off"]);
  assert.equal(
    env.errors.length,
    0,
    "an intentional stop is not reported as an error",
  );
});

test("switching cameras releases the previous stream before requesting an exact device", async () => {
  const env = setup();
  const first = await goLive(env);
  const switching = env.camera.start("cam-b");
  assert.equal(first.track.stops, 1, "previous camera released immediately");
  await flush();
  assert.deepEqual(
    JSON.parse(JSON.stringify(env.requests[1].constraints.video)),
    {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      deviceId: { exact: "cam-b" },
    },
  );
  env.requests[1].resolve(fakeStream("cam-b"));
  assert.equal(await switching, true);
  assert.equal(env.states.at(-1).deviceId, "cam-b");
  first.track.endExternally();
  assert.equal(
    env.states.at(-1).state,
    "live",
    "the old track's ended event is ignored",
  );
});

test("externally ended track stops the camera, reports it and refuses capture", async () => {
  const env = setup();
  const stream = await goLive(env);
  stream.track.endExternally();
  assert.equal(env.states.at(-1).state, "error");
  assert.match(env.errors.at(-1), /stopped or was disconnected/);
  assert.equal(env.video.srcObject, null);
  assert.equal(env.camera.capture(), null);
});

test("hidden page and pagehide stop live and pending cameras", async () => {
  const env = setup();
  const stream = await goLive(env);
  env.document.visibilityState = "hidden";
  env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(stream.track.stops, 1);
  assert.equal(env.states.at(-1).state, "off");
  assert.match(env.states.at(-1).message, /hidden/);

  env.document.visibilityState = "visible";
  env.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(
    env.requests.length,
    1,
    "becoming visible never restarts the camera",
  );

  const pending = env.camera.start();
  await flush();
  env.windowTarget.dispatchEvent(new Event("pagehide"));
  const late = fakeStream();
  env.requests[1].resolve(late);
  assert.equal(await pending, false);
  assert.equal(late.track.stops, 1);
  assert.equal(env.states.at(-1).state, "off");
});

test("capture refuses muted, zero-size, oversized, non-JPEG and contextless frames without stopping", async () => {
  const oversized =
    "data:image/jpeg;base64," +
    "A".repeat(Math.ceil((2 * 1024 * 1024 + 1) / 3) * 4);
  const cases = [
    [{}, (env, stream) => (stream.track.muted = true), /no picture yet/],
    [{}, (env) => env.video.showFrame(0, 0), /no picture yet/],
    [{ toDataURL: () => oversized }, () => {}, /too detailed/],
    [
      { toDataURL: () => "data:image/png;base64,iVBORw0KGgo=" },
      () => {},
      /could not produce a JPEG/,
    ],
    [{ toDataURL: () => "data:," }, () => {}, /could not produce a JPEG/],
    [
      {
        toDataURL: () => {
          throw new Error("SecurityError raw");
        },
      },
      () => {},
      /could not be captured/,
    ],
    [{ noContext: true }, () => {}, /could not capture/],
  ];
  for (const [options, prepare, pattern] of cases) {
    const env = setup(options);
    const stream = await goLive(env);
    prepare(env, stream);
    assert.equal(env.camera.capture(), null, String(pattern));
    assert.match(env.errors.at(-1), pattern);
    assert.doesNotMatch(env.errors.at(-1), /raw/);
    assert.equal(
      env.camera.live,
      true,
      "a capture failure leaves the camera running",
    );
    assert.equal(stream.track.stops, 0);
  }
});

test("capture refuses during starting", async () => {
  const env = setup();
  env.camera.start();
  await flush();
  assert.equal(env.camera.capture(), null);
  assert.match(env.errors[0], /wait until it is live/);
});

test("listCameras returns video inputs only, without opening a camera", async () => {
  const env = setup({
    enumerate: () => [
      { kind: "audioinput", deviceId: "mic", label: "Microphone" },
      { kind: "videoinput", deviceId: "cam-a", label: "  Desk webcam  " },
      { kind: "videoinput", deviceId: "", label: "" },
      { kind: "videoinput", deviceId: "", label: "" },
      { kind: "videoinput", deviceId: "cam-b", label: "x".repeat(500) },
      null,
    ],
  });
  // Spread into this realm: arrays created inside the vm context have a different prototype.
  const cameras = [...(await env.camera.listCameras())];
  assert.equal(env.requests.length, 0);
  assert.deepEqual(
    cameras.map((camera) => camera.deviceId),
    ["cam-a", "", "cam-b"],
  );
  assert.equal(cameras[0].label, "Desk webcam");
  assert.equal(cameras[1].label, "Camera 2");
  assert.equal(cameras[2].label.length, 120);
  assert.equal(env.states.length, 0);
});

test("listCameras failure returns an empty list with a safe message", async () => {
  const env = setup({
    enumerate: () => {
      throw domError("NotAllowedError");
    },
  });
  assert.equal((await env.camera.listCameras()).length, 0);
  assert.match(env.errors[0], /could not be read/);
  assert.doesNotMatch(env.errors[0], /private/);
});

test("dispose stops the camera, removes page listeners and ignores later starts", async () => {
  const env = setup();
  const stream = await goLive(env);
  env.camera.dispose();
  assert.equal(stream.track.stops, 1);
  assert.equal(env.states.at(-1).state, "off");
  const count = env.states.length;
  env.document.visibilityState = "hidden";
  env.document.dispatchEvent(new Event("visibilitychange"));
  env.windowTarget.dispatchEvent(new Event("pagehide"));
  assert.equal(await env.camera.start(), false);
  assert.equal(env.requests.length, 1);
  assert.equal(env.states.length, count);
  env.camera.dispose();
});

test("throwing UI callbacks do not interrupt cleanup", async () => {
  const env = setup();
  const video = new FakeVideo();
  const camera = new env.context.ReverseStepsCamera({
    video,
    onState: () => {
      throw new Error("UI bug");
    },
    onError: () => {
      throw new Error("UI bug");
    },
  });
  const started = camera.start();
  await flush();
  const stream = fakeStream();
  env.requests[0].resolve(stream);
  assert.equal(await started, true);
  camera.stop();
  assert.equal(stream.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(camera.capture(), null);
});

test("constructor requires a video element and defaults callbacks", async () => {
  const env = setup();
  assert.throws(() => new env.context.ReverseStepsCamera({}), {
    name: "TypeError",
  });
  assert.throws(() => new env.context.ReverseStepsCamera(), {
    name: "TypeError",
  });
  const quiet = new env.context.ReverseStepsCamera({ video: new FakeVideo() });
  assert.equal(quiet.capture(), null);
  quiet.dispose();
});
