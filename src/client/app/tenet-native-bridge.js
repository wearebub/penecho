(function initTenetNativeBridge(global) {
  "use strict";

  const config = global.PENECHO_CONFIG;
  const capacitor = global.Capacitor;
  if (!config || config.tenetMode !== true || !capacitor || !capacitor.Plugins) return;
  if (typeof capacitor.getPlatform === "function" && capacitor.getPlatform() !== "ios") return;

  const native = capacitor.Plugins.TenetNative;
  if (!native) return;

  let currentDrawingMode = "pen";
  let previousDrawingMode = "eraser";
  let pencilActionListenerInstalled = false;

  function upsertStylesheet() {
    if (document.head.querySelector('link[data-tenet-native="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/tenet-native.css";
    link.setAttribute("data-tenet-native", "true");
    document.head.appendChild(link);
  }

  function showMessage(message, isError) {
    let toast = document.querySelector("#tenetNativeToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tenetNativeToast";
      toast.className = "tenet-native-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.kind = isError ? "error" : "success";
    toast.hidden = false;
    global.clearTimeout(toast.__tenetTimer);
    toast.__tenetTimer = global.setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function activeDrawingMode() {
    const active = document.querySelector('[data-mode][aria-pressed="true"], [data-mode].active');
    return active && typeof active.dataset.mode === "string" ? active.dataset.mode : currentDrawingMode;
  }

  function selectDrawingMode(mode) {
    const button = document.querySelector(`[data-mode="${mode}"]`);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function handlePencilToolAction(event) {
    const current = activeDrawingMode();
    if (event && event.action === "switchPrevious") {
      selectDrawingMode(previousDrawingMode === current ? (current === "pen" ? "eraser" : "pen") : previousDrawingMode);
      return;
    }
    if (!event || event.action !== "switchEraser") return;
    if (current === "eraser") selectDrawingMode(previousDrawingMode === "eraser" ? "pen" : previousDrawingMode);
    else selectDrawingMode("eraser");
  }

  function installPencilActionListener() {
    if (pencilActionListenerInstalled || typeof native.addListener !== "function") return;
    pencilActionListenerInstalled = true;
    const initialMode = activeDrawingMode();
    if (initialMode) currentDrawingMode = initialMode;
    document.addEventListener("click", (event) => {
      const modeButton = event.target && typeof event.target.closest === "function" ? event.target.closest("[data-mode]") : null;
      const nextMode = modeButton && modeButton.dataset ? modeButton.dataset.mode : null;
      if (!nextMode || nextMode === currentDrawingMode) return;
      previousDrawingMode = currentDrawingMode;
      currentDrawingMode = nextMode;
    });
    void native.addListener("pencilToolAction", handlePencilToolAction);
  }

  async function signOut(button) {
    if (!global.confirm("Sign out of Tenet Whiteboard on this iPad?")) return;
    button.disabled = true;
    try {
      await native.signOut();
      global.location.replace("capacitor://localhost/");
    } catch (cause) {
      showMessage(cause && cause.message ? cause.message : "Sign out failed.", true);
      button.disabled = false;
    }
  }

  function installActions() {
    document.documentElement.classList.add("tenet-native-ios");
    installPencilActionListener();
    document.querySelectorAll(".tenet-install-hint").forEach((element) => element.remove());
    const badge = document.querySelector("#tenetBadge");
    if (!badge || badge.querySelector("#tenetNativeActions")) return;

    const actions = document.createElement("div");
    actions.id = "tenetNativeActions";
    actions.className = "tenet-native-actions";

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "tenet-native-action";
    logout.textContent = "Sign out";
    logout.addEventListener("click", () => { void signOut(logout); });

    // Main-canvas ink has its own renderer toggle. The optional standalone
    // Apple Pencil sketch remains in Pages, with the real image importer.
    actions.append(logout);
    badge.appendChild(actions);
  }

  upsertStylesheet();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installActions, { once: true });
  } else {
    installActions();
  }
})(window);
