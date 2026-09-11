(() => {
  "use strict";

  const STYLE_ID = "tenet-ipad-usability-styles";
  const MAX_DECODED_IMPORT_BYTES = 24 * 1024 * 1024;
  let documentImportActive = false;
  let pencilImportActive = false;
  let pdfExportActive = false;

  // Native ink must be flushed and suspended while web tool dialogs own input.
  // Keep document operations on the existing image/history/persistence path.
  function createTenetToolDialog(id, title, description, trigger) {
    const dialog = document.createElement("dialog");
    dialog.id = id;
    dialog.className = "tenet-tool-dialog";
    dialog.setAttribute("aria-labelledby", id + "-title");
    dialog.setAttribute("aria-describedby", id + "-description");
    dialog.setAttribute("aria-modal", "true");
    const header = document.createElement("header");
    header.className = "tenet-tool-dialog-header";
    const heading = document.createElement("h2");
    heading.id = id + "-title";
    heading.textContent = title;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tenet-tool-close";
    closeButton.textContent = "Done";
    header.append(heading, closeButton);
    const help = document.createElement("p");
    help.id = id + "-description";
    help.className = "tenet-tool-description";
    help.textContent = description;
    const body = document.createElement("div");
    body.className = "tenet-tool-dialog-body";
    dialog.append(header, help, body);
    document.body.append(dialog);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", id);

    const lifetime = new AbortController();
    const signal = lifetime.signal;
    const reason = "tool-dialog:" + id;
    let opening = false, suspended = false, busy = false;
    const releaseInk = () => {
      if (!suspended) return;
      suspended = false;
      window.TenetInk?.resume(reason);
    };
    const api = {
      dialog, body, signal, beforeOpen: null,
      close: () => { if (!busy && dialog.open) dialog.close(); },
      setBusy: value => {
        busy = value;
        dialog.setAttribute("aria-busy", String(value));
        dialog.querySelectorAll("button, input, select").forEach(control => { control.disabled = value; });
      },
    };
    trigger.addEventListener("click", async () => {
      if (opening || dialog.open || busy) return;
      if (state.viewMode) {
        showTenetMessage("Leave view mode before using drawing tools.");
        return;
      }
      opening = true;
      try {
        suspended = true;
        await window.TenetInk?.suspend(reason);
        if (signal.aborted) return;
        api.beforeOpen?.();
        dialog.showModal();
      } catch (error) {
        showTenetMessage(error?.message || "Lift your Pencil and try again.", "error");
      } finally {
        opening = false;
        if (!dialog.open) releaseInk();
      }
    }, { signal });
    closeButton.addEventListener("click", api.close, { signal });
    dialog.addEventListener("cancel", event => {
      if (busy) event.preventDefault();
    }, { signal });
    // Do not let canvas shortcuts delete, undo, or finalize work behind a dialog.
    dialog.addEventListener("keydown", event => event.stopPropagation(), { signal });
    dialog.addEventListener("close", () => {
      releaseInk();
      if (!signal.aborted && document.visibilityState !== "hidden") trigger.focus({ preventScroll: true });
    }, { signal });
    window.addEventListener("pagehide", event => {
      if (event.persisted) return;
      lifetime.abort();
      releaseInk();
    }, { signal });
    return api;
  }

  function drawTenetInsertArtwork(kind, color, maxDimension = 1024) {
    if (["ellipse","right-triangle","diamond","pentagon","hexagon","octagon","star","plus","heart","trapezoid","parallelogram","double-arrow","arc","bracket","cube","cuboid","cylinder","cone","sphere","pyramid","triangular-prism","graph-3d","graph-isometric","graph-polar","graph-numberline"].includes(kind)) return drawTenetExtraArtwork(kind, color, maxDimension);
    const graph = kind === "graph-four" || kind === "graph-first";
    const dimensions = {
      rectangle: [720, 480], square: [512, 512], circle: [512, 512],
      triangle: [600, 520], line: [720, 128], arrow: [720, 240],
      "graph-four": [1024, 1024], "graph-first": [1024, 1024],
    };
    const size = dimensions[kind];
    if (!size) throw new Error("Unknown shape.");
    const [width, height] = size;
    const ratio = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Drawing tools are unavailable on this device.");
    context.scale(canvas.width / width, canvas.height / height);
    context.strokeStyle = color;
    context.lineWidth = 8;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (!graph) {
      context.beginPath();
      if (kind === "rectangle" || kind === "square") {
        context.rect(32, 32, width - 64, height - 64);
      } else if (kind === "circle") {
        context.arc(width / 2, height / 2, width / 2 - 32, 0, Math.PI * 2);
      } else if (kind === "triangle") {
        context.moveTo(width / 2, 32);
        context.lineTo(width - 32, height - 32);
        context.lineTo(32, height - 32);
        context.closePath();
      } else {
        context.moveTo(32, height / 2);
        context.lineTo(width - 32, height / 2);
        if (kind === "arrow") {
          context.moveTo(width - 116, height / 2 - 68);
          context.lineTo(width - 32, height / 2);
          context.lineTo(width - 116, height / 2 + 68);
        }
      }
      context.stroke();
      return canvas;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    const first = kind === "graph-first";
    const start = 100, end = 924, unit = (end - start) / 10;
    const originX = first ? start : (start + end) / 2;
    const originY = first ? end : (start + end) / 2;
    context.strokeStyle = "#dce3e9";
    context.lineWidth = 1.8;
    context.beginPath();
    for (let index = 0; index <= 10; index++) {
      const point = start + index * unit;
      context.moveTo(point, start);
      context.lineTo(point, end);
      context.moveTo(start, point);
      context.lineTo(end, point);
    }
    context.stroke();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(first ? originX : start - 22, originY);
    context.lineTo(end + 22, originY);
    context.moveTo(originX, first ? originY : end + 22);
    context.lineTo(originX, start - 22);
    const arrowhead = (x, y, dx, dy) => {
      context.moveTo(x - dx * 16 - dy * 9, y - dy * 16 + dx * 9);
      context.lineTo(x, y);
      context.lineTo(x - dx * 16 + dy * 9, y - dy * 16 - dx * 9);
    };
    arrowhead(end + 22, originY, 1, 0);
    arrowhead(originX, start - 22, 0, -1);
    if (!first) {
      arrowhead(start - 22, originY, -1, 0);
      arrowhead(originX, end + 22, 0, 1);
    }
    context.stroke();
    context.font = '500 24px "Avenir Next", "Trebuchet MS", sans-serif';
    context.lineWidth = 2;
    for (let index = 0; index <= 10; index++) {
      const value = first ? index : index - 5;
      if (value === 0) continue;
      const x = start + index * unit, y = end - index * unit;
      context.beginPath();
      context.moveTo(x, originY - 7);
      context.lineTo(x, originY + 7);
      context.moveTo(originX - 7, y);
      context.lineTo(originX + 7, y);
      context.stroke();
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(String(value), x, originY + 16);
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillText(String(value), originX - 16, y);
    }
    context.textAlign = "right";
    context.textBaseline = "top";
    context.fillText("0", originX - 14, originY + 14);
    context.font = 'italic 600 32px "Avenir Next", "Trebuchet MS", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("x", end + 60, originY);
    context.fillText("y", originX, start - 60);
    return canvas;
  }

  function drawTenetExtraArtwork(kind, color, maxDimension = 1024) {
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, maxDimension / 800);
    canvas.width = Math.round(800 * ratio); canvas.height = Math.round(600 * ratio);
    const q = canvas.getContext("2d");
    q.scale(canvas.width / 800, canvas.height / 600);
    q.strokeStyle = color; q.fillStyle = color; q.lineWidth = 7;
    q.lineCap = "round"; q.lineJoin = "round";
    const path = (points, closed = false) => {
      q.beginPath(); points.forEach(([x,y],i) => i ? q.lineTo(x,y) : q.moveTo(x,y));
      if (closed) q.closePath(); q.stroke();
    };
    const ellipse = (x,y,rx,ry) => { q.beginPath(); q.ellipse(x,y,rx,ry,0,0,Math.PI*2); q.stroke(); };
    if (kind.startsWith("graph-")) {
      q.fillStyle="#fff"; q.fillRect(0,0,800,600); q.fillStyle=color;
      q.font='24px "Avenir Next", "Trebuchet MS", sans-serif';
      q.textAlign="center"; q.textBaseline="middle";
      if (kind === "graph-polar") {
        q.lineWidth=2; q.strokeStyle="#dce3e9";
        for(let r=40;r<=240;r+=40) ellipse(400,300,r,r);
        for(let i=0;i<12;i++) { const a=i*Math.PI/6; path([[400,300],[400+240*Math.cos(a),300+240*Math.sin(a)]]); }
        q.strokeStyle=color; q.lineWidth=4; path([[120,300],[680,300]]); path([[400,30],[400,570]]);
        for(const [text,x,y] of [["0",700,300],["90",400,20],["180",95,300],["270",400,585]]) q.fillText(text,x,y);
      } else if (kind === "graph-numberline") {
        path([[65,300],[735,300]]); path([[85,285],[65,300],[85,315]]); path([[715,285],[735,300],[715,315]]);
        for(let i=-5;i<=5;i++) { const x=400+i*55; path([[x,288],[x,312]]); q.fillText(String(i),x,344); }
      } else {
        q.lineWidth=2; q.strokeStyle="#dce3e9";
        for(let i=-5;i<=5;i++) {
          const s=i*30;
          path([[400+s-180,330+s*0.5+90],[400+s+180,330+s*0.5-90]]);
          path([[400+s-180,330-s*0.5-90],[400+s+180,330-s*0.5+90]]);
          if(kind === "graph-isometric") path([[400+s*2,95],[400+s*2,535]]);
        }
        q.strokeStyle=color; q.lineWidth=5;
        path([[400,330],[675,465]]); path([[400,330],[125,465]]); path([[400,330],[400,70]]);
        path([[649,462],[675,465],[659,444]]); path([[141,444],[125,465],[151,462]]); path([[386,92],[400,70],[414,92]]);
        q.fillText("x",705,480); q.fillText("y",95,480); q.fillText("z",400,40); q.fillText("0",426,316);
      }
      return canvas;
    }
    const polygonSides={diamond:4,pentagon:5,hexagon:6,octagon:8};
    if (polygonSides[kind] || kind === "star") {
      const sides=polygonSides[kind] || 10;
      path(Array.from({length:sides},(_,i)=>{const a=-Math.PI/2+i*Math.PI*2/sides; const r=kind === "star" && i%2 ? 95 : 220; return [400+Math.cos(a)*r,300+Math.sin(a)*r];}),true);
    } else if(kind === "ellipse") ellipse(400,300,290,190);
    else if(kind === "right-triangle") path([[180,80],[180,510],[650,510]],true);
    else if(kind === "trapezoid") path([[255,110],[545,110],[690,490],[110,490]],true);
    else if(kind === "parallelogram") path([[280,110],[690,110],[520,490],[110,490]],true);
    else if(kind === "plus") path([[340,80],[460,80],[460,240],[650,240],[650,360],[460,360],[460,520],[340,520],[340,360],[150,360],[150,240],[340,240]],true);
    else if(kind === "double-arrow") path([[80,300],[250,150],[250,245],[550,245],[550,150],[720,300],[550,450],[550,355],[250,355],[250,450]],true);
    else if(kind === "heart") { q.beginPath(); q.moveTo(400,500); q.bezierCurveTo(50,270,180,20,400,190); q.bezierCurveTo(620,20,750,270,400,500); q.stroke(); }
    else if(kind === "arc") { q.beginPath(); q.ellipse(400,380,270,240,0,Math.PI,2*Math.PI); q.stroke(); }
    else if(kind === "bracket") path([[515,90],[285,90],[285,510],[515,510]]);
    else if(kind === "cube" || kind === "cuboid") {
      const right=kind === "cube" ? 490 : 610;
      path([[160,200],[right,200],[right,500],[160,500]],true);
      path([[160,200],[280,100],[right+120,100],[right,200]]);
      path([[right+120,100],[right+120,400],[right,500]]);
      q.setLineDash([12,10]); path([[280,100],[280,400],[160,500]]); path([[280,400],[right+120,400]]);
    } else if(kind === "cylinder") {
      ellipse(400,140,220,70); path([[180,140],[180,450]]); path([[620,140],[620,450]]); ellipse(400,450,220,70);
    } else if(kind === "cone") {
      path([[170,450],[400,75],[630,450]]); ellipse(400,450,230,70);
    } else if(kind === "sphere") {
      ellipse(400,300,230,230); q.lineWidth=3; ellipse(400,300,95,230); ellipse(400,300,230,70);
    } else if(kind === "pyramid") {
      path([[400,65],[120,420],[390,535],[680,420],[400,65],[390,535]]);
      q.setLineDash([12,10]); path([[120,420],[410,325],[680,420]]); path([[410,325],[400,65]]);
    } else if(kind === "triangular-prism") {
      path([[120,480],[310,110],[480,480]],true); path([[310,110],[510,65],[690,415],[480,480]]);
      q.setLineDash([12,10]); path([[120,480],[330,415],[690,415]]); path([[330,415],[510,65]]);
    } else throw new Error("Unknown shape.");
    return canvas;
  }

  function installShapeTools() {
    const toolbar = document.querySelector("[data-tenet-ink-toolbar]");
    if (!toolbar || document.getElementById("tenetInsertBtn")) return;
    const trigger = document.createElement("button");
    trigger.type="button"; trigger.id="tenetInsertBtn"; trigger.className="tenet-tool-trigger";
    trigger.textContent="+ Insert"; trigger.title="Insert shapes and graphs";
    toolbar.prepend(trigger);
    const tools=createTenetToolDialog("tenetInsertDialog","Insert","Choose a shape. Use Hand to move or resize it.",trigger);
    const search=document.createElement("input"); search.type="search"; search.placeholder="Search shapes and graphs";
    search.setAttribute("aria-label","Find a shape"); search.className="tenet-shape-search";
    const colorLabel=document.createElement("label"); colorLabel.className="tenet-tool-color"; colorLabel.textContent="Color";
    const color=document.createElement("input"); color.type="color"; color.value=/^#[0-9a-f]{6}$/i.test(state.inkColor) ? state.inkColor : "#10243e";
    colorLabel.append(color); tools.body.append(search,colorLabel);
    const groups=[
      ["Basic shapes",[["rectangle","Rectangle"],["square","Square"],["circle","Circle"],["ellipse","Ellipse"],["triangle","Triangle"],["right-triangle","Right triangle"],["line","Line"],["arrow","Arrow"],["double-arrow","Double arrow"]]],
      ["2D graphs",[["graph-four","Four quadrants"],["graph-first","First quadrant"],["graph-numberline","Number line"],["graph-polar","Polar grid"]]],
      ["3D & geometry",[["graph-3d","3D axes"],["graph-isometric","Isometric grid"],["cube","Cube"],["cuboid","Cuboid"],["cylinder","Cylinder"],["cone","Cone"],["sphere","Sphere"],["pyramid","Pyramid"],["triangular-prism","Triangular prism"]]],
      ["More shapes",[["diamond","Diamond"],["pentagon","Pentagon"],["hexagon","Hexagon"],["octagon","Octagon"],["star","Star"],["plus","Plus"],["heart","Heart"],["trapezoid","Trapezoid"],["parallelogram","Parallelogram"],["arc","Arc"],["bracket","Bracket"]]],
    ];
    const entries=[], sections=[];
    const errorMessage=document.createElement("p"); errorMessage.className="tenet-tool-error"; errorMessage.setAttribute("role","status");
    let inserting=false;
    for(const [title,options] of groups) {
      const details=document.createElement("details"); details.open=sections.length===0;
      const summary=document.createElement("summary"); summary.textContent=title;
      const grid=document.createElement("div"); grid.className="tenet-insert-grid";
      details.append(summary,grid); tools.body.append(details); sections.push(details);
      for(const [kind,label] of options) {
        const button=document.createElement("button"); button.type="button"; button.className="tenet-insert-card";
        button.setAttribute("aria-label","Insert "+label.toLowerCase()); button.title=label;
        const preview=drawTenetInsertArtwork(kind,color.value,120); preview.setAttribute("aria-hidden","true");
        const name=document.createElement("span"); name.textContent=label; button.append(preview,name); grid.append(button);
        entries.push({button,kind,label,details});
        button.addEventListener("click",async()=>{
          if(inserting)return; inserting=true; tools.setBusy(true); errorMessage.textContent="Adding "+label.toLowerCase()+"...";
          const pageGeneration=state.snapshotLoadGeneration;
          try {
            const artwork=drawTenetInsertArtwork(kind,color.value);
            const blob=await new Promise(resolve=>artwork.toBlob(resolve,"image/png"));
            if(tools.signal.aborted)return;
            if(!blob)throw new Error("Could not create this shape.");
            if(pageGeneration !== state.snapshotLoadGeneration)throw new Error("The page changed. Reopen Insert on the correct page.");
            const file=new File([blob],"Tenet "+label+".png",{type:"image/png"});
            const item=await addImageFile(file);
            if(tools.signal.aborted)return;
            if(!item)throw new Error("Finish the active image or AI operation and try again.");
            tools.setBusy(false); tools.close(); showTenetMessage(label+" added. Use Hand and the resize handles, or Pen to write.");
          } catch(error) { errorMessage.textContent=error?.message || "Could not insert this shape."; }
          finally { inserting=false; tools.setBusy(false); }
        },{signal:tools.signal});
      }
    }
    tools.body.append(errorMessage);
    color.addEventListener("input",()=>{
      for(const {button,kind} of entries) { const preview=drawTenetInsertArtwork(kind,color.value,120); preview.setAttribute("aria-hidden","true"); button.firstElementChild.replaceWith(preview); }
    },{signal:tools.signal});
    search.addEventListener("input",()=>{
      const term=search.value.trim().toLowerCase();
      for(const entry of entries) entry.button.hidden=!entry.label.toLowerCase().includes(term);
      for(const section of sections) { section.hidden=!entries.some(entry=>entry.details===section&&!entry.button.hidden); if(term)section.open=true; }
    },{signal:tools.signal});
    tools.beforeOpen=()=>{
      errorMessage.textContent="";
      const rect=trigger.getBoundingClientRect(), scale=rect.width/Math.max(1,trigger.offsetWidth);
      const css=runtimeElementStyle(tools.dialog,"tenet-insert-anchor");
      const left=Math.max(8,Math.min(rect.left,window.innerWidth-336*scale));
      css?.setProperty("--tenet-insert-left",left/scale+"px");
      css?.setProperty("--tenet-insert-top",Math.max(8,Math.min(rect.bottom+8,window.innerHeight-240*scale))/scale+"px");
    };
  }

  function installDrawingTools() {
    const penSize = document.getElementById("penSize");
    if (!penSize || document.getElementById("tenetDrawingOptionsBtn")) return;
    const preferenceKey = "tenet.whiteboard.input-mode.v1";
    let inputMode = "touch";
    try {
      const stored = localStorage.getItem(preferenceKey);
      if (stored === "pencil" || stored === "touch") inputMode = stored;
    } catch { /* Drawing still works when preference storage is unavailable. */ }
    const deviceAllowsFinger = () => {
      const setting = window.PENECHO_CONFIG?.tenetFingerDraws;
      if (setting === false) return false;
      if (setting === "phone") {
        const side = Math.min(Number(window.screen?.width) || 0, Number(window.screen?.height) || 0);
        return window.matchMedia("(pointer: coarse)").matches && side > 0 && side < 700;
      }
      return true;
    };
    window.TenetDrawingPreferences = Object.freeze({
      fingerDrawing: () => deviceAllowsFinger() && inputMode === "touch",
    });
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = "tenetDrawingOptionsBtn";
    trigger.className = "tenet-tool-trigger";
    trigger.title = "Line thickness and finger / stylus drawing";
    const toolbar = document.querySelector("[data-tenet-ink-toolbar]");
    if (toolbar) toolbar.prepend(trigger);
    else (document.getElementById("penSizeValue") || penSize).after(trigger);
    const tools = createTenetToolDialog("tenetDrawingDialog", "Line thickness & input",
      "Choose a line thickness and how you draw. Thickness changes apply to new strokes, not existing work.", trigger);
    const label = document.createElement("label");
    label.className = "tenet-drawing-width-label";
    label.htmlFor = "tenetDrawingWidth";
    label.textContent = "Line thickness";
    const value = document.createElement("output");
    value.htmlFor = "tenetDrawingWidth";
    label.append(value);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = "tenetDrawingWidth";
    slider.min = penSize.min || "1";
    slider.max = penSize.max || "24";
    slider.step = penSize.step || "1";
    const presets = document.createElement("div");
    presets.className = "tenet-width-presets";
    const setWidth = width => {
      penSize.value = String(width);
      // Reuse the canvas width clamp, label update and native synchronization.
      penSize.dispatchEvent(new Event("input", { bubbles: true }));
    };
    for (const [width, name] of [[3, "Thin"], [5, "Medium"], [8, "Thick"]]) {
      if (width < Number(slider.min) || width > Number(slider.max)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.width = String(width);
      button.textContent = name + " " + width + " px";
      button.addEventListener("click", () => setWidth(width), { signal: tools.signal });
      presets.append(button);
    }
    const modeLabel = document.createElement("label");
    modeLabel.className = "tenet-drawing-mode-label";
    modeLabel.htmlFor = "tenetDrawingInput";
    modeLabel.textContent = "Draw with";
    const mode = document.createElement("select");
    mode.id = "tenetDrawingInput";
    for (const [id, text] of [
      ["touch", "Finger / regular stylus + Apple Pencil"],
      ["pencil", "Apple Pencil only"],
    ]) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = text;
      mode.append(option);
    }
    const note = document.createElement("p");
    note.className = "tenet-tool-description";
    note.setAttribute("role", "status");
    const preview = document.createElement("canvas");
    preview.className = "tenet-width-preview";
    preview.width = 840;
    preview.height = 160;
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", "Preview of new strokes at the selected thickness");
    tools.body.append(label, slider, presets, preview, modeLabel, mode, note);
    const touchAllowed = () => deviceAllowsFinger()
      && !(window.TenetInk?.getStatus?.().engine === "pencilkit" && window.TenetInk?.fingerDrawingAllowed?.() === false);
    const updateWidth = () => {
      slider.value = penSize.value;
      value.textContent = penSize.value + " px";
      const nativeInk = window.TenetInk?.getStatus?.().engine === "pencilkit";
      document.body.classList.toggle("tenet-using-pencilkit", nativeInk);
      trigger.textContent = (nativeInk ? "Pencil thickness: " : "Line thickness: ") + penSize.value + " px";
      trigger.setAttribute("aria-label", trigger.textContent);
      const context = preview.getContext("2d");
      if (context) {
        context.clearRect(0, 0, preview.width, preview.height);
        context.save();
        context.scale(2, 2);
        context.strokeStyle = /^#[0-9a-f]{6}$/i.test(state.inkColor) ? state.inkColor : "#10243e";
        context.lineWidth = Number(penSize.value);
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(24, 46);
        context.bezierCurveTo(100, 8, 130, 70, 210, 40);
        context.bezierCurveTo(290, 10, 315, 70, 396, 32);
        context.stroke();
        context.restore();
      }
      penSize.setAttribute("aria-valuetext", penSize.value + " pixels");
      presets.querySelectorAll("button").forEach(button => {
        button.setAttribute("aria-pressed", String(Number(button.dataset.width) === Number(penSize.value)));
      });
    };
    const updateMode = () => {
      const allowed = touchAllowed();
      mode.disabled = !allowed;
      mode.value = allowed ? inputMode : "pencil";
      note.textContent = allowed
        ? (inputMode === "pencil"
          ? "In PencilKit, one finger scrolls the whole page while Apple Pencil draws. Pinch with two fingers to zoom. Hand also moves the page."
          : "In PencilKit, one finger or a regular stylus draws; two fingers scroll or pinch to zoom. Choose Apple Pencil only for one-finger scrolling. A regular stylus has no Pencil pressure or tilt.")
        : "Finger drawing is disabled by this device's configuration. In PencilKit, one finger scrolls the page; two fingers pinch to zoom.";
    };
    slider.addEventListener("input", () => setWidth(slider.value), { signal: tools.signal });
    penSize.addEventListener("input", updateWidth, { signal: tools.signal });
    window.addEventListener("tenet:ink-status", updateWidth, { signal: tools.signal });
    mode.addEventListener("change", () => {
      if (!touchAllowed()) { updateMode(); return; }
      inputMode = mode.value === "pencil" ? "pencil" : "touch";
      updateMode();
      try { localStorage.setItem(preferenceKey, inputMode); }
      catch { note.textContent = "Input mode changed for this session. Device storage is unavailable."; }
      mode.dispatchEvent(new Event("input", { bubbles: true }));
    }, { signal: tools.signal });
    tools.beforeOpen = () => { updateWidth(); updateMode(); };
    updateWidth();
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
      return;
    }
    callback();
  }

  function isTenetWhiteboard() {
    return document.body?.classList.contains("tenet-whiteboard")
      || window.PENECHO_CONFIG?.tenetMode === true
      || window.PenEchoRuntimeConfig?.tenetMode === true
      || window.TenetBranding?.tenetMode === true;
  }

  function nativePlugin() {
    return window.Capacitor?.Plugins?.TenetNative || null;
  }

  function isNativeIos() {
    try {
      return window.Capacitor?.getPlatform?.() === "ios";
    } catch {
      return false;
    }
  }

  function showTenetMessage(message, kind = "info") {
    if (typeof tenetInkMessage === "function") {
      tenetInkMessage(message);
      return;
    }
    if (kind === "error") window.alert(message);
  }

  function installStylesheet() {
    if (document.getElementById(STYLE_ID)) return;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = "/tenet-ipad-usability.css";
    document.head.appendChild(link);
  }

  function dispatchTenetAction(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  function configureBrand() {
    const brand = document.querySelector(".brand");
    if (!brand || brand.querySelector(".tenet-brand-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tenet-brand-button";
    button.setAttribute("aria-label", "Open Tenet pages and files");
    button.title = "Tenet Whiteboard pages and files";

    const icon = document.createElement("img");
    icon.src = "/tenet-whiteboard-icon-180.png";
    icon.alt = "";
    icon.width = 36;
    icon.height = 36;

    const label = document.createElement("span");
    label.textContent = "Tenet";

    button.append(icon, label);
    button.addEventListener("click", () => document.querySelector("#tenetNotebookLauncher")?.click());
    brand.replaceChildren(button);
  }

  function labelHeaderButton(selector, label, title = label) {
    const button = document.querySelector(selector);
    if (!button) return null;
    button.classList.add("tenet-header-action");
    button.textContent = label;
    button.setAttribute("aria-label", title);
    button.title = title;
    return button;
  }

  function hideStudentIrrelevantControls() {
    ["#shareCanvasBtn", "#cloudAccountBtn", "#settingsBtn"].forEach((selector) => {
      const control = document.querySelector(selector);
      if (!control) return;
      control.hidden = true;
      control.setAttribute("aria-hidden", "true");
      control.tabIndex = -1;
    });

    const coordinates = document.querySelector("#coords");
    if (coordinates) {
      coordinates.hidden = true;
      coordinates.setAttribute("aria-hidden", "true");
    }
  }

  function configureHeaderActions() {
    const newButton = labelHeaderButton("#newCanvasBtn", "New", "Create a new page");
    labelHeaderButton("#historyBtn", "Pages", "Open pages and files");
    const exportButton = labelHeaderButton(
      "#exportPngBtn",
      isNativeIos() ? "Export PDF" : "Export",
      isNativeIos() ? "Export this page as a PDF" : "Export this page",
    );

    let openButton = document.querySelector("#tenetOpenDocumentBtn");
    if (!openButton) {
      openButton = document.createElement("button");
      openButton.type = "button";
      openButton.id = "tenetOpenDocumentBtn";
      openButton.className = `${newButton?.className || exportButton?.className || ""} tenet-header-action`;
      openButton.textContent = "Open";
      openButton.setAttribute("aria-label", "Open a PDF or image");
      openButton.title = "Open a PDF or image";
      openButton.addEventListener("click", () => dispatchTenetAction("tenet:open-document"));

      if (newButton) newButton.insertAdjacentElement("afterend", openButton);
      else if (exportButton?.parentElement) exportButton.parentElement.insertBefore(openButton, exportButton);
    }

    if (exportButton && nativePlugin()?.exportPdf) {
      exportButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        void exportCurrentPageAsPdf(exportButton);
      }, true);
    }
  }

  function installCompactIpadChrome() {
    if (!isNativeIos() || document.getElementById("tenetPageMenuButton")) return;
    const host = document.getElementById("canvasFileActions");
    const toolbar = document.querySelector("[data-tenet-ink-toolbar]");
    if (!host || !toolbar) return;
    const lifetime = new AbortController(), signal = lifetime.signal;
    const reason = "tenet-page-menu";
    const icon = paths => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      for (const d of paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d); svg.append(path);
      }
      return svg;
    };
    document.body.classList.add("tenet-compact-chrome");
    toolbar.id ||= "tenetDrawingControls";
    const toolsButton = document.createElement("button");
    toolsButton.id = "tenetDrawingToolsToggle";
    toolsButton.type = "button";
    toolsButton.className = "tenet-chrome-toggle";
    toolsButton.setAttribute("aria-controls", toolbar.id);
    toolsButton.append(icon(["M4 7h16M4 17h16", "M8 4v6M16 14v6"]), document.createTextNode("Tools"));
    const expandTools = expanded => {
      if (!expanded && toolbar.contains(document.activeElement)) toolsButton.focus({ preventScroll: true });
      toolbar.hidden = !expanded;
      document.body.dataset.tenetToolsExpanded = String(expanded);
      toolsButton.setAttribute("aria-expanded", String(expanded));
      toolsButton.setAttribute("aria-label", expanded ? "Hide drawing tools" : "Show drawing tools");
      toolsButton.title = expanded ? "Hide drawing tools" : "Show drawing tools";
      tenetInkController?.sync?.();
    };
    toolsButton.addEventListener("click", () => expandTools(toolbar.hidden), { signal });

    const trigger = document.createElement("button");
    trigger.id = "tenetPageMenuButton";
    trigger.type = "button";
    trigger.className = "tenet-chrome-toggle tenet-page-menu-toggle";
    trigger.title = "Notebook menu";
    trigger.setAttribute("aria-label", "Notebook menu: new, open, export PDF, and pages");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", "tenetPageMenu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.append(icon(["M5 6h14M5 12h14M5 18h14"]));
    const menu = document.createElement("dialog");
    menu.id = "tenetPageMenu";
    menu.className = "tenet-page-menu";
    menu.setAttribute("aria-labelledby", "tenetPageMenuTitle");
    const heading = document.createElement("header");
    const title = document.createElement("h2");
    title.id = "tenetPageMenuTitle"; title.textContent = "Your notebook";
    const closeButton = document.createElement("button");
    closeButton.type = "button"; closeButton.className = "tenet-page-menu-close";
    closeButton.setAttribute("aria-label", "Close notebook menu");
    closeButton.append(icon(["M6 6l12 12M18 6 6 18"]));
    heading.append(title, closeButton);
    const actions = document.createElement("div");
    actions.className = "tenet-page-menu-actions";
    const specifications = [
      ["newCanvasBtn", "New page", ["M6 3h8l4 4v14H6Z", "M14 3v4h4M9 14h6M12 11v6"]],
      ["tenetOpenDocumentBtn", "Open document", ["M3 7h7l2 2h9l-3 11H3Z", "M3 7V4h7l2 3h8v2"]],
      ["exportPngBtn", "Export PDF", ["M12 3v12M7 10l5 5 5-5", "M5 15v5h14v-5"]],
      ["historyBtn", "Pages & files", ["M5 3h14v18H5Z", "M9 3v18M12 8h4M12 12h4"]],
    ];
    for (const [id, label, paths] of specifications) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.classList.add("tenet-page-menu-action");
      button.replaceChildren(icon(paths), document.createTextNode(label));
      // Move the actual controls, not copies: their native import/export and
      // notebook handlers, disabled state, and element identities stay intact.
      actions.append(button);
    }
    const scopeSection = document.createElement("section");
    scopeSection.className = "tenet-menu-tutor-scope";
    scopeSection.hidden = true;
    const scopeTitle = document.createElement("h3"); scopeTitle.textContent = "Tutor view";
    const scopeControl = document.createElement("div"); scopeControl.className = "tenet-menu-scope-control";
    const scopeHelp = document.createElement("p");
    scopeHelp.id = "tenetTutorViewHelp";
    scopeHelp.textContent = "Choose recent writing for your latest step, or the visible page for more context. Circled questions keep their selected area.";
    scopeSection.append(scopeTitle, scopeControl, scopeHelp);
    menu.append(heading, actions, scopeSection);
    host.append(toolsButton, trigger);
    document.body.append(menu);

    let opening = false, suspended = false, epoch = 0;
    const releaseInk = () => {
      if (!suspended) return;
      suspended = false;
      void window.TenetInk?.resume(reason);
    };
    const positionMenu = () => {
      const bounds = trigger.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const visual = window.visualViewport;
      const rightEdge = (visual?.offsetLeft || 0) + (visual?.width || width);
      const bottom = (visual?.offsetTop || 0) + (visual?.height || window.innerHeight);
      const top = Math.max(12 + (visual?.offsetTop || 0), Math.min(bounds.bottom + 10, bottom - 120));
      const style = runtimeElementStyle(menu, "tenet-page-menu");
      if (!style) return;
      style.setProperty("--tenet-page-menu-top", top + "px");
      style.setProperty("--tenet-page-menu-right", Math.max(12, width - Math.min(bounds.right, rightEdge - 12)) + "px");
      style.setProperty("--tenet-page-menu-height", Math.max(80, bottom - top - 12) + "px");
    };
    const safelyPositionMenu = () => { try { positionMenu(); } catch { /* CSS provides a safe fallback position. */ } };
    trigger.addEventListener("click", async () => {
      if (opening || menu.open) return;
      const attempt = ++epoch;
      opening = true; suspended = true;
      trigger.setAttribute("aria-busy", "true");
      try {
        await window.TenetInk?.suspend(reason);
        if (signal.aborted || attempt !== epoch || document.hidden) return;
        safelyPositionMenu();
        menu.showModal();
        trigger.setAttribute("aria-expanded", "true");
      } catch (error) {
        showTenetMessage(error?.message || "Lift your Pencil and try the notebook menu again.", "error");
      } finally {
        opening = false;
        trigger.removeAttribute("aria-busy");
        if (!menu.open) releaseInk();
      }
    }, { signal });
    closeButton.addEventListener("click", () => menu.close(), { signal });
    actions.addEventListener("click", event => {
      const button = event.target.closest?.("button.tenet-page-menu-action");
      if (button && !button.disabled && menu.open) menu.close();
    }, { capture: true, signal });
    menu.addEventListener("pointerdown", event => {
      if (event.target !== menu) return;
      const box = menu.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
        event.preventDefault(); menu.close();
      }
    }, { signal });
    menu.addEventListener("keydown", event => event.stopPropagation(), { signal });
    menu.addEventListener("close", () => {
      trigger.setAttribute("aria-expanded", "false");
      releaseInk();
      if (!signal.aborted && !document.hidden && !document.querySelector("dialog[open]")) trigger.focus({ preventScroll: true });
    }, { signal });
    window.addEventListener("resize", () => { if (menu.open) safelyPositionMenu(); }, { signal });
    window.visualViewport?.addEventListener("resize", () => { if (menu.open) safelyPositionMenu(); }, { signal });
    window.visualViewport?.addEventListener("scroll", () => { if (menu.open) safelyPositionMenu(); }, { signal });

    // The native scope control arrives asynchronously. Relocate the existing
    // selector without rewriting its value or registering another AI pathway.
    let scopeAttached = false;
    const attachTutorScope = () => {
      if (scopeAttached || signal.aborted) return;
      const select = [...document.querySelectorAll("select")].find(control => {
        const labels = [...control.options].map(option => option.label || option.textContent || "");
        return labels.some(label => /recent\s+writing/i.test(label)) && labels.some(label => /visible\s+page/i.test(label));
      });
      if (!select) return;
      const label = select.closest("label");
      const element = label && label.querySelectorAll("select,input,button").length === 1 ? label : select;
      if (!label) select.setAttribute("aria-label", "Tutor view");
      const describedBy = new Set((select.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(scopeHelp.id); select.setAttribute("aria-describedby", [...describedBy].join(" "));
      scopeControl.append(element);
      scopeSection.hidden = false;
      scopeAttached = true;
      scopeObserver.disconnect();
    };
    const scopeObserver = new MutationObserver(attachTutorScope);
    scopeObserver.observe(document.body, { childList: true, subtree: true });
    attachTutorScope();
    window.addEventListener("tenet:ink-status", attachTutorScope, { signal });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      epoch++;
      if (menu.open) menu.close();
      releaseInk();
    }, { signal });
    window.addEventListener("pagehide", event => {
      epoch++;
      if (menu.open) menu.close();
      releaseInk();
      if (!event.persisted) { scopeObserver.disconnect(); lifetime.abort(); }
    }, { signal });
    expandTools(false);
  }

  function installCanvasChromeLayout() {
    const viewport = document.getElementById("viewport");
    if (!viewport) return;
    const occluders = [...document.querySelectorAll(".topbar, [data-tenet-ink-toolbar], .toolbar")];
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const bounds = viewport.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const visual = window.visualViewport;
      const visibleTop = visual?.offsetTop || 0;
      const visibleRight = (visual?.offsetLeft || 0) + (visual?.width || window.innerWidth);
      let coveredTop = Math.max(0, visibleTop - bounds.top);
      for (const element of occluders) {
        if (element.hidden) continue;
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0 && box.right > bounds.left && box.left < bounds.right) {
          coveredTop = Math.max(coveredTop, box.bottom - bounds.top);
        }
      }
      // Separate from --studio-toolbar-height: feeding measured height into
      // the toolbar's own min-height would stop it shrinking after rotation.
      const values = {
        "--tenet-canvas-controls-top": Math.ceil(Math.min(bounds.height, coveredTop)) + "px",
        "--tenet-canvas-right-occlusion": Math.ceil(Math.max(0, bounds.right - visibleRight)) + "px",
      };
      const declaration = runtimeElementStyle(viewport, "tenet-canvas-chrome");
      if (!declaration) return;
      for (const [name, value] of Object.entries(values)) {
        if (declaration.getPropertyValue(name) !== value) declaration.setProperty(name, value);
      }
      // CSS position changes do not resize the orb, but its native hit-test
      // exclusion must follow the newly positioned button as well.
      tenetInkController?.sync?.();
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    new Set([viewport, ...occluders]).forEach(element => observer.observe(element));
    window.addEventListener("resize", schedule, { signal });
    window.addEventListener("pageshow", schedule, { signal });
    window.visualViewport?.addEventListener("resize", schedule, { signal });
    window.visualViewport?.addEventListener("scroll", schedule, { passive: true, signal });
    document.addEventListener("scroll", schedule, { capture: true, passive: true, signal });
    document.addEventListener("transitionend", event => {
      if (event.target === embodiment || event.target?.classList?.contains("canvas-frame")) schedule();
    }, { signal });
    window.addEventListener("pagehide", event => {
      if (event.persisted) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      lifetime.abort();
    }, { signal });
    schedule();
  }

  function configureTitleDismissal() {
    const titleInput = document.querySelector("#canvasDocumentNameInput");
    titleInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      document.querySelector("#canvasDocumentNameConfirm")?.click();
      titleInput.blur();
    });

    document.addEventListener("pointerdown", (event) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const editable = active.matches("input, textarea, [contenteditable='true']");
      if (!editable || active.contains(event.target)) return;
      active.blur();
    }, true);
  }

  function hideLegacyPencilAction() {
    document.querySelectorAll(".tenet-product-lockup button").forEach((button) => {
      if (!/pencil studio|apple pencil sketch/i.test(button.textContent || "")) return;
      button.hidden = true;
      button.setAttribute("aria-hidden", "true");
      button.classList.add("tenet-legacy-pencil-action");
    });
  }

  function safeFileStem() {
    const inputValue = document.querySelector("#canvasDocumentNameInput")?.value;
    const labelValue = document.querySelector("#canvasDocumentName")?.textContent;
    const stem = String(inputValue || labelValue || "Tenet Whiteboard")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    return stem || "Tenet Whiteboard";
  }

  function fileFromImageDataUrl(dataUrl, name) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl || ""));
    if (!match) throw new Error("The selected page was not returned as a supported image.");

    const payload = match[2].replace(/[\r\n]/g, "");
    const binary = window.atob(payload);
    if (binary.length > MAX_DECODED_IMPORT_BYTES) throw new Error("The selected page is too large to place safely.");

    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

    const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
    const requestedName = String(name || `Imported page.${extension}`);
    const safeName = requestedName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 120);
    return new File([bytes], safeName || `Imported page.${extension}`, { type: match[1] });
  }

  async function placeImagePages(pages) {
    if (typeof addImageFile !== "function") throw new Error("The canvas image importer is unavailable.");

    let offsetY = 0;
    let imported = 0;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index] || {};
      const file = fileFromImageDataUrl(page.dataUrl, page.name || `Page ${index + 1}.png`);
      const item = await addImageFile(file, { offsetY });
      if (!item) throw new Error(`Page ${index + 1} could not be placed on the canvas.`);
      imported += 1;
      offsetY += Math.max(160, Number(item.h) || Number(page.height) || 900) + 64;
    }
    return imported;
  }

  async function openDocument(control = null) {
    if (documentImportActive) return;
    const plugin = nativePlugin();
    if (!plugin?.pickDocument) {
      document.querySelector("#imagePickerBtn")?.click();
      return;
    }

    documentImportActive = true;
    if (control) control.disabled = true;
    try {
      const result = await plugin.pickDocument();
      if (result?.cancelled) return;
      const pages = Array.isArray(result?.pages) ? result.pages : [];
      if (!pages.length) throw new Error("The selected document did not contain an importable page.");
      const imported = await placeImagePages(pages);
      showTenetMessage(`${imported} ${imported === 1 ? "page" : "pages"} placed on the canvas.`);
    } catch (error) {
      showTenetMessage(error?.message || "The document could not be opened.", "error");
    } finally {
      documentImportActive = false;
      if (control) control.disabled = false;
    }
  }

  async function openApplePencilSketch(control = null) {
    if (pencilImportActive) return;
    const plugin = nativePlugin();
    if (!plugin?.presentPencilCanvas) {
      showTenetMessage("Apple Pencil sketch is available in the Tenet iPad app.", "error");
      return;
    }

    pencilImportActive = true;
    if (control) control.disabled = true;
    try {
      await window.TenetInk?.suspend("sketch");
      const result = await plugin.presentPencilCanvas();
      if (result?.cancelled) return;
      if (!result?.dataUrl) throw new Error("The sketch did not return any ink.");
      const imported = await placeImagePages([{
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        name: "Apple Pencil sketch.png",
      }]);
      if (imported !== 1) throw new Error("The sketch could not be placed on this page.");
      showTenetMessage("Apple Pencil sketch placed on the current page.");
    } catch (error) {
      showTenetMessage(error?.message || "The Apple Pencil sketch could not be placed.", "error");
    } finally {
      pencilImportActive = false;
      window.TenetInk?.resume("sketch");
      if (control) control.disabled = false;
    }
  }

  async function exportCurrentPageAsPdf(control = null) {
    if (pdfExportActive) return;
    const plugin = nativePlugin();
    if (!plugin?.exportPdf) return;
    if (typeof renderExportCanvas !== "function") {
      showTenetMessage("PDF export is unavailable.", "error");
      return;
    }

    pdfExportActive = true;
    if (control) control.disabled = true;
    let exportCanvas = null;
    try {
      exportCanvas = await renderExportCanvas();
      if (!exportCanvas?.width || !exportCanvas?.height) throw new Error("Add something to the page before exporting it.");
      const resize = Math.min(1, 8192 / exportCanvas.width, 8192 / exportCanvas.height, Math.sqrt(32 * 1024 * 1024 / (exportCanvas.width * exportCanvas.height)));
      if (resize < 1) {
        const bounded = document.createElement("canvas");
        bounded.width = Math.max(1, Math.floor(exportCanvas.width * resize));
        bounded.height = Math.max(1, Math.floor(exportCanvas.height * resize));
        bounded.getContext("2d").drawImage(exportCanvas, 0, 0, bounded.width, bounded.height);
        exportCanvas.width = exportCanvas.height = 0;
        exportCanvas = bounded;
      }
      const result = await plugin.exportPdf({
        dataUrl: exportCanvas.toDataURL("image/png"),
        filename: `${safeFileStem()}.pdf`,
      });
      if (!result?.cancelled) showTenetMessage("PDF ready to share or save.");
    } catch (error) {
      showTenetMessage(error?.message || "The PDF could not be exported.", "error");
    } finally {
      if (exportCanvas) {
        exportCanvas.width = 0;
        exportCanvas.height = 0;
      }
      pdfExportActive = false;
      if (control) control.disabled = false;
    }
  }

  function installNativeActions() {
    document.addEventListener("tenet:open-document", (event) => {
      void openDocument(event.target instanceof HTMLButtonElement ? event.target : null);
    });
    document.addEventListener("tenet:open-pencil-sketch", (event) => {
      void openApplePencilSketch(event.target instanceof HTMLButtonElement ? event.target : null);
    });
    document.addEventListener("tenet:export-pdf", (event) => {
      void exportCurrentPageAsPdf(event.target instanceof HTMLButtonElement ? event.target : null);
    });
  }

  onReady(() => {
    if (!isTenetWhiteboard()) return;
    installStylesheet();
    if (isNativeIos()) document.documentElement.classList.add("tenet-native-ios");
    configureBrand();
    hideStudentIrrelevantControls();
    configureHeaderActions();
    installDrawingTools();
    installShapeTools();
    installCompactIpadChrome();
    installCanvasChromeLayout();
    configureTitleDismissal();
    hideLegacyPencilAction();
    installNativeActions();
  });
})();
