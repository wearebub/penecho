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

const AI_BODY_LIMIT = 12 * 1024 * 1024, AI_IMAGE_LIMIT = 8 * 1024 * 1024;
const inputPNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const nextTurn = () => new Promise(setImmediate);
function requestInput(h, settings = {}) {
  const packed = settings.packed || { questionOnly:true, selectionQuestion:"Which step should I try?" };
  const body = settings.body ?? JSON.stringify({ ...packed, trigger:"manual", userAction:"hint" });
  const input = { action:"hint", automatic:false, revision:h.state.userRevision, packed, voice:false,
    requestBody:body, ...settings.input };
  const token = h.capture.aiRequested(input);
  assert.ok(token);
  return { token, body, input };
}
function blockInputHash(h) {
  const entered = deferred(), release = deferred();
  h.context.crypto = { randomUUID:() => webcrypto.randomUUID(), subtle:{
    async digest(...args) { entered.resolve(); await release.promise; return webcrypto.subtle.digest(...args); },
  } };
  return { entered:entered.promise, release:release.resolve };
}
function capturedInput(prepared, token) {
  return prepared.item.workHistory.events.find(event => event.type === "ai.input" && event.details.localRequestId === token.id);
}
function storedInputAsset(prepared, event, name) {
  const reference = event.assets.find(asset => asset.name === name);
  return reference && prepared.item.workHistory.assets.find(asset => asset.hash === reference.hash);
}

test("exact serialized client body and crop are retained independently of later edits and response completion", options, async () => {
  const h = harness(); await h.api.flush();
  const packed = { atlasImage:"data:image/png;base64," + inputPNG.toString("base64"), atlasSize:{ w:1, h:1 },
    sourceRect:{ x:17, y:29, w:40, h:50 }, changedBox:{ x:20, y:30, w:10, h:12 },
    selectionContext:{ closed:true, path:[{ x:17, y:29 }, { x:57, y:29 }, { x:57, y:79 }] },
    selectionQuestion:"Explain this π step", focusInset:null };
  const body = JSON.stringify({ ...packed, userAction:"hint", trigger:"manual", reasoningEffort:"medium",
    canvasSize:{ w:20000, h:20000 }, uiTheme:"studio", persona:"Exact client persona", plugins:["graph"] }, null, 2);
  const gate = blockInputHash(h), sent = requestInput(h, { packed, body });
  await gate.entered;
  h.capture.aiResponse(sent.token, { commands:[{ tool:"write_text", text:"What is known?" }] });
  h.capture.aiFinished(sent.token, "completed");
  packed.selectionQuestion = "Later text must not replace request"; edit(h);
  gate.release(); await h.api.flush();
  const prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
  assert.equal(input.details.requestRevision, 0); assert.equal(input.details.userRevision, 0);
  assert.equal(input.details.bodyStatus, "recorded"); assert.equal(input.details.bodyExact, true);
  assert.equal(input.details.bodyFormat, "raw-client-json"); assert.equal(input.details.imageStatus, "recorded");
  assert.equal(input.details.boundary, "client-to-whiteboard"); assert.equal(input.details.gatewayProviderPromptObserved, false);
  assert.ok(Number.isFinite(Date.parse(input.details.requestObservedAt)));
  assert.ok(input.sequence > prepared.item.workHistory.events.find(event => event.type === "ai.finished").sequence);
  assert.equal(await storedInputAsset(prepared, input, "ai-input.json").blob.text(), body);
  const image = storedInputAsset(prepared, input, "ai-input.png");
  assert.deepEqual(Buffer.from(await image.blob.arrayBuffer()), inputPNG);
  assert.equal(input.assets.length, 2);
  for (const event of prepared.item.workHistory.events) {
    assert.ok(event.assets.length <= 2); assert.ok(Buffer.byteLength(JSON.stringify(event.details)) <= 12 * 1024);
    if (event.type === "canvas.checkpoint") assert.equal(event.assets.some(asset => asset.name.startsWith("ai-input.")), false);
  }
  h.commitPrepared(prepared);
  const reloaded = harness({ pages:structuredClone(h.pages) }), record = await reloaded.api.readSavedPage("page-a");
  const savedInput = record.events.find(event => event.type === "ai.input");
  assert.equal(await (await record.getAsset("page-a", savedInput.assets[0].hash)).text(), body);
  assert.equal(h.api.isDirty(), false);
});

