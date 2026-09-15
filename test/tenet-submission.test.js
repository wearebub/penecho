"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/tenet-submission.js"), "utf8");
const mib = 1024 * 1024;
const options = { timeout:15000 };
const bytes = async blob => Buffer.from(await blob.arrayBuffer());
const digest = async value => Buffer.from(await webcrypto.subtle.digest("SHA-256", value)).toString("hex");
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

// Reuse the existing host fixtures, not their tests. saveSnapshot,
// readDeviceSnapshot and the history engine remain the actual source paths.
function fixture(filename, names) {
  const file = path.join(__dirname, filename), code = fs.readFileSync(file, "utf8");
  const end = code.search(/\r?\ntest\(/);
  assert.ok(end > 0);
  const prefix = code.slice(0, end);
  return new Function("require", "__dirname", `${prefix}\nreturn {${names.join(",")}};`)(require, __dirname);
}
const { boot:bootSavedPage } = fixture("tenet-document-history-integration.test.js", ["boot"]);

function harness(reader, overrides = {}) {
  const listeners = new Map();
  const window = {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); }
  };
  const context = vm.createContext({ window, Blob, Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder,
    CompressionStream, DecompressionStream, crypto:webcrypto, atob, btoa, setTimeout, clearTimeout, ...overrides });
  // IDB values ordinarily enter the application's own realm. Recreate that
  // boundary for Node VM fixtures, retaining immutable Blob bytes/functions.
  const localize = vm.runInContext(`(function localize(value) {
    if (value instanceof Blob || typeof value === "function" || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return Array.from(value, localize);
    const result = {}; for (const key of Object.keys(value)) Object.defineProperty(result, key,
      { value:localize(value[key]), enumerable:true, writable:true, configurable:true }); return result;
  })`, context);
  if (reader) window.TenetDocumentHistory = { readSubmissionSource:async id => localize(await reader(id)) };
  vm.runInContext(source, context, { filename:"tenet-submission.js" });
  return { api:window.TenetSubmission, context, window,
    signOut() { for (const listener of listeners.get("tenet:sign-out") || []) listener({ type:"tenet:sign-out" }); } };
}

function page(overrides = {}) {
  return { item:{ version:2, id:"saved-page", name:"Algebra", createdAt:100, updatedAt:200,
    theme:"light", view:{ scale:1, panX:0, panY:0, navigationLocked:false }, tileCount:0,
    animationCount:0, animations:[], widgetCount:0, widgets:[], textBoxCount:0, textBoxes:[],
    imageCount:0, images:[], preview:new Blob([new Uint8Array([137,80,78,71,1,2,3])], { type:"image/png" }),
    ...overrides }, tileEntries:[], assertCurrent() {} };
}
async function history(attachments, events) {
  const assets = [], refs = [];
  for (const [name, blob] of attachments) {
    const hash = await digest(await blob.arrayBuffer());
    refs.push({ name, hash, mime:blob.type, size:blob.size });
    if (!assets.some(asset => asset.hash === hash)) assets.push({ hash, mime:blob.type, size:blob.size, blob });
  }
  const records = events || [{ sequence:1, timestamp:"2026-09-15T00:00:00.000Z", type:"ai.input",
    details:{ localRequestId:1, origin:"voice-question", boundary:"client-to-whiteboard", bodyExact:true,
      bodyStatus:"recorded", bodyAssetName:"ai-input.json", imageAssetName:"ai-input.png", gatewayProviderPromptObserved:false }, assets:refs }];
  return { version:1, startedAt:100, updatedAt:200, nextSequence:records.length + 1,
    incomplete:false, incompleteReasons:[], droppedEvents:0, events:records, assets };
}
async function pack(value, settings = {}) {
  const raw = settings.raw || Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  const compressed = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const header = new Uint8Array(48); header.set(Buffer.from("TENETWB\n"));
  new DataView(header.buffer).setUint32(8, settings.version ?? 1);
  new DataView(header.buffer).setUint32(12, settings.expandedBytes ?? raw.byteLength);
  header.set(new Uint8Array(await webcrypto.subtle.digest("SHA-256", raw)), 16);
  return new Blob([header, compressed]);
}
async function unpack(blob) {
  const text = await new Response(blob.slice(48).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text);
}
async function exported(saved = page()) {
  const h = harness(async id => { assert.equal(id, saved.item.id); return saved; });
  return { h, saved, result:await h.api.exportSavedPage(saved.item.id) };
}
async function corrupt(change, saved) {
  const { result } = await exported(saved);
  const manifest = await unpack(result.blob); change(manifest);
  return harness().api.openFile(await pack(manifest));
}

