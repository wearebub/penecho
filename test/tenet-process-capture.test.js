'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/client/app/tenet-process-capture.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const options = { timeout:3000 };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); }
function target() {
  const listeners = new Map();
  return { listeners,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); return true; } };
}
class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }

function harness(settings = {}) {
  const events = [], writes = [], marks = [], statuses = [], reads = [], rendered = [], attempts = new Map(), timers = new Map();
  let timerId = 0;
  const controls = { onAppend:null, onRender:null, native:null, nativeBusy:false, ...settings.controls };
  const journal = settings.journal || {
    async createAttempt(metadata) {
      const attempt = { id:'attempt-' + (attempts.size + 1), ...metadata, status:'recording', eventCount:0, incomplete:false };
      attempts.set(attempt.id, attempt); return { ...attempt };
    },
    async append(id, event) {
      writes.push({ id, type:event.type });
      if (controls.onAppend) await controls.onAppend(id, event);
      const attempt = attempts.get(id);
      if (attempt.status !== 'recording') throw Error('This history is not recording.');
      assert.ok(Buffer.byteLength(JSON.stringify(event.details || {})) <= 12 * 1024, 'Production journal details bound');
      const record = { ...event, attemptId:id, sequence:++attempt.eventCount };
      events.push(record); return record;
    },
    async readAttempt(id) { reads.push(id); return { ...attempts.get(id) }; },
    async pauseAttempt(id) { const attempt = attempts.get(id); if (attempt.status === 'frozen') throw Error('Frozen'); attempt.status = 'paused'; return { ...attempt }; },
    async resumeAttempt(id) { const attempt = attempts.get(id); assert.equal(attempt.status, 'paused'); attempt.status = 'recording'; return { ...attempt }; },
    async markIncomplete(id, reason) { marks.push({ id, reason }); attempts.get(id).incomplete = true; },
    listAttempts() { assert.fail('Capture must not enumerate other attempts'); },
    listEvents() { assert.fail('Capture must not read unrelated history'); },
    getAsset() { assert.fail('Capture must not fetch unrelated assets'); },
  };
  const window = { ...target(), crypto:webcrypto, PENECHO_CONFIG:settings.config || { tenetMode:true, tenetAssignmentPreview:true }, TenetProcessJournal:journal };
  window.addEventListener('tenet:process-status', event => statuses.push(plain(event.detail)));
  const document = { ...target(), hidden:false };
  const state = { snapshotLoadGeneration:1, currentSnapshotId:'page-a', currentSnapshotLocation:'device', userRevision:0,
    busy:false, activeAI:null, drawing:null, areaEraseGesture:null, historyBefore:new Map(),
    animationHistoryBefore:null, widgetHistoryBefore:null, imageHistoryBefore:null, textBoxHistoryBefore:null,
    tenetNativeHistoryBefore:undefined };
  const context = vm.createContext({
    window, document, state, crypto:webcrypto, Blob, TextEncoder, Uint8Array, atob, CustomEvent,
    aiPreparation:null, snapshotLoadInProgress:false, snapshotSaveInProgress:false,
    hasUnsettledToolbox:() => false,
    tenetInkController:{ snapshot:() => controls.native, active:() => controls.nativeBusy },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async renderExportCanvas(renderOptions) {
      if (!renderOptions.isCurrent()) throw Error('Stale render');
      const pageId = state.currentSnapshotId, revision = state.userRevision;
      if (controls.onRender) await controls.onRender(renderOptions);
      if (!renderOptions.isCurrent()) throw Error('Stale render');
      rendered.push({ pageId, revision, maxDimension:renderOptions.maxDimension, maxPixels:renderOptions.maxPixels });
      return { width:640, height:480, pageId, revision };
    },
    async canvasBlob(canvas) { return new Blob([canvas.pageId + ':' + canvas.revision], { type:'image/png' }); },
    fetch() { assert.fail('Capture must not use network transport'); },
  });
  vm.runInContext(source, context, { filename:'tenet-process-capture.js' });
  return { api:window.TenetProcessCapture, window, document, state, context, journal, controls,
    events, writes, marks, statuses, reads, rendered, attempts, timers,
    begin:() => window.TenetProcessCapture.begin({ title:'Synthetic assignment', subject:'Math' }),
    signal:type => window.dispatchEvent(new CustomEvent(type)),
  };
}

test('capture is default-off and installs no drawing, account or navigation listeners in the scratch demo', options, () => {
  for (const config of [{}, { tenetMode:true }, { tenetMode:true, tenetAssignmentPreview:false },
    { tenetMode:false, tenetAssignmentPreview:true }, { tenetMode:true, tenetAssignmentPreview:'true' }]) {
    const h = harness({ config });
    assert.equal(h.api, undefined); assert.equal(h.window.listeners.size, 1); assert.equal(h.document.listeners.size, 0);
    assert.equal(h.reads.length, 0); assert.equal(h.timers.size, 0);
  }
});

