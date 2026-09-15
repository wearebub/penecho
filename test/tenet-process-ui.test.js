"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const filename = path.join(__dirname, "../src/client/app/tenet-process-ui.js");
const source = fs.readFileSync(filename, "utf8");
const processCSS = fs.readFileSync(path.join(__dirname, "../public/tenet-process.css"), "utf8");
const viewerHTML = fs.readFileSync(path.join(__dirname, "../public/tenet-history-viewer.html"), "utf8");

// Small behavioral DOM harness: real callback dispatch, range clamping and
// controllable async work/timers, with no browser package or network dependency.
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, extra = {}) { const event = {type, target:this, currentTarget:this, preventDefault() {}, ...extra}; for (const callback of this.listeners.get(type) || []) callback(event); }
}
function matches(element, selector) {
  const attributes = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];
  const plain = selector.replace(/\[[^\]]+\]/g, "");
  const tag = plain.match(/^[\w-]+/)?.[0];
  if (tag && element.tagName !== tag.toLowerCase()) return false;
  const id = plain.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;
  for (const item of plain.matchAll(/\.([\w-]+)/g)) if (!element.className.split(/\s+/).includes(item[1])) return false;
  return attributes.every(([, name, value]) => element.getAttribute(name) !== null && (value === undefined || element.getAttribute(name) === value));
}
class Element extends Events {
  constructor(tag, doc) { super(); this.tagName = tag; this.doc = doc; this.children = []; this.parentElement = null; this.attributes = {}; this.dataset = {}; this.style = {cssText:""}; this._text = ""; this._value = ""; this.hidden = false; this.disabled = false; this.open = false; this.id = ""; this.className = ""; }
  set textContent(text) { this.children = []; this._text = String(text); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
  set innerHTML(html) {
    this.replaceChildren(); const stack = [this];
    for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
      if (token.startsWith("<")) {
        const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
        const node = new Element(tag, this.doc);
        for (const match of token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g)) node.setAttribute(match[1], match[2] ?? match[3] ?? "");
        stack.at(-1).append(node);
        if (!/\/>$/.test(token) && !["input", "img", "br", "hr", "meta", "link"].includes(tag)) stack.push(node);
      } else stack.at(-1)._text += token;
    }
  }
  set value(value) {
    if (this.type === "range") this._value = String(Math.max(Number(this.min || 0), Math.min(Number(this.max ?? 100), Number(value) || 0)));
    else this._value = String(value);
  }
  get value() { return this._value; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    if (["id", "type", "name", "min", "max", "value"].includes(name)) this[name] = value;
    if (name === "hidden") this.hidden = true;
  }
  getAttribute(name) { if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? null; if (name === "class") return this.className || null; if (name === "id") return this.id || null; return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src") delete this.src; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this._text = ""; this.append(...nodes); }
  insertAdjacentElement(_position, node) { const parent = this.parentElement; node.parentElement = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+(?=(?:[^"']|"[^"]*"|'[^']*')*$)/); const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (matches(child, parts.at(-1))) {
          let parent = child.parentElement, index = parts.length - 2;
          while (parent && index >= 0) { if (matches(parent, parts[index])) index--; parent = parent.parentElement; }
          if (index < 0) found.push(child);
        }
        visit(child);
      }
    };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { if (!this.disabled) this.fire("click"); }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; this.fire("close"); } }
  get elements() { return Object.fromEntries(this.querySelectorAll("input").map(node => [node.name, node])); }
  reportValidity() { return Boolean(this.elements.title?.value.trim() && this.elements.consent?.checked); }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
