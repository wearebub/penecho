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
  set src(value) { this._src = String(value); this.attributes.src = this._src; if (this.tagName === "img") this.doc.loadImage?.(this, this._src); }
  get src() { return this._src || ""; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
    if (["id", "type", "name", "min", "max", "value"].includes(name)) this[name] = value;
    if (name === "hidden") this.hidden = true;
    if (name === "checked") this.checked = true;
  }
  getAttribute(name) { if (name.startsWith("data-")) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? null; if (name === "class") return this.className || null; if (name === "id") return this.id || null; return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src") this._src = ""; }
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
  focus() { this.doc.activeElement = this; }
  contains(node) { while (node) { if (node === this) return true; node = node.parentElement; } return false; }
  scrollIntoView() { this.doc.lastScrolled = this; }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; this.fire("close"); } }
  get elements() { return Object.fromEntries(this.querySelectorAll("input").map(node => [node.name, node])); }
  reportValidity() { return Boolean(this.elements.title?.value.trim() && this.elements.consent?.checked); }
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; }
async function settle() { for (let index = 0; index < 40; index++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); for (let index = 0; index < 40; index++) await Promise.resolve(); }
const rasterMetadata = new WeakMap();
// Header fixtures qualify bounds/ownership, not a browser's image codec. The
// browser decode boundary is separately controllable in this DOM harness.
function rasterBlob(label, mime = "image/png", width = 900, height = 600) {
  let header;
  if (mime === "image/png") {
    header = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8); header.write("IHDR", 12); header.writeUInt32BE(width, 16); header.writeUInt32BE(height, 20);
  } else if (mime === "image/jpeg") {
    header = Buffer.from([255,216,255,192,0,8,8,0,0,0,0,0]); header.writeUInt16BE(height, 7); header.writeUInt16BE(width, 9);
  } else {
    header = Buffer.alloc(30); header.write("RIFF", 0); header.writeUInt32LE(22, 4); header.write("WEBP", 8); header.write("VP8X", 12); header.writeUInt32LE(10, 16);
    header.writeUIntLE(width - 1, 24, 3); header.writeUIntLE(height - 1, 27, 3);
  }
  const blob = new Blob([header, label], {type:mime}); rasterMetadata.set(blob, {label, width, height}); return blob;
}
function displayedLabel(ui) { const image = ui.dialog.querySelector(".tenet-process-preview img"); return rasterMetadata.get(ui.urls.get(image.src))?.label; }
function recorded(type, sequence, details = {}, assets = [], time = 1700000000000 + sequence * 5000) { return {type, sequence, details, assets, clientWallTime:time}; }
function fixtureWith(events, getAsset = async () => null) { return {...bundle("Interaction fixture", 0), events, getAsset}; }
function rawInputFixture() {
  const body = {action:"hint", question:"How do I start?", atlasImage:"data:image/png;base64,AAAA", context:{scope:"selection"}};
  const json = new Blob([JSON.stringify(body)], {type:"application/json"}), image = rasterBlob("exact submitted crop");
  const events = [
    recorded("ai.request", 1, {localRequestId:"request-a", question:"How do I start?", origin:"voice-question", originEvidence:"local-submit-path", questionSource:"selection-question", inputVersion:1, action:"hint", context:{scope:"selection"}}),
    recorded("ai.response", 2, {localRequestId:"request-a", text:"Which operation would undo +6?", committedToPage:false}),
    recorded("ai.finished", 3, {localRequestId:"request-a", outcome:"completed"}),
    recorded("ai.input", 4, {localRequestId:"request-a", inputVersion:1, boundary:"client-to-whiteboard", method:"POST", endpoint:"/api/ai/command", observation:"prepared-client-request-not-server-receipt", origin:"voice-question", requestObservedAt:new Date(1700000005000).toISOString(), bodyStatus:"recorded", bodyFormat:"raw-client-json", bodyExact:true, imageStatus:"recorded", bodyAssetName:"ai-input.json", imageAssetName:"ai-input.png", omitted:[], gatewayProviderPromptObserved:false}, [{name:"ai-input.json", hash:"body", mime:"application/json"}, {name:"ai-input.png", hash:"crop", mime:"image/png"}]),
  ];
  const reads = [], assets = new Map([["body", json], ["crop", image]]);
  return {body, json, image, assets, reads, fixture:fixtureWith(events, async (_id, hash) => { reads.push(hash); return assets.get(hash); })};
}
async function inspectInput(ui, text) { const button = ui.dialog.querySelectorAll(".tenet-process-input-record button").find(item => item.textContent === text); assert.ok(button, text); button.click(); await settle(); }
async function seek(ui, index) { ui.slider.value = String(index); ui.slider.fire("input"); await settle(); }
function bundle(title = "Fixture assignment", count = 3, getAsset) {
  const events = Array.from({length:count}, (_, index) => ({sequence:index + 1, type:"page.checkpoint", clientWallTime:1700000000000 + index * 5000, details:{stage:index}, assets:[{hash:"frame" + index, mime:"image/png"}]}));
  return {attempt:{id:title, title, subject:"Math", status:"frozen", incomplete:false}, events, getAsset:getAsset || (async (_id, hash) => rasterBlob(hash))};
}
function boot(options = {}) {
  const doc = new Events(); doc.head = new Element("head", doc); doc.body = new Element("body", doc); doc.hidden = false;
  const anchor = new Element("button", doc); anchor.id = "saveCanvasBtn"; doc.body.append(anchor);
  doc.querySelector = selector => doc.head.querySelector(selector) || doc.body.querySelector(selector);
  doc.querySelectorAll = selector => [...doc.head.querySelectorAll(selector), ...doc.body.querySelectorAll(selector)];
  const calls = {list:0, begin:0, canvases:0, read:0, archive:0, decoded:[]};
  doc.createElement = tag => {
    const node = new Element(tag, doc);
    if (tag === "canvas") {
      calls.canvases++;
      node.getContext = () => ({fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}});
      node.toBlob = callback => callback(rasterBlob("synthetic checkpoint", "image/png", node.width, node.height));
    }
    return node;
  };
  doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
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
  doc.loadImage = (image, url) => {
    if (typeof image.onload !== "function") return;
    const blob = urls.get(url), metadata = rasterMetadata.get(blob) || {width:1, height:1};
    image.naturalWidth = options.naturalWidth || metadata.width; image.naturalHeight = options.naturalHeight || metadata.height;
    image.decode = () => { calls.decoded.push(url); return options.decode ? options.decode(url, blob, image) : Promise.resolve(); };
    void Promise.resolve().then(() => { if (image.src === url) image.onload?.(); });
  };
  const intl = options.timeZone ? {DateTimeFormat:function(locale, format) { return new Intl.DateTimeFormat(locale, {...format, timeZone:options.timeZone}); }} : Intl;
  const context = vm.createContext({window:win, document:doc, Blob, File, TextEncoder, Intl:intl, navigator:{}, URL:{createObjectURL:blob => { const url = "blob:fixture-" + (++urlId); urls.set(url, blob); return url; }, revokeObjectURL:url => { urls.delete(url); revoked.push(url); }}, setTimeout:(callback, ms) => { const id = ++timerId; timers.set(id, {callback, ms}); return id; }, clearTimeout:id => timers.delete(id)});
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
    async runTimer(ms) { const [id, entry] = [...timers.entries()].find(([, item]) => ms === undefined || item.ms === ms) || []; assert.ok(entry, "An expected timer must be scheduled"); timers.delete(id); entry.callback(); await settle(); },
  };
}

test("relative and clock labels expose a five-minute recorded span without using the save date", async () => {
  const start = Date.parse("2026-09-15T15:00:00Z");
  const fixture = fixtureWith([recorded("history.observation",1,{},[],start), recorded("history.observation",2,{},[],start+252000), recorded("history.observation",3,{},[],start+312000)]);
  fixture.attempt.startedAt = "2026-09-01T00:00:00Z"; fixture.savedAt = "2026-10-01T00:00:00Z";
  const ui = boot({bundle:fixture, timeZone:"UTC"}); await ui.import();
  assert.equal(ui.value("recorded-span").textContent, "5m 12s");
  assert.match(ui.value("recorded-start").textContent, /3:00:00 PM UTC/);
  assert.match(ui.value("recorded-end").textContent, /3:05:12 PM UTC/);
  assert.match(ui.value("timing-note").textContent, /not measured active work/);
  assert.match(ui.value("timing-note").textContent, /not a server-verified clock/);
  assert.equal(ui.dialog.querySelector(".tenet-process-events"), null);
  assert.match(ui.dialog.querySelectorAll(".tenet-process-axis-label").at(-1).textContent, /3:05:12 PM/);
  await seek(ui,1); assert.match(ui.value("selected-time").textContent, /\+4m 12s \|.*3:04:12 PM UTC/);
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-elapsed-label").at(-1).textContent, "+5m 12s");
  assert.equal(ui.calls.begin,0);
});

test("accelerated playback and pause skipping never shorten displayed recorded time", async () => {
  const start = 1700000000000;
  const ui = boot({bundle:fixtureWith([recorded("history.observation",1,{},[],start),recorded("history.observation",2,{},[],start+300000)])});
  await ui.import(); const end = ui.value("recorded-end").textContent;
  const speed = ui.dialog.querySelector('[data-control="speed"]'); speed.value = "8"; speed.fire("change"); await settle();
  await ui.click("play"); assert.equal([...ui.timers.values()][0].ms,125); await ui.runTimer(125);
  assert.equal(ui.value("recorded-span").textContent,"5m 0s");
  assert.equal(ui.value("recorded-end").textContent,end);
  assert.match(ui.value("selected-time").textContent,/\+5m 0s \|/);
  const skip = ui.dialog.querySelector('[data-control="skip-pauses"]'); skip.checked = false; skip.fire("change"); await settle();
  await ui.click("play"); assert.equal([...ui.timers.values()][0].ms,37500);
  assert.equal(ui.value("recorded-span").textContent,"5m 0s"); ui.action("close").click();
});

test("no history and a single observation do not invent a working duration", async () => {
  for (const count of [0,1]) {
    const ui = boot({bundle:fixtureWith(count ? [recorded("history.observation",1)] : [])}); await ui.import();
    assert.equal(ui.value("recorded-span").textContent,count ? "One observation" : "Unavailable");
    assert.match(ui.value("timing-note").textContent,count ? /single observation does not establish a duration/ : /cannot be reconstructed from the final page/);
    if (!count) assert.equal(ui.value("recorded-start").textContent,"Clock time unavailable");
  }
});

