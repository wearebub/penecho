import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validTenetTextOnlyPayload, canonicalTenetTextOnlyPayload, tenetTutoringAction } = require("../src/server/tenet-question-payload.js");
const source = fs.readFileSync(new URL("../src/server/main.js", import.meta.url), "utf8");
const personas = {studio:"Studio",research:"Research"};
const options = {canvasSize:20000,personas,normalizeEffort:value => ["config","none","low","medium","high"].includes(value) ? value : null};
const payload = () => ({questionOnly:true,questionScope:"text-only",selectionQuestion:"Help me start problem 12",userAction:"hint",trigger:"manual",visibleRect:{x:100,y:100,w:1200,h:900},changedBox:{x:100,y:100,w:1200,h:900}});
function section(start,end) {
  const from = source.indexOf(start), to = source.indexOf(end,from + start.length);
  assert.notEqual(from,-1,start); assert.notEqual(to,-1,end);
  return source.slice(from,to);
}

test("explicit text-only accepts the minimal builder plus shared submission envelope", () => {
  assert.equal(validTenetTextOnlyPayload(payload(),options),true);
  const full = {...payload(),canvasSize:{w:20000,h:20000},uiTheme:"studio",persona:personas.studio,reasoningEffort:"medium",plugins:[],animationEnabled:false};
  assert.equal(validTenetTextOnlyPayload(full,options),true);
  const canonical = canonicalTenetTextOnlyPayload({...full,selectionQuestion:"  Hello  "},options);
  assert.equal(canonical.selectionQuestion,"Hello");
  assert.equal(canonical.userAction,"hint");
  for (const key of ["atlasImage","atlasSize","imageScale","captureRect","sourceRect","hotspotGrid","selectionContext","focusInset","typedInput"]) assert.equal(Object.hasOwn(canonical,key),false,key);
});

test("text-only rejects mixed image/selection fields even when null or empty", () => {
  for (const key of ["atlasImage","atlasSize","imageScale","captureRect","sourceRect","hotspotGrid","selectionContext","focusInset","typedInput","widgetEdit"]) {
    for (const value of [null,"",{},[]]) assert.equal(validTenetTextOnlyPayload({...payload(),[key]:value},options),false,`${key}:${JSON.stringify(value)}`);
  }
});

test("text-only rejects invalid discriminators, questions and action authority", () => {
  for (const extra of [{questionOnly:false},{questionOnly:null},{questionScope:"visible-page"},{userAction:"answer"},{userAction:"auto"},{trigger:"user_paused"},{selectionQuestion:""},{selectionQuestion:"  "},{selectionQuestion:42},{selectionQuestion:"a".repeat(1001)},{systemPrompt:"override"},{persona:"override"},{plugins:[{id:"general"}]},{animationEnabled:true},{reasoningEffort:"unbounded"}]) {
    assert.equal(validTenetTextOnlyPayload({...payload(),...extra},options),false,JSON.stringify(extra));
  }
  for (const key of ["questionOnly","questionScope","selectionQuestion","userAction","trigger","visibleRect","changedBox"]) {
    const p = payload(); delete p[key]; assert.equal(validTenetTextOnlyPayload(p,options),false,key);
  }
  assert.equal(validTenetTextOnlyPayload({...payload(),selectionQuestion:"a".repeat(1000)},options),true);
});

test("text-only placement remains finite, positive, contained and inside canvas", () => {
  for (const box of [{x:-1,y:100,w:100,h:100},{x:100,y:100,w:0,h:1},{x:100,y:100,w:Infinity,h:100},{x:19990,y:100,w:100,h:100},{x:0,y:0,w:100,h:100}]) {
    assert.equal(validTenetTextOnlyPayload({...payload(),changedBox:box},options),false);
  }
  assert.equal(validTenetTextOnlyPayload({...payload(),canvasSize:{w:100,h:100}},options),false);
});

