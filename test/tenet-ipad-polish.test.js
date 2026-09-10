'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const NOTEBOOK_PATH = path.join(ROOT, 'src/client/app/tenet-notebook.js');
const notebookSource = fs.readFileSync(NOTEBOOK_PATH, 'utf8').replace(/\r\n/g, '\n');
const notebookCss = fs.readFileSync(path.join(ROOT, 'public/tenet-notebook.css'), 'utf8');
const usabilityCss = fs.readFileSync(path.join(ROOT, 'public/tenet-ipad-usability.css'), 'utf8');
const voiceCss = fs.readFileSync(path.join(ROOT, 'public/tenet-voice.css'), 'utf8');
const PREFERENCE_KEY = 'tenet-notebook-launcher-v1';
const NOTEBOOK_KEY = 'tenet-notebook-v1';

// Exercise production preferences and header routing without installing the
// unrelated canvas/snapshot UI. Unresolved snapshot reads never render fixtures.
const instrumented = notebookSource.replace(
  /\n  if \(document\.readyState === "loading"\) \{[\s\S]*?\n\}\)\(\);\s*$/,
  [
    '',
    '  globalThis.notebookTest = {',
    '    readLauncherCollapsed, setLauncherCollapsed, handleLauncherPreferenceStorage,',
    '    startRuntime, handlePageHide, handlePageShow, openNotebook, closeNotebook,',
    '    getLauncherCollapsed: () => launcherCollapsed,',
    '    attachUI(elements) {',
    '      launcherDock = elements.dock; launcherToggle = elements.toggle;',
    '      launcher = elements.launcher; overlay = elements.overlay;',
    '      closeButton = elements.closeButton; imageMenu = elements.imageMenu;',
    '      imageButton = elements.imageButton; blankPaperButton = elements.blankPaperButton;',
    '      gridPaperButton = elements.gridPaperButton;',
    '    }',
    '  };',
    '})();'
  ].join('\n')
);
assert.notEqual(instrumented, notebookSource, 'The notebook test seam must match startup');
const script = new vm.Script(instrumented, { filename: NOTEBOOK_PATH });

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

function harness({ preference, seed, failReads = false, failWrites = false } = {}) {
  const storage = new Map(seed || [
    [NOTEBOOK_KEY, '{"version":1,"activeSubject":"math","pages":{"saved-page":{"subjectId":"math"}}}']
  ]);
  if (preference !== undefined) storage.set(PREFERENCE_KEY, preference);
  const writes = [];
  const intervals = new Map();
  const frames = new Map();
  const document = new Document();
  const window = new ListenerTarget();
  let nextId = 0;
  Object.assign(window, {
    PENECHO_CONFIG: { tenetMode: true },
    localStorage: {
      getItem(key) {
        if (failReads) throw new Error('Storage access denied');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        writes.push([key, String(value)]);
        if (failWrites) throw new Error('Storage quota exceeded');
        storage.set(key, String(value));
      }
    },
    setInterval(callback) { const id = ++nextId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const header = document.createElement('button');
  header.id = 'historyBtn';
  header.className = 'icon-button tenet-header-action';
  header.setAttribute('aria-controls', 'historyPanel');
  header.setAttribute('aria-label', 'Open pages and files');
  document.body.appendChild(header);
  const elements = {};
  for (const name of ['dock', 'toggle', 'launcher', 'overlay', 'closeButton', 'imageMenu', 'imageButton', 'blankPaperButton', 'gridPaperButton']) {
    elements[name] = document.createElement(name === 'dock' || name === 'overlay' || name === 'imageMenu' ? 'div' : 'button');
  }
  elements.toggle.appendChild(document.createElement('span'));
  elements.overlay.hidden = true;
  elements.imageMenu.hidden = true;
  document.body.appendChild(elements.launcher);
  let snapshotReads = 0;
  const context = vm.createContext({
    window, document, HTMLElement: Element, state: { userRevision: 0 },
    allSnapshots() { snapshotReads += 1; return new Promise(() => {}); }
  });
  script.runInContext(context);
  const controls = context.notebookTest;
  controls.attachUI(elements);
  controls.setLauncherCollapsed(controls.getLauncherCollapsed());
  return {
    controls, storage, writes, window, document, header, intervals, frames, ...elements,
    snapshotReads: () => snapshotReads
  };
}

// Source-level CSS contracts complement the parent's browser/device checks.
function rule(css, selector) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(',').map(value => value.trim()).includes(selector)) continue;
    return Object.fromEntries(match[2].split(';').flatMap(declaration => {
      const separator = declaration.indexOf(':');
      if (separator < 0) return [];
      return [[declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()]];
    }));
  }
  assert.fail('Missing CSS selector: ' + selector);
}

