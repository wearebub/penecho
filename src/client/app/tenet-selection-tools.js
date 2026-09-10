var tenetCanvasAI = null;
(function initializeTenetSelectionToolsModule() {
  if (typeof PENECHO_CONFIG === "undefined" || !PENECHO_CONFIG.tenetMode) return;

  const AI_ACTIONS = [
      { action: "explain", label: "Explain" },
      { action: "check", label: "Check step" },
      { action: "practice", label: "Practice" },
      { action: "hint", label: "Hint" },
    ],
    INK_COLORS = ["#172a3a", "#2166d1", "#c9362b", "#1f7a4d", "#d27a00"];

  function addStylesheet() {
    if (document.querySelector('link[data-tenet-selection-styles]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/tenet-selection-tools.css";
    link.dataset.tenetSelectionStyles = "true";
    document.head.append(link);
  }

  function makeButton(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function mount() {
    mountCircleHelp();
    const toolbar = document.getElementById("selectionToolbar");
    if (!toolbar || toolbar.querySelector("[data-tenet-selection-tools]")) return;
    addStylesheet();
    toolbar.classList.add("tenet-selection-toolbar");

    const scopeNotice = document.getElementById("selectionScopeNotice");
    if (scopeNotice) scopeNotice.textContent = "Only the pixels inside your circle are sent for this AI request.";

    const tools = document.createElement("div");
    tools.className = "tenet-selection-tools";
    tools.dataset.tenetSelectionTools = "true";

    const aiGroup = document.createElement("div");
    aiGroup.className = "tenet-selection-group tenet-selection-ai-group";
    aiGroup.setAttribute("aria-label", "Ask Tenet about this selection");
    const aiLabel = document.createElement("span");
    aiLabel.className = "tenet-selection-label";
    aiLabel.textContent = "Ask Tenet";
    aiGroup.append(aiLabel);
    for (const item of AI_ACTIONS) {
      const button = makeButton(item.label, "tenet-selection-button tenet-selection-ai-button");
      button.dataset.tenetSelectionAi = item.action;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        void invokeAIAction(item.action);
      });
      aiGroup.append(button);
    }

    const editGroup = document.createElement("div");
    editGroup.className = "tenet-selection-group tenet-selection-edit-group";
    editGroup.setAttribute("aria-label", "Edit selected ink");
    const editLabel = document.createElement("span");
    editLabel.className = "tenet-selection-label";
    editLabel.textContent = "Edit ink";
    editGroup.append(editLabel);

    const colors = document.createElement("div");
    colors.className = "tenet-selection-colors";
    colors.setAttribute("aria-label", "Recolor selected ink");
    for (const [index, color] of INK_COLORS.entries()) {
      const swatch = makeButton("", "tenet-selection-color");
      swatch.dataset.tenetSelectionEdit = "recolor";
      swatch.dataset.selectionColor = String(index);
      swatch.setAttribute("aria-label", `Recolor selection ${color}`);
      swatch.addEventListener("click", (event) => {
        event.preventDefault();
        applySelectionColor(color);
      });
      colors.append(swatch);
    }
    editGroup.append(colors);

    const duplicateButton = makeButton("Duplicate", "tenet-selection-button");
    duplicateButton.dataset.tenetSelectionEdit = "duplicate";
    duplicateButton.addEventListener("click", (event) => {
      event.preventDefault();
      duplicateSelection();
    });
    editGroup.append(duplicateButton);

    for (const action of ["undo", "redo"]) {
      const button = makeButton(action === "undo" ? "Undo" : "Redo", "tenet-selection-button tenet-selection-history-button");
      button.dataset.tenetSelectionEdit = action;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        document.querySelector(`[data-action="${action}"]`)?.click();
      });
      editGroup.append(button);
    }

    const hint = document.createElement("p");
    hint.className = "tenet-selection-hint";
    hint.textContent = "Drag the selection to move it. Drag an edge handle to resize it.";

    tools.append(aiGroup, editGroup, hint);
    toolbar.append(tools);

    const deleteButton = document.getElementById("selectionDeleteBtn");
    if (deleteButton) deleteButton.textContent = "Erase selection";
  }

  function mountCircleHelp() {
    const boardToolbar = document.querySelector('[data-tenet-ink-toolbar], .toolbar');
    if (!boardToolbar || tenetCanvasAI) return;
    addStylesheet();
    const lifetime = new AbortController(), signal = lifetime.signal;
    const entry = document.createElement("div");
    entry.className = "tenet-ai-entry";
    const circle = makeButton("Circle selection", "tenet-selection-button tenet-selection-ai-button");
    circle.classList.add("tenet-circle-trigger");
    circle.setAttribute("aria-label", "Circle selection");
    circle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 19c-5.5.6-10-2.5-10-7S7 4 12 4s9 3 9 7c0 1-.2 2-.7 2.8" stroke-dasharray="3 3"/><path d="m14 13 7 3-3.3 1.4-1.4 3.3Z"/></svg>';
    circle.setAttribute("aria-pressed", "false");
    circle.title = "Draw around an area to move its ink or ask Tenet. Tap again to cancel.";
    const scope = document.createElement("select");
    scope.className = "tenet-ai-scope";
    scope.setAttribute("aria-label", "Quick AI context");
    for (const [value, label] of [["recent", "Recent writing"], ["page", "Visible page"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; scope.append(option);
    }
    scope.title = "Choose what Quick Ask sends. Circle selection chooses an exact area.";
    entry.append(circle, scope);
    view.append(entry);

    const surface = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    surface.classList.add("tenet-ai-circle-surface");
    surface.setAttribute("aria-label", "Circle the part of the page you want help with");
    surface.setAttribute("role", "img");
    surface.setAttribute("hidden", "");
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    surface.append(polygon);
    const controls = document.createElement("div");
    controls.className = "tenet-ai-region-controls";
    controls.hidden = true;
    controls.setAttribute("role", "region");
    controls.setAttribute("aria-label", "Help with the circled area");
    const notice = document.createElement("span");
    notice.setAttribute("role", "status");
    const help = makeButton("Quick help", "tenet-selection-button tenet-selection-ai-button");
    const question = makeButton("Ask AI a question", "tenet-selection-button");
    const move = makeButton("Move ink", "tenet-selection-button");
    move.setAttribute("aria-pressed", "false");
    const talk = makeButton("Talk to Tenet", "tenet-selection-button");
    talk.classList.add("tenet-circle-talk");
    talk.setAttribute("aria-label", "Talk to Tenet about this selection");
    talk.title = "Talk to Tenet about this selection";
    talk.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="3" width="6" height="11" rx="3"/><path d="M3 10v1a6 6 0 0 0 12 0v-1M9 17v4M6 21h6M19 8v8M22 10v4"/></svg>';
    const redraw = makeButton("Circle again", "tenet-selection-button");
    const cancel = makeButton("Cancel", "tenet-selection-button");
    controls.append(notice, move, help, question, talk, redraw, cancel);
    view.append(surface, controls);

    const dialog = document.createElement("dialog");
    dialog.className = "tenet-ai-question";
    dialog.setAttribute("aria-labelledby", "tenetAiQuestionTitle");
    const form = document.createElement("form");
    const title = document.createElement("h2");
    title.id = "tenetAiQuestionTitle"; title.textContent = "Ask about your selection";
    const caption = document.createElement("p");
    caption.textContent = "Only the circled pixels and this question go to your district Gateway. The rest of the page is not included.";
    const preview = document.createElement("img");
    preview.alt = "Selected area that will be sent to Tenet";
    const label = document.createElement("label");
    label.textContent = "Your question";
    const input = document.createElement("textarea");
    input.rows = 3; input.maxLength = 1000; input.required = true;
    input.placeholder = "For example: Why is this step incorrect?";
    label.append(input);
    const actions = document.createElement("div");
    const submit = makeButton("Ask Tenet", "tenet-selection-button tenet-selection-ai-button");
    submit.type = "submit";
    const back = makeButton("Back", "tenet-selection-button");
    actions.append(back, submit); form.append(title, caption, preview, label, actions);
    dialog.append(form); document.body.append(dialog);

    let region = null, pendingStart = 0, pointer = null, drawing = false, preparing = false;
    let moving = false, moveGesture = null;
    function paint() {
      if (!region) return;
      const rect = view.getBoundingClientRect();
      const metrics = canvasViewportMetrics(), factor = rect.width / Math.max(1, metrics.width);
      surface.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      polygon.setAttribute("points", region.points.map(p => `${(p.x*state.scale+state.panX)*factor},${(p.y*state.scale+state.panY)*factor}`).join(" "));
      const ready = !drawing && Boolean(tenetRegionGeometry(region.points));
      controls.hidden = !ready;
      for (const button of [help, question, move, talk]) {
        button.disabled = !ready || preparing || Boolean(moveGesture);
        button.hidden = !ready;
      }
      talk.hidden = !ready || !tenetVoice;
      move.setAttribute("aria-pressed", String(moving));
      surface.classList.toggle("is-moving", moving);
      cancel.disabled = redraw.disabled = preparing;
    }
    function close() {
      pendingStart++;
      if (dialog.open) dialog.close();
      const captured = pointer;
      pointer = null; drawing = false; moving = false; moveGesture = null;
      if (captured !== null && surface.hasPointerCapture?.(captured)) surface.releasePointerCapture(captured);
      const reason = region?.reason;
      region = null;
      surface.setAttribute("hidden", "");
      controls.hidden = true;
      circle.setAttribute("aria-pressed", "false");
      preview.removeAttribute("src"); input.value = "";
      if (reason) tenetInkController?.resume(reason);
    }
    function unchanged(value) {
      return region === value && value.page === state.snapshotLoadGeneration &&
        value.revision === state.userRevision && value.generation === state.recognitionGeneration;
    }
    async function start() {
      if (region) { close(); return; }
      if (state.busy || state.pending || state.pendingWidget || state.drawing || tenetInkController?.active()) {
        tenetInkMessage("Finish the current stroke or AI draft, then circle an area."); return;
      }
      const token = ++pendingStart, reason = `ai-circle-${token}`, page = state.snapshotLoadGeneration;
      preparing = true; circle.disabled = true;
      try {
        clearTimeout(state.timer); state.timer = 0;
        if (state.selection) commitSelection();
        await tenetInkController?.suspend(reason);
        await tenetInkFlush();
        if (token !== pendingStart || page !== state.snapshotLoadGeneration) { tenetInkController?.resume(reason); return; }
        document.activeElement?.blur?.();
        region = { reason, points:[], revision:state.userRevision, generation:state.recognitionGeneration, page:state.snapshotLoadGeneration };
        surface.removeAttribute("hidden");
        controls.hidden = true;
        circle.setAttribute("aria-pressed", "true");
        notice.textContent = "Circle an area, then move its ink or ask Tenet about it.";
      } catch (error) { tenetInkController?.resume(reason); tenetInkMessage(error.message); }
      finally { preparing = false; circle.disabled = false; paint(); }
    }
    function addPoint(event) {
      const point = SELECT.clipPoint(clientPoint(event), SIZE), last = region.points.at(-1);
      if (last && Math.hypot(point.x-last.x, point.y-last.y)*state.scale < 1) return;
      if (region.points.length >= 256) region.points = region.points.filter((_, i) => i%2 === 0);
      region.points.push({ x:point.x, y:point.y });
    }
    async function capture(value, text = "") {
      if (!value || !unchanged(value)) throw Error("The page changed. Cancel and circle the work again.");
      const bounds = tenetRegionGeometry(value.points);
      if (!bounds) throw Error("Circle an area of the page first.");
      await prepareVisibleWidgetSnapshots(bounds);
      if (!unchanged(value)) throw Error("The page changed. Circle the work again.");
      return buildTenetRegionImage(value.points, text);
    }
    async function ask(action = "hint", text = "") {
      if (preparing || drawing) return;
      preparing = true; paint();
      const value = region;
      try {
        const packed = await capture(value, text);
        const options = { isolatedSelection:true, expectedRevision:value.revision, expectedGeneration:value.generation };
        close();
        supersedeActiveAI("tenet-circled-area");
        await requestAI(action === "auto" ? "hint" : action, packed, options);
      } catch (error) { tenetInkMessage(error.message); }
      finally { preparing = false; paint(); }
    }
    async function quick(action) {
      if (preparing) return;
      // Student help stays a hint across input methods. The hint contract
      // already permits ordinary conversation without revealing school answers.
      action = "hint";
      if (scope.value === "page") { await requestAI(action, null, { captureCurrentViewport:true }); return; }
      preparing = true;
      try {
        await tenetInkFlush();
        const visible = viewportRect(), recent = state.dirty || state.lastUserBox;
        const bounds = recent && visible ? intersection(recent, visible) : null;
        if (!bounds) throw Error("Write something new, circle an area, or choose Visible page for Quick Ask.");
        const { x,y,w,h } = bounds, revision = state.userRevision, generation = state.recognitionGeneration;
        await prepareVisibleWidgetSnapshots(bounds);
        if (revision !== state.userRevision || generation !== state.recognitionGeneration) throw Error("The page changed. Try Quick Ask again.");
        const packed = buildTenetRegionImage([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]);
        await requestAI(action, packed, { expectedRevision:revision, expectedGeneration:generation });
      } catch (error) { tenetInkMessage(error.message); }
      finally { preparing = false; }
    }
    function voiceContext() {
      if (!region) return null;
      if (drawing || preparing || moveGesture || !unchanged(region) || !tenetRegionGeometry(region.points))
        throw Error("Finish circling an area before asking about it.");
      return { points:region.points.map(point => ({...point})), revision:region.revision,
        generation:region.generation, page:region.page };
    }
    async function finishMove(value, gesture) {
      preparing = true; paint();
      try {
        if (!unchanged(value) || value.page !== state.snapshotLoadGeneration)
          throw Error("The page changed. Circle the ink again.");
        const dx = value.points[0].x - gesture.points[0].x;
        const dy = value.points[0].y - gesture.points[0].y;
        if (Math.abs(dx) + Math.abs(dy) < 0.01) return;
        if (window.TenetInk?.getStatus?.().engine === "pencilkit") {
          if (!tenetInkController?.moveRegion) throw Error("Update the iPad app to move circled PencilKit ink.");
          const result = await tenetInkController.moveRegion(gesture.points, dx, dy);
          if (!result?.moved) throw Error("Circle complete PencilKit strokes to move them. Images and other ink stay in place.");
        } else {
          if (!captureSelection(gesture.points)) throw Error("There is no Web ink inside this circle. Use Hand to move pictures or shapes.");
          const selected = state.selection;
          selected.box = {...selected.box, x:selected.box.x + dx, y:selected.box.y + dy};
          commitSelection();
        }
        if (region !== value || value.page !== state.snapshotLoadGeneration) return;
        value.revision = state.userRevision; value.generation = state.recognitionGeneration;
        notice.textContent = "Ink moved. Drag again, ask about this area, or tap Done.";
      } catch (error) {
        if (region === value) value.points = gesture.points;
        tenetInkMessage(error?.message || "The selected ink could not be moved.");
      } finally { preparing = false; paint(); }
    }
    move.addEventListener("click", () => {
      moving = !moving;
      notice.textContent = moving
        ? "Drag inside the circle and release to move ink from the current drawing engine. Pictures and other layers stay in place."
        : "Choose Quick help, Ask AI a question, or Talk to Tenet.";
      paint();
    }, {signal});
    talk.addEventListener("click", () => {
      try { if (tenetVoice) void tenetVoice.openSelection(voiceContext()); }
      catch (error) { tenetInkMessage(error.message); }
    }, {signal});
    cancel.textContent = "Done";
    circle.addEventListener("click", () => { void start(); }, { signal });
    cancel.addEventListener("click", close, { signal });
    redraw.addEventListener("click", () => {
      if (region && !preparing) { region.points = []; moving = false; notice.textContent = "Circle a new area."; paint(); }
    }, { signal });
    help.addEventListener("click", () => { void ask("hint"); }, { signal });
    question.addEventListener("click", () => {
      if (!region || preparing) return;
      // Open synchronously from the gesture so iPad can present its keyboard.
      dialog.showModal(); input.focus(); preparing = true; submit.disabled = true; paint();
      const value = region;
      void capture(value).then(packed => { if (dialog.open && unchanged(value)) preview.src = packed.atlasImage; })
        .catch(error => { if (dialog.open) dialog.close(); tenetInkMessage(error.message); })
        .finally(() => { preparing = false; submit.disabled = false; paint(); });
    }, { signal });
    back.addEventListener("click", () => dialog.close(), { signal });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      void ask("hint", input.value.trim());
    }, { signal });
    surface.addEventListener("pointerdown", event => {
      event.preventDefault(); event.stopPropagation();
      if (!region || preparing || event.button > 0 || pointer !== null) return;
      if (moving) {
        const point = clientPoint(event), bounds = tenetRegionGeometry(region.points);
        if (!bounds || point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.w || point.y > bounds.y + bounds.h) return;
        pointer = event.pointerId;
        moveGesture = {point, bounds, points:region.points.map(p => ({...p}))};
        surface.setPointerCapture(pointer); paint(); return;
      }
      // A completed selection stays selected. A stray finger/palm landing on
      // the SVG must not silently replace it; Circle again explicitly redraws.
      if (tenetRegionGeometry(region.points)) return;
      pointer = event.pointerId; drawing = true; region.points = [];
      surface.setPointerCapture(pointer); addPoint(event); paint();
    }, { signal });
    surface.addEventListener("pointermove", event => {
      event.preventDefault(); event.stopPropagation();
      if (moveGesture && event.pointerId === pointer && region) {
        const point = clientPoint(event), box = moveGesture.bounds;
        const dx = Math.max(-box.x, Math.min(SIZE - box.x - box.w, point.x - moveGesture.point.x));
        const dy = Math.max(-box.y, Math.min(SIZE - box.y - box.h, point.y - moveGesture.point.y));
        region.points = moveGesture.points.map(p => ({x:p.x + dx, y:p.y + dy}));
        paint(); return;
      }
      if (!drawing || event.pointerId !== pointer || !region) return;
      const samples = event.getCoalescedEvents?.() || [];
      for (const sample of samples.length ? samples : [event]) addPoint(sample);
      paint();
    }, { signal });
    function finish(event) {
      event.preventDefault(); event.stopPropagation();
      if (event.pointerId !== pointer || !region) return;
      if (moveGesture) {
        const value = region, gesture = moveGesture, id = pointer;
        moveGesture = null; pointer = null;
        if (surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id);
        if (event.type !== "pointerup") { value.points = gesture.points; paint(); }
        else void finishMove(value, gesture);
        return;
      }
      if (event.type !== "pointerup") region.points = [];
      else addPoint(event);
      const captured = pointer;
      pointer = null; drawing = false;
      if (surface.hasPointerCapture?.(captured)) surface.releasePointerCapture(captured);
      const bounds = tenetRegionGeometry(region.points);
      if (!bounds || bounds.w*state.scale < 8 || bounds.h*state.scale < 8) region.points = [];
      notice.textContent = region.points.length ? "Selection ready. Move its ink, or ask Tenet about only this area." : "Circle a larger area to select it.";
      paint();
    }
    surface.addEventListener("pointerup", finish, { signal });
    surface.addEventListener("pointercancel", finish, { signal });
    surface.addEventListener("lostpointercapture", event => { if (pointer !== null) finish(event); }, {signal});
    document.addEventListener("visibilitychange", () => { if (document.hidden) close(); }, {signal});
    document.addEventListener("pointerdown", event => {
      if (!region || view.contains(event.target) || entry.contains(event.target) || dialog.contains(event.target)) return;
      close();
    }, { capture:true, signal });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && region && !dialog.open) { close(); event.preventDefault(); }
    }, { signal });
    window.addEventListener("resize", paint, { signal });
    window.visualViewport?.addEventListener("resize", paint, { signal });
    window.addEventListener("pagehide", event => {
      close();
      if (!event.persisted) lifetime.abort();
    }, { signal });
    tenetCanvasAI = { selectionActive:() => Boolean(region), ask, quick, close, voiceContext };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
