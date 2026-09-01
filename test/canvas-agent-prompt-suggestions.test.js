"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {parseHTML} = require("linkedom");

const ROOT=path.resolve(__dirname,".."),
  runtime=fs.readFileSync(path.join(ROOT,"src/client/app/canvas-agent-runtime.js"),"utf8"),
  html=fs.readFileSync(path.join(ROOT,"public/index.html"),"utf8"),
  css=fs.readFileSync(path.join(ROOT,"public/style.css"),"utf8"),
  english=fs.readFileSync(path.join(ROOT,"src/client/app/core.js"),"utf8"),
  chinese=fs.readFileSync(path.join(ROOT,"public/locales/zh.js"),"utf8");

function functionSource(name){
  const start=runtime.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing function ${name}`);
  const signature=runtime.indexOf("(",start);let parentheses=0,signatureEnd=-1;
  for(let index=signature;index<runtime.length;index++){
    if(runtime[index]==="(")parentheses++;
    else if(runtime[index]===")"&&--parentheses===0){signatureEnd=index;break;}
  }
  assert.notEqual(signatureEnd,-1,`unterminated signature ${name}`);
  const body=runtime.indexOf("{",signatureEnd);let depth=0;
  for(let index=body;index<runtime.length;index++){
    if(runtime[index]==="{")depth++;
    else if(runtime[index]==="}"&&--depth===0)return runtime.slice(start,index+1);
  }
  assert.fail(`unterminated function ${name}`);
}

function promptConstants(){
  const start=runtime.indexOf("CANVAS_AGENT_PROMPT_LIBRARY ="),end=runtime.indexOf("  const canvasAgent =",start);
  assert.notEqual(start,-1);assert.notEqual(end,-1);
  const declarations=runtime.slice(start,end).trim();
  return vm.runInNewContext(`(()=>{const ${declarations}\nreturn {library:CANVAS_AGENT_PROMPT_LIBRARY,iconPaths:CANVAS_AGENT_PROMPT_ICON_PATHS,additional:CANVAS_AGENT_PROMPT_ADDITIONAL,primary:CANVAS_AGENT_PROMPT_PRIMARY};})()`);
}

function translation(source,key){
  const match=source.match(new RegExp(`(?:^|\\n)\\s*${key}: "((?:\\\\.|[^"\\\\])*)"`));
  assert.ok(match,`missing translation ${key}`);
  return JSON.parse(`"${match[1]}"`);
}

test("PenEcho Agent keeps the Revise pencil seam inside its icon viewBox",()=>{
  const {iconPaths}=promptConstants();
  assert.equal(iconPaths.revise[1],"M13.5 9l3.5 3.5M4 5h6M4 9h5");
});

test("PenEcho Agent keeps its default introduction above the Try asking overlay",()=>{
  assert.match(html,/class="canvas-agent-empty"><strong data-i18n="canvasAgentEmptyTitle"/);
  assert.doesNotMatch(html,/class="canvas-agent-empty-icon"/);
  assert.doesNotMatch(functionSource("canvasAgentRenderEmpty"),/canvas-agent-empty-icon|<svg/);
  assert.match(css,/\.canvas-agent-empty\s*\{[^}]*margin:\s*clamp\(22px, 11vh, 108px\) 8px auto[^}]*text-align:\s*left/);
  assert.doesNotMatch(css,/\.canvas-agent-empty-icon/);
});

