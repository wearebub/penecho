"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

const historySource = fs.readFileSync(path.join(__dirname, "../src/client/app/tenet-document-history.js"), "utf8");
const persistenceSource = fs.readFileSync(path.join(__dirname, "../src/client/app/persistence.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

// Reuse the existing behavioral fixtures, WITHOUT importing/registering their
// tests. Only browser/native/IndexedDB host services are simulated. The full
// document-history engine, native receive handler, save transaction and Teacher
// renderer below are the actual source implementations, not sample histories.
function fixture(filename, names, extend = source => source) {
  const file = path.join(__dirname, filename), source = fs.readFileSync(file, "utf8");
  const end = source.search(/\r?\ntest\(/);
  assert.ok(end > 0, `${filename}: fixture must end before test registration`);
  let prefix = source.slice(0, end)
    .replace(/^import (\{[^\n]+\}|\w+) from "([^"]+)";\r?$/gm, "const $1 = require(\"$2\");")
    .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(file).href));
  prefix = extend(prefix);
  return new Function("require", "__dirname", `${prefix}\nreturn {${names.join(",")}};`)(require, __dirname);
}
const { harness: nativeHarness } = fixture("tenet-native-teacher-preview.test.js", ["harness"]);
const { boot: teacherUI } = fixture("tenet-process-ui.test.js", ["boot"]);
const { memoryIndexedDB } = fixture("tenet-process-journal.test.js", ["memoryIndexedDB"], source => {
  const marker = "const database = {";
  assert.equal(source.split(marker).length, 2);
  // The notebook upgrader additionally uses this standard IndexedDB property.
  return source.replace(marker, marker + "\nobjectStoreNames:{contains:name => stores.has(name)},")
    .replace("nextFailure = Error(message)", "nextFailure = Object.assign(Error(message), {name:message})");
});

