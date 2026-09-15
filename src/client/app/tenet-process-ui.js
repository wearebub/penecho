// Local assignment-preview controls. Server policy and LMS receipts are later lanes.
(function installTenetProcessUI() {
  "use strict";
  if (window.PENECHO_CONFIG?.tenetMode !== true) return;
  const journal = window.TenetProcessJournal;
  const previewEnabled = window.PENECHO_CONFIG?.tenetAssignmentPreview === true && Boolean(journal);
  const viewerOnly = window.PENECHO_CONFIG?.tenetHistoryViewerOnly === true;
  const capture = () => window.TenetProcessCapture;
  let selected = null, events = [], assetSource = journal, imported = false, sample = false;
  let exportFile = null, imageUrl = null, generation = 0, playing = false, playTimer = null;
  let sessionEpoch = 0, selectionEpoch = 0, playbackEpoch = 0, busyOwner = 0;
  const launcherCSS = '.tenet-process-launch{display:inline-flex;align-items:center;gap:6px;min-height:44px;box-sizing:border-box;margin-inline-start:8px;padding:7px 11px;border:1px solid #d6d3ca;border-radius:9px;background:#f7f3e9;color:#172638;font:600 13px "Avenir Next","Trebuchet MS",sans-serif;text-decoration:none;flex-shrink:0;cursor:pointer;touch-action:manipulation}.tenet-process-launch svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.tenet-process-launch-floating{position:fixed;top:calc(8px + env(safe-area-inset-top));right:12px;z-index:40}';
  const control = document.createElement("button");
  control.type = "button"; control.className = "tenet-process-launch";
  control.setAttribute("aria-haspopup", "dialog");
  control.setAttribute("aria-label", "Teacher preview: assignment playback");
  control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 8 10-5 10 5-10 5-10-5Zm4 3v6c4 3 8 3 12 0v-6M22 8v9"/></svg><span>Teacher preview</span>';
  // Keep ordinary sessions inside the app without exposing shared-profile
  // histories. The child viewer permits only synthetic samples or chosen files.
  if (!previewEnabled) {
    control.setAttribute("aria-controls", "tenetProcessDialog");
    control.setAttribute("aria-label", "Teacher preview: synthetic sample or local file");
    control.title = "Sample and local-file preview only. Not a connected classroom.";
    const entry = document.querySelector("#saveCanvasBtn");
    if (entry) entry.insertAdjacentElement("afterend", control);
    else { control.className += " tenet-process-launch-floating"; document.body.append(control); }
    const shell = document.createElement("dialog");
    shell.id = "tenetProcessDialog"; shell.className = "tenet-process-dialog tenet-process-embedded";
    shell.setAttribute("aria-labelledby", "tenetProcessEmbeddedTitle");
    shell.innerHTML = '<header><div><strong id="tenetProcessEmbeddedTitle">Teacher preview</strong><p>Sample and local-file playback. Not a connected classroom.</p></div><button type="button" data-action="close" aria-label="Close teacher preview and return to canvas">Back to canvas</button></header><iframe title="Tenet assignment playback: sample or local file" referrerpolicy="no-referrer"></iframe>';
    const embeddedStyle = document.createElement("style");
    embeddedStyle.textContent = '.tenet-process-embedded{box-sizing:border-box;width:min(1240px,98vw);height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));padding:0;border:1px solid #dad6ca;border-radius:16px;background:#f8f6ee;color:#172638;overflow:hidden;box-shadow:0 20px 70px #10223340;font-family:"Avenir Next","Trebuchet MS",sans-serif}.tenet-process-embedded[open]{display:flex;flex-direction:column}.tenet-process-embedded::backdrop{background:#17263870;backdrop-filter:blur(5px)}.tenet-process-embedded>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;flex:none;border-bottom:1px solid #dfdfd5;background:#f8f6ee}.tenet-process-embedded strong{font-size:16px}.tenet-process-embedded p{font-size:11px;color:#69766d;margin:4px 0 0}.tenet-process-embedded button{min-height:44px;min-width:44px;padding:9px 13px;border:1px solid #cbd5cf;border-radius:9px;background:#fffdf7;color:#172638;font:600 13px "Avenir Next","Trebuchet MS",sans-serif;cursor:pointer;touch-action:manipulation}.tenet-process-embedded button:focus-visible{outline:3px solid #488777;outline-offset:2px}.tenet-process-embedded>iframe{display:block;flex:1;min-height:0;width:100%;border:0;background:#f8f6ee}@media(max-width:520px){.tenet-process-embedded>header{padding:10px;gap:8px}.tenet-process-embedded strong{font-size:14px}.tenet-process-embedded p{max-width:190px}}';
    embeddedStyle.textContent += launcherCSS;
    document.head.append(embeddedStyle); document.body.append(shell);
    const frame = shell.querySelector("iframe");
    const unload = () => { frame.src = "about:blank"; };
    control.addEventListener("click", () => {
      if (shell.open) return;
      shell.showModal();
      frame.src = "./tenet-history-viewer.html";
    });
    shell.querySelector('[data-action="close"]').addEventListener("click", () => shell.close());
    shell.addEventListener("close", unload);
    window.addEventListener("tenet:sign-out", () => { shell.close(); unload(); });
    window.addEventListener("pagehide", () => { shell.close(); unload(); });
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "tenet-process-dialog";
  dialog.id = "tenetProcessDialog";
  dialog.setAttribute("aria-labelledby", "tenetProcessTitle");
  control.setAttribute("aria-controls", dialog.id);
  dialog.innerHTML = `
    <header class="tenet-process-heading"><div><small>TENET / ASSIGNMENT PLAYBACK</small><h2 id="tenetProcessTitle">See how the thinking unfolded.</h2></div><button type="button" data-action="close" aria-label="Close teacher preview">Close</button></header>
    <p class="tenet-process-disclosure">Teacher-style preview, not an authenticated teacher dashboard. This viewer does not upload work or call AI. Real teacher access, assignment rules and Schoology hand-in are not connected. Ordinary canvas AI continues through the district Gateway.</p>
    <p class="tenet-process-status" role="status" aria-live="polite">Explore a synthetic example, or explicitly record a local assignment.</p>
    <div class="tenet-process-layout">
      <aside class="tenet-process-sidebar">
        <div class="tenet-process-demo"><small>START HERE</small><h3>A hint, then a next step.</h3><p>Follow a fictional algebra example. No student data and no AI request.</p><button type="button" data-action="sample" class="tenet-process-primary">Play a sample assignment</button></div>
        <button type="button" data-action="open">Open a history archive</button>
        <input data-file="archive" type="file" accept=".json,.tenet-work,application/json" hidden />
        <details class="tenet-process-record-options"><summary>Record my current page</summary><form data-form="start"><h3>Opt-in local capture</h3>
          <label>Assignment title<input name="title" required maxlength="80" placeholder="Problem set: linear equations" autocomplete="off" /></label>
          <label>Subject<input name="subject" maxlength="80" placeholder="Math" autocomplete="off" /></label>
          <label class="tenet-process-consent"><input name="consent" type="checkbox" required /><span>Record this page's edits, checkpoints and observed AI activity locally. Use synthetic work in this preview; this browser profile is not separated by school account.</span></label>
          <button type="submit" class="tenet-process-primary">Start capture on this page</button>
        </form></details>
        <div class="tenet-process-library-heading"><h3>Local histories</h3><button type="button" data-action="refresh">Refresh</button></div>
        <nav class="tenet-process-list" aria-label="Recorded assignments"></nav>
      </aside>
      <section class="tenet-process-work" aria-label="Assignment history viewer">
        <div class="tenet-process-empty"><span>TEACHER PREVIEW</span><h3>The work behind the answer.</h3><p>See a page develop alongside the questions asked and the help received. Start with the sample, or open a local history. No past work is reconstructed.</p></div>
        <div class="tenet-process-record" hidden>
          <div class="tenet-process-record-heading"><div><h3 data-value="title"></h3><p data-value="meta"></p></div><span class="tenet-process-badge" data-value="badge"></span></div>
          <p class="tenet-process-coverage" data-value="coverage"></p>
          <div class="tenet-process-metrics" aria-label="Observed history summary"><div><strong data-value="checkpoints">0</strong><span>Page checkpoints</span></div><div><strong data-value="requests">0</strong><span>AI requests observed</span></div><div><strong data-value="gaps">0</strong><span>Coverage gaps</span></div></div>
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
          <div class="tenet-process-playback"><button type="button" data-action="play">Play history</button><input type="range" min="0" max="0" value="0" aria-label="History position" /><output data-value="position">0 / 0</output></div>
          <p class="tenet-process-caption">Checkpoint replay, not a recording of every pen movement. The image is the nearest recorded checkpoint at or before the selected event.</p>
          <div class="tenet-process-detail"><div><h3>Work timeline</h3><p class="tenet-process-caption" data-value="timeline-note"></p><nav class="tenet-process-events" aria-label="Recorded events"></nav></div><section class="tenet-process-observation" aria-label="AI help and process evidence"><small data-value="event-label"></small><h3 data-value="event-title"></h3><p data-value="event-description"></p><div class="tenet-process-conversation" hidden><h4>Question observed</h4><p data-value="question"></p><h4>Tenet reply observed</h4><p data-value="response"></p><p class="tenet-process-caption" data-value="ai-provenance"></p></div><details><summary>Technical event details</summary><pre data-value="detail" aria-label="Event details"></pre></details></section></div>
        </div>
      </section>
    </div><footer class="tenet-process-source">Built on PenEcho. <a href="https://github.com/wearebub/penecho/tree/codex/tenet-ipad" target="_blank" rel="noopener noreferrer">Tenet fork source</a> / <a href="https://github.com/wearebub/penecho/blob/codex/tenet-ipad/LICENSE" target="_blank" rel="noopener noreferrer">AGPL-3.0</a></footer>`;
  const style = document.createElement("style");
  style.textContent = `
    .tenet-process-launch{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin-inline-start:8px;padding:7px 11px;border:1px solid #d6d3ca;border-radius:9px;background:#f7f3e9;color:#172638;font:600 13px "Avenir Next","Trebuchet MS",sans-serif;cursor:pointer;touch-action:manipulation;flex-shrink:0}
    .tenet-process-launch svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
    .tenet-process-launch[data-recording=true]{border-color:#1c816d;background:#eaf4ef}
    .tenet-process-dialog{box-sizing:border-box;width:min(1120px,96vw);max-height:calc(100dvh - 48px - env(safe-area-inset-top));padding:24px;border:1px solid #dad6ca;border-radius:20px;background:linear-gradient(145deg,#fffefb,#f5f2e9);color:#172638;font-family:"Avenir Next","Trebuchet MS",sans-serif;box-shadow:0 20px 70px #10223340;overflow:auto}
    .tenet-process-dialog::backdrop{background:#17263860;backdrop-filter:blur(5px)}
    .tenet-process-source{margin-top:22px;padding-top:14px;border-top:1px solid #dddcd1;font-size:11px;color:#68716f}.tenet-process-source a{color:#315c50;text-underline-offset:3px}
    .tenet-process-dialog [hidden]{display:none!important}.tenet-process-heading,.tenet-process-record-heading,.tenet-process-library-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}
    .tenet-process-heading small{font-size:11px;letter-spacing:.15em;color:#9b552f;font-weight:800}.tenet-process-heading h2{font-size:27px;letter-spacing:-.7px;margin:5px 0 0}.tenet-process-dialog h3{margin:0 0 10px;font-size:16px}
    .tenet-process-dialog button{min-height:42px;border:1px solid #d2d5d5;border-radius:9px;padding:8px 12px;background:#fffdfa;color:#172638;font:600 13px "Avenir Next","Trebuchet MS",sans-serif;cursor:pointer;touch-action:manipulation}
    .tenet-process-dialog button:disabled{opacity:.5;cursor:default}.tenet-process-dialog button:focus-visible,.tenet-process-dialog input:focus-visible{outline:3px solid #5a98c1;outline-offset:2px}
    .tenet-process-dialog .tenet-process-primary{background:#172638;color:white;width:100%;border-color:#172638}.tenet-process-dialog .tenet-process-danger{color:#9a3434}
    .tenet-process-disclosure{font-size:12px;line-height:1.6;max-width:920px;color:#68716f}.tenet-process-status{padding:10px 13px;border-radius:9px;background:#eaf0ed;font-size:13px;min-height:18px}.tenet-process-status[data-error=true]{background:#fae8e2;color:#90331f}
    .tenet-process-layout{display:grid;grid-template-columns:265px minmax(0,1fr);gap:24px}.tenet-process-sidebar{border-right:1px solid #e0ddd4;padding-right:20px}.tenet-process-sidebar label{display:grid;gap:5px;font-size:12px;font-weight:600;margin-bottom:12px}
    .tenet-process-sidebar input:not([type=checkbox]){box-sizing:border-box;width:100%;padding:11px;border:1px solid #d6d6d0;border-radius:8px;background:#fff;font:14px "Avenir Next","Trebuchet MS",sans-serif;color:#172638}
    .tenet-process-sidebar .tenet-process-consent{display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:1.55;font-weight:400}.tenet-process-consent input{margin-top:4px;flex:none;accent-color:#287868}
    .tenet-process-demo{padding:16px;margin-bottom:12px;border:1px solid #d8e3da;border-radius:12px;background:linear-gradient(135deg,#e9f1e9,#fbf7e9)}.tenet-process-demo small{color:#6c7355;font-size:10px;font-weight:800;letter-spacing:.14em}.tenet-process-demo h3{margin-top:9px}.tenet-process-demo p{font-size:12px;line-height:1.6;color:#556560}.tenet-process-record-options{margin-top:22px}.tenet-process-dialog summary{cursor:pointer;padding:11px 0;min-height:22px;font-size:13px;font-weight:700}.tenet-process-record-options form{padding-top:12px}
    .tenet-process-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:15px 0}.tenet-process-metrics div{display:grid;gap:4px;padding:12px;border:1px solid #dddcd1;border-radius:10px;background:#fffefa}.tenet-process-metrics strong{font-size:22px;color:#246454}.tenet-process-metrics span{font-size:10px;color:#626d69}.tenet-process-observation{padding:15px;border:1px solid #dddcd1;border-radius:12px;background:#fffefa;overflow-wrap:anywhere}.tenet-process-observation>small{font-size:10px;letter-spacing:.1em;color:#846442}.tenet-process-observation h3{margin-top:8px}.tenet-process-observation p{font-size:12px;line-height:1.6;white-space:pre-wrap}.tenet-process-conversation{border-top:1px solid #e1e3d9;margin-top:14px}.tenet-process-conversation h4{font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin:15px 0 6px;color:#66796e}.tenet-process-conversation [data-value=response]{padding:11px;background:#edf3ec;border-left:3px solid #488777;border-radius:0 8px 8px 0}.tenet-process-preview{position:relative}
    .tenet-process-library-heading{margin-top:28px}.tenet-process-library-heading h3{margin:0}.tenet-process-list{display:grid;gap:8px;margin:12px 0 18px;max-height:300px;overflow:auto}.tenet-process-list button{text-align:left;display:grid;gap:4px}.tenet-process-list small{font-size:11px;font-weight:400;color:#697478}.tenet-process-list button[aria-current=true]{border-color:#527f88;background:#edf4f0}
    .tenet-process-work{min-width:0}.tenet-process-empty{min-height:340px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:radial-gradient(ellipse at center,#f2eee0,transparent 72%);padding:20px}.tenet-process-empty span{font-size:10px;letter-spacing:.18em;color:#9b552f}.tenet-process-empty h3{font-size:24px;margin:14px 0}.tenet-process-empty p{max-width:360px;color:#68716f;line-height:1.6;font-size:14px}
    .tenet-process-record-heading h3{margin:0;font-size:21px}.tenet-process-record-heading p{font-size:12px;color:#68716f;margin:7px 0}.tenet-process-badge{padding:6px 9px;border-radius:20px;background:#e6eee8;font-size:11px;font-weight:700;white-space:nowrap}.tenet-process-coverage{font-size:12px;line-height:1.5;color:#805530}
    .tenet-process-actions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.tenet-process-preview{min-height:230px;height:32vh;max-height:390px;display:flex;align-items:center;justify-content:center;border:1px solid #dddcd5;border-radius:12px;background:repeating-linear-gradient(0deg,#fff,#fff 23px,#f3f2ee 24px);overflow:hidden}.tenet-process-preview img{max-width:100%;max-height:100%;object-fit:contain}.tenet-process-preview p{padding:20px;text-align:center;color:#737c81;font-size:13px}
    .tenet-process-playback{display:flex;align-items:center;gap:12px;margin-top:12px}.tenet-process-playback input{flex:1;min-width:50px;accent-color:#267b6b}.tenet-process-playback output{font-size:12px;min-width:48px;text-align:right}.tenet-process-caption{font-size:11px;line-height:1.5;color:#68716f}.tenet-process-detail{display:grid;grid-template-columns:minmax(130px,1fr) minmax(0,1.35fr);gap:12px}.tenet-process-events{max-height:210px;overflow:auto;display:flex;flex-direction:column;gap:5px}.tenet-process-events button{text-align:left;min-height:38px;font-size:11px}.tenet-process-events button[aria-current=true]{background:#eaf2ef;border-color:#4c8274}.tenet-process-detail pre{white-space:pre-wrap;overflow:auto;margin:0;padding:12px;max-height:185px;border-radius:9px;background:#eeeae0;font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}
    @media(max-width:720px){.tenet-process-dialog{padding:16px}.tenet-process-layout{grid-template-columns:1fr}.tenet-process-sidebar{border-right:0;border-bottom:1px solid #e0ddd4;padding:0 0 18px}.tenet-process-heading h2{font-size:22px}.tenet-process-list{max-height:150px}.tenet-process-detail{grid-template-columns:1fr}.tenet-process-launch span{display:none}.tenet-process-launch{min-width:42px;justify-content:center}.tenet-process-preview{height:30vh}}`;
  style.textContent += launcherCSS;
  document.head.append(style); document.body.append(dialog);
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
    dialog.querySelector(".tenet-process-heading small").textContent = "TENET WORK HISTORY VIEWER";
    dialog.querySelector(".tenet-process-disclosure").textContent = "Open a Tenet history archive from your device. This viewer is read-only and makes no AI, school-account or upload requests. File consistency is not proof of student identity or independent work.";
    statusLine.textContent = "Try the synthetic sample or open an archive from your device.";
  }
  function message(text, error = false) {
    statusLine.textContent = text; statusLine.dataset.error = String(error); control.title = text;
  }
  function stopPlaying() {
    playing = false; playbackEpoch++; clearTimeout(playTimer); playTimer = null; find("play").textContent = "Play history";
  }
  function clearImage() {
    picture.hidden = true; picture.removeAttribute("src");
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  }
  function clearPrepared() {
    exportFile = null; find("download").hidden = true; find("share").hidden = true;
  }
  function eventTitle(event) {
    const titles = { "capture.started":"Recording began", "capture.paused":"Recording paused", "canvas.commit":"Canvas edit committed", "canvas.undo":"Edit undone", "canvas.redo":"Edit restored", "native.revision":"PencilKit revision received", "ai.request":"Question sent to Tenet", "ai.response":"Tenet reply observed", "ai.finished":"AI request finished", "coverage.gap":"Coverage gap recorded" };
    if (!event) return "No event selected";
    if ((event.assets || []).some(asset => /^image\/(png|jpeg)$/.test(asset.mime))) return "Page checkpoint";
    return Object.hasOwn(titles, event.type) ? titles[event.type] : String(event.type).replaceAll(".", " ");
  }
  function paintObservation(event, index) {
    value("event-label").textContent = sample ? "FICTIONAL EXAMPLE" : "LOCAL OBSERVATION";
    value("event-title").textContent = eventTitle(event);
    const data = event?.details || {};
    value("event-description").textContent = event?.type === "coverage.gap" ? String(data.reason || data.note || "Part of the work was not captured. Do not infer what happened during this gap.") : event?.type === "ai.response" ? "A reply was observed before canvas placement. This does not prove the student used or accepted it." : event?.type === "native.revision" ? "One accepted drawing revision was observed. It may contain multiple strokes or edits." : event?.type === "ai.request" ? "This is the locally observed question and scope, not a copy of the exact provider payload." : "Use the timeline to compare recorded page states. Device timestamps and gaps do not establish authorship, effort or outside help.";
    let request = null;
    const requestId = data.localRequestId;
    for (let cursor = index; cursor >= 0; cursor--) {
      const item = events[cursor];
      if (item?.type === "ai.request" && (!requestId || item.details?.localRequestId === requestId)) { request = item; break; }
    }
    const conversation = dialog.querySelector(".tenet-process-conversation");
    conversation.hidden = !request;
    value("question").textContent = ""; value("response").textContent = ""; value("ai-provenance").textContent = "";
    if (!request) return;
    const response = events.slice(0, index + 1).find(item => item.type === "ai.response" && item.details?.localRequestId === request.details?.localRequestId);
    value("question").textContent = request.details?.question || "No typed question captured. This request may have used handwriting or automatic context.";
    value("response").textContent = response ? response.details?.text || "Non-text output observed; inspect later page checkpoints and technical tool details." : "No reply observed yet at this point in the timeline.";
    value("ai-provenance").textContent = `Scope: ${request.details?.context?.scope || "not recorded"}. ${sample ? "Scripted example, not a live AI interaction." : "Local client evidence only; exact Gateway payload and policy are not attested."}${request.details?.questionTruncated || response?.details?.textTruncated ? " Some text was truncated during capture." : ""}`;
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
  async function renderEvent(index) {
    const token = ++generation; clearImage();
    index = Math.max(0, Math.min(Number(index) || 0, Math.max(0, events.length - 1)));
    const event = events[index];
    slider.value = String(index); value("position").textContent = `${event ? index + 1 : 0} / ${events.length}`;
    value("detail").textContent = event ? JSON.stringify({ event: event.type, sequence: event.sequence, recordedAt: new Date(event.clientWallTime).toLocaleString(), details: event.details }, null, 2) : "No events recorded.";
    paintObservation(event, index);
    dialog.querySelectorAll(".tenet-process-events button").forEach(button => button.setAttribute("aria-current", String(Number(button.dataset.index) === index)));
    let image = null;
    for (let cursor = index; cursor >= 0 && !image; cursor--) image = (events[cursor]?.assets || []).find(asset => asset.mime === "image/png" || asset.mime === "image/jpeg");
    value("preview").hidden = false; value("preview").textContent = image ? "Loading recorded checkpoint..." : "No rendered checkpoint at or before this event.";
    if (!image || !selected) return;
    const blob = await assetSource.getAsset(selected.id, image.hash);
    if (token !== generation || !dialog.open) return;
    if (!(blob instanceof Blob)) throw Error("This checkpoint attachment is unavailable. The event history is still readable.");
    imageUrl = URL.createObjectURL(blob); picture.src = imageUrl; picture.hidden = false; value("preview").hidden = true;
  }
  async function paintRecord() {
    dialog.querySelector(".tenet-process-empty").hidden = Boolean(selected);
    dialog.querySelector(".tenet-process-record").hidden = !selected;
    if (!selected) return;
    value("title").textContent = selected.title;
    const aiCount = events.filter(event => event.type.startsWith("ai.")).length;
    value("meta").textContent = `${selected.subject || "Assignment"} / ${events.length} events / ${aiCount} AI lifecycle events`;
    value("badge").textContent = sample ? "SYNTHETIC EXAMPLE" : imported ? "IMPORTED / UNVERIFIED" : String(selected.status).toUpperCase();
    value("coverage").textContent = `${sample ? "Fictional work and scripted AI replies. " : "Local observations, not server-attested evidence. "}Coalesced checkpoints, not full stroke playback. No verified student identity, assignment-rule enforcement or Schoology receipt.${selected.incomplete ? " Known gaps: " + (selected.coverageNotes || []).join(" ") : " Not proof of independent work."}`;
    value("checkpoints").textContent = String(events.filter(event => (event.assets || []).some(asset => /^image\/(png|jpeg)$/.test(asset.mime))).length);
    value("requests").textContent = String(events.filter(event => event.type === "ai.request").length);
    value("gaps").textContent = String(events.filter(event => event.type === "coverage.gap").length || (selected.incomplete ? "Recorded" : 0));
    slider.max = String(Math.max(0, events.length - 1)); slider.disabled = !events.length;
    const list = dialog.querySelector(".tenet-process-events"); list.replaceChildren();
    // Keep a long notebook from turning into thousands of live DOM controls.
    const start = Math.max(0, events.length - 150);
    value("timeline-note").textContent = start ? "Latest 150 events shown here. The playback slider covers the full history." : "Observed order and device times, not a measure of effort or authorship.";
    for (let index = start; index < events.length; index++) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.index = String(index);
      button.textContent = `${events[index].sequence}. ${eventTitle(events[index])}`;
      button.addEventListener("click", () => { stopPlaying(); void perform(() => renderEvent(index)); }); list.append(button);
    }
    paintActions(); await renderEvent(Math.max(0, events.length - 1));
  }
  async function selectAttempt(id) {
    const token = ++selectionEpoch, session = sessionEpoch;
    stopPlaying(); generation++; clearPrepared(); clearImage();
    const attempt = await journal.readAttempt(id), nextEvents = attempt ? await journal.listEvents(id) : [];
    if (token !== selectionEpoch || session !== sessionEpoch || !dialog.open) return;
    imported = false; sample = false; assetSource = journal; selected = attempt; events = nextEvents;
    await paintRecord(); await refreshLibrary();
  }
  async function tick(index, token) {
    if (!playing || !dialog.open || token !== playbackEpoch) return;
    try { await renderEvent(index); }
    catch (error) { if (token === playbackEpoch) { stopPlaying(); message(error.message, true); } return; }
    if (!playing || !dialog.open || token !== playbackEpoch) return;
    if (index >= events.length - 1) { stopPlaying(); return; }
    playTimer = setTimeout(() => void tick(index + 1, token), 1000);
  }
  async function prepareExport() {
    if (!selected || imported) return;
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
    void perform(async () => { await refreshLibrary(); if (session !== sessionEpoch || !dialog.open) return; if (!viewerOnly && capture()?.activeId()) await selectAttempt(capture().activeId()); else await paintRecord(); });
  });
  find("close").addEventListener("click", () => dialog.close());
  function retireView() { stopPlaying(); generation++; sessionEpoch++; selectionEpoch++; busyOwner++; dialog.dataset.busy = "false"; dialog.removeAttribute("aria-busy"); clearImage(); }
  dialog.addEventListener("close", retireView);
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
  find("play").addEventListener("click", () => {
    if (playing) { stopPlaying(); return; }
    if (!events.length || !dialog.open || dialog.dataset.busy === "true") return;
    playing = true; find("play").textContent = "Pause replay";
    const token = ++playbackEpoch;
    void tick(Number(slider.value) >= events.length - 1 ? 0 : Number(slider.value) + 1, token);
  });
  slider.addEventListener("input", () => { stopPlaying(); void renderEvent(Number(slider.value)).catch(error => message(error.message, true)); });
  const picker = dialog.querySelector('[data-file="archive"]');
  find("open").addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => void perform(async () => {
    const file = picker.files?.[0]; picker.value = ""; if (!file) return;
    const token = ++selectionEpoch, session = sessionEpoch;
    stopPlaying(); generation++; clearImage(); clearPrepared();
    message("Opening and checking archive consistency...");
    const bundle = await journal.readArchive(file);
    if (token !== selectionEpoch || session !== sessionEpoch || !dialog.open) return;
    selected = bundle.attempt; events = bundle.events; imported = true; sample = false; assetSource = bundle;
    await paintRecord(); if (session === sessionEpoch && dialog.open) message("Archive opened read-only. Internal consistency checked; identity and independent authorship are not verified.");
  }));
  find("sample").addEventListener("click", () => void perform(async () => {
    const token = ++selectionEpoch, session = sessionEpoch;
    stopPlaying(); generation++; clearImage(); clearPrepared();
    message("Preparing a fictional assignment. No recording or AI request is being started.");
    const bundle = await syntheticAssignment();
    if (token !== selectionEpoch || session !== sessionEpoch || !dialog.open) return;
    selected = bundle.attempt; events = bundle.events; imported = true; sample = true; assetSource = bundle;
    await paintRecord();
    if (session !== sessionEpoch || !dialog.open) return;
    await renderEvent(0);
    if (session === sessionEpoch && dialog.open) message("Synthetic example ready. Press Play history to follow the work and observed AI help. Your canvas is unchanged.");
  }));
  window.addEventListener("tenet:process-status", event => {
    control.dataset.recording = String(Boolean(capture()?.isRecording()));
    if (event.detail?.error) message(String(event.detail.error), true);
  });
  window.addEventListener("tenet:sign-out", () => { dialog.close(); retireView(); selected = null; events = []; assetSource = journal; imported = false; sample = false; clearPrepared(); value("detail").textContent = ""; value("question").textContent = ""; value("response").textContent = ""; dialog.querySelector(".tenet-process-list").replaceChildren(); dialog.querySelector(".tenet-process-events").replaceChildren(); void paintRecord(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlaying(); });
  window.addEventListener("pagehide", () => { retireView(); clearPrepared(); });
  if (viewerOnly) control.click();
})();
