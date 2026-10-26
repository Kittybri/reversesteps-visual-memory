"use strict";
const $ = (id) => document.getElementById(id);
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const blank = () => ({
  schema_version: 1,
  id: uid("session"),
  title: "My first teardown",
  images: [],
  steps: [],
});
let session = blank(),
  images = {},
  active = 0,
  query = null,
  ready = false,
  busy = false;
let marking = false,
  drawingStart = null,
  reverse = false,
  db,
  saveQueue = Promise.resolve(),
  revision = 0,
  highlighted = new Set(),
  recoveryRecord = null,
  storageBlocked = false;
let cameraController = null,
  cameraState = { state: "off", message: "Camera off", deviceId: "" },
  cameraDevices = [],
  cameraListEpoch = 0,
  sourceDimensions = new Map();
const notify = (message) => {
  $("notice").textContent = message;
  $("notice").hidden = !message;
};
const text = (tag, content, className) => {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className) el.className = className;
  return el;
};
function invalidate() {
  revision++;
  highlighted.clear();
  $("result").replaceChildren();
  $("result").hidden = true;
}
function changed() {
  invalidate();
  persist();
  render();
}
function snapshot() {
  return JSON.parse(
    JSON.stringify({ format: "reversesteps-workspace-v1", session, images }),
  );
}
function persist() {
  if (storageBlocked) {
    $("save-state").textContent = "Saving paused — export your work";
    notify(
      "The previous workspace could not be restored. Its data is protected. Use Recover backup for that copy and Export to keep your current work.",
    );
    return;
  }
  const record = snapshot();
  $("save-state").textContent = "Saving locally…";
  saveQueue = saveQueue
    .catch(() => {})
    .then(
      () =>
        new Promise((resolve, reject) => {
          if (!db) {
            reject(new Error("Browser storage unavailable"));
            return;
          }
          const tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(record, "current");
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    )
    .then(() => {
      $("save-state").textContent = "Saved on this device";
    })
    .catch(() => {
      $("save-state").textContent = "Not saved — export a backup";
      notify(
        "Local saving failed. Use Export now to keep your photos and steps.",
      );
    });
}
async function hashUrl(url) {
  const raw = atob(url.split(",")[1]);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function imageFrom(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("That image could not be opened. Try a JPEG or PNG."));
    img.src = url;
  });
}
async function normalize(file) {
  if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024)
    throw new Error("Choose an image smaller than 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await imageFrom(url);
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 60e6)
      throw new Error("This photo is too large. Resize it and try again.");
    const scale = Math.min(
      1,
      1440 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.86);
    if (data.length > 2.6 * 1024 * 1024)
      throw new Error("This image is too detailed. Try a smaller photo.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
function setBusy(value) {
  busy = value;
  [
    "photos",
    "query-photo",
    "query-extra",
    "import",
    "new",
    "remove-step",
    "mark",
    "title",
    "note",
    "part-label",
  ].forEach((id) => ($(id).disabled = value));
  $("part-list")
    .querySelectorAll("button")
    .forEach((button) => (button.disabled = value));
  renderQuery();
  updateFind();
}
function updateFind() {
  const count = session.steps.reduce((n, s) => n + s.observations.length, 0);
  $("find").disabled = busy || !ready || !query || !count;
  $("find").textContent = busy ? "Working…" : "Find its story ↗";
  $("reverse").disabled = !session.steps.length || busy;
  renderCamera();
}

function renderCamera() {
  const live = cameraState.state === "live";
  const starting = cameraState.state === "starting";
  const step = session.steps[active];
  const viewCount = query?.views?.length || 0;
  $("camera-deck").classList.toggle("is-live", live);
  $("camera-status").textContent = live
    ? "● Live on this device"
    : starting
      ? "Opening camera…"
      : cameraState.state === "error"
        ? "Camera unavailable"
        : "Camera off";
  $("camera-message").textContent =
    cameraState.message ||
    "Use your webcam to save steps and photograph a loose piece.";
  $("camera-start").disabled = busy || !cameraController || starting || live;
  $("camera-start").hidden = starting || live;
  $("camera-stop").hidden = !starting && !live;
  $("camera-stop").textContent = starting ? "Cancel camera" : "Stop camera";
  $("camera-body").hidden = !live && !starting;
  $("camera-live-badge").textContent = live
    ? "LIVE · LOCAL PREVIEW"
    : "OPENING CAMERA";
  $("camera-device").disabled = busy || !live || cameraDevices.length < 2;
  $("camera-step").disabled = busy || !live || session.steps.length >= 12;
  $("camera-step-help").textContent =
    session.steps.length >= 12
      ? "12 steps reached. Export this object before starting another."
      : `Step ${session.steps.length + 1}: hold still with hands clear, capture before moving a piece, then mark it below.`;
  $("camera-query").disabled = busy || !live;
  $("camera-query").textContent = query
    ? "Use as a different piece"
    : "Use as mystery piece";
  $("camera-extra").disabled = busy || !live || !viewCount || viewCount >= 3;
  $("camera-query-help").textContent =
    viewCount >= 3
      ? "Three views ready. Remove a query view below to add another."
      : viewCount
        ? `${viewCount} of 3 views saved. Keep the same piece for another angle, or start a different piece.`
        : "Hold a piece in view. Use Find its story below when you are ready.";
  const sourceHash = step
    ? session.images.find((image) => image.id === step.image_id)?.sha256
    : null;
  const sourceSize = sourceDimensions.get(sourceHash);
  const video = $("camera-video");
  const videoRatio =
    video.videoWidth && video.videoHeight
      ? video.videoWidth / video.videoHeight
      : 0;
  const sourceRatio = sourceSize ? sourceSize.width / sourceSize.height : 0;
  const shapeMismatch =
    !!sourceRatio &&
    !!videoRatio &&
    Math.abs(sourceRatio / videoRatio - 1) > 0.02;
  const canCompare =
    live && !!step && !!sourceRatio && !!videoRatio && !shapeMismatch;
  $("camera-compare").disabled = !canCompare;
  if (shapeMismatch) $("camera-compare").checked = false;
  $("camera-reference-help").textContent = shapeMismatch
    ? "This photo has a different shape from the camera view. Choose a photo with the same proportions; you can still inspect the original below."
    : step && !sourceRatio
      ? "Loading the recorded photo for comparison…"
      : "Select a step below and line up the camera yourself. This reference does not check placement.";
  if (!step) $("camera-compare").checked = false;
  const comparing = canCompare && $("camera-compare").checked;
  $("camera-ghost").hidden = !comparing;
  $("camera-reference-badge").hidden = !comparing;
  $("camera-opacity").disabled = !comparing;
  if (comparing) {
    const src = images[step.image_id];
    if ($("camera-ghost").getAttribute("src") !== src)
      $("camera-ghost").src = src;
    $("camera-ghost").alt =
      `Original photo from step ${step.position}; align the camera manually`;
    $("camera-ghost").style.opacity = String(
      Number($("camera-opacity").value) / 100,
    );
    $("camera-reference-badge").textContent =
      `REFERENCE · STEP ${String(step.position).padStart(2, "0")}`;
  } else $("camera-ghost").removeAttribute("src");
  $("camera-opacity-value").textContent = `${$("camera-opacity").value}%`;
}

async function refreshCameraDevices() {
  const epoch = ++cameraListEpoch;
  const devices = await cameraController.listCameras();
  if (epoch !== cameraListEpoch || cameraState.state !== "live") return;
  cameraDevices = devices;
  $("camera-device").replaceChildren();
  if (!devices.length) {
    const option = text("option", "Default camera");
    option.value = "";
    $("camera-device").append(option);
  }
  devices.forEach((device, index) => {
    const option = text("option", device.label || `Camera ${index + 1}`);
    option.value = device.deviceId;
    $("camera-device").append(option);
  });
  if (devices.some((device) => device.deviceId === cameraState.deviceId))
    $("camera-device").value = cameraState.deviceId;
  renderCamera();
}

function initializeCamera() {
  if (typeof window.ReverseStepsCamera !== "function") {
    cameraState = {
      state: "error",
      message:
        "Camera tools did not load. Refresh this page or continue with photo uploads.",
      deviceId: "",
    };
    renderCamera();
    return;
  }
  cameraController = new window.ReverseStepsCamera({
    video: $("camera-video"),
    onError: (message) => notify(message),
    onState: (state) => {
      cameraState = state;
      if (state.state !== "live") {
        cameraListEpoch++;
        $("camera-compare").checked = false;
      }
      renderCamera();
      if (state.state === "live" && cameraController)
        void refreshCameraDevices().catch(() =>
          notify(
            "Could not list cameras. The current camera can still be used.",
          ),
        );
    },
  });
  renderCamera();
}

$("camera-start").onclick = async () => {
  if (
    busy ||
    !cameraController ||
    ["starting", "live"].includes(cameraState.state)
  )
    return;
  notify("");
  try {
    await cameraController.start();
  } catch {
    notify(
      "Could not start the camera. Check browser camera access, or upload photos instead.",
    );
  }
};
$("camera-stop").onclick = () =>
  cameraController?.stop(
    "Camera stopped. Your saved snapshots are still available.",
  );
$("camera-device").onchange = async () => {
  if (busy || cameraState.state !== "live" || !cameraController) return;
  try {
    const started = await cameraController.start(
      $("camera-device").value || undefined,
    );
    if (started === false && cameraState.state === "error") {
      cameraState = {
        ...cameraState,
        message: `${cameraState.message} Start camera will try the default camera.`,
      };
      renderCamera();
    }
  } catch {
    notify("Could not switch cameras. Try Start camera again.");
  }
};
$("camera-compare").onchange = renderCamera;
$("camera-opacity").oninput = renderCamera;
function updateCameraShape() {
  const video = $("camera-video");
  if (video.videoWidth && video.videoHeight)
    $("camera-stage").style.aspectRatio =
      `${video.videoWidth} / ${video.videoHeight}`;
  renderCamera();
}
$("camera-video").addEventListener("loadedmetadata", updateCameraShape);
$("camera-video").addEventListener("resize", updateCameraShape);

function appendSteps(additions) {
  $("camera-compare").checked = false;
  additions.forEach(({ data, hash }) => {
    const id = uid("image");
    images[id] = data;
    session.images.push({ id, sha256: hash });
    session.steps.push({
      id: uid("step"),
      position: session.steps.length + 1,
      image_id: id,
      note: `Step ${session.steps.length + 1}`,
      observations: [],
    });
  });
  active = session.steps.length - 1;
  reverse = false;
  marking = false;
}

function setQueryView(data, append) {
  if (append && query?.views.length >= 3)
    throw new Error("You already have three views. Remove one to add another.");
  if (append && query?.views.includes(data))
    throw new Error(
      "That photo is already included. Choose a different angle of the same piece.",
    );
  query = {
    id: uid("query"),
    views: append && query ? [...query.views, data] : [data],
  };
  invalidate();
  drawRegions();
}

async function captureCamera(target) {
  if (busy || cameraState.state !== "live" || !cameraController) return;
  if (target === "step" && session.steps.length >= 12) {
    notify(
      "The 12-step limit is reached. Export this workspace before starting another object.",
    );
    return;
  }
  if (target === "extra" && (!query || query.views.length >= 3)) {
    notify(
      "Capture a mystery piece first, and keep at most three views of it.",
    );
    return;
  }
  setBusy(true);
  notify("");
  try {
    // Capture only the video pixels. The reference overlay is never baked into evidence.
    const data = cameraController.capture();
    if (typeof data !== "string" || !data) return;
    if (target === "step") {
      const hash = await hashUrl(data);
      appendSteps([{ data, hash }]);
      changed();
      notify(
        `Step ${session.steps.length} saved. Add a note and mark the piece in its original photo below.`,
      );
    } else {
      setQueryView(data, target === "extra");
      notify(
        target === "extra"
          ? "Another view saved. Find its story will compare all views together."
          : "Mystery piece captured. Use Find its story to request a Meta comparison.",
      );
    }
  } catch (error) {
    notify(
      error.message ||
        "Could not capture a frame. Your saved photos were kept.",
    );
  } finally {
    setBusy(false);
  }
}
$("camera-step").onclick = () => captureCamera("step");
$("camera-query").onclick = () => captureCamera("query");
$("camera-extra").onclick = () => captureCamera("extra");
function imageBounds() {
  const img = $("main-photo"),
    stage = $("photo-stage");
  if (!img.naturalWidth) return null;
  const scale = Math.min(
    img.clientWidth / img.naturalWidth,
    img.clientHeight / img.naturalHeight,
  );
  const width = img.naturalWidth * scale,
    height = img.naturalHeight * scale;
  return {
    left: (stage.clientWidth - width) / 2,
    top: (img.clientHeight - height) / 2,
    width,
    height,
  };
}
function drawRegions() {
  const container = $("regions");
  container.replaceChildren();
  const step = session.steps[active],
    bounds = imageBounds();
  if (!step || !bounds) return;
  Object.assign(container.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
  step.observations.forEach((obs) => {
    const region = text("div", "", "region");
    if (highlighted.has(obs.id)) region.classList.add("selected");
    else if (highlighted.size) region.classList.add("dimmed");
    const [l, t, r, b] = obs.box;
    Object.assign(region.style, {
      left: `${l * 100}%`,
      top: `${t * 100}%`,
      width: `${(r - l) * 100}%`,
      height: `${(b - t) * 100}%`,
    });
    region.dataset.observation = obs.id;
    region.append(text("span", obs.label));
    container.append(region);
  });
}
function selectStep(index) {
  active = index;
  marking = false;
  $("drawing").hidden = true;
  render();
}
function render() {
  $("title").value = session.title;
  $("step-count").textContent = String(session.steps.length).padStart(2, "0");
  $("part-count").textContent = String(
    session.steps.reduce((n, s) => n + s.observations.length, 0),
  ).padStart(2, "0");
  const step = session.steps[active];
  $("empty").hidden = !!step;
  $("photo-stage").hidden = !step;
  $("step-editor").hidden = !step;
  $("photo-stage").classList.toggle("marking", marking);
  $("mark").textContent = marking ? "Cancel marking" : "⌖ Mark a part";
  $("mark-help").textContent = marking
    ? "Drag a box around the part in the photograph."
    : "Mark the visible parts you want to find later. Regions are selected by you.";
  if (step) {
    const source = images[step.image_id];
    if ($("main-photo").getAttribute("src") !== source)
      $("main-photo").src = source;
    $("main-photo").alt = `Step ${step.position}: ${step.note}`;
    $("note").value = step.note;
    $("frame-label").textContent =
      `STEP ${String(step.position).padStart(2, "0")}`;
    drawRegions();
  }
  $("part-list").replaceChildren();
  step?.observations.forEach((obs) => {
    const chip = text("span", "", "part-chip");
    chip.append(text("span", obs.label));
    const remove = text("button", "×");
    remove.setAttribute("aria-label", `Remove region ${obs.label}`);
    remove.disabled = busy;
    remove.onclick = () => {
      if (busy) return;
      step.observations = step.observations.filter((o) => o.id !== obs.id);
      changed();
    };
    chip.append(remove);
    $("part-list").append(chip);
  });
  $("timeline").replaceChildren();
  if (!session.steps.length)
    $("timeline").append(text("p", "Your steps will appear here.", "small"));
  const ordered = reverse ? [...session.steps].reverse() : session.steps;
  ordered.forEach((s) => {
    const index = session.steps.indexOf(s);
    const card = text(
      "button",
      "",
      `timeline-card${index === active ? " active" : ""}`,
    );
    card.setAttribute("aria-label", `Open step ${s.position}: ${s.note}`);
    card.setAttribute("aria-pressed", String(index === active));
    const img = new Image();
    img.src = images[s.image_id];
    img.alt = "";
    card.append(
      img,
      text("span", `STEP ${String(s.position).padStart(2, "0")}`),
    );
    card.onclick = () => selectStep(index);
    $("timeline").append(card);
  });
  $("reverse").textContent = reverse
    ? "↗ Return to recorded order"
    : "↶ Rebuild in reverse";
  $("rebuild-controls").hidden = !reverse || !step;
  $("rebuild-label").textContent = step
    ? `Rebuild ${session.steps.length - active} of ${session.steps.length}`
    : "";
  $("previous").disabled = active === session.steps.length - 1;
  $("next").disabled = active === 0;
  updateFind();
}
$("photos").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  if (busy) return;
  if (session.steps.length + files.length > 12) {
    notify(
      "Keep this teardown to 12 photos or fewer. Export it before starting another object.",
    );
    return;
  }
  setBusy(true);
  notify("");
  try {
    const additions = [];
    for (const file of files) {
      const data = await normalize(file);
      additions.push({ data, hash: await hashUrl(data) });
    } // Commit the batch only after every image decodes.
    appendSteps(additions);
    changed();
    notify(
      "Photos added. Give each step a short note, then mark the parts you want to find later.",
    );
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
    render();
  }
});
$("title").addEventListener("change", () => {
  session.title = $("title").value.trim() || "My first teardown";
  changed();
});
$("note").addEventListener("change", () => {
  const s = session.steps[active];
  if (s) {
    s.note = $("note").value.trim() || `Step ${s.position}`;
    changed();
  }
});
$("remove-step").onclick = () => {
  const step = session.steps[active];
  if (!step || !confirm("Remove this step and its marked parts?")) return;
  session.steps.splice(active, 1);
  if (!session.steps.some((s) => s.image_id === step.image_id)) {
    session.images = session.images.filter((i) => i.id !== step.image_id);
    delete images[step.image_id];
  }
  session.steps.forEach((s, i) => (s.position = i + 1));
  active = Math.max(0, Math.min(active, session.steps.length - 1));
  changed();
};
$("mark").onclick = () => {
  if (!marking && !$("part-label").value.trim()) {
    notify("Name the part first, then drag a box around it.");
    $("part-label").focus();
    return;
  }
  marking = !marking;
  notify("");
  render();
};
function pointerPosition(event) {
  const b = imageBounds();
  if (!b) return null;
  const rect = $("photo-stage").getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left - b.left) / b.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top - b.top) / b.height)),
    b,
  };
}
$("photo-stage").onpointerdown = (event) => {
  if (!marking || busy || event.button !== 0) return;
  const p = pointerPosition(event);
  if (!p) return;
  drawingStart = p;
  $("photo-stage").setPointerCapture(event.pointerId);
  $("drawing").hidden = false;
  Object.assign($("drawing").style, {
    left: `${p.b.left + p.x * p.b.width}px`,
    top: `${p.b.top + p.y * p.b.height}px`,
    width: "0px",
    height: "0px",
  });
};
$("photo-stage").onpointermove = (event) => {
  if (!drawingStart) return;
  const p = pointerPosition(event);
  if (!p) return;
  Object.assign($("drawing").style, {
    left: `${p.b.left + Math.min(drawingStart.x, p.x) * p.b.width}px`,
    top: `${p.b.top + Math.min(drawingStart.y, p.y) * p.b.height}px`,
    width: `${Math.abs(p.x - drawingStart.x) * p.b.width}px`,
    height: `${Math.abs(p.y - drawingStart.y) * p.b.height}px`,
  });
};
$("photo-stage").onpointerup = (event) => {
  if (!drawingStart) return;
  const p = pointerPosition(event),
    start = drawingStart;
  drawingStart = null;
  $("drawing").hidden = true;
  const step = session.steps[active];
  if (!p || !step) return;
  const box = [
    Math.min(start.x, p.x),
    Math.min(start.y, p.y),
    Math.max(start.x, p.x),
    Math.max(start.y, p.y),
  ];
  if (box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01) {
    notify("Draw a slightly larger box around the part.");
    return;
  }
  if (step.observations.length >= 32) {
    notify("This step already has 32 marked regions.");
    return;
  }
  const label = $("part-label").value.trim();
  if (!label) {
    notify("Give this part a name before marking its region.");
    $("part-label").focus();
    return;
  }
  step.observations.push({
    id: uid("part"),
    label,
    box,
  });
  marking = false;
  $("part-label").value = "";
  changed();
};
$("photo-stage").onpointercancel = () => {
  drawingStart = null;
  $("drawing").hidden = true;
};
$("main-photo").onload = () => {
  const photo = $("main-photo"),
    step = session.steps[active];
  if (
    step &&
    photo.getAttribute("src") === images[step.image_id] &&
    photo.naturalWidth &&
    photo.naturalHeight
  ) {
    const digest = session.images.find(
      (image) => image.id === step.image_id,
    )?.sha256;
    if (digest)
      sourceDimensions.set(digest, {
        width: photo.naturalWidth,
        height: photo.naturalHeight,
      });
  }
  drawRegions();
  renderCamera();
};
new ResizeObserver(drawRegions).observe($("viewer"));
$("reverse").onclick = () => {
  reverse = !reverse;
  active = reverse ? session.steps.length - 1 : 0;
  selectStep(active);
};
$("previous").onclick = () =>
  selectStep(Math.min(session.steps.length - 1, active + 1));