function persistenceFunction(name) {
  const declarations = [...persistenceSource.matchAll(/^  (?:async )?function (\w+)\(/gm)];
  const index = declarations.findIndex(match => match[1] === name);
  assert.ok(index >= 0, `Real persistence function ${name} must exist`);
  return persistenceSource.slice(declarations[index].index, declarations[index + 1]?.index ?? persistenceSource.length);
}
const realPersistence = ["snapshotDb", "requestResult", "transactionDone", "canvasBlob", "allSnapshots",
  "saveDeviceSnapshot", "readDeviceSnapshot", "snapshotName", "finalizeCanvasForSnapshot", "snapshotPreviewBlob",
  "exportRegion", "renderExportCanvas", "save", "saveSnapshot"].map(persistenceFunction).join("\n");

function raster(contents, framed = false) {
  const canvas = { width:320, height:180, contents,
    getContext:() => context,
    toBlob(callback, mime = "image/png") {
      // The Teacher fixture owns simulated decode(). Supply its bounded PNG
      // header contract while retaining observable scene markers. This is not
      // a browser-codec or pixel-fidelity qualification; tiles remain unchanged.
      const parts = [];
      if (framed && mime === "image/png") {
        const header = Buffer.alloc(33);
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
        header.writeUInt32BE(13, 8); header.write("IHDR", 12);
        header.writeUInt32BE(canvas.width, 16); header.writeUInt32BE(canvas.height, 20);
        parts.push(header);
      }
      parts.push(canvas.contents);
      queueMicrotask(() => callback(new Blob(parts, { type:mime })));
    } };
  const context = { fillRect() {}, save() {}, restore() {}, setTransform() {},
    drawImage(image) { canvas.contents += image.contents || "native-preview-fixture"; } };
  return canvas;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function boot(indexedDB = memoryIndexedDB(), { settledNative = true } = {}) {
  const h = await nativeHarness({ readOnly:true }), c = h.context, state = h.state;
  const noop = () => {}, timers = new Map();
  let nextTimer = 0;
  const name = h.document.createElement("input"); name.id = "historyName"; name.value = "";
  h.document.body.append(name);
  h.document.querySelector = selector => h.document.body.querySelector(selector);
  Object.assign(state, { snapshotLocation:"device", currentSnapshotLocation:null, currentSnapshotId:null,
    snapshotLoadGeneration:0, snapshotSavedRevision:0, historyBefore:new Map(), inkBounds:new Map(),
    animations:[], preservedSnapshotAnimations:[], images:[], textBoxes:[], textEditors:new Map(),
    drawing:false, animationHistoryBefore:null, widgetHistoryBefore:null, imageHistoryBefore:null,
    textBoxHistoryBefore:null, language:"en", theme:"light", paint:{ paper:"#fff" },
    currentSnapshotBundleExtensions:{}, currentSnapshotPreservedAssets:[] });
  Object.defineProperty(h.window, "TenetProcessCapture", { value:undefined, writable:true, configurable:true });
  Object.assign(c, { Blob, TextEncoder, Uint8Array, atob, crypto:webcrypto, indexedDB,
    snapshotDbPromise:null, SNAPSHOT_DB:"notebook-integration", SNAPSHOT_STORE:"snapshots",
    SNAPSHOT_TILE_STORE:"snapshotTiles", SNAPSHOT_LOCATIONS:new Set(["device", "server", "cloud"]),
    snapshotItems:[], tiles:new Map(), TILE:256, canvasSnapshotFinalizationDepth:0,
    EXPORT_MAX_DIMENSION:16384, EXPORT_MAX_PIXELS:64 * 1024 * 1024, CANVAS_DOWNLOAD_RESOLUTION_SCALE:1, performance,
    setTimeout:(callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout:id => timers.delete(id),
    hasUnsettledToolbox:() => false, selectionAIBusy:() => false,
    pluginEnabled:() => false, visibleWidgets:() => [],
    serializedAnimations:() => [], serializedWidgets:() => [], storedTextBoxes:() => [], storedImages:() => [],
    snapshotPreservedAssets:value => value || [],
    prepareVisibleWidgetSnapshots:async () => {}, finishAIDraftHandMode:noop,
    canvasAgentCanvasDidPersist:noop, setStatusKey:noop,
    snapshotPreview:() => raster(JSON.stringify({ fixtureRaster:true, native:h.controller.snapshot(), web:[...c.tiles].map(([key, canvas]) => [key, canvas.contents]) })),
    cloneCanvas:canvas => canvas ? raster(canvas.contents) : null,
    saveServerSnapshot:() => assert.fail("This integration must never save student work to a server"),
    saveCloudSnapshot:() => assert.fail("This integration must never save student work to the cloud"),
    fetch:() => assert.fail("No provider or upload requests are part of this local regression"),
    exportInkBounds:() => c.tiles.size ? { x:0, y:0, w:256, h:256 } : h.controller.snapshot()?.bounds || null,
    offscreen:(width, height) => Object.assign(raster("", true), { width, height }),
    drawCanvasLineGrid:noop, drawAnimationsToContext:noop, drawWidgetsToContext:noop,
    drawImagesToContext:noop, drawTextBoxesToContext:noop, drawSharpOverlays:context => h.controller.draw(context),
    refreshSnapshots:async () => { c.snapshotItems = await vm.runInContext("allSnapshots()", c); },
  });
  vm.runInContext(realPersistence, c, { filename:"actual-notebook-persistence.js" });
  // Establish the native plugin's accepted empty archive before measuring a
  // settled-page baseline. A first-ever null -> empty native acknowledgement
  // changes the revision stamp and intentionally cannot be called that baseline.
  if (settledNative) await h.controller.flush();
  vm.runInContext(historySource, c, { filename:"tenet-document-history.js" });
  const api = h.window.TenetDocumentHistory, capture = h.window.TenetProcessCapture;
  assert.equal(typeof api.beginSave, "function"); assert.equal(typeof capture.nativeRevision, "function");
  await api.flush();
  return { ...h, indexedDB, timers, history:api, capture,
    readStored:id => c.readDeviceSnapshot(id),
    savePage:options => c.saveSnapshot({ name:"Observed algebra work", location:"device", ...options }),
    webEdit(contents = "web-ink-before-AI") {
      const before = c.tiles.get("0,0") || null;
      state.historyBefore.set("0,0", before);
      c.tiles.set("0,0", raster(contents)); state.inkBounds.set("0,0", { x:0, y:0, w:100, h:60 });
      state.userRevision++;
      return vm.runInContext("save()", c);
    },
    dispose() { h.window.dispatchEvent(new Event("pagehide")); timers.clear(); },
  };
}
function observeAI(h, question = "What should I try next?", reply = "Which operation would undo adding six?") {
  const packed = { questionOnly:true, selectionQuestion:question };
  const token = h.capture.aiRequested({ action:"hint", automatic:false, revision:h.state.userRevision,
    captureCurrentViewport:false, packed, voice:false,
    requestBody:JSON.stringify({ ...packed, userAction:"hint", trigger:"manual" }) });
  assert.ok(token, "The real ordinary-session observer must accept the request");
  h.capture.aiResponse(token, { commands:[{ tool:"write_text", text:reply }], requestId:"local-fixture-request" });
  h.capture.aiFinished(token, "completed");
  return { question, reply };
}
const options = { timeout:15000 };

test("observed web/native/AI work saves atomically, survives a new runtime and opens as real Teacher history", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit(); await h.history.flush();
  await h.api.setEngine("pencilkit"); await h.addStroke(); await h.history.flush();
  const ai = observeAI(h), drawing = plain(h.controller.snapshot());
  assert.equal(h.history.isDirty(), true);
  const saveStart = h.calls.length, id = await h.savePage();
  assert.ok(id); assert.equal(h.history.currentSavedPageId(), id); assert.equal(h.history.isDirty(), false);
  assert.ok(h.calls.slice(saveStart).some(call => call.kind === "flush"), "Actual saveSnapshot must flush native ink before persistence");
  const stored = await h.readStored(id);
  assert.equal(stored.item.id, id); assert.equal(stored.tileEntries.length, 1);
  assert.equal(await stored.tileEntries[0].blob.text(), "web-ink-before-AI");
  const expected = ["canvas.commit", "native.revision", "ai.request", "ai.response", "ai.finished"];
  const types = stored.item.workHistory.events.map(event => event.type);
  let last = -1;
  for (const type of expected) { const index = types.indexOf(type); assert.ok(index > last, `${type} must preserve observed order`); last = index; }
  const nativeEvent = stored.item.workHistory.events.find(event => event.type === "native.revision");
  assert.equal(nativeEvent.details.strokeCount, 1);
  assert.equal(nativeEvent.details.granularity, "accepted-PKDrawing-revision-not-individual-stroke");
  assert.equal(nativeEvent.details.serverVerified, false);
  for (const label of ["committed-edit", "native-revision"]) {
    const checkpoint = stored.item.workHistory.events.find(event => event.type === "canvas.checkpoint" && event.details.label === label);
    assert.ok(checkpoint, `Actual renderer must produce a post-edit ${label} checkpoint, not only a saved thumbnail`);
    assert.equal(checkpoint.details.representation, "coalesced-rendered-page");
    assert.ok(checkpoint.assets.some(asset => asset.mime === "image/png"));
  }
  assert.equal(types.includes("coverage.gap"), false, "Ordinary settled edits must not silently degrade into renderer gaps: " + JSON.stringify(stored.item.workHistory.events.filter(event => event.type === "coverage.gap")));
  const fullCheckpoint = stored.item.workHistory.events.filter(event => event.type === "canvas.checkpoint" && event.assets.some(asset => asset.mime === "image/png")).at(-1);
  assert.equal(fullCheckpoint.details.representation, "coalesced-rendered-page");
  assert.equal(stored.item.workHistory.events.some(event => event.details.representation === "saved-page-thumbnail"), false,
    "A retained, current full checkpoint must not be replaced by a lower-resolution save thumbnail");

  // The actual modal entry reads this saved page, never loading it onto scratch.
  const session = h.latest().sessionId, editCount = h.state.history.length;
  assert.equal(await h.window.TenetProcessUI.openSavedPage(id), true); await h.settle();
  assert.equal(h.latest().inputEnabled, false); assert.equal(h.latest().visible, false);
  assert.equal(h.previewState().selected.id, id);
  assert.deepEqual(h.previewState().events, stored.item.workHistory.events);
  h.close.click(); await h.settle();
  assert.equal(h.latest().inputEnabled, true); assert.equal(h.latest().sessionId, session);
  assert.deepEqual(plain(h.controller.snapshot()), drawing); assert.equal(h.state.history.length, editCount);

  // A completely fresh engine must recover from IndexedDB, not old in-memory events.
  const reloaded = await boot(h.indexedDB); t.after(() => reloaded.dispose());
  assert.equal(reloaded.history.hasWork(), false);
  const rows = await reloaded.history.listSavedPages();
  assert.equal(rows.length, 1); assert.equal(rows[0].id, id); assert.equal(rows[0].hasHistory, true);
  const record = await reloaded.history.readSavedPage(id);
  assert.equal(record.historyAvailable, true); assert.deepEqual(plain(record.events), stored.item.workHistory.events);
  const nativeAttachment = record.events.flatMap(event => event.assets).findLast(asset => asset.name === "drawing.pkdrawing");
  assert.ok(nativeAttachment);
  assert.equal(await (await record.getAsset(id, nativeAttachment.hash)).text(), "stroke");
  await assert.rejects(record.getAsset("another-page", nativeAttachment.hash), /different saved page/);

  const ui = teacherUI({ config:{ tenetAssignmentPreview:false, tenetHistoryViewerOnly:false }, documentHistory:reloaded.history });
  t.after(() => ui.dialog.close());
  assert.equal(await ui.win.TenetProcessUI.openSavedPage(id), true);
  assert.equal(ui.value("title").textContent, "Observed algebra work");
  assert.equal(ui.value("badge").textContent, "SAVED WHITEBOARD / ON DEVICE");
  assert.equal(ui.value("question").textContent, ai.question);
  assert.equal(ui.value("response").textContent, ai.reply);
  assert.equal(ui.value("requests").textContent, "1");
  assert.doesNotMatch(ui.value("detail").textContent, /Invalid Date/);
  const checkpoint = record.events.flatMap(event => event.assets).findLast(asset => asset.mime === "image/png");
  const displayed = ui.urls.get(ui.dialog.querySelector("img")?.getAttribute("src"));
  assert.ok(displayed instanceof Blob, "Teacher view must select the nearest full checkpoint even when the last event is AI lifecycle metadata");
  assert.equal(displayed.type, "image/png");
  assert.equal(await displayed.text(), await (await record.getAsset(id, checkpoint.hash)).text());
  assert.equal(ui.calls.canvases, 0, "Opening saved work must not generate the fictional sample");
  assert.equal(ui.calls.archive, 0); assert.equal(ui.calls.begin, 0); assert.equal(ui.calls.list, 0);
  ui.dialog.close(); assert.equal(ui.urls.size, 0);
  assert.equal(ui.value("question").textContent, ""); assert.equal(ui.value("response").textContent, "");
});

test("AI-only changes remain saveable and persist on overwrite without a new drawing revision", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  observeAI(h, "Help me start problem 12", "What information does the problem give you?");
  const revision = h.state.userRevision, id = await h.savePage();
  assert.ok(id, "A text-only question on blank paper still has real work history");
  assert.equal(h.history.isDirty(), false);
  observeAI(h, "What should I identify first?", "Which quantity are you trying to find?");
  assert.equal(h.state.userRevision, revision); assert.equal(h.history.isDirty(), true);
  assert.equal(await h.savePage({ overwriteId:id }), id); assert.equal(h.history.isDirty(), false);
  const fresh = await boot(h.indexedDB); t.after(() => fresh.dispose());
  const record = await fresh.history.readSavedPage(id);
  assert.deepEqual(plain(record.events.filter(event => event.type === "ai.request").map(event => event.details.question)),
    ["Help me start problem 12", "What should I identify first?"]);
  assert.equal(record.events.filter(event => event.type === "ai.finished").length, 2);
});

test("save captures a fresh full frame when the last edit has not reached the coalescing timer", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("old-full-frame"); await h.history.flush();
  h.webEdit("latest-uncheckpointed-edit");
  const id = await h.savePage(), stored = await h.readStored(id);
  const checkpoint = stored.item.workHistory.events.filter(event => event.type === "canvas.checkpoint").at(-1);
  assert.equal(checkpoint.details.label, "saved-end-state");
  assert.equal(checkpoint.details.representation, "coalesced-rendered-page");
  const image = checkpoint.assets.find(asset => asset.mime === "image/png");
  assert.ok(image, "The final saved revision must have a full PNG, not only a thumbnail");
  const reader = await h.history.readSavedPage(id);
  const frame = await reader.getAsset(id, image.hash);
  assert.match(await frame.text(), /latest-uncheckpointed-edit/);
  assert.doesNotMatch(await frame.text(), /old-full-frame/);
  assert.equal(stored.item.workHistory.events.some(event => event.details.representation === "saved-page-thumbnail"), false);
  const ui = teacherUI({ config:{ tenetAssignmentPreview:false, tenetHistoryViewerOnly:false }, documentHistory:h.history });
  t.after(() => ui.dialog.close());
  assert.equal(await ui.win.TenetProcessUI.openSavedPage(id), true);
  assert.equal(await ui.urls.get(ui.dialog.querySelector("img")?.getAttribute("src")).text(), await frame.text());
});

