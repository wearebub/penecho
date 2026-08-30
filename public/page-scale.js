"use strict";

const CANVAS_PAGE_SCALE = 0.9;

if (typeof module !== "undefined" && module.exports) module.exports = { CANVAS_PAGE_SCALE };

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const root = document.documentElement;
  root.style.setProperty("--penecho-canvas-page-scale", String(CANVAS_PAGE_SCALE));
  root.style.setProperty("--penecho-canvas-page-viewport-height", `${100 / CANVAS_PAGE_SCALE}vh`);
  root.style.setProperty("--penecho-canvas-page-dynamic-height", `${100 / CANVAS_PAGE_SCALE}dvh`);
  if (window.PENECHO_CONFIG?.desktopApp !== true) root.classList.add("penecho-web-page-scale");
}