test('begin requires idle drawing and AI, without creating a partial attempt', options, async () => {
  for (const field of ['drawing', 'busy', 'activeAI', 'areaEraseGesture']) {
    const h = harness(); h.state[field] = true;
    await assert.rejects(h.begin(), /Finish drawing/);
    assert.equal(h.attempts.size, 0);
  }
  const h = harness(); h.controls.nativeBusy = true;
  await assert.rejects(h.begin(), /Finish drawing/);
});

test('begin returns an unconfigured recording attempt with bounded baseline and optional native archive', options, async () => {
  const h = harness();
  h.controls.native = { drawingData:Buffer.from('synthetic PKDrawing').toString('base64'), strokeCount:3 };
  const attempt = await h.begin();
  assert.equal(attempt.phase, 'unconfigured'); assert.equal(attempt.status, 'recording'); assert.equal(h.api.activeId(), attempt.id);
  const baseline = h.events.find(event => event.type === 'canvas.checkpoint');
  assert.equal(baseline.details.label, 'baseline'); assert.equal(baseline.details.everyStroke, false);
  assert.equal(baseline.details.nativeArchiveIncluded, true);
  assert.equal(await baseline.assets.find(asset => asset.name === 'drawing.pkdrawing').blob.text(), 'synthetic PKDrawing');
  assert.deepEqual(h.rendered, [{ pageId:'page-a', revision:0, maxDimension:2048, maxPixels:4 * 1024 * 1024 }]);
  await h.api.pause();
});

test('baseline is pinned before an awaited initial append; intervening edits become a gap, not a new baseline', options, async () => {
  const entered = deferred(), release = deferred(), h = harness();
  h.controls.onAppend = async (_id, event) => { if (event.type === 'capture.started') { entered.resolve(); await release.promise; } };
  const begin = h.begin();
  await entered.promise;
  h.state.userRevision++; h.api.commit({ tiles:[{}] });
  release.resolve();
  await begin; await h.api.flush();
  assert.equal(h.events.filter(event => event.type === 'canvas.checkpoint' && event.details.label === 'baseline').length, 0);
  const gap = h.events.find(event => event.type === 'coverage.gap' && event.details.requestedCheckpoint === 'baseline');
  assert.ok(gap); assert.equal(gap.details.userRevision, 0); assert.equal(gap.details.reason, 'page-revision-or-input-changed');
  assert.ok(h.marks.length); await h.api.pause();
});

test('resume baseline has the same initial-stamp protection as begin', options, async () => {
  const h = harness(), attempt = await h.begin(); await h.api.pause();
  const entered = deferred(), release = deferred();
  h.controls.onAppend = async (_id, event) => { if (event.type === 'capture.resumed') { entered.resolve(); await release.promise; } };
  const resumed = h.api.resume(attempt.id); await entered.promise;
  h.state.userRevision++; h.api.commit({ tiles:[{}] }); release.resolve();
  await resumed; await h.api.flush();
  assert.equal(h.events.filter(event => event.type === 'canvas.checkpoint' && event.details.label === 'resume-baseline').length, 0);
  assert.ok(h.events.some(event => event.type === 'coverage.gap' && event.details.requestedCheckpoint === 'resume-baseline'));
  await h.api.pause();
});

test('a checkpoint append failure stops capture and is never retried or mislabeled as a rendering gap', options, async () => {
  const h = harness();
  h.controls.onAppend = async (_id, event) => { if (event.type === 'canvas.checkpoint') throw Error('Synthetic quota failure'); };
  await assert.rejects(h.begin(), /quota failure/);
  await assert.rejects(h.api.pause(), /quota failure/);
  assert.equal(h.api.isRecording(), false);
  assert.equal(h.writes.filter(write => write.type === 'canvas.checkpoint').length, 1);
  assert.equal(h.writes.filter(write => write.type === 'coverage.gap').length, 0);
  assert.ok(h.marks.some(mark => mark.reason === 'storage-write-unconfirmed'));
  assert.equal(h.statuses.some(status => /render-or-attachment/.test(status.error || '')), false);
});