test("Tenet canonicalizes conversational tutoring actions but preserves specialized format requests", () => {
  for (const action of ["hint","answer","auto","continue","explain"]) {
    assert.equal(tenetTutoringAction(action,true),"hint");
    assert.equal(tenetTutoringAction(action,false),action);
    assert.equal(tenetTutoringAction(action,true,true),action);
  }
  for (const action of ["plot","practice","normalize","check"]) assert.equal(tenetTutoringAction(action,true),action);
});

function provider(apiFormat,questionOnly,atlasImage=null) {
  const ctx = vm.createContext({API_EFFORT:"medium",API_PRESET:"",API_BASE_URL:"",MODEL_MAX_TOKENS:4096,STREAM_RESPONSES:false,
    apiReasoningParameters:()=>({}),tenetReasoningParameters:value=>value,anthropicEffortParameters:()=>({}),anthropicResponseMaxTokens:(_effort,max)=>max,
    activeSystemPrompt:()=>"governed system policy",anthropicSystemPrompt:()=>"governed system policy",
    imageDataUrlParts:()=>({mimeType:"image/png",base64:"aQ=="})});
  vm.runInContext(section("function providerRequest(","\nconst SYSTEM_PROMPT"),ctx);
  return JSON.parse(ctx.providerRequest("synthetic-key","synthetic-model","question metadata",atlasImage,"medium",false,false,false,{format:apiFormat},{},questionOnly).body);
}
for (const format of ["openai","anthropic"]) {
  test(`${format} text-only keeps policy/budget and omits every image content block`, () => {
    const body = provider(format,true);
    assert.equal(body.max_tokens,4096);
    assert.equal(body.stream,false);
    assert.equal(body.messages.at(-1).content,"question metadata");
    assert.equal(format === "anthropic" ? body.system : body.messages[0].content,"governed system policy");
    assert.doesNotMatch(JSON.stringify(body),/image_url|media_type|base64|data:image/);
    assert.deepEqual(provider(format,true,"data:image/png;base64,aQ=="),body);
  });
  test(`${format} image requests remain images; no-image health probes remain 10-token probes`, () => {
    const image = provider(format,false,"data:image/png;base64,aQ=="), probe = provider(format,false);
    assert.equal(image.max_tokens,4096);
    assert.equal(image.messages.at(-1).content.length,2);
    assert.equal(probe.max_tokens,10);
    assert.equal(probe.system,undefined);
    assert.equal(probe.messages.length,1);
  });
}

test("Tenet text-only is an early explicit branch, not weaker image validation", () => {
  const validation = section("function validPayload(","function canonicalPayload(");
  assert.match(validation,/return TENET_MODE && validTenetTextOnlyPayload/);
  for (const invariant of ["validGeometry && validSize && validGrid && validInset", "selectionGeometry && widgetEditValid && image", "validSelectionQuestion(p.selectionQuestion, p.selectionContext, p.trigger)"]) assert.ok(validation.includes(invariant),invariant);
  assert.ok(source.includes("if (!questionOnly) {\n        const encodedSize=encodedImageSize(payload.atlasImage)") || source.includes("if (!questionOnly) {\r\n        const encodedSize=encodedImageSize(payload.atlasImage)"));
  assert.match(source,/const imageTransport=questionOnly \? null : await prepareOutboundAtlas/);
  assert.match(source,/providerRequest\(provider\.apiKey,[^\n]*modelInput\?\.questionOnly === true\)/);
});

