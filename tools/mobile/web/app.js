"use strict";

const primaryAction = document.querySelector("#primaryAction");
const openAction = document.querySelector("#openAction");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const profileText = document.querySelector("#profileText");
const error = document.querySelector("#error");

let configuration = null;
let authenticated = false;

function nativeBridge() {
  return window.Capacitor && window.Capacitor.Plugins
    ? window.Capacitor.Plugins.TenetNative
    : null;
}

function setBusy(busy, message) {
  primaryAction.disabled = busy || !configuration || !configuration.valid;
  primaryAction.textContent = busy ? message : "Sign in with Google";
}

function setStatus(message, state) {
  statusText.textContent = message;
  statusDot.dataset.state = state;
}

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function clearError() {
  error.hidden = true;
  error.textContent = "";
}

function openWhiteboard() {
  if (!configuration || !configuration.valid || !authenticated) return;
  const target = new URL(configuration.baseUrl);
  target.searchParams.set("tenet_native", "1");
  window.location.replace(target.href);
}

async function initialize() {
  const bridge = nativeBridge();
  if (!bridge) {
    setStatus("Native iPad bridge unavailable", "blocked");
    showError("This launcher must run inside the signed Tenet Whiteboard iPad application.");
    return;
  }

  try {
    configuration = await bridge.getConfiguration();
    profileText.textContent = configuration.profileLabel || "Unavailable";
    if (!configuration.valid) {
      setStatus("Managed configuration required", "blocked");
      showError(configuration.reason || "Contact your district administrator.");
      return;
    }

    setStatus("Restoring secure session...", "working");
    const restored = await bridge.restoreSession();
    authenticated = restored.authenticated === true;
    if (authenticated) {
      setStatus("Student rules active", "ready");
      primaryAction.hidden = true;
      openAction.hidden = false;
      return;
    }

    setStatus("Sign in required", "waiting");
    primaryAction.disabled = false;
  } catch (cause) {
    setStatus("Unable to initialize", "blocked");
    showError(cause && cause.message ? cause.message : "The native application could not initialize.");
  }
}

primaryAction.addEventListener("click", async () => {
  const bridge = nativeBridge();
  if (!bridge || !configuration || !configuration.valid) return;
  clearError();
  setBusy(true, "Opening secure sign-in...");
  setStatus("Complete sign-in in the system window", "working");
  try {
    const result = await bridge.authenticate({ baseUrl: configuration.baseUrl });
    authenticated = result.authenticated === true;
    if (!authenticated) throw new Error("Sign-in did not establish a session.");
    setStatus("Student rules active", "ready");
    primaryAction.hidden = true;
    openAction.hidden = false;
    openWhiteboard();
  } catch (cause) {
    setStatus("Sign in required", "waiting");
    showError(cause && cause.message ? cause.message : "Google sign-in did not complete.");
    setBusy(false, "");
  }
});

openAction.addEventListener("click", openWhiteboard);

void initialize();