test('read-only renderer failure marks a coverage gap but does not stop ordinary edits', options, async () => {
  const h = harness(); h.controls.onRender = async () => { throw Error('Synthetic renderer failure'); };
  await h.begin();
  assert.equal(h.api.isRecording(), true);
  assert.ok(h.events.some(event => event.type === 'coverage.gap' && event.details.reason === 'checkpoint-render-or-attachment-failed'));
  h.controls.onRender = null; h.state.userRevision++; h.api.commit({ tiles:[{}] });
  await h.api.flush();
  assert.ok(h.events.some(event => event.type === 'canvas.commit'));
  assert.ok(h.events.some(event => event.type === 'canvas.checkpoint'));
  await h.api.pause();
});

test('pause drains accepted descriptors and resolves only after durable paused state, rejecting later records', options, async () => {
  const h = harness(), attempt = await h.begin(), entered = deferred(), release = deferred();
  h.controls.onAppend = async (_id, event) => { if (event.type === 'canvas.commit') { entered.resolve(); await release.promise; } };
  h.state.userRevision++; h.api.commit({ tiles:[{}] }); await entered.promise;
  let resolved = false;
  const paused = h.api.pause().then(value => { resolved = true; return value; });
  await settle(); assert.equal(resolved, false); assert.equal(h.attempts.get(attempt.id).status, 'recording');
  release.resolve(); const stored = await paused;
  assert.equal(stored.status, 'paused'); assert.equal(h.attempts.get(attempt.id).status, 'paused');
  const count = h.events.length; h.api.commit({ tiles:[{}] }); h.api.nativeRevision({ revision:2, strokeCount:4 });
  await h.api.flush(); assert.equal(h.events.length, count);
  assert.ok(h.events.findIndex(event => event.type === 'canvas.commit') < h.events.findIndex(event => event.type === 'coverage.boundary'));
});

test('pause rejects if storage cannot confirm the paused state', options, async () => {
  const h = harness(); await h.begin();
  h.journal.pauseAttempt = async () => { throw Error('Synthetic pause storage failure'); };
  await assert.rejects(h.api.pause(), /not paused/);
  assert.equal(h.api.isRecording(), false);
  assert.ok(h.statuses.some(status => /pause storage failure/.test(status.error || '')));
});

test('a page transition during rendering cannot capture the next page or accept late AI response text', options, async () => {
  const h = harness(); await h.begin();
  const token = h.api.aiRequested({ action:'hint', revision:0, packed:{ selectionQuestion:'Question on page A' } });
  const entered = deferred(), release = deferred();
  h.controls.onRender = async () => { entered.resolve(); await release.promise; };
  const checkpoint = h.api.checkpoint('before-navigation'); await entered.promise;
  h.api.boundary('snapshot-load-transition');
  h.state.currentSnapshotId = 'private-page-b'; h.state.snapshotLoadGeneration++;
  h.api.commit({ tiles:[{}] });
  h.api.aiResponse(token, { commands:[{ tool:'write_text', text:'UNOBSERVED PRIVATE RESPONSE' }] });
  release.resolve(); await checkpoint; await h.api.flush();
  assert.equal(h.api.isRecording(), false);
  assert.ok(h.rendered.every(frame => frame.pageId === 'page-a'));
  assert.equal(JSON.stringify(h.events).includes('private-page-b'), false);
  assert.equal(JSON.stringify(h.events).includes('UNOBSERVED PRIVATE RESPONSE'), false);
  assert.ok(h.reads.every(id => id === 'attempt-1'));
  await assert.rejects(h.api.resume('attempt-1'), /same opted-in page/);
});

test('identity and generation mismatches independently stop capture without reading unrelated attempts', options, async () => {
  for (const change of [h => { h.state.currentSnapshotId = 'other-page'; }, h => { h.state.snapshotLoadGeneration++; }]) {
    const h = harness(); await h.begin(); change(h); h.api.commit({ tiles:[{}] }); await h.api.flush();
    assert.equal(h.api.isRecording(), false);
    assert.equal(h.events.filter(event => event.type === 'canvas.commit').length, 0);
    assert.ok(h.reads.every(id => id === 'attempt-1'));
  }
});

test('sign-out clears active capture and rejects late callbacks from the prior account', options, async () => {
  const h = harness(); await h.begin();
  const token = h.api.aiRequested({ action:'hint', packed:{ selectionQuestion:'Before sign-out' } });
  h.signal('tenet:sign-out'); assert.equal(h.api.activeId(), null); assert.equal(h.api.isRecording(), false);
  h.api.aiResponse(token, { commands:[{ tool:'write_text', text:'LATE ACCOUNT RESPONSE' }] });
  h.api.aiFinished(token, 'completed'); h.api.commit({ tiles:[{}] });
  await h.api.flush();
  assert.equal(JSON.stringify(h.events).includes('LATE ACCOUNT RESPONSE'), false);
  assert.equal(h.statuses.at(-1).attemptId, null);
  assert.ok(h.events.some(event => event.type === 'coverage.boundary' && event.details.reason === 'sign-out'));
});