test("equal device timestamps remain zero recorded span with an explicit limitation", async () => {
  const ui = boot({bundle:fixtureWith([recorded("history.observation",1,{},[],1000),recorded("history.observation",2,{},[],1000)])}); await ui.import();
  assert.equal(ui.value("recorded-span").textContent,"0s");
  assert.match(ui.value("timing-note").textContent,/does not mean the assignment took zero time/);
  assert.match(ui.value("selected-time").textContent,/\+0s \|/);
});

test("missing timestamps or a backward device clock disable relative spans without reordering events", async () => {
  for (const times of [[1000,null,3000],[3000,1000,5000]]) {
    const events = times.map((time,index)=>recorded("history.observation",index+1,{},[],time));
    const before = JSON.stringify(events), ui = boot({bundle:fixtureWith(events)}); await ui.import();
    assert.equal(ui.value("recorded-span").textContent,"Unavailable");
    assert.match(ui.value("timing-note").textContent,/Missing or out-of-order device timestamps/);
    assert.match(ui.value("selected-time").textContent,/Relative time unavailable/);
    await seek(ui,1); assert.equal(JSON.parse(ui.value("detail").textContent).sequence,2);
    assert.equal(JSON.stringify(events),before);
  }
});

test("relative elapsed time uses absolute instants across daylight-saving clock changes", async () => {
  const events = ["2026-11-01T01:59:00-04:00","2026-11-01T01:01:00-05:00"].map((timestamp,index)=>({type:"history.observation",sequence:index+1,timestamp,details:{},assets:[]}));
  const ui = boot({bundle:fixtureWith(events),timeZone:"America/New_York"}); await ui.import();
  assert.equal(ui.value("recorded-span").textContent,"2m 0s");
  assert.match(ui.value("recorded-start").textContent,/1:59:00 AM EDT/);
  assert.match(ui.value("recorded-end").textContent,/1:01:00 AM EST/);
  assert.match(ui.value("timing-note").textContent,/America\/New_York/);
  assert.match(ui.value("selected-time").textContent,/\+2m 0s \|/);
});

test("epoch timestamps, fractional spans and multi-day spans are displayed without wrapping", async () => {
  for (const [span,label] of [[500,"<1s"],[90061000,"1d 1h 1m 1s"]]) {
    const ui = boot({bundle:fixtureWith([recorded("history.observation",1,{},[],0),recorded("history.observation",2,{},[],span)]),timeZone:"UTC"}); await ui.import();
    assert.equal(ui.value("recorded-span").textContent,label);
    assert.match(ui.value("recorded-start").textContent,/1970/);
    assert.ok(ui.value("selected-time").textContent.includes("+"+label+" |"));
  }
});

test("AI requests and their completed lifecycle share the same relative-time origin", async () => {
  const ui = boot({bundle:rawInputFixture().fixture}); await ui.import(); await ui.click("ai-summary");
  assert.match(ui.dialog.querySelector(".tenet-process-ai-requests button").textContent,/\+0s \|/);
  assert.match(ui.value("ai-origin").textContent,/Request observed: \+0s \|/);
  assert.match(ui.value("ai-lifecycle").textContent,/at \+10s \|/);
  assert.match(ui.value("ai-replies").textContent,/Reply observed \+5s \|/);
  assert.equal(ui.value("recorded-span").textContent,"15s");
});

test("timing coverage warnings and session retirement preserve privacy", async () => {
  const fixture = fixtureWith([recorded("history.observation",1),recorded("coverage.gap",2)]);
  fixture.attempt.incomplete=true; fixture.attempt.droppedEvents=3;
  const ui = boot({bundle:fixture}); await ui.import();
  assert.match(ui.value("timing-note").textContent,/missing or omitted observations/);
  ui.win.fire("tenet:sign-out"); await settle();
  for (const name of ["recorded-span","recorded-start","recorded-end","timing-note"]) assert.equal(ui.value(name).textContent,"");
  assert.equal(ui.dialog.open,false);
});