test("PenEcho Agent keeps Project, Try asking, and model in the composer toolbar",()=>{
  const {document}=parseHTML(html),form=document.querySelector("#canvasAgentForm"),surface=form.querySelector(".canvas-agent-composer-surface"),toolbar=form.querySelector(".canvas-agent-composer-toolbar"),suggestions=document.querySelector("#canvasAgentPromptSuggestions"),project=document.querySelector("#canvasAgentProjectControl"),connection=document.querySelector("#canvasAgentConnection"),attachments=document.querySelector("#canvasAgentAttachments"),approval=document.querySelector("#canvasAgentApproval"),
    popup=document.querySelector("#canvasAgentPromptPopup"),additionalGroup=document.querySelector("#canvasAgentAdditionalPromptGroup"),primaryGroup=document.querySelector("#canvasAgentPrimaryPromptGroup"),additional=document.querySelector("#canvasAgentAdditionalPromptList"),primary=document.querySelector("#canvasAgentPrimaryPromptList"),toggle=suggestions.querySelector("#canvasAgentPromptToggle"),additionalRule=css.match(/\.canvas-agent-prompt-additional\s*\{([^}]*)\}/)?.[1]||"";
  assert.equal(attachments.nextElementSibling,approval);
  assert.equal(approval.nextElementSibling,form,"the composer remains the fixed final panel item");
  assert.equal(toolbar.parentElement,surface);
  assert.deepEqual([...toolbar.children],[project,suggestions,connection]);
  assert.equal(form.querySelector(".canvas-agent-tool-actions").contains(project),false,"Project moved out of the lower action row");
  assert.equal(document.querySelector("#canvasAgentProjectLabel").textContent,"No project");
  assert.equal(connection.getAttribute("aria-controls"),"settingsPanel");
  assert.equal(suggestions.hasAttribute("hidden"),true);
  assert.deepEqual([...popup.children],[primaryGroup,additionalGroup]);
  assert.equal(primary.parentElement,primaryGroup);assert.equal(additional.parentElement,additionalGroup);
  assert.equal(primary.dataset.peList,"prompt-grid");assert.equal(additional.dataset.peList,"prompt-grid");
  assert.equal(popup.querySelector('[data-pe-region="group-label"]'),null,"suggestions are title-only without category headings");
  assert.equal(toggle.getAttribute("aria-controls"),"canvasAgentPromptPopup");
  assert.doesNotMatch(toggle.innerHTML,/canvas-agent-prompt-spark/);
  assert.match(toggle.innerHTML,/canvas-agent-prompt-toggle-copy[\s\S]*canvas-agent-prompt-chevron/);
  assert.equal(connection.dataset.peButton,"ghost");
  assert.match(css,/\.canvas-agent-composer-toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*border-bottom:/);
  assert.match(css,/\.canvas-agent-composer-toolbar:has\(\.canvas-agent-prompt-suggestions\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/\.canvas-agent-prompt-suggestions\s*\{[^}]*position:\s*static;[^}]*min-height:\s*30px;[^}]*overflow:\s*visible/);
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*position:\s*absolute;[^}]*right:\s*6px;[^}]*bottom:\s*calc\(100% \+ 6px\);[^}]*left:\s*6px;[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;[^}]*-webkit-overflow-scrolling:\s*touch/);
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*max-height:\s*min\(420px, max\(96px, calc\(100cqh - 160px\)\)\)/,"the popup stays inside the Agent panel at narrow heights");
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*gap:\s*4px;[^}]*padding:\s*6px;[^}]*border-radius:\s*var\(--pe-r-popover[^}]*box-shadow:\s*none/);
  assert.match(css,/\.canvas-agent-prompt-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*gap:\s*4px/);
  assert.match(css,/@container \(max-width: 520px\)[\s\S]*?\.canvas-agent-prompt-list\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(additionalRule,/position:|bottom:|max-height:|overflow|overscroll|scrollbar|border:|background:|box-shadow:/,"the popup keeps one scroll owner");
  assert.match(css,/\.canvas-agent-prompt-list > button\s*\{[^}]*min-height:\s*48px;[^}]*grid-template-columns:\s*22px minmax\(0, 1fr\);[^}]*padding:\s*6px 7px;[^}]*border:\s*1px solid var\(--pe-line[^}]*border-radius:\s*7px/);
  assert.match(css,/\.canvas-agent-prompt-list > button > \[data-pe-region="preview"\]\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;[^}]*border-radius:\s*5px/);
  assert.match(css,/\.canvas-agent-prompt-copy > \[data-pe-region="title"\]\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.45;[^}]*white-space:\s*normal/);
  assert.match(css,/\.canvas-agent-project-button > span\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500/);
  assert.match(css,/\.canvas-agent-prompt-toggle-copy > \[data-pe-region="title"\]\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500/);
  assert.match(css,/\.canvas-agent-connection-button > span\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500/);
  assert.doesNotMatch(functionSource("canvasAgentRenderPromptSuggestions"),/createElement\("small"\)|data-pe-region="description"|Summary/);
});