test("request origins distinguish explicit questions from typed canvas context without retaining voice IDs", options, async () => {
  const cases = [
    { origin:"quick-help", packed:{}, input:{ typedInput:{ text:"Canvas textbox" } }, source:"canvas-typed-input" },
    { origin:"specific-question", packed:{ selectionQuestion:"Why?" }, source:"selection-question" },
    { origin:"voice-question", packed:{ questionOnly:true, selectionQuestion:"Edited spoken question" }, input:{ voice:true, voiceRequestId:"never-retain-voice-id" }, source:"selection-question" },
    { origin:"automatic", packed:{}, input:{ action:"auto", automatic:true }, source:"none" },
    { origin:"unknown", packed:{}, input:{ voice:undefined }, source:"none" },
  ];
  for (const item of cases) {
    const h = harness(), sent = requestInput(h, item);
    const prepared = await h.prepare(), request = prepared.item.workHistory.events.find(event => event.type === "ai.request");
    assert.equal(request.details.origin, item.origin); assert.equal(request.details.questionSource, item.source);
    assert.equal(capturedInput(prepared, sent.token).details.origin, item.origin);
    assert.doesNotMatch(JSON.stringify(prepared.item.workHistory.events), /never-retain-voice-id/);
  }
});

test("credential and header fields are removed only from local retained JSON and marked partial", options, async () => {
  const h = harness();
  const value = { selectionQuestion:"Keep the question", authorization:"secret-one", headers:{ Authorization:"secret-two" },
    nested:{ api_key:"secret-three", clientSecret:"secret-four", safe:"keep this" },
    list:[{ refresh_token:"secret-five", text:"Keep this too" }], typedInput:{ text:"ordinary student text" } };
  const body = JSON.stringify(value), sent = requestInput(h, { body });
  const prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
  const retained = await storedInputAsset(prepared, input, "ai-input.json").blob.text();
  assert.equal(sent.body, body); assert.match(body, /secret-one/);
  assert.doesNotMatch(retained, /secret-(?:one|two|three|four|five)/);
  assert.deepEqual(JSON.parse(retained), { selectionQuestion:"Keep the question", nested:{ safe:"keep this" },
    list:[{ text:"Keep this too" }], typedInput:{ text:"ordinary student text" } });
  assert.equal(input.details.bodyStatus, "partial"); assert.equal(input.details.bodyExact, false);
  assert.equal(input.details.bodyFormat, "redacted-client-json");
  assert.ok(input.details.omitted.includes("sensitive-body-fields-omitted"));
  assert.equal(prepared.item.workHistory.incomplete, true);
});

test("raw body limits are enforced in both source characters and UTF8 Blob bytes", options, async () => {
  for (const [body, reason] of [
    ["x".repeat(AI_BODY_LIMIT + 1), "body-character-limit"],
    [JSON.stringify({ text:"\u4f60".repeat(Math.floor(AI_BODY_LIMIT / 3) + 1) }), "body-byte-limit"],
  ]) {
    const h = harness(), sent = requestInput(h, { body });
    const prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
    assert.equal(input.details.bodyStatus, "unavailable"); assert.equal(input.assets.length, 0);
    assert.ok(input.details.omitted.includes(reason)); assert.equal(prepared.item.workHistory.incomplete, true);
    h.commitPrepared(prepared); assert.equal(h.api.isDirty(), false, "Stored partial history must not cause autosave churn");
  }
  const h = harness(), overhead = JSON.stringify({ text:"" }).length;
  const body = JSON.stringify({ text:"a".repeat(AI_BODY_LIMIT - overhead) });
  assert.equal(Buffer.byteLength(body), AI_BODY_LIMIT);
  const sent = requestInput(h, { body }), prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
  assert.equal(input.details.bodyExact, true); assert.equal(storedInputAsset(prepared, input, "ai-input.json").size, AI_BODY_LIMIT);
});

