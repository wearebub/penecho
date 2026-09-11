"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "src/client/app/tenet-native-ink.js"), "utf8");
const PNG = "data:image/png;base64,cHJldmlldw==";

async function harness({ enabled = true, nativeAvailable = true, fingerDrawingEnabled = false } = {}) {
  const frames = new Map(), elements = new Map(), listeners = new Map(), calls = [];
  const win = new EventTarget(), doc = new EventTarget();
  let id = 0, counter = 0, draft = null, nativeSession = null, configureGate = null;
  const records = new Map();
  const makeElement = () => ({ style:{}, hidden:false, textContent:"", setAttribute(){}, closest(){ return null; }, getBoundingClientRect(){ return { x:0,y:0,width:0,height:0 }; } });
  doc.body = { append(element){ elements.set(element.id, element); } };
  doc.getElementById = key => elements.get(key);
  doc.createElement = makeElement;
  doc.querySelectorAll = () => [];
  doc.readyState = "complete";
  doc.hidden = false;
  const view = { contains(){ return false; }, getBoundingClientRect(){ return { x:40,y:120,width:1200,height:800 }; } };
  const state = { currentSnapshotManifestExtensions:{ keep:"original" }, scale:.5, panX:0, panY:0,
    pen:4, inkColor:"#172a3a", mode:"pen", userRevision:0, history:[], future:[],
    hotspotTrail:[], dirty:null, autoEligible:false, navigationLocked:false };
  const empty = () => ({ drawingData:Buffer.from("empty").toString("base64"), previewDataUrl:null, bounds:null, strokeCount:0 });
  records.set(empty().drawingData, empty());
  const native = {
    getConfiguration:async () => ({ valid:true, pencilKitEnabled:enabled, fingerDrawingEnabled }),
    addListener:async (name, callback) => { listeners.set(name, callback); return { remove:async () => listeners.delete(name) }; },
    configureInkSurface:async options => {
      calls.push({ kind:"configure", ...options });
      if (configureGate) { const wait = configureGate; configureGate = null; await wait; }
      if (nativeSession !== options.sessionId) {
        nativeSession = options.sessionId;
        draft = options.drawingData ? records.get(options.drawingData) : empty();
        if (!draft) throw Error("Unknown native archive");
        counter++;
      }
      return { sessionId:nativeSession, revision:counter };
    },
    flushInkSurface:async options => { calls.push({ kind:"flush", ...options }); return { ...draft, sessionId:options.sessionId, revision:counter }; },
    hideInkSurface:async options => { calls.push({ kind:"hide", ...options }); return { ...draft, sessionId:options.sessionId, revision:counter }; },
  };
  win.Capacitor = { getPlatform:() => nativeAvailable ? "ios" : "web", Plugins:{ TenetNative:native } };
  win.PENECHO_CONFIG = { tenetMode:true };
  win.innerWidth = 1280;
  const inkCtx = { drawImage(){} };
  const noop = () => {};
  const context = vm.createContext({ window:win, document:doc, view, state, inkCtx,
    crypto:{ randomUUID:() => `session-${++id}` }, SIZE:20000, MAX_HISTORY:30,
    Event, CustomEvent, AbortController, snapshotLoadInProgress:false, performance,
    ResizeObserver:class { observe(){} unobserve(){} disconnect(){} },
    MutationObserver:class { observe(){} disconnect(){} },
    Image:class { naturalWidth=500; naturalHeight=200; set src(value){ queueMicrotask(() => this.onload?.()); } },
    getComputedStyle:() => ({ display:"block", visibility:"visible" }),
    requestAnimationFrame:callback => { const n = ++id; frames.set(n, callback); return n; },
    cancelAnimationFrame:n => frames.delete(n), setTimeout:() => ++id, clearTimeout:noop,
    requestCommittedInkRender:noop, requestInteractionLayerRender:noop, requestRender:noop,
    canvasViewportMetrics:() => ({ width:1200, height:800 }),
    canvasAgentDidCommitUserCanvasChange:noop, supersedeActiveAI:noop, schedule:noop,
    updateCoordinates:noop, invalidateRecognition:noop, commitSelection:noop,
    snapshotExtensionObject:value => JSON.parse(JSON.stringify(value)),
    mergeDirtyBox:box => { state.dirty = box; },
    intersection:(a,b) => {
      const x=Math.max(a.x,b.x), y=Math.max(a.y,b.y);
      const w=Math.min(a.x+a.w,b.x+b.w)-x, h=Math.min(a.y+a.h,b.y+b.h)-y;
      return w>0&&h>0 ? {x,y,w,h} : null;
    },
    unionLocalBounds:(a,b) => {
      if (!a) return b; if (!b) return a;
      const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y);
      return {x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};
    },
    save:() => {
      if (state.tenetNativeHistoryBefore === undefined) return;
      state.history.push({tiles:[],nativeInkBefore:state.tenetNativeHistoryBefore,nativeInkAfter:context.controller.snapshot()});
      state.tenetNativeHistoryBefore=undefined;
    },
    applyHistory:(entry,side) => context.controller.applyHistory(entry,side),
  });
  vm.runInContext(`${SOURCE}\nglobalThis.controller=tenetInkController; globalThis.manifest=tenetInkManifestExtensions; globalThis.bounds=tenetInkBounds;`, context);
  const settle = async () => {
    for (let n=0;n<12;n++) {
      await new Promise(resolve => setImmediate(resolve));
      const batch=[...frames.values()]; frames.clear();
      for (const callback of batch) callback(performance.now());
    }
  };
  await settle();
  const addStroke = async (name="stroke-1") => {
    draft={drawingData:Buffer.from(name).toString("base64"),previewDataUrl:PNG,bounds:{x:100,y:150,w:500,h:200},strokeCount:1};
    records.set(draft.drawingData,draft);
    const event={...draft,sessionId:nativeSession,revision:++counter,changedBounds:{x:100,y:150,w:500,h:200},metrics:{serializationMs:3}};
    listeners.get("inkSurfaceChanged")?.(event);
    await settle();
    return event;
  };
  return { context, win, doc, native, listeners, state, calls, settle, addStroke, inkCtx,
    api:win.TenetInk, controller:context.controller,
    gate:promise => { configureGate=promise; },
    currentSession:() => nativeSession,
  };
}

