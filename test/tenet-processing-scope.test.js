'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const aiSource = fs.readFileSync(path.join(ROOT, 'src/client/app/ai-runtime.js'), 'utf8').replace(/\r\n/g, '\n');
const coreSource = fs.readFileSync(path.join(ROOT, 'src/client/app/core.js'), 'utf8').replace(/\r\n/g, '\n');
const summonSource = fs.readFileSync(path.join(ROOT, 'public/summon.js'), 'utf8');
const CONCAVE = [
  { x:100, y:100 }, { x:220, y:100 }, { x:220, y:140 },
  { x:140, y:140 }, { x:140, y:220 }, { x:100, y:220 }
];
const plain = value => JSON.parse(JSON.stringify(value));

function functionSource(source, name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'Missing function: ' + name);
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start, 'Missing function boundary: ' + name);
  return source.slice(start, end + 4);
}

function requestHarness() {
  const state = {
    busy:true, snapshotLoadGeneration:3, userRevision:7, recognitionGeneration:11,
    dirty:{ x:1200, y:900, w:80, h:60 }, lastUserBox:{ x:1800, y:1700, w:20, h:20 },
    hotspotTrail:[], aiColor:'#526ff1', timer:0
  };
  const context = vm.createContext({
    state, SIZE:4096, AbortController, window:{PENECHO_CONFIG:{tenetMode:true}},
    aiPreparation:null, aiPreparationGeneration:1
  });
  vm.runInContext(
    functionSource(aiSource, 'tenetRegionGeometry') + '\n' +
    functionSource(aiSource, 'createAIProcessingScope'),
    context
  );
  const preparation = { controller:new AbortController(), generation:1, superseded:false };
  context.aiPreparation = preparation;
  const packed = {
    atlasImage:'unchanged-masked-atlas',
    selectionContext:{ box:{ x:0, y:0, w:4000, h:4000 }, path:plain(CONCAVE), closed:true }
  };
  const scope = context.createAIProcessingScope(packed, preparation);
  preparation.processingScope = scope;
  return { state, context, preparation, packed, scope };
}