test("redaction expansion beyond the body ceiling cannot attach a rejected Blob", options, async () => {
  // JSON number normalization can expand a valid serialized body's text.
  const head = '{"password":"remove","numbers":[' + Array(100).fill("1e21").join(",") + '],"padding":"';
  const body = head + "x".repeat(AI_BODY_LIMIT - head.length - 2) + '"}';
  assert.equal(Buffer.byteLength(body), AI_BODY_LIMIT);
  const h = harness(), sent = requestInput(h, { body }), prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
  assert.equal(input.details.bodyStatus, "unavailable"); assert.equal(input.details.bodyAssetName, null);
  assert.equal(input.assets.length, 0); assert.ok(input.details.omitted.includes("body-structure-limit"));
  assert.equal(prepared.item.workHistory.assets.some(asset => asset.size > AI_BODY_LIMIT), false);
});

test("image convenience caps, invalid encodings and remote URLs do not widen capture or issue fetches", options, async () => {
  const oversizedImage = Buffer.alloc(AI_IMAGE_LIMIT + 1).toString("base64");
  for (const [atlasImage, imageStatus, reason] of [
    [undefined, "not-submitted", null],
    ["https://private.invalid/student-image.png", "omitted", "image-format-unavailable"],
    ["data:image/svg+xml;base64,PHN2Zy8+", "omitted", "image-format-unavailable"],
    ["data:image/png;base64,%%%", "omitted", "image-encoding-invalid"],
    ["data:image/png;base64," + oversizedImage, "omitted", "image-byte-limit"],
  ]) {
    const h = harness(), body = JSON.stringify({ atlasImage, selectionQuestion:"Help" });
    const sent = requestInput(h, { body }), prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
    assert.equal(input.details.bodyStatus, "recorded"); assert.equal(input.details.imageStatus, imageStatus);
    assert.equal(input.assets.length, 1); assert.equal(await storedInputAsset(prepared, input, "ai-input.json").blob.text(), body);
    if (reason) assert.ok(input.details.omitted.includes(reason)); else assert.deepEqual(plain(input.details.omitted), []);
  }
});

test("unknown or overcomplex bodies produce explicit missing input instead of claiming completeness", options, async () => {
  for (const [body, reason] of [["not-json", "body-format-unavailable"], ["[]", "body-format-unavailable"],
    [JSON.stringify({ values:Array(8193).fill(1) }), "body-structure-limit"],
    ['{"next":'.repeat(34) + "{}" + "}".repeat(34), "body-structure-limit"]]) {
    const h = harness(), sent = requestInput(h, { body }), prepared = await h.prepare(), input = capturedInput(prepared, sent.token);
    assert.equal(input.details.bodyStatus, "unavailable"); assert.equal(input.details.bodyExact, false);
    assert.ok(input.details.omitted.includes(reason)); assert.equal(input.assets.length, 0);
  }
});

test("two-job and aggregate-character queue caps preserve explicit omissions while accepting tutoring lifecycle events", options, async () => {
  for (const aggregate of [false, true]) {
    const h = harness(); await h.api.flush(); const gate = blockInputHash(h);
    const body = aggregate ? JSON.stringify({ text:"x".repeat(6 * 1024 * 1024) }) : undefined;
    const first = requestInput(h, { body }); await gate.entered;
    h.capture.aiFinished(first.token, "completed");
    const second = requestInput(h, { body }); h.capture.aiFinished(second.token, "completed");
    const third = aggregate ? null : requestInput(h);
    if (third) h.capture.aiFinished(third.token, "completed");
    gate.release(); const prepared = await h.prepare();
    const events = prepared.item.workHistory.events.filter(event => event.type === "ai.input");
    assert.equal(events.filter(event => event.details.bodyStatus === "recorded").length, aggregate ? 1 : 2);
    assert.equal(events.filter(event => event.details.omitted.includes("input-queue-limit")).length, 1);
    assert.equal(prepared.item.workHistory.events.filter(event => event.type === "ai.finished").length, aggregate ? 2 : 3);
  }
});

