import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const inkSource = read("../src/client/app/tenet-native-ink.js");
const uiSource = read("../src/client/app/tenet-process-ui.js");
const nativeSource = read("../tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetInkSurface.swift");
const plain = value => JSON.parse(JSON.stringify(value));

async function harness({ readOnly = false } = {}) {
  const frames = new Map(), listeners = new Map(), observers = new Set(), calls = [];
  const window = new EventTarget(), document = new EventTarget();
  let nextId = 0, revision = 0, sessionId = null;
  let draft = { drawingData:"ZW1wdHk=", previewDataUrl:null, bounds:null, strokeCount:0 };
  function mutate(target, type, attributeName) {
    for (const observer of observers) {
      const options = observer.options;
      if (!options || !observer.target.contains(target)) continue;
      if (type === "attributes" && (!options.attributes || !options.attributeFilter.includes(attributeName))) continue;
      if (type === "childList" && !options.childList) continue;
      queueMicrotask(() => observer.callback([{ target, type, attributeName }], observer));
    }
  }
  class Element extends EventTarget {
    constructor(tag, rect = { x:0, y:0, width:0, height:0 }) {
      super(); this.tagName = tag.toUpperCase(); this.rect = rect;
      this.attributes = new Map(); this.children = []; this.parentElement = null;
      this.style = {}; this.dataset = {}; this.textContent = "";
    }
    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }
    get hidden() { return this.attributes.has("hidden"); }
    set hidden(value) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
    get open() { return this.attributes.has("open"); }
    set open(value) { if (value) this.setAttribute("open", ""); else this.removeAttribute("open"); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) {
      const text = String(value);
      if (this.getAttribute(name) === text) return;
      this.attributes.set(name, text); mutate(this, "attributes", name);
    }
    removeAttribute(name) { if (this.attributes.delete(name)) mutate(this, "attributes", name); }
    append(...children) {
      for (const child of children) { child.parentElement = this; this.children.push(child); }
      mutate(this, "childList");
    }
    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null;
      this.children = []; this.append(...children);
    }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    matches(selector) {
      let matched = true;
      let rest = selector.trim().replace(/:not\(([^)]+)\)/g, (_, condition) => {
        if (this.matches(condition)) matched = false;
        return "";
      }).replace(/\[([^\s=\]]+)(?:="([^"]*)")?\]/g, (_, key, value) => {
        if (!this.attributes.has(key) || value !== undefined && this.getAttribute(key) !== value) matched = false;
        return "";
      }).replace(/^[a-z][\w-]*/i, tag => {
        if (this.tagName !== tag.toUpperCase()) matched = false;
        return "";
      }).replace(/([.#])([\w-]+)/g, (_, prefix, name) => {
        if (prefix === "#" ? this.id !== name : !this.className.split(/\s+/).includes(name)) matched = false;
        return "";
      });
      return matched && (rest === "" || rest === "*");
    }
    closest(selectors) {
      for (let element = this; element; element = element.parentElement) {
        if (selectors.split(",").some(selector => element.matches(selector))) return element;
      }
      return null;
    }
    querySelectorAll(selectors) {
      const result = [];
      for (const child of this.children) {
        if (selectors.split(",").some(selector => child.matches(selector))) result.push(child);
        result.push(...child.querySelectorAll(selectors));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() {
      for (let element = this; element; element = element.parentElement) {
        if (element.hidden || element.tagName === "DIALOG" && !element.open) return { ...this.rect, width:0, height:0 };
      }
      return { ...this.rect };
    }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatchEvent(new Event("close")); } }
    click() { this.dispatchEvent(new Event("click")); }
  }
  document.body = new Element("body"); document.hidden = false; document.readyState = "complete";
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.getElementById = id => document.body.querySelector(`#${id}`);
  document.createElement = tag => new Element(tag);
  const view = new Element("div", { x:40, y:120, width:1200, height:800 });
  const control = new Element("button", { x:1050, y:132, width:150, height:44 });
  control.className = "tenet-process-launch";
  const dialog = new Element("dialog", { x:100, y:190, width:1020, height:670 });
  dialog.id = "tenetProcessDialog";
  dialog.className = "tenet-process-dialog";
  const close = new Element("button", { x:1020, y:210, width:80, height:44 });
  close.setAttribute("data-action", "close");
  const play = new Element("button", { x:460, y:790, width:110, height:44 });
  play.setAttribute("data-action", "play");
  const slider = new Element("input", { x:590, y:790, width:400, height:44 });
  slider.setAttribute("type", "range");
  const library = new Element("nav"), timeline = new Element("nav");
  library.className = "tenet-process-list"; timeline.className = "tenet-process-events";
  const values = ["detail", "question", "response"].map(name => {
    const element = new Element("p"); element.setAttribute("data-value", name); return element;
  });
  dialog.append(close, play, slider, library, timeline, ...values);
  document.body.append(view, control, dialog);
  const state = { currentSnapshotManifestExtensions:{ keep:"notebook-metadata" }, scale:.5, panX:25, panY:35,
    pen:4, inkColor:"#172638", mode:"pen", userRevision:0, history:[], future:[],
    hotspotTrail:[], dirty:null, autoEligible:false, navigationLocked:false };
  const native = {
    getConfiguration:async () => ({ valid:true, pencilKitEnabled:true, fingerDrawingEnabled:true }),
    addListener:async (name, callback) => { listeners.set(name, callback); return { remove:async () => listeners.delete(name) }; },
    configureInkSurface:async options => { calls.push({ kind:"configure", ...plain(options) }); sessionId = options.sessionId; return { sessionId, revision }; },
    hideInkSurface:async options => { calls.push({ kind:"hide", ...options }); return { ...draft, sessionId, revision }; },
    flushInkSurface:async options => { calls.push({ kind:"flush", ...options }); return { ...draft, sessionId, revision }; },
  };
  window.Capacitor = { getPlatform:() => "ios", Plugins:{ TenetNative:native } };
  window.PENECHO_CONFIG = { tenetMode:true, tenetAssignmentPreview:!readOnly }; window.innerWidth = 1280;
  const access = { journal:0, list:0, capture:0, begin:0 };
  const lifecycle = { clearImage:0, clearPrepared:0 };
  Object.defineProperty(window, "TenetProcessJournal", { get() {
    access.journal++;
    return { listAttempts:async () => { access.list++; return []; } };
  } });
  Object.defineProperty(window, "TenetProcessCapture", { get() {
    access.capture++;
    return { activeId:() => null, isRecording:() => false, nativeRevision:() => {}, begin:() => { access.begin++; throw Error("Preview must not start capture"); } };
  } });
  const noop = () => {};
  const context = vm.createContext({ window, document, view, state, SIZE:20000, MAX_HISTORY:30,
    inkCtx:{ drawImage:noop }, crypto:{ randomUUID:() => `preview-ink-${++nextId}` },
    Event, CustomEvent, AbortController, snapshotLoadInProgress:false,
    ResizeObserver:class { observe(){} unobserve(){} disconnect(){} },
    MutationObserver:class {
      constructor(callback) { this.callback = callback; observers.add(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { observers.delete(this); }
    },
    Image:class { naturalWidth=500; naturalHeight=200; set src(value) { queueMicrotask(() => this.onload?.()); } },
    getComputedStyle:() => ({ display:"block", visibility:"visible" }),
    requestAnimationFrame:callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame:id => frames.delete(id), setTimeout:() => ++nextId, clearTimeout:noop,
    requestCommittedInkRender:noop, requestInteractionLayerRender:noop, requestRender:noop,
    canvasViewportMetrics:() => ({ width:1200, height:800 }),
    canvasAgentDidCommitUserCanvasChange:noop, supersedeActiveAI:noop, schedule:noop,
    updateCoordinates:noop, invalidateRecognition:noop, commitSelection:noop, save:noop,
    snapshotExtensionObject:plain, mergeDirtyBox:box => { state.dirty = box; },
    intersection:(a, b) => {
      const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
      const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
      return w > 0 && h > 0 ? { x, y, w, h } : null;
    },
    unionLocalBounds:(a, b) => a || b, previewControl:control, previewDialog:dialog, previewLifecycle:lifecycle,
  });
  vm.runInContext(`${inkSource}\nglobalThis.controller = tenetInkController;`, context);
  // Run the actual preview's opening, Close button and close-retirement handlers.
  // Include the real gate/accessor and library refresh so default-off behavior
  // cannot pass merely because a mock silently bypassed journal enumeration.
  const gateStart = uiSource.indexOf("  const standalone =");
  const gateEnd = uiSource.indexOf("  let selected =", gateStart);
  const refreshStart = uiSource.indexOf("  async function refreshLibrary()");
  const refreshEnd = uiSource.indexOf("  async function renderEvent(", refreshStart);
  const start = uiSource.indexOf('  control.addEventListener("click", () => {');
  const closeMarker = '  dialog.addEventListener("close", retireView);';
  const closeStart = uiSource.indexOf(closeMarker, start);
  assert.ok(gateStart >= 0 && gateEnd > gateStart && refreshStart >= 0 && refreshEnd > refreshStart,
    "real read-only gate and library refresh must remain identifiable");
  assert.ok(start >= 0 && closeStart > start, "the complete preview lifecycle must remain identifiable");
  const signOut = uiSource.match(/^  window\.addEventListener\("tenet:sign-out",[^\r\n]+/m)?.[0];
  const pagehide = uiSource.match(/^  window\.addEventListener\("pagehide",[^\r\n]+/m)?.[0];
  assert.ok(signOut && pagehide, "native navigation regression must exercise real lifecycle retirement");
  vm.runInContext(`(() => {
    ${uiSource.slice(gateStart, gateEnd)}
    const control = previewControl, dialog = previewDialog;
    const find = action => dialog.querySelector('[data-action="' + action + '"]');
    const value = name => dialog.querySelector('[data-value="' + name + '"]');
    let sessionEpoch = 0, generation = 0, selectionEpoch = 0, busyOwner = 0;
    let selected = null, events = [], assetSource = journal, imported = false, sample = false;
    const stopPlaying = () => {}, clearImage = () => { previewLifecycle.clearImage++; };
    const clearPrepared = () => { previewLifecycle.clearPrepared++; }, paintRecord = async () => {};
    const perform = async operation => operation();
    ${uiSource.slice(refreshStart, refreshEnd)}
    ${uiSource.slice(start, closeStart + closeMarker.length)}
    ${signOut}
    ${pagehide}
  })();`, context);
  const settle = async () => {
    for (let index = 0; index < 12; index++) {
      await new Promise(resolve => setImmediate(resolve));
      const batch = [...frames.values()]; frames.clear();
      for (const callback of batch) callback();
    }
  };
  await settle();
  return { window, document, state, calls, control, dialog, close, slider, access, lifecycle, Element, settle,
    api:window.TenetInk, controller:context.controller,
    latest:() => calls.filter(call => call.kind === "configure").at(-1),
    async addStroke() {
      draft = { drawingData:"c3Ryb2tl", previewDataUrl:"data:image/png;base64,cHJldmlldw==",
        bounds:{ x:100, y:150, w:500, h:200 }, strokeCount:1 };
      listeners.get("inkSurfaceChanged")({ ...draft, sessionId, revision:++revision });
      await settle();
    },
  };
}

test("Teacher preview uses native-observed modal semantics and web-owned launcher controls", () => {
  assert.match(uiSource, /const control = document\.createElement\("button"\)/);
  assert.match(uiSource, /control\.className = "tenet-process-launch"/);
  assert.match(uiSource, /const dialog = document\.createElement\("dialog"\)/);
  assert.match(uiSource, /dialog\.id = "tenetProcessDialog"/);
  assert.match(uiSource, /control\.setAttribute\("aria-controls", dialog\.id\)/);
  assert.match(uiSource, /const style = document\.createElement\("link"\)/);
  assert.match(uiSource, /style\.id = "tenetProcessStyles"; style\.rel = "stylesheet"; style\.href = "\.\/tenet-process\.css"/);
  assert.doesNotMatch(uiSource, /<iframe\b|document\.createElement\(["'](?:iframe|style)["']\)|\.style\.cssText|window\.open\s*\(|(?:window\.)?location\.(?:href|assign|replace)\b/,
    "the modal must neither require framed/inline-style CSP exceptions nor navigate away from scratch work");
  assert.match(uiSource, /if \(!viewerOnly\) \{\s*dialog\.querySelector\("form"\)\.addEventListener/,
    "recording handlers must not be registered for read-only sessions");
  assert.match(inkSource, /attributeFilter:\[[^\]]*"open"/);
  assert.match(inkSource, /mutations\.observe\(document\.body, \{ subtree:true, childList:true, attributes:true/);
});

test("Teacher preview opening hides native ink before reconfiguration and Close restores the same drawing", async () => {
  const h = await harness();
  await h.api.setEngine("pencilkit"); await h.addStroke();
  const before = h.latest(), drawing = plain(h.controller.snapshot()), historyLength = h.state.history.length;
  assert.equal(before.visible, true); assert.equal(before.inputEnabled, true);
  assert.deepEqual(before.exclusions, [{ x:1046, y:128, width:158, height:52 }], "launcher includes the four-pixel Pencil/finger margin");
  const start = h.calls.length;
  h.control.click(); await h.settle();
  assert.equal(h.dialog.open, true);
  assert.equal(h.latest().visible, false); assert.equal(h.latest().inputEnabled, false);
  const transitions = h.calls.slice(start);
  assert.deepEqual(transitions.map(call => call.kind), ["hide", "configure"]);
  assert.ok(h.latest().exclusions.some(hole => hole.x <= 1020 && hole.y <= 210 && hole.x + hole.width >= 1100 && hole.y + hole.height >= 254), "modal controls are also covered by a web-owned exclusion");
  h.slider.setAttribute("aria-expanded", "true"); await h.settle();
  assert.equal(h.latest().visible, false, "interacting with preview controls must not reactivate ink");
  h.close.click(); await h.settle();
  assert.equal(h.dialog.open, false);
  const restored = h.latest();
  assert.equal(restored.visible, true); assert.equal(restored.inputEnabled, true);
  for (const field of ["sessionId", "panX", "panY", "scale", "tool", "width"]) assert.equal(restored[field], before[field], field);
  assert.deepEqual(restored.exclusions, before.exclusions, "closed preview leaves no dead canvas hit boxes");
  assert.deepEqual(plain(h.controller.snapshot()), drawing);
  assert.equal(h.state.history.length, historyLength, "opening and closing preview is not a canvas edit");
  assert.equal(h.state.currentSnapshotManifestExtensions.keep, "notebook-metadata");
  assert.ok(h.calls.slice(start).filter(call => call.kind === "configure").every(call => !Object.hasOwn(call, "drawingData")), "preview must not replace the PKDrawing archive");
});

test("closing Teacher preview cannot override another modal, suspension, or Web mode", async () => {
  const h = await harness(); await h.api.setEngine("pencilkit");
  h.control.click(); await h.settle();
  const other = new h.Element("dialog", { x:200, y:240, width:500, height:300 });
  h.document.body.append(other); other.showModal();
  h.close.click(); await h.settle();
  assert.equal(h.latest().visible, false, "another modal retains native input ownership");
  other.close(); await h.settle();
  assert.equal(h.latest().visible, true);
  await h.api.suspend("other-native-operation");
  h.control.click(); await h.settle(); h.close.click(); await h.settle();
  assert.equal(h.latest().inputEnabled, false, "preview close cannot remove another suspension");
  h.api.resume("other-native-operation"); await h.settle();
  assert.equal(h.latest().inputEnabled, true);
  await h.api.setEngine("web");
  h.control.click(); await h.settle(); h.close.click(); await h.settle();
  assert.equal(h.latest().visible, false); assert.equal(h.api.getStatus().engine, "web");
});

test("ordinary-session same-document preview blocks its controls and preserves scratch without journal or capture access", async () => {
  const h = await harness({ readOnly:true });
  await h.api.setEngine("pencilkit");
  await h.addStroke();
  const before = h.latest(), drawing = plain(h.controller.snapshot());
  // Seeding existing scratch ink emits the ordinary nativeRevision notification.
  // Measure preview access after that unrelated native drawing lifecycle.
  const beforePreviewAccess = { ...h.access };
  assert.equal(beforePreviewAccess.journal, 0); assert.equal(beforePreviewAccess.list, 0); assert.equal(beforePreviewAccess.begin, 0);
  assert.equal(h.latest().visible, true);
  assert.deepEqual(h.latest().exclusions, [{ x:1046, y:128, width:158, height:52 }]);
  h.control.click(); await h.settle();
  assert.equal(h.dialog.open, true);
  assert.equal(h.latest().visible, false); assert.equal(h.latest().inputEnabled, false);
  assert.ok(h.latest().exclusions.some(hole => hole.x <= 590 && hole.y <= 790 && hole.x + hole.width >= 990 && hole.y + hole.height >= 834), "the same-document modal covers the replay slider and other controls");
  assert.deepEqual(h.access, beforePreviewAccess, "opening default-off preview must not access additional shared-profile services");
  h.close.click(); await h.settle();
  assert.equal(h.dialog.open, false);
  assert.equal(h.latest().visible, true); assert.equal(h.latest().inputEnabled, true);
  assert.equal(h.latest().sessionId, before.sessionId);
  for (const field of ["panX", "panY", "scale"]) assert.equal(h.latest()[field], before[field], field);
  assert.deepEqual(plain(h.controller.snapshot()), drawing);
  assert.deepEqual(h.latest().exclusions, before.exclusions);
  assert.deepEqual(h.access, beforePreviewAccess, "closing default-off preview must not access journal or recording services");
});

test("read-only preview browser close and sign-out retire viewer state; pagehide never restores native input", async () => {
  for (const reason of ["browser-close", "tenet:sign-out", "pagehide"]) {
    const h = await harness({ readOnly:true }); await h.api.setEngine("pencilkit");
    h.control.click(); await h.settle();
    assert.equal(h.latest().visible, false);
    const start = h.calls.length;
    if (reason === "browser-close") h.dialog.close();
    else h.window.dispatchEvent(new Event(reason));
    await h.settle();
    assert.ok(h.lifecycle.clearImage > 0, `${reason} must retire viewer image state`);
    assert.deepEqual(h.access, { journal:0, list:0, capture:0, begin:0 }, reason);
    if (reason === "pagehide") {
      assert.equal(h.calls.slice(start).some(call => call.kind === "configure" && call.inputEnabled), false, "retiring the viewer cannot revive the retired native controller");
      assert.equal(h.latest().inputEnabled, false);
      assert.ok(h.lifecycle.clearPrepared > 0);
    } else {
      assert.equal(h.dialog.open, false, reason);
      if (reason === "browser-close") assert.equal(h.latest().inputEnabled, true);
      else assert.ok(h.lifecycle.clearPrepared > 0);
    }
    // Real sign-out authority is enforced natively, not fabricated by this VM.
  }
});

test("native exclusions reject all touch types and hidden preview state disables the drawing recognizer", () => {
  const hitStart = nativeSource.indexOf("override func point(inside point: CGPoint");
  const hitEnd = nativeSource.indexOf("private struct InkToolActivity", hitStart);
  assert.ok(hitStart >= 0 && hitEnd > hitStart);
  const hit = nativeSource.slice(hitStart, hitEnd);
  assert.match(hit, /super\.point\(inside: point, with: event\) && !exclusions\.contains \{ \$0\.contains\(point\) \}/);
  assert.doesNotMatch(hit, /\.pencil|\.direct|touch\.type/, "exclusions cannot protect only finger or only Pencil");
  const start = nativeSource.indexOf("private func refreshPolicyAndVisibility()");
  const end = nativeSource.indexOf("private func configureInputAndNavigation()", start);
  assert.ok(start >= 0 && end > start);
  const visibility = nativeSource.slice(start, end);
  assert.match(visibility, /settings\?\.visible == true && settings\?\.inputEnabled == true/);
  assert.match(visibility, /let drawingEnabled = visible && !inputSuspended/);
  assert.match(visibility, /canvas\.drawingGestureRecognizer\.isEnabled = drawingEnabled/);
  assert.match(visibility, /clip\.isHidden = !visible/);
  assert.match(visibility, /picker\.setVisible\(false, forFirstResponder: canvas\)/);
});