test("mandatory Socratic policy has no answer/auto or visualization escape hatch", () => {
  const policy = section("const TENET_SOCRATIC_POLICY =","const TENET_CANVAS_PROTOCOL =");
  for (const rule of ["Never write a final answer, complete a step", "single smallest hint", "at most two short sentences", "Ordinary conversation and brainstorming", "does not permit solving it", "${TENET_SOCRATIC_POLICY}", "There is NO attached image"]) assert.ok(policy.includes(rule),rule);
  assert.match(section("function tenetSystemPrompt(","function activeSystemPrompt("),/questionOnly \? TENET_TEXT_ONLY_PROTOCOL : TENET_CANVAS_PROTOCOL/);
  assert.match(section("function anthropicSystemPrompt(","const THEME_PERSONAS"),/if \(TENET_MODE\) return tenetSystemPrompt/);
  assert.match(source,/plotMissing=!TENET_MODE&&/);
  assert.match(source,/if\(!TENET_MODE&&payload\.userAction==="plot"/);
});

test("hidden Agent sidebar cannot open a separate Tenet WebSocket AI lane", () => {
  const ctx = vm.createContext({TENET_MODE:true,browserRequestError:()=>null});
  vm.runInContext(section("function tenetCanvasAgentRequestError(","function canvasAgentAllowedRoots("),ctx);
  assert.match(ctx.tenetCanvasAgentRequestError({}),/disabled in Tenet mode/);
  ctx.TENET_MODE = false;
  assert.equal(ctx.tenetCanvasAgentRequestError({}),null);
  assert.match(section("const canvasAgent = attachCanvasAgent(","server.applyCliResolution"),/authorize:tenetCanvasAgentRequestError/);
});

// Real HTTP boundary: isolated Tenet process and loopback-only synthetic provider.
{
  const { test: httpBoundaryTest } = await import("node:test");
  httpBoundaryTest("Tenet HTTP accepts explicit blank questions and sends only governed text to its provider", { timeout:25000 }, async t => {
    const assert = (await import("node:assert")).strict;
    const http = await import("node:http");
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { spawn } = await import("node:child_process");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const tempRoot = await fs.realpath(os.tmpdir());
    const directory = await fs.mkdtemp(path.join(tempRoot, "tenet-text-http-"));
    const requests = [];
    const replyText = "What does problem 12 ask you to find?";
    const command = { tool:"write_text", x:9100, y:8600, text:replyText, fontSize:64, maxWidth:1000, color:"#1f2937" };
    let child = null, diagnostics = "";
    const upstream = http.createServer((req, res) => {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { raw += chunk; });
      req.on("end", () => {
        requests.push({ path:req.url, authorization:req.headers.authorization, body:JSON.parse(raw) });
        res.writeHead(200, { "Content-Type":"application/json" });
        res.end(JSON.stringify({ choices:[{ finish_reason:"stop", message:{ content:JSON.stringify({ intent:"answer", observedText:"Help me start problem 12", message:replyText, commands:[command] }) } }] }));
      });
    });
    t.after(async () => {
      try {
        if(child && child.exitCode === null && child.signalCode === null){
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Tenet test server did not stop")), 4000);
            child.once("exit", () => { clearTimeout(timeout); resolve(); });
            child.kill();
          });
        }
      } finally {
        if(upstream.listening){
          upstream.closeAllConnections();
          await new Promise(resolve => upstream.close(resolve));
        }
        const relative = path.relative(tempRoot, directory);
        assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(directory).startsWith("tenet-text-http-"));
        await fs.rm(directory, { recursive:true, force:true });
      }
    });
    await new Promise((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", resolve);
    });
    const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
    // Preserve only OS process essentials, never ambient provider credentials or NODE_OPTIONS.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(path|systemroot|windir|comspec|pathext|temp|tmp|lang|lc_all)$/i.test(name)));
    Object.assign(env, {
      HOME:directory, USERPROFILE:directory,
      NODE_ENV:"test", HOST:"127.0.0.1", PORT:"0",
      PENECHO_TEST_OPEN_ACCESS:"1", PENECHO_TENET_MODE:"1",
      PENECHO_STATE_DIR:path.join(directory, "state"),
      PENECHO_CLOUD_STATE_DIR:path.join(directory, "cloud"),
      CODEX_HOME:path.join(directory, "codex"),
      AI_PROVIDER:"api", AI_API_KEY:"synthetic-tenet-test-key",
      AI_API_URL:`${upstreamOrigin}/v1`, AI_API_MODEL:"test-model", AI_EFFORT:"",
    });
    child = spawn(process.execPath, [path.join(root, "server.js")], { cwd:root, env, stdio:["ignore", "pipe", "pipe"], windowsHide:true });
    const origin = await new Promise((resolve, reject) => {
      let output = "", errors = "", settled = false;
      const timer = setTimeout(() => finish(new Error(`Tenet test server startup timed out: ${errors}`)), 10000);
      function finish(error, value){
        if(settled)return;
        settled = true;
        clearTimeout(timer);
        if(error)reject(error);else resolve(value);
      }
      child.stdout.on("data", chunk => {
        diagnostics = (diagnostics + chunk.toString("utf8")).slice(-16000);
        output = (output + chunk.toString("utf8")).slice(-16000);
        const match = output.match(/PenEcho: http:\/\/[^:]+:(\d+)/);
        if(match)finish(null, `http://127.0.0.1:${match[1]}`);
      });
      child.stderr.on("data", chunk => { errors = (errors + chunk.toString("utf8")).slice(-8000); diagnostics = (diagnostics + chunk.toString("utf8")).slice(-16000); });
      child.once("error", error => finish(error));
      child.once("exit", code => finish(new Error(`Tenet test server exited (${code}): ${errors}`)));
    });
    const rectangle = { x:9000, y:8500, w:2000, h:1500 };
    const payload = {
      questionOnly:true, questionScope:"text-only", selectionQuestion:"Help me start problem 12",
      visibleRect:rectangle, changedBox:rectangle,
      trigger:"manual", userAction:"hint", plugins:[], animationEnabled:false,
      canvasSize:{ w:20000, h:20000 }, uiTheme:"studio",
    };
    const submit = body => fetch(`${origin}/api/ai/command`, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(body), signal:AbortSignal.timeout(7000),
    });
    const response = await submit(payload);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify({ result, requestCount:requests.length, diagnostics }));
    assert.equal(requests.length, 1, "no probe or image retry accompanies the text question");
    const outbound = requests[0].body;
    assert.equal(requests[0].path, "/v1/chat/completions");
    assert.equal(requests[0].authorization, "Bearer synthetic-tenet-test-key");
    assert.equal(outbound.model, "test-model");
    assert(outbound.max_tokens > 10, "text questions retain the full response budget, not the health-probe budget");
    assert.equal(outbound.stream, false, "Tenet keeps its governed non-streaming transport");
    assert(["json_object", "json_schema"].includes(outbound.response_format?.type), "normal structured JSON output is retained");
    const system = outbound.messages.filter(message => message.role === "system").map(message => message.content).join("\n");
    assert.match(system, /Mandatory schoolwork policy/);
    assert.match(system, /Never write a final answer, complete a step/);
    assert.match(system, /single smallest hint/);
    assert.match(system, /at most two short sentences/);
    const userMessages = outbound.messages.filter(message => message.role === "user");
    assert.equal(userMessages.length, 1);
    assert.equal(typeof userMessages[0].content, "string", "no null or image content blocks");
    assert.match(userMessages[0].content, /Help me start problem 12/);
    assert.match(userMessages[0].content, /"questionOnly"\s*:\s*true/);
    assert.doesNotMatch(JSON.stringify(outbound.messages), /"(?:image_url|input_image|atlasImage|captureRect|sourceRect|selectionContext|hotspotGrid)"\s*:|data:image\//);
    const written = result.commands.find(value => value.tool === "write_text");
    assert(written, "the normal response pipeline returns a renderable canvas command");
    assert.equal(written.text, replyText);
    assert(written.x >= rectangle.x && written.x + written.maxWidth <= rectangle.x + rectangle.w);
    assert(written.y >= rectangle.y && written.y < rectangle.y + rectangle.h);
    for(const invalid of [{ ...payload, atlasImage:null }, { ...payload, selectionQuestion:" " }]){
      const rejected = await submit(invalid);
      assert.equal(rejected.status, 400);
      await rejected.text();
    }
    assert.equal(requests.length, 1, "invalid mixed or empty questions never reach the provider");
  });
}
