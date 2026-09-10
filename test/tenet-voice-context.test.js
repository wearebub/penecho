"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../src/server/main.js"),"utf8");
const placement=source.match(/function normalizeCommandPlacements\(commands,payload\)\{[\s\S]*?\n\}/)[0];
const validation=source.slice(source.indexOf("function validPayload(p) {"),source.indexOf("function canonicalPayload(p) {"));
const view={x:9000,y:8500,w:2000,h:1500};
function run(commands,payload={}){
  const context=vm.createContext({TENET_MODE:true,CANVAS_SIZE:20000,commands,payload:{visibleRect:view,captureRect:view,changedBox:view,questionScope:"visible-page",...payload},translateTypesetGroup:()=>[{tool:"lasso-placement"}]});
  return JSON.parse(JSON.stringify(vm.runInContext(placement+";normalizeCommandPlacements(commands,payload)",context)));
}
test("whole-page voice answers stay onscreen instead of being moved beside the whole viewport",()=>{
  const [reply]=run([{tool:"write_text",text:"Identify the known values",fontSize:96,maxWidth:1000,x:11500,y:8500}]);
  assert(reply.x>=view.x && reply.x+reply.maxWidth<=view.x+view.w);
  assert(reply.y>=view.y && reply.y<view.y+view.h);
});
test("voice image and graph replies fit the visible page while preserving aspect ratio",()=>{
  for(const tool of ["draw_image","plot_function"]){
    const [reply]=run([{tool,x:16000,y:16000,w:4000,h:2000}]);
    assert.equal(reply.w/reply.h,2);assert(reply.x+reply.w<=view.x+view.w);assert(reply.y+reply.h<=view.y+view.h);
  }
});
test("regular lasso placement remains unchanged and voice does not relocate destructive tools",()=>{
  assert.deepEqual(run([{tool:"write_text",x:1,y:1}],{questionScope:undefined,selectionContext:{box:view}}),[{tool:"lasso-placement"}]);
  const erase={tool:"erase",x:12000,y:12000,w:100,h:100};assert.deepEqual(run([erase]),[erase]);
});
test("unknown, automatic or mismatched voice context cannot enter the normal payload pipeline",()=>{
  for(const p of [{questionScope:"anything"},{questionScope:"visible-page",trigger:"user_paused",userAction:"auto"},
    {questionScope:"visible-page",trigger:"manual",userAction:"answer",selectionQuestion:"Help",selectionContext:{},visibleRect:view,sourceRect:{...view,x:0}}]){
    const context=vm.createContext({TENET_MODE:true,p,selectionBoxesMatch:(a,b)=>JSON.stringify(a)===JSON.stringify(b)});
    assert.equal(vm.runInContext(validation+";validPayload(p)",context),false);
  }
  assert.match(source,/questionScope:payload|payload\.questionScope === "visible-page"/);
  assert.match(source,/do not answer all the handwriting/);
});
test("visible-page scope survives strict validation and canonicalization",()=>{
  const p={questionScope:"visible-page",trigger:"manual",userAction:"answer",selectionQuestion:"Help me start problem 12",
    selectionContext:{box:view,path:[{x:9000,y:8500},{x:11000,y:8500},{x:11000,y:10000},{x:9000,y:10000}],closed:true},
    visibleRect:view,sourceRect:view,captureRect:view,changedBox:view,canvasSize:{w:20000,h:20000},
    atlasImage:"data:image/png;base64,YQ==",atlasSize:{w:2000,h:1500},imageScale:1,
    hotspotGrid:{columns:8,rows:8,order:"oldest-to-newest",hotspots:[]},uiTheme:"studio",persona:"test"};
  const canonical=source.slice(source.indexOf("function canonicalPayload(p) {"),source.indexOf("function imageDataUrlParts(dataUrl) {"));
  const context=vm.createContext({p,TENET_MODE:true,CANVAS_SIZE:20000,THEME_PERSONAS:{studio:"test"},DEBUG_ACTIONS:new Set(["answer"]),
    validTypedInput:()=>true,validSelectionContext:()=>true,selectionBox:x=>x,canonicalSelectionContext:x=>x,
    selectionBoxesMatch:(a,b)=>JSON.stringify(a)===JSON.stringify(b),canonicalWidgetEdit:()=>null,
    validSelectionQuestion:require("../src/server/tenet-illustration.js").validSelectionQuestion});
  assert.equal(vm.runInContext(validation+";validPayload(p)",context),true);
  assert.equal(vm.runInContext(canonical+";canonicalPayload(p).questionScope",context),"visible-page");
});
