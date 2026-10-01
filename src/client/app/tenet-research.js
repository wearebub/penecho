(function installTenetResearch() {
  "use strict";
  if (window.PENECHO_CONFIG?.tenetMode !== true) return;
  const model = window.TenetResearchModel;
  const lifetime = new AbortController(), signal = lifetime.signal;
  const reason = "research-workspace";
  let ui, trigger, editingId = null, generation = null, busy = false, opening = false, suspended = false;
  let voice = null, voiceHandles = [], voiceTimer = null, disposed = false, lifecycle = 0;
  const downloads = new Set();
  const native = () => window.Capacitor?.getPlatform?.() === "ios" ? window.Capacitor.Plugins?.TenetNative : null;
  const notes = () => state.images.filter(item => model.normalize(item.tenetResearch));
  const say = text => { if (ui) ui.status.textContent = text; };
  function editable() {
    if (disposed || state.viewMode || snapshotLoadInProgress) throw Error("Open an editable page first.");
    if (state.pending || state.pendingWidget || state.selection || state.activeAI || selectionAIBusy()
      || state.imageImporting || state.textEditors.size) throw Error("Finish the current text, selection, or AI action first. Your work is unchanged.");
  }
  function requireCurrent(revision = null) {
    if (disposed || !ui?.dialog.open || generation !== state.snapshotLoadGeneration
      || revision !== null && revision !== state.userRevision) throw Error("The page changed. Reopen Research on the intended page.");
    editable();
  }
  function setBusy(value) {
    busy = value;
    ui.dialog.setAttribute("aria-busy", String(value));
    for (const control of ui.dialog.querySelectorAll("button,input,textarea,select")) control.disabled = value;
  }
  function release() {
    if (!suspended) return;
    suspended = false;
    void window.TenetInk?.resume(reason);
  }
  function cancelDictation() {
    const previous = voice;
    voice = null;
    clearTimeout(voiceTimer);
    voiceTimer = null;
    for (const handle of voiceHandles.splice(0)) void handle.remove().catch(() => {});
    if (previous) void native()?.cancelVoiceRecognition({sessionId:previous.id}).catch(() => {});
    ui?.dictate.setAttribute("aria-pressed", "false");
    if (ui) { ui.dictate.textContent = "Dictate a note"; ui.text.readOnly = false; }
  }
  function close() { if (!busy) ui.dialog.close(); }
  function selectNote(id = null, draft = null) {
    cancelDictation();
    const item = id ? notes().find(entry => entry.id === id) : null;
    if (id && !item) throw Error("That note is no longer on this page.");
    editingId = item?.id || null;
    const data = item?.tenetResearch || draft || {kind:"fact",title:"",text:"",source:"",url:""};
    for (const key of ["kind","title","text","source","url"]) ui[key].value = data[key] || "";
    ui.submit.textContent = item ? "Save changes" : "Add to board";
    ui.remove.hidden = !item;
    ui.copy.hidden = !item;
    ui.exportNote.hidden = !item;
    ui.heading.textContent = item ? "Edit " + (data.kind === "frame" ? "organizer" : "research note") : "New research note";
    say(item ? "Edits keep this note's place on the board. Undo is available after saving." : "Research stays on this iPad. Nothing here asks AI or uploads your sources.");
    refreshList();
  }
  function refreshList() {
    ui.list.replaceChildren();
    for (const item of notes()) {
      const button = element("button", "tenet-research-list-item");
      button.type = "button";
      button.dataset.kind = item.tenetResearch.kind;
      button.setAttribute("aria-pressed", String(item.id === editingId));
      button.textContent = item.tenetResearch.title || item.tenetResearch.text.slice(0, 70);
      button.addEventListener("click", () => safely(() => selectNote(item.id)), {signal});
      ui.list.append(button);
    }
    ui.empty.hidden = notes().length > 0;
  }
  async function safely(action) {
    try { await action(); }
    catch (error) {
      const message = error?.message || "This action could not finish. Your saved work is retained.";
      if (ui?.dialog.open) say(message); else tenetInkMessage(message);
    }
  }
  async function open(id = null, draft = null) {
    if (opening || busy || disposed) return;
    mount();
    if (!ui) return;
    if (ui.dialog.open) { selectNote(id, draft); return; }
    opening = true;
    const expectedGeneration = state.snapshotLoadGeneration, expectedLifecycle = lifecycle;
    try {
      editable();
      suspended = true;
      await window.TenetInk?.suspend(reason);
      await tenetInkFlush();
      if (expectedGeneration !== state.snapshotLoadGeneration || expectedLifecycle !== lifecycle) throw Error("The page changed. Reopen Research on the intended page.");
      editable();
      if (state.imageEdit) acceptImageEdit({restoreMode:false});
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.animationEdit) acceptAnimationEdit();
      generation = state.snapshotLoadGeneration;
      selectNote(id, draft);
      ui.dialog.showModal();
      ui.title.focus();
    } catch (error) { tenetInkMessage(error?.message || "Research could not open. Try again after lifting your Pencil."); }
    finally { opening = false; if (!ui.dialog.open) release(); }
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = "") {
    const node = element("button", className, text); node.type = "button";
    node.addEventListener("click", () => { if (!busy) void safely(action); }, {signal});
    return node;
  }
  function field(label, key, tag = "input", limit = null) {
    const wrapper = element("label", "tenet-research-field");
    const control = element(tag);
    control.id = "tenetResearch-" + key;
    if (limit) control.maxLength = limit;
    wrapper.htmlFor = control.id;
    wrapper.append(element("span", "", label), control);
    ui[key] = control;
    return wrapper;
  }
  function draft() {
    const value = model.normalize({version:1, ...Object.fromEntries(["kind","title","text","source","url"].map(key => [key, ui[key].value]))});
    if (!value) throw Error("Add a title or note. Source links must be complete http:// or https:// addresses, without a username or password.");
    return value;
  }
  async function prepare(value) {
    const artwork = model.render(value);
    try {
      const blob = await canvasBlob(artwork, "image/png");
      if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_IMAGE_SOURCE_BYTES) throw Error("This note is too large. Split it into shorter notes.");
      const image = await imageFromBlob(blob);
      return {blob, image, naturalW:artwork.width, naturalH:artwork.height};
    } finally { artwork.width = artwork.height = 1; }
  }
  function changed(items) {
    for (const item of items) state.dirtyImageIds.add(item.id);
    recomputeDirtyBounds();
    state.userRevision++;
    // Organizing evidence must not silently send the entire board to AI.
    state.autoEligible = false;
    saveUserCanvasChange();
    requestRender();
  }
  async function saveNote() {
    if (busy) return;
    cancelDictation(); requireCurrent();
    const data = draft(), existing = editingId ? notes().find(item => item.id === editingId) : null;
    if (editingId && !existing) throw Error("That note was removed. Add a new note instead.");
    if (!existing && state.images.length >= MAX_VISIBLE_IMAGES) throw Error("This page is full. Create another page for more research.");
    const revision = state.userRevision;
    setBusy(true);
    try {
      const prepared = await prepare(data);
      requireCurrent(revision);
      const placement = existing ? imageBox(existing) : importedImagePlacement(prepared.naturalW, prepared.naturalH);
      const item = imageRecord({...placement, ...prepared, ...(existing ? {id:existing.id} : {}),
        sourceName:data.title || "Research note", tenetResearch:data});
      if (!item) throw Error("The note could not be placed. Your previous note is retained.");
      recordImagesBefore();
      if (existing) state.images.splice(state.images.indexOf(existing), 1, item);
      else state.images.push(item);
      changed([item]);
      setBusy(false); ui.dialog.close();
      setCanvasMode("hand"); beginImageEdit(item); showHandObjectToolbar("image", item);
      tenetInkMessage("Note saved locally. Use Hand to move it; Edit note reopens its text and sources.");
    } finally { setBusy(false); }
  }
  async function insertTemplate(template) {
    requireCurrent(); cancelDictation();
    if (state.images.length + template.frames.length > MAX_VISIBLE_IMAGES) throw Error("There is not enough room for this organizer. Start a new page first.");
    const revision = state.userRevision;
    setBusy(true);
    try {
      const prepared = [];
      for (const frame of template.frames) {
        const data = model.normalize({version:1, kind:"frame", title:frame.title, text:frame.text || "", source:"", url:""});
        prepared.push({data, ...(await prepare(data))});
        requireCurrent(revision);
      }
      // Place below existing content, never clear a student's board for a template.
      const content = exportInkBounds(), visible = viewportRect();
      const width = 1100, height = 820, gap = 80, count = prepared.length;
      const x = Math.max(0, Math.min(SIZE - count * (width + gap), visible?.x || 0));
      const y = content ? content.y + content.h + gap : Math.max(0, visible?.y || 0);
      if (y + height > SIZE) throw Error("No empty space remains below this work. Create a new page for the organizer.");
      const items = prepared.map((item, index) => imageRecord({...item,
        x:x + index * (width + gap), y, w:width, h:height,
        sourceName:item.data.title, tenetResearch:item.data}));
      if (items.some(item => !item)) throw Error("The organizer could not be prepared. Nothing was added.");
      recordImagesBefore(); state.images.unshift(...items); changed(items);
      const metrics = canvasViewportMetrics();
      state.scale = Math.max(.03, Math.min(1, (metrics.width - 80) / (count * (width + gap)), (metrics.height - 100) / height));
      state.panX = 40 - x * state.scale; state.panY = 60 - y * state.scale;
      updateCoordinates(); requestRender(); tenetInkController?.sync();
      setBusy(false); ui.dialog.close(); setCanvasMode("hand");
      tenetInkMessage("Organizer added without replacing your work. Drag notes into the zones; use Insert for arrows. Research edits each heading.");
    } finally { setBusy(false); }
  }
  function removeNote() {
    requireCurrent();
    const item = notes().find(entry => entry.id === editingId);
    if (item) {
      state.autoEligible = false;
      deleteImage(item);
    }
    selectNote(); say("Note removed. Use Undo on the canvas to restore it.");
  }
  async function exportPng(onlyNote = false) {
    requireCurrent(); cancelDictation();
    const revision = state.userRevision;
    const item = onlyNote ? notes().find(entry => entry.id === editingId) : null;
    if (onlyNote && !item) throw Error("Choose a saved note or organizer first.");
    setBusy(true);
    let canvas;
    try {
      canvas = item ? model.render(item.tenetResearch) : await renderExportCanvas({isCurrent:() => ui.dialog.open && generation === state.snapshotLoadGeneration && revision === state.userRevision});
      if (!canvas) throw Error("Add something to the board before exporting an image.");
      const blob = await canvasBlob(canvas, "image/png");
      if (!blob || blob.size > 24 * 1024 * 1024) throw Error("The image exceeds the 24 MB sharing limit. Export a smaller note or use PDF.");
      requireCurrent(revision);
      const stem = String(item?.tenetResearch.title || state.currentSnapshotName || "Tenet board")
        .replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^[^A-Za-z0-9]+/, "").slice(0, 70) || "Tenet-board";
      const filename = stem + ".png", plugin = native();
      if (plugin?.exportFile) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(Error("The image could not be prepared.")); reader.readAsDataURL(blob);
        });
        requireCurrent(revision);
        try { await plugin.exportFile({base64, filename}); }
        catch (error) {
          if (error?.code === "invalid_export_filename") throw Error("Update Tenet in TestFlight for PNG sharing. PDF export is still available.");
          throw error;
        }
      } else {
        // Canvas encoding is asynchronous and can outlive Web Share activation.
        // Browser downloads do not need that transient gesture; iPad uses the
        // explicit native share bridge above.
        const url = URL.createObjectURL(blob); downloads.add(url);
        const link = element("a"); link.href = url; link.download = filename; ui.dialog.append(link); link.click(); link.remove();
        setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
      }
      say("Image prepared for your document. PNG contains the picture, not editable notes or replay history. Use PDF / .tenet for the full work record.");
    } catch (error) { if (error?.name !== "AbortError") throw error; }
    finally { if (canvas) canvas.width = canvas.height = 1; setBusy(false); }
  }
  async function dictate() {
    requireCurrent();
    const plugin = native();
    if (!plugin?.startVoiceRecognition) {
      ui.text.focus(); say("Use the microphone on your iPad keyboard to dictate here, or type your note. This does not ask AI."); return;
    }
    if (voice) { cancelDictation(); say("Dictation stopped. Review your text before adding it to the board."); return; }
    const session = {id:crypto.randomUUID(), prefix:ui.text.value.trim()}; voice = session;
    const current = () => voice === session && ui.dialog.open && generation === state.snapshotLoadGeneration && !disposed;
    ui.text.readOnly = true; ui.dictate.textContent = "Stop dictation"; ui.dictate.setAttribute("aria-pressed", "true");
    say("Starting on-device dictation. No audio is saved or sent to AI.");
    const apply = text => {
      if (!current() || typeof text !== "string" || !text.trim()) return;
      const next = [session.prefix, text.trim()].filter(Boolean).join("\n");
      if (next.length > 4000) { cancelDictation(); say("This note reached its text limit. Start another note; your previous text is retained."); return; }
      ui.text.value = next;
    };
    try {
      for (const handle of voiceHandles.splice(0)) await handle.remove();
      const listen = async (name, handler) => {
        const handle = await plugin.addListener(name, handler);
        if (!current()) { await handle.remove(); return; }
        voiceHandles.push(handle);
      };
      await listen("voiceTranscript", event => { if (event.sessionId === session.id) apply(event.text); });
      if (!current()) return;
      await listen("voiceState", event => {
        if (!current() || event.sessionId !== session.id) return;
        if (event.state === "listening") say("Listening on this iPad. Pause to finish, then review and add your note.");
        if (["stopped","error","cancelled"].includes(event.state)) {
          apply(event.text); cancelDictation();
          say(event.state === "error" ? "Dictation stopped. Your text is retained. Try again or use keyboard dictation." : "Review your note, then choose Add to board. Nothing was sent to AI.");
        }
      });
      if (!current()) return;
      voiceTimer = setTimeout(() => { if (current()) { cancelDictation(); say("Dictation timed out. Review the retained text or try again."); } }, 95000);
      const capability = await plugin.getVoiceCapabilities({locale:navigator.language});
      if (!current()) return;
      if (!capability?.supported) throw Error(capability?.reason || "On-device dictation is unavailable. Use your keyboard microphone or type instead.");
      const result = await plugin.startVoiceRecognition({sessionId:session.id, locale:capability.locale});
      if (!current()) { await plugin.cancelVoiceRecognition({sessionId:session.id}); return; }
      if (capability.confirmsAudioInput && (result?.state !== "listening" || result.audioInput !== true)) throw Error("The microphone did not start. Try again or use keyboard dictation.");
    } catch (error) { if (current()) { cancelDictation(); say(error?.message || "Dictation could not start. Type your note instead."); } }
  }
  function mount() {
    if (ui || disposed) return;
    const toolbar = document.querySelector("[data-tenet-ink-toolbar]");
    if (!toolbar) return;
    const sheet = element("link"); sheet.rel = "stylesheet"; sheet.href = "/tenet-research.css"; document.head.append(sheet);
    trigger = button("Research", () => open(), "tenet-tool-trigger"); trigger.id = "tenetResearchButton";
    trigger.setAttribute("aria-haspopup", "dialog"); trigger.setAttribute("aria-controls", "tenetResearchDialog");
    toolbar.prepend(trigger);
    const dialog = element("dialog", "tenet-research"); dialog.id = "tenetResearchDialog";
    dialog.setAttribute("aria-labelledby", "tenetResearchTitle");
    ui = {dialog};
    const header = element("header", "tenet-research-header");
    const title = element("h2", "", "Research & writing"); title.id = "tenetResearchTitle";
    header.append(title, button("Back to board", close));
    const intro = element("p", "tenet-research-intro", "Collect evidence. Make connections. Write in your own words.");
    const layout = element("div", "tenet-research-layout"), sidebar = element("aside", "tenet-research-library");
    ui.list = element("div", "tenet-research-list"); ui.empty = element("p", "", "No research notes yet. Start with a fact or your own idea.");
    sidebar.append(button("+ New note", () => selectNote(), "tenet-research-primary"), element("h3", "", "On this board"), ui.empty, ui.list);
    const form = element("form", "tenet-research-editor"); ui.heading = element("h3", "", "New research note"); form.append(ui.heading);
    form.append(field("Note type", "kind", "select"));
    for (const [id, label] of [["fact","Yellow / Evidence & direct quotes"],["thought","Blue / My thinking"],["source","Green / Source & citation"],["frame","Organizer / Named subtopic zone"]]) {
      const option = element("option", "", label); option.value = id; ui.kind.append(option);
    }
    form.append(field("Title or subtopic", "title", "input", 120), field("Note / quote / summary", "text", "textarea", 4000));
    ui.text.rows = 6; ui.text.placeholder = "Paste a quotation or explain the idea in your own words...";
    ui.dictate = button("Dictate a note", dictate); ui.dictate.setAttribute("aria-pressed", "false"); form.append(ui.dictate);
    form.append(field("Source / author / page reference", "source", "input", 300), field("Source website (optional)", "url", "input", 2048));
    ui.url.type = "url"; ui.url.placeholder = "https://...";
    const actions = element("div", "tenet-research-actions");
    ui.submit = element("button", "tenet-research-primary", "Add to board"); ui.submit.type = "submit";
    ui.copy = button("Duplicate", () => { const data = draft(); selectNote(null, data); });
    ui.remove = button("Delete note", removeNote);
    ui.exportNote = button("Save note as image", () => exportPng(true));
    actions.append(ui.submit, ui.copy, ui.exportNote, ui.remove); form.append(actions);
    form.addEventListener("submit", event => { event.preventDefault(); void safely(saveNote); }, {signal});
    layout.append(sidebar, form);
    const templates = element("section", "tenet-research-templates"); templates.append(element("h3", "", "Start with an organizer"));
    const templateGrid = element("div", "tenet-research-template-grid");
    for (const template of model.TEMPLATES) {
      const tile = button("", () => insertTemplate(template));
      tile.append(element("strong", "", template.title), element("span", "", template.description)); templateGrid.append(tile);
    }
    templates.append(templateGrid);
    const footer = element("footer", "tenet-research-footer");
    footer.append(button("Save board as image", () => exportPng()), element("p", "", "Use iPad multitasking to keep Safari or your writing app beside Tenet. Drop a quote, link, or image onto the board. Use Hand to arrange cards, and Insert for arrows. Your teacher can share a blank organizer as a PDF; open it from the notebook menu."));
    ui.status = element("p", "tenet-research-status"); ui.status.setAttribute("role", "status"); ui.status.setAttribute("aria-live", "polite");
    dialog.append(header, intro, layout, templates, ui.status, footer); document.body.append(dialog);
    dialog.addEventListener("keydown", event => event.stopPropagation(), {signal});
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); }, {signal});
    dialog.addEventListener("close", () => { cancelDictation(); release(); if (!disposed && !document.hidden) trigger.focus({preventScroll:true}); }, {signal});
    view.addEventListener("dragover", event => {
      if (!state.viewMode && !ui.dialog.open && [...(event.dataTransfer?.types || [])].some(type => ["Files","text/plain","text/uri-list"].includes(type))) event.preventDefault();
    }, {signal});
    view.addEventListener("drop", event => {
      if (event.target.closest?.("input,textarea,[contenteditable],dialog")) return;
      event.preventDefault(); event.stopPropagation();
      const transfer = event.dataTransfer;
      const files = [...(transfer?.files || [])];
      const text = transfer?.getData("text/plain") || "";
      const uri = (transfer?.getData("text/uri-list") || "").split(/\r?\n/).find(line => line && !line.startsWith("#")) || "";
      void safely(async () => {
        editable();
        if (files.length) {
          if (files.length > 8 || files.some(file => !/^image\/(png|jpeg|webp|gif|heic|heif)$/i.test(file.type))) throw Error("Drop up to eight images. Use Open document for a PDF.");
          const expected = state.snapshotLoadGeneration;
          suspended = true; await window.TenetInk?.suspend(reason);
          try {
            for (const [index, file] of files.entries()) {
              if (expected !== state.snapshotLoadGeneration) throw Error("The page changed. Drop remaining images again.");
              if (!await addImageFile(file, {offsetX:index * 80, offsetY:index * 80})) throw Error("An image could not be imported. Previously added images are retained.");
            }
          } finally { release(); }
          return;
        }
        if (text.length > 4000 || uri.length > 2048) throw Error("This selection is too long for one note. Drop a shorter quotation.");
        const url = uri || (/^https?:\/\/\S+$/i.test(text.trim()) ? text.trim() : "");
        if (!text && !url) return;
        const value = model.normalize({version:1, kind:!text.trim() || text.trim() === url ? "source" : "fact", title:"", text:text || url, source:"", url});
        if (!value) throw Error("Only safe http:// and https:// source links can be added.");
        await open(null, value);
      }).catch(() => {});
    }, {signal});
  }
  function retire() {
    lifecycle++;
    cancelDictation(); if (ui?.dialog.open) ui.dialog.close(); release();
    for (const handle of voiceHandles.splice(0)) void handle.remove();
  }
  window.TenetResearch = {open};
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelDictation(); }, {signal});
  window.addEventListener("tenet:sign-out", retire, {signal});
  window.addEventListener("pagehide", event => {
    retire();
    if (!event.persisted) { disposed = true; lifetime.abort(); for (const url of downloads) URL.revokeObjectURL(url); downloads.clear(); }
  }, {signal});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, {once:true,signal});
  else mount();
})();
