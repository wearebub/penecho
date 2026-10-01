'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../src/client/app/tenet-research-model.js');
const sourceCode = fs.readFileSync(require.resolve('../src/client/app/tenet-research-model.js'), 'utf8');
const note = (overrides = {}) => ({ version: 1, kind: 'fact', title: 'Topic', text: 'Evidence.', source: '', url: '', ...overrides });
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

function browser(options = {}) {
  const canvases = [];
  const sandbox = { URL, Intl: options.fallback ? {} : Intl, document: {
    createElement(tag) {
      assert.equal(tag, 'canvas', 'Only a local canvas may be created');
      const calls = [];
      const ctx = {
        font: '10px sans-serif', fillStyle: '#000000', strokeStyle: '#000000',
        measureText(text) {
          const size = Number(this.font.match(/([\d.]+)px/)[1]);
          let width = 0;
          for (const { segment } of graphemes.segment(text)) {
            width += size * (/^[il.! ]$/.test(segment) ? 0.28 : /[WM\u4e00-\u9fff\u{1f300}-\u{1faff}]/u.test(segment) ? 1 : 0.55);
          }
          if (options.wideGlyph && text.includes('\u754c')) width += 3000;
          return { width, actualBoundingBoxLeft: options.overhang ? 7 : 0,
            actualBoundingBoxRight: width + (options.overhang ? 9 : 0),
            actualBoundingBoxAscent: size * (options.overhang ? 1.8 : 0.8),
            actualBoundingBoxDescent: size * (options.overhang ? 0.8 : 0.2) };
        },
        fillRect(x, y, width, height) { calls.push({ op: 'fillRect', x, y, width, height, color: this.fillStyle }); },
        strokeRect(x, y, width, height) { calls.push({ op: 'strokeRect', x, y, width, height, color: this.strokeStyle }); },
        fillText(text, x, y, maxWidth) {
          assert.equal(maxWidth, undefined, 'Do not squeeze text to conceal overflow');
          calls.push({ op: 'text', text, x, y, font: this.font, metrics: this.measureText(text) });
        }
      };
      const canvas = { calls, getContext(type) { assert.equal(type, '2d'); return options.noContext ? null : ctx; } };
      for (const dimension of ['width', 'height']) {
        let value = dimension === 'width' ? 300 : 150;
        Object.defineProperty(canvas, dimension, { get: () => value, set(next) {
          value = next;
          ctx.font = '10px sans-serif';
          ctx.fillStyle = ctx.strokeStyle = '#000000';
          ctx.textBaseline = 'alphabetic';
          ctx.textAlign = 'start';
        } });
      }
      for (const name of ['innerHTML', 'toBlob', 'toDataURL']) {
        Object.defineProperty(canvas, name, { get() { throw new Error(`Forbidden ${name}`); }, set() { throw new Error(`Forbidden ${name}`); } });
      }
      canvases.push(canvas);
      return canvas;
    }
  } };
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'Image', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'Worker', 'setTimeout']) {
    Object.defineProperty(sandbox, name, { get() { throw new Error(`Forbidden ${name}`); } });
  }
  sandbox.window = sandbox;
  vm.runInNewContext(sourceCode, sandbox, { filename: 'tenet-research-model.js' });
  return { api: sandbox.TenetResearchModel, canvases };
}

const textRows = (canvas, size) => canvas.calls.filter(row => row.op === 'text' && (!size || row.font.includes(` ${size}px `)));
function insideBounds(canvas) {
  assert.ok(canvas.width > 0 && canvas.width <= 2048);
  assert.ok(canvas.height >= 320 && canvas.height <= 1800);
  for (const row of textRows(canvas)) {
    assert.ok(row.x - row.metrics.actualBoundingBoxLeft >= 0, 'Left ink stays in bounds');
    assert.ok(row.x + row.metrics.actualBoundingBoxRight <= canvas.width, 'Right ink stays in bounds');
    assert.ok(row.y - row.metrics.actualBoundingBoxAscent >= 0, 'Top ink stays in bounds');
    assert.ok(row.y + row.metrics.actualBoundingBoxDescent <= canvas.height, 'Bottom ink stays in bounds');
  }
}

