const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const base = read('style.css');
const ipad = read('tenet-ipad-usability.css');

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, 'Missing standalone CSS rule: ' + selector);
  return match[1];
}

function zIndex(css, selector) {
  const match = rule(css, selector).match(/z-index:\s*(-?\d+)/);
  assert.ok(match, 'Missing stacking order: ' + selector);
  return Number(match[1]);
}

test('resize touch targets cannot cover the AI draft move and action buttons', () => {
  assert.ok(zIndex(ipad, '.tenet-resize-layer') < zIndex(base, '.object-chrome-layer'));
  assert.ok(zIndex(ipad, '.tenet-resize-layer') >= zIndex(base, '.interaction-layer'));
  assert.match(rule(ipad, '.tenet-resize-layer'), /pointer-events:\s*none/);
  assert.match(rule(ipad, '.tenet-resize-handle'), /pointer-events:\s*auto/);
});

test('iPad move and resize controls override the ordinary button touch policy', () => {
  const prefix = 'html.tenet-native-ios body.tenet-whiteboard ';
  const ordinary = prefix + 'button,\n' + prefix + '[role="button"]';
  const drag = prefix + '.object-chrome-button.move,\n'
    + prefix + '.object-chrome-button.object-toolbar-surface,\n'
    + prefix + '.tenet-resize-handle';
  assert.match(rule(ipad, ordinary), /touch-action:\s*manipulation/);
  assert.match(rule(ipad, drag), /touch-action:\s*none/);
  assert.ok(ipad.indexOf(drag) > ipad.indexOf(ordinary));
});

test('canvas navigation and object drag surfaces retain their pointer streams', () => {
  assert.match(rule(base, '#viewport'), /touch-action:\s*none/);
  assert.match(rule(base, '#screen'), /touch-action:\s*none/);
  assert.match(rule(base, '.object-chrome-button'), /touch-action:\s*none/);
  assert.match(rule(ipad, '.tenet-resize-handle'), /touch-action:\s*none/);
});