test('launcher defaults compact and accepts only an explicit expanded preference', () => {
  for (const [preference, collapsed] of [
    [undefined, true], ['collapsed', true], ['expanded', false],
    ['', true], ['true', true], ['{"collapsed":false}', true], ['unexpected', true]
  ]) {
    const instance = harness({ preference });
    assert.equal(instance.controls.getLauncherCollapsed(), collapsed);
    assert.equal(instance.dock.dataset.collapsed, String(collapsed));
    assert.equal(instance.document.body.dataset.tenetNotebookLauncherCollapsed, String(collapsed));
    assert.equal(instance.toggle.getAttribute('aria-expanded'), String(!collapsed));
    assert.equal(instance.toggle.firstElementChild.textContent, collapsed ? '>' : '<');
    assert.match(instance.toggle.getAttribute('aria-label'), collapsed ? /^Expand Pages & files/ : /^Collapse Pages & files/);
    assert.deepEqual(instance.writes, []);
  }
});

test('collapse preference persists independently and leaves notebook metadata unchanged', () => {
  const instance = harness();
  const originalNotebook = instance.storage.get(NOTEBOOK_KEY);
  instance.controls.setLauncherCollapsed(false, true);
  assert.deepEqual(instance.writes, [[PREFERENCE_KEY, 'expanded']]);
  assert.equal(instance.storage.get(NOTEBOOK_KEY), originalNotebook);
  const restored = harness({ seed: instance.storage });
  assert.equal(restored.controls.getLauncherCollapsed(), false);
  restored.controls.setLauncherCollapsed(true, true);
  assert.deepEqual(restored.writes, [[PREFERENCE_KEY, 'collapsed']]);
  assert.equal(restored.storage.get(NOTEBOOK_KEY), originalNotebook);
  assert.equal(harness({ seed: restored.storage }).controls.getLauncherCollapsed(), true);
});

test('blocked storage does not prevent changing the current launcher preference', () => {
  const unreadable = harness({ failReads: true });
  assert.equal(unreadable.controls.getLauncherCollapsed(), true);
  assert.equal(unreadable.controls.readLauncherCollapsed(false), false);
  const unwritable = harness({ failWrites: true });
  const originalStorage = [...unwritable.storage];
  assert.doesNotThrow(() => unwritable.controls.setLauncherCollapsed(false, true));
  assert.equal(unwritable.dock.dataset.collapsed, 'false');
  assert.equal(unwritable.toggle.getAttribute('aria-expanded'), 'true');
  assert.doesNotThrow(() => unwritable.controls.setLauncherCollapsed(true, true));
  assert.equal(unwritable.dock.dataset.collapsed, 'true');
  assert.deepEqual([...unwritable.storage], originalStorage);
});

test('storage events synchronize the launcher without writeback or unrelated-key reactions', () => {
  const instance = harness();
  instance.storage.set(PREFERENCE_KEY, 'expanded');
  instance.controls.handleLauncherPreferenceStorage({ key: 'unrelated-setting' });
  assert.equal(instance.controls.getLauncherCollapsed(), true);
  instance.controls.handleLauncherPreferenceStorage({ key: PREFERENCE_KEY });
  assert.equal(instance.controls.getLauncherCollapsed(), false);
  instance.storage.delete(PREFERENCE_KEY);
  instance.controls.handleLauncherPreferenceStorage({ key: null });
  assert.equal(instance.controls.getLauncherCollapsed(), true);
  assert.deepEqual(instance.writes, []);
});

