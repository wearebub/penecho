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

  function installShapeTools() {
    const toolbar = document.querySelector("[data-tenet-ink-toolbar]");
    if (!toolbar || document.getElementById("tenetInsertBtn")) return;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = "tenetInsertBtn";
    trigger.className = "tenet-tool-trigger";
    trigger.textContent = "+ Insert";
    trigger.title = "Insert shapes and coordinate graphs";
    toolbar.prepend(trigger);
    const tools = createTenetToolDialog("tenetInsertDialog", "Shapes & graphs",
      "Made on this device. Insert, move and resize with Hand, then choose Pen to write on top.", trigger);
    const colorLabel = document.createElement("label");
    colorLabel.className = "tenet-tool-color";
    colorLabel.textContent = "Outline / axes color";
    const color = document.createElement("input");
    color.type = "color";
    color.value = /^#[0-9a-f]{6}$/i.test(state.inkColor) ? state.inkColor : "#10243e";
    colorLabel.append(color);
    tools.body.append(colorLabel);
    const options = [
      ["rectangle", "Rectangle"], ["square", "Square"], ["circle", "Circle"],
      ["triangle", "Triangle"], ["line", "Line"], ["arrow", "Arrow"],
      ["graph-four", "Four quadrants", "-5 to 5 on both axes"],
      ["graph-first", "First quadrant", "0 to 10 on both axes"],
    ];
    const errorMessage = document.createElement("p");
    errorMessage.className = "tenet-tool-error";
    errorMessage.setAttribute("role", "status");
    const previews = [];
    let inserting = false;
    for (const [group, title] of [["shape", "Standard shapes"], ["graph", "Coordinate graphs"]]) {
      const heading = document.createElement("h3");
      heading.textContent = title;
      const grid = document.createElement("div");
      grid.className = "tenet-insert-grid" + (group === "graph" ? " tenet-insert-graphs" : "");
      tools.body.append(heading, grid);
      for (const [kind, label, caption] of options.filter(option => option[0].startsWith("graph-") === (group === "graph"))) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tenet-insert-card";
        button.setAttribute("aria-label", "Insert " + label.toLowerCase());
        const preview = drawTenetInsertArtwork(kind, color.value, 220);
        preview.setAttribute("aria-hidden", "true");
        const name = document.createElement("strong");
        name.textContent = label;
        button.append(preview, name);
        if (caption) {
          const detail = document.createElement("small");
          detail.textContent = caption;
          button.append(detail);
        }
        grid.append(button);
        previews.push({ button, kind });
        button.addEventListener("click", async () => {
          if (inserting) return;
          inserting = true;
          tools.setBusy(true);
          errorMessage.textContent = "Adding " + label.toLowerCase() + "...";
          const pageGeneration = state.snapshotLoadGeneration;
          try {
            const artwork = drawTenetInsertArtwork(kind, color.value);
            const blob = await new Promise(resolve => artwork.toBlob(resolve, "image/png"));
            if (tools.signal.aborted) return;
            if (!blob) throw new Error("Could not create this shape. Try again.");
            if (pageGeneration !== state.snapshotLoadGeneration) throw new Error("The page changed. Reopen Insert on the page you want.");
            const file = new File([blob], "Tenet " + label + ".png", { type: "image/png" });
            const item = await addImageFile(file);
            if (tools.signal.aborted) return;
            if (!item) throw new Error("Could not add this object. Finish any active image or AI operation and try again.");
            tools.setBusy(false);
            tools.close();
            showTenetMessage(label + " added. Use its handles to resize, or choose Pen to write.");
          } catch (error) {
            errorMessage.textContent = error?.message || "Could not insert this object.";
          } finally {
            inserting = false;
            tools.setBusy(false);
          }
        }, { signal: tools.signal });
      }
    }
    tools.body.append(errorMessage);
    color.addEventListener("input", () => {
      for (const { button, kind } of previews) {
        const preview = drawTenetInsertArtwork(kind, color.value, 220);
        preview.setAttribute("aria-hidden", "true");
        button.firstElementChild.replaceWith(preview);
      }
    }, { signal: tools.signal });
    tools.beforeOpen = () => { errorMessage.textContent = ""; };
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
    (document.getElementById("penSizeValue") || penSize).after(trigger);
    const tools = createTenetToolDialog("tenetDrawingDialog", "Drawing tools",
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
    for (const [width, name] of [[2, "Fine"], [4, "Regular"], [8, "Bold"], [12, "Heavy"]]) {
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
    tools.body.append(label, slider, presets, modeLabel, mode, note);
    const touchAllowed = () => deviceAllowsFinger()
      && !(window.TenetInk?.getStatus?.().engine === "pencilkit" && window.TenetInk?.fingerDrawingAllowed?.() === false);
    const updateWidth = () => {
      slider.value = penSize.value;
      value.textContent = penSize.value + " px";
      trigger.textContent = "Pen: " + penSize.value + " px";
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
    installCanvasChromeLayout();
    configureTitleDismissal();
    hideLegacyPencilAction();
    installNativeActions();
  });
})();
