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
  show() { this.open=true; } showModal() { this.open=true; } close() { this.open=false; }
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
    tenetRegionGeometry:points=>({x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),w:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),h:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))}),
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
  assert.equal(sent[1],"hint"); assert.equal(sent[2].selectionQuestion,"Help me start problem 12");
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
test("voice from a circle sends only the selected polygon, never the visible page",async()=>{
  const h=harness();await h.api.activate();
  const points=[{x:120,y:230},{x:240,y:240},{x:190,y:300}];
  await h.api.open({points,revision:2,generation:3,page:1});
  await h.api.submit();
  const sent=h.calls.find(x=>x[0]==="request");
  assert.deepEqual(JSON.parse(JSON.stringify(sent[2].selectionContext.path)),points);
  assert.equal(sent[2].visibleRect,undefined);assert.equal(sent[2].questionScope,undefined);
  assert.match(h.api.ui.privacy.textContent,/only the circled pixels/);
});
test("changed circled work cannot fall back to whole-page voice capture",async()=>{
  const h=harness();await h.api.activate();
  await h.api.open({points:[{x:120,y:230},{x:240,y:240},{x:190,y:300}],revision:2,generation:3,page:1});
  h.state.userRevision++;await h.api.submit();
  assert.equal(h.calls.some(x=>x[0]==="request"),false);
  assert(h.calls.some(x=>x[0]==="message"&&/selected work changed/.test(x[1])));
});
test("unsupported on-device language offers typing without microphone or cloud fallback",async()=>{
  const h=harness({async getVoiceCapabilities(){return {supported:false,onDevice:false,locale:"xx",reason:"Type instead"};}});
  await h.api.activate();await h.api.open();assert.equal(h.api.ui.record.disabled,false);
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

test("blank-page voice preserves the text-only envelope instead of overwriting its scope",async()=>{
  const h=harness();await h.api.activate();
  h.context.buildTenetRegionImage=(points,text)=>text
    ? {questionOnly:true,questionScope:"text-only",selectionQuestion:text,visibleRect:{x:100,y:200,w:800,h:600},changedBox:{x:100,y:200,w:800,h:600}}
    : {atlasImage:"data:image/png;base64,synthetic",selectionContext:{path:points}};
  await h.api.open();await h.api.submit();
  const sent=h.calls.find(c=>c[0]==="request");
  assert.equal(sent[1],"hint");assert.equal(sent[2].questionOnly,true);
  assert.equal(sent[2].questionScope,"text-only");assert.equal(sent[2].atlasImage,undefined);
  assert.equal(sent[2].selectionContext,undefined);
  assert(h.calls.some(c=>c[0]==="message"&&/without an image/.test(c[1])));
});

function autoSendHarness() {
  return harness({async getVoiceCapabilities(){return {supported:true,onDevice:true,locale:"en-US",supportsSilenceAutoSubmit:true,autoSubmitSilenceSeconds:1.5};}});
}
const settle = () => new Promise(resolve=>setImmediate(resolve));

test("Talk starts recording without waiting for ink suspension or page preview",async()=>{
  for(const blocked of ["suspend","preview"]) {
    const h=harness();await h.api.activate();
    let release;const pending=new Promise(resolve=>{release=resolve;});
    if(blocked==="suspend")h.context.tenetInkController.suspend=()=>pending;
    else h.context.prepareVisibleWidgetSnapshots=()=>pending;
    await h.api.open();
    assert.equal(h.api.phase,"listening");
    assert.equal(h.calls.filter(c=>c[0]==="start").length,1);
    h.api.cancel();release();await settle();
    assert.equal(h.api.ui.preview.src,undefined);
    assert.equal(h.calls.some(c=>c[0]==="request"),false);
  }
});

test("a failed preview does not prevent recording or replace microphone status",async()=>{
  const h=harness();await h.api.activate();
  h.context.prepareVisibleWidgetSnapshots=async()=>{throw Error("Widget preview unavailable");};
  await h.api.open();await settle();
  assert.equal(h.api.phase,"listening");
  assert.match(h.api.ui.status.textContent,/Listening on this iPad/);
  assert.match(h.api.ui.previewStatus.textContent,/Preview unavailable/);
  h.api.cancel();
});

test("Talk rechecks readiness instead of permanently caching unavailable permissions",async()=>{
  let ready=false;
  const h=harness({async getVoiceCapabilities(){return {supported:ready,onDevice:true,locale:"en-US",reason:"Microphone unavailable"};}});
  await h.api.activate();ready=true;await h.api.open();
  assert.equal(h.api.phase,"listening");
  assert.equal(h.calls.filter(c=>c[0]==="start").length,1);
  h.api.cancel();
});

test("recording cannot start until native listeners are installed",async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const h=harness({async addListener(){await pending;return {async remove(){}};}});
  const activation=h.api.activate();await settle();
  assert.equal(h.api.ui.entry.disabled,true);await h.api.open();
  assert.equal(h.calls.some(c=>c[0]==="start"),false);
  release();await activation;await h.api.open();
  assert.equal(h.api.phase,"listening");h.api.cancel();
});

test("atomic silence completion sends final text without a preceding transcript event",async()=>{
  const h=autoSendHarness();await h.api.activate();await h.api.open();
  const sessionId=h.api.job.sessionId;
  const terminal={sessionId,state:"stopped",reason:"silence",text:"Help me start problem 12",isFinal:true};
  h.events.get("voiceState")(terminal);h.events.get("voiceState")(terminal);
  h.events.get("voiceTranscript")({sessionId,text:"older partial text",isFinal:false});await settle();
  const requests=h.calls.filter(c=>c[0]==="request");
  assert.equal(requests.length,1);assert.equal(requests[0][1],"hint");
  assert.equal(requests[0][2].selectionQuestion,"Help me start problem 12");
});

test("transcript inactivity uses the advertised word-pause trigger and preserves lasso scope",async()=>{
  const h=harness({async getVoiceCapabilities(){return {supported:true,onDevice:true,locale:"en-US",supportsSilenceAutoSubmit:true,autoSubmitSilenceSeconds:1.5,autoSubmitTrigger:"transcript-inactivity"};}});
  await h.api.activate();const points=[{x:120,y:230},{x:240,y:240},{x:190,y:300}];
  await h.api.open({points,revision:2,generation:3,page:1});
  assert.match(h.api.ui.timing.textContent,/1.5 seconds without a new word/);
  assert.match(h.api.ui.status.textContent,/last new transcribed word/);
  const sessionId=h.api.job.sessionId;
  h.events.get("voiceState")({sessionId,state:"stopped",reason:"transcript-pause",text:"Help with this part",isFinal:true});
  await settle();const requests=h.calls.filter(c=>c[0]==="request");
  assert.equal(requests.length,1);assert.equal(requests[0][1],"hint");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0][2].selectionContext.path)),points);
  assert.equal(requests[0][2].visibleRect,undefined);
});

