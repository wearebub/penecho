"use strict";

// An explicit sum-type branch, not a relaxation of viewport-image validation.
// Null image/selection fields are rejected too: absence is the privacy contract.
const TEXT_ONLY_KEYS = new Set([
  "questionOnly", "questionScope", "selectionQuestion", "userAction", "trigger",
  "visibleRect", "changedBox", "canvasSize", "uiTheme", "persona",
  "reasoningEffort", "plugins", "animationEnabled",
]);
const TUTORING_ACTIONS = new Set(["hint", "answer", "auto", "continue", "explain"]);

function validTenetTextOnlyPayload(p, { canvasSize, personas, normalizeEffort }) {
  if (!p || typeof p !== "object" || Array.isArray(p) ||
      Object.keys(p).some(key => !TEXT_ONLY_KEYS.has(key)) ||
      p.questionOnly !== true || p.questionScope !== "text-only" ||
      p.userAction !== "hint" || p.trigger !== "manual" ||
      typeof p.selectionQuestion !== "string" || !p.selectionQuestion.trim() || p.selectionQuestion.length > 1000) return false;
  const validBox = box => box && typeof box === "object" && !Array.isArray(box) &&
    [box.x,box.y,box.w,box.h].every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.w > 0 && box.h > 0 &&
    box.x + box.w <= canvasSize && box.y + box.h <= canvasSize;
  if (!validBox(p.visibleRect) || !validBox(p.changedBox)) return false;
  const view = p.visibleRect, placement = p.changedBox;
  if (placement.x < view.x || placement.y < view.y || placement.x + placement.w > view.x + view.w ||
      placement.y + placement.h > view.y + view.h) return false;
  if (p.canvasSize !== undefined && (p.canvasSize?.w !== canvasSize || p.canvasSize?.h !== canvasSize)) return false;
  if (p.uiTheme !== undefined && !Object.hasOwn(personas,p.uiTheme)) return false;
  const theme = p.uiTheme ?? "studio";
  if (p.persona !== undefined && p.persona !== personas[theme]) return false;
  if (p.reasoningEffort !== undefined && normalizeEffort(p.reasoningEffort) === null) return false;
  if (p.plugins !== undefined && (!Array.isArray(p.plugins) || p.plugins.length !== 0)) return false;
  if (p.animationEnabled !== undefined && p.animationEnabled !== false) return false;
  return true;
}

function canonicalTenetTextOnlyPayload(p, { canvasSize, personas, normalizeEffort }) {
  const box = value => ({x:value.x,y:value.y,w:value.w,h:value.h});
  const uiTheme = p.uiTheme ?? "studio";
  return {
    questionOnly:true,
    questionScope:"text-only",
    selectionQuestion:p.selectionQuestion.trim(),
    userAction:"hint",
    trigger:"manual",
    visibleRect:box(p.visibleRect),
    changedBox:box(p.changedBox),
    canvasSize:{w:canvasSize,h:canvasSize},
    uiTheme,
    persona:personas[uiTheme],
    reasoningEffort:p.reasoningEffort === undefined ? "config" : normalizeEffort(p.reasoningEffort) || "config",
    plugins:[],
    animationEnabled:false,
    widgetEdit:null,
  };
}

function tenetTutoringAction(action, tenetMode, widgetEdit = false) {
  return tenetMode && !widgetEdit && TUTORING_ACTIONS.has(action) ? "hint" : action;
}

module.exports = { validTenetTextOnlyPayload, canonicalTenetTextOnlyPayload, tenetTutoringAction };