test("save flush waits for admitted input attachments and later inputs remain dirty across first-save binding", options, async () => {
  const h = harness(); await h.api.flush(); const gate = blockInputHash(h);
  const first = requestInput(h); await gate.entered;
  let settled = false;
  const saving = h.prepare().then(value => { settled = true; return value; });
  await nextTurn(); assert.equal(settled, false);
  gate.release(); const prepared = await saving;
  assert.equal(capturedInput(prepared, first.token).details.bodyStatus, "recorded");
  const laterGate = blockInputHash(h), later = requestInput(h); await laterGate.entered;
  h.commitPrepared(prepared); assert.equal(h.api.isDirty(), true);
  laterGate.release(); await h.api.flush();
  const next = await h.prepare("page-a");
  assert.equal(capturedInput(next, later.token).details.bodyStatus, "recorded");
  h.commitPrepared(next); assert.equal(h.api.isDirty(), false);
});

test("page, account and background boundaries invalidate both running and queued input jobs", options, async () => {
  for (const boundary of ["page", "account", "background"]) {
    const h = harness(); await h.api.flush(); const gate = blockInputHash(h);
    const first = requestInput(h, { packed:{ selectionQuestion:"Old page private question" } }); await gate.entered;
    requestInput(h, { packed:{ selectionQuestion:"Queued old private question" } });
    const oldFlush = h.api.flush();
    if (boundary === "account") h.signal("tenet:sign-out");
    else if (boundary === "background") {
      h.document.hidden = true; h.document.dispatchEvent(new CustomEvent("visibilitychange"));
      h.document.hidden = false; h.document.dispatchEvent(new CustomEvent("visibilitychange"));
    } else {
      h.capture.boundary("page-transition"); h.state.snapshotLoadGeneration++; h.api.restore(null);
    }
    gate.release(); await oldFlush; await nextTurn();
    if (boundary === "account") {
      assert.equal(h.api.beginSave("device"), null); assert.equal(h.capture.aiRequested({ action:"hint" }), null);
    } else {
      h.capture.aiFinished(first.token, "completed");
      const prepared = await h.prepare();
      assert.equal(prepared.item.workHistory.events.filter(event => event.type === "ai.input").length, 0);
      assert.equal(prepared.item.workHistory.assets.some(asset => asset.mime === "application/json"), false);
      if (boundary === "page") assert.doesNotMatch(JSON.stringify(prepared.item.workHistory.events), /Old page private|Queued old private/);
      else assert.ok(prepared.item.workHistory.events.some(event => event.type === "coverage.gap" && event.details.reason === "backgrounded"));
    }
  }
});

test("input timeout produces one explicit omission and cannot append again after delayed hashing resolves", options, async () => {
  const h = harness(); await h.api.flush(); const gate = blockInputHash(h);
  const sent = requestInput(h); await gate.entered;
  const [id, timeout] = [...h.timers].filter(([, value]) => value.delay === 12000).at(-1);
  h.timers.delete(id); timeout.fn(); await h.api.flush();
  gate.release(); await nextTurn();
  const prepared = await h.prepare(), inputs = prepared.item.workHistory.events.filter(event => event.type === "ai.input");
  assert.equal(inputs.length, 1); assert.equal(inputs[0].details.localRequestId, sent.token.id);
  assert.equal(inputs[0].details.bodyStatus, "unavailable"); assert.equal(inputs[0].assets.length, 0);
  assert.ok(inputs[0].details.omitted.includes("input-capture-failed"));
});

