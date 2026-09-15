"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/tenet-document-history.js"), "utf8");
const persistence = fs.readFileSync(path.join(__dirname, "../src/client/app/persistence.js"), "utf8");
const aiSource = fs.readFileSync(path.join(__dirname, "../src/client/app/ai-runtime.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
const options = { timeout:5000 };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function target() {
  const listeners = new Map();
  return { listeners,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); return true; } };
}
class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
function harness(settings = {}) {
  const pages = settings.pages || new Map(), timers = new Map(), reads = [], rendered = [], statuses = [];
  const controls = { native:null, nativeBusy:false, onRender:null, onRead:null, ...settings.controls };
  let timerId = 0;
  const window = { ...target(), PENECHO_CONFIG:settings.config || { tenetMode:true },
    TenetProcessCapture:settings.legacy,
    TenetProcessJournal:new Proxy({}, { get() { assert.fail("No global process journal access"); } }) };
  const document = { ...target(), hidden:false };
  const state = { snapshotLoadGeneration:1, currentSnapshotId:null, currentSnapshotLocation:null,
    snapshotLocation:"device", userRevision:0, historyBefore:new Map(), tenetNativeHistoryBefore:undefined,
    drawing:null, areaEraseGesture:null, ...settings.state };
  window.addEventListener("tenet:document-history-status", event => statuses.push(plain(event.detail)));
  const context = vm.createContext({ window, document, state, Blob, Uint8Array, TextEncoder, atob, crypto:webcrypto, CustomEvent,
    snapshotLoadInProgress:false, hasUnsettledToolbox:() => false,
    tenetInkController:{ snapshot:() => controls.native, active:() => controls.nativeBusy },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async renderExportCanvas(config) {
      assert.equal(config.maxDimension, 2048); assert.equal(config.maxPixels, 4 * 1024 * 1024);
      assert.ok(config.isCurrent());
      const observed = { pageId:state.currentSnapshotId, revision:state.userRevision };
      if (controls.onRender) await controls.onRender(config);
      if (!config.isCurrent()) throw Error("Stale renderer");
      rendered.push(observed);
      return { width:640, height:426, ...observed };
    },
    async canvasBlob(canvas) { return new Blob([JSON.stringify({ id:canvas.pageId, revision:canvas.revision })], { type:"image/png" }); },
    async allSnapshots() { reads.push("list"); return Array.from(pages.values(), value => structuredClone(value)); },
    async readDeviceSnapshot(id) {
      reads.push(id); if (controls.onRead) await controls.onRead();
      return pages.has(id) ? { item:structuredClone(pages.get(id)), tileEntries:[] } : null;
    },
    fetch() { assert.fail("No history network requests"); }, indexedDB:{ open() { assert.fail("No new history database"); } },
  });
  vm.runInContext(source, context, { filename:"tenet-document-history.js" });
  const api = window.TenetDocumentHistory, capture = window.TenetProcessCapture;
  return { api, capture, window, document, state, controls, context, pages, reads, rendered, timers, statuses,
    async prepare(id = "page-a") {
      const token = api.beginSave("device"); api.pinSave(token);
      const item = { id, name:"Math notebook", createdAt:100, updatedAt:200,
        preview:new Blob(["saved page thumbnail"], { type:"image/webp" }) };
      item.workHistory = await api.serializeForSave(token, item, state.userRevision);
      return { token, item };
    },
    commitPrepared({ token, item }) {
      pages.set(item.id, structuredClone(item));
      capture.boundary("saved-page-identity-changed"); state.currentSnapshotId = item.id; state.currentSnapshotLocation = "device";
      api.didSave(token, item.id);
    },
    signal:type => window.dispatchEvent(new CustomEvent(type)),
  };
}
function edit(h, entry = { tiles:[{}] }) { h.state.userRevision++; h.capture.commit(entry); }

test("automatic history installs only for ordinary Tenet, never enables the legacy assignment preview", options, () => {
  for (const config of [{}, { tenetMode:false }, { tenetMode:true, tenetAssignmentPreview:true }, { tenetMode:true, runtime:"viewer" }]) {
    const legacy = {}; const h = harness({ config, legacy });
    assert.equal(h.api, undefined); assert.equal(h.capture, legacy); assert.equal(h.timers.size, 0); assert.deepEqual(h.reads, []);
  }
  for (const config of [{ tenetMode:true }, { tenetMode:true, tenetAssignmentPreview:false }]) {
    const h = harness({ config });
    assert.ok(h.api); assert.equal(h.api.isDirty(), false); assert.equal(config.tenetAssignmentPreview, h.window.PENECHO_CONFIG.tenetAssignmentPreview);
    assert.equal(h.capture.begin, undefined); assert.deepEqual(h.reads, []);
  }
});