test("ordinary actual save exports tiles, images, native archives and recorded AI JSON to a fresh context", options, async () => {
  const h = await bootSavedPage();
  try {
    const image = new Blob([new Uint8Array([137,80,78,71,0,255,128])], { type:"image/png" });
    const nativeBytes = Buffer.from([0,1,128,255,13,10,5]);
    const question = "{\"typedInput\":\"Help with \\u03c0\",\"atlas\":\"data:image/png;base64,AAH/\"}";
    h.context.storedImages = () => [{ id:"image-a", x:3, y:4, w:30, h:40, blob:image }];
    h.context.tenetInkManifestExtensions = () => ({ tenetNativeInk:{ version:1, drawingBase64:nativeBytes.toString("base64") } });
    h.webEdit("actual tile marker");
    await h.history.flush();
    // Exercise the existing common request hook, not a manufactured viewer event.
    h.capture.aiRequested({ action:"hint", automatic:false, revision:h.state.userRevision,
      packed:{ questionOnly:true, selectionQuestion:"Help with pi" }, typedInput:"Help with pi",
      requestBody:question, voice:true });
    await h.history.flush();
    await h.savePage();
    const id = h.state.currentSnapshotId;
    const before = await h.readStored(id);
    assert.ok(before.item.workHistory.events.some(event => event.type === "ai.input"));
    const sender = harness(savedId => h.history.readSubmissionSource(savedId));
    const result = await sender.api.exportSavedPage(id);
    const manifest = await unpack(result.blob);
    const table = new Map(manifest.assets.map(asset => [asset.hash, Buffer.from(asset.data, "base64")]));
    const atPath = path => manifest.blobRefs.find(ref => JSON.stringify(ref.path) === JSON.stringify(path));
    const storedTiles = before.tileEntries;
    assert.ok(storedTiles.length > 0);
    for (let i = 0; i < storedTiles.length; i++) {
      const ref = atPath(["tileEntries", i, "blob"]);
      assert.deepEqual(table.get(ref.hash), await bytes(storedTiles[i].blob));
      assert.equal(manifest.page.tileEntries[i].k, storedTiles[i].k);
    }
    assert.deepEqual(table.get(atPath(["item","images",0,"blob"]).hash), await bytes(image));
    assert.equal(manifest.page.item.manifestExtensions.tenetNativeInk.drawingBase64, nativeBytes.toString("base64"));
    const reopened = await harness().api.openFile(result.blob);
    assert.equal(reopened.attempt.id, id);
    assert.equal(reopened.historyAvailable, true);
    const input = reopened.events.find(event => event.type === "ai.input");
    const json = input.assets.find(asset => asset.name === "ai-input.json");
    assert.equal(await (await reopened.getAsset(id, json.hash)).text(), question);
    assert.equal(input.details.gatewayProviderPromptObserved, false);
    assert.ok(reopened.finalPreview instanceof Blob);
    assert.deepEqual((await h.readStored(id)).item.workHistory.events, before.item.workHistory.events);
  } finally { h.dispose(); }
});