test("a mutation during final full-frame encoding refuses the pinned save rather than widening its revision", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("before-final-pin");
  const entered = deferred(), encoding = deferred(), offscreen = h.context.offscreen;
  h.context.offscreen = (width, height) => {
    const canvas = offscreen(width, height), encode = canvas.toBlob.bind(canvas);
    canvas.toBlob = (callback, mime) => { entered.resolve(); void encoding.promise.then(() => encode(callback, mime)); };
    return canvas;
  };
  const saving = h.savePage(); await entered.promise;
  h.webEdit("after-final-pin");
  encoding.resolve();
  assert.equal(await saving, null);
  assert.deepEqual(plain(await h.history.listSavedPages()), []);
  assert.equal(h.state.currentSnapshotId, null);
  assert.equal(h.history.isDirty(), true, "The newer edit must remain unsaved, not falsely acknowledged");
});

test("a cold native acknowledgement records the unavailable initial baseline rather than silently re-stamping it", options, async t => {
  const h = await boot(memoryIndexedDB(), { settledNative:false }); t.after(() => h.dispose());
  h.webEdit(); await h.history.flush();
  const id = await h.savePage(), stored = await h.readStored(id), events = stored.item.workHistory.events;
  const gaps = events.filter(event => event.type === "coverage.gap");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].details.label, "initial-baseline");
  assert.equal(gaps[0].details.requestedRevision, 0);
  assert.equal(events.some(event => event.type === "canvas.checkpoint" && event.details.label === "initial-baseline"), false);
  assert.equal(events.some(event => event.type === "native.revision"), false, "An initial empty archive acknowledgement is not a student edit");
  assert.ok(events.some(event => event.type === "canvas.checkpoint" && event.details.label === "committed-edit"));
  assert.equal(stored.item.workHistory.incomplete, true);
});