test("normal Web edits, native revisions and AI survive save and a fresh-runtime reopen with verified assets", options, async () => {
  const h = harness(); await h.api.flush();
  edit(h); await h.api.flush();
  h.controls.native = { drawingData:Buffer.from("editable native drawing").toString("base64"), strokeCount:3 };
  h.state.userRevision++; h.capture.nativeRevision({ revision:1, strokeCount:3, changedBounds:{ x:1, y:2, w:3, h:4 } });
  await h.api.flush();
  const token = h.capture.aiRequested({ action:"hint", revision:h.state.userRevision, packed:{ questionOnly:true }, typedInput:{ text:"Help me start problem 12" } });
  h.capture.aiResponse(token, { commands:[{ tool:"write_text", text:"What do you already know?" }, { tool:"draw_image", src:"not retained" }], requestId:"local-observation" });
  h.capture.aiFinished(token, "completed");
  const prepared = await h.prepare(); h.commitPrepared(prepared);
  assert.equal(h.api.isDirty(), false); assert.equal(h.api.currentSavedPageId(), "page-a");
  const reopened = harness({ pages:h.pages, state:{ currentSnapshotId:"page-a", currentSnapshotLocation:"device" } });
  const bundle = await reopened.api.readSavedPage("page-a");
  assert.equal(bundle.historyAvailable, true); assert.equal(bundle.attempt.status, "saved");
  const types = bundle.events.map(event => event.type);
  for (const type of ["canvas.commit", "native.revision", "ai.request", "ai.response", "ai.finished", "canvas.checkpoint"]) assert.ok(types.includes(type));
  assert.equal(bundle.events.find(event => event.type === "ai.request").details.question, "Help me start problem 12");
  const response = bundle.events.find(event => event.type === "ai.response");
  assert.equal(response.details.text, "What do you already know?"); assert.equal(response.details.committedToPage, false);
  const checkpoint = bundle.events.find(event => event.assets.some(asset => asset.name === "drawing.pkdrawing"));
  const archive = checkpoint.assets.find(asset => asset.name === "drawing.pkdrawing");
  assert.equal(await (await bundle.getAsset("page-a", archive.hash)).text(), "editable native drawing");
  await assert.rejects(bundle.getAsset("other-page", archive.hash), /different saved page/);
  const lastSequence = bundle.events.at(-1).sequence;
  reopened.api.restore(h.pages.get("page-a")); edit(reopened);
  const next = await reopened.prepare("page-a");
  assert.ok(next.item.workHistory.events.at(-1).sequence > lastSequence);
  assert.ok(next.item.workHistory.events.some(event => event.details.reason === "reload-or-unobserved-period"));
  assert.equal(next.item.workHistory.events.filter(event => event.type === "ai.request").length, 1);
});

test("first-save identity binding does not stop in-flight AI or discard edits made during storage", options, async () => {
  const h = harness(); edit(h);
  const ai = h.capture.aiRequested({ action:"hint", typedInput:{ text:"A question" } });
  const prepared = await h.prepare();
  edit(h); h.commitPrepared(prepared);
  assert.equal(h.api.isDirty(), true);
  h.capture.aiResponse(ai, { commands:[{ tool:"write_text", text:"A hint" }] }); h.capture.aiFinished(ai, "completed");
  const next = await h.prepare("page-a");
  assert.equal(next.item.workHistory.events.filter(event => event.type === "canvas.commit").length, 2);
  assert.equal(next.item.workHistory.events.filter(event => event.type === "ai.response").length, 1);
  assert.equal(next.item.workHistory.events.at(-1).details.label, "saved-end-state");
});

