// DOM integration checks. Image decoding, layout and canvas are mocked; these
// checks do not establish browser rendering or visual recognition accuracy.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto, createHash } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "web/app.js"), "utf8");
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrL8AAAAASUVORK5CYII=";
const hash = createHash("sha256")
  .update(Buffer.from(PNG.split(",")[1], "base64"))
  .digest("hex");
const fixture = () => ({
  format: "reversesteps-workspace-v1",
  session: {
    schema_version: 1,
    id: "session-test",
    title: "Authored test fixture",
    images: [
      { id: "img-1", sha256: hash },
      { id: "img-2", sha256: hash },
    ],
    steps: [
      {
        id: "step-1",
        position: 1,
        image_id: "img-1",
        note: "First step",
        observations: [
          { id: "part-1", label: "Bracket", box: [0.1, 0.2, 0.4, 0.6] },
        ],
      },
      {
        id: "step-2",
        position: 2,
        image_id: "img-2",
        note: "Second step",
        observations: [
          { id: "part-2", label: "Bolt", box: [0.4, 0.4, 0.7, 0.8] },
        ],
      },
    ],
  },
  images: { "img-1": PNG, "img-2": PNG },
});
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("DOM operation did not finish");
}
async function setup(options = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:8765/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  const calls = [];
  let camera = null;
  if (options.camera) {
    Object.defineProperties(w.document.getElementById("camera-video"), {
      videoWidth: { value: 1000, configurable: true },
      videoHeight: { value: 800, configurable: true },
    });
    w.ReverseStepsCamera = class {
      constructor(callbacks) {
        camera = this;
        this.callbacks = callbacks;
        this.starts = [];
        this.captures = 0;
        this.stops = 0;
        this.data = PNG;
        this.error = null;
      }
      async start(deviceId) {
        this.starts.push(deviceId);
        this.callbacks.onState({
          state: "live",
          message: "Test camera live",
          deviceId: deviceId || "camera-a",
        });
      }
      stop(message) {
        this.stops++;
        this.callbacks.onState({
          state: "off",
          message: message || "Test camera stopped",
          deviceId: "",
        });
      }
      capture() {
        this.captures++;
        if (this.error) throw new Error(this.error);
        return this.data;
      }
      async listCameras() {
        return [
          { deviceId: "camera-a", label: "Test camera A" },
          { deviceId: "camera-b", label: "Test camera B" },
        ];
      }
    };
  }
  w.indexedDB = options.db || new IDBFactory();
  Object.defineProperty(w, "crypto", { value: webcrypto });
  w.ResizeObserver = class {
    observe() {}
  };
  w.confirm = () => true;
  w.URL.createObjectURL = () => PNG;
  w.URL.revokeObjectURL = () => {};
  w.AbortSignal.timeout = () => undefined;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({
    fillRect() {},
    drawImage() {},
  });
  w.HTMLCanvasElement.prototype.toDataURL = () => PNG;
  w.Image = function () {
    const img = w.document.createElement("img");
    Object.defineProperties(img, {
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 800 },
      src: {
        get() {
          return this.getAttribute("src");
        },
        set(v) {
          this.setAttribute("src", v);
          queueMicrotask(() => this.onload?.());
        },
      },
    });
    return img;
  };
  w.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === "/api/status")
      return {
        ok: true,
        json: async () => ({ ready: options.ready === true }),
      };
    return options.match
      ? options.match(init)
      : {
          ok: false,
          json: async () => ({
            error: { message: "Provider deliberately unavailable" },
          }),
        };
  };
  require("node:vm").runInContext(script, dom.getInternalVMContext());
  await until(() => !w.eval("busy"));
  return {
    dom,
    w,
    $: (id) => w.document.getElementById(id),
    calls,
    errors,
    db: w.indexedDB,
    camera,
  };
}
async function importData(ctx, data) {
  await ctx.$("import").onchange({
    target: {
      files: [{ size: 1000, text: async () => JSON.stringify(data) }],
      value: "test",
    },
  });
  await ctx.w.eval("saveQueue");
}
test("offline capture workspace keeps lookup disabled and reports its actual state", async () => {
  const c = await setup();
  try {
    assert.match(c.$("provider-message").textContent, /not connected/);
    assert.equal(c.$("find").disabled, true);
    assert.equal(c.$("empty").hidden, false);
    assert.equal(c.errors.length, 0);
  } finally {
    c.dom.window.close();
  }
});

