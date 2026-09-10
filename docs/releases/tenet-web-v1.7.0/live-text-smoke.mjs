import assert from 'node:assert/strict';

// Operator-only loopback smoke test. Never contains student work or credentials.
// This verifies deployed server/Gateway behavior, not the public sign-in flow.
const box = {x:8000,y:8000,w:2000,h:1500};
const payload = {
  questionOnly:true, questionScope:'text-only',
  selectionQuestion:'Help me choose one topic for a blank notebook page.',
  userAction:'hint', trigger:'manual', visibleRect:box, changedBox:box,
  canvasSize:{w:20000,h:20000}, reasoningEffort:'low',
  plugins:[], animationEnabled:false,
};
const response = await fetch('http://127.0.0.1:3888/api/ai/command', {
  method:'POST', headers:{'Content-Type':'application/json', Origin:'http://127.0.0.1:3888'},
  body:JSON.stringify(payload), signal:AbortSignal.timeout(90000),
});
const text = await response.text();
let result;
try { result=JSON.parse(text); } catch { throw new Error(`Non-JSON response: HTTP ${response.status}`); }
assert.equal(response.status,200,`HTTP ${response.status}: ${result.code || result.error || 'request failed'}`);
assert(Array.isArray(result.commands) && result.commands.length>0,'No renderable reply');
console.log(JSON.stringify({
  checkedAt:new Date().toISOString(), status:response.status,
  requestId:result.requestId, commandCount:result.commands.length,
  tools:result.commands.map(command=>command.tool), requestHasImage:false,
  questionOnly:true, synthetic:true, surface:'operator-loopback-to-deployed-Gateway',
}));
