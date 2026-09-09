(() => {
  "use strict";

  const STYLE_ID = "tenet-ipad-usability-styles";
  const MAX_DECODED_IMPORT_BYTES = 24 * 1024 * 1024;
  let documentImportActive = false;
  let pencilImportActive = false;
  let pdfExportActive = false;

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
    configureTitleDismissal();
    hideLegacyPencilAction();
    installNativeActions();
  });
})();