test("PenEcho Agent keeps its fixed Try asking row whenever suggestions are available",()=>{
  const input={value:"",disabled:false},form={contains:node=>node===input},outside={},document={activeElement:input},panel={hidden:false},referencePicker={hidden:true},approval={hidden:true},suggestions={contains:()=>false},canvasAgent={
    inputMode:"text",inkPresent:false,attachments:[],references:[],requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false,
  },context={canvasAgentPromptSuggestions:suggestions,canvasAgentPanel:panel,canvasAgentForm:form,document,canvasAgent,canvasAgentInput:input,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval};
  context.canvasAgentPromptHasDraft=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptHasDraft")}return canvasAgentPromptHasDraft;})()`,context);
  context.canvasAgentPromptSuggestionsAvailable=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionsAvailable")}return canvasAgentPromptSuggestionsAvailable;})()`,context);
  const shouldShow=vm.runInNewContext(`(()=>{${functionSource("canvasAgentShouldShowPromptSuggestions")}return canvasAgentShouldShowPromptSuggestions;})()`,context);
  assert.equal(shouldShow(),true);
  document.activeElement=outside;assert.equal(shouldShow(),true,"the fixed row keeps its layout position after blur");
  input.value="draft";assert.equal(shouldShow(),true,"a text draft keeps the Try asking header visible after blur");
  input.value="";canvasAgent.attachments=[{}];assert.equal(shouldShow(),true,"an attachment is composer content");
  canvasAgent.attachments=[];canvasAgent.references=["widget-1"];assert.equal(shouldShow(),true,"an explicit reference is composer content");
  canvasAgent.references=[];document.activeElement=input;
  const blockers=[
    [canvasAgent,"requestPending",true],[canvasAgent,"running",true],[canvasAgent,"inputMode","ink"],[canvasAgent,"inkPresent",true],
    [canvasAgent,"viewingHistoryId","history"],[canvasAgent,"pendingApproval",{}],[canvasAgent,"attachmentBusy",true],[canvasAgent,"projectUploadBusy",true],
    [input,"disabled",true],[referencePicker,"hidden",false],[approval,"hidden",false],[panel,"hidden",true],
  ];
  for(const [target,key,value] of blockers){const previous=target[key];target[key]=value;assert.equal(shouldShow(),false,`${key} should hide suggestions`);target[key]=previous;}
});

test("PenEcho Agent floats only prompt options without CSP-sensitive inline sizing",()=>{
  assert.doesNotMatch(runtime,/style\.(?:set|remove)Property\([^)]*canvas-agent-prompt/);
  assert.doesNotMatch(css,/canvas-agent-prompt-height-|--canvas-agent-prompt-avoidance|\.canvas-agent-prompt-suggestions\s*\{[^}]*position:\s*absolute/);
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*position:\s*absolute/);
});

test("PenEcho Agent classifies image, Office, document, code, and generic files",()=>{
  const classify=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptFileContext")}return canvasAgentPromptFileContext;})()`);
  assert.equal(classify({kind:"image",name:"photo.bin"}),"image");
  assert.equal(classify({name:"budget.xlsx",mediaType:"application/octet-stream"}),"spreadsheet");
  assert.equal(classify({name:"deck.pptx"}),"presentation");
  assert.equal(classify({name:"paper.pdf"}),"document");
  assert.equal(classify({name:"agent.ts"}),"code");
  assert.equal(classify({name:"archive.bin"}),"file");
});

test("PenEcho Agent intent precedence follows explicit choices before inferred canvas content",()=>{
  let selected=false,project=null,hasInk=false,hasContent=false;
  const canvasAgent={attachments:[],projectId:""},state={selection:null,images:[],widgets:[],textBoxes:[],animations:[],preservedSnapshotAnimations:[]},scope={
    canvasAgent,state,SIZE:100,canvasAgentReferencedIds:()=>selected?["selected"]:[],canvasAgentProjectById:()=>project,
    visibleInkBounds:()=>hasInk?{x:1,y:1,w:2,h:2}:null,canvasAgentContentBounds:()=>hasContent?{x:1,y:1,w:2,h:2}:null,
  };
  scope.canvasAgentPromptFileContext=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptFileContext")}return canvasAgentPromptFileContext;})()`);
  const context=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptContext")}return canvasAgentPromptContext;})()`,scope);
  assert.equal(context(),"blank");
  hasContent=true;assert.equal(context(),"canvas");
  state.images.push({});assert.equal(context(),"image");
  hasInk=true;assert.equal(context(),"notes");
  project={kind:"folder"};canvasAgent.projectId="folder-1";assert.equal(context(),"project");
  selected=true;assert.equal(context(),"selection");
  canvasAgent.attachments=[{kind:"file",name:"budget.xlsx"}];assert.equal(context(),"spreadsheet");
  canvasAgent.attachments=[{kind:"image",name:"photo.png"}];assert.equal(context(),"image");
  canvasAgent.attachments=[];selected=false;project={kind:"file",name:"paper.pdf"};assert.equal(context(),"document");
});