test("lossless binary dedup retains separate MIME references and exact JSON/crop bytes", options, async () => {
  const crop = new Blob([new Uint8Array([0,255,7,128])], { type:"image/png" });
  const body = new Blob([' { "question":"Hello \u03c0", "atlas":"AA==" }\n'], { type:"application/json" });
  const saved = page({ images:[{ blob:crop }], imageCount:1,
    preservedAssets:[{ path:"native/drawing.bin", blob:new Blob([crop], { type:"application/octet-stream" }) }] });
  saved.tileEntries.push({ k:"0,0", blob:crop });
  saved.item.workHistory = await history([["ai-input.json",body],["ai-input.png",crop]]);
  const { result } = await exported(saved), manifest = await unpack(result.blob);
  assert.equal(manifest.assets.length, 3, "preview + JSON + one shared crop/native/tile binary");
  assert.equal(new Set(manifest.assets.map(asset => asset.hash)).size, manifest.assets.length);
  const bundle = await harness().api.openFile(result.blob);
  for (const [name, expected] of [["ai-input.json",body],["ai-input.png",crop]]) {
    const ref = bundle.events[0].assets.find(asset => asset.name === name);
    const actual = await bundle.getAsset(bundle.attempt.id, ref.hash);
    assert.deepEqual(await bytes(actual), await bytes(expected)); assert.equal(actual.type, expected.type);
  }
  assert.equal(bundle.submission.integrity, "sha256-not-authorship");
  await assert.rejects(bundle.getAsset("another-page", bundle.events[0].assets[0].hash));
});

test("legacy saved page has honest final preview, metadata and no fabricated events", options, async () => {
  const { saved, result } = await exported();
  const bundle = await harness().api.openFile(result.blob);
  assert.equal(bundle.historyAvailable, false); assert.equal(bundle.events.length, 0);
  assert.equal(bundle.title, "Algebra"); assert.equal(bundle.savedAt, new Date(200).toISOString());
  assert.equal(bundle.finalPage.representation, "saved-page-thumbnail");
  assert.deepEqual(await bytes(bundle.finalPreview), await bytes(saved.item.preview));
  assert.deepEqual(await bytes(await bundle.getAsset(bundle.attempt.id, bundle.finalPage.asset.hash)), await bytes(saved.item.preview));
  assert.match(result.filename, /^Tenet - Algebra\.tenet$/);
});

test("only a genuine saved-end-state checkpoint becomes the final full page", options, async () => {
  const image = new Blob(["full final frame"], { type:"image/png" });
  const saved = page(); saved.item.workHistory = await history([["page.png", image]]);
  Object.assign(saved.item.workHistory.events[0], { type:"canvas.checkpoint",
    details:{ label:"saved-end-state", representation:"coalesced-rendered-page" } });
  const { result } = await exported(saved), bundle = await harness().api.openFile(result.blob);
  assert.equal(bundle.finalPage.representation, "recorded-save-checkpoint");
  assert.equal(bundle.finalPage.sourceEventSequence, 1);
  assert.deepEqual(await bytes(bundle.finalPreview), await bytes(image));
  saved.item.workHistory.events[0].details.label = "post-edit";
  const fallback = await harness().api.openFile((await exported(saved)).result.blob);
  assert.equal(fallback.finalPage.representation, "saved-page-thumbnail");
});

test("engine source helper allowlists saved drawing fields and fences its asynchronous read", options, async () => {
  const h = await bootSavedPage();
  try {
    h.webEdit(); await h.savePage();
    const id = h.state.currentSnapshotId, actualRead = h.context.readDeviceSnapshot;
    h.context.readDeviceSnapshot = async key => {
      const stored = await actualRead(key);
      Object.assign(stored.item, { session:{ token:"secret" }, auth:"secret", projectId:"community",
        bundleExtensions:{ lineage:"outside-snapshot" }, manifestExtensions:{ tenetNativeInk:{ drawingBase64:"AQI=" }, other:"secret" } });
      return stored;
    };
    const read = await h.history.readSubmissionSource(id);
    assert.equal(read.item.session, undefined); assert.equal(read.item.auth, undefined);
    assert.equal(read.item.projectId, undefined); assert.equal(read.item.bundleExtensions, undefined);
    assert.deepEqual(plain(read.item.manifestExtensions), { tenetNativeInk:{ drawingBase64:"AQI=" } });
    const entered = deferred(), release = deferred();
    h.context.readDeviceSnapshot = async key => { entered.resolve(); await release.promise; return actualRead(key); };
    const pending = h.history.readSubmissionSource(id); await entered.promise;
    h.window.dispatchEvent(new h.context.CustomEvent("tenet:sign-out")); release.resolve();
    await assert.rejects(pending); assert.throws(read.assertCurrent);
  } finally { h.dispose(); }
});

