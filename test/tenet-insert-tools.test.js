"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/client/app/tenet-ipad-usability.js"), "utf8");
const start = source.indexOf("  function drawTenetInsertArtwork(");
const end = source.indexOf("  function installShapeTools(", start);
assert(start >= 0 && end > start, "Artwork renderer must remain independently testable");

function render(kind, maxDimension) {
  const calls = [];
  const context = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        for (const value of args) if (typeof value === "number") assert(Number.isFinite(value));
        calls.push([name, ...args]);
      };
    },
  });
  const canvas = { getContext:() => context };
  const sandbox = vm.createContext({ document:{ createElement:() => canvas } });
  vm.runInContext(source.slice(start, end), sandbox);
  const result = sandbox.drawTenetInsertArtwork(kind, "#10243e", maxDimension);
  return { result, calls };
}

for (const kind of ["rectangle", "square", "circle", "triangle", "line", "arrow"]) {
  test("local " + kind + " has bounded transparent artwork and a stroke", () => {
    const { result, calls } = render(kind);
    assert(result.width > 0 && result.width <= 1024);
    assert(result.height > 0 && result.height <= 1024);
    assert(calls.some(call => call[0] === "stroke"));
    assert(!calls.some(call => call[0] === "fillRect"));
    const preview = render(kind, 220).result;
    assert(Math.max(preview.width, preview.height) <= 220);
  });
}

test("first-quadrant and four-quadrant graphs keep unnumbered axes in the correct positions", () => {
  for (const [kind, originX, originY] of [["graph-first", 100, 924], ["graph-four", 512, 512]]) {
    const { result, calls } = render(kind);
    assert.equal(result.width, 1024);
    assert.equal(result.height, 1024);
    assert(calls.some(call => call[0] === "fillRect"));
    const labels = calls.filter(call => call[0] === "fillText").map(call => call[1]);
    assert.deepEqual(labels, ["x", "y"]);
    assert(calls.some(call => call[0] === "lineTo" && call[1] === 946 && call[2] === originY));
    assert(calls.some(call => call[0] === "lineTo" && call[1] === originX && call[2] === 78));
    assert(calls.some(call => call[0] === "moveTo" && call[1] === (kind === "graph-first" ? 100 : 78) && call[2] === originY));
  }
});

test("insertion uses the existing local image path and guards page changes", () => {
  const insert = source.slice(end, source.indexOf("  function installDrawingTools(", end));
  assert.match(insert, /pageGeneration !== state\.snapshotLoadGeneration/);
  assert.match(insert, /await addImageFile\(file\)/);
  assert.doesNotMatch(insert, /\bfetch\s*\(|XMLHttpRequest|requestAI\s*\(/);
  assert.match(source, /await window\.TenetInk\?\.suspend\(reason\)/);
  assert.match(source, /window\.TenetInk\?\.resume\(reason\)/);
});