test("timing cards use responsive external CSS and do not create student verdict controls", () => {
  assert.match(processCSS,/@media\(max-width:560px\)\{\.tenet-process-time-cards\{grid-template-columns:1fr 1fr/);
  const ui=boot(); assert.equal(ui.dialog.querySelectorAll(".tenet-process-timing button").length,0);
  assert.equal(ui.dialog.querySelector(".tenet-process-timing").getAttribute("aria-label"),"Recorded elapsed and clock time");
});

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

test("teacher review owns the full viewport with a collapsible narrow library", () => {
  assert.match(processCSS, /#tenetProcessDialog\{[^}]*position:fixed;inset:0;[^}]*max-width:none;[^}]*height:100dvh;max-height:none/);
  assert.match(processCSS, /#tenetProcessDialog\[open\]\{display:grid;grid-template-rows:auto auto auto minmax\(0,1fr\) auto/);
  assert.match(processCSS, /#tenetProcessDialog\[data-library=open\] \.tenet-process-layout\{grid-template-columns:224px minmax\(0,1fr\)/);
  assert.match(processCSS, /#tenetProcessDialog \.tenet-process-work\{[^}]*min-height:0;[^}]*overflow:auto/);
  assert.match(processCSS, /safe-area-inset-top/);
  assert.match(processCSS, /#tenetProcessDialog\{[^}]*width:100vw/);
  assert.match(processCSS, /html:has\(#tenetProcessDialog\[open\]\),body:has\(#tenetProcessDialog\[open\]\)\{overflow:hidden\}/);
  assert.match(processCSS, /@media\(max-width:700px\)/);
  assert.match(processCSS, /#tenetProcessDialog\[data-library=open\] \.tenet-process-work\{display:none\}/);
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
  assert.equal(ui.value("position").textContent, "1 / 10 moments");
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
  const ui = boot(); await ui.import(); assert.equal(ui.value("position").textContent, "3 / 3 moments");
  await ui.click("play"); assert.equal(ui.value("position").textContent, "1 / 3 moments"); assert.equal(ui.timers.size, 1);
  assert.equal(displayedLabel(ui), "frame0");
  await ui.runTimer(); assert.equal(ui.value("position").textContent, "2 / 3 moments");
  await ui.runTimer(); assert.equal(ui.value("position").textContent, "3 / 3 moments"); assert.equal(ui.timers.size, 0); assert.equal(ui.action("play").textContent, "Play history");
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
  const ui = boot({bundle:bundle("Delayed frames", 3, async (_id, hash) => hash === "frame0" && requested++ === 0 ? pending.promise : rasterBlob(hash))});
  await ui.import(); await ui.click("play"); await ui.click("play"); await ui.click("play");
  assert.equal(ui.value("position").textContent, "1 / 3 moments"); assert.equal(ui.timers.size, 1);
  pending.resolve(rasterBlob("stale")); await settle();
  assert.equal(ui.timers.size, 1); assert.equal(displayedLabel(ui), "frame0");
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
  const old = bundle("Old archive", 3, async (_id, hash) => hash === "frame0" ? pending.promise : rasterBlob(hash));
  const ui = boot({readArchive:file => file.name === "old" ? old : bundle("New archive")});
  await ui.import({name:"old"}); ui.slider.value = "0"; ui.slider.fire("input"); await settle(); await ui.import({name:"new"});
  pending.resolve(rasterBlob("old-frame")); await settle();
  assert.equal(ui.value("title").textContent, "New archive"); assert.equal(displayedLabel(ui), "frame2");
});

test("AI question and response form one interaction by request id and render as text", async () => {
  const fixture = bundle();
  fixture.events = [
    {sequence:1, type:"ai.request", details:{localRequestId:"one", question:'<img src=x onerror="attack()">', context:{scope:"selection"}}, assets:[]},
    {sequence:2, type:"ai.response", details:{localRequestId:"one", text:"What would undo +6?", committedToPage:false}, assets:[]},
    {sequence:3, type:"ai.request", details:{localRequestId:"two", question:"Another question", context:{scope:"text-only"}}, assets:[]},
  ];
  const ui = boot({bundle:fixture}); await ui.import();
  assert.equal(ui.value("question").textContent, "Another question"); assert.match(ui.value("response").textContent, /No linked reply body/);
  ui.slider.value = "0"; ui.slider.fire("input"); await settle();
  assert.equal(ui.value("question").textContent, fixture.events[0].details.question); assert.equal(ui.value("question").querySelector("img"), null);
  assert.equal(ui.value("response").textContent, "What would undo +6?"); assert.match(ui.value("event-description").textContent, /not proof of acceptance/);
  assert.equal(ui.value("position").textContent, "1 / 2 moments");
  assert.match(ui.value("ai-replies").textContent, /What would undo \+6/);
  ui.slider.value = "1"; ui.slider.fire("input"); await settle(); assert.equal(ui.value("question").textContent, "Another question");
});

test("empty histories remain readable with playback disabled", async () => {
  const ui = boot({bundle:bundle("Empty history", 0)}); await ui.import();
  assert.equal(ui.value("position").textContent, "0 / 0 moments"); assert.equal(ui.action("play").disabled, true);
  assert.match(ui.value("preview").textContent, /No rendered checkpoint/); assert.equal(ui.timers.size, 0);
});

test("missing replay attachment retains the labeled prior frame and readable event history", async () => {
  const ui = boot({bundle:bundle("Missing checkpoint", 3, async (_id, hash) => hash === "frame0" ? null : rasterBlob(hash))});
  await ui.import(); await ui.click("play");
  assert.equal(ui.timers.size, 1); assert.equal(ui.action("play").textContent, "Pause replay");
  assert.match(ui.value("preview").textContent, /checkpoint attachment is unavailable/); assert.equal(displayedLabel(ui), "frame2");
  assert.match(ui.value("frame-time").textContent, /checkpoint: event 3/);
  await ui.runTimer(); assert.equal(displayedLabel(ui), "frame1");
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
  assert.equal(displayedLabel(ui), "frame2");
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
  assert.equal(ui.value("title").textContent, "Last year's work"); assert.equal(ui.value("position").textContent, "0 / 0 moments");
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
  work.getAsset = async () => rasterBlob("saved webp thumbnail", "image/webp");
  const history = savedProvider([work]); const ui = savedBoot(history.provider);
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("webp"), true); await settle();
  assert.equal(ui.value("checkpoints").textContent, "1"); assert.equal(ui.value("event-title").textContent, "Saved page state");
  assert.equal(displayedLabel(ui), "saved webp thumbnail");
  assert.match(ui.value("checkpoint-caption").textContent, /saved-page thumbnail, not a full-resolution checkpoint/);
  assert.equal(ui.calls.canvases, 0);
});

test("event details normalize saved ISO timestamps and legacy numeric times without reordering playback", async () => {
  const work = savedBundle("times", "Timestamp compatibility");
  const iso = "2026-09-15T18:30:45.123Z", legacy = 1700000000000;
  work.events = [
    {sequence:1, type:"history.observation", timestamp:iso, details:{note:"ISO saved event"}, assets:[]},
    {sequence:2, type:"history.observation", clientWallTime:legacy, details:{note:"Older clock value, later event order"}, assets:[]},
    {sequence:3, type:"history.observation", timestamp:"not a time", details:{note:"Bad timestamp"}, assets:[]},
    {sequence:4, type:"history.observation", clientWallTime:1e30, details:{note:"Out of Date range"}, assets:[]},
    {sequence:5, type:"history.observation", clientWallTime:null, details:{note:"No timestamp"}, assets:[]},
    {sequence:6, type:"history.observation", clientWallTime:0, details:{note:"Numeric epoch is valid"}, assets:[]},
    {sequence:7, type:"history.observation", timestamp:"bad", clientWallTime:legacy, details:{note:"Legacy fallback"}, assets:[]},
  ];
  const history = savedProvider([work]); const ui = savedBoot(history.provider);
  assert.equal(await ui.win.TenetProcessUI.openSavedPage("times"), true); await settle();
  const format = new Intl.DateTimeFormat(undefined, {year:"numeric", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", second:"2-digit", timeZoneName:"short"});
  const expected = [Date.parse(iso), legacy, null, null, null, 0, legacy].map(time => `Relative time unavailable | ${time === null ? "Clock time unavailable" : format.format(new Date(time))}`);
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

test("final capture contract forms one AI moment including inputs appended after finish", async () => {
  const input = rawInputFixture(), ui = boot({bundle:input.fixture}); await ui.import();
  assert.equal(ui.value("position").textContent, "1 / 1 moments");
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-events button").length, 0);
  assert.match(ui.value("response").textContent, /undo \+6/);
  assert.equal(ui.value("checkpoints").textContent, "0"); assert.deepEqual(input.reads, []);
  await ui.click("ai-summary");
  assert.match(ui.value("ai-origin").textContent, /Voice question.*local-submit-path/);
  assert.match(ui.value("ai-lifecycle").textContent, /completed.*1 reply observation.*1 client-input record/);
  assert.match(ui.value("ai-replies").textContent, /undo \+6/);
  assert.equal(JSON.parse(ui.value("ai-context").textContent).questionSource, "selection-question");
  assert.deepEqual(JSON.parse(ui.value("detail").textContent).groupedRawSequences, [1,2,3,4]);
  assert.deepEqual(input.reads, [], "Inspector attachment reads must be explicit/lazy");
});

test("explicitly linked late edit selects its own request rather than a newer preceding request", async () => {
  const events = [
    recorded("ai.request", 1, {localRequestId:"a", question:"First question", origin:"quick-help"}),
    recorded("ai.response", 2, {localRequestId:"a", text:"First hint"}),
    recorded("ai.request", 3, {localRequestId:"b", question:"Second question", origin:"specific-question"}),
    recorded("ai.response", 4, {localRequestId:"b", text:"Second hint"}),
    recorded("canvas.commit", 5, {localRequestId:"a", note:"Explicit recorded output link"}),
    recorded("canvas.commit", 6, {note:"Independent later student edit"}),
  ];
  const ui = boot({bundle:fixtureWith(events)}); await ui.import();
  const linkedBar = ui.dialog.querySelectorAll('g[role="button"]').find(node => /Seek to recorded event 5: \+20s \|/.test(node.getAttribute("aria-label")));
  assert.ok(linkedBar); linkedBar.click(); await settle();
  assert.equal(ui.value("question").textContent, "First question"); assert.equal(ui.value("response").textContent, "First hint");
  assert.deepEqual(JSON.parse(ui.value("detail").textContent).groupedRawSequences, [1,2,5]);
  assert.equal(ui.value("position").textContent, "1 / 3 moments");
  await seek(ui, 2);
  assert.match(ui.value("event-title").textContent, /Work updated/);
  assert.match(ui.value("event-description").textContent, /does not attribute the edits to AI/);
  assert.deepEqual(JSON.parse(ui.value("detail").textContent).groupedRawSequences, [6]);
});

test("nearby edits and checkpoints group into work moments without counting images as edits", async () => {
  const baseline = 1700000000000;
  const events = [recorded("canvas.commit",1,{},[],baseline), recorded("page.checkpoint",2,{},[{hash:"work",mime:"image/png"}],baseline+10), recorded("native.revision",3,{},[],baseline+20), recorded("page.checkpoint",4,{},[{hash:"work",mime:"image/png"}],baseline+30), recorded("coverage.gap",5,{reason:"not observed"},[],baseline+40)];
  const ui = boot({bundle:fixtureWith(events, async () => rasterBlob("work"))}); await ui.import();
  assert.equal(ui.slider.max, "1"); await seek(ui, 0);
  assert.match(ui.value("event-description").textContent, /1 observed canvas edits, 1 PencilKit revisions and 2 saved page images/);
  assert.deepEqual(JSON.parse(ui.value("detail").textContent).groupedRawSequences, [1,2,3,4]);
  assert.match(ui.value("activity-note").textContent, /reloads and coverage gaps are not counted/);
});

test("duplicate and missing request identities never fabricate linked replies", async () => {
  const events = [recorded("ai.request",1,{localRequestId:"dup",question:"First"}), recorded("ai.request",2,{localRequestId:"dup",question:"Second"}), recorded("ai.response",3,{localRequestId:"dup",text:"Must not attribute"}), recorded("ai.request",4,{question:"No identity"}), recorded("ai.response",5,{text:"No identity response"})];
  const ui = boot({bundle:fixtureWith(events)}); await ui.import(); await ui.click("ai-summary");
  assert.match(ui.value("ai-lifecycle").textContent, /Duplicate request identifiers/);
  assert.doesNotMatch(ui.value("ai-replies").textContent, /Must not attribute/);
  ui.dialog.querySelectorAll(".tenet-process-ai-requests button")[2].click(); await settle();
  assert.match(ui.value("ai-origin").textContent, /not recorded \(legacy\)/);
  assert.match(ui.value("ai-lifecycle").textContent, /no usable linking identifier/);
  assert.doesNotMatch(ui.value("ai-replies").textContent, /No identity response/);
});

test("all supported playback speeds use recorded-time intervals and stop old timers on change", async () => {
  const ui = boot(); await ui.import();
  const control = ui.dialog.querySelector('[data-control="speed"]');
  for (const speed of [0.5,1,2,4,8,16,32]) {
    control.value = String(speed); control.fire("change"); await settle();
    assert.equal(ui.timers.size, 0); assert.equal(ui.action("play").textContent, "Play history");
    await ui.click("play"); assert.equal([...ui.timers.values()][0].ms, 5000 / speed);
    await ui.click("play");
  }
  assert.doesNotMatch(ui.value("pacing").textContent, /proven work/);
});

test("long-pause skipping is explicit and unskipped delays are chunked without timer overflow", async () => {
  const fixture = bundle("Long pause", 2); fixture.events[1].clientWallTime = fixture.events[0].clientWallTime + 90000;
  const ui = boot({bundle:fixture}); await ui.import(); await ui.click("play");
  assert.equal([...ui.timers.values()][0].ms, 1000); assert.match(ui.value("pacing").textContent, /shortened to 1 second/);
  const skip = ui.dialog.querySelector('[data-control="skip-pauses"]'); skip.checked = false; skip.fire("change"); await settle();
  assert.equal(ui.timers.size, 0); await ui.click("play"); assert.equal([...ui.timers.values()][0].ms, 60000);
  await ui.runTimer(60000); assert.equal([...ui.timers.values()][0].ms, 30000);
  await ui.runTimer(30000); assert.equal(ui.value("position").textContent, "2 / 2 moments"); assert.equal(ui.timers.size, 0);
});

test("nonmonotonic and missing timestamps retain append order with honest pacing fallback", async () => {
  const fixture = fixtureWith([recorded("history.observation",1,{},[],3000), recorded("history.observation",2,{},[],1000), recorded("history.observation",3,{},[],null)]);
  const ui = boot({bundle:fixture}); await ui.import();
  assert.match(ui.value("activity-note").textContent, /Recorded-order bins/);
  await ui.click("play"); assert.equal([...ui.timers.values()][0].ms, 1000); assert.match(ui.value("pacing").textContent, /fallback in recorded order/);
  await ui.runTimer(); assert.equal(JSON.parse(ui.value("detail").textContent).sequence, 2);
  assert.equal([...ui.timers.values()][0].ms, 1000); await ui.runTimer(); assert.equal(JSON.parse(ui.value("detail").textContent).sequence, 3);
});

test("scrubbing and speed changes invalidate already-dispatched old replay callbacks", async () => {
  const ui = boot(); await ui.import(); await ui.click("play"); const old = [...ui.timers.values()][0].callback;
  await seek(ui, 1); old(); await settle(); assert.equal(ui.value("position").textContent, "2 / 3 moments"); assert.equal(ui.timers.size, 0);
  const speed = ui.dialog.querySelector('[data-control="speed"]'); speed.value = "2"; speed.fire("change"); await settle();
  old(); await settle(); assert.equal(ui.value("position").textContent, "2 / 3 moments");
});

test("a pending next decode keeps the displayed checkpoint and its own timestamp visible", async () => {
  const gate = deferred();
  const ui = boot({decode:(_url, blob) => rasterMetadata.get(blob)?.label === "frame0" ? gate.promise : Promise.resolve()});
  await ui.import(); const prior = ui.dialog.querySelector(".tenet-process-preview img").src;
  await seek(ui, 0); assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src, prior);
  assert.equal(ui.dialog.querySelector(".tenet-process-preview img").hidden, false);
  assert.match(ui.value("frame-time").textContent, /checkpoint: event 3/); assert.match(ui.value("selected-time").textContent, /Work moment 1/);
  gate.resolve(); await settle(); assert.equal(displayedLabel(ui), "frame0"); assert.match(ui.value("frame-time").textContent, /checkpoint: event 1/);
});

test("same checkpoint asset is read once across different events and non-image observations", async () => {
  const reads = [], fixture = bundle("Repeated frame", 3, async (_id, hash) => { reads.push(hash); return rasterBlob(hash); });
  fixture.events.forEach(event => { event.assets[0].hash = "same"; });
  fixture.events.push(recorded("history.observation",4));
  const ui = boot({bundle:fixture}); await ui.import(); await seek(ui,0); await seek(ui,1); await seek(ui,2); await seek(ui,3);
  assert.deepEqual(reads, ["same"]); assert.equal(ui.urls.size,1); assert.equal(displayedLabel(ui),"same");
});

test("prefetch reuses next frame and bounds decoded cache count and total pixels", async () => {
  const reads = [], fixture = bundle("Cache budget",6,async (_id,hash) => { reads.push(hash); return rasterBlob(hash,"image/png",4000,2000); });
  const ui = boot({bundle:fixture}); await ui.import(); await seek(ui,0); assert.ok(reads.includes("frame1"),"Next checkpoint prefetched");
  await seek(ui,1); assert.equal(reads.filter(hash => hash === "frame1").length,1);
  for (let index = 2; index < 6; index++) {
    await seek(ui,index); assert.ok(ui.urls.size <= 3);
    const pixels = [...ui.urls.values()].reduce((total,blob) => { const meta=rasterMetadata.get(blob); return total + meta.width*meta.height; },0);
    assert.ok(pixels <= 16*1024*1024);
  }
  assert.ok(ui.revoked.length>0); await ui.click("close"); assert.equal(ui.urls.size,0); assert.equal(ui.timers.size,0);
});

test("oversized, mismatched and malformed raster headers never enter the decoded cache", async () => {
  const bad = [rasterBlob("too-wide","image/png",5000,10),rasterBlob("too-many-pixels","image/png",4096,4096),new Blob(["<svg><script>attack()</script></svg>"],{type:"image/png"}),new Blob([new Uint8Array(8*1024*1024+1)],{type:"image/png"})];
  for (const blob of bad) {
    const ui = boot({bundle:bundle("Bad image",1,async()=>blob)}); await ui.import();
    assert.equal(ui.urls.size,0); assert.equal(ui.calls.decoded.length,0); assert.equal(ui.timers.size,0);
    assert.match(ui.value("preview").textContent,/limit|header/); assert.equal(ui.value("position").textContent,"1 / 1 moments");
  }
});

test("PNG JPEG and WebP image header paths retain readable decoded frames", async () => {
  for (const mime of ["image/png","image/jpeg","image/webp"]) {
    const fixture = bundle(mime,1,async()=>rasterBlob(mime,mime)); fixture.events[0].assets[0].mime=mime;
    const ui=boot({bundle:fixture}); await ui.import(); assert.equal(displayedLabel(ui),mime); assert.equal(ui.calls.decoded.length,1);
    await ui.click("close"); assert.equal(ui.urls.size,0);
  }
});

test("retiring a view cancels deferred decodes and revokes every page image URL", async () => {
  for (const action of ["close","signout","pagehide"]) {
    const gate=deferred(), ui=boot({decode:(_url,blob)=>rasterMetadata.get(blob)?.label==="frame0"?gate.promise:Promise.resolve()});
    await ui.import(); await seek(ui,0); assert.ok(ui.urls.size>0);
    if(action==="close") ui.dialog.close(); else ui.win.fire(action==="signout"?"tenet:sign-out":"pagehide");
    await settle(); assert.equal(ui.urls.size,0); assert.equal(ui.timers.size,0); gate.resolve(); await settle();
    assert.equal(ui.urls.size,0); assert.equal(ui.value("question").textContent,"");
  }
});

test("unresolved checkpoint reads have a bounded timeout and cannot repaint after retirement", async () => {
  const gate=deferred(), ui=boot({bundle:bundle("Hung checkpoint",1,()=>gate.promise)});
  await ui.import(); await ui.runTimer(20000); assert.match(ui.value("preview").textContent,/too long/);
  assert.equal(ui.timers.size,0); await ui.click("close"); gate.resolve(rasterBlob("late")); await settle(); assert.equal(ui.urls.size,0);
});

test("AI input rasters and all AI lifecycle image assets are excluded from page replay and counts", async () => {
  const input=rawInputFixture();
  input.fixture.events[0].assets=[{name:"page.png",hash:"must-not-read",mime:"image/png"}];
  input.fixture.events.push(recorded("page.checkpoint",5,{},[{name:"ai-input.png",hash:"must-not-read",mime:"image/png"}]));
  const ui=boot({bundle:input.fixture}); await ui.import();
  assert.equal(ui.value("checkpoints").textContent,"0"); assert.equal(ui.urls.size,0); assert.deepEqual(input.reads,[]);
  assert.equal(ui.value("requests").textContent,"1");
});

test("raw client input inspector is lazy, text-safe and downloads the unchanged recorded body", async () => {
  const input=rawInputFixture(); input.body.question='<img src=x onerror="attack()">'; input.assets.set("body",new Blob([JSON.stringify(input.body)],{type:"application/json"}));
  const ui=boot({bundle:input.fixture}); await ui.import(); await ui.click("ai-summary"); assert.deepEqual(input.reads,[]);
  await inspectInput(ui,"Inspect recorded request JSON");
  assert.match(ui.value("input-body").textContent,/Image data hidden in this text preview only/);
  assert.match(ui.value("input-body").textContent,/<img src=x/); assert.equal(ui.value("input-body").querySelector("img"),null);
  assert.equal(await ui.urls.get(ui.value("input-download").href).text(),JSON.stringify(input.body));
  assert.match(ui.value("input-status").textContent,/not a server receipt or the final Gateway\/provider prompt/);
  assert.equal(ui.value("checkpoints").textContent,"0");
});

test("input body limit matches final 12 MiB capture contract and text preview has a separate limit", async () => {
  const input=rawInputFixture(), body={notes:"x".repeat(1024*1024+20)};
  input.assets.set("body",new Blob([JSON.stringify(body)],{type:"application/json"}));
  const ui=boot({bundle:input.fixture}); await ui.import(); await ui.click("ai-summary"); await inspectInput(ui,"Inspect recorded request JSON");
  assert.match(ui.value("input-body").textContent,/Text preview limited to 128 KiB/);
  assert.equal(JSON.parse(await ui.urls.get(ui.value("input-download").href).text()).notes.length,body.notes.length);
  input.assets.set("body",new Blob([new Uint8Array(12*1024*1024+1)],{type:"application/json"}));
  await inspectInput(ui,"Inspect recorded request JSON"); assert.match(ui.value("input-status").textContent,/exceeds the local viewer limit/); assert.equal(ui.urls.size,0);
});

test("recorded image inspector is separate from page frames and releases its URL on hiding", async () => {
  const input=rawInputFixture(), ui=boot({bundle:input.fixture}); await ui.import(); await ui.click("ai-summary"); await inspectInput(ui,"View submitted image");
  const image=ui.dialog.querySelector(".tenet-process-input-image"); assert.equal(image.hidden,false); assert.equal(rasterMetadata.get(ui.urls.get(image.src)).label,"exact submitted crop");
  assert.equal(ui.dialog.querySelector(".tenet-process-preview img").hidden,true); assert.equal(ui.value("checkpoints").textContent,"0");
  assert.equal(ui.urls.size,1); await ui.click("hide-ai-summary"); assert.equal(ui.urls.size,0); assert.equal(image.hidden,true);
});

test("redacted and absent legacy inputs are explicitly unavailable or partial, never reconstructed", async () => {
  const input=rawInputFixture(); Object.assign(input.fixture.events[3].details,{bodyStatus:"partial",bodyFormat:"redacted-client-json",bodyExact:false,omitted:["credential-field-omitted"]});
  const ui=boot({bundle:input.fixture}); await ui.import(); await ui.click("ai-summary"); await inspectInput(ui,"Inspect recorded request JSON");
  assert.match(ui.value("input-status").textContent,/partial.*redacted-client-json/); assert.match(ui.value("input-status").textContent,/not established/);
  assert.match(ui.dialog.querySelector(".tenet-process-input-records").textContent,/credential-field-omitted/);
  const legacy=boot({bundle:fixtureWith([recorded("ai.request",1,{localRequestId:"old"})])}); await legacy.import(); await legacy.click("ai-summary");
  assert.match(legacy.value("ai-origin").textContent,/legacy/); assert.match(legacy.dialog.querySelector(".tenet-process-input-records").textContent,/cannot be reconstructed/);
});

test("late recorded input reads cannot cross saved-page selection, close, or account retirement", async () => {
  for(const action of ["page","close","signout"]) {
    const input=rawInputFixture(), gate=deferred(); input.fixture.getAsset=()=>gate.promise;
    const next=bundle("Other student's selected page",0), ui=boot({readArchive:file=>file.name==="next"?next:input.fixture});
    await ui.import(); await ui.click("ai-summary"); await inspectInput(ui,"Inspect recorded request JSON");
    if(action==="page") await ui.import({name:"next"}); else if(action==="close") ui.dialog.close(); else ui.win.fire("tenet:sign-out");
    gate.resolve(input.json); await settle(); assert.equal(ui.value("input-body").textContent,""); assert.equal(ui.urls.size,0); assert.equal(ui.value("ai-question").textContent,"");
  }
});

test("late input-image decodes cannot recreate a private URL after sign-out", async () => {
  const input=rawInputFixture(), gate=deferred(), ui=boot({bundle:input.fixture,decode:()=>gate.promise});
  await ui.import(); await ui.click("ai-summary"); await inspectInput(ui,"View submitted image"); assert.equal(ui.urls.size,1);
  ui.win.fire("tenet:sign-out"); await settle(); assert.equal(ui.urls.size,0); assert.equal(ui.timers.size,0);
  gate.resolve(); await settle(); assert.equal(ui.dialog.querySelector(".tenet-process-input-image").hidden,true); assert.equal(ui.urls.size,0);
});

test("activity graph is bounded, accessible and counts edits/revisions rather than gaps or reloads", async () => {
  const events=[recorded("canvas.commit",1),recorded("native.revision",2),recorded("coverage.gap",3),recorded("page.reload",4),recorded("capture.paused",5),recorded("page.checkpoint",6,{},[{hash:"page",mime:"image/png"}])];
  const ui=boot({bundle:fixtureWith(events,async()=>rasterBlob("page"))}); await ui.import();
  const bars=ui.dialog.querySelectorAll('g[role="button"]'); assert.equal(bars.length,6);
  const labels=bars.map(node=>node.getAttribute("aria-label"));
  assert.equal(labels.filter(label=>/1 canvas edits/.test(label)).length,1); assert.equal(labels.filter(label=>/1 PencilKit revisions/.test(label)).length,1);
  assert.equal(labels.filter(label=>/1 coverage gap/.test(label)).length,1);
  for(const bar of bars) { assert.equal(bar.getAttribute("tabindex"),"0"); const hit=bar.querySelector("rect"); assert.ok(Number(hit.getAttribute("width"))>=44); assert.ok(Number(hit.getAttribute("height"))>=44); }
  bars[0].fire("keydown",{key:"Enter"}); await settle(); assert.equal(JSON.parse(ui.value("detail").textContent).sequence,1);
  assert.match(processCSS,/tenet-process-graph>svg\{[^}]*min-width:720px/);
});

test("large histories aggregate purple AI stars and paginate the complete request summary", async () => {
  const events=[];
  for(let index=0;index<50;index++) { events.push(recorded("ai.request",index*2+1,{localRequestId:"r"+index,question:"Question "+index,origin:"quick-help"})); events.push(recorded("ai.finished",index*2+2,{localRequestId:"r"+index,outcome:"failed"})); }
  const ui=boot({bundle:fixtureWith(events)}); await ui.import();
  assert.equal(ui.value("requests").textContent,"50"); assert.equal(ui.value("position").textContent,"50 / 50 moments");
  assert.ok(ui.dialog.querySelectorAll('g[role="button"]').length<=24);
  const stars=ui.dialog.querySelectorAll(".tenet-process-ai-star"); assert.ok(stars.length<=12); assert.ok(stars.length>0); assert.match(processCSS,/tenet-process-ai-star\{fill:var\(--process-ai\)/);
  stars[0].parentElement.fire("keydown",{key:" "}); await settle(); assert.equal(ui.dialog.querySelector(".tenet-process-ai-summary").hidden,false);
  assert.match(ui.value("ai-list-note").textContent,/Requests from .* to /); assert.match(ui.value("ai-lifecycle").textContent,/failed/);
  await ui.click("ai-summary"); assert.equal(ui.dialog.querySelectorAll(".tenet-process-ai-requests button").length,20);
  await ui.click("ai-next"); assert.equal(ui.dialog.querySelectorAll(".tenet-process-ai-requests button").length,20);
  await ui.click("ai-next"); assert.equal(ui.dialog.querySelectorAll(".tenet-process-ai-requests button").length,10); assert.equal(ui.action("ai-next").disabled,true);
});

test("rendered graph and inspector retain strict CSP and same-document modal contract", async () => {
  const input=rawInputFixture(), ui=boot({bundle:input.fixture}); await ui.import(); await ui.click("ai-summary");
  assert.equal(ui.dialog.id,"tenetProcessDialog"); assert.equal(ui.dialog.querySelector("iframe"),null);
  assert.equal(ui.dialog.querySelectorAll("[style]").length,0); assert.equal(ui.doc.head.querySelector("style"),null);
  assert.equal(ui.doc.head.querySelector("#tenetProcessStyles").href,"./tenet-process.css");
  assert.equal(ui.calls.list,0); assert.equal(ui.calls.begin,0); assert.match(ui.dialog.querySelector(".tenet-process-source").textContent,/AGPL-3.0/);
  assert.doesNotMatch(source,/\.style\.(?:cssText|setProperty|removeProperty|[A-Za-z_$][\w$]*\s*=)/);
});

function portableBundle(title = "Portable homework", historyAvailable = true) {
  const original = bundle(title, historyAvailable ? 3 : 0), finalPreview = rasterBlob("saved final page", "image/png", 1200, 800);
  return {
    ...original, historyAvailable, title, savedAt:"2026-09-15T18:00:00.000Z", finalPreview,
    finalPage:{asset:{name:"saved-preview.png",hash:"final-page",mime:"image/png",size:finalPreview.size},representation:"saved-preview-thumbnail",caption:"Saved snapshot preview; not a full-resolution rendered checkpoint."},
    submission:{version:1,exportedAt:"2026-09-15T18:30:00.000Z",assetCount:4,compressedBytes:4096,expandedBytes:8192,integrity:"sha256-not-authorship",localOnly:true},
    getAsset:async (id,hash)=>hash==="final-page"?finalPreview:original.getAsset(id,hash),
  };
}
function installSubmission(ui, options = {}) {
  const calls={opens:[],exports:[],prepares:[],shares:[],reports:[]};
  ui.win.TenetSubmission={
    openFile:async file=>{calls.opens.push(file);return options.openFile?options.openFile(file):portableBundle();},
    exportSavedPage:async id=>{calls.exports.push(id);return options.exportSavedPage?options.exportSavedPage(id):{blob:new Blob(["portable saved bytes"],{type:"application/vnd.tenet.whiteboard"}),filename:"homework.tenet"};},
    prepareSavedPage:async id=>{calls.prepares.push(id);return options.prepareSavedPage?options.prepareSavedPage(id):portableBundle();},
  };
  ui.win.TenetSubmissionShare=async (blob,filename)=>{calls.shares.push({blob,filename});return options.share?options.share(blob,filename):undefined;};
  ui.win.TenetSubmissionReport=async (record,settings)=>{calls.reports.push({bundle:record,settings});return options.report?options.report(record,settings):undefined;};
  return calls;
}

test("portable picker routes .tenet to the bounded codec and keeps legacy archives on the legacy reader", async () => {
  const ui=boot(), calls=installSubmission(ui);
  const picker=ui.dialog.querySelector('[data-file="archive"]');
  assert.match(picker.getAttribute("accept"),/\.tenet,/); assert.match(picker.getAttribute("accept"),/\.json/);
  await ui.import({name:"work.TENET",type:"application/octet-stream"});
  assert.equal(calls.opens.length,1); assert.equal(ui.calls.archive,0); assert.equal(ui.value("badge").textContent,"PORTABLE WORK / LOCAL FILE");
  await ui.import({name:"old.tenet-work.json",type:"application/json"});
  assert.equal(calls.opens.length,1); assert.equal(ui.calls.archive,1); assert.equal(ui.value("badge").textContent,"IMPORTED / UNVERIFIED");
  assert.equal(ui.calls.list,0); assert.equal(ui.calls.begin,0); assert.equal(calls.shares.length,0);
});

test("public openFile opens the same document dialog without navigating or replacing scratch work", async () => {
  const history=savedProvider([savedBundle("local","Local saved work")]);
  const ui=savedBoot(history.provider), calls=installSubmission(ui);
  const scratch={ink:["unsaved stroke"]};ui.win.scratch=scratch;ui.win.location=Object.freeze({href:"https://district.example/whiteboard"});
  ui.win.open=()=>assert.fail("Portable history must stay in-app");
  assert.equal(ui.dialog.open,false);
  assert.equal(await ui.win.TenetProcessUI.openFile({name:"homework.tenet"}),true);await settle();
  assert.equal(ui.dialog.open,true);assert.strictEqual(ui.win.scratch,scratch);assert.deepEqual(scratch.ink,["unsaved stroke"]);
  assert.equal(ui.win.location.href,"https://district.example/whiteboard");assert.equal(ui.dialog.querySelector("iframe"),null);
  assert.equal(calls.opens.length,1);assert.deepEqual(history.calls.reads,[]);
  assert.equal(typeof ui.win.TenetProcessUI.openSavedPage,"function");assert.equal(typeof ui.win.TenetProcessUI.shareSavedPage,"function");
});

test("corrupt portable and legacy imports retain the previous selected history and displayed frame", async () => {
  for(const portable of [true,false]) {
    const ui=boot({readArchive:file=>file.name==="bad.json"?Promise.reject(Error("Legacy integrity failure")):bundle("Keep this work")});
    installSubmission(ui,{openFile:()=>Promise.reject(Error("Portable integrity failure"))});await ui.import();
    const frame=ui.dialog.querySelector(".tenet-process-preview img").src,title=ui.value("title").textContent;
    assert.equal(await ui.win.TenetProcessUI.openFile({name:portable?"bad.tenet":"bad.json"}),false);await settle();
    assert.equal(ui.value("title").textContent,title);assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src,frame);
    assert.ok(ui.urls.has(frame));assert.equal(ui.dialog.querySelector(".tenet-process-record").hidden,false);
    assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/integrity failure/);
  }
});

test("portable codec failure never falls through to a different archive parser", async () => {
  const ui=boot(), calls=installSubmission(ui,{openFile:()=>Promise.reject(Error("Bad TENETWB magic"))});
  assert.equal(await ui.win.TenetProcessUI.openFile({name:"renamed-json.tenet",type:"application/json"}),false);
  assert.equal(calls.opens.length,1);assert.equal(ui.calls.archive,0);assert.equal(ui.calls.begin,0);
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/Bad TENETWB magic/);
});

test("cancelled file selection and missing portable module preserve existing work", async () => {
  const ui=boot();await ui.import();const title=ui.value("title").textContent,frame=ui.dialog.querySelector(".tenet-process-preview img").src;
  const picker=ui.dialog.querySelector('[data-file="archive"]');picker.files=[];picker.fire("change");await settle();
  assert.equal(ui.value("title").textContent,title);assert.equal(await ui.win.TenetProcessUI.openFile(null),false);
  assert.equal(await ui.win.TenetProcessUI.openFile({name:"new.tenet"}),false);
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/not supported in this build/);
  assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src,frame);
});

test("latest portable selection wins over a delayed file without reviving old URLs", async () => {
  const pending=deferred(), ui=boot();installSubmission(ui,{openFile:file=>file.name==="old.tenet"?pending.promise:portableBundle("Latest file")});
  const old=ui.win.TenetProcessUI.openFile({name:"old.tenet"});await settle();
  assert.equal(await ui.win.TenetProcessUI.openFile({name:"new.tenet"}),true);const frame=ui.dialog.querySelector(".tenet-process-preview img").src;
  pending.resolve(portableBundle("Old file"));assert.equal(await old,false);await settle();
  assert.equal(ui.value("title").textContent,"Latest file");assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src,frame);
});

test("portable imports and final-page reads cannot cross close, pagehide or sign-out boundaries", async () => {
  for(const action of ["close","pagehide","tenet:sign-out"]) {
    const pending=deferred(), ui=boot();installSubmission(ui,{openFile:()=>pending.promise});
    const opening=ui.win.TenetProcessUI.openFile({name:"private.tenet"});await settle();
    if(action==="close")ui.dialog.close();else ui.win.fire(action);
    pending.resolve(portableBundle("Retired private file",false));assert.equal(await opening,false);await settle();
    assert.equal(ui.value("title").textContent,"");assert.equal(ui.urls.size,0);assert.equal(ui.value("sharing-note").textContent,"");
  }
  const pending=deferred(), record=portableBundle("Private final page",false);record.getAsset=()=>pending.promise;
  const ui=boot();installSubmission(ui,{openFile:()=>record});const opening=ui.win.TenetProcessUI.openFile({name:"private.tenet"});await settle();
  ui.win.fire("tenet:sign-out");pending.resolve(record.finalPreview);assert.equal(await opening,false);await settle();assert.equal(ui.urls.size,0);
});

test("portable no-history files display only the actual final preview without invented events", async () => {
  const record=portableBundle("Legacy worksheet",false), ui=boot();installSubmission(ui,{openFile:()=>record});
  assert.equal(await ui.win.TenetProcessUI.openFile({name:"legacy.tenet"}),true);await settle();
  assert.equal(displayedLabel(ui),"saved final page");assert.equal(ui.value("position").textContent,"0 / 0 moments");
  assert.equal(ui.value("checkpoints").textContent,"0");assert.equal(ui.value("requests").textContent,"0");
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-events button").length,0);assert.equal(ui.action("play").disabled,true);
  assert.match(ui.value("coverage").textContent,/No process history/);assert.match(ui.value("checkpoint-caption").textContent,/Saved snapshot preview.*No history events are added/);
  assert.match(ui.value("frame-time").textContent,/separate from timed replay/);assert.equal(ui.calls.canvases,0);assert.equal(ui.calls.begin,0);
});

test("saved final preview is an independent view and playback returns to historical checkpoints", async () => {
  const ui=boot();installSubmission(ui);await ui.win.TenetProcessUI.openFile({name:"work.tenet"});await settle();
  assert.equal(displayedLabel(ui),"frame2");assert.equal(ui.value("checkpoints").textContent,"3");
  await ui.click("final-page");assert.equal(displayedLabel(ui),"saved final page");assert.match(ui.action("final-page").textContent,/Return to work history/);
  assert.equal(ui.value("checkpoints").textContent,"3");assert.equal(ui.value("position").textContent,"3 / 3 moments");
  await ui.click("play");assert.equal(displayedLabel(ui),"frame0");assert.match(ui.value("frame-time").textContent,/checkpoint: event 1/);
});

test("portable files retain full grouped AI interactions and lazy original client inputs", async () => {
  const input=rawInputFixture(), record={...portableBundle(),...input.fixture,historyAvailable:true}, ui=boot();
  installSubmission(ui,{openFile:()=>record});await ui.win.TenetProcessUI.openFile({name:"ai-work.tenet"});await settle();
  assert.equal(ui.value("position").textContent,"1 / 1 moments");assert.equal(ui.value("checkpoints").textContent,"0");
  await ui.click("ai-summary");assert.match(ui.value("ai-lifecycle").textContent,/completed/);assert.match(ui.value("ai-replies").textContent,/undo \+6/);
  await inspectInput(ui,"Inspect recorded request JSON");assert.equal(await ui.urls.get(ui.value("input-download").href).text(),JSON.stringify(input.body));
  assert.equal(ui.value("checkpoints").textContent,"0");assert.equal(ui.calls.archive,0);
});

test("Share work exports only the selected saved version and never touches unsaved scratch work", async () => {
  const saved=savedBundle("saved-id","Saved assignment"), history=savedProvider([saved],"saved-id"), ui=savedBoot(history.provider);
  const bytes=new Blob(["only saved version"],{type:"application/vnd.tenet.whiteboard"}), calls=installSubmission(ui,{exportSavedPage:id=>({blob:bytes,filename:"assignment.tenet",bytes:bytes.size})});
  const scratch={name:"Unsaved rename",strokes:["new unsaved ink"]};ui.win.scratch=scratch;
  await ui.win.TenetProcessUI.openSavedPage("saved-id");await settle();assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);
  assert.equal(ui.action("share-work").hidden,false);assert.match(ui.value("sharing-note").textContent,/Only the saved version is exported/);
  assert.match(ui.value("sharing-note").textContent,/questions, replies and images/);assert.match(ui.value("sharing-note").textContent,/Nothing is uploaded automatically/);
  await ui.click("share-work");assert.deepEqual(calls.exports,["saved-id"]);assert.equal(calls.shares.length,1);
  assert.strictEqual(calls.shares[0].blob,bytes);assert.equal(calls.shares[0].filename,"assignment.tenet");
  assert.strictEqual(ui.win.scratch,scratch);assert.deepEqual(scratch.strokes,["new unsaved ink"]);assert.equal(ui.value("title").textContent,"Saved assignment");
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/sharing\/download was requested/);
});

test("Share work remains unavailable for imported and standalone files and cannot enumerate local saves", async () => {
  const ui=boot(), calls=installSubmission(ui);await ui.win.TenetProcessUI.openFile({name:"shared.tenet"});await settle();
  assert.equal(ui.action("share-work").hidden,true);assert.equal(await ui.win.TenetProcessUI.shareSavedPage("private-id"),false);
  assert.deepEqual(calls.exports,[]);assert.equal(ui.calls.list,0);
  const ordinary=savedBoot(savedProvider([]).provider);installSubmission(ordinary);await ordinary.win.TenetProcessUI.openFile({name:"shared.tenet"});
  assert.equal(ordinary.action("share-work").hidden,true);
});

test("share cancellation, export failure and old-native update errors retain selection and restore controls", async () => {
  for(const kind of ["cancel","export","old-native","invalid-result"]) {
    const ui=savedBoot(savedProvider([savedBundle("a","Keep saved work")]).provider);
    const cancel=Error("User cancelled");cancel.name="AbortError";
    const calls=installSubmission(ui,{
      exportSavedPage:()=>kind==="export"?Promise.reject(Error("Storage export failed")):kind==="invalid-result"?{blob:new Blob([]),filename:"invalid.tenet"}:{blob:new Blob(["saved"]),filename:"saved.tenet"},
      share:()=>kind==="cancel"?Promise.reject(cancel):kind==="old-native"?Promise.reject(Error("Update the iPad application to share work files.")):undefined,
    });
    await ui.win.TenetProcessUI.openSavedPage("a");const frame=ui.dialog.querySelector(".tenet-process-preview img").src;
    assert.equal(await ui.win.TenetProcessUI.shareSavedPage("a"),false);await settle();
    assert.equal(ui.value("title").textContent,"Keep saved work");assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src,frame);
    assert.equal(ui.action("share-work").disabled,false);
    const status=ui.dialog.querySelector(".tenet-process-status");
    assert.match(status.textContent,kind==="cancel"?/Sharing cancelled/:kind==="export"?/Storage export failed/:kind==="old-native"?/Update the iPad/:/valid work file/);
    assert.equal(status.dataset.error,kind==="cancel"?"false":"true");if(kind==="export"||kind==="invalid-result")assert.equal(calls.shares.length,0);
  }
});

test("sharing rejects stale export completions after page switches or sign-out", async () => {
  for(const action of ["page","signout"]) {
    const pending=deferred(), history=savedProvider([savedBundle("a","First"),savedBundle("b","Second")]), ui=savedBoot(history.provider);
    const calls=installSubmission(ui,{exportSavedPage:()=>pending.promise});await ui.win.TenetProcessUI.openSavedPage("a");
    const sharing=ui.win.TenetProcessUI.shareSavedPage("a");await settle();assert.equal(ui.action("share-work").disabled,true);
    if(action==="page")await ui.win.TenetProcessUI.openSavedPage("b");else ui.win.fire("tenet:sign-out");
    pending.resolve({blob:new Blob(["retired saved work"]),filename:"old.tenet"});assert.equal(await sharing,false);await settle();
    assert.equal(calls.shares.length,0);assert.equal(ui.action("share-work").disabled,false);assert.equal(ui.value("title").textContent,action==="page"?"Second":"");
  }
});

test("duplicate Share work clicks do not dispatch multiple exports or native share sheets", async () => {
  const pending=deferred(), ui=savedBoot(savedProvider([savedBundle("a","Saved work")]).provider), calls=installSubmission(ui,{share:()=>pending.promise});
  await ui.win.TenetProcessUI.openSavedPage("a");const first=ui.win.TenetProcessUI.shareSavedPage("a");await settle();
  assert.equal(await ui.win.TenetProcessUI.shareSavedPage("a"),false);assert.equal(calls.exports.length,1);assert.equal(calls.shares.length,1);
  pending.resolve();assert.equal(await first,true);assert.equal(ui.action("share-work").disabled,false);
});

test("report receives raw lifecycle fields, final-page metadata and guarded asset access", async () => {
  const input=rawInputFixture(), record=portableBundle("Reportable work"), assets=new Map(input.assets);
  record.events=input.fixture.events;record.getAsset=async(_id,hash)=>hash==="final-page"?record.finalPreview:assets.get(hash);
  const ui=boot(), calls=installSubmission(ui,{openFile:()=>record});await ui.win.TenetProcessUI.openFile({name:"report.tenet"});await ui.click("report");
  assert.equal(calls.reports.length,1);const report=calls.reports[0];assert.equal(report.settings.isCurrent(),true);
  assert.equal(report.bundle.title,"Reportable work");assert.equal(report.bundle.savedAt,record.savedAt);assert.strictEqual(report.bundle.finalPreview,record.finalPreview);
  assert.deepEqual(report.bundle.finalPage,record.finalPage);assert.deepEqual(report.bundle.submission,record.submission);
  assert.equal(report.bundle.events[1].details.text,"Which operation would undo +6?");assert.equal(report.bundle.events[2].details.outcome,"completed");
  assert.equal(report.bundle.events[3].type,"ai.input");assert.strictEqual(await report.bundle.getAsset(record.attempt.id,"body"),input.json);
  await assert.rejects(report.bundle.getAsset("wrong-attempt","body"),/does not belong/);
  assert.equal(calls.shares.length,0,"Opening a report must not itself share a file");
});

test("report current guard survives its same-document modal and rejects closed or changed ownership", async () => {
  const ui=boot(), calls=installSubmission(ui,{report:()=>{const modal=ui.doc.createElement("dialog");modal.className="tenet-submission-report";ui.doc.body.append(modal);modal.showModal();}});
  await ui.win.TenetProcessUI.openFile({name:"work.tenet"});await ui.click("report");const {bundle:report,settings}=calls.reports[0];
  assert.equal(ui.dialog.open,true);assert.equal(ui.doc.querySelector(".tenet-submission-report").open,true);assert.equal(settings.isCurrent(),true);
  ui.dialog.close();await settle();assert.equal(settings.isCurrent(),false);assert.throws(report.assertCurrent,/closed or changed/);
  await assert.rejects(report.getAsset(report.attempt.id,"final-page"),/closed or changed/);assert.equal(ui.urls.size,0);
});

test("report asset results and late report errors cannot cross page or account boundaries", async () => {
  for(const action of ["page","signout"]) {
    const asset=deferred(), parent=deferred(), record=portableBundle("Private report"), original=record.getAsset;
    record.getAsset=(id,hash)=>hash==="body"?asset.promise:original(id,hash);
    const ui=boot(), calls=installSubmission(ui,{openFile:file=>file.name==="next.tenet"?portableBundle("New selection",false):record,report:()=>parent.promise});
    await ui.win.TenetProcessUI.openFile({name:"first.tenet"});await ui.click("report");
    const {bundle:report,settings}=calls.reports[0];const reading=report.getAsset(report.attempt.id,"body");
    if(action==="page")await ui.win.TenetProcessUI.openFile({name:"next.tenet"});else ui.win.fire("tenet:sign-out");
    assert.equal(settings.isCurrent(),false);asset.resolve(new Blob(["private body"]));await assert.rejects(reading,/closed or changed/);
    parent.reject(Error("Late private report error"));await settle();assert.doesNotMatch(ui.dialog.querySelector(".tenet-process-status").textContent,/Late private report error/);
    assert.equal(ui.value("title").textContent,action==="page"?"New selection":"");assert.equal(ui.action("report").disabled,false);
  }
});

test("missing or failed report helpers retain history and allow retry without exporting", async () => {
  const ui=boot(), calls=installSubmission(ui,{report:()=>Promise.reject(Error("PDF/report unavailable"))});
  await ui.win.TenetProcessUI.openFile({name:"work.tenet"});const frame=ui.dialog.querySelector(".tenet-process-preview img").src;
  await ui.click("report");assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/PDF\/report unavailable/);
  assert.equal(ui.action("report").disabled,false);assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src,frame);
  delete ui.win.TenetSubmissionReport;await ui.click("report");assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/not available in this build/);
  assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);
});