test("legacy saved request summaries retain unknown origin and absent full inputs without reconstruction", options, async () => {
  const original = { sequence:1, timestamp:"2026-09-01T12:00:00.000Z", type:"ai.request",
    details:{ localRequestId:"old", question:"Old summary only", action:"hint" }, assets:[] };
  const item = { id:"legacy", name:"Legacy AI work", createdAt:1, workHistory:{ version:1,
    events:[original], assets:[], incomplete:false, droppedEvents:0 } };
  const h = harness({ pages:new Map([[item.id, item]]) }), reader = await h.api.readSavedPage(item.id);
  assert.deepEqual(plain(reader.events), [original]); assert.equal(reader.events[0].details.origin, undefined);
  assert.equal(reader.events[0].details.inputVersion, undefined); assert.equal(reader.events.some(event => event.type === "ai.input"), false);
  h.state.currentSnapshotId = item.id; h.state.currentSnapshotLocation = "device"; h.api.restore(item);
  const prepared = await h.prepare(item.id);
  assert.deepEqual(plain(prepared.item.workHistory.events.find(event => event.type === "ai.request")), original);
  assert.equal(prepared.item.workHistory.assets.some(asset => asset.mime === "application/json"), false);
});

function installRequestRuntime(h, settings = {}) {
  const begin = aiSource.indexOf("  async function requestAI("), end = aiSource.indexOf("  function viewportRect(", begin);
  assert.ok(begin >= 0 && end > begin);
  const calls = { fetch:[], statuses:[], clears:0 }, noop = () => {};
  Object.assign(h.state, { mode:"pen", auto:false, theme:"studio", reasoningEffort:"medium", aiColor:"blue",
    recognitionGeneration:0, hotspotTrail:[], images:[], widgets:[], dirty:null, latestTypedInput:null });
  Object.assign(h.context, { AbortController, SIZE:20000, aiPreparationGeneration:0, aiPreparation:null,
    AI_CANCELLED:"cancelled", AI_SUPERSEDED:"superseded", AI_REJECTED:"rejected",
    MAX_VISIBLE_WIDGETS:20, MAX_VISIBLE_IMAGES:100,
    tenetInkFlush:async () => {}, tenetInkMessage:message => calls.statuses.push(message),
    clearWidgetRefineCandidate:noop, createAIProcessingScope:() => null, pluginEnabled:() => false,
    aiPreparationInvalid:() => false, containsRect:() => true,
    setBusy:value => { h.state.busy = value; }, setStatusKey:key => calls.statuses.push(key),
    setStatus:message => calls.statuses.push(message), activeAiRequestTimeoutMs:() => 30000,
    createActivityAwareAbortTimeout:() => ({ clear() { calls.clears++; }, activity:noop }),
    aiRequestHeaders:headers => ({ ...headers, Authorization:"PRIVATE_AUTH_HEADER" }),
    pluginRequestPayload:settings.pluginRequestPayload || (() => ({ plugins:["graph"], clientCapabilities:{ diagrams:true } })),
    async fetch(url, init) { calls.fetch.push({ url, init }); return { ok:true }; },
    readAiCommandResponse:async () => ({ ok:true, data:{ requestId:"fixture-response", commands:[] } }),
    applyAiProgress:noop, rememberRequest:noop, showTenetGatewayBanner:noop,
    validate:commands => commands, normalizeCommandPlacements:commands => commands,
    debug:noop, t:key => key, restoreDirty:noop, schedule:noop,
  });
  vm.runInContext(aiSource.slice(begin, end), h.context, { filename:"actual-requestAI.js" });
  return { calls, request:(action, packed, options) => h.context.requestAI(action, packed, options) };
}

