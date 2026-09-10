'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const filename = path.join(__dirname, '../src/client/app/tenet-voice.js');
const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
const instrumented = source.replace(
  /\n  if \(document\.readyState === "loading"\)[\s\S]*?\n\}\)\(\);\s*$/,
  '\n  globalThis.popoverTest = { voicePopoverBounds };\n})();'
);
assert.notEqual(instrumented, source, 'The popover test seam must match voice startup');
const context = vm.createContext({
  AbortController,
  window: {
    PENECHO_CONFIG: { tenetMode: true },
    Capacitor: { getPlatform: () => 'ios', Plugins: { TenetNative: {} } },
    addEventListener() {}
  },
  document: { addEventListener() {} }
});
new vm.Script(instrumented, { filename }).runInContext(context);
const bounds = context.popoverTest.voicePopoverBounds;

test('popover opens below Talk and expresses right as a layout-viewport inset', () => {
  const result = bounds({ top: 120, bottom: 164, right: 1000 },
    { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0 }, 1024, 320);
  assert.equal(result.top, 172);
  assert.equal(result.right, 24);
  assert.equal(result.maxWidth, 360);
  assert.equal(result.availableHeight, 520);
});

test('keyboard viewport bounds contain the popover even when Talk is outside the visible area', () => {
  const result = bounds({ top: 560, bottom: 604, right: 1000 },
    { width: 1024, height: 300, offsetLeft: 0, offsetTop: 160 }, 1024, 320);
  assert.equal(result.top, 172);
  assert.equal(result.availableHeight, 276);
  assert.equal(result.top + result.availableHeight, 448);
});

test('pinch-zoom offsets constrain both horizontal position and maximum width', () => {
  const result = bounds({ top: 230, bottom: 274, right: 510 },
    { width: 300, height: 400, offsetLeft: 220, offsetTop: 140 }, 1024, 280);
  assert.equal(result.maxWidth, 276);
  assert.equal(result.right, 516);
  assert.equal(1024 - result.right - result.maxWidth, 232);
  assert.ok(result.top >= 152);
  assert.ok(result.top + result.availableHeight <= 528);
});

test('popover moves above Talk when there is insufficient space below', () => {
  const result = bounds({ top: 530, bottom: 574, right: 1000 },
    { width: 1024, height: 600, offsetLeft: 0, offsetTop: 0 }, 1024, 320);
  assert.equal(result.top, 202);
  assert.equal(result.availableHeight, 320);
  assert.equal(result.bottom, 522);
});

test('invalid viewport sizes are ignored and very small viewports remain bounded', () => {
  const entry = { top: 100, bottom: 144, right: 80 };
  assert.equal(bounds(entry, { width: 80, height: 0 }, 80), null);
  assert.equal(bounds(entry, { width: NaN, height: 90 }, 80), null);
  assert.equal(bounds(entry, { width: 80, height: 90 }, 0), null);
  const result = bounds(entry, { width: 80, height: 90 }, 80, 320);
  assert.ok(result.maxWidth > 0 && result.maxWidth <= 80);
  assert.ok(result.top >= 0);
  assert.ok(result.top + result.availableHeight <= 90);
});
