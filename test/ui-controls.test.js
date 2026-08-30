"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const selectionMath = require(path.join(ROOT, "public/selection.js"));
const functionSource = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const body = source.indexOf("{", start);
  let depth = 0;
  for (let index = body; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
};

test("selected pen width stays at 4-8 px while pressure tips can render below 4 px", () => {
  const html = read("public/index.html"), app = read("public/app.js");
  const control = html.match(/<input id="penSize"[^>]*>/)?.[0] || "";
  assert.match(control, /min="4"/);
  assert.match(control, /max="8"/);
  assert.match(control, /step="1"/);
  assert.match(control, /value="4"/);
  assert.match(app, /PEN_STROKE_MIN = 1,[\s\S]*?PEN_PRESSURE_TIP_RATIO = 0\.25,[\s\S]*?PEN_SIZE_MIN = 4,[\s\S]*?PEN_SIZE_MAX = 8/);
  const clampSource = functionSource(app, "clampPenWidth"), strokeClampSource = functionSource(app, "clampStrokeWidth"), pressureSource = functionSource(app, "pressureWidth");
  assert.match(clampSource, /Math\.max\(PEN_SIZE_MIN, Math\.min\(PEN_SIZE_MAX, width\)\)/);
  assert.match(strokeClampSource, /Math\.max\(PEN_STROKE_MIN, Math\.min\(PEN_SIZE_MAX, width\)\)/);
  assert.match(pressureSource, /tip = Math\.max\(PEN_STROKE_MIN, state\.pen \* PEN_PRESSURE_TIP_RATIO\)[\s\S]*?Math\.sqrt\(pressure\)/);
  assert.match(app, /document\.querySelector\("#penSize"\)\.oninput = \(e\) => \{[\s\S]*?state\.pen = clampPenWidth\(Math\.round\(Number\(e\.target\.value\)\)\)/);
  const clamp = Function("PEN_SIZE_MIN", "PEN_SIZE_MAX", `return (${clampSource});`)(4, 8);
  assert.deepEqual([clamp(2), clamp(6), clamp(12)], [4, 6, 8]);
  const strokeClamp = Function("PEN_STROKE_MIN", "PEN_SIZE_MIN", "PEN_SIZE_MAX", `return (${strokeClampSource});`)(1, 4, 8),
    state = { pen:8 }, pressureWidth = Function("state", "clampStrokeWidth", "PEN_STROKE_MIN", "PEN_PRESSURE_TIP_RATIO", `return (${pressureSource});`)(state, strokeClamp, 1, 0.25);
  assert.equal(pressureWidth({ pointerType:"pen", pressure:1 }), 8);
  state.pen = 4;
  assert.equal(pressureWidth({ pointerType:"pen", pressure:0 }), 1);
  assert.ok(pressureWidth({ pointerType:"pen", pressure:0.1 }) < 4);
  assert.equal(pressureWidth({ pointerType:"mouse", pressure:0.1 }), 4);
});

test("active pen drawing consumes valid deduplicated coalesced samples only", () => {
  const app = read("public/app.js"), samplesSource = functionSource(app, "drawingPointerSamples"),
    drawingPointerSamples = vm.runInNewContext(`(${samplesSource})`),
    first = { pointerType:"pen", pointerId:7, clientX:10, clientY:11, pressure:0.2 },
    second = { pointerType:"pen", pointerId:7, clientX:12, clientY:13, pressure:0.3 },
    event = {
      pointerType:"pen", pointerId:7, clientX:14, clientY:15, pressure:0.4,
      getCoalescedEvents:() => [first, first, { pointerId:8, clientX:11, clientY:12, pressure:0.25 }, second],
    },
    samples = drawingPointerSamples(event);
  assert.deepEqual(Array.from(samples, sample => [sample.clientX, sample.clientY, sample.pressure]), [
    [10, 11, 0.2], [12, 13, 0.3], [14, 15, 0.4],
  ]);
  let mouseCoalescedRead = false;
  const mouse = { pointerType:"mouse", clientX:1, clientY:2, getCoalescedEvents:() => { mouseCoalescedRead = true; return [first]; } };
  assert.equal(drawingPointerSamples(mouse)[0], mouse);
  assert.equal(mouseCoalescedRead, false);
  const pointerMove = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)"));
  assert.match(pointerMove, /if \(!state\.drawing \|\| state\.drawing\.id !== e\.pointerId\) return;[\s\S]*?d\.erase \? \[e\] : drawingPointerSamples\(e\)/);
  assert.match(pointerMove, /for \(const sample of[\s\S]*?cssSize = d\.erase \? state\.eraser : pressureWidth\(sample\)[\s\S]*?stroke\(a, p, d\.erase, size, true\)/);
});

test("canvas file actions are in the top-right header and available in History", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  const topRow = html.indexOf('class="top-row"'), toolbar = html.indexOf('class="toolbar"'), files = html.indexOf('id="canvasFileActions"');
  assert.ok(topRow < files && files < toolbar);
  assert.ok(html.indexOf('id="newCanvasBtn"') < html.indexOf('id="exportPngBtn"'));
  assert.ok(html.indexOf('id="exportPngBtn"') < html.indexOf('id="historyBtn"'));
  assert.doesNotMatch(html, /id="tourReplayBtn"/);
  assert.match(html, /id="settingsBtn"[^>]*aria-controls="settingsPanel"[\s\S]*?<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(css, /\.canvas-file-actions button,\s*#settingsBtn\s*\{[^}]*display:\s*grid;[^}]*width:\s*29px;[^}]*flex:\s*0 0 29px/);
  assert.match(css, /\.canvas-file-actions button svg,\s*#settingsBtn svg\s*\{[^}]*fill:\s*none;[^}]*stroke:\s*currentColor/);
  for (const id of ["historySaveCurrent", "newCanvasDialog", "newDiscard", "newSaveCopy", "newOverwrite", "saveCanvasBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="currentSnapshotLabel"[^>]*hidden/);
  assert.match(css, /\.new-canvas-dialog \.current-snapshot\[hidden\]\s*\{\s*display:\s*none/);
  for (const id of ["historyNew", "newCanvasCancel"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.match(html, /class="new-canvas-actions"[\s\S]*?id="newDiscard"[\s\S]*?class="new-canvas-action-group"[\s\S]*?id="newOverwrite"[\s\S]*?id="newSaveCopy"/);
  assert.match(css, /\.new-canvas-actions\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between/);
  assert.match(css, /\.new-canvas-action-group\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end/);
  assert.doesNotMatch(css, /\.new-canvas-actions\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  assert.match(app, /currentSnapshotId:\s*null/);
  assert.match(app, /saveSnapshot\(\{\s*overwriteId\s*=\s*null,\s*name\s*=\s*null,\s*location\s*=\s*state\.snapshotLocation\s*\}/);
  assert.match(app, /completeNewCanvas\("overwrite"\)/);
  assert.match(app, /function startBlankCanvas\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "startBlankCanvas"), /state\.aiDraftReturnMode = null[\s\S]*?setCanvasNavigationLocked\(false\)[\s\S]*?setCanvasMode\("pen", \{/);
  assert.match(functionSource(app, "loadSnapshot"), /clearTextEditors\(\)/);
  assert.match(functionSource(app, "renderSnapshotList"), /runSnapshotLoadAction\(load, \(\) => requestLoadSnapshot\(item\.id, location\)\)/);
  assert.match(functionSource(app, "runSnapshotLoadAction"), /if \(button\.disabled\) return;[\s\S]*?button\.disabled = true[\s\S]*?await runSnapshotAction\(action\)[\s\S]*?button\.disabled = false/);
});

test("canvas connection editor uses editable Kimi and MiniMax presets without connection names", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  assert.doesNotMatch(html, /id="settingsConnectionName"|name="connectionName"/);
  for (const value of ["openai", "anthropic", "kimi", "minimax"]) {
    assert.match(html, new RegExp(`<option value="${value}"`));
  }
  assert.match(html, /id="settingsApiPresetFields"[^>]*hidden/);
  assert.match(html, /id="settingsApiRegion"/);
  assert.match(html, /id="settingsApiService"/);
  assert.match(html, /id="settingsApiModel"[^>]*list="settingsApiModelPresets"/);
  const effortInput = html.match(/<input id="settingsEffort"[^>]*>/)?.[0] || "",
    effortOptions = html.match(/<div id="settingsEffortOptions"[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(effortInput, /role="combobox"/);
  assert.match(effortInput, /aria-controls="settingsEffortOptions"/);
  assert.match(effortInput, /aria-expanded="false"/);
  assert.match(effortInput, /autocomplete="off"/);
  assert.match(effortInput, /spellcheck="false"/);
  assert.match(effortInput, /required/);
  assert.match(html, /id="settingsEffortToggle"[^>]*aria-haspopup="listbox"[^>]*aria-controls="settingsEffortOptions"/);
  assert.match(effortOptions, /role="listbox"[^>]*hidden/);
  assert.doesNotMatch(effortOptions, /Provider default|Extra high|Maximum|>None<|>Low<|>Medium<|>High</);
  for (const effort of ["none", "low", "medium", "high", "xhigh", "max"]) assert.match(effortOptions, new RegExp(`data-effort-value="${effort}"[^>]*>${effort}</button>`));
  assert.match(functionSource(app, "showSettingsEffortOptions"), /hidden = false[\s\S]*aria-expanded/);
  assert.match(functionSource(app, "chooseSettingsEffort"), /settingsEffort\.value = String\(value/);
  assert.match(functionSource(app, "handleSettingsEffortKeydown"), /Escape[\s\S]*ArrowDown/);
  assert.match(html, /data-effort="config"[^>]*>[\s\S]*?Configured/);
  assert.match(html, /id="settingsTestConnection"[^>]*data-i18n="settingsTestConnection"/);
  assert.match(html, /id="settingsInstallCli"[^>]*hidden[^>]*data-i18n="settingsInstallCli"/);
  assert.match(html, /id="settingsCliPath"[^>]*type="hidden"/);
  assert.doesNotMatch(html, /<label><span data-i18n="settingsCliPath"/);
  for (const id of ["settingsCliStatus", "settingsCliStatusTitle", "settingsCliStatusDetail", "settingsCliCommandRow", "settingsCliCommand", "settingsCliCopyCommand"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const endpoint of [
    "https://api.moonshot.ai/v1", "https://api.moonshot.cn/v1", "https://api.kimi.com/coding/v1",
    "https://api.minimax.io/v1", "https://api.minimax.io/anthropic", "https://api.minimaxi.com/v1", "https://api.minimaxi.com/anthropic",
  ]) assert.match(app, new RegExp(endpoint.replaceAll(".", "\\.")));
  for (const model of ["k3", "kimi-k3", "MiniMax-M3", "MiniMax-M2.7"]) assert.match(app, new RegExp(`"${model.replaceAll(".", "\\.")}"`));
  assert.match(app, /function connectionTitle\(connection\)/);
  assert.match(app, /return connection\.provider === "api" \? connection\.apiModel \|\| "API" : connection\.cliModel/);
  assert.match(functionSource(app, "renderConnectionLists"), /settings-connection-quick\$\{connection\.active \? " active" : ""\}[\s\S]*?editing = settings\.editingConnectionId === connection\.id[\s\S]*?settings-connection-item\$\{editing \? " editing" : ""\}/);
  assert.match(functionSource(app, "fillConnectionEditor"), /settings\.editingConnectionId = connection\?\.id \|\| null[\s\S]*?renderConnectionLists\(\)/);
  assert.match(functionSource(app, "hideConnectionEditor"), /settings\.editingConnectionId = null[\s\S]*?renderConnectionLists\(\)/);
  assert.match(functionSource(app, "defaultConnectionEffort"), /return "medium"/);
  assert.match(functionSource(app, "fillConnectionEditor"), /connection\?\.effort \|\| defaultConnectionEffort\(provider\)/);
  assert.match(functionSource(app, "testCanvasConnection"), /\/api\/settings\/connections\/test[\s\S]*?settings\.editingConnectionId[\s\S]*?body\?\.installable/);
  assert.match(functionSource(app, "installCanvasCli"), /penechoDesktop\.installCli\(provider\)[\s\S]*?settingsCliPath\.value = result\.executable[\s\S]*?testCanvasConnection\(\)/);
  assert.match(functionSource(app, "updateSettingsProviderFields"), /inspectCanvasCli\(provider\)/);
  assert.match(functionSource(app, "inspectCanvasCli"), /\/api\/settings\/connections\/inspect-cli[\s\S]*?renderCanvasCliStatus\(body\.status\)/);
  assert.match(functionSource(app, "renderCanvasCliStatus"), /status\.state === "missing"[\s\S]*?showCliCommand\(status\.installCommand\)[\s\S]*?showCliInstaller\(status\.provider, true\)/);
  assert.match(functionSource(app, "installCanvasCli"), /settingsCliManualFallback/);
  assert.match(functionSource(app, "copyCanvasCliCommand"), /writeClipboardText\(command\)/);
  assert.match(html, /id="settingsKimiCliRecommendation"[^>]*role="note"[^>]*hidden/);
  assert.match(html, /https:\/\/api\.kimi\.com\/coding\/v1[\s\S]*?https:\/\/www\.kimi\.com\/code\/console/);
  assert.match(functionSource(app, "updateSettingsProviderFields"), /settingsKimiCliRecommendation\.hidden = provider !== "kimi-cli"/);
  assert.match(css, /\.settings-provider-notice\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.settings-cli-status\[data-state="missing"\]/);
  assert.match(css, /\.settings-cli-command code\s*\{/);
  for (const key of ["settingsCliChecking", "settingsCliMissing", "settingsCliCopyCommand", "settingsCliManualFallback"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  for (const key of ["settingsKimiCodingRecommendationTitle", "settingsKimiCodingRecommendationBody", "settingsKimiCodingConsole", "settingsKimiCodingRecommendationReason"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(css, /\.settings-connection-item\.editing\s*\{/);
  assert.match(css, /\.settings-combobox-toggle\s*\{[^}]*position:\s*absolute[^}]*cursor:\s*pointer/);
  assert.match(css, /\.settings-combobox-options\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*12/);
  assert.doesNotMatch(css, /\.settings-connection-item\.active\s*\{/);
  assert.match(css, /\.settings-panel, \.configuration-panel\s*\{[^}]*color-scheme:\s*light[^}]*--panel-raised:\s*var\(--studio-panel/);
  assert.match(css, /\.settings-save\s*\{[^}]*color:\s*#fff;[^}]*background:\s*var\(--gold\)/);
  assert.match(css, /\.connection-manager > header button\s*\{[^}]*height:\s*32px[^}]*color:\s*var\(--ink\)[^}]*background:\s*transparent/);
  assert.match(html, /id="summonToggleLabel"[^>]*data-i18n="settingsSummonSection"/);
  assert.doesNotMatch(html, /settingsSummonEnabled|settingsSummonDescription/);
  assert.equal((html.match(/class="settings-links"/g) || []).length, 1, "web Settings keeps the download and GitHub links");
  assert.match(app, /if \(window\.penechoDesktop\) document\.querySelector\("\.settings-links"\)\?\.remove\(\)/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.settings-panel/);
  for (const key of ["settingsApiRegion", "settingsApiService", "settingsApiServiceCoding"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("API connection models can be fetched into an editable dropdown", () => {
  const html = read("public/index.html"), core = read("src/client/app/core.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const format = html.indexOf('id="settingsApiFormat"'), url = html.indexOf('id="settingsApiUrl"'), key = html.indexOf('id="settingsApiKey"'), model = html.indexOf('id="settingsApiModel"'), fetchButton = html.indexOf('id="settingsFetchModels"');
  assert.ok(format > -1 && format < url && url < key && key < model && model < fetchButton);
  assert.match(html, /id="settingsApiModel"[^>]*list="settingsApiModelPresets"[^>]*role="combobox"[^>]*aria-controls="settingsApiModelOptions"/);
  assert.match(html, /id="settingsApiModelOptions"[^>]*role="listbox"[^>]*hidden/);
  assert.match(html, /id="settingsFetchModels"[^>]*aria-busy="false/);
  assert.match(html, /<span data-i18n="settingsFetchModels">Fetch models<\/span>/);
  assert.match(functionSource(core, "fetchConnectionModels"), /connectionEditorPayload\(\)[\s\S]*?\/api\/settings\/connections\/models[\s\S]*?id:settings\.editingConnectionId/);
  assert.match(functionSource(core, "fetchConnectionModels"), /settings\.fetchedApiModels = normalizeFetchedApiModels[\s\S]*?if \(!settingsApiModel\.value\.trim\(\)/);
  assert.match(functionSource(core, "fetchConnectionModels"), /requestSignature[\s\S]*?connectionModelDiscoverySignature\(\)[\s\S]*?setSettingsStatus\(\)[\s\S]*?return/);
  assert.match(functionSource(core, "normalizeFetchedApiModels"), /\.sort\(\(a, b\)/);
  assert.match(functionSource(core, "updateConnectionModelFetchState"), /aria-busy[\s\S]*settingsFetchingModels/);
  assert.match(core, /API_DEFAULTS = Object\.freeze\(\{[\s\S]*?openai:[\s\S]*?https:\/\/api\.openai\.com\/v1[\s\S]*?anthropic:[\s\S]*?https:\/\/api\.anthropic\.com/);
  assert.match(functionSource(core, "updateApiPresetFields"), /selectedApiPreset\(\) \|\| API_DEFAULTS\[family\][\s\S]*?settingsApiUrl\.value = defaults\.url/);
  assert.match(functionSource(core, "handleApiModelKeydown"), /Escape[\s\S]*ArrowDown/);
  assert.match(bootstrap, /settingsFetchModels\?\.addEventListener\("click"[^\n]*fetchConnectionModels/);
  assert.match(bootstrap, /settingsApiModelOptions\?\.addEventListener\("click"[\s\S]*?chooseApiModel/);
  assert.match(css, /\.settings-model-control\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.settings-fetch-models\s*\{[^}]*height:\s*36px[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.settings-combobox-options\[hidden\]\s*\{\s*display:\s*none/);
  for (const keyName of ["settingsFetchModels", "settingsFetchingModels", "settingsModelsFetched", "settingsModelFetchFailed", "settingsModelSuggestions"]) {
    assert.match(core, new RegExp(`${keyName}:`));
    assert.match(zh, new RegExp(`${keyName}:`));
  }
  assert.equal(app, require("../scripts/build-client.js").compiledSource(), "public/app.js must match client sources");
});

test("closing Settings moves focus outside before hiding it from accessibility APIs", () => {
  const closeSettings = functionSource(read("public/app.js"), "closeSettings");
  const focusMove = closeSettings.indexOf("settingsLayer.contains(document.activeElement)");
  const hideLayer = closeSettings.indexOf("settingsLayer.hidden = true");
  const hideFromAccessibility = closeSettings.indexOf('settingsLayer.setAttribute("aria-hidden", "true")');
  assert.ok(focusMove >= 0 && focusMove < hideLayer && hideLayer < hideFromAccessibility);
  assert.match(closeSettings, /restoreTarget\?\.focus\(\{ preventScroll:true \}\)/);
});

test("canvas photos use one picker, editable image records, side action bar, and dirty Auto AI", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js"), css = read("public/style.css"),
    end = functionSource(app, "end"),
    save = functionSource(app, "save"),
    loadSnapshot = functionSource(app, "loadSnapshot"),
    startBlankCanvas = functionSource(app, "startBlankCanvas"),
    renderExportCanvas = functionSource(app, "renderExportCanvas"),
    snapshotPreview = functionSource(app, "snapshotPreview"),
    prepareImportedImage = functionSource(app, "prepareImportedImage");

  assert.match(html, /id="imagePickerBtn"/);
  assert.match(html, /id="imagePickerInput" type="file" accept="image\/\*" hidden/);
  assert.doesNotMatch(html, /id="imagePickerInput"[^>]*\bcapture\b/);
  assert.match(app, /MAX_VISIBLE_IMAGES = 100/);
  assert.match(app, /MAX_IMAGE_DIMENSION = 2048/);
  assert.match(prepareImportedImage, /scale = Math\.min\(1, MAX_IMAGE_DIMENSION \/ sourceW, MAX_IMAGE_DIMENSION \/ sourceH/);
  assert.match(app, /function canvasIdentityGeneration\(\)/);
  assert.match(app, /function beginCanvasPointerAction\(e, point\)/);
  assert.doesNotMatch(app, /beginImageTouchHold|imageTouchHold|IMAGE_TOUCH_HOLD/);
  assert.match(app, /state\.mode !== "hand"[\s\S]{0,120}?beginCanvasPointerAction\(e, clientPoint\(e\)\)/);
  assert.match(functionSource(app, "objectChromeSpecs"), /target:"image"/);
  const mergeImage = functionSource(app, "mergeImage"),
    beginImageGesture = functionSource(app, "beginImageGesture"),
    addImageFile = functionSource(app, "addImageFile"),
    imageControlHit = functionSource(app, "imageControlHit"),
    imageRecord = functionSource(app, "imageRecord"),
    resizeImageBox = functionSource(app, "resizeImageBox"),
    drawImageChrome = functionSource(app, "drawImageChrome"),
    renderInteractionLayer = functionSource(app, "renderInteractionLayer"),
    resizeImage = vm.runInNewContext(`(${resizeImageBox})`, { SIZE:20000 }),
    resizeStart = { x:100, y:200, w:1200, h:800 };
  assert.doesNotMatch(addImageFile, /requestAI|buildViewportImage/);
  assert.match(addImageFile, /state\.dirtyImageIds\.add\(item\.id\)[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?state\.autoEligible = true/);
  assert.match(functionSource(app, "viewportHasWidgetRefineInput"), /state\.dirty && visible && intersection\(state\.dirty, visible\)/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /dirtyBox = state\.dirty && visible \? intersection\(state\.dirty, visible\) : null/);
  assert.match(functionSource(app, "requestWidgetRefinement"), /attentionBox:refineInputBox/);
  assert.match(addImageFile, /enterManualImageHandMode\(\)[\s\S]{0,80}?beginImageEdit\(item\)[\s\S]{0,80}?showHandObjectToolbar\("image", item\)/);
  assert.match(functionSource(app, "finishManualImageHandMode"), /imageHandReturnMode/);
  for (const name of ["acceptImageEdit", "cancelImageEdit", "deleteImage", "mergeImage"]) {
    assert.match(functionSource(app, name), /finishManualImageHandMode\(\)/);
  }
  assert.doesNotMatch(beginImageGesture, /result\.hit === "(accept|merge|cancel)"/);
  assert.match(mergeImage, /recordBefore\(tx, ty\)[\s\S]{0,160}?drawImage\(item\.image/);
  assert.match(mergeImage, /extendInkBounds\(key\(tx, ty\)/);
  assert.match(mergeImage, /state\.images\.filter/);
  assert.match(mergeImage, /trackMergedImageAsDirty\(item, box\)[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?state\.autoEligible\s*=\s*true[\s\S]*?saveUserCanvasChange\(\)[\s\S]*?schedule\(\)/);
  assert.doesNotMatch(imageControlHit, /draftActionPoints|merge/);
  assert.doesNotMatch(drawImageChrome, /drawDraftActions|drawImageMergeAction/);
  assert.deepEqual({ ...resizeImage(resizeStart, { x:15100, y:0 }, "width") }, { ...resizeStart, w:15000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:0, y:15200 }, "height") }, { ...resizeStart, h:15000 });
  assert.deepEqual({ ...resizeImage(resizeStart, { x:15100, y:10200 }, "resize") }, { ...resizeStart, w:15000, h:10000 });
  assert.doesNotMatch(resizeImageBox, /6000|MAX_IMAGE_PIXELS/);
  assert.doesNotMatch(imageRecord, /n\(item\.(?:w|h), 80, 6000\)|item\.w \* item\.h > MAX_IMAGE_PIXELS/);
  for (const id of ["imageEditBar", "imageMergeBtn"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const id of ["imagePlaceBtn", "imageDeleteBtn"]) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.match(css, /\.image-edit-bar \{/);
  assert.match(css, /\.image-action-hint \{/);
  assert.match(app, /function positionImageEditBar\(\)/);
  assert.match(functionSource(app, "positionImageEditBar"), /imageSelectionMaterial\.hidden = true[\s\S]*?--image-selection-x[\s\S]*?--image-selection-height/);
  assert.doesNotMatch(functionSource(app, "positionImageEditBar"), /imagePlaceButton|placePosition|image-place-control|--object-control-x/);
  assert.match(renderInteractionLayer, /positionImageEditBar\(\)/);
  assert.match(functionSource(app, "objectChromeSpecs"), /record\.kind === "image"[\s\S]*?imageToolGroup = `image-\$\{handTarget\.id\}-tools`[\s\S]*?kind:"move"[\s\S]*?widgetCore:true[\s\S]*?kind:"cancel"[\s\S]*?label:t\("imageDelete"\)[\s\S]*?deleteImage\(handTarget\)[\s\S]*?kind:"accept"[\s\S]*?label:t\("imagePlace"\)[\s\S]*?acceptImageEdit\(\{ showHint:true \}\)/);
  assert.match(app, /imageMergeButton\.onclick =[\s\S]{0,100}?mergeImage\(item, \{ showHint:true \}\)/);
  assert.doesNotMatch(app, /imagePlaceButton|imageDeleteButton/);
  assert.match(app, /images = storedImages\(\)/);
  assert.match(loadSnapshot, /decodeSnapshotImagesInBatches\(item\.images, loadIsCurrent/);
  assert.match(loadSnapshot, /restoreImages\(images\)/);
  assert.match(startBlankCanvas, /restoreImages\(\[\]\)/);
  assert.match(save, /imagesBefore[\s\S]*?imagesAfter[\s\S]*?const entry = \{[^}]*imagesBefore, imagesAfter[^}]*\}[\s\S]*?state\.history\.push\(entry\)/);
  assert.match(renderExportCanvas, /drawImagesToContext\(context, region\)/);
  assert.ok(renderExportCanvas.indexOf("drawWidgetsToContext(context, region)") < renderExportCanvas.indexOf("drawImagesToContext(context, region)"));
  assert.ok(snapshotPreview.indexOf("drawWidgetsToContext(q, bounds)") < snapshotPreview.indexOf("drawImagesToContext(q, bounds)"));
  assert.doesNotMatch(end, /imageTouchHold|cancelImageTouchHold/);
  assert.ok(end.indexOf("state.imageGesture") < end.indexOf("state.pendingGesture"));
  assert.equal((app.match(/imagePickerButton\.addEventListener\("click"/g) || []).length, 1);
  for (const key of ["addImage", "imageAdded", "imageSelected", "imageDeleted", "imageMerged", "imageEditBarLabel", "imagePlace", "imagePlaceHint", "imageMerge", "imageMergeHint", "imageDelete", "imageDeleteHint", "snapshotImages"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("hand is the only object interaction mode and uses dedicated, clamped move handles", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    handIndex = html.indexOf('data-mode="hand"'),
    penIndex = html.indexOf('data-mode="pen"'),
    pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')),
    mode = functionSource(app, "setCanvasMode"),
    modePresentation = functionSource(app, "syncCanvasModePresentation"),
    autoControl = functionSource(app, "updateAutoControl"),
    handStatusHint = functionSource(app, "showHandStatusHint"),
    acceptImageEdit = functionSource(app, "acceptImageEdit"),
    mergeImage = functionSource(app, "mergeImage"),
    acceptWidgetEdit = functionSource(app, "acceptWidgetEdit"),
    acceptPendingWidget = functionSource(app, "acceptPendingWidget"),
    acceptAnimationEdit = functionSource(app, "acceptAnimationEdit"),
    confirmTextEditor = functionSource(app, "confirmTextEditor"),
    acceptPending = functionSource(app, "acceptPending"),
    refineHoverOutline = functionSource(app, "drawWidgetRefineButtonHoverOutline"),
    refineClickPulse = functionSource(app, "drawWidgetRefineClickPulse"),
    createChromeButton = functionSource(app, "createObjectChromeButton"),
    syncChrome = functionSource(app, "syncObjectChrome"),
    chromeSpecs = functionSource(app, "objectChromeSpecs"),
    chromeMove = functionSource(app, "beginObjectChromeMove"),
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{ panX:0, panY:-180, scale:1 },
      view:{ clientWidth:900, clientHeight:600 },
      screenObjectBox:(box) => ({ left:box.x, top:box.y - 180, width:box.w, height:box.h }),
    });

  assert.ok(handIndex >= 0 && handIndex < penIndex);
  assert.match(html, /id="handToolBtn"[^>]*data-mode="hand"[^>]*aria-pressed="false"[^>]*data-i18n-aria="hand"/);
  assert.match(app, /mode:\s*"pen"/);
  assert.match(app, /hand:\s*"Hand tool: move canvas and objects"/);
  assert.match(zh, /hand:\s*"小手：移动画布和对象"/);
  assert.match(app, /handAutoAIManual:\s*"Hand mode pauses Auto AI · Use the AI button to run it manually\."/);
  assert.match(zh, /handAutoAIManual:\s*"Hand 模式暂停自动 AI · 请点击 AI 按钮手动运行"/);
  for (const key of ["handAutoAIResume", "handWidgetConfirmedHint", "handImageConfirmedHint", "handImageMergedHint", "handAnimationConfirmedHint", "handTextConfirmedHint", "handDraftConfirmedHint"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(autoControl, /disabled = state\.mode === "hand" && state\.auto/);
  assert.match(autoControl, /button\.disabled = disabled/);
  assert.match(autoControl, /button\.setAttribute\("aria-disabled", String\(disabled\)\)/);
  assert.match(handStatusHint, /state\.mode !== "hand" \|\| state\.busy/);
  assert.match(handStatusHint, /statusHintRotation\.get\(action\)[\s\S]*?% candidates\.length/);
  assert.match(handStatusHint, /setStatusKey\(candidates\[index\]\)/);
  assert.match(mode, /if \(mode === "hand"\) \{[\s\S]*?clearTimeout\(state\.timer\);[\s\S]*?state\.timer = 0/);
  assert.match(mode, /state\.mode = mode;[\s\S]*?updateAutoControl\(\)/);
  assert.match(mode, /if \(mode === "hand" && options\.showHint && !state\.busy\)[\s\S]*?showHandStatusHint\("hand-mode", \["handAutoAIManual", "handAutoAIResume"\]\)/);
  assert.doesNotMatch(mode, /setAutoEnabled|state\.autoEligible|supersedeActiveAI|controller\.abort/);
  assert.match(acceptImageEdit, /options\.showHint[\s\S]*?showHandStatusHint\("image-confirmed"/);
  assert.match(mergeImage, /options\.showHint[\s\S]*?showHandStatusHint\("image-merged"/);
  assert.match(acceptWidgetEdit, /options\.showHint[\s\S]*?showHandStatusHint\("widget-confirmed"/);
  assert.match(acceptPendingWidget, /options\.showHint[\s\S]*?showHandStatusHint\("widget-draft-confirmed"/);
  assert.match(acceptAnimationEdit, /options\.showHint[\s\S]*?showHandStatusHint\("animation-confirmed"/);
  assert.match(confirmTextEditor, /options\.showHint[\s\S]*?showHandStatusHint\("text-confirmed"/);
  assert.match(acceptPending, /options\.showHint[\s\S]*?showHandStatusHint\("ai-draft-confirmed"/);
  assert.match(chromeSpecs, /record\.kind === "image"[\s\S]*?kind:"cancel"[\s\S]*?deleteImage\(handTarget\)[\s\S]*?kind:"accept"[\s\S]*?acceptImageEdit\(\{ showHint:true \}\)/);
  assert.match(app, /mergeImage\(item, \{ showHint:true \}\)/);
  assert.match(app, /acceptPending\(\{ showHint:true \}\)/);
  assert.match(app, /acceptPendingWidget\(\{ showHint:true \}\)/);
  assert.match(modePresentation, /view\.classList\.toggle\("hand-mode", mode === "hand"\)/);
  assert.match(mode, /requestInteractionLayerRender\(\)/);
  assert.match(mode, /eraserMode = \["eraser", "area-eraser"\]\.includes\(mode\)[\s\S]*?finalizingPendingWidgetForEraser = eraserMode[\s\S]*?\["hand", "pen"\]\.includes\(state\.mode\)[\s\S]*?acceptPendingWidget\(\{ restoreMode:false, allowRevisionMismatch:true \}\)/);
  assert.match(mode, /leavingDraftHand[\s\S]*?acceptPending\(\{ restoreMode:false \}\)/);
  assert.match(functionSource(app, "beginCanvasPointerAction"), /state\.mode === "hand"[\s\S]*?state\.panGesture[\s\S]*?setCanvasCursor\("grabbing"\)/);
  assert.ok(pointerDown.indexOf('state.mode !== "hand"') < pointerDown.indexOf("widgetPointerHit(point"));
  assert.match(pointerDown, /widgetPointerHit\(point, e\.pointerType, false\)/);
  assert.match(pointerDown, /imagePointerHit\(point, e\.pointerType, false\)/);
  assert.match(pointerDown, /selectedImageResult\.hit !== "move"/);
  assert.doesNotMatch(pointerDown, /state\.selectedImageId\) acceptImageEdit\(\)/);
  assert.match(pointerDown, /animationResult && animationResult\.hit !== "move"/);
  assert.doesNotMatch(pointerDown, /beginImageTouchHold|beginAnimationTouchHold/);
  for (const target of ["image", "animation", "widget", "pending-widget"]) assert.match(chromeSpecs, new RegExp(`target:"${target}"`));
  assert.match(functionSource(app, "pendingChromeSpecs"), /target:"pending"/);
  assert.match(chromeMove, /beginPendingGesture[\s\S]*?beginWidgetGesture[\s\S]*?beginImageGesture[\s\S]*?beginAnimationGesture/);
  assert.equal(chromePosition({ x:100, y:100, w:300, h:260 }, "move").y, 6);
  assert.doesNotMatch(app, /function drawHandModeOutlines\(/);
  const handToolbarOutlines = functionSource(app, "drawHandObjectToolbarOutlines");
  assert.match(handToolbarOutlines, /state\.mode !== "hand"[\s\S]*?state\.handToolbarTargets\.values\(\)[\s\S]*?if \(!record\.expanded\) continue[\s\S]*?widgetBox\(object\)[\s\S]*?imageBox\(object\)[\s\S]*?animationBox\(object\)[\s\S]*?textBoxBox\(object\)[\s\S]*?strokeRect/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawHandObjectToolbarOutlines\(interactionCtx\)/);
  assert.match(chromeSpecs, /for \(const \[key, record\] of state\.handToolbarTargets\)/);
  assert.doesNotMatch(chromeSpecs, /for \(const item of (?:visibleImages|visibleAnimations|visibleTextBoxes|visibleWidgets)/);
  assert.match(app, /HAND_OBJECT_TOOLBAR_VISIBLE_MS = 10000/);
  assert.match(functionSource(app, "expireHandObjectToolbars"), /record\.holds\?\.size\) continue[\s\S]*?record\.expiresAt <= now[\s\S]*?record\.hiding = true[\s\S]*?HAND_OBJECT_TOOLBAR_FADE_MS/);
  assert.match(functionSource(app, "ensureHandToolbarRecord"), /expanded:false[\s\S]*?holds:new Set\(\)/);
  assert.match(functionSource(app, "updateHandObjectHover"), /handObjectToolbarTargetAtPoint[\s\S]*?releaseHandObjectFocus[\s\S]*?focusHandObject/);
  assert.match(functionSource(app, "beginHandObjectFocus"), /handObjectToolbarTargetAtPoint[\s\S]*?handPointerFocusKeys\.set/);
  assert.match(createChromeButton, /kind === "move"\) activateHandObjectToolbar[\s\S]*?beginObjectChromeMove/);
  assert.match(refineHoverOutline, /state\.widgetRefineButtonHoverId[\s\S]*?\["pen", "hand"\]\.includes\(state\.mode\)/);
  assert.match(functionSource(app, "widgetRefineOutlineTarget"), /visibleWidgets\(\)\.find\(\(item\) => item\.id === widgetId\)/);
  assert.doesNotMatch(refineHoverOutline, /widgetRefineHoveredWidgetId|widgetRefineHintHovered/);
  const refineOutline = functionSource(app, "strokeWidgetRefineOutline");
  assert.match(refineOutline, /widgetBox\(widget\)[\s\S]*?strokeStyle = solid \? "#007aff" : "rgba\(0, 122, 255, 0\.34\)"[\s\S]*?lineWidth = \(solid \? 2 : 1\) \* unit[\s\S]*?setLineDash\(solid \? \[\] : \[4 \* unit, 4 \* unit\]\)[\s\S]*?strokeRect/);
  assert.doesNotMatch(refineOutline, /shadowColor|shadowBlur/);
  assert.match(css, /\.object-chrome-button\.refine:hover[^\{]*\{[^}]*box-shadow:\s*none/);
  assert.match(css, /\.widget-refine-hint\s*\{[^}]*box-shadow:\s*none/);
  assert.match(refineClickPulse, /WIDGET_REFINE_CLICK_PULSE_MS[\s\S]*?Math\.sin\(progress \* Math\.PI \* 2\) \*\* 2[\s\S]*?strokeWidgetRefineOutline[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawWidgetRefineButtonHoverOutline\(interactionCtx\)[\s\S]*?drawWidgetRefineClickPulse\(interactionCtx\)/);
  assert.doesNotMatch(functionSource(app, "renderInteractionLayer"), /drawHandModeOutlines/);
  assert.match(createChromeButton, /kind === "refine"\) triggerWidgetRefineClickPulse\(button\.penechoSpec\?\.refineCandidate\?\.widgetId\)[\s\S]*?button\.penechoSpec\?\.activate/);
  assert.match(createChromeButton, /pointerdown[\s\S]*?preventDefault\(\)[\s\S]*?stopPropagation\(\)[\s\S]*?setPointerCapture/);
  assert.match(createChromeButton, /pointerenter[\s\S]*?state\.widgetRefineButtonHoverId = candidate\.widgetId[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(createChromeButton, /pointerleave[\s\S]*?state\.widgetRefineButtonHoverId = null[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(syncChrome, /button\.penechoSpec\?\.kind === "refine"[\s\S]*?state\.widgetRefineButtonHoverId = null[\s\S]*?removedHoveredRefineButton[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(app, /overChromeControl = event\.target\?\.closest\?\.\("\.object-chrome-button, \.widget-refine-confirmation"\)[\s\S]*?!overChromeControl\) updateWidgetRefinePointer/);
  assert.match(html, /id="objectChromeLayer" class="object-chrome-layer"/);
  assert.match(css, /\.canvas-widget-frame\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /#viewport\.hand-mode \.canvas-widget-frame\s*\{[^}]*pointer-events:\s*auto[^}]*cursor:\s*default/);
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.object-chrome-layer\s*\{[^}]*z-index:\s*4/);
  assert.match(css, /\.object-chrome-button\.move\s*\{[^}]*width:\s*34px[^}]*height:\s*34px[^}]*cursor:\s*grab/);
  assert.match(css, /\.object-chrome-button\.hand-toolbar-hiding\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0/);
  for (const name of ["acceptImageEdit", "cancelImageEdit", "deleteImage", "mergeImage"]) {
    assert.match(functionSource(app, name), /state\.mode !== "hand"/);
  }
  assert.doesNotMatch(functionSource(app, "updateImageGesture"), /schedule|requestAI/);
  assert.doesNotMatch(functionSource(app, "updateWidgetGesturePoint"), /schedule\(\)|requestAI/);
  assert.doesNotMatch(functionSource(app, "updateAnimationGesture"), /schedule|requestAI/);
});

test("AI drafts temporarily enter Hand, restore the prior tool, and undo back to an unconfirmed draft", () => {
  const app = read("public/app.js"),
    enter = functionSource(app, "enterAIDraftHandMode"),
    finish = functionSource(app, "finishAIDraftHandMode"),
    mode = functionSource(app, "setCanvasMode"),
    accept = functionSource(app, "acceptPending"),
    acceptItem = functionSource(app, "acceptPendingItem"),
    acceptWidget = functionSource(app, "acceptPendingWidget"),
    restore = functionSource(app, "restorePendingHistoryState"),
    applyHistory = functionSource(app, "applyHistory");
  assert.match(enter, /aiDraftReturnMode === null[\s\S]*?state\.aiDraftReturnMode = state\.mode/);
  assert.match(enter, /setCanvasMode\("hand", \{[\s\S]*?preserveSelection:true,[\s\S]*?skipDraftFinalize:true,[\s\S]*?preserveWidgetRefinement:true/);
  assert.match(finish, /returnMode[\s\S]*?setCanvasMode\(returnMode, \{[\s\S]*?preserveSelection:true,[\s\S]*?skipDraftFinalize:true,[\s\S]*?preserveWidgetRefinement:true/);
  assert.match(functionSource(app, "startPending"), /enterAIDraftHandMode\(\)/);
  assert.match(functionSource(app, "startPendingBatch"), /enterAIDraftHandMode\(\)/);
  assert.match(functionSource(app, "startPendingWidget"), /enterAIDraftHandMode\(\)/);
  assert.match(mode, /leavingDraftHand[\s\S]*?acceptPending\(\{ restoreMode:false \}\)[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)/);
  assert.match(accept, /capturePendingHistoryState\(\)[\s\S]*?recordPendingHistory\(historyEntry, pendingBefore/);
  assert.match(acceptItem, /capturePendingHistoryState\(\)[\s\S]*?recordPendingHistory\(historyEntry, pendingBefore/);
  assert.match(acceptWidget, /capturePendingHistoryState\(\)[\s\S]*?recordPendingHistory\(historyEntry, pendingBefore/);
  assert.match(restore, /side === "before" \? entry\.pendingBefore : entry\.pendingAfter/);
  assert.match(restore, /state\.pendingHistoryRestored = Boolean\(state\.pending \|\| state\.pendingWidget\)/);
  assert.match(restore, /setCanvasMode\("hand", \{ preserveSelection:true, skipDraftFinalize:true \}\)/);
  assert.match(applyHistory, /restorePendingHistoryState\(entry, side\)/);
  assert.match(app, /state\.pendingHistoryRestored && \(a === "undo" \|\| a === "redo"\)/);
});

test("switching from Pen to Eraser finalizes a pending widget regardless of revision drift", () => {
  const setCanvasMode = functionSource(read("public/app.js"), "setCanvasMode"),
    button = { classList:{ toggle() {} }, setAttribute() {} },
    state = {
      mode:"pen",
      pending:null,
      pendingWidget:{ id:"widget-1", revision:4 },
      pendingWidgetReplacement:null,
      aiDraftReturnMode:"pen",
      pendingHistoryRestored:false,
      selection:null,
      pointerPreview:null,
      areaEraseGesture:null,
      eraserMode:"eraser",
      busy:false,
  };
  let accepted = 0,
    storedEraserMode = null;
  vm.runInNewContext(`(${setCanvasMode})("area-eraser")`, {
    state,
    ERASER_MODE_STORAGE_KEY:"penecho-eraser-mode",
    localStorage:{
      setItem:(key, value) => {
        assert.equal(key, "penecho-eraser-mode");
        storedEraserMode = value;
      },
    },
    eraserToolButton:button,
    document:{
      querySelector:() => button,
      querySelectorAll:() => [button],
    },
    activeWidgetRefinement:() => null,
    acceptPendingWidget:(options) => {
      assert.equal(options.restoreMode, false);
      assert.equal(options.allowRevisionMismatch, true);
      accepted++;
      state.pendingWidget = null;
    },
    updateWidgetRefinePointer() {},
    updateAutoControl() {},
    syncCanvasModePresentation() {},
    updateEraserToolUI() {},
    hideEraserToolMenu() {},
    cancelAreaEraseGesture() {},
    deselectAnimation() {},
    view:{ classList:{ toggle() {} } },
    resetCanvasCursor() {},
    requestInteractionLayerRender() {},
  });
  assert.equal(accepted, 1);
  assert.equal(state.mode, "area-eraser");
  assert.equal(storedEraserMode, "area-eraser");
  assert.equal(state.pendingWidget, null);
});

test("contextual footer hints persist, settle from blue, and follow widget and tool behavior", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    showHint = functionSource(app, "showCanvasHint"),
    renderHint = functionSource(app, "renderCanvasHint"),
    mode = functionSource(app, "setCanvasMode"),
    startWidget = functionSource(app, "startPendingWidget"),
    acceptWidget = functionSource(app, "acceptPendingWidget");
  assert.match(html, /id="canvasHint" class="canvas-hint" role="status" aria-live="polite" hidden/);
  assert.doesNotMatch(html, /data-i18n="footerTip"|AI drafts: move the whole group/);
  assert.match(renderHint, /`\$\{t\("hintPrefix"\)\}: \$\{t\(state\.canvasHintKey\)\}`[\s\S]*?canvasHint\.hidden = false/);
  assert.match(app, /hintPrefix:\s*"Hint"/);
  assert.match(zh, /hintPrefix:\s*"提示"/);
  assert.match(zh, /pluginPreview:\s*"预览"/);
  assert.doesNotMatch(showHint, /setTimeout|hidden\s*=\s*true/);
  assert.match(showHint, /Array\.isArray\(keys\)[\s\S]*?candidates\.filter\(\(key\) => key !== state\.canvasHintKey\)[\s\S]*?Math\.random\(\)/);
  assert.match(css, /\.canvas-hint\s*\{[^}]*grid-column:\s*2[^}]*min-width:\s*0[^}]*max-width:\s*none[^}]*overflow:\s*hidden[^}]*justify-self:\s*end[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.canvas-hint\.is-new\s*\{[^}]*animation:\s*canvasHintSettle 10s/);
  assert.match(css, /@keyframes canvasHintSettle\s*\{[\s\S]*?#2f80ed[\s\S]*?var\(--muted\)/);
  assert.match(startWidget, /widget\.widgetType === "html_widget"[\s\S]*?showCanvasHint\(\["canvasHintWidgetAdded", "canvasHintWidgetAddedAlt", "canvasHintRefineInPlace", "canvasHintAIAddsOnly"\]\)/);
  assert.match(acceptWidget, /if \(restoreMode\) finishAIDraftHandMode\(\);[\s\S]*?if \(!replacement && restoreMode\) showCanvasHint\("canvasHintWidgetTouchHand"\)/);
  assert.match(mode, /hand:\["canvasHintHand", "canvasHintHandAlt"\][\s\S]*?select:\["canvasHintLasso", "canvasHintLassoAlt"\][\s\S]*?text:\["canvasHintText", "canvasHintTextAlt"\][\s\S]*?eraser:\["canvasHintEraser", "canvasHintEraserAlt"\]/);
  assert.match(app, /button\.onclick = \(\) => selectCanvasToolMode\(button\.dataset\.mode, \{ showHint:true \}\)/);
  assert.match(app, /e\.pointerType === "touch"[\s\S]*?touchWidget = valid\(touchPoint\) \? widgetAtRefinePoint\(touchPoint\) : null[\s\S]*?state\.mode !== "hand"\) showCanvasHint\("canvasHintWidgetTouchHand"\)/);
  const hintKeys = [
    "canvasHintWidgetAdded", "canvasHintWidgetAddedAlt", "canvasHintRefineInPlace", "canvasHintAIAddsOnly", "canvasHintHand", "canvasHintHandAlt", "canvasHintLasso",
    "canvasHintWidgetTouchHand", "canvasHintLassoAlt", "canvasHintText", "canvasHintTextAlt", "canvasHintEraser", "canvasHintEraserAlt",
  ];
  for (const key of hintKeys) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
    const english = new RegExp(`${key}: "([^"]+)"`).exec(app)?.[1] || "";
    assert.ok(english && english.split(/\s+/).length <= 20, `${key} must stay within 20 English words`);
  }
});

test("widget shadows are an optional device display preference", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    css = read("public/style.css"),
    setter = functionSource(app, "setWidgetShadowEnabled"),
    drawImages = functionSource(app, "drawImagesToContext"),
    render = functionSource(app, "render"),
    mergeImage = functionSource(app, "mergeImage");
  assert.match(html, /id="settingsWidgetShadowToggle" class="settings-switch"[^>]*aria-checked="false"/);
  assert.doesNotMatch(html, /id="settingsWidgetShadowToggle" class="settings-switch on"/);
  assert.match(app, /storedWidgetShadowEnabled = localStorage\.getItem\("penecho-widget-shadow"\)[\s\S]*?initialWidgetShadowEnabled = storedWidgetShadowEnabled === "true"/);
  assert.match(setter, /localStorage\.setItem\("penecho-widget-shadow"[\s\S]*?view\.classList\.toggle\("widget-shadows"[\s\S]*?requestRender\(\)/);
  assert.match(css, /#viewport\.widget-shadows \.canvas-widget\s*\{[^}]*box-shadow:[^}]*0 1px 2px[^}]*0 7px 16px[^}]*0 22px 46px/);
  assert.match(drawImages, /withShadow = false[\s\S]*?shadowColor = "rgba\(15, 23, 42, \.24\)"[\s\S]*?shadowBlur = 18[\s\S]*?shadowOffsetY = 7[\s\S]*?drawImage[\s\S]*?restore/);
  assert.match(functionSource(app, "renderPlacedContentLayer"), /drawImagesToContext\(placedContentCtx, visible, state\.widgetShadowEnabled\)[\s\S]*?drawTextBoxesToContext\(placedContentCtx, visible\)/);
  assert.doesNotMatch(mergeImage, /shadow(?:Color|Blur|Offset)|widgetShadowEnabled/);
});

test("PenEcho Agent auto-open is a default-on canvas preference", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    zh = read("public/locales/zh.js"),
    agent = read("src/client/app/canvas-agent-runtime.js"),
    setter = functionSource(app, "setCanvasAgentAutoOpen");
  assert.match(html, /id="settingsCanvasAgentAutoOpenToggle" class="settings-switch on"[^>]*aria-checked="true"/);
  assert.match(html, /id="settingsCanvasAgentAutoOpenLabel"[^>]*data-i18n="settingsCanvasAgentAutoOpen"/);
  assert.match(app, /storedCanvasAgentAutoOpen = localStorage\.getItem\("penecho-canvas-agent-auto-open"\)/);
  assert.match(app, /storedCanvasAgentAutoOpen === null \? configuredCanvasAgentAutoOpen !== false : storedCanvasAgentAutoOpen === "true"/);
  assert.match(setter, /localStorage\.setItem\("penecho-canvas-agent-auto-open"[\s\S]*?aria-checked/);
  assert.match(app, /settingsCanvasAgentAutoOpen: "Open PenEcho Agent with each canvas"/);
  assert.match(zh, /settingsCanvasAgentAutoOpen: "打开画布时自动打开 PenEcho Agent"/);
  let openCount = 0;
  const context = {
    canvasAgent:{ socket:null, connectPromise:null }, state:{ canvasAgentAutoOpen:false }, canvasAgentPanel:{ hidden:true }, WebSocket:{ OPEN:1 },
    canvasAgentCanvasIdentity:() => "draft:test-client", canvasAgentPersistCurrentConversation:() => {}, canvasAgentBeginLocalConversation:() => {}, canvasAgentDropSessionIdentity:() => {}, canvasAgentSyncPromptSuggestions:() => {}, openCanvasAgent:() => { openCount++; },
  };
  vm.runInNewContext(functionSource(agent, "canvasAgentCanvasDidChange"), context);
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 0);
  context.state.canvasAgentAutoOpen = true;
  context.canvasAgentCanvasDidChange();
  assert.equal(openCount, 1);
});

test("pen ink stays above widgets and the eraser exposes a dashed footprint", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    interaction = functionSource(app, "renderInteractionLayer"),
    preview = functionSource(app, "drawPointerPreview"),
    cursor = functionSource(app, "resetCanvasCursor");
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="inkLayer"'));
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="placedContentLayer"'));
  assert.ok(html.indexOf('id="placedContentLayer"') < html.indexOf('id="inkLayer"'));
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.placed-content-layer\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*none/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /#screen\.cursor-pen\s*\{[^}]*data:image\/svg\+xml/);
  assert.match(css, /#screen\.cursor-eraser\s*\{\s*cursor:\s*none/);
  assert.match(cursor, /state\.mode === "pen" \? "pen"[\s\S]*?state\.mode === "eraser" \? "eraser"/);
  assert.match(interaction, /drawPointerPreview\(interactionCtx\)/);
  assert.match(preview, /state\.mode !== "eraser" && !state\.drawing\?\.erase[\s\S]*?context\.setLineDash\(\[3\.5 \* unit, 3 \* unit\]\)[\s\S]*?context\.arc/);
  const updatePreview = functionSource(app, "updateCanvasPointerPreview"),
    beginPointer = functionSource(app, "beginCanvasPointerAction"),
    finishPointer = functionSource(app, "end");
  assert.match(updatePreview, /drawing \? drawing\.erase && drawing\.id === event\.pointerId : state\.mode === "eraser"[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(beginPointer, /state\.drawing = \{[\s\S]*?erase: erasing,[\s\S]*?\};[\s\S]*?updateCanvasPointerPreview\(e\)/);
  assert.match(finishPointer, /const wasErasing = state\.drawing\.erase;[\s\S]*?finishDrawing\(e\.pointerType\);[\s\S]*?state\.pointerPreview = null;[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(app, /screen\.addEventListener\("pointerleave", \(\) => \{[\s\S]*?state\.pointerPreview = null;[\s\S]*?requestInteractionLayerRender\(\)/);
});

test("stylus eraser ends and Apple Pencil bridge actions preserve Canvas tool semantics", () => {
  const app = read("public/app.js"),
    eraserActive = vm.runInNewContext(`(${functionSource(app, "canvasPenEraserActive")})`),
    pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')),
    beginPointer = functionSource(app, "beginCanvasPointerAction"),
    pointerState = { selectedAnimationId:null,mode:"hand",timer:0,eraser:35,userRevision:0,drawing:null },
    pointerCalls = [],
    state = { mode:"pen",previousToolMode:"select",eraserMode:"area-eraser",viewMode:false,drawing:null,areaEraseGesture:null,selectionGesture:null },
    context = {
      state,
      setCanvasMode(mode) { state.mode = mode; },
    };

  assert.equal(eraserActive({ pointerType:"pen",button:5,buttons:32 }), true);
  assert.equal(eraserActive({ pointerType:"pen",button:-1,buttons:32 }), true);
  assert.equal(eraserActive({ pointerType:"pen",button:2,buttons:2 }), false);
  assert.equal(eraserActive({ pointerType:"mouse",button:5,buttons:32 }), false);
  assert.match(beginPointer, /options = arguments\[2\] \|\| \{\}[\s\S]*?forceEraser = options\.forceEraser === true[\s\S]*?!forceEraser && state\.mode === "hand"/);
  assert.match(beginPointer, /const erasing = forceEraser \|\| state\.mode === "eraser"/);
  assert.ok(pointerDown.indexOf("canvasPenEraserActive(e)") < pointerDown.indexOf('if (state.mode !== "hand")'));
  assert.match(pointerDown, /beginCanvasPointerAction\(e, clientPoint\(e\), \{ forceEraser:true \}\)/);
  assert.match(app, /window\.addEventListener\("penecho:pencil-action"[\s\S]*?performCanvasPencilAction\(event\.detail\?\.action\)/);
  const beginTemporaryEraser = vm.runInNewContext(`(${beginPointer})`, {
    state:pointerState,
    acceptAnimationEdit() {},
    valid:() => true,
    supersedeActiveAI:() => pointerCalls.push("supersede"),
    clearTimeout() {},
    hideWidgetRefineHint() {},
    clearWidgetRefineCandidate:() => pointerCalls.push("clear-refine"),
    logicalWidth:(value) => value,
    updateCanvasPointerPreview:() => pointerCalls.push("preview"),
    dot:(_point, erase, size) => pointerCalls.push(["dot", erase, size]),
    requestRender:() => pointerCalls.push("render"),
  });
  beginTemporaryEraser({ pointerType:"pen",pointerId:9,clientX:10,clientY:20 }, { x:10,y:20 }, { forceEraser:true });
  assert.equal(pointerState.mode, "hand");
  assert.equal(pointerState.drawing.erase, true);
  assert.equal(pointerState.drawing.size, 35);
  assert.deepEqual(pointerCalls.at(-2), ["dot", true, 35]);

  vm.runInNewContext([
    functionSource(app, "canvasToolMode"),
    functionSource(app, "selectCanvasToolMode"),
    functionSource(app, "performCanvasPencilAction"),
    "this.performCanvasPencilAction = performCanvasPencilAction;",
  ].join("\n"), context);
  assert.equal(context.performCanvasPencilAction("switch-previous"), true);
  assert.equal(context.state.mode, "select");
  assert.equal(context.state.previousToolMode, "pen");
  assert.equal(context.performCanvasPencilAction("switch-previous"), true);
  assert.equal(context.state.mode, "pen");
  assert.equal(context.state.previousToolMode, "select");
  assert.equal(context.performCanvasPencilAction("switch-eraser"), true);
  assert.equal(context.state.mode, "area-eraser");
  assert.equal(context.state.previousToolMode, "pen");
  assert.equal(context.performCanvasPencilAction("switch-eraser"), true);
  assert.equal(context.state.mode, "pen");
  assert.equal(context.state.previousToolMode, "area-eraser");
  context.state.viewMode = true;
  assert.equal(context.performCanvasPencilAction("switch-previous"), false);
  assert.equal(context.state.mode, "pen");
});

test("clicking eraser switches its current mode and shows two auto-closing choices", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    begin = functionSource(app, "beginCanvasPointerAction"),
    move = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    end = functionSource(app, "end"),
    finish = functionSource(app, "finishAreaEraseGesture"),
    erase = functionSource(app, "eraseInkRegion"),
    clearDirty = functionSource(app, "clearDirtyInkRegion"),
    draw = functionSource(app, "drawAreaEraseSelection"),
    startBlankCanvas = functionSource(app, "startBlankCanvas"),
    loadSnapshot = functionSource(app, "loadSnapshot"),
    box = vm.runInNewContext(`(${functionSource(app, "areaEraseBox")})`, { state:{ areaEraseGesture:null } });

  assert.match(html, /id="eraserToolBtn"[^>]*data-mode="eraser"[^>]*aria-haspopup="menu"[^>]*aria-controls="eraserToolMenu"/);
  assert.match(html, /id="eraserToolMenu"[^>]*role="menu"[^>]*hidden[\s\S]*?data-eraser-mode="eraser"[\s\S]*?data-eraser-mode="area-eraser"/);
  assert.equal((html.match(/data-eraser-mode=/g) || []).length, 2);
  assert.equal((html.match(/data-eraser-glyph="stroke"/g) || []).length, 2);
  assert.equal((html.match(/data-eraser-glyph="area"/g) || []).length, 2);
  assert.match(html, /data-eraser-glyph="stroke"[^>]*>[\s\S]*?<path d="M3\.5 15\.8c2\.2-4\.5/);
  assert.match(html, /data-eraser-glyph="area"[^>]*>[\s\S]*?<rect class="eraser-area-frame"[^>]*>[\s\S]*?<path class="eraser-area-tool"[^>]*>[\s\S]*?<path class="eraser-area-seam"/);
  assert.match(css, /\[data-eraser-glyph\][^{]*\{[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;[^}]*stroke-linecap:\s*round/);
  assert.match(css, /\.eraser-area-frame\s*\{[^}]*stroke-dasharray:\s*2\.3 2\.3/);
  assert.match(css, /\.eraser-area-tool\s*\{[^}]*fill:\s*currentColor/);
  assert.match(css, /#eraserToolBtn \[data-eraser-icon\]\s*\{\s*display:\s*none/);
  assert.match(css, /data-active-eraser="eraser"\][^\{]*data-eraser-icon="freehand"[\s\S]*?data-active-eraser="area-eraser"\][^\{]*data-eraser-icon="area"[^\{]*\{\s*display:\s*block/);
  assert.match(functionSource(app, "updateEraserToolUI"), /dataset\.activeEraser = state\.eraserMode/);
  assert.doesNotMatch(functionSource(app, "updateEraserToolUI"), /toggleAttribute\("hidden"/);
  assert.match(app, /ERASER_MODE_STORAGE_KEY = "penecho-eraser-mode"[\s\S]*?storedEraserMode = localStorage\.getItem\(ERASER_MODE_STORAGE_KEY\)/);
  assert.match(app, /initialEraserMode = \["eraser", "area-eraser"\]\.includes\(storedEraserMode\) \? storedEraserMode : "eraser"[\s\S]*?eraserMode: initialEraserMode/);
  assert.match(functionSource(app, "setCanvasMode"), /state\.eraserMode = mode;[\s\S]*?localStorage\.setItem\(ERASER_MODE_STORAGE_KEY, mode\)/);
  assert.doesNotMatch(startBlankCanvas, /eraserMode|ERASER_MODE_STORAGE_KEY/);
  assert.doesNotMatch(loadSnapshot, /eraserMode|ERASER_MODE_STORAGE_KEY/);
  assert.match(css, /\.eraser-tool-menu\s*\{[^}]*display:\s*flex[^}]*border-radius:\s*10px[^}]*background:\s*color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /\.eraser-tool-option\[aria-checked="true"\]\s*\{[^}]*color:/);
  assert.match(app, /ERASER_TOOL_MENU_MS = 5000/);
  assert.doesNotMatch(app, /ERASER_TOOL_HOLD_MS|eraserToolHold|finishEraserToolHold/);
  assert.match(functionSource(app, "showEraserToolMenu"), /clearTimeout\(eraserToolMenuTimer\)[\s\S]*?hidden = false[\s\S]*?positionToolbarPopover\("#eraserToolControl", "#eraserToolMenu", \{ align:"center", gap:6 \}\)[\s\S]*?setTimeout\(\(\) => hideEraserToolMenu\(\), ERASER_TOOL_MENU_MS\)/);
  assert.match(functionSource(app, "hideEraserToolMenu"), /clearTimeout\(eraserToolMenuTimer\)[\s\S]*?eraserToolMenuTimer = 0/);
  assert.match(functionSource(app, "selectEraserMode"), /state\.eraserMode = mode[\s\S]*?selectCanvasToolMode\(mode, \{ showHint:true \}\)[\s\S]*?options\.keepMenuOpen\) showEraserToolMenu\(\)/);
  assert.match(app, /eraserToolButton\?\.addEventListener\("click", \(\) => selectEraserMode\(state\.eraserMode, \{ keepMenuOpen:true \}\)\)/);
  assert.match(app, /selectEraserMode\(button\.dataset\.eraserMode, \{ keepMenuOpen:true \}\)/);
  assert.match(begin, /state\.mode === "area-eraser"[\s\S]*?beginAreaEraseGesture\(e, point\)/);
  assert.match(move, /state\.areaEraseGesture\?\.id === e\.pointerId[\s\S]*?updateAreaEraseGesture\(e\)/);
  assert.match(end, /state\.areaEraseGesture\?\.id === e\.pointerId[\s\S]*?finishAreaEraseGesture\(e\)/);
  assert.match(finish, /event\.type === "pointercancel"[\s\S]*?box\.w \* state\.scale < 4[\s\S]*?eraseInkRegion\(box\)/);
  assert.deepEqual({ ...box({ start:{ x:9, y:13 }, current:{ x:3, y:4 } }) }, { x:3, y:4,w:6,h:9 });
  assert.match(draw, /rgba\(220, 38, 38, \.1\)[\s\S]*?setLineDash[\s\S]*?fillRect[\s\S]*?strokeRect/);
  assert.match(erase, /save\(\);[\s\S]*?recordBefore\(tx, ty\)[\s\S]*?clearRect\(localPart\.x[\s\S]*?state\.userRevision\+\+[\s\S]*?recomputeDirtyBounds\(\)[\s\S]*?filterErasedDirtyHotspots\(touchedTiles\)[\s\S]*?saveUserCanvasChange\(\)/);
  assert.match(clearDirty, /state\.dirtyInkTiles[\s\S]*?DIRTY_MASK_SCALE[\s\S]*?state\.dirtyInkBounds\.delete\(tileKey\)/);
  assert.doesNotMatch(erase, /requestAI\(/);
  assert.doesNotMatch(erase, /invalidateRecognition\(/);
  for (const key of ["eraserOptions", "areaEraser", "canvasHintAreaEraser", "canvasHintAreaEraserAlt", "areaEraseTooSmall", "areaEraseDeleted"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("canvas navigation guidance emphasizes middle-mouse panning for at least ten seconds", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    navigating = functionSource(app, "setNavigating");

  assert.match(html, /id="tip"[^>]*data-i18n="tip"/);
  assert.match(app, /NAVIGATION_HINT_VISIBLE_MS\s*=\s*10000/);
  assert.match(navigating, /view\.classList\.add\("is-navigating"\)[\s\S]*?NAVIGATION_HINT_VISIBLE_MS/);
  assert.match(functionSource(app, "wheelNavigating"), /setNavigating\(true\)/);
  assert.match(app, /fit\(\);\s*setNavigating\(true\)/);
  assert.match(app, /tip:\s*"Pan: middle-mouse drag, Hand tool, or one finger · Zoom: wheel or pinch"/);
  assert.match(zh, /tip:\s*"移动画布：鼠标中键、小手或单指拖动 · 缩放：滚轮或双指"/);
  assert.match(css, /#tip\s*\{[^}]*right:\s*12px[^}]*z-index:\s*0[^}]*visibility:\s*hidden[^}]*opacity:\s*0/);
  assert.match(css, /#viewport\.is-navigating #tip\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*1/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
});

test("canvas navigation lock freezes only the outer view and leaves locked widgets interactive", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    host = read("public/widget-host.js"),
    zh = read("public/locales/zh.js"),
    toggle = functionSource(app, "setCanvasNavigationLocked"),
    move = functionSource(app, "moveCanvas"),
    zoom = functionSource(app, "zoomCanvasAt"),
    pinch = functionSource(app, "updateTouchGesture"),
    hostState = functionSource(app, "sendWidgetHostState"),
    loadSnapshot = functionSource(app, "loadSnapshot");

  assert.match(html, /id="canvasNavigationLock"[^>]*aria-pressed="false"[^>]*data-i18n-aria="canvasLockNavigation"/);
  assert.match(html, /id="canvasNavigationLockHint"[^>]*data-i18n="canvasNavigationLockedHint"/);
  assert.match(css, /\.canvas-navigation-lock\s*\{[^}]*top:\s*10px[^}]*left:\s*10px[^}]*width:\s*30px[^}]*height:\s*30px[^}]*opacity:\s*\.3/);
  assert.match(css, /#viewport\.is-navigating \.canvas-navigation-lock[^}]*opacity:\s*\.58/);
  assert.match(css, /\.canvas-navigation-lock\.locked[^}]*opacity:\s*\.76/);
  assert.match(css, /body\[data-theme="arcane"\] \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*var\(--outside\)[^}]*opacity:\s*\.52/);
  assert.match(css, /body\[data-theme="arcane"\] #viewport\.is-navigating \.canvas-navigation-lock:not\(\.locked\)[\s\S]*?opacity:\s*\.68/);
  assert.match(css, /body\[data-theme="scifi"\] \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*var\(--outside\) 78%[^}]*opacity:\s*\.38/);
  assert.match(css, /body\[data-theme="scifi"\] #viewport\.is-navigating \.canvas-navigation-lock:not\(\.locked\)\s*\{[^}]*opacity:\s*\.5/);
  assert.match(css, /body\[data-theme="scifi"\] \.canvas-navigation-lock:not\(\.locked\):hover[\s\S]*?opacity:\s*\.66/);
  assert.match(css, /\.canvas-navigation-lock-hint\s*\{[^}]*z-index:\s*0[^}]*right:\s*12px[^}]*bottom:\s*11px[^}]*color:[^}]*opacity:\s*0/);
  assert.match(css, /#viewport\.navigation-locked \.canvas-navigation-lock-hint\s*\{[^}]*visibility:\s*visible[^}]*opacity:\s*\.78/);
  assert.match(app, /NAVIGATION_HINT_VISIBLE_MS\s*=\s*10000/);
  assert.match(toggle, /state\.navigationLocked = Boolean\(locked\)[\s\S]*?view\.classList\.toggle\("navigation-locked"[\s\S]*?syncWidgetHostStates\(\)[\s\S]*?setNavigating\(true\)/);
  assert.match(move, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?canvasClientDelta\(dx, dy\)[\s\S]*?state\.panX \+= delta\.x/);
  assert.match(zoom, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.scale = next/);
  assert.match(pinch, /if \(state\.navigationLocked\)[\s\S]*?return false[\s\S]*?state\.scale = next/);
  assert.match(hostState, /navigationLocked:state\.navigationLocked/);
  assert.doesNotMatch(host, /addEventListener\("wheel"|penecho-widget-wheel|penecho-widget-pan-(?:start|move|end)/);
  assert.match(host, /press\.pointerType === "touch"\) pointerMessage\(TOUCH_END/);
  assert.match(host, /press\.pointerType === "touch"\) \{[\s\S]*?pointerMessage\(TOUCH_START/);
  assert.doesNotMatch(host, /press\.pointerType === "touch" && !widgetState\.navigationLocked/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?view:\s*\{[^}]*scale:\s*state\.scale[^}]*panX:\s*state\.panX[^}]*panY:\s*state\.panY[^}]*navigationLocked:\s*state\.navigationLocked/);
  assert.match(loadSnapshot, /setCanvasNavigationLocked\(item\.view\?\.navigationLocked === true\)/);
  assert.match(zh, /canvasLockNavigation:\s*"锁定画布移动和缩放"[\s\S]*?canvasUnlockNavigation:\s*"解锁画布移动和缩放"[\s\S]*?canvasNavigationLockedHint:\s*"当前画布视野已锁定 · 点击左上角锁图标解锁"/);
  assert.doesNotMatch(toggle, /localStorage|save\(/);
});

test("canvas view mode exposes quiet share, download, and exit controls while preserving pan and zoom", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    viewMode = functionSource(app, "setCanvasViewMode"),
    renderInteraction = functionSource(app, "renderInteractionLayer"),
    pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')),
    pointerMove = app.slice(app.indexOf('screen.addEventListener("pointermove"'), app.indexOf("function end(e)")),
    pointerEnd = functionSource(app, "end"),
    modeTools = html.match(/<div class="mode-tools">[\s\S]*?<\/div>/)?.[0] || "",
    viewTools = html.match(/<span class="view-tools">[\s\S]*?<\/span>/)?.[0] || "";

  assert.ok(modeTools.indexOf('id="canvasViewBtn"') < modeTools.indexOf('id="handToolBtn"'));
  assert.doesNotMatch(viewTools, /id="canvasViewBtn"/);
  assert.ok(viewTools.indexOf('id="fullscreenBtn"') < viewTools.indexOf('id="gridToggle"'));
  assert.match(html, /id="canvasViewBtn"[^>]*aria-pressed="false"[^>]*data-i18n-aria="enterCanvasViewMode"[\s\S]*?<circle cx="12" cy="12" r="2\.8"/);
  assert.match(html, /id="canvasViewActions"[^>]*role="toolbar"[^>]*hidden[\s\S]*?id="canvasViewShareBtn"[\s\S]*?id="canvasViewDownloadBtn"[\s\S]*?id="canvasViewCloseBtn"/);
  for (const key of ["enterCanvasViewMode", "exitCanvasViewMode", "canvasViewModeActions"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(viewMode, /document\.body\.classList\.toggle\("canvas-view-mode", enabled\)/);
  assert.match(viewMode, /view\.classList\.toggle\("view-mode", enabled\)/);
  assert.match(viewMode, /element\.inert = true[\s\S]*?data-canvas-view-inert/);
  assert.match(viewMode, /state\.viewModeNavigationLocked = state\.navigationLocked[\s\S]*?setCanvasNavigationLocked\(false\)/);
  assert.match(viewMode, /closeCanvasAgent\(\)/);
  assert.match(viewMode, /state\.viewModeNavigationLocked[\s\S]*?setCanvasNavigationLocked\(true\)/);
  assert.match(app, /canvasViewActions\.contains\(event\.target\) && \["Enter", " "\]\.includes\(event\.key\)/);
  assert.match(pointerDown, /if \(state\.viewMode\)[\s\S]*?state\.panGesture = \{ id:e\.pointerId/);
  assert.match(pointerMove, /if \(state\.viewMode\)[\s\S]*?updateTouchGesture\(\)[\s\S]*?moveCanvas\(/);
  assert.match(pointerEnd, /if \(state\.viewMode\)[\s\S]*?state\.touchGesture = null[\s\S]*?setCanvasCursor\("grab"\)/);
  assert.match(renderInteraction, /if \(state\.viewMode\)[\s\S]*?drawSelectionContent\(state\.selection[\s\S]*?drawPending\(state\.pending, interactionCtx, \{ chrome:false \}\)[\s\S]*?return/);
  assert.match(app, /canvasViewShareButton\.onclick = \(\) => document\.querySelector\("#shareCanvasBtn"\)\?\.click\(\)/);
  assert.match(app, /canvasViewDownloadButton\.onclick = exportCanvasPng/);
  assert.match(css, /\.canvas-view-actions\s*\{[^}]*opacity:\s*\.44/);
  assert.match(css, /\.canvas-view-actions:hover,[\s\S]*?\.canvas-view-actions:focus-within\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /body\.canvas-view-mode main\s*\{[^}]*height:\s*100dvh[^}]*padding:\s*0/);
  assert.match(css, /#viewport\.view-mode \.canvas-navigation-lock,[\s\S]*?#viewport\.view-mode #tip\s*\{\s*display:\s*none !important/);
  assert.match(css, /#viewport\.view-mode \.canvas-widget-frame\s*\{\s*pointer-events:\s*none/);
});

test("declarative scenes and widgets render below the dedicated ink and interaction layers", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.ok(html.indexOf('src="animation.js"') < html.indexOf('src="app.js"'));
  for (const id of ["animationLayer", "placedContentLayer", "inkLayer", "interactionLayer", "objectChromeLayer", "animationControls", "animationPlayPause", "animationRestart", "animationDelete"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.indexOf('id="screen"') < html.indexOf('id="animationLayer"'));
  assert.ok(html.indexOf('id="widgetLayer"') < html.indexOf('id="placedContentLayer"'));
  assert.ok(html.indexOf('id="placedContentLayer"') < html.indexOf('id="inkLayer"'));
  assert.ok(html.indexOf('id="inkLayer"') < html.indexOf('id="interactionLayer"'));
  assert.ok(html.indexOf('id="animationLayer"') < html.indexOf('id="interactionLayer"'));
  assert.match(css, /\.animation-layer\s*\{[^}]*z-index:\s*1/);
  assert.match(css, /\.placed-content-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /\.ink-layer\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /\.interaction-layer\s*\{[^}]*z-index:\s*3/);
  assert.match(functionSource(app, "renderInkLayer"), /forTiles[\s\S]*?drawSharpOverlays/);
  assert.doesNotMatch(functionSource(app, "render"), /forTiles\(l, t/);
  assert.match(app, /acceptedTools\.includes\(c\.tool\)/);
  assert.match(app, /animations = serializedAnimations\(\),[\s\S]*?animationCount: animations\.length,[\s\S]*?animations,/);
  assert.match(app, /captureTime = performance\.now\(\)/);
  assert.match(app, /drawAnimationsToContext\(q, sourceRect, captureTime\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange"[\s\S]*?document\.hidden\) stopAnimationFrames\(\)/);
  assert.match(app, /renderObjectCount = playing\.reduce[\s\S]*?minimumFrameMs = 1000 \/ \(renderObjectCount > 24 \? 30 : 60\)/);
  assert.match(functionSource(app, "renderAnimationLayer"), /mergeAnimationDirtyRects[\s\S]*?clearRect\(region\.x, region\.y, region\.w, region\.h\)/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawPreview[\s\S]*?drawSelection[\s\S]*?drawSelectedAnimation[\s\S]*?drawPending/);
  assert.match(app, /SNAPSHOT_TILE_DECODE_BATCH_SIZE = 8/);
  const decodeTiles = functionSource(app, "decodeSnapshotTilesInBatches"),
    loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(decodeTiles, /Promise\.all\(tileEntries\.slice\(start, end\)[\s\S]*?context\.drawImage\(image, 0, 0\)[\s\S]*?batch\.length = 0[\s\S]*?waitForSnapshotTileFrame\(\)/);
  assert.match(loadSnapshot, /decodeSnapshotTilesInBatches\(tileEntries, loadIsCurrent,[\s\S]*?for \(const \[k, canvas\] of decodedTiles\) tiles\.set\(k, canvas\);[\s\S]*?restoreWidgets\(item\.widgets\)/);
  assert.doesNotMatch(loadSnapshot, /Promise\.all\(tileEntries\.map/);

  const end = functionSource(app, "end"),
    captureSelection = functionSource(app, "captureSelection"),
    eraseRect = functionSource(app, "eraseRect"),
    eraseWithMask = functionSource(app, "eraseWithMask");
  assert.ok(end.indexOf("state.animationGesture") < end.indexOf("state.selectionGesture"));
  assert.ok(captureSelection.indexOf("invalidateSharpOverlays(box)") > captureSelection.indexOf("if (!fragments.length)"));
  assert.match(eraseRect, /invalidateSharpOverlays\(\{ x, y, w, h \}\);[\s\S]*?forTiles\(/);
  assert.match(eraseWithMask, /invalidateSharpOverlays\(\{ x, y, w, h \}\);[\s\S]*?forTiles\(/);

  const restoreState = { animations: [{ id:"existing" }], selectedAnimationId: "existing", animationEdit:{ id:"existing" }, nextAnimationId: 1 },
    restore = vm.runInNewContext(`(${functionSource(app, "restoreAnimations")})`, {
      clearHandToolbarTargets: () => {},
      hideAnimationControls: () => {},
      requestAnimationLayerRender: () => {},
      state: restoreState,
    }),
    saved = {
      id: "animation-1",
      scene: { durationMs: 1000 },
      transform: { x: 10, y: 20, w: 300, h: 200 },
      playback: { playheadMs: 250, paused: true },
    };
  restore(Array.from({ length: 102 }, () => saved));
  assert.equal(restoreState.animations.length, 0);
  assert.equal(restoreState.selectedAnimationId, null);
  assert.equal(restoreState.animationEdit, null);
  assert.equal(restoreState.nextAnimationId, 1);
});

test("plugin manager is a centered dynamic catalog with General HTML and bundled local plugins", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  const css = read("public/style.css");
  for (const id of ["pluginButton", "pluginPopover", "pluginOptions", "pluginClose", "pluginRefresh", "pluginLocalTab", "pluginCreateTab", "pluginServerTab", "pluginLocalPanel", "pluginCreatePanel", "pluginServerPanel"]) assert.match(html, new RegExp(`id="${id}"`));
  const toolbar = html.match(/<nav class="toolbar"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.doesNotMatch(html, /id="pluginControl"/);
  assert.doesNotMatch(toolbar, /id="pluginButton"/);
  assert.match(html, /id="settingsPanel"[\s\S]*?id="pluginButton"[^>]*aria-haspopup="dialog"[^>]*aria-controls="pluginPopover"[\s\S]*?data-i18n="settingsPluginsEntryHelp"/);
  assert.match(app, /pluginButton\.onclick = \(\) => \{[\s\S]*?closeSettings\(false\);[\s\S]*?showPluginControl\(\);/);
  assert.doesNotMatch(html, /id="animationPluginEnabled"/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[/);
  assert.match(app, /PLUGIN_DEFINITIONS\s*=\s*\[\.\.\.BUILTIN_PLUGIN_DEFINITIONS\]/);
  assert.match(app, /BUILTIN_PLUGIN_DEFINITIONS\s*=\s*Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(app, /documentPath:\s*"plugins\/weather\.md"/);
  const loadPluginDocuments = functionSource(app, "loadPluginDocuments");
  assert.match(loadPluginDocuments, /fetch\("\/api\/plugins"[\s\S]*?defaultEnabled:\["general", "flowchart"\]\.includes\(item\.manifest\.id\)[\s\S]*?professionalDefinitions = definitions\.filter\(\(definition\) => definition\.id === "flowchart"\)[\s\S]*?promotedDefinitions = \["image-search", "weather"\][\s\S]*?PLUGIN_DEFINITIONS\.splice\(0, PLUGIN_DEFINITIONS\.length, \.\.\.generalDefinitions, \.\.\.professionalDefinitions, \.\.\.BUILTIN_PLUGIN_DEFINITIONS, \.\.\.promotedDefinitions, \.\.\.remainingDefinitions\)/);
  const enabledPluginDescriptors = functionSource(app, "enabledPluginDescriptors");
  assert.match(enabledPluginDescriptors, /id === "general" \? 0 : id === "flowchart" \? 1 : 2/);
  assert.doesNotMatch(enabledPluginDescriptors, /styles/);
  assert.match(app, /localStorage\.setItem\(PLUGIN_STORAGE_KEY, JSON\.stringify/);
  assert.match(app, /if \(!state\.pluginCatalogLoaded\) void loadPluginDocuments\(\)/);
  assert.match(app, /applyTheme\(state\.theme\);\s*applyStudioPalette\(state\.studioPalette\);\s*applyPageScale\(state\.pageScale\);\s*resetCanvasCursor\(\);\s*loadPluginDocuments\(\)\.catch/);
  assert.match(app, /function pluginRequestPayload\(\)/);
  assert.match(app, /\.\.\.pluginRequestPayload\(\)/);
  assert.match(app, /function authenticatedApiHeaders\([\s\S]*?X-PenEcho-Session/);
  assert.match(app, /AI_CONNECTION_STORAGE_KEY = "penecho-ai-connection-id"/);
  assert.match(functionSource(app, "canvasClientId"), /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(app, /AI_CLIENT_ID = canvasClientId\(\)/);
  assert.match(app, /function authenticatedApiHeaders\([\s\S]*?X-PenEcho-Client/);
  assert.match(app, /function aiRequestHeaders\([\s\S]*?X-PenEcho-Connection/);
  assert.match(functionSource(app, "readAiCommandResponse"), /application\/x-ndjson[\s\S]*?response\.body\.getReader\(\)[\s\S]*?event\?\.type\s*===\s*"progress"[\s\S]*?onActivity[\s\S]*?terminal\.type\s*===\s*"result"/);
  assert.match(functionSource(app, "applyAiProgress"), /run\.superseded\|\|state\.activeAI!==run[\s\S]*?setStatus\(text,AI_PROGRESS_STATUS_KEYS\[event\.phase\]\)/);
  assert.match(functionSource(app, "applyAiProgress"), /event\?\.phase==="waiting"[\s\S]*?\["retrying","image-fallback"\]/);
  assert.match(functionSource(app, "requestAI"), /setStatusKey\("aiPreparingCanvas"\)[\s\S]*?setStatusKey\("aiSendingRequest"\)[\s\S]*?Accept:"application\/x-ndjson, application\/json"[\s\S]*?readAiCommandResponse/);
  assert.match(functionSource(app, "activeAiRequestTimeoutMs"), /state\.reasoningEffort === "config"[\s\S]*?aiTimeoutMultiplier/);
  assert.match(functionSource(app, "createActivityAwareAbortTimeout"), /deadline[\s\S]*?lastActivityAt[\s\S]*?idleGraceMs[\s\S]*?controller\.abort/);
  assert.match(functionSource(app, "requestAI"), /requestTimeoutMs=activeAiRequestTimeoutMs\(\)[\s\S]*?slowNoticeDelay[\s\S]*?requestTimeoutMs\/3[\s\S]*?phase:"slow"[\s\S]*?timeoutSeconds:Math\.ceil\(requestTimeoutMs\/1000\)[\s\S]*?timeout\.clear\(\)/);
  assert.match(functionSource(app, "supersedeActiveAI"), /aiCancelledForInput[\s\S]*?aiCancelled/);
  assert.doesNotMatch(functionSource(app, "readAiCommandResponse"), /setTimeout|setInterval|\/api\/ai\/progress|fetch\(/);
  assert.match(css, /#status\[data-ai-progress="true"\][^{]*\{[^}]*min-width:\s*180px/);
  assert.match(css, /#status\s*\{[^}]*height:\s*38px[^}]*display:\s*grid[^}]*align-items:\s*center/);
  assert.match(css, /#status\[data-ai-progress="true"\][^{]*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?#status\s*\{[^}]*width:\s*min\(210px, calc\(100vw - 20px\)\)[^}]*min-width:\s*min\(210px, calc\(100vw - 20px\)\)[^}]*max-width:\s*min\(210px, calc\(100vw - 20px\)\)/);
  const handleConnectionAction = functionSource(app, "handleConnectionAction");
  assert.match(handleConnectionAction, /localStorage\.setItem\(AI_CONNECTION_STORAGE_KEY, id\)/);
  assert.match(handleConnectionAction, /closeAfterActivation = settingsConnectionQuickList\?\.contains\(button\) === true[\s\S]*?if \(closeAfterActivation\) closeSettings\(\)/);
  assert.doesNotMatch(handleConnectionAction, /updateConnection\("activate"/);
  assert.match(app, /fetch\("\/api\/plugins\/improve"[\s\S]*?headers:aiRequestHeaders/);
  assert.match(app, /fetch\("\/api\/ai\/command"[\s\S]*?headers:\s*aiRequestHeaders/);
  assert.match(functionSource(app, "validate"), /acceptedTools = \["write_text", "draw_formula", "plot_function", "draw", "erase"\]/);
  assert.doesNotMatch(functionSource(app, "validate"), /animate_scene/);
  assert.match(functionSource(app, "renderPluginOptions"), /localizedManifestValue[\s\S]*?pluginPromptEstimate[\s\S]*?copy\.append\(titleRow, help, meta\)/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.id === "general" \? t\("pluginPublicHttps"\)/);
  assert.match(app, /pluginPromptEstimate:\s*"adds about \{tokens\} prompt tokens to each AI request while enabled; once on canvas, display, interaction, refresh, and rendering use no tokens"/);
  assert.match(app, /MAX_VISIBLE_WIDGETS = 100/);
  assert.match(app, /widgetLimitReached:\s*"Live widget limit reached \(100\)/);
  assert.match(zh, /pluginPromptEstimate:\s*"启用时，每次 AI 请求约增加 \{tokens\} 个 prompt token；内容添加到画布后，显示、交互、刷新和重绘都不消耗 token"/);
  assert.match(zh, /widgetLimitReached:\s*"实时组件已达到 100 个上限/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.id === "general"[\s\S]*?pluginRecommended[\s\S]*?generalPluginRecommendedHelp/);
  assert.match(functionSource(app, "renderPluginOptions"), /pluginSourceLabel[\s\S]*?pluginApiLabel[\s\S]*?manifest\.connect\.length[\s\S]*?pluginNoNetwork/);
  assert.match(functionSource(app, "renderPluginOptions"), /pluginPersonalSection[\s\S]*?plugin\.builtIn === false[\s\S]*?pluginBuiltInSection[\s\S]*?plugin\.builtIn !== false/);
  assert.match(functionSource(app, "renderPluginOptions"), /detailDocument[\s\S]*?pluginBuiltInRuntime[\s\S]*?dataset\.pluginDetail[\s\S]*?manifest\?\.document[\s\S]*?dataset\.pluginCopy/);
  assert.match(functionSource(app, "togglePluginDetails"), /detail\.hidden[\s\S]*?aria-expanded/);
  assert.match(functionSource(app, "copyPluginMarkdown"), /writeClipboardText\(document\)[\s\S]*?pluginMarkdownCopied[\s\S]*?pluginMarkdownCopyFailed/);
  assert.match(functionSource(app, "validPluginCatalogPath"), /plugin\\{2}\.md|plugin\\\\\.md/);
  assert.match(functionSource(app, "validPluginCatalogPath"), /styles\\{2}\.css|styles\\\\\.css/);
  assert.match(css, /\.plugin-option-section-title\s*\{/);
  assert.match(css, /\.plugin-option-detail\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(zh, /pluginDetails:\s*"详情"/);
  assert.match(zh, /copyPluginMarkdown:\s*"复制 Markdown"/);
  assert.match(css, /\.plugin-option-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.plugin-control\s*\{[^}]*height:\s*29px;\s*min-height:\s*29px/);
  const updatePluginControl = functionSource(app, "updatePluginControl");
  assert.match(updatePluginControl, /classList\.toggle\("active", !pluginPopover\.hidden\)/);
  assert.match(updatePluginControl, /removeAttribute\("aria-pressed"\)/);
  assert.doesNotMatch(updatePluginControl, /anyEnabled/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.plugin-control\s*\{\s*height:\s*38px;\s*min-height:\s*38px;\s*\}[\s\S]*?\.toolbar \.plugin-trigger\s*\{\s*height:\s*36px;\s*min-height:\s*36px/);
  assert.match(css, /\.plugin-modal-layer\s*\{[^}]*position:\s*fixed[^}]*place-items:\s*center/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*color-scheme:\s*light[^}]*--ink:\s*var\(--studio-text, #1c1f27\)[^}]*--panel-raised:\s*var\(--studio-panel, #ffffff\)[^}]*--gold-bright:\s*var\(--studio-accent-strong, #4338ca\)[^}]*width:\s*min\(920px, 100%\)[^}]*max-height/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.plugin-modal/);
  assert.match(html, /class="plugin-usage"[\s\S]*?data-i18n="pluginUsageDescription"/);
  assert.match(zh, /pluginUsageDescription:\s*"需要自定义界面时[\s\S]*?数据由你的浏览器直接获取/);
  assert.match(app, /generalPluginRecommendedHelp:\s*"Recommended\.[\s\S]*?interactive and dynamic content/);
  assert.match(zh, /generalPluginRecommendedHelp:\s*"建议开启[\s\S]*?交互内容和动态内容/);
  assert.match(html, /data-i18n="serverPluginsComingTitle"/);
});

test("model timeouts double for maximum effort and wait for ten seconds of stream inactivity", () => {
  const server = read("src/server/main.js"), callModel = functionSource(server,"callModel"), progress = functionSource(server,"aiProgressStream"),
    authoring = functionSource(server,"improvePluginDocument");
  assert.match(callModel,/createActivityAwareTimeout\(controller, provider\.timeoutMs \* reasoningEffortTimeoutMultiplier\(effort\)\)/);
  assert.match(callModel,/onActivity:streamActivity[\s\S]*?readProviderEventStream\([^)]*onActivity:streamActivity/);
  assert.match(authoring,/createActivityAwareTimeout\(controller, provider\.timeoutMs \* reasoningEffortTimeoutMultiplier\(effort\)\)/);
  assert.match(progress,/startHeartbeat[\s\S]*?setInterval[\s\S]*?type:"activity"[\s\S]*?AI_PROGRESS_HEARTBEAT_MS/);
  assert.match(progress,/activity\(\)[\s\S]*?now-lastActivitySentAt<1000[\s\S]*?type:"activity"/);
});

test("plugin creator offers one air-quality template, editable copies, AI title completion, deletion, and local save-and-enable", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"), server = read("src/server/main.js");
  for (const id of ["pluginCreateForm", "pluginSimpleTemplate", "pluginTitle", "pluginDocumentEditor", "pluginDocumentBytes", "pluginStylesEditor", "pluginStylesUploadButton", "pluginStylesUpload", "pluginStylesBytes", "pluginStylesPreview", "pluginDocumentStatus", "pluginImprove", "pluginSave"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="pluginApiTemplate"|id="pluginImproveInstructions"/);
  assert.match(html, /data-i18n="sharePluginComing"[^>]*disabled|disabled[^>]*data-i18n="sharePluginComing"/);
  assert.match(html, /id="pluginCreateTab"[\s\S]*?class="plugin-preview"[\s\S]*?data-i18n="pluginPreview"/);
  assert.match(html, /data-i18n="createPluginDescription">Preview: this workflow has limited testing/);
  assert.match(zh, /createPluginDescription:\s*"Preview：此功能测试尚不充分/);
  assert.match(app, /const PLUGIN_TEMPLATE_DOCUMENTS = Object\.freeze\(\{/);
  assert.match(app, /simple: `[\s\S]*?我需要根据地点, 显示空气质量\.[\s\S]*?## One-shot example[\s\S]*?html_widget/);
  assert.doesNotMatch(app, /pluginApiTemplate|pluginImproveInstructions/);
  assert.match(functionSource(app, "pluginDraftValidation"), /PLUGINS\.parse[\s\S]*?pluginIdReserved[\s\S]*?pluginIdExists/);
  assert.match(functionSource(app, "importPluginStylesFile"), /\.css\$[\s\S]*?file\.size > 32000[\s\S]*?file\.text\(\)[\s\S]*?pluginStylesEditor\.value = styles[\s\S]*?pluginStylesImported/);
  assert.match(functionSource(app, "improvePluginDraft"), /body:JSON\.stringify\(\{ document, styles[\s\S]*?pluginDocumentEditor\.value = body\.document[\s\S]*?pluginStylesEditor\.value = body\.styles[\s\S]*?syncPluginTitleFromDocument/);
  assert.match(functionSource(app, "savePluginDraft"), /fetch\("\/api\/plugins"[\s\S]*?loadPluginDocuments\(\)[\s\S]*?setPluginEnabled\(savedId, true\)[\s\S]*?setPluginTab\("local"\)/);
  assert.match(functionSource(app, "createPluginCopy"), /nextPluginCopyId[\s\S]*?manifest\.document[\s\S]*?pluginIdPattern[\s\S]*?pluginDocumentEditor\.value = document[\s\S]*?pluginStylesEditor\.value = manifest\.styles[\s\S]*?setPluginTab\("create"\)/);
  assert.match(functionSource(app, "deleteLocalPlugin"), /plugin\.builtIn !== false[\s\S]*?method:"DELETE"[\s\S]*?forgetPluginSetting[\s\S]*?loadPluginDocuments/);
  assert.match(functionSource(app, "renderPluginOptions"), /manifest\?\.document[\s\S]*?data-plugin-duplicate|manifest\?\.document[\s\S]*?dataset\.pluginDuplicate/);
  assert.match(functionSource(app, "renderPluginOptions"), /plugin\.builtIn === false[\s\S]*?data-plugin-delete|plugin\.builtIn === false[\s\S]*?dataset\.pluginDelete/);
  assert.match(functionSource(app, "setPluginTab"), /\["local", "create", "server"\]/);
  assert.match(functionSource(app, "setPluginTab"), /panel\.hidden = !active[\s\S]*?if \(active\) panel\.scrollTop = 0/);
  assert.match(css, /\.plugin-template-switch\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(css, /\.plugin-css-import\s*\{/);
  assert.match(css, /\.plugin-duplicate-button, \.plugin-delete-button\s*\{/);
  assert.match(css, /\.plugin-create-actions\s*\{[^}]*grid-template-columns/);
  for (const key of ["createPlugin", "pluginSimpleTemplate", "pluginTitleLabel", "pluginStylesImport", "pluginStylesImported", "improvePluginWithAi", "saveAndEnablePlugin", "pluginMarketplaceNote", "pluginNoNetwork", "duplicatePlugin", "pluginCopyName", "pluginCopyDraftReady", "deletePlugin"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(server, /const PLUGIN_AUTHORING_SYSTEM = `[\s\S]*?JSON object with exactly two string fields[\s\S]*?under 12000 UTF-8 bytes[\s\S]*?under 32000 UTF-8 bytes/);
  assert.match(functionSource(server, "pluginBundleFromModel"), /matchAll[\s\S]*?JSON\.parse[\s\S]*?PLUGIN_FORMAT\.parse/);
  assert.match(functionSource(server, "improvePluginDocument"), /requestPluginAuthoringModel[\s\S]*?pluginBundleFromModel[\s\S]*?pluginAuthoringRepairPrompt[\s\S]*?requestPluginAuthoringModel[\s\S]*?still failed validation/);
  assert.match(server, /url\.pathname === "\/api\/plugins"[\s\S]*?saveLocalPluginDocument\(body\.document, body\.styles \|\| ""\)/);
  assert.match(server, /url\.pathname === "\/api\/plugins\/improve"[\s\S]*?improvePluginDocument/);
  assert.match(server, /BUILTIN_PLUGIN_IDS[\s\S]*?function deleteLocalPlugin[\s\S]*?Built-in plugins cannot be deleted/);
  assert.match(server, /req\.method === "DELETE"[\s\S]*?deleteLocalPlugin\(id\)/);
});

test("General HTML stays mandatory while optional data plugins can detach widget runtime hooks", () => {
  const app = read("public/app.js"), html = read("public/index.html"), requestPayload = functionSource(app, "pluginRequestPayload"), syncRuntime = functionSource(app, "syncWidgetRuntime"), pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')), validate = functionSource(app, "validate");
  assert.match(html, /id="widgetLayer"[^>]*\shidden(?:\s|>)/);
  assert.match(requestPayload, /if \(plugins\.length\) payload\.plugins = plugins/);
  assert.match(functionSource(app, "enabledPluginDescriptors"), /filter\(\(plugin\) => pluginEnabled\(plugin\.id\)\)/);
  assert.match(functionSource(app, "pluginEnabled"), /pluginId === "general" \|\| state\.plugins\[pluginId\] === true/);
  assert.match(functionSource(app, "setPluginEnabled"), /if \(pluginId === "general"\) enabled = true/);
  assert.match(functionSource(app, "renderPluginOptions"), /input\.disabled = plugin\.id === "general"/);
  assert.match(functionSource(app, "enabledPluginDescriptors"), /sort\(\(a, b\) => \{[\s\S]*?id === "general" \? 0 : id === "flowchart" \? 1 : 2/);
  assert.match(syncRuntime, /dataPluginDefinitions\(\)\.some[\s\S]*?widgetLayer\.hidden = !enabled[\s\S]*?addEventListener[\s\S]*?removeEventListener/);
  assert.doesNotMatch(app, /window\.addEventListener\("message", handleWidgetMessage\)/);
  assert.match(functionSource(app, "visibleWidgets"), /if \(!widgetRuntimeEnabled\(\)\) return \[\]/);
  assert.match(functionSource(app, "positionWidgets"), /if \(!widgetRuntimeEnabled\(\)\) return/);
  assert.match(functionSource(app, "drawWidgetChrome"), /if \(!widgetRuntimeEnabled\(\)\) return/);
  assert.match(pointerDown, /widgetRuntimeEnabled\(\) && valid\(point\) \? widgetPointerHit/);
  assert.match(validate, /if \(widgetPluginIds\.size\) acceptedTools\.push\("html_widget"\)/);
  assert.match(validate, /allowCopy = c\.pluginId !== "image-search"[\s\S]*?allowCopy && typeof c\.copyText === "string"/);
});

test("simple native draw is loaded and rendered without enabling legacy animation output", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    validate = functionSource(app, "validate"),
    prepare = functionSource(app, "preparePendingItem");
  assert.match(html, /<script src="draw\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>/);
  assert.match(app, /const DRAW = window\.PENECHO_DRAW/);
  assert.match(validate, /acceptedTools = \["write_text", "draw_formula", "plot_function", "draw", "erase"\]/);
  assert.match(validate, /c\.tool === "draw"[\s\S]*?DRAW\?\.normalize\(c, SIZE\)/);
  assert.match(prepare, /c\.tool === "draw"[\s\S]*?DRAW\.render\(c, offscreen, c\.color\)/);
  assert.doesNotMatch(validate, /animate_scene/);
});

test("AI completion always leaves a user-visible result or diagnostic", () => {
  const app = read("public/app.js"),
    zh = read("public/locales/zh.js"),
    request = functionSource(app, "requestAI");
  assert.match(request, /commands\.length[\s\S]*?typeof data\.message === "string"[\s\S]*?setStatus\(data\.message\.trim\(\)\)[\s\S]*?setStatusKey\("aiNoVisibleResponse"\)/);
  assert.match(app, /aiNoVisibleResponse:\s*"AI returned no displayable content/);
  assert.match(zh, /aiNoVisibleResponse:\s*"AI 没有返回可显示的内容/);
});

test("client widget validation matches the server tolerance boundary", () => {
  const app = read("public/app.js"),
    server = read("src/server/main.js"),
    geometryGuide = vm.runInNewContext(`(${functionSource(app, "widgetGeometryForViewport")})`, { SIZE:20000 }),
    fitGeometry = vm.runInNewContext(`(${functionSource(app, "fitWidgetGeometry")})`, { SIZE:20000, widgetGeometryForViewport:geometryGuide }),
    resizeImage = vm.runInNewContext(`(${functionSource(app, "resizeImageBox")})`, { SIZE:20000 });
  assert.deepEqual({ ...geometryGuide({ w:3000, h:3000 }).max }, { w:1500, h:1500 });
  assert.deepEqual({ ...geometryGuide({ w:3001, h:3001 }).max }, { w:2000, h:2000 });
  assert.deepEqual({ ...fitGeometry({ x:100, y:200, w:10000, h:20000 }, { w:10000, h:10000 }) }, { x:100, y:200, w:2500, h:5000 });
  assert.deepEqual({ ...fitGeometry({ x:100, y:200, w:6800, h:2200 }, { w:10000, h:10000 }) }, { x:100, y:200, w:6800, h:2200 });
  assert.deepEqual({ ...fitGeometry({ x:100, y:200, w:8000, h:6000 }, { w:20000, h:20000 }) }, { x:100, y:200, w:7302, h:5477 });
  assert.deepEqual({ ...fitGeometry({ x:30000, y:-500, w:2, h:3 }, { w:10000, h:10000 }) }, { x:19700, y:0, w:300, h:450 });
  assert.deepEqual({ ...resizeImage({ x:100, y:200, w:1200, h:800 }, { x:15100, y:10200 }, "resize") }, { x:100, y:200, w:15000, h:10000 });
  assert.doesNotMatch(functionSource(app, "resizeImageBox"), /5000|10000|40000000|maximumArea/);
  assert.doesNotMatch(functionSource(app, "resizeWidgetBox"), /5000|10000|40000000|maximumArea/);
  assert.match(server, /MAX_WIDGET_WIDTH = 10000[\s\S]*?MAX_WIDGET_HEIGHT = 10000[\s\S]*?MAX_WIDGET_AREA = 40000000/);
  assert.match(server, /widgetGeometryForViewport[\s\S]*?ceil-to-1000-before-halving/);
});

test("AI waiting effect ends when the response arrives, before draft confirmation", () => {
  const request = functionSource(read("src/client/app/ai-runtime.js"), "requestAI"),
    response = request.indexOf("streamed = await readAiCommandResponse"),
    clearRequestTimeout = request.indexOf("timeout.clear();", response),
    clearSlowNotice = request.indexOf("clearTimeout(run.slowNoticeTimer);", response),
    endBusy = request.indexOf("if (state.activeAI === run) setBusy(false);", response),
    singleDraft = request.indexOf("await animate(", response),
    batchDraft = request.indexOf("await startPendingBatch(", response),
    pendingWidget = functionSource(read("src/client/app/canvas-runtime.js"), "startPendingWidget");
  assert.ok(response >= 0);
  assert.ok(clearRequestTimeout > response);
  assert.ok(clearSlowNotice > response);
  assert.ok(endBusy > response);
  assert.ok(clearRequestTimeout < singleDraft);
  assert.ok(clearSlowNotice < singleDraft);
  assert.ok(endBusy < singleDraft);
  assert.ok(endBusy < batchDraft);
  assert.match(pendingWidget, /setStatusKey\("aiDone"\)/);
  assert.doesNotMatch(pendingWidget, /setStatusKey\("draftReady"\)/);
});

test("AI waiting uses a spatial echo and quiet copy for the real request lifetime", () => {
  const core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js"),
    busy = functionSource(core, "setBusy");
  assert.match(core, /summonLayer|fxCanvas:\s*summonLayer|getAiColor:\s*\(\)\s*=>\s*state\.aiColor/);
  assert.match(core, /summonFX\.show\(state\.summonAnchor\)/);
  assert.match(busy, /if \(state\.busy\) \{[\s\S]*?showSummon\(\);[\s\S]*?\} else \{[\s\S]*?hideSummon\(\);/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon|summonPreviewTimer/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
});

test("new canvases open with a 0.8x initial viewport extent without overriding restored views", () => {
  const core = read("src/client/app/core.js"),
    canvas = read("src/client/app/canvas-runtime.js"),
    persistence = read("src/client/app/persistence.js"),
    fitSource = functionSource(canvas, "fit"),
    state = { scale:0.1, panX:0, panY:0, viewInitialized:false, animationFullRedraw:false },
    screen = {},
    animationLayer = {},
    placedContentLayer = {},
    inkLayer = {},
    interactionLayer = {},
    fit = vm.runInNewContext(`(${fitSource})`, {
      INITIAL_VIEWPORT_EXTENT_SCALE:0.8,
      SIZE:20000,
      viewerAutoFitWidgetId:null,
      viewerAutoFitCanvas:false,
      devicePixelRatio:1,
      view:{ getBoundingClientRect:() => ({ width:1200, height:800 }) },
      canvasViewportMetrics:() => ({ width:1200, height:800 }),
      screen,
      animationLayer,
      placedContentLayer,
      inkLayer,
      interactionLayer,
      state,
      updateCoordinates:() => {},
      requestRender:() => {},
    });
  assert.match(core, /INITIAL_VIEWPORT_EXTENT_SCALE\s*=\s*0\.8,/);
  assert.match(fitSource, /Math\.max\(r\.width,\s*r\.height\)\s*\/\s*10000\s*\/\s*INITIAL_VIEWPORT_EXTENT_SCALE/);
  fit();
  assert.equal(state.scale, 0.15);
  assert.equal(state.panX + 10000 * state.scale, 600);
  assert.equal(state.panY + 10000 * state.scale, 400);
  assert.match(functionSource(persistence, "startBlankCanvas"), /state\.viewInitialized\s*=\s*false;[\s\S]*?fit\(\)/);
  assert.match(persistence, /state\.scale\s*=\s*Math\.max\(0\.03,\s*Math\.min\(2,\s*item\.view\.scale\)\)/);
});

test("the public Viewer camera fits a Widget in phone portrait and landscape", () => {
  const fitSource = functionSource(read("src/client/app/canvas-runtime.js"), "fit"),
    widget = { id:"viewer-widget", x:2400, y:3600, w:1200, h:800 },
    state = { widgets:[widget], scale:.1, panX:0, panY:0, viewInitialized:true, animationFullRedraw:false },
    screen = {}, animationLayer = {}, placedContentLayer = {}, inkLayer = {}, interactionLayer = {};
  let rect = { left:0, top:0, width:375, height:667 };
  const fit = vm.runInNewContext(`(${fitSource})`, {
    INITIAL_VIEWPORT_EXTENT_SCALE:0.8,
    SIZE:20000,
    viewerAutoFitWidgetId:widget.id,
    viewerAutoFitCanvas:false,
    widgetBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
    devicePixelRatio:1,
    view:{ getBoundingClientRect:() => rect },
    canvasViewportMetrics:() => ({ width:rect.width, height:rect.height }),
    pageLayoutRect:(element) => element?.getBoundingClientRect?.() || rect,
    document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:62 }) }) },
    screen,
    animationLayer,
    placedContentLayer,
    inkLayer,
    interactionLayer,
    state,
    updateCoordinates:() => {},
    requestRender:() => {},
  });
  const visibleBox = () => ({
    left:state.panX + widget.x * state.scale,
    top:state.panY + widget.y * state.scale,
    right:state.panX + (widget.x + widget.w) * state.scale,
    bottom:state.panY + (widget.y + widget.h) * state.scale,
  });
  for (const size of [{ width:375, height:667 }, { width:667, height:375 }]) {
    rect = { ...rect, ...size };
    fit();
    const box = visibleBox();
    assert.ok(box.left >= 11 && box.right <= size.width - 11);
    assert.ok(box.top >= 63 && box.bottom <= size.height - 11);
    assert.ok(Math.abs((box.right - box.left) / (box.bottom - box.top) - widget.w / widget.h) < 1e-9);
  }
});

test("the public Viewer camera fits every object in a restored Canvas", () => {
  const fitSource = functionSource(read("src/client/app/canvas-runtime.js"), "fit"),
    widgets = [
      { id:"clock", x:6895, y:8757, w:3206, h:1801 },
      { id:"guide", x:9905, y:8922, w:3300, h:2150 },
    ],
    combined = { x:6895, y:8757, w:6310, h:2315 },
    state = { widgets, scale:.1, panX:0, panY:0, viewInitialized:true, animationFullRedraw:false },
    screen = {}, animationLayer = {}, placedContentLayer = {}, inkLayer = {}, interactionLayer = {},
    rect = { left:0, top:0, width:1200, height:800 },
    unionLocalBounds = (current, next) => {
      if (!current) return next;
      if (!next) return current;
      const x = Math.min(current.x, next.x), y = Math.min(current.y, next.y),
        right = Math.max(current.x + current.w, next.x + next.w),
        bottom = Math.max(current.y + current.h, next.y + next.h);
      return { x, y, w:right - x, h:bottom - y };
    },
    fit = vm.runInNewContext(`(${fitSource})`, {
      INITIAL_VIEWPORT_EXTENT_SCALE:0.8,
      SIZE:20000,
      viewerAutoFitWidgetId:null,
      viewerAutoFitCanvas:true,
      visibleInkBounds:() => null,
      imageBounds:() => null,
      textBoxBounds:() => null,
      animationBounds:() => null,
      widgetBounds:() => combined,
      unionLocalBounds,
      devicePixelRatio:1,
      view:{ getBoundingClientRect:() => rect },
      canvasViewportMetrics:() => ({ width:rect.width, height:rect.height }),
      pageLayoutRect:(element) => element?.getBoundingClientRect?.() || rect,
      document:{ querySelector:() => ({ getBoundingClientRect:() => ({ bottom:62 }) }) },
      screen,
      animationLayer,
      placedContentLayer,
      inkLayer,
      interactionLayer,
      state,
      updateCoordinates:() => {},
      requestRender:() => {},
    });
  fit();
  for (const item of widgets) {
    const left = state.panX + item.x * state.scale,
      top = state.panY + item.y * state.scale,
      right = state.panX + (item.x + item.w) * state.scale,
      bottom = state.panY + (item.y + item.h) * state.scale;
    assert.ok(left >= 39 && right <= rect.width - 39);
    assert.ok(top >= 63 && bottom <= rect.height - 11);
  }
});

test("animation defaults on without overriding an explicitly disabled plugin choice", () => {
  const storedPluginSettings = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id: "animation", defaultEnabled: true, legacyStorageKey: "penecho-animation-plugin" }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem: () => null },
    }),
    explicitlyDisabled = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id: "animation", defaultEnabled: true, legacyStorageKey: "penecho-animation-plugin" }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem: (key) => key === "penecho-plugins" ? '{"animation":false}' : null },
    });

  assert.deepEqual({ ...storedPluginSettings() }, { animation:true });
  assert.deepEqual({ ...explicitlyDisabled() }, { animation:false });
});

test("general HTML defaults on while preserving an explicit user choice", () => {
  const storedPluginSettings = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"general", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:() => null },
    }),
    explicitlyDisabled = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"general", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:(key) => key === "penecho-plugins" ? '{"general":false}' : null },
    });
  assert.deepEqual({ ...storedPluginSettings() }, { general:true });
  assert.deepEqual({ ...explicitlyDisabled() }, { general:false });
});

test("professional diagrams default on while preserving an explicit user choice", () => {
  const storedPluginSettings = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"flowchart", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:() => null },
    }),
    explicitlyDisabled = vm.runInNewContext(`(${functionSource(read("public/app.js"), "storedPluginSettings")})`, {
      PLUGIN_DEFINITIONS: [{ id:"flowchart", defaultEnabled:true }],
      PLUGIN_STORAGE_KEY: "penecho-plugins",
      localStorage: { getItem:(key) => key === "penecho-plugins" ? '{"flowchart":false}' : null },
    });
  assert.deepEqual({ ...storedPluginSettings() }, { flowchart:true });
  assert.deepEqual({ ...explicitlyDisabled() }, { flowchart:false });
});

test("empty animation bounds do not break ink-only capture and controls expire after ten seconds", () => {
  const app = read("public/app.js"),
    union = vm.runInNewContext(`(${functionSource(app, "unionLocalBounds")})`),
    ink = { x: 10, y: 20, w: 30, h: 40 };
  assert.deepEqual(union(ink, null), ink);
  assert.match(functionSource(app, "showAnimationControls"), /ANIMATION_CONTROLS_VISIBLE_MS[\s\S]*?setTimeout\(expireAnimationControls, duration\)/);
  assert.match(functionSource(app, "expireAnimationControls"), /hideAnimationControls\(\)[\s\S]*?selectedAnimation\(\)[\s\S]*?acceptAnimationEdit\(\)/);
  assert.match(functionSource(app, "hideAnimationControls"), /animationControlsUntil = 0[\s\S]*?requestInteractionLayerRender\(\)/);
  assert.match(functionSource(app, "animationControlChromeVisible"), /animationControlsUntil > now/);
  assert.match(functionSource(app, "pendingAnimationChromeVisible"), /pendingAnimationControlTarget\(\)[\s\S]*?animationControlChromeVisible/);
  assert.match(functionSource(app, "animationEditChromeVisible"), /kind === "confirmed"[\s\S]*?state\.animationEdit[\s\S]*?animationControlChromeVisible/);
  assert.match(functionSource(app, "drawSelectedAnimation"), /animationEditChromeVisible\(\)/);
  assert.match(app, /ANIMATION_CONTROLS_VISIBLE_MS\s*=\s*10000/);
  assert.match(functionSource(app, "beginAnimationGesture"), /showAnimationControls\(\)/);
  assert.doesNotMatch(functionSource(app, "addAnimation"), /showAnimationControls|selectedAnimationId\s*=/);
});

test("animation frames do not rewrite unchanged control DOM", () => {
  const app = read("public/app.js"), values = new Map(), writes = { hidden:0, style:0, text:0 };
  let hidden = true, label = "";
  const animationControls = {
      offsetWidth:210,
      offsetHeight:36,
      classList:{ toggle() {}, remove() {} },
      style:{
        getPropertyValue:(name)=>values.get(name)||"",
        setProperty:(name,value)=>{writes.style++;values.set(name,value)},
      },
    },
    animationPlayPause = {};
  Object.defineProperty(animationControls,"hidden",{get:()=>hidden,set:(value)=>{writes.hidden++;hidden=value}});
  Object.defineProperty(animationPlayPause,"textContent",{get:()=>label,set:(value)=>{writes.text++;label=value}});
  const position = vm.runInNewContext(`(${functionSource(app, "positionAnimationControls")})`, {
    animationControlTarget:()=>({kind:"pending",box:{x:100,y:120,w:300,h:180},playback:{paused:false}}),
    pluginEnabled:()=>true,
    animationControls,
    animationPlayPause,
    performance:{now:()=>100},
    state:{animationControlsUntil:1000,panX:10,panY:20,scale:1},
    canvasViewportMetrics:()=>({width:1000,height:700}),
    t:(key)=>key,
    runtimeElementStyle:()=>animationControls.style,
    acceptAnimationEdit:()=>{},
  });
  position();
  assert.deepEqual(writes,{hidden:1,style:2,text:1});
  position();
  assert.deepEqual(writes,{hidden:1,style:2,text:1});
});

test("strict CSP dynamic layout uses stylesheet rules instead of element style attributes", () => {
  const app = read("public/app.js"),
    summon = read("public/summon.js"),
    html = read("public/index.html"),
    widgetHost = read("public/widget-host.js"),
    helper = functionSource(app, "runtimeElementStyle");
  assert.match(helper, /sheet\.insertRule\(`\.\$\{className\} \{\}`/);
  for (const key of ["tour-layer", "tour-highlight", "tour-card", "tour-progress", "animation-controls", "canvas-image-selection", "image-edit-bar", "selection-toolbar", "summon-copy"])
    assert.match(app, new RegExp(`runtimeElementStyle\\([^)]*["']${key}["']`));
  assert.doesNotMatch(app, /Reflect\.get\((?:tourLayer|tourHighlight|tourCard|tourProgressBar|animationControls|imageEditBar|selectionToolbar), "style"\)/);
  assert.doesNotMatch(summon, /copyEl\.style\./);
  assert.match(summon, /styleFor = options\.styleFor/);
  assert.doesNotMatch(app, /pluginStylesPreview\.srcdoc|<style>\$\{escaped\}/);
  assert.doesNotMatch(html, /id="pluginStylesPreview"[^>]*\ssandbox(?:\s|>)/);
  assert.match(functionSource(app, "updatePluginStylesPreview"), /widget-host\.html/);
  assert.match(functionSource(app, "handlePluginStylesPreviewMessage"), /penecho-widget-host-ready/);
  assert.doesNotMatch(widgetHost, /if \(initialized \|\| typeof message\.html/);
});

test("animation drafts play immediately and share playback controls with confirmed editing", () => {
  const app = read("public/app.js"),
    playhead = vm.runInNewContext(`(${functionSource(app, "playbackPlayhead")})`),
    drawPending = functionSource(app, "drawPending"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    frame = functionSource(app, "animationFrameStep"),
    start = functionSource(app, "startPending"),
    selected = functionSource(app, "drawSelectedAnimation"),
    hit = functionSource(app, "animationPointerHit");
  assert.equal(playhead({ durationMs: 1000, loop: true }, { playheadMs: 0, paused: false, startedAt: 100 }, 350), 250);
  assert.match(drawPending, /p\.animationScene\) drawPendingAnimation/);
  assert.match(drawBatch, /item\.animationScene\) drawPendingAnimation/);
  assert.match(frame, /pendingAnimations = pendingAnimationEntries\(\)[\s\S]*?renderInteractionLayer\(\)[\s\S]*?pendingPlaying\.length/);
  assert.match(start, /revealProgress:\s*animationScene \? 1 : 0/);
  assert.match(start, /animationScene\)[\s\S]*?showAnimationControls\(\)[\s\S]*?requestAnimationLayerRender\(\)/);
  assert.match(functionSource(app, "animationControlTarget"), /pendingAnimationControlTarget\(\)[\s\S]*?kind:\s*"confirmed"/);
  assert.match(functionSource(app, "toggleSelectedAnimationPlayback"), /animationControlTarget\(\)/);
  assert.doesNotMatch(selected, /drawDraftActions/);
  assert.match(functionSource(app, "objectChromeSpecs"), /animation:\$\{handTarget\.id\}:cancel[\s\S]*?cancelAnimationEdit[\s\S]*?animation:\$\{handTarget\.id\}:accept[\s\S]*?acceptAnimationEdit/);
  assert.match(hit, /draftActionPoints\(box, handle, false, true\)/);
  for (const control of ["width", "height", "resize"]) assert.match(hit, new RegExp(`hit: "${control}"`));
  assert.match(functionSource(app, "beginAnimationGesture"), /result\.hit === "accept"[\s\S]*?acceptAnimationEdit\(\)[\s\S]*?result\.hit === "cancel"[\s\S]*?cancelAnimationEdit\(\)/);
  assert.match(drawPending, /pendingAnimationChromeVisible\(p\)[\s\S]*?if \(!chromeVisible\) return/);
  assert.match(drawBatch, /chromeVisible: !item\.animationScene \|\| pendingAnimationChromeVisible\(p, index\)/);
  assert.match(functionSource(app, "pendingHit"), /p\.animationScene && !pendingAnimationChromeVisible\(p\)/);
  assert.match(functionSource(app, "beginPendingGesture"), /!p\.items && p\.animationScene\) showAnimationControls\(\)/);
});

test("live widgets use native canvas chrome, state-aware iframe gestures, and three resize modes", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizeWidgetBox")})`, { SIZE:20000 }),
    start = { x:100, y:200, w:1200, h:800, contentW:1200, contentH:800 },
    width = resize(start, { x:2000, y:0 }, "width"),
    height = resize(start, { x:0, y:1300 }, "height"),
    corner = resize(start, { x:2500, y:1800 }, "resize"),
    minimum = resize(start, { x:0, y:0 }, "resize"),
    bounded = resize({ x:18500, y:19000, w:1200, h:800, contentW:1200, contentH:800 }, { x:22000, y:22000 }, "resize"),
    scaledWidth = resize({ x:100, y:200, w:600, h:400, contentW:1200, contentH:800 }, { x:1000, y:0 }, "width"),
    scaledHeight = resize({ x:100, y:200, w:600, h:400, contentW:1200, contentH:800 }, { x:0, y:800 }, "height"),
    unrestrictedWidth = resize(start, { x:15100, y:0 }, "width"),
    unrestrictedHeight = resize(start, { x:0, y:15200 }, "height"),
    unrestrictedCorner = resize(start, { x:15100, y:10200 }, "resize"),
    chrome = functionSource(app, "drawWidgetChrome"),
    hit = functionSource(app, "widgetControlHit"),
    begin = functionSource(app, "beginWidgetGesture"),
    updatePoint = functionSource(app, "updateWidgetGesturePoint"),
    finishReleased = functionSource(app, "finishReleasedWidgetGesture"),
    finishStaleHost = functionSource(app, "finishStaleWidgetHostGesture"),
    pointerHit = functionSource(app, "widgetPointerHit"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    finishWidgetGesture = functionSource(app, "finishWidgetGesture"),
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{panX:0,panY:0,scale:1},
      view:{clientWidth:1200,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0})},
      screenObjectBox:box=>({left:box.x,top:box.y,width:box.w,height:box.h}),
    }),
    positionWidget = vm.runInNewContext(`(${functionSource(app, "positionWidget")})`, {
      state:{ panX:10, panY:20, scale:0.2 },
      updateWidgetRenderVisibility() {},
      sendWidgetHostState() {},
    }),
    pointerDown = app.slice(app.indexOf('screen.addEventListener("pointerdown"'), app.indexOf('screen.addEventListener("pointermove"')),
    frameRule = /\.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "";
  const declaration = {},
    positionedWidget = { shell:{}, x:100, y:200, w:600, h:400, contentW:1200, contentH:800, styleRule:{ style:declaration } };
  positionWidget(positionedWidget);

  assert.deepEqual({ ...width }, { x:100, y:200, w:1900, h:800, contentW:1900, contentH:800 });
  assert.deepEqual({ ...height }, { x:100, y:200, w:1200, h:1100, contentW:1200, contentH:1100 });
  assert.deepEqual({ ...corner }, { x:100, y:200, w:2400, h:1600, contentW:1200, contentH:800 });
  assert.deepEqual({ ...minimum }, { x:100, y:200, w:300, h:200, contentW:1200, contentH:800 });
  assert.deepEqual({ ...bounded }, { x:18500, y:19000, w:1500, h:1000, contentW:1200, contentH:800 });
  assert.deepEqual({ ...scaledWidth }, { x:100, y:200, w:900, h:400, contentW:1800, contentH:800 });
  assert.deepEqual({ ...scaledHeight }, { x:100, y:200, w:600, h:600, contentW:1200, contentH:1200 });
  assert.deepEqual({ ...unrestrictedWidth }, { x:100, y:200, w:15000, h:800, contentW:15000, contentH:800 });
  assert.deepEqual({ ...unrestrictedHeight }, { x:100, y:200, w:1200, h:15000, contentW:1200, contentH:15000 });
  assert.deepEqual({ ...unrestrictedCorner }, { x:100, y:200, w:15000, h:10000, contentW:1200, contentH:800 });
  assert.equal(width.w / width.contentW, width.h / width.contentH);
  assert.equal(height.w / height.contentW, height.h / height.contentH);
  assert.equal(scaledWidth.w / scaledWidth.contentW, scaledWidth.h / scaledWidth.contentH);
  assert.equal(scaledHeight.w / scaledHeight.contentW, scaledHeight.h / scaledHeight.contentH);
  assert.equal(corner.w / corner.h, start.w / start.h);
  assert.equal(corner.contentW, start.contentW);
  assert.equal(corner.contentH, start.contentH);
  assert.equal(declaration.width, "1200px");
  assert.equal(declaration.height, "800px");
  assert.equal(declaration.transform, "translate3d(30px,60px,0) scale(0.1,0.1)");
  const chromeBox={x:400,y:100,w:300,h:200},
    anchoredToolSpec={widgetTool:true,widgetToolPlacement:"inside-top",widgetCoreMoveKey:"move",widgetCoreAcceptKey:"accept",widgetToolGroup:"tools",groupHorizontalWidth:116,groupVerticalWidth:36,groupVerticalHeight:110,groupHorizontalOffset:0,groupVerticalOffset:0,baseWidth:36,baseHeight:34,controlScale:1},
    fallbackToolSpec={...anchoredToolSpec,groupHorizontalWidth:234,groupVerticalWidth:118,groupVerticalHeight:72,baseWidth:118},
    corePositions = box => new Map([
      ["move",chromePosition(box,"move","",{widgetCore:true})],
      ["accept",chromePosition(box,"accept","",{widgetCore:true})],
    ]);
  assert.deepEqual({x:chromePosition(chromeBox,"move","",{widgetCore:true}).x,y:chromePosition(chromeBox,"move","",{widgetCore:true}).y},{x:533,y:108});
  assert.deepEqual({x:chromePosition(chromeBox,"cancel","",{widgetCore:true}).x,y:chromePosition(chromeBox,"cancel","",{widgetCore:true}).y},{x:408,y:108});
  assert.deepEqual({x:chromePosition(chromeBox,"accept","",{widgetCore:true}).x,y:chromePosition(chromeBox,"accept","",{widgetCore:true}).y},{x:656,y:108});
  assert.deepEqual({x:chromePosition({x:200,y:100,w:900,h:200},"download","",anchoredToolSpec,corePositions({x:200,y:100,w:900,h:200})).x,y:chromePosition({x:200,y:100,w:900,h:200},"download","",anchoredToolSpec,corePositions({x:200,y:100,w:900,h:200})).y},{x:674,y:108});
  assert.deepEqual({x:chromePosition(chromeBox,"download","",anchoredToolSpec,corePositions(chromeBox)).x,y:chromePosition(chromeBox,"download","",anchoredToolSpec,corePositions(chromeBox)).y},{x:656,y:149});
  assert.deepEqual({x:chromePosition({x:900,y:200,w:250,h:200},"copy","",fallbackToolSpec,corePositions({x:900,y:200,w:250,h:200})).x,y:chromePosition({x:900,y:200,w:250,h:200},"copy","",fallbackToolSpec,corePositions({x:900,y:200,w:250,h:200})).y},{x:1024,y:249});
  assert.match(frameRule, /color-scheme:\s*light/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.match(functionSource(app, "sendWidgetHostState"), /const selected[\s\S]*?classList\.toggle\("is-selected", selected\)[\s\S]*?if \(!widget\.frame\?\.contentWindow/);
  assert.match(functionSource(app, "serializedWidgets"), /contentW:\s*widget\.contentW[\s\S]*?contentH:\s*widget\.contentH/);
  assert.match(functionSource(app, "serializedWidgets"), /widget\.widgetType !== "diagram_source"[\s\S]*?widget\.pluginId !== "image-search"[\s\S]*?copyText:widget\.copyText[\s\S]*?copyLabel:widget\.copyLabel/);
  const widgetRecord = functionSource(app, "widgetRecord");
  assert.match(widgetRecord, /contentW = item\.contentW \?\? item\.w[\s\S]*?contentH = item\.contentH \?\? item\.h/);
  assert.match(widgetRecord, /copyText: widgetType === "diagram_source" \? source[\s\S]*?allowCopy[\s\S]*?copyLabel: widgetType === "diagram_source" \? runtime\?\.copyLabel/);
  assert.match(functionSource(app, "sendWidgetInit"), /html:widget\.html[\s\S]*?pluginStyles:manifest\.styles/);
  assert.doesNotMatch(functionSource(app, "sendWidgetInit"), /copyText|copyLabel/);
  assert.doesNotMatch(functionSource(app, "resizeWidgetBox"), /5000|4000|12000000|maximumArea/);
  assert.doesNotMatch(functionSource(app, "widgetRecord"), /pluginManifests\.has/);
  assert.match(functionSource(app, "requestWidgetSnapshot"), /width:widget\.contentW, height:widget\.contentH, timeoutMs:remaining\(\), highResolution/);
  const requestSnapshot = functionSource(app, "requestWidgetSnapshot"),
    prepareSnapshots = functionSource(app, "prepareVisibleWidgetSnapshots"),
    capturableWidgets = functionSource(app, "capturableWidgets"),
    acceptPendingWidget = functionSource(app, "acceptPendingWidget");
  assert.match(requestSnapshot, /timeoutMs = WIDGET_SNAPSHOT_TIMEOUT_MS[\s\S]*?highResolution = highResolution === true[\s\S]*?if \(widget\.snapshotPromise\)[\s\S]*?widget\.snapshotPromiseHighResolution[\s\S]*?await waitForWidgetSnapshot\(inFlight,signal\)[\s\S]*?widget\.snapshotVersion >= widget\.contentVersion[\s\S]*?widget\.snapshotHighResolution[\s\S]*?widget\.snapshotPromise = snapshotPromise[\s\S]*?widget\.snapshotPromiseHighResolution = highResolution[\s\S]*?widget\.snapshotPromise = null/);
  assert.doesNotMatch(requestSnapshot, /waitForWidgetContent|readyPromise|contentReady|\bfetch\s*\(/);
  assert.match(requestSnapshot, /if \(!widget\.hostReady\)[\s\S]*?widget\.hostReadyPromise[\s\S]*?sendWidgetInit\(widget\)/);
  assert.match(messageHandler, /penecho-widget-updated[\s\S]*?widget\.contentVersion\+\+/);
  assert.match(messageHandler, /penecho-widget-updated[\s\S]*?if \(widget\.favorite\)[\s\S]*?widget\.favorite = false[\s\S]*?syncObjectChrome\(\)/);
  assert.doesNotMatch(messageHandler, /removeLocalFavorite|\/api\/favorites|DELETE/);
  const favoriteState = functionSource(app, "setCommunityWidgetFavorite");
  assert.match(favoriteState, /busy === true && !widget\.favoriteBusy[\s\S]*?favoritePendingVersion = widget\.contentVersion/);
  assert.match(favoriteState, /changedWhileSaving[\s\S]*?favoritePendingVersion !== widget\.contentVersion[\s\S]*?if \(!changedWhileSaving\) widget\.favorite = favorite/);
  assert.match(functionSource(app, "widgetRecord"), /favoriteBusy: false[\s\S]*?favoritePendingVersion: null/);
  assert.match(messageHandler, /penecho-widget-snapshot-error[\s\S]*?console\.warn\("PenEcho widget snapshot failed:"/);
  assert.doesNotMatch(messageHandler, /requestWidgetSnapshot/);
  assert.equal((app.match(/requestWidgetSnapshot\(/g) || []).length, 4);
  assert.match(app, /WIDGET_SNAPSHOT_TIMEOUT_MS = 20000,[\s\S]*?WIDGET_HISTORY_SNAPSHOT_WAIT_MS = 3000/);
  assert.doesNotMatch(app, /WIDGET_(?:BACKGROUND_SNAPSHOT_DELAY|SNAPSHOT_CACHE_REFRESH|SNAPSHOT_CACHE_STAGGER)_MS|scheduleWidgetSnapshot|snapshotTimer|snapshotCapturedAt/);
  assert.match(requestSnapshot, /widget\.snapshotPromise = snapshotPromise[\s\S]*?return await snapshotPromise[\s\S]*?widget\.snapshotPromise = null/);
  assert.match(messageHandler, /penecho-widget-capture-ready[\s\S]*?return/);
  assert.doesNotMatch(messageHandler, /penecho-widget-snapshot-ready/);
  assert.match(messageHandler, /const snapshotImage=await decodeWidgetSnapshot[\s\S]*?pending\.signal\?\.aborted[\s\S]*?widget\.contentVersion!==pending\.contentVersion[\s\S]*?widget\.snapshotImage = snapshotImage[\s\S]*?widget\.snapshotHighResolution = pending\.highResolution[\s\S]*?widget\.snapshotVersion = pending\.contentVersion[\s\S]*?pending\.resolve\(widget\.snapshotImage\)/);
  assert.match(capturableWidgets, /visibleWidgets\(region\)[\s\S]*?state\.pendingWidget[\s\S]*?pending\.shell[\s\S]*?return \[\.\.\.widgets, pending\]/);
  assert.match(prepareSnapshots, /highResolution = false[\s\S]*?capturableWidgets\(region\)[\s\S]*?requestWidgetSnapshot\(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true, signal, highResolution\)[\s\S]*?Promise\.race\([\s\S]*?WIDGET_HISTORY_SNAPSHOT_WAIT_MS[\s\S]*?Boolean\(widget\.snapshotImage\)/);
  assert.match(prepareSnapshots, /bestEffort = true[\s\S]*?if \(bestEffort\) await Promise\.race[\s\S]*?else await request/);
  assert.match(functionSource(app, "widgetBounds"), /capturableWidgets\(region\)/);
  assert.match(functionSource(app, "drawWidgetsToContext"), /capturableWidgets\(region\)/);
  assert.match(functionSource(app, "renderExportCanvas"), /prepareVisibleWidgetSnapshots\(null, false, null, true\)[\s\S]*?scale = Math\.min\(CANVAS_DOWNLOAD_RESOLUTION_SCALE, EXPORT_MAX_DIMENSION \/ region\.w[\s\S]*?Math\.sqrt\(EXPORT_MAX_PIXELS \/ \(region\.w \* region\.h\)\)/);
  assert.match(acceptPendingWidget, /!options\.allowRevisionMismatch && widget\.revision !== state\.userRevision[\s\S]*?rejectPendingWidget\(AI_CANCELLED\)/);
  assert.match(acceptPendingWidget, /if \(replacement\) \{[\s\S]*?unmountWidget\(widget\)[\s\S]*?\} else \{[\s\S]*?state\.widgets\.push\(widget\)[\s\S]*?widget\.shell\.classList\.remove\("pending"\)[\s\S]*?sendWidgetHostState\(widget/);
  assert.doesNotMatch(prepareSnapshots, /snapshotVersion === widget\.contentVersion/);
  assert.doesNotMatch(finishWidgetGesture, /requestWidgetSnapshot|scheduleWidgetSnapshot/);
  assert.match(finishWidgetGesture, /state\.widgetGesture = null[\s\S]*?positionWidget\(gesture\.widget\)/);
  const visibilityState = { scale:1, widgetGesture:null },
    updateWidgetRenderVisibility = vm.runInNewContext(`(${functionSource(app, "updateWidgetRenderVisibility")})`, {
      state:visibilityState,
      view:{ clientWidth:1000, clientHeight:700 },
      sendWidgetInit() {},
    }),
    visibilityClasses = new Set(),
    visibilityWidget = {
      w:300,
      h:200,
      shell:{ classList:{ toggle(name, enabled) { if (enabled) visibilityClasses.add(name); else visibilityClasses.delete(name); } } },
    };
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 100, 100), true);
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 1001, 100), false);
  assert.equal(visibilityClasses.has("widget-offscreen"), true);
  visibilityState.widgetGesture = { widget:visibilityWidget };
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 1001, 100), true);
  visibilityState.widgetGesture = null;
  assert.equal(updateWidgetRenderVisibility(visibilityWidget, 1001, 100), false);
  assert.match(functionSource(app, "sendWidgetHostState"), /active[\s\S]*?penecho-widget-state/);
  assert.match(css, /\.canvas-widget\s*\{[^}]*contain:\s*layout paint style/);
  assert.doesNotMatch(css, /\.canvas-widget\s*\{[^}]*will-change:\s*transform/);
  assert.match(css, /\.canvas-widget\.widget-offscreen\s*\{[^}]*visibility:\s*hidden/);
  assert.doesNotMatch(chrome, /drawDraftActions/);
  assert.match(chrome, /drawResizeHandle\(context, box, handle\)/);
  assert.match(hit, /draftActionPoints\(box, handle, false, true\)/);
  for (const control of ["width", "height", "resize"]) assert.match(hit, new RegExp(`hit:\\s*"${control}"`));
  assert.match(begin, /result\.hit === "accept"[\s\S]*?acceptPendingWidget[\s\S]*?acceptWidgetEdit/);
  assert.match(begin, /result\.hit === "cancel"[\s\S]*?rejectPendingWidget[\s\S]*?deleteWidget\(result\.widget\)/);
  assert.match(functionSource(app, "deleteWidget"), /recordWidgetsBefore\(\)[\s\S]*?state\.widgets = state\.widgets\.filter[\s\S]*?saveUserCanvasChange\(\)[\s\S]*?setStatusKey\("widgetDeleted"\)/);
  assert.doesNotMatch(functionSource(app, "deleteWidget"), /confirm\(/);
  assert.match(functionSource(app, "applyHistory"), /widgetsBefore[\s\S]*?widgetsAfter[\s\S]*?restoreWidgets/);
  assert.match(begin, /start:widgetLayout\(result\.widget\)/);
  assert.match(updatePoint, /gesture\.hit === "move"[\s\S]*?resizeWidgetBox/);
  assert.match(finishReleased, /event\.pointerType !== "mouse"[\s\S]*?Number\(event\.buttons\) !== 0[\s\S]*?gesture\.source !== "widget-host"[\s\S]*?finishWidgetGesture/);
  assert.match(finishStaleHost, /gesture\.source !== "widget-host"[\s\S]*?Number\(event\.button\) !== 0[\s\S]*?finishWidgetGesture/);
  assert.match(pointerHit, /hit && hit !== "move"/);
  assert.match(messageHandler, /validWidgetHostDrag\(message\)[\s\S]*?beginWidgetHostDrag\(widget, message\)[\s\S]*?updateWidgetHostDrag\(widget, message\)[\s\S]*?finishWidgetHostDrag\(widget, message\)/);
  assert.match(messageHandler, /validWidgetHostTouch\(message\)[\s\S]*?beginWidgetHostTouch\(widget, message\)[\s\S]*?updateWidgetHostTouch\(widget, message\)[\s\S]*?finishWidgetHostTouch\(widget, message\)/);
  assert.doesNotMatch(messageHandler, /validWidgetHostNavigation|handleWidgetHostNavigation/);
  assert.match(messageHandler, /validWidgetHostActivate\(message\)[\s\S]*?handObjectToolbarTargetFromWidgetMessage\(widget, message\)[\s\S]*?focusHandObject\(target\.kind, target\.object\)/);
  assert.doesNotMatch(messageHandler, /penecho-widget-copy-source/);
  assert.match(functionSource(app, "sendWidgetHostState"), /selected[\s\S]*?penecho-widget-state[\s\S]*?scaleX[\s\S]*?scaleY/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /state\.handWidgetPointerIds[\s\S]*?source:"widget-host"[\s\S]*?hit:message\.hit[\s\S]*?startPoint:clientPoint/);
  const widgetStackState = {
      widgets:[
        { id:"html-a", widgetType:"html_widget" },
        { id:"diagram", widgetType:"diagram_source" },
        { id:"html-b", widgetType:"html_widget" },
      ],
      widgetEdit:{ id:"html-a", changed:false },
    },
    stackMoves = [],
    setWidgetStackIndex = vm.runInNewContext(`(${functionSource(app, "setWidgetStackIndex")})`, {
      state:widgetStackState,
      syncWidgetLayerOrder:() => stackMoves.push(widgetStackState.widgets.map(widget => widget.id)),
    }),
    bringHtmlWidgetToFront = vm.runInNewContext(`(${functionSource(app, "bringHtmlWidgetToFront")})`, { state:widgetStackState, setWidgetStackIndex });
  assert.equal(bringHtmlWidgetToFront(widgetStackState.widgets[0]), true);
  assert.deepEqual(widgetStackState.widgets.map(widget => widget.id), ["diagram", "html-b", "html-a"]);
  assert.equal(widgetStackState.widgetEdit.changed, true);
  assert.deepEqual(stackMoves, [["diagram", "html-b", "html-a"]]);
  assert.equal(bringHtmlWidgetToFront(widgetStackState.widgets[0]), false, "diagram widgets keep their existing stack order");
  const stackStyles = [{}, {}, {}],
    syncWidgetLayerOrder = vm.runInNewContext(`(${functionSource(app, "syncWidgetLayerOrder")})`, {
      state:{
        widgets:stackStyles.slice(0, 2).map(style => ({ styleRule:{ style } })),
        pendingWidget:{ styleRule:{ style:stackStyles[2] } },
      },
    });
  syncWidgetLayerOrder();
  assert.deepEqual(stackStyles.map(style => style.zIndex), ["1", "2", "3"]);
  assert.doesNotMatch(functionSource(app, "syncWidgetLayerOrder"), /append|appendChild|insertBefore/, "changing Widget order must not reparent live iframes");
  assert.match(functionSource(app, "mountWidget"), /addWidgetStyleRule\(widget\);[\s\S]*?syncWidgetLayerOrder\(\);[\s\S]*?positionWidget\(widget\)/);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("load"[\s\S]*?widget\.initialized = false[\s\S]*?widget\.hostReady = false[\s\S]*?widget\.hostReadyPromise = new Promise[\s\S]*?probeWidgetHost\(widget\)/);
  assert.match(functionSource(app, "beginWidgetGesture"), /beginWidgetEdit\(result\.widget\)[\s\S]*?bringHtmlWidgetToFront\(result\.widget\)/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /beginWidgetEdit\(widget\)[\s\S]*?bringHtmlWidgetToFront\(widget\)/);
  assert.match(functionSource(app, "beginWidgetEdit"), /beforeIndex:state\.widgets\.indexOf\(widget\)/);
  assert.match(functionSource(app, "cancelWidgetEdit"), /setWidgetStackIndex\(widget, edit\.beforeIndex\)/);
  assert.match(functionSource(app, "updateWidgetHostDrag"), /widgetHostViewportPoint[\s\S]*?updateWidgetGesturePoint/);
  assert.match(functionSource(app, "finishWidgetHostDrag"), /finishWidgetGesture/);
  const handTarget = functionSource(app, "handObjectToolbarTargetAtPoint");
  assert.ok(handTarget.indexOf("textBoxAtPoint(point)") < handTarget.indexOf("imageAtPoint(point)"));
  assert.ok(handTarget.indexOf("imageAtPoint(point)") < handTarget.indexOf("visibleWidgets()"));
  assert.ok(handTarget.indexOf("visibleWidgets()") < handTarget.indexOf("animationPointerHit(point)"));
  assert.match(functionSource(app, "handObjectToolbarTargetFromWidgetMessage"), /widgetHostViewportPoint\(widget, message\)[\s\S]*?handObjectToolbarTargetAtPoint\(clientPoint[\s\S]*?kind:"widget"/);
  assert.match(functionSource(app, "beginWidgetHostTouch"), /beginWidgetOwnedHandGesture\(id\)[\s\S]*?handObjectToolbarTargetFromWidgetMessage\(widget, message\)[\s\S]*?focusHandObject\(target\.kind, target\.object, token\)[\s\S]*?handPointerFocusKeys\.set/);
  assert.doesNotMatch(functionSource(app, "beginWidgetHostTouch"), /state\.touches|beginTouchGesture|moveCanvas/);
  assert.match(functionSource(app, "updateWidgetHostTouch"), /handWidgetPointerIds\.has\(id\)[\s\S]*?updateHandObjectFocus/);
  assert.doesNotMatch(functionSource(app, "updateWidgetHostTouch"), /updateTouchGesture|moveCanvas/);
  assert.match(functionSource(app, "finishWidgetHostTouch"), /finishHandObjectFocus[\s\S]*?finishWidgetOwnedHandGesture[\s\S]*?widgetHostPointerAnchors\.delete/);
  assert.match(functionSource(app, "beginWidgetOwnedHandGesture"), /handGestureIncludesWidget = true[\s\S]*?panGesture = null[\s\S]*?touchGesture = null/);
  const clearWidgetOwned = functionSource(app, "clearWidgetOwnedHandGestures"),
    beginResetTap = functionSource(app, "beginCanvasWidgetGestureResetTap"),
    updateResetTap = functionSource(app, "updateCanvasWidgetGestureResetTap"),
    finishResetTap = functionSource(app, "finishCanvasWidgetGestureResetTap");
  assert.match(clearWidgetOwned, /handWidgetPointerIds[\s\S]*?widgetHostPointerAnchors[\s\S]*?finishHandObjectFocus[\s\S]*?finishWidgetRefineTouch[\s\S]*?handWidgetPointerIds\.clear\(\)[\s\S]*?widgetHostPointerAnchors\.clear\(\)[\s\S]*?handGestureIncludesWidget = false/);
  assert.match(clearWidgetOwned, /pointerPrefix[\s\S]*?widget-host:[^\n]*widget\.id[\s\S]*?state\.widgetGesture\?\.widget === widget[\s\S]*?handWidgetPointerIds\.delete[\s\S]*?widgetHostPointerAnchors\.delete[\s\S]*?state\.widgetGesture = null/);
  assert.match(functionSource(app, "unmountWidget"), /clearWidgetOwnedHandGestures\(widget\)[\s\S]*?widget\.shell\?\.remove\(\)/);
  assert.match(beginResetTap, /state\.mode !== "hand"[\s\S]*?\["mouse", "touch"\][\s\S]*?event\.isPrimary === false[\s\S]*?state\.pointers\.size[\s\S]*?handObjectToolbarTargetAtPoint\(point\)/);
  assert.match(updateResetTap, /state\.pointers\.size > 1[\s\S]*?Math\.hypot[\s\S]*?HAND_WIDGET_GESTURE_RESET_TAP_PX/);
  assert.match(finishResetTap, /state\.mode !== "hand"[\s\S]*?event\.type === "pointercancel"[\s\S]*?state\.pointers\.size[\s\S]*?state\.touches\.size[\s\S]*?clearWidgetOwnedHandGestures\(\)/);
  assert.match(pointerDown, /beginCanvasWidgetGestureResetTap\(e, handPoint\)[\s\S]*?state\.pointers\.set/);
  assert.match(app, /screen\.addEventListener\("pointermove"[\s\S]*?updateCanvasWidgetGestureResetTap\(e\)[\s\S]*?finishReleasedWidgetGesture\(e\)/);
  assert.match(functionSource(app, "end"), /state\.pointers\.delete[\s\S]*?state\.touches\.delete[\s\S]*?finishCanvasWidgetGestureResetTap\(e\)[\s\S]*?handGestureIncludesWidget/);
  const resetState = {
      mode:"hand",
      handGestureIncludesWidget:true,
      handWidgetPointerIds:new Set(["widget-touch:1"]),
      pointers:new Map(),
      touches:new Map(),
    },
    resetAnchors = new Map([["widget-touch:1", {}]]),
    resetFinished = [],
    resetHarness = vm.runInNewContext(`(() => {
      const HAND_WIDGET_GESTURE_RESET_TAP_PX = 8;
      let canvasWidgetGestureResetTap = null;
      ${clearWidgetOwned}
      ${beginResetTap}
      ${updateResetTap}
      ${finishResetTap}
      return { beginCanvasWidgetGestureResetTap, updateCanvasWidgetGestureResetTap, finishCanvasWidgetGestureResetTap };
    })()`, {
      state:resetState,
      widgetHostPointerAnchors:resetAnchors,
      valid:() => true,
      handObjectToolbarTargetAtPoint:() => null,
      finishHandObjectFocus:({ pointerId }) => resetFinished.push(`focus:${pointerId}`),
      finishWidgetRefineTouch:(pointerId) => resetFinished.push(`refine:${pointerId}`),
    }),
    resetPointer = { pointerId:7, pointerType:"touch", isPrimary:true, button:0, clientX:100, clientY:120 };
  assert.equal(resetHarness.beginCanvasWidgetGestureResetTap(resetPointer, { x:10, y:20 }), true);
  assert.equal(resetHarness.finishCanvasWidgetGestureResetTap({ ...resetPointer, type:"pointerup" }), true);
  assert.equal(resetState.handGestureIncludesWidget, false);
  assert.equal(resetState.handWidgetPointerIds.size, 0);
  assert.equal(resetAnchors.size, 0);
  assert.deepEqual(resetFinished, ["focus:widget-touch:1", "refine:widget-touch:1"]);
  resetState.mode = "pen";
  resetState.handGestureIncludesWidget = true;
  resetState.handWidgetPointerIds.add("widget-touch:2");
  assert.equal(resetHarness.beginCanvasWidgetGestureResetTap(resetPointer, { x:10, y:20 }), false);
  assert.equal(resetState.handWidgetPointerIds.has("widget-touch:2"), true);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("pointerenter"[\s\S]*?updateHandObjectHover\(clientPoint\(event\)\)[\s\S]*?frame\.addEventListener\("pointerleave"[\s\S]*?updateHandObjectHover\(null\)/);
  const trackedPoint = vm.runInNewContext(`(${functionSource(app, "widgetHostTrackedPoint")})`, { screenClientRatio:0.5 });
  assert.deepEqual({ ...trackedPoint({ clientX:100, clientY:200, screenX:500, screenY:600 }, { screenX:540, screenY:660 }) }, { x:120, y:230 });
  assert.equal(trackedPoint(null, { screenX:0, screenY:0 }), null);
  assert.match(functionSource(app, "updateWidgetHostTouch"), /widgetHostTrackedPoint\(widgetHostPointerAnchors\.get\(id\), message\)/);
  assert.match(functionSource(app, "updateWidgetHostDrag"), /widgetHostTrackedPoint\(gesture\.hostAnchor, message\)/);
  assert.match(functionSource(app, "beginWidgetHostTouch"), /widgetHostPointerAnchors\.set\(id/);
  assert.match(functionSource(app, "beginWidgetHostDrag"), /hostAnchor:\{ clientX:viewportPoint\.x, clientY:viewportPoint\.y, screenX:message\.screenX, screenY:message\.screenY \}/);
  assert.match(functionSource(app, "finishWidgetHostTouch"), /widgetHostPointerAnchors\.delete\(id\)/);
  assert.match(functionSource(app, "validWidgetHostTouch"), /message\.screenX, message\.screenY/);
  assert.match(functionSource(app, "validWidgetHostDrag"), /message\.screenX, message\.screenY/);
  assert.match(functionSource(app, "calibrateScreenClientRatio"), /screenClientRatio/);
  assert.match(functionSource(app, "renderInteractionLayer"), /drawSelectedAnimation[\s\S]*?drawPending[\s\S]*?drawWidgetChrome/);
  assert.ok(pointerDown.indexOf("widgetPointerHit(point") < pointerDown.indexOf("animationPointerHit(point"));
  assert.match(app, /state\.widgetGesture\?\.id === e\.pointerId[\s\S]*?updateWidgetGesture\(e\)/);
  assert.match(app, /state\.widgetGesture\?\.id === e\.pointerId[\s\S]*?finishWidgetGesture\(e\)/);
  assert.match(pointerDown, /finishStaleWidgetHostGesture\(e\)/);
  assert.match(app, /objectChromeLayer\?\.addEventListener\("pointermove"[\s\S]*?finishReleasedWidgetGesture\(event\)/);
  assert.match(css, /\.widget-layer\s*\{[^}]*z-index:\s*1[^}]*pointer-events:\s*none/);
  assert.match(css, /\.canvas-widget\s*\{[^}]*pointer-events:\s*none/);
  assert.match(frameRule, /pointer-events:\s*none/);
  assert.match(css, /#viewport\.hand-mode \.canvas-widget-frame\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(frameRule, /border:\s*0/);
  assert.match(frameRule, /background:\s*transparent/);
  assert.doesNotMatch(frameRule, /box-shadow|border-radius/);
  assert.doesNotMatch(css, /canvas-widget-toolbar/);
  const downloadWidgetImage = functionSource(app,"downloadWidgetImage");
  assert.match(downloadWidgetImage,/requestWidgetSnapshot\(widget, WIDGET_SNAPSHOT_TIMEOUT_MS, true, null, true\)[\s\S]*?link\.download = widgetImageFilename\(widget\)[\s\S]*?link\.click\(\)/);
  assert.doesNotMatch(downloadWidgetImage,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\/api\/|cloud|relay/i);
  assert.match(app,/function addWidgetToolSpecs[\s\S]*?kind:"download"[\s\S]*?widgetToolGroup = `widget-\$\{widget\.id\}-tools`[\s\S]*?widgetToolPlacement:"inside-top"/);
  for (const key of ["downloadWidget","widgetDownloading","widgetDownloaded","widgetDownloadFailed"]) {
    assert.match(app,new RegExp(`${key}:`));
    assert.match(read("public/locales/zh.js"),new RegExp(`${key}:`));
  }
  assert.match(read("src/server/main.js"), /Keep user-facing text natively selectable and do not globally disable text selection/);
});

test("widget AI refinement is discoverable near ink and replaces only its locked target", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    server = read("src/server/main.js"),
    candidate = functionSource(app, "currentWidgetRefineCandidate"),
    latch = functionSource(app, "latchWidgetRefineCandidate"),
    strokeProximity = functionSource(app, "strokeWidgetProximity"),
    context = functionSource(app, "widgetEditContext"),
    request = functionSource(app, "requestWidgetRefinement"),
    validate = functionSource(app, "validate"),
    replacementInput = functionSource(app, "widgetReplacementRecordInput"),
    start = functionSource(app, "startPendingWidgetReplacement"),
    accept = functionSource(app, "acceptPendingWidget"),
    reject = functionSource(app, "rejectPendingWidget"),
    cancel = functionSource(app, "cancelWidgetRefinement"),
    mode = functionSource(app, "setCanvasMode"),
    snapshot = functionSource(app, "requestWidgetSnapshot"),
    chrome = functionSource(app, "objectChromeSpecs"),
    selectedRefine = functionSource(app, "selectedWidgetRefineCandidate"),
    record = functionSource(app, "widgetRecord"),
    serialize = functionSource(app, "serializedWidgets");

  assert.match(candidate, /const candidate = state\.widgetRefineCandidate/);
  assert.match(candidate, /if \(!candidate\) return null/);
  assert.doesNotMatch(candidate, /pluginId/);
  assert.match(latch, /if \(state\.widgetRefineCandidate[\s\S]*?return state\.widgetRefineCandidate/);
  assert.match(latch, /for \(const widget of visibleWidgets\(\)\)[\s\S]*?kind === "text-box"[\s\S]*?boxWidgetProximity\(widget, textBoxBox\(input\)\)[\s\S]*?kind === "box"[\s\S]*?boxWidgetProximity\(widget, input\)[\s\S]*?strokeWidgetProximity\(widget, input\)/);
  assert.match(latch, /instructionMode:"nearby-dirty"[\s\S]*?hintKey:"widgetRefineNearbyHint"[\s\S]*?hintUntil:Date\.now\(\) \+ WIDGET_REFINE_HINT_MS/);
  assert.match(app, /const WIDGET_REFINE_PROXIMITY_PX = 24/);
  assert.match(app, /const WIDGET_REFINE_HOVER_GRACE_MS = 5000/);
  assert.match(app, /const WIDGET_REFINE_HINT_MS = 10000/);
  assert.match(strokeProximity, /drawing\.trail[\s\S]*?drawing\.last[\s\S]*?next <= WIDGET_REFINE_PROXIMITY_PX[\s\S]*?distance <= WIDGET_REFINE_PROXIMITY_PX/);
  const nonHandChrome = chrome.slice(0, chrome.indexOf("return specs;"));
  assert.match(nonHandChrome, /persistentCandidate = currentWidgetRefineCandidate\(\)[\s\S]*?hoverCandidate = currentWidgetRefineHoverCandidate\(\)[\s\S]*?state\.mode !== "hand"/);
  assert.doesNotMatch(nonHandChrome, /copy:true/);
  assert.match(chrome, /for \(const \[key, record\] of state\.handToolbarTargets\)[\s\S]*?record\.kind === "text-box"[\s\S]*?target:"text-box"/);
  assert.match(chrome, /if \(persistentCandidate\) addWidgetToolSpecs\(specs, persistentCandidate\.widget, \{ refine:persistentCandidate \}\)/);
  assert.match(functionSource(app, "updateWidgetRefinePointer"), /\["pen", "hand"\]\.includes\(state\.mode\)[\s\S]*?widgetAtRefinePoint[\s\S]*?const hasDirty = viewportHasWidgetRefineInput/);
  assert.match(functionSource(app, "updateWidgetRefinePointer"), /instructionMode:"viewport-dirty"[\s\S]*?hintKey:"widgetRefineViewportHint"/);
  assert.match(selectedRefine, /persistentCandidate\?\.widget === widget[\s\S]*?hoverCandidate\?\.widget === widget/);
  assert.match(selectedRefine, /const hasDirty = viewportHasWidgetRefineInput\(\)[\s\S]*?instructionMode:hasDirty \? "viewport-dirty" : "implicit-polish"[\s\S]*?hintKey:hasDirty \? "widgetRefineViewportHint" : "widgetRefineNoInputHint"/);
  assert.match(functionSource(app, "scheduleWidgetRefineHoverClear"), /WIDGET_REFINE_HOVER_GRACE_MS/);
  assert.match(functionSource(app, "widgetRefineHintVisible"), /widgetRefineHintHovered\(candidate\) \|\| candidate\.hintUntil > Date\.now\(\)/);
  assert.match(functionSource(app, "confirmTextEditor"), /latchWidgetRefineCandidate\(item, "text-box"\)[\s\S]*?!refineCandidate\) schedule/);
  assert.match(functionSource(app, "finishTextBoxChromeGesture"), /latchWidgetRefineCandidate\(gesture\.item, "text-box"\)/);
  assert.doesNotMatch(read("public/widget-host.js"), /penecho-widget-hover/);
  assert.match(functionSource(app, "beginWidgetRefineTouch"), /state\.mode !== "pen"[\s\S]*?setWidgetRefineHoverCandidate\(widget, false\)[\s\S]*?widgetRefineTouchCandidates\.set/);
  assert.doesNotMatch(functionSource(app, "beginWidgetHostTouch"), /beginWidgetRefineTouch/);
  assert.match(app, /state\.mode === "pen"\) beginWidgetRefineTouch\(`canvas-touch:/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /dirtyBox[\s\S]*?state\.widgetRefineConfirmation/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /clearTimeout\(state\.timer\)[\s\S]*?state\.timer = 0[\s\S]*?state\.widgetRefineConfirmation/);
  assert.match(functionSource(app, "beginWidgetRefineConfirmation"), /anchor:anchor \? \{ \.\.\.anchor \} : null/);
  assert.match(app, /activate:\(button\) => void beginWidgetRefineConfirmation\(options\.refine, objectChromeAnchor\(button\)\)/);
  assert.match(functionSource(app, "createObjectChromeButton"), /activate\?\.\(button\)/);
  assert.match(functionSource(app, "confirmWidgetRefinement"), /requestWidgetRefinement\(confirmation\.widget, confirmation\.instructionMode\)/);
  assert.match(functionSource(app, "cancelWidgetRefineConfirmation"), /clearWidgetRefineCandidate\(\)[\s\S]*?state\.auto[\s\S]*?state\.dirty[\s\S]*?state\.autoEligible[\s\S]*?schedule\(state\.autoDelayMs\)/);
  assert.match(functionSource(app, "drawWidgetRefineConfirmation"), /strokeWidgetRefineOutline\(context, widget, 1, !confirmation\.hasDirty, true\)[\s\S]*?strokeRect\(box\.x, box\.y, box\.w, box\.h\)[\s\S]*?widgetRefineConnectorPoints\(box, widgetBounds\)[\s\S]*?connector\.slice\(1\)/);
  assert.match(functionSource(app, "drawWidgetRefineConfirmation"), /strokeStyle = "#007aff"[\s\S]*?lineWidth = 2 \* unit[\s\S]*?setLineDash\(\[\]\)[\s\S]*?strokeRect\(box\.x, box\.y, box\.w, box\.h\)[\s\S]*?widgetRefineConnectorPoints/);
  assert.match(functionSource(app, "widgetRefineConnectorPoints"), /widgetRefineEdgeMidpoints\(fromBox\)[\s\S]*?Math\.hypot[\s\S]*?middleX[\s\S]*?middleY/);
  assert.doesNotMatch(functionSource(app, "drawWidgetRefineConfirmation"), /box\.x \+ box\.w \/ 2[\s\S]*?widgetBounds\.x \+ widgetBounds\.w \/ 2/);
  assert.match(css, /\.widget-refine-confirmation-copy\s*\{[^}]*overflow:\s*visible[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/);
  assert.doesNotMatch(css, /\.widget-refine-confirmation-copy\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(functionSource(app, "syncWidgetRefineConfirmation"), /Math\.min\(560, view\.clientWidth - 24\)[\s\S]*?element\.offsetHeight/);
  const confirmationPosition = vm.runInNewContext(`(${functionSource(app, "widgetRefineConfirmationPosition")})`);
  assert.deepEqual({ ...confirmationPosition({ x:300, y:220, width:112, height:34 }, 360, 50, 1000, 700) }, { x:176, y:212 });
  assert.deepEqual({ ...confirmationPosition({ x:930, y:220, width:64, height:34 }, 360, 50, 1000, 700) }, { x:632, y:212 });
  assert.deepEqual({ ...confirmationPosition({ x:300, y:670, width:112, height:34 }, 360, 50, 1000, 700) }, { x:176, y:642 });
  assert.match(chrome, /editWidget = state\.mode === "hand" && state\.widgetEdit \? selectedWidget\(\) : null/);
  const handChrome = chrome.slice(chrome.indexOf("const specs = [];", chrome.indexOf("return specs;") + 1));
  assert.doesNotMatch(handChrome, /addWidgetToolSpecs\([^\n]*refine:/);
  assert.match(handChrome, /state\.widgetEdit\?\.id === handTarget\.id[\s\S]*?editWidget === handTarget[\s\S]*?addWidgetToolSpecs\(specs, handTarget, \{[\s\S]*?copy:true,[\s\S]*?community:true,[\s\S]*?download:true,[\s\S]*?handToolbar:true/);
  assert.match(chrome, /state\.pendingWidget[\s\S]*?addWidgetToolSpecs\(specs, widget, \{[\s\S]*?copy:true,[\s\S]*?download:true,[\s\S]*?widgetCoreMoveKey:`pending-widget:\$\{widget\.id\}:move`[\s\S]*?widgetCoreAcceptKey:`pending-widget:\$\{widget\.id\}:accept`/);
  assert.match(request, /supersedeActiveAI\("widget-refine"\)[\s\S]*?captureCurrentViewport:true[\s\S]*?widgetEditTarget:widget/);
  assert.match(functionSource(app, "requestAI"), /let attentionBox = dirtySnapshot[\s\S]*?if \(requestedAttentionBox\) attentionBox = requestedAttentionBox/);
  assert.match(request, /clearTimeout\(state\.timer\)[\s\S]*?state\.timer = 0[\s\S]*?supersedeActiveAI\("widget-refine"\)/);
  assert.match(functionSource(app, "schedule"), /activeWidgetRefinement\(\) \|\| state\.widgetRefineConfirmation/);
  assert.match(functionSource(app, "launchAutomaticAI"), /state\.drawing \|\| state\.widgetRefineConfirmation/);
  assert.doesNotMatch(request, /requestWidgetSnapshot|await/);
  assert.match(context, /widget\.widgetType === "diagram_source" \? \{ source:widget\.source \} : \{ html:widget\.html \}/);
  assert.match(context, /sourceMirrorsHtml = widgetUsesHtmlCopySource\(widget\)/);
  assert.match(context, /sourceMirrorsHtml \? \{ sourceMirrorsHtml:true \} : widget\.widgetType !== "diagram_source" && widget\.copyText \? \{ source:widget\.copyText, copyLabel:widget\.copyLabel \}/);
  assert.match(context, /widget\.widgetType === "html_widget" && widget\.runtimeDiagnostics\?\.errors\?\.length[\s\S]*?runtimeDiagnostics:widget\.runtimeDiagnostics/);
  assert.match(context, /refreshSeconds:widget\.refreshSeconds/);
  assert.doesNotMatch(context, /\bid\b|targetId/);
  for (const field of ["communityOriginItemId", "communityRootItemId", "communityOriginName", "communityOriginGeneration"]) assert.doesNotMatch(context, new RegExp(field));
  assert.doesNotMatch(functionSource(app, "serializedWidgets"), /runtimeDiagnostics/);
  assert.match(functionSource(app, "widgetUsesHtmlCopySource"), /widget\.pluginId !== "image-search"[\s\S]*?!widget\.copyText \|\| widgetSourceMirrorsHtml/);
  assert.match(functionSource(app, "widgetCopySource"), /widgetUsesHtmlCopySource\(widget\) \? widget\.html : widget\.copyText/);
  assert.match(functionSource(app, "widgetCopySourceLabel"), /widgetUsesHtmlCopySource\(widget\)\) return "Copy HTML"/);
  assert.match(validate, /widgetEditTarget && c\.pluginId !== widgetEditTarget\.pluginId/);
  assert.match(validate, /sourceFormat \? `Copy \$\{sourceFormat\}` : "Copy source"/);
  assert.match(start, /state\.widgets\.includes\(target\)[\s\S]*?widgetReplacementRecordInput\(command, target\)[\s\S]*?target\.hiddenForReplacement = true/);
  const replacementRecord = vm.runInNewContext(`(${replacementInput})`),
    protectedOrigin = {
      communityOriginItemId:"123e4567-e89b-42d3-a456-426614174000",
      communityRootItemId:"123e4567-e89b-42d3-a456-426614174001",
      communityOriginName:"Original Echo",
      communityOriginGeneration:7,
    },
    replacement = replacementRecord({
      pluginId:"general",
      html:"<main>AI update</main>",
      favorite:true,
      communityOriginItemId:"123e4567-e89b-42d3-a456-426614174099",
      communityRootItemId:"123e4567-e89b-42d3-a456-426614174098",
      communityOriginName:"Forged origin",
      communityOriginGeneration:99,
    }, {
      id:"widget-7", x:10, y:20, w:300, h:200, contentW:600, contentH:400,
      ...protectedOrigin,
    });
  assert.deepEqual({
    communityOriginItemId:replacement.communityOriginItemId,
    communityRootItemId:replacement.communityRootItemId,
    communityOriginName:replacement.communityOriginName,
    communityOriginGeneration:replacement.communityOriginGeneration,
  }, protectedOrigin);
  assert.equal(replacement.favorite, false);
  assert.equal(replacement.html, "<main>AI update</main>");
  assert.match(start, /state\.pendingWidgetReplacement = \{ target[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)[\s\S]*?Promise\.resolve\(state\.widgets\.includes\(widget\)\)/);
  assert.doesNotMatch(start, /enterAIDraftHandMode|widgetReplacementReady/);
  assert.match(accept, /recordWidgetsBefore\(\)[\s\S]*?state\.widgets\.indexOf\(replacement\.target\)[\s\S]*?state\.widgets\.splice\(index, 1, widget\)[\s\S]*?const historyEntry = save\(\)/);
  assert.match(reject, /replacement\.target\.hiddenForReplacement = false[\s\S]*?mountWidget\(replacement\.target\)/);
  assert.match(cancel, /activeWidgetRefinement\(\)[\s\S]*?state\.pendingWidgetReplacement[\s\S]*?rejectPendingWidget/);
  assert.match(mode, /staysInWidgetRefineModes = \["pen", "hand"\]\.includes\(state\.mode\) && \["pen", "hand"\]\.includes\(mode\)/);
  assert.match(mode, /mode !== state\.mode && !staysInWidgetRefineModes[\s\S]*?else cancelWidgetRefinement\("widget-refine-tool-change"/);
  assert.doesNotMatch(mode, /state\.pendingWidgetReplacement\) rejectPendingWidget/);
  assert.match(mode, /!options\.preserveWidgetRefinement/);
  assert.match(functionSource(app, "enterAIDraftHandMode"), /preserveWidgetRefinement:true/);
  assert.match(snapshot, /try \{[\s\S]*?finally \{[\s\S]*?previousActive === false[\s\S]*?widget\.renderActive = false/);
  for (const field of ["diagramKind", "sourceFormat", "frameworkVersion"]) {
    assert.match(record, new RegExp(field));
    assert.match(serialize, new RegExp(field));
  }
  assert.match(server, /widgetEditPolicy:payload\.widgetEdit\.widgetType === "diagram_source"/);
  assert.match(server, /resolveWidgetEditPatchCommands/);
  assert.match(functionSource(server, "filterWidgetEditCommands"), /commands\.length === 1[\s\S]*?widget\?\.tool === widgetEdit\.widgetType[\s\S]*?widget\.pluginId === widgetEdit\.pluginId/);
  assert.match(server, /sourceFormat is an open string, never an enum/);
  assert.doesNotMatch(server, /ALLOWED_(?:SOURCE_)?FORMATS|SOURCE_FORMATS\s*=\s*new Set/);
  assert.match(functionSource(app, "dismissWidgetRefineCandidate"), /clearWidgetRefineCandidate\(\)/);
  assert.match(app, /widgetRefinePointer/);
  assert.match(functionSource(app, "requestAI"), /^function requestAI[\s\S]*?clearWidgetRefineCandidate\(\)/);
  const finishDrawing = functionSource(app, "finishDrawing"),
    launchAutomatic = functionSource(app, "launchAutomaticAI"),
    scheduleAutomatic = functionSource(app, "schedule");
  assert.match(finishDrawing, /refineCandidate = latchWidgetRefineCandidate\(d\)/);
  assert.match(finishDrawing, /state\.dirty && state\.autoEligible && !refineCandidate\) schedule\(\)/);
  assert.match(finishDrawing, /refineCandidate \? "widgetRefinePending"/);
  assert.match(launchAutomatic, /currentWidgetRefineCandidate\(\)[\s\S]*?setStatusKey\("widgetRefinePending"\)[\s\S]*?return/);
  assert.match(scheduleAutomatic, /currentWidgetRefineCandidate\(\)[\s\S]*?setStatusKey\("widgetRefinePending"\)[\s\S]*?return/);
  assert.match(launchAutomatic, /aiPreparation \|\| state\.activeAI[\s\S]*?return[\s\S]*?supersedeActiveAI\(reason\)/);
  assert.match(scheduleAutomatic, /activeWidgetRefinement\(\)[\s\S]*?return[\s\S]*?state\.timer = setTimeout/);
  assert.match(app, /widgetRefinePending:/);
  assert.match(zh, /widgetRefinePending:/);
  assert.doesNotMatch(functionSource(app, "objectChromePosition"), /side:"(?:right|bottom|left)"[\s\S]*?positions\.find/);
  assert.match(functionSource(app, "objectChromePosition"), /spec\.widgetCoreMoveKey && spec\.widgetCoreAcceptKey[\s\S]*?side:"move"[\s\S]*?preferred\.x \+ preferred\.w <= acceptPosition\.x - gap[\s\S]*?side:"accept"[\s\S]*?y:acceptPosition\.y \+ acceptHeight \+ gap[\s\S]*?fitsBetweenCoreControls \? preferred : belowAccept/);
  assert.match(functionSource(app, "objectChromePosition"), /if \(spec\?\.widgetCore\)[\s\S]*?inset = 8[\s\S]*?kind === "cancel" \? screenBox\.left \+ inset : right - width - inset[\s\S]*?y:screenBox\.top \+ inset/);
  assert.match(functionSource(app, "objectChromePosition"), /spec\.groupHorizontalOffset[\s\S]*?vertical \? spec\.groupVerticalOffset/);
  assert.doesNotMatch(functionSource(app, "objectChromePosition"), /querySelectorAll|overlapsObstacle|fallbackPosition/);
  assert.match(functionSource(app, "objectChromeSpecs"), /widgetToolGroup = `widget-\$\{handTarget\.id\}-tools`[\s\S]*?widgetCore:true, widgetToolGroup[\s\S]*?widgetCoreMoveKey:`widget:\$\{handTarget\.id\}:move`[\s\S]*?widgetCoreAcceptKey:`widget:\$\{handTarget\.id\}:accept`/);
  assert.match(functionSource(app, "objectChromeSpecs"), /imageToolGroup = `image-\$\{handTarget\.id\}-tools`[\s\S]*?kind:"move"[\s\S]*?widgetCore:true, widgetToolGroup:imageToolGroup[\s\S]*?kind:"cancel"[\s\S]*?widgetCore:true, widgetToolGroup:imageToolGroup[\s\S]*?kind:"accept"[\s\S]*?widgetCore:true, widgetToolGroup:imageToolGroup/);
  assert.match(functionSource(app, "objectChromePosition"), /chromeGap = 7[\s\S]*?gap = chromeGap \* controlScale[\s\S]*?above = screenBox\.top - height - chromeGap/);
  const syncChrome = functionSource(app, "syncObjectChrome");
  assert.match(syncChrome, /knownPositions = new Map\(\)[\s\S]*?objectChromePosition\(spec\.box, spec\.kind, spec\.key, spec, knownPositions\)[\s\S]*?knownPositions\.set\(spec\.key, position\)/);
  assert.match(syncChrome, /spec\.kind === "refine"\) button\.removeAttribute\("title"\)/);
  assert.doesNotMatch(syncChrome, /button\.title = spec\.kind === "refine"/);
  assert.doesNotMatch(app, /function widgetToolScale/);
  assert.match(app, /function addWidgetToolSpecs\(specs, widget, options = \{\}\)[\s\S]*?controlScale:1[\s\S]*?baseHeight:34/);
  assert.match(app, /kind:"favorite"[\s\S]*?baseWidth:36,[\s\S]*?iconOnly:true/);
  assert.match(app, /kind:"share"[\s\S]*?baseWidth:36,[\s\S]*?iconOnly:true/);
  assert.match(syncChrome, /classList\.toggle\("icon-only", Boolean\(spec\.iconOnly\)\)/);
  assert.match(syncChrome, /classList\.toggle\("widget-chrome-control", Boolean\(spec\.widgetTool \|\| spec\.widgetCore\)\)/);
  assert.match(app, /favoriteLabelKey = widget\.favoriteBusy \? "favoriteWidgetSaving" : widget\.favorite \? "unfavoriteWidget" : "favoriteWidget"/);
  assert.match(app, /kind:"favorite"[\s\S]*?pressed:widget\.favorite === true,[\s\S]*?busy:widget\.favoriteBusy === true/);
  assert.match(functionSource(app, "createObjectChromeButton"), /kind === "move" \|\| button\.disabled/);
  assert.match(syncChrome, /classList\.toggle\("is-favorite", Boolean\(spec\.kind === "favorite" && spec\.pressed\)\)/);
  assert.match(syncChrome, /button\.disabled = Boolean\(spec\.busy\)/);
  assert.match(syncChrome, /spec\.kind === "favorite"\) button\.setAttribute\("aria-pressed", String\(Boolean\(spec\.pressed\)\)\)/);
  assert.match(syncChrome, /spec\.busy\) button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(app, /move:'<svg[^']*?<path d="M12 9V3M9 6l3-3 3 3[\s\S]*?M15 12h6M18 9l3 3-3 3/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.move \{ width: 34px; height: 34px;/);
  assert.match(read("public/style.css"), /\.object-chrome-button \{[^}]*box-shadow: none;[^}]*backdrop-filter: none;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] \.object-chrome-button\.widget-chrome-control \{[^}]*border-radius: 8px;[^}]*background: color-mix\(in srgb, var\(--studio-panel\) 74%, transparent\);[^}]*box-shadow: 0 2px 8px[^}]*backdrop-filter: saturate\(1\.16\) blur\(16px\)/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] \.object-chrome-button\.widget-chrome-control\.widget-tool \{[^}]*border-style: solid;[^}]*border-radius: 8px/);
  assert.match(read("public/style.css"), /#viewport \.canvas-widget\.is-selected, #viewport \.canvas-image-selection \{[^}]*border-radius: 10px;[^}]*background: color-mix\(in srgb, var\(--studio-panel,[^;]+12%, transparent\);[^}]*box-shadow: 0 4px 8px color-mix\(in srgb, var\(--studio-chrome-shadow-color,[^;]+72%, transparent\);[^}]*backdrop-filter: saturate\(1\.08\) blur\(18px\)/);
  assert.match(read("public/style.css"), /#viewport \.canvas-widget\.is-selected::after, #viewport \.canvas-image-selection::after \{[^}]*outline: 1px solid color-mix\(in srgb, var\(--studio-accent,[^)]+\) 46%, transparent\)[^}]*background: transparent;/);
  assert.doesNotMatch(read("public/style.css").match(/#viewport \.canvas-widget\.is-selected::after, #viewport \.canvas-image-selection::after \{[^}]*\}/)?.[0] || "", /backdrop-filter|filter:/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.widget-tool\.icon-only \{[^}]*gap: 0;[^}]*padding: 0;/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.widget-tool\.icon-only \.object-chrome-label \{ display: none; \}/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.favorite\.is-favorite svg \{ fill: currentColor; \}/);
  assert.match(read("public/style.css"), /\.object-chrome-button\.loading::after \{[^}]*animation: history-save-spin \.8s linear infinite;/);
  assert.match(read("public/style.css"), /object-chrome-button[^}]*scale\(var\(--object-control-scale, 1\)\)/);
  const canvasHtml = read("public/index.html"),
    materialLayerIndex = canvasHtml.indexOf('id="imageMaterialLayer"'),
    placedContentIndex = canvasHtml.indexOf('id="placedContentLayer"');
  assert.ok(materialLayerIndex >= 0 && materialLayerIndex < placedContentIndex);
  assert.match(canvasHtml, /id="imageMaterialLayer"[^>]*>[\s\S]*?id="imageSelectionMaterial"[\s\S]*?<\/div>[\s\S]*?id="placedContentLayer"/);
  assert.match(canvasHtml, /id="objectChromeLayer" class="object-chrome-layer"><\/div>/);
  assert.doesNotMatch(canvasHtml, /imagePlaceBtn|imageDeleteBtn|image-place-control/);
  assert.match(read("public/style.css"), /\.image-material-layer \{[^}]*z-index: 1;[^}]*overflow: hidden;[^}]*pointer-events: none;/);
  assert.match(read("public/style.css"), /body\[data-theme="studio"\] \.image-edit-bar \{[^}]*var\(--studio-panel\) 74%, transparent[^}]*box-shadow: 0 4px 8px/);
});

test("widget Refine discovery stays in the parent canvas and leaves iframe events untouched", () => {
  const app = read("public/app.js"),
    widgetHost = read("public/widget-host.js"),
    css = read("public/style.css"),
    pointer = functionSource(app, "updateWidgetRefinePointer"),
    hitTest = functionSource(app, "widgetAtRefinePoint"),
    messageHandler = functionSource(app, "handleWidgetMessage"),
    frameRule = /\.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "",
    handFrameRule = /#viewport\.hand-mode \.canvas-widget-frame\s*\{[^}]*\}/.exec(css)?.[0] || "";

  assert.match(pointer, /state\.widgetRefinePointer = point && valid\(point\) \? point : null/);
  assert.match(pointer, /\["pen", "hand"\]\.includes\(state\.mode\) \? widgetAtRefinePoint\(state\.widgetRefinePointer\) : null/);
  assert.match(hitTest, /visibleWidgets\(\)[\s\S]*?widgetBox\(widget\)[\s\S]*?point\.x[\s\S]*?point\.y/);
  assert.doesNotMatch(hitTest, /contentWindow|postMessage|addEventListener/);
  assert.match(functionSource(app, "mountWidget"), /frame\.addEventListener\("pointerenter"[\s\S]*?updateHandObjectHover\(clientPoint\(event\)\)[\s\S]*?frame\.addEventListener\("pointerleave"[\s\S]*?updateHandObjectHover\(null\)/);
  assert.doesNotMatch(widgetHost, /penecho-widget-hover|widget-refine/i);
  assert.doesNotMatch(messageHandler, /refine|hover/i);
  assert.match(frameRule, /pointer-events:\s*none/);
  assert.match(frameRule, /touch-action:\s*none/);
  assert.match(handFrameRule, /pointer-events:\s*auto/);
  assert.match(handFrameRule, /cursor:\s*default/);
});

test("selected Widget chrome stays inside the frame and follows Studio glass tokens", () => {
  const app = read("public/app.js"), css = read("public/style.css"),
    chromePosition = vm.runInNewContext(`(${functionSource(app, "objectChromePosition")})`, {
      state:{panX:0,panY:0,scale:1},
      view:{clientWidth:1200,clientHeight:800,getBoundingClientRect:()=>({left:0,top:0})},
      screenObjectBox:box=>({left:box.x,top:box.y,width:box.w,height:box.h}),
    }),
    box = {x:400,y:100,w:300,h:200},
    move = chromePosition(box,"move","",{widgetCore:true}),
    accept = chromePosition(box,"accept","",{widgetCore:true}),
    corePositions = new Map([["move",move],["accept",accept]]),
    firstTool = {widgetTool:true,widgetCoreMoveKey:"move",widgetCoreAcceptKey:"accept",groupHorizontalWidth:234,groupVerticalWidth:118,groupVerticalHeight:72,groupHorizontalOffset:0,groupVerticalOffset:0,baseWidth:118,baseHeight:34,controlScale:1},
    secondTool = {...firstTool,groupVerticalOffset:38,baseWidth:36},
    firstPosition = chromePosition(box,"copy","",firstTool,corePositions),
    secondPosition = chromePosition(box,"download","",secondTool,corePositions),
    selectedClasses = [],
    sendWidgetHostState = vm.runInNewContext(`(${functionSource(app, "sendWidgetHostState")})`, {
      state:{scale:1,widgetEdit:{id:"widget-1"},selectedWidgetId:"widget-1",navigationLocked:false},
    });
  sendWidgetHostState({
    id:"widget-1", pending:false, w:300, h:200, contentW:300, contentH:200, hostReady:false,
    shell:{classList:{toggle(name,value){selectedClasses.push([name,value]);}}},
  });

  assert.deepEqual({x:chromePosition(box,"cancel","",{widgetCore:true}).x,y:chromePosition(box,"cancel","",{widgetCore:true}).y},{x:408,y:108});
  assert.deepEqual({x:move.x,y:move.y},{x:533,y:108});
  assert.deepEqual({x:accept.x,y:accept.y},{x:656,y:108});
  assert.deepEqual({x:firstPosition.x,y:firstPosition.y},{x:574,y:149});
  assert.deepEqual({x:secondPosition.x,y:secondPosition.y},{x:656,y:187});
  assert.deepEqual(selectedClasses,[["is-selected",true]]);
  assert.doesNotMatch(functionSource(app, "objectChromePosition"), /querySelectorAll|positions\.find|fallbackPosition/);
  assert.match(functionSource(app, "drawWidgetChrome"), /state\.paint\.accent \|\| "#4f46e5"/);
  assert.match(css, /body\[data-theme="studio"\] \.object-chrome-button\.widget-chrome-control \{[^}]*var\(--studio-panel\)[^}]*box-shadow: 0 2px 8px[^}]*backdrop-filter: saturate\(1\.16\) blur\(16px\)/);
  assert.match(css, /#viewport \.canvas-widget\.is-selected, #viewport \.canvas-image-selection \{[^}]*var\(--studio-chrome-shadow-color,[^;]+72%, transparent\);[^}]*backdrop-filter: saturate\(1\.08\) blur\(18px\)/);
  assert.doesNotMatch(css.match(/#viewport \.canvas-widget\.is-selected::after, #viewport \.canvas-image-selection::after \{[^}]*\}/)?.[0] || "", /backdrop-filter|filter:/);
});

test("downsampled animation drafts clip against logical rather than raster dimensions", () => {
  const app = read("public/app.js"),
    rects = [],
    context = {
      beginPath() {},
      clip() {},
      rect(...args) {
        rects.push(args);
      },
      restore() {},
      save() {},
    },
    draw = vm.runInNewContext(`(${functionSource(app, "drawPending")})`, {
      createAnimationPlayback: () => ({}),
      ctx: context,
      draftBounds: () => ({ x: 100, y: 200, w: 4000, h: 3000 }),
      drawPendingAnimation: () => {},
      drawPendingBatch: () => {},
      drawTextDraftSurface: () => {},
      pendingAnimationChromeVisible: () => false,
    });

  draw({
    image: { width: 1000, height: 750, logicalWidth: 4000, logicalHeight: 3000 },
    animationScene: { w: 4000, h: 3000 },
    animationPlayback: {},
    revealProgress: 1,
    scaleX: 1,
    scaleY: 1,
  });

  assert.deepEqual(rects, [
    [100, 200, 4000, 3000],
    [100, 200, 4000, 3000],
  ]);
});

test("object bodies cannot activate editing outside Hand and long-press selection is removed", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('screen.addEventListener("pointerdown"'),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd),
    nonHand = pointerDown.indexOf('if (state.mode !== "hand")'),
    widgetHit = pointerDown.indexOf("widgetPointerHit(point"),
    imageHit = pointerDown.indexOf("imagePointerHit(point"),
    animationHit = pointerDown.indexOf("animationPointerHit(point");
  assert.ok(nonHand > 0 && nonHand < widgetHit && nonHand < imageHit && nonHand < animationHit);
  assert.match(pointerDown, /beginCanvasPointerAction\(e, clientPoint\(e\)\);\s*return/);
  assert.doesNotMatch(app, /beginAnimationTouchHold|animationTouchHold|ANIMATION_TOUCH_HOLD/);
  assert.doesNotMatch(app, /beginImageTouchHold|imageTouchHold|IMAGE_TOUCH_HOLD/);
  assert.match(functionSource(app, "beginObjectChromeMove"), /target === "animation"[\s\S]*?beginAnimationGesture/);
  assert.doesNotMatch(app, /function handleWidgetHostNavigation\(|function validWidgetHostNavigation\(/);
  assert.doesNotMatch(read("public/widget-host.js"), /penecho-widget-wheel|penecho-widget-pan-(?:start|move|end)/);
  assert.match(functionSource(app, "acceptAnimationEdit"), /selectedAnimationId = null[\s\S]*?requestInteractionLayerRender\(\)/);
});

test("Save canvas exposes non-blocking progress and completion feedback", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    saveCurrent = functionSource(app, "saveCurrentCanvas"),
    finalize = functionSource(app, "finalizeCanvasForSnapshot");
  assert.match(html, /id="historyNotice"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(app, /async function saveSnapshotFromHistory\(\)/);
  assert.match(app, /showHistoryNoticeKey\("snapshotSaving", "busy", 0\)/);
  assert.match(app, /selectionBusyKey = selectionAIStatusKey\(\)/);
  assert.match(app, /showHistoryNoticeKey\(id \? "snapshotSaved" : selectionBusy \? selectionBusyKey : "emptyCanvas"/);
  assert.match(app, /historySaveCurrent"\)\.onclick = saveCurrentCanvas/);
  assert.match(app, /historySave\"\)\.onclick = saveSnapshotFromHistory/);
  assert.match(app, /if \(event\.key === "Enter"\) saveCurrentCanvas\(\)/);
  assert.match(app, /button\.disabled = busy/);
  assert.match(css, /\.history-notice\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /#historySaveCurrent\.is-saving::before/);
  assert.match(zh, /snapshotSaving:/);
  assert.match(html, /id="saveCanvasBtn"/);
  assert.match(html, /id="historySaveCurrent"[^>]*>Save<\/button>/);
  assert.match(html, /id="historySave"[^>]*>Save New<\/button>/);
  assert.match(saveCurrent, /currentSnapshotLocation === state\.snapshotLocation \? state\.currentSnapshotId : null/);
  assert.match(saveCurrent, /requestedName = document\.querySelector\("#historyName"\)/);
  assert.match(saveCurrent, /saveSnapshot\(\{ overwriteId, name, location:state\.snapshotLocation \}\)/);
  assert.match(finalize, /state\.pendingWidget[\s\S]*?acceptPendingWidget\(\{ restoreMode:false \}\)/);
  assert.match(finalize, /state\.pending[\s\S]*?acceptPending\(\{ restoreMode:false \}\)/);
  assert.ok(finalize.indexOf("acceptPendingWidget") < finalize.indexOf("confirmTextEditor"));
  for (const edit of ["acceptWidgetEdit", "acceptImageEdit", "acceptAnimationEdit"]) assert.match(finalize, new RegExp(`\\b${edit}\\(\\)`));
  assert.match(finalize, /for \(const editor of \[\.\.\.state\.textEditors\.values\(\)\]\) await confirmTextEditor\(editor\)/);
  assert.match(finalize, /state\.selection[\s\S]*?commitSelection\(\)/);
  assert.match(finalize, /finishAIDraftHandMode\(\)/);
  assert.match(app, /async function saveSnapshot\(\{ overwriteId = null, name = null, location = state\.snapshotLocation \} = \{\}\) \{[\s\S]*?selectionAIBusy\(\)[\s\S]*?await finalizeCanvasForSnapshot\(\)[\s\S]*?if \(!tiles\.size/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?prepareVisibleWidgetSnapshots\(null, false\)/);
  assert.match(functionSource(app, "snapshotPreviewBlob"), /canvasBlob\(snapshotPreview\(\), "image\/webp", \.78\)[\s\S]*?fallback thumbnail[\s\S]*?data:image\/png;base64/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?preview = location === "cloud" \? await cloudSnapshotPreviewBlob\(\) : await snapshotPreviewBlob\(\)/);
  assert.match(functionSource(app, "loadSnapshot"), /state\.currentSnapshotId = item\.id/);
  assert.match(functionSource(app, "loadSnapshot"), /state\.currentSnapshotLocation = location/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?state\.currentSnapshotId = storedId/);
  assert.match(app, /querySelector\("#saveCanvasBtn"\)\.onclick = saveCurrentCanvas/);
});

test("canvas history clearly separates device, server, and private cross-device Cloud storage", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const closeHistory = functionSource(app, "closeHistoryPanel"), openHistory = functionSource(app, "openHistoryPanel");
  assert.match(html, /id="historyPanel"[^>]*aria-hidden="true"[^>]*\sinert/);
  assert.doesNotMatch(html, /id="historyPanel"[\s\S]*?<span class="history-kicker">PenEcho<\/span>[\s\S]*?<div class="history-composer">/);
  assert.doesNotMatch(html, /data-i18n="historyDescription"/);
  assert.doesNotMatch(app, /historyDescription:/);
  assert.doesNotMatch(zh, /historyDescription:/);
  assert.match(css, /\.history-panel, \.new-canvas-dialog\s*\{[^}]*color-scheme:\s*light[^}]*--ai-bg:\s*var\(--studio-shell, #f2f3f5\)[^}]*--ai-surface:\s*var\(--studio-panel, #ffffff\)[^}]*--ai-accent:\s*var\(--studio-accent, #4f46e5\)/);
  assert.doesNotMatch(css, /body\[data-theme="(?:studio|research|arcane|scifi)"\] \.history-panel/);
  assert.match(css, /\.history-panel\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*width:\s*min\(680px, calc\(100vw - 64px\)\)[^}]*height:\s*auto[^}]*max-height:\s*min\(680px, calc\(100dvh - 64px\)\)[^}]*border-radius:\s*14px[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*box-shadow:\s*0 4px 8px[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.history-panel\.open\s*\{[^}]*opacity:\s*1[^}]*translate\(-50%, -50%\) scale\(1\)[^}]*visibility:\s*visible/);
  assert.match(css, /html\.penecho-web-page-scale \.history-panel\s*\{[^}]*min-height:\s*0/);
  assert.match(css, /\.history-list\s*\{[^}]*display:\s*block[^}]*max-height:\s*380px[^}]*overflow:\s*hidden auto[^}]*border-radius:\s*10px/);
  assert.match(css, /\.history-card \+ \.history-card\s*\{[^}]*border-top:\s*1px solid/);
  assert.doesNotMatch(css, /\.history-card\.current::before/);
  assert.match(openHistory, /panel\.inert = false/);
  assert.match(closeHistory, /panel\.contains\(document\.activeElement\)[\s\S]*?button\.focus\(\{ preventScroll:true \}\)[\s\S]*?panel\.inert = true[\s\S]*?aria-hidden", "true"/);
  for (const name of ["historyStorageLocation", "newCanvasStorageLocation"]) {
    assert.match(html, new RegExp(`name="${name}" value="device"`));
    assert.match(html, new RegExp(`name="${name}" value="server"`));
    assert.match(html, new RegExp(`name="${name}" value="cloud"`));
  }
  for (const key of ["saveLocation", "storageThisDevice", "storagePenEchoServer", "storagePenEchoCloud", "storageThisDeviceDescription", "storagePenEchoServerDescription", "storagePenEchoCloudDescription", "cloudCanvasConflict"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(app, /localStorage\.setItem\("penecho-snapshot-location", location\)/);
  assert.match(app, /currentSnapshotLocation:\s*null/);
  assert.match(app, /state\.currentSnapshotLocation !== state\.snapshotLocation/);
  const serverPayload = functionSource(app, "serverSnapshotPayload"), readServer = functionSource(app, "readServerSnapshot"), readBundle = functionSource(app, "readSnapshotBundle");
  assert.match(serverPayload, /snapshotBundleAsset\("preview"[\s\S]*?snapshotBundleAsset\("tile"[\s\S]*?snapshotBundleAsset\("resource"[\s\S]*?snapshotBundleAsset\("widget"[\s\S]*?version:2[\s\S]*?bundleVersion:2[\s\S]*?mode:"snapshot"[\s\S]*?format:"penecho-raster-tiles"[\s\S]*?canvasSize:[\s\S]*?tileSize:TILE[\s\S]*?assets:\[\.\.\.snapshotPreservedAssets\(item\.preservedAssets\), \.\.\.tileAssets, \.\.\.widgetAssets, \.\.\.imageAssets, previewAsset\]/);
  assert.match(serverPayload, /extensions:snapshotExtensionObject\(item\.bundleExtensions\)[\s\S]*?extensions:snapshotExtensionObject\(item\.manifestExtensions\)/);
  assert.match(readServer, /stored\.version \?\? stored\.bundleVersion \?\? 1[\s\S]*?readSnapshotBundle\(stored\)/);
  assert.match(readBundle, /stored\.manifest\?\.format !== "penecho-raster-tiles"[\s\S]*?snapshotBundleAssetBlob\(previewAsset\)[\s\S]*?widgets,[\s\S]*?images:\[\.\.\.imageById\.values\(\)\]/);
  assert.match(readBundle, /bundleExtensions:snapshotExtensionObject\(stored\.extensions\)[\s\S]*?manifestExtensions:snapshotExtensionObject\(stored\.manifest\.extensions\)/);
  const enableSnapshotPlugins = functionSource(app, "enableSnapshotWidgetPlugins"),
    loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(enableSnapshotPlugins, /new Set[\s\S]*?item\?\.pluginId[\s\S]*?state\.plugins\[pluginId\] = true/);
  assert.match(enableSnapshotPlugins, /widgetType === "diagram_source"[\s\S]*?ensurePluginRuntime\("flowchart"\)/);
  assert.match(enableSnapshotPlugins, /persistPluginSettings\(\)[\s\S]*?syncWidgetRuntime\(\)[\s\S]*?updatePluginControl\(\)/);
  assert.ok(loadSnapshot.indexOf("await enableSnapshotWidgetPlugins(item.widgets)") < loadSnapshot.indexOf("restoreWidgets(item.widgets)"));
  assert.match(functionSource(app, "serverSnapshotItems"), /fetch\("\/api\/canvases"/);
  assert.match(functionSource(app, "serverSnapshotItems"), /fetch\("\/api\/canvas-projects"/);
  assert.match(functionSource(app, "saveServerSnapshot"), /method:overwriteId \? "PUT" : "POST"/);
  assert.match(functionSource(app, "deleteServerSnapshot"), /method:"DELETE"/);
  assert.match(functionSource(app, "renameSnapshot"), /method:"PATCH"[\s\S]*?canvasAgentCanvasDidPersist\(location, id\)[\s\S]*?refreshSnapshots\(\)/);
  assert.match(functionSource(app, "beginSnapshotRename"), /history-rename-form[\s\S]*?canvasNameRequired[\s\S]*?renameSnapshot\(item\.id, location, name\)/);
  assert.match(functionSource(app, "renderSnapshotList"), /history-title-row[\s\S]*?history-rename[\s\S]*?beginSnapshotRename/);
  assert.match(functionSource(app, "cloudSnapshotItems"), /\/api\/cloud\/library[\s\S]*?bundleVersion !== 2[\s\S]*?conflictPolicy !== "base-revision-required"/);
  assert.match(functionSource(app, "cacheCloudHistory"), /items\.slice\(\)[\s\S]*?cloudCanvasProjects\.slice\(\)/);
  assert.match(functionSource(app, "restoreCloudHistoryCache"), /snapshotItems = cloudHistoryCache\.items\.slice\(\)[\s\S]*?cloudCanvasProjects = cloudHistoryCache\.projects\.slice\(\)[\s\S]*?snapshotItemsLocation = "cloud"/);
  assert.match(functionSource(app, "saveCloudSnapshot"), /baseRevisionId[\s\S]*?\/api\/cloud\/canvases\/[\s\S]*?status === 409[\s\S]*?cloudCanvasConflict[\s\S]*?\/api\/cloud\/projects\//);
  assert.match(functionSource(app, "readCloudSnapshot"), /\/api\/cloud\/canvases\/[\s\S]*?body\?\.revision\?\.id[\s\S]*?readSnapshotBundle/);
  assert.match(functionSource(app, "openCloudProjectHistory"), /setSnapshotLocation\("cloud", \{ refresh:false \}\)[\s\S]*?refreshSnapshots\(\)[\s\S]*?openHistoryPanel\(false\)/);
  assert.match(functionSource(app, "openHistoryPanel"), /if \(refresh\) refreshSnapshots\(\)/);
  for (const key of ["snapshotLibraryLoading", "snapshotLibraryLoadingDetail", "snapshotCloudCacheRefreshing", "snapshotCloudCacheLoadFailed", "snapshotLoading", "snapshotLoadDownloading", "snapshotLoadDecoding", "snapshotLoadApplying"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  for (const id of ["historyActivity", "historyActivityTitle", "historyActivityDetail", "historyActivityProgress"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function setSnapshotLocation\([\s\S]*?snapshotItems = \[\][\s\S]*?snapshotItemsLocation = null[\s\S]*?renderSnapshotListLoading\(location\)/);
  assert.match(app, /function setSnapshotLocation\([\s\S]*?restoreCloudHistoryCache\(\)[\s\S]*?renderSnapshotList\(\)/);
  assert.match(app, /function setSnapshotLocation\([\s\S]*?snapshotLoadInProgress[\s\S]*?state\.snapshotLoadGeneration\+\+[\s\S]*?snapshotLoadInProgress = false/);
  assert.match(functionSource(app, "updateHistoryReadControls"), /input\[name="historyStorageLocation"\][\s\S]*?control\.disabled = snapshotSaveInProgress/);
  assert.match(functionSource(app, "refreshSnapshots"), /snapshotItemsLocation !== location[\s\S]*?renderSnapshotListLoading\(location\)[\s\S]*?snapshotItemsLocation = location/);
  assert.match(functionSource(app, "refreshSnapshots"), /showingCloudCache[\s\S]*?snapshotCloudCacheRefreshing[\s\S]*?cacheCloudHistory\(items\)[\s\S]*?clearCloudHistoryCache\(\)[\s\S]*?snapshotCloudCacheLoadFailed/);
  assert.match(functionSource(app, "loadSnapshot"), /setHistoryActivity[\s\S]*?snapshotLoadRequesting[\s\S]*?snapshotLoadDownloading[\s\S]*?snapshotLoadDecoding[\s\S]*?snapshotLoadApplying/);
  assert.match(functionSource(app, "loadSnapshot"), /if \(!loadIsCurrent\(\)\) return;[\s\S]*?loadGeneration !== state\.snapshotLoadGeneration[\s\S]*?return false/);
  for (const id of ["serverProjectManager", "historyProjectSelect", "historyProjectCreate", "historyProjectDelete", "projectDialog", "projectForm", "projectName", "projectDialogCreate", "newCanvasProjectField", "newCanvasProjectSelect"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="projectDialogCancel"/);
  assert.match(functionSource(app, "openServerProjectDialog"), /projectDialog[\s\S]*?showModal\(\)[\s\S]*?input\.focus\(\)/);
  assert.match(functionSource(app, "createServerProject"), /projectName[\s\S]*?input\.value\.trim\(\)\.slice\(0, 48\)[\s\S]*?fetch\(isCloud \? "\/api\/cloud\/projects" : "\/api\/canvas-projects"[\s\S]*?dialog\.close\("created"\)/);
  assert.doesNotMatch(app, /\bprompt\s*\(/);
  assert.match(functionSource(app, "storedServerProjectId"), /sessionStorage\.getItem\(SERVER_PROJECT_SESSION_KEY\)/);
  assert.match(functionSource(app, "rememberSelectedServerProject"), /sessionStorage\.setItem\(SERVER_PROJECT_SESSION_KEY, selectedServerProjectId\)/);
  assert.match(functionSource(app, "selectedServerSaveProjectId"), /selectedServerProjectId === SERVER_ALL_PROJECTS_ID \? SERVER_DEFAULT_PROJECT_ID/);
  assert.match(app, /async function saveSnapshot\([\s\S]*?projectId:location === "server"[\s\S]*?overwriteId[\s\S]*?selectedServerSaveProjectId\(\)/);
  assert.match(functionSource(app, "deleteSelectedServerProject"), /method:"DELETE"[\s\S]*?rememberSelectedServerProject\(SERVER_DEFAULT_PROJECT_ID\)/);
  assert.match(functionSource(app, "moveServerSnapshot"), /\/api\/canvases\/\$\{encodeURIComponent\(id\)\}\/project[\s\S]*?projectId/);
  const unsavedGuard = functionSource(app, "canvasHasUnsavedChanges"), transitionGuard = functionSource(app, "requestCanvasTransition");
  assert.match(unsavedGuard, /state\.userRevision === state\.snapshotSavedRevision[\s\S]*?return false/);
  assert.match(unsavedGuard, /state\.currentSnapshotId && state\.currentCanvasSuggestedName/);
  assert.match(unsavedGuard, /state\.currentSnapshotId \|\| hasContent/);
  assert.doesNotMatch(unsavedGuard, /state\.dirty/);
  assert.match(transitionGuard, /canvasHasUnsavedChanges\(\)[\s\S]*?performCanvasTransition\(transition\)[\s\S]*?pendingCanvasTransition = transition[\s\S]*?showModal/);
  assert.match(functionSource(app, "openNewCanvasDialog"), /requestCanvasTransition\(\{ type:"new" \}\)/);
  assert.match(functionSource(app, "requestLoadSnapshot"), /requestCanvasTransition\(\{ type:"load", id, location \}\)/);
  assert.match(functionSource(app, "performCanvasTransition"), /transition\?\.type === "load"[\s\S]*?loadSnapshot\(transition\.id, transition\.location\)[\s\S]*?startBlankCanvas\(\)/);
  const hasUnsavedChanges = ({ currentSnapshotId = null, currentCanvasSuggestedName = "", userRevision = 2, snapshotSavedRevision = 1, tileCount = 0, dirty = null } = {}) => vm.runInNewContext(`(${unsavedGuard})()`, {
    state:{ currentSnapshotId, currentCanvasSuggestedName, userRevision, snapshotSavedRevision, dirty, images:[], textBoxes:[], preservedSnapshotAnimations:[], animations:[] },
    tiles:{ size:tileCount },
    pluginEnabled:() => false,
    visibleWidgets:() => [],
  });
  assert.equal(hasUnsavedChanges({ currentSnapshotId:"saved-canvas" }), true, "clearing a saved canvas must remain dirty");
  assert.equal(hasUnsavedChanges(), false, "an empty never-saved canvas has nothing to lose");
  assert.equal(hasUnsavedChanges({ tileCount:1 }), true, "content on a never-saved canvas must be protected");
  assert.equal(hasUnsavedChanges({ currentSnapshotId:"saved-canvas", userRevision:1, snapshotSavedRevision:1, tileCount:1, dirty:{ x:0, y:0, w:1, h:1 } }), false, "AI attention state alone is not an unsaved snapshot revision");
  assert.equal(hasUnsavedChanges({ currentSnapshotId:"saved-canvas", currentCanvasSuggestedName:"Suggested title", userRevision:1, snapshotSavedRevision:1 }), true, "an unsaved suggested name must remain protected");
  assert.match(css, /\.history-card\s*\{[^}]*grid-template-columns:\s*112px/);
  assert.match(css, /\.history-preview\s*\{[^}]*width:\s*112px[^}]*height:\s*80px[^}]*align-self:\s*start/);
  assert.match(css, /\.history-save-row\s*\{[^}]*grid-template-columns:\s*minmax\(220px, 360px\) auto[^}]*justify-content:\s*start/);
  assert.match(css, /\.history-projects\s*\{[^}]*display:\s*flex[^}]*gap:\s*8px/);
  assert.match(css, /\.history-projects label\s*\{[^}]*width:\s*240px[^}]*letter-spacing:\s*normal[^}]*text-transform:\s*none/);
  assert.match(css, /\.history-projects select\s*\{[^}]*width:\s*100%[^}]*max-width:\s*240px/);
  assert.match(css, /\.history-meta\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto[^}]*grid-template-areas:\s*"title title" "detail detail" "stats stats" "actions project"/);
  assert.match(css, /\.history-move\s*\{[^}]*width:\s*216px[^}]*grid-area:\s*project[^}]*justify-self:\s*end/);
  assert.match(css, /\.snapshot-location-options\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.doesNotMatch(html, /class="history-kicker"/);
  assert.match(css, /\.history-list-loading\s*\{[^}]*min-height:\s*44px[^}]*border:\s*0/);
  assert.match(css, /\.history-empty\s*\{[^}]*padding:\s*12px[^}]*border:\s*0/);
  assert.match(css, /\.history-projects \.history-project-delete\s*\{[^}]*color:\s*var\(--ai-faint\)[^}]*background:\s*transparent/);
  assert.match(css, /\.new-canvas-fields\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;[^}]*\}/);
  assert.match(css, /\.project-dialog\s*\{[^}]*width:\s*min\(336px,[^}]*border-radius:\s*12px/);
  assert.match(css, /\.history-rename-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 36px 36px/);
});

test("local snapshot database upgrades preserve existing canvas records", () => {
  const snapshotDb = functionSource(read("public/app.js"), "snapshotDb");
  assert.match(snapshotDb, /indexedDB\.open\(SNAPSHOT_DB, 2\)/);
  assert.match(snapshotDb, /createObjectStore\(SNAPSHOT_TILE_STORE/);
  assert.doesNotMatch(snapshotDb, /objectStore\(SNAPSHOT_STORE\)\.clear\(\)/);
});

test("Cloud History distinguishes sign-in from failures and protects external Canvas opens", () => {
  const persistence = read("src/client/app/persistence.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), css = read("public/style.css");
  assert.match(functionSource(persistence, "cloudHistoryRequiresSignIn"), /cloud_sign_in_required/);
  assert.doesNotMatch(functionSource(persistence, "cloudHistoryRequiresSignIn"), /status\) === 401|unauthorized/);
  assert.match(functionSource(persistence, "renderCloudHistorySignIn"), /history-cloud-auth[\s\S]*?closeHistoryPanel\(\)[\s\S]*?cloudAccountBtn[\s\S]*?\.click\(\)/);
  assert.match(functionSource(persistence, "renderSnapshotList"), /location === "cloud" && cloudHistorySignInRequired[\s\S]*?renderCloudHistorySignIn/);
  assert.match(functionSource(persistence, "refreshSnapshots"), /authenticationRequired[\s\S]*?renderCloudHistorySignIn[\s\S]*?!authenticationRequired[\s\S]*?setHistoryActivity[\s\S]*?"error"/);
  assert.match(functionSource(persistence, "updateHistoryReadControls"), /cloudBlocked[\s\S]*?historyProjectSelect[\s\S]*?historySaveCurrent[\s\S]*?saveCanvasBtn/);
  assert.match(functionSource(persistence, "updateNewCanvasDialog"), /cloudBlocked[\s\S]*?saveCopy\.disabled = cloudBlocked/);
  assert.match(functionSource(persistence, "confirmExternalCanvasOpen"), /!canvasHasUnsavedChanges\(\) \|\| window\.confirm\(cloudHistoryCopy\("confirmExternalOpen"\)\)/);
  assert.match(functionSource(persistence, "cloudHistoryCopy"), /snapshotCloudSignInRequired[\s\S]*?snapshotCloudSignInHint[\s\S]*?openCloudCanvasUnsaved/);
  assert.match(functionSource(persistence, "refreshSnapshots"), /if \(authenticationRequired\) return false;/);
  assert.match(bootstrap, /confirmExternalOpen:confirmExternalCanvasOpen/);
  assert.match(functionSource(persistence, "importCommunityCanvasArtifact"), /requestLoadSnapshot\(id, "device"\)/);
  assert.doesNotMatch(functionSource(persistence, "importCommunityCanvasArtifact"), /loadSnapshot\(id, "device"\)/);
  assert.doesNotMatch(functionSource(persistence, "importCommunityCanvasArtifact"), /refreshSnapshots\(\)/);
  const openCloudCanvas = functionSource(persistence, "openCloudCanvas");
  assert.match(openCloudCanvas, /setSnapshotLocation\("cloud", \{ refresh:false \}\)/);
  assert.match(openCloudCanvas, /requestLoadSnapshot\(canvasId, "cloud"\)/);
  assert.doesNotMatch(openCloudCanvas, /refreshSnapshots\(\)|window\.open|location\./);
  assert.match(css, /\.history-cloud-auth\s*\{/);
  assert.match(css, /\.history-cloud-auth button\s*\{[^}]*min-height:\s*36px/);
  assert.match(css, /\.history-cloud-auth button:hover:not\(:disabled\), \.history-cloud-auth button:focus-visible\s*\{[^}]*color:\s*var\(--ai-primary-ink\)[^}]*background:\s*var\(--ai-primary-hover\)/);
  assert.match(css, /#historyClose, \.new-canvas-close\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*flex:\s*0 0 36px/);
  for (const selector of [
    "history-save-row input",
    "history-projects select",
    "history-projects button",
    "history-actions button",
    "history-move",
    "new-canvas-project select, \\.new-snapshot-name input",
    "new-canvas-actions button",
  ]) assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*min-height:\\s*36px`));
  assert.match(css, /\.snapshot-location-options\s*\{[^}]*height:\s*36px/);
  assert.match(css, /\.snapshot-location-options span\s*\{[^}]*height:\s*30px[^}]*min-height:\s*30px/);
  assert.match(css, /#historySaveCurrent, #historySave\s*\{[^}]*height:\s*36px[^}]*min-height:\s*36px/);
  assert.match(css, /\.settings-editor-cancel\s*\{[^}]*height:\s*36px[^}]*min-height:\s*36px/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.ok(css.includes("#historyClose, .new-canvas-close { width: 44px; height: 44px; flex-basis: 44px; }"));
  assert.ok(css.includes(".new-canvas-actions button, .new-canvas-project select, .new-snapshot-name input { height: auto; min-height: 44px; }"));
  assert.match(functionSource(persistence, "renderSnapshotListLoading"), /role", "status"/);
  assert.match(functionSource(persistence, "renderSnapshotListError"), /role", "alert"/);
});

test("Cloud History restores a session cache without sharing mutable list containers", () => {
  const persistence = read("src/client/app/persistence.js"), context = {
    snapshotItems:[],
    snapshotItemsLocation:null,
    cloudCanvasProjects:[{ id:"project-one" }],
    cloudHistoryCache:null,
    result:null,
  };
  vm.runInNewContext(`
    ${functionSource(persistence, "cacheCloudHistory")}
    ${functionSource(persistence, "restoreCloudHistoryCache")}
    ${functionSource(persistence, "clearCloudHistoryCache")}
    const fetchedItems = [{ id:"canvas-one" }];
    cacheCloudHistory(fetchedItems);
    fetchedItems.push({ id:"canvas-two" });
    cloudCanvasProjects.push({ id:"project-two" });
    snapshotItems = [];
    cloudCanvasProjects = [];
    const restored = restoreCloudHistoryCache();
    const restoredItemCount = snapshotItems.length;
    const restoredProjectCount = cloudCanvasProjects.length;
    snapshotItems.push({ id:"canvas-three" });
    cloudCanvasProjects.push({ id:"project-three" });
    snapshotItems = [];
    cloudCanvasProjects = [];
    restoreCloudHistoryCache();
    const isolatedItemCount = snapshotItems.length;
    const isolatedProjectCount = cloudCanvasProjects.length;
    clearCloudHistoryCache();
    result = { restored, restoredItemCount, restoredProjectCount, isolatedItemCount, isolatedProjectCount, cleared:cloudHistoryCache === null };
  `, context);
  assert.equal(JSON.stringify(context.result), JSON.stringify({
    restored:true,
    restoredItemCount:1,
    restoredProjectCount:1,
    isolatedItemCount:1,
    isolatedProjectCount:1,
    cleared:true,
  }));
});

test("New, Export, and Clear remain accessible Studio-aware icon buttons while Debug stays out of the toolbar", () => {
  const html = read("public/index.html"), css = read("public/style.css");
  for (const id of ["newCanvasBtn", "exportPngBtn", "clearCanvasBtn"]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*utility-icon[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.match(button, /<svg /);
    assert.doesNotMatch(button, />\s*(New|Clear|Debug)\s*</);
  }
  assert.doesNotMatch(html, /id="debugBtn"/);
  assert.doesNotMatch(html, /id="theme"|value="(?:arcane|scifi|research)"/);
  assert.equal((html.match(/class="studio-palette-option"/g) || []).length, 8);
  assert.match(css, /button\.utility-icon:not\(\.active\).*var\(--ink\)/);
  assert.match(css, /button\.utility-icon\.danger:not\(\.active\).*var\(--danger\)/);
});

test("Studio-only palettes are wired through initialization, localization, and snapshots", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  assert.match(html, /<body\b[^>]*\bdata-theme="studio"[^>]*\bdata-studio-palette="indigo"/);
  assert.match(html, /<meta\b[^>]*\bname="theme-color"[^>]*\bcontent="#eef0f3"/);
  assert.match(html, /<div\b[^>]*\bid="aiEmbodiment"[^>]*\bdata-theme="studio"/);
  assert.match(app, /DEFAULT_THEME\s*=\s*"studio"/);
  assert.match(app, /DEFAULT_STUDIO_PALETTE\s*=\s*"indigo"/);
  assert.match(app, /REMOVED_THEMES\s*=\s*new Set\(\["arcane", "scifi", "research"\]\)/);
  assert.match(app, /SUPPORTED_THEMES\s*=\s*new Set\(\[DEFAULT_THEME\]\)/);
  assert.match(app, /SUPPORTED_STUDIO_PALETTES\s*=\s*new Set\(\["indigo", "graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"\]\)/);
  assert.match(app, /function normalizeTheme\(theme\)\s*\{\s*return SUPPORTED_THEMES\.has\(theme\) \? theme : DEFAULT_THEME;/);
  assert.match(app, /function normalizeStudioPalette\(palette\)\s*\{\s*return SUPPORTED_STUDIO_PALETTES\.has\(palette\) \? palette : DEFAULT_STUDIO_PALETTE;/);
  assert.match(app, /function normalizeStudioPaletteForTheme\(theme, palette\)\s*\{\s*return REMOVED_THEMES\.has\(theme\) \? DEFAULT_STUDIO_PALETTE : normalizeStudioPalette\(palette\);/);
  assert.match(app, /initialTheme\s*=\s*normalizeTheme\(storedTheme\)/);
  assert.match(app, /initialStudioPalette\s*=\s*normalizeStudioPaletteForTheme\(storedTheme, storedStudioPalette\)/);

  const appearanceControls = functionSource(app, "updateAppearanceControls"), embodimentCopy = functionSource(app, "updateEmbodimentLabel"), loadSnapshot = functionSource(app, "loadSnapshot");
  assert.match(appearanceControls, /studio-palette-option\[data-studio-palette\][\s\S]*?data-page-scale/);
  assert.match(embodimentCopy, /t\("guideStudio"\)/);
  assert.match(loadSnapshot, /applyTheme\(item\.theme\)/);
  assert.match(functionSource(app, "applyTheme"), /normalizeStudioPaletteForTheme\(theme, state\.studioPalette\)[\s\S]*?theme\s*=\s*normalizeTheme\(theme\)[\s\S]*?penecho-studio-palette/);
  assert.match(functionSource(app, "applyStudioPalette"), /normalizeStudioPalette\(palette\)[\s\S]*?penecho-studio-palette/);

  for (const key of ["guideStudio", "studioPaletteIndigo", "studioPaletteGraphite", "studioPaletteCobalt", "studioPaletteAzure", "studioPaletteTeal", "studioPaletteForest", "studioPaletteAmber", "studioPaletteBurgundy"]) {
    assert.match(app, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
  assert.match(css, /body\[data-theme="studio"\]\s*\{/);
  for (const palette of ["indigo", "graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"]) assert.match(css, new RegExp(`\\[data-studio-palette="${palette}"\\]`));
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-project-dialog\s*\{[^}]*color:\s*var\(--studio-text\)[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--penecho-dialog-surface\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-project-choice\[aria-pressed="true"\]\s*\{[^}]*border-color:\s*var\(--studio-accent\)[^}]*background:\s*var\(--studio-accent-soft\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-prompt-popup\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--studio-panel-raised\)/);
  assert.match(css, /body\[data-theme="studio"\]\.is-fullscreen\s+#viewport\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/);
});

test("Studio palette propagates through every Canvas popup surface", () => {
  const css = read("public/style.css");
  assert.match(css, /:root\s*\{[^}]*--penecho-dialog-backdrop:\s*rgba\(18, 23, 34, \.2\)[^}]*--penecho-dialog-backdrop-filter:\s*blur\(4px\) saturate\(1\.08\)[^}]*--penecho-dialog-surface:[^}]*78%, transparent\)[^}]*--penecho-dialog-surface-filter:\s*blur\(30px\) saturate\(1\.24\)/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*--ink:\s*var\(--studio-text,[^)]+\)[^}]*--panel-raised:\s*var\(--studio-panel,[^)]+\)[^}]*--gold-bright:\s*var\(--studio-accent-strong,[^)]+\)/);
  assert.match(css, /\.plugin-modal-layer\s*\{[^}]*background:\s*var\(--penecho-dialog-backdrop\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-backdrop-filter\)/);
  assert.match(css, /\.plugin-modal\s*\{[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.history-panel, \.new-canvas-dialog\s*\{[^}]*--ai-surface:\s*var\(--studio-panel,[^)]+\)[^}]*--ai-accent:\s*var\(--studio-accent,[^)]+\)[^}]*--ai-primary:\s*var\(--studio-accent-strong,[^)]+\)/);
  assert.match(css, /body\[data-theme="studio"\] \.tour-card\s*\{[^}]*border-color:\s*var\(--studio-accent-border\)[^}]*background:\s*var\(--studio-panel\)/);
  assert.match(css, /\.settings-panel, \.configuration-panel\s*\{[^}]*--ink:\s*var\(--studio-text,[^)]+\)[^}]*--gold-bright:\s*var\(--studio-accent-strong,[^)]+\)/);
  assert.match(css, /\.configuration-panel\s*\{[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.crafts-modal\s*\{[^}]*--ink:\s*var\(--studio-text,[^)]+\)[^}]*--panel-raised:\s*var\(--studio-panel,[^)]+\)[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-project-dialog\s*\{[^}]*color:\s*var\(--studio-text\)[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--penecho-dialog-surface\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-prompt-popup\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--studio-panel-raised\)/);
  assert.match(css, /\.studio-session-delete-dialog\s*\{[^}]*color:\s*var\(--studio-text,[^)]+\)[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.changelog-dialog\s*\{[^}]*color:\s*var\(--ink\)[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  for (const selector of ["new-canvas-dialog", "studio-session-delete-dialog", "canvas-agent-project-dialog"]) {
    assert.match(css, new RegExp(`\\.${selector}::backdrop\\s*\\{[^}]*background:\\s*var\\(--penecho-dialog-backdrop\\)[^}]*backdrop-filter:\\s*var\\(--penecho-dialog-backdrop-filter\\)`));
  }
});

test("Settings is a centered frosted workbench with persistent navigation and switchable detail pages", () => {
  const html = read("public/index.html"), css = read("public/style.css"), app = read("public/app.js");
  const panel = html.match(/<section id="settingsPanel"[\s\S]*?<\/section>\s*<\/div>\s*<div id="configurationLayer"/)?.[0] || "";
  assert.match(panel, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="settingsTitle"/);
  assert.match(panel, /class="settings-window-header"[\s\S]*?id="settingsClose"[\s\S]*?<svg/);
  assert.match(panel, /class="settings-navigation"[^>]*role="tablist"[^>]*aria-orientation="vertical"/);
  for (const page of ["appearance", "connections", "canvas", "about"]) {
    assert.match(panel, new RegExp(`data-settings-page-target="${page}"`));
    assert.match(panel, new RegExp(`data-settings-page="${page}"`));
  }
  assert.ok(panel.indexOf('class="settings-navigation"') < panel.indexOf('class="settings-detail"'));
  assert.equal((panel.match(/class="studio-palette-option"/g) || []).length, 8);
  assert.equal((panel.match(/data-page-scale=/g) || []).length, 6);
  assert.match(panel, /data-page-scale="0\.9" aria-checked="false"/);
  assert.match(panel, /data-page-scale="1" aria-checked="true"/);
  assert.match(css, /\.settings-panel\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*background:\s*var\(--penecho-dialog-surface\)[^}]*backdrop-filter:\s*var\(--penecho-dialog-surface-filter\)/);
  assert.match(css, /\.settings-workbench\s*\{[^}]*grid-template-columns:\s*184px minmax\(0, 1fr\)/);
  assert.match(css, /\.settings-page\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.settings-workbench\s*\{\s*grid-template-columns:\s*112px minmax\(0, 1fr\)/);
  assert.match(app, /function selectSettingsPage\(page,[\s\S]*?data-settings-page-target[\s\S]*?node\.hidden = !selected[\s\S]*?return true;\s*\}/);
  assert.match(functionSource(app, "handleSettingsNavigationKeydown"), /ArrowUp[\s\S]*?ArrowDown[\s\S]*?Home[\s\S]*?End/);
});

test("Canvas grid keeps the original 500-unit lines at half-pixel weight in the viewport and PNG export", () => {
  const canvas = read("src/client/app/canvas-runtime.js"), persistence = read("src/client/app/persistence.js"), css = read("public/style.css"),
    draw = functionSource(canvas, "drawCanvasLineGrid"), render = functionSource(canvas, "render"), exportCanvas = functionSource(persistence, "renderExportCanvas");
  assert.match(draw, /step = 500/);
  assert.match(draw, /context\.lineWidth = 0\.5 \/ scale/);
  assert.match(draw, /context\.lineTo\(/);
  assert.doesNotMatch(draw, /context\.arc\(/);
  assert.match(render, /drawCanvasLineGrid\(ctx,[\s\S]*?state\.scale\)/);
  assert.match(exportCanvas, /drawCanvasLineGrid\(context, region, scale\)/);
  assert.match(css, /--paper-grid:\s*color-mix\(in srgb, var\(--studio-text\) 7%, transparent\)/);
});

test("Studio uses glass workbench overlays, contextual pen properties, and a right-edge Agent inspector", () => {
  const html = read("public/index.html"), css = read("public/style.css"), core = read("src/client/app/core.js"), bootstrap = read("src/client/app/ui-bootstrap.js"), agent = read("src/client/app/canvas-agent-runtime.js");
  assert.match(html, /<body\b[^>]*data-theme="studio"[^>]*data-canvas-mode="pen"/);
  assert.match(html, /id="penToolProperties"[^>]*class="tool-properties pen-tool-properties"[\s\S]*?id="penSize"[\s\S]*?data-color-control="ink"[\s\S]*?data-color-control="ai"/);
  assert.match(html, /id="canvasAgentHome"[^>]*hidden[\s\S]*?id="canvasAgentPanel"[^>]*hidden[^>]*inert/);
  const syncModePresentation = functionSource(bootstrap, "syncCanvasModePresentation");
  assert.match(syncModePresentation, /document\.body\?\.setAttribute\("data-canvas-mode", mode\)/);
  assert.match(functionSource(bootstrap, "setCanvasMode"), /syncCanvasModePresentation\(\)/);
  assert.match(functionSource(core, "applyTheme"), /syncStudioWorkbench\(theme\)/);
  assert.match(functionSource(agent, "syncStudioWorkbench"), /theme === "studio"[\s\S]*?min-width: 701px[\s\S]*?canvasAgentFrame\.append\(canvasAgentPanel\)[\s\S]*?canvasAgentHome\.after\(canvasAgentPanel\)/);
  assert.match(functionSource(agent, "canvasAgentBeginPanelDrag"), /canvasAgentDockedPanel\(\)/);
  assert.match(functionSource(agent, "canvasAgentKeyboardPanelResize"), /canvasAgentFrame\.clientWidth\/CANVAS_AGENT_SIZE_STEPS/);
  assert.match(css, /body\[data-theme="studio"\] \.top-row\s*\{[^}]*min-height:\s*52px[^}]*border-bottom:/);
  assert.match(css, /--studio-chrome-shadow-color:\s*rgba\(30, 35, 48, \.07\)/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar\s*\{[^}]*position:\s*absolute[^}]*top:\s*100%[^}]*min-height:\s*var\(--studio-toolbar-height\)[^}]*background:\s*var\(--studio-glass\)[^}]*box-shadow:\s*0 4px 8px var\(--studio-chrome-shadow-color\)[^}]*backdrop-filter:\s*saturate\(1\.2\) blur\(18px\)/);
  assert.match(css, /body\[data-theme="studio"\]\[data-canvas-mode="pen"\] \.pen-tool-properties\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css, /body\[data-theme="studio"\] main > footer\s*\{[^}]*min-height:\s*26px[^}]*border-top:/);
  assert.match(css, /--studio-agent-glass:\s*color-mix\(in srgb, var\(--studio-panel\) 80%, transparent\)/);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*?studio-agent-docked \.canvas-agent-panel\s*\{[\s\S]*?position:\s*absolute[\s\S]*?inset:\s*var\(--studio-toolbar-height\) 0 0 auto[\s\S]*?flex:\s*none[\s\S]*?background:\s*var\(--studio-agent-glass\)[\s\S]*?box-shadow:\s*-4px 0 8px var\(--studio-chrome-shadow-color\)[\s\S]*?backdrop-filter:\s*saturate\(1\.08\) blur\(30px\)/);
  assert.match(css, /studio-agent-docked:not\(\.canvas-agent-open\) \.canvas-agent-panel\s*\{[^}]*pointer-events:\s*none[^}]*opacity:\s*0[^}]*translate3d\(100%, 0, 0\)/);
  assert.doesNotMatch(css, /studio-agent-docked:not\(\.canvas-agent-open\) \.canvas-agent-panel\s*\{[^}]*width:\s*0/);
  assert.match(css, /studio-agent-docked\.canvas-agent-open \.canvas-frame\s*\{[^}]*--studio-agent-edge-shift:\s*calc\(var\(--studio-agent-width\) - 4px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-control\s*\{[^}]*right:\s*calc\(max\(16px, env\(safe-area-inset-right\)\) \+ var\(--studio-agent-edge-shift\)\)[^}]*transition:\s*right \.22s/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-control\s*\{[^}]*border-color:\s*var\(--studio-line\)[^}]*background:\s*var\(--studio-panel\)[^}]*box-shadow:\s*none[^}]*backdrop-filter:\s*none/);
  assert.match(agent, /function openCanvasAgent\([\s\S]*?canvasAgentToggle\.setAttribute\("aria-expanded","true"\)/);
  assert.match(agent, /function openCanvasAgent\(\{focus=true\}=\{\}\)[\s\S]*?document\.body\.classList\.add\("canvas-agent-open"\)[\s\S]*?syncCanvasModePresentation\(\)/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-agent-trigger\[aria-expanded="true"\]\s*\{[^}]*color:\s*var\(--studio-accent\)/);
  assert.doesNotMatch(css, /\.canvas-agent-control:focus-within/);
  assert.match(agent, /function closeCanvasAgent\([\s\S]*?if\(focus\)canvasAgentToggle\.focus\(\)/);
  assert.match(css, /studio-agent-launcher-floating #tip,[\s\S]*?right:\s*calc\(176px \+ var\(--studio-agent-edge-shift\)\)/);
  assert.match(functionSource(agent, "canvasAgentApplyPanelWidth"), /canvasAgentFrame\.classList\.add\(`canvas-agent-width-\$\{step\}`\)/);
  assert.match(agent, /function openCanvasAgent\(\{focus=true\}=\{\}\)[\s\S]*?if\(docked\)\{[\s\S]*?canvasAgentRestorePanelSize\(\)[\s\S]*?document\.body\.classList\.add\("canvas-agent-open"\)/);
  assert.match(css, /html\.penecho-web-page-scale body\[data-theme="studio"\] main\s*\{[^}]*--penecho-canvas-page-dynamic-height/);
});

test("opening PenEcho Agent re-syncs Pen mode presentation without changing the Canvas mode", () => {
  const bootstrap = read("src/client/app/ui-bootstrap.js"), agent = read("src/client/app/canvas-agent-runtime.js"),
    syncModePresentation = functionSource(bootstrap, "syncCanvasModePresentation"),
    makeButton = (active) => ({
      active,
      pressed:String(active),
      classList:{ toggle(name,value) { if (name === "active") this.owner.active = Boolean(value); }, owner:null },
      setAttribute(name,value) { if (name === "aria-pressed") this.pressed = value; },
    }),
    handButton = makeButton(true), penButton = makeButton(false), bodyAttributes = {}, viewClasses = {}, calls = [];
  handButton.classList.owner = handButton;
  penButton.classList.owner = penButton;
  const result = vm.runInNewContext(`${syncModePresentation};syncCanvasModePresentation();`, {
    state:{ mode:"pen" },
    eraserToolButton:null,
    document:{
      body:{ setAttribute:(name,value) => { bodyAttributes[name] = value; } },
      querySelector:(selector) => selector === '[data-mode="pen"]' ? penButton : null,
      querySelectorAll:() => [handButton,penButton],
    },
    view:{ classList:{ toggle:(name,value) => { viewClasses[name] = value; } } },
    updateEraserToolUI:() => calls.push("eraser-ui"),
    resetCanvasCursor:() => calls.push("cursor"),
  });
  assert.equal(result,true);
  assert.equal(bodyAttributes["data-canvas-mode"],"pen");
  assert.equal(viewClasses["hand-mode"],false);
  assert.deepEqual({handActive:handButton.active,handPressed:handButton.pressed,penActive:penButton.active,penPressed:penButton.pressed},{handActive:false,handPressed:"false",penActive:true,penPressed:"true"});
  assert.deepEqual(calls,["eraser-ui","cursor"]);
  const openAgent = agent.slice(agent.indexOf("function openCanvasAgent("),agent.indexOf("function closeCanvasAgent("));
  assert.match(openAgent,/syncCanvasModePresentation\(\)/);
  assert.doesNotMatch(openAgent,/setCanvasMode\(/);
});

test("PenEcho Agent launcher uses a rotating color border while it works", () => {
  const css = read("public/style.css"), agent = read("src/client/app/canvas-agent-runtime.js");
  const syncTrigger = functionSource(agent, "canvasAgentSyncTriggerState");
  assert.match(syncTrigger, /busy = canvasAgent\.requestPending \|\| canvasAgent\.running[\s\S]*?classList\.toggle\("is-busy",busy\)[\s\S]*?aria-busy/);
  assert.doesNotMatch(syncTrigger, /canvasAgentPanel\.hidden/);
  const triggerState = {};
  vm.runInNewContext(`${syncTrigger};canvasAgentSyncTriggerState();`,{
    canvasAgent:{requestPending:true,running:false}, canvasAgentPanel:{hidden:false},
    canvasAgentControl:{classList:{toggle:(name,value)=>{triggerState.className=name;triggerState.busy=value;}}},
    canvasAgentToggle:{setAttribute:(name,value)=>{triggerState.attribute=name;triggerState.ariaBusy=value;}},
    canvasAgentSyncPromptSuggestions:()=>{},
  });
  assert.deepEqual(triggerState,{className:"is-busy",busy:true,attribute:"aria-busy",ariaBusy:"true"});
  assert.match(css, /@property --canvas-agent-busy-angle\s*\{[^}]*syntax:\s*"<angle>"[^}]*initial-value:\s*0deg/);
  assert.match(css, /\.canvas-agent-control\.is-busy::after\s*\{[^}]*inset:\s*0[^}]*padding:\s*2px[^}]*background:\s*conic-gradient\(from var\(--canvas-agent-busy-angle\)[^}]*mask-composite:\s*exclude[^}]*animation:\s*canvas-agent-trigger-busy 1\.4s linear infinite/);
  assert.match(css, /@keyframes canvas-agent-trigger-busy\s*\{\s*to\s*\{\s*--canvas-agent-busy-angle:\s*360deg/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.canvas-agent-control\.is-busy::after\s*\{[^}]*animation:\s*none/);
});

test("PenEcho Agent launcher uses ordered toolbar compaction before returning to the Canvas corner", () => {
  const html = read("public/index.html"), css = read("public/style.css"), core = read("src/client/app/core.js"), agent = read("src/client/app/canvas-agent-runtime.js");
  const toolbar = html.match(/<nav class="toolbar"[\s\S]*?<\/nav>/)?.[0] || "",
    syncLayout = functionSource(agent, "canvasAgentSyncToolbarLayout"),
    updateEffort = functionSource(core, "updateEffortControl");
  assert.ok(toolbar.indexOf('class="tool-group primary-tools"') < toolbar.indexOf('id="canvasAgentToolbarHome"'));
  assert.match(toolbar, /id="canvasAgentToolbarHome"[\s\S]*?id="canvasAgentControl"[\s\S]*?id="canvasAgentToggle"/);
  assert.equal((html.match(/id="canvasAgentControl"/g) || []).length, 1);
  assert.match(updateEffort, /effort-label-full[\s\S]*?effort-label-short[\s\S]*?shortLabel\.textContent = shortLevel[\s\S]*?canvasAgentScheduleToolbarLayout/);
  assert.match(syncLayout, /canvasAgentToolbarHome\.append\(canvasAgentControl\)[\s\S]*?studio-toolbar-effort-compact[\s\S]*?canvasAgentToolbarOverflows\(\)[\s\S]*?studio-toolbar-controls-compact[\s\S]*?canvasAgentToolbarOverflows\(\)[\s\S]*?studio-agent-launcher-floating[\s\S]*?canvasAgentFrame\.append\(canvasAgentControl\)/);
  assert.match(css, /studio-toolbar-effort-compact \.effort-label-full\s*\{[^}]*display:\s*none/);
  assert.match(css, /studio-toolbar-effort-compact \.effort-label-short\s*\{[^}]*display:\s*inline/);
  assert.match(css, /studio-toolbar-controls-compact \.toolbar \.icon-button\s*\{[^}]*width:\s*27px/);
  assert.match(css, /canvas-agent-toolbar-home\s*\{[^}]*margin-left:\s*auto/);
});

test("Studio title bar exposes document identity, explicit save state, and a blank-canvas next step", () => {
  const html = read("public/index.html"), css = read("public/style.css"), navigator = read("src/client/app/studio-navigator.js"),
    persistence = read("src/client/app/persistence.js"), core = read("src/client/app/core.js"), zh = read("public/locales/zh.js");
  const brand = html.indexOf('class="brand"'), documentMeta = html.indexOf('id="canvasDocumentMeta"'), status = html.indexOf('id="aiStatusArea"'),
    toolbar = html.indexOf('class="toolbar"'), navigatorToggle = html.indexOf('id="studioNavigatorToggle"'), divider = html.indexOf('class="toolbar-leading-divider"'), primaryTools = html.indexOf('class="tool-group primary-tools"');
  assert.ok(brand < documentMeta && documentMeta < status && status < toolbar,"brand, document, and global status follow the title-row reading order");
  assert.ok(toolbar < navigatorToggle && navigatorToggle < divider && divider < primaryTools,"navigator and its divider lead the contextual toolbar");
  assert.match(html, /id="canvasDocumentMeta"[\s\S]*?id="canvasDocumentName"[\s\S]*?id="canvasDocumentSaveState"[^>]*data-state="unsaved"[\s\S]*?id="saveCanvasBtn"/);
  assert.match(html, /id="canvasDocumentName"[^>]*type="button"[^>]*data-i18n-aria="canvasRenameCurrent"/);
  assert.match(html, /id="canvasDocumentNameInput"[^>]*maxlength="48"[^>]*hidden/);
  assert.doesNotMatch(html, /id="canvasFileActions"[\s\S]*?id="saveCanvasBtn"[\s\S]*?<\/span>/);
  assert.match(html, /id="canvasWelcome"[^>]*hidden[\s\S]*?canvasWelcomeKicker[\s\S]*?canvasWelcomeTitle[\s\S]*?canvasWelcomeBody/);
  assert.match(css, /body\[data-theme="studio"\] \.sigil\s*\{[^}]*background:\s*var\(--studio-accent-strong\)[^}]*-webkit-mask:\s*url\("penecho-mark\.png"\)[^}]*mask:\s*url\("penecho-mark\.png"\)/);
  assert.match(css, /body\[data-theme="studio"\] \.sigil img\s*\{[^}]*opacity:\s*0[^}]*filter:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar\s*\{[^}]*column-gap:\s*8px/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar > \.studio-navigator-toggle::before\s*\{[^}]*inset:\s*-2px/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar > \.studio-navigator-toggle\.active\s*\{[^}]*background:\s*var\(--studio-accent-soft\)[^}]*box-shadow:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.toolbar-leading-divider\s*\{[^}]*width:\s*1px[^}]*height:\s*24px[^}]*background:\s*var\(--studio-line\)/);
  assert.match(css, /\.canvas-document-save-state\[data-state="saved"\][\s\S]*?\.canvas-document-save-state\[data-state="edited"\][\s\S]*?\.canvas-document-save-state\[data-state="saving"\]/);
  assert.match(html, /class="canvas-welcome-kicker"[\s\S]*?<svg viewBox="0 0 24 12" aria-hidden="true"><path d="M1\.5 6h20M16\.5 1\.5 21 6l-4\.5 4\.5"\/>/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-frame\s*\{[^}]*--studio-agent-edge-shift:\s*0px[^}]*--studio-navigator-edge-shift:\s*0px/);
  assert.match(css, /studio-agent-docked\.canvas-agent-open \.canvas-frame\s*\{[^}]*--studio-agent-edge-shift:\s*calc\(var\(--studio-agent-width\) - 4px\)/);
  assert.match(css, /studio-navigator-open \.canvas-frame\s*\{[^}]*--studio-navigator-edge-shift:\s*256px/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-welcome\s*\{[^}]*inset:\s*var\(--studio-toolbar-height\) var\(--studio-agent-edge-shift\) 0 var\(--studio-navigator-edge-shift\)[^}]*align-content:\s*center[^}]*pointer-events:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.canvas-welcome-kicker\s*\{[^}]*font:\s*650 2rem\/1\.05 "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive[^}]*letter-spacing:\s*\.015em[^}]*transform:\s*rotate\(-2deg\)/);
  assert.doesNotMatch(css, /\.canvas-welcome-kicker::after/);
  const updateDocument = functionSource(navigator, "updateStudioDocumentState");
  assert.match(updateDocument, /currentCanvasDisplayName\(\) \|\| t\("canvasUntitledName"\)/);
  assert.match(updateDocument, /canvasHasUnsavedChanges\(\) \|\| Boolean\(state\.currentCanvasSuggestedName\)/);
  assert.match(updateDocument, /snapshotSaveInProgress \? "saving" : !saved \? "unsaved" : edited \? "edited" : "saved"/);
  assert.match(updateDocument, /canvasWelcome\.hidden = !active \|\| state\.viewMode \|\| studioCanvasHasContent\(\)/);
  assert.match(functionSource(navigator, "beginCanvasDocumentRename"), /canvasDocumentName\.hidden = true[\s\S]*?canvasDocumentNameInput\.hidden = false[\s\S]*?select\(\)/);
  assert.match(functionSource(navigator, "commitCanvasDocumentRename"), /trim\(\)\.slice\(0, 48\)[\s\S]*?renameCurrentCanvasFromTitle\(name\)[\s\S]*?finishCanvasDocumentRename/);
  assert.match(functionSource(persistence, "renameCurrentCanvasFromTitle"), /saveSnapshot\(\{ overwriteId, name, location \}\)[\s\S]*?canvasRenamed/);
  assert.match(functionSource(persistence, "save"), /PenEchoStudioNavigator\?\.updateDocument/);
  assert.match(persistence, /async function saveSnapshot\([\s\S]*?setStatusKey\(overwriteId \? "snapshotOverwritten" : "snapshotSaved"\);[\s\S]*?PenEchoStudioNavigator\?\.updateDocument/);
  assert.match(persistence, /async function loadSnapshot\([\s\S]*?state\.currentSnapshotName = snapshotName\(item\);[\s\S]*?PenEchoStudioNavigator\?\.updateDocument/);
  assert.match(persistence, /state\.currentSnapshotName = snapshotName\(item\);[\s\S]*?state\.currentSnapshotHasExplicitName = Boolean\(String\(item\.name\|\|""\)\.trim\(\)\);[\s\S]*?state\.currentCanvasSuggestedName = ""/);
  assert.match(functionSource(persistence, "saveCurrentCanvas"), /name = requestedName \|\| currentCanvasDisplayName\(\)/);
  assert.match(functionSource(persistence, "startBlankCanvas"), /PenEchoStudioNavigator\?\.updateDocument/);
  for (const key of ["canvasUntitledName", "canvasRename", "canvasRenameCurrent", "canvasRenameNamed", "canvasNamePlaceholder", "canvasNameRequired", "canvasRenamed", "canvasSaveStateUnsaved", "canvasSaveStateSaved", "canvasSaveStateEdited", "canvasSaveStateSaving", "canvasWelcomeKicker", "canvasWelcomeTitle", "canvasWelcomeBody"]) {
    assert.match(core, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
});

test("Studio navigator groups recent Agent sessions by canvas and opens the bound canvas first", () => {
  const html = read("public/index.html"), css = read("public/style.css"), navigator = read("src/client/app/studio-navigator.js"),
    persistence = read("src/client/app/persistence.js"), agent = read("src/client/app/canvas-agent-runtime.js"),
    build = read("scripts/build-client.js"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  assert.match(html, /id="studioNavigatorToggle"[^>]*aria-controls="studioNavigator"/);
  assert.match(html, /id="studioNavigator"[^>]*aria-labelledby="studioNavigatorTitle"[\s\S]*?id="studioNavigatorAgentPanel"[\s\S]*?id="studioNavigatorCanvasPanel"/);
  assert.match(html, /id="studioNavigatorSearch"[^>]*type="search"/);
  assert.match(build, /src\/client\/app\/studio-navigator\.js/);
  assert.match(navigator, /let studioNavigatorOpenPreference = false/);
  assert.doesNotMatch(navigator, /STUDIO_NAVIGATOR_OPEN_KEY|penecho-studio-navigator-open/);
  assert.match(navigator, /canvasAgentStoredHistoryGroups\(\)[\s\S]*?sort\(\(a,b\)=>b\.updatedAt-a\.updatedAt\)/);
  assert.match(navigator, /className="studio-navigator-group"[\s\S]*?className="studio-navigator-group-conversations"/);
  assert.match(functionSource(navigator, "studioNavigatorCanvasGroupSnapshot"), /snapshotItemsLocation===identity\.location[\s\S]*?snapshotItems\.find\(candidate=>candidate\.id===identity\.id\)[\s\S]*?studioNavigatorCanvasGroupSnapshots\.set\(key,item\)/);
  assert.match(functionSource(navigator, "studioNavigatorLoadDraftSnapshot"), /await snapshotPreviewBlob\(\)[\s\S]*?request\.canvasKey===state\.canvasAgentCanvasKey[\s\S]*?studioNavigatorDraftSnapshot\.item=\{id:request\.canvasKey,preview\}/);
  assert.match(functionSource(navigator, "studioNavigatorQueueDraftSnapshot"), /canvasKey\.startsWith\("draft:"\)[\s\S]*?studioNavigatorLoadDraftSnapshot\(request\)/);
  assert.match(functionSource(navigator, "studioNavigatorQueueCanvasGroupSnapshots"), /snapshotListInProgress[\s\S]*?studioNavigatorCanvasGroupSnapshotLoads\.get\(location\)[\s\S]*?studioNavigatorLoadCanvasGroupSnapshots\(location,request\)/);
  assert.match(functionSource(navigator, "studioNavigatorLoadCanvasGroupSnapshots"), /await snapshotsAt\(location\)[\s\S]*?studioNavigatorCanvasGroupSnapshots\.set\(key,item\)[\s\S]*?renderStudioAgentHistory\(\)/);
  const renderAgentHistory=functionSource(navigator, "renderStudioAgentHistory");
  assert.match(renderAgentHistory, /canvasAgentStoredHistoryGroups\(\)\.filter\(group=>!group\.canvasKey\.startsWith\("draft:"\)\)/);
  assert.doesNotMatch(renderAgentHistory, /startsWith\("draft:"\)\)\|\|group\.canvasKey===state\.canvasAgentCanvasKey/);
  assert.match(renderAgentHistory, /releaseStudioNavigatorPreviewUrls\(studioNavigatorAgentPreviewUrls\)[\s\S]*?studioNavigatorQueueCanvasGroupSnapshots\(groups\)[\s\S]*?studioNavigatorCanvasPreview\(studioNavigatorCanvasGroupSnapshot\(group\),studioNavigatorAgentPreviewUrls\)[\s\S]*?heading\.append\(canvasPreview,headingBody\)/);
  assert.match(functionSource(navigator, "studioNavigatorCanvasPreview"), /item\?\.preview instanceof Blob[\s\S]*?urls\.add\(url\)[\s\S]*?urls\.delete\(url\)/);
  assert.match(navigator, /className="studio-navigator-conversation-entry"[\s\S]*?className="studio-navigator-session-delete"/);
  assert.match(functionSource(navigator, "openStudioSessionDeleteDialog"), /studioSessionDeletePending=[\s\S]*?studioSessionDeleteDialog\.showModal\(\)[\s\S]*?studioSessionDeleteCancel\.focus/);
  assert.match(functionSource(navigator, "confirmStudioSessionDelete"), /canvasAgentDeleteStoredConversation\(studioSessionDeletePending\.canvasKey,studioSessionDeletePending\.conversationId\)/);
  assert.match(functionSource(navigator, "openStudioConversation"), /requestLoadSnapshot\(identity\.id,identity\.location\)/);
  assert.match(functionSource(navigator, "openStudioConversationOnCurrentCanvas"), /canvasAgentHistoryForCanvas\(pending\.canvasKey\)[\s\S]*?openCanvasAgent\(\{focus:false,connect:false\}\)[\s\S]*?canvasAgentViewStoredConversation\(conversation\.id\)/);
  assert.match(functionSource(navigator, "collapseStudioNavigatorForWorkspaceFocus"), /studioNavigatorIsOpen\(\)[\s\S]*?setStudioNavigatorOpen\(false\)/);
  assert.match(navigator, /view\.addEventListener\("pointerdown", collapseStudioNavigatorForWorkspaceFocus, true\)/);
  assert.match(navigator, /view\.addEventListener\("focusin", collapseStudioNavigatorForWorkspaceFocus\)/);
  assert.match(navigator, /canvasAgentPanel\.addEventListener\("pointerdown", collapseStudioNavigatorForWorkspaceFocus, true\)/);
  assert.match(navigator, /canvasAgentPanel\.addEventListener\("focusin", collapseStudioNavigatorForWorkspaceFocus\)/);
  assert.match(functionSource(navigator, "studioNavigatorCanvasDidLoad"), /openStudioConversationOnCurrentCanvas\(studioNavigatorPendingConversation\)/);
  assert.match(navigator, /snapshotItemsForCurrentView\(\)[\s\S]*?requestLoadSnapshot\(item\.id, location\)/);
  assert.match(navigator, /openHistoryPanel\(\)/);
  assert.match(functionSource(navigator, "updateStudioNavigatorSurfaceInert"), /studioNavigatorIsCompact\(\)[\s\S]*?view\.inert = true[\s\S]*?dataset\.studioNavigatorInert[\s\S]*?view\.inert = false/);
  assert.doesNotMatch(navigator, /canvasAgentBeginLocalConversation|canvasAgentStartNewConversation/);
  assert.match(persistence, /function snapshotItemsForCurrentView\(\)/);
  assert.match(functionSource(persistence, "renderStudioSnapshotLists"), /renderCanvases\?\.\(\)[\s\S]*?renderAgent\?\.\(\)/);
  assert.match(functionSource(persistence, "renderSnapshotList"), /renderStudioSnapshotLists\(\)[\s\S]*?renderStudioSnapshotLists\(\)/);
  assert.match(persistence, /wantsConversationForCanvas\?\.\(\{ id:item\.id, location \}\)[\s\S]*?deferConversationStart:restoreStudioConversation/);
  assert.match(functionSource(agent, "canvasAgentCanvasDidChange"), /deferConversationStart[\s\S]*?!deferConversationStart&&/);
  assert.match(agent, /function canvasAgentStoredHistoryGroups\(\)/);
  assert.match(agent, /PenEchoStudioNavigator\?\.renderAgent/);
  assert.match(css, /body\[data-theme="studio"\] \.studio-navigator\s*\{[^}]*position:\s*absolute[^}]*inset:\s*var\(--studio-toolbar-height\) auto 0 0[^}]*width:\s*256px[^}]*flex:\s*0 0 auto[^}]*border-right:\s*0[^}]*background:\s*var\(--studio-glass\)[^}]*box-shadow:\s*4px 0 8px var\(--studio-chrome-shadow-color\)[^}]*backdrop-filter:\s*saturate\(1\.15\) blur\(20px\)/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.studio-navigator\s*\{[^}]*z-index:\s*45[^}]*box-shadow:\s*4px 0 8px var\(--studio-chrome-shadow-color\)/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.studio-navigator-scrim\s*\{[^}]*z-index:\s*44[^}]*background:\s*transparent/);
  assert.match(css, /not\(\.studio-navigator-open\) \.studio-navigator\s*\{[^}]*transform:\s*translateX\(-100%\)/);
  assert.match(css, /\.studio-navigator-group-heading \.studio-navigator-item-icon\.canvas\s*\{[^}]*width:\s*40px[^}]*height:\s*28px[^}]*flex-basis:\s*40px/);
  assert.match(css, /\.studio-navigator-group-heading \.studio-navigator-item-icon\.canvas img\s*\{[^}]*object-fit:\s*contain/);
  assert.match(css, /\.studio-navigator-group-conversations\s*\{[^}]*border-left:\s*1px solid/);
  assert.match(css, /\.studio-navigator-session-delete\s*\{[^}]*width:\s*36px[^}]*height:\s*36px[^}]*opacity:\s*0[^}]*pointer-events:\s*none/);
  assert.match(css, /\.studio-navigator-conversation-entry:focus-within \.studio-navigator-session-delete\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/);
  assert.match(css, /\.studio-session-delete-dialog\s*\{[^}]*width:\s*min\(400px,[^}]*border-radius:\s*14px/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.studio-navigator\s*\{\s*transition:\s*none/);
  for (const key of ["studioNavigatorTitle", "studioNavigatorAgents", "studioNavigatorCanvases", "studioNavigatorManageCanvases", "studioNavigatorSessionCount", "studioNavigatorCanvasUnavailable", "studioNavigatorDeleteSession", "studioNavigatorDeleteSessionAction", "studioNavigatorDeleteSessionConfirm"]) {
    assert.match(app, new RegExp(`\\b${key}:\\s*"`));
    assert.match(zh, new RegExp(`\\b${key}:\\s*"`));
  }
});

test("Studio tablet edge swipes open the left and right sidebars without taking mouse or pen input", () => {
  const navigator = read("src/client/app/studio-navigator.js"),
    side = functionSource(navigator, "studioEdgeSwipeSide"),
    move = functionSource(navigator, "moveStudioEdgeSwipe");
  assert.match(navigator, /STUDIO_EDGE_SWIPE_START_PX = 28,[\s\S]*?STUDIO_EDGE_SWIPE_COMMIT_PX = 56,[\s\S]*?STUDIO_EDGE_SWIPE_DIRECTION_RATIO = 1\.25/);
  assert.match(side, /event\.pointerType !== "touch"/);
  assert.match(side, /event\.isPrimary === false/);
  assert.match(side, /state\.viewMode \|\| !studioNavigatorIsStudio\(\)/);
  assert.match(side, /studioEdgeSwipeInteractiveTarget\(event\.target\)/);
  assert.match(side, /leftInset >= 0[\s\S]*?!studioNavigatorIsOpen\(\)[\s\S]*?return "left"/);
  assert.match(side, /rightInset >= 0[\s\S]*?canvasAgentAvailable\(\)[\s\S]*?canvasAgentPanel\.hidden[\s\S]*?canvasAgentDockedPanel\(\)[\s\S]*?return "right"/);
  assert.match(move, /inward < STUDIO_EDGE_SWIPE_COMMIT_PX \|\| inward < deltaY \* STUDIO_EDGE_SWIPE_DIRECTION_RATIO/);
  assert.match(move, /setStudioNavigatorOpen\(true, \{ focus:false \}\)[\s\S]*?openCanvasAgent\(\{ focus:false \}\)/);
  assert.match(navigator, /view\.addEventListener\("pointerdown", beginStudioEdgeSwipe, true\)[\s\S]*?view\.addEventListener\("pointercancel", finishStudioEdgeSwipe, true\)/);
  assert.match(navigator, /studioNavigatorToggle\.addEventListener\("click"/);
});

test("stored Agent sessions can be deleted individually without touching sibling sessions", () => {
  const agent = read("src/client/app/canvas-agent-runtime.js"), writes = [], context = {
    canvasAgent:{projectId:"",currentConversation:{id:"keep"},requestPending:false,running:false},
    state:{canvasAgentCanvasKey:"device:canvas-a"},
    canvasAgentReadHistoryStore:() => ({
      version:1,
      canvasMeta:{"device:canvas-a":{name:"Canvas A",updatedAt:30}},
      canvases:{"device:canvas-a":[{id:"delete",updatedAt:30,items:[{}]},{id:"keep",updatedAt:20,items:[{}]}]},
    }),
    canvasAgentNormalizeConversation:(value) => value,
    canvasAgentRememberCanvasMeta:(store,key,value) => { store.canvasMeta[key]={name:value.name,updatedAt:value.updatedAt}; },
    canvasAgentBeginLocalConversation:() => { throw Error("a sibling deletion must not reset the current session"); },
    canvasAgentDropSessionIdentity:() => {},
    canvasAgentSetStatus:() => {},
    canvasAgentRenderHistoryList:() => {},
    t:(key) => key,
    localStorage:{setItem:(key,value) => writes.push([key,JSON.parse(value)])},
    CANVAS_AGENT_HISTORY_KEY:"history",
    result:null,
  };
  vm.runInNewContext(`${functionSource(agent,"canvasAgentDeleteStoredConversation")};result=canvasAgentDeleteStoredConversation("device:canvas-a","delete");`,context);
  assert.equal(context.result.deleted,true);
  assert.deepEqual(writes[0][1].canvases["device:canvas-a"].map(item=>item.id),["keep"]);
  assert.equal(writes[0][1].canvasMeta["device:canvas-a"].updatedAt,20);
});

test("deleting the current stored Agent session is blocked while busy and resets only after deletion", () => {
  const agent = read("src/client/app/canvas-agent-runtime.js"), writes = [], calls = [], context = {
    canvasAgent:{projectId:"",currentConversation:{id:"current"},requestPending:true,running:false},
    state:{canvasAgentCanvasKey:"device:canvas-a"},
    canvasAgentReadHistoryStore:() => ({version:1,canvasMeta:{"device:canvas-a":{name:"Canvas A",updatedAt:30}},canvases:{"device:canvas-a":[{id:"current",updatedAt:30,items:[{}]}]}}),
    canvasAgentNormalizeConversation:(value) => value,
    canvasAgentRememberCanvasMeta:() => {},
    canvasAgentBeginLocalConversation:(options) => calls.push(["begin",options]),
    canvasAgentDropSessionIdentity:() => calls.push(["drop"]),
    canvasAgentSetStatus:(text,status) => calls.push(["status",text,status]),
    canvasAgentRenderHistoryList:() => calls.push(["render"]),
    t:(key) => key,
    localStorage:{setItem:(key,value) => writes.push([key,JSON.parse(value)])},
    CANVAS_AGENT_HISTORY_KEY:"history",
    first:null,
    second:null,
  };
  vm.runInNewContext(`${functionSource(agent,"canvasAgentDeleteStoredConversation")};first=canvasAgentDeleteStoredConversation("device:canvas-a","current");canvasAgent.requestPending=false;second=canvasAgentDeleteStoredConversation("device:canvas-a","current");`,context);
  assert.equal(context.first.reason,"busy");
  assert.equal(context.second.deleted,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0][1].canvases["device:canvas-a"],undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),["begin",{persistCurrent:false}]);
  assert.deepEqual(calls.slice(1),[["drop"],["status","canvasAgentReadyConnect","ready"]]);
});

test("stored Agent canvas groups and their conversations are newest first", () => {
  const agent = read("src/client/app/canvas-agent-runtime.js"), context = {
    CANVAS_AGENT_HISTORY_LIMIT:5,
    canvasAgentReadHistoryStore:() => ({
      version:1,
      canvasMeta:{"device:older":{name:"Older",updatedAt:20},"device:newer":{name:"Newer",updatedAt:90}},
      canvases:{
        "device:older":[{id:"old",createdAt:10,updatedAt:20,title:"Old",items:[{}]}],
        "device:newer":[{id:"second",createdAt:40,updatedAt:70,title:"Second",items:[{}]},{id:"first",createdAt:50,updatedAt:90,title:"First",items:[{}]}],
      },
    }),
    canvasAgentNormalizeConversation:(value) => value,
    canvasAgentHistoryText:(value,limit) => String(value||"").slice(0,limit),
    result:null,
  };
  vm.runInNewContext(`${functionSource(agent,"canvasAgentStoredHistoryGroups")};result=canvasAgentStoredHistoryGroups();`,context);
  const groups=JSON.parse(JSON.stringify(context.result));
  assert.deepEqual(groups.map(group=>group.canvasKey),["device:newer","device:older"]);
  assert.deepEqual(groups[0].conversations.map(conversation=>conversation.id),["first","second"]);
  assert.equal(groups[0].name,"Newer");
});

test("the canvas fills the available browser viewport consistently across themes", () => {
  const css = read("public/style.css");
  assert.match(css, /main\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[^}]*min-height:\s*100dvh;[^}]*flex-direction:\s*column;[^}]*max-width:\s*none/);
  assert.match(css, /\.canvas-frame\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto/);
  assert.match(css, /#viewport\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*440px;[^}]*flex:\s*1 1 auto/);
  assert.doesNotMatch(css, /#viewport\s*\{[^}]*(?:height:\s*(?:min\([^}]*vh|[0-9]+vh)|900px|960px)/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\]\s+#viewport\s*\{[^}]*height:/);
  assert.match(css, /@media \(max-width:\s*620px\)\s*\{[\s\S]*?#viewport\s*\{\s*min-height:\s*380px;\s*\}/);
});

test("PNG export crops to all ink with one tile of padding at 1.5x browser-local download resolution", () => {
  const html = read("public/index.html"), app = read("public/app.js"), ink = functionSource(app, "exportInkBounds"), region = functionSource(app, "exportRegion"), render = functionSource(app, "renderExportCanvas"), run = functionSource(app, "exportCanvasPng");
  assert.match(ink, /inkBox\(tileCanvas/);
  assert.doesNotMatch(ink, /visibleInkBounds/);
  assert.match(region, /Math\.floor\(ink\.x\) - TILE/);
  assert.match(region, /Math\.ceil\(ink\.x \+ ink\.w\) \+ TILE/);
  assert.match(region, /Math\.ceil\(ink\.y \+ ink\.h\) \+ TILE/);
  assert.match(app, /CANVAS_DOWNLOAD_RESOLUTION_SCALE = 1\.5,[\s\S]*?EXPORT_MAX_DIMENSION = 16384,[\s\S]*?EXPORT_MAX_PIXELS = 64 \* 1024 \* 1024/);
  assert.doesNotMatch(app, /EXPORT_TARGET_SCALE|function exportPixelScale/);
  assert.match(render, /prepareVisibleWidgetSnapshots\(null, false, null, true\)/);
  assert.match(render, /scale = Math\.min\(CANVAS_DOWNLOAD_RESOLUTION_SCALE, EXPORT_MAX_DIMENSION \/ region\.w, EXPORT_MAX_DIMENSION \/ region\.h, Math\.sqrt\(EXPORT_MAX_PIXELS \/ \(region\.w \* region\.h\)\)\)/);
  assert.match(render, /offscreen\(Math\.max\(1, Math\.ceil\(region\.w \* scale\)\), Math\.max\(1, Math\.ceil\(region\.h \* scale\)\)\)/);
  assert.match(render, /imageSmoothingEnabled = true[\s\S]*?imageSmoothingQuality = "high"/);
  assert.match(render, /setTransform\(scale, 0, 0, scale, -region\.x \* scale, -region\.y \* scale\)/);
  assert.match(render, /state\.paint\.paper/);
  assert.match(render, /state\.gridVisible/);
  assert.match(render, /for \(const \[tileKey, tileCanvas\] of tiles\)/);
  assert.match(render, /selection\?\.phase === "active"/);
  assert.match(run, /canvasBlob\(canvas\)/);
  assert.match(run, /URL\.createObjectURL\(blob\)[\s\S]*?link\.click\(\)/);
  assert.doesNotMatch(run,/\bfetch\s*\(|XMLHttpRequest|WebSocket|\/api\/|cloud|relay/i);
  assert.match(run, /link\.download = exportFilename\(\)/);
  assert.match(app, /querySelector\("#exportPngBtn"\)\.onclick = exportCanvasPng/);
  assert.match(html, /id="exportPngBtn"[^>]*data-i18n-aria="exportPng"/);
});

test("Auto AI exposes a persisted zero-to-ten-second delay control", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css");
  assert.match(html, /id="autoLabel">Auto \(5s\)<\/span>/);
  assert.match(html, /id="autoDelayRange"[^>]*min="0"[^>]*max="10"[^>]*step="0\.1"[^>]*value="5"/);
  assert.match(app, /DEFAULT_AUTO_DELAY = 5000/);
  assert.match(app, /autoEnabled:\s*"Auto \(\{delay\}s\)"/);
  assert.match(app, /penecho-auto-delay-ms/);
  assert.match(app, /penecho-auto-ai/);
  assert.match(app, /setTimeout\(hideAutoDelayControl,\s*5000\)/);
  assert.match(app, /if\s*\(state\.auto\)\s*setAutoEnabled\(false\)/);
  assert.match(app, /else\s*setAutoEnabled\(true,\s*true\)/);
  assert.match(css, /\.auto-delay-popover\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.auto-delay-popover\s*\{[^}]*left:\s*0;[^}]*width:\s*190px/);
});

test("Auto AI waits for unsettled toolboxes while manual actions remain available", () => {
  const app = read("public/app.js"), zh = read("public/locales/zh.js"),
    unsettled = functionSource(app, "hasUnsettledToolbox"),
    launch = functionSource(app, "launchAutomaticAI"),
    schedule = functionSource(app, "schedule"),
    manual = functionSource(app, "invokeAIAction"),
    createText = functionSource(app, "createTextEditor");
  for (const toolbox of ["state.pending", "state.pendingGesture", "state.selection", "state.selectionGesture", "state.textEditors.size"]) assert.match(unsettled, new RegExp(toolbox.replace(".", "\\.")));
  assert.match(launch, /state\.mode === "hand"/);
  assert.match(schedule, /state\.mode === "hand"/);
  assert.match(launch, /if \(hasUnsettledToolbox\(\)\)/);
  assert.match(launch, /state\.statusKey !== "autoToolboxPending"/);
  assert.ok(launch.indexOf("hasUnsettledToolbox()") < launch.indexOf('requestAI("auto")'));
  assert.doesNotMatch(schedule, /textEditors|hasUnsettledToolbox/);
  assert.match(schedule, /setTimeout\(\(\) =>/);
  assert.doesNotMatch(createText, /clearTimeout\(state\.timer\)/);
  assert.match(createText, /if \(!state\.timer && state\.auto && state\.dirty && state\.autoEligible\) schedule\(\)/);
  assert.match(manual, /requestAI\(action,/);
  assert.doesNotMatch(manual, /hasUnsettledToolbox|autoToolboxPending/);
  assert.match(app, /autoToolboxPending:/);
  assert.match(zh, /autoToolboxPending:/);
});

test("toolbar exposes a fixed clickable reasoning menu before the drawing tools", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const section = html.indexOf('id="aiToolsSection"'), auto = html.indexOf('id="autoControl"'), effort = html.indexOf('id="effortControl"'), font = html.indexOf('id="aiFont"'), pen = html.indexOf('data-mode="pen"'), fullscreen = html.indexOf('id="fullscreenBtn"'), grid = html.indexOf('id="gridToggle"');
  assert.ok(section < auto && auto < effort && effort < pen && pen < font);
  assert.ok(pen < fullscreen && fullscreen < grid);
  assert.match(html, /id="aiToolsSection"[^>]*data-i18n-aria="aiTools"[\s\S]*?class="ai-section-label"[^>]*>AI<\/span>/);
  assert.match(html, /<label[^>]*class="settings-row"[^>]*>[\s\S]*?<span data-i18n="aiFont">AI font<\/span>[\s\S]*?id="aiFont"/);
  assert.match(css, /\.ai-tools-section\s*\{/);
  assert.match(css, /\.view-tools\s*\{/);
  assert.match(html, /id="aiEffortButton"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="effortPopover"[^>]*hidden/);
  assert.equal((html.match(/class="effort-option"/g) || []).length, 6);
  assert.match(html, /data-effort="config"/);
  for (const mode of ["pen", "eraser", "select"]) {
    const button = html.match(new RegExp(`<button[^>]*data-mode="${mode}"[\\s\\S]*?<\\/button>`))?.[0] || "";
    assert.match(button, /class="[^"]*icon-button[^"]*"/);
    assert.match(button, /data-i18n-aria=/);
    assert.match(button, /data-i18n-title=/);
    assert.doesNotMatch(button, /<span/);
  }
  assert.match(app, /penecho-ai-effort/);
  assert.match(app, /reasoningEffort === "config" \? \{\} : \{ reasoningEffort: state\.reasoningEffort \}/);
  assert.match(app, /const EFFORT_LEVELS = \["none", "low", "medium", "high", "max"\]/);
  assert.match(app, /EFFORT_OPTIONS = \["config", \.\.\.EFFORT_LEVELS\]/);
  assert.match(css, /\.effort-control\s*\{[^}]*width:\s*172px;[^}]*flex:\s*0 0 172px/);
  assert.match(app, /function positionToolbarPopover\(controlSelector, popoverSelector, options\)[\s\S]*?host\.append\(popover\)[\s\S]*?getBoundingClientRect\(\)[\s\S]*?toolbar-anchored-popover/);
  assert.match(app, /showEffortControl\(\)[\s\S]*?positionToolbarPopover\("#effortControl", "#effortPopover"\)/);
  assert.match(app, /!document\.querySelector\("#effortControl"\)\.contains\(event\.target\) && !document\.querySelector\("#effortPopover"\)\.contains\(event\.target\)/);
  assert.match(css, /\.topbar > \.toolbar-anchored-popover\s*\{[^}]*z-index:\s*52/);
  assert.match(css, /\.effort-popover\s*\{[^}]*width:\s*168px[^}]*background:\s*color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /\.effort-option\s*\{[^}]*min-height:\s*28px[^}]*font:\s*550 12\.5px\/1\.2 system-ui[^}]*transition:/);
  assert.match(css, /body\[data-theme="studio"\] \.effort-popover,[^}]*background:\s*color-mix\(in srgb, var\(--studio-panel\) 62%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.effort-option\.active\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--studio-accent\) 10%, var\(--studio-panel\)\)/);
  assert.match(css, /@supports not \(\(-webkit-backdrop-filter:[\s\S]*?\.effort-popover,[\s\S]*?background:\s*var\(--panel-raised\)/);
  assert.doesNotMatch(css, /effort-slider-shell|effort-thumb|effort-dots/);
  for (const [type, popover] of [["ink", "inkColorPopover"], ["ai", "aiColorPopover"]]) {
    assert.match(html, new RegExp(`data-color-control="${type}"[\\s\\S]*?aria-haspopup="menu"[^>]*aria-controls="${popover}"[\\s\\S]*?id="${popover}"[^>]*role="menu"[^>]*hidden`));
    assert.match(app, new RegExp(`positionToolbarPopover\\('\\[data-color-control="${type}"\\]', "#${popover}", \\{ align:"center", gap:6 \\}\\)`));
  }
  assert.match(functionSource(app, "colorOrbitFor"), /getAttribute\("aria-controls"\)[\s\S]*?document\.getElementById\(id\)/);
  assert.match(css, /\.color-orbit\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4, 28px\)[^}]*background:\s*color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\)[^}]*blur\(28px\)/);
  assert.match(css, /\.color-orbit\[hidden\]\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /\.color-orb-control\.open \.orbit-[1-8]/);
  for (const key of ["reasoningEffort", "reasoningEffortDisplay", "effortConfigured", "effortConfiguredShort", "effortNone", "effortLow", "effortMedium", "effortMediumShort", "effortHigh", "effortMaximum"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("text editor corner scales its box and font while edge handles remain single-axis", () => {
  const app = read("public/app.js"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizeTextEditorDimensions")})`),
    gesture = { startWidth: 320, startHeight: 168, startFontCss: 17 };
  const corner = resize(gesture, "corner", 160, 84, 170, 96, 900, 700);
  assert.equal(corner.widthCss, 480);
  assert.equal(corner.heightCss, 252);
  assert.equal(corner.fontCss, 25.5);
  assert.ok(Math.abs(corner.widthCss / gesture.startWidth - corner.heightCss / gesture.startHeight) < 1e-9);
  assert.ok(Math.abs(corner.fontCss / gesture.startFontCss - corner.widthCss / gesture.startWidth) < 1e-9);
  assert.deepEqual({ ...resize(gesture, "width", 90, 50, 170, 96, 900, 700) }, { widthCss: 410, heightCss: 168, fontCss: 17 });
  assert.deepEqual({ ...resize(gesture, "height", 90, 50, 170, 96, 900, 700) }, { widthCss: 320, heightCss: 218, fontCss: 17 });
  const minimum = resize(gesture, "corner", -400, -400, 170, 96, 900, 700);
  assert.equal(minimum.heightCss, 96);
  assert.ok(Math.abs(minimum.widthCss / gesture.startWidth - minimum.fontCss / gesture.startFontCss) < 1e-9);
  const maximum = resize(gesture, "corner", 2000, 2000, 170, 96, 400, 700);
  assert.equal(maximum.widthCss, 400);
  assert.ok(Math.abs(maximum.heightCss / gesture.startHeight - maximum.fontCss / gesture.startFontCss) < 1e-9);
  const resizedFirst = { startWidth: 500, startHeight: 120, startFontCss: 17 },
    resizedCorner = resize(resizedFirst, "corner", 250, 60, 170, 96, 1000, 700);
  assert.deepEqual({ ...resizedCorner }, { widthCss: 750, heightCss: 180, fontCss: 25.5 });
});

test("text editor and final raster share one visible content origin across canvas scales", () => {
  const app = read("public/app.js"),
    place = vm.runInNewContext(`(${functionSource(app, "textBoxOriginFromEditor")})`),
    reopen = vm.runInNewContext(`(${functionSource(app, "textEditorOriginFromTextBox")})`),
    editor = { x:742.25, y:391.75 },
    contentMetrics = { x:11, y:51, width:298 },
    contentInset = { x:2.04, y:2.04 };
  for (const scale of [0.03, 0.25, 0.8, 1, 1.75, 2]) {
    const item = place(editor, contentMetrics, contentInset, scale),
      visibleEditorX = editor.x + contentMetrics.x / scale,
      visibleEditorY = editor.y + contentMetrics.y / scale;
    assert.ok(Math.abs(item.x + contentInset.x - visibleEditorX) < 1e-9);
    assert.ok(Math.abs(item.y + contentInset.y - visibleEditorY) < 1e-9);
    const reopened = reopen(item, contentMetrics, contentInset, scale);
    assert.ok(Math.abs(reopened.x - editor.x) < 1e-9);
    assert.ok(Math.abs(reopened.y - editor.y) < 1e-9);
  }
});

test("clipboard copy button and system paste import only text or images into native canvas controls", () => {
  const html = read("public/index.html"),
    app = read("public/app.js"),
    zh = read("public/locales/zh.js"),
    payload = functionSource(app, "clipboardPayloadFromDataTransfer"),
    navigatorPayload = functionSource(app, "navigatorClipboardPayload"),
    importPayload = functionSource(app, "importClipboardPayload"),
    addText = functionSource(app, "addClipboardText"),
    createText = functionSource(app, "createTextEditor"),
    restoreTextMode = functionSource(app, "restoreTextEditorMode"),
    copy = functionSource(app, "copyFromSystemClipboard");

  const imageButton = html.indexOf('id="imagePickerBtn"'),
    copyButton = html.indexOf('id="clipboardCopyBtn"');
  assert.ok(imageButton >= 0 && copyButton > imageButton);
  assert.match(html.slice(copyButton, copyButton + 500), /data-i18n-aria="copyFromClipboard"/);
  assert.match(app, /document\.addEventListener\("paste"/);
  assert.match(app, /editableClipboardTarget\(event\.target\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?clipboardPayloadFromDataTransfer\(event\.clipboardData\)/);
  assert.match(payload, /startsWith\("image\/"\)[\s\S]*?getData\?\.\("text\/plain"\)/);
  assert.doesNotMatch(payload, /text\/html/);
  assert.match(navigatorPayload, /navigator\.clipboard\?\.read[\s\S]*?startsWith\("image\/"\)[\s\S]*?text\/plain/);
  assert.match(importPayload, /payload\?\.image instanceof Blob[\s\S]*?addImageFile\(payload\.image\)/);
  assert.match(importPayload, /payload\?\.text[\s\S]*?addClipboardText\(payload\.text\)/);
  assert.match(importPayload, /clipboardUnsupported/);
  assert.match(addText, /state\.pending[\s\S]*?acceptPending\(\)/);
  assert.match(addText, /state\.selection[\s\S]*?commitSelection\(\)/);
  assert.match(addText, /returnMode = state\.mode[\s\S]*?setCanvasMode\("hand"/);
  assert.match(addText, /createTextEditor\(clipboardTextEditorPoint\(\), \{ text:value, returnMode \}\)/);
  assert.match(createText, /textarea\.value = typeof options\.text === "string"/);
  assert.match(createText, /returnMode:typeof options\.returnMode === "string"/);
  assert.match(restoreTextMode, /returnMode && state\.mode === "hand"[\s\S]*?setCanvasMode\(returnMode/);
  assert.match(copy, /clipboardReading[\s\S]*?navigatorClipboardPayload\(\)[\s\S]*?clipboardReadFailed/);
  for (const key of ["copyFromClipboard", "clipboardReading", "clipboardTextAdded", "clipboardUnsupported", "clipboardReadFailed"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("text tool toggles a real MD+TeX preview and confirms the unchanged source", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js");
  const textButton = html.match(/<button[^>]*data-mode="text"[\s\S]*?<\/button>/)?.[0] || "";
  assert.match(textButton, /class="[^\"]*icon-button[^\"]*"/);
  assert.match(textButton, /data-i18n-aria="text"/);
  for (const id of ["textEditorLayer", "textInputHint", "textHelpDialog", "textHelpClose"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="textHelpDone"|data-i18n="textHelpConfirm"/);
  for (const name of ["createTextEditor", "confirmTextEditor", "cancelTextEditor", "toggleTextEditorMixedMode", "updateTextEditorMixedMode", "renderTextEditorPreview", "scheduleTextEditorPreview", "cancelTextEditorPreview", "mixedTextImage", "positionTextEditors", "keepTextEditorVisible", "clearTextEditors", "setCanvasMode", "openTextHelp", "closeTextHelp", "restoreTextEditorAfterHelp"]) assert.match(app, new RegExp(`function ${name}\\(`));
  assert.ok(html.indexOf('src="mixed-text.js"') < html.indexOf('src="app.js"'));
  assert.match(app, /textEditorStyleSheet\(\)/);
  assert.match(app, /textInputBlockedUntil/);
  assert.match(app, /nextTextEditorZ/);
  assert.match(app, /textTap/);
  assert.match(app, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  assert.match(app, /\? \{ typedInput \}/);
  assert.match(app, /if \(state\.auto && !refineCandidate\) schedule\(Math\.max\(1000, state\.autoDelayMs\)\)/);
  assert.match(app, /mixedMode:\s*false/);
  assert.match(app, /fontCss:\s*Number\(options\.fontCss\) \|\| TEXT_EDITOR_FONT_CSS/);
  assert.match(app, /startFontCss:\s*editor\.fontCss/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-pressed", "false"\)/);
  assert.match(app, /helpButton\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(app, /header\.append\(title, helpButton, mixedModeButton, acceptButton, cancelButton\)/);
  assert.match(app, /openTextHelp\(editor, helpButton\)/);
  assert.match(app, /function fittedTextBoxContent\(text, fontSize, color, maxWidth\)/);
  assert.match(app, /function textEditorContentMetrics\(editor\)/);
  assert.match(app, /function textImageContentInset\(image\)/);
  assert.match(app, /function textBoxOriginFromEditor\(editor, contentMetrics, contentInset, scale\)/);
  assert.match(app, /function textEditorOriginFromTextBox\(item, contentMetrics, contentInset, scale\)/);
  assert.match(app, /preview\.className = "text-editor-preview"/);
  assert.match(app, /mixedModeButton\.setAttribute\("aria-controls", preview\.id\)/);
  assert.match(app, /state\.latestTypedInput = \{ text: text\.slice\(0, TEXT_INPUT_MAX_LENGTH\), box \}/);
  const confirm = functionSource(app, "confirmTextEditor"),
    cancel = functionSource(app, "cancelTextEditor"),
    reconcile = functionSource(app, "reconcileDirtyAfterTextBoxDeletion"),
    create = functionSource(app, "createTextEditor"),
    setMode = functionSource(app, "setCanvasMode"),
    syncModePresentation = functionSource(app, "syncCanvasModePresentation"),
    openHelp = functionSource(app, "openTextHelp"),
    restoreHelp = functionSource(app, "restoreTextEditorAfterHelp"),
    toggle = functionSource(app, "toggleTextEditorMixedMode"),
    update = functionSource(app, "updateTextEditorMixedMode"),
    preview = functionSource(app, "renderTextEditorPreview");
  assert.doesNotMatch(confirm, /hotspotTrail\.push/);
  assert.match(app, /TEXT_INPUT_GUARD_MS\s*=\s*500/);
  assert.match(confirm, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /blockCanvasInput\(TEXT_INPUT_GUARD_MS\)/);
  assert.match(cancel, /editor\.sourceTextBoxId[\s\S]*?recordTextBoxesBefore\(\)[\s\S]*?state\.textBoxes\.splice\(index, 1\)[\s\S]*?state\.userRevision\+\+[\s\S]*?saveUserCanvasChange\(\)/);
  assert.doesNotMatch(cancel, /mergeDirtyBox|hotspotTrail|autoEligible\s*=\s*true/);
  assert.match(cancel, /reconcileDirtyAfterTextBoxDeletion\(deletedTextBox\)/);
  assert.match(reconcile, /deletedLatestTypedInput[\s\S]*?state\.latestTypedInput = null[\s\S]*?state\.dirtyTextBoxIds\.delete\(deletedTextBox\.id\)[\s\S]*?recomputeDirtyBounds\(\)/);
  assert.match(cancel, /if \(!deletedTextBox && !state\.textEditors\.size/);
  assert.doesNotMatch(create, /event\.key === "Escape"/);
  assert.match(confirm, /editor\.cancelled \|\| state\.textEditors\.get\(editor\.id\) !== editor/);
  assert.match(confirm, /if \(editor\.commitPromise\) return editor\.commitPromise/);
  assert.match(confirm, /editor\.commitPromise = commitPromise/);
  assert.match(confirm, /return await commitPromise/);
  assert.match(confirm, /proposedFontSize = editor\.fontCss \/ Math\.max\(0\.03, state\.scale\)/);
  assert.match(confirm, /contentMetrics = textEditorContentMetrics\(editor\)/);
  assert.match(confirm, /alignedOrigin = textBoxOriginFromEditor\(editor, contentMetrics, contentInset, editorScale\)/);
  assert.doesNotMatch(confirm, /editor\.x \+=|editor\.y \+=/);
  assert.match(confirm, /fittedTextBoxContent\(text, fontSize, color, maxWidth\)/);
  assert.match(confirm, /Math\.min\(SIZE - width, x\)/);
  assert.match(confirm, /Math\.min\(SIZE - height, y\)/);
  assert.match(confirm, /state\.textBoxes\.splice\(existingIndex, 1, item\)[\s\S]*?state\.textBoxes\.push\(item\)/);
  assert.doesNotMatch(confirm, /blitSized\(|retainSharpOverlay\(/);
  assert.match(app, /function editTextBox\(item\)/);
  assert.match(app, /state\.mode !== "hand"[\s\S]*?sourceTextBoxId:item\.id/);
  assert.match(css, /\.text-editor\s*\{[^}]*border:\s*1px solid[^}]*border-radius:\s*10px[^}]*box-shadow:/);
  assert.match(css, /\.text-editor-button\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*box-shadow:\s*none/);
  assert.ok(confirm.indexOf('setCanvasMode("pen")') > confirm.indexOf("if (!text.trim())"));
  assert.ok(confirm.indexOf('setCanvasMode("pen")') < confirm.indexOf("await fittedTextBoxContent"));
  assert.match(cancel, /setCanvasMode\("pen"\)/);
  assert.match(setMode, /state\.mode = mode/);
  assert.match(syncModePresentation, /classList\.toggle\("active", item === button\)/);
  assert.match(app, /button\.onclick = \(\) => selectCanvasToolMode\(button\.dataset\.mode, \{ showHint:true \}\)/);
  assert.match(openHelp, /focusTextEditor\(editor\)/);
  assert.match(openHelp, /dialog\.showModal\(\)/);
  assert.match(restoreHelp, /blockCanvasInput\(300\)/);
  assert.match(restoreHelp, /invoker\?\.isConnected/);
  assert.match(app, /textHelpDialog"\)\.addEventListener\("close", restoreTextEditorAfterHelp\)/);
  assert.match(app, /newCanvasDialog"\)\.open \|\| document\.querySelector\("#textHelpDialog"\)\.open/);
  assert.match(toggle, /editor\.mixedMode = !editor\.mixedMode/);
  assert.match(toggle, /scheduleTextEditorPreview\(editor, 0\)/);
  assert.doesNotMatch(toggle, /textarea\.value\s*=|\bschedule\(|requestAI\(|userRevision/);
  assert.match(update, /editor\.textarea\.hidden = editor\.mixedMode/);
  assert.match(update, /editor\.preview\.hidden = !editor\.mixedMode/);
  assert.match(preview, /text = editor\.textarea\.value/);
  assert.match(preview, /image = await mixedTextImage\(text, fontCss, color, maxWidth/);
  assert.match(preview, /editor\.previewRevision !== revision/);
  assert.match(preview, /editor\.preview\.replaceChildren\(image\)/);
  assert.doesNotMatch(preview, /schedule\(|requestAI\(|userRevision/);
  assert.match(css, /\.text-editor\s*\{[^}]*pointer-events:\s*auto;[^}]*border:\s*1px solid[^}]*background:[^}]*box-shadow:/);
  assert.match(css, /\.text-editor-header\s*\{[^}]*border-bottom:\s*1px solid[^}]*background:/);
  assert.match(css, /\.text-editor-body\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-preview\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.text-editor-preview-canvas\s*\{[^}]*--text-editor-preview-inset-x[^}]*--text-editor-preview-inset-y/);
  assert.match(css, /\.text-editor-input\[hidden\]\s*\{[^}]*display:\s*none/);
  assert.match(css, /font:\s*var\(--text-editor-font-size\)\/1\.35/);
  assert.match(css, /\.text-editor-button\.mixed-mode\[aria-pressed="true"\]/);
  assert.match(css, /\.text-editor-button\.help/);
  assert.match(css, /\.text-help-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)[^}]*overflow:\s*auto/);
  assert.match(css, /\.text-help-example pre\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*pre-wrap/);
  assert.match(css, /#textEditorLayer\s*\{[^}]*z-index:\s*6/);
  assert.match(css, /\.text-editor-handle\.width/);
  assert.match(css, /\.text-editor-handle\.height/);
  assert.match(css, /\.text-editor-handle\.corner/);
  for (const key of ["text", "textMixedMode", "textMixedModeShort", "textEditMode", "textPreview", "textMixedModeError", "textConfirm", "textCancel", "textPlaceholder", "textConfirmHint", "textEmpty", "textHelp", "textHelpTitle", "textHelpClose", "textHelpIntro", "textHelpMarkdown", "textHelpMath", "textHelpExampleTitle", "textHelpExample"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("deleting a textbox removes its stale contribution from typed-only attention", () => {
  const app = read("public/app.js"),
    upperBox = { x:11299, y:7064, w:2370, h:708 },
    lowerBox = { x:11840, y:8920, w:920, h:690 },
    upper = { id:"text-box-1", ...upperBox },
    lower = { id:"text-box-2", ...lowerBox },
    state = {
      dirty:{ x:upperBox.x, y:upperBox.y, w:upperBox.w, h:lowerBox.y + lowerBox.h - upperBox.y },
      latestTypedInput:{ text:"Create a FHIR CarePlan", box:{ ...upperBox } },
      hotspotTrail:[],
      autoEligible:true,
      dirtyInkTiles:new Map(),
      dirtyInkBounds:new Map(),
      dirtyImageIds:new Set(),
      dirtyTextBoxIds:new Set([upper.id, lower.id]),
      images:[],
      textBoxes:[upper],
    },
    source = `(() => {
      ${functionSource(app, "unionDirtyBounds")}
      ${functionSource(app, "recomputeDirtyBounds")}
      return ${functionSource(app, "reconcileDirtyAfterTextBoxDeletion")};
    })()`,
    reconcile = vm.runInNewContext(source, {
      state,
      TILE:512,
      DIRTY_MASK_SCALE:.25,
      imageBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
      textBoxBox:(item) => ({ x:item.x, y:item.y, w:item.w, h:item.h }),
      dirtyMaskAlphaBounds:() => null,
    });
  reconcile(lower);
  assert.deepEqual({ ...state.dirty }, upperBox);
  assert.equal(state.latestTypedInput.text, "Create a FHIR CarePlan");
  assert.deepEqual(state.hotspotTrail, []);
  assert.equal(state.autoEligible, true);
});

test("text rendering preserves explicit lines and rejects MathJax error output", () => {
  const app = read("public/app.js"), layout = functionSource(app, "layoutText"), mixed = functionSource(app, "mixedTextImage"), math = functionSource(app, "mathJaxImage");
  assert.match(layout, /split\("\\n"\)/);
  assert.match(layout, /lines\.push\(\.\.\.wrapped\)/);
  assert.match(mixed, /MIXED_TEXT\.parse/);
  assert.match(mixed, /segment\.raw/);
  assert.match(mixed, /rows\.push\(row\)/);
  assert.match(mixed, /MIXED_FORMULA_MAX_LENGTH/);
  assert.match(math, /\[data-mml-node="merror"\], mjx-merror/);
  assert.match(math, /image\.revealRows = \[logicalWidth\]/);
});

test("New canvas, Export, and Auto AI controls have English and Chinese copy", () => {
  const app = read("public/app.js"), zh = read("public/locales/zh.js");
  for (const key of ["autoDelay", "newCanvas", "exportPng", "exportComplete", "exportError", "newCanvasTitle", "saveAsNewAndCreate", "overwriteAndCreate", "newCanvasReady"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("eraser strokes shrink retained dirty input without becoming new AI instructions", () => {
  const app = read("public/app.js");
  const pointerMoveStart = app.indexOf('screen.addEventListener("pointermove"'),
    pointerMoveEnd = app.indexOf("function end(e)", pointerMoveStart),
    pointerMove = app.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(pointerMove, /if \(e\.pointerType !== "touch"\) updateWidgetRefinePointer\(clientPoint\(e\)\)/);
  assert.match(pointerMove, /if \(!state\.drawing \|\| state\.drawing\.id !== e\.pointerId\) return[\s\S]*?stroke\(a, p, d\.erase, size, true\)/);
  assert.match(app, /const shouldRequest = !d\.erase/);
  assert.match(app, /if \(shouldRequest\) \{\s*for \(const point of d\.trail\) state\.hotspotTrail\.push\(point\)/);
  assert.match(app, /recomputeDirtyBounds\(\);\s*filterErasedDirtyHotspots\(d\.dirtyMaskTouched\);\s*refineCandidate = relatchWidgetRefineCandidateFromDirty\(\)/);
  assert.match(app, /if \(state\.dirty && state\.autoEligible && !refineCandidate\) schedule\(\)/);
  assert.match(app, /const erasing = forceEraser \|\| state\.mode === "eraser";\s*if \(erasing\) clearWidgetRefineCandidate\(\)/);
  assert.match(functionSource(app, "invalidateRecognition"), /clearWidgetRefineCandidate\(\)[\s\S]*?state\.dirty = null/);
  assert.match(app, /erase: erasing/);
  assert.match(app, /dirtyMaskTouched:erasing \? new Set\(\) : null/);
  assert.match(app, /dot\(p, erasing, size, true\)/);
  assert.match(app, /stroke\(a, p, d\.erase, size, true\)/);
  assert.match(functionSource(app, "trackDirtyStrokeSegment"), /globalCompositeOperation = erase \? "destination-out" : "source-over"[\s\S]*?state\.dirtyInkBounds\.delete\(k\)/);
});

test("capture failure preserves dirty input and cannot block the AI request", () => {
  const app = read("public/app.js");
  const request = functionSource(app, "requestAI"), emergency = functionSource(app, "emergencyViewportImage");
  assert.doesNotMatch(app, /discardUncapturableInput/);
  assert.match(request, /if \(!packed\) \{[\s\S]*?packed = emergencyViewportImage\(/);
  assert.match(request, /const res = await fetch\("\/api\/ai\/command"/);
  assert.doesNotMatch(request.slice(0, request.indexOf('const res = await fetch("/api/ai/command"')), /state\.dirty = null|hotspotTrail\.splice/);
  assert.match(emergency, /data:image\/png;base64/);
  assert.match(emergency, /hotspotGrid:\{[\s\S]*?hotspots:\[\]/);
});

test("AI capture stays inside the current viewport when retained dirty ink is off-screen", () => {
  const app = read("public/app.js"), capture = functionSource(app, "captureRectFor"), plan = functionSource(app, "planViewportImage"), build = functionSource(app, "buildViewportImage"), request = functionSource(app, "requestAI");
  assert.match(capture, /return visible/);
  assert.doesNotMatch(capture, /Math\.max\(3200|Math\.max\(2200/);
  assert.match(plan, /useFullViewport = captureCurrentViewport \|\| Boolean\(latestBox && !intersection\(latestBox, captureRect\)\)/);
  assert.match(plan, /latestVisible = latestBox \? intersection\(latestBox, sourceRect\) \|\| \{ \.\.\.sourceRect \}/);
  assert.match(build, /changedBox: latestVisible/);
  assert.doesNotMatch(build, /containsRect\(sourceRect, latestBox\)/);
  assert.match(request, /const requestBox = packed\.changedBox/);
  assert.match(request, /rawCommands = Array\.isArray\(data\.commands\)[\s\S]*?normalizeCommandPlacements\(validate\(rawCommands, aiColor, widgetEditTarget, packed\.visibleRect\), packed, requestBox\)/);
});

test("clicking the magic orb sends the Auto AI prompt with the current viewport", () => {
  const app = read("public/app.js"),
    html = read("public/index.html"),
    manual = functionSource(app, "invokeAIAction"),
    request = functionSource(app, "requestAI"),
    plan = functionSource(app, "planViewportImage"),
    build = functionSource(app, "buildViewportImage"),
    automatic = functionSource(app, "launchAutomaticAI"),
    selection = functionSource(app, "requestSelectionAI");
  assert.doesNotMatch(html, /id="aiRadial"|data-ai-action=/);
  assert.match(app, /aiOrb\.addEventListener\("click"[\s\S]*?invokeAIAction\("auto"\)/);
  assert.match(manual, /requestAI\(action, null, \{ captureCurrentViewport: true \}\)/);
  assert.doesNotMatch(manual, /action === "answer"|state\.dirty/);
  assert.match(request, /automatic = action === "auto"/);
  assert.match(request, /trigger: automatic \? "user_paused" : "manual"/);
  assert.match(request, /userAction: action/);
  assert.match(request, /captureCurrentViewport = Boolean\(requestOptions\.captureCurrentViewport\)/);
  assert.match(request, /preparationGeneration = \+\+aiPreparationGeneration[\s\S]*?aiPreparationInvalid\(preparation, preparationGeneration, revision\)/);
  assert.match(functionSource(app, "aiPreparationInvalid"), /state\.userRevision === revision[\s\S]*?finishAIPreparation\(preparation\)[\s\S]*?setStatusKey\("deferred"\)/);
  assert.match(request, /attentionBox = dirtySnapshot \|\| \(captureCurrentViewport \? null : latestBox\)/);
  assert.match(request, /planViewportImage\(attentionBox, captureCurrentViewport\)[\s\S]*?await prepareVisibleWidgetSnapshots\(snapshotRegion\)/);
  assert.match(request, /packed = captureCurrentViewport \|\| attentionBox[\s\S]*?\? buildViewportImage\(state\.hotspotTrail\.slice\(0, hotspotCount\), attentionBox, captureCurrentViewport, capturePlan\)/);
  assert.ok(request.indexOf("await prepareVisibleWidgetSnapshots(") < request.indexOf("buildViewportImage("), "visible iframe snapshots must be prepared before the AI atlas is built");
  assert.equal((request.match(/buildViewportImage\(/g) || []).length, 1, "all viewport requests must use the same capture entry point");
  assert.match(request, /if \(!packed\) \{[\s\S]*?packed = emergencyViewportImage\(/);
  assert.match(functionSource(app, "planViewportImage"), /sourceRect = \{ x: left, y: top, w: right - left, h: bottom - top \}[\s\S]*?return \{ visible, captureRect, sourceRect, imageScale, imageSize, latestVisible \}/);
  assert.match(plan, /if \(!useFullViewport && !ink\) return null/);
  assert.match(plan, /left = useFullViewport \? captureRect\.x/);
  assert.match(plan, /right = useFullViewport \? captureRect\.x \+ captureRect\.w/);
  assert.match(plan, /latestVisible = latestBox \? intersection\(latestBox, sourceRect\) \|\| \{ \.\.\.sourceRect \}/);
  assert.match(build, /globalAlpha = 0\.42[\s\S]*?drawWidgetsToContext\(q, sourceRect\)[\s\S]*?drawWidgetsToContext\(q, latestVisible\)/);
  assert.ok(build.indexOf("drawWidgetsToContext(q, sourceRect)") < build.indexOf("drawImagesToContext(q, sourceRect)"));
  assert.match(build, /scope: captureCurrentViewport \? "current-viewport" : "visible-content"/);
  assert.match(request, /typedInput = !isolatedSelection[\s\S]*?containsRect\(packed\?\.sourceRect, state\.latestTypedInput\.box\)/);
  assert.match(request, /state\.dirty = null;[\s\S]*?state\.hotspotTrail\.splice\(0, hotspotCount\);[\s\S]*?state\.latestTypedInput = null/);
  assert.match(request, /state\.userRevision !== revision[\s\S]*?!run\.inputConsumed[\s\S]*?restoreDirty\(dirtySnapshot\)/);
  assert.match(automatic, /if \(state\.mode === "hand" \|\| !state\.auto \|\| !state\.dirty \|\| !state\.autoEligible \|\| state\.drawing \|\| state\.widgetRefineConfirmation\) return/);
  assert.match(automatic, /requestAI\("auto"\)/);
  assert.doesNotMatch(automatic, /captureCurrentViewport/);
  assert.match(selection, /requestAI\(action, packed, \{ isolatedSelection: true, selection, selectionRequestToken: token \}\)/);
  assert.doesNotMatch(selection, /captureCurrentViewport/);
});

test("the retained focus inset implementation is inactive", () => {
  const app = read("public/app.js");
  assert.match(app, /FOCUS_INSET_ENABLED = false/);
  assert.match(app, /FOCUS_INSET_ENABLED \? drawFocusInset\(out, latestVisible, sourceRect, imageScale, captureTime\) : null/);
  assert.match(app, /function drawFocusInset\(out, latestBox, sourceRect, mainScale, captureTime = performance\.now\(\)\)/);
});

test("normalize sends the lasso bounding rectangle on a blank background", () => {
  const app = read("public/app.js"), source = functionSource(app, "buildSelectionImage");
  assert.match(source, /const sourceRect = \{\s*\.\.\.selection\.box\s*\}/);
  assert.doesNotMatch(source, /const padding|content\.x - padding|content\.y - padding/);
  assert.match(source, /q\.fillStyle = "#fff"/);
  assert.match(source, /for \(const fragment of selection\.fragments\)/);
  assert.match(source, /changedBox: \{ \.\.\.sourceRect \}/);
});

test("normalize preserves literal text, formulas, and function plots without inspecting their content", () => {
  const request = functionSource(read("public/app.js"), "requestAI"),
    filter = request.match(/if \(action === "normalize"\)[\s\S]*?debug\("ai-response"/)?.[0] || "";
  assert.match(filter, /\["write_text", "draw_formula", "plot_function"\]\.includes\(commands\[index\]\.tool\)/);
  assert.doesNotMatch(filter, /commands\[index\]\.(?:text|latex|expression)|observedText/);
});

test("selection AI tracks its action while Typeset remains available", () => {
  const app = read("public/app.js"),
    mode = functionSource(app, "setCanvasMode"),
    pointer = functionSource(app, "handleSelectionPointerDown"),
    complete = functionSource(app, "completeNewCanvas"),
    selectionRequest = functionSource(app, "requestSelectionAI"),
    toolbar = functionSource(app, "updateSelectionToolbar"),
    release = functionSource(app, "releaseSelectionAITransformLock"),
    isTypesetting = vm.runInNewContext(`(${functionSource(app, "selectionIsTypesetting")})`, { selectionAIRequest: (selection) => selection?.aiRequest || null });
  assert.equal(isTypesetting({ aiRequest: { action: "continue" } }), false);
  assert.equal(isTypesetting({ aiRequest: { action: "normalize" } }), true);
  assert.match(selectionRequest, /selection\.aiRequest = \{ token, action \}/);
  assert.match(selectionRequest, /selectionRequestToken: token/);
  assert.match(selectionRequest, /selection\.aiRequest\?\.token === token/);
  assert.match(toolbar, /selectionTypesetButton\.disabled = false/);
  assert.match(toolbar, /isTypesetting \? "selectionTypesetting" : "selectionTypeset"/);
  assert.match(release, /selection\.aiRequest\?\.token !== token/);
  assert.match(mode, /selectionAIBusy\(state\.selection\)/);
  assert.match(mode, /selectionAIStatusKey\(state\.selection\)/);
  assert.match(pointer, /selectionAIBusy\(selection\)/);
  assert.doesNotMatch(app, /selection\.typesetting|selection\?\.typesetting/);
  assert.match(complete, /saved === null/);
  assert.match(complete, /setNewCanvasDialogBusy\(false\)/);
});

test("cancelling after accepting an isolated draft does not restore the old selection tiles", () => {
  const app = read("public/app.js"), cancel = functionSource(app, "cancelSelection"), consume = functionSource(app, "consumePendingInput");
  assert.match(cancel, /selection\.phase === "active" && !selection\.acceptedDraft/);
  assert.match(consume, /p\.selection\.acceptedDraft = true/);
});

test("lasso tool exposes local transform controls in both languages", () => {
  const html = read("public/index.html"), app = read("public/app.js"), zh = read("public/locales/zh.js");
  assert.match(html, /data-mode="select"/);
  assert.ok(html.indexOf('src="selection.js"') < html.indexOf('src="app.js"'));
  for (const key of ["select", "selectionTooSmall", "selectionReady", "selectionCommitted", "selectionCancelled", "selectionRecolored"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
  assert.match(app, /drawDraftActions\(ctx, selection\.box, size\)/);
  assert.match(app, /drawMoveHandle\(ctx, selection\.box, size, true\)/);
  assert.match(app, /drawResizeHandle\(ctx, selection\.box, size\)/);
  assert.match(app, /clippedContext\.clip\("evenodd"\)/);
  assert.match(app, /tileContext\.fill\("evenodd"\)/);
  assert.match(app, /MAX_LASSO_POINTS = 4096/);
});

test("selection edits never schedule or send AI requests", () => {
  const app = read("public/app.js");
  for (const name of ["captureSelection", "commitSelection", "cancelSelection", "applySelectionColor", "updateSelectionGesture"]) {
    const source = functionSource(app, name);
    assert.doesNotMatch(source, /\b(?:schedule|requestAI)\s*\(/, `${name} must stay local`);
  }
  assert.match(functionSource(app, "finishDrawing"), /schedule\(\)/);
  assert.match(functionSource(app, "invokeAIAction"), /requestAI\(action,/);
});

test("manual actions and pen-down use non-blocking latest-request-wins cancellation", () => {
  const app = read("public/app.js"),
    manual = functionSource(app, "invokeAIAction"),
    supersede = functionSource(app, "supersedeActiveAI"),
    request = functionSource(app, "requestAI"),
    guard = functionSource(app, "checkAI");
  assert.ok(manual.indexOf('supersedeActiveAI("manual-action")') < manual.indexOf("requestAI(action,"));
  assert.match(app, /if \(!valid\(p\)\)[\s\S]*?return;\s*}\s*supersedeActiveAI\("user-input-started"\);\s*clearTimeout\(state\.timer\)/);
  assert.match(request, /^function requestAI[\s\S]*?clearWidgetRefineCandidate\(\)/);
  assert.match(request, /automatic = action === "auto"[\s\S]*?if \(!automatic\) \{[\s\S]*?clearTimeout\(state\.timer\)[\s\S]*?state\.timer = 0/);
  assert.match(supersede, /active\.superseded = true;[\s\S]*?active\.controller\.abort\(\)/);
  assert.doesNotMatch(supersede, /discardPendingForNewAI\(\)/);
  assert.match(app, /appendPendingItems\(state\.pending, items, revision, meta, resolve\)/);
  assert.doesNotMatch(request, /if\s*\(state\.busy\)/);
  assert.match(guard, /run\.superseded \|\| state\.activeAI !== run/);
  assert.match(request, /animate\(commands\[0\], revision, meta, run\)/);
  assert.match(request, /preparePendingItem\(c, revision, meta, run\)/);
});

test("the magic orb becomes a device-scoped stop button while an AI request is active", () => {
  const html = read("public/index.html"), app = read("public/app.js"), css = read("public/style.css"), zh = read("public/locales/zh.js"),
    busy = functionSource(app, "setBusy"), stop = functionSource(app, "stopActiveAIRequests"), trigger = functionSource(app, "invokeAIAction"),
    reveal = functionSource(app, "revealAIOrb"), idle = functionSource(app, "scheduleAIOrbIdle"),
    supersede = functionSource(app, "supersedeActiveAI");
  assert.match(html, /id="aiOrb"[\s\S]*?class="ai-stop-icon"/);
  assert.match(html, /id="aiOrb"[^>]*data-i18n-aria="triggerAutoAI"/);
  assert.doesNotMatch(html, /id="aiRadial"|data-ai-action=|id="aiOrb"[^>]*aria-haspopup/);
  assert.match(busy, /classList\.toggle\("working", state\.busy\)[\s\S]*?revealAIOrb\(\)[\s\S]*?updateEmbodimentLabel\(\)/);
  assert.match(stop, /state\.activeAI \|\| aiPreparation[\s\S]*?supersedeActiveAI\("user-stop"\)/);
  assert.match(trigger, /clearTimeout\(state\.timer\)[\s\S]*?requestAI\(action, null, \{ captureCurrentViewport: true \}\)/);
  assert.match(reveal, /clearTimeout\(state\.aiOrbIdleTimer\)[\s\S]*?classList\.remove\("idle-dim"\)/);
  assert.match(idle, /revealAIOrb\(\)[\s\S]*?classList\.add\("idle-dim"\)[\s\S]*?AI_ORB_IDLE_DELAY_MS/);
  assert.match(app, /const AI_ORB_IDLE_DELAY_MS = 5000/);
  assert.match(app, /setNavigating\(true\);\s*scheduleAIOrbIdle\(\);/);
  assert.match(css, /\.ai-embodiment\s*\{[^}]*transition:\s*opacity \.32s ease/);
  assert.match(css, /\.ai-embodiment\.idle-dim:not\(\.working\):not\(:hover\):not\(:focus-within\)[^{]*\{[^}]*opacity:\s*\.36/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\s*\{[^}]*z-index:\s*41;[^}]*top:\s*calc\(var\(--studio-toolbar-height\) \+ 10px\);[^}]*right:\s*calc\(max\(10px, env\(safe-area-inset-right\)\) \+ var\(--studio-agent-edge-shift\)\);[^}]*width:\s*48px;[^}]*height:\s*48px;[^}]*opacity:\s*\.52/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\] \.ai-embodiment\s*\{[^}]*right:\s*calc\(var\(--studio-agent-edge-shift\) - 24px\)/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.idle-dim:not\(\.working\):not\(:hover\):not\(:focus-within\)\s*\{[^}]*opacity:\s*\.52/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment:hover,[\s\S]*?\.ai-embodiment:focus-within\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.working\s*\{[^}]*opacity:\s*1/);
  assert.match(css, /@property --ai-orb-ring-angle\s*\{[^}]*syntax:\s*"<angle>"[^}]*initial-value:\s*0deg/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.working::before\s*\{[^}]*inset:\s*2px;[^}]*conic-gradient\(from var\(--ai-orb-ring-angle\)[^}]*animation:\s*ai-orb-ring-spin 1\.4s linear infinite/);
  assert.match(css, /@keyframes ai-orb-ring-spin\s*\{\s*to\s*\{\s*--ai-orb-ring-angle:\s*360deg/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-orb\s*\{[^}]*inset:\s*4px;[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*box-shadow:\s*0 1px 4px[^}]*transition:\s*transform \.16s ease-out/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-orb::before\s*\{[^}]*display:\s*none/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment:not\(\.working\) \.ai-orb:hover,[\s\S]*?\.ai-orb:focus-visible\s*\{[^}]*border-color:\s*var\(--studio-accent\);[^}]*transform:\s*scale\(1\.04\)/);
  assert.match(css, /body\[data-theme="studio"\] \.ai-embodiment\.working \.ai-orb,[\s\S]*?\.ai-orb:focus-visible\s*\{[^}]*color:\s*#b4232f;[^}]*background:\s*var\(--studio-panel\);[^}]*box-shadow:\s*0 1px 4px/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\] \.ai-embodiment\.working \.ai-orb,[\s\S]*?\.ai-orb:focus-visible\s*\{[^}]*background:\s*#b4232f/);
  assert.match(css, /body\[data-theme="studio"\] \.orb-aura,[^}]*\.orb-runes,[^}]*\.orb-particle\s*\{[^}]*display:\s*none/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.ai-embodiment\.working::before\s*\{[^}]*animation:\s*none/);
  assert.match(app, /aiOrb\.addEventListener\("click"[\s\S]*?if \(state\.busy\)[\s\S]*?stopActiveAIRequests\(\)[\s\S]*?invokeAIAction\("auto"\)/);
  assert.match(css, /\.ai-embodiment\.working \.ai-stop-icon\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.ai-stop-icon\s*\{[^}]*width:\s*11px;[^}]*height:\s*11px;[^}]*border-radius:\s*2px;[^}]*background:\s*currentColor;[^}]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /\.ai-stop-icon::before|\.ai-stop-icon::after|\.ai-stop-icon\s*\{[^}]*background:\s*#fff/);
  assert.match(zh, /triggerAutoAI:\s*"立即运行 Auto AI"/);
  assert.match(zh, /stopAIRequest:\s*"停止当前 AI 请求"/);
  assert.doesNotMatch(`${app}\n${css}`, /radial-action|openRadialMenu|closeRadialMenu|menu-open/);
  assert.doesNotMatch(stop, /fetch\(|\/api\//);
  assert.match(supersede, /reason === "user-stop"[\s\S]*?restoreDirty\(active\.dirtySnapshot\)[\s\S]*?refreshWidgetRefineHoverCandidate\(\)/);
  assert.match(supersede, /const preparation = aiPreparation[\s\S]*?preparation\.controller\.abort\(\)[\s\S]*?phase:"preparing"/);
  assert.match(functionSource(app, "activeWidgetRefinement"), /aiPreparation\?\.widgetEdit \|\| state\.activeAI\?\.widgetEdit/);
});

test("AI drafts move only from the dedicated Hand chrome", () => {
  const app = read("public/app.js"),
    pointerDownStart = app.indexOf('screen.addEventListener("pointerdown"'),
    pointerDownEnd = app.indexOf('screen.addEventListener("pointermove"', pointerDownStart),
    pointerDown = app.slice(pointerDownStart, pointerDownEnd),
    specs = functionSource(app, "pendingChromeSpecs"),
    begin = functionSource(app, "beginObjectChromeMove");
  assert.match(specs, /kind:"move"[\s\S]*?target:"pending"/);
  assert.match(begin, /spec\.target === "pending"[\s\S]*?beginPendingGesture\(event, "move", spec\.itemIndex\)/);
  assert.match(pointerDown, /\["resize", "width", "height", "batch-resize"\]\.includes\(hit\)/);
  assert.doesNotMatch(pointerDown, /beginPendingGesture\(e, "move"/);
});

test("AI write_text validates and rasterizes the same 1000 characters", () => {
  const app = read("public/app.js"),
    validate = functionSource(app, "validate"),
    rasterScaleSource = functionSource(app, "rasterScaleFor"),
    rasterSource = functionSource(app, "textRasterMetrics"),
    imageSource = functionSource(app, "textImage"),
    capture = {},
    raster = vm.runInNewContext(`(${rasterSource})`, {
      AI_TEXT_MAX_LENGTH: 1000,
      SIZE: 20000,
      state: { aiFont: "system-ui" },
      rasterScaleFor: vm.runInNewContext(`(${rasterScaleSource})`),
      offscreen: () => ({ getContext: () => ({}) }),
      layoutText: (content) => {
        capture.content = content;
        return { lines: [content], widths: [content.length] };
      },
    });

  raster("x".repeat(1100), 24);
  assert.equal(capture.content.length, 1000);
  assert.match(app, /AI_TEXT_MAX_LENGTH = 1000/);
  assert.match(validate, /c\.text = c\.text\.slice\(0, AI_TEXT_MAX_LENGTH\)/);
  assert.match(rasterSource, /maxLength = AI_TEXT_MAX_LENGTH/);
  assert.match(imageSource, /maxLength = AI_TEXT_MAX_LENGTH/);
});

test("AI text and formula drafts expose copy and axis-resize controls", () => {
  const app = read("public/app.js"),
    css = read("public/style.css"),
    zh = read("public/locales/zh.js"),
    points = vm.runInNewContext(`(${functionSource(app, "draftActionPoints")})`, { SIZE: 20000 }),
    copyTextForCommand = vm.runInNewContext(`(${functionSource(app, "copyTextForCommand")})`),
    draw = functionSource(app, "drawPending"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    hit = functionSource(app, "pendingHit"),
    start = functionSource(app, "startPending"),
    prepare = functionSource(app, "preparePendingItem"),
    update = functionSource(app, "updatePendingGesture");
  const box = { x: 100, y: 120, w: 300, h: 180 },
    edge = points({ x: 0, y: 0, w: 300, h: 180 }, 14, true, true),
    radius = 14 * 0.54;

  assert.equal(copyTextForCommand({ tool: "write_text", text: "copy me" }), "copy me");
  assert.equal(copyTextForCommand({ tool: "draw_formula", latex: "x^2" }), "x^2");
  assert.equal(copyTextForCommand({ tool: "plot_function", expression: "x^2" }), null);
  assert.deepEqual(Object.keys(points(box, 14, false, true)).sort(), ["accept", "cancel"]);
  assert.deepEqual(Object.keys(points(box, 14, true, true)).sort(), ["accept", "cancel", "copy"]);
  assert.deepEqual(Object.keys(points(box, 14, false)).sort(), ["item-accept", "item-cancel"]);
  assert.deepEqual(Object.keys(points(box, 14, true)).sort(), ["item-accept", "item-cancel", "item-copy"]);
  assert.equal(points(box, 14, true, true).copy.x, box.x + box.w / 2);
  assert.ok(edge.copy.y > 0 && edge.copy.y >= radius);
  assert.ok(Object.values(edge).every((point) => point.x >= radius && point.x <= 20000 - radius));
  assert.match(draw, /if \(p\.textCommand\) drawTextDraftSurface\(ctx, b\)/);
  assert.doesNotMatch(draw, /drawDraftActions/);
  assert.match(draw, /b\.x \+ b\.w \+ s \* 0\.08/);
  assert.match(draw, /b\.y \+ b\.h \+ s \* 0\.08/);
  assert.match(drawBatch, /if \(item\.textCommand\) drawTextDraftSurface\(ctx, box, index === p\.selectedIndex\)/);
  assert.doesNotMatch(drawBatch, /drawDraftActions/);
  assert.match(functionSource(app, "pendingChromeSpecs"), /kind:"move"[\s\S]*?kind:"cancel"[\s\S]*?kind:"accept"[\s\S]*?kind:"copy"/);
  assert.match(functionSource(app, "pendingChromeSpecs"), /copyPendingText\(itemIndex\)/);
  assert.match(hit, /draftActionPoints\(box, s, pendingCopyable\(item\)\)/);
  assert.match(hit, /\.sort\(\(a, b\) => a\.distance - b\.distance \|\| b\.z - a\.z\)/);
  assert.match(start, /copyText = copyTextForCommand\(command\)/);
  assert.match(prepare, /copyText: copyTextForCommand\(c\)/);
  assert.match(update, /p\.scaleX = p\.scaleY = next/);
  assert.match(update, /g\.hit === "width"[\s\S]*?p\.scaleX = Math\.max/);
  assert.match(update, /g\.hit === "height"[\s\S]*?p\.scaleY = Math\.max/);
  assert.match(functionSource(app, "pendingChromeSpecs"), /pendingCopyable\(target\)[\s\S]*?copyPendingText\(itemIndex\)/);
  assert.match(css, /\.clipboard-copy-fallback\s*\{[^}]*left:\s*-10000px/);
  for (const key of ["copyText", "textCopied", "textCopyFailed"]) {
    assert.match(app, new RegExp(`${key}:`));
    assert.match(zh, new RegExp(`${key}:`));
  }
});

test("pending copy is exposed as a direct DOM chrome action", () => {
  const app = read("public/app.js"),
    specs = functionSource(app, "pendingChromeSpecs"),
    button = functionSource(app, "createObjectChromeButton");
  assert.match(specs, /pendingCopyable\(target\)[\s\S]*?kind:"copy"[\s\S]*?copyPendingText\(itemIndex\)/);
  assert.match(button, /kind !== "move"[\s\S]*?button\.penechoSpec\?\.activate\?\.\(button\)/);
  assert.match(functionSource(app, "objectChromeLabel"), /kind === "copy"[\s\S]*?t\("copyText"\)/);
});

test("AI text copy uses the original command with an insecure-context fallback and local feedback", () => {
  const app = read("public/app.js"),
    clipboard = functionSource(app, "writeClipboardText"),
    fallback = functionSource(app, "fallbackCopyText"),
    copy = functionSource(app, "copyPendingText"),
    feedback = functionSource(app, "drawCopyFeedback");

  assert.match(clipboard, /navigator\.clipboard\?\.writeText/);
  assert.match(clipboard, /fallbackCopyText\(text\)/);
  assert.match(fallback, /document\.createElement\("textarea"\)/);
  assert.match(fallback, /field\.value = text/);
  assert.match(fallback, /document\.execCommand\?\.\("copy"\)/);
  assert.match(fallback, /field\.remove\(\)/);
  assert.match(copy, /pendingCopyValue\(target\)/);
  assert.doesNotMatch(copy, /\.message|observedText|textContent|innerText/);
  assert.match(copy, /generation = \+\+state\.copyGeneration/);
  assert.match(copy, /if \(!stillPending\(\)\) return copied/);
  assert.match(copy, /setStatusKey\("copyText"\)/);
  assert.match(copy, /target\.copyFeedbackUntil = performance\.now\(\) \+ COPY_FEEDBACK_MS/);
  assert.match(copy, /setStatusKey\("textCopied"\)/);
  assert.match(copy, /target\.copyFeedbackGeneration !== generation/);
  assert.match(feedback, /label = t\("textCopied"\)/);
});

test("clipboard fallback runs before awaiting a native clipboard attempt", async () => {
  const source = functionSource(read("public/app.js"), "writeClipboardText");
  function harness({ fallbackResult, nativePromise }) {
    const calls = [],
      context = {
        debug: () => calls.push("debug"),
        document: { hasFocus: () => true },
        fallbackCopyText: () => {
          calls.push("fallback");
          return fallbackResult;
        },
        navigator: {
          clipboard: {
            writeText: () => {
              calls.push("native");
              return nativePromise;
            },
          },
        },
        window: { isSecureContext: true },
      };
    return { calls, copy: vm.runInNewContext(`(async ${source})`, context) };
  }

  const synchronousFallback = harness({ fallbackResult: true, nativePromise: Promise.resolve() }),
    fallbackResult = synchronousFallback.copy("copy me");
  assert.deepEqual(synchronousFallback.calls, ["fallback"]);
  assert.equal(await fallbackResult, true);

  let resolveNative;
  const acceptedNative = new Promise((resolve) => {
      resolveNative = resolve;
    }),
    secureNative = harness({ fallbackResult: false, nativePromise: acceptedNative }),
    nativeResult = secureNative.copy("copy me");
  assert.deepEqual(secureNative.calls, ["fallback", "native"]);
  resolveNative();
  assert.equal(await nativeResult, true);

  let rejectNative;
  const rejectedNative = new Promise((_, reject) => {
      rejectNative = reject;
    }),
    failed = harness({ fallbackResult: false, nativePromise: rejectedNative }),
    failedResult = failed.copy("copy me");
  assert.deepEqual(failed.calls, ["fallback", "native"]);
  rejectNative(Error("permission denied"));
  assert.equal(await failedResult, false);
  assert.deepEqual(failed.calls, ["fallback", "native", "debug"]);
});

test("AI text copy ignores stale clipboard completions and stale feedback timers", async () => {
  const source = functionSource(read("public/app.js"), "copyPendingText");
  function harness(writeClipboardText) {
    const pending = { copyText: "copy me" },
      state = { pending, copyGeneration: 0, statusKey: "draftReady" },
      statuses = [],
      timers = [];
    return {
      pending,
      state,
      statuses,
      timers,
      copy: vm.runInNewContext(`(async ${source})`, {
        COPY_FEEDBACK_MS: 1600,
        performance: { now: () => 0 },
        pendingTextTarget: (value) => value,
        pendingCopyValue: (value) => value?.copyText,
        requestRender: () => {},
        setStatusKey: (key) => {
          state.statusKey = key;
          statuses.push(key);
        },
        setTimeout: (callback) => {
          timers.push(callback);
        },
        state,
        writeClipboardText,
      }),
    };
  }

  let finishStaleCopy;
  const stale = harness(() => new Promise((resolve) => {
    finishStaleCopy = resolve;
  }));
  const staleResult = stale.copy();
  stale.state.pending = null;
  stale.state.statusKey = "merged";
  finishStaleCopy(true);
  assert.equal(await staleResult, true);
  assert.deepEqual(stale.statuses, ["copyText"]);
  assert.equal(stale.state.statusKey, "merged");
  assert.equal(stale.timers.length, 0);

  const current = harness(async () => true);
  await current.copy();
  const firstTimer = current.timers[0];
  await current.copy();
  const statusesBeforeOldTimer = current.statuses.slice();
  firstTimer();
  assert.deepEqual(current.statuses, statusesBeforeOldTimer);
  assert.equal(current.pending.copyFeedbackGeneration, 2);
});

test("batch drafts paint every body before selected feedback", () => {
  const source = functionSource(read("public/app.js"), "drawPendingBatch"),
    events = [],
    context = {
      beginPath() {},
      clip() {},
      drawImage(image) {
        events.push(`body:${image.id}`);
      },
      lineTo() {},
      moveTo() {},
      rect() {},
      restore() {},
      save() {},
      setLineDash() {},
      stroke() {},
      strokeRect() {
        events.push("frame");
      },
    },
    draw = vm.runInNewContext(`(${source})`, {
      batchBounds: () => ({ x: 0, y: 0, w: 300, h: 180 }),
      ctx: context,
      drawCopyFeedback: (_ctx, box) => events.push(`feedback:${box.id}`),
      drawResizeHandle: () => {},
      drawTextDraftSurface: (_ctx, box) => events.push(`surface:${box.id}`),
      pendingItemBounds: (item) => item.box,
      pendingCopyable: (item) => Boolean(item.textCommand),
      state: { scale: 1 },
    }),
    pending = {
      selectedIndex: 0,
      items: [
        { box: { id: 0, x: 0, y: 0, w: 180, h: 120 }, image: { id: 0, width: 180, height: 120 }, scaleX: 1, scaleY: 1, textCommand: { text: "first" } },
        { box: { id: 1, x: 60, y: 30, w: 180, h: 120 }, image: { id: 1, width: 180, height: 120 }, scaleX: 1, scaleY: 1, textCommand: { text: "second" } },
      ],
    };

  draw(pending);
  const firstFeedback = Math.min(events.indexOf("feedback:0"), events.indexOf("feedback:1")),
    lastBody = Math.max(events.indexOf("body:0"), events.indexOf("body:1"));
  assert.ok(firstFeedback > lastBody);
  assert.ok(events.indexOf("feedback:1") < events.indexOf("feedback:0"));
});

test("batch draft action controls provide a 44px touch target", () => {
  const app = read("public/app.js"),
    points = vm.runInNewContext(`(${functionSource(app, "draftActionPoints")})`, { SIZE: 20000 }),
    hit = vm.runInNewContext(`(${functionSource(app, "pendingHit")})`, {
      clientPoint: (event) => event,
      draftActionPoints: points,
      draftBounds: (pending) => pending.box,
      pendingItemBounds: (item) => item.box,
      pendingCopyable: (item) => Boolean(item.copyText || item.textCommand?.text),
      state: { scale: 1 },
    }),
    box = { x: 100, y: 120, w: 300, h: 180 },
    pending = { box, selectedIndex: 0, items: [{ box, textCommand: { text: "copy" } }] },
    copy = points(box, 14, true)["item-copy"];

  assert.deepEqual({ ...hit(pending, { x: copy.x + 20, y: copy.y, pointerType: "touch" }) }, { hit: "item-copy", itemIndex: 0 });
  assert.equal(hit(pending, { x: copy.x + 20, y: copy.y, pointerType: "mouse" }), null);
});

test("a multi-tool AI draft has one uniform group corner resize", () => {
  const app = read("public/app.js"),
    drawBatch = functionSource(app, "drawPendingBatch"),
    hit = functionSource(app, "pendingHit"),
    resize = vm.runInNewContext(`(${functionSource(app, "resizePendingBatchItems")})`, { SELECT: selectionMath }),
    items = [
      { x: 100, y: 100, scaleX: 1, scaleY: 1 },
      { x: 300, y: 200, scaleX: 0.5, scaleY: 2 },
    ],
    starts = items.map((item) => ({ ...item })),
    startBox = { x: 100, y: 100, w: 300, h: 300 };

  assert.match(drawBatch, /drawResizeHandle\(ctx, batch, s\)/);
  assert.match(hit, /addControl\("batch-resize",\s*\{ x: b\.x \+ b\.w, y: b\.y \+ b\.h \}/);
  const target = resize(items, startBox, starts, { x: 700, y: 700 }, 40, 1000);
  assert.deepEqual({ ...target }, { x: 100, y: 100, w: 600, h: 600 });
  assert.deepEqual(items.map((item) => ({ ...item })), [
    { x: 100, y: 100, scaleX: 2, scaleY: 2 },
    { x: 500, y: 300, scaleX: 1, scaleY: 4 },
  ]);
  const bounded = resize(items, target, items.map((item) => ({ ...item })), { x: 5000, y: 5000 }, 40, 800);
  assert.ok(bounded.x + bounded.w <= 800 && bounded.y + bounded.h <= 800);
});

test("PenEcho Agent internet search is configured in Settings and toggled beside attachments", () => {
  const html=read("public/index.html"),app=read("public/app.js"),server=read("src/server/main.js"),runtime=read("src/server/canvas-agent/runtime.mjs"),css=read("public/style.css"),zh=read("public/locales/zh.js");
  for(const id of ["settingsOpenSearch","settingsSearchEntryStatus","settingsDeepSeekSearchProvider","settingsOpenCodeGoSearchSetup","settingsDeepSeekSearchApiKey","settingsDeepSeekSearchSaved","settingsTavilyApiKey","settingsTavilySaved","settingsDuckDuckGoReady","settingsSearchTestResults","settingsSearchTestFlashLabel","settingsTestSearch","canvasAgentSearch"]) assert.match(html,new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('id="canvasAgentAttach"')<html.indexOf('id="canvasAgentSearch"'));
  assert.ok(html.indexOf('id="canvasAgentSearch"')<html.indexOf('id="canvasAgentFileInput"'));
  assert.match(app,/settingsOpenSearch\?\.addEventListener\("click", \(\) => openConfiguration\("search"\)\)/);
  assert.match(app,/canvasAgentSearch\.setAttribute\("aria-disabled",String\(!canvasAgent\.searchConfigured\)\)/);
  assert.match(app,/canvasAgentSearch\.dataset\.tooltip = canvasAgent\.searchConfigured \? "" : label/);
  assert.match(app,/localStorage\.getItem\(CANVAS_AGENT_SEARCH_ENABLED_KEY\) !== "false"/);
  assert.match(app,/settingsTestSearch\?\.addEventListener\("click", \(\) => void testCanvasSearch\(\)\)/);
  assert.match(app,/fetch\("\/api\/settings\/search\/test"/);
  assert.ok(html.indexOf('id="settingsSearchTestResults"')<html.indexOf('id="settingsTestSearch"'));
  assert.ok(html.indexOf('id="settingsTestSearch"')<html.indexOf('id="settingsSave"'));
  assert.match(app,/webSearchEnabled:canvasAgent\.searchEnabled/);
  assert.match(server,/deepSeekSearchProvider:DEEPSEEK_SEARCH_PROVIDER/);
  assert.match(server,/hasDeepSeekSearchApiKey:Boolean\(DEEPSEEK_SEARCH_API_KEY\)/);
  assert.match(server,/hasTavilyApiKey:Boolean\(TAVILY_API_KEY\)/);
  assert.match(server,/url\.pathname === "\/api\/settings\/search\/test"/);
  assert.match(server,/deepseekApiKey:DEEPSEEK_SEARCH_API_KEY\|\|""/);
  assert.match(server,/tavilyApiKey:TAVILY_API_KEY\|\|""/);
  assert.match(runtime,/name:'deepseek_search'/);
  assert.match(runtime,/model:DEEPSEEK_SEARCH_MODEL/);
  assert.match(runtime,/type:'web_search_20250305'/);
  assert.match(runtime,/endpoint:'https:\/\/opencode\.ai\/zen\/go\/v1\/messages'/);
  assert.match(runtime,/name:'tavily_search'/);
  assert.doesNotMatch(runtime,/name:'load_search_skill'/);
  assert.match(runtime,/name:'research_search'/);
  assert.match(runtime,/name:'github_repository_search'/);
  assert.match(runtime,/name:'duckduckgo_search'/);
  assert.match(runtime,/name:'stock_symbol_search'/);
  assert.match(runtime,/name:'stock_market_data'/);
  assert.match(runtime,/export async function testCanvasSearchProviders/);
  assert.match(runtime,/include_answer:false, include_raw_content:false, include_images:false/);
  assert.match(css,/\.canvas-agent-composer \.canvas-agent-search\.active \{ color: var\(--studio-accent, #4f46e5\); background: transparent; \}/);
  assert.match(css,/content: attr\(data-tooltip\)/);
  assert.match(css,/\.settings-search-test-results output\[data-state="available"\]/);
  for(const text of ["互联网搜索","Flash 密钥来源","OpenCode Go","中国托管的 DeepSeek 模型","复制 Go API 密钥","Flash 搜索 API 密钥","Tavily API 密钥","DuckDuckGo 后备已就绪","当前搜索状态","测试搜索","尚未测试","未配置","可用 · 已返回结果","内置搜索已就绪","查询股票数据"]) assert.match(zh,new RegExp(text));
});