test("an aborted notebook transaction preserves both prior tiles and prior history, then a successful retry saves both", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("original-ink"); const id = await h.savePage();
  const before = await h.readStored(id);
  h.webEdit("revised-ink"); observeAI(h);
  h.indexedDB.failNextWrite("Injected transaction abort");
  await assert.rejects(h.savePage({ overwriteId:id }), /Injected transaction abort/);
  const unchanged = await h.readStored(id);
  assert.equal(await unchanged.tileEntries[0].blob.text(), "original-ink");
  assert.deepEqual(unchanged.item.workHistory.events, before.item.workHistory.events);
  assert.equal(h.history.isDirty(), true, "Failed persistence must not acknowledge the new history");
  assert.equal(await h.savePage({ overwriteId:id }), id);
  const after = await h.readStored(id);
  assert.equal(await after.tileEntries[0].blob.text(), "revised-ink");
  assert.equal(after.item.workHistory.events.filter(event => event.type === "ai.request").length, 1);
  assert.equal(h.history.isDirty(), false);
});

test("failed native flush cannot commit a snapshot or acknowledge history", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  await h.api.setEngine("pencilkit"); await h.addStroke();
  h.window.Capacitor.Plugins.TenetNative.flushInkSurface = async () => { throw Error("Native flush fixture failure"); };
  await assert.rejects(h.savePage(), /Native flush fixture failure/);
  assert.deepEqual(plain(await h.history.listSavedPages()), []);
  assert.equal(h.history.isDirty(), true); assert.equal(h.state.currentSnapshotId, null);
});