test("audio silence cannot trigger submission on a transcript-inactivity native build",async()=>{
  const h=harness({async getVoiceCapabilities(){return {supported:true,onDevice:true,locale:"en-US",supportsSilenceAutoSubmit:true,autoSubmitSilenceSeconds:1.5,autoSubmitTrigger:"transcript-inactivity"};}});
  await h.api.activate();await h.api.open();const sessionId=h.api.job.sessionId;
  h.events.get("voiceState")({sessionId,state:"stopped",reason:"silence",text:"Wait for the words",isFinal:true});
  await settle();assert.equal(h.calls.some(c=>c[0]==="request"),false);h.api.cancel();
});

test("malformed atomic completion cannot reuse an older final transcript",async()=>{
  for(const fields of [{text:"",isFinal:true},{text:"partial",isFinal:false},{isFinal:true},{text:"question"},{text:"x".repeat(1001),isFinal:true}]) {
    const h=autoSendHarness();await h.api.activate();await h.api.open();const sessionId=h.api.job.sessionId;
    h.events.get("voiceTranscript")({sessionId,text:"old final question",isFinal:true});
    h.events.get("voiceState")({sessionId,state:"stopped",reason:"silence",...fields});await settle();
    assert.equal(h.calls.some(c=>c[0]==="request"),false);h.api.cancel();
  }
});

test("native final transcript followed by 1.5-second silence auto-submits exactly one hint",async()=>{
  const h=autoSendHarness();await h.api.activate();await h.api.open();
  assert.match(h.api.ui.timing.textContent,/1.5 seconds of silence/);
  const sessionId=h.api.job.sessionId;
  h.events.get("voiceState")({sessionId,state:"finalizing"});
  h.events.get("voiceTranscript")({sessionId,text:"Help me start problem 12",isFinal:true});
  h.events.get("voiceState")({sessionId,state:"stopped",reason:"silence"});
  h.events.get("voiceState")({sessionId,state:"stopped",reason:"silence"});
  await settle();
  const requests=h.calls.filter(c=>c[0]==="request");
  assert.equal(requests.length,1);assert.equal(requests[0][1],"hint");
  assert.equal(requests[0][2].selectionQuestion,"Help me start problem 12");
  assert.equal(h.calls.filter(c=>c[0]==="stop").length,0);
});

test("no-speech, partial or empty transcripts, and non-silence stops never auto-send",async()=>{
  for(const [text,isFinal,reason] of [["",true,"silence"],["partial",false,"silence"],["question",true,"no-speech"],["question",true,"manual"]]) {
    const h=autoSendHarness();await h.api.activate();await h.api.open();const sessionId=h.api.job.sessionId;
    h.events.get("voiceTranscript")({sessionId,text,isFinal});
    h.events.get("voiceState")({sessionId,state:"stopped",reason});await settle();
    assert.equal(h.calls.some(c=>c[0]==="request"),false);h.api.cancel();
  }
});

test("older voice-capable binaries keep manual send even if given a silence event",async()=>{
  const h=harness();await h.api.activate();await h.api.open();const sessionId=h.api.job.sessionId;
  assert.match(h.api.ui.timing.textContent,/Manual send/);
  h.events.get("voiceTranscript")({sessionId,text:"question",isFinal:true});
  h.events.get("voiceState")({sessionId,state:"stopped",reason:"silence"});await settle();
  assert.equal(h.calls.some(c=>c[0]==="request"),false);h.api.cancel();
});

test("cancel, page changes, manual review and transcript edits disarm silence submission",async()=>{
  for(const action of ["cancel","page","review","edit"]) {
    const h=autoSendHarness();await h.api.activate();await h.api.open();const sessionId=h.api.job.sessionId;
    h.events.get("voiceTranscript")({sessionId,text:"question",isFinal:true});
    if(action==="cancel")h.api.cancel();
    if(action==="page")h.state.snapshotLoadGeneration++;
    if(action==="review")await h.api.finish(h.api.job);
    if(action==="edit")h.api.ui.input.dispatchEvent(new Event("input"));
    h.events.get("voiceState")({sessionId,state:"stopped",reason:"silence"});await settle();
    assert.equal(h.calls.some(c=>c[0]==="request"),false);h.api.cancel();
  }
});
