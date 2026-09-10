// Native iPad audio only. No microphone stream enters the webview or Gateway.
(function initializeTenetVoice() {
  if (window.PENECHO_CONFIG?.tenetMode !== true || window.Capacitor?.getPlatform?.() !== "ios") return;
  const native = window.Capacitor?.Plugins?.TenetNative;
  if (!native) return;
  const reason = "tenet-voice-question", preference = "tenet.voice-replies.v1";
  const lifetime = new AbortController(), signal = lifetime.signal, listeners = [];
  let ui = null, capability = null, job = null, sequence = 0, guardTimer = 0;
  let phase = "idle", speaking = false, disposed = false;

  function message(text) { if (ui) ui.status.textContent = text; }
  function current(value) {
    return Boolean(value && job === value && !disposed && !document.hidden &&
      value.page === state.snapshotLoadGeneration);
  }
  function paint() {
    if (!ui) return;
    const recording = ["starting", "listening"].includes(phase);
    ui.record.textContent = recording ? "Stop listening" : "Record again";
    ui.record.disabled = !capability?.supported || ["starting", "finalizing", "sending"].includes(phase);
    ui.input.readOnly = recording || phase === "finalizing" || phase === "sending";
    ui.ask.disabled = !ui.input.value.trim() || ["starting", "finalizing", "sending"].includes(phase);
    ui.stop.hidden = !speaking;
    ui.entry.disabled = phase === "sending";
  }
  function quiet() {
    speaking = false;
    void native.stopSpeaking().catch(() => {});
    paint();
  }
  function stopGuard() { clearInterval(guardTimer); guardTimer = 0; }
  function cancel() {
    const previous = job;
    job = null;
    sequence++;
    phase = "idle";
    stopGuard();
    void native.cancelVoiceRecognition(previous ? {sessionId:previous.sessionId} : {}).catch(() => {});
    quiet();
    if (previous && (state.activeAI?.voiceRequestId === previous.id || aiPreparation?.voiceRequestId === previous.id))
      supersedeActiveAI("voice-cancelled");
    if (ui) { ui.input.value = ""; ui.preview.removeAttribute("src"); if (ui.dialog.open) ui.dialog.close(); }
    void tenetInkController?.resume(reason);
    paint();
  }
  function watch(value) {
    stopGuard();
    guardTimer = setInterval(() => { if (!current(value)) cancel(); }, 250);
  }
  async function record(value) {
    if (!current(value) || !capability?.supported) return;
    quiet();
    value.sessionId = crypto.randomUUID();
    phase = "starting";
    ui.input.value = "";
    message("Starting on-device dictation...");
    paint();
    try {
      await native.startVoiceRecognition({sessionId:value.sessionId, locale:capability.locale});
      if (!current(value)) { await native.cancelVoiceRecognition({sessionId:value.sessionId}); return; }
      phase = "listening";
      message("Listening on this iPad. Say, for example, Help me start problem 12.");
    } catch (error) {
      if (!current(value)) return;
      phase = "idle";
      message(error?.message || "On-device dictation is unavailable. You can type your question instead.");
    }
    paint();
  }
  async function finish(value) {
    if (!current(value) || !["starting", "listening"].includes(phase)) return;
    phase = "finalizing";
    paint();
    try {
      const result = await native.stopVoiceRecognition({sessionId:value.sessionId});
      if (current(value) && typeof result?.text === "string") ui.input.value = result.text.slice(0, 1000);
    } finally {
      if (current(value)) { phase = "idle"; message("Review your question, or tap Ask Tenet."); paint(); }
    }
  }
  async function capture(value, text) {
    await tenetInkFlush();
    if (!current(value)) throw Error("The page changed. Start a new voice question.");
    const revision = state.userRevision, generation = state.recognitionGeneration;
    const bounds = intersection(viewportRect(), {x:0,y:0,w:SIZE,h:SIZE});
    if (!bounds) throw Error("Move back onto the page before asking Tenet.");
    await prepareVisibleWidgetSnapshots(bounds);
    if (!current(value) || state.userRevision !== revision || state.recognitionGeneration !== generation)
      throw Error("The page changed. Start a new voice question.");
    const {x,y,w,h} = bounds;
    // A rectangular context selection requires no lasso gesture. It is explicitly
    // disclosed in the dialog and reuses the existing strict crop/question API.
    const packed = buildTenetRegionImage([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}], text);
    return {packed, revision, generation};
  }
  async function submit() {
    const value = job;
    if (!current(value) || ["starting", "finalizing", "sending"].includes(phase)) return;
    try {
      await finish(value);
      if (!current(value)) return;
      const text = ui.input.value.trim();
      if (!text || text.length > 1000) { message("Ask a question of up to 1,000 characters."); return; }
      phase = "sending";
      message("Sending your question and the visible page through your district Gateway...");
      paint();
      const {packed, revision, generation} = await capture(value, text);
      if (!current(value)) return;
      ui.dialog.close();
      ui.preview.removeAttribute("src");
      ui.input.value = "";
      await tenetInkController?.resume(reason);
      if (!current(value)) return;
      supersedeActiveAI("voice-question");
      await requestAI("answer", packed, {
        isolatedSelection:true, expectedRevision:revision, expectedGeneration:generation,
        voiceRequestId:value.id, isCurrent:() => current(value),
        onReply(reply) {
          if (!current(value) || !ui.reply.checked || !reply.trim()) return;
          void native.speakVoice({text:reply, locale:capability.locale}).catch(() => {
            if (current(value)) tenetInkMessage("The answer is on the canvas. Spoken playback is unavailable.");
          });
        },
      });
    } catch (error) {
      if (current(value)) {
        message(error?.message || "Voice question could not be sent. Please try again.");
        tenetInkMessage(error?.message || "Voice question could not be sent.");
      }
    } finally {
      if (current(value)) { phase = "idle"; paint(); if (!speaking && !ui.dialog.open) stopGuard(); }
    }
  }
  async function open() {
    if (state.busy || state.pending || state.pendingWidget || state.drawing) {
      tenetInkMessage("Finish the current drawing or AI draft before starting a voice question."); return;
    }
    cancel();
    tenetCanvasAI?.close();
    clearTimeout(state.timer); state.timer = 0;
    document.activeElement?.blur();
    const value = {id:++sequence, sessionId:crypto.randomUUID(), page:state.snapshotLoadGeneration};
    job = value;
    ui.dialog.showModal();
    watch(value);
    message("Your question and the visible page are sent only when you tap Ask Tenet.");
    try {
      await tenetInkController?.suspend(reason);
      if (!current(value)) { await tenetInkController?.resume(reason); return; }
      const preview = await capture(value, "");
      if (!current(value)) return;
      ui.preview.src = preview.packed.atlasImage;
      if (capability.supported) await record(value);
      else { message(capability.reason || "On-device dictation is unavailable for this language. Type below instead."); ui.input.focus(); }
    } catch (error) { if (current(value)) { message(error?.message || "Unable to prepare the visible page."); paint(); } }
  }
  async function activate() {
    try { capability = await native.getVoiceCapabilities({locale:navigator.language}); }
    catch { return; } // Older TestFlight binaries have no voice bridge.
    if (disposed) return;
    const toolbar = document.querySelector("[data-tenet-ink-toolbar], .toolbar");
    if (!toolbar) return;
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/tenet-voice.css"; document.head.append(link);
    const group = document.createElement("div"); group.className = "tenet-voice-entry";
    group.innerHTML = '<button type="button" data-voice="open" aria-haspopup="dialog">Talk to Tenet</button><button type="button" data-voice="stop" hidden>Stop voice</button>';
    const dialog = document.createElement("dialog"); dialog.className = "tenet-voice-dialog";
    dialog.setAttribute("aria-labelledby", "tenetVoiceTitle");
    dialog.innerHTML = '<form><header><span>ON THIS IPAD</span><h2 id="tenetVoiceTitle">Talk to Tenet</h2><p>No circle needed. Try: Help me start problem 12.</p></header><p class="tenet-voice-privacy">Audio stays on this iPad. Ask Tenet sends your transcript and this visible page to your district Gateway. Off-screen work is not included.</p><img alt="Visible page included with your question"><label for="tenetVoiceQuestion">Your question</label><textarea id="tenetVoiceQuestion" maxlength="1000" rows="3" placeholder="Help me start problem 12"></textarea><p data-voice="status" role="status" aria-live="polite"></p><label class="tenet-voice-reply"><input type="checkbox" data-voice="reply"> Read Tenet\'s reply aloud <small>The written answer still appears on the canvas.</small></label><footer><button type="button" data-voice="cancel">Cancel</button><button type="button" data-voice="record">Record again</button><button type="submit" data-voice="ask">Ask Tenet</button></footer></form>';
    document.body.append(dialog); toolbar.prepend(group);
    const find = (root, name) => root.querySelector(`[data-voice="${name}"]`);
    ui = {group,dialog, entry:find(group,"open"),stop:find(group,"stop"),record:find(dialog,"record"),
      ask:find(dialog,"ask"),reply:find(dialog,"reply"),status:find(dialog,"status"),
      input:dialog.querySelector("textarea"),preview:dialog.querySelector("img")};
    try { ui.reply.checked = localStorage.getItem(preference) === "true"; } catch {}
    ui.entry.addEventListener("click", () => { void open(); }, {signal});
    ui.stop.addEventListener("click", quiet, {signal});
    ui.record.addEventListener("click", () => { void (phase === "listening" ? finish(job) : record(job)).catch(error => message(error?.message || "Dictation stopped.")); }, {signal});
    ui.input.addEventListener("input", paint, {signal});
    ui.reply.addEventListener("change", () => { try { localStorage.setItem(preference, String(ui.reply.checked)); } catch {} if (!ui.reply.checked) quiet(); }, {signal});
    dialog.querySelector("form").addEventListener("submit", event => { event.preventDefault(); void submit(); }, {signal});
    find(dialog,"cancel").addEventListener("click", cancel, {signal});
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); }, {signal});
    dialog.addEventListener("close", () => { if (!dialog.open && phase !== "sending" && job) cancel(); }, {signal});
    for (const [name, handler] of [
      ["voiceTranscript", event => {
        if (!current(job) || event.sessionId !== job.sessionId || !["starting","listening","finalizing"].includes(phase)) return;
        if (typeof event.text === "string") ui.input.value = event.text.slice(0, 1000);
        paint();
      }],
      ["voiceState", event => {
        if (!current(job) || event.sessionId !== job.sessionId || phase === "sending") return;
        if (["error","cancelled","stopped"].includes(event.state) && phase !== "finalizing") {
          phase = "idle"; message(event.message || "Dictation stopped. Review your question and tap Ask Tenet."); paint();
        }
      }],
      ["voicePlayback", event => {
        if (event.state === "speaking" && !current(job)) { quiet(); return; }
        speaking = event.state === "speaking"; paint();
        if (!speaking && phase === "idle" && !ui.dialog.open) stopGuard();
      }],
    ]) {
      const handle = await native.addListener(name, handler);
      if (disposed) { await handle.remove(); return; }
      listeners.push(handle);
    }
    paint();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); }, {signal});
  window.addEventListener("tenet:sign-out", cancel, {signal});
  window.addEventListener("pagehide", event => {
    cancel();
    if (!event.persisted) { disposed = true; lifetime.abort(); for (const listener of listeners) void listener.remove(); }
  }, {signal});
  function launch() { void activate().catch(() => { cancel(); ui?.group.remove(); ui?.dialog.remove(); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch, {once:true,signal});
  else launch();
})();