test("actual export renderer failure is recorded as a coverage gap without fabricating a successful checkpoint", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.context.drawWidgetsToContext = () => { throw Error("Injected render dependency failure"); };
  h.webEdit(); await h.history.flush();
  const id = await h.savePage(), stored = await h.readStored(id);
  assert.equal(stored.item.workHistory.events.some(event => event.type === "canvas.checkpoint" && event.details.label === "committed-edit"), false);
  assert.ok(stored.item.workHistory.events.some(event => event.type === "coverage.gap" && event.details.reason === "checkpoint-render-or-revision-gap"));
  assert.equal(await stored.tileEntries[0].blob.text(), "web-ink-before-AI");
  assert.equal(stored.item.workHistory.incomplete, true);
});

test("navigation during snapshot encoding refuses the stale save and late AI response cannot enter the replacement page", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit();
  const token = h.capture.aiRequested({ action:"hint", packed:{ selectionQuestion:"Old page question" } });
  const encoding = deferred(), entered = deferred();
  h.context.snapshotPreview = () => ({ width:320, height:180, toBlob(callback) {
    entered.resolve(); void encoding.promise.then(() => callback(new Blob(["old-page-preview"], { type:"image/webp" })));
  } });
  const saving = h.savePage(); await entered.promise;
  h.capture.boundary("page-load-start"); h.state.snapshotLoadGeneration++;
  h.history.restore(null);
  h.capture.aiResponse(token, { commands:[{ tool:"write_text", text:"Old reply must not follow navigation" }] });
  h.capture.aiFinished(token, "completed");
  encoding.resolve(); assert.equal(await saving, null);
  assert.deepEqual(plain(await h.history.listSavedPages()), []);
  assert.equal(h.state.currentSnapshotId, null); assert.equal(h.history.hasWork(), false);
});