test('CommonJS and browser exports load without rendering or side effects', () => {
  assert.equal(typeof model.normalize, 'function');
  assert.equal(typeof model.render, 'function');
  const { api, canvases } = browser();
  assert.equal(typeof api.normalize, 'function');
  assert.equal(typeof api.render, 'function');
  assert.equal(canvases.length, 0);
});

test('normalization returns a fresh bounded record, strips extras, and preserves prose', () => {
  const input = Object.freeze(note({ title: '  Topic  ', text: '  <b>Evidence</b>\n', source: 'Author  ', extra: { private: true } }));
  const normalized = model.normalize(input);
  assert.deepEqual(normalized, note({ title: input.title, text: input.text, source: input.source }));
  assert.notEqual(normalized, input);
  assert.notEqual(model.normalize(input), normalized);
  normalized.title = 'Changed';
  assert.equal(input.title, '  Topic  ');
});

test('invalid shapes, versions, kinds, missing fields, and non-string fields return null', () => {
  for (const input of [null, undefined, [], '', 1, true, {}, note({ version: 2 }), note({ version: '1' }), note({ kind: 'FACT' }), note({ kind: '__proto__' })]) {
    assert.equal(model.normalize(input), null);
  }
  for (const field of ['title', 'text', 'source', 'url']) {
    const input = note();
    delete input[field];
    assert.equal(model.normalize(input), null, field);
    for (const value of [null, 12, [], {}]) assert.equal(model.normalize(note({ [field]: value })), null, field);
  }
  assert.equal(model.normalize({ get version() { throw new Error('unreadable'); } }), null);
});

test('at least title or body must contain non-whitespace text', () => {
  assert.equal(model.normalize(note({ title: ' \t', text: '\n ', source: 'Only a source' })), null);
  assert.ok(model.normalize(note({ title: '', text: 'Body only' })));
  assert.ok(model.normalize(note({ text: '' })));
});

test('every size cap accepts its boundary and rejects excess without truncation', () => {
  for (const [key, cap] of Object.entries({ title: 120, text: 4000, source: 300, url: 2048 })) {
    const prefix = key === 'url' ? 'https://example.test/' : '';
    const value = prefix + 'a'.repeat(cap - prefix.length);
    assert.equal(model.normalize(note({ [key]: value }))[key], value, key);
    assert.equal(model.normalize(note({ [key]: value + 'a' })), null, key);
    assert.equal(model.normalize(note({ [key]: value + ' ' })), null, `${key} checks before trimming`);
  }
});

test('links reject unsafe schemes, credentials, malformed input, controls, and encoded controls', () => {
  const urls = ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///tmp/x', 'ftp://example.test',
    '//example.test', 'http:example.test', 'https://', 'https://user:pass@example.test',
    'https://user@example.test', 'https://@example.test', 'https://example.test\\path',
    'https://exa\nmple.test', '\thttps://example.test', 'https://example.test/\u0000',
    'https://example.test/\u007f', 'https://example.test/\u0085', 'https://example.test/\u202e',
    'https://example.test/%0a', 'https://example.test/%1F', 'https://example.test/%7f', '\n'];
  for (const url of urls) assert.equal(model.normalize(note({ url })), null, JSON.stringify(url));
});

test('links allow HTTP(S), Unicode, blank input, and @ outside the authority', () => {
  for (const url of ['', 'http://example.test', 'HTTPS://example.test/path?q=1#part', 'https://[::1]/',
    'https://example.test/@author?email=a@b.test', 'https://example.test/\u4e16\u754c', 'https://example.test/%E4%B8%96']) {
    assert.equal(model.normalize(note({ url })).url, url);
  }
  assert.equal(model.normalize(note({ url: '   ' })).url, '');
  assert.equal(model.normalize(note({ url: ' https://example.test ' })).url, 'https://example.test');
});