function rendererHarness() {
  const frames = new Map(), clips = [], strokes = [], transforms = [];
  let clock = 0, sequence = 0, currentPath = [], currentClip = null;
  const stack = [];
  const ctx = {
    save() { stack.push(currentClip); },
    restore() { currentClip = stack.pop(); },
    beginPath() { currentPath = []; },
    moveTo(x, y) { currentPath.push({ x, y }); },
    lineTo(x, y) { currentPath.push({ x, y }); },
    closePath() {},
    clip(rule) {
      currentClip = rule;
      clips.push({ rule, points:plain(currentPath) });
    },
    stroke() { strokes.push({ clip:currentClip, points:plain(currentPath) }); },
    setTransform(...values) { transforms.push(values); },
    clearRect() {}
  };
  function element() {
    return {
      textContent:'', children:[], className:'',
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); }
    };
  }
  const canvas = { width:0, height:0, hidden:true, dataset:{}, getContext:() => ctx };
  const textLayer = element();
  const transform = { scale:1, panX:0, panY:0, width:800, height:600, dpr:1 };
  const context = vm.createContext({
    module:{ exports:{} },
    performance:{ now:() => clock },
    document:{ createElement:element },
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  vm.runInContext(summonSource, context);
  const api = context.module.exports;
  const effect = api.create({
    fxCanvas:canvas, textLayer, t:() => 'Understanding the selected work',
    getTransform:() => transform, getReducedMotion:() => true,
    styleFor:() => ({ setProperty() {} })
  });
  function tick(milliseconds = 16) {
    clock += milliseconds;
    const next = frames.entries().next().value;
    assert.ok(next, 'Expected a pending render frame');
    frames.delete(next[0]);
    next[1]();
  }
  return { api, effect, canvas, frames, clips, strokes, transforms, transform, tick };
}

test('processing scope copies the exact concave path, derives its bounds, and leaves the payload unchanged', () => {
  const instance = requestHarness();
  assert.deepEqual(plain(instance.scope.path), CONCAVE);
  assert.deepEqual(plain(instance.scope.box), { x:100, y:100, w:120, h:120 });
  assert.equal(instance.scope.closed, true);
  assert.equal(instance.scope.isCurrent(), true);
  assert.equal(Object.isFrozen(instance.scope), true);
  assert.equal(Object.isFrozen(instance.scope.path), true);
  assert.equal(Object.isFrozen(instance.scope.path[0]), true);
  assert.equal(instance.packed.atlasImage, 'unchanged-masked-atlas');
  assert.equal(instance.packed.selectionContext.box.w, 4000, 'Visual validation must not rewrite transport');
  instance.packed.selectionContext.path[0].x = 999;
  assert.equal(instance.scope.path[0].x, 100);
});

test('scoped invalid geometry is distinguished from ordinary requests and never borrows dirty bounds', () => {
  const instance = requestHarness();
  assert.equal(instance.context.createAIProcessingScope({ atlasImage:'ordinary' }, instance.preparation), null);
  for (const selectionContext of [
    null,
    { closed:false, path:CONCAVE },
    { closed:true, path:CONCAVE.slice(0, 2) },
    { closed:true, path:[...CONCAVE, { x:Infinity, y:10 }] },
    { closed:true, path:[...CONCAVE, { x:-1, y:10 }] },
    { closed:true, path:[...CONCAVE, { x:4097, y:10 }] },
    { closed:true, path:Array.from({ length:513 }, (_, index) => ({ x:index, y:index % 2 })) }
  ]) {
    const scope = instance.context.createAIProcessingScope({ selectionContext }, instance.preparation);
    assert.ok(scope, 'An explicit invalid selection must suppress the fallback visual');
    assert.equal(scope.box, null);
    assert.equal(scope.closed, false);
    assert.equal(scope.path.length, 0);
  }
});

test('request preparation publishes the polygon before busy rendering despite unrelated recent ink', async () => {
  const instance = requestHarness();
  const originalPayload = JSON.stringify(instance.packed);
  const seen = [];
  Object.assign(instance.context, {
    tenetInkFlush:async () => {},
    tenetInkMessage:message => assert.fail(message),
    clearTimeout() {},
    clearWidgetRefineCandidate() {},
    setStatusKey() {},
    setBusy(value, processingScope) {
      instance.state.busy = Boolean(value);
      seen.push({
        processingScope, anchor:plain(instance.state.summonAnchor),
        owner:instance.context.aiPreparation,
        current:processingScope?.isCurrent()
      });
    }
  });
  // Execute the production preparation prefix through its busy transition only.
  const start = aiSource.indexOf('  async function requestAI(');
  const marker = '    setStatusKey("aiPreparingCanvas");';
  const end = aiSource.indexOf(marker, start);
  assert.ok(start >= 0 && end > start);
  const preparationOnly = aiSource.slice(start, end + marker.length) + '\n    return preparation;\n  }';
  vm.runInContext(preparationOnly, instance.context);
  const preparation = await instance.context.requestAI('hint', instance.packed, { isolatedSelection:true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].processingScope, preparation.processingScope);
  assert.equal(seen[0].owner, preparation);
  assert.equal(seen[0].current, true);
  assert.deepEqual(seen[0].anchor, { x:100, y:100, w:120, h:120 });
  assert.notDeepEqual(seen[0].anchor, instance.state.dirty);
  assert.equal(JSON.stringify(instance.packed), originalPayload);
  assert.match(aiSource, /processingScope: preparation\.processingScope/);
});

test('core forwards the request scope and does not substitute a dirty anchor for stale scope', () => {
  const instance = requestHarness();
  const shown = [], hidden = [];
  const context = vm.createContext({
    state:{ summonEnabled:true, summonAnchor:instance.state.dirty },
    summonProcessingScope:instance.scope,
    summonFX:{ show:(...args) => shown.push(args), hide:() => hidden.push(true) }
  });
  vm.runInContext(functionSource(coreSource, 'showSummon') + '\n' + functionSource(coreSource, 'hideSummon'), context);
  context.showSummon();
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], instance.scope.box);
  assert.equal(shown[0][1].scope, instance.scope);
  instance.preparation.controller.abort();
  context.showSummon();
  assert.equal(shown.length, 1);
  assert.equal(hidden.length, 1);
  const busy = functionSource(coreSource, 'setBusy');
  assert.match(busy, /summonProcessingScope = state\.busy \? processingScope : null/);
});

test('concave selection rendering traces the exact polygon inside an even-odd clip', () => {
  const request = requestHarness(), renderer = rendererHarness();
  assert.equal(renderer.effect.show(request.scope.box, { scope:request.scope }), true);
  renderer.tick();
  assert.deepEqual(renderer.clips, [{ rule:'evenodd', points:CONCAVE }]);
  assert.deepEqual(renderer.strokes[0].points, CONCAVE);
  assert.ok(renderer.strokes.every(stroke => stroke.clip === 'evenodd'));
  const layout = renderer.api.scopeLayout({ box:request.scope.box }, renderer.transform);
  assert.deepEqual(plain(layout.source), { x:100, y:100, w:120, h:120 });
  assert.equal(Object.hasOwn(layout, 'outer'), false, 'Polygon visuals have no padded outer contour');
});

