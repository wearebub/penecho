"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname,"../src/client/app/tenet-voice.js"),"utf8");
const instrumented = source.replace("  function launch()", "  globalThis.voiceTest = {activate,open,submit,cancel,finish,capture, current, get ui(){return ui}, get job(){return job}, get phase(){return phase}};\n  function launch()");
assert.notEqual(instrumented, source);
class Element extends EventTarget {
  constructor() { super(); this.value=""; this.hidden=false; this.open=false; this.checked=false; this.children=new Map(); }
  querySelector(key) { if(!this.children.has(key)) this.children.set(key,new Element()); return this.children.get(key); }
  setAttribute() {} removeAttribute(key) { delete this[key]; } append() {} prepend() {} remove() {} focus() {} blur() {}
  showModal() { this.open=true; } close() { this.open=false; }
}
function harness(overrides={}) {
  const events=new Map(), calls=[], timers=new Map(), storage=new Map();
  let timer=0;
  const native={
    async getVoiceCapabilities(){return {supported:true,onDevice:true,locale:"en-US"};},
    async addListener(name,fn){events.set(name,fn);return {async remove(){events.delete(name);}};},
    async startVoiceRecognition(value){calls.push(["start",value]);},
    async stopVoiceRecognition(value){calls.push(["stop",value]);return {text:"Help me start problem 12"};},
    async cancelVoiceRecognition(value){calls.push(["cancel",value]);},
    async speakVoice(value){calls.push(["speak",value]);events.get("voicePlayback")?.({state:"speaking"});},
    async stopSpeaking(){calls.push(["quiet"]);}, ...overrides,
  };
  const document=Object.assign(new Element(),{readyState:"loading",hidden:false,head:new Element(),body:new Element(),activeElement:new Element(),createElement:()=>new Element()});
  const window=Object.assign(new EventTarget(),{PENECHO_CONFIG:{tenetMode:true},Capacitor:{getPlatform:()=>"ios",Plugins:{TenetNative:native}}});
  const state={snapshotLoadGeneration:1,userRevision:2,recognitionGeneration:3};
  const context=vm.createContext({window,document,state,AbortController,crypto:require("node:crypto").webcrypto,navigator:{language:"en-US"},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    setInterval:fn=>{timers.set(++timer,fn);return timer;},clearInterval:id=>timers.delete(id),clearTimeout(){},
    tenetInkController:{async suspend(){calls.push(["suspend"]);},async resume(){calls.push(["resume"]);}},
    tenetInkFlush:async()=>{},tenetCanvasAI:{close(){}},tenetInkMessage:text=>calls.push(["message",text]),
    aiPreparation:null,SIZE:20000,viewportRect:()=>({x:100,y:200,w:800,h:600}),intersection:(a)=>a,
    prepareVisibleWidgetSnapshots:async()=>{},
    buildTenetRegionImage:(points,text)=>({atlasImage:"data:image/png;base64,synthetic",selectionContext:{path:points},selectionQuestion:text}),
    supersedeActiveAI:reason=>calls.push(["supersede",reason]),
    requestAI:async(action,packed,options)=>{calls.push(["request",action,packed,options]);if(options.isCurrent())options.onReply("Start by identifying the known values.");},
  });
  new vm.Script(instrumented).runInContext(context);
  return {api:context.voiceTest,context,state,native,events,calls,timers,storage,document,window};
}
test("plain voice question needs no lasso and uses the disclosed visible-page crop",async()=>{
  const h=harness(); await h.api.activate(); await h.api.open();
  assert.equal(h.api.phase,"listening");
  h.events.get("voiceTranscript")({sessionId:h.api.job.sessionId,text:"Help me start problem 12",isFinal:false});
  await h.api.submit();
  const sent=h.calls.find(x=>x[0]==="request");
  assert.equal(sent[1],"answer"); assert.equal(sent[2].selectionQuestion,"Help me start problem 12");
  assert.equal(sent[2].questionScope,"visible-page");
  assert.equal(sent[2].visibleRect.w,800);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[2].selectionContext.path)),[{x:100,y:200},{x:900,y:200},{x:900,y:800},{x:100,y:800}]);
  assert.equal(sent[3].isolatedSelection,true); assert.equal(sent[3].expectedRevision,2);
  assert(h.calls.findIndex(x=>x[0]==="stop")<h.calls.findIndex(x=>x[0]==="request"));
  assert.equal(h.calls.some(x=>x[0]==="speak"),false);
  assert.equal(h.storage.size,0); assert.equal(h.api.ui.input.value,"");
});
test("spoken reply is opt-in and leaves the existing visual request intact",async()=>{
  const h=harness(); await h.api.activate(); await h.api.open(); h.api.ui.reply.checked=true;
  await h.api.submit();
  const speech=h.calls.find(x=>x[0]==="speak");assert.equal(speech[1].text,"Start by identifying the known values.");
  assert.equal(h.api.ui.stop.hidden,false);
  h.api.ui.stop.dispatchEvent(new Event("click"));assert.equal(h.api.ui.stop.hidden,true);
});
test("unsupported on-device language offers typing without microphone or cloud fallback",async()=>{
  const h=harness({async getVoiceCapabilities(){return {supported:false,onDevice:false,locale:"xx",reason:"Type instead"};}});
  await h.api.activate();await h.api.open();assert.equal(h.api.ui.record.disabled,true);
  h.api.ui.input.value="Help me start problem 12";await h.api.submit();
  assert.equal(h.calls.some(x=>x[0]==="start"),false);assert(h.calls.some(x=>x[0]==="request"));
});
test("older native binary does not show unusable audio controls",async()=>{
  const h=harness({async getVoiceCapabilities(){throw Error("UNIMPLEMENTED");}});await h.api.activate();assert.equal(h.api.ui,null);
});
test("stale transcript and page-switch callbacks cannot submit previous-page work",async()=>{
  const h=harness();await h.api.activate();await h.api.open();
  h.events.get("voiceTranscript")({sessionId:"old",text:"stale"});assert.equal(h.api.ui.input.value,"");
  h.state.snapshotLoadGeneration++;await h.api.submit();assert.equal(h.calls.some(x=>x[0]==="request"),false);
  for(const fn of h.timers.values())fn();assert.equal(h.api.job,null);assert.equal(h.api.ui.dialog.open,false);
});
test("background/sign-out stop recording and speech and erase ephemeral transcript",async()=>{
  for(const kind of ["visibilitychange","tenet:sign-out"]){
    const h=harness();await h.api.activate();await h.api.open();h.api.ui.input.value="private question";
    if(kind==="visibilitychange"){h.document.hidden=true;h.document.dispatchEvent(new Event(kind));}else h.window.dispatchEvent(new Event(kind));
    assert.equal(h.api.job,null);assert.equal(h.api.ui.input.value,"");assert.equal(h.timers.size,0);
    assert(h.calls.some(x=>x[0]==="cancel"));assert(h.calls.some(x=>x[0]==="quiet"));
  }
});
test("cancel during native permission prompt does not reopen the recording UI",async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const h=harness({async startVoiceRecognition(){await pending;}});await h.api.activate();const opening=h.api.open();
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(h.api.phase,"starting");h.api.cancel();release();await opening;
  assert.equal(h.api.job,null);assert.equal(h.api.phase,"idle");assert.equal(h.api.ui.dialog.open,false);
});
test("stale close event cannot close a newly reopened voice panel",async()=>{
  const h=harness();await h.api.activate();await h.api.open();h.api.cancel();await h.api.open();
  h.api.ui.dialog.dispatchEvent(new Event("close"));assert(h.api.job);assert.equal(h.api.ui.dialog.open,true);
});
test("web layer has no audio recorder, speech-service endpoint, or transcript persistence",()=>{
  assert.doesNotMatch(source,/MediaRecorder|getUserMedia|SpeechRecognition\(|fetch\(/);
  assert.equal((source.match(/localStorage\.setItem/g)||[]).length,1);
  assert.match(source,/localStorage\.setItem\(preference, String\(ui\.reply\.checked\)\)/);
  const ai=fs.readFileSync(path.join(__dirname,"../src/client/app/ai-runtime.js"),"utf8");
  assert(ai.indexOf('commands.filter(command => command.tool === "write_text")')>ai.indexOf('const rawCommands ='));
  assert.match(ai,/requestOptions\.isCurrent && !requestOptions\.isCurrent\(\)/);
});