test("Web remains default; new native sessions omit empty drawingData and honor managed policy", async () => {
  const h=await harness();
  assert.equal(h.api.getStatus().engine,"web");
  assert.equal(h.api.getStatus().nativeAvailable,true);
  assert.equal(h.calls[0].visible,false);
  assert.equal(Object.hasOwn(h.calls[0],"drawingData"),false);
  assert.equal(h.calls[0].fingerDrawing,false);
  assert.equal(h.calls[0].width,8);
  const denied=await harness({enabled:false});
  await assert.rejects(denied.api.setEngine("pencilkit"),/disabled/);
  assert.equal(denied.calls.length,0);
});

test("top bars exclude only overlapping surface area without changing ink coordinates", async () => {
  const h = await harness();
  let headerHeight = 96;
  const header = { hidden:false, closest:() => null, getBoundingClientRect:() => ({ x:0, y:24, width:1280, height:headerHeight }) };
  h.doc.querySelectorAll = selector => selector.includes(".topbar") ? [header] : [];
  await h.api.setEngine("pencilkit");
  await h.settle();
  let latest = h.calls.filter(call => call.kind === "configure").at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(latest.exclusions)), [], "a header ending at the canvas edge needs no hole");
  headerHeight = 128;
  h.controller.sync();
  await h.settle();
  latest = h.calls.filter(call => call.kind === "configure").at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(latest.exclusions)), [{ x:40, y:120, width:1200, height:36 }], "overlapping UI includes its four-pixel touch margin");
  assert.deepEqual(JSON.parse(JSON.stringify(latest.frame)), { x:40, y:120, width:1200, height:800 });
  assert.equal(latest.panY, 0);
  assert.equal(latest.scale, .5);
});

test("finger preference can narrow native input but cannot override a managed refusal", async () => {
  const allowed = await harness({ fingerDrawingEnabled:true });
  assert.equal(allowed.api.fingerDrawingAllowed(), true);
  allowed.win.TenetDrawingPreferences = { fingerDrawing:() => false };
  allowed.controller.sync();
  await allowed.settle();
  assert.equal(allowed.calls.filter(call => call.kind === "configure").at(-1).fingerDrawing, false);
  allowed.win.TenetDrawingPreferences = { fingerDrawing:() => true };
  allowed.controller.sync();
  await allowed.settle();
  assert.equal(allowed.calls.filter(call => call.kind === "configure").at(-1).fingerDrawing, true);
  const denied = await harness({ fingerDrawingEnabled:false });
  denied.win.TenetDrawingPreferences = { fingerDrawing:() => true };
  denied.controller.sync();
  await denied.settle();
  assert.equal(denied.api.fingerDrawingAllowed(), false);
  assert.equal(denied.calls.filter(call => call.kind === "configure").at(-1).fingerDrawing, false);
});

