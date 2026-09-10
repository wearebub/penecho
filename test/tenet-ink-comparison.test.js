'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const MODULE_PATH = path.join(__dirname, '../src/client/app/tenet-ink-comparison.js');
const STORAGE_KEY = 'tenet.ink-comparison.v1';
const TOOLBAR_ID = 'tenet-ink-comparison-toolbar';
const source = fs.readFileSync(MODULE_PATH, 'utf8').replace(/\r\n/g, '\n');

// Private entry points are exposed only inside this test VM.
const instrumented = source.replace(/\n  activate\(\);\s*\}\)\(\);\s*$/, [
  '',
  '  globalThis.inkTest = { normalizeStatus, switchEngine };',
  '  activate();',
  '})();'
].join('\n'));
assert.notEqual(instrumented, source, 'The test seam must match the module startup');
const script = new vm.Script(instrumented, { filename: MODULE_PATH });

class ListenerTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, handler, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Map());
    this.listeners.get(name).set(handler, {
      once: Boolean(options && options.once),
      capture: options === true || Boolean(options && options.capture)
    });
  }
  removeEventListener(name, handler, options) {
    const capture = options === true || Boolean(options && options.capture);
    if (this.listeners.get(name)?.get(handler)?.capture === capture) this.listeners.get(name).delete(handler);
  }
  listenerCount(name) { return this.listeners.get(name)?.size || 0; }
  dispatchEvent(event) {
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    event.stopImmediatePropagation ||= () => { event.immediateStopped = true; };
    const handlers = [...(this.listeners.get(event.type) || [])]
      .sort((a, b) => Number(b[1].capture) - Number(a[1].capture));
    for (const [handler, options] of handlers) {
      if (event.immediateStopped) break;
      if (options.once) this.removeEventListener(event.type, handler, options.capture);
      handler(event);
    }
    return !event.defaultPrevented;
  }
}

