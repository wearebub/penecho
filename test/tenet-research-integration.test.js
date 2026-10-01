'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { File } = require('node:buffer');
const vm = require('node:vm');

const read = name => readFileSync(join(__dirname, '../src/client/app', name), 'utf8');
const uiSource = read('tenet-research.js');
const modelSource = read('tenet-research-model.js');
const canvasSource = read('canvas-runtime.js');
const aiSource = read('ai-runtime.js');
const plain = value => JSON.parse(JSON.stringify(value));
const note = extra => ({ version: 1, kind: 'fact', title: 'Evidence', text: 'An observed fact.', source: 'Author, page 7', url: 'https://example.test/evidence', ...extra });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

// Execute real private functions, bounded by the next same-indent declaration.
function functionSource(source, name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `Missing production function ${name}`);
  const tail = source.slice(match.index);
  const next = /\n  (?:async )?function \w+\(/.exec(tail);
  assert.ok(next, `Missing end boundary for ${name}`);
  return tail.slice(0, next.index);
}
const runtimeSource = ['imageBox', 'imageHistoryRecord', 'storedImageRecord', 'imageRecord',
  'imageHistoryState', 'storedImages', 'recordImagesBefore', 'restoreImages',
  'decodeStoredImage', 'decodeStoredImages', 'deleteImage'].map(name => functionSource(canvasSource, name)).join('\n');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = {}; this.dataset = {}; this.listeners = new Map();
    this.value = ''; this._text = ''; this.open = false; this.disabled = false;
    this.hidden = false; this.readOnly = false; this.className = '';
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  prepend(node) { node.parentNode = this; this.children.unshift(node); }
  replaceChildren(...nodes) { for (const child of this.children) child.parentNode = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('#')) return this.id === part.slice(1);
      if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
      if (part.startsWith('[')) return Object.hasOwn(this.attributes, part.slice(1, -1));
      return this.tagName.toLowerCase() === part;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback, options = {}) {
    if (options.signal?.aborted) return;
    const entry = { callback, once: options.once };
    const entries = this.listeners.get(type) || [];
    entries.push(entry); this.listeners.set(type, entries);
    options.signal?.addEventListener('abort', () => this.removeEventListener(type, callback), { once: true });
  }
  removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.callback !== callback)); }
  dispatch(type, fields = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...fields };
    for (const entry of [...(this.listeners.get(type) || [])]) {
      entry.callback(event);
      if (entry.once) this.removeEventListener(type, entry.callback);
    }
    return event;
  }
  focus() { this.focused = true; }
  click() { if (!this.disabled) { this.onClick?.(); this.dispatch('click'); } }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; this.dispatch('close'); } }
}

function speech(options = {}) {
  const registrations = [], starts = [], cancellations = [];
  const plugin = {
    async addListener(name, callback) {
      const entry = { name, callback, removed: false, removals: 0 };
      registrations.push(entry);
      if (options.register) await options.register(entry, registrations.length);
      return { async remove() { entry.removed = true; entry.removals++; } };
    },
    async getVoiceCapabilities() { return { supported: true, locale: 'en-US', confirmsAudioInput: true }; },
    async startVoiceRecognition(request) { starts.push(request); return { state: 'listening', audioInput: true }; },
    async cancelVoiceRecognition(request) { cancellations.push(request); }
  };
  return { plugin, registrations, starts, cancellations,
    emit(name, event) { for (const entry of registrations) if (!entry.removed && entry.name === name) entry.callback(event); } };
}

