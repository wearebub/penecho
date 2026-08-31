"use strict";

const CANVAS_PAGE_SCALES = Object.freeze([1, 1.1, 1.25, 1.5, 1.75]);
const CANVAS_PAGE_SCALE = 1;
const CANVAS_PAGE_SCALE_STORAGE_KEY = "penecho-canvas-page-scale";

function normalizeCanvasPageScale(value) {
  const requested = Number(value);
  return CANVAS_PAGE_SCALES.find(scale => Math.abs(scale - requested) < 0.0001) || CANVAS_PAGE_SCALE;
}

if (typeof module !== "undefined" && module.exports) module.exports = {
  CANVAS_PAGE_SCALE,
  CANVAS_PAGE_SCALES,
  CANVAS_PAGE_SCALE_STORAGE_KEY,
  normalizeCanvasPageScale,
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const root = document.documentElement;
  let currentScale = CANVAS_PAGE_SCALE;
  try { currentScale = normalizeCanvasPageScale(localStorage.getItem(CANVAS_PAGE_SCALE_STORAGE_KEY)); } catch {}

  function applyCanvasPageScale(value, { persist = true } = {}) {
    currentScale = normalizeCanvasPageScale(value);
    root.style.setProperty("--penecho-canvas-page-scale", String(currentScale));
    root.style.setProperty("--penecho-canvas-page-viewport-height", `${100 / currentScale}vh`);
    root.style.setProperty("--penecho-canvas-page-dynamic-height", `${100 / currentScale}dvh`);
    if (persist) {
      try { localStorage.setItem(CANVAS_PAGE_SCALE_STORAGE_KEY, String(currentScale)); } catch {}
    }
    if (window.PENECHO_CONFIG?.desktopApp === true) void window.penechoDesktop?.setPageScale?.(currentScale);
    return currentScale;
  }

  window.PenEchoPageScale = Object.freeze({
    choices:CANVAS_PAGE_SCALES,
    current:() => currentScale,
    apply:applyCanvasPageScale,
  });
  applyCanvasPageScale(currentScale, { persist:false });
  if (window.PENECHO_CONFIG?.desktopApp !== true) root.classList.add("penecho-web-page-scale");
}