test("portable/report UI retains strict CSP, privacy disclosures and native modal touch targets", async () => {
  const ui=boot();installSubmission(ui);await ui.win.TenetProcessUI.openFile({name:"work.tenet"});
  assert.equal(ui.dialog.id,"tenetProcessDialog");assert.equal(ui.dialog.querySelector("iframe"),null);assert.equal(ui.doc.head.querySelector("style"),null);
  assert.equal(ui.dialog.querySelectorAll("[style]").length,0);assert.match(ui.dialog.querySelector(".tenet-process-disclosure").textContent,/read-only/);
  assert.match(ui.value("sharing-note").textContent,/private student work, questions, replies and images/);
  assert.match(processCSS,/\.tenet-submission-report\{[^}]*width:min\(760px,calc\(100vw - 32px\)\)[^}]*max-height:calc\(100dvh - 32px\)[^}]*overflow:auto[^}]*padding:24px/);
  assert.match(processCSS,/\.tenet-submission-report::backdrop/);assert.match(processCSS,/\.tenet-submission-report-actions\{display:flex;flex-wrap:wrap;gap:12px/);
  assert.match(processCSS,/\.tenet-submission-report-actions button\{[^}]*min-height:44px/);
  assert.doesNotMatch(source,/window\.print\(|createElement\(["']iframe["']\)|createElement\(["']style["']\)/);
  assert.doesNotMatch(source,/\.style\.(?:cssText|setProperty|removeProperty|[A-Za-z_$][\w$]*\s*=)/);
});

test("notebook public Share opens the requested saved page with visible confirmation and PDF access", async () => {
  const history=savedProvider([savedBundle("chosen","Chosen saved page"),savedBundle("current","Different current canvas")],"current"), ui=savedBoot(history.provider);
  const complete=portableBundle("Chosen saved report"), calls=installSubmission(ui,{prepareSavedPage:()=>complete});
  const scratch={title:"Unsaved scratch",ink:["not saved"]};ui.win.scratch=scratch;
  const notebook=ui.doc.createElement("dialog");notebook.id="tenetNotebook";ui.doc.body.append(notebook);notebook.showModal();
  assert.equal(ui.dialog.open,false);notebook.close();
  assert.equal(await ui.win.TenetProcessUI.shareSavedPage("chosen"),true);await settle();
  assert.equal(ui.dialog.open,true);assert.equal(notebook.open,false);assert.equal(ui.value("title").textContent,"Chosen saved page");
  assert.equal(ui.dialog.querySelector(".tenet-process-record").hidden,false);assert.equal(ui.action("report").hidden,false);assert.equal(ui.action("report").disabled,false);
  assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/sharing\/download was requested/);
  assert.match(ui.value("sharing-note").textContent,/Only the saved version/);assert.deepEqual(calls.exports,["chosen"]);assert.equal(calls.shares.length,1);
  assert.deepEqual(history.calls.reads,["chosen"]);assert.strictEqual(ui.win.scratch,scratch);assert.deepEqual(scratch.ink,["not saved"]);
  await ui.click("report");assert.deepEqual(calls.prepares,["chosen"]);assert.equal(calls.reports.length,1);assert.strictEqual(calls.reports[0].bundle.finalPreview,complete.finalPreview);
  assert.equal(ui.dialog.open,true);assert.equal(ui.calls.begin,0);assert.equal(ui.calls.canvases,0);
});

test("public Share visibly reports missing saved pages without exporting another page", async () => {
  const ui=savedBoot(savedProvider([]).provider), calls=installSubmission(ui);
  assert.equal(await ui.win.TenetProcessUI.shareSavedPage("missing"),false);await settle();
  assert.equal(ui.dialog.open,true);assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/not found/);
  assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);assert.equal(ui.action("share-work").disabled,false);
});

