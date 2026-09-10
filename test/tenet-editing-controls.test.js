import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const resizeSource = read("src/client/app/tenet-object-resize.js");
const resizeContext = vm.createContext({});
vm.runInContext(resizeSource, resizeContext);
const plain = value => JSON.parse(JSON.stringify(value));
const box = { x:100, y:200, w:400, h:200 };

test("tapped objects expose handles before an edit transaction begins", () => {
  const image = {...box,id:"image-1"};
  const record = {kind:"image",id:image.id,hiding:false};
  const context = vm.createContext({
    snapshotLoadInProgress:false,
    state:{mode:"hand",viewMode:false,pending:null,imageEdit:null,widgetEdit:null,pendingWidget:null},
    handToolbarRecord:() => record,handToolbarObject:() => image,imageBox:item => item,
  });
  vm.runInContext(resizeSource,context);
  assert.equal(context.tenetResizeTargets()[0].item,image);
  record.hiding = true;
  assert.equal(context.tenetResizeTargets().length,0);
});

test("eight DOM handles have independent CSP positioning rules", () => {
  const rules = new Map(), elements = [];
  const image = {...box,id:"image-1"};
  const context = vm.createContext({
    window:{PENECHO_CONFIG:{tenetMode:true},addEventListener(){}},
    document:{body:{},createElement:() => ({setAttribute(){},addEventListener(){},append(element){elements.push(element);},remove(){}})},
    view:{append(){}}, snapshotLoadInProgress:false,
    state:{mode:"hand",viewMode:false,imageEdit:{},pending:null,pendingWidget:null,widgetEdit:null},
    selectedImage:() => image, imageBox:item => item,
    screenObjectBox:item => ({left:item.x,top:item.y,width:item.w,height:item.h}),
    runtimeElementStyle:(element,key) => {
      if (!rules.has(key)) rules.set(key,new Map());
      element.rule = rules.get(key);
      return {setProperty:(name,value) => element.rule.set(name,value)};
    },
  });
  vm.runInContext(resizeSource,context);
  context.tenetSyncResizeHandles();
  assert.equal(elements.length,8);
  assert.equal(rules.size,8);
  const positions = elements.map(element => [element.rule.get("left"),element.rule.get("top")]);
  assert.deepEqual(positions,[["100px","200px"],["300px","200px"],["500px","200px"],["500px","300px"],["500px","400px"],["300px","400px"],["100px","400px"],["100px","300px"]]);
  context.tenetSyncResizeHandles();
  assert.equal(rules.size,8,"repeated frames must reuse the same rules");
});

for (const [edge, point, expected] of [
  ["nw", {x:0,y:150}, {x:0,y:150,w:500,h:250}],
  ["ne", {x:600,y:150}, {x:100,y:150,w:500,h:250}],
  ["sw", {x:0,y:450}, {x:0,y:200,w:500,h:250}],
  ["se", {x:600,y:450}, {x:100,y:200,w:500,h:250}],
  ["n", {x:300,y:250}, {x:100,y:250,w:400,h:150}],
  ["s", {x:300,y:500}, {x:100,y:200,w:400,h:300}],
  ["w", {x:200,y:300}, {x:200,y:200,w:300,h:200}],
  ["e", {x:700,y:300}, {x:100,y:200,w:600,h:200}],
]) {
  test(`resize ${edge} keeps the opposite anchor and the intended aspect behavior`, () => {
    assert.deepEqual(plain(resizeContext.tenetResizeBox(box,point,edge)),expected);
  });
}
test("resize cannot invert objects or leave the finite canvas", () => {
  for (const edge of ["nw","n","ne","e","se","s","sw","w"]) {
    for (const point of [{x:-50000,y:-50000},{x:50000,y:50000},{x:300,y:300}]) {
      const result = resizeContext.tenetResizeBox(box,point,edge);
      assert.ok(result.x >= 0 && result.y >= 0,edge);
      assert.ok(result.x+result.w <= 20000 && result.y+result.h <= 20000,edge);
      assert.ok(result.w >= 80 && result.h >= 80,edge);
      if (edge.length === 2) assert.equal(result.w/result.h,2,edge);
    }
  }
});

