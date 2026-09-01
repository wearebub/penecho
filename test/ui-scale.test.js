"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { CANVAS_PAGE_SCALE, CANVAS_PAGE_SCALES, CANVAS_PAGE_SCALE_STORAGE_KEY, normalizeCanvasPageScale } = require("../public/page-scale.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function runPageScale(config, storedScale = null) {
  const classes = [], properties = new Map(), storage = new Map(), desktopCalls = [];
  if (storedScale !== null) storage.set(CANVAS_PAGE_SCALE_STORAGE_KEY, String(storedScale));
  const browserWindow = { PENECHO_CONFIG:config, penechoDesktop:{ setPageScale:value => desktopCalls.push(value) } };
  vm.runInNewContext(read("public/page-scale.js"), {
    window:browserWindow,
    localStorage:{
      getItem:key => storage.get(key) ?? null,
      setItem:(key, value) => storage.set(key, String(value)),
    },
    document:{
      documentElement:{
        classList:{ add:value => classes.push(value) },
        style:{ setProperty:(name, value) => properties.set(name, value) },
      },
    },
  });
  return { classes, properties, storage, desktopCalls, browserWindow };
}

test("Canvas page scale exposes four validated choices with mutually exclusive desktop/web paths", () => {
  const desktop = runPageScale({ desktopApp:true });
  const web = runPageScale({ runtime:"cloud" }, 1.25);
  const main = read("desktop/main.js"), preload = read("desktop/canvas-preload.js"), css = read("public/style.css");

  assert.equal(CANVAS_PAGE_SCALE, 1);
  assert.deepEqual(CANVAS_PAGE_SCALES, [0.9, 1, 1.1, 1.25]);
  assert.equal(normalizeCanvasPageScale(0.9), 0.9);
  assert.equal(normalizeCanvasPageScale(1.25), 1.25);
  assert.equal(normalizeCanvasPageScale(1.5), 1);
  assert.equal(normalizeCanvasPageScale("invalid"), 1);
  assert.deepEqual(desktop.classes, []);
  assert.deepEqual(desktop.desktopCalls, [1]);
  assert.deepEqual(web.classes, ["penecho-web-page-scale"]);
  assert.equal(web.properties.get("--penecho-canvas-page-scale"), "1.25");
  assert.equal(web.properties.get("--penecho-canvas-page-viewport-width"), "80vw");
  assert.equal(web.browserWindow.PenEchoPageScale.apply(0.9), 0.9);
  assert.equal(web.storage.get(CANVAS_PAGE_SCALE_STORAGE_KEY), "0.9");
  assert.equal(web.properties.get("--penecho-canvas-page-scale"), "0.9");
  assert.equal(web.properties.get("--penecho-canvas-page-viewport-width"), `${100 / 0.9}vw`);
  assert.equal(web.browserWindow.PenEchoPageScale.apply(1.25), 1.25);
  assert.equal(web.storage.get(CANVAS_PAGE_SCALE_STORAGE_KEY), "1.25");
  assert.equal(web.properties.get("--penecho-canvas-page-scale"), "1.25");
  assert.equal(web.properties.get("--penecho-canvas-page-viewport-width"), `${100 / 1.25}vw`);
  assert.match(main, /const \{ CANVAS_PAGE_SCALE, normalizeCanvasPageScale \} = require\("\.\.\/public\/page-scale\.js"\)/);
  assert.match(main, /webPreferences:\{ preload:CANVAS_PRELOAD, zoomFactor:CANVAS_PAGE_SCALE \}/);
  assert.match(main, /ipcMain\.handle\("penecho:set-page-scale"[\s\S]*?fromCanvas\(event\)[\s\S]*?setZoomFactor\(scale\)/);
  assert.match(preload, /setPageScale:scale => ipcRenderer\.invoke\("penecho:set-page-scale", scale\)/);
  assert.match(css, /@media \(min-width: 701px\) \{\s*html\.penecho-web-page-scale \{ zoom: var\(--penecho-canvas-page-scale\); \}/);
});

test("only the Canvas document loads web scaling and it is ready before styles", () => {
  const html = read("public/index.html"), packageJson = JSON.parse(read("package.json"));
  const config = html.indexOf('<script src="/api/config.js"></script>'),
    scale = html.indexOf('<script src="page-scale.js"></script>'),
    style = html.indexOf('<link rel="stylesheet" href="style.css">');

  assert.ok(config > 0 && config < scale && scale < style);
  assert.equal((html.match(/\/api\/config\.js/g) || []).length, 1);
  assert.ok(packageJson.files.includes("public/page-scale.js"));
});

test("web page scaling keeps Canvas layout coordinates aligned with screen input", () => {
  const core = read("src/client/app/core.js"), canvas = read("src/client/app/canvas-runtime.js"), agent = read("src/client/app/canvas-agent-runtime.js");

  assert.match(core, /clientScaleX = rect\.width > 0 \? width \/ rect\.width : 1/);
  assert.match(core, /function canvasClientPosition\(clientX, clientY\)/);
  assert.match(core, /function applyPageScale\(scale\)[\s\S]*?updateAppearanceControls\(\);[\s\S]*?fit\(\);[\s\S]*?dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(canvas, /function fit\(\) \{\s*const metrics = canvasViewportMetrics\(\)/);
  assert.match(canvas, /function clientPoint\(e\) \{\s*const point = canvasClientPosition\(e\.clientX, e\.clientY\)/);
  assert.match(canvas, /const delta = canvasClientDelta\(dx, dy\)/);
  assert.match(agent, /const panelRect=canvasElementLayoutRect\(canvasAgentPanel\)/);
  assert.match(agent, /triggerRect=pageLayoutRect\(canvasAgentToggle\)/);
});