test("failed saves keep unsaved events and quota fallback explicitly omits history without clearing memory", options, async () => {
  const h = harness(); edit(h);
  const prepared = await h.prepare();
  assert.equal(h.api.isDirty(), true); assert.equal(h.pages.size, 0);
  const originalCount = prepared.item.workHistory.events.length;
  const fallback = h.api.degradeForSave(prepared.token, prepared.item.workHistory);
  assert.equal(fallback.incomplete, true); assert.equal(fallback.assets.length, 0);
  assert.equal(fallback.events[0].type, "coverage.gap");
  assert.equal(fallback.events[0].details.omittedEvents, originalCount);
  h.commitPrepared({ token:prepared.token, item:{ ...prepared.item, workHistory:fallback } });
  assert.equal(h.api.isDirty(), false);
  const retried = await h.prepare("page-a");
  assert.ok(retried.item.workHistory.events.length >= originalCount);
  assert.ok(retried.item.workHistory.events.some(event => event.type === "canvas.commit"));
  assert.ok(h.statuses.some(status => status.incomplete && status.error));
});

test("page transitions fence late render, AI and save callbacks; failed loads retain the previous history", options, async () => {
  const h = harness(); await h.api.flush(); edit(h);
  const prepared = await h.prepare(), ai = h.capture.aiRequested({ action:"hint", typedInput:{ text:"Old page" } });
  const gate = deferred(); h.controls.onRender = () => gate.promise;
  const flushing = h.api.flush();
  h.capture.boundary("new-page-transition"); h.state.snapshotLoadGeneration++; h.state.userRevision++;
  h.state.currentSnapshotId = "page-b"; h.state.currentSnapshotLocation = "device";
  h.api.restore({ id:"page-b" });
  gate.resolve(); await flushing;
  h.controls.onRender = null;
  h.capture.aiResponse(ai, { commands:[{ tool:"write_text", text:"Must not bleed" }] });
  h.api.didSave(prepared.token, "page-a");
  assert.equal(h.api.currentSavedPageId(), "page-b"); assert.equal(h.api.isSaveCurrent(prepared.token), false);
  edit(h);
  h.capture.boundary("snapshot-load-transition"); h.state.snapshotLoadGeneration++;
  h.api.loadFailed(h.state.snapshotLoadGeneration);
  const pageB = await h.prepare("page-b");
  assert.equal(pageB.item.workHistory.events.filter(event => event.type === "canvas.commit").length, 1);
  assert.equal(pageB.item.workHistory.events.some(event => event.type === "ai.response"), false);
  assert.ok(pageB.item.workHistory.events.some(event => event.details.reason === "failed-load-unobserved-period"));
});

test("a checkpoint invalidated by editing reports a gap rather than capturing a newer revision as the old one", options, async () => {
  const h = harness(), gate = deferred(); h.controls.onRender = () => gate.promise;
  const flushing = h.api.flush();
  edit(h); gate.resolve(); await flushing;
  const prepared = await h.prepare();
  const events = prepared.item.workHistory.events;
  assert.ok(events.some(event => event.type === "coverage.gap" && event.details.requestedRevision === 0));
  assert.equal(events.some(event => event.type === "canvas.checkpoint" && event.details.label === "initial-baseline"), false);
  assert.ok(events.some(event => event.type === "canvas.checkpoint" && event.details.userRevision === 1));
});

test("native unchanged revisions and viewport changes produce no extra native edits", options, async () => {
  const h = harness();
  h.controls.native = { drawingData:Buffer.from("ink").toString("base64"), strokeCount:1 };
  h.capture.nativeRevision({ revision:5, strokeCount:1 });
  h.state.panX = 100; h.state.scale = 2;
  h.capture.nativeRevision({ revision:5, strokeCount:1 });
  h.capture.history({ tiles:[] }, "before"); h.capture.history({ tiles:[] }, "after");
  const prepared = await h.prepare();
  assert.equal(prepared.item.workHistory.events.filter(event => event.type === "native.revision").length, 1);
  assert.equal(prepared.item.workHistory.events.filter(event => event.type === "canvas.undo").length, 1);
  assert.equal(prepared.item.workHistory.events.filter(event => event.type === "canvas.redo").length, 1);
});