test("actual local transaction preserves submitted JSON and crop hashes across overwrite and fresh runtime", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("worksheet-before-request");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const packed = { atlasImage:"data:image/png;base64," + image.toString("base64"),
    sourceRect:{ x:17, y:23, w:41, h:59 }, atlasSize:{ w:1, h:1 }, selectionQuestion:"Why this step?",
    selectionContext:{ closed:true, path:[{ x:17, y:23 }, { x:58, y:23 }, { x:58, y:82 }] } };
  const body = JSON.stringify({ ...packed, trigger:"manual", userAction:"hint", reasoningEffort:"medium",
    canvasSize:{ w:20000, h:20000 }, uiTheme:"studio", persona:"Fixture client persona", plugins:["graph"] });
  const token = h.capture.aiRequested({ action:"hint", automatic:false, voice:true,
    revision:h.state.userRevision, packed, requestBody:body });
  h.capture.aiResponse(token, { commands:[{ tool:"write_text", text:"Which value changes?" }] });
  h.capture.aiFinished(token, "completed");
  const id = await h.savePage();
  assert.ok(id); assert.equal(h.history.isDirty(), false);
  const fresh = await boot(h.indexedDB); t.after(() => fresh.dispose());
  const record = await fresh.history.readSavedPage(id);
  const request = record.events.find(event => event.type === "ai.request");
  const input = record.events.find(event => event.type === "ai.input");
  assert.equal(request.details.origin, "voice-question");
  assert.equal(input.details.localRequestId, request.details.localRequestId);
  assert.equal(input.details.bodyExact, true); assert.equal(input.details.gatewayProviderPromptObserved, false);
  assert.equal(input.assets.length, 2);
  const json = input.assets.find(asset => asset.name === "ai-input.json");
  const crop = input.assets.find(asset => asset.name === "ai-input.png");
  assert.equal(await (await record.getAsset(id, json.hash)).text(), body);
  assert.deepEqual(Buffer.from(await (await record.getAsset(id, crop.hash)).arrayBuffer()), image);
  for (const asset of input.assets) {
    const blob = await record.getAsset(id, asset.hash);
    assert.equal(Buffer.from(await webcrypto.subtle.digest("SHA-256", await blob.arrayBuffer())).toString("hex"), asset.hash);
  }
  assert.equal(record.events.filter(event => event.type === "canvas.checkpoint").some(event =>
    event.assets.some(asset => asset.name.startsWith("ai-input."))), false);
  const stored = await h.readStored(id);
  assert.equal(await stored.tileEntries[0].blob.text(), "worksheet-before-request");
  fresh.state.currentSnapshotId = id; fresh.state.currentSnapshotLocation = "device";
  fresh.history.restore(stored.item);
  fresh.webEdit("worksheet-after-reopen");
  assert.equal(await fresh.savePage({ overwriteId:id }), id);
  const after = await fresh.history.readSavedPage(id);
  assert.equal(await (await after.getAsset(id, json.hash)).text(), body);
  assert.equal(after.events.filter(event => event.type === "ai.input").length, 1);
});

