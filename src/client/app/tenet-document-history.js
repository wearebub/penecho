// Inside the canvas closure, after the explicitly opted-in process adapter.
// Ordinary Tenet notebooks own this history in snapshot.workHistory. No separate
// journal, database, upload, microphone recording, or server policy authority.
// Events describe observed commits, not individual stroke ancestry or authorship.
  (function initializeTenetDocumentHistory() {
    const config = window.PENECHO_CONFIG;
    if (config?.tenetMode !== true || config.tenetAssignmentPreview === true || config.runtime === "viewer") return;
    const MAX_BYTES = 64 * 1024 * 1024, MAX_EVENTS = 5000, MAX_DETAILS = 12 * 1024;
    const MAX_IMAGE = 8 * 1024 * 1024, MAX_NATIVE = 16 * 1024 * 1024;
    const MAX_AI_BODY = 12 * 1024 * 1024, MAX_AI_JOBS = 2;
    const DELAY = 400, TIMEOUT = 12000;
    const encoder = new TextEncoder(), runtimeId = crypto.randomUUID();
    let current = null, signedOut = false, renderJob = null, requestNumber = 0, accountEpoch = 0;
    let inputTail = Promise.resolve(), inputJobs = 0, inputCharacters = 0;
    const now = () => new Date().toISOString();
    const bytes = value => encoder.encode(JSON.stringify(value)).length;
    const clone = value => JSON.parse(JSON.stringify(value));
    const page = () => ({ generation:state.snapshotLoadGeneration,
      id:state.currentSnapshotId ?? null, location:state.currentSnapshotLocation ?? null });
    const local = () => (state.currentSnapshotLocation || state.snapshotLocation || "device") === "device";
    function samePage(ctx) {
      const value = page();
      return current === ctx && !signedOut && ctx.accountEpoch === accountEpoch &&
        value.generation === ctx.page.generation && value.id === ctx.page.id && value.location === ctx.page.location;
    }
    function live() { return current && !current.closed && !document.hidden && local() && samePage(current) ? current : null; }
    function report(ctx, error = null) {
      if (error && ctx) ctx.error = String(error?.message || error).slice(0, 200);
      try {
        window.dispatchEvent(new CustomEvent("tenet:document-history-status", { detail:{
          snapshotId:ctx?.page.id ?? null, dirty:Boolean(ctx?.hasWork && ctx.version > ctx.savedVersion),
          incomplete:Boolean(ctx?.incomplete), droppedEvents:ctx?.droppedEvents || 0,
          ...(ctx?.error ? { error:ctx.error } : {}),
        } }));
      } catch { /* A status listener cannot break ordinary editing. */ }
    }
    function mark(ctx, reason) {
      ctx.incomplete = true;
      if (!ctx.incompleteReasons.includes(reason) && ctx.incompleteReasons.length < 16) ctx.incompleteReasons.push(reason);
      report(ctx, "Notebook history is incomplete: " + reason + ". Your canvas is unchanged.");
    }
    function bounded(promise) {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("History checkpoint timed out.")), TIMEOUT);
      })]).finally(() => clearTimeout(timer));
    }
    function safeDetails(value) {
      let result = clone(value);
      if (bytes(result) > MAX_DETAILS) {
        for (const field of ["question", "text"]) if (typeof result[field] === "string") result[field] = result[field].slice(0, 512);
        result.textTruncated = true;
        result.detailsTruncated = true;
      }
      if (bytes(result) > MAX_DETAILS) result = { detailsTruncated:true, evidence:"local-client-observation", serverVerified:false };
      return result;
    }
    function evict(ctx) {
      const event = ctx.events.shift();
      if (!event) return;
      if (ctx.lastCheckpoint?.sequence === event.sequence) ctx.lastCheckpoint = null;
      ctx.bytes -= bytes(event);
      for (const asset of event.assets) {
        const stored = ctx.assets.get(asset.hash);
        if (stored && --stored.refs === 0) { ctx.bytes -= stored.size; ctx.assets.delete(asset.hash); }
      }
      ctx.droppedEvents++;
    }
    function append(ctx, type, details = {}, attachments = []) {
      const event = { sequence:ctx.nextSequence++, timestamp:now(), type,
        details:safeDetails({ evidence:"local-client-observation", serverVerified:false,
          userRevision:state.userRevision, ...details }),
        assets:attachments.map(({ name, hash, blob }) => ({ name, hash, mime:blob.type, size:blob.size })) };
      for (const asset of attachments) {
        let stored = ctx.assets.get(asset.hash);
        if (!stored) {
          stored = { hash:asset.hash, blob:asset.blob, mime:asset.blob.type, size:asset.blob.size, refs:0 };
          ctx.assets.set(asset.hash, stored); ctx.bytes += stored.size;
        }
        stored.refs++;
      }
      ctx.events.push(event); ctx.bytes += bytes(event); ctx.version++;
      let trimmed = false;
      // Leave room for a small, explicit retention-gap event. Blob references
      // are shared until the last referencing event is evicted.
      while (ctx.events.length > MAX_EVENTS - 1 || ctx.bytes > MAX_BYTES - 2048) { evict(ctx); trimmed = true; }
      if (trimmed) {
        mark(ctx, "history-retention-limit");
        if (type !== "coverage.gap") append(ctx, "coverage.gap", { reason:"history-retention-limit", droppedEvents:ctx.droppedEvents });
      }
      report(ctx);
      return event;
    }
    function gap(ctx, reason, details = {}) {
      mark(ctx, reason);
      return append(ctx, "coverage.gap", { reason, ...details });
    }
    function newContext() {
      return { page:page(), accountEpoch, epoch:0, closed:false, hasWork:false, startedAt:now(),
        events:[], assets:new Map(), bytes:0, nextSequence:1, version:0, savedVersion:0,
        incomplete:false, incompleteReasons:[], droppedEvents:0, error:null,
        mutation:0, timer:0, pending:null, requests:new Set(), inputs:new Set(), lastNativeRevision:null, lastCheckpoint:null };
    }
    function stamp(ctx) {
      return { epoch:ctx.epoch, revision:state.userRevision, mutation:ctx.mutation,
        native:tenetInkController?.snapshot() || null, observedAt:now() };
    }
    function matches(ctx, value) {
      return live() === ctx && value.epoch === ctx.epoch && value.revision === state.userRevision &&
        value.mutation === ctx.mutation && value.native === (tenetInkController?.snapshot() || null);
    }
    function unsettledReason() {
      if (state.drawing || state.areaEraseGesture || tenetInkController?.active()) return "active-input";
      if (snapshotLoadInProgress) return "page-loading";
      // Preserve the original settlement fence. Save finalizes the toolbox
      // before requesting a fresh, pinned full checkpoint when needed.
      if (hasUnsettledToolbox()) return "uncommitted-toolbox";
      if (state.historyBefore.size || state.animationHistoryBefore || state.widgetHistoryBefore ||
          state.imageHistoryBefore || state.textBoxHistoryBefore ||
          state.tenetNativeHistoryBefore !== undefined) return "uncommitted-history";
      return null;
    }
    async function attachment(name, blob) {
      const digest = await bounded(crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
      return { name, blob, hash:Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("") };
    }
    function nativeBlob(record) {
      const source = record?.drawingData;
      if (!source) return null;
      if (typeof source !== "string" || source.length > Math.ceil(MAX_NATIVE / 3) * 4) throw Error("Native history attachment too large.");
      const binary = atob(source);
      if (binary.length > MAX_NATIVE) throw Error("Native history attachment too large.");
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
      return new Blob([data], { type:"application/octet-stream" });
    }
    async function checkpoint(ctx, item) {
      let canvas = null, valid = true, stage = "settlement";
      const isCurrent = () => valid && matches(ctx, item.stamp) && !unsettledReason();
      try {
        if (!isCurrent() || item.unsupported) throw Error("Unsettled history checkpoint.");
        stage = "render";
        canvas = await bounded(renderExportCanvas({ isCurrent, maxDimension:2048, maxPixels:4 * 1024 * 1024 })
          .then(value => { if (!valid && value) value.width = value.height = 1; return value; }));
        if (!isCurrent()) throw Error("History revision changed.");
        const dimensions = canvas ? { width:canvas.width, height:canvas.height } : null, assets = [];
        if (canvas) {
          stage = "encode-image";
          const blob = await bounded(canvasBlob(canvas));
          if (blob.size > MAX_IMAGE) throw Error("History image too large.");
          stage = "hash-image";
          assets.push(await attachment("page.png", blob));
        }
        if (!isCurrent()) throw Error("History revision changed.");
        stage = "native-attachment";
        const native = nativeBlob(item.stamp.native);
        if (native) assets.push(await attachment("drawing.pkdrawing", native));
        if (!isCurrent()) throw Error("History revision changed.");
        stage = "record-checkpoint";
        const event = append(ctx, "canvas.checkpoint", { label:item.label, dimensions, blank:!canvas,
          requestedStateObservedAt:item.stamp.observedAt, userRevision:item.stamp.revision,
          representation:"coalesced-rendered-page", coalescedCommits:item.count, everyStroke:false,
          nativeArchiveIncluded:Boolean(native), nativeStrokeCount:item.stamp.native?.strokeCount ?? null }, assets);
        ctx.lastCheckpoint = { stamp:item.stamp, sequence:event.sequence };
      } catch (error) {
        if (samePage(ctx) && !ctx.closed) gap(ctx, item.unsupported || "checkpoint-render-or-revision-gap", {
          label:item.label, requestedRevision:item.stamp.revision, coalescedCommits:item.count,
          failureStage:stage, guard:matches(ctx, item.stamp) ? unsettledReason() : "page-or-revision-changed",
          errorName:["Error", "TypeError", "ReferenceError", "SecurityError", "RangeError"].includes(error?.name) ? error.name : "Error" });
      } finally {
        valid = false;
        if (canvas) canvas.width = canvas.height = 1;
      }
    }
    function schedule(ctx) {
      if (!ctx.timer && ctx.pending && !ctx.closed) ctx.timer = setTimeout(() => { void pump(ctx); }, DELAY);
    }
    function pump(ctx) {
      clearTimeout(ctx.timer); ctx.timer = 0;
      if (renderJob) return renderJob;
      const item = ctx.pending;
      ctx.pending = null;
      if (!item || live() !== ctx) return Promise.resolve();
      renderJob = checkpoint(ctx, item).catch(() => { if (live() === ctx) gap(ctx, "checkpoint-observer-failed"); })
        .finally(() => { renderJob = null; if (current?.pending) schedule(current); });
      return renderJob;
    }
    function requestCheckpoint(ctx, label, unsupported = null) {
      ctx.pending = { stamp:stamp(ctx), label, unsupported, count:(ctx.pending?.count || 0) + 1 };
      schedule(ctx);
    }
    async function flush() {
      const ctx = live();
      if (!ctx) return;
      // Drain only inputs admitted at this boundary. Later requests stay dirty
      // when their attachments arrive; never poll or prolong an active AI run.
      const inputs = inputTail;
      await pump(ctx);
      // At most one newly coalesced checkpoint, never a polling/drain loop.
      if (live() === ctx && ctx.pending) await pump(ctx);
      await inputs;
    }
    function historyDetails(entry) {
      return { tileChanges:Array.isArray(entry) ? entry.length : entry?.tiles?.length || 0,
        nativeChanged:Object.prototype.hasOwnProperty.call(entry || {}, "nativeInkBefore"),
        imagesChanged:Boolean(entry?.imagesBefore), textBoxesChanged:Boolean(entry?.textBoxesBefore),
        widgetsChanged:Boolean(entry?.widgetsBefore), animationsChanged:Boolean(entry?.animationsBefore),
        granularity:"history-entry-not-stroke", actor:"not-inferred" };
    }
    function observe(type, details, label = null, unsupported = null) {
      const ctx = live();
      if (!ctx) return null;
      ctx.hasWork = true;
      append(ctx, type, details);
      if (label) { ctx.mutation++; requestCheckpoint(ctx, label, unsupported); }
      return ctx;
    }
    function safeBox(box) {
      return box && [box.x, box.y, box.w, box.h].every(Number.isFinite) ? { x:box.x, y:box.y, w:box.w, h:box.h } : null;
    }
    function recordInput(ctx, details, assets, omitted) {
      append(ctx, "ai.input", { ...details, omitted, gatewayProviderPromptObserved:false }, assets);
      if (omitted.length) gap(ctx, "ai-input-incomplete", { localRequestId:details.localRequestId, omitted });
    }
    function unavailableInput(ctx, details, reason) {
      recordInput(ctx, { ...details, bodyStatus:"unavailable", bodyFormat:null, bodyExact:false,
        imageStatus:"unavailable", bodyAssetName:null, imageAssetName:null }, [], [reason]);
    }
    function omitSensitiveInputFields(body) {
      // The observer never receives fetch headers. Also exclude explicit
      // credential/header properties should a future body extension add them.
      // This is not DLP or a claim that free-form student text was scanned.
      const sensitive = new Set(["authorization", "proxyauthorization", "cookie", "setcookie", "headers", "requestheaders",
        "apikey", "apikeys", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "clientsecret",
        "password", "credentials", "credential", "secret", "secrets"]);
      const pending = [{ value:body, depth:0 }];
      let entries = 0, omitted = false;
      while (pending.length) {
        const { value, depth } = pending.pop();
        if (depth > 32) throw Error("AI input structure limit.");
        const keys = Object.keys(value);
        entries += keys.length;
        if (entries > 8192) throw Error("AI input structure limit.");
        for (const key of keys) {
          if (sensitive.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
            delete value[key]; omitted = true;
          } else if (value[key] && typeof value[key] === "object") {
            pending.push({ value:value[key], depth:depth + 1 });
          }
        }
      }
      return omitted;
    }
    async function captureInput(job, isCurrent) {
      // Read the immutable string already supplied to fetch, not live canvas,
      // microphone, policy, plugin state, or a newly rendered/re-cropped image.
      const raw = new Blob([job.body], { type:"application/json" });
      if (raw.size > MAX_AI_BODY) {
        if (isCurrent()) unavailableInput(job.ctx, job.details, "body-byte-limit");
        return;
      }
      let body;
      try {
        body = JSON.parse(job.body);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Invalid request body.");
      } catch {
        if (isCurrent()) unavailableInput(job.ctx, job.details, "body-format-unavailable");
        return;
      }
      const assets = [], omitted = [];
      let bodyStatus = "recorded", bodyFormat = "raw-client-json", bodyAssetName = null;
      let imageStatus = "not-submitted", imageAssetName = null;
      let safeBody = null;
      try {
        if (omitSensitiveInputFields(body)) {
          bodyStatus = "partial"; bodyFormat = "redacted-client-json";
          omitted.push("sensitive-body-fields-omitted");
          safeBody = new Blob([JSON.stringify(body)], { type:"application/json" });
          if (safeBody.size > MAX_AI_BODY) throw Error("Redacted body limit.");
        } else safeBody = raw;
      } catch {
        bodyStatus = "unavailable"; bodyFormat = null;
        safeBody = null;
        omitted.push("body-structure-limit");
      }
      if (safeBody) {
        assets.push(await attachment("ai-input.json", safeBody));
        if (!isCurrent()) return;
        bodyAssetName = "ai-input.json";
      }
      const image = body.atlasImage;
      if (image !== undefined && image !== null && image !== "") {
        imageStatus = "omitted";
        const prefix = typeof image === "string" && /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(image);
        if (!prefix) omitted.push("image-format-unavailable");
        else if (image.length - prefix[0].length > Math.ceil(MAX_IMAGE / 3) * 4) omitted.push("image-byte-limit");
        else {
          let blob = null;
          try {
            const binary = atob(image.slice(prefix[0].length));
            if (binary.length > MAX_IMAGE) omitted.push("image-byte-limit");
            else if (!binary.length) omitted.push("image-encoding-invalid");
            else {
              const data = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
              blob = new Blob([data], { type:prefix[1].toLowerCase() });
            }
          } catch { omitted.push("image-encoding-invalid"); }
          if (blob) {
            const name = "ai-input." + blob.type.slice("image/".length);
            assets.push(await attachment(name, blob));
            if (!isCurrent()) return;
            imageAssetName = name; imageStatus = "recorded";
          }
        }
      }
      if (!isCurrent()) return;
      // Exactly two attachments at most, within the existing saved-history
      // schema. ai.input / ai-input.* are NEVER page replay checkpoints.
      recordInput(job.ctx, { ...job.details, bodyStatus, bodyFormat, bodyExact:bodyStatus === "recorded",
        imageStatus, bodyAssetName, imageAssetName }, assets, omitted);
    }
    function queueInput(token, input) {
      const ctx = token.ctx, body = input.requestBody;
      const details = { inputVersion:1, localRequestId:token.id, origin:token.origin,
        userRevision:token.revision, requestRevision:token.revision, requestObservedAt:token.observedAt,
        boundary:"client-to-whiteboard", method:"POST", endpoint:"/api/ai/command",
        observation:"prepared-client-request-not-server-receipt" };
      if (typeof body !== "string") { unavailableInput(ctx, details, "body-not-observed"); return; }
      if (body.length > MAX_AI_BODY) { unavailableInput(ctx, details, "body-character-limit"); return; }
      if (inputJobs >= MAX_AI_JOBS || inputCharacters + body.length > MAX_AI_BODY) {
        unavailableInput(ctx, details, "input-queue-limit"); return;
      }
      const characters = body.length, job = { ctx, epoch:ctx.epoch, body, details, active:true };
      ctx.inputs.add(job); inputJobs++; inputCharacters += characters;
      // A bounded serial queue starts after fetch has received its request.
      // Finished responses do not invalidate an immutable historical input;
      // page/account/epoch changes do. No later page state is sampled here.
      inputTail = inputTail.then(async () => {
        const isCurrent = () => job.active && live() === ctx && job.epoch === ctx.epoch;
        try {
          if (isCurrent()) await bounded(captureInput(job, isCurrent));
        } catch {
          if (isCurrent()) unavailableInput(ctx, details, "input-capture-failed");
        } finally {
          job.active = false; job.body = null; ctx.inputs.delete(job);
          inputJobs--; inputCharacters -= characters;
        }
      }).catch(() => { /* An optional observer cannot fail AI or notebook save. */ });
    }
    function aiRequested(input) {
      const ctx = live();
      if (!ctx) return null;
      if (ctx.requests.size >= 8) { gap(ctx, "ai-observer-limit"); return null; }
      const packed = input.packed || {}, question = packed.selectionQuestion ?? input.typedInput?.text;
      const origin = typeof input.voice !== "boolean" ? "unknown" : input.automatic === true ? "automatic"
        : input.voice ? "voice-question" : typeof packed.selectionQuestion === "string" && packed.selectionQuestion.trim()
          ? "specific-question" : "quick-help";
      const token = { ctx, epoch:ctx.epoch, id:runtimeId + ":" + (++requestNumber),
        origin, revision:input.revision, observedAt:now() };
      ctx.requests.add(token);
      observe("ai.request", { localRequestId:token.id, action:String(input.action || "").slice(0, 40),
        inputVersion:1, origin, originEvidence:origin === "unknown" ? "not-observed" : "local-submit-path",
        questionSource:typeof packed.selectionQuestion === "string" ? "selection-question"
          : typeof input.typedInput?.text === "string" ? "canvas-typed-input" : "none",
        automatic:input.automatic === true, requestRevision:input.revision,
        question:typeof question === "string" ? question.slice(0, 4000) : null,
        questionTruncated:typeof question === "string" && question.length > 4000,
        context:{ evidence:"local-request-metadata-not-provider-payload", exactGatewayEvidence:false,
          scope:packed.questionOnly ? "text-only" : packed.selectionContext ? "selection" : input.captureCurrentViewport ? "visible-page" : "recent-writing",
          sourceRect:safeBox(packed.sourceRect), changedBox:safeBox(packed.changedBox),
          closedSelection:packed.selectionContext?.closed === true,
          providerImageRetained:false, clientRequestInput:"see-linked-ai.input", promptAndPolicyNotAttested:true } });
      queueInput(token, input);
      return token;
    }
    function requestCurrent(token) { return token && live() === token.ctx && token.epoch === token.ctx.epoch && token.ctx.requests.has(token); }
    function aiResponse(token, input) {
      if (!requestCurrent(token)) return;
      const commands = Array.isArray(input.commands) ? input.commands : [];
      let text = "";
      const tools = [];
      for (const command of commands.slice(0, 64)) {
        if (typeof command.tool === "string") tools.push(command.tool.slice(0, 64));
        if (command.tool === "write_text" && typeof command.text === "string")
          text += ((text ? "\n\n" : "") + command.text).slice(0, Math.max(0, 8000 - text.length));
      }
      observe("ai.response", { localRequestId:token.id, text, textTruncated:text.length === 8000 || commands.length > 64,
        tools, commandCount:commands.length, committedToPage:false,
        serverReportedRequestId:typeof input.requestId === "string" ? input.requestId.slice(0, 160) : null,
        observation:"validated-current-response-before-draft-rendering",
        nonTextOutput:"Tool names observed; committed output is represented by later page checkpoints." });
    }
    function aiFinished(token, outcome) {
      if (!requestCurrent(token)) return;
      observe("ai.finished", { localRequestId:token.id, outcome:String(outcome).slice(0, 80),
        evidence:"local-runtime-outcome-not-server-attestation" });
      token.ctx.requests.delete(token);
    }
    function boundary(reason = "page-transition") {
      // Persistence adopts the same physical page after its first save or Save As.
      if (reason === "saved-page-identity-changed") return;
      const ctx = current;
      if (ctx && !ctx.closed) {
        if (ctx.pending || ctx.requests.size || ctx.inputs.size || renderJob) gap(ctx, "unfinished-work-at-boundary", { reason });
        append(ctx, "coverage.boundary", { reason, unloadPersistenceGuaranteed:false });
        ctx.closed = true; ctx.epoch++; ctx.pending = null; ctx.requests.clear();
        for (const input of ctx.inputs) { input.active = false; input.body = null; }
        ctx.inputs.clear();
        clearTimeout(ctx.timer); ctx.timer = 0;
      }
      if (reason === "sign-out") { signedOut = true; accountEpoch++; current = null; report(null); }
    }
    function decode(value) {
      if (!value || value.version !== 1 || !Array.isArray(value.events) || value.events.length > MAX_EVENTS ||
          !Array.isArray(value.assets) || value.assets.length > MAX_EVENTS * 2) throw Error("Invalid saved-page history.");
      const result = newContext();
      let total = 0, sequence = 0;
      for (const asset of value.assets) {
        if (!asset || !/^[0-9a-f]{64}$/.test(asset.hash) || !(asset.blob instanceof Blob) ||
            asset.size !== asset.blob.size || asset.mime !== asset.blob.type || asset.size > MAX_NATIVE || result.assets.has(asset.hash))
          throw Error("Invalid history attachment.");
        total += asset.size;
        if (total > MAX_BYTES) throw Error("History exceeds its byte budget.");
        result.assets.set(asset.hash, { ...asset, refs:0 });
      }
      for (const original of value.events) {
        if (!original || !Number.isSafeInteger(original.sequence) || original.sequence <= sequence ||
            !/^[a-z][a-z0-9.-]{0,63}$/.test(original.type) || typeof original.timestamp !== "string" ||
            !Number.isFinite(Date.parse(original.timestamp)) || bytes(original.details || {}) > MAX_DETAILS ||
            !Array.isArray(original.assets) || original.assets.length > 2) throw Error("Invalid history event.");
        const event = clone(original);
        total += bytes(event);
        if (total > MAX_BYTES) throw Error("History exceeds its byte budget.");
        for (const asset of event.assets) {
          const stored = result.assets.get(asset.hash);
          if (!stored || stored.size !== asset.size || stored.mime !== asset.mime || typeof asset.name !== "string" || asset.name.length > 64)
            throw Error("Missing history attachment.");
          stored.refs++;
        }
        result.events.push(event); sequence = event.sequence;
      }
      for (const asset of result.assets.values()) if (!asset.refs) throw Error("Unreferenced history attachment.");
      if (sequence >= Number.MAX_SAFE_INTEGER - MAX_EVENTS) throw Error("History sequence limit reached.");
      result.bytes = total; result.nextSequence = sequence + 1;
      result.startedAt = typeof value.startedAt === "string" ? value.startedAt.slice(0, 40) : now();
      result.incomplete = value.incomplete === true;
      result.incompleteReasons = Array.isArray(value.incompleteReasons) ? value.incompleteReasons.slice(0, 16).map(reason => String(reason).slice(0, 160)) : [];
      result.droppedEvents = Number.isSafeInteger(value.droppedEvents) && value.droppedEvents >= 0 ? value.droppedEvents : 0;
      result.hasWork = result.events.some(event => /^(canvas\.commit|canvas\.undo|canvas\.redo|native\.revision|ai\.)/.test(event.type));
      return result;
    }
    function snapshot(ctx) {
      return { version:1, startedAt:ctx.startedAt, updatedAt:now(), nextSequence:ctx.nextSequence,
        incomplete:ctx.incomplete, incompleteReasons:ctx.incompleteReasons.slice(), droppedEvents:ctx.droppedEvents,
        bytes:ctx.bytes, events:clone(ctx.events),
        assets:Array.from(ctx.assets.values(), ({ hash, blob, mime, size }) => ({ hash, blob, mime, size })) };
    }
    function restore(item = null, options = {}) {
      if (signedOut || !local()) { boundary("non-local-page"); return; }
      boundary("document-replaced");
      let ctx = newContext();
      if (item?.workHistory) {
        try { ctx = decode(item.workHistory); }
        catch { mark(ctx, "saved-history-invalid"); }
      }
      current = ctx;
      if (item) {
        gap(ctx, item.workHistory ? "reload-or-unobserved-period" : "history-unavailable-before-this-open", {
          historicalActionsReconstructed:false });
      }
      append(ctx, "document.opened", { baselineOnly:true, existingPage:Boolean(item),
        historyStartsNow:!item?.workHistory, reason:options.reason || "page-opened",
        coverage:"Observed edits and AI, coalesced checkpoints; no outside-app activity, audio, or per-stroke ancestry." });
      requestCheckpoint(ctx, item ? "reopened-baseline" : "initial-baseline");
    }
    function loadFailed(generation) {
      const ctx = current;
      if (!ctx || signedOut || generation !== state.snapshotLoadGeneration || state.currentSnapshotId !== ctx.page.id) return;
      ctx.page = page(); ctx.closed = false; ctx.epoch++;
      gap(ctx, "failed-load-unobserved-period");
      requestCheckpoint(ctx, "after-failed-load-baseline");
    }
    function beginSave(location) {
      const ctx = live();
      return ctx && location === "device" ? { ctx, epoch:ctx.epoch, accountEpoch, preparedVersion:null } : null;
    }
    function isSaveCurrent(token, revision) {
      return Boolean(token && !signedOut && token.accountEpoch === accountEpoch && !token.ctx.closed &&
        samePage(token.ctx) && token.epoch === token.ctx.epoch &&
        (revision === undefined || (revision === state.userRevision && token.stamp?.mutation === token.ctx.mutation &&
          token.stamp?.native === (tenetInkController?.snapshot() || null))));
    }
    function pinSave(token) { if (isSaveCurrent(token)) token.stamp = stamp(token.ctx); }
    async function serializeForSave(token, item, revision) {
      if (!isSaveCurrent(token, revision)) return null;
      const ctx = token.ctx;
      // Save has finalized edits. Recover a full checkpoint missed while the
      // UI was unsettled, using the already-pinned save revision, never a later
      // page state. Drain at most the existing job and one coalesced checkpoint.
      if (!ctx.lastCheckpoint || !matches(ctx, ctx.lastCheckpoint.stamp)) {
        ctx.pending = { stamp:token.stamp, label:"saved-end-state", unsupported:null,
          count:(ctx.pending?.count || 0) + 1 };
      }
      await flush();
      if (!isSaveCurrent(token, revision)) return null;
      if (ctx.lastCheckpoint && matches(ctx, ctx.lastCheckpoint.stamp)) {
        token.preparedVersion = ctx.version;
        return snapshot(ctx);
      }
      try {
        // A real capture failure retains the explicit gap above. The snapshot
        // thumbnail is only the bounded fallback, never the normal end state.
        const assets = [];
        if (item.preview instanceof Blob && item.preview.size <= MAX_IMAGE)
          assets.push(await attachment(item.preview.type === "image/webp" ? "page.webp" : "page.png", item.preview));
        const native = nativeBlob(token.stamp.native);
        if (native) assets.push(await attachment("drawing.pkdrawing", native));
        if (!isSaveCurrent(token, revision)) return null;
        append(ctx, "canvas.checkpoint", { label:"saved-end-state", userRevision:revision,
          representation:"saved-page-thumbnail", thumbnailMayBeFallback:true, everyStroke:false,
          nativeArchiveIncluded:Boolean(native), blank:assets.every(asset => !asset.blob.type.startsWith("image/")) }, assets);
      } catch {
        if (!isSaveCurrent(token, revision)) return null;
        gap(ctx, "save-checkpoint-attachment-failed");
      }
      token.preparedVersion = ctx.version;
      return snapshot(ctx);
    }
    function degradeForSave(token, prepared) {
      if (!token || !prepared) return null;
      mark(token.ctx, "snapshot-history-storage-failed");
      // Keep all in-memory events for retry. Only this fallback save is reduced;
      // it explicitly states that its history is unavailable, not complete.
      const last = prepared.events.at(-1);
      return { version:1, startedAt:prepared.startedAt, updatedAt:now(), incomplete:true,
        incompleteReasons:["snapshot-history-storage-failed"], droppedEvents:prepared.droppedEvents + prepared.events.length,
        events:[{ sequence:(last?.sequence || 0) + 1, timestamp:now(), type:"coverage.gap",
          details:{ reason:"snapshot-history-storage-failed", evidence:"local-client-observation", serverVerified:false,
            omittedEvents:prepared.events.length, notebookContentPreserved:true }, assets:[] }], assets:[] };
    }
    function didSave(token, id) {
      const ctx = token?.ctx;
      if (!ctx || current !== ctx || signedOut || ctx.closed || token.epoch !== ctx.epoch ||
          token.accountEpoch !== accountEpoch || ctx.page.generation !== state.snapshotLoadGeneration ||
          state.currentSnapshotId !== id || state.currentSnapshotLocation !== "device") return;
      ctx.page = page();
      ctx.savedVersion = Math.max(ctx.savedVersion, token.preparedVersion ?? -1);
      report(ctx);
    }
    function assertReader(epoch) {
      if (signedOut || epoch !== accountEpoch) throw Error("Notebook history is unavailable after an account change.");
    }
    async function listSavedPages() {
      const epoch = accountEpoch;
      assertReader(epoch);
      const items = await allSnapshots();
      assertReader(epoch);
      return items.map(item => ({ id:item.id, name:item.name || "Untitled canvas", createdAt:item.createdAt,
        eventCount:Array.isArray(item.workHistory?.events) ? Math.min(MAX_EVENTS, item.workHistory.events.length) : 0,
        hasHistory:item.workHistory?.version === 1 && Array.isArray(item.workHistory.events) && item.workHistory.events.length > 0 }));
    }
    async function readSavedPage(id) {
      const epoch = accountEpoch;
      assertReader(epoch);
      const stored = await readDeviceSnapshot(id);
      assertReader(epoch);
      if (!stored?.item) throw Error("Saved notebook page was not found.");
      const item = stored.item;
      let history = null, invalid = false;
      if (item.workHistory) { try { history = decode(item.workHistory); } catch { invalid = true; } }
      const events = history?.events || [];
      return { historyAvailable:Boolean(history && events.length), events,
        attempt:{ id:item.id, title:item.name || "Untitled canvas", phase:"unconfigured", status:"saved",
          createdAt:item.createdAt, updatedAt:item.updatedAt || item.createdAt, eventCount:events.length,
          incomplete:invalid || Boolean(history?.incomplete), incompleteReasons:invalid ? ["saved-history-invalid"] : history?.incompleteReasons || [],
          droppedEvents:history?.droppedEvents || 0, evidence:"local-client-observation", serverVerified:false },
        async getAsset(attemptId, hash) {
          assertReader(epoch);
          if (attemptId !== item.id) throw Error("History asset belongs to a different saved page.");
          const asset = history?.assets.get(hash);
          if (!asset) throw Error("History attachment is unavailable.");
          const checked = await attachment("asset", asset.blob);
          assertReader(epoch);
          if (checked.hash !== hash) throw Error("History attachment hash mismatch.");
          return asset.blob;
        } };
    }
    function protect(callback) {
      return (...args) => {
        try { return callback(...args); }
        catch { if (current) mark(current, "history-observer-failed"); return null; }
      };
    }
    window.TenetDocumentHistory = Object.freeze({ listSavedPages, readSavedPage,
      currentSavedPageId:() => !signedOut && state.currentSnapshotLocation === "device" ? state.currentSnapshotId ?? null : null,
      isDirty:() => Boolean(live()?.hasWork && current.version > current.savedVersion),
      hasWork:() => Boolean(live()?.hasWork), flush,
      beginSave:protect(beginSave), pinSave:protect(pinSave), isSaveCurrent,
      serializeForSave, degradeForSave:protect(degradeForSave), didSave:protect(didSave),
      restore:protect(restore), loadFailed:protect(loadFailed) });
    window.TenetProcessCapture = Object.freeze({
      boundary:protect(boundary), aiRequested:protect(aiRequested), aiResponse:protect(aiResponse), aiFinished:protect(aiFinished),
      commit:protect(entry => observe("canvas.commit", historyDetails(entry), "committed-edit")),
      history:protect((entry, side) => observe(side === "before" ? "canvas.undo" : "canvas.redo", historyDetails(entry), "history-change",
        entry?.[side === "before" ? "textBoxesBefore" : "textBoxesAfter"] ? "asynchronous-text-restoration-not-observed" : null)),
      nativeRevision:protect(value => {
        const ctx = live();
        if (!ctx || ctx.lastNativeRevision === value.revision) return;
        ctx.lastNativeRevision = value.revision;
        observe("native.revision", { revision:value.revision, strokeCount:value.strokeCount,
          changedBounds:safeBox(value.changedBounds), changedBoundsAreConservative:true,
          granularity:"accepted-PKDrawing-revision-not-individual-stroke" }, "native-revision");
      }) });
    window.addEventListener("tenet:sign-out", () => boundary("sign-out"));
    for (const event of ["pagehide", "popstate", "hashchange"]) window.addEventListener(event, () => boundary(event));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) boundary("backgrounded");
      else if (current?.closed && samePage(current)) {
        current.closed = false; current.epoch++;
        gap(current, "background-unobserved-period"); requestCheckpoint(current, "foreground-baseline");
      }
    });
    restore(null, { reason:"automatic-notebook-history" });
  })();
