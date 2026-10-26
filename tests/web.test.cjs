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