test('pagehide and reload never auto-resume journal records', options, async () => {
  const h = harness(); await h.begin(); h.signal('pagehide'); await h.api.flush();
  assert.equal(h.api.isRecording(), false);
  const previousReads = h.reads.length, next = harness({ journal:h.journal });
  assert.equal(next.api.activeId(), null); assert.equal(next.api.isRecording(), false);
  assert.equal(h.reads.length, previousReads); assert.equal(next.rendered.length, 0);
  await assert.rejects(next.api.resume('attempt-1'), /same opted-in page/);
});

test('AI capture preserves observed hint/question/status but not crop bytes, transport headers or provider claims', options, async () => {
  const h = harness(); await h.begin();
  const token = h.api.aiRequested({ action:'hint', revision:0, packed:{ selectionQuestion:'A synthetic question',
    atlasImage:'PRIVATE_IMAGE_BYTES', headers:{ Authorization:'PRIVATE_TOKEN' },
    selectionContext:{ closed:true, path:[{ x:1, y:1 }, { x:4, y:1 }, { x:4, y:4 }] }, sourceRect:{ x:1, y:1, w:3, h:3 } } });
  h.api.aiResponse(token, { requestId:'local-observed-server-id', commands:[{ tool:'write_text', text:'What is your first step?' }] });
  h.api.aiFinished(token, 'completed'); await h.api.flush();
  const event = h.events.find(item => item.type === 'ai.request');
  assert.equal(event.details.action, 'hint'); assert.equal(event.details.context.scope, 'selection');
  assert.equal(event.details.context.exactGatewayEvidence, false);
  assert.equal(event.details.serverVerified, false);
  assert.equal(JSON.stringify(h.events).includes('PRIVATE_IMAGE_BYTES'), false);
  assert.equal(JSON.stringify(h.events).includes('PRIVATE_TOKEN'), false);
  assert.equal(h.events.find(item => item.type === 'ai.response').details.committedToPage, false);
  await h.api.pause();
});

test('oversized escaped response details become a bounded JSON attachment', options, async () => {
  const h = harness(); await h.begin();
  const token = h.api.aiRequested({ action:'hint', packed:{} });
  h.api.aiResponse(token, { commands:[{ tool:'write_text', text:'\0'.repeat(7000) }] });
  h.api.aiFinished(token, 'completed'); await h.api.flush();
  const event = h.events.find(item => item.type === 'ai.response');
  assert.equal(event.details.detailsAttachment, 'details.json');
  assert.ok(Buffer.byteLength(JSON.stringify(event.details)) <= 12 * 1024);
  assert.equal(JSON.parse(await event.assets[0].blob.text()).text.length, 7000);
  await h.api.pause();
});

test('bounded queue overflow stops capture, records an incomplete boundary and does not grow indefinitely', options, async () => {
  const h = harness(); await h.begin();
  const entered = deferred(), release = deferred(); let held = false;
  h.controls.onAppend = async (_id, event) => { if (event.type === 'canvas.commit' && !held) { held = true; entered.resolve(); await release.promise; } };
  h.api.commit({ tiles:[{}] }); await entered.promise;
  for (let index = 0; index < 100; index++) { h.state.userRevision++; h.api.commit({ tiles:[{}] }); }
  assert.equal(h.api.isRecording(), false);
  release.resolve(); await h.api.pause();
  assert.ok(h.events.length < 40);
  assert.ok(h.marks.some(mark => mark.reason === 'queue-overflow'));
  assert.ok(h.events.some(event => event.type === 'coverage.boundary' && event.details.reason === 'queue-overflow'));
  assert.equal(h.timers.size, 0);
});

test('native status and viewport events are not edit records; accepted revisions are explicitly coalesced', options, async () => {
  const h = harness(); await h.begin(); const before = h.events.length;
  h.window.dispatchEvent(new CustomEvent('tenet:ink-status', { detail:{ engine:'pencilkit', busy:false } }));
  h.signal('resize'); await h.api.flush(); assert.equal(h.events.length, before);
  h.controls.native = { drawingData:Buffer.from('new native archive').toString('base64'), strokeCount:2 };
  h.state.userRevision++; h.api.nativeRevision({ revision:4, strokeCount:2, changedBounds:{ x:1, y:2, w:3, h:4 } });
  await h.api.flush();
  const event = h.events.find(item => item.type === 'native.revision');
  assert.equal(event.details.granularity, 'accepted-PKDrawing-revision-not-individual-stroke');
  assert.equal(event.details.changedBoundsAreConservative, true);
  await h.api.pause();
});