test("PenEcho Agent chooses three context-specific primary intents",()=>{
  const constants=promptConstants(),expected={
    blank:["file","architecture","handwriting"],image:["imageVisual","imageLayer","imagePublish"],spreadsheet:["spreadsheetVisual","spreadsheetLayer","spreadsheetPublish"],
    presentation:["presentationVisual","presentationLayer","presentationPublish"],document:["documentVisual","documentStudy","documentPublish"],code:["codeVisual","codeLayer","codePlan"],
    file:["file","fileLayer","filePublish"],project:["architecture","projectPlan","projectPublish"],selection:["selectionVisual","selectionLayer","selectionPublish"],
    notes:["notesVisual","applyAnnotations","handwriting"],canvas:["canvasVisual","canvasLayer","canvasPublish"],
  };
  for(const [context,ids] of Object.entries(expected)){
    const set=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionSet")}return canvasAgentPromptSuggestionSet;})()`,{
      CANVAS_AGENT_PROMPT_LIBRARY:constants.library,CANVAS_AGENT_PROMPT_ADDITIONAL:constants.additional,CANVAS_AGENT_PROMPT_PRIMARY:constants.primary,canvasAgentPromptContext:()=>context,
    })();
    assert.equal(set.key,context);assert.equal(set.suggestions.length,context==="notes"?11:12);assert.deepEqual(Array.from(set.suggestions.slice(-3),item=>item.id),ids);
  }
});

