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
    for (const color of INK_COLORS) {
      const swatch = makeButton("", "tenet-selection-color");
      swatch.dataset.tenetSelectionEdit = "recolor";
      swatch.style.setProperty("--selection-color", color);
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
