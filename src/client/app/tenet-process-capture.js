// INSIDE the canvas closure, after persistence/native ink/AI and before ui-bootstrap.
// TenetProcessJournal is a separate, pre-core script. Both require the explicit
// tenetAssignmentPreview flag; the ordinary iPad scratch-work demo installs no
// adapter, event listeners, or capture state. This adapter is opt-in and
// local-only: device timestamps/hashes are not teacher or Gateway attestations.
// Replay is coalesced page checkpoints plus observed semantic events, NOT a
// per-stroke ancestry log. Raster Web ink stays raster; PKDrawing stays native.
// No timers poll the canvas, no network requests, no saved-page rewrites, no audio.
  (function initializeTenetProcessCapture() {
    if (window.PENECHO_CONFIG?.tenetMode !== true || window.PENECHO_CONFIG?.tenetAssignmentPreview !== true) return;
    const MAX_QUEUE = 32, CHECKPOINT_DELAY = 250;
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_NATIVE_BYTES = 16 * 1024 * 1024;
    const MAX_DETAILS_BYTES = 12 * 1024;
    const IO_TIMEOUT = 30000, RENDER_TIMEOUT = 12000;
    const runtimeId = crypto.randomUUID();
    let current = null, opening = false, lifecycle = 0, mutation = 0;
    let tail = Promise.resolve(), queued = 0, requestNumber = 0;

    function journal() {
      if (!window.TenetProcessJournal) throw Error("Local work-history storage is unavailable.");
      return window.TenetProcessJournal;
    }
    function page() {
      return { generation:state.snapshotLoadGeneration, snapshotId:state.currentSnapshotId ?? null,
        location:state.currentSnapshotLocation ?? null };
    }
    function samePage(binding) {
      const now = page();
      return now.generation === binding.generation && now.snapshotId === binding.snapshotId && now.location === binding.location;
    }
    function idle() {
      return !document.hidden && !state.busy && !state.activeAI && !aiPreparation && !state.drawing &&
        !state.areaEraseGesture && !hasUnsettledToolbox() && !snapshotLoadInProgress && !snapshotSaveInProgress &&
        !tenetInkController?.active() && !state.historyBefore.size && !state.animationHistoryBefore &&
        !state.widgetHistoryBefore && !state.imageHistoryBefore && !state.textBoxHistoryBefore &&
        state.tenetNativeHistoryBefore === undefined;
    }
    function report(ctx, error) {
      if (ctx && error) ctx.error = String(error?.message || error).slice(0, 240);
      if (ctx?.detached) return;
      window.dispatchEvent(new CustomEvent("tenet:process-status", { detail:{
        attemptId:ctx?.id ?? null, recording:Boolean(ctx?.accepting),
        status:ctx?.accepting ? "recording" : ctx?.status || "paused",
        ...(error || ctx?.error ? { error:ctx?.error || String(error?.message || error).slice(0, 240) } : {}),
      } }));
    }
    function bounded(promise, milliseconds, message) {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), milliseconds);
      })]).finally(() => clearTimeout(timer));
    }
    function serial(operation) {
      queued++;
      const result = tail.then(operation);
      tail = result.catch(() => {}).finally(() => { queued--; });
      return result;
    }
    function descriptor(type, details = {}) {
      return { type, details:{ observedAt:new Date().toISOString(), evidence:"local-client-observation",
        serverVerified:false, page:page(), userRevision:state.userRevision, mutation, ...details } };
    }
    async function incomplete(ctx, reason) {
      try {
        await bounded(journal().markIncomplete(ctx.id, String(reason).slice(0, 160)), IO_TIMEOUT,
          "The work-history coverage warning could not be saved.");
      } catch (error) { report(ctx, error); }
    }
    function boundedDetails(event) {
      const json = JSON.stringify(event.details || {});
      if (new TextEncoder().encode(json).length <= MAX_DETAILS_BYTES) return event;
      // JSON escaping can make even a bounded question/answer exceed 12 KiB.
      // Preserve that local observation in an asset instead of truncating it
      // silently or pushing an oversized details record into journal storage.
      return { ...event, details:{ observedAt:event.details.observedAt,
        evidence:"local-client-observation", serverVerified:false,
        localRequestId:event.details.localRequestId || null,
        detailsAttachment:"details.json", inlineDetailsOmitted:true },
        assets:[...(event.assets || []), { name:"details.json", blob:new Blob([json], { type:"application/json" }) }] };
    }
    async function append(ctx, event) {
      const attempt = await bounded(journal().readAttempt(ctx.id), IO_TIMEOUT, "Work-history storage did not respond.");
      if (attempt?.status !== "recording") throw Error("This work-history attempt is paused or frozen; no further records were accepted.");
      const result = await bounded(journal().append(ctx.id, boundedDetails(event)), IO_TIMEOUT,
        "A work-history write could not be confirmed. Capture stopped; do not treat the last record as saved.");
      report(ctx);
      return result;
    }
    function enqueue(ctx, operation) {
      if (queued >= MAX_QUEUE) {
        void close(ctx, "queue-overflow", "Work-history capture could not keep up. Capture stopped with a coverage gap.");
        return Promise.resolve(false);
      }
      return serial(async () => {
        if (ctx.failed) return false;
        try { return await operation(); }
        catch (error) {
          ctx.failed = true;
          report(ctx, error);
          void close(ctx, "storage-error");
          return false;
        }
      });
    }
    function live() {
      const ctx = current;
      if (!ctx?.accepting) return null;
      if (!samePage(ctx.binding) || ctx.lifecycle !== lifecycle || document.hidden) {
        void close(ctx, "page-or-lifecycle-changed");
        return null;
      }
      return ctx;
    }
    function stamp() {
      return { observedAt:new Date().toISOString(), revision:state.userRevision, mutation,
        native:tenetInkController?.snapshot() || null };
    }
    function stampMatches(ctx, value) {
      return current === ctx && ctx.accepting && ctx.lifecycle === lifecycle && samePage(ctx.binding) &&
        value.revision === state.userRevision && value.mutation === mutation &&
        value.native === (tenetInkController?.snapshot() || null) && idle();
    }
    async function gap(ctx, event, reason) {
      report(ctx, "A work-history checkpoint was omitted: " + reason + ". Ordinary editing is unaffected.");
      await incomplete(ctx, reason);
      return append(ctx, { type:"coverage.gap", details:{ ...event.details, reason,
        requestedCheckpoint:event.details.label, coalescedCommits:event.details.coalescedCommits || 0 } });
    }
    function nativeBlob(record) {
      const source = record?.drawingData;
      if (!source) return null;
      if (typeof source !== "string" || source.length > Math.ceil(MAX_NATIVE_BYTES / 3) * 4) {
        throw Error("Native drawing exceeds the work-history attachment limit.");
      }
      const binary = atob(source);
      if (binary.length > MAX_NATIVE_BYTES) throw Error("Native drawing exceeds the work-history attachment limit.");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type:"application/octet-stream" });
    }
    async function captureCheckpoint(ctx, item) {
      let canvas = null, valid = true, event = null, failure = null;
      const isCurrent = () => valid && stampMatches(ctx, item.stamp);
      // Storage operations stay outside the renderer catch. A failed/uncertain
      // append must stop capture, not be retried as a supposed rendering gap.
      if (item.unsupported) return gap(ctx, item.event, item.unsupported);
      if (!isCurrent()) return gap(ctx, item.event, "page-revision-or-input-changed");
      try {
        canvas = await bounded(renderExportCanvas({ isCurrent, maxDimension:2048, maxPixels:4 * 1024 * 1024 }),
          RENDER_TIMEOUT, "Checkpoint rendering timed out.");
        if (!isCurrent()) throw Error("Checkpoint revision changed.");
        const assets = [], dimensions = canvas ? { width:canvas.width, height:canvas.height } : null;
        if (canvas) {
          const blob = await bounded(canvasBlob(canvas), RENDER_TIMEOUT, "Checkpoint encoding timed out.");
          if (!isCurrent()) throw Error("Checkpoint revision changed.");
          if (blob.size > MAX_IMAGE_BYTES) {
            failure = "rendered-image-size-limit";
            throw Error("Checkpoint image exceeds its size limit.");
          }
          assets.push({ name:"page.png", blob });
        }
        const archive = nativeBlob(item.stamp.native);
        if (archive) assets.push({ name:"drawing.pkdrawing", blob:archive });
        if (!isCurrent()) throw Error("Checkpoint revision changed.");
        event = { ...item.event, details:{ ...item.event.details, dimensions,
          blank:!canvas, representation:"coalesced-rendered-page", everyStroke:false,
          nativeArchiveIncluded:Boolean(archive), nativeStrokeCount:item.stamp.native?.strokeCount ?? null,
          limitations:"Not editable Web stroke ancestry; embedded widget/animation frames reflect local rendering, not verified source history." }, assets };
      } catch {
        failure ||= isCurrent() ? "checkpoint-render-or-attachment-failed" : "page-revision-or-input-changed";
      } finally {
        valid = false;
        if (canvas) canvas.width = canvas.height = 1;
      }
      return failure ? gap(ctx, item.event, failure) : append(ctx, event);
    }
    function queueCheckpoint(ctx) {
      clearTimeout(ctx.timer);
      ctx.timer = 0;
      const item = ctx.checkpoint;
      ctx.checkpoint = null;
      return item ? enqueue(ctx, () => captureCheckpoint(ctx, item)) : Promise.resolve(false);
    }
    function requestCheckpoint(ctx, label, unsupported = null, expected = stamp()) {
      const count = (ctx.checkpoint?.event.details.coalescedCommits || 0) + 1;
      ctx.checkpoint = { stamp:expected, unsupported,
        event:descriptor("canvas.checkpoint", { label:String(label).slice(0, 80), coalescedCommits:count,
          userRevision:expected.revision, mutation:expected.mutation, requestedStateObservedAt:expected.observedAt }) };
      // One bounded, event-triggered coalescing timer. No snapshot polling or
      // promise is retained per stroke; only the latest pending checkpoint.
      if (!ctx.timer) ctx.timer = setTimeout(() => { void queueCheckpoint(ctx); }, CHECKPOINT_DELAY);
    }
    function observe(type, details, checkpointLabel = null, unsupported = null) {
      const ctx = live();
      if (!ctx) return null;
      const event = descriptor(type, details);
      void enqueue(ctx, () => append(ctx, event));
      if (checkpointLabel && ctx.accepting) requestCheckpoint(ctx, checkpointLabel, unsupported);
      return ctx;
    }
    function close(ctx, reason, error = null) {
      if (!ctx) return Promise.resolve(null);
      if (ctx.closing) return ctx.closing;
      ctx.accepting = false;
      clearTimeout(ctx.timer);
      ctx.timer = 0;
      const omittedCheckpoint = Boolean(ctx.checkpoint);
      const inFlightAI = ctx.requests.size;
      ctx.checkpoint = null;
      ctx.resumable = reason === "user-paused";
      ctx.status = "pausing";
      report(ctx, error);
      // Descriptors already captured on this page may drain before the boundary.
      // Queued renders cannot read after this point: stampMatches fails closed.
      // One reserved control operation is allowed even at the queue ceiling.
      const event = { type:"coverage.boundary", details:{ observedAt:new Date().toISOString(),
        evidence:"local-client-observation", serverVerified:false, page:ctx.binding, reason,
        omittedCheckpoint, inFlightAI, captureContinues:false,
        durability:reason === "pagehide" ? "unload-write-not-guaranteed" : "subject-to-journal-write-success" } };
      ctx.requests.clear();
      ctx.closing = serial(async () => {
        try {
          if (ctx.failed || error || omittedCheckpoint || inFlightAI || reason === "pagehide")
            await incomplete(ctx, ctx.failed ? "storage-write-unconfirmed" : reason);
          const attempt = await bounded(journal().readAttempt(ctx.id), IO_TIMEOUT, "Work-history status could not be read.");
          if (attempt?.status === "recording") {
            if (!ctx.failed) {
              if (error || omittedCheckpoint) await append(ctx, { type:"coverage.gap", details:{ ...event.details,
                reason:error ? reason : "pending-checkpoint-at-coverage-boundary" } });
              await append(ctx, event);
            }
            await bounded(journal().pauseAttempt(ctx.id), IO_TIMEOUT, "Work-history pause could not be confirmed.");
            ctx.status = "paused";
          } else ctx.status = attempt?.status || "paused";
        } catch (failure) { ctx.failed = true; report(ctx, failure); }
        finally { ctx.closing = null; report(ctx); }
        return ctx.id;
      });
      return ctx.closing;
    }
    function boundary(reason = "page-transition") {
      lifecycle++;
      if (reason === "sign-out" && current) current.detached = true;
      if (current?.accepting) void close(current, reason);
      if (current) current.resumable = false;
      if (reason === "sign-out") { current = null; report(null); }
    }
    function newContext(attempt, binding) {
      return { id:attempt.id, binding, lifecycle, accepting:true, status:"recording", error:null,
        failed:false, resumable:false, closing:null, timer:0, checkpoint:null, requests:new Set() };
    }
    async function begin(metadata) {
      let ctx = null;
      try {
        if (opening || current?.accepting || current?.closing || queued) throw Error("Finish or pause the current work-history capture first.");
        if (!idle()) throw Error("Finish drawing, editing, or the AI request before starting work history.");
        opening = true;
        const binding = page(), initial = stamp(), startLifecycle = lifecycle;
        const attempt = await journal().createAttempt({ title:metadata?.title, subject:metadata?.subject,
          phase:metadata?.phase ?? "unconfigured" });
        if (!attempt?.id || attempt.status !== "recording") throw Error("The work-history attempt did not start recording.");
        ctx = newContext(attempt, binding);
        current = ctx;
        if (startLifecycle !== lifecycle || !samePage(binding) || !stampMatches(ctx, initial)) {
          await close(ctx, "begin-page-changed", "The page changed while work history was starting. Start again on the intended page.");
          throw Error(ctx.error);
        }
        const event = descriptor("capture.started", { runtimeId, optIn:"explicit-local", phase:attempt.phase,
          coverage:"committed Web/history edits, accepted native revisions, common canvas AI requests and coalesced checkpoints",
          exclusions:"No outside-app activity, per-stroke Web ancestry, audio, provider attestation, or separate agent-sidebar conversations." });
        void enqueue(ctx, () => append(ctx, event));
        if (!ctx.accepting) throw Error(ctx.error || "Work-history capture stopped.");
        // Reserve the baseline before yielding. Later edits either follow it
        // as semantic events or invalidate its pinned stamp into an explicit gap.
        requestCheckpoint(ctx, "baseline", null, initial);
        void queueCheckpoint(ctx);
        await flush();
        report(ctx);
        return await journal().readAttempt(ctx.id);
      } catch (error) { report(ctx || current, error); throw error; }
      finally { opening = false; }
    }
    async function pause() {
      const ctx = current;
      lifecycle++;
      if (!ctx) return null;
      try {
        // Also await a pause already initiated by a boundary or queue failure.
        // UI may freeze only after this promise confirms the stored paused state.
        if (ctx.closing) await ctx.closing;
        else if (ctx.accepting) await close(ctx, "user-paused");
        const attempt = await bounded(journal().readAttempt(ctx.id), IO_TIMEOUT, "Work-history pause could not be confirmed.");
        if (attempt?.status !== "paused") throw Error("Work-history storage is not paused; freezing is not ready.");
        ctx.status = "paused";
        if (ctx.failed) throw Error(ctx.error || "Not all queued work-history records could be saved. The attempt is incomplete.");
        report(ctx);
        return attempt;
      } catch (error) { report(ctx, error); throw error; }
    }
    async function resume(id) {
      let ctx = current;
      try {
        if (opening || ctx?.accepting || ctx?.closing || queued) throw Error("Finish the current work-history operation before resuming.");
        if (!ctx || ctx.id !== id || !ctx.resumable || !samePage(ctx.binding)) {
          throw Error("Resume is only available on the same opted-in page in this session. After navigation or reload, start a new attempt.");
        }
        if (!idle()) throw Error("Finish drawing, editing, or the AI request before resuming work history.");
        opening = true;
        const previous = ctx, expected = stamp(), startLifecycle = lifecycle;
        const stored = await journal().readAttempt(id);
        if (stored?.status !== "paused") throw Error("Only a paused, unfrozen attempt can resume.");
        const attempt = await journal().resumeAttempt(id);
        ctx = newContext(attempt, previous.binding);
        current = ctx;
        if (startLifecycle !== lifecycle || !stampMatches(ctx, expected)) {
          await close(ctx, "resume-page-changed", "The page changed while capture was resuming. Start a new attempt.");
          throw Error(ctx.error);
        }
        const event = descriptor("capture.resumed", { runtimeId, unobservedInterval:true,
          coverage:"Work performed while paused is unknown; the next checkpoint is a new baseline, not inferred edits." });
        void enqueue(ctx, () => append(ctx, event));
        if (!ctx.accepting) throw Error(ctx.error || "Work-history capture stopped.");
        requestCheckpoint(ctx, "resume-baseline", null, expected);
        void queueCheckpoint(ctx);
        await flush();
        report(ctx);
        return await journal().readAttempt(id);
      } catch (error) { report(ctx, error); throw error; }
      finally { opening = false; }
    }
    async function flush() {
      try {
        const ctx = current;
        if (ctx?.accepting && ctx.checkpoint) void queueCheckpoint(ctx);
        await tail;
        if (ctx?.failed) throw Error(ctx.error || "Work-history writes could not be confirmed.");
        return ctx ? await journal().readAttempt(ctx.id) : null;
      } catch (error) { report(current, error); throw error; }
    }
    async function checkpoint(label = "manual-checkpoint") {
      const ctx = live();
      if (!ctx) { const error = Error("Start or resume local work history before capturing a checkpoint."); report(current, error); throw error; }
      requestCheckpoint(ctx, label);
      await queueCheckpoint(ctx);
      return flush();
    }
    function historyDetails(entry) {
      return { tileChanges:Array.isArray(entry) ? entry.length : entry?.tiles?.length || 0,
        nativeChanged:Object.prototype.hasOwnProperty.call(entry || {}, "nativeInkBefore"),
        imagesChanged:Boolean(entry?.imagesBefore), textBoxesChanged:Boolean(entry?.textBoxesBefore),
        widgetsChanged:Boolean(entry?.widgetsBefore), animationsChanged:Boolean(entry?.animationsBefore),
        granularity:"history-entry-not-stroke", actor:"not-inferred" };
    }
    function safeBox(box) {
      return box && [box.x, box.y, box.w, box.h].every(Number.isFinite)
        ? { x:box.x, y:box.y, w:box.w, h:box.h } : null;
    }
    function aiRequested(input) {
      const ctx = live();
      if (!ctx) return null;
      if (ctx.requests.size >= 8) {
        void close(ctx, "ai-observer-limit", "Too many concurrent AI observations; work-history capture stopped with a coverage gap.");
        return null;
      }
      const packed = input.packed || {}, rawQuestion = packed.selectionQuestion ?? input.typedInput?.text;
      const question = typeof rawQuestion === "string" ? rawQuestion.slice(0, 4000) : null;
      const token = { ctx, id:runtimeId + ":" + (++requestNumber), page:page(), ended:false };
      ctx.requests.add(token);
      observe("ai.request", { localRequestId:token.id, action:String(input.action || "").slice(0, 40),
        automatic:input.automatic === true, requestRevision:input.revision,
        question, questionTruncated:typeof rawQuestion === "string" && rawQuestion.length > 4000,
        context:{ evidence:"local-request-metadata-not-provider-payload", exactGatewayEvidence:false,
          scope:packed.questionOnly === true ? "text-only" : packed.selectionContext ? "selection" : input.captureCurrentViewport ? "visible-page" : "recent-writing",
          sourceRect:safeBox(packed.sourceRect), changedBox:safeBox(packed.changedBox),
          closedSelection:packed.selectionContext?.closed === true,
          selectionPointCount:Array.isArray(packed.selectionContext?.path) ? packed.selectionContext.path.length : 0,
          providerImageRetained:false, promptAndPolicyNotAttested:true } });
      return token;
    }
    function currentRequest(token) {
      return token && !token.ended && live() === token.ctx && samePage(token.page) && token.ctx.requests.has(token);
    }
    function aiResponse(token, input) {
      if (!currentRequest(token)) return;
      const commands = Array.isArray(input.commands) ? input.commands : [];
      let text = "", truncated = false;
      const tools = [];
      for (const command of commands.slice(0, 64)) {
        if (typeof command.tool === "string") tools.push(command.tool.slice(0, 64));
        if (command.tool !== "write_text" || typeof command.text !== "string") continue;
        const available = Math.max(0, 8000 - text.length);
        text += ((text ? "\n\n" : "") + command.text).slice(0, available);
        truncated ||= available < command.text.length + 2;
      }
      observe("ai.response", { localRequestId:token.id,
        serverReportedRequestId:typeof input.requestId === "string" ? input.requestId.slice(0, 160) : null,
        observation:"validated-current-response-before-draft-rendering", text, textTruncated:truncated || commands.length > 64,
        tools, commandCount:commands.length, committedToPage:false,
        nonTextOutput:"Only tool names observed; committed rendered output may appear in later page checkpoints." });
    }
    function aiFinished(token, outcome) {
      if (!currentRequest(token)) return;
      observe("ai.finished", { localRequestId:token.id, outcome:String(outcome).slice(0, 80),
        evidence:"local-runtime-outcome-not-server-attestation" });
      token.ended = true;
      token.ctx.requests.delete(token);
    }
    function protect(callback) {
      return (...args) => {
        try { return callback(...args); }
        catch (error) { report(current, error); if (current?.accepting) void close(current, "observer-error"); return null; }
      };
    }
    window.TenetProcessCapture = Object.freeze({ begin, pause, resume, flush, checkpoint,
      activeId:() => current?.id ?? null, isRecording:() => Boolean(live()),
      boundary:protect(boundary), aiRequested:protect(aiRequested), aiResponse:protect(aiResponse), aiFinished:protect(aiFinished),
      commit:protect(entry => { mutation++; observe("canvas.commit", historyDetails(entry), "committed-edit"); }),
      history:protect((entry, side) => {
        mutation++;
        observe(side === "before" ? "canvas.undo" : "canvas.redo", historyDetails(entry), "history-change",
          entry?.[side === "before" ? "textBoxesBefore" : "textBoxesAfter"] ? "asynchronous-text-restoration-not-observed" : null);
      }),
      nativeRevision:protect(value => {
        mutation++;
        observe("native.revision", { revision:value.revision, strokeCount:value.strokeCount,
          changedBounds:safeBox(value.changedBounds), granularity:"accepted-PKDrawing-revision-not-individual-stroke",
          changedBoundsAreConservative:true }, "native-revision");
      }),
    });
    // Navigation ends capture even when a load later fails. Do not silently
    // attach a journal to an imported page, a new identity, or a restored tab.
    window.addEventListener("tenet:sign-out", () => boundary("sign-out"));
    window.addEventListener("pagehide", () => boundary("pagehide"));
    window.addEventListener("popstate", () => boundary("navigation"));
    window.addEventListener("hashchange", () => boundary("navigation"));
    document.addEventListener("visibilitychange", () => { if (document.hidden) boundary("backgrounded"); });
  })();