function interactiveScene(){
  const constants=promptConstants(),set={key:"blank",suggestions:[...constants.additional,...constants.primary.blank].map(id=>({id,...constants.library[id]}))},active={element:null,insideForm:false,insideSuggestions:false},outside={};
  function node(tag){
    return {tag,handlers:{},children:[],dataset:{},className:"",attributes:{},hidden:false,focusOptions:null,_textContent:"",
      get textContent(){return this.children.length?this.children.map(child=>child.textContent||"").join(""):this._textContent;},set textContent(value){this._textContent=String(value);this.children=[];},
      closest(selector){return selector==="button"&&this.tag==="button"?this:null;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},
      setAttribute(name,value){this.attributes[name]=String(value);this[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},
      addEventListener(type,handler){this.handlers[type]=handler;},click(){this.handlers.click?.();},focus(options){this.focusOptions=options;active.element=this;active.insideForm=false;active.insideSuggestions=true;}};
  }
  const document={get activeElement(){return active.element;},set activeElement(value){active.element=value;},createElement:node,createElementNS(_namespace,tag){return node(tag);}},
    input={value:"",disabled:false,events:0,focused:false,blurred:false,selection:null,dispatchEvent(event){this.events++;if(event.type==="input")sync();},focus(){this.focused=true;active.element=this;active.insideForm=true;active.insideSuggestions=false;},blur(){this.blurred=true;if(active.element===this){active.element=null;active.insideForm=false;}},setSelectionRange(start,end){this.selection=[start,end];}},
    form={contains(node){return node===input||node===active.element&&active.insideForm;},submitted:false},
    suggestions={hidden:true,dataset:{},attributes:{},classList:{expanded:false,promptRowsVisible:false,toggle(name,value){if(name==="expanded")this.expanded=Boolean(value);if(name==="prompt-rows-visible")this.promptRowsVisible=Boolean(value);}},setAttribute(name,value){this.attributes[name]=String(value);},contains(node){return node===active.element&&active.insideSuggestions;}},
    popup={hidden:true},makeList=()=>({hidden:false,children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);}}),additional=makeList(),primary=makeList(),additionalGroup={hidden:true},primaryGroup={hidden:false},toggle=node("button"),disclosure=node("span"),
    hint={hidden:false},canvasAgent={inputMode:"text",inkPresent:false,attachments:[],references:[],currentConversation:{items:[]},requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false,promptSuggestionsExpanded:false,promptSuggestionsManual:false,promptSuggestionsCollapsedAll:false,promptSuggestionContextKey:"",promptSuggestions:[]},
    panel={hidden:false},referencePicker={hidden:true},approval={hidden:true},translations={canvasAgentPromptHandwriting:"Polished prompt",canvasAgentPromptHandwritingTitle:"Enhance My Handwritten Notes",canvasAgentPromptMore:"Show",canvasAgentPromptLess:"Hide",canvasAgentPromptDisclosureMore:"More",canvasAgentPromptDisclosureLess:"Less"};
  const context={canvasAgentInput:input,canvasAgentInputHint:hint,canvasAgentPromptSuggestions:suggestions,canvasAgentPromptPopup:popup,canvasAgentAdditionalPromptGroup:additionalGroup,canvasAgentAdditionalPromptList:additional,canvasAgentPrimaryPromptGroup:primaryGroup,canvasAgentPrimaryPromptList:primary,
    canvasAgentPromptToggle:toggle,canvasAgentPromptDisclosureCopy:disclosure,canvasAgentPanel:panel,canvasAgentForm:form,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval,document,canvasAgent,
    CANVAS_AGENT_PROMPT_ICON_PATHS:constants.iconPaths,t:key=>translations[key]||key,canvasAgentSyncInputHint(){},canvasAgentPromptSuggestionSet:()=>set,Event:class Event{constructor(type){this.type=type;}},
  };
  const hasDraft=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptHasDraft")}return canvasAgentPromptHasDraft;})()`,context);
  context.canvasAgentPromptHasDraft=hasDraft;
  const needsManualExpansion=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptNeedsManualExpansion")}return canvasAgentPromptNeedsManualExpansion;})()`,context);
  context.canvasAgentPromptNeedsManualExpansion=needsManualExpansion;
  const rowsVisible=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptRowsVisible")}return canvasAgentPromptRowsVisible;})()`,context);
  context.canvasAgentPromptRowsVisible=rowsVisible;
  const setExpanded=vm.runInNewContext(`(()=>{${functionSource("canvasAgentSetPromptSuggestionsExpanded")}return canvasAgentSetPromptSuggestionsExpanded;})()`,context);
  context.canvasAgentSetPromptSuggestionsExpanded=setExpanded;
  const createIcon=vm.runInNewContext(`(()=>{${functionSource("canvasAgentCreatePromptIcon")}return canvasAgentCreatePromptIcon;})()`,context);
  context.canvasAgentCreatePromptIcon=createIcon;
  const render=vm.runInNewContext(`(()=>{${functionSource("canvasAgentRenderPromptSuggestions")}return canvasAgentRenderPromptSuggestions;})()`,context);
  context.canvasAgentRenderPromptSuggestions=render;
  const available=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionsAvailable")}return canvasAgentPromptSuggestionsAvailable;})()`,context);
  context.canvasAgentPromptSuggestionsAvailable=available;
  const shouldShow=vm.runInNewContext(`(()=>{${functionSource("canvasAgentShouldShowPromptSuggestions")}return canvasAgentShouldShowPromptSuggestions;})()`,context);
  context.canvasAgentShouldShowPromptSuggestions=shouldShow;
  const sync=vm.runInNewContext(`(()=>{${functionSource("canvasAgentSyncPromptSuggestions")}return canvasAgentSyncPromptSuggestions;})()`,context);
  context.canvasAgentSyncPromptSuggestions=sync;
  const choose=vm.runInNewContext(`(()=>{${functionSource("canvasAgentChoosePromptSuggestion")}return canvasAgentChoosePromptSuggestion;})()`,context);
  context.canvasAgentChoosePromptSuggestion=choose;
  const preventFocusLoss=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPreventPromptSuggestionFocusLoss")}return canvasAgentPreventPromptSuggestionFocusLoss;})()`,context),
    expandOnEnter=vm.runInNewContext(`(()=>{${functionSource("canvasAgentExpandPromptSuggestionsOnPointerEnter")}return canvasAgentExpandPromptSuggestionsOnPointerEnter;})()`,context),
    collapseOnLeave=vm.runInNewContext(`(()=>{${functionSource("canvasAgentCollapsePromptSuggestionsOnPointerLeave")}return canvasAgentCollapsePromptSuggestionsOnPointerLeave;})()`,context),
    syncFocus=vm.runInNewContext(`(()=>{${functionSource("canvasAgentSyncPromptSuggestionsFocus")}return canvasAgentSyncPromptSuggestionsFocus;})()`,context),
    toggleExpanded=vm.runInNewContext(`(()=>{${functionSource("canvasAgentTogglePromptSuggestions")}return canvasAgentTogglePromptSuggestions;})()`,context),
    collapseFromPanel=vm.runInNewContext(`(()=>{${functionSource("canvasAgentCollapsePromptSuggestionsFromPanel")}return canvasAgentCollapsePromptSuggestionsFromPanel;})()`,context);
  return {set,input,active,outside,document,form,suggestions,popup,additionalGroup,primaryGroup,additional,primary,toggle,canvasAgent,render,setExpanded,shouldShow,sync,choose,preventFocusLoss,expandOnEnter,collapseOnLeave,syncFocus,toggleExpanded,collapseFromPanel};
}