test('role colors are yellow for fact, blue for thought, and green for source', () => {
  const { api, canvases } = browser();
  for (const [kind, color] of Object.entries({ fact: '#fff3bf', thought: '#dfedff', source: '#e3f3e5' })) {
    const canvas = api.render(note({ kind }));
    assert.equal(canvas, canvases.at(-1), 'Return the canvas itself');
    assert.equal(canvas.width, 600);
    assert.equal(canvas.height, 320);
    assert.equal(canvas.calls.find(call => call.op === 'fillRect').color, color);
    assert.equal(textRows(canvas)[0].text, kind.toUpperCase());
    insideBounds(canvas);
  }
});

test('plain HTML-looking user text is drawn literally, with no HTML, network, storage, or serialization', () => {
  const { api } = browser();
  const text = '<img src=x onerror=alert(1)> & <script>fetch("/")</script>';
  const canvas = api.render(note({ text }));
  assert.equal(textRows(canvas, 22).map(row => row.text).join(''), text);
  insideBounds(canvas);
});

test('title, complete body, source attribution, and source URL remain visible', () => {
  const { api } = browser();
  const input = note({ title: 'A researched claim', text: 'Evidence and explanation. '.repeat(15),
    source: 'Author, Book, page 23', url: 'https://example.test/research' });
  const canvas = api.render(input);
  assert.equal(textRows(canvas, 30).map(row => row.text).join(''), input.title);
  assert.equal(textRows(canvas, 22).map(row => row.text).join(''), input.text);
  assert.equal(textRows(canvas, 20).map(row => row.text).join(''), input.source + input.url);
  assert.ok(textRows(canvas).some(row => row.text === 'SOURCE / PROVENANCE'));
  insideBounds(canvas);
});

test('long words and maximum-length URLs wrap without ellipsis or missing characters', () => {
  const { api } = browser();
  for (const input of [note({ text: 'UnbrokenWord'.repeat(85) }),
    note({ url: 'https://example.test/' + 'x'.repeat(2048 - 'https://example.test/'.length) })]) {
    const canvas = api.render(input);
    assert.equal(textRows(canvas, input.url ? 20 : 22).map(row => row.text).join(''), input.url || input.text);
    assert.ok(canvas.height > 320);
    insideBounds(canvas);
  }
});

test('auto-height can display all 4000 narrow characters within the 1800px limit', () => {
  const { api } = browser();
  const text = 'i'.repeat(4000);
  const canvas = api.render(note({ text }));
  assert.equal(textRows(canvas, 22).map(row => row.text).join(''), text);
  assert.ok(canvas.height > 320);
  insideBounds(canvas);
});

test('Unicode graphemes and surrogate pairs survive wrapping intact', () => {
  const { api } = browser();
  const text = ('A\u0301 \u4e16\u754c \ud83d\udc69\u200d\ud83d\udcbb \ud83c\uddfa\ud83c\uddf8 ').repeat(25);
  const canvas = api.render(note({ text }));
  const lines = textRows(canvas, 22).map(row => row.text);
  assert.equal(lines.join(''), text);
  for (const line of lines) {
    assert.doesNotMatch(line, /^[\p{Mark}\u200d\udc00-\udfff]/u);
    assert.doesNotMatch(line, /[\ud800-\udbff]$/u);
    assert.doesNotMatch(line, /\u200d$/u);
  }
  insideBounds(canvas);
});

test('code-point fallback preserves astral text when Intl.Segmenter is unavailable', () => {
  const { api } = browser({ fallback: true });
  const text = '\ud83d\ude00'.repeat(100);
  const canvas = api.render(note({ text }));
  assert.equal(textRows(canvas, 22).map(row => row.text).join(''), text);
  insideBounds(canvas);
});