test("repeated overwrites then reopen/save preserve every earlier event and attachment", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("first-work"); observeAI(h, "First question", "First hint");
  await h.api.setEngine("pencilkit"); await h.addStroke(); await h.history.flush();
  const id = await h.savePage(), first = await h.readStored(id);
  for (let round = 0; round < 3; round++) {
    h.webEdit("later-work-" + round); observeAI(h, "Follow-up " + round, "Next hint " + round);
    assert.equal(await h.savePage({overwriteId:id}), id);
    const current = await h.readStored(id);
    assert.deepEqual(current.item.workHistory.events.slice(0, first.item.workHistory.events.length), first.item.workHistory.events);
    assert.equal((await h.history.listSavedPages()).length, 1);
  }
  const before = await h.readStored(id), fresh = await boot(h.indexedDB); t.after(() => fresh.dispose());
  fresh.state.currentSnapshotId = id; fresh.state.currentSnapshotLocation = "device";
  fresh.history.restore(before.item); fresh.webEdit("after-app-reopen");
  assert.equal(await fresh.savePage({overwriteId:id}), id);
  const final = await fresh.readStored(id), reader = await fresh.history.readSavedPage(id);
  assert.deepEqual(final.item.workHistory.events.slice(0, before.item.workHistory.events.length), before.item.workHistory.events);
  for (const asset of before.item.workHistory.assets)
    assert.deepEqual(await (await reader.getAsset(id, asset.hash)).arrayBuffer(), await asset.blob.arrayBuffer());
  assert.equal(reader.events.filter(event => event.type === "ai.request").length, 4);
  assert.equal(await final.tileEntries[0].blob.text(), "after-app-reopen");
});