test("PenEcho Agent renders one flat expanded prompt grid and inserts the full prompt",()=>{
  const scene=interactiveScene();scene.render(scene.set);
  assert.equal(scene.additional.children.length,12);assert.equal(scene.primary.children.length,3);
  const button=scene.primary.children.at(-1),preview=button.children[0],copy=button.children[1],title=copy.children[0];
  assert.equal(button.dataset.peList,undefined);assert.equal(button.className,"canvas-agent-prompt-row list-row");assert.equal(preview.dataset.peRegion,"preview");assert.equal(preview.className,"canvas-agent-prompt-icon list-icon");assert.equal(preview.children[0].children.length>0,true);
  assert.equal(copy.className,"canvas-agent-prompt-copy list-copy");assert.equal(title.tag,"span");assert.equal(copy.children.length,1);assert.equal(title.textContent,"Enhance My Handwritten Notes");assert.equal(button.title,"Enhance My Handwritten Notes");
  assert.equal(scene.choose("canvasAgentPromptHandwriting"),true);
  assert.equal(scene.input.value,"Polished prompt");assert.equal(scene.input.events,1);assert.equal(scene.input.focused,true);assert.deepEqual(scene.input.selection,[15,15]);assert.equal(scene.form.submitted,false);
  assert.match(runtime,/canvasAgentInput\.addEventListener\("input",\(\)=>\{[^}]*canvasAgentPromptHasDraft\(\)[^}]*canvasAgentSyncPromptSuggestions\(\)/);
});

test("Empty prompts expand as one card on hover and collapse immediately on leave",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.suggestions.hidden,false);assert.equal(scene.popup.hidden,false);assert.equal(scene.additional.hidden,true);assert.equal(scene.primary.hidden,false);
  scene.expandOnEnter();assert.equal(scene.additional.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.suggestions.classList.expanded,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"true");
  scene.collapseOnLeave();assert.equal(scene.additional.hidden,true);
  assert.match(css,/\.canvas-agent-prompt-suggestions > header > button\[aria-expanded="true"\] \.canvas-agent-prompt-chevron\s*\{[^}]*transform:\s*rotate\(180deg\)/);
  assert.match(runtime,/canvasAgentPromptSuggestions\?\.addEventListener\("pointerenter",canvasAgentExpandPromptSuggestionsOnPointerEnter\)/);
  assert.doesNotMatch(functionSource("canvasAgentCollapsePromptSuggestionsOnPointerLeave"),/setTimeout|requestAnimationFrame/);
});

test("The expanded arrow collapses every prompt row and keeps manual collapse stable",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.primary.hidden,false);assert.equal(scene.additional.hidden,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"true","the default three rows make the arrow a collapse action");
  scene.toggleExpanded();assert.equal(scene.popup.hidden,true);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);assert.equal(scene.canvasAgent.promptSuggestionsCollapsedAll,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"false");
  scene.expandOnEnter();assert.equal(scene.primary.hidden,true,"hover must not undo an explicit full collapse");assert.equal(scene.additional.hidden,true);
  scene.toggleExpanded();assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,false);assert.equal(scene.canvasAgent.promptSuggestionsCollapsedAll,false);
  assert.equal(scene.input.blurred,true,"manual expansion dismisses the touch keyboard");assert.equal(scene.document.activeElement,scene.toggle,"the non-text disclosure keeps focus");assert.equal(scene.toggle.focusOptions?.preventScroll,true);
  scene.toggleExpanded();assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true,"the same arrow collapses all rows from the fully expanded state");
});