// Generic fragment parsing makes reintroduced controls observable in the fixture.
class Element extends ListenerTarget {
  constructor(tag, document) {
    super();
    Object.assign(this, {
      tagName: tag.toUpperCase(), ownerDocument: document, children: [], parentNode: null,
      attributes: new Map(), dataset: {}, id: '', className: '', hidden: false, disabled: false, ownText: ''
    });
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'hidden') this.hidden = true;
  }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'hidden') return this.hidden ? '' : null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'id') this.id = '';
    if (name === 'class') this.className = '';
    if (name === 'hidden') this.hidden = false;
  }
  get classList() {
    return {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(value => !names.includes(value)).join(' '); }
    };
  }
  get firstElementChild() { return this.children[0] || null; }
  get isConnected() {
    for (let element = this; element; element = element.parentNode) {
      if (element === this.ownerDocument.body || element === this.ownerDocument.head) return true;
    }
    return false;
  }
  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  set textContent(value) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this.ownText = String(value);
  }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this.textContent = '';
    this.ownerDocument.fragments.push(value);
    const elements = /<([a-z][\w-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;
    let found = false;
    while ((match = elements.exec(value))) {
      found = true;
      const child = this.ownerDocument.createElement(match[1]);
      const attributes = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attribute;
      while ((attribute = attributes.exec(match[2]))) {
        child.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      }
      child.innerHTML = match[3];
      this.appendChild(child);
    }
    if (!found) this.ownText = value;
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) {
      const value = this.getAttribute(attribute[1]);
      return attribute[2] === undefined ? value !== null : value === attribute[2];
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let element = this; element; element = element.parentNode) {
      if (element.matches(selector)) return element;
    }
    return null;
  }
  click() {
    const event = { type: 'click', target: this };
    if (!this.disabled) this.dispatchEvent(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
}

class Document extends ListenerTarget {
  constructor(readyState = 'complete') {
    super();
    this.readyState = readyState;
    this.created = [];
    this.fragments = [];
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.activeElement = null;
  }
  createElement(tag) {
    const element = new Element(tag, this);
    this.created.push(element);
    return element;
  }
  querySelectorAll(selector) {
    return [this.head, this.body].flatMap(root => [
      ...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelector('#' + id); }
}

function harness(options = {}) {
  const document = new Document(options.readyState || 'complete');
  const window = new ListenerTarget();
  const calls = [];
  const timers = new Map();
  const observers = [];
  const storageAccess = [];
  const frameRequests = [];
  const storage = new Map([
    [STORAGE_KEY, 'retired records must remain opaque and untouched'],
    ['tenet-notebook-v1', '{"version":1,"pages":{"saved":{"subjectId":"math"}}}']
  ]);
  const status = {
    engine: options.engine || 'web',
    strokeCount: options.strokeCount ?? null,
    busy: options.busy ?? false,
    nativeAvailable: options.nativeAvailable ?? true
  };
  const api = {
    available: options.available ?? true,
    getStatus() { return { ...status }; },
    async flush() { calls.push('flush'); },
    async setEngine(engine) { calls.push('setEngine:' + engine); status.engine = engine; },
    async suspend() { calls.push('suspend'); },
    async resume() { calls.push('resume'); }
  };
  let timerId = 0;
  Object.assign(window, {
    TenetInk: api,
    localStorage: {
      getItem(key) { storageAccess.push(['get', key]); return storage.get(key) ?? null; },
      setItem(key, value) { storageAccess.push(['set', key]); storage.set(key, String(value)); },
      removeItem(key) { storageAccess.push(['remove', key]); storage.delete(key); },
      clear() { storageAccess.push(['clear']); storage.clear(); }
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frameRequests.push(callback); return frameRequests.length; },
    cancelAnimationFrame() {}
  });
  class Observer {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    trigger() { if (this.connected) this.callback([]); }
  }
  function addToolbar() {
    const target = document.createElement('div');
    target.setAttribute('data-tenet-ink-toolbar', '');
    document.body.appendChild(target);
    return target;
  }
  const hostToolbar = options.toolbar === false ? null : addToolbar();
  const context = vm.createContext({ window, document, MutationObserver: Observer });
  script.runInContext(context);
  return {
    window, document, api, status, calls, timers, observers, storage, storageAccess, frameRequests,
    controls: context.inkTest, hostToolbar, addToolbar,
    toolbar: () => document.getElementById(TOOLBAR_ID),
    button: () => document.querySelector('[data-tic="engine-button"]'),
    notice: () => document.querySelector('[data-tic="notice"]'),
    dock: () => document.querySelector('.tic-dock'),
    statusEvent(detail = { ...status }) { window.dispatchEvent({ type: 'tenet:ink-status', detail }); },
    hide(persisted = false) { window.dispatchEvent({ type: 'pagehide', persisted }); },
    show() { window.dispatchEvent({ type: 'pageshow', persisted: true }); }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function nextTurn() { return new Promise(resolve => setImmediate(resolve)); }

test('status preserves unknown Web inventory, authoritative zero, and safe numeric inventory', () => {
  const { controls } = harness({ available: false });
  for (const engine of ['web', 'pencilkit']) {
    for (const strokeCount of [null, 0, 7, Number.MAX_SAFE_INTEGER]) {
      const status = { engine, strokeCount, busy: false, nativeAvailable: true };
      assert.deepEqual(plain(controls.normalizeStatus(status)), status);
    }
  }
});

test('malformed status counts and availability fields are refused without coercion', () => {
  const { controls } = harness({ available: false });
  const valid = { engine: 'web', strokeCount: null, busy: false, nativeAvailable: true };
  for (const strokeCount of [-1, '0', '2', undefined, false, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => controls.normalizeStatus({ ...valid, strokeCount }), /Invalid ink status/);
  }
  for (const value of [null, undefined, false, [], {}, { ...valid, engine: 'unknown' }]) {
    assert.throws(() => controls.normalizeStatus(value), /Invalid ink status/);
  }
  for (const field of ['busy', 'nativeAvailable']) {
    for (const value of [undefined, null, 0, 1, 'false', 'true']) {
      assert.throws(() => controls.normalizeStatus({ ...valid, [field]: value }), /Invalid ink status/);
    }
  }
});

test('only the engine control mounts; comparison UI, storage, and collectors stay retired', async () => {
  const instance = harness();
  const originalStorage = [...instance.storage];
  assert.equal(instance.toolbar().parentNode, instance.hostToolbar);
  assert.equal(instance.toolbar().getAttribute('role'), 'group');
  assert.equal(instance.toolbar().getAttribute('aria-label'), 'Ink renderer controls');
  assert.equal(instance.button().getAttribute('data-tic'), 'engine-button');
  assert.equal(instance.button().textContent, 'Ink: Web');
  assert.equal(instance.document.querySelectorAll('[data-tic="engine-button"]').length, 1);
  assert.equal(instance.document.created.some(element => element.tagName === 'DIALOG'), false);
  for (const name of ['compare', 'task', 'start', 'stop', 'rating-form', 'results', 'export']) {
    assert.equal(instance.document.querySelector('[data-tic="' + name + '"]'), null, name);
  }
  assert.doesNotMatch(instance.document.fragments.join('\n'), /Compare ink|Stop and rate|Local results/i);
  assert.equal(instance.window.listenerCount('tenet:ink-sample'), 0);
  assert.equal(instance.document.listenerCount('visibilitychange'), 0);
  instance.window.dispatchEvent({ type: 'tenet:ink-sample', detail: { kind: 'stroke', engine: 'web' } });
  instance.document.dispatchEvent({ type: 'visibilitychange' });
  instance.button().click();
  await nextTurn();
  instance.hide(true);
  instance.show();
  assert.deepEqual(instance.storageAccess, []);
  assert.deepEqual([...instance.storage], originalStorage);
  assert.deepEqual(instance.frameRequests, []);
});

test('the visible button switches Web and PencilKit, flushing before each change', async () => {
  const instance = harness();
  instance.button().click();
  await nextTurn();
  assert.deepEqual(instance.calls, ['flush', 'setEngine:pencilkit']);
  assert.equal(instance.button().textContent, 'Ink: PencilKit');
  assert.equal(instance.button().disabled, false);
  assert.equal(instance.dock().hidden, true, 'Successful switches leave no obsolete notices');
  instance.button().click();
  await nextTurn();
  assert.deepEqual(instance.calls, ['flush', 'setEngine:pencilkit', 'flush', 'setEngine:web']);
  assert.equal(instance.button().textContent, 'Ink: Web');
  assert.deepEqual(instance.storageAccess, []);
});

test('switching waits for flush completion and excludes concurrent changes', async () => {
  const instance = harness();
  const flush = deferred();
  instance.api.flush = () => { instance.calls.push('flush'); return flush.promise; };
  const switching = instance.controls.switchEngine('pencilkit');
  assert.deepEqual(instance.calls, ['flush']);
  assert.equal(instance.button().disabled, true);
  assert.equal(instance.toolbar().getAttribute('aria-busy'), 'true');
  assert.equal(instance.button().textContent, 'Ink: Switching...');
  await instance.controls.switchEngine('web');
  assert.deepEqual(instance.calls, ['flush']);
  flush.resolve();
  await switching;
  assert.deepEqual(instance.calls, ['flush', 'setEngine:pencilkit']);
  assert.equal(instance.toolbar().getAttribute('aria-busy'), 'false');
  assert.equal(instance.button().textContent, 'Ink: PencilKit');
});

test('busy and unavailable engines cannot switch; invalid engine names are ignored', async () => {
  for (const options of [{ busy: true }, { nativeAvailable: false }, { available: false }]) {
    const instance = harness(options);
    if (instance.button()) assert.equal(instance.button().disabled, true);
    await instance.controls.switchEngine('pencilkit');
    assert.deepEqual(instance.calls, []);
    assert.equal(instance.status.engine, 'web');
  }
  const instance = harness();
  await instance.controls.switchEngine('unknown');
  assert.deepEqual(instance.calls, []);
  assert.equal(instance.dock().hidden, true);
});

test('flush failures, native failures, and incomplete switches expose the actual current engine', async () => {
  for (const failure of ['flush', 'native', 'incomplete']) {
    const instance = harness();
    if (failure === 'flush') {
      instance.api.flush = async () => { instance.calls.push('flush'); throw new Error('flush failed'); };
    } else {
      instance.api.setEngine = async engine => {
        instance.calls.push('setEngine:' + engine);
        if (failure === 'native') throw new Error('native failed');
      };
    }
    await instance.controls.switchEngine('pencilkit');
    assert.deepEqual(instance.calls, failure === 'flush' ? ['flush'] : ['flush', 'setEngine:pencilkit']);
    assert.equal(instance.button().textContent, 'Ink: Web');
    assert.equal(instance.button().disabled, false);
    assert.equal(instance.dock().hidden, false);
    assert.equal(instance.notice().getAttribute('role'), 'alert');
    assert.match(instance.notice().textContent, /could not switch/);
    assert.doesNotMatch(instance.notice().textContent, /comparison|trial|rating/i);
    instance.document.querySelector('[data-tic="dismiss"]').click();
    assert.equal(instance.dock().hidden, true);
    assert.equal(instance.document.activeElement, instance.button());
  }
});

test('status events update the toggle and malformed status fails closed until valid status returns', () => {
  const instance = harness();
  Object.assign(instance.status, { engine: 'pencilkit', strokeCount: 0 });
  instance.statusEvent();
  assert.equal(instance.button().textContent, 'Ink: PencilKit');
  instance.statusEvent({ ...instance.status, strokeCount: '0' });
  assert.equal(instance.button().textContent, 'Ink: Unavailable');
  assert.equal(instance.button().disabled, true);
  instance.statusEvent();
  assert.equal(instance.button().disabled, false);
  instance.status.busy = true;
  instance.statusEvent();
  assert.equal(instance.button().disabled, true);
  instance.api.available = false;
  instance.statusEvent();
  assert.equal(instance.toolbar().hidden, true);
  Object.assign(instance.status, { busy: false, nativeAvailable: false, engine: 'web' });
  instance.api.available = true;
  instance.statusEvent();
  assert.equal(instance.toolbar().hidden, false);
  assert.equal(instance.button().textContent, 'Ink: Web');
  assert.equal(instance.button().disabled, true);
  assert.match(instance.button().title, /PencilKit is not available/);
});

test('DOM and API readiness can arrive late without duplicate controls', () => {
  const instance = harness({ readyState: 'loading', available: false });
  assert.equal(instance.toolbar(), null);
  instance.document.readyState = 'complete';
  instance.document.dispatchEvent({ type: 'DOMContentLoaded' });
  assert.equal(instance.toolbar(), null);
  instance.api.available = true;
  instance.statusEvent();
  instance.statusEvent();
  assert.equal(instance.document.querySelectorAll('[data-tic="engine-button"]').length, 1);
  assert.deepEqual(instance.storageAccess, []);
});

test('pagehide during flush prevents the subsequent engine change and removes listeners/UI', async () => {
  const instance = harness();
  const flush = deferred();
  instance.api.flush = () => { instance.calls.push('flush'); return flush.promise; };
  const switching = instance.controls.switchEngine('pencilkit');
  instance.hide();
  assert.equal(instance.toolbar(), null);
  assert.equal(instance.dock(), null);
  assert.equal(instance.document.getElementById('tenet-ink-comparison-styles'), null);
  assert.equal(instance.window.listenerCount('tenet:ink-status'), 0);
  assert.equal(instance.window.listenerCount('pagehide'), 0);
  flush.resolve();
  await switching;
  instance.statusEvent();
  assert.deepEqual(instance.calls, ['flush']);
  assert.equal(instance.toolbar(), null);
});

test('completion of an already-started native switch cannot recreate disposed UI', async () => {
  const instance = harness();
  const native = deferred();
  instance.api.setEngine = async engine => {
    instance.calls.push('setEngine:' + engine);
    await native.promise;
    instance.status.engine = engine;
  };
  const switching = instance.controls.switchEngine('pencilkit');
  await nextTurn();
  assert.deepEqual(instance.calls, ['flush', 'setEngine:pencilkit']);
  instance.hide();
  native.resolve();
  await switching;
  assert.equal(instance.toolbar(), null);
  assert.equal(instance.dock(), null);
  assert.equal(instance.window.listenerCount('tenet:ink-status'), 0);
});

test('back-forward restoration reinstalls one control and one status subscription', async () => {
  const instance = harness();
  const oldButton = instance.button();
  instance.hide(true);
  assert.equal(instance.window.listenerCount('tenet:ink-status'), 0);
  assert.equal(instance.window.listenerCount('pageshow'), 1);
  instance.status.engine = 'pencilkit';
  instance.show();
  assert.equal(instance.window.listenerCount('pageshow'), 0);
  assert.equal(instance.window.listenerCount('tenet:ink-status'), 1);
  assert.notEqual(instance.button(), oldButton);
  assert.equal(instance.button().textContent, 'Ink: PencilKit');
  assert.equal(instance.document.querySelectorAll('[data-tic="engine-button"]').length, 1);
  oldButton.click();
  assert.deepEqual(instance.calls, [], 'Detached controls must not retain click listeners');
  instance.button().click();
  await nextTurn();
  assert.deepEqual(instance.calls, ['flush', 'setEngine:web']);
  assert.deepEqual(instance.storageAccess, []);
});

test('late toolbar discovery disconnects its observer and cancels the timeout', () => {
  const instance = harness({ toolbar: false });
  assert.equal(instance.toolbar().parentNode, instance.document.body);
  assert.equal(instance.toolbar().classList.contains('tic-floating-toolbar'), true);
  assert.equal(instance.observers.length, 1);
  assert.equal(instance.timers.size, 1);
  const toolbar = instance.addToolbar();
  instance.observers[0].trigger();
  assert.equal(instance.toolbar().parentNode, toolbar);
  assert.equal(instance.toolbar().classList.contains('tic-floating-toolbar'), false);
  assert.equal(instance.observers[0].connected, false);
  assert.equal(instance.timers.size, 0);
});

test('teardown also cancels pending toolbar discovery', () => {
  const instance = harness({ toolbar: false });
  instance.hide();
  assert.equal(instance.observers[0].connected, false);
  assert.equal(instance.timers.size, 0);
  assert.equal(instance.toolbar(), null);
  instance.addToolbar();
  instance.observers[0].trigger();
  assert.equal(instance.toolbar(), null);
});
