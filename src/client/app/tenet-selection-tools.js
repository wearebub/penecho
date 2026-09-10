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
    const circle = makeButton("Circle for AI", "tenet-selection-button tenet-selection-ai-button");
    circle.setAttribute("aria-pressed", "false");
    const scope = document.createElement("select");
    scope.className = "tenet-ai-scope";
    scope.setAttribute("aria-label", "Quick AI context");
    for (const [value, label] of [["recent", "Recent writing"], ["page", "Visible page"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label; scope.append(option);
    }
    scope.title = "Choose what the Quick Ask button sends. Circle for AI selects an exact area.";
    entry.append(circle, scope);
    boardToolbar.prepend(entry);

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
    const question = makeButton("Ask a question", "tenet-selection-button");
    const redraw = makeButton("Circle again", "tenet-selection-button");
    const cancel = makeButton("Cancel", "tenet-selection-button");
    controls.append(notice, help, question, redraw, cancel);
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
    function paint() {
      if (!region) return;
      const rect = view.getBoundingClientRect();
      const metrics = canvasViewportMetrics(), factor = rect.width / Math.max(1, metrics.width);
      surface.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      polygon.setAttribute("points", region.points.map(p => `${(p.x*state.scale+state.panX)*factor},${(p.y*state.scale+state.panY)*factor}`).join(" "));
      help.disabled = question.disabled = drawing || !tenetRegionGeometry(region.points) || preparing;
    }
    function close() {
      pendingStart++;
      if (dialog.open) dialog.close();
      if (pointer !== null && surface.hasPointerCapture?.(pointer)) surface.releasePointerCapture(pointer);
      pointer = null; drawing = false;
      const reason = region?.reason;
      region = null;
      surface.setAttribute("hidden", "");
      controls.hidden = true;
      circle.setAttribute("aria-pressed", "false");
      preview.removeAttribute("src"); input.value = "";
      if (reason) tenetInkController?.resume(reason);
    }
    function unchanged(value) {
      return region === value && value.revision === state.userRevision && value.generation === state.recognitionGeneration;
    }
    async function start() {
      if (region) { close(); return; }
      if (state.busy || state.pending || state.drawing || tenetInkController?.active()) {
        tenetInkMessage("Finish the current stroke or AI draft, then circle an area."); return;
      }
      const token = ++pendingStart, reason = `ai-circle-${token}`;
      preparing = true; circle.disabled = true;
      try {
        clearTimeout(state.timer); state.timer = 0;
        if (state.selection) commitSelection();
        await tenetInkController?.suspend(reason);
        await tenetInkFlush();
        if (token !== pendingStart) { tenetInkController?.resume(reason); return; }
        document.activeElement?.blur?.();
        region = { reason, points:[], revision:state.userRevision, generation:state.recognitionGeneration };
        surface.removeAttribute("hidden");
        controls.hidden = false;
        circle.setAttribute("aria-pressed", "true");
        notice.textContent = "Circle an area with your Pencil, finger, stylus, or mouse. Your ink will not move.";
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
    circle.addEventListener("click", () => { void start(); }, { signal });
    cancel.addEventListener("click", close, { signal });
    redraw.addEventListener("click", () => {
      if (region && !preparing) { region.points = []; notice.textContent = "Circle a new area."; paint(); }
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
      void ask("answer", input.value.trim());
    }, { signal });
    surface.addEventListener("pointerdown", event => {
      event.preventDefault(); event.stopPropagation();
      if (!region || preparing || event.button > 0 || pointer !== null) return;
      pointer = event.pointerId; drawing = true; region.points = [];
      surface.setPointerCapture(pointer); addPoint(event); paint();
    }, { signal });
    surface.addEventListener("pointermove", event => {
      event.preventDefault(); event.stopPropagation();
      if (!drawing || event.pointerId !== pointer || !region) return;
      const samples = event.getCoalescedEvents?.() || [];
      for (const sample of samples.length ? samples : [event]) addPoint(sample);
      paint();
    }, { signal });
    function finish(event) {
      event.preventDefault(); event.stopPropagation();
      if (event.pointerId !== pointer || !region) return;
      if (event.type === "pointercancel") region.points = [];
      else addPoint(event);
      if (surface.hasPointerCapture?.(pointer)) surface.releasePointerCapture(pointer);
      pointer = null; drawing = false;
      const bounds = tenetRegionGeometry(region.points);
      if (!bounds || bounds.w*state.scale < 8 || bounds.h*state.scale < 8) region.points = [];
      notice.textContent = region.points.length ? "Only the circled area will be sent. Choose Quick help or ask your own question." : "Circle a larger area to select it.";
      paint();
    }
    surface.addEventListener("pointerup", finish, { signal });
    surface.addEventListener("pointercancel", finish, { signal });
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
    tenetCanvasAI = { selectionActive:() => Boolean(region), ask, quick, close };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