test("legacy and invalid saved pages never fabricate historical actions", options, async () => {
  const pages = new Map([["legacy", { id:"legacy", name:"Old worksheet", createdAt:1 }],
    ["invalid", { id:"invalid", workHistory:{ version:1, events:"bad", assets:[] } }]]);
  const h = harness({ pages });
  const list = await h.api.listSavedPages();
  assert.equal(list.find(page => page.id === "legacy").hasHistory, false);
  const legacy = await h.api.readSavedPage("legacy"), invalid = await h.api.readSavedPage("invalid");
  assert.equal(legacy.historyAvailable, false); assert.equal(legacy.events.length, 0);
  assert.equal(invalid.historyAvailable, false); assert.equal(invalid.attempt.incomplete, true);
  h.state.currentSnapshotId = "legacy"; h.state.currentSnapshotLocation = "device"; h.api.restore(pages.get("legacy"));
  edit(h);
  const saved = await h.prepare("legacy");
  assert.equal(saved.item.workHistory.events.filter(event => event.type === "canvas.commit").length, 1);
  assert.ok(saved.item.workHistory.events.some(event => event.details.reason === "history-unavailable-before-this-open"));
});

test("sign-out invalidates existing reader bundles, async page reads, capture and save callbacks", options, async () => {
  const h = harness(); edit(h); const saved = await h.prepare(); h.commitPrepared(saved);
  const bundle = await h.api.readSavedPage("page-a"), asset = bundle.events.flatMap(event => event.assets)[0];
  const gate = deferred(); h.controls.onRead = () => gate.promise;
  const reading = h.api.readSavedPage("page-a");
  h.signal("tenet:sign-out"); gate.resolve();
  await assert.rejects(reading, /account change/);
  await assert.rejects(bundle.getAsset("page-a", asset.hash), /account change/);
  await assert.rejects(h.api.listSavedPages(), /account change/);
  assert.equal(h.api.isDirty(), false); assert.equal(h.api.currentSavedPageId(), null);
  assert.equal(h.capture.aiRequested({ action:"hint" }), null); assert.equal(h.api.beginSave("device"), null);
});

test("tampered attachment hashes and oversized saved event details fail safely", options, async () => {
  const h = harness(); edit(h); const prepared = await h.prepare(); h.commitPrepared(prepared);
  const item = h.pages.get("page-a");
  const asset = item.workHistory.assets[0];
  asset.blob = new Blob(["x".repeat(asset.size)], { type:asset.mime });
  const bundle = await h.api.readSavedPage("page-a");
  await assert.rejects(bundle.getAsset("page-a", asset.hash), /hash mismatch/);
  item.workHistory.events[0].details = { oversized:"x".repeat(12 * 1024) };
  const invalid = await h.api.readSavedPage("page-a");
  assert.equal(invalid.historyAvailable, false); assert.equal(invalid.attempt.incomplete, true);
});

test("rapid edits keep one coalescing timer, bounded retention and explicit gaps", options, async () => {
  const h = harness();
  for (let index = 0; index < 5100; index++) edit(h);
  assert.equal(h.timers.size, 1); assert.equal(h.rendered.length, 0); assert.deepEqual(h.reads, []);
  const prepared = await h.prepare();
  assert.ok(prepared.item.workHistory.events.length <= 5000);
  assert.ok(prepared.item.workHistory.bytes <= 64 * 1024 * 1024);
  assert.ok(prepared.item.workHistory.droppedEvents > 0);
  assert.ok(prepared.item.workHistory.events.some(event => event.type === "coverage.gap"));
  const finalCheckpoint = prepared.item.workHistory.events.filter(event => event.type === "canvas.checkpoint").at(-1);
  assert.equal(finalCheckpoint.details.label, "saved-end-state");
  assert.ok(finalCheckpoint.assets.some(asset => asset.mime === "image/png"));
  assert.ok(prepared.item.workHistory.events.at(-1).sequence >= finalCheckpoint.sequence);
});

test("large multilingual AI text stays within event bounds with explicit truncation and no audio payload", options, async () => {
  const h = harness();
  const token = h.capture.aiRequested({ action:"hint", typedInput:{ text:"\u4f60".repeat(4000), audio:"must not retain" } });
  h.capture.aiResponse(token, { commands:[{ tool:"write_text", text:"\u4f60".repeat(8000) }] });
  const prepared = await h.prepare();
  for (const event of prepared.item.workHistory.events) assert.ok(Buffer.byteLength(JSON.stringify(event.details)) <= 12 * 1024);
  assert.ok(prepared.item.workHistory.events.find(event => event.type === "ai.response").details.textTruncated);
  assert.doesNotMatch(JSON.stringify(prepared.item.workHistory.events), /must not retain/);
});