test("bad magic, header versions, expanded lengths, body hashes and damaged gzip reject", options, async () => {
  const { result } = await exported(), original = await bytes(result.blob);
  for (const offset of [0,8,15,16,original.length-1]) {
    const damaged = Buffer.from(original); damaged[offset] ^= 1;
    await assert.rejects(harness().api.openFile(new Blob([damaged])), `byte ${offset}`);
  }
  await assert.rejects(harness().api.openFile(new Blob([original.subarray(0,48)])));
  await assert.rejects(harness().api.openFile(await pack({}, { version:2 })));
  await assert.rejects(harness().api.openFile(await pack({}, { expandedBytes:96*mib+1 })));
});

test("duplicate JSON keys including escaped and nested keys are rejected before last-wins parsing", options, async () => {
  const { result } = await exported(), manifest = await unpack(result.blob), json = JSON.stringify(manifest);
  for (const raw of [json.replace('"version":1', '"version":0,"version":1'),
    json.replace('"version":1', '"vers\\u0069on":0,"version":1'),
    json.replace('"name":"Algebra"', '"name":"wrong","name":"Algebra"')]) {
    await assert.rejects(harness().api.openFile(await pack(raw)), /JSON/);
  }
});

test("malformed JSON, unsafe object keys, unknown fields/version and deep structures reject", options, async () => {
  await assert.rejects(harness().api.openFile(await pack('{"x":1,}')));
  await assert.rejects(harness().api.openFile(await pack({}, { raw:Buffer.from([255]) })));
  await assert.rejects(corrupt(m => { m.version = 2; }));
  await assert.rejects(corrupt(m => { m.page.item.auth = "secret"; }));
  await assert.rejects(corrupt(m => { m.page.item.manifestExtensions = { unauthorized:"data" }; }));
  for (const key of ["__proto__", "constructor", "prototype"]) {
    await assert.rejects(corrupt(m => Object.defineProperty(m.page.item, key, { value:{ polluted:true }, enumerable:true })));
  }
  await assert.rejects(corrupt(m => { let value = {}; m.page.item.view = value;
    for (let i = 0; i < 35; i++) { value.next = {}; value = value.next; } }));
});

test("binary asset hashes, sizes, duplicate table entries and orphan assets reject", options, async () => {
  await assert.rejects(corrupt(m => { m.assets[0].data = Buffer.alloc(m.assets[0].size, 4).toString("base64"); }));
  await assert.rejects(corrupt(m => { m.assets[0].size++; }));
  await assert.rejects(corrupt(m => { m.assets.push({ ...m.assets[0] }); }));
  await assert.rejects(corrupt(m => { m.assets[0].size = 16*mib+1; }));
  const { result } = await exported(), m = await unpack(result.blob), raw = Buffer.from("unreferenced");
  m.assets.push({ hash:await digest(raw), size:raw.length, data:raw.toString("base64") });
  await assert.rejects(harness().api.openFile(await pack(m)), /[Uu]nreferenced|[Uu]nused/);
});