test("public Share cannot export a selection retired while its saved page is opening", async () => {
  for(const action of ["close","page","signout"]) {
    const pending=deferred(), history=savedProvider([savedBundle("b","New page")]), read=history.provider.readSavedPage;
    history.provider.readSavedPage=id=>id==="a"?pending.promise:read(id);
    const ui=savedBoot(history.provider), calls=installSubmission(ui), sharing=ui.win.TenetProcessUI.shareSavedPage("a");await settle();
    if(action==="close")ui.dialog.close();else if(action==="page")await ui.win.TenetProcessUI.openSavedPage("b");else ui.win.fire("tenet:sign-out");
    pending.resolve(savedBundle("a","Retired private page"));assert.equal(await sharing,false);await settle();
    assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);assert.equal(ui.value("title").textContent,action==="page"?"New page":"");
    assert.equal(ui.action("share-work").disabled,false);assert.doesNotMatch(ui.dialog.querySelector(".tenet-process-status").textContent,/sharing\/download was requested/);
  }
});

test("duplicate public Share calls during opening load and share the saved page only once", async () => {
  const pending=deferred(), entry=savedBundle("a","Saved page"), history=savedProvider([entry]);let reads=0;
  history.provider.readSavedPage=()=>{reads++;return pending.promise;};
  const ui=savedBoot(history.provider), calls=installSubmission(ui), first=ui.win.TenetProcessUI.shareSavedPage("a");await settle();
  assert.equal(await ui.win.TenetProcessUI.shareSavedPage("a"),false);assert.equal(reads,1);assert.equal(calls.exports.length,0);
  pending.resolve(entry);assert.equal(await first,true);assert.equal(calls.exports.length,1);assert.equal(calls.shares.length,1);assert.equal(ui.dialog.open,true);
});