test("Clicking the PenEcho Agent panel collapses Try asking like its disclosure button",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.popup.hidden,false);assert.equal(scene.primary.hidden,false);
  scene.collapseFromPanel({target:scene.outside});
  assert.equal(scene.popup.hidden,true);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);assert.equal(scene.canvasAgent.promptSuggestionsCollapsedAll,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"false");
  scene.expandOnEnter();assert.equal(scene.popup.hidden,true,"panel collapse must be as stable as the disclosure collapse");
  scene.toggleExpanded();scene.active.element=scene.toggle;scene.active.insideSuggestions=true;scene.collapseFromPanel({target:scene.toggle});
  assert.equal(scene.popup.hidden,false,"clicks inside Try asking keep their own toggle and suggestion behavior");
  assert.match(runtime,/canvasAgentPanel\.addEventListener\("click",canvasAgentCollapsePromptSuggestionsFromPanel\)/);
});

test("Drafts keep only the header until toggled and external blur always collapses",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.input.value="draft";scene.active.element=scene.outside;scene.sync();
  assert.equal(scene.suggestions.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);
  scene.expandOnEnter();assert.equal(scene.additional.hidden,true,"hover must not auto-open a draft");
  scene.toggleExpanded();assert.equal(scene.canvasAgent.promptSuggestionsManual,true);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,false);
  scene.collapseOnLeave();assert.equal(scene.additional.hidden,false,"manual expansion survives pointerleave");
  scene.active.insideForm=false;scene.active.insideSuggestions=false;scene.syncFocus();
  assert.equal(scene.suggestions.hidden,false,"draft header remains after blur");assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);assert.equal(scene.canvasAgent.promptSuggestionsManual,false);
  scene.toggleExpanded();scene.toggleExpanded();assert.equal(scene.toggle.getAttribute("aria-expanded"),"false","the arrow toggles both ways");
  assert.match(runtime,/canvasAgent\.promptSuggestionsExpanded&&!canvasAgentForm\.contains\(event\.target\)&&!canvasAgentPromptSuggestions\?\.contains\(event\.target\)\) canvasAgentSetPromptSuggestionsExpanded\(false\)/);
});

test("Existing conversations stay collapsed on focus until the arrow is clicked",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.canvasAgent.currentConversation.items.push({role:"user",text:"Earlier message"});scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.suggestions.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);
  scene.expandOnEnter();assert.equal(scene.additional.hidden,true,"hover must not auto-open prompts after a conversation has started");
  scene.toggleExpanded();assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,false);assert.equal(scene.canvasAgent.promptSuggestionsManual,true);
  scene.active.element=scene.outside;scene.active.insideForm=false;scene.active.insideSuggestions=false;scene.syncFocus();assert.equal(scene.suggestions.hidden,false,"the fixed header remains after blur");assert.equal(scene.popup.hidden,true);
});

test("PenEcho Agent suggestions preserve mouse activation without blocking iPad scrolling",async()=>{
  const scene=interactiveScene();scene.render(scene.set);const button=scene.primary.children.at(-1);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  const touchEvent={pointerType:"touch",target:button,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},
    penEvent={pointerType:"pen",target:button,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},
    mouseEvent={pointerType:"mouse",target:button,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}},
    toggleEvent={pointerType:"mouse",target:scene.toggle,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  scene.preventFocusLoss(touchEvent);scene.preventFocusLoss(penEvent);scene.preventFocusLoss(mouseEvent);scene.preventFocusLoss(toggleEvent);
  assert.equal(touchEvent.defaultPrevented,false,"touch panning stays native");assert.equal(penEvent.defaultPrevented,false,"pen panning stays native");assert.equal(mouseEvent.defaultPrevented,true,"mouse selection keeps the composer stable");assert.equal(toggleEvent.defaultPrevented,false,"the disclosure may take non-text focus");
  if(!mouseEvent.defaultPrevented)scene.active.element=scene.outside;
  queueMicrotask(scene.sync);await Promise.resolve();assert.equal(scene.suggestions.hidden,false);
  button.click();assert.equal(scene.input.value,"Polished prompt");assert.equal(scene.suggestions.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.form.submitted,false);
});