function harness(options = {}) {
  const document = new Element('document'), window = new Element('window'), view = new Element('canvas');
  document.body = new Element('body'); document.head = new Element('head');
  document.append(document.head, document.body); document.readyState = 'complete'; document.hidden = false;
  document.getElementById = id => document.querySelector('#' + id);
  const toolbar = new Element('nav'); toolbar.setAttribute('data-tenet-ink-toolbar', ''); document.body.append(toolbar, view);
  const effects = { commits: [], persisted: [], messages: [], suspended: [], resumed: [], renders: [], artworks: [], downloads: [], objectUrls: [], revokedUrls: [], network: 0, ai: 0, scheduled: 0 };
  const timers = new Map(); let nextTimer = 0, uuid = 0, context;
  class LocalURL extends URL {
    static createObjectURL(blob) {
      const url = 'blob:research-test/' + (effects.objectUrls.length + 1);
      effects.objectUrls.push({ url, blob }); return url;
    }
    static revokeObjectURL(url) { effects.revokedUrls.push(url); }
  }
  document.createElement = tag => {
    const element = new Element(tag);
    if (tag === 'a') element.onClick = () => {
      const modal = element.closest('dialog');
      effects.downloads.push({ anchor: element, href: element.href, filename: element.download,
        modal, modalOpen: Boolean(modal?.open), connected: element.closest('body') === document.body });
    };
    if (tag === 'canvas') {
      element.width = 300; element.height = 150;
      const drawing = { font: '22px sans-serif', measureText(text) {
        return { width: Array.from(text).length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.5 };
      }, fillRect() {}, strokeRect() {}, fillText() {} };
      element.getContext = () => drawing;
    }
    return element;
  };
  const state = { images: [], nextImageId: 1, imageHistoryBefore: null, dirtyImageIds: new Set(), textEditors: new Set(),
    widgets: [{ id: 'existing-widget' }], textBoxes: [{ id: 'existing-text', text: 'Student writing' }],
    userRevision: 0, snapshotLoadGeneration: 1, autoEligible: true, mode: 'hand', auto: false,
    dirty: true, autoDelayMs: 1000, scale: 1, panX: 0, panY: 0, ...options.state };
  const ink = new Map([['tile-1', 'existing handwriting']]);
  window.PENECHO_CONFIG = { tenetMode: true };
  window.TenetInk = { async suspend(reason) { effects.suspended.push(reason); if (options.suspend) await options.suspend(reason); }, async resume(reason) { effects.resumed.push(reason); } };
  if (options.speech || options.native) window.Capacitor = { getPlatform: () => 'ios', Plugins: { TenetNative: options.speech?.plugin || options.native } };
  const sandbox = {
    window, document, view, state, Blob, File, URL: LocalURL, Intl, AbortController, navigator: { language: 'en-US', ...options.navigator },
    FileReader: class {
      readAsDataURL(blob) {
        blob.arrayBuffer().then(bytes => { this.result = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'); this.onload?.(); }, () => this.onerror?.());
      }
    },
    crypto: { randomUUID: () => 'speech-' + (++uuid) }, snapshotLoadInProgress: false,
    SIZE: options.size || 20000, MAX_VISIBLE_IMAGES: options.maxImages || 40,
    MAX_IMAGE_SOURCE_BYTES: 20 * 1024 * 1024, MAX_IMAGE_DIMENSION: 8192, MAX_IMAGE_PIXELS: 32 * 1024 * 1024,
    n: (value, min = 0, max = options.size || 20000) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, selectionAIBusy: () => false,
    tenetInkFlush: options.flush || (async () => {}), tenetInkMessage: message => effects.messages.push(message),
    tenetInkController: { sync() {} },
    acceptImageEdit() { state.imageEdit = null; }, acceptWidgetEdit() {}, acceptAnimationEdit() {},
    clearHandToolbarTargets() {}, clearHandToolbarTarget() {}, finishManualImageHandMode() {},
    async canvasBlob(canvas, type) {
      effects.renders.push({ width: canvas.width, height: canvas.height });
      effects.artworks.push(canvas);
      return options.encode ? options.encode(canvas, effects.renders.length) : new Blob(['local PNG fixture'], { type });
    },
    async renderExportCanvas() {
      if (options.boardRender) return options.boardRender();
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; return canvas;
    },
    imageFromBlob: options.decode || (async () => ({ width: 600, height: 320 })),
    importedImagePlacement: (w, h) => ({ x: 300, y: 500, w, h }),
    exportInkBounds: () => options.bounds || { x: 20, y: 30, w: 200, h: 300 },
    viewportRect: () => ({ x: 10, y: 20 }), canvasViewportMetrics: () => ({ width: 1200, height: 900 }),
    recomputeDirtyBounds() {}, updateCoordinates() {}, requestRender() {},
    setCanvasMode(mode) { state.mode = mode; }, beginImageEdit(item) { state.imageEdit = { id: item.id }; }, showHandObjectToolbar() {},
    saveUserCanvasChange() {
      effects.commits.push({ before: state.imageHistoryBefore, after: context.imageHistoryState() });
      effects.persisted.push(structuredClone(context.storedImages()));
      state.imageHistoryBefore = null;
    },
    setStatusKey(key) { state.statusKey = key; },
    canvasAgentSuppressesAutomaticAI: () => false, activeWidgetRefinement: () => false, currentWidgetRefineCandidate: () => false,
    launchAutomaticAI() { effects.ai++; },
    fetch() { effects.network++; throw new Error('Unexpected network request'); },
    clearCanvas() { throw new Error('Research must not erase existing work'); }
  };
  window.fetch = sandbox.fetch;
  context = vm.createContext(sandbox);
  vm.runInContext(modelSource, context, { filename: 'tenet-research-model.js' });
  vm.runInContext(runtimeSource, context, { filename: 'canvas-runtime.research-functions.js' });
  vm.runInContext(functionSource(aiSource, 'schedule'), context, { filename: 'ai-runtime.schedule.js' });
  const schedule = context.schedule;
  context.schedule = (...args) => { effects.scheduled++; return schedule(...args); };
  vm.runInContext(uiSource, context, { filename: 'tenet-research.js' });
  const field = name => document.getElementById('tenetResearch-' + name);
  const dialog = document.getElementById('tenetResearchDialog');
  const button = text => {
    const found = dialog.querySelectorAll('button').find(element => element.textContent === text);
    assert.ok(found, `Missing button ${text}`); return found;
  };
  const h = { context, state, effects, document, window, view, dialog, timers, ink, field, button,
    status: () => dialog.querySelector('.tenet-research-status').textContent,
    async open(id, draft) { await window.TenetResearch.open(id, draft); await settle(); },
    fill(data = note()) { for (const key of ['kind', 'title', 'text', 'source', 'url']) if (Object.hasOwn(data, key)) field(key).value = data[key]; },
    async click(text) { button(text).click(); await settle(); },
    async submit() { dialog.querySelector('form').dispatch('submit'); await settle(); },
    async template(id = 'research') {
      const title = window.TenetResearchModel.TEMPLATES.find(template => template.id === id).title;
      const tile = dialog.querySelector('.tenet-research-template-grid').children.find(child => child.textContent.startsWith(title));
      assert.ok(tile); tile.click(); await settle();
    },
    seed(data = note(), extra = {}) {
      const record = context.imageRecord({ x: 100, y: 200, w: 600, h: 320, naturalW: 600, naturalH: 320,
        blob: new Blob(['seed PNG'], { type: 'image/png' }), image: { width: 600, height: 320 }, tenetResearch: data, ...extra });
      assert.ok(record); state.images.push(record); return record;
    },
    undo() { const transaction = effects.commits.at(-1); assert.ok(transaction?.before); context.restoreImages(transaction.before); },
    redo() { context.restoreImages(effects.commits.at(-1).after); },
    async drop(text, uri = '') {
      view.dispatch('drop', { dataTransfer: { files: [], types: ['text/plain', 'text/uri-list'],
        getData: type => type === 'text/plain' ? text : type === 'text/uri-list' ? uri : '' } });
      await settle();
    },
    fireTimers() { const pending = [...timers.values()]; timers.clear(); for (const timer of pending) timer.callback(); }
  };
  return h;
}

test('adding a note commits actual normalized metadata, preserves other work, and never asks AI', async () => {
  const h = harness(), original = h.seed(null), widgets = h.state.widgets, textBoxes = h.state.textBoxes;
  await h.open(); h.fill(); await h.submit();
  assert.equal(h.state.images.length, 2, h.status());
  assert.equal(h.state.images[0], original);
  assert.deepEqual(plain(h.state.images[1].tenetResearch), note());
  assert.equal(h.effects.commits.length, 1);
  assert.equal(h.effects.commits[0].before.length, 1);
  assert.equal(h.state.userRevision, 1);
  assert.equal(h.state.autoEligible, false);
  assert.ok(h.state.dirtyImageIds.has(h.state.images[1].id));
  assert.equal(h.dialog.open, false);
  assert.equal(h.state.widgets, widgets); assert.equal(h.state.textBoxes, textBoxes);
  assert.equal(h.ink.get('tile-1'), 'existing handwriting');
  h.fireTimers(); assert.equal(h.effects.ai, 0); assert.equal(h.effects.network, 0);
  assert.deepEqual(h.effects.resumed, ['research-workspace']);
});

test('editing preserves image identity and placement; undo and redo retain original and edited provenance', async () => {
  const h = harness(), old = h.seed(note(), { x: 345, y: 678, w: 420, h: 360 });
  await h.open(old.id); h.fill({ text: 'Revised explanation.', source: 'New author, page 9' }); await h.submit();
  const edited = h.state.images[0];
  assert.equal(edited.id, old.id);
  assert.deepEqual(plain(h.context.imageBox(edited)), { x: 345, y: 678, w: 420, h: 360 });
  assert.equal(edited.tenetResearch.text, 'Revised explanation.', h.status());
  assert.equal(h.effects.commits.length, 1);
  assert.equal(old.tenetResearch.source, 'Author, page 7');
  h.undo(); assert.deepEqual(plain(h.state.images[0].tenetResearch), note());
  h.redo(); assert.equal(h.state.images[0].tenetResearch.source, 'New author, page 9');
});

test('duplicate stages the current draft and creates a distinct note only after Add to board', async () => {
  const h = harness(), original = h.seed();
  await h.open(original.id); h.fill({ text: 'Unsaved duplicate text.' }); await h.click('Duplicate');
  assert.equal(h.effects.commits.length, 0); assert.equal(h.state.images.length, 1);
  assert.equal(h.field('text').value, 'Unsaved duplicate text.', h.status());
  assert.equal(h.button('Delete note').hidden, true);
  await h.submit();
  assert.equal(h.state.images.length, 2, h.status());
  assert.notEqual(h.state.images[1].id, original.id);
  assert.equal(original.tenetResearch.text, note().text);
  assert.equal(h.state.images[1].tenetResearch.text, 'Unsaved duplicate text.');
  assert.equal(h.state.images[1].tenetResearch.url, original.tenetResearch.url);
});

test('delete removes only the selected note and its actual history restores editable metadata', async () => {
  const h = harness(), original = h.seed(), unrelated = h.seed(null);
  await h.open(original.id); await h.click('Delete note');
  assert.deepEqual(h.state.images.map(item => item.id), [unrelated.id]);
  assert.equal(h.effects.commits.length, 1);
  h.undo(); assert.deepEqual(plain(h.state.images[0].tenetResearch), note());
  assert.equal(h.state.images[1].id, unrelated.id);
});

test('deleting a research note with eligible handwriting must not schedule automatic AI', async () => {
  const h = harness({ state: { mode: 'pen', auto: true, autoEligible: true, dirty: true } });
  const original = h.seed(); await h.open(original.id); await h.click('Delete note');
  h.fireTimers();
  assert.equal(h.effects.ai, 0, 'Research deletion reached launchAutomaticAI through deleteImage -> schedule');
  assert.equal(h.state.autoEligible, false, 'Research deletion must retire automatic-AI eligibility');
});

test('invalid edits retain the saved note and do not create an undo entry', async () => {
  const h = harness(), original = h.seed();
  await h.open(original.id); h.fill({ url: 'javascript:alert(1)' }); await h.submit();
  assert.equal(h.state.images[0], original); assert.equal(h.effects.commits.length, 0);
  assert.ok(h.dialog.open); assert.match(h.status(), /http|source|link/i);
});

test('organizer insertion is a single undoable transaction and never erases preexisting work', async () => {
  const h = harness(), existing = h.seed(), widgets = h.state.widgets, textBoxes = h.state.textBoxes;
  await h.open(); await h.template();
  assert.equal(h.state.images.length, 4, h.status());
  assert.equal(h.state.images[3], existing);
  assert.deepEqual(h.state.images.slice(0, 3).map(item => item.tenetResearch.kind), ['frame', 'frame', 'frame']);
  assert.ok(h.state.images.slice(0, 3).every(item => item.y >= 30 + 300 + 80));
  assert.equal(h.effects.commits.length, 1); assert.equal(h.state.userRevision, 1);
  assert.equal(h.state.widgets, widgets); assert.equal(h.state.textBoxes, textBoxes);
  assert.equal(h.ink.get('tile-1'), 'existing handwriting'); assert.equal(h.state.autoEligible, false);
  h.undo(); assert.equal(h.state.images.length, 1); assert.equal(h.state.images[0].id, existing.id);
});

test('organizer encoding failure on its second frame adds nothing and preserves undo history', async () => {
  const h = harness({ encode: (_, count) => { if (count === 2) throw new Error('Synthetic encoder failure'); return new Blob(['PNG']); } });
  const existing = h.seed(); await h.open(); await h.template();
  assert.equal(h.effects.renders.length, 2, h.status());
  assert.equal(h.state.images.length, 1); assert.equal(h.state.images[0], existing);
  assert.equal(h.effects.commits.length, 0); assert.equal(h.state.userRevision, 0);
  assert.match(h.status(), /encoder failure/); assert.equal(h.dialog.getAttribute('aria-busy'), 'false');
});

test('organizers refuse image capacity and finite-canvas overflow without partial insertion', async () => {
  for (const options of [{ maxImages: 3 }, { bounds: { x: 0, y: 19500, w: 100, h: 300 } }, { size: 2000 }]) {
    const h = harness(options), original = h.seed(); await h.open(); await h.template();
    assert.equal(h.state.images.length, 1, h.status()); assert.equal(h.state.images[0], original);
    assert.equal(h.effects.commits.length, 0); assert.equal(h.state.userRevision, 0);
    assert.match(h.status(), /room|space|prepared/i);
  }
});

for (const [label, mutate] of [
  ['page generation changes', h => h.state.snapshotLoadGeneration++],
  ['revision changes', h => h.state.userRevision++],
  ['page becomes read-only', h => { h.state.viewMode = true; }],
  ['another selection starts', h => { h.state.selection = {}; }],
  ['dialog closes', h => h.dialog.close()],
  ['sign-out occurs', h => h.window.dispatch('tenet:sign-out')]
]) {
  test(`pending note serialization cannot commit after ${label}`, async () => {
    const gate = deferred(), h = harness({ decode: () => gate.promise }), original = h.seed();
    await h.open(original.id); h.fill({ text: 'Should never be committed.' }); await h.submit();
    assert.equal(h.effects.renders.length, 1, h.status());
    assert.equal(h.dialog.getAttribute('aria-busy'), 'true');
    mutate(h); gate.resolve({ width: 600, height: 320 }); await settle();
    assert.equal(h.state.images.length, 1); assert.equal(h.state.images[0], original);
    assert.equal(h.effects.commits.length, 0);
    assert.equal(h.dialog.getAttribute('aria-busy'), 'false');
  });
}

test('organizer page changes during preparation never commit even the first completed frame', async () => {
  const gate = deferred(); let decodes = 0;
  const h = harness({ decode: async () => ++decodes === 2 ? gate.promise : { width: 1100, height: 800 } });
  const existing = h.seed(); await h.open(); await h.template();
  assert.equal(decodes, 2, h.status()); h.state.snapshotLoadGeneration++;
  gate.resolve({ width: 1100, height: 800 }); await settle();
  assert.equal(h.state.images.length, 1); assert.equal(h.state.images[0], existing);
  assert.equal(h.effects.commits.length, 0); assert.match(h.status(), /page changed/i);
});

test('changing pages while opening waits for ink cannot carry the old draft into the new page', async () => {
  const gate = deferred(), h = harness({ flush: () => gate.promise });
  const opening = h.window.TenetResearch.open(null, note({ text: 'Draft from page one' }));
  await settle(); h.state.snapshotLoadGeneration++; gate.resolve(); await opening;
  assert.equal(h.dialog.open, false, 'Open accepted a new generation after awaiting ink flush');
  assert.equal(h.effects.commits.length, 0);
});

for (const phase of ['suspend', 'flush']) {
  test(`sign-out during opening while awaiting ${phase} cannot reopen the retired dialog`, async () => {
    const gate = deferred(), h = harness({ [phase]: () => gate.promise }), original = h.seed();
    const opening = h.window.TenetResearch.open(null, note({ text: 'Private draft before sign-out' }));
    await settle();
    assert.equal(h.dialog.open, false); assert.equal(h.effects.suspended.length, 1);
    const generation = h.state.snapshotLoadGeneration;
    h.window.dispatch('tenet:sign-out');
    assert.equal(h.state.snapshotLoadGeneration, generation, 'Exercise retirement independently of page navigation');
    gate.resolve(); await opening; await settle();
    assert.equal(h.dialog.open, false, 'A continuation reopened Research after sign-out');
    assert.equal(h.state.images[0], original); assert.equal(h.state.images.length, 1);
    assert.equal(h.effects.commits.length, 0);
    assert.deepEqual(h.effects.resumed, ['research-workspace']);
    assert.equal(h.effects.network, 0); assert.equal(h.effects.ai, 0);
  });
}

test('Plan & Write uses consistent visible names without changing saved-data or bridge identities', async () => {
  const h = harness();
  await h.open();
  assert.equal(h.dialog.querySelector('h2').textContent, 'Plan & Write');
  assert.equal(h.dialog.getAttribute('aria-labelledby'), 'tenetResearchTitle');
  assert.match(uiSource, /trigger = button\("Plan & Write",/);
  assert.doesNotMatch(uiSource, /button\("Research",|"Research & writing"|Reopen Research/);
  assert.equal(typeof h.window.TenetResearch.open, 'function');
  assert.equal(h.window.TenetResearchModel.TEMPLATES.find(item => item.id === 'research').title, 'Topic organizer');
  assert.match(h.status(), /Plan & Write stays on this iPad/);
  h.fill();
  await h.submit();
  assert.equal(h.state.images[0].tenetResearch.version, 1);
  assert.deepEqual(plain(h.state.images[0].tenetResearch), note());
});

test('read-only and loading pages cannot open Plan & Write', async () => {
  for (const loading of [false, true]) {
    const h = harness(); h.state.viewMode = !loading; h.context.snapshotLoadInProgress = loading;
    await h.open(); assert.equal(h.dialog.open, false);
    assert.equal(h.effects.suspended.length, 0); assert.equal(h.effects.commits.length, 0);
    assert.match(h.effects.messages.at(-1), /editable page/i);
  }
});

test('dropped quotations retain source URLs and require explicit Add to board', async () => {
  const h = harness(); await h.drop('A copied quotation.', '# browser comment\nhttps://example.test/source');
  assert.equal(h.dialog.open, true, h.status());
  assert.equal(h.field('text').value, 'A copied quotation.');
  assert.equal(h.field('url').value, 'https://example.test/source');
  assert.equal(h.effects.commits.length, 0); await h.submit();
  assert.equal(h.state.images[0].tenetResearch.version, 1);
  assert.equal(h.state.images[0].tenetResearch.url, 'https://example.test/source');
});

test('a URI-list-only browser link drop opens a usable source-card draft', async () => {
  const h = harness(); await h.drop('', 'https://example.test/source');
  assert.equal(h.dialog.open, true, 'A valid link-only drop was rejected: ' + h.status());
  assert.equal(h.field('kind').value, 'source');
  assert.equal(h.field('url').value, 'https://example.test/source');
  await h.submit(); assert.equal(h.state.images.length, 1, h.status());
});

test('drop errors while Plan & Write is closed produce a visible canvas message', async () => {
  const h = harness(); await h.drop('Unsafe link', 'javascript:alert(1)');
  assert.equal(h.dialog.open, false); assert.equal(h.effects.commits.length, 0);
  assert.ok(h.effects.messages.some(message => /http|source|link/i.test(message)), 'Error was only written into a closed dialog');
});

test('stored metadata survives structured cloning, image decoding, restore, and reopening the editor', async () => {
  const h = harness(), original = h.seed(note({ text: '<b>Literal quotation</b>' }));
  const stored = structuredClone(h.context.storedImages());
  assert.equal(Object.hasOwn(stored[0], 'image'), false);
  original.tenetResearch.source = 'Changed in memory';
  assert.equal(stored[0].tenetResearch.source, 'Author, page 7');
  const decoded = await h.context.decodeStoredImages(stored); h.context.restoreImages(decoded);
  assert.deepEqual(plain(h.state.images[0].tenetResearch), note({ text: '<b>Literal quotation</b>' }));
  await h.open(original.id);
  assert.equal(h.field('text').value, '<b>Literal quotation</b>'); assert.equal(h.field('source').value, 'Author, page 7');
  assert.ok(h.state.nextImageId > Number(original.id.split('-')[1]));
});

test('restoration strips invalid or unknown metadata without discarding the ordinary image', async () => {
  const h = harness();
  const valid = h.seed(note({ unexpected: 'discard me' }));
  assert.equal(Object.hasOwn(valid.tenetResearch, 'unexpected'), false);
  const invalid = { ...h.context.storedImageRecord(valid), id: 'image-70', tenetResearch: note({ url: 'data:text/html,unsafe' }) };
  const decoded = await h.context.decodeStoredImages([invalid]); h.context.restoreImages(decoded);
  assert.equal(h.state.images.length, 1); assert.equal(h.state.images[0].id, 'image-70');
  assert.equal(Object.hasOwn(h.state.images[0], 'tenetResearch'), false);
  assert.equal(h.state.nextImageId, 71);
});

test('browser dictation fallback focuses the textarea and never calls AI or saves a note', async () => {
  const h = harness(); await h.open(); await h.click('Dictate a note');
  assert.equal(h.field('text').focused, true); assert.match(h.status(), /keyboard.*dictate|microphone/i);
  assert.equal(h.effects.commits.length, 0); assert.equal(h.effects.network, 0); assert.equal(h.effects.ai, 0);
});

test('native dictation applies matching transcripts once, preserves drafts, and needs explicit save', async () => {
  const native = speech(), h = harness({ speech: native }); await h.open(); h.fill({ text: 'Existing idea.' });
  await h.click('Dictate a note'); assert.equal(native.starts.length, 1);
  const sessionId = native.starts[0].sessionId;
  native.emit('voiceTranscript', { sessionId: 'unrelated-session', text: 'Ignore this' });
  assert.equal(h.field('text').value, 'Existing idea.');
  native.emit('voiceTranscript', { sessionId, text: 'First words' });
  native.emit('voiceTranscript', { sessionId, text: 'First words completed.' });
  assert.equal(h.field('text').value, 'Existing idea.\nFirst words completed.');
  assert.equal(h.field('text').readOnly, true);
  native.emit('voiceState', { sessionId, state: 'stopped', text: 'Final words.' }); await settle();
  assert.equal(h.field('text').value, 'Existing idea.\nFinal words.'); assert.equal(h.field('text').readOnly, false);
  assert.equal(h.effects.commits.length, 0); assert.equal(h.effects.network, 0); assert.equal(h.effects.ai, 0);
  assert.ok(native.registrations.every(entry => entry.removed), 'Stopped dictation retained native listeners');
});

test('oversize dictation retains existing text and stops the native session', async () => {
  const native = speech(), h = harness({ speech: native }); await h.open(); h.fill({ text: 'Keep this text.' });
  await h.click('Dictate a note'); const sessionId = native.starts[0].sessionId;
  native.emit('voiceTranscript', { sessionId, text: 'x'.repeat(4000) }); await settle();
  assert.equal(h.field('text').value, 'Keep this text.'); assert.equal(h.field('text').readOnly, false);
  assert.ok(native.cancellations.some(request => request.sessionId === sessionId));
  assert.equal(h.effects.commits.length, 0);
});

for (const cancellation of ['close', 'sign-out', 'pagehide']) {
  test(`late native listener registration is removed after ${cancellation}`, async () => {
    const gate = deferred(), native = speech({ register: (_, number) => number === 1 ? gate.promise : undefined });
    const h = harness({ speech: native }); await h.open(); h.fill({ text: 'Keep draft' }); await h.click('Dictate a note');
    assert.equal(native.registrations.length, 1);
    if (cancellation === 'close') h.dialog.close();
    else h.window.dispatch(cancellation === 'sign-out' ? 'tenet:sign-out' : 'pagehide', { persisted: false });
    gate.resolve(); await settle();
    assert.equal(native.starts.length, 0);
    assert.ok(native.registrations.every(entry => entry.removed), 'A listener resolved after cancellation and leaked');
    native.emit('voiceTranscript', { sessionId: 'speech-1', text: 'Stale transcript' });
    assert.equal(h.field('text').value, 'Keep draft'); assert.equal(h.field('text').readOnly, false);
  });
}

test('dictation from a previous page cannot alter the current draft', async () => {
  const native = speech(), h = harness({ speech: native }); await h.open(); h.fill({ text: 'Original draft' });
  await h.click('Dictate a note'); const sessionId = native.starts[0].sessionId;
  h.state.snapshotLoadGeneration++;
  native.emit('voiceTranscript', { sessionId, text: 'Late result from old page' });
  assert.equal(h.field('text').value, 'Original draft'); assert.equal(h.effects.commits.length, 0);
  h.dialog.close(); await settle();
});

function exportReleased(h, original) {
  assert.equal(h.dialog.getAttribute('aria-busy'), 'false');
  assert.ok(h.dialog.querySelectorAll('button,input,textarea,select').every(control => !control.disabled));
  assert.equal(h.state.images.length, 1); assert.equal(h.state.images[0], original);
  assert.equal(h.effects.commits.length, 0); assert.equal(h.effects.network, 0); assert.equal(h.effects.ai, 0);
  for (const canvas of h.effects.artworks) { assert.equal(canvas.width, 1); assert.equal(canvas.height, 1); }
}

for (const action of ['Save note as image', 'Save board as image']) {
  test(`${action}: browser download clicks a connected anchor inside the open dialog`, async () => {
    let shares = 0;
    const h = harness({ navigator: { canShare: () => true, share: async () => { shares++; } } });
    const original = h.seed(); await h.open(original.id); await h.click(action);
    assert.equal(h.effects.downloads.length, 1, h.status());
    const download = h.effects.downloads[0];
    assert.equal(download.modal, h.dialog, 'An anchor outside the modal is inert');
    assert.equal(download.modalOpen, true); assert.equal(download.connected, true);
    assert.match(download.filename, /\.png$/);
    assert.equal(h.effects.objectUrls.length, 1);
    assert.equal(download.href, h.effects.objectUrls[0].url);
    assert.equal(h.effects.objectUrls[0].blob.type, 'image/png');
    assert.ok(h.effects.objectUrls[0].blob.size > 0);
    assert.equal(shares, 0, 'Browser export must download directly instead of opening Web Share');
    assert.equal(download.anchor.parentNode, null, 'Temporary download anchor is removed after clicking');
    assert.equal(h.dialog.open, true); assert.match(h.status(), /Image prepared/i);
    exportReleased(h, original);
    h.fireTimers(); assert.ok(h.effects.revokedUrls.includes(download.href), 'Temporary blob URL must be revoked');
  });
}

for (const action of ['Save note as image', 'Save board as image']) {
  test(`${action}: encoder failure releases busy state and temporary artwork`, async () => {
    const h = harness({ encode: () => { throw new Error('Synthetic PNG encoding failure'); } }), original = h.seed();
    await h.open(original.id); await h.click(action);
    assert.match(h.status(), /PNG encoding failure/); assert.equal(h.effects.artworks.length, 1);
    exportReleased(h, original);
  });

  test(`${action}: a pending native share stays busy, then cancellation releases controls`, async () => {
    const gate = deferred(), shares = [];
    const h = harness({ native: { exportFile: request => { shares.push(request); return gate.promise; } } });
    const original = h.seed(); await h.open(original.id); await h.click(action);
    assert.equal(shares.length, 1); assert.match(shares[0].filename, /\.png$/); assert.ok(shares[0].base64);
    assert.equal(h.dialog.getAttribute('aria-busy'), 'true'); assert.equal(h.button(action).disabled, true);
    gate.reject(Object.assign(new Error('System share cancelled'), { name: 'AbortError' })); await settle();
    exportReleased(h, original);
    assert.doesNotMatch(h.status(), /System share cancelled/);
  });
}

test('native PNG export failures and cancellation always release busy state', async () => {
  for (const error of [new Error('Native export failed'), Object.assign(new Error('Cancelled'), { name: 'AbortError' }),
    Object.assign(new Error('Unsupported filename'), { code: 'invalid_export_filename' })]) {
    const exports = [], h = harness({ native: { async exportFile(request) { exports.push(request); throw error; } } });
    const original = h.seed(); await h.open(original.id); await h.click('Save note as image');
    assert.equal(exports.length, 1); assert.match(exports[0].filename, /\.png$/); assert.ok(exports[0].base64);
    exportReleased(h, original);
    if (error.code) assert.match(h.status(), /TestFlight|PNG sharing/);
  }
});

test('board-render failure releases busy state before a PNG exists', async () => {
  const h = harness({ boardRender: () => { throw new Error('Board rendering failed'); } }), original = h.seed();
  await h.open(original.id); await h.click('Save board as image');
  assert.match(h.status(), /Board rendering failed/); assert.equal(h.effects.artworks.length, 0);
  exportReleased(h, original);
});

test('a page switch during PNG encoding blocks sharing and releases export controls', async () => {
  const gate = deferred(); let shares = 0;
  const h = harness({ encode: () => gate.promise, navigator: { canShare: () => true, share: async () => { shares++; } } });
  const original = h.seed(); await h.open(original.id); await h.click('Save note as image');
  assert.equal(h.dialog.getAttribute('aria-busy'), 'true'); h.state.snapshotLoadGeneration++;
  gate.resolve(new Blob(['PNG'], { type: 'image/png' })); await settle();
  assert.equal(shares, 0); assert.match(h.status(), /page changed/i); exportReleased(h, original);
});