test("real local snapshot transaction stores workHistory alongside the page and tiles atomically", options, async () => {
  const h = harness(); edit(h); const prepared = await h.prepare();
  const start = persistence.indexOf("  async function saveDeviceSnapshot("), end = persistence.indexOf("  async function snapshotBundleAsset(", start);
  const transactions = [], puts = [];
  const db = { transaction(stores, mode) {
    const transaction = { objectStore(name) { return { put(value) { puts.push({ name, value:structuredClone(value) }); } }; } };
    transactions.push({ stores, mode, transaction }); return transaction;
  } };
  const save = vm.runInNewContext(`(function() { ${persistence.slice(start, end)}; return saveDeviceSnapshot; })()`, {
    snapshotDb:async () => db, SNAPSHOT_STORE:"snapshots", SNAPSHOT_TILE_STORE:"snapshot-tiles",
    transactionDone:async transaction => assert.equal(transaction, transactions[0].transaction),
  });
  await save(prepared.item, [{ k:"0,0", blob:new Blob(["tile"]) }], null);
  assert.equal(transactions.length, 1); assert.equal(transactions[0].mode, "readwrite");
  assert.deepEqual(Array.from(transactions[0].stores), ["snapshots", "snapshot-tiles"]);
  assert.equal(puts[0].value.workHistory.events.filter(event => event.type === "canvas.commit").length, 1);
  assert.ok(puts[0].value.workHistory.assets[0].blob instanceof Blob);
  assert.equal(puts[1].value.id, "page-a:0,0");
});

function installProductionRenderer(h) {
  const renderStart = persistence.indexOf("  async function renderExportCanvas("),
    renderEnd = persistence.indexOf("  function exportFilename(", renderStart),
    blobSource = persistence.match(/  function canvasBlob\([\s\S]*?\n  \}/)?.[0],
    toolboxSource = aiSource.match(/  function hasUnsettledToolbox\([\s\S]*?\n  \}/)?.[0];
  assert.ok(blobSource && toolboxSource && renderStart >= 0 && renderEnd > renderStart);
  const operations = [];
  const context = { save() {}, restore() {}, setTransform() {}, fillRect() { operations.push("paper"); },
    drawImage() { operations.push("ink"); } };
  Object.assign(h.state, { paint:{ paper:"white" }, textEditors:new Map(), gridVisible:false });
  Object.assign(h.context, {
    performance:{ now:() => 0 }, tenetInkFlush:async () => {},
    exportRegion:() => ({ x:0, y:0, w:320, h:240 }),
    prepareVisibleWidgetSnapshots:async () => {},
    EXPORT_MAX_DIMENSION:16384, EXPORT_MAX_PIXELS:64 * 1024 * 1024, CANVAS_DOWNLOAD_RESOLUTION_SCALE:1.5,
    tiles:new Map([["0,0", {}]]), TILE:256, intersection:() => true,
    offscreen(width, height) { return { width, height, getContext:() => context,
      toBlob(callback, type) { operations.push("encode"); callback(new Blob(["production-renderer-ink"], { type })); } }; },
    drawCanvasLineGrid() {}, drawAnimationsToContext() {}, drawWidgetsToContext() {},
    drawImagesToContext() { operations.push("image"); }, drawTextBoxesToContext() {}, drawSharpOverlays() {},
  });
  vm.runInContext(`${toolboxSource}\n${blobSource}\n${persistence.slice(renderStart, renderEnd)}`, h.context);
  return operations;
}

test("production image-selection fence is preserved and a finalized save uses the real renderer and encoder", options, async () => {
  const h = harness(), operations = installProductionRenderer(h);
  await h.api.flush();
  edit(h, { tiles:[], imagesBefore:[] });
  // Production importImageFile commits, then beginImageEdit opens the toolbox.
  // Keep the existing fence; finalization clears it before the save checkpoint.
  h.state.imageEdit = { id:"rectangle", changed:false };
  h.state.imageHistoryBefore = [];
  assert.equal(h.context.hasUnsettledToolbox(), true);
  await h.api.flush();
  h.state.imageEdit = null; h.state.imageHistoryBefore = null;
  const prepared = await h.prepare();
  assert.equal(prepared.item.workHistory.events.filter(event => event.type === "coverage.gap").length, 1);
  assert.equal(prepared.item.workHistory.events.find(event => event.type === "coverage.gap").details.guard, "uncommitted-toolbox");
  const frame = prepared.item.workHistory.events.filter(event => event.type === "canvas.checkpoint").at(-1);
  assert.equal(frame.details.representation, "coalesced-rendered-page");
  assert.equal(frame.details.userRevision, 1);
  assert.ok(frame.assets.some(asset => asset.name === "page.png"));
  assert.ok(operations.includes("ink") && operations.includes("image") && operations.includes("encode"));
});

