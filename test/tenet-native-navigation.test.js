import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetInkSurface.swift", import.meta.url), "utf8");

test("native navigation uses one finger only when finger inking is disabled", () => {
  const start = source.indexOf("private func configureInputAndNavigation()");
  const end = source.indexOf("private func restoreSharedViewport()", start);
  const configure = source.slice(start, end);
  assert.match(configure, /policy\(\)\.finger && settings\?\.fingerDrawing == true/);
  assert.match(configure, /let navigationTouches = fingerDraws \? 2 : 1/);
  assert.match(configure, /panGesture\.minimumNumberOfTouches = navigationTouches/);
  assert.match(configure, /drawingGestureRecognizer\.allowedTouchTypes = drawingTouches/);
  assert.match(configure, /canvas\.panGestureRecognizer\.isEnabled = false/);
  assert.match(configure, /canvas\.pinchGestureRecognizer\?\.isEnabled = false/);
  assert.ok(source.split("configureInputAndNavigation()").length >= 4, "policy, visibility and picker updates must all reassert navigation ownership");
});

test("PencilKit internal scrolling cannot become a second viewport authority", () => {
  const start = source.indexOf("private func restoreSharedViewport()");
  const end = source.indexOf("func scrollViewDidZoom", start);
  const restoration = source.slice(start, end);
  assert.match(restoration, /guard viewportConfigured, !applyingViewport else \{ return \}/);
  assert.match(restoration, /defer \{ applyingViewport = false \}/);
  assert.match(restoration, /setZoomScale\(viewportZoom, animated: false\)/);
  assert.match(restoration, /setContentOffset\(viewportOffset, animated: false\)/);
  assert.doesNotMatch(restoration, /\.drawing\s*=/, "view restoration must never translate or replace saved strokes");
  assert.match(source, /func scrollViewDidScroll[\s\S]*?restoreSharedViewport\(\)/);
  assert.match(source, /func scrollViewDidZoom[\s\S]*?restoreSharedViewport\(\)/);
  assert.match(source, /viewportZoom = zoom\s+viewportOffset = offset\s+viewportConfigured = true/);
});