test('launcher retains its click target and has a separate accessible collapse control', () => {
  assert.match(notebookSource, /launcher\.id = "tenetNotebookLauncher"/);
  assert.match(notebookSource, /launcher\.addEventListener\("click", openNotebook\)/);
  assert.match(notebookSource, /launcher\.setAttribute\("aria-controls", "tenetNotebookOverlay"\)/);
  assert.match(notebookSource, /launcher\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(notebookSource, /launcherToggle\.type = "button"/);
  assert.match(notebookSource, /launcherToggle\.setAttribute\("aria-controls", "tenetNotebookLauncher"\)/);
  assert.match(notebookSource, /launcherToggle\.addEventListener\("click", \(\) => setLauncherCollapsed\(!launcherCollapsed, true\)\)/);
  const compact = rule(notebookCss, '.tenet-notebook-launcher-dock[data-collapsed="true"] .tenet-notebook-launcher');
  const toggle = rule(notebookCss, '.tenet-notebook-launcher-toggle');
  assert.ok(parseFloat(compact.width) >= 44);
  assert.ok(parseFloat(compact['min-height']) >= 44);
  assert.ok(parseFloat(toggle.width) >= 44);
  assert.ok(parseFloat(toggle['min-height']) >= 44);
  assert.equal(rule(notebookCss, '.tenet-notebook-launcher-dock[data-collapsed="true"] .tenet-notebook-launcher-label').display, 'none');
  assert.equal(rule(notebookCss, '.tenet-notebook-launcher-dock[data-collapsed="true"] .tenet-notebook-count').display, 'none');
});

test('header Pages captures clicks before the legacy handler and opens the same notebook', () => {
  const instance = harness();
  let legacyOpens = 0;
  instance.header.addEventListener('click', () => { legacyOpens += 1; });
  instance.header.focus();
  instance.controls.startRuntime();
  assert.equal(instance.header.getAttribute('aria-controls'), 'tenetNotebookOverlay');
  assert.equal(instance.header.getAttribute('aria-haspopup'), 'dialog');
  const event = instance.header.click();
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.immediateStopped, true);
  assert.equal(legacyOpens, 0);
  assert.equal(instance.overlay.hidden, false);
  assert.equal(instance.header.getAttribute('aria-expanded'), 'true');
  assert.equal(instance.launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(instance.snapshotReads(), 1);
  instance.controls.closeNotebook();
  assert.equal(instance.header.getAttribute('aria-expanded'), 'false');
  assert.equal(instance.document.activeElement, instance.header);
  assert.equal(instance.frames.size, 0);
  instance.controls.handlePageHide({ persisted: false });
});

test('header teardown restores original attributes/listeners and back-forward activation binds once', () => {
  const instance = harness();
  const originalAttributes = [...instance.header.attributes];
  let legacyOpens = 0;
  instance.header.addEventListener('click', () => { legacyOpens += 1; });
  instance.controls.startRuntime();
  instance.controls.startRuntime();
  assert.equal(instance.header.listenerCount('click'), 2);
  assert.equal(instance.intervals.size, 1);
  instance.controls.handlePageHide({ persisted: true });
  assert.deepEqual([...instance.header.attributes], originalAttributes);
  assert.equal(instance.header.listenerCount('click'), 1);
  assert.equal(instance.window.listenerCount('storage'), 0);
  assert.equal(instance.intervals.size, 0);
  instance.header.click();
  assert.equal(legacyOpens, 1);
  instance.controls.handlePageShow({ persisted: true });
  assert.equal(instance.header.listenerCount('click'), 2);
  assert.equal(instance.header.getAttribute('aria-controls'), 'tenetNotebookOverlay');
  assert.equal(instance.window.listenerCount('storage'), 1);
  instance.header.click();
  assert.equal(legacyOpens, 1);
  instance.controls.handlePageHide({ persisted: false });
  assert.deepEqual([...instance.header.attributes], originalAttributes);
});

test('the notebook leaves upstream Pages untouched outside Tenet mode', () => {
  const document = new Document();
  const header = document.createElement('button');
  header.id = 'historyBtn';
  header.setAttribute('aria-controls', 'historyPanel');
  document.body.appendChild(header);
  const window = new ListenerTarget();
  window.PENECHO_CONFIG = { tenetMode: false };
  const context = vm.createContext({ window, document });
  script.runInContext(context);
  assert.equal(context.notebookTest, undefined);
  assert.equal(header.getAttribute('aria-controls'), 'historyPanel');
  assert.equal(header.listenerCount('click'), 0);
});

test('whiteboard chrome is opaque with app/page/header specificity over studio styling', () => {
  for (const selector of [
    'html body.tenet-whiteboard .topbar',
    'html body.tenet-whiteboard .toolbar',
    'html body.tenet-whiteboard[data-theme="studio"] #app .topbar',
    'html body.tenet-whiteboard[data-theme="studio"] #app .toolbar',
    'html body.tenet-whiteboard[data-theme="studio"] #app.page > header.topbar',
    'html body.tenet-whiteboard[data-theme="studio"] #app.page .toolbar'
  ]) {
    const chrome = rule(usabilityCss, selector);
    assert.match(chrome.background, /^#[0-9a-f]{6}\s*!important$/i, selector);
    assert.match(chrome.opacity, /^1\s*!important$/, selector);
    assert.match(chrome['backdrop-filter'], /^none\s*!important$/, selector);
    assert.match(chrome['-webkit-backdrop-filter'], /^none\s*!important$/, selector);
  }
});

test('opaque chrome retains safe-area padding and resize handles below object chrome', () => {
  const header = rule(usabilityCss, 'html.tenet-native-ios body.tenet-whiteboard .topbar');
  assert.match(header['padding-top'], /env\(safe-area-inset-top\)/);
  assert.equal(header['box-sizing'], 'content-box');
  const resize = rule(usabilityCss, '.tenet-resize-layer');
  assert.equal(resize['z-index'], '3', 'Object chrome owns z-index 4');
  assert.equal(resize['pointer-events'], 'none');
});

test('native notifications reserve launcher space and stay above its stacking layer', () => {
  const preference = rule(notebookCss, 'body[data-tenet-notebook-launcher-collapsed]');
  const dock = rule(notebookCss, '.tenet-notebook-launcher-dock');
  const notice = rule(usabilityCss, 'body.tenet-whiteboard #tenetNativeToast');
  assert.match(preference['--tenet-notebook-notice-bottom'], /safe-area-inset-bottom/);
  assert.match(notice.bottom, /var\(--tenet-notebook-notice-bottom/);
  assert.ok(Number(notice['z-index']) > Number(dock['z-index']));
  assert.match(notice.background, /^#[0-9a-f]{6}$/i);
  assert.equal(notice['white-space'], 'normal');
  assert.equal(notice['overflow-wrap'], 'anywhere');
  assert.equal(rule(usabilityCss, 'body.tenet-whiteboard #tenetNativeToast[hidden]').display, 'none !important');
});

test('Talk uses a compact bounded popover with a transparent backdrop and accessible actions', () => {
  const dialog = rule(voiceCss, '.tenet-voice-dialog');
  assert.equal(dialog.position, 'fixed');
  assert.equal(dialog.margin, '0');
  assert.match(dialog.width, /min\(360px,/);
  assert.match(dialog['max-height'], /--tenet-voice-popover-available-height/);
  assert.match(dialog.top, /--tenet-voice-popover-top/);
  assert.match(dialog.right, /--tenet-voice-popover-right/);
  assert.equal(rule(voiceCss, '.tenet-voice-dialog::backdrop').background, 'transparent !important');
  assert.equal(rule(voiceCss, '.tenet-voice-dialog [hidden]').display, 'none !important');
  assert.ok(parseFloat(rule(voiceCss, '.tenet-voice-dialog button')['min-height']) >= 44);
  assert.equal(rule(voiceCss, '.tenet-voice-dialog footer').position, 'sticky');
});