test("asset paths cannot overwrite fields, traverse prototypes, duplicate references or fabricate final provenance", options, async () => {
  await assert.rejects(corrupt(m => { m.blobRefs[0].path = ["item","name"]; }));
  await assert.rejects(corrupt(m => { m.blobRefs[0].path = ["__proto__","polluted"]; }));
  await assert.rejects(corrupt(m => { m.blobRefs.push({ ...m.blobRefs[0] }); }));
  await assert.rejects(corrupt(m => { m.blobRefs[0].hash = "a".repeat(64); }));
  await assert.rejects(corrupt(m => { m.blobRefs[0].size++; }));
  await assert.rejects(corrupt(m => { m.finalPage.representation = "recorded-save-checkpoint"; }));
  await assert.rejects(corrupt(m => { m.blobRefs[0].mime = "image/png;bad=metadata"; }));
  await assert.rejects(corrupt(m => { m.blobRefs[0].mime = "text/html"; }));
});

test("history event/detail/attachment limits and mismatched MIME metadata remain enforced", options, async () => {
  const saved = page(); saved.item.workHistory = await history([["ai-input.json",new Blob(["{}"], { type:"application/json" })]]);
  await assert.rejects(corrupt(m => { m.page.item.workHistory.events[0].details.text = "x".repeat(12*1024); }, saved));
  await assert.rejects(corrupt(m => { const e = m.page.item.workHistory.events[0]; e.assets.push(...e.assets,...e.assets); }, saved));
  await assert.rejects(corrupt(m => { m.page.item.workHistory.events = Array(5001).fill(m.page.item.workHistory.events[0]); }, saved));
  await assert.rejects(corrupt(m => { m.page.item.workHistory.assets[0].mime = "image/png"; }, saved));
  await assert.rejects(corrupt(m => { m.page.item.workHistory.events[0].assets[0].mime = "image/png"; }, saved));
});

test("compression bombs and native sharing size overflow reject without stripping history", options, async () => {
  const bomb = await pack("x".repeat(2*mib), { expandedBytes:512 });
  assert.ok(bomb.size < 5000);
  await assert.rejects(harness().api.openFile(bomb), /limit|size|large|exceed/i);
  const tooLarge = new Blob([new Uint8Array(64*mib+1)]);
  await assert.rejects(harness().api.openFile(tooLarge), /64 MiB/);
  const saved = page({ preview:new Blob([new Uint8Array(8*mib+1)], { type:"image/png" }) });
  await assert.rejects(exported(saved));
  saved.item.preview = page().item.preview;
  saved.tileEntries = [{ k:"0,0", blob:new Blob([new Uint8Array(16*mib+1)]) }];
  await assert.rejects(exported(saved));
});

test("no compression API and concurrent operations fail explicitly and recover without storage writes", options, async () => {
  const entered = deferred(), release = deferred(); let reads = 0;
  const h = harness(async () => { reads++; entered.resolve(); await release.promise; return page(); });
  const first = h.api.exportSavedPage("saved-page"); await entered.promise;
  await assert.rejects(h.api.exportSavedPage("saved-page")); release.resolve(); await first;
  assert.equal(reads, 1);
  const { result } = await exported();
  await assert.rejects(harness(undefined, { DecompressionStream:undefined }).api.openFile(result.blob));
  await assert.rejects(harness(async () => page(), { CompressionStream:undefined }).api.exportSavedPage("saved-page"));
  const clean = harness(); await assert.rejects(clean.api.openFile(new Blob(["broken"])));
  assert.equal((await clean.api.openFile(result.blob)).historyAvailable, false);
});

test("sign-out during source read or digest aborts export and invalidates opened bundle getters", options, async () => {
  const entered = deferred(), release = deferred();
  const h = harness(async () => { entered.resolve(); await release.promise; return page(); });
  const pending = h.api.exportSavedPage("saved-page"); await entered.promise; h.signOut(); release.resolve();
  await assert.rejects(pending);
  const hashEntered = deferred(), hashRelease = deferred();
  const duringHash = harness(async () => page(), { crypto:{ subtle:{ async digest(...args) {
    hashEntered.resolve(); await hashRelease.promise; return webcrypto.subtle.digest(...args);
  } } } });
  const hashing = duringHash.api.exportSavedPage("saved-page"); await hashEntered.promise;
  duringHash.signOut(); hashRelease.resolve(); await assert.rejects(hashing);
  const receiver = harness(), { result } = await exported(), bundle = await receiver.api.openFile(result.blob);
  receiver.signOut(); await assert.rejects(bundle.getAsset(bundle.attempt.id, bundle.finalPage.asset.hash));
  await assert.rejects(receiver.api.openFile(result.blob));
});