test('pan and zoom project each lasso vertex once while DPR scales only the drawing context', () => {
  const request = requestHarness(), renderer = rendererHarness();
  Object.assign(renderer.transform, { scale:2, panX:30, panY:-15, dpr:2 });
  renderer.effect.show(request.scope.box, { scope:request.scope });
  renderer.tick();
  const projected = CONCAVE.map(point => ({ x:point.x * 2 + 30, y:point.y * 2 - 15 }));
  assert.deepEqual(renderer.clips[0].points, projected);
  assert.ok(renderer.transforms.some(values => JSON.stringify(values) === '[2,0,0,2,0,0]'));
  assert.equal(renderer.canvas.width, 1600);
  assert.equal(renderer.canvas.height, 1200);
});

test('offscreen vertices remain geometrically exact instead of becoming a viewport fallback contour', () => {
  const request = requestHarness(), renderer = rendererHarness();
  Object.assign(renderer.transform, { panX:-500, panY:-500 });
  renderer.effect.show(request.scope.box, { scope:request.scope });
  renderer.tick();
  assert.deepEqual(renderer.clips[0].points, CONCAVE.map(point => ({ x:point.x - 500, y:point.y - 500 })));
  const projected = renderer.api.projectScope(request.scope, renderer.transform);
  assert.equal(renderer.api.scopeLayout(projected, renderer.transform).fallback, false);
});

test('invalid polygon input clears an earlier effect without inventing a rectangle highlight', () => {
  const renderer = rendererHarness();
  renderer.effect.show({ x:100, y:100, w:120, h:120 });
  assert.equal(renderer.effect.active, true);
  assert.equal(renderer.effect.show({ x:100, y:100, w:120, h:120 }, {
    scope:{ closed:true, path:[{ x:NaN, y:20 }, { x:30, y:40 }, { x:50, y:60 }] }
  }), false);
  assert.equal(renderer.effect.active, false);
  assert.equal(renderer.canvas.hidden, true);
  assert.equal(renderer.frames.size, 0);
});

test('scope ownership survives promotion from preparation into its active request', () => {
  const instance = requestHarness();
  instance.state.activeAI = { processingScope:instance.scope, superseded:false };
  instance.context.aiPreparation = null;
  assert.equal(instance.scope.isCurrent(), true);
  instance.state.activeAI.superseded = true;
  assert.equal(instance.scope.isCurrent(), false);
});

test('abort, supersession, page changes, and stale revisions stop scoped rendering before another paint', () => {
  for (const invalidate of [
    instance => instance.preparation.controller.abort(),
    instance => { instance.preparation.superseded = true; },
    instance => { instance.context.aiPreparationGeneration += 1; },
    instance => { instance.context.aiPreparation = null; },
    instance => { instance.state.snapshotLoadGeneration += 1; },
    instance => { instance.state.userRevision += 1; },
    instance => { instance.state.recognitionGeneration += 1; },
    instance => { instance.state.busy = false; }
  ]) {
    const instance = requestHarness(), renderer = rendererHarness();
    renderer.effect.show(instance.scope.box, { scope:instance.scope });
    renderer.tick();
    const paints = renderer.clips.length;
    invalidate(instance);
    renderer.tick();
    assert.equal(renderer.effect.active, false);
    assert.equal(renderer.canvas.hidden, true);
    assert.equal(renderer.frames.size, 0);
    assert.equal(renderer.clips.length, paints);
  }
});

test('scoped hide clears immediately and a new request replaces the old polygon', () => {
  const first = requestHarness(), renderer = rendererHarness();
  renderer.effect.show(first.scope.box, { scope:first.scope });
  renderer.tick();
  renderer.effect.hide();
  assert.equal(renderer.effect.active, false);
  assert.equal(renderer.frames.size, 0);
  const second = requestHarness();
  second.packed.selectionContext.path = CONCAVE.map(point => ({ x:point.x + 300, y:point.y }));
  const nextScope = second.context.createAIProcessingScope(second.packed, second.preparation);
  second.preparation.processingScope = nextScope;
  renderer.effect.show(nextScope.box, { scope:nextScope });
  first.preparation.controller.abort();
  renderer.tick();
  assert.equal(renderer.effect.active, true);
  assert.deepEqual(renderer.clips.at(-1).points, plain(nextScope.path));
});

test('ordinary requests retain padded spatial-echo contours and the existing fade-out', () => {
  const renderer = rendererHarness();
  const region = { x:100, y:100, w:120, h:120 };
  const layout = renderer.api.echoLayout(region, renderer.transform);
  assert.ok(layout.outer.w > region.w);
  assert.ok(layout.outer.h > region.h);
  renderer.effect.show(region);
  renderer.tick();
  assert.equal(renderer.effect.type, 'spatial-echo');
  assert.equal(renderer.clips.length, 0);
  assert.equal(renderer.strokes[0].points.length, renderer.api.THINKING_LAYOUT.samples);
  renderer.effect.hide();
  assert.equal(renderer.effect.active, true);
  renderer.tick(400);
  assert.equal(renderer.effect.active, false);
});
