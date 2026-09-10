'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const ai = fs.readFileSync(path.join(root, 'src/client/app/ai-runtime.js'), 'utf8');
const canvas = fs.readFileSync(path.join(root, 'src/client/app/canvas-runtime.js'), 'utf8');
const selection = fs.readFileSync(path.join(root, 'src/client/app/tenet-selection-tools.js'), 'utf8');
function extract(source, name, indent = '  ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(start >= 0 && end > start, `Missing ${name} test seam`);
  return source.slice(start, end + indent.length + 2);
}
function captureHarness(pixel = [255, 255, 255, 255], failRead = false) {
  const operations = [];
  const q = { fillRect(){}, save(){}, restore(){}, setTransform(){}, beginPath(){}, moveTo(){}, lineTo(){}, closePath(){},
    clip(rule){ operations.push(['clip', rule]); },
    getImageData(){ if (failRead) throw Error('Unreadable image'); return {data:new Uint8ClampedArray(pixel)}; },
  };
  const context = vm.createContext({ SIZE:20000, MAX_ATLAS_WIDTH:2048, MAX_ATLAS_HEIGHT:2048,
    window:{PENECHO_CONFIG:{tenetMode:true}}, performance:{now:()=>0},
    offscreen:(width,height)=>({width,height,getContext:()=>q,toDataURL:()=> 'data:image/png;base64,synthetic'}),
    drawAnimationsToContext(){operations.push(['layer']);}, drawWidgetsToContext(){}, drawImagesToContext(){},
    drawTextBoxesToContext(){}, forTiles(){}, drawSharpOverlays(){},
  });
  vm.runInContext(['tenetRegionGeometry','buildTenetTextQuestion','tenetRenderedQuestionIsBlank','buildTenetRegionImage']
    .map(name=>extract(ai,name)).join('\n'),context);
  return {context,operations};
}
const polygon = [{x:100,y:200},{x:300,y:200},{x:250,y:350}];

test('a question on a verified blank render contains no image or fake image metadata',()=>{
  const {context,operations}=captureHarness();
  const packed=context.buildTenetRegionImage(polygon,'  Help me choose a topic  ');
  assert.equal(packed.questionOnly,true); assert.equal(packed.questionScope,'text-only');
  assert.equal(packed.selectionQuestion,'Help me choose a topic');
  for(const key of ['atlasImage','atlasSize','imageScale','sourceRect','captureRect','selectionContext','hotspotGrid'])
    assert.equal(Object.hasOwn(packed,key),false,key);
  assert.deepEqual(JSON.parse(JSON.stringify(packed.visibleRect)),{x:100,y:200,w:200,h:150});
  assert.deepEqual(operations[0],['clip','evenodd']);
});

test('even faint rendered ink retains the masked image and selection geometry',()=>{
  const {context}=captureHarness([254,254,254,255]);
  const packed=context.buildTenetRegionImage(polygon,'Help with this');
  assert.equal(packed.questionOnly,undefined); assert.match(packed.atlasImage,/^data:image/);
  assert.deepEqual(JSON.parse(JSON.stringify(packed.selectionContext.path)),polygon);
});

test('blankness detection ignores transparent pixels but does not ignore visible marks',()=>{
  const {context}=captureHarness();
  const check=data=>context.tenetRenderedQuestionIsBlank({getImageData:()=>({data})},1,1);
  assert.equal(check([0,0,0,0]),true); assert.equal(check([255,255,255,255]),true);
  assert.equal(check([255,255,254,1]),false);
});

test('capture failure never degrades a question to text-only',()=>{
  const {context}=captureHarness(undefined,true);
  assert.throws(()=>context.buildTenetRegionImage(polygon,'Help with this'),/Unreadable image/);
});

test('a preview without a question does not invent a text-only request',()=>{
  const {context}=captureHarness();const packed=context.buildTenetRegionImage(polygon);
  assert.equal(packed.questionOnly,undefined);assert.equal(packed.selectionQuestion,undefined);
});

test('text-only questions require bounded text and valid page placement',()=>{
  const {context}=captureHarness();const rect={x:10,y:20,w:400,h:300};
  for(const text of ['', ' ', 'x'.repeat(1001), null]) assert.throws(()=>context.buildTenetTextQuestion(text,rect));
  for(const bad of [null,{...rect,x:-1},{...rect,w:0},{...rect,y:NaN},{...rect,x:19999}])
    assert.throws(()=>context.buildTenetTextQuestion('Help me start',bad));
});

test('finger target expansion cannot steal a form, dialog, or lasso touch',()=>{
  const button={disabled:false,isConnected:true,penechoSpec:{kind:'accept'},getBoundingClientRect:()=>({left:10,right:50,top:10,bottom:50,width:40,height:40})};
  let dialogOpen=false, circleOpen=false;
  const context=vm.createContext({usesTouchSizedCanvasTargets:type=>type==='touch',
    objectChromeButtons:new Map([['pending:accept',button]]),COARSE_OBJECT_ACTION_PADDING_PX:20,
    document:{querySelector:()=>dialogOpen?{}:null},tenetCanvasAI:{selectionActive:()=>circleOpen},
  });
  vm.runInContext(extract(canvas,'nearbyCoarseObjectActionButton'),context);
  const event={pointerType:'touch',button:0,clientX:35,clientY:35,target:{closest:()=>null}};
  assert.equal(context.nearbyCoarseObjectActionButton(event),button);
  for(const owned of ['button','dialog','.tenet-ai-circle-surface','.tenet-voice-entry']) {
    event.target={closest:selector=>selector.includes(owned)?{}:null};
    assert.equal(context.nearbyCoarseObjectActionButton(event),null,owned);
  }
  event.target={closest:()=>null};dialogOpen=true;assert.equal(context.nearbyCoarseObjectActionButton(event),null);
  dialogOpen=false;circleOpen=true;assert.equal(context.nearbyCoarseObjectActionButton(event),null);
});

test('lost lasso capture resets drawing before releasing capture, allowing a new gesture',()=>{
  let releases=0;
  const context=vm.createContext({pointer:7,region:{points:polygon.slice()},drawing:true,moveGesture:null,
    surface:{hasPointerCapture:()=>true,releasePointerCapture(){releases++;context.finish(event);}},
    state:{scale:1},tenetRegionGeometry:()=>null,notice:{},paint(){},addPoint(){throw Error('Cancelled gesture must not add a point');},
  });
  const event={pointerId:7,type:'lostpointercapture',preventDefault(){},stopPropagation(){}};
  vm.runInContext(extract(selection,'finish','    '),context);context.finish(event);
  assert.equal(context.pointer,null);assert.equal(context.drawing,false);assert.equal(context.region.points.length,0);
  assert.equal(releases,1);
});

test('graphic controls retain accessible names and a completed circle requires explicit redraw',()=>{
  assert.match(selection,/circle\.setAttribute\("aria-label", "Circle selection"\)/);
  assert.match(selection,/if \(tenetRegionGeometry\(region\.points\)\) return;/);
  assert.match(selection,/lostpointercapture.*pointer !== null/);
});