test('paragraph boundaries, blank lines, and trailing hard breaks are retained', () => {
  const { api } = browser();
  const canvas = api.render(note({ text: 'First\r\n\r\nLast\u2028' }));
  assert.deepEqual(textRows(canvas, 22).map(row => row.text), ['First', '', 'Last', '']);
  insideBounds(canvas);
});

test('actual glyph overhang and tall accents are included in layout bounds', () => {
  const { api } = browser({ overhang: true });
  const canvas = api.render(note({ text: 'Tall accents and overhanging letters. '.repeat(8) }));
  insideBounds(canvas);
});

test('oversize layouts throw before painting instead of silently clipping or shrinking', () => {
  const { api, canvases } = browser();
  for (const kind of ['fact', 'frame']) {
    assert.throws(() => api.render(note({ kind, text: 'W'.repeat(4000) })), /cannot fit without clipping/);
    assert.equal(canvases.at(-1).calls.length, 0);
  }
});

test('a glyph wider than the canvas throws instead of clipping', () => {
  const { api, canvases } = browser({ wideGlyph: true });
  assert.throws(() => api.render(note({ text: '\u754c' })), /glyph cannot fit/);
  assert.equal(canvases[0].calls.length, 0);
});

test('frames have a named title band, prompt, border, and mostly transparent interior', () => {
  const { api } = browser();
  const canvas = api.render(note({ kind: 'frame', title: 'Evidence zone', text: 'Place related facts here.' }));
  assert.equal(canvas.width, 1100);
  assert.equal(canvas.height, 800);
  const fills = canvas.calls.filter(call => call.op === 'fillRect');
  assert.equal(fills.length, 1);
  assert.ok(fills[0].height < canvas.height / 3);
  assert.ok(canvas.calls.some(call => call.op === 'strokeRect'));
  assert.equal(textRows(canvas, 30).map(row => row.text).join(''), 'Evidence zone');
  assert.equal(textRows(canvas, 22).map(row => row.text).join(''), 'Place related facts here.');
  insideBounds(canvas);
});

test('invalid notes fail before canvas creation; unavailable contexts fail explicitly', () => {
  const { api, canvases } = browser();
  assert.throws(() => api.render(note({ text: 'x'.repeat(4001) })), /Invalid research note/);
  assert.equal(canvases.length, 0);
  assert.throws(() => browser({ noContext: true }).api.render(note()), /2D canvas context/);
  assert.throws(() => model.render(note()), /requires a document/);
});

test('templates contain the required organizers and valid renderable frame records', () => {
  const { api } = browser();
  const templates = model.templates();
  assert.equal(new Set(templates.map(item => item.id)).size, templates.length);
  assert.equal(templates.find(item => item.id === 'research').frames.length, 3);
  const informative = templates.find(item => item.id === 'informative');
  assert.equal(informative.frames.length, 5);
  assert.match(informative.frames[0].text, /[Hh]ook.*central idea/);
  assert.equal(informative.frames.at(-1).title, 'Conclusion');
  assert.ok(templates.some(item => item.id === 'cause-effect'));
  for (const item of templates) {
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.description, 'string');
    for (const frame of item.frames) {
      assert.deepEqual(Object.keys(frame).sort(), ['text', 'title']);
      const input = note({ kind: 'frame', ...frame });
      assert.ok(model.normalize(input));
      insideBounds(api.render(input));
    }
  }
});

test('template constants are deeply frozen and template copies are independent', () => {
  assert.ok(Object.isFrozen(model.TEMPLATES));
  for (const item of model.TEMPLATES) {
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.frames));
    assert.ok(item.frames.every(Object.isFrozen));
  }
  const copy = model.templates();
  copy[0].frames[0].title = 'Changed';
  copy[0].frames.push({ title: 'Extra', text: 'Extra' });
  assert.equal(model.TEMPLATES[0].frames[0].title, 'Subtopic 1');
  assert.equal(model.templates()[0].frames.length, 3);
});
