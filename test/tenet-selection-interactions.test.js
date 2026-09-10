const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/client/app/tenet-selection-tools.js'), 'utf8');
const start = source.indexOf('    function voiceContext()');
const end = source.indexOf('    move.addEventListener', start);
assert(start >= 0 && end > start, 'selection interaction test seam');

function harness(engine = 'web') {
  const original = [{x:10,y:10},{x:110,y:10},{x:110,y:110},{x:10,y:110}];
  const region = {points:original.map(p=>({x:p.x+20,y:p.y+30})),revision:3,generation:5,page:8};
  const state = {userRevision:3,recognitionGeneration:5,snapshotLoadGeneration:8};
  const calls = [], messages = [];
  const context = vm.createContext({region,state,preparing:false,drawing:false,moveGesture:null,
    notice:{textContent:''},paint:()=>{},
    unchanged:value=>value===region && value.revision===state.userRevision && value.generation===state.recognitionGeneration,
    tenetRegionGeometry:points=>points.length>=3 ? {x:10,y:10,w:100,h:100}:null,
    window:{TenetInk:{getStatus:()=>({engine})}},
    tenetInkMessage:message=>messages.push(message),
    captureSelection:points=>{calls.push({kind:'capture',points});state.selection={box:{x:10,y:10,w:100,h:100}};return true;},
    commitSelection:()=>{calls.push({kind:'commit',box:state.selection.box});state.userRevision++;state.selection=null;},
    tenetInkController:{moveRegion:async(points,dx,dy)=>{calls.push({kind:'native',points,dx,dy});state.userRevision++;return {moved:2};}},
  });
  vm.runInContext(source.slice(start,end),context);
  return {context,region,state,original,calls,messages,move:()=>context.finishMove(region,{points:original})};
}

test('selection controls appear after circling, not over the drawing gesture',()=>{
  assert.match(source,/const ready = !drawing && Boolean\(tenetRegionGeometry\(region.points\)\);\s*controls.hidden = !ready/);
  assert.match(source,/view.append\(entry\)/);
  for(const label of ['Move ink','Quick help','Ask AI a question','Talk to Tenet']) assert.ok(source.includes(`makeButton("${label}"`));
});

test('typed circle questions and Quick AI request hints, not direct answers',()=>{
  assert.match(source,/void ask\("hint", input.value.trim\(\)\)/);
  assert.doesNotMatch(source,/ask\("answer"/);
  const quick=source.slice(source.indexOf('    async function quick(action)'),source.indexOf('    function voiceContext()'));
  assert.ok(quick.indexOf('action = "hint"') < quick.indexOf('requestAI(action'));
  assert.match(quick,/scope.value === "page"/);
});

test('Web region movement uses existing selection undo transaction',async()=>{
  const h=harness(); await h.move();
  assert.deepEqual(h.calls.map(c=>c.kind),['capture','commit']);
  assert.equal(h.calls[1].box.x,30); assert.equal(h.calls[1].box.y,40);
  assert.equal(h.calls[1].box.w,100); assert.equal(h.calls[1].box.h,100);
  assert.equal(h.region.revision,4); assert.equal(h.messages.length,0);
});

test('PencilKit movement stays native rather than flattening into Web tiles',async()=>{
  const h=harness('pencilkit'); await h.move();
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].kind,'native');
  assert.equal(h.calls[0].dx,20); assert.equal(h.calls[0].dy,30);
  assert.equal(h.region.revision,4); assert.equal(h.messages.length,0);
});

test('older native binaries and empty native selections retain the original outline',async()=>{
  for(const missing of [true,false]) {
    const h=harness('pencilkit');
    h.context.tenetInkController=missing?{}:{moveRegion:async()=>({moved:0})};
    await h.move();
    assert.deepEqual(h.region.points,h.original);
    assert.equal(h.calls.length,0); assert.equal(h.messages.length,1);
    assert.equal(h.context.preparing,false);
  }
});

test('page or revision changes refuse a stale ink movement',async()=>{
  for(const key of ['snapshotLoadGeneration','userRevision']) {
    const h=harness('pencilkit'); h.state[key]++; await h.move();
    assert.equal(h.calls.length,0); assert.match(h.messages[0],/page changed/);
  }
});

test('voice selection context is copied and refuses incomplete or stale selections',()=>{
  const h=harness(); const copied=h.context.voiceContext();
  assert.notEqual(copied.points,h.region.points);
  copied.points[0].x=999; assert.equal(h.region.points[0].x,30);
  assert.equal(copied.page,8);
  h.context.drawing=true; assert.throws(()=>h.context.voiceContext(),/Finish circling/);
  h.context.drawing=false; h.state.userRevision++;
  assert.throws(()=>h.context.voiceContext(),/Finish circling/);
});