test("switching retains vector archives, bounded preview and unrelated notebook metadata", async () => {
  const h=await harness();
  await h.api.setEngine("pencilkit");
  const packet=await h.addStroke();
  await h.api.setEngine("web");
  const saved=h.context.manifest();
  assert.equal(saved.keep,"original");
  assert.equal(saved.tenetNativeInk.drawingData,packet.drawingData);
  assert.equal(saved.tenetNativeInk.strokeCount,1);
  assert.equal(h.calls.filter(c=>c.kind==="configure").at(-1).visible,false);
  await h.api.setEngine("pencilkit");
  assert.equal(h.controller.snapshot().drawingData,packet.drawingData);
});

test("native changes create shared undo/redo entries, and clear stays undoable", async () => {
  const h=await harness();
  await h.api.setEngine("pencilkit");
  await h.addStroke();
  assert.equal(h.state.history.length,1);
  await h.controller.history("before");
  await h.settle();
  assert.equal(h.controller.snapshot()?.strokeCount || 0,0);
  assert.equal(h.state.future.length,1);
  await h.controller.history("after");
  await h.settle();
  assert.equal(h.controller.snapshot().strokeCount,1);
  h.controller.stageClear();
  h.context.save();
  await h.settle();
  assert.equal(h.controller.snapshot(),null);
  await h.controller.history("before");
  await h.settle();
  assert.equal(h.controller.snapshot().strokeCount,1);
});

test("late native callbacks cannot resurrect ink on a newly opened page", async () => {
  const h=await harness();
  await h.api.setEngine("pencilkit");
  const old=await h.addStroke();
  h.controller.restore(null);
  h.listeners.get("inkSurfaceChanged")({...old,revision:old.revision+100});
  await h.settle();
  assert.equal(h.controller.snapshot(),null);
  assert.notEqual(h.currentSession(),old.sessionId);
});

test("corrupt or future native archives reject before replacing the current page", async () => {
  const h=await harness();
  await h.api.setEngine("pencilkit");
  await h.addStroke();
  const before=h.controller.snapshot();
  await assert.rejects(h.controller.prepare({...before,version:2}),/newer native ink format/);
  await assert.rejects(h.controller.prepare({...before,drawingData:"!invalid!"}),/archive is invalid/);
  await assert.rejects(h.controller.prepare({...before,previewDataUrl:"https://example.com/ink.png"}),/preview is invalid/);
  assert.equal(h.controller.snapshot(),before);
});

test("AI/export composition includes native ink without doubling the onscreen overlay", async () => {
  const h=await harness();
  await h.api.setEngine("pencilkit");
  await h.addStroke();
  let screenDraws=0, exportDraws=0;
  h.inkCtx.drawImage=()=>screenDraws++;
  h.controller.draw(h.inkCtx,null);
  h.controller.draw({drawImage:()=>exportDraws++},null);
  assert.equal(screenDraws,0);
  assert.equal(exportDraws,1);
  await h.api.setEngine("web");
  h.controller.draw(h.inkCtx,null);
  assert.equal(screenDraws,1);
});

test("flush and switching refuse active native strokes", async () => {
  const h=await harness();
  await h.api.setEngine("pencilkit");
  h.listeners.get("inkSurfaceActivity")({sessionId:h.currentSession(),active:true});
  await assert.rejects(h.api.flush(),/Lift the Pencil/);
  await assert.rejects(h.api.setEngine("web"),/Finish the current action/);
  h.listeners.get("inkSurfaceActivity")({sessionId:h.currentSession(),active:false});
  await h.api.setEngine("web");
});

test("navigation uses viewport-relative centers and does not drift by the header height", async () => {
  const h=await harness();
  h.listeners.get("inkSurfaceNavigation")({sessionId:h.currentSession(),centerX:640,centerY:520,scaleFactor:2,dx:0,dy:0});
  assert.equal(h.state.scale,1);
  assert.equal(h.state.panX,-600);
  assert.equal(h.state.panY,-400);
});