test("fresh local saved report prepares one complete saved version without export, compression or current canvas", async () => {
  const history=savedProvider([savedBundle("chosen","Saved page")]), ui=savedBoot(history.provider), prepared=portableBundle("Latest saved version",false);
  prepared.attempt={...prepared.attempt,id:"prepared-saved-version"};
  const calls=installSubmission(ui,{prepareSavedPage:()=>prepared});ui.win.scratch={image:"unsaved current canvas",question:"not part of the saved report"};
  await ui.win.TenetProcessUI.openSavedPage("chosen");await ui.click("report");
  assert.deepEqual(calls.prepares,["chosen"]);assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);assert.equal(calls.reports.length,1);
  const report=calls.reports[0];assert.equal(report.settings.isCurrent(),true);assert.equal(report.bundle.title,"Latest saved version");
  assert.equal(report.bundle.attempt.id,"prepared-saved-version");assert.strictEqual(report.bundle.finalPreview,prepared.finalPreview);assert.deepEqual(report.bundle.finalPage,prepared.finalPage);
  assert.equal(report.bundle.historyAvailable,false);assert.equal(report.bundle.events.length,0);assert.equal(report.bundle.savedAt,prepared.savedAt);
  assert.strictEqual(await report.bundle.getAsset("prepared-saved-version","final-page"),prepared.finalPreview);
  await assert.rejects(report.bundle.getAsset("chosen","final-page"),/does not belong/);
  assert.equal(ui.value("title").textContent,"Saved page");assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,/saved version, not unsaved canvas edits/);
  assert.equal(ui.calls.canvases,0);assert.equal(ui.win.scratch.image,"unsaved current canvas");
});

