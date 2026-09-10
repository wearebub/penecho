import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const navigator = readFileSync(new URL("../src/client/app/studio-navigator.js", import.meta.url), "utf8");
const usability = readFileSync(new URL("../src/client/app/tenet-ipad-usability.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/tenet-ipad-usability.css", import.meta.url), "utf8");

test("the actual studio empty-page predicate counts native ink without requiring web tiles", () => {
  const start = navigator.indexOf("function studioCanvasHasContent()");
  const end = navigator.indexOf("function updateStudioDocumentState()", start);
  assert.ok(start >= 0 && end > start);
  let nativeContent = false;
  const context = vm.createContext({
    tenetInkController: { hasContent: () => nativeContent },
    tiles: new Map(),
    state: { images: [], textBoxes: [], preservedSnapshotAnimations: [], animations: [] },
    pluginEnabled: () => false, visibleWidgets: () => [],
  });
  vm.runInContext(navigator.slice(start, end), context);
  assert.equal(context.studioCanvasHasContent(), false);
  nativeContent = true;
  assert.equal(context.studioCanvasHasContent(), true);
  nativeContent = false;
  assert.equal(context.studioCanvasHasContent(), false);
  context.tiles.set("web", {});
  assert.equal(context.studioCanvasHasContent(), true);
});

function layoutHarness() {
  const start = usability.indexOf("function installCanvasChromeLayout()");
  const end = usability.indexOf("function configureTitleDismissal()", start);
  assert.ok(start >= 0 && end > start);
  const properties = new Map();
  const rectangle = { left: 0, right: 1280, top: 70, bottom: 920, width: 1280, height: 850 };
  const toolbarRectangle = { left: 0, right: 1280, top: 70, bottom: 174, width: 1280, height: 104 };
  const viewport = { getBoundingClientRect: () => rectangle, style: {
    getPropertyValue: name => properties.get(name) || "",
    setProperty: (name, value) => properties.set(name, value),
  } };
  const header = { getBoundingClientRect: () => ({ left: 0, right: 1280, top: 24, bottom: 70, width: 1280, height: 46 }) };
  const toolbar = { getBoundingClientRect: () => toolbarRectangle };
  const window = Object.assign(new EventTarget(), { innerWidth: 1280,
    visualViewport: Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, width: 1280 }) });
  const document = Object.assign(new EventTarget(), {
    getElementById: id => id === "viewport" ? viewport : null,
    querySelectorAll: () => [header, toolbar],
  });
  let resize, disconnected = false, syncs = 0, id = 0;
  const frames = new Map();
  const context = vm.createContext({ window, document, AbortController, embodiment: {},
    tenetInkController: { sync: () => { syncs++; } },
    runtimeElementStyle: (element, key) => {
      assert.equal(element, viewport);
      assert.equal(key, "tenet-canvas-chrome");
      return viewport.style;
    },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  });
  vm.runInContext(usability.slice(start, end), context);
  context.installCanvasChromeLayout();
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback());
  };
  return { window, document, rectangle, toolbarRectangle, properties, flush,
    resize: () => resize(), syncs: () => syncs, disconnected: () => disconnected,
    pendingFrames: () => frames.size };
}

test("quick-ask placement follows toolbar growth and shrink without minimum-height feedback", () => {
  const h = layoutHarness();
  h.flush();
  assert.equal(h.properties.get("--tenet-canvas-controls-top"), "104px");
  h.toolbarRectangle.bottom = 112;
  h.toolbarRectangle.height = 42;
  h.resize();
  h.flush();
  assert.equal(h.properties.get("--tenet-canvas-controls-top"), "42px");
  assert.equal(h.properties.has("--studio-toolbar-height"), false);
  assert.equal(h.syncs(), 2, "native hit-test exclusions follow the new layout");
  h.rectangle.top = 112;
  h.resize();
  h.flush();
  assert.equal(h.properties.get("--tenet-canvas-controls-top"), "0px", "a toolbar outside the canvas is not counted twice");
});

test("visual viewport clipping moves controls inward and layout work is coalesced", () => {
  const h = layoutHarness();
  h.flush();
  h.window.visualViewport.offsetLeft = 20;
  h.window.visualViewport.width = 600;
  h.window.visualViewport.dispatchEvent(new Event("resize"));
  h.document.dispatchEvent(new Event("scroll"));
  assert.equal(h.pendingFrames(), 1);
  h.flush();
  assert.equal(h.properties.get("--tenet-canvas-right-occlusion"), "660px");
});

test("layout tracking survives cached pages but disconnects on final teardown", () => {
  const h = layoutHarness();
  h.flush();
  const cached = new Event("pagehide");
  Object.defineProperty(cached, "persisted", { value: true });
  h.window.dispatchEvent(cached);
  assert.equal(h.disconnected(), false);
  h.window.dispatchEvent(new Event("pageshow"));
  assert.equal(h.pendingFrames(), 1);
  h.window.dispatchEvent(new Event("pagehide"));
  assert.equal(h.disconnected(), true);
  assert.equal(h.pendingFrames(), 0);
  h.window.dispatchEvent(new Event("resize"));
  assert.equal(h.pendingFrames(), 0);
});

test("quick ask retains a visible 48-pixel target and bounded measured positioning", () => {
  assert.match(css, /#aiEmbodiment\s*\{[^}]*top: clamp\([^;]*--tenet-canvas-controls-top/);
  assert.match(css, /#aiEmbodiment\s*\{[^}]*right: clamp\([^;]*--tenet-canvas-right-occlusion/);
  assert.match(css, /#aiEmbodiment\s*\{[^}]*opacity: 1/);
  assert.match(css, /#aiOrb\s*\{[^}]*width: 48px;[^}]*height: 48px/);
});