async function settle() { for (let index = 0; index < 40; index++) await Promise.resolve(); }
function bundle(title = "Fixture assignment", count = 3, getAsset) {
  const events = Array.from({length:count}, (_, index) => ({sequence:index + 1, type:"page.checkpoint", clientWallTime:1700000000000 + index * 1000, details:{stage:index}, assets:[{hash:"frame" + index, mime:"image/png"}]}));
  return {attempt:{id:title, title, subject:"Math", status:"frozen", incomplete:false}, events, getAsset:getAsset || (async (_id, hash) => new Blob([hash], {type:"image/png"}))};
}
function boot(options = {}) {
  const doc = new Events(); doc.head = new Element("head", doc); doc.body = new Element("body", doc); doc.hidden = false;
  const anchor = new Element("button", doc); anchor.id = "saveCanvasBtn"; doc.body.append(anchor);
  doc.querySelector = selector => doc.head.querySelector(selector) || doc.body.querySelector(selector);
  doc.querySelectorAll = selector => [...doc.head.querySelectorAll(selector), ...doc.body.querySelectorAll(selector)];
  const calls = {list:0, begin:0, canvases:0, read:0, archive:0};
  doc.createElement = tag => {
    const node = new Element(tag, doc);
    if (tag === "canvas") {
      calls.canvases++;
      node.getContext = () => ({fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}});
      node.toBlob = callback => callback(new Blob(["synthetic checkpoint"], {type:"image/png"}));
    }
    return node;
  };
  const current = options.bundle || bundle();
  const journal = {
    listAttempts:async () => { calls.list++; return options.rows || []; },
    readAttempt:async () => { calls.read++; return current.attempt; },
    listEvents:async () => current.events,
    getAsset:current.getAsset,
    readArchive:async file => { calls.archive++; return options.readArchive ? options.readArchive(file) : current; },
  };
  const capture = {activeId:() => null, isRecording:() => false, begin:async () => { calls.begin++; return {id:"new", status:"recording"}; }};
  const win = new Events(); win.PENECHO_CONFIG = {tenetMode:true, tenetAssignmentPreview:true, tenetHistoryViewerOnly:true, ...options.config};
  win.TenetDocumentHistory = options.documentHistory;
  win.confirm = () => true; win.TenetProcessJournal = options.noJournal ? undefined : options.readOnlyJournal ? Object.freeze({readArchive:journal.readArchive}) : journal; win.TenetProcessCapture = capture;
  const timers = new Map(); let timerId = 0, urlId = 0; const urls = new Map(), revoked = [];
  const context = vm.createContext({window:win, document:doc, Blob, File, navigator:{}, URL:{createObjectURL:blob => { const url = "blob:fixture-" + (++urlId); urls.set(url, blob); return url; }, revokeObjectURL:url => { urls.delete(url); revoked.push(url); }}, setTimeout:(callback, ms) => { const id = ++timerId; timers.set(id, {callback, ms}); return id; }, clearTimeout:id => timers.delete(id)});
  new vm.Script(source, {filename}).runInContext(context);
  const dialog = doc.querySelector("dialog");
  return {
    doc, win, journal, capture, calls, timers, urls, revoked, dialog,
    launch:doc.querySelector(".tenet-process-launch"),
    action:name => dialog.querySelector(`[data-action="${name}"]`),
    value:name => dialog.querySelector(`[data-value="${name}"]`),
    slider:dialog?.querySelector('input[type="range"]'),
    async import(file = {name:"fixture.json"}) { await settle(); const picker = dialog.querySelector('[data-file="archive"]'); picker.files = [file]; picker.fire("change"); await settle(); },
    async click(name) { await settle(); this.action(name).click(); await settle(); },
    async runTimer() { const [id, entry] = timers.entries().next().value || []; assert.ok(entry, "A replay timer must be scheduled"); timers.delete(id); entry.callback(); await settle(); },
  };
}

test("non-Tenet mode installs no preview UI", () => {
  const ui = boot({config:{tenetMode:false}});
  assert.equal(ui.launch, null); assert.equal(ui.dialog, null); assert.equal(ui.calls.list, 0);
});