test("failed restore preserves original data before a new edit is saved", async () => {
  const db = new IDBFactory();
  const bad = fixture();
  bad.session.images[0].sha256 = "0".repeat(64);
  const connection = await new Promise((resolve, reject) => {
    const r = db.open("reversesteps-visual-memory", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise((resolve, reject) => {
    const tx = connection.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(bad, "current");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const c = await setup({ db });
  try {
    assert.equal(c.$("export-recovery").hidden, false);
    assert.match(c.$("notice").textContent, /recovery copy/);
    c.$("title").value = "New work";
    c.$("title").dispatchEvent(new c.w.Event("change"));
    await c.w.eval("saveQueue");
    const records = await new Promise((resolve, reject) => {
      const r = connection
        .transaction("workspace")
        .objectStore("workspace")
        .getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    assert.ok(records.some((x) => JSON.stringify(x) === JSON.stringify(bad)));
    assert.ok(records.some((x) => x.session.title === "New work"));
    const nextBoot = await setup({ db });
    try {
      assert.equal(nextBoot.$("export-recovery").hidden, false);
      assert.equal(nextBoot.$("title").value, "New work");
    } finally {
      nextBoot.dom.window.close();
    }
  } finally {
    connection.close();
    c.dom.window.close();
  }
});

test("query follow-up retains the first photo and sends all views together", async () => {
  const c = await setup({ ready: true });
  try {
    let frame = 0;
    const viewImages = [];
    c.w.HTMLCanvasElement.prototype.toDataURL = () => {
      const url =
        "data:image/png;base64," +
        Buffer.concat([
          Buffer.from(PNG.split(",")[1], "base64"),
          Buffer.from([++frame]),
        ]).toString("base64");
      viewImages.push(url);
      return url;
    };
    await importData(c, fixture());
    const event = () => ({
      target: { files: [{ type: "image/png", size: 100 }], value: "photo" },
    });
    await c.$("query-photo").onchange(event());
    await c.$("query-extra").onchange(event());
    await c.$("query-extra").onchange(event());
    assert.equal(c.$("query-views").children.length, 3);
    assert.equal(c.$("extra-view-controls").hidden, true);
    await c.$("find").onclick();
    const sent = JSON.parse(
      c.calls.find((x) => x.url === "/api/match").init.body,
    );
    assert.deepEqual(sent.query.views, viewImages);
    assert.equal(sent.query.data_url, undefined);
    c.$("query-views").querySelector("button").click();
    assert.equal(c.$("query-views").children.length, 2);
    assert.equal(c.$("extra-view-controls").hidden, false);
  } finally {
    c.dom.window.close();
  }
});

test("source highlight survives image load, redraw and step navigation", async () => {
  const c = await setup();
  try {
    await importData(c, fixture());
    Object.defineProperties(c.$("main-photo"), {
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 800 },
      clientWidth: { value: 1000 },
      clientHeight: { value: 800 },
    });
    Object.defineProperty(c.$("photo-stage"), "clientWidth", { value: 1000 });
    c.w.eval(
      `showResult({model:'test',elapsed_ms:1,proposal:{status:'suggested_match',rationale:'Fixture',follow_up:null,candidates:[{step_id:'step-2',image_id:'img-2',observation_id:'part-2'}]}})`,
    );
    c.$("main-photo").onload();
    assert.equal(
      c.$("regions").querySelector(".selected").dataset.observation,
      "part-2",
    );
    c.w.eval("selectStep(0);selectStep(1);drawRegions()");
    assert.equal(
      c.$("regions").querySelector(".selected").dataset.observation,
      "part-2",
    );
  } finally {
    c.dom.window.close();
  }
});

test("lookup disables destructive region edits", async () => {
  const c = await setup();
  try {
    await importData(c, fixture());
    const remove = c.$("part-list").querySelector("button");
    c.w.eval("setBusy(true)");
    assert.equal(remove.disabled, true);
    remove.onclick();
    assert.equal(c.$("part-count").textContent, "02");
    c.w.eval("setBusy(false)");
  } finally {
    c.dom.window.close();
  }
});

test("oversized lookup is stopped before sending any request", async () => {
  const c = await setup({ ready: true });
  try {
    await importData(c, fixture());
    c.w.eval(
      `query={id:'query-test',views:[${JSON.stringify(PNG)}]};images['img-1']='x'.repeat(16*1024*1024);updateFind()`,
    );
    await c.$("find").onclick();
    assert.equal(c.calls.filter((x) => x.url === "/api/match").length, 0);
    assert.match(c.$("result").textContent, /size limit/);
  } finally {
    c.dom.window.close();
  }
});
test("backup round trip restores source photos, regions, reverse order and local persistence", async () => {
  const c = await setup();
  try {
    await importData(c, fixture());
    assert.equal(c.$("step-count").textContent, "02");
    assert.equal(c.$("part-count").textContent, "02");
    assert.equal(c.$("note").value, "First step");
    c.$("reverse").click();
    assert.equal(c.$("note").value, "Second step");
    assert.match(c.$("rebuild-label").textContent, /1 of 2/);
    c.$("next").click();
    assert.equal(c.$("note").value, "First step");
    const restored = await setup({ db: c.db });
    try {
      assert.equal(restored.$("step-count").textContent, "02");
      assert.equal(restored.$("title").value, "Authored test fixture");
    } finally {
      restored.dom.window.close();
    }
  } finally {
    c.dom.window.close();
  }
});
test("tampered photo hash is rejected without replacing existing session", async () => {
  const c = await setup();
  try {
    await importData(c, fixture());
    const bad = fixture();
    bad.session.title = "Malicious replacement";
    bad.session.images[0].sha256 = "0".repeat(64);
    await importData(c, bad);
    assert.equal(c.$("title").value, "Authored test fixture");
    assert.match(c.$("notice").textContent, /not a valid/);
  } finally {
    c.dom.window.close();
  }
});
test("out-of-bounds region and duplicate references cannot enter a restored session", async () => {
  const c = await setup();
  try {
    const bad = fixture();
    bad.session.steps[0].observations[0].box = [0, 0, 2, 1];
    await importData(c, bad);
    assert.equal(c.$("step-count").textContent, "00");
    const duplicate = fixture();
    duplicate.session.steps[1].observations[0].id = "part-1";
    await importData(c, duplicate);
    assert.equal(c.$("step-count").textContent, "00");
  } finally {
    c.dom.window.close();
  }
});
test("model ambiguity displays a specific next-view request and opens original evidence", async () => {
  const c = await setup({
    ready: true,
    match: async () => ({
      ok: true,
      json: async () => ({
        model: "test-double-only",
        elapsed_ms: 200,
        proposal: {
          status: "needs_more_evidence",
          rationale: "These two authored fixtures overlap.",
          follow_up: "Show the threaded end beside a ruler.",
          candidates: [
            { step_id: "step-2", image_id: "img-2", observation_id: "part-2" },
          ],
        },
      }),
    }),
  });
  try {
    await importData(c, fixture());
    c.w.eval(
      `query={id:'query-test',data_url:${JSON.stringify(PNG)}};updateFind()`,
    );
    await c.$("find").onclick();
    assert.match(c.$("result").textContent, /threaded end beside a ruler/);
    assert.equal(c.$("note").value, "Second step");
    const sent = JSON.parse(
      c.calls.find((x) => x.url === "/api/match").init.body,
    );
    assert.equal(sent.session.images[0].sha256, hash);
    assert.equal(sent.images["img-1"], PNG);
    assert.equal(c.$("find").disabled, false);
  } finally {
    c.dom.window.close();
  }
});
test("untrusted model text is rendered as text, never as markup", async () => {
  const c = await setup();
  try {
    await importData(c, fixture());
    c.w.eval(
      `showResult({model:'test',elapsed_ms:1,proposal:{status:'needs_more_evidence',rationale:'<img src=x onerror=alert(1)>',follow_up:'<script>alert(1)</script>',candidates:[]}})`,
    );
    assert.equal(c.$("result").querySelector("img"), null);
    assert.equal(c.$("result").querySelector("script"), null);
    assert.match(c.$("result").textContent, /<img/);
  } finally {
    c.dom.window.close();
  }
});
test("failed lookup reports an error and restores controls without inventing a result", async () => {
  const c = await setup({ ready: true });
  try {
    await importData(c, fixture());
    c.w.eval(
      `query={id:'query-test',data_url:${JSON.stringify(PNG)}};updateFind()`,
    );
    await c.$("find").onclick();
    assert.match(c.$("result").textContent, /deliberately unavailable/);
    assert.equal(c.$("find").disabled, false);
    assert.equal(c.$("result").querySelector("button"), null);
  } finally {
    c.dom.window.close();
  }
});
test("deleting a source step removes orphan media and renumbers the recorded history", async () => {
  const c = await setup();
  try {
    await importData(c, fixture());
    c.$("remove-step").click();
    await c.w.eval("saveQueue");
    const saved = c.w.eval("snapshot()");
    assert.equal(saved.session.steps.length, 1);
    assert.equal(saved.session.steps[0].position, 1);
    assert.equal(saved.session.steps[0].id, "step-2");
    assert.equal(Object.keys(saved.images).length, 1);
    assert.equal(saved.images["img-1"], undefined);
  } finally {
    c.dom.window.close();
  }
});

test("camera is user-started; captured step is hashed, persisted and never sent to Meta automatically", async () => {
  const c = await setup({ camera: true });
  try {
    assert.equal(c.camera.starts.length, 0);
    assert.equal(c.$("camera-step").disabled, true);
    await c.$("camera-start").onclick();
    await until(() => c.$("camera-device").options.length === 2);
    assert.equal(c.$("camera-body").hidden, false);
    assert.equal(c.$("camera-step").disabled, false);
    await c.$("camera-step").onclick();
    await c.w.eval("saveQueue");
    const record = c.w.eval("snapshot()");
    assert.equal(record.session.steps.length, 1);
    assert.equal(record.session.steps[0].position, 1);
    assert.equal(record.session.images[0].sha256, hash);
    assert.equal(record.images[record.session.steps[0].image_id], PNG);
    assert.equal(c.calls.filter((x) => x.url === "/api/match").length, 0);
    const next = await setup({ db: c.db, camera: true });
    try {
      assert.equal(next.$("step-count").textContent, "01");
      assert.equal(next.camera.starts.length, 0);
    } finally {
      next.dom.window.close();
    }
  } finally {
    c.dom.window.close();
  }
});

test("camera query and additional views retain evidence, reject duplicates and stop at three", async () => {
  const c = await setup({ camera: true });
  try {
    await c.$("camera-start").onclick();
    await c.$("camera-query").onclick();
    await c.$("camera-extra").onclick();
    assert.equal(c.$("query-views").children.length, 1);
    assert.match(c.$("notice").textContent, /already included/);
    for (let n = 1; n <= 2; n++) {
      c.camera.data =
        "data:image/png;base64," +
        Buffer.concat([
          Buffer.from(PNG.split(",")[1], "base64"),
          Buffer.from([n]),
        ]).toString("base64");
      await c.$("camera-extra").onclick();
    }
    assert.equal(c.$("query-views").children.length, 3);
    assert.equal(c.$("camera-extra").disabled, true);
    const captures = c.camera.captures;
    await c.$("camera-extra").onclick();
    assert.equal(c.camera.captures, captures);
    assert.equal(c.calls.filter((x) => x.url === "/api/match").length, 0);
    assert.equal(c.$("step-count").textContent, "00");
    await c.$("camera-query").onclick();
    assert.equal(c.$("query-views").children.length, 1);
  } finally {
    c.dom.window.close();
  }
});

test("reference overlay follows selected evidence and never changes captured pixels", async () => {
  const c = await setup({ camera: true });
  try {
    await importData(c, fixture());
    Object.defineProperties(c.$("main-photo"), {
      naturalWidth: { value: 1000, configurable: true },
      naturalHeight: { value: 800, configurable: true },
    });
    c.$("main-photo").onload();
    await c.$("camera-start").onclick();
    c.$("camera-compare").checked = true;
    c.$("camera-compare").onchange();
    assert.equal(c.$("camera-ghost").hidden, false);
    assert.equal(c.$("camera-ghost").getAttribute("src"), PNG);
    assert.match(c.$("camera-reference-badge").textContent, /01/);
    c.w.eval("selectStep(1)");
    assert.match(c.$("camera-reference-badge").textContent, /02/);
    c.$("camera-opacity").value = "65";
    c.$("camera-opacity").oninput();
    assert.equal(c.$("camera-ghost").style.opacity, "0.65");
    await c.$("camera-query").onclick();
    assert.equal(c.w.eval("query.views[0]"), PNG);
    c.$("new").click();
    assert.equal(c.$("camera-compare").checked, false);
    assert.equal(c.$("camera-ghost").hidden, true);
  } finally {
    c.dom.window.close();
  }
});

test("incompatible photo proportions disable the reference and camera resize recomputes compatibility", async () => {
  const c = await setup({ camera: true });
  try {
    await importData(c, fixture());
    await c.$("camera-start").onclick();
    Object.defineProperties(c.$("main-photo"), {
      naturalWidth: { value: 600, configurable: true },
      naturalHeight: { value: 800, configurable: true },
    });
    c.$("main-photo").onload();
    assert.equal(c.$("camera-compare").disabled, true);
    assert.match(c.$("camera-reference-help").textContent, /different shape/);
    c.$("camera-compare").checked = true;
    c.$("camera-compare").onchange();
    assert.equal(c.$("camera-ghost").hidden, true);
    Object.defineProperties(c.$("camera-video"), {
      videoWidth: { value: 600, configurable: true },
      videoHeight: { value: 800, configurable: true },
    });
    c.$("camera-video").dispatchEvent(new c.w.Event("resize"));
    assert.equal(c.$("camera-compare").disabled, false);
    assert.equal(c.$("camera-stage").style.aspectRatio, "600 / 800");
    c.$("camera-compare").checked = true;
    c.$("camera-compare").onchange();
    assert.equal(c.$("camera-ghost").hidden, false);
    Object.defineProperty(c.$("camera-video"), "videoWidth", {
      value: 1000,
      configurable: true,
    });
    c.$("camera-video").dispatchEvent(new c.w.Event("resize"));
    assert.equal(c.$("camera-compare").checked, false);
    assert.equal(c.$("camera-ghost").hidden, true);
  } finally {
    c.dom.window.close();
  }
});

test("busy and cap guards prevent camera mutation while Stop remains available", async () => {
  const c = await setup({ camera: true });
  try {
    await c.$("camera-start").onclick();
    c.w.eval("setBusy(true)");
    await c.$("camera-step").onclick();
    await c.$("camera-query").onclick();
    assert.equal(c.camera.captures, 0);
    c.$("camera-stop").click();
    assert.equal(c.camera.stops, 1);
    assert.equal(c.$("camera-body").hidden, true);
    c.w.eval("setBusy(false)");
    await c.$("camera-start").onclick();
    for (let i = 0; i < 12; i++) await c.$("camera-step").onclick();
    assert.equal(c.$("camera-step").disabled, true);
    const captures = c.camera.captures;
    await c.$("camera-step").onclick();
    assert.equal(c.camera.captures, captures);
    assert.equal(c.$("step-count").textContent, "12");
  } finally {
    c.dom.window.close();
  }
});

test("failed camera capture keeps existing session and query and returns controls", async () => {
  const c = await setup({ camera: true });
  try {
    await importData(c, fixture());
    await c.$("camera-start").onclick();
    await c.$("camera-query").onclick();
    const before = JSON.stringify(c.w.eval("snapshot()"));
    const queryBefore = JSON.stringify(c.w.eval("query"));
    c.camera.error = "No camera frame is ready";
    await c.$("camera-step").onclick();
    await c.$("camera-extra").onclick();
    assert.equal(JSON.stringify(c.w.eval("snapshot()")), before);
    assert.equal(JSON.stringify(c.w.eval("query")), queryBefore);
    assert.match(c.$("notice").textContent, /No camera frame/);
    assert.equal(c.$("camera-step").disabled, false);
  } finally {
    c.dom.window.close();
  }
});

test("controller null capture refusal cannot become a query or saved step", async () => {
  const c = await setup({ camera: true });
  try {
    await importData(c, fixture());
    await c.$("camera-start").onclick();
    await c.$("camera-query").onclick();
    const original = JSON.stringify(c.w.eval("snapshot()"));
    const originalQuery = JSON.stringify(c.w.eval("query"));
    c.camera.capture = () => {
      c.camera.callbacks.onError("Waiting for a camera picture.");
      return null;
    };
    await c.$("camera-step").onclick();
    await c.$("camera-query").onclick();
    await c.$("camera-extra").onclick();
    assert.equal(JSON.stringify(c.w.eval("snapshot()")), original);
    assert.equal(JSON.stringify(c.w.eval("query")), originalQuery);
    assert.match(c.$("notice").textContent, /Waiting for a camera picture/);
    assert.equal(c.$("camera-query").disabled, false);
  } finally {
    c.dom.window.close();
  }
});

test("late device list from an old camera cannot overwrite the current selection", async () => {
  const c = await setup({ camera: true });
  try {
    let oldResolve;
    let requests = 0;
    c.camera.listCameras = () =>
      ++requests === 1
        ? new Promise((resolve) => (oldResolve = resolve))
        : Promise.resolve([{ deviceId: "new", label: "New camera" }]);
    await c.$("camera-start").onclick();
    c.camera.callbacks.onState({
      state: "starting",
      message: "Switching",
      deviceId: "new",
    });
    c.camera.callbacks.onState({
      state: "live",
      message: "New camera live",
      deviceId: "new",
    });
    await until(() => c.$("camera-device").value === "new");
    oldResolve([{ deviceId: "old", label: "Old camera" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(c.$("camera-device").value, "new");
  } finally {
    c.dom.window.close();
  }
});

test("stopped or switched camera clears the manually aligned reference", async () => {
  const c = await setup({ camera: true });
  try {
    await importData(c, fixture());
    await c.$("camera-start").onclick();
    await until(() => c.$("camera-device").options.length === 2);
    c.$("camera-compare").checked = true;
    c.$("camera-compare").onchange();
    c.camera.callbacks.onState({
      state: "starting",
      message: "Switching camera",
      deviceId: "",
    });
    assert.equal(c.$("camera-compare").checked, false);
    assert.equal(c.$("camera-ghost").hidden, true);
    c.camera.stop("Camera hidden");
    assert.match(c.$("camera-message").textContent, /Camera hidden/);
    assert.equal(c.$("camera-start").hidden, false);
    assert.equal(c.$("camera-step").disabled, true);
  } finally {
    c.dom.window.close();
  }
});

test("real controller and app integrate through capture, saving and hidden-page cleanup with mocked hardware", async () => {
  const c = await setup({ camera: true });
  try {
    const video = c.$("camera-video");
    Object.defineProperties(video, {
      readyState: { value: 4, configurable: true },
      videoWidth: { value: 1920, configurable: true },
      videoHeight: { value: 1080, configurable: true },
    });
    video.play = async () => {};
    video.pause = () => {};
    const track = new c.w.EventTarget();
    track.readyState = "live";
    track.muted = false;
    track.getSettings = () => ({ deviceId: "physical-test-double" });
    let stops = 0;
    track.stop = () => {
      track.readyState = "ended";
      stops++;
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const requests = [];
    Object.defineProperty(c.w.navigator, "mediaDevices", {
      value: {
        getUserMedia: async (config) => {
          requests.push(config);
          return stream;
        },
        enumerateDevices: async () => [
          {
            kind: "videoinput",
            deviceId: "physical-test-double",
            label: "Mocked hardware",
          },
        ],
      },
      configurable: true,
    });
    // Encoding is a deliberate test double, not a real webcam photograph.
    const jpeg =
      "data:image/jpeg;base64," +
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
    c.w.HTMLCanvasElement.prototype.toDataURL = () => jpeg;
    c.w.eval(fs.readFileSync(path.join(root, "web/camera.js"), "utf8"));
    c.w.eval("initializeCamera()");
    assert.equal(requests.length, 0);
    await c.$("camera-start").onclick();
    assert.equal(requests[0].audio, false);
    assert.equal(c.$("camera-status").textContent, "● Live on this device");
    await c.$("camera-step").onclick();
    await c.w.eval("saveQueue");
    const saved = c.w.eval("snapshot()");
    assert.equal(
      saved.session.images[0].sha256,
      createHash("sha256")
        .update(Buffer.from(jpeg.split(",")[1], "base64"))
        .digest("hex"),
    );
    assert.equal(Object.values(saved.images)[0], jpeg);
    await c.$("camera-query").onclick();
    assert.equal(c.w.eval("query.views[0]"), jpeg);
    assert.equal(c.calls.filter((x) => x.url === "/api/match").length, 0);
    Object.defineProperty(c.w.document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    c.w.document.dispatchEvent(new c.w.Event("visibilitychange"));
    assert.equal(stops, 1);
    assert.equal(video.srcObject, null);
    assert.equal(c.$("camera-body").hidden, true);
    assert.equal(c.$("step-count").textContent, "01");
    c.w.eval("cameraController.dispose()");
  } finally {
    c.dom.window.close();
  }
});
