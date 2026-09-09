(function initTenetNotebookModule() {
  "use strict";

  if (!window.PENECHO_CONFIG || window.PENECHO_CONFIG.tenetMode !== true) return;

  const NOTEBOOK_STORAGE_KEY = "tenet-notebook-v1";
  const AUTOSAVE_IDLE_MS = 1800;
  const AUTOSAVE_POLL_MS = 900;
  const SUBJECTS = Object.freeze([
    { id: "math", label: "Math", color: "#2f6fbb" },
    { id: "science", label: "Science", color: "#2d806a" },
    { id: "english", label: "English", color: "#bd6d3a" },
    { id: "social-studies", label: "Social Studies", color: "#8a5a44" },
    { id: "other", label: "Other", color: "#667085" },
  ]);
  const SUBJECT_IDS = new Set(SUBJECTS.map((subject) => subject.id));

  let metadata = readMetadata();
  let latestPages = [];
  let previewUrls = [];
  let refreshSequence = 0;
  let notebookSaveInFlight = false;
  let editorSnapshotKey = null;
  let lastObservedRevision = Number(state.userRevision) || 0;
  let lastRevisionChangeAt = Date.now();
  let autosaveInterval = null;
  let restoreFocusTarget = null;

  let launcher;
  let pageCount;
  let overlay;
  let panel;
  let closeButton;
  let subjectTabs;
  let titleInput;
  let subjectSelect;
  let saveButton;
  let newPageButton;
  let imageButton;
  let imageMenu;
  let pencilButton;
  let cameraInput;
  let pageList;
  let emptyState;
  let statusLine;

  function readMetadata() {
    const fallback = { version: 1, activeSubject: "all", pages: {} };
    try {
      const parsed = JSON.parse(window.localStorage.getItem(NOTEBOOK_STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return fallback;

      const pages = {};
      const entries = Object.entries(parsed.pages && typeof parsed.pages === "object" ? parsed.pages : {});
      for (const [snapshotId, value] of entries.slice(0, 1000)) {
        if (!snapshotId || snapshotId.length > 160 || !value || typeof value !== "object") continue;
        const subjectId = SUBJECT_IDS.has(value.subjectId) ? value.subjectId : "other";
        pages[snapshotId] = { subjectId };
      }

      return {
        version: 1,
        activeSubject:
          parsed.activeSubject === "all" || SUBJECT_IDS.has(parsed.activeSubject)
            ? parsed.activeSubject
            : "all",
        pages,
      };
    } catch (_error) {
      return fallback;
    }
  }

  function writeMetadata() {
    try {
      window.localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(metadata));
      return true;
    } catch (_error) {
      setNotebookStatus("Subject changes could not be stored on this device.", "error");
      return false;
    }
  }

  function ensureStylesheet() {
    if (document.querySelector('link[data-tenet-notebook="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/tenet-notebook.css";
    link.dataset.tenetNotebook = "true";
    document.head.appendChild(link);
  }

  function subjectForPage(page) {
    const stored = metadata.pages[page.id];
    return stored && SUBJECT_IDS.has(stored.subjectId) ? stored.subjectId : "other";
  }

  function subjectById(subjectId) {
    return SUBJECTS.find((subject) => subject.id === subjectId) || SUBJECTS[SUBJECTS.length - 1];
  }

  function currentDeviceSnapshotId() {
    return state.currentSnapshotLocation === "device" && state.currentSnapshotId
      ? state.currentSnapshotId
      : null;
  }

  function defaultPageName() {
    const date = new Date();
    return `Page ${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`.slice(0, 48);
  }

  function setNotebookStatus(message, tone = "neutral") {
    if (!statusLine) return;
    statusLine.textContent = message;
    statusLine.dataset.tone = tone;
  }

  function revokePreviewUrls() {
    for (const url of previewUrls) URL.revokeObjectURL(url);
    previewUrls = [];
  }

  function buildShell() {
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "tenetNotebookLauncher";
    launcher.className = "tenet-notebook-launcher";
    launcher.setAttribute("aria-controls", "tenetNotebookOverlay");
    launcher.setAttribute("aria-expanded", "false");
    launcher.innerHTML = `
      <span class="tenet-notebook-launcher-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Notebook</span>
      <span id="tenetNotebookPageCount" class="tenet-notebook-count">0</span>
    `;

    overlay = document.createElement("div");
    overlay.id = "tenetNotebookOverlay";
    overlay.className = "tenet-notebook-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <button class="tenet-notebook-backdrop" type="button" aria-label="Close notebook"></button>
      <aside class="tenet-notebook-panel" role="dialog" aria-modal="true" aria-labelledby="tenetNotebookTitle">
        <header class="tenet-notebook-header">
          <div>
            <span class="tenet-notebook-eyebrow">TENET WHITEBOARD</span>
            <h2 id="tenetNotebookTitle">My notebook</h2>
          </div>
          <button id="tenetNotebookClose" class="tenet-notebook-icon-button" type="button" aria-label="Close notebook">
            <span aria-hidden="true">&times;</span>
          </button>
        </header>

        <div class="tenet-notebook-local-note">
          <span class="tenet-notebook-local-dot" aria-hidden="true"></span>
          Saved on this device only
        </div>

        <nav id="tenetNotebookSubjects" class="tenet-notebook-subjects" role="tablist" aria-label="Notebook subjects"></nav>

        <section class="tenet-notebook-compose" aria-label="Current page">
          <label class="tenet-notebook-field tenet-notebook-title-field">
            <span>Page title</span>
            <input id="tenetNotebookPageTitle" type="text" maxlength="48" autocomplete="off" placeholder="Untitled page" />
          </label>
          <label class="tenet-notebook-field tenet-notebook-subject-field">
            <span>Subject</span>
            <select id="tenetNotebookPageSubject"></select>
          </label>
          <button id="tenetNotebookSave" class="tenet-notebook-primary" type="button">Save page</button>
        </section>

        <div class="tenet-notebook-actions">
          <button id="tenetNotebookNewPage" class="tenet-notebook-action" type="button">
            <span class="tenet-notebook-action-icon" aria-hidden="true">+</span>
            New page
          </button>
          <div class="tenet-notebook-image-wrap">
            <button id="tenetNotebookImage" class="tenet-notebook-action" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="tenet-notebook-image-icon" aria-hidden="true"></span>
              Add image
            </button>
            <div id="tenetNotebookImageMenu" class="tenet-notebook-image-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-image-action="library">
                <strong>Photos &amp; Files</strong>
                <small>Choose an image already on your iPad</small>
              </button>
              <button type="button" role="menuitem" data-image-action="camera">
                <strong>Take a photo</strong>
                <small>Capture a worksheet, diagram, or notes</small>
              </button>
              <button id="tenetNotebookPencil" type="button" role="menuitem" data-image-action="pencil" hidden>
                <strong>Pencil Studio</strong>
                <small>Draw with Apple Pencil, then place it here</small>
              </button>
            </div>
          </div>
        </div>

        <div class="tenet-notebook-list-heading">
          <h3>Saved pages</h3>
          <span id="tenetNotebookStatus" aria-live="polite">Ready</span>
        </div>
        <div id="tenetNotebookPages" class="tenet-notebook-pages"></div>
        <div id="tenetNotebookEmpty" class="tenet-notebook-empty" hidden>
          <span class="tenet-notebook-empty-paper" aria-hidden="true"></span>
          <strong>No pages in this subject yet</strong>
          <p>Draw something, give it a title, and save your first page.</p>
        </div>
      </aside>
    `;

    document.body.append(launcher, overlay);

    pageCount = launcher.querySelector("#tenetNotebookPageCount");
    panel = overlay.querySelector(".tenet-notebook-panel");
    closeButton = overlay.querySelector("#tenetNotebookClose");
    subjectTabs = overlay.querySelector("#tenetNotebookSubjects");
    titleInput = overlay.querySelector("#tenetNotebookPageTitle");
    subjectSelect = overlay.querySelector("#tenetNotebookPageSubject");
    saveButton = overlay.querySelector("#tenetNotebookSave");
    newPageButton = overlay.querySelector("#tenetNotebookNewPage");
    imageButton = overlay.querySelector("#tenetNotebookImage");
    imageMenu = overlay.querySelector("#tenetNotebookImageMenu");
    pencilButton = overlay.querySelector("#tenetNotebookPencil");
    pageList = overlay.querySelector("#tenetNotebookPages");
    emptyState = overlay.querySelector("#tenetNotebookEmpty");
    statusLine = overlay.querySelector("#tenetNotebookStatus");

    for (const subject of SUBJECTS) {
      const option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.label;
      subjectSelect.appendChild(option);
    }
    subjectSelect.value = metadata.activeSubject === "all" ? "other" : metadata.activeSubject;

    cameraInput = document.createElement("input");
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.hidden = true;
    overlay.appendChild(cameraInput);
  }

  function renderSubjectTabs(pages) {
    subjectTabs.replaceChildren();
    const tabs = [{ id: "all", label: "All", color: "#14243b" }, ...SUBJECTS];

    for (const subject of tabs) {
      const count =
        subject.id === "all" ? pages.length : pages.filter((page) => subjectForPage(page) === subject.id).length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tenet-notebook-subject-tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(metadata.activeSubject === subject.id));
      button.dataset.active = String(metadata.activeSubject === subject.id);
      button.style.setProperty("--subject-color", subject.color);

      const label = document.createElement("span");
      label.textContent = subject.label;
      const countLabel = document.createElement("small");
      countLabel.textContent = String(count);
      button.append(label, countLabel);

      button.addEventListener("click", () => {
        metadata.activeSubject = subject.id;
        writeMetadata();
        if (subject.id !== "all" && !currentDeviceSnapshotId()) subjectSelect.value = subject.id;
        renderNotebook(latestPages);
      });
      subjectTabs.appendChild(button);
    }
  }

  function createPageCard(page) {
    const subjectId = subjectForPage(page);
    const subject = subjectById(subjectId);
    const current = currentDeviceSnapshotId() === page.id;
    const card = document.createElement("article");
    card.className = "tenet-notebook-page-card";
    card.dataset.current = String(current);
    card.style.setProperty("--subject-color", subject.color);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "tenet-notebook-page-open";
    openButton.setAttribute("aria-label", `Open ${snapshotName(page)}`);

    const preview = document.createElement("span");
    preview.className = "tenet-notebook-page-preview";
    if (page.preview instanceof Blob) {
      const url = URL.createObjectURL(page.preview);
      previewUrls.push(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      preview.appendChild(image);
    } else {
      const paper = document.createElement("span");
      paper.className = "tenet-notebook-preview-paper";
      paper.setAttribute("aria-hidden", "true");
      preview.appendChild(paper);
    }

    const details = document.createElement("span");
    details.className = "tenet-notebook-page-details";
    const heading = document.createElement("strong");
    heading.textContent = snapshotName(page);
    const date = document.createElement("span");
    const timestamp = Number(page.updatedAt || page.createdAt || Date.now());
    date.textContent = new Date(timestamp).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const facts = document.createElement("small");
    const imageCount = Array.isArray(page.images) ? page.images.length : 0;
    facts.textContent = current ? "Open now" : imageCount ? `${imageCount} image${imageCount === 1 ? "" : "s"}` : "Canvas page";
    details.append(heading, date, facts);
    openButton.append(preview, details);

    openButton.addEventListener("click", async () => {
      openButton.disabled = true;
      setNotebookStatus("Opening page...", "working");
      try {
        await requestLoadSnapshot(page.id, "device");
      } finally {
        openButton.disabled = false;
        closeNotebook();
      }
    });

    const move = document.createElement("label");
    move.className = "tenet-notebook-page-subject";
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    const moveSelect = document.createElement("select");
    moveSelect.setAttribute("aria-label", `Move ${snapshotName(page)} to subject`);
    for (const candidate of SUBJECTS) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.label;
      moveSelect.appendChild(option);
    }
    moveSelect.value = subjectId;
    moveSelect.addEventListener("change", () => {
      metadata.pages[page.id] = { subjectId: moveSelect.value };
      writeMetadata();
      if (currentDeviceSnapshotId() === page.id) subjectSelect.value = moveSelect.value;
      renderNotebook(latestPages);
    });
    move.append(dot, moveSelect);

    card.append(openButton, move);
    return card;
  }

  function syncEditorForCurrentPage(pages, force = false) {
    const currentId = currentDeviceSnapshotId();
    const currentPage = currentId ? pages.find((page) => page.id === currentId) : null;
    const key = currentPage ? `device:${currentPage.id}` : state.currentSnapshotId ? `remote:${state.currentSnapshotId}` : "blank";
    if (!force && key === editorSnapshotKey) return;
    editorSnapshotKey = key;

    if (document.activeElement !== titleInput) {
      titleInput.value = currentPage
        ? snapshotName(currentPage)
        : typeof state.currentSnapshotName === "string"
          ? state.currentSnapshotName
          : "";
    }

    if (currentPage) {
      subjectSelect.value = subjectForPage(currentPage);
    } else if (metadata.activeSubject !== "all") {
      subjectSelect.value = metadata.activeSubject;
    } else {
      subjectSelect.value = "other";
    }
  }

  function renderNotebook(pages) {
    revokePreviewUrls();
    pageCount.textContent = String(pages.length);
    renderSubjectTabs(pages);
    syncEditorForCurrentPage(pages);
    pageList.replaceChildren();

    const visiblePages =
      metadata.activeSubject === "all"
        ? pages
        : pages.filter((page) => subjectForPage(page) === metadata.activeSubject);

    for (const page of visiblePages) pageList.appendChild(createPageCard(page));
    emptyState.hidden = visiblePages.length !== 0;
  }

  async function refreshPages(quiet = false) {
    const sequence = ++refreshSequence;
    if (!quiet) setNotebookStatus("Loading local pages...", "working");
    try {
      const pages = await allSnapshots();
      if (sequence !== refreshSequence) return;
      latestPages = pages;

      const liveIds = new Set(pages.map((page) => page.id));
      let pruned = false;
      for (const snapshotId of Object.keys(metadata.pages)) {
        if (liveIds.has(snapshotId)) continue;
        delete metadata.pages[snapshotId];
        pruned = true;
      }
      if (pruned) writeMetadata();

      renderNotebook(pages);
      if (!quiet) setNotebookStatus(`${pages.length} page${pages.length === 1 ? "" : "s"} stored locally`, "saved");
    } catch (_error) {
      if (sequence !== refreshSequence) return;
      setNotebookStatus("Local pages could not be opened.", "error");
    }
  }

  function closeImageMenu() {
    imageMenu.hidden = true;
    imageButton.setAttribute("aria-expanded", "false");
  }

  function toggleImageMenu() {
    const nativePlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TenetNative;
    pencilButton.hidden = !nativePlugin;
    const willOpen = imageMenu.hidden;
    imageMenu.hidden = !willOpen;
    imageButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      const firstAction = imageMenu.querySelector('button:not([hidden])');
      if (firstAction) firstAction.focus();
    }
  }

  async function saveNotebookPage({ autosave = false } = {}) {
    if (notebookSaveInFlight) return null;
    const existingId = currentDeviceSnapshotId();
    if (autosave && (!existingId || !metadata.pages[existingId])) return null;
    if (autosave && Number(state.userRevision) === Number(state.snapshotSavedRevision)) return existingId;

    notebookSaveInFlight = true;
    saveButton.disabled = true;
    setNotebookStatus(autosave ? "Autosaving..." : "Saving page...", "working");

    const enteredName = titleInput.value.trim();
    const storedName = typeof state.currentSnapshotName === "string" ? state.currentSnapshotName.trim() : "";
    const name = (enteredName || storedName || defaultPageName()).slice(0, 48);
    const subjectId = SUBJECT_IDS.has(subjectSelect.value) ? subjectSelect.value : "other";

    try {
      const snapshotId = await saveSnapshot({
        overwriteId: existingId,
        name,
        location: "device",
      });
      if (!snapshotId) {
        setNotebookStatus("Add something to the canvas before saving.", "error");
        return null;
      }

      metadata.pages[snapshotId] = { subjectId };
      writeMetadata();
      editorSnapshotKey = null;
      lastObservedRevision = Number(state.userRevision) || 0;
      lastRevisionChangeAt = Date.now();
      await refreshPages(true);
      setNotebookStatus(autosave ? "Autosaved on this device" : "Saved on this device", "saved");
      return snapshotId;
    } catch (_error) {
      setNotebookStatus("This page could not be saved locally.", "error");
      return null;
    } finally {
      notebookSaveInFlight = false;
      saveButton.disabled = false;
    }
  }

  async function createNewPage() {
    newPageButton.disabled = true;
    setNotebookStatus("Starting a new page...", "working");
    try {
      await requestCanvasTransition({ type: "new" });
    } finally {
      newPageButton.disabled = false;
      closeNotebook();
    }
  }

  function openNotebook() {
    restoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : launcher;
    overlay.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    document.body.classList.add("tenet-notebook-open");
    closeImageMenu();
    void refreshPages();
    window.requestAnimationFrame(() => closeButton.focus());
  }

  function closeNotebook() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    document.body.classList.remove("tenet-notebook-open");
    closeImageMenu();
    if (restoreFocusTarget && restoreFocusTarget.isConnected) restoreFocusTarget.focus();
    restoreFocusTarget = null;
  }

  function handleDocumentPointerDown(event) {
    if (imageMenu.hidden) return;
    if (imageMenu.contains(event.target) || imageButton.contains(event.target)) return;
    closeImageMenu();
  }

  function handleDocumentKeydown(event) {
    if (event.key !== "Escape") return;
    if (!imageMenu.hidden) {
      closeImageMenu();
      imageButton.focus();
      return;
    }
    closeNotebook();
  }

  function monitorAutosave() {
    const revision = Number(state.userRevision) || 0;
    if (revision !== lastObservedRevision) {
      lastObservedRevision = revision;
      lastRevisionChangeAt = Date.now();
    }

    syncEditorForCurrentPage(latestPages);
    const currentId = currentDeviceSnapshotId();
    if (!currentId || !metadata.pages[currentId]) return;
    if (revision === Number(state.snapshotSavedRevision)) return;
    if (Date.now() - lastRevisionChangeAt < AUTOSAVE_IDLE_MS) return;
    if (notebookSaveInFlight || state.drawing || state.imageImporting) return;
    void saveNotebookPage({ autosave: true });
  }

  function bindEvents() {
    launcher.addEventListener("click", openNotebook);
    closeButton.addEventListener("click", closeNotebook);
    overlay.querySelector(".tenet-notebook-backdrop").addEventListener("click", closeNotebook);
    saveButton.addEventListener("click", () => void saveNotebookPage());
    newPageButton.addEventListener("click", () => void createNewPage());
    imageButton.addEventListener("click", toggleImageMenu);

    imageMenu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-image-action]");
      if (!action) return;
      const kind = action.dataset.imageAction;
      closeImageMenu();

      if (kind === "library") {
        const existingPicker = document.querySelector("#imagePickerBtn");
        if (existingPicker) existingPicker.click();
      } else if (kind === "camera") {
        cameraInput.click();
      } else if (kind === "pencil") {
        const nativePencilButton = document.querySelector("#tenetNativeActions .tenet-native-action-primary");
        if (nativePencilButton) nativePencilButton.click();
        else setNotebookStatus("Pencil Studio is available in the installed iPad app.", "neutral");
      }
    });

    cameraInput.addEventListener("change", async () => {
      const file = cameraInput.files && cameraInput.files[0];
      cameraInput.value = "";
      if (!file) return;
      closeNotebook();
      await addImageFile(file);
    });

    subjectSelect.addEventListener("change", () => {
      const currentId = currentDeviceSnapshotId();
      if (!currentId || !metadata.pages[currentId]) return;
      metadata.pages[currentId] = { subjectId: subjectSelect.value };
      writeMetadata();
      renderNotebook(latestPages);
    });

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeydown);
    autosaveInterval = window.setInterval(monitorAutosave, AUTOSAVE_POLL_MS);

    window.addEventListener(
      "pagehide",
      () => {
        window.clearInterval(autosaveInterval);
        document.removeEventListener("pointerdown", handleDocumentPointerDown);
        document.removeEventListener("keydown", handleDocumentKeydown);
        revokePreviewUrls();
      },
      { once: true },
    );
  }

  function installNotebook() {
    ensureStylesheet();
    buildShell();
    bindEvents();
    void refreshPages(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installNotebook, { once: true });
  } else {
    installNotebook();
  }
})();