test("launcher styling uses CSS classes rather than strict-CSP-blocked style attributes", () => {
  assert.doesNotMatch(source, /\.style\.(?:cssText|setProperty|removeProperty|[A-Za-z_$][\w$]*\s*=)/);
  assert.doesNotMatch(source, /setAttribute\(\s*["']style["']/);
  for (const config of [{tenetAssignmentPreview:false}, {tenetAssignmentPreview:true}]) {
    const ui = boot({config});
    assert.match(ui.launch.className, /tenet-process-launch/);
    assert.equal(ui.launch.style.cssText, "");
    assert.equal(ui.launch.querySelector("svg").style.cssText, "");
    assert.equal(ui.doc.head.querySelector("#tenetProcessStyles").rel, "stylesheet");
    assert.equal(ui.doc.head.querySelector("#tenetProcessStyles").href, "./tenet-process.css");
    assert.match(processCSS, /\.tenet-process-launch\{[^}]*min-height:44px/);
  }
});

test("all process UI uses same-origin external styles and no frames under the unchanged host CSP", () => {
  assert.doesNotMatch(source, /createElement\(["']style["']\)|<style\b|<iframe\b|createElement\(["']iframe["']\)/i);
  assert.doesNotMatch(viewerHTML, /<style\b|\sstyle=|<iframe\b/i);
  assert.match(viewerHTML, /<link id="tenetProcessStyles" rel="stylesheet" href="\.\/tenet-process\.css"/);
  assert.match(viewerHTML, /<body class="tenet-history-standalone">/);
  assert.doesNotMatch(processCSS, /@import|url\(\s*["']?https?:/i);
  assert.match(viewerHTML, /Tenet fork source/); assert.match(viewerHTML, /AGPL-3\.0/);
});

test("ordinary Tenet sessions open an inline read-only viewer without navigating or reading histories", async () => {
  for (const options of [{readOnlyJournal:true, config:{tenetAssignmentPreview:undefined, tenetHistoryViewerOnly:false}}, {noJournal:true, config:{tenetHistoryViewerOnly:false}}]) {
    const ui = boot(options); await settle();
    const scratch = {unsaved:true, strokes:[1, 2, 3]}; ui.win.scratch = scratch;
    ui.win.location = Object.freeze({href:"https://district.example/whiteboard"});
    ui.win.open = () => assert.fail("Teacher preview must not open Safari or a new tab");
    assert.equal(ui.dialog.querySelector("iframe"), null);
    assert.equal(ui.dialog.open, false); assert.equal(ui.launch.tagName, "button");
    assert.equal(ui.launch.getAttribute("aria-controls"), "tenetProcessDialog");
    ui.launch.click(); await settle();
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.dialog.querySelector(".tenet-process-record-options").hidden, true);
    assert.equal(ui.dialog.querySelector(".tenet-process-list").hidden, true);
    await ui.click("sample"); assert.equal(ui.value("badge").textContent, "SYNTHETIC EXAMPLE");
    assert.equal(ui.win.location.href, "https://district.example/whiteboard");
    ui.action("close").click(); await settle();
    assert.equal(ui.dialog.open, false); assert.equal(ui.urls.size, 0);
    assert.strictEqual(ui.win.scratch, scratch); assert.deepEqual(scratch.strokes, [1, 2, 3]);
    ui.launch.click(); await settle(); assert.equal(ui.dialog.open, true);
    assert.match(ui.launch.getAttribute("aria-label"), /Teacher view/);
    assert.equal(ui.calls.list, 0); assert.equal(ui.calls.begin, 0);
  }
});

test("ordinary inline viewer retires images and replay on dismissal, sign-out and pagehide", async () => {
  const ui = boot({config:{tenetAssignmentPreview:false, tenetHistoryViewerOnly:false}});
  ui.launch.click(); await ui.click("sample"); await ui.click("play"); ui.dialog.close(); await settle(); assert.equal(ui.urls.size, 0); assert.equal(ui.timers.size, 0);
  ui.launch.click(); await settle(); ui.win.fire("tenet:sign-out"); await settle(); assert.equal(ui.dialog.open, false); assert.equal(ui.urls.size, 0);
  ui.launch.click(); await ui.click("sample"); ui.win.fire("pagehide"); await settle(); assert.equal(ui.urls.size, 0); assert.equal(ui.timers.size, 0);
  assert.equal(ui.calls.list, 0); assert.equal(ui.calls.begin, 0);
});

test("default-off pure archive API supports local imports without capture or journal enumeration", async () => {
  const ui = boot({readOnlyJournal:true, config:{tenetAssignmentPreview:undefined, tenetHistoryViewerOnly:false}});
  ui.launch.click(); await ui.import();
  assert.equal(ui.calls.archive, 1); assert.equal(ui.calls.list, 0); assert.equal(ui.calls.read, 0); assert.equal(ui.calls.begin, 0);
  assert.equal(ui.value("title").textContent, "Fixture assignment");
  assert.equal(ui.value("badge").textContent, "IMPORTED / UNVERIFIED");
  assert.equal(ui.dialog.querySelector(".tenet-process-actions").hidden, true);
  const form = ui.dialog.querySelector("form"); form.elements.title.value = "Must not record"; form.elements.consent.checked = true; form.fire("submit");
  ui.action("checkpoint").click(); ui.action("pause").click(); ui.action("freeze").click(); await settle();
  assert.equal(ui.calls.begin, 0); assert.equal(ui.calls.list, 0);
});

test("missing read-only archive API fails clearly without enabling capture or blocking the sample", async () => {
  const ui = boot({noJournal:true, config:{tenetHistoryViewerOnly:false}}); ui.launch.click(); await ui.import();
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent, /read-only archive reader is unavailable/);
  assert.equal(ui.calls.begin, 0); await ui.click("sample"); assert.equal(ui.value("badge").textContent, "SYNTHETIC EXAMPLE");
});

test("standalone preview never enumerates shared-profile history and exposes no recording form", async () => {
  const ui = boot(); await settle();
  assert.equal(ui.dialog.open, true); assert.equal(ui.calls.list, 0);
  assert.equal(ui.dialog.querySelector(".tenet-process-record-options").hidden, true);
  assert.match(ui.launch.textContent, /Teacher view/);
  assert.match(ui.dialog.querySelector(".tenet-process-disclosure").textContent, /read-only/);
});

test("synthetic example works without recording, journal enumeration or network APIs", async () => {
  const ui = boot(); await ui.click("sample");
  assert.equal(ui.value("badge").textContent, "SYNTHETIC EXAMPLE");
  assert.equal(ui.value("position").textContent, "1 / 12");
  assert.equal(ui.value("checkpoints").textContent, "4"); assert.equal(ui.value("requests").textContent, "1"); assert.equal(ui.value("gaps").textContent, "1");
  assert.equal(ui.calls.begin, 0); assert.equal(ui.calls.list, 0); assert.equal(ui.calls.canvases, 4);
  assert.equal(ui.action("freeze").hidden, true); assert.equal(ui.action("remove").hidden, true);
  assert.match(ui.value("coverage").textContent, /Fictional work and scripted AI replies/);
});

test("local capture is explicit, consent-gated and unavailable in ordinary sessions", async () => {
  const ui = boot({config:{tenetHistoryViewerOnly:false}}); ui.launch.click(); await settle();
  assert.equal(ui.calls.begin, 0);
  const form = ui.dialog.querySelector("form"); form.elements.title.value = "Synthetic test";
  form.fire("submit"); await settle(); assert.equal(ui.calls.begin, 0);
  form.elements.consent.checked = true; form.fire("submit"); await settle();
  assert.equal(ui.calls.begin, 1); assert.equal(ui.dialog.open, false);
});

test("replay starts with checkpoint zero and advances once per timer without skipping", async () => {
  const ui = boot(); await ui.import(); assert.equal(ui.value("position").textContent, "3 / 3");
  await ui.click("play"); assert.equal(ui.value("position").textContent, "1 / 3"); assert.equal(ui.timers.size, 1);
  assert.equal(await [...ui.urls.values()][0].text(), "frame0");
  await ui.runTimer(); assert.equal(ui.value("position").textContent, "2 / 3");
  await ui.runTimer(); assert.equal(ui.value("position").textContent, "3 / 3"); assert.equal(ui.timers.size, 0); assert.equal(ui.action("play").textContent, "Play history");
});

test("pause and close retire scheduled replay; closing clears loaded history from the hidden dialog", async () => {
  const ui = boot(); await ui.import(); await ui.click("play"); await ui.click("play");
  assert.equal(ui.timers.size, 0);
  await ui.click("play"); assert.equal(ui.timers.size, 1);
  await ui.click("close"); assert.equal(ui.timers.size, 0); assert.equal(ui.urls.size, 0);
  ui.launch.click(); await settle(); assert.equal(ui.dialog.open, true); assert.equal(ui.urls.size, 0); assert.equal(ui.timers.size, 0);
  assert.equal(ui.dialog.querySelector(".tenet-process-record").hidden, true); assert.equal(ui.value("title").textContent, "");
});

test("an old replay frame cannot schedule another timer after pause and restart", async () => {
  const pending = deferred(); let requested = 0;
  const ui = boot({bundle:bundle("Delayed frames", 3, async (_id, hash) => hash === "frame0" && requested++ === 0 ? pending.promise : new Blob([hash], {type:"image/png"}))});
  await ui.import(); await ui.click("play"); await ui.click("play"); await ui.click("play");
  assert.equal(ui.value("position").textContent, "2 / 3"); assert.equal(ui.timers.size, 1);
  pending.resolve(new Blob(["stale"], {type:"image/png"})); await settle();
  assert.equal(ui.timers.size, 1); assert.equal(await [...ui.urls.values()][0].text(), "frame1");
});

test("close/reopen and a newer import invalidate the older in-flight import", async () => {
  const pending = deferred();
  const ui = boot({readArchive:file => file.name === "old" ? pending.promise : bundle("New archive")});
  await ui.import({name:"old"}); await ui.click("close"); ui.launch.click(); await settle(); await ui.import({name:"new"});
  pending.resolve(bundle("Old archive")); await settle();
  assert.equal(ui.value("title").textContent, "New archive"); assert.equal(ui.dialog.open, true);
});

test("a failed import completing after close does not reopen the dialog", async () => {
  const pending = deferred(); const ui = boot({readArchive:() => pending.promise});
  await ui.import(); await ui.click("close"); pending.reject(Error("late failure")); await settle();
  assert.equal(ui.dialog.open, false); assert.equal(ui.timers.size, 0); assert.equal(ui.urls.size, 0);
});

test("a late frame from an older selection cannot replace a new archive image", async () => {
  const pending = deferred();
  const old = bundle("Old archive", 3, async (_id, hash) => hash === "frame0" ? pending.promise : new Blob([hash], {type:"image/png"}));
  const ui = boot({readArchive:file => file.name === "old" ? old : bundle("New archive")});
  await ui.import({name:"old"}); ui.slider.value = "0"; ui.slider.fire("input"); await settle(); await ui.import({name:"new"});
  pending.resolve(new Blob(["old-frame"], {type:"image/png"})); await settle();
  assert.equal(ui.value("title").textContent, "New archive"); assert.equal(await [...ui.urls.values()][0].text(), "frame2");
});

test("AI question and response are linked by request id, remain chronological and render as text", async () => {
  const fixture = bundle();
  fixture.events = [
    {sequence:1, type:"ai.request", details:{localRequestId:"one", question:'<img src=x onerror="attack()">', context:{scope:"selection"}}, assets:[]},
    {sequence:2, type:"ai.response", details:{localRequestId:"one", text:"What would undo +6?", committedToPage:false}, assets:[]},
    {sequence:3, type:"ai.request", details:{localRequestId:"two", question:"Another question", context:{scope:"text-only"}}, assets:[]},
  ];
  const ui = boot({bundle:fixture}); await ui.import();
  assert.equal(ui.value("question").textContent, "Another question"); assert.match(ui.value("response").textContent, /No reply observed yet/);
  ui.slider.value = "0"; ui.slider.fire("input"); await settle();
  assert.equal(ui.value("question").textContent, fixture.events[0].details.question); assert.equal(ui.value("question").querySelector("img"), null);
  assert.match(ui.value("response").textContent, /No reply observed yet/);
  ui.slider.value = "1"; ui.slider.fire("input"); await settle();
  assert.equal(ui.value("response").textContent, "What would undo +6?"); assert.match(ui.value("event-description").textContent, /does not prove/);
});

test("empty histories remain readable with playback disabled", async () => {
  const ui = boot({bundle:bundle("Empty history", 0)}); await ui.import();
  assert.equal(ui.value("position").textContent, "0 / 0"); assert.equal(ui.action("play").disabled, true);
  assert.match(ui.value("preview").textContent, /No rendered checkpoint/); assert.equal(ui.timers.size, 0);
});

test("missing replay attachment stops playback with readable error rather than an unhandled promise", async () => {
  const ui = boot({bundle:bundle("Missing checkpoint", 3, async (_id, hash) => hash === "frame0" ? null : new Blob([hash], {type:"image/png"}))});
  await ui.import(); await ui.click("play");
  assert.equal(ui.timers.size, 0); assert.equal(ui.action("play").textContent, "Play history");
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent, /checkpoint attachment is unavailable/);
});

test("backgrounding stops replay, and sign-out clears retained display and object URLs", async () => {
  const ui = boot(); await ui.click("sample"); await ui.click("play");
  ui.doc.hidden = true; ui.doc.fire("visibilitychange"); await settle(); assert.equal(ui.timers.size, 0);
  ui.doc.hidden = false; ui.win.fire("tenet:sign-out"); await settle();
  assert.equal(ui.dialog.open, false); assert.equal(ui.urls.size, 0); assert.equal(ui.value("question").textContent, ""); assert.equal(ui.value("detail").textContent, "");
  ui.launch.click(); await settle(); assert.equal(ui.dialog.querySelector(".tenet-process-record").hidden, true);
});

test("pagehide retires a pending archive even if it resolves later", async () => {
  const pending = deferred(); const ui = boot({readArchive:() => pending.promise});
  await ui.import(); ui.win.fire("pagehide"); pending.resolve(bundle("Too late")); await settle();
  assert.notEqual(ui.value("title").textContent, "Too late"); assert.equal(ui.urls.size, 0); assert.equal(ui.timers.size, 0);
});

function savedBundle(id, title, historyAvailable = true) {
  const value = bundle(title, historyAvailable ? 3 : 0);
  return {...value, historyAvailable, attempt:{...value.attempt, id, title, status:"saved"}};
}
function savedProvider(entries, currentId = null) {
  const calls = {list:0, current:0, reads:[]};
  return {calls, provider:{
    listSavedPages:async () => { calls.list++; return entries.map(entry => ({id:entry.attempt.id, name:entry.attempt.title, createdAt:1700000000000, eventCount:entry.events.length, hasHistory:entry.historyAvailable})); },
    currentSavedPageId:() => { calls.current++; return currentId; },
    readSavedPage:async id => { calls.reads.push(id); const found = entries.find(entry => entry.attempt.id === id); if (!found) throw Error("Saved whiteboard not found"); return found; },
  }};
}
function savedBoot(provider) { return boot({documentHistory:provider, readOnlyJournal:true, config:{tenetAssignmentPreview:undefined, tenetHistoryViewerOnly:false}}); }

test("Teacher view defaults to saved whiteboards and the current saved page, not a synthetic sample", async () => {
  const history = savedProvider([savedBundle("math", "My algebra homework"), savedBundle("science", "My lab work")], "math");
  const ui = savedBoot(history.provider); ui.launch.click(); await settle();
  const buttons = ui.dialog.querySelectorAll(".tenet-process-saved-pages button");
  assert.equal(buttons.length, 2); assert.match(buttons[0].textContent, /My algebra homework/); assert.match(buttons[0].textContent, /Current page/);
  assert.deepEqual(history.calls.reads, ["math"]); assert.equal(ui.value("title").textContent, "My algebra homework");
  assert.equal(ui.value("badge").textContent, "SAVED WHITEBOARD / ON DEVICE"); assert.equal(ui.calls.canvases, 0);
  assert.equal(ui.dialog.querySelector(".tenet-process-examples").open, false);
  assert.equal(ui.calls.list, 0); assert.equal(ui.calls.read, 0); assert.equal(ui.calls.archive, 0); assert.equal(ui.calls.begin, 0);
  assert.equal(ui.dialog.querySelector(".tenet-process-record-options").hidden, true);
});

test("saved page selection renders its actual AI question/reply and checkpoint without loading the canvas", async () => {
  const work = savedBundle("fraction-work", "Fractions worksheet");
  work.events.push(
    {sequence:4, type:"ai.request", details:{localRequestId:"real-question", question:"Why do I need a common denominator?", context:{scope:"selection"}}, assets:[]},
    {sequence:5, type:"ai.response", details:{localRequestId:"real-question", text:"What size pieces are you combining?", committedToPage:false}, assets:[]}
  );
  const history = savedProvider([work]); const ui = savedBoot(history.provider);
  const scratch = {strokes:["current unsaved ink"]}; ui.win.scratch = scratch;
  ui.win.location = Object.freeze({href:"https://district.example/whiteboard"}); ui.win.open = () => assert.fail("No new tab");
  const result = await ui.win.TenetProcessUI.openSavedPage("fraction-work"); await settle();
  assert.equal(result, true); assert.equal(ui.dialog.open, true);
  assert.equal(ui.value("question").textContent, "Why do I need a common denominator?");
  assert.equal(ui.value("response").textContent, "What size pieces are you combining?");
  assert.equal(await [...ui.urls.values()][0].text(), "frame2");
  assert.strictEqual(ui.win.scratch, scratch); assert.deepEqual(scratch.strokes, ["current unsaved ink"]);
  assert.equal(ui.win.location.href, "https://district.example/whiteboard"); assert.equal(ui.calls.canvases, 0); assert.equal(ui.calls.begin, 0);
  ui.action("close").click(); await settle(); assert.equal(ui.value("question").textContent, ""); assert.equal(ui.urls.size, 0);
  assert.strictEqual(ui.win.scratch, scratch);
});

test("clicking a saved whiteboard changes only the history selection", async () => {
  const history = savedProvider([savedBundle("first", "First whiteboard"), savedBundle("second", "Second whiteboard")], "first");
  const ui = savedBoot(history.provider); ui.launch.click(); await settle();
  ui.dialog.querySelectorAll(".tenet-process-saved-pages button")[1].click(); await settle();
  assert.equal(ui.value("title").textContent, "Second whiteboard"); assert.deepEqual(history.calls.reads, ["first", "second"]);
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-saved-pages button")[1].getAttribute("aria-current"), "true");
  assert.equal(ui.calls.archive, 0); assert.equal(ui.calls.begin, 0);
});

test("legacy saved whiteboards explicitly report unavailable history without invented events or examples", async () => {
  const history = savedProvider([savedBundle("old", "Last year's work", false)], "old");
  const ui = savedBoot(history.provider); ui.launch.click(); await settle();
  assert.equal(ui.value("title").textContent, "Last year's work"); assert.equal(ui.value("position").textContent, "0 / 0");
  assert.match(ui.value("preview").textContent, /History unavailable/); assert.match(ui.value("coverage").textContent, /do not substitute a sample/);
  assert.equal(ui.value("question").textContent, ""); assert.equal(ui.action("play").disabled, true); assert.equal(ui.calls.canvases, 0);
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent, /cannot be reconstructed/);
});

test("saved history coverage reasons and dropped events remain visible", async () => {
  const work = savedBundle("gaps", "Work with gaps"); work.attempt.incomplete = true; work.attempt.incompleteReasons = ["Storage was unavailable during one interval."]; work.attempt.droppedEvents = 4;
  const history = savedProvider([work]); const ui = savedBoot(history.provider); await ui.win.TenetProcessUI.openSavedPage("gaps"); await settle();
  assert.match(ui.value("coverage").textContent, /Storage was unavailable/); assert.match(ui.value("coverage").textContent, /Events omitted by retention limits: 4/);
  assert.match(ui.value("coverage").textContent, /not full stroke playback/);
});

test("saved-page WebP thumbnails render and are explicitly distinguished from full checkpoints", async () => {
  const work = savedBundle("webp", "Saved fallback thumbnail");
  work.events = [{sequence:1, type:"canvas.checkpoint", clientWallTime:1700000000000, details:{representation:"saved-page-thumbnail", everyStroke:false}, assets:[{hash:"saved-thumb", name:"page.webp", mime:"image/webp"}]}];
  work.getAsset = async () => new Blob(["saved webp thumbnail"], {type:"image/webp"});
  const history = savedProvider([work]); const ui = savedBoot(history.provider);
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("webp"), true); await settle();
  assert.equal(ui.value("checkpoints").textContent, "1"); assert.equal(ui.value("event-title").textContent, "Saved-page thumbnail");
  assert.equal(await [...ui.urls.values()][0].text(), "saved webp thumbnail");
  assert.match(ui.value("checkpoint-caption").textContent, /saved-page thumbnail, not a full-resolution checkpoint/);
  assert.equal(ui.calls.canvases, 0);
});

test("event details normalize saved ISO timestamps and legacy numeric times without reordering playback", async () => {
  const work = savedBundle("times", "Timestamp compatibility");
  const iso = "2026-09-15T18:30:45.123Z", legacy = 1700000000000;
  work.events = [
    {sequence:1, type:"canvas.commit", timestamp:iso, details:{note:"ISO saved event"}, assets:[]},
    {sequence:2, type:"canvas.commit", clientWallTime:legacy, details:{note:"Older clock value, later event order"}, assets:[]},
    {sequence:3, type:"canvas.commit", timestamp:"not a time", details:{note:"Bad timestamp"}, assets:[]},
    {sequence:4, type:"canvas.commit", clientWallTime:1e30, details:{note:"Out of Date range"}, assets:[]},
    {sequence:5, type:"canvas.commit", clientWallTime:null, details:{note:"No timestamp"}, assets:[]},
    {sequence:6, type:"canvas.commit", clientWallTime:0, details:{note:"Numeric epoch is valid"}, assets:[]},
    {sequence:7, type:"canvas.commit", timestamp:"bad", clientWallTime:legacy, details:{note:"Legacy fallback"}, assets:[]},
  ];
  const history = savedProvider([work]); const ui = savedBoot(history.provider);
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("times"), true); await settle();
  const expected = [new Date(iso).toLocaleString(), new Date(legacy).toLocaleString(), "Time unavailable", "Time unavailable", "Time unavailable", new Date(0).toLocaleString(), new Date(legacy).toLocaleString()];
  for (let index = 0; index < expected.length; index++) {
    ui.slider.value = String(index); ui.slider.fire("input"); await settle();
    const detail = JSON.parse(ui.value("detail").textContent);
    assert.equal(detail.recordedAt, expected[index]); assert.equal(detail.sequence, index + 1);
    assert.deepEqual(detail.details, work.events[index].details);
    assert.doesNotMatch(ui.value("detail").textContent, /Invalid Date/);
  }
  await ui.click("play"); assert.equal(JSON.parse(ui.value("detail").textContent).sequence, 1);
  await ui.runTimer(); assert.equal(JSON.parse(ui.value("detail").textContent).sequence, 2);
  assert.equal(ui.calls.begin, 0); assert.equal(ui.calls.archive, 0);
});

test("a newer notebook-card request wins over a delayed saved-page read", async () => {
  const pending = deferred(), first = savedBundle("a", "Older selection"), second = savedBundle("b", "New selection");
  const history = savedProvider([first, second]); const original = history.provider.readSavedPage;
  history.provider.readSavedPage = id => id === "a" ? pending.promise : original(id);
  const ui = savedBoot(history.provider); const old = ui.win.TenetProcessUI.openSavedPage("a"); await settle();
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("b"), true);
  pending.resolve(first); assert.equal(await old, false); await settle();
  assert.equal(ui.value("title").textContent, "New selection"); assert.equal(ui.value("badge").textContent, "SAVED WHITEBOARD / ON DEVICE");
});

test("a delayed initial listing cannot replace an explicit notebook-card selection", async () => {
  const pending = deferred(), first = savedBundle("a", "Current scratch page"), second = savedBundle("b", "Chosen notebook card");
  const history = savedProvider([first, second], "a"); const list = history.provider.listSavedPages; let lists = 0;
  history.provider.listSavedPages = () => ++lists === 1 ? pending.promise : list();
  const ui = savedBoot(history.provider); ui.launch.click(); await settle();
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("b"), true);
  pending.resolve(await list()); await settle();
  assert.equal(ui.value("title").textContent, "Chosen notebook card"); assert.deepEqual(history.calls.reads, ["b"]);
});

test("closing or signing out prevents a late saved-page read from repopulating hidden history", async () => {
  for (const action of ["close", "signout"]) {
    const pending = deferred(); const history = savedProvider([savedBundle("late", "Late saved work")]); history.provider.readSavedPage = () => pending.promise;
    const ui = savedBoot(history.provider); const opening = ui.win.TenetProcessUI.openSavedPage("late"); await settle();
    if (action === "close") ui.action("close").click(); else ui.win.fire("tenet:sign-out");
    pending.resolve(savedBundle("late", "Late saved work")); assert.equal(await opening, false); await settle();
    assert.equal(ui.dialog.open, false); assert.equal(ui.value("title").textContent, ""); assert.equal(ui.value("question").textContent, ""); assert.equal(ui.urls.size, 0);
  }
});

test("saved-page load errors are visible and never fall back to fictional sample content", async () => {
  const history = savedProvider([]); const ui = savedBoot(history.provider);
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("missing"), false); await settle();
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent, /Saved whiteboard not found/);
  assert.equal(ui.dialog.querySelector(".tenet-process-record").hidden, true); assert.equal(ui.calls.canvases, 0); assert.equal(ui.calls.begin, 0);
});

test("public standalone viewer cannot enumerate saved app whiteboards even when a provider exists", async () => {
  const history = savedProvider([savedBundle("private", "Private saved page")], "private");
  const ui = boot({documentHistory:history.provider}); await settle(); await ui.click("sample");
  assert.equal(history.calls.list, 0); assert.deepEqual(history.calls.reads, []);
  assert.equal(ui.dialog.querySelector(".tenet-process-saved").hidden, true);
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("private"), false);
  assert.equal(history.calls.list, 0); assert.deepEqual(history.calls.reads, []);
});