const insertSource = read("src/client/app/tenet-ipad-usability.js");
const renderer = insertSource.slice(insertSource.indexOf("  function drawTenetInsertArtwork("),insertSource.indexOf("  function installShapeTools("));
const extraShapes = ["ellipse","right-triangle","diamond","pentagon","hexagon","octagon","star","plus","heart","trapezoid","parallelogram","double-arrow","arc","bracket","cube","cuboid","cylinder","cone","sphere","pyramid","triangular-prism","graph-3d","graph-isometric","graph-polar","graph-numberline"];
for (const shape of extraShapes) {
  test(`local Insert renderer produces bounded ${shape} artwork`, () => {
    const calls = [];
    const drawing = new Proxy({}, {get:(_,name) => (...args) => {
      for (const arg of args) if (typeof arg === "number") assert.ok(Number.isFinite(arg),`${shape}: ${String(name)}`);
      calls.push([name,...args]);
    },set:() => true});
    const context = vm.createContext({ document:{createElement:() => ({width:0,height:0,getContext:() => drawing})} });
    vm.runInContext(renderer,context);
    const canvas = context.drawTenetInsertArtwork(shape,"#17263b",120);
    assert.ok(canvas.width > 0 && canvas.width <= 120);
    assert.ok(canvas.height > 0 && canvas.height <= 120);
    assert.ok(calls.some(([name]) => name === "stroke"));
    if (shape === "graph-3d" || shape === "graph-isometric") {
      const labels = calls.filter(([name]) => name === "fillText").map(([,label]) => label);
      for (const axis of ["x","y","z"]) assert.ok(labels.includes(axis));
    }
  });
}

test("ordinary illustrations save without pretending to be a graph expression", () => {
  const canvasSource = read("src/client/app/canvas-runtime.js");
  const start = canvasSource.indexOf("function imageRecord(");
  const end = canvasSource.indexOf("function imageHistoryState(",start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    Blob, SIZE:20000, MAX_IMAGE_SOURCE_BYTES:20*1024*1024,
    MAX_IMAGE_DIMENSION:8192, MAX_IMAGE_PIXELS:32*1024*1024,
    n:(value,min=0,max=20000) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max,
    state:{nextImageId:1},
  });
  vm.runInContext(canvasSource.slice(start,end),context);
  const image = {x:100,y:200,w:800,h:600,naturalW:800,naturalH:600,
    blob:new Blob(["synthetic fixture"],{type:"image/png"}),image:{width:800,height:600},sourceName:"Synthetic illustration"};
  const record = context.imageRecord(image);
  assert.ok(record);
  assert.equal(Object.hasOwn(record,"plotExpression"),false);
  assert.ok(context.imageRecord(record));
  assert.equal(context.imageRecord({...image,plotExpression:""}),null);
  assert.equal(context.imageRecord({...image,plotExpression:"x*x"}).plotExpression,"x*x");
  const ai = read("src/client/app/ai-runtime.js");
  const commit = ai.slice(ai.indexOf("function addPendingPlotImage("),ai.indexOf("function commitPendingItem("));
  assert.match(commit,/\.\.\.\(expression \? \{ plotExpression:expression \} : \{\}\)/);
});

test("PencilKit hides web-only ink controls without hiding its thickness control", () => {
  const css = read("public/tenet-ipad-usability.css");
  assert.match(insertSource,/classList\.toggle\("tenet-using-pencilkit",\s*nativeInk\)/);
  assert.match(insertSource,/Pencil thickness:/);
  assert.match(css,/tenet-using-pencilkit[^{}]*\.eraser-tool-menu/);
  assert.match(css,/tenet-using-pencilkit[^{}]*\.pen-tool-properties/);
  assert.match(resizeSource,/runtimeElementStyle\(button,/);
  assert.match(resizeSource,/finishObjectChromeGesture\(event\)/);
});