test("prepareSavedPage enriches one saved version without compression and keeps account fences", options, async () => {
  let reads = 0, current = true;
  const saved = page(); saved.assertCurrent = () => { if (!current) throw Error("Account changed"); };
  const h = harness(async () => { reads++; return saved; }, { CompressionStream:undefined, DecompressionStream:undefined });
  const bundle = await h.api.prepareSavedPage(saved.item.id);
  assert.equal(reads, 1); assert.equal(bundle.title, "Algebra"); assert.equal(bundle.historyAvailable, false);
  assert.equal(bundle.submission.source, "local-saved-page");
  assert.equal(bundle.finalPage.representation, "saved-page-thumbnail");
  assert.deepEqual(await bytes(bundle.finalPreview), await bytes(saved.item.preview));
  current = false;
  await assert.rejects(bundle.getAsset(bundle.attempt.id, bundle.finalPage.asset.hash));
  await assert.rejects(h.api.prepareSavedPage(saved.item.id));
});

test("sign-out while decoding a package prevents delivery into a later account", options, async () => {
  const { result } = await exported(), entered = deferred(), release = deferred();
  const receiver = harness(undefined, { crypto:{ subtle:{ async digest(...args) {
    entered.resolve(); await release.promise; return webcrypto.subtle.digest(...args);
  } } } });
  const pending = receiver.api.openFile(result.blob); await entered.promise;
  receiver.signOut(); release.resolve(); await assert.rejects(pending);
});

test("real browser-downloaded work package opens independently with exact recorded inputs", {
  ...options, skip:!process.env.TENET_SUBMISSION_ARTIFACT
}, async t => {
  const file = new Blob([fs.readFileSync(process.env.TENET_SUBMISSION_ARTIFACT)]);
  const bundle = await harness().api.openFile(file);
  assert.equal(bundle.events.length, 8);
  const inputs = bundle.events.filter(event => event.type === "ai.input");
  assert.equal(inputs.length, 1);
  assert.equal(bundle.events.filter(event => event.type === "ai.request").length, 1);
  const input = inputs[0], jsonRef = input.assets.find(asset => asset.name === "ai-input.json");
  assert.ok(jsonRef);
  const bodyBlob = await bundle.getAsset(bundle.attempt.id, jsonRef.hash);
  assert.equal(await digest(await bodyBlob.arrayBuffer()), jsonRef.hash);
  const body = JSON.parse(await bodyBlob.text());
  const imageRef = input.assets.find(asset => /^ai-input\.(png|jpeg|webp)$/.test(asset.name));
  assert.ok(imageRef);
  const image = await bundle.getAsset(bundle.attempt.id, imageRef.hash), candidates = [];
  function collect(value) {
    if (typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(value)) candidates.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  collect(body);
  const imageBytes = await bytes(image);
  assert.ok(candidates.some(data => Buffer.from(data.slice(data.indexOf(",") + 1), "base64").equals(imageBytes)));
  assert.equal(await digest(imageBytes), imageRef.hash);
  assert.ok(bundle.finalPreview.size > 0);
  assert.equal(await digest(await bundle.finalPreview.arrayBuffer()), bundle.finalPage.asset.hash);
  t.diagnostic(JSON.stringify({ compressedBytes:bundle.submission.compressedBytes,
    expandedBytes:bundle.submission.expandedBytes, assetCount:bundle.submission.assetCount,
    events:bundle.events.length, aiInputs:inputs.length, finalPreviewBytes:bundle.finalPreview.size,
    jsonBytes:bodyBlob.size, imageBytes:image.size }));
});