test("changed transforms still fail closed, and real save serialization recovers a full finalized end state", options, async () => {
  const h = harness(); installProductionRenderer(h); await h.api.flush();
  edit(h, { tiles:[], imagesBefore:[] });
  h.state.imageEdit = { id:"rectangle", changed:true }; h.state.imageHistoryBefore = [];
  await h.api.flush();
  // finalizeCanvasForSnapshot accepts the edit before serialization. No new
  // mock checkpoint is inserted: the real renderer must run again at save.
  h.state.imageEdit = null; h.state.imageHistoryBefore = null;
  const prepared = await h.prepare();
  const gap = prepared.item.workHistory.events.find(event => event.type === "coverage.gap");
  assert.equal(gap.details.guard, "uncommitted-toolbox"); assert.equal(gap.details.failureStage, "settlement");
  const frame = prepared.item.workHistory.events.filter(event => event.type === "canvas.checkpoint").at(-1);
  assert.equal(frame.details.label, "saved-end-state"); assert.equal(frame.details.representation, "coalesced-rendered-page");
  assert.equal(frame.assets[0].mime, "image/png");
  h.commitPrepared(prepared); assert.equal(h.api.isDirty(), false); assert.equal(h.timers.size, 0);
});

test("save-time renderer failures retain a labeled thumbnail and safe diagnostic stage rather than a false full checkpoint", options, async () => {
  const h = harness(); edit(h);
  h.controls.onRender = () => { throw new TypeError("Private page content must not enter diagnostic text"); };
  const prepared = await h.prepare();
  const gap = prepared.item.workHistory.events.find(event => event.type === "coverage.gap");
  assert.equal(gap.details.failureStage, "render"); assert.equal(gap.details.errorName, "TypeError");
  assert.equal(prepared.item.workHistory.events.at(-1).details.representation, "saved-page-thumbnail");
  assert.equal(prepared.item.workHistory.events.at(-1).assets[0].mime, "image/webp");
  assert.doesNotMatch(JSON.stringify(prepared.item.workHistory.events), /Private page content/);
});

test("a current full checkpoint is reused at save without adding a lower-resolution thumbnail or duplicate render", options, async () => {
  const h = harness(); edit(h); await h.api.flush();
  const renders = h.rendered.length;
  const token = h.capture.aiRequested({ action:"hint", typedInput:{ text:"Question about the current page" } });
  h.capture.aiFinished(token, "completed");
  const prepared = await h.prepare();
  assert.equal(h.rendered.length, renders);
  assert.equal(prepared.item.workHistory.events.some(event => event.details.representation === "saved-page-thumbnail"), false);
  assert.ok(prepared.item.workHistory.events.some(event => event.type === "canvas.checkpoint" && event.assets.some(asset => asset.mime === "image/png")));
  h.commitPrepared(prepared); assert.equal(h.api.isDirty(), false);
});

test("retention cannot reuse a full checkpoint whose event and assets have been evicted", options, async () => {
  const h = harness(); edit(h); await h.api.flush();
  const renders = h.rendered.length;
  for (let index = 0; index < 2600; index++) {
    const token = h.capture.aiRequested({ action:"hint" }); h.capture.aiFinished(token, "completed");
  }
  const prepared = await h.prepare();
  assert.ok(h.rendered.length > renders);
  const frame = prepared.item.workHistory.events.filter(event => event.type === "canvas.checkpoint").at(-1);
  assert.equal(frame.details.label, "saved-end-state"); assert.equal(frame.details.representation, "coalesced-rendered-page");
  assert.ok(prepared.item.workHistory.assets.some(asset => asset.hash === frame.assets[0].hash));
});

test("editing during a fresh save checkpoint still rejects the pinned save instead of widening its revision", options, async () => {
  const h = harness(); edit(h);
  const gate = deferred(); h.controls.onRender = () => gate.promise;
  const saving = h.prepare(); edit(h); gate.resolve();
  const prepared = await saving;
  assert.equal(prepared.item.workHistory, null);
  assert.equal(h.api.isSaveCurrent(prepared.token, 1), false);
  assert.equal(h.api.isDirty(), true); assert.equal(h.pages.size, 0);
});