test("local report preparation failures retain the saved selection and never omit its image silently", async () => {
  for(const kind of ["missing","failure","invalid"]) {
    const ui=savedBoot(savedProvider([savedBundle("a","Retained saved page")]).provider);
    const calls=installSubmission(ui,{prepareSavedPage:()=>kind==="invalid"?{attempt:{id:"invalid"}}:Promise.reject(Error("Saved page preparation failed"))});
    if(kind==="missing")delete ui.win.TenetSubmission.prepareSavedPage;
    await ui.win.TenetProcessUI.openSavedPage("a");const frame=ui.dialog.querySelector(".tenet-process-preview img").src;await ui.click("report");
    assert.equal(calls.reports.length,0);assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);assert.equal(ui.action("report").disabled,false);
    assert.equal(ui.value("title").textContent,"Retained saved page");assert.equal(ui.dialog.querySelector(".tenet-process-preview img").src,frame);
    assert.match(ui.dialog.querySelector(".tenet-process-status").textContent,kind==="missing"?/preparation is not available/:kind==="invalid"?/could not be prepared/:/preparation failed/);
    ui.win.TenetSubmission.prepareSavedPage=async()=>portableBundle("Retry saved version");await ui.click("report");assert.equal(calls.reports.length,1);
  }
});

test("local saved report preparation is fenced across close, page switch and sign-out", async () => {
  for(const action of ["close","page","signout"]) {
    const pending=deferred(), ui=savedBoot(savedProvider([savedBundle("a","Private saved work"),savedBundle("b","Next saved page")]).provider);
    const calls=installSubmission(ui,{prepareSavedPage:()=>pending.promise});await ui.win.TenetProcessUI.openSavedPage("a");await ui.click("report");
    assert.equal(ui.action("report").disabled,true);
    if(action==="close")ui.dialog.close();else if(action==="page")await ui.win.TenetProcessUI.openSavedPage("b");else ui.win.fire("tenet:sign-out");
    pending.resolve(portableBundle("Private prepared image"));await settle();
    assert.equal(calls.reports.length,0);assert.equal(calls.exports.length,0);assert.equal(calls.shares.length,0);assert.equal(ui.action("report").disabled,false);
    assert.equal(ui.value("title").textContent,action==="page"?"Next saved page":"");
  }
});

