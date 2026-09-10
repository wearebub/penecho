"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");

// JS tests execute the actual controller with a mock Capacitor transport.
// Swift tests inspect source contracts only. They do not compile Swift, execute
// PencilKit geometry, inspect installed voices, or prove physical-device behavior.
const jsSource = readFileSync(path.join(__dirname, "../src/client/app/tenet-native-ink.js"), "utf8");
const inkSwift = readFileSync(path.join(__dirname, "../tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetInkSurface.swift"), "utf8");
const voiceSwift = readFileSync(path.join(__dirname, "../tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetVoiceSession.swift"), "utf8");
const copy = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const polygon = [{ x: 80, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 160 }, { x: 80, y: 160 }];

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing source-contract boundary: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing source-contract boundary: ${end}`);
  return source.slice(from, to);
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
      return true;
    },
  }, extra);
}

function element(selector, rect) {
  return {
    selector, hidden: false,
    getBoundingClientRect: () => ({ ...rect }),
    closest: () => null,
    setAttribute() {},
  };
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

async function harness({ engine = "pencilkit" } = {}) {
  const calls = [], nativeListeners = new Map(), frames = new Map(), observers = {};
  const committed = [];
  let frameId = 0, commandHandler = null, flushHandler = null;
  let packet = { sessionId: "", revision: 0, drawingData: "ZW1wdHk=", strokeCount: 0, bounds: null, previewDataUrl: null };
  const controls = [
    element(".tenet-voice-entry", { x: 850, y: 20, width: 100, height: 44 }),
    element(".tenet-ai-entry", { x: 730, y: 20, width: 100, height: 44 }),
    element("#tenetNotebookCollapse", { x: 20, y: 20, width: 44, height: 44 }),
  ];
  const view = element("#view", { x: 0, y: 0, width: 1000, height: 700 });
  view.contains = target => target === view;
  const state = {
    mode: "pen", pen: 5, scale: 1, inkColor: "#123456", panX: 0, panY: 0,
    drawing: false, viewMode: false, navigationLocked: false, selection: null,
    currentSnapshotManifestExtensions: {}, history: [], future: [], userRevision: 0,
    hotspotTrail: [], autoEligible: false,
  };
  const bridge = {
    async getConfiguration() { return { valid: true, pencilKitEnabled: true, fingerDrawingEnabled: true }; },
    async addListener(name, listener) {
      nativeListeners.set(name, listener);
      return { remove: async () => nativeListeners.delete(name) };
    },
    async configureInkSurface(options) {
      calls.push({ method: "configure", options: copy(options) });
      if (packet.sessionId !== options.sessionId) {
        packet = { sessionId: options.sessionId, revision: packet.revision + 1,
          drawingData: "ZW1wdHk=", strokeCount: 0, bounds: null, previewDataUrl: null };
      }
      return { sessionId: options.sessionId, revision: packet.revision };
    },
    async flushInkSurface(options) {
      calls.push({ method: "flush", options: copy(options) });
      return flushHandler ? flushHandler(options) : copy(packet);
    },
    async hideInkSurface(options) {
      calls.push({ method: "hide", options: copy(options) });
      return copy(packet);
    },
    async inkSurfaceCommand(options) {
      calls.push({ method: "command", options: copy(options) });
      return commandHandler ? commandHandler(options) : { ...copy(packet), moved: 0 };
    },
  };
  const document = eventTarget({
    hidden: false, readyState: "complete", activeElement: null,
    body: { append() {} },
    getElementById: () => null,
    createElement: () => ({ setAttribute() {} }),
    querySelectorAll: selectors => controls.filter(control => selectors.split(",").map(value => value.trim()).includes(control.selector)),
  });
  const window = eventTarget({
    PENECHO_CONFIG: { tenetMode: true },
    Capacitor: { getPlatform: () => "ios", Plugins: { TenetNative: bridge } },
    innerWidth: 1000,
  });
  class FixtureImage {
    naturalWidth = 20;
    naturalHeight = 10;
    set src(value) { this.source = value; queueMicrotask(() => this.onload?.()); }
  }
  const noop = () => {};
  const context = vm.createContext({
    window, document, state, view, SIZE: 20_000, MAX_HISTORY: 30, inkCtx: {},
    snapshotLoadInProgress: false, crypto: { randomUUID }, AbortController, Image: FixtureImage,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.elements = []; observers.resize = this; }
      observe(node) { this.elements.push(node); }
      disconnect() {}
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.mutation = this; }
      observe(node, options) { this.options = options; }
      disconnect() {}
    },
    getComputedStyle: node => ({ display: node.display || "block", visibility: node.visibility || "visible" }),
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: () => 1, clearTimeout: noop,
    canvasViewportMetrics: () => ({ width: 1000, height: 700 }),
    snapshotExtensionObject: value => value,
    intersection: intersect, unionLocalBounds: union,
    requestCommittedInkRender: noop, requestInteractionLayerRender: noop,
    save: noop, mergeDirtyBox: noop, schedule: noop,
    canvasAgentDidCommitUserCanvasChange: entry => committed.push(entry),
    supersedeActiveAI: noop, updateCoordinates: noop, requestRender: noop,
    commitSelection: noop, invalidateRecognition: noop, applyHistory: noop,
  });
  vm.runInContext(jsSource, context, { filename: "tenet-native-ink.js", timeout: 1000 });
  async function drain() {
    for (let attempt = 0; attempt < 25; attempt++) {
      await turn();
      if (!frames.size) return;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
    assert.fail("Native controller did not settle within 25 animation-frame batches");
  }
  await drain();
  if (engine === "pencilkit") {
    await window.TenetInk.setEngine("pencilkit");
    await drain();
  }
  return {
    state, context, window, controls, calls, observers, committed, drain,
    controller: context.tenetInkController,
    configuration: () => calls.filter(call => call.method === "configure").at(-1).options,
    packet: () => copy(packet),
    setPacket(value) { packet = copy(value); },
    setCommandHandler(handler) { commandHandler = handler; },
    setFlushHandler(handler) { flushHandler = handler; },
    emitNative(name, value) { nativeListeners.get(name)?.(copy(value)); },
    async width(value) {
      // ui-bootstrap owns the width clamp; this fixture supplies its resulting
      // state and bubbling #penSize input, including an unchanged preset value.
      state.pen = value;
      document.dispatchEvent({ type: "input", target: { id: "penSize" } });
      await drain();
    },
    async seedStroke() {
      packet = { ...packet, revision: packet.revision + 1, drawingData: "c3Ryb2tl", strokeCount: 1,
        bounds: { x: 100, y: 100, w: 20, h: 10 }, previewDataUrl: "data:image/png;base64,cG5n" };
      await window.TenetInk.flush();
      await drain();
    },
  };
}

test("JS behavior: explicit width inputs and repeated presets reach native without reactivating the pen", async () => {
  const h = await harness();
  const initial = h.configuration();
  await h.width(8);
  const first = h.configuration();
  assert.equal(first.width, 8);
  assert.equal(first.widthRequestId, initial.widthRequestId + 1);
  assert.equal(first.toolRequestId, initial.toolRequestId);
  const count = h.calls.filter(call => call.method === "configure").length;
  await h.width(8);
  assert.equal(h.configuration().widthRequestId, first.widthRequestId + 1);
  assert.equal(h.configuration().width, 8);
  assert.equal(h.configuration().color, initial.color);
  assert.equal(h.configuration().toolRequestId, initial.toolRequestId);
  assert.equal(h.calls.filter(call => call.method === "configure").length, count + 1);
});

test("JS behavior: passive zoom preserves native width; an explicit repeated preset uses the current zoom", async () => {
  const h = await harness();
  const initial = h.configuration();
  h.state.scale = 2;
  h.controller.sync();
  await h.drain();
  assert.equal(h.configuration().width, initial.width);
  assert.equal(h.configuration().widthRequestId, initial.widthRequestId);
  await h.width(5);
  assert.equal(h.configuration().width, 2.5);
  assert.equal(h.configuration().widthRequestId, initial.widthRequestId + 1);
});

test("JS behavior: visible Talk, AI, and notebook-collapse controls exclude native hit testing", async () => {
  const h = await harness();
  for (const control of h.controls) {
    assert.ok(h.configuration().exclusions.some(rect => JSON.stringify(rect) === JSON.stringify(control.getBoundingClientRect())));
    assert.ok(h.observers.resize.elements.includes(control));
  }
  assert.equal(h.observers.mutation.options.childList, true);
  assert.equal(h.observers.mutation.options.subtree, true);
  h.controls[0].hidden = true;
  h.observers.mutation.callback();
  await h.drain();
  assert.equal(h.configuration().exclusions.length, 2);
});

test("JS behavior: invalid move coordinates and oversized polygons reject before transport", async () => {
  const h = await harness();
  const invalid = [
    [null, 1, 1], [polygon.slice(0, 2), 1, 1], [Array.from({ length: 257 }, () => polygon[0]), 1, 1],
    [[{ x: NaN, y: 0 }, ...polygon], 1, 1], [[{ x: -1, y: 0 }, ...polygon], 1, 1],
    [[{ x: 20_001, y: 0 }, ...polygon], 1, 1], [polygon, Infinity, 1], [polygon, 0, 20_001],
  ];
  for (const args of invalid) await assert.rejects(h.controller.moveRegion(...args), /bounded selection/);
  assert.equal(h.calls.filter(call => call.method === "command").length, 0);
  assert.equal(h.window.TenetInk.getStatus().busy, false);
});

test("JS behavior: region movement requires PencilKit and an idle page", async () => {
  const web = await harness({ engine: "web" });
  assert.equal(web.window.TenetInk.getStatus().engine, "web");
  await assert.rejects(web.controller.moveRegion(polygon, 1, 1), /active PencilKit engine/);
  const h = await harness();
  assert.equal(h.window.TenetInk.getStatus().engine, "pencilkit");
  h.state.drawing = true;
  await assert.rejects(h.controller.moveRegion(polygon, 1, 1), /Finish the current action/);
  h.state.drawing = false;
  h.context.snapshotLoadInProgress = true;
  await assert.rejects(h.controller.moveRegion(polygon, 1, 1), /Finish the current action/);
  h.context.snapshotLoadInProgress = false;
  h.emitNative("inkSurfaceActivity", { sessionId: h.packet().sessionId, active: true, tool: "ink" });
  await assert.rejects(h.controller.moveRegion(polygon, 1, 1), /Finish the current action/);
  assert.equal(h.calls.filter(call => call.method === "command").length, 0);
});

test("JS behavior: one move command consumes its vector packet once across event and promise delivery", async () => {
  const h = await harness();
  await h.seedStroke();
  const before = h.controller.snapshot(), historyLength = h.state.history.length;
  const revision = h.state.userRevision, commits = h.committed.length;
  h.state.future = [{}];
  h.setCommandHandler(() => {
    // This is a transport fixture, not an implementation of native geometry.
    const moved = { ...h.packet(), revision: h.packet().revision + 1, moved: 1,
      drawingData: "bW92ZWQ=", bounds: { x: 107, y: 103, w: 20, h: 10 },
      changedBounds: { x: 100, y: 100, w: 27, h: 13 } };
    h.setPacket(moved);
    h.emitNative("inkSurfaceChanged", moved);
    return moved;
  });
  const start = h.calls.length;
  assert.deepEqual(copy(await h.controller.moveRegion(polygon, 7, 3)), { moved: 1 });
  const moveCalls = h.calls.slice(start);
  const commandIndex = moveCalls.findIndex(call => call.method === "command");
  assert.ok(commandIndex > 0);
  assert.ok(moveCalls.slice(0, commandIndex).some(call => call.method === "flush"));
  assert.ok(moveCalls.slice(0, commandIndex).some(call => call.method === "configure" && call.options.visible === false));
  assert.equal(moveCalls.filter(call => call.method === "command").length, 1);
  assert.deepEqual(moveCalls[commandIndex].options, {
    sessionId: h.packet().sessionId, command: "move-region", points: polygon, dx: 7, dy: 3,
  });
  assert.equal(h.state.history.length, historyLength + 1);
  const entry = h.state.history.at(-1);
  assert.equal(entry.nativeInkBefore, before);
  assert.equal(entry.nativeInkAfter.drawingData, "bW92ZWQ=");
  assert.equal(entry.tiles.length, 0);
  assert.equal(h.state.future.length, 0);
  assert.equal(h.state.userRevision, revision + 1);
  assert.equal(h.committed.length, commits + 1);
  assert.equal(h.window.TenetInk.getStatus().busy, false);
  await h.drain();
  assert.equal(h.configuration().visible, true);
});

test("JS behavior: an empty move result creates no history entry", async () => {
  const h = await harness();
  await h.seedStroke();
  const before = h.controller.snapshot(), historyLength = h.state.history.length;
  assert.deepEqual(copy(await h.controller.moveRegion(polygon, 0, 0)), { moved: 0 });
  assert.equal(h.controller.snapshot(), before);
  assert.equal(h.state.history.length, historyLength);
  assert.equal(h.window.TenetInk.getStatus().busy, false);
});

test("JS behavior: a rejected bridge command preserves accepted JS ink/history and releases the lock", async () => {
  const h = await harness();
  await h.seedStroke();
  const before = h.controller.snapshot(), historyLength = h.state.history.length;
  h.setCommandHandler(() => { throw Error("Move destination outside the page"); });
  await assert.rejects(h.controller.moveRegion(polygon, 7, 3), /outside the page/);
  assert.equal(h.controller.snapshot(), before);
  assert.equal(h.state.history.length, historyLength);
  assert.equal(h.window.TenetInk.getStatus().busy, false);
  await h.drain();
  assert.equal(h.configuration().visible, true);
});

test("JS behavior: a page replacement during flush prevents a stale move command", async () => {
  const h = await harness();
  let release;
  h.setFlushHandler(() => new Promise(resolve => { release = resolve; }));
  const moving = h.controller.moveRegion(polygon, 1, 1);
  const rejected = assert.rejects(moving, /page changed/i);
  await turn();
  assert.equal(typeof release, "function");
  h.controller.restore(null);
  release(h.packet());
  await rejected;
  h.setFlushHandler(null);
  assert.equal(h.calls.filter(call => call.method === "command").length, 0);
  assert.equal(h.controller.snapshot(), null);
  assert.equal(h.window.TenetInk.getStatus().busy, false);
  await h.drain();
});

test("Swift source contract only: explicit widths preserve native ink/color and bypass palette normalization", () => {
  const settings = section(inkSwift, "private struct InkSurfaceSettings", "private struct InkRegionMove");
  assert.match(settings, /call\.getValue\("widthRequestId"\)/);
  assert.match(settings, /widthRequestId == other\.widthRequestId/);
  assert.match(settings, /else \{ widthRequestId = 0 \}/);
  const apply = section(inkSwift, "private func apply(_ next:", "private func configurationResult");
  assert.match(apply, /next\.widthRequestId != \(settings\?\.widthRequestId \?\? 0\)/);
  assert.match(apply, /selected = PKInkingTool\(ink\.inkType,/);
  assert.match(apply, /color: changeColor \? next\.color : ink\.color/);
  assert.match(apply, /width: changeWidth \? next\.width : ink\.width/);
  assert.match(apply, /styleOnlyRequest && !\(canvas\.tool is PKInkingTool\)/);
  assert.ok(apply.indexOf("canvas.tool = selected") > apply.indexOf("picker.selectedTool = selected"));
  assert.doesNotMatch(apply, /canvas\.drawing\s*=/);
  const picker = section(inkSwift, "private func synchronizePickerTool()", "func pencilInteractionDidTap");
  assert.match(picker, /if changed \|\| applyingTool \{ canvas\.tool = selected \}/);
});

test("Swift source contract only: installed Apple voices stay in-language with quality before locale tie-breaking", () => {
  const rank = section(voiceSwift, "private static func voiceQualityRank", "private static func voiceQualityName");
  assert.match(rank, /#available\(iOS 16\.0, \*\), voice\.quality == \.premium \{ return 3 \}/);
  assert.match(rank, /voice\.quality == \.enhanced \? 2 : 1/);
  const preferred = section(voiceSwift, "private static func preferredVoice", "private static func validSessionId");
  assert.match(preferred, /AVSpeechSynthesisVoice\.speechVoices\(\)\.filter/);
  assert.match(preferred, /voice\.identifier\.hasPrefix\("com\.apple\."\)/);
  assert.match(preferred, /candidate\.split\(separator: "-"\)\.first == language/);
  assert.match(preferred, /if firstQuality != secondQuality \{ return firstQuality > secondQuality \}/);
  assert.ok(preferred.indexOf("if firstQuality != secondQuality") < preferred.indexOf("if firstExact != secondExact"));
  assert.match(preferred, /return first\.identifier < second\.identifier/);
  assert.doesNotMatch(preferred, /AVSpeechSynthesisVoice\(language:|URLSession/);
  const capabilities = section(voiceSwift, "func capabilities(locale:", "func start(_ call:");
  for (const key of ["voiceName", "voiceQuality", "voiceLocale", "voiceNeedsDownload"]) {
    assert.ok(capabilities.includes(`"${key}"`));
  }
  assert.match(capabilities, /Self\.voiceQualityRank\(voice\) < 2/);
  assert.match(capabilities, /Self\.preferredVoice\(locale: selected\)/);
  const speak = section(voiceSwift, "func speak(_ call:", "func stopSpeaking()");
  assert.match(speak, /Self\.preferredVoice\(locale: locale\)/);
  assert.match(speak, /let lease = authority\(\)/);
  assert.match(voiceSwift, /request\.requiresOnDeviceRecognition = true/);
});

test("Swift source contract only: region geometry is bounded and changes only copied stroke translation", () => {
  const region = section(inkSwift, "private struct InkRegionMove", "private struct InkStrokeStamp");
  assert.match(region, /\(3\.\.\.256\)\.contains\(supplied\.count\)/);
  assert.match(region, /\(0\.\.\.inkDocumentSize\)\.contains\(point\.x\)/);
  assert.match(region, /\(0\.\.\.inkDocumentSize\)\.contains\(point\.y\)/);
  assert.match(region, /Self\.intersects\(/);
  assert.match(region, /abs\(area\) > 0\.000001/);
  assert.match(region, /abs\(dx\) <= inkDocumentSize, abs\(dy\) <= inkDocumentSize/);
  assert.match(region, /strokes\.count <= 20_000, strokes\.count \* points\.count <= 2_000_000/);
  assert.match(region, /corners\.allSatisfy/);
  assert.match(region, /Self\.crossesInterior\(/);
  assert.match(region, /where encloses\(strokes\[index\]\.renderBounds\)/);
  assert.match(region, /var stroke = strokes\[index\]/);
  assert.match(region, /transform\.tx \+= dx/);
  assert.match(region, /transform\.ty \+= dy/);
  assert.match(region, /stroke\.transform = transform/);
  assert.match(region, /guard Self\.withinPage\(stroke\.renderBounds\)/);
  assert.doesNotMatch(region, /stroke\.(?:ink|path|mask|randomSeed)\s*=/);
  assert.doesNotMatch(region, /canvas\.drawing|\.image\(|pngData\(/);
  const number = section(inkSwift, "private func inkNumber", "private func inkHexColor");
  assert.match(number, /CFGetTypeID\(number\) != CFBooleanGetTypeID\(\)/);
  assert.match(number, /number\.doubleValue\.isFinite/);
});

test("Swift source contract only: move validation/encoding precede guarded mutation and vector undo/packet delivery", () => {
  const command = section(inkSwift, "func command(_ call:", "private func moveRegion(_ call:");
  assert.match(command, /try requireSession\(call\)/);
  assert.match(command, /guard policy\(\)\.enabled/);
  assert.match(command, /if command == "move-region" \{ moveRegion\(call\); return \}/);
  const move = section(inkSwift, "private func moveRegion(_ call:", "private func replaceDrawing");
  const encode = move.indexOf("EncodedInk.make(candidate.drawing");
  const commit = move.indexOf('undoableReplace(candidate.drawing, actionName: "Move Ink")');
  assert.ok(encode >= 0 && commit > encode);
  assert.ok(move.indexOf("try InkRegionMove(call)") < commit);
  assert.ok(move.indexOf("sessionId == expectedSession, revision == expectedRevision") < commit);
  assert.match(move, /policy\(\)\.enabled, !applicationSuspended/);
  assert.match(move, /inputSuspended = true/);
  assert.match(move, /case \.failure\(let error\): reject\(call, error\)/);
  assert.match(move, /cached = \(session, revision, encoded\)/);
  assert.match(move, /value\["moved"\] = candidate\.moved/);
  assert.ok(move.indexOf("emitChanged(value)", commit) < move.indexOf("call.resolve(value)", commit));
  const undo = section(inkSwift, "private func undoableReplace", "private func apply(_ next:");
  assert.match(undo, /registerUndo\(withTarget: self\)/);
  assert.match(undo, /target\.undoableReplace\(previous, actionName: actionName\)/);
  assert.match(undo, /replaceDrawing\(drawing, resetUndo: false\)/);
});

test("Swift source contract only: exclusion masks subtract overlapping holes with bounded disjoint visible pieces", () => {
  const clip = section(inkSwift, "private final class InkClipView: UIView", "private struct InkToolActivity");
  assert.match(clip, /didSet \{ rebuildExclusionMask\(\) \}/);
  assert.match(clip, /override func layoutSubviews\(\) \{\s*super\.layoutSubviews\(\)\s*rebuildExclusionMask\(\)/);
  assert.match(clip, /maximumMaskPieces = 4096/);
  assert.match(clip, /finiteRectangle\(bounds\), !bounds\.isEmpty, exclusions\.count <= 128/);
  assert.match(clip, /guard finiteRectangle\(exclusion\) else \{ return \[\] \}/);
  assert.match(clip, /var visible = \[bounds\]/);
  assert.match(clip, /let hole = exclusion\.intersection\(bounds\)/);
  assert.match(clip, /let overlap = rect\.intersection\(hole\)/);
  assert.match(clip, /width: rect\.width, height: overlap\.minY - rect\.minY/);
  assert.match(clip, /width: rect\.width, height: rect\.maxY - overlap\.maxY/);
  assert.match(clip, /width: overlap\.minX - rect\.minX, height: overlap\.height/);
  assert.match(clip, /width: rect\.maxX - overlap\.maxX, height: overlap\.height/);
  assert.match(clip, /guard remaining\.count <= maximumMaskPieces else \{ return \[\] \}/);
  assert.match(clip, /visible = remaining/);
  assert.match(clip, /path\.addRect\(rect\.offsetBy\(dx: -surface\.minX, dy: -surface\.minY\)\)/);
  assert.match(clip, /CATransaction\.setDisableActions\(true\)/);
  assert.match(clip, /exclusionMask\.fillRule = \.nonZero/);
  assert.match(clip, /layer\.mask = exclusionMask/);
  assert.match(clip, /super\.point\(inside: point, with: event\) && !exclusions\.contains \{ \$0\.contains\(point\) \}/);
  assert.doesNotMatch(clip, /\.evenOdd|canvas\.drawing|canvas\.frame|drawingPolicy|insertSubview/);
});