$("next").onclick = () => selectStep(Math.max(0, active - 1));
async function loadQuery(event, append) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (busy) return;
  if (append && query?.views.length >= 3) {
    notify("You already have three views. Remove one to add another.");
    return;
  }
  setBusy(true);
  notify("");
  try {
    const data = await normalize(file);
    setQueryView(data, append);
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
}
$("query-photo").onchange = (event) => loadQuery(event, false);
$("query-extra").onchange = (event) => loadQuery(event, true);
function renderQuery() {
  const views = query?.views || [];
  $("query-preview").hidden = !views.length;
  $("query-placeholder").hidden = !!views.length;
  $("query-replace").hidden = !views.length;
  $("extra-view-controls").hidden = !views.length || views.length >= 3;
  $("query-views").replaceChildren();
  if (!views.length) {
    $("query-preview").removeAttribute("src");
    return;
  }
  $("query-preview").src = views[views.length - 1];
  views.forEach((url, index) => {
    const tile = text("div", "", "query-view");
    const img = new Image();
    img.src = url;
    img.alt = `Query view ${index + 1}`;
    const remove = text("button", `× View ${index + 1}`, "quiet");
    remove.disabled = busy;
    remove.setAttribute("aria-label", `Remove query view ${index + 1}`);
    remove.onclick = () => {
      if (busy) return;
      query.views.splice(index, 1);
      if (!query.views.length) query = null;
      else query.id = uid("query");
      invalidate();
      renderQuery();
      drawRegions();
      updateFind();
    };
    tile.append(img, remove);
    $("query-views").append(tile);
  });
}
function showResult(data) {
  const out = $("result"),
    p = data.proposal;
  out.replaceChildren();
  out.hidden = false;
  highlighted = new Set(
    p.candidates.map((candidate) => candidate.observation_id),
  );
  out.append(
    text(
      "p",
      `${data.model} · ${(data.elapsed_ms / 1000).toFixed(1)} seconds`,
      "eyebrow",
    ),
  );
  out.append(
    text(
      "h3",
      p.status === "suggested_match"
        ? "A possible way back."
        : "One more clue.",
    ),
  );
  out.append(text("p", p.rationale));
  if (p.follow_up) out.append(text("p", p.follow_up, "followup"));
  p.candidates.forEach((c) => {
    const index = session.steps.findIndex((s) => s.id === c.step_id);
    const step = session.steps[index];
    const observation = step?.observations.find(
      (o) => o.id === c.observation_id,
    );
    if (!observation) return;
    const button = text(
      "button",
      `↖ Step ${step.position} · ${observation.label}`,
      "button outline",
    );
    button.onclick = () => {
      selectStep(index);
      $("viewer").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    out.append(button);
  });
  out.append(
    text(
      "p",
      "References checked against your recorded steps. Review the photograph before acting; appearance alone does not prove fit.",
      "small",
    ),
  );
  if (p.candidates.length) {
    const stepIndex = session.steps.findIndex(
      (s) => s.id === p.candidates[0].step_id,
    );
    if (stepIndex >= 0) selectStep(stepIndex);
  }
}
$("find").onclick = async () => {
  if (busy || !ready || !query) return;
  const requestRevision = revision;
  setBusy(true);
  notify("");
  $("result").hidden = false;
  $("result").replaceChildren(
    text("h3", "Following the evidence…"),
    text(
      "p",
      "Comparing this part with the photographs and regions you recorded.",
    ),
  );
  try {
    const body = JSON.stringify({ session, images, query });
    if (new Blob([body]).size > 16 * 1024 * 1024)
      throw new Error(
        "These photos exceed the lookup size limit. Export a backup, then use fewer source photos or smaller images.",
      );
    const response = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message || "Lookup could not finish.");
    if (revision !== requestRevision)
      throw new Error(
        "The workspace changed during lookup. Try again with the current photos.",
      );
    showResult(data);
  } catch (error) {
    $("result").replaceChildren(
      text("h3", "No result yet."),
      text(
        "p",
        error.name === "TimeoutError"
          ? "The lookup timed out. No automatic retry was made."
          : error.message,
      ),
    );
  } finally {
    setBusy(false);
  }
};
async function status() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error();
    const data = await res.json();
    ready = data.ready === true;
    $("provider-message").textContent = ready
      ? "Meta enabled · ready for a lookup"
      : "Meta not connected · you can still capture and replay";
    $("provider-state").classList.toggle("ready", ready);
  } catch {
    ready = false;
    $("provider-message").textContent =
      "Local server unavailable · reopen with the launcher";
  }
  updateFind();
}
$("export").onclick = () => {
  const data = JSON.stringify(snapshot());
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `reversesteps-${session.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(
    "Backup exported. It includes your photos; keep it somewhere you trust.",
  );
};
function objectKeys(obj, keys) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.keys(obj).sort().join("|") === keys.sort().join("|")
  );
}
async function validateWorkspace(data) {
  const fail = () => {
    throw new Error(
      "This is not a valid ReverseSteps backup. Your current workspace was kept.",
    );
  };
  const id = (s) =>
    typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(s);
  const str = (s, max) => typeof s === "string" && s.trim() && s.length <= max;
  if (
    !objectKeys(data, ["format", "session", "images"]) ||
    data.format !== "reversesteps-workspace-v1"
  )
    fail();
  const s = data.session;
  if (
    !objectKeys(s, ["schema_version", "id", "title", "images", "steps"]) ||
    s.schema_version !== 1 ||
    !id(s.id) ||
    !str(s.title, 200) ||
    !Array.isArray(s.steps) ||
    s.steps.length > 12 ||
    !Array.isArray(s.images) ||
    s.images.length !== s.steps.length ||
    !data.images ||
    Array.isArray(data.images) ||
    typeof data.images !== "object"
  )
    fail();
  const ids = new Set(),
    stepids = new Set(),
    observations = new Set(),
    used = new Set();
  for (const img of s.images) {
    if (
      !objectKeys(img, ["id", "sha256"]) ||
      !id(img.id) ||
      ids.has(img.id) ||
      !/^[0-9a-f]{64}$/.test(img.sha256)
    )
      fail();
    ids.add(img.id);
    const url = data.images[img.id];
    if (
      typeof url !== "string" ||
      url.length > 2.8e6 ||
      !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(url)
    )
      fail();
    if (atob(url.split(",")[1]).length > 2 * 1024 * 1024) fail();
    if ((await hashUrl(url)) !== img.sha256) fail();
    const decoded = await imageFrom(url);
    if (decoded.naturalWidth * decoded.naturalHeight > 60e6) fail();
  }
  if (Object.keys(data.images).length !== ids.size) fail();
  for (const [i, step] of s.steps.entries()) {
    if (
      !objectKeys(step, [
        "id",
        "position",
        "image_id",
        "note",
        "observations",
      ]) ||
      !id(step.id) ||
      stepids.has(step.id) ||
      step.position !== i + 1 ||
      !ids.has(step.image_id) ||
      used.has(step.image_id) ||
      !str(step.note, 2000) ||
      !Array.isArray(step.observations) ||
      step.observations.length > 32
    )
      fail();
    stepids.add(step.id);
    used.add(step.image_id);
    for (const obs of step.observations) {
      if (
        !objectKeys(obs, ["id", "label", "box"]) ||
        !id(obs.id) ||
        observations.has(obs.id) ||
        !str(obs.label, 200) ||
        !Array.isArray(obs.box) ||
        obs.box.length !== 4 ||
        obs.box.some(
          (n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1,
        ) ||
        obs.box[0] >= obs.box[2] ||
        obs.box[1] >= obs.box[3]
      )
        fail();
      observations.add(obs.id);
    }
  }
  return data;
}
function resetQuery() {
  query = null;
  renderQuery();
}
$("import").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (busy) return;
  if (file.size > 40 * 1024 * 1024) {
    notify("That backup is too large (maximum 40 MB).");
    return;
  }
  setBusy(true);
  try {
    const data = await validateWorkspace(JSON.parse(await file.text()));
    if (
      session.steps.length &&
      !confirm(
        "Replace this workspace with the imported one? Export first if you want to keep it.",
      )
    )
      return;
    session = data.session;
    images = data.images;
    active = 0;
    reverse = false;
    marking = false;
    $("camera-compare").checked = false;
    resetQuery();
    changed();
    notify("Backup restored. Photos and marked regions are ready.");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
    render();
  }
};
$("new").onclick = () => {
  if (busy) return;
  if (
    session.steps.length &&
    !confirm("Start a new object? Export first to keep this workspace.")
  )
    return;
  session = blank();
  images = {};
  active = 0;
  reverse = false;
  marking = false;
  $("camera-compare").checked = false;
  resetQuery();
  changed();
  notify("New workspace ready.");
};
async function boot() {
  setBusy(true);
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("reversesteps-visual-memory", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const saved = await new Promise((resolve, reject) => {
      const r = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (saved) {
      try {
        const data = await validateWorkspace(saved);
        session = data.session;
        images = data.images;
      } catch {
        recoveryRecord = saved;
        storageBlocked = true;
        $("export-recovery").hidden = false;
        await new Promise((resolve, reject) => {
          const tx = db.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(
            saved,
            `recovery-${Date.now()}-${crypto.randomUUID()}`,
          );
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        storageBlocked = false;
        notify(
          "Your previous workspace could not be opened. A recovery copy was preserved. Use Recover backup to download it; new work can be saved safely.",
        );
      }
    }
    if (!recoveryRecord) {
      const recoveryKeys = await new Promise((resolve, reject) => {
        const request = db
          .transaction("workspace")
          .objectStore("workspace")
          .getAllKeys();
        request.onsuccess = () =>
          resolve(
            request.result
              .filter(
                (key) => typeof key === "string" && key.startsWith("recovery-"),
              )
              .sort(),
          );
        request.onerror = () => reject(request.error);
      });
      if (recoveryKeys.length) {
        recoveryRecord = await new Promise((resolve, reject) => {
          const request = db
            .transaction("workspace")
            .objectStore("workspace")
            .get(recoveryKeys[recoveryKeys.length - 1]);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        $("export-recovery").hidden = false;
      }
    }
    $("save-state").textContent = recoveryRecord
      ? "Recovery copy preserved"
      : "Saved on this device";
  } catch {
    storageBlocked = true;
    notify(
      "Could not restore local storage. Existing data will not be overwritten. Use Export to keep any new work; Recover backup downloads the original if available.",
    );
    $("save-state").textContent = "Use Export to keep your work";
  }
  render();
  await status();
  setBusy(false);
}
$("export-recovery").onclick = () => {
  if (!recoveryRecord) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(recoveryRecord)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "reversesteps-recovery.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("focus", status);
window.addEventListener("beforeunload", (event) => {
  if (busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
initializeCamera();
boot();