for (const failure of ["QuotaExceededError", "DataCloneError"]) {
  test(failure + " preserves the last complete page/replay and a retry keeps both sessions", options, async t => {
    const h = await boot(); t.after(() => h.dispose());
    h.webEdit("saved-work"); observeAI(h);
    const id = await h.savePage(), before = await h.readStored(id), savedRevision = h.state.snapshotSavedRevision;
    h.webEdit("new-unsaved-work"); observeAI(h, "Later question", "Later hint");
    h.indexedDB.failNextWrite(failure);
    await assert.rejects(h.savePage({overwriteId:id}), /previous saved page is unchanged/);
    const failed = await h.readStored(id);
    assert.deepEqual(failed.item, before.item); assert.deepEqual(failed.tileEntries, before.tileEntries);
    assert.equal(h.state.snapshotSavedRevision, savedRevision); assert.equal(h.history.isDirty(), true);
    assert.equal(await h.savePage({overwriteId:id}), id);
    const after = await h.readStored(id);
    assert.deepEqual(after.item.workHistory.events.slice(0,before.item.workHistory.events.length), before.item.workHistory.events);
    assert.equal(after.item.workHistory.events.filter(event => event.type === "ai.request").length, 2);
    assert.equal(await after.tileEntries[0].blob.text(), "new-unsaved-work");
    assert.equal(h.history.isDirty(), false);
  });
}

test("missing or reset history cannot replace the durable page or its tiles", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("durable-work"); const id = await h.savePage(), before = await h.readStored(id);
  const without = {...before.item}; delete without.workHistory;
  await assert.rejects(h.context.saveDeviceSnapshot(without, [], id), /protect earlier replay/);
  h.history.restore(null); h.webEdit("reset-session-work");
  await assert.rejects(h.savePage({overwriteId:id}), /protect earlier replay/);
  const after = await h.readStored(id);
  assert.deepEqual(after.item, before.item); assert.deepEqual(after.tileEntries, before.tileEntries);
  assert.equal(h.history.isDirty(), true);
});

test("unavailable live capture refuses save without erasing the existing replay", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("saved"); const id = await h.savePage(), before = await h.readStored(id);
  h.capture.boundary("backgrounded");
  await assert.rejects(h.savePage({overwriteId:id}), /Replay history is not ready/);
  assert.deepEqual(await h.readStored(id), before);
});

test("two writers cannot overwrite a newer durable history from the same stale baseline", options, async t => {
  const left = await boot(); t.after(() => left.dispose());
  left.webEdit("baseline"); const id = await left.savePage(), baseline = await left.readStored(id);
  const right = await boot(left.indexedDB); t.after(() => right.dispose());
  right.state.currentSnapshotId = id; right.state.currentSnapshotLocation = "device"; right.history.restore(baseline.item);
  left.webEdit("left-writer"); right.webEdit("right-writer");
  const results = await Promise.allSettled([left.savePage({overwriteId:id}), right.savePage({overwriteId:id})]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.match(results.find(result => result.status === "rejected").reason.message, /protect earlier replay/);
  const winner = results[0].status === "fulfilled" ? "left-writer" : "right-writer";
  const after = await left.readStored(id);
  assert.equal(await after.tileEntries[0].blob.text(), winner);
  assert.deepEqual(after.item.workHistory.events.slice(0,baseline.item.workHistory.events.length), baseline.item.workHistory.events);
});

test("legacy history-free pages can acquire new history without changing their identity", options, async t => {
  const h = await boot(); t.after(() => h.dispose());
  h.webEdit("legacy"); const id = await h.savePage();
  h.indexedDB.seed("snapshots", id, item => { delete item.workHistory; return item; });
  const legacy = await h.readStored(id); h.history.restore(legacy.item); h.webEdit("new-observed-work");
  assert.equal(await h.savePage({overwriteId:id}), id);
  assert.equal((await h.history.listSavedPages()).length, 1);
  const after = await h.readStored(id);
  assert.ok(after.item.workHistory.events.some(event => event.details.reason === "history-unavailable-before-this-open"));
  assert.equal(after.item.workHistory.events.filter(event => event.type === "canvas.commit").length, 1);
});
