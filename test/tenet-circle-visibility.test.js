const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the SVG circle overlay uses the hidden attribute, not an HTML-only property', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/client/app/tenet-selection-tools.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/tenet-selection-tools.css'), 'utf8');
  assert.doesNotMatch(source, /surface\.hidden\s*=/);
  assert.equal((source.match(/surface\.setAttribute\("hidden", ""\)/g) || []).length, 2);
  assert.match(source, /surface\.removeAttribute\("hidden"\)/);
  assert.match(css, /\.tenet-ai-circle-surface\[hidden\][\s\S]*?display:\s*none/);
});