test("real requestAI sends and records the same once-serialized body without headers, voice ID or raw audio", options, async () => {
  const h = harness(); await h.api.flush(); const runtime = installRequestRuntime(h);
  const packed = { atlasImage:"data:image/png;base64," + inputPNG.toString("base64"),
    sourceRect:{ x:1, y:2, w:3, h:4 }, changedBox:{ x:1, y:2, w:3, h:4 }, selectionQuestion:"Help here" };
  await runtime.request("answer", packed, { voiceRequestId:"PRIVATE_VOICE_ID", audio:"PRIVATE_RAW_AUDIO", oneShotInput:true });
  assert.equal(runtime.calls.fetch.length, 1); assert.equal(runtime.calls.fetch[0].url, "/api/ai/command");
  const sent = runtime.calls.fetch[0].init;
  assert.equal(sent.headers.Authorization, "PRIVATE_AUTH_HEADER"); assert.equal(sent.credentials, "same-origin");
  const body = JSON.parse(sent.body); assert.equal(body.userAction, "hint"); assert.equal(body.trigger, "manual");
  assert.deepEqual(body.plugins, ["graph"]); assert.equal(body.reasoningEffort, "medium"); assert.equal(body.uiTheme, "studio");
  assert.match(body.persona, /well-organized/); assert.deepEqual(body.sourceRect, packed.sourceRect);
  const prepared = await h.prepare(), input = prepared.item.workHistory.events.find(event => event.type === "ai.input");
  assert.equal(input.details.origin, "voice-question");
  const retained = await storedInputAsset(prepared, input, "ai-input.json").blob.text();
  assert.equal(retained, sent.body); assert.doesNotMatch(retained, /PRIVATE_AUTH_HEADER|PRIVATE_VOICE_ID|PRIVATE_RAW_AUDIO/);
  assert.doesNotMatch(JSON.stringify(prepared.item.workHistory.events), /PRIVATE_AUTH_HEADER|PRIVATE_VOICE_ID|PRIVATE_RAW_AUDIO/);
  assert.equal(h.state.activeAI, null); assert.equal(h.state.busy, false); assert.ok(runtime.calls.clears > 0);
});

test("real requestAI cleanup still runs for body construction and serialization failures", options, async () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const pluginRequestPayload of [() => cyclic, () => { throw Error("Body construction failed"); }]) {
    const h = harness(), runtime = installRequestRuntime(h, { pluginRequestPayload });
    await runtime.request("hint", { questionOnly:true, selectionQuestion:"Start here" }, { oneShotInput:true });
    assert.equal(runtime.calls.fetch.length, 0); assert.equal(h.state.activeAI, null); assert.equal(h.state.busy, false);
    assert.ok(runtime.calls.clears > 0); assert.equal(runtime.calls.statuses.some(value => String(value).startsWith("aiError")), true);
  }
});

test("real tutoring request is not blocked by a throwing history observer or a failed input hash", options, async () => {
  for (const failure of ["observer", "hash"]) {
    const h = harness(); await h.api.flush(); const runtime = installRequestRuntime(h);
    if (failure === "observer") h.window.TenetProcessCapture = { aiRequested() { throw Error("History unavailable"); }, aiResponse() {}, aiFinished() {} };
    else h.context.crypto = { randomUUID:() => webcrypto.randomUUID(), subtle:{ digest:async () => { throw Error("Hash unavailable"); } } };
    await runtime.request("hint", { questionOnly:true, selectionQuestion:"Tutor still works" }, { oneShotInput:true });
    await h.api.flush();
    assert.equal(runtime.calls.fetch.length, 1); assert.equal(h.state.activeAI, null); assert.equal(h.state.busy, false);
    assert.equal(runtime.calls.statuses.some(value => String(value).startsWith("aiError")), false);
  }
});

test("saturated input capture cannot delay real tutoring requests or alter their serialized questions", options, async () => {
  const h = harness(); await h.api.flush(); const runtime = installRequestRuntime(h), gate = blockInputHash(h);
  for (let index = 0; index < 3; index++) {
    await runtime.request("hint", { questionOnly:true, selectionQuestion:"Question " + index }, { oneShotInput:true });
    if (index === 0) await gate.entered;
  }
  assert.equal(runtime.calls.fetch.length, 3); assert.equal(h.state.activeAI, null);
  assert.deepEqual(runtime.calls.fetch.map(call => JSON.parse(call.init.body).selectionQuestion), ["Question 0", "Question 1", "Question 2"]);
  gate.release(); const prepared = await h.prepare();
  const inputs = prepared.item.workHistory.events.filter(event => event.type === "ai.input");
  assert.equal(inputs.length, 3); assert.equal(inputs.filter(event => event.details.omitted.includes("input-queue-limit")).length, 1);
});