test("PenEcho Agent ships localized 3-to-5-word titles and full prompts for every intent",()=>{
  const {library}=promptConstants(),items=Object.values(library),keys=[...new Set(items.map(item=>item.prompt))],titleKeys=[...new Set(items.map(item=>item.title))];
  assert.equal(keys.length>=30,true);
  for(const key of keys){
    const en=translation(english,key),zh=translation(chinese,key);
    assert.equal(en.length>25,true,`English ${key} is incomplete`);
    assert.equal(zh.length>12,true,`Chinese ${key} is incomplete`);
    if(key!=="canvasAgentPromptHandwriting"){
      assert.equal(en.length<=150,true,`English ${key} should stay concise`);
      assert.equal(zh.length<=70,true,`Chinese ${key} should stay concise`);
    }
  }
  for(const key of titleKeys){
    const en=translation(english,key),zh=translation(chinese,key),words=en.trim().split(/\s+/);
    assert.equal(words.length>=3&&words.length<=5,true,`English ${key} must be 3–5 words`);
    assert.equal(zh.length>=4&&zh.length<=24,true,`Chinese ${key} should stay compact`);
  }
  for(const key of ["canvasAgentPromptMore","canvasAgentPromptLess","canvasAgentPromptDisclosureMore","canvasAgentPromptDisclosureLess","canvasAgentPromptCurrentCanvas","canvasAgentPromptMoreInspiration"]){assert.ok(translation(english,key));assert.ok(translation(chinese,key));}
  assert.equal(translation(english,"canvasAgentPromptHandwriting"),"Keep the current handwriting completely unchanged—do not edit, erase, or move it. Add a transparent explanatory layer over it; overlap is acceptable only if the original strokes remain clearly visible, and use annotations, connectors, links, graphics, or motion where appropriate to make the notes more vivid and intuitive.");
  assert.equal(translation(chinese,"canvasAgentPromptHandwriting"),"请保持当前手写笔迹完全不变：不修改、擦除或移动它；在其上添加一层背景透明的解释层，解释层可以适度覆盖但必须让原笔迹清晰透出，并在合适位置用标注、连线、链接、图形或动效让内容更生动直观。");
  assert.equal(translation(english,"canvasAgentPromptSequenceDiagramSource"),"Convert the current diagram into a sequence diagram and return editable diagram source code, such as Mermaid or PlantUML—not HTML.");
  assert.equal(translation(chinese,"canvasAgentPromptSequenceDiagramSource"),"请将当前图表转换为时序图，并返回可编辑的时序图源代码（如 Mermaid 或 PlantUML），不要返回 HTML。");
  assert.equal(translation(english,"canvasAgentPromptFollowCanvasCues"),"Follow my latest Canvas drawings, images, text boxes, and annotations. Continue and refine the work without changing unmarked content; ask if unclear.");
  assert.equal(translation(chinese,"canvasAgentPromptFollowCanvasCues"),"请把我刚在 Canvas 上新增的笔迹、手绘图形、图片、文本框和批注作为指示，按这些线索继续完善当前内容；不要改动未标注处，不清楚时先问我。");
  for(const item of items){assert.ok(item.icon);assert.ok(item.title);assert.ok(item.prompt);}
  assert.match(functionSource("canvasAgentRenderPromptSuggestions"),/titleText=t\(suggestion\.title\)[\s\S]*?title\.textContent=titleText/);
  assert.doesNotMatch(functionSource("canvasAgentRenderPromptSuggestions"),/Summary|createElement\("small"\)/);
  assert.doesNotMatch(runtime,/canvasAgentPrompt[A-Za-z]+Label/);
  assert.doesNotMatch(english,/canvasAgentPrompt[A-Za-z]+Label:/);
  assert.doesNotMatch(chinese,/canvasAgentPrompt[A-Za-z]+Label:/);
});

test("PenEcho Agent refreshes prompt intent when attachments, references, projects, or canvas state change",()=>{
  assert.match(functionSource("canvasAgentRenderAttachments"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentSyncSelection"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentSelectProject"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentEnsureProjects"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentCanvasDidChange"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentSyncPromptSuggestions"),/suggestionSet\.key!==canvasAgent\.promptSuggestionContextKey/);
});