test("prepared report guards keep codec account invalidation and its own asset reader", async () => {
  let accountCurrent=true;const prepared=portableBundle("Account-bound saved work");
  prepared.assertCurrent=()=>{if(!accountCurrent)throw Error("Saved account changed");};
  const ui=savedBoot(savedProvider([savedBundle("a","Saved work")]).provider), calls=installSubmission(ui,{prepareSavedPage:()=>prepared});
  await ui.win.TenetProcessUI.openSavedPage("a");await ui.click("report");const report=calls.reports[0];
  assert.equal(report.settings.isCurrent(),true);accountCurrent=false;assert.equal(report.settings.isCurrent(),false);
  assert.throws(report.bundle.assertCurrent,/Saved account changed/);await assert.rejects(report.bundle.getAsset(prepared.attempt.id,"final-page"),/Saved account changed/);
});


test("selecting work collapses the library and the header reopens it without losing the report", async () => {
  const ui=boot(); await ui.import();
  assert.equal(ui.dialog.dataset.library,"closed");
  assert.equal(ui.dialog.querySelector(".tenet-process-sidebar").hidden,true);
  assert.equal(ui.action("library").getAttribute("aria-expanded"),"false");
  const title=ui.value("title").textContent, frame=displayedLabel(ui);
  await ui.click("library");
  assert.equal(ui.dialog.dataset.library,"open");
  assert.equal(ui.dialog.querySelector(".tenet-process-sidebar").hidden,false);
  assert.equal(ui.action("library").getAttribute("aria-controls"),"tenetProcessLibrary");
  assert.equal(ui.value("title").textContent,title);
  await ui.click("library"); assert.equal(displayedLabel(ui),frame);
});

test("saved-page selection moves focus off the collapsed library into the report", async () => {
  const history=savedProvider([savedBundle("one","One saved page")]);
  const ui=savedBoot(history.provider); ui.launch.click(); await settle();
  const button=ui.dialog.querySelector(".tenet-process-saved-pages button"); button.focus(); button.click(); await settle();
  assert.equal(ui.dialog.dataset.library,"closed");
  assert.equal(ui.doc.activeElement,ui.dialog.querySelector(".tenet-process-work"));
  assert.equal(ui.calls.begin,0);
});

test("an empty viewer keeps work selection available and retirement clears the storage readout", async () => {
  const ui=boot(); await settle();
  assert.equal(ui.dialog.dataset.library,"open"); assert.equal(ui.action("library").getAttribute("aria-expanded"),"true");
  await ui.import(); ui.action("close").click();
  for(const name of ["history-size","storage-note","axis-context"]) assert.equal(ui.value(name).textContent,"");
  assert.equal(ui.dialog.dataset.library,"open");
});

test("clock-axis ticks replace bin ordinals and keep elapsed labels and AI inspection", async () => {
  const start=Date.parse("2026-09-15T15:00:00Z"),events=[];
  for(let i=0;i<13;i++) events.push(recorded(i===6?"ai.request":"canvas.commit",i+1,i===6?{localRequestId:"a",question:"A hint?",origin:"quick-help"}:{},[],start+i*60000));
  const ui=boot({bundle:fixtureWith(events),timeZone:"UTC"}); await ui.import();
  const labels=ui.dialog.querySelectorAll(".tenet-process-axis-label").map(item=>item.textContent);
  assert.equal(labels.length,5); assert.match(labels[0],/3:00:00 PM/); assert.match(labels.at(-1),/3:12:00 PM/);
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-bin-label").length,0);
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-elapsed-label").at(-1).textContent,"+12m 0s");
  assert.match(ui.value("axis-context").textContent,/UTC.*elapsed/);
  ui.dialog.querySelector(".tenet-process-ai-star").parentElement.click(); await settle();
  assert.equal(ui.dialog.querySelector(".tenet-process-ai-summary").hidden,false);
  assert.equal(ui.value("ai-question").textContent,"A hint?");
});

test("an unreliable clock keeps recorded order and never fabricates an elapsed graph axis", async () => {
  const ui=boot({bundle:fixtureWith([recorded("canvas.commit",1,{},[],1700000010000),recorded("canvas.commit",2,{},[],1700000000000),{sequence:3,type:"canvas.commit",details:{},assets:[]}])});
  await ui.import();
  assert.match(ui.value("axis-context").textContent,/spacing does not represent elapsed time/);
  assert.equal(ui.dialog.querySelectorAll(".tenet-process-axis-label").at(-1).textContent,"Time unavailable");
  assert.ok(ui.dialog.querySelectorAll(".tenet-process-elapsed-label").every(item=>item.textContent==="Time not comparable"));
  assert.equal(ui.value("recorded-span").textContent,"Unavailable");
});

test("the removed work timeline has no hidden event list while graph and slider still seek", async () => {
  const ui=boot(); await ui.import();
  assert.equal(ui.dialog.querySelector(".tenet-process-events"),null);
  assert.equal(ui.value("timeline-note"),null);
  assert.doesNotMatch(ui.dialog.textContent,/Work timeline/);
  assert.equal(ui.dialog.querySelector(".tenet-process-detail").tagName,"details");
  await seek(ui,1); assert.equal(JSON.parse(ui.value("detail").textContent).sequence,2);
  ui.dialog.querySelectorAll('g[role="button"]')[0].click(); await settle();
  assert.equal(JSON.parse(ui.value("detail").textContent).sequence,1);
});

test("storage totals count event metadata and unique attachments without eagerly loading assets", async () => {
  const first={hash:"shared",mime:"application/octet-stream",size:2048,name:"drawing.pkdrawing"};
  const second={hash:"input",mime:"application/json",size:1024,name:"ai-input.json"};
  const events=[recorded("history.observation",1,{},[first]),recorded("history.observation",2,{},[first,second])];
  let reads=0;const ui=boot({bundle:fixtureWith(events,async()=>{reads++;return null;})});await ui.import();
  const bytes=events.reduce((total,event)=>total+Buffer.byteLength(JSON.stringify(event)),3072);
  assert.equal(ui.value("history-size").textContent,(bytes/1024).toFixed(1)+" KiB");
  assert.match(ui.value("storage-note").textContent,/2 unique recorded attachments: 3.0 KiB/);
  assert.match(ui.value("storage-note").textContent,/not browser memory or the compressed export size/);
  assert.equal(reads,0);
});

test("missing or inconsistent attachment sizes are not represented as a complete size", async () => {
  for(const assets of [[{hash:"missing",mime:"application/octet-stream"}],[{hash:"same",size:1},{hash:"same",size:2}]]) {
    const ui=boot({bundle:fixtureWith([recorded("history.observation",1,{},assets)])});await ui.import();
    assert.equal(ui.value("history-size").textContent,"Incomplete sizes");
    assert.match(ui.value("storage-note").textContent,/complete total cannot be reported/);
  }
});

test("16x and 32x remain selectable and rapid observations keep the existing display floor", async () => {
  const ui=boot({bundle:fixtureWith([recorded("history.observation",1,{},[],1700000000000),recorded("history.observation",2,{},[],1700000000100)])});await ui.import();
  const speed=ui.dialog.querySelector('[data-control="speed"]');
  for(const rate of [16,32]) {
    assert.ok(speed.querySelectorAll("option").some(option=>option.value===String(rate)));
    speed.value=String(rate);speed.fire("change");await settle();
    await ui.click("play"); assert.equal([...ui.timers.values()][0].ms,60);
    await ui.runTimer(60);assert.equal(ui.action("play").textContent,"Play history");
    assert.equal(ui.value("recorded-span").textContent,"<1s");
  }
});
