// This module lives INSIDE the canvas closure. Only the bounded comparison API
// is public; drawing archives never enter AI prompts, telemetry, or Gateway calls.
  var tenetInkController = null;
  let tenetInkMessageTimer = 0;
  function tenetInkMessage(message) {
    let toast = document.getElementById("tenetInkToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tenetInkToast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    toast.textContent = String(message);
    toast.hidden = false;
    clearTimeout(tenetInkMessageTimer);
    tenetInkMessageTimer = setTimeout(() => { toast.hidden = true; }, 7000);
  }
  function tenetInkBounds(region = null) {
    const bounds = tenetInkController?.snapshot()?.bounds;
    return bounds ? region ? intersection(bounds, region) : { ...bounds } : null;
  }
  function tenetInkManifestExtensions() {
    const extensions = { ...state.currentSnapshotManifestExtensions };
    if (!tenetInkController) return snapshotExtensionObject(extensions);
    const drawing = tenetInkController?.snapshot();
    if (drawing) extensions.tenetNativeInk = drawing;
    else delete extensions.tenetNativeInk;
    return snapshotExtensionObject(extensions);
  }
  async function tenetInkFlush() {
    await tenetInkController?.flush();
  }

  (function initializeTenetMainCanvasInk() {
    if (window.PENECHO_CONFIG?.tenetMode !== true) return;
    const native = window.Capacitor?.Plugins?.TenetNative;
    const available = window.Capacitor?.getPlatform?.() === "ios"
      && typeof native?.configureInkSurface === "function";
    const ARCHIVE_CHARS = Math.ceil(16 * 1024 * 1024 / 3) * 4;
    const PREVIEW_CHARS = Math.ceil(12 * 1024 * 1024 / 3) * 4 + 32;
    const HISTORY_CHARS = 64 * 1024 * 1024;
    let engine = "web", ready = false, stopped = false, active = false;
    let sessionId = crypto.randomUUID(), nativeSession = null, revision = -1;
    let drawing = null, preview = null, visible = false, lock = 0;
    let wire = Promise.resolve(), reception = Promise.resolve(), syncFrame = 0;
    let syncPending = false, syncAgain = false, lastConfiguration = "", restoreImage = null;
    let nativeToolKey = "", nativeToolWidth = 4, receiveError = null, toolRequestId = 0;
    let fingerDrawing = false, lastError = "", reportTimer = 0;
    const suspended = new Set(), listeners = [];
    const lifetime = new AbortController();
    const signal = lifetime.signal;

    function status() {
      return { engine, busy:active || lock > 0, nativeAvailable:ready,
        strokeCount:engine === "pencilkit" ? drawing?.strokeCount || 0 : null };
    }
    function emitStatus() {
      window.dispatchEvent(new CustomEvent("tenet:ink-status", { detail:status() }));
    }
    function fail(error) {
      const message = String(error?.message || error || "Native ink could not be synchronized.");
      if (message === lastError) return;
      lastError = message;
      clearTimeout(reportTimer);
      tenetInkMessage(message);
      reportTimer = setTimeout(() => { lastError = ""; }, 4000);
    }
    function serial(operation) {
      const job = wire.then(operation);
      wire = job.catch(() => {});
      return job;
    }
    function normalize(record) {
      if (record == null) return null;
      if (record.version !== undefined && record.version !== 1) throw Error("This page uses a newer native ink format. Its original data has not been changed.");
      const data = record.drawingData;
      if (typeof data !== "string" || !data.length || data.length > ARCHIVE_CHARS
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error("The page's native ink archive is invalid or too large.");
      const count = Number(record.strokeCount);
      if (!Number.isSafeInteger(count) || count < 0) throw Error("The page's native stroke count is invalid.");
      let bounds = null, dataUrl = null;
      if (count) {
        const box = record.bounds;
        if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)
            || box.w <= 0 || box.h <= 0 || box.x < -SIZE || box.y < -SIZE
            || box.x + box.w > SIZE * 2 || box.y + box.h > SIZE * 2) throw Error("The page's native ink bounds are invalid.");
        dataUrl = record.previewDataUrl;
        if (typeof dataUrl !== "string" || dataUrl.length > PREVIEW_CHARS
            || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw Error("The page's native ink preview is invalid or too large.");
        bounds = { x:box.x, y:box.y, w:box.w, h:box.h };
      }
      return { version:1, drawingData:data, previewDataUrl:dataUrl, bounds, strokeCount:count };
    }
    async function prepare(record) {
      const value = normalize(record);
      let image = null;
      if (value?.previewDataUrl) {
        image = new Image();
        const loaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(Error("The native ink preview could not be decoded. The current page was kept."));
        });
        image.src = value.previewDataUrl;
        await loaded;
        image.onload = image.onerror = null;
        if (image.naturalWidth > 4096 || image.naturalHeight > 4096
            || image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) throw Error("The native ink preview exceeds the supported image size.");
      }
      return { drawing:value, preview:image };
    }
    function install(prepared) {
      sessionId = crypto.randomUUID();
      revision = -1;
      receiveError = null;
      drawing = prepared?.drawing || null;
      preview = prepared?.preview || null;
      active = false;
      visible = false;
      lastConfiguration = "";
      state.tenetNativeHistoryBefore = undefined;
      state.currentSnapshotManifestExtensions = tenetInkManifestExtensions();
      scheduleSync();
      requestCommittedInkRender();
      emitStatus();
    }
    function draw(context, region) {
      if (!preview || !drawing?.bounds) return;
      if (context === inkCtx && visible) return;
      const box = drawing.bounds;
      if (region && !intersection(box, region)) return;
      context.drawImage(preview, box.x, box.y, box.w, box.h);
    }
    function boundHistory() {
      const size = () => {
        const seen = new Set();
        let chars = 0;
        for (const item of state.history) for (const key of ["nativeInkBefore", "nativeInkAfter"]) {
          const value = item?.[key];
          if (!value || seen.has(value)) continue;
          seen.add(value);
          chars += (value.drawingData?.length || 0) + (value.previewDataUrl?.length || 0);
        }
        return chars;
      };
      while (state.history.length > MAX_HISTORY || state.history.length > 1 && size() > HISTORY_CHARS) state.history.shift();
    }
    function receive(packet) {
      const apply = async () => {
        if (stopped || packet?.sessionId !== sessionId || !Number.isSafeInteger(packet.revision) || packet.revision <= revision) return;
        if (packet.drawingData === drawing?.drawingData) { revision = packet.revision; receiveError = null; return; }
        const expectedSession = sessionId;
        const prepared = await prepare(packet);
        if (expectedSession !== sessionId || packet.revision <= revision) return;
        const before = drawing;
        save();
        drawing = prepared.drawing;
        preview = prepared.preview;
        revision = packet.revision;
        receiveError = null;
        // An empty initial drawing is a baseline, not a user edit.
        if (before || drawing.strokeCount) {
          const entry = { tiles:[], nativeInkBefore:before, nativeInkAfter:drawing };
          state.history.push(entry);
          state.future = [];
          boundHistory();
          state.userRevision++;
          const changed = packet.changedBounds && ["x", "y", "w", "h"].every(key => Number.isFinite(packet.changedBounds[key]))
            ? intersection(packet.changedBounds, { x:0, y:0, w:SIZE, h:SIZE })
            : unionLocalBounds(before?.bounds, drawing.bounds);
          mergeDirtyBox(changed);
          if (changed) {
            state.lastUserBox = changed;
            state.hotspotTrail.push({ x:changed.x + changed.w / 2, y:changed.y + changed.h / 2 });
            if (state.hotspotTrail.length > 512) state.hotspotTrail.shift();
          }
          state.autoEligible ||= drawing.strokeCount > 0;
          canvasAgentDidCommitUserCanvasChange(entry);
          window.PenEchoStudioNavigator?.updateDocument?.();
          if (!active && state.autoEligible) schedule();
        }
        state.currentSnapshotManifestExtensions = tenetInkManifestExtensions();
        requestCommittedInkRender();
        requestInteractionLayerRender();
        emitStatus();
        if (packet.metrics) window.dispatchEvent(new CustomEvent("tenet:ink-sample", { detail:{
          engine:"pencilkit", kind:"snapshot", serializationMs:packet.metrics.serializationMs,
        } }));
      };
      const job = reception.then(apply);
      reception = job.catch(error => { if (packet?.sessionId === sessionId) { receiveError = error; fail(error); } });
      return job;
    }
    function onscreen(element) {
      if (!element || element.hidden || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const css = getComputedStyle(element);
      return css.display !== "none" && css.visibility !== "hidden" && element.getBoundingClientRect().width > 0;
    }
    function modalOpen() {
      return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], .tenet-notebook-overlay, .penecho-cloud-overlay')].some(onscreen);
    }
    function configuration() {
      const metrics = canvasViewportMetrics(), rect = view.getBoundingClientRect();
      const factor = rect.width / Math.max(1, metrics.width);
      const nativeTool = state.mode === "select" ? "lasso" : state.mode === "eraser" ? "eraser" : "pen";
      const toolKey = `${sessionId}:${nativeTool}:${state.inkColor}:${state.pen}`;
      if (toolKey !== nativeToolKey) {
        nativeToolKey = toolKey;
        nativeToolWidth = Math.min(1024, state.pen / Math.max(.03, state.scale));
      }
      const shouldShow = engine === "pencilkit" && !lock && !suspended.size && !document.hidden
        && !state.viewMode && !snapshotLoadInProgress && ["pen", "eraser", "select"].includes(state.mode) && !modalOpen();
    const exclusions = [...document.querySelectorAll(
      '.topbar, [data-tenet-ink-toolbar], footer, #tenetBadge, #tenetNotebookLauncher, .ai-embodiment, .canvas-navigation-lock, #canvasAgentPanel, #studioNavigator, .hand-object-toolbar, .selection-toolbar, #tenetNativeToast, .tenet-ink-comparison.tic-dock > *, [role="menu"], [role="listbox"]'
      )].filter(onscreen).map(element => {
        const box = element.getBoundingClientRect();
        return { x:box.x, y:box.y, width:box.width, height:box.height };
      });
      return { sessionId, frame:{ x:rect.x, y:rect.y, width:rect.width, height:rect.height },
        viewportWidth:window.innerWidth, panX:state.panX * factor, panY:state.panY * factor,
        scale:state.scale * factor, canvasSize:SIZE, visible:shouldShow, inputEnabled:shouldShow,
        tool:nativeTool, color:state.inkColor, width:nativeToolWidth, toolRequestId,
        fingerDrawing:fingerDrawing && (window.TenetDrawingPreferences?.fingerDrawing() ?? true),
        navigationLocked:state.navigationLocked === true, exclusions };
    }
    async function synchronize() {
      if (!ready || stopped) return;
      const options = configuration();
      const key = JSON.stringify(options);
      if (key === lastConfiguration && nativeSession === sessionId) return;
      const targetSession = sessionId;
      if (nativeSession !== targetSession && drawing?.drawingData) options.drawingData = drawing.drawingData;
      // A modal/Hand switch must capture the last stroke before hiding it.
      if (visible && !options.visible && nativeSession === targetSession) {
        await receive(await native.hideInkSurface({ sessionId:targetSession }));
      }
      await native.configureInkSurface(options);
      if (targetSession !== sessionId) return;
      nativeSession = targetSession;
      lastConfiguration = key;
      const changed = visible !== options.visible;
      visible = options.visible;
      if (changed) requestCommittedInkRender();
    }
    function scheduleSync() {
      if (!ready || stopped) return;
      if (syncPending) { syncAgain = true; return; }
      syncPending = true;
      syncFrame = requestAnimationFrame(() => {
        syncFrame = 0;
        void serial(synchronize).catch(fail).finally(() => {
          syncPending = false;
          if (syncAgain) { syncAgain = false; scheduleSync(); }
        });
      });
    }
    async function flush() {
      if (active) throw Error("Lift the Pencil or finger before saving, switching, or asking Tenet.");
      const targetSession = sessionId;
      await serial(async () => {
        if (ready && nativeSession === targetSession && sessionId === targetSession) {
          await receive(await native.flushInkSurface({ sessionId:targetSession }));
        }
      });
      await reception;
      if (receiveError) throw receiveError;
      if (targetSession !== sessionId) throw Error("The page changed before native ink finished saving. Try again on the current page.");
    }
    async function setEngine(next) {
      if (!["web", "pencilkit"].includes(next)) throw Error("Unknown drawing engine.");
      if (lock || active || state.drawing) throw Error("Finish the current action before switching ink engines.");
      if (next === "pencilkit" && !ready) throw Error("PencilKit is unavailable in this build or disabled by managed configuration.");
      if (engine === next) return;
      const previous = engine;
      lock++;
      emitStatus();
      try {
        await flush();
        if (state.selection) commitSelection();
        save();
        document.activeElement?.blur?.();
        engine = next;
        lock--;
        await serial(synchronize);
      } catch (error) {
        engine = previous;
        if (lock) lock--;
        scheduleSync();
        throw error;
      } finally { emitStatus(); }
    }
    async function history(side) {
      if (lock || active || state.drawing) { fail(Error("Finish drawing before undo or redo.")); return; }
      lock++;
      emitStatus();
      try {
        await flush();
        await serial(synchronize);
        if (side === "before") save();
        const source = side === "before" ? state.history : state.future;
        const destination = side === "before" ? state.future : state.history;
        const entry = source.at(-1);
        if (!entry) return;
        if (Object.prototype.hasOwnProperty.call(entry, "nativeInkBefore")) {
          restoreImage = await prepare(entry[side === "before" ? "nativeInkBefore" : "nativeInkAfter"]);
        }
        invalidateRecognition();
        applyHistory(entry, side);
        source.pop();
        destination.push(entry);
        state.userRevision++;
      } catch (error) { fail(error); }
      finally { restoreImage = null; lock--; scheduleSync(); emitStatus(); }
    }
    function applyNativeHistory(entry, side) {
      if (!Object.prototype.hasOwnProperty.call(entry || {}, "nativeInkBefore")) return;
      if (!restoreImage) throw Error("Native history must be prepared before it is restored.");
      install(restoreImage);
    }
    function stageClear() {
      const before = drawing;
      install(null);
      if (before) state.tenetNativeHistoryBefore = before;
    }
    function suspend(reason) {
      suspended.add(String(reason));
      return serial(synchronize).catch(error => { fail(error); throw error; });
    }
    function resume(reason) { suspended.delete(String(reason)); scheduleSync(); }

    tenetInkController = { available, snapshot:() => drawing, draw, prepare, restore:install,
      flush, sync:scheduleSync, active:() => active || lock > 0, history, applyHistory:applyNativeHistory,
      stageClear, boundHistory, suspend, resume };
    window.TenetInk = { available, getStatus:status, setEngine, flush, suspend, resume,
      fingerDrawingAllowed:() => fingerDrawing };

    async function mount() {
      if (!available) return;
      try {
        const config = await native.getConfiguration();
        if (config.valid === false || config.pencilKitEnabled === false) { emitStatus(); return; }
        fingerDrawing = config.fingerDrawingEnabled === true;
        listeners.push(await native.addListener("inkSurfaceChanged", packet => { void receive(packet).catch(fail); }));
        listeners.push(await native.addListener("inkSurfaceActivity", event => {
          if (event.sessionId !== sessionId) return;
          active = event.active === true;
          if (active) {
            state.userRevision++;
            supersedeActiveAI("native-user-input-started");
            clearTimeout(state.timer);
            state.timer = 0;
            document.activeElement?.blur?.();
          }
          if (!active && event.tool === "ink" && event.completed !== false) window.dispatchEvent(new CustomEvent("tenet:ink-sample", { detail:{
            engine:"pencilkit", kind:"stroke", durationMs:event.durationMs, sampleCount:event.sampleCount,
          } }));
          emitStatus();
        }));
        listeners.push(await native.addListener("inkSurfaceError", event => {
          if (event.sessionId !== sessionId) return;
          receiveError = Error(event.message || "Native ink could not be saved. Your ink is retained; undo or erase and retry.");
          fail(receiveError);
        }));
        listeners.push(await native.addListener("inkSurfaceNavigation", event => {
          if (event.sessionId !== sessionId || state.navigationLocked || lock) return;
          const metrics = canvasViewportMetrics(), rect = view.getBoundingClientRect();
          const ratio = metrics.width / Math.max(1, rect.width);
          const factor = Number(event.scaleFactor);
          if (Number.isFinite(factor) && factor > 0 && Number.isFinite(event.centerX) && Number.isFinite(event.centerY)) {
            const next = Math.max(.03, Math.min(2, state.scale * factor));
            const x = (event.centerX - rect.x) * ratio, y = (event.centerY - rect.y) * ratio;
            state.panX = x - (x - state.panX) * next / state.scale;
            state.panY = y - (y - state.panY) * next / state.scale;
            state.scale = next;
          }
          if (Number.isFinite(event.dx)) state.panX += event.dx * ratio;
          if (Number.isFinite(event.dy)) state.panY += event.dy * ratio;
          updateCoordinates();
          requestRender();
          scheduleSync();
        }));
        ready = true;
        // Keep Web as the safe initial mode; the tester explicitly opts in.
        emitStatus();
        scheduleSync();
      } catch (error) { ready = false; fail(error); emitStatus(); }
    }
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(view);
    document.querySelectorAll('.topbar, [data-tenet-ink-toolbar], footer').forEach(element => resizeObserver.observe(element));
    const mutations = new MutationObserver(scheduleSync);
    mutations.observe(document.body, { subtree:true, attributes:true, attributeFilter:["hidden", "open", "class", "aria-hidden", "aria-expanded"] });
    window.addEventListener("resize", scheduleSync, { signal });
    window.visualViewport?.addEventListener("resize", scheduleSync, { signal });
    window.visualViewport?.addEventListener("scroll", scheduleSync, { passive: true, signal });
    document.addEventListener("scroll", scheduleSync, { capture: true, passive: true, signal });
    document.addEventListener("visibilitychange", () => {
      scheduleSync();
      if (document.hidden && !active) void flush().catch(fail);
    }, { signal });
    document.addEventListener("input", scheduleSync, { signal });
    document.addEventListener("click", event => {
      if (!event.target?.closest?.("[data-mode]")) return;
      toolRequestId++;
      scheduleSync();
    }, { signal });
    document.addEventListener("pointerdown", event => {
      if (!lock || !view.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture:true, signal });
    window.addEventListener("pageshow", () => { lastConfiguration = ""; scheduleSync(); }, { signal });
    window.addEventListener("pagehide", event => {
      if (event.persisted) {
        if (nativeSession) void native.hideInkSurface({ sessionId:nativeSession }).then(receive).catch(fail);
        visible = false;
        return;
      }
      // Existing notebook autosave owns durable storage. Never claim a fire-
      // and-forget unload callback is a successful save.
      stopped = true;
      if (syncFrame) cancelAnimationFrame(syncFrame);
      clearTimeout(reportTimer);
      resizeObserver.disconnect();
      mutations.disconnect();
      lifetime.abort();
      for (const listener of listeners) void listener.remove();
      if (nativeSession) void native.hideInkSurface({ sessionId:nativeSession }).catch(() => {});
    }, { signal });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void mount(); }, { once:true });
    else void mount();
  })();
