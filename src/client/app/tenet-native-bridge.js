(function initTenetNativeBridge(global) {
  "use strict";

  const config = global.PENECHO_CONFIG;
  const capacitor = global.Capacitor;
  if (!config || config.tenetMode !== true || !capacitor || !capacitor.Plugins) return;
  if (typeof capacitor.getPlatform === "function" && capacitor.getPlatform() !== "ios") return;

  const native = capacitor.Plugins.TenetNative;
  if (!native) return;

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

  async function importPencilDrawing(result) {
    if (!result || typeof result.dataUrl !== "string" || !result.dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("PencilKit returned an invalid drawing.");
    }
    const input = document.querySelector("#imagePickerInput");
    if (!input || typeof DataTransfer !== "function") {
      throw new Error("This canvas cannot import the native drawing.");
    }
    const response = await fetch(result.dataUrl);
    const blob = await response.blob();
    const file = new File([blob], `tenet-pencil-${Date.now()}.png`, { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function openPencilStudio(button) {
    button.disabled = true;
    try {
      const managed = await native.getConfiguration();
      if (managed.pencilKitEnabled === false) {
        throw new Error("Pencil studio is disabled by managed configuration.");
      }
      const result = await native.presentPencilCanvas({
        fingerDrawing: managed.fingerDrawingEnabled === true,
      });
      if (result && result.cancelled === true) return;
      await importPencilDrawing(result);
      showMessage("PencilKit drawing added to the whiteboard.", false);
    } catch (cause) {
      showMessage(cause && cause.message ? cause.message : "Pencil studio could not open.", true);
    } finally {
      button.disabled = false;
    }
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
    document.querySelectorAll(".tenet-install-hint").forEach((element) => element.remove());
    const badge = document.querySelector("#tenetBadge");
    if (!badge || badge.querySelector("#tenetNativeActions")) return;

    const actions = document.createElement("div");
    actions.id = "tenetNativeActions";
    actions.className = "tenet-native-actions";

    const pencil = document.createElement("button");
    pencil.type = "button";
    pencil.className = "tenet-native-action tenet-native-action-primary";
    pencil.textContent = "Pencil studio";
    pencil.addEventListener("click", () => { void openPencilStudio(pencil); });

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "tenet-native-action";
    logout.textContent = "Sign out";
    logout.addEventListener("click", () => { void signOut(logout); });

    actions.append(pencil, logout);
    badge.appendChild(actions);
  }

  upsertStylesheet();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installActions, { once: true });
  } else {
    installActions();
  }
})(window);