test("finger pan updates the shared viewport without changing its zoom", async () => {
  const h = await harness();
  const navigate = h.listeners.get("inkSurfaceNavigation");
  const sessionId = h.currentSession();
  navigate({ sessionId, centerX: 340, centerY: 420, scaleFactor: 1, dx: 35, dy: -90 });
  navigate({ sessionId, centerX: 375, centerY: 330, scaleFactor: 1, dx: -10, dy: -20 });
  assert.equal(h.state.scale, 0.5);
  assert.equal(h.state.panX, 25);
  assert.equal(h.state.panY, -110);
});

test("native ink counts as content from first contact through snapshot acceptance and restore", async () => {
  const h = await harness();
  const sessionId = h.currentSession();
  const activity = h.listeners.get("inkSurfaceActivity");
  assert.equal(h.controller.hasContent(), false);
  activity({ sessionId, active: true, tool: "ink" });
  assert.equal(h.controller.hasContent(), true);
  activity({ sessionId, active: false, tool: "ink", completed: true });
  assert.equal(h.controller.hasContent(), true, "lifting must not flash the welcome while encoding finishes");
  h.addStroke();
  await h.settle();
  assert.equal(h.controller.snapshot().strokeCount, 1);
  assert.equal(h.controller.hasContent(), true);
  const prepared = await h.controller.prepare(h.controller.snapshot());
  h.controller.restore(null);
  assert.equal(h.controller.hasContent(), false);
  h.controller.restore(prepared);
  assert.equal(h.controller.hasContent(), true, "saved native-only pages are not empty in either engine");
});

test("eraser activity, canceled ink and old-session activity do not leave an empty page populated", async () => {
  const h = await harness();
  const sessionId = h.currentSession();
  const activity = h.listeners.get("inkSurfaceActivity");
  activity({ sessionId, active: true, tool: "eraser" });
  assert.equal(h.controller.hasContent(), false);
  activity({ sessionId, active: false, tool: "eraser", completed: true });
  activity({ sessionId, active: true, tool: "ink" });
  assert.equal(h.controller.hasContent(), true);
  activity({ sessionId, active: false, tool: "ink", completed: false });
  assert.equal(h.controller.hasContent(), false);
  h.controller.restore(null);
  activity({ sessionId, active: true, tool: "ink" });
  assert.equal(h.controller.hasContent(), false, "old page callbacks cannot dismiss the new page's welcome");
});

test("a viewport change during an in-flight bridge call is replayed", async () => {
  const h=await harness();
  let release;
  h.gate(new Promise(resolve=>{release=resolve;}));
  h.state.panX=10; h.controller.sync();
  await h.settle();
  h.state.panX=40; h.controller.sync();
  release();
  await h.settle();
  assert.equal(h.calls.filter(c=>c.kind==="configure").at(-1).panX,40);
});

test("the real client includes the importer inside the canvas closure and flushes capture paths", () => {
  const read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");
  const builder=read("scripts/build-client.js");
  assert.ok(builder.indexOf('"src/client/app/tenet-ipad-usability.js"')<builder.indexOf('"src/client/app/ui-bootstrap.js"'));
  assert.match(read("src/client/app/persistence.js"),/async function renderExportCanvas\(\) \{\s*await tenetInkFlush\(\)/);
  assert.match(read("src/client/app/canvas-agent-runtime.js"),/async function canvasAgentCapture\(args,options\) \{\s*await tenetInkFlush\(\)/);
  const aiRuntime = read("src/client/app/ai-runtime.js");
  const requestStart = aiRuntime.indexOf("async function requestAI(");
  assert.notEqual(requestStart, -1, "requestAI must exist");
  const request = aiRuntime.slice(requestStart);
  // Tenet action normalization is safe before the unconditional flush. Capture
  // must still wait for it, and a flush failure must return rather than proceed.
  assert.match(request, /^async function requestAI[^\n]*\n\s*(?:if \(window\.PENECHO_CONFIG\?\.tenetMode && action === "answer"\) action = "hint";\s*)?try \{ await tenetInkFlush\(\); \}\s*catch \(error\) \{[^\n]*return; \}/);
  const flushIndex = request.indexOf("await tenetInkFlush()");
  for (const capture of ["planViewportImage(", "prepareVisibleWidgetSnapshots(", "buildViewportImage(", "emergencyViewportImage("]) {
    const captureIndex = request.indexOf(capture);
    assert.ok(captureIndex > flushIndex, `${capture} must occur after the awaited native ink flush`);
  }
  assert.doesNotMatch(read("src/client/app/tenet-native-bridge.js"),/new DataTransfer|fetch\(result.dataUrl\)/);
});
