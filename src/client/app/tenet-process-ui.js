// Local assignment-preview controls. Server policy and LMS receipts are later lanes.
(function installTenetProcessUI() {
  "use strict";
  if (window.PENECHO_CONFIG?.tenetMode !== true) return;
  const standalone = window.PENECHO_CONFIG?.tenetHistoryViewerOnly === true;
  const journal = !standalone && window.PENECHO_CONFIG?.tenetAssignmentPreview === true ? window.TenetProcessJournal : null;
  const viewerOnly = !journal;
  const capture = () => viewerOnly ? null : window.TenetProcessCapture;
  const documents = () => standalone ? null : window.TenetDocumentHistory;
  let selected = null, events = [], assetSource = journal, imported = false, sample = false;
  let savedPageId = null, historyAvailable = true, savedListEpoch = 0;
  let portableFile = false, finalPage = null, submissionMeta = null, showingFinalPage = false;
  let shareOwner = 0, reportOwner = 0, sharingWork = false, openingReport = false, pendingShareOpen = null;
  let exportFile = null, imageUrl = null, generation = 0, playing = false, playTimer = null;
  let sessionEpoch = 0, selectionEpoch = 0, playbackEpoch = 0, busyOwner = 0;
  // Retain only a few decoded checkpoints, never an entire assignment's images.
  const MAX_FRAME_ENTRIES = 3, MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_FRAME_PIXELS = 8 * 1024 * 1024, MAX_CACHE_PIXELS = 16 * 1024 * 1024;
  const MAX_CACHE_BYTES = 16 * 1024 * 1024, AI_LIST_PAGE_SIZE = 20;
  const frameCache = new Map();
  let cacheEpoch = 0, cacheBytes = 0, cachePixels = 0;
  let displayedFrameKey = null, requestedFrameKey = null, desiredFrameKeys = new Set();
  let indexedEvents = null, frames = [], frameAtEvent = [], nextFrameAt = [], previousFrameAt = [];
  let eventTimes = [], eventPositions = [], eventGroups = [], precedingGroups = [];
  let requestGroups = [], activityBins = [], timeBased = false, currentIndex = 0;
  let moments = [], momentAtEvent = [];
  let playbackSpeed = 1, skipLongPauses = true, aiFilter = null, aiListPage = 0, inspectedGroup = null;
  let inputEpoch = 0, inputUrl = null, inputDecoder = null, cancelInputDecode = null;
  const control = document.createElement("button");
  control.type = "button"; control.className = "tenet-process-launch";
  control.setAttribute("aria-haspopup", "dialog");
  control.setAttribute("aria-label", "Teacher view: saved whiteboard history");
  control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 8 10-5 10 5-10 5-10-5Zm4 3v6c4 3 8 3 12 0v-6M22 8v9"/></svg><span>Teacher view</span>';
  // One same-document modal preserves scratch work and obeys frame-ancestors.
  const dialog = document.createElement("dialog");
  dialog.className = "tenet-process-dialog";
  dialog.id = "tenetProcessDialog";
  dialog.setAttribute("aria-labelledby", "tenetProcessTitle");
  control.setAttribute("aria-controls", dialog.id);
  dialog.innerHTML = `
    <header class="tenet-process-heading"><div><small>TENET / TEACHER VIEW</small><h2 id="tenetProcessTitle">The work behind the answer.</h2></div><button type="button" data-action="close" aria-label="Close teacher view">Back to canvas</button></header>
    <p class="tenet-process-disclosure">On-device Teacher view, not an authenticated teacher or LMS service. Select a saved whiteboard to inspect the actions, checkpoints and AI interactions saved with it. This viewer never loads the page onto your canvas, starts recording, uploads work or calls AI. District AI rules still apply to normal canvas requests.</p>
    <p class="tenet-process-status" role="status" aria-live="polite">Choose a saved whiteboard to see its actual work history.</p>
    <div class="tenet-process-layout">
      <aside class="tenet-process-sidebar">
        <section class="tenet-process-saved"><div class="tenet-process-saved-heading"><h3>Saved whiteboards</h3><button type="button" data-action="refresh-pages">Refresh</button></div><p class="tenet-process-saved-caption">History travels with the saved page. Older pages may not have recorded history.</p><nav class="tenet-process-saved-pages" aria-label="Saved whiteboards"></nav></section>
        <section class="tenet-process-file-tools" aria-label="Open shared work"><button type="button" data-action="open">Open shared work</button><p>Choose a portable .tenet file or a legacy history archive from your device. Files are read here, not uploaded.</p><input data-file="archive" type="file" accept=".tenet,.json,.tenet-work,application/json" hidden /></section>
        <details class="tenet-process-examples"><summary>Explore a synthetic example</summary>
        <div class="tenet-process-demo"><small>START HERE</small><h3>A hint, then a next step.</h3><p>Follow a fictional algebra example. No student data and no AI request.</p><button type="button" data-action="sample" class="tenet-process-primary">Play a sample assignment</button></div>
        </details>
        <details class="tenet-process-record-options"><summary>Record my current page</summary><form data-form="start"><h3>Opt-in local capture</h3>
          <label>Assignment title<input name="title" required maxlength="80" placeholder="Problem set: linear equations" autocomplete="off" /></label>
          <label>Subject<input name="subject" maxlength="80" placeholder="Math" autocomplete="off" /></label>
          <label class="tenet-process-consent"><input name="consent" type="checkbox" required /><span>Record this page's edits, checkpoints and observed AI activity locally. Use synthetic work in this preview; this browser profile is not separated by school account.</span></label>
          <button type="submit" class="tenet-process-primary">Start capture on this page</button>
        </form></details>
        <div class="tenet-process-library-heading"><h3>Advanced captures</h3><button type="button" data-action="refresh">Refresh</button></div>
        <nav class="tenet-process-list" aria-label="Recorded assignments"></nav>
      </aside>
      <section class="tenet-process-work" aria-label="Assignment history viewer">
        <div class="tenet-process-empty"><span>SAVED WHITEBOARD HISTORY</span><h3>Choose the work you want to understand.</h3><p>Select a saved whiteboard to review its actual recorded edits and AI help. No manual recording or archive export is required. Missing history is never reconstructed.</p></div>
        <div class="tenet-process-record" hidden>
          <div class="tenet-process-record-heading"><div><h3 data-value="title"></h3><p data-value="meta"></p></div><span class="tenet-process-badge" data-value="badge"></span></div>
          <p class="tenet-process-coverage" data-value="coverage"></p>
          <div class="tenet-process-metrics" aria-label="Observed history summary"><div><strong data-value="checkpoints">0</strong><span>Page checkpoints</span></div><button type="button" data-action="ai-summary" aria-expanded="false" aria-controls="tenetProcessAIRequests"><strong data-value="requests">0</strong><span>AI interactions / Open summary</span></button><div><strong data-value="gaps">0</strong><span>Coverage gaps</span></div></div>
          <section class="tenet-process-portable" aria-label="Share work and report"><div class="tenet-process-portable-actions"><button type="button" data-action="share-work" class="tenet-process-share-work">Share work (.tenet)</button><button type="button" data-action="report">Open report / PDF</button><button type="button" data-action="final-page" hidden>Show saved final page</button></div><p data-value="sharing-note" class="tenet-process-sharing-note"></p></section>
          <div class="tenet-process-actions">
            <button type="button" data-action="checkpoint">Capture checkpoint</button>
            <button type="button" data-action="pause">Pause recording</button>
            <button type="button" data-action="recover">Recover interrupted capture</button>
            <button type="button" data-action="freeze">Freeze & prepare export</button>
            <button type="button" data-action="download" hidden>Save archive</button>
            <button type="button" data-action="share" hidden>Share archive</button>
            <button type="button" data-action="remove" class="tenet-process-danger">Remove local history</button>
          </div>
          <div class="tenet-process-preview"><img alt="Recorded page checkpoint" hidden /><p data-value="preview">No rendered checkpoint selected.</p></div>
          <p class="tenet-process-frame-time" data-value="frame-time">Displayed checkpoint: none.</p>
          <div class="tenet-process-playback"><button type="button" data-action="play">Play history</button><input type="range" min="0" max="0" value="0" aria-label="History position" /><output data-value="position">0 / 0</output></div>
          <div class="tenet-process-pacing"><label>Playback speed<select data-control="speed" aria-label="Playback speed"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option><option value="4">4x</option><option value="8">8x</option></select></label><label class="tenet-process-skip"><input type="checkbox" data-control="skip-pauses" checked />Skip long pauses</label></div>
          <p class="tenet-process-caption" data-value="pacing">Recorded-time pacing. Pauses longer than 10 seconds can be shortened to 1 second before speed adjustment.</p>
          <p class="tenet-process-caption" data-value="checkpoint-caption">Checkpoint replay, not a recording of every pen movement. The image is the nearest recorded checkpoint at or before the selected event.</p>
          <section class="tenet-process-activity" aria-label="Observed work activity"><div class="tenet-process-activity-heading"><h3>Work activity</h3><span>Edits, revisions and AI requests</span></div><p class="tenet-process-caption" data-value="activity-note"></p><div class="tenet-process-graph" tabindex="0" aria-label="Scrollable activity graph"></div><p class="tenet-process-legend"><span class="tenet-process-web-key">Canvas edits</span><span class="tenet-process-native-key">PencilKit revisions</span><span class="tenet-process-ai-key">Purple stars: AI requests</span></p><p class="tenet-process-caption" data-value="selected-time"></p></section>
          <section class="tenet-process-ai-summary" id="tenetProcessAIRequests" aria-label="Recorded AI interactions" hidden><header><div><small>RECORDED AI INTERACTIONS</small><h3>What was asked. What came back.</h3></div><button type="button" data-action="hide-ai-summary">Hide AI summary</button></header><p class="tenet-process-caption">This panel shows the complete recorded interaction, including replies and inputs appended later than the selected request. It is not limited to the replay cursor. Observation is not proof of receipt, acceptance or use.</p><div class="tenet-process-ai-layout"><div><p data-value="ai-list-note" class="tenet-process-caption"></p><nav class="tenet-process-ai-requests" aria-label="AI request summary"></nav><div class="tenet-process-ai-pagination"><button type="button" data-action="ai-previous">Previous requests</button><button type="button" data-action="ai-next">Next requests</button></div></div><section class="tenet-process-ai-inspector" aria-label="Complete recorded AI interaction"><h4 data-value="ai-title"></h4><p data-value="ai-origin"></p><p data-value="ai-lifecycle"></p><h4>Recorded question</h4><p data-value="ai-question"></p><h4>Recorded replies</h4><pre data-value="ai-replies"></pre><details><summary>Recorded request context</summary><pre data-value="ai-context"></pre></details><h4>Recorded client inputs</h4><p class="tenet-process-caption">These inputs, when available, were prepared by the client for Whiteboard. They are not the final Gateway or provider prompt, district policy, or a server receipt. No microphone audio is included.</p><div class="tenet-process-input-records"></div><p data-value="input-status" role="status"></p><img class="tenet-process-input-image" alt="Recorded image prepared for an AI request, not a page replay checkpoint" hidden /><pre data-value="input-body" hidden></pre><a data-value="input-download" download hidden>Save this recorded input</a></section></div></section>
          <div class="tenet-process-detail"><div><h3>Work timeline</h3><p class="tenet-process-caption" data-value="timeline-note"></p><nav class="tenet-process-events" aria-label="Recorded events"></nav></div><section class="tenet-process-observation" aria-label="AI help and process evidence"><small data-value="event-label"></small><h3 data-value="event-title"></h3><p data-value="event-description"></p><div class="tenet-process-conversation" hidden><h4>Question observed</h4><p data-value="question"></p><h4>Tenet reply observed</h4><p data-value="response"></p><p class="tenet-process-caption" data-value="ai-provenance"></p></div><details><summary>Technical event details</summary><pre data-value="detail" aria-label="Event details"></pre></details></section></div>
        </div>
      </section>
    </div><footer class="tenet-process-source">Built on PenEcho. <a href="https://github.com/wearebub/penecho/tree/codex/tenet-ipad" target="_blank" rel="noopener noreferrer">Tenet fork source</a> / <a href="https://github.com/wearebub/penecho/blob/codex/tenet-ipad/LICENSE" target="_blank" rel="noopener noreferrer">AGPL-3.0</a></footer>`;
  if (!document.querySelector("#tenetProcessStyles")) {
    const style = document.createElement("link");
    style.id = "tenetProcessStyles"; style.rel = "stylesheet"; style.href = "./tenet-process.css";
    document.head.append(style);
  }
  document.body.append(dialog);
  const anchor = document.querySelector("#saveCanvasBtn");
  if (anchor) anchor.insertAdjacentElement("afterend", control);
  else { control.className += " tenet-process-launch-floating"; document.body.append(control); }
  const find = action => dialog.querySelector(`[data-action="${action}"]`);
  const value = name => dialog.querySelector(`[data-value="${name}"]`);
  const statusLine = dialog.querySelector(".tenet-process-status"), slider = dialog.querySelector('input[type="range"]');
  const picture = dialog.querySelector(".tenet-process-preview img");
  if (viewerOnly) {
    dialog.querySelector('.tenet-process-record-options').hidden = true;
    dialog.querySelector(".tenet-process-library-heading").hidden = true;
    dialog.querySelector(".tenet-process-list").hidden = true;
  }
  if (standalone) {
    dialog.querySelector(".tenet-process-saved").hidden = true;
    dialog.querySelector(".tenet-process-examples").open = true;
    dialog.querySelector(".tenet-process-heading small").textContent = "TENET WORK HISTORY VIEWER";
    dialog.querySelector(".tenet-process-disclosure").textContent = "Open shared work as a .tenet file or a legacy history archive, or explore the synthetic example. Files may contain private student work, questions, replies and images. This read-only viewer reads files locally and never enumerates saved app whiteboards or makes AI, school-account or upload requests. File integrity is not proof of student identity or independent work.";
    dialog.querySelector(".tenet-process-empty p").textContent = "Open shared work from your device to inspect the saved page and any recorded history. This public viewer cannot list whiteboards saved inside the app. The synthetic example is optional.";
    find("close").textContent = "Close";
    statusLine.textContent = "Open a shared .tenet file or legacy archive from your device. Nothing is uploaded.";
  }
  function message(text, error = false) {
    statusLine.textContent = text; statusLine.dataset.error = String(error); control.title = text;
  }
  function stopPlaying() {
    playing = false; playbackEpoch++; clearTimeout(playTimer); playTimer = null; find("play").textContent = "Play history";
    for (const [key, entry] of frameCache) if (entry.state === "loading") dropFrame(key);
  }
  function hidePicture() {
    picture.hidden = true; picture.removeAttribute("src");
    imageUrl = null; displayedFrameKey = null;
    dialog.querySelector(".tenet-process-preview").dataset.retained = "false";
    value("frame-time").textContent = "Displayed checkpoint: none.";
  }
  function clearInput() {
    inputEpoch++;
    if (cancelInputDecode) cancelInputDecode();
    cancelInputDecode = null;
    if (inputDecoder) inputDecoder.removeAttribute("src");
    inputDecoder = null;
    const image = dialog.querySelector(".tenet-process-input-image");
    image.hidden = true; image.removeAttribute("src");
    if (inputUrl) URL.revokeObjectURL(inputUrl);
    inputUrl = null;
    value("input-body").textContent = ""; value("input-body").hidden = true;
    value("input-status").textContent = "";
    value("input-download").hidden = true; value("input-download").removeAttribute("href");
  }
  function releaseFrame(entry) {
    if (entry.cancelDecode) entry.cancelDecode();
    entry.cancelDecode = null;
    if (entry.decoder) entry.decoder.removeAttribute("src");
    entry.decoder = null;
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = null;
    cacheBytes -= entry.bytes; cachePixels -= entry.pixels;
    entry.bytes = 0; entry.pixels = 0;
  }
  function dropFrame(key) {
    const entry = frameCache.get(key); if (!entry) return;
    frameCache.delete(key); entry.state = "retired";
    releaseFrame(entry); entry.finish?.(null);
  }
  function clearImage() {
    pendingShareOpen = null;
    shareOwner++; reportOwner++; sharingWork = false; openingReport = false;
    find("share-work").disabled = false; find("report").disabled = false;
    portableFile = false; finalPage = null; submissionMeta = null; showingFinalPage = false;
    value("sharing-note").textContent = "";
    cacheEpoch++; hidePicture(); requestedFrameKey = null; desiredFrameKeys.clear();
    for (const key of frameCache.keys()) dropFrame(key);
    indexedEvents = null; frames = []; frameAtEvent = []; nextFrameAt = []; previousFrameAt = [];
    eventTimes = []; eventPositions = []; eventGroups = []; precedingGroups = [];
    requestGroups = []; activityBins = []; inspectedGroup = null; aiFilter = null; aiListPage = 0;
    moments = []; momentAtEvent = [];
    clearInput();
    dialog.querySelector(".tenet-process-graph").replaceChildren();
    dialog.querySelector(".tenet-process-ai-requests").replaceChildren();
    dialog.querySelector(".tenet-process-input-records").replaceChildren();
    dialog.querySelector(".tenet-process-ai-summary").hidden = true;
    find("ai-summary").setAttribute("aria-expanded", "false");
    for (const name of ["ai-title", "ai-origin", "ai-lifecycle", "ai-question", "ai-replies", "ai-context", "ai-list-note", "activity-note", "selected-time"]) value(name).textContent = "";
  }
  function clearPrepared() {
    exportFile = null; find("download").hidden = true; find("share").hidden = true;
  }
  function clearRecord() {
    selected = null; events = []; assetSource = journal; imported = false; sample = false;
    savedPageId = null; historyAvailable = true;
    clearPrepared(); clearImage();
    for (const name of ["title", "meta", "badge", "coverage", "detail", "question", "response", "ai-provenance", "event-title", "event-description"]) value(name).textContent = "";
    dialog.querySelector(".tenet-process-events").replaceChildren();
    dialog.querySelector(".tenet-process-saved-pages").replaceChildren();
    dialog.querySelector(".tenet-process-list").replaceChildren();
    void paintRecord();
  }
  async function refreshSavedPages(selectCurrent = false) {
    if (standalone) return;
    const session = sessionEpoch, token = ++savedListEpoch, selection = selectionEpoch;
    const list = dialog.querySelector(".tenet-process-saved-pages"), provider = documents();
    list.textContent = "Loading saved whiteboards...";
    if (typeof provider?.listSavedPages !== "function") { list.textContent = "Saved-whiteboard history is unavailable in this build."; message(list.textContent, true); return; }
    try {
      const rows = await provider.listSavedPages();
      const currentId = typeof provider.currentSavedPageId === "function" ? await provider.currentSavedPageId() : null;
      if (session !== sessionEpoch || token !== savedListEpoch || !dialog.open) return;
      if (!Array.isArray(rows)) throw Error("The saved-whiteboard list could not be read.");
      list.replaceChildren();
      for (const row of rows) {
        const button = document.createElement("button"), name = document.createElement("span"), detail = document.createElement("small");
        button.type = "button"; button.dataset.pageId = String(row.id);
        button.setAttribute("aria-current", String(savedPageId !== null && String(savedPageId) === String(row.id)));
        name.textContent = row.name || "Untitled whiteboard";
        detail.textContent = `${row.hasHistory === true ? String(row.eventCount || 0) + " recorded events" : "History unavailable"}${currentId != null && String(currentId) === String(row.id) ? " / Current page" : ""}`;
        button.append(name, detail); button.addEventListener("click", () => void selectSavedPage(row.id)); list.append(button);
      }
      if (!rows.length) list.textContent = "No saved whiteboards yet. Save your canvas to view the history stored with it.";
      if (selectCurrent && selection === selectionEpoch && currentId != null && rows.some(row => String(row.id) === String(currentId))) await selectSavedPage(currentId);
    } catch (error) {
      if (session !== sessionEpoch || token !== savedListEpoch || !dialog.open) return;
      list.textContent = "Saved whiteboards could not be read. Try Refresh.";
      message(error?.message || list.textContent, true);
    }
  }
  async function selectSavedPage(id) {
    const token = ++selectionEpoch, session = sessionEpoch;
    stopPlaying(); generation++; clearPrepared(); clearImage();
    selected = null; events = []; savedPageId = null;
    await paintRecord();
    message("Opening the history saved with this whiteboard...");
    try {
      const provider = documents();
      if (typeof provider?.readSavedPage !== "function") throw Error("Saved-whiteboard history is unavailable in this build.");
      const bundle = await provider.readSavedPage(id);
      if (session !== sessionEpoch || token !== selectionEpoch || !dialog.open) return false;
      if (!bundle?.attempt || !Array.isArray(bundle.events) || typeof bundle.getAsset !== "function") throw Error("This whiteboard's history could not be read.");
      savedPageId = id; historyAvailable = bundle.historyAvailable === true;
      selected = bundle.attempt; events = historyAvailable ? bundle.events : [];
      assetSource = bundle; imported = true; sample = false;
      finalPage = bundle.finalPage || null; submissionMeta = bundle.submission || null;
      showingFinalPage = Boolean(finalPage && !events.length);
      dialog.querySelectorAll(".tenet-process-saved-pages button").forEach(button => button.setAttribute("aria-current", String(button.dataset.pageId === String(id))));
      await paintRecord();
      if (session !== sessionEpoch || token !== selectionEpoch || !dialog.open) return false;
      message(historyAvailable ? "Showing actual history saved with this whiteboard. Your scratch canvas is unchanged." : "No work history was saved for this whiteboard. Earlier actions and AI help cannot be reconstructed.");
      return true;
    } catch (error) {
      if (session === sessionEpoch && token === selectionEpoch && dialog.open) message(error?.message || "This whiteboard's history could not be opened. Your canvas is unchanged.", true);
      return false;
    }
  }
  async function openSavedPage(id) {
    if (!dialog.open) dialog.showModal();
    savedListEpoch++; busyOwner++; dialog.dataset.busy = "false"; dialog.removeAttribute("aria-busy");
    const opened = await selectSavedPage(id);
    if (opened && dialog.open) await refreshSavedPages();
    return opened;
  }
  async function shareSavedPage(id) {
    if (standalone || id === null || id === undefined || sharingWork || pendingShareOpen) return false;
    // Notebook callers close their own overlay first. Open the saved selection
    // here as well as from the history button, so sharing never reports invisibly.
    if (!dialog.open || !selected || savedPageId === null || String(savedPageId) !== String(id)) {
      const opening = openSavedPage(id);
      const pending = {session:sessionEpoch, selection:selectionEpoch};
      pendingShareOpen = pending;
      const currentOpening = () => pendingShareOpen === pending && pending.session === sessionEpoch && pending.selection === selectionEpoch && dialog.open;
      try {
        const opened = await opening;
        if (!opened || !currentOpening()) return false;
      } catch (error) {
        if (currentOpening()) message(error?.message || "The saved whiteboard could not be opened for sharing. Your canvas is unchanged.", true);
        return false;
      } finally {
        if (pendingShareOpen === pending) pendingShareOpen = null;
      }
    }
    if (!dialog.open || !selected || savedPageId === null || String(savedPageId) !== String(id)) return false;
    const owner = ++shareOwner, session = sessionEpoch, selection = selectionEpoch;
    const record = selected;
    const current = () => owner === shareOwner && session === sessionEpoch && selection === selectionEpoch && dialog.open && selected === record && String(savedPageId) === String(id);
    sharingWork = true; find("share-work").disabled = true;
    try {
      if (typeof window.TenetSubmission?.exportSavedPage !== "function") throw Error("Portable work export is not available in this build. Your saved whiteboard is unchanged.");
      if (typeof window.TenetSubmissionShare !== "function") throw Error("Work-file sharing is not available in this build. Your saved whiteboard is unchanged.");
      message("Preparing one .tenet file from the saved whiteboard. Unsaved canvas edits are not included.");
      const result = await window.TenetSubmission.exportSavedPage(id);
      if (!current()) return false;
      if (!(result?.blob instanceof Blob) || !result.blob.size || typeof result.filename !== "string" || !/\.tenet$/i.test(result.filename)) throw Error("The portable exporter did not return a valid work file. Your saved whiteboard is unchanged.");
      await window.TenetSubmissionShare(result.blob, result.filename);
      if (!current()) return false;
      message("Work-file sharing/download was requested. Complete or cancel it in your device's dialog. Only the saved version is included; share it only with intended recipients.");
      return true;
    } catch (error) {
      if (current()) message(error?.name === "AbortError" ? "Sharing cancelled. Your saved work and current canvas are unchanged." : error?.message || "Work sharing did not complete. Your saved work and current selection are retained.", error?.name !== "AbortError");
      return false;
    } finally {
      if (owner === shareOwner) { sharingWork = false; find("share-work").disabled = false; }
    }
  }
  async function showReport() {
    if (!selected || !dialog.open || openingReport) return false;
    const owner = ++reportOwner, session = sessionEpoch, selection = selectionEpoch, record = selected, source = assetSource;
    const current = () => owner === reportOwner && session === sessionEpoch && selection === selectionEpoch && selected === record && source === assetSource && dialog.open;
    const assertCurrent = () => { if (!current()) throw Error("This history view was closed or changed. Reopen the report from the intended work file."); };
    openingReport = true; find("report").disabled = true;
    try {
      if (typeof window.TenetSubmissionReport !== "function") throw Error("The local report/PDF viewer is not available in this build. Your selected work is retained.");
      let reportSource = source;
      const localSavedPage = !standalone && savedPageId !== null;
      if (localSavedPage) {
        if (typeof window.TenetSubmission?.prepareSavedPage !== "function") throw Error("Saved-page report preparation is not available in this build. Update Whiteboard to include the saved page image; your selected work is retained.");
        message("Preparing the selected whiteboard's saved page and history for a local report. Unsaved canvas edits are not included.");
        reportSource = await window.TenetSubmission.prepareSavedPage(savedPageId);
        assertCurrent();
        if (!reportSource?.attempt || typeof reportSource.attempt.id !== "string" || !Array.isArray(reportSource.events) || typeof reportSource.getAsset !== "function") throw Error("The saved-page report could not be prepared. Your work and current selection are unchanged.");
      }
      const reportRecord = localSavedPage ? reportSource.attempt : record;
      const reportHasHistory = localSavedPage ? reportSource.historyAvailable !== false : historyAvailable;
      const assertReportCurrent = () => { assertCurrent(); reportSource?.assertCurrent?.(); };
      const reportCurrent = () => { try { assertReportCurrent(); return true; } catch { return false; } };
      assertReportCurrent();
      const bundle = {
        attempt:reportRecord, events:reportHasHistory ? (localSavedPage ? reportSource.events : events).slice() : [], historyAvailable:reportHasHistory,
        finalPage:localSavedPage ? reportSource.finalPage ?? null : finalPage,
        submission:localSavedPage ? reportSource.submission ?? null : submissionMeta,
        finalPreview:reportSource?.finalPreview instanceof Blob ? reportSource.finalPreview : undefined,
        title:reportSource?.title || reportRecord.title, savedAt:reportSource?.savedAt ?? null,
        synthetic:sample, assertCurrent:assertReportCurrent,
        getAsset:async (attemptId, hash) => {
          assertReportCurrent();
          if (attemptId !== reportRecord.id) throw Error("This attachment does not belong to the selected report.");
          const blob = await reportSource.getAsset(attemptId, hash); assertReportCurrent(); return blob;
        },
      };
      message("Opening a local report of the saved version, not unsaved canvas edits. Use Save PDF report there for an optional PDF; the .tenet file retains the portable work history.");
      await window.TenetSubmissionReport(bundle, {isCurrent:reportCurrent});
      return reportCurrent();
    } catch (error) {
      if (current()) message(error?.message || "The report could not be opened. Your work and selection are unchanged.", true);
      return false;
    } finally {
      if (owner === reportOwner) { openingReport = false; find("report").disabled = false; }
    }
  }
  async function openFile(file) {
    if (!file) return false;
    if (!dialog.open) dialog.showModal();
    const token = ++selectionEpoch, session = sessionEpoch;
    const current = () => token === selectionEpoch && session === sessionEpoch && dialog.open;
    const portable = /\.tenet$/i.test(String(file.name || ""));
    stopPlaying(); generation++;
    // Do not discard the selected page, images or prepared archive before the
    // replacement file is successfully decoded and ownership is still current.
    message(portable ? "Opening the portable work file locally..." : "Opening the legacy history archive locally...");
    try {
      let bundle;
      if (portable) {
        if (typeof window.TenetSubmission?.openFile !== "function") throw Error("Portable .tenet files are not supported in this build. Update the viewer; your current selection is retained.");
        bundle = await window.TenetSubmission.openFile(file);
      } else {
        const archive = window.TenetProcessJournal;
        if (typeof archive?.readArchive !== "function") throw Error("The read-only archive reader is unavailable in this build. Your current selection is retained and recording has not been enabled.");
        bundle = await archive.readArchive(file);
      }
      if (!current()) return false;
      if (!bundle?.attempt || !Array.isArray(bundle.events) || typeof bundle.getAsset !== "function") throw Error("This file did not contain readable work history. Your current selection is retained.");
      clearImage(); clearPrepared();
      selected = bundle.attempt; events = bundle.events; imported = true; sample = false; savedPageId = null;
      portableFile = portable; historyAvailable = portable ? bundle.historyAvailable === true : true;
      finalPage = bundle.finalPage || null; submissionMeta = bundle.submission || null;
      if (!historyAvailable) events = [];
      showingFinalPage = Boolean(finalPage && !events.length);
      assetSource = bundle;
      await paintRecord();
      if (!current()) return false;
      message(portable ? "Portable work opened locally. Nothing was uploaded or loaded onto your canvas. Saved images and recorded history are observations, not verified student identity or authorship." : "Legacy archive opened read-only. Internal consistency checked; identity and independent authorship are not verified.");
      return true;
    } catch (error) {
      if (current()) message(error?.message || "This file could not be opened. Your selected history and current canvas are retained.", true);
      return false;
    }
  }
  function isCheckpointImage(asset, event) {
    return !String(event?.type || "").startsWith("ai.") && !/^ai-input[.\/-]/i.test(String(asset?.name || "")) &&
      ["image/png", "image/jpeg", "image/webp"].includes(asset?.mime) && typeof asset.hash === "string" && asset.hash.length > 0 && asset.hash.length <= 160;
  }
  function checkpointImage(event) { return (event?.assets || []).find(asset => isCheckpointImage(asset, event)); }
  function requestId(event) {
    const id = event?.details?.localRequestId;
    return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
  }
  function originLabel(request) {
    const labels = {"quick-help":"Quick help", "specific-question":"Specific question", "voice-question":"Voice question", automatic:"Automatic request", unknown:"Unknown request type"};
    const origin = request?.details?.origin;
    return typeof origin === "string" && Object.hasOwn(labels, origin) ? labels[origin] : "Request type not recorded (legacy)";
  }
  // Parse dimensions before asking the browser to decode an imported raster.
  // Unknown headers and oversized frames remain readable as events, not images.
  function rasterDimensions(buffer, mime) {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer), length = bytes.length;
    const ascii = (offset, text) => offset + text.length <= length && Array.from(text).every((letter, index) => bytes[offset + index] === letter.charCodeAt(0));
    const little24 = offset => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
    let width = 0, height = 0;
    if (mime === "image/png" && length >= 33 && bytes[0] === 137 && ascii(1, "PNG\r\n\u001a\n") && ascii(12, "IHDR") && view.getUint32(8) === 13) {
      width = view.getUint32(16); height = view.getUint32(20);
    } else if (mime === "image/jpeg" && length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      for (let segments = 0; segments < 1024 && offset + 3 < length; segments++) {
        if (bytes[offset++] !== 255) break;
        while (offset < length && bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 218 || marker === 217 || marker === undefined) break;
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        if (offset + 2 > length) break;
        const size = view.getUint16(offset);
        if (size < 2 || offset + size > length) break;
        if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && size >= 8) {
          height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
        }
        offset += size;
      }
    } else if (mime === "image/webp" && length >= 30 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
      let offset = 12;
      for (let chunks = 0; chunks < 128 && offset + 8 <= length; chunks++) {
        const size = view.getUint32(offset + 4, true), data = offset + 8;
        if (data + size > length) break;
        if (ascii(offset, "VP8X") && size >= 10) {
          if (bytes[data] & 2) throw Error("Animated images are not page checkpoints.");
          width = little24(data + 4) + 1; height = little24(data + 7) + 1; break;
        }
        if (ascii(offset, "VP8 ") && size >= 10 && bytes[data + 3] === 157 && bytes[data + 4] === 1 && bytes[data + 5] === 42) {
          width = view.getUint16(data + 6, true) & 16383; height = view.getUint16(data + 8, true) & 16383; break;
        }
        if (ascii(offset, "VP8L") && size >= 5 && bytes[data] === 47) {
          width = 1 + (bytes[data + 1] | (bytes[data + 2] & 63) << 8);
          height = 1 + (bytes[data + 2] >> 6 | bytes[data + 3] << 2 | (bytes[data + 4] & 15) << 10); break;
        }
        offset = data + size + (size & 1);
      }
    }
    if (!width || !height) throw Error("This recorded image has an unsupported or incomplete raster header.");
    if (width > 4096 || height > 4096 || width * height > MAX_FRAME_PIXELS) throw Error("This recorded image exceeds the viewer's bounded decoding limit (4096 pixels per side, 8 megapixels). Event details remain available.");
    return {width, height, pixels:width * height};
  }
  function predecode(url, pixels) {
    const image = document.createElement("img");
    let complete = false, timer = null, resolveResult;
    const promise = new Promise(resolve => { resolveResult = resolve; });
    function finish(result) {
      if (complete) return;
      complete = true; clearTimeout(timer); image.onload = null; image.onerror = null; resolveResult(result);
    }
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096 || image.naturalWidth * image.naturalHeight > pixels) { finish(false); return; }
      if (typeof image.decode === "function") void image.decode().then(() => finish(true), () => finish(false));
      else finish(true);
    };
    image.onerror = () => finish(false);
    timer = setTimeout(() => finish(false), 12000);
    image.src = url;
    return {image, promise, cancel:() => finish(false)};
  }
  function evictFrame(protectedKey) {
    for (const key of frameCache.keys()) {
      if (key !== displayedFrameKey && key !== requestedFrameKey && key !== protectedKey) { dropFrame(key); return true; }
    }
    return false;
  }
  function loadFrame(frame) {
    let entry = frameCache.get(frame.key);
    if (entry) {
      frameCache.delete(frame.key); frameCache.set(frame.key, entry);
      return entry.promise;
    }
    while (frameCache.size >= MAX_FRAME_ENTRIES) if (!evictFrame(frame.key)) return Promise.resolve(null);
    const scope = {cache:cacheEpoch, session:sessionEpoch, selection:selectionEpoch, playback:playbackEpoch, source:assetSource, record:selected};
    entry = {key:frame.key, state:"loading", bytes:0, pixels:0, url:null, decoder:null, cancelDecode:null, error:null, finish:null, promise:null};
    let timer;
    entry.promise = new Promise(resolve => { entry.finish = result => { clearTimeout(timer); entry.finish = null; resolve(result); }; });
    frameCache.set(frame.key, entry);
    const current = () => entry.state === "loading" && frameCache.get(frame.key) === entry && dialog.open && scope.cache === cacheEpoch && scope.session === sessionEpoch && scope.selection === selectionEpoch && scope.playback === playbackEpoch && scope.source === assetSource && scope.record === selected && desiredFrameKeys.has(frame.key);
    function fail(text) {
      if (!current()) { if (frameCache.get(frame.key) === entry) dropFrame(frame.key); return; }
      entry.state = "failed"; entry.error = text; releaseFrame(entry); entry.finish?.(entry);
    }
    timer = setTimeout(() => fail("This checkpoint took too long to read. The previously displayed frame is retained."), 20000);
    void (async () => {
      try {
        const blob = await scope.source.getAsset(scope.record.id, frame.asset.hash);
        if (!current()) { if (frameCache.get(frame.key) === entry) dropFrame(frame.key); return; }
        if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_IMAGE_BYTES) throw Error("This checkpoint attachment is unavailable or exceeds the 8 MiB image limit.");
        const buffer = await blob.arrayBuffer();
        if (!current()) { if (frameCache.get(frame.key) === entry) dropFrame(frame.key); return; }
        const dimensions = rasterDimensions(buffer, frame.asset.mime);
        while (cacheBytes + blob.size > MAX_CACHE_BYTES || cachePixels + dimensions.pixels > MAX_CACHE_PIXELS) {
          if (!evictFrame(frame.key)) throw Error("The next checkpoint exceeds the available preview image budget.");
        }
        entry.bytes = blob.size; entry.pixels = dimensions.pixels; cacheBytes += entry.bytes; cachePixels += entry.pixels;
        entry.url = URL.createObjectURL(blob);
        const decoder = predecode(entry.url, entry.pixels); entry.decoder = decoder.image; entry.cancelDecode = decoder.cancel;
        const decoded = await decoder.promise;
        if (!current()) { if (frameCache.get(frame.key) === entry) dropFrame(frame.key); return; }
        if (!decoded) throw Error("This recorded checkpoint could not be decoded. Its event details are still readable.");
        entry.state = "ready"; entry.cancelDecode = null; entry.finish?.(entry);
      } catch (error) { fail(error?.message || "This checkpoint could not be read."); }
    })();
    return entry.promise;
  }
  function indexHistory() {
    if (indexedEvents === events) return;
    indexedEvents = events;
    frames = []; frameAtEvent = new Int32Array(events.length); nextFrameAt = []; previousFrameAt = [];
    eventTimes = events.map(eventMillis); eventPositions = new Float64Array(events.length);
    eventGroups = new Int32Array(events.length).fill(-1); precedingGroups = new Int32Array(events.length).fill(-1);
    requestGroups = [];
    const requestById = new Map();
    let latest = -1;
    for (let index = 0; index < events.length; index++) {
      const event = events[index], image = checkpointImage(event);
      if (image) frames.push({eventIndex:index, asset:image, key:image.mime + ":" + image.hash});
      frameAtEvent[index] = frames.length - 1;
      if (event.type === "ai.request") {
        const id = requestId(event), group = {number:requestGroups.length, index, id, responses:[], inputs:[], finished:[], related:[], ambiguous:false};
        latest = group.number; requestGroups.push(group); eventGroups[index] = latest;
        if (id && requestById.has(id)) {
          const previous = requestById.get(id);
          if (previous !== null) requestGroups[previous].ambiguous = true;
          group.ambiguous = true; requestById.set(id, null);
        } else if (id) requestById.set(id, latest);
      }
      precedingGroups[index] = latest;
    }
    // A delayed ai.input can follow the response/finish; join once by identity,
    // never by adjacency or undefined IDs, and never scan the whole log per tick.
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      const field = event.type === "ai.response" ? "responses" : event.type === "ai.input" ? "inputs" : event.type === "ai.finished" ? "finished" : ["page.checkpoint", "canvas.commit", "canvas.undo", "canvas.redo", "native.revision"].includes(event.type) ? "related" : null;
      if (!field) continue;
      const id = requestId(event), groupIndex = id ? requestById.get(id) : undefined;
      if (groupIndex === undefined || groupIndex === null) continue;
      const group = requestGroups[groupIndex];
      if (index <= group.index) continue;
      eventGroups[index] = groupIndex;
      group[field].push(index);
    }
    moments = []; momentAtEvent = new Int32Array(events.length);
    const aiMoment = new Map();
    for (let index = 0; index < events.length; index++) {
      const event = events[index], group = eventGroups[index];
      if (group >= 0) {
        if (!aiMoment.has(group)) {
          aiMoment.set(group, moments.length);
          moments.push({kind:"ai", group, start:index, end:index, index, raw:[index], web:0, native:0, checkpoints:0});
        } else { const moment = moments[aiMoment.get(group)]; moment.raw.push(index); moment.end = index; }
        momentAtEvent[index] = aiMoment.get(group);
        continue;
      }
      const web = ["canvas.commit", "canvas.undo", "canvas.redo"].includes(event.type), native = event.type === "native.revision", checkpoint = Boolean(checkpointImage(event));
      const previous = moments.at(-1), time = eventTimes[index], priorTime = previous ? eventTimes[previous.start] : null;
      const closeInTime = time !== null && priorTime !== null ? time >= priorTime && time - priorTime <= 4000 : previous?.raw.length < 2;
      // Nearby ordinary edits/checkpoints are presentation groups, not inferred
      // stroke ancestry. AI output joins only through a real localRequestId.
      if ((web || native || checkpoint) && previous?.kind === "work" && previous.raw.length < 8 && closeInTime) {
        previous.raw.push(index); previous.end = index; previous.index = index;
        previous.web += Number(web); previous.native += Number(native); previous.checkpoints += Number(checkpoint);
        momentAtEvent[index] = moments.length - 1;
      } else {
        momentAtEvent[index] = moments.length;
        moments.push({kind:web || native || checkpoint ? "work" : "observation", start:index, end:index, index, raw:[index], web:Number(web), native:Number(native), checkpoints:Number(checkpoint)});
      }
    }
    for (let index = 0; index < frames.length; index++) previousFrameAt[index] = index === 0 ? -1 : frames[index - 1].key === frames[index].key ? previousFrameAt[index - 1] : index - 1;
    for (let index = frames.length - 1; index >= 0; index--) nextFrameAt[index] = index === frames.length - 1 ? -1 : frames[index + 1].key === frames[index].key ? nextFrameAt[index + 1] : index + 1;
    timeBased = events.length > 1 && eventTimes.every((time, index) => time !== null && (index === 0 || time >= eventTimes[index - 1])) && eventTimes.at(-1) > eventTimes[0];
    const count = Math.min(12, Math.max(1, events.length));
    activityBins = Array.from({length:count}, () => ({first:-1, last:-1, editIndex:-1, web:0, native:0, gaps:0, groups:[]}));
    for (let index = 0; index < events.length; index++) {
      const position = timeBased ? (eventTimes[index] - eventTimes[0]) / (eventTimes.at(-1) - eventTimes[0]) : index / Math.max(1, events.length - 1);
      eventPositions[index] = position;
      const bin = activityBins[Math.min(count - 1, Math.floor(position * count))], type = events[index].type;
      if (bin.first < 0) bin.first = index;
      bin.last = index;
      if (["canvas.commit", "canvas.undo", "canvas.redo"].includes(type)) { bin.web++; if (bin.editIndex < 0) bin.editIndex = index; }
      if (type === "native.revision") { bin.native++; if (bin.editIndex < 0) bin.editIndex = index; }
      if (type === "coverage.gap") bin.gaps++;
      if (type === "ai.request") bin.groups.push(eventGroups[index]);
    }
  }
  function latestAt(indices, index) {
    let low = 0, high = indices.length;
    while (low < high) { const mid = (low + high) >>> 1; if (indices[mid] <= index) low = mid + 1; else high = mid; }
    return low ? indices[low - 1] : -1;
  }
  function nearestPosition(position) {
    let low = 0, high = eventPositions.length;
    while (low < high) { const mid = (low + high) >>> 1; if (eventPositions[mid] < position) low = mid + 1; else high = mid; }
    return Math.min(Math.max(0, events.length - 1), low);
  }
  function svgElement(name, attributes = {}, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, item] of Object.entries(attributes)) element.setAttribute(key, String(item));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function graphButton(parent, label, action) {
    const button = svgElement("g", {role:"button", tabindex:0, "aria-label":label, class:"tenet-process-graph-button"});
    button.append(svgElement("title", {}, label));
    button.addEventListener("click", action);
    button.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } });
    parent.append(button); return button;
  }
  function paintActivity() {
    const host = dialog.querySelector(".tenet-process-graph"); host.replaceChildren();
    value("activity-note").textContent = `${timeBased ? "Equal device-time bins." : "Recorded-order bins: missing, equal or out-of-order timestamps prevent a reliable time axis."} Bar heights count observed canvas edits and PencilKit revisions, not individual strokes or seconds of proven work. Checkpoints, reloads and coverage gaps are not counted as activity. Tap a bar to seek or a purple star to inspect AI requests; large histories are aggregated.`;
    if (!events.length) { host.textContent = "No recorded activity to display."; return; }
    const svg = svgElement("svg", {viewBox:"0 0 720 170", role:"group", "aria-label":"Observed edits and revisions with AI request markers"});
    const width = 660 / activityBins.length, peak = Math.max(1, ...activityBins.map(bin => bin.web + bin.native));
    svg.append(svgElement("line", {x1:30, y1:126, x2:690, y2:126, class:"tenet-process-graph-axis"}));
    activityBins.forEach((bin, binIndex) => {
      const x = 30 + binIndex * width, middle = x + width / 2;
      const index = bin.editIndex >= 0 ? bin.editIndex : bin.first >= 0 ? bin.first : nearestPosition(binIndex / activityBins.length);
      const label = `Interval ${binIndex + 1}: ${bin.web} canvas edits, ${bin.native} PencilKit revisions, ${bin.gaps} coverage gap observations. Seek to recorded event ${index + 1}.`;
      const button = graphButton(svg, label, () => seekEvent(index));
      button.append(svgElement("rect", {x, y:49, width, height:80, rx:5, class:"tenet-process-bin-hit"}));
      const webHeight = bin.web / peak * 60, nativeHeight = bin.native / peak * 60;
      button.append(svgElement("rect", {x:x + 9, y:125 - webHeight, width:width - 18, height:webHeight, rx:2, class:"tenet-process-web-bar"}));
      button.append(svgElement("rect", {x:x + 9, y:125 - webHeight - nativeHeight, width:width - 18, height:nativeHeight, rx:2, class:"tenet-process-native-bar"}));
      button.append(svgElement("text", {x:middle, y:Math.max(61, 118 - webHeight - nativeHeight), "text-anchor":"middle", class:"tenet-process-bin-count"}, String(bin.web + bin.native)));
      svg.append(svgElement("text", {x:middle, y:146, "text-anchor":"middle", class:"tenet-process-bin-label"}, String(binIndex + 1)));
      if (bin.groups.length) {
        const star = graphButton(svg, `${bin.groups.length} AI request${bin.groups.length === 1 ? "" : "s"} in interval ${binIndex + 1}. Open recorded interactions.`, () => showAISummary(binIndex));
        star.append(svgElement("rect", {x, y:2, width, height:44, rx:7, class:"tenet-process-star-hit"}));
        star.append(svgElement("path", {d:`M ${middle} 8 l 3.8 8 8.8 1.3 -6.3 6.2 1.5 8.8 -7.8 -4.2 -7.8 4.2 1.5 -8.8 -6.3 -6.2 8.8 -1.3 Z`, class:"tenet-process-ai-star"}));
        if (bin.groups.length > 1) star.append(svgElement("text", {x:middle + 15, y:13, class:"tenet-process-star-count"}, String(bin.groups.length)));
      }
    });
    svg.append(svgElement("line", {x1:30, x2:30, y1:47, y2:131, class:"tenet-process-current-marker", "aria-hidden":"true"}));
    svg.append(svgElement("text", {x:30, y:164, class:"tenet-process-axis-label"}, timeBased ? "Earlier device time" : "Earlier recorded events"));
    svg.append(svgElement("text", {x:690, y:164, "text-anchor":"end", class:"tenet-process-axis-label"}, timeBased ? "Later device time" : "Later recorded events"));
    host.append(svg);
  }
  function momentTitle(moment) {
    if (!moment) return "No work moment selected";
    if (moment.kind === "ai") return `AI interaction / ${originLabel(events[requestGroups[moment.group].index])}`;
    if (moment.kind === "work") {
      const changes = [];
      if (moment.web) changes.push(`${moment.web} canvas edit${moment.web === 1 ? "" : "s"}`);
      if (moment.native) changes.push(`${moment.native} PencilKit revision${moment.native === 1 ? "" : "s"}`);
      return changes.length ? "Work updated / " + changes.join(", ") : "Saved page state";
    }
    return String(events[moment.index]?.type || "").startsWith("ai.") ? "Unlinked AI observation" : eventTitle(events[moment.index]);
  }
  function seekMoment(position) {
    const moment = moments[position]; if (!moment) return;
    if (moment.kind === "ai") {
      aiFilter = null; aiListPage = Math.floor(moment.group / AI_LIST_PAGE_SIZE);
      dialog.querySelector(".tenet-process-ai-summary").hidden = false;
      find("ai-summary").setAttribute("aria-expanded", "true");
      paintAIList(); chooseAIRequest(moment.group);
    } else seekEvent(moment.index);
  }
  function updateActivityPosition(index) {
    const marker = dialog.querySelector(".tenet-process-current-marker");
    if (marker) { const x = 30 + (eventPositions[index] || 0) * 660; marker.setAttribute("x1", String(x)); marker.setAttribute("x2", String(x)); }
    const moment = moments[momentAtEvent[index]];
    value("selected-time").textContent = events[index] ? `Work moment ${momentAtEvent[index] + 1}: ${momentTitle(moment)}. Selected observation time: ${recordedEventTime(events[index])}.` : "No selected work moment.";
  }
  function seekEvent(index) {
    if (events.length) showingFinalPage = false;
    stopPlaying(); clearInput();
    const session = sessionEpoch, selection = selectionEpoch;
    void renderEvent(index).catch(error => { if (session === sessionEpoch && selection === selectionEpoch && dialog.open) message(error?.message || "The selected event could not be displayed.", true); });
  }
  function summaryGroups() { return aiFilter === null ? requestGroups.map(group => group.number) : activityBins[aiFilter]?.groups || []; }
  function showAISummary(binIndex = null) {
    if (!selected || !dialog.open) return;
    aiFilter = binIndex;
    const groups = summaryGroups();
    const near = groups.find(number => number === eventGroups[currentIndex]) ?? groups[0];
    aiListPage = Math.max(0, Math.floor(groups.indexOf(near) / AI_LIST_PAGE_SIZE));
    dialog.querySelector(".tenet-process-ai-summary").hidden = false;
    find("ai-summary").setAttribute("aria-expanded", "true");
    paintAIList();
    if (near !== undefined) chooseAIRequest(near);
    else { clearInput(); value("ai-title").textContent = "No AI requests recorded"; value("ai-question").textContent = "Absence of a recorded request is not proof that no AI was used."; }
    dialog.querySelector(".tenet-process-ai-summary").scrollIntoView({block:"nearest"});
  }
  function paintAIList() {
    const groups = summaryGroups(), list = dialog.querySelector(".tenet-process-ai-requests"); list.replaceChildren();
    const lastPage = Math.max(0, Math.ceil(groups.length / AI_LIST_PAGE_SIZE) - 1);
    aiListPage = Math.max(0, Math.min(aiListPage, lastPage));
    const start = aiListPage * AI_LIST_PAGE_SIZE;
    value("ai-list-note").textContent = `${aiFilter === null ? "All recorded requests" : "Requests in activity interval " + (aiFilter + 1)}. ${groups.length ? `${start + 1}-${Math.min(groups.length, start + AI_LIST_PAGE_SIZE)} of ${groups.length}` : "None recorded"}.`;
    for (const number of groups.slice(start, start + AI_LIST_PAGE_SIZE)) {
      const group = requestGroups[number], request = events[group.index], button = document.createElement("button"), title = document.createElement("span"), note = document.createElement("small");
      button.type = "button"; button.dataset.request = String(number); button.setAttribute("aria-current", String(inspectedGroup === number));
      title.textContent = `${number + 1}. ${originLabel(request)}`;
      note.textContent = String(request.details?.question || "No question text recorded; inspect recorded context.").slice(0, 160);
      button.title = `${originLabel(request)} / ${recordedEventTime(request)}`;
      button.append(title, note); button.addEventListener("click", () => chooseAIRequest(number)); list.append(button);
    }
    find("ai-previous").disabled = aiListPage === 0; find("ai-next").disabled = aiListPage >= lastPage;
  }
  function chooseAIRequest(number) {
    const group = requestGroups[number]; if (!group) return;
    inspectedGroup = number; seekEvent(group.index); paintAIInspector(group);
    dialog.querySelectorAll(".tenet-process-ai-requests button").forEach(button => button.setAttribute("aria-current", String(Number(button.dataset.request) === number)));
  }
  function paintAIInspector(group) {
    clearInput();
    const request = events[group.index], details = request.details || {};
    value("ai-title").textContent = `Interaction ${group.number + 1} / complete recorded lifecycle`;
    value("ai-origin").textContent = `${originLabel(request)}. Origin evidence: ${details.originEvidence || "not recorded"}. Requested action: ${details.action || "not recorded"}. Request observed: ${recordedEventTime(request)}.`;
    const finish = group.finished.length ? events[group.finished.at(-1)] : null;
    value("ai-lifecycle").textContent = `${finish ? `Latest finish observation: ${finish.details?.outcome || "outcome not recorded"} at ${recordedEventTime(finish)}.` : "No finished lifecycle event is recorded: the history may be pending or incomplete."} ${group.responses.length} reply observation(s), ${group.inputs.length} client-input record(s), ${group.related.length} explicitly linked page/edit observation(s). ${group.ambiguous ? "Duplicate request identifiers prevent reliable linking; replies and inputs are not guessed." : !group.id ? "Legacy request has no usable linking identifier; replies and inputs cannot be safely associated." : "The full recorded lifecycle is grouped here even when input hashing finished later. Nearby student edits are not attributed to AI without a recorded link."}`;
    value("ai-question").textContent = details.question || "No typed/transcribed question text was recorded. Do not infer the wording from the page image.";
    const replyParts = group.responses.map(index => {
      const event = events[index];
      return `Reply observed ${recordedEventTime(event)}\n${event.details?.text || "Non-text or unavailable reply body; inspect recorded tool/event details and later checkpoints."}${event.details?.textTruncated ? "\n[Capture marked this reply as truncated.]" : ""}\nObserved output is not evidence of student acceptance or canvas placement.`;
    });
    value("ai-replies").textContent = replyParts.join("\n\n") || "No linked reply body was recorded. A finished request alone does not establish what was returned.";
    value("ai-context").textContent = JSON.stringify({action:details.action ?? null, origin:details.origin ?? null, originEvidence:details.originEvidence ?? null, questionSource:details.questionSource ?? null, requestRevision:details.requestRevision ?? null, questionTruncated:details.questionTruncated === true, context:details.context ?? null, boundary:"Local observation, not an attested Gateway/provider prompt or policy"}, null, 2);
    const inputs = dialog.querySelector(".tenet-process-input-records"); inputs.replaceChildren();
    if (!group.inputs.length) {
      const note = document.createElement("p"); note.textContent = "Client request inputs were not recorded in this history (legacy, unavailable or omitted). They cannot be reconstructed from a reply or page checkpoint."; inputs.append(note); return;
    }
    // Controls are bounded even if an imported archive repeats input events.
    for (const index of group.inputs.slice(0, 12)) {
      const event = events[index], data = event.details || {}, block = document.createElement("div"), note = document.createElement("p");
      block.className = "tenet-process-input-record";
      note.textContent = `Input observation: ${recordedEventTime(event)}. Request boundary: ${data.boundary || "not recorded"}. Body: ${data.bodyStatus || "not recorded"}; image: ${data.imageStatus || "not recorded"}. ${data.observation || "Receipt not established."}${Array.isArray(data.omitted) && data.omitted.length ? " Omissions: " + data.omitted.map(String).join("; ") : ""}`;
      block.append(note);
      const metadata = document.createElement("details"), heading = document.createElement("summary"), pre = document.createElement("pre");
      heading.textContent = "Input observation metadata"; pre.textContent = JSON.stringify(data, null, 2); metadata.append(heading, pre); block.append(metadata);
      for (const asset of (event.assets || []).slice(0, 4)) {
        const json = asset.name === "ai-input.json" && asset.mime === "application/json";
        const raster = /^ai-input\.(?:png|jpe?g|webp)$/i.test(String(asset.name || "")) && ["image/png", "image/jpeg", "image/webp"].includes(asset.mime);
        if (!json && !raster) continue;
        const button = document.createElement("button"); button.type = "button";
        button.textContent = json ? "Inspect recorded request JSON" : "View submitted image";
        button.addEventListener("click", () => void openRecordedInput(group, event, asset, json)); block.append(button);
      }
      inputs.append(block);
    }
    if (group.inputs.length > 12) { const note = document.createElement("p"); note.textContent = "The input-control display is limited to the first 12 observations for this request; additional input events remain in the recorded event history."; inputs.append(note); }
  }
  async function openRecordedInput(group, inputEvent, asset, json) {
    clearInput();
    const token = inputEpoch, session = sessionEpoch, selection = selectionEpoch, playback = playbackEpoch, source = assetSource, record = selected;
    // Inspector ownership is independent of checkpoint rendering. Selecting a
    // different request/page, seeking, closing, playback changes or sign-out
    // retires it; a late frame decode cannot adopt this input attachment.
    const current = () => token === inputEpoch && session === sessionEpoch && selection === selectionEpoch && playback === playbackEpoch && source === assetSource && record === selected && inspectedGroup === group.number && dialog.open;
    value("input-status").textContent = "Reading the selected local input attachment...";
    try {
      const blob = await source.getAsset(record.id, asset.hash);
      if (!current()) return;
      if (!(blob instanceof Blob) || !blob.size || blob.size > (json ? 12 * 1024 * 1024 : MAX_IMAGE_BYTES)) throw Error("This input attachment is unavailable or exceeds the local viewer limit.");
      if (json) {
        const text = await blob.text(); if (!current()) return;
        const body = JSON.parse(text);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("The recorded client JSON body is not recognized; no provider prompt is inferred.");
        const preview = JSON.stringify(body, (key, item) => key === "atlasImage" && typeof item === "string" && item.startsWith("data:image/") ? "[Image data hidden in this text preview only. Use View submitted image or save the original JSON.]" : item, 2);
        value("input-body").textContent = preview.length > 131072 ? preview.slice(0, 131072) + "\n[Text preview limited to 128 KiB. Save the recorded JSON for its complete captured contents.]" : preview;
        value("input-body").hidden = false;
      } else {
        const buffer = await blob.arrayBuffer(); if (!current()) return;
        const dimensions = rasterDimensions(buffer, asset.mime);
        inputUrl = URL.createObjectURL(blob);
        const decoder = predecode(inputUrl, dimensions.pixels); inputDecoder = decoder.image; cancelInputDecode = decoder.cancel;
        const decoded = await decoder.promise; if (!current()) return;
        if (!decoded) throw Error("This recorded input image could not be decoded.");
        const image = dialog.querySelector(".tenet-process-input-image"); image.src = inputUrl; image.hidden = false;
      }
      if (!current()) return;
      if (!inputUrl) inputUrl = URL.createObjectURL(blob);
      value("input-download").href = inputUrl; value("input-download").download = asset.name; value("input-download").hidden = false;
      value("input-status").textContent = `Recorded client-to-Whiteboard input. Capture status: ${inputEvent.details?.bodyStatus || "not recorded"}; format: ${inputEvent.details?.bodyFormat || "not recorded"}. ${inputEvent.details?.bodyExact === true ? "Capture marks the body as exact at this client boundary." : "Exact body capture is not established; review omission metadata."} Text-preview image placeholders and display limits do not change the downloadable recorded JSON. This is not a server receipt or the final Gateway/provider prompt. The page replay is unchanged.`;
    } catch (error) {
      if (!current()) return;
      clearInput(); value("input-status").textContent = error?.message || "This recorded input is unavailable.";
    }
  }
  function eventTitle(event) {
    const titles = { "capture.started":"Recording began", "capture.paused":"Recording paused", "canvas.commit":"Canvas edit committed", "canvas.undo":"Edit undone", "canvas.redo":"Edit restored", "native.revision":"PencilKit revision received", "ai.request":"Question sent to Tenet", "ai.response":"Tenet reply observed", "ai.finished":"AI request finished", "coverage.gap":"Coverage gap recorded" };
    if (!event) return "No event selected";
    if (checkpointImage(event)) return event.details?.representation === "saved-page-thumbnail" ? "Saved-page thumbnail" : "Page checkpoint";
    return Object.hasOwn(titles, event.type) ? titles[event.type] : String(event.type).replaceAll(".", " ");
  }
  function paintObservation(event, index) {
    value("event-label").textContent = sample ? "FICTIONAL EXAMPLE" : "LOCAL OBSERVATION";
    value("event-title").textContent = eventTitle(event);
    const data = event?.details || {};
    value("event-description").textContent = event?.type === "coverage.gap" ? String(data.reason || data.note || "Part of the work was not captured. Do not infer what happened during this gap.") : event?.type === "ai.response" ? "A reply was observed before canvas placement. This does not prove the student used or accepted it." : event?.type === "native.revision" ? "One accepted drawing revision was observed. It may contain multiple strokes or edits." : event?.type === "ai.request" ? "This is the locally observed question and scope, not a copy of the exact provider payload." : "Use the timeline to compare recorded page states. Device timestamps and gaps do not establish authorship, effort or outside help.";
    const groupNumber = eventGroups[index] >= 0 ? eventGroups[index] : String(event?.type || "").startsWith("ai.") ? -1 : precedingGroups[index];
    const group = requestGroups[groupNumber], request = group ? events[group.index] : null;
    const interaction = eventGroups[index] >= 0;
    const moment = moments[momentAtEvent[index]];
    value("event-title").textContent = momentTitle(moment);
    if (interaction && group) {
      const finish = group.finished.length ? events[group.finished.at(-1)] : null;
      value("event-description").textContent = `One recorded AI interaction: question, linked reply and lifecycle. ${finish ? "Finish observation: " + (finish.details?.outcome || "outcome unavailable") + "." : "No finish observation recorded; pending or incomplete history."} Observed output is not proof of acceptance. Only edits with an explicit request identifier are associated with AI.`;
    } else if (moment?.kind === "work") value("event-description").textContent = `${moment.web} observed canvas edits, ${moment.native} PencilKit revisions and ${moment.checkpoints} saved page images grouped as a work moment. This grouping is not a count of individual pen strokes or proof of active work time. It does not attribute the edits to AI.`;
    const conversation = dialog.querySelector(".tenet-process-conversation");
    conversation.hidden = !request;
    value("question").textContent = ""; value("response").textContent = ""; value("ai-provenance").textContent = "";
    if (!request) return;
    const responseIndex = interaction ? group.responses.at(-1) ?? -1 : latestAt(group.responses, index), response = responseIndex >= 0 ? events[responseIndex] : null;
    value("question").textContent = request.details?.question || "No typed question captured. This request may have used handwriting or automatic context.";
    value("response").textContent = response ? response.details?.text || "Non-text output observed; inspect recorded tool details and later page checkpoints." : interaction ? "No linked reply body was recorded for this interaction. Pending, failed and missing captures are not reconstructed." : "No reply observed yet at this point in the timeline.";
    value("ai-provenance").textContent = `${interaction ? "Full recorded interaction: the latest linked reply may be later than the displayed checkpoint." : "Latest linked reply at this replay position only."} ${originLabel(request)}. Scope: ${request.details?.context?.scope || "not recorded"}. Open the AI interaction summary for all recorded replies, lifecycle and inputs. ${sample ? "Scripted example, not a live AI interaction." : "Local client evidence only; exact Gateway payload and policy are not attested."}${request.details?.questionTruncated || response?.details?.textTruncated ? " Some text was truncated during capture." : ""}${group.ambiguous || !group.id ? " Request linkage is unavailable or ambiguous; no response is inferred." : ""}`;
  }
  async function syntheticAssignment() {
    // All sample work is generated locally. No network, journal writes, capture
    // session, identity assertion or live model call is needed to explore it.
    const frames = new Map();
    for (let stage = 0; stage < 4; stage++) {
      const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 600;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("This browser could not render the sample. You can still open a local archive.");
      ctx.fillStyle = "#fffef9"; ctx.fillRect(0, 0, 900, 600);
      ctx.fillStyle = "#eeeadd"; ctx.fillRect(0, 0, 900, 67);
      ctx.fillStyle = "#6c735f"; ctx.font = "bold 14px sans-serif"; ctx.fillText("SYNTHETIC EXAMPLE / MATHEMATICS", 45, 41);
      ctx.fillStyle = "#172638"; ctx.font = "bold 28px Georgia"; ctx.fillText("Problem 12. Find x and check your answer.", 45, 124);
      ctx.strokeStyle = "#ebe9e0"; ctx.lineWidth = 1;
      for (let y = 180; y < 600; y += 50) { ctx.beginPath(); ctx.moveTo(44, y); ctx.lineTo(855, y); ctx.stroke(); }
      ctx.fillStyle = "#223b4b"; ctx.font = "36px Georgia"; ctx.fillText("3x + 6 = 18", 90, 220);
      if (stage === 1) { ctx.fillText("3x = 24", 90, 300); ctx.font = "italic 19px Georgia"; ctx.fillText("I added 6. Is that the right first step?", 90, 355); }
      if (stage >= 2) { ctx.fillText("3x + 6 - 6 = 18 - 6", 90, 295); ctx.fillText("3x = 12", 90, 370); ctx.fillText("x = 4", 90, 445); }
      if (stage === 3) { ctx.fillStyle = "#247461"; ctx.font = "24px Georgia"; ctx.fillText("Check: 3(4) + 6 = 18", 410, 510); }
      ctx.fillStyle = "#8b795d"; ctx.font = "13px sans-serif"; ctx.fillText("Fictional page checkpoint. Not a student submission or stroke recording.", 45, 573);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(Error("The sample checkpoint could not be created.")), "image/png"));
      frames.set("sample-frame-" + stage, blob); canvas.width = 0; canvas.height = 0;
    }
    const base = Date.UTC(2026, 0, 1, 10), id = "synthetic-algebra-example";
    const rows = [
      ["page.checkpoint", { reason:"Blank problem baseline" }, 0],
      ["canvas.commit", { note:"A fictional first step is written." }],
      ["page.checkpoint", { reason:"First step before asking for help" }, 1],
      ["ai.request", { localRequestId:"example-question-1", action:"hint", question:"I added 6 to get 3x = 24. Is that the right first step?", context:{scope:"selection", exactGatewayEvidence:false} }],
      ["ai.response", { localRequestId:"example-question-1", text:"What operation would undo the +6 next to 3x? Try doing the same operation to both sides before dividing.", committedToPage:false, observation:"scripted-sample-response" }],
      ["ai.finished", { localRequestId:"example-question-1", outcome:"completed" }],
      ["canvas.undo", { note:"The earlier edit is undone. Intent is not inferred." }],
      ["canvas.commit", { note:"A revised solution is written." }],
      ["page.checkpoint", { reason:"Revised solution after the hint" }, 2],
      ["coverage.gap", { reason:"This example intentionally omits an interval to show how a coverage gap is reported. No activity is inferred in the gap." }],
      ["page.checkpoint", { reason:"A final answer check is visible" }, 3],
      ["capture.paused", { reason:"End of fictional example; not an LMS submission" }],
    ];
    return {
      attempt:{id, title:"Problem 12: a hint, then a next step", subject:"Mathematics / synthetic example", status:"frozen", incomplete:true, coverageNotes:["One interval is intentionally omitted in this fictional example."], eventCount:rows.length},
      events:rows.map(([type, details, frame], index) => ({attemptId:id, sequence:index + 1, clientWallTime:base + index * 12000, type, details, assets:frame === undefined ? [] : [{name:"page.png", hash:"sample-frame-" + frame, mime:"image/png"}]})),
      getAsset:async (_attempt, hash) => frames.get(hash),
    };
  }
  async function perform(operation) {
    if (dialog.dataset.busy === "true") return;
    const owner = ++busyOwner, session = sessionEpoch;
    dialog.dataset.busy = "true"; dialog.setAttribute("aria-busy", "true");
    try { await operation(); }
    catch (error) { if (session === sessionEpoch) message(error?.message || "This operation could not be completed. Existing work is retained.", true); }
    finally { if (owner === busyOwner) { dialog.dataset.busy = "false"; dialog.removeAttribute("aria-busy"); } }
  }
  function paintActions() {
    dialog.querySelector(".tenet-process-actions").hidden = viewerOnly;
    find("share-work").hidden = standalone || savedPageId === null || !selected;
    find("report").hidden = !selected;
    find("final-page").hidden = !finalPage;
    find("final-page").textContent = showingFinalPage ? events.length ? "Return to work history" : "Saved final page" : "Show saved final page";
    find("final-page").disabled = Boolean(showingFinalPage && !events.length);
    const ownsActive = selected && capture()?.activeId() === selected.id;
    const recording = selected?.status === "recording";
    find("checkpoint").hidden = imported || !ownsActive || !recording;
    find("pause").hidden = imported || !ownsActive || !recording;
    find("recover").hidden = imported || !recording || ownsActive;
    find("freeze").hidden = imported || recording && !ownsActive;
    find("freeze").textContent = selected?.status === "frozen" ? "Prepare export" : "Freeze & prepare export";
    find("remove").hidden = imported || recording;
    find("play").disabled = events.length === 0;
  }
  async function refreshLibrary() {
    if (viewerOnly) return;
    const session = sessionEpoch;
    const rows = await journal.listAttempts(), list = dialog.querySelector(".tenet-process-list");
    if (session !== sessionEpoch || !dialog.open) return;
    list.replaceChildren();
    for (const row of rows) {
      const button = document.createElement("button"), title = document.createElement("span"), meta = document.createElement("small");
      button.type = "button"; button.setAttribute("aria-current", String(!imported && selected?.id === row.id));
      title.textContent = row.title; meta.textContent = `${row.eventCount} events / ${row.status}${row.incomplete ? " / gaps" : ""}`;
      button.append(title, meta); button.addEventListener("click", () => void perform(() => selectAttempt(row.id))); list.append(button);
    }
    if (!rows.length) { const empty = document.createElement("p"); empty.textContent = "No recorded assignments yet."; list.append(empty); }
    control.dataset.recording = String(Boolean(capture()?.isRecording()));
  }
  function eventMillis(event) {
    const iso = event?.timestamp;
    const isoTime = typeof iso === "string" && iso.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? Date.parse(iso) : NaN;
    const legacyTime = typeof event?.clientWallTime === "number" ? event.clientWallTime : NaN;
    for (const time of [isoTime, legacyTime]) {
      if (!Number.isFinite(time)) continue;
      const date = new Date(time);
      if (Number.isFinite(date.getTime())) return time;
    }
    return null;
  }
  function recordedEventTime(event) {
    const time = eventMillis(event);
    return time === null ? "Time unavailable" : new Date(time).toLocaleString();
  }
  async function renderEvent(index) {
    const token = ++generation, session = sessionEpoch, selection = selectionEpoch, playback = playbackEpoch;
    const current = () => token === generation && session === sessionEpoch && selection === selectionEpoch && playback === playbackEpoch && dialog.open;
    indexHistory();
    index = Math.max(0, Math.min(Number(index) || 0, Math.max(0, events.length - 1)));
    currentIndex = index;
    const event = events[index];
    const momentNumber = momentAtEvent[index], moment = moments[momentNumber];
    slider.value = String(momentNumber || 0); value("position").textContent = `${event ? momentNumber + 1 : 0} / ${moments.length} moments`;
    value("detail").textContent = event ? JSON.stringify({ event: event.type, sequence: event.sequence, recordedAt: recordedEventTime(event), groupedMoment:momentTitle(moment), groupedRawSequences:moment?.raw.map(raw => events[raw].sequence), details: event.details }, null, 2) : "No events recorded.";
    paintObservation(event, index);
    updateActivityPosition(index);
    dialog.querySelectorAll(".tenet-process-events button").forEach(button => button.setAttribute("aria-current", String(Number(button.dataset.moment) === momentNumber)));
    const frameIndex = frameAtEvent[index];
    const finalImage = finalPage && isCheckpointImage(finalPage.asset, {type:"submission.final-page"}) ? finalPage.asset : null;
    const finalView = Boolean(finalImage && (showingFinalPage || !events.length));
    const frame = finalView ? {eventIndex:-1, asset:finalImage, key:finalImage.mime + ":" + finalImage.hash} : frames[frameIndex];
    requestedFrameKey = frame?.key || null;
    desiredFrameKeys = new Set((finalView ? [frame.key] : [frame?.key, frames[nextFrameAt[frameIndex]]?.key, frames[previousFrameAt[frameIndex]]?.key]).filter(Boolean));
    for (const [key, entry] of frameCache) if (entry.state === "loading" && !desiredFrameKeys.has(key)) dropFrame(key);
    value("preview").hidden = false;
    value("preview").textContent = frame ? "Preparing the next checkpoint. Any visible image retains its own timestamp below." : "No rendered checkpoint at or before this event.";
    dialog.querySelector(".tenet-process-preview").dataset.retained = String(Boolean(imageUrl));
    if ((savedPageId !== null || portableFile) && !historyAvailable) {
      value("preview").textContent = "History unavailable for this saved whiteboard. No past steps or AI interactions can be reconstructed.";
      value("event-title").textContent = "No recorded history";
      value("event-description").textContent = "This page predates saved work-history capture or contains no saved history. It is not evidence that no AI was used.";
    }
    if (!frame || !selected) {
      hidePicture(); value("checkpoint-caption").textContent = "No page image is recorded at or before this position. AI input images are not page checkpoints."; return;
    }
    const entry = await loadFrame(frame);
    if (!current()) return;
    if (!entry || entry.state !== "ready" || !entry.url) {
      value("preview").textContent = entry?.error || "This checkpoint is unavailable. Event history remains readable.";
      return;
    }
    imageUrl = entry.url; displayedFrameKey = frame.key;
    if (picture.getAttribute("src") !== imageUrl) picture.src = imageUrl;
    picture.hidden = false; value("preview").hidden = true;
    dialog.querySelector(".tenet-process-preview").dataset.retained = "false";
    if (finalView) {
      value("frame-time").textContent = `Displayed saved final page / ${String(finalPage.representation || "preview provenance unavailable").replaceAll("-", " ")}. This is separate from timed replay observations.`;
      value("checkpoint-caption").textContent = `${finalPage.caption || "A saved final-page image supplied with this work file."} No history events are added or inferred from this image.`;
      paintActions(); return;
    }
    const imageEvent = events[frame.eventIndex];
    value("frame-time").textContent = `Displayed ${imageEvent.details?.representation === "saved-page-thumbnail" ? "saved-page thumbnail" : "checkpoint"}: event ${frame.eventIndex + 1}, ${recordedEventTime(imageEvent)}. Selected event: ${index + 1}, ${recordedEventTime(event)}.`;
    value("checkpoint-caption").textContent = imageEvent.details?.representation === "saved-page-thumbnail" ? "This displayed frame is a saved-page thumbnail, not a full-resolution checkpoint or a recording of every stroke." : "Recorded checkpoints and native revision observations, not a video of individual pen strokes. A checkpoint may combine several edits.";
    const next = frames[nextFrameAt[frameIndex]];
    paintActions();
    if (next && current()) void loadFrame(next);
  }
  async function paintRecord() {
    dialog.querySelector(".tenet-process-empty").hidden = Boolean(selected);
    dialog.querySelector(".tenet-process-record").hidden = !selected;
    if (!selected) return;
    indexHistory();
    value("title").textContent = selected.title;
    value("meta").textContent = `${selected.subject || "Assignment"} / ${moments.length} work moments / ${requestGroups.length} AI interactions. ${events.length} raw observations retained.`;
    value("badge").textContent = savedPageId !== null ? "SAVED WHITEBOARD / ON DEVICE" : sample ? "SYNTHETIC EXAMPLE" : portableFile ? "PORTABLE WORK / LOCAL FILE" : imported ? "IMPORTED / UNVERIFIED" : String(selected.status).toUpperCase();
    value("coverage").textContent = (savedPageId !== null || portableFile) && !historyAvailable ? "No process history is available for this saved whiteboard. We cannot reconstruct earlier edits, time spent or AI help, and do not substitute a sample. A saved final-page preview, when supplied, is shown separately without inventing events." : `${savedPageId !== null ? "Actual process history stored with this whiteboard. " : sample ? "Fictional work and scripted AI replies. " : "Local observations, not server-attested evidence. "}Coalesced checkpoints, not full stroke playback. No verified student identity, assignment-rule enforcement or Schoology receipt.${selected.incomplete ? " Known gaps: " + (selected.coverageNotes || selected.incompleteReasons || []).join(" ") : " Not proof of independent work."}${selected.droppedEvents > 0 ? " Events omitted by retention limits: " + selected.droppedEvents + "." : ""}`;
    value("sharing-note").textContent = savedPageId !== null ? "Share one compact .tenet work file, not a GIF or video. It contains the saved student work and recorded questions, replies and images. Only the saved version is exported: save canvas changes first if you want them included. File size depends on the recorded contents. Share only with intended recipients; anyone with the file may read it. Nothing is uploaded automatically. Open report / PDF offers a separate optional report." : sample ? "This is a fictional example, not student work. A local report can demonstrate the format; it is not a classroom submission." : "This local file may contain private student work, questions, replies and images. Share only with intended recipients. Opening it does not upload data, restore the canvas or grant teacher privileges. Open report / PDF offers an optional local report; a report does not replace the portable history file.";
    value("checkpoints").textContent = String(frames.length);
    value("requests").textContent = String(requestGroups.length);
    value("gaps").textContent = String(events.filter(event => event.type === "coverage.gap").length || (selected.incomplete ? "Recorded" : 0));
    slider.max = String(Math.max(0, moments.length - 1)); slider.disabled = !moments.length;
    const list = dialog.querySelector(".tenet-process-events"); list.replaceChildren();
    // Keep a long notebook from turning into thousands of live DOM controls.
    const start = Math.max(0, moments.length - 100);
    value("timeline-note").textContent = `${start ? "Latest 100 work moments shown; the slider covers all moments. " : ""}AI requests, replies, finishes and recorded inputs are one interaction. Nearby ordinary edits/checkpoints are grouped work moments; no student edit is attributed to AI without an explicit recorded link. Raw order and details are retained.`;
    for (let index = start; index < moments.length; index++) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.moment = String(index);
      button.textContent = `${index + 1}. ${momentTitle(moments[index])}`;
      button.addEventListener("click", () => seekMoment(index)); list.append(button);
    }
    paintActivity(); paintActions(); await renderEvent(moments.at(-1)?.index || 0);
  }
  async function selectAttempt(id) {
    if (viewerOnly) return;
    const token = ++selectionEpoch, session = sessionEpoch;
    stopPlaying(); generation++; clearPrepared(); clearImage();
    const attempt = await journal.readAttempt(id), nextEvents = attempt ? await journal.listEvents(id) : [];
    if (token !== selectionEpoch || session !== sessionEpoch || !dialog.open) return;
    imported = false; sample = false; savedPageId = null; historyAvailable = true; assetSource = journal; selected = attempt; events = nextEvents;
    await paintRecord(); await refreshLibrary();
  }
  async function tick(position, token) {
    if (!playing || !dialog.open || token !== playbackEpoch) return;
    const moment = moments[position]; if (!moment) { stopPlaying(); return; }
    showingFinalPage = false;
    try { await renderEvent(moment.index); }
    catch (error) { if (token === playbackEpoch) { stopPlaying(); message(error.message, true); } return; }
    if (!playing || !dialog.open || token !== playbackEpoch) return;
    if (position >= moments.length - 1) { stopPlaying(); return; }
    const previous = eventTimes[moment.start], next = eventTimes[moments[position + 1].start];
    const reliable = previous !== null && next !== null && next >= previous;
    const recordedDelay = reliable ? next - previous : 1000;
    const shortened = skipLongPauses && recordedDelay > 10000;
    const delay = Math.max(60, (shortened ? 1000 : recordedDelay) / playbackSpeed);
    value("pacing").textContent = `${playbackSpeed}x playback. ${reliable ? shortened ? "A recorded pause longer than 10 seconds is shortened to 1 second before speed adjustment." : "Using the recorded interval to the next event." : "Next interval has missing or out-of-order times: using a 1-second fallback in recorded order."} Rapid simultaneous events have a 60 ms display floor. Pausing, seeking or changing pacing stops this timer.`;
    function waitRemaining(remaining) {
      if (!playing || !dialog.open || token !== playbackEpoch) return;
      const chunk = Math.min(60000, remaining);
      playTimer = setTimeout(() => {
        if (!playing || !dialog.open || token !== playbackEpoch) return;
        if (remaining > chunk) waitRemaining(remaining - chunk);
        else void tick(position + 1, token);
      }, chunk);
    }
    waitRemaining(delay);
  }
  async function prepareExport() {
    if (viewerOnly || !selected || imported) return;
    const id = selected.id, session = sessionEpoch;
    stopPlaying();
    message("Finishing the local journal and preparing an archive...");
    if (capture()?.activeId() === id) await capture().pause();
    const frozen = await journal.freezeAttempt(id), blob = await journal.exportAttempt(id), frozenEvents = await journal.listEvents(id);
    if (session !== sessionEpoch || !dialog.open) return;
    selected = frozen; events = frozenEvents;
    const filename = (selected.title.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "assignment") + ".tenet-work.json";
    exportFile = new File([blob], filename, { type: "application/json" });
    await paintRecord(); await refreshLibrary();
    if (session !== sessionEpoch || !dialog.open) return;
    find("download").hidden = false;
    find("share").hidden = !(navigator.canShare && navigator.canShare({ files: [exportFile] }));
    message("Frozen locally. Save or share the archive below. This is not a Schoology submission.");
  }
  control.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
    const session = sessionEpoch;
    void perform(async () => { await refreshSavedPages(true); if (session !== sessionEpoch || !dialog.open) return; await refreshLibrary(); if (session !== sessionEpoch || !dialog.open) return; await paintRecord(); });
  });
  find("close").addEventListener("click", () => dialog.close());
  function retireView() { stopPlaying(); generation++; sessionEpoch++; selectionEpoch++; savedListEpoch++; busyOwner++; dialog.dataset.busy = "false"; dialog.removeAttribute("aria-busy"); clearRecord(); }
  dialog.addEventListener("close", retireView);
  find("refresh-pages").addEventListener("click", () => void refreshSavedPages());
  if (!viewerOnly) {
  dialog.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    void perform(async () => {
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      if (!capture()) throw Error("The assignment recorder is not available in this build.");
      if (capture().isRecording()) throw Error("Pause the current page recording first.");
      const title = form.elements.title.value.trim(), subject = form.elements.subject.value.trim();
      dialog.close();
      const startSession = sessionEpoch;
      let attempt;
      try { attempt = await capture().begin({ title, subject, phase: "unconfigured" }); }
      catch (error) { if (startSession === sessionEpoch) { dialog.showModal(); message(error?.message || "Recording did not start. Your canvas is unchanged.", true); } return; }
      if (startSession !== sessionEpoch) return;
      selected = attempt || await journal.readAttempt(capture().activeId());
      control.dataset.recording = "true";
      message("Recording this page locally. Open Teacher preview to inspect, pause, or export.");
    });
  });
  find("refresh").addEventListener("click", () => void perform(async () => {
    if (selected && !imported) await selectAttempt(selected.id); else await refreshLibrary();
  }));
  find("checkpoint").addEventListener("click", () => void perform(async () => { await capture().checkpoint("Student checkpoint"); await capture().flush(); await selectAttempt(selected.id); }));
  find("pause").addEventListener("click", () => void perform(async () => { const id = selected.id; await capture().pause(); await selectAttempt(id); message("Recording paused. History is retained; new edits are not captured."); }));
  find("recover").addEventListener("click", () => void perform(async () => {
    if (!window.confirm("Recover this interrupted recording? This stops any other window writing to it and marks a coverage gap.")) return;
    await journal.recoverAttempt(selected.id); await selectAttempt(selected.id); message("Recovered as paused, with an explicit coverage gap. You can freeze and export it.");
  }));
  find("freeze").addEventListener("click", () => void perform(prepareExport));
  find("download").addEventListener("click", () => {
    if (!exportFile) return;
    const url = URL.createObjectURL(exportFile), link = document.createElement("a");
    link.href = url; link.download = exportFile.name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message("Archive download requested. On iPad, use Share archive when available to save it to Files.");
  });
  find("share").addEventListener("click", () => {
    if (!exportFile) return;
    void navigator.share({ files: [exportFile], title: selected.title }).catch(error => { if (error.name !== "AbortError") message("Sharing was unavailable. Your frozen archive is retained; try Save archive.", true); });
  });
  find("remove").addEventListener("click", () => void perform(async () => {
    if (!selected || imported || !window.confirm("Permanently remove this local work history and its attachments? The original canvas is not deleted. Export first if you need this history.")) return;
    const session = sessionEpoch;
    stopPlaying(); generation++;
    await journal.deleteAttempt(selected.id); if (session !== sessionEpoch || !dialog.open) return;
    selected = null; events = []; clearPrepared(); clearImage(); await paintRecord(); await refreshLibrary(); message("Local history removed. Your original canvas is unchanged.");
  }));
  }
  find("play").addEventListener("click", () => {
    if (playing) { stopPlaying(); return; }
    if (!events.length || !dialog.open || dialog.dataset.busy === "true") return;
    clearInput(); playing = true; find("play").textContent = "Pause replay";
    const token = ++playbackEpoch;
    void tick(Number(slider.value) >= moments.length - 1 ? 0 : Number(slider.value), token);
  });
  slider.addEventListener("input", () => seekMoment(Number(slider.value)));
  dialog.querySelector('[data-control="speed"]').addEventListener("change", event => {
    const speed = Number(event.currentTarget.value);
    if (![0.5, 1, 2, 4, 8].includes(speed)) return;
    playbackSpeed = speed; seekEvent(currentIndex);
    value("pacing").textContent = `Paused. Press Play history to continue at ${speed}x recorded-time speed. Missing or out-of-order times use a 1-second fallback in recorded order.`;
  });
  dialog.querySelector('[data-control="skip-pauses"]').addEventListener("change", event => {
    skipLongPauses = event.currentTarget.checked === true; seekEvent(currentIndex);
    value("pacing").textContent = skipLongPauses ? "Paused. Long pauses over 10 seconds will be shortened to 1 second before speed adjustment." : "Paused. Long recorded pauses will be retained. This timing is not a measure of active work.";
  });
  find("ai-summary").addEventListener("click", () => showAISummary());
  find("hide-ai-summary").addEventListener("click", () => { clearInput(); dialog.querySelector(".tenet-process-ai-summary").hidden = true; find("ai-summary").setAttribute("aria-expanded", "false"); find("ai-summary").focus(); });
  find("ai-previous").addEventListener("click", () => { aiListPage--; paintAIList(); });
  find("ai-next").addEventListener("click", () => { aiListPage++; paintAIList(); });
  find("share-work").addEventListener("click", () => { if (savedPageId !== null) void shareSavedPage(savedPageId); });
  find("report").addEventListener("click", () => void showReport());
  find("final-page").addEventListener("click", () => {
    if (!finalPage) return;
    stopPlaying(); clearInput(); showingFinalPage = !showingFinalPage;
    const session = sessionEpoch, selection = selectionEpoch;
    void renderEvent(currentIndex).catch(error => { if (session === sessionEpoch && selection === selectionEpoch && dialog.open) message(error?.message || "The saved final page could not be displayed.", true); });
  });
  const picker = dialog.querySelector('[data-file="archive"]');
  find("open").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => { const file = picker.files?.[0]; picker.value = ""; if (file) void openFile(file); });
  find("sample").addEventListener("click", () => void perform(async () => {
    const token = ++selectionEpoch, session = sessionEpoch;
    stopPlaying(); generation++; clearImage(); clearPrepared();
    message("Preparing a fictional assignment. No recording or AI request is being started.");
    const bundle = await syntheticAssignment();
    if (token !== selectionEpoch || session !== sessionEpoch || !dialog.open) return;
    selected = bundle.attempt; events = bundle.events; imported = true; sample = true; savedPageId = null; historyAvailable = true; assetSource = bundle;
    await paintRecord();
    if (session !== sessionEpoch || !dialog.open) return;
    await renderEvent(0);
    if (session === sessionEpoch && dialog.open) message("Synthetic example ready. Press Play history to follow the work and observed AI help. Your canvas is unchanged.");
  }));
  window.addEventListener("tenet:process-status", event => {
    if (viewerOnly) return;
    control.dataset.recording = String(Boolean(capture()?.isRecording()));
    if (event.detail?.error) message(String(event.detail.error), true);
  });
  window.addEventListener("tenet:sign-out", () => { dialog.close(); retireView(); selected = null; events = []; assetSource = journal; imported = false; sample = false; clearPrepared(); value("detail").textContent = ""; value("question").textContent = ""; value("response").textContent = ""; dialog.querySelector(".tenet-process-list").replaceChildren(); dialog.querySelector(".tenet-process-events").replaceChildren(); void paintRecord(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlaying(); });
  window.addEventListener("pagehide", () => { retireView(); clearPrepared(); });
  window.TenetProcessUI = Object.freeze({openSavedPage, shareSavedPage, openFile});
  if (standalone) control.click();
})();
