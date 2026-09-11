// Native iPad audio only. No microphone stream enters the webview or Gateway.
var tenetVoice = null;
(function initializeTenetVoice() {
  if (window.PENECHO_CONFIG?.tenetMode !== true || window.Capacitor?.getPlatform?.() !== "ios") return;
  const native = window.Capacitor?.Plugins?.TenetNative;
  if (!native) return;
  const reason = "tenet-voice-question", preference = "tenet.voice-replies.v1";
  const lifetime = new AbortController(), signal = lifetime.signal, listeners = [];
  let ui = null, capability = null, job = null, sequence = 0, guardTimer = 0;
  let phase = "idle", speaking = false, disposed = false, listenersReady = false;

  function voicePopoverBounds(entry, viewport, layoutWidth, contentHeight = 320) {
    if (!entry || !viewport || !Number.isFinite(layoutWidth) || layoutWidth <= 0 ||
        !Number.isFinite(viewport.width) || viewport.width <= 0 ||
        !Number.isFinite(viewport.height) || viewport.height <= 0) return null;
    const offsetLeft = Number.isFinite(viewport.offsetLeft) ? Math.max(0, viewport.offsetLeft) : 0;
    const offsetTop = Number.isFinite(viewport.offsetTop) ? Math.max(0, viewport.offsetTop) : 0;
    const visibleWidth = Math.min(viewport.width, layoutWidth - offsetLeft);
    if (visibleWidth <= 0) return null;
    const edge = Math.min(12, visibleWidth / 4, viewport.height / 4);
    const left = offsetLeft + edge, right = offsetLeft + visibleWidth - edge;
    const top = offsetTop + edge, bottom = offsetTop + viewport.height - edge;
    const width = Math.min(360, right - left);
    const height = Math.min(520, bottom - top,
      Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : 320);
    const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
    const below = clamp((Number.isFinite(entry.bottom) ? entry.bottom : top) + 8, top, bottom);
    const above = clamp((Number.isFinite(entry.top) ? entry.top : top) - 8, top, bottom);
    const useAbove = bottom - below < Math.min(height, 240) && above - top > bottom - below;
    const popoverTop = useAbove ? Math.max(top, above - height) : below;
    const popoverBottom = useAbove ? above : bottom;
    const popoverRight = clamp(Number.isFinite(entry.right) ? entry.right : right, left + width, right);
    return {
      top: popoverTop,
      right: Math.max(0, layoutWidth - popoverRight),
      maxWidth: width,
      availableHeight: Math.min(520, popoverBottom - popoverTop),
      bottom: popoverBottom
    };
  }

  function positionPopover() {
    if (disposed || !ui?.dialog.open || typeof ui.entry.getBoundingClientRect !== "function" ||
        typeof runtimeElementStyle !== "function") return;
    const layoutWidth = document.documentElement?.clientWidth || window.innerWidth;
    const viewport = window.visualViewport || {
      width: layoutWidth, height: window.innerHeight || document.documentElement?.clientHeight,
      offsetLeft: 0, offsetTop: 0
    };
    const bounds = voicePopoverBounds(ui.entry.getBoundingClientRect(), viewport, layoutWidth,
      ui.dialog.scrollHeight + 2);
    if (!bounds) return;
    // The dialog is fixed-position: rects and visualViewport offsets share the
    // layout viewport. CSS right is the inset from that viewport's right edge.
    const style = runtimeElementStyle(ui.dialog, "tenet-voice-popover");
    if (!style) return;
    style.setProperty("--tenet-voice-popover-top", `max(${bounds.top}px, env(safe-area-inset-top, 0px))`);
    style.setProperty("--tenet-voice-popover-right", `max(${bounds.right}px, env(safe-area-inset-right, 0px))`);
    style.setProperty("--tenet-voice-popover-available-height",
      `max(0px, min(${bounds.availableHeight}px, calc(${bounds.bottom}px - var(--tenet-voice-popover-top) - env(safe-area-inset-bottom, 0px))))`);
    style.setProperty("max-width",
      `max(0px, calc(${bounds.maxWidth}px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))`);
  }

  function message(text) { if (ui) ui.status.textContent = text; }
  async function boundedVoiceCall(operation, milliseconds, failureMessage) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error(failureMessage)), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }
  function listening(value) {
    if (!isOpenVoiceJob(value, value?.sessionId) || phase !== "starting") return;
    phase = "listening";
    message(supportsSilenceAutoSubmit()
      ? capability?.autoSubmitTrigger === "transcript-inactivity"
        ? "Listening on this iPad. Sends 1.5 seconds after the last new transcribed word. Stop listening to review instead."
        : "Listening on this iPad. Pause for 1.5 full seconds to send. Stop listening to review instead."
      : "Listening on this iPad. Stop to review, or tap Ask Tenet to send.");
    paint();
  }
  function cancelRecordingAttempt(value) {
    if (!isOpenVoiceJob(value, value?.sessionId)) return;
    const previousId = value.sessionId;
    // Retire the attempt before issuing asynchronous cancellation. Its late
    // capability/start/stop callbacks must not restart capture or change UI.
    value.sessionId = crypto.randomUUID();
    value.autoSubmitArmed = false;
    value.finalTranscript = null;
    phase = "idle";
    void native.cancelVoiceRecognition({sessionId:previousId}).catch(() => {});
    message("Recording stopped. Tap Record again, or type your question.");
    paint();
  }
  function current(value) {
    return Boolean(value && job === value && !disposed && !document.hidden &&
      value.page === state.snapshotLoadGeneration);
  }
  function isOpenVoiceJob(value, sessionId) {
    return current(value) && ui?.dialog.open === true && value.sessionId === sessionId;
  }
  function supportsSilenceAutoSubmit() {
    return capability?.supportsSilenceAutoSubmit === true && capability.autoSubmitSilenceSeconds === 1.5;
  }
  function disclose(value) {
    const context = value.selection, autoSend = supportsSilenceAutoSubmit();
    const transcriptPause = capability?.autoSubmitTrigger === "transcript-inactivity";
    const pause = transcriptPause ? "1.5 seconds without a new transcribed word" : "1.5 full seconds of silence";
    ui.heading.textContent = context ? "Talk about your selection" : "Talk to Tenet";
    ui.timing.textContent = autoSend
      ? transcriptPause ? "Sends after 1.5 seconds without a new word" : "Sends after 1.5 seconds of silence"
      : "Manual send. Update the iPad app for silence sending.";
    ui.privacy.textContent = autoSend
      ? context
        ? `Your transcript and only the circled pixels are sent to your district Gateway after ${pause}. Audio stays on this iPad. Stop or cancel to prevent automatic sending.`
        : `Your transcript and the visible page are sent to your district Gateway after ${pause}. Audio stays on this iPad. Off-screen work is not included. Stop or cancel to prevent automatic sending.`
      : context
        ? "Tap Ask Tenet to send your transcript and only the circled pixels to your district Gateway. Audio stays on this iPad."
        : "Tap Ask Tenet to send your transcript and visible page to your district Gateway. Audio stays on this iPad. Off-screen work is not included.";
    ui.preview.alt = context ? "Circled area included with your question" : "Visible page included with your question";
  }
  function paint() {
    if (!ui) return;
    const recording = ["starting", "listening"].includes(phase);
    ui.record.textContent = phase === "starting" ? "Cancel starting"
      : phase === "finalizing" ? "Cancel finishing"
      : recording ? "Stop listening" : "Record again";
    // Readiness/permissions can change after launch. A retry must reach native
    // capability checks rather than remain disabled by an old snapshot.
    ui.record.disabled = !listenersReady || !job || Boolean(job?.submitting) || phase === "sending";
    ui.input.readOnly = recording || phase === "finalizing" || phase === "sending";
    ui.ask.disabled = !ui.input.value.trim() || Boolean(job?.submitting) || ["starting", "finalizing", "sending"].includes(phase);
    ui.stop.hidden = !speaking;
    ui.entry.disabled = !listenersReady || phase === "sending";
    ui.entry.setAttribute("data-voice-phase", phase);
    ui.entry.setAttribute("aria-expanded", String(ui.dialog.open));
  }
  function quiet() {
    speaking = false;
    void native.stopSpeaking().catch(() => {});
    paint();
  }
  function stopGuard() { clearInterval(guardTimer); guardTimer = 0; }
  function cancel() {
    const previous = job;
    if (previous) { previous.autoSubmitArmed = false; previous.finalTranscript = null; }
    job = null;
    sequence++;
    phase = "idle";
    stopGuard();
    // Never enqueue an unscoped cancellation that could arrive after a new start.
    if (previous) void native.cancelVoiceRecognition({sessionId:previous.sessionId}).catch(() => {});
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
    if (!listenersReady || !isOpenVoiceJob(value, value?.sessionId) || value.submitting || phase !== "idle") return;
    quiet();
    const recordingSessionId = crypto.randomUUID();
    value.sessionId = recordingSessionId;
    value.autoSubmitArmed = false;
    value.finalTranscript = null;
    value.autoSubmittedSessionId = null;
    phase = "starting";
    ui.input.value = "";
    message("Starting on-device dictation...");
    paint();
    try {
      const refreshed = await boundedVoiceCall(native.getVoiceCapabilities({locale:navigator.language}), 10000,
        "Microphone readiness timed out. Tap Record again to retry, or type your question.");
      if (!isOpenVoiceJob(value, recordingSessionId) || phase !== "starting") return;
      capability = refreshed;
      disclose(value);
      if (!capability?.supported) {
        phase = "idle";
        message(capability?.reason || "On-device dictation is unavailable. Check microphone and speech permissions, then tap Record again.");
        ui.input.focus();
        paint();
        return;
      }
      value.autoSubmitArmed = supportsSilenceAutoSubmit();
      const permissionsGranted = capability.microphonePermission === "granted" && capability.speechPermission === "authorized";
      const result = await boundedVoiceCall(native.startVoiceRecognition({sessionId:recordingSessionId, locale:capability.locale}),
        permissionsGranted ? 15000 : 95000,
        "The microphone did not start. Tap Record again to retry, or type your question.");
      if (!isOpenVoiceJob(value, recordingSessionId)) { await native.cancelVoiceRecognition({sessionId:recordingSessionId}); return; }
      if (phase === "starting") {
        if (capability.confirmsAudioInput === true && (result?.state !== "listening" || result.audioInput !== true))
          throw Error("The iPad did not confirm microphone input. Tap Record again to retry.");
        listening(value);
      }
    } catch (error) {
      if (!isOpenVoiceJob(value, recordingSessionId)) return;
      value.autoSubmitArmed = false;
      value.sessionId = crypto.randomUUID();
      void native.cancelVoiceRecognition({sessionId:recordingSessionId}).catch(() => {});
      phase = "idle";
      message(error?.message || "On-device dictation is unavailable. You can type your question instead.");
    }
    paint();
  }
  async function finish(value) {
    if (!isOpenVoiceJob(value, value?.sessionId)) return;
    value.autoSubmitArmed = false;
    if (!["starting", "listening"].includes(phase)) return;
    const recordingSessionId = value.sessionId;
    phase = "finalizing";
    paint();
    try {
      const result = await boundedVoiceCall(native.stopVoiceRecognition({sessionId:recordingSessionId}), 6000,
        "Transcription did not finish. Your text is retained; record again or send it manually.");
      if (isOpenVoiceJob(value, recordingSessionId) && typeof result?.text === "string") ui.input.value = result.text.slice(0, 1000);
    } catch (error) {
      if (isOpenVoiceJob(value, recordingSessionId)) {
        value.sessionId = crypto.randomUUID();
        phase = "idle";
        void native.cancelVoiceRecognition({sessionId:recordingSessionId}).catch(() => {});
        message(error?.message || "Dictation stopped. Record again or type your question.");
        paint();
      }
      throw error;
    } finally {
      if (isOpenVoiceJob(value, recordingSessionId)) { phase = "idle"; message("Review your question, or tap Ask Tenet."); paint(); }
    }
  }
  async function capture(value, text) {
    await tenetInkFlush();
    if (!current(value)) throw Error("The page changed. Start a new voice question.");
    const revision = state.userRevision, generation = state.recognitionGeneration;
    const selection = value.selection;
    if (selection && (selection.revision !== revision || selection.generation !== generation || selection.page !== state.snapshotLoadGeneration))
      throw Error("The selected work changed. Circle it again before asking Tenet.");
    const bounds = selection ? tenetRegionGeometry(selection.points) : intersection(viewportRect(), {x:0,y:0,w:SIZE,h:SIZE});
    if (!bounds) throw Error("Move back onto the page before asking Tenet.");
    await prepareVisibleWidgetSnapshots(bounds);
    if (!current(value) || state.userRevision !== revision || state.recognitionGeneration !== generation)
      throw Error("The page changed. Start a new voice question.");
    const {x,y,w,h} = bounds;
    // A rectangular context selection requires no lasso gesture. It is explicitly
    // disclosed in the dialog and reuses the existing strict crop/question API.
    const packed = buildTenetRegionImage(selection ? selection.points : [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}], text);
    if (!selection && !packed.questionOnly) {
      packed.visibleRect = {...bounds};
      if (text) packed.questionScope = "visible-page";
    }
    return {packed, revision, generation};
  }
  async function submit() {
    const value = job;
    if (!isOpenVoiceJob(value, value?.sessionId) || value.submitting || ["starting", "finalizing", "sending"].includes(phase)) return;
    const submissionSessionId = value.sessionId;
    value.submitting = true;
    value.autoSubmitArmed = false;
    try {
      await finish(value);
      if (!isOpenVoiceJob(value, submissionSessionId)) return;
      const text = ui.input.value.trim();
      if (!text || text.length > 1000) { message("Ask a question of up to 1,000 characters."); return; }
      phase = "sending";
      message(value.selection ? "Sending your question and only the circled area through your district Gateway..." : "Sending your question and the visible page through your district Gateway...");
      paint();
      const {packed, revision, generation} = await capture(value, text);
      if (!current(value)) return;
      if (packed.questionOnly) tenetInkMessage("Blank page: sending only your question, without an image.");
      ui.dialog.close();
      ui.preview.removeAttribute("src");
      ui.input.value = "";
      await tenetInkController?.resume(reason);
      if (!current(value)) return;
      supersedeActiveAI("voice-question");
      await requestAI("hint", packed, {
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
      value.submitting = false;
      if (current(value)) { phase = "idle"; paint(); if (!speaking && !ui.dialog.open) stopGuard(); }
    }
  }
  function handleVoiceTranscript(event) {
    const value = job;
    if (!isOpenVoiceJob(value, event.sessionId) || !["starting","listening","finalizing"].includes(phase)) return;
    if (typeof event.text === "string") {
      ui.input.value = event.text.slice(0, 1000);
      value.finalTranscript = event.isFinal === true && event.text.length <= 1000
        ? {sessionId:event.sessionId, text:event.text} : null;
    }
    paint();
  }
  function handleVoiceState(event) {
    const value = job;
    if (!isOpenVoiceJob(value, event.sessionId) || value.submitting || phase === "sending"
        || value.autoSubmittedSessionId === event.sessionId) return;
    if (event.state === "listening") { listening(value); return; }
    if (event.state === "finalizing" && ["starting","listening","finalizing"].includes(phase)) {
      phase = "finalizing";
      message("Finishing on-device transcription...");
      paint();
      return;
    }
    if (!["error","cancelled","stopped"].includes(event.state)) return;
    // New native builds deliver final text with the terminal event. Do not
    // depend on ordering between two distinct Capacitor notifications, and do
    // not fall back to older text if an explicit terminal payload is invalid.
    const hasTerminalText = "text" in event || "isFinal" in event;
    const final = hasTerminalText
      ? event.isFinal === true && typeof event.text === "string" && event.text.length <= 1000
        ? {sessionId:event.sessionId, text:event.text} : null
      : value.finalTranscript;
    const expectedReason = capability?.autoSubmitTrigger === "transcript-inactivity" ? "transcript-pause" : "silence";
    const autoSubmit = supportsSilenceAutoSubmit() && event.state === "stopped" && event.reason === expectedReason && value.autoSubmitArmed
      && ["starting","listening","finalizing"].includes(phase)
      && final?.sessionId === event.sessionId && final.text.trim().length > 0;
    value.autoSubmitArmed = false;
    phase = "idle";
    if (autoSubmit) {
      value.autoSubmittedSessionId = event.sessionId;
      ui.input.value = final.text;
      message("Pause complete. Sending your question...");
      // Only the native terminal event for the advertised pause trigger may
      // enter this path. Native owns finalization and the inactivity timer.
      void submit();
    } else {
      message(event.message || (event.reason === "no-speech"
        ? "No question heard. Record again or type below."
        : "Dictation stopped. Review your question and tap Ask Tenet."));
    }
    paint();
  }
  async function open(selection = null) {
    if (!listenersReady) { tenetInkMessage("Connecting the microphone controls. Please try again in a moment."); return; }
    if (state.busy || state.pending || state.pendingWidget || state.drawing) {
      tenetInkMessage("Finish the current drawing or AI draft before starting a voice question."); return;
    }
    let context;
    try { context = selection || tenetCanvasAI?.voiceContext?.() || null; }
    catch (error) { tenetInkMessage(error.message); return; }
    cancel();
    tenetCanvasAI?.close();
    clearTimeout(state.timer); state.timer = 0;
    document.activeElement?.blur();
    const value = {id:++sequence, sessionId:crypto.randomUUID(), page:state.snapshotLoadGeneration, selection:context};
    job = value;
    disclose(value);
    ui.previewStatus.textContent = "Preparing the page preview...";
    ui.dialog.show();
    paint();
    watch(value);
    // Opening Talk and pressing Record again use the same recorder. Optional
    // layout must not throw before that recorder or its controls can start.
    const recording = record(value);
    try { positionPopover(); }
    catch { ui.previewStatus.textContent = "Popup layout unavailable. You can still dictate or type your question."; }
    // Preview generation can wait for native ink or widget snapshots. It is
    // optional UI work, not a microphone prerequisite; submit still performs
    // the authoritative, revision-checked capture before anything is sent.
    void (async () => {
      try {
        await tenetInkController?.suspend(reason);
        if (!current(value)) return;
        const preview = await capture(value, "");
        if (!isOpenVoiceJob(value, value.sessionId) || value.submitting) return;
        ui.preview.src = preview.packed.atlasImage;
        ui.previewStatus.textContent = "";
      } catch {
        if (isOpenVoiceJob(value, value.sessionId) && !value.submitting)
          ui.previewStatus.textContent = "Preview unavailable. Tenet will retry the same page or selected area before sending.";
      }
    })();
    await recording;
  }
  async function activate() {
    try { capability = await boundedVoiceCall(native.getVoiceCapabilities({locale:navigator.language}), 10000, "Microphone controls are unavailable."); }
    catch { return; } // Older TestFlight binaries have no voice bridge.
    if (disposed) return;
    const viewport = document.querySelector("#viewport");
    if (!viewport) return;
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/tenet-voice.css"; document.head.append(link);
    const group = document.createElement("div"); group.className = "tenet-voice-entry";
    group.innerHTML = '<button type="button" data-voice="open" aria-label="Talk to Tenet" title="Talk to Tenet" aria-haspopup="dialog" aria-controls="tenetVoicePopover" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="3" width="6" height="11" rx="3"/><path d="M3 10v1a6 6 0 0 0 12 0v-1M9 17v4M6 21h6"/><path class="tenet-mic-wave" d="M19 7v10"/><path class="tenet-mic-wave" d="M22 10v4"/></svg></button><button type="button" data-voice="stop" hidden>Stop voice</button>';
    const dialog = document.createElement("dialog"); dialog.className = "tenet-voice-dialog tenet-voice-popover";
    dialog.id = "tenetVoicePopover";
    dialog.setAttribute("aria-labelledby", "tenetVoiceTitle");
    dialog.innerHTML = '<form><header><h2 id="tenetVoiceTitle">Talk to Tenet</h2><button type="button" data-voice="cancel">Cancel</button></header><p class="tenet-voice-timing" data-voice="timing">Tap Ask Tenet to send</p><p class="tenet-voice-privacy">Audio stays on this iPad.</p><label for="tenetVoiceQuestion">Your question</label><textarea id="tenetVoiceQuestion" maxlength="1000" rows="2" placeholder="Help me start problem 12"></textarea><p data-voice="status" role="status" aria-live="polite"></p><details data-voice="details" class="tenet-voice-details"><summary>Page preview and voice settings</summary><img alt="Visible page included with your question"><label class="tenet-voice-reply"><input type="checkbox" data-voice="reply"> Read Tenet\'s reply aloud <small>The written answer still appears on the canvas.</small></label></details><footer><button type="button" data-voice="record">Record again</button><button type="submit" data-voice="ask">Ask Tenet</button></footer></form>';
    group.append(dialog); viewport.append(group);
    const find = (root, name) => root.querySelector(`[data-voice="${name}"]`);
    ui = {group,dialog, entry:find(group,"open"),stop:find(group,"stop"),record:find(dialog,"record"),
      ask:find(dialog,"ask"),reply:find(dialog,"reply"),status:find(dialog,"status"),
      input:dialog.querySelector("textarea"),preview:dialog.querySelector("img"),
      heading:dialog.querySelector("h2"),privacy:dialog.querySelector(".tenet-voice-privacy"),timing:find(dialog,"timing")};
    ui.entry.disabled = true;
    ui.previewStatus = document.createElement("p");
    ui.previewStatus.className = "tenet-voice-preview-status";
    find(dialog,"details").append(ui.previewStatus);
    const voiceQuality = document.createElement("p");
    voiceQuality.className = "tenet-voice-quality";
    voiceQuality.textContent = capability.voiceName
      ? `Voice: ${capability.voiceName} (${capability.voiceQuality || "standard"}). `
      : "Using an installed iPad voice. ";
    if (!capability.voiceName || capability.voiceNeedsDownload)
      voiceQuality.textContent += "For a more natural voice, download an Enhanced or Premium voice in Settings > Accessibility > Read & Speak > Voices (Spoken Content on older iPads).";
    find(dialog,"details").append(voiceQuality);
    tenetVoice = {openSelection:selection => open(selection)};
    try { ui.reply.checked = localStorage.getItem(preference) === "true"; } catch {}
    window.addEventListener("resize", positionPopover, {passive:true,signal});
    window.addEventListener("scroll", positionPopover, {capture:true,passive:true,signal});
    window.visualViewport?.addEventListener?.("resize", positionPopover, {passive:true,signal});
    window.visualViewport?.addEventListener?.("scroll", positionPopover, {passive:true,signal});
    ui.preview.addEventListener("load", positionPopover, {signal});
    dialog.addEventListener("toggle", positionPopover, {capture:true,signal});
    ui.entry.addEventListener("click", () => { void open(); }, {signal});
    ui.stop.addEventListener("click", quiet, {signal});
    ui.record.addEventListener("click", () => {
      if (["starting", "finalizing"].includes(phase)) { cancelRecordingAttempt(job); return; }
      void (phase === "listening" ? finish(job) : record(job)).catch(error => message(error?.message || "Dictation stopped."));
    }, {signal});
    ui.input.addEventListener("input", () => {
      if (job) { job.autoSubmitArmed = false; job.finalTranscript = null; }
      paint();
    }, {signal});
    ui.reply.addEventListener("change", () => { try { localStorage.setItem(preference, String(ui.reply.checked)); } catch {} if (!ui.reply.checked) quiet(); }, {signal});
    dialog.querySelector("form").addEventListener("submit", event => { event.preventDefault(); void submit(); }, {signal});
    find(dialog,"cancel").addEventListener("click", cancel, {signal});
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); }, {signal});
    dialog.addEventListener("close", () => { if (!dialog.open && phase !== "sending" && job) cancel(); }, {signal});
    document.addEventListener("pointerdown", event => {
      if (dialog.open && !group.contains(event.target)) cancel();
    }, {capture:true,signal});
    document.addEventListener("keydown", event => {
      if (dialog.open && event.key === "Escape") { event.preventDefault(); cancel(); }
    }, {signal});
    for (const [name, handler] of [
      ["voiceTranscript", handleVoiceTranscript],
      ["voiceState", handleVoiceState],
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
    listenersReady = true;
    paint();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); }, {signal});
  window.addEventListener("tenet:sign-out", cancel, {signal});
  window.addEventListener("pagehide", event => {
    cancel();
    if (!event.persisted) { disposed = true; tenetVoice = null; lifetime.abort(); for (const listener of listeners) void listener.remove(); }
  }, {signal});
  function launch() { void activate().catch(() => { cancel(); ui?.group.remove(); ui?.dialog.remove(); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch, {once:true,signal});
  else launch();
})();
