"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { normalizeModelEvaluation, forwardModelEvaluation } = require("../src/server/model-evaluation.js");

const valid = {
  eventId:"2a57ac2b-0c22-4c79-8eaf-99683ffada0c",
  action:"like",
  modelName:"gpt-5.6-sol",
  channel:"codex-cli",
  client:"desktop",
  platform:"macos",
  appVersion:"1.1.7",
};

test("model evaluation validation accepts only content-free fields", () => {
  assert.deepEqual(normalizeModelEvaluation(valid), valid);
  assert.equal(normalizeModelEvaluation({ ...valid, prompt:"private prompt" }), null);
  assert.equal(normalizeModelEvaluation({ ...valid, response:"private response" }), null);
  assert.equal(normalizeModelEvaluation({ ...valid, action:"dislike" }), null);
});

test("model evaluation forwarding uses the Cloud API and a bounded request", async () => {
  let call;
  await forwardModelEvaluation(async (url, options) => {
    call = { url:String(url), options };
    return { ok:true, status:202 };
  }, "https://penecho.ai", valid, 10_000);
  assert.equal(call.url, "https://penecho.ai/api/v1/model-evaluation");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(call.options.body), valid);
});

test("Canvas Agent exposes one rating chooser and retries inside the current conversation", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/client/app/canvas-agent-runtime.js"), "utf8");
  assert.match(source, /feedbackButton\.setAttribute\("aria-haspopup","menu"\)/);
  assert.match(source, /action:"like"[\s\S]*action:"criticism"/);
  assert.match(source, /actions\.append\(button,feedbackButton,retryButton\)/);
  assert.match(source, /canvasAgentSubmitMessage\(\{[\s\S]*displayTextOverride:t\("canvasAgentRetryMessage"\)[\s\S]*includeDraftMedia:false/);
  assert.match(source, /canvasAgentEvaluationContext\(\{preferSelected:true\}\)/);
  assert.match(source, /fetch\("\/api\/v1\/model-evaluation"[\s\S]*keepalive:true[\s\S]*signal:controller\.signal/);
  assert.doesNotMatch(source.match(/function canvasAgentReportEvaluation[\s\S]*?\n  }/)?.[0] || "", /\b(?:messageText|prompt|responseText|canvasContent)\s*:/i);
});
