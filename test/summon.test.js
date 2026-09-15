"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const SUMMON = require("../public/summon.js");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("short closed-contour highlights wrap safely at every animation head and boundary", () => {
  const match = read("public/summon.js").match(/  function drawHighlight\([\s\S]*?\n  \}/);
  assert.ok(match, "exercise the production highlight implementation without exposing a new API");
  const drawHighlight = vm.runInNewContext(`(${match[0]})`, {
    THINKING_LAYOUT:SUMMON.THINKING_LAYOUT,
    clamp01:(value) => Math.max(0, Math.min(1, value)),
  });
  // Two-point scopes remain invalid publicly; the drawing primitive accepts two points.
  for (let count = 2; count <= 5; count++) {
    const points = Array.from({ length:count }, (_, index) => ({ x:index * 11, y:index * 17 })),
      length = Math.max(6, Math.round(count * SUMMON.THINKING_LAYOUT.highlightFraction)),
      progressValues = new Set([-1, 0, 0.13, 1, 2]);
    for (let sample = 0; sample <= 100; sample++) progressValues.add(sample / 100);
    for (let head = 0; head < count; head++) {
      progressValues.add(head / count);
      progressValues.add((head + 0.5) / count);
      progressValues.add((head + 1) / count - 1e-9);
    }
    for (const progress of progressValues) {
      const segments = [];
      let current = [], saves = 0, restores = 0;
      const ctx = {
        save() { saves++; },
        restore() { restores++; },
        beginPath() { current = []; },
        moveTo(x, y) { current.push({ x, y }); },
        lineTo(x, y) { current.push({ x, y }); },
        stroke() { segments.push({ points:current, alpha:this.globalAlpha }); },
      };
      const label = `${count} points, progress ${progress}`;
      assert.doesNotThrow(() => drawHighlight(ctx, points, "#526ff1", progress, 0.75), label);
      assert.equal(saves, 1, label);
      assert.equal(restores, 1, label);
      assert.equal(segments.length, length, label);
      assert.equal(ctx.strokeStyle, "#526ff1", label);
      assert.equal(ctx.lineWidth, 2.5, label);
      const head = Math.floor(Math.max(0, Math.min(1, progress)) * count) % count;
      for (let step = 0; step < length; step++) {
        // Start at head, walk backward with positive indices, then advance each segment.
        let index = head;
        for (let back = 0; back < length; back++) index = (index + count - 1) % count;
        index = (index + step) % count;
        assert.deepEqual(segments[step].points, [points[index], points[(index + 1) % count]], label);
        assert.equal(segments[step].alpha,
          0.75 * (0.12 + Math.sin((step + 1) / (length + 1) * Math.PI) * 0.82), label);
      }
    }
  }
});

test("short closed scopes preserve their vertices without accepting two-point polygons", () => {
  for (let count = 2; count <= 5; count++) {
    const points = Array.from({ length:count }, (_, index) => ({
      x:100 + 40 * Math.cos(index / count * Math.PI * 2),
      y:100 + 40 * Math.sin(index / count * Math.PI * 2),
    }));
    const scope = { path:points, closed:true };
    if (count === 2) {
      assert.equal(SUMMON.normalizeScope(scope), null);
      assert.equal(SUMMON.projectScope(scope, { scale:1 }), null);
    } else {
      assert.deepEqual(SUMMON.normalizeScope(scope).path, points);
      assert.deepEqual(SUMMON.projectScope(scope, { scale:1, panX:0, panY:0 }).path, points);
    }
  }
});

test("spatial echo projects the active canvas region into viewport coordinates", () => {
  assert.deepEqual(
    SUMMON.projectRegion({ x:120, y:80, w:300, h:140 }, { scale:1.5, panX:-40, panY:25 }),
    { x:140, y:145, w:450, h:210 },
  );
  assert.equal(SUMMON.projectRegion(null, { scale:1 }), null);
  assert.equal(SUMMON.normalizeRegion({ x:0, y:0, w:0, h:10 }), null);
});

test("spatial echo surrounds the current region and places one status line below it", () => {
  const region = { x:260, y:180, w:430, h:190 },
    layout = SUMMON.echoLayout(region, { width:1100, height:760 });
  assert.equal(layout.fallback, false);
  assert.ok(layout.outer.x < region.x);
  assert.ok(layout.outer.y < region.y);
  assert.ok(layout.outer.x + layout.outer.w > region.x + region.w);
  assert.ok(layout.outer.y + layout.outer.h > region.y + region.h);
  assert.ok(layout.inner.x > layout.outer.x && layout.inner.y > layout.outer.y);
  assert.ok(layout.inner.x + layout.inner.w < layout.outer.x + layout.outer.w);
  assert.ok(layout.status.y > layout.outer.y + layout.outer.h);
  assert.ok(layout.status.x - layout.status.w / 2 >= 0);
  assert.ok(layout.status.x + layout.status.w / 2 <= 1100);
});

test("spatial echo remains usable at viewport edges and without an input anchor", () => {
  const nearBottom = SUMMON.echoLayout({ x:120, y:510, w:500, h:180 }, { width:820, height:700 }),
    fallback = SUMMON.echoLayout(null, { width:820, height:700 });
  assert.ok(nearBottom.status.y < nearBottom.outer.y, "status moves above only when there is no room below");
  assert.ok(nearBottom.outer.x >= 0 && nearBottom.outer.y >= 0);
  assert.ok(nearBottom.outer.x + nearBottom.outer.w <= 820);
  assert.ok(nearBottom.outer.y + nearBottom.outer.h <= 700);
  assert.equal(fallback.fallback, true);
  assert.ok(fallback.outer.w >= 180 && fallback.outer.h >= 110);
});

test("the two organic contours are deterministic, smooth, and distinct", () => {
  const rect = { x:80, y:60, w:640, h:300 },
    outer = SUMMON.buildEchoContour(rect, "outer"),
    inner = SUMMON.buildEchoContour({ x:102, y:82, w:596, h:256 }, "inner");
  assert.equal(outer.length, SUMMON.THINKING_LAYOUT.samples);
  assert.equal(inner.length, SUMMON.THINKING_LAYOUT.samples);
  assert.ok(outer.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.deepEqual(SUMMON.buildEchoContour(rect, "outer"), outer);
  assert.notDeepEqual(inner, outer);
  const longestStep = Math.max(...outer.map((point, index) => {
    const next = outer[(index + 1) % outer.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  }));
  assert.ok(longestStep < 50, `contour segment ${longestStep} should remain visually smooth`);
});

test("the request lifetime drives one restrained spatial echo with reduced-motion support", () => {
  const html = read("public/index.html"),
    css = read("public/style.css"),
    source = read("public/summon.js"),
    core = read("src/client/app/core.js"),
    bootstrap = read("src/client/app/ui-bootstrap.js"),
    summon = html.indexOf('id="summonLayer"'),
    ink = html.indexOf('id="inkLayer"');
  assert.match(html, /<canvas id="summonLayer" class="summon-layer" hidden aria-hidden="true"><\/canvas>/);
  assert.ok(summon >= 0 && summon < ink, "the echo must remain behind ink and widgets");
  assert.match(source, /dataset\.effect = "spatial-echo"/);
  assert.match(source, /buildEchoContour\(layout\.outer, "outer"\)[\s\S]*?buildEchoContour\(layout\.inner, "inner"\)[\s\S]*?drawHighlight/);
  assert.match(source, /getReducedMotion\(\) \? 0\.13/);
  assert.match(source, /t\("summonUnderstanding"\)/);
  assert.doesNotMatch(source, /LOADER_TYPES|PHRASE_KEYS|TIP_KEYS|setInterval|create(?:Radial|Linear)Gradient|shadowBlur|hsla\(/);
  assert.match(css, /AI thinking: a spatial echo around the current input region/);
  assert.match(css, /\.summon-caption\s*\{[^}]*var\(--summon-accent[^}]*font-family:\s*var\(--pe-font-ui[^}]*animation:\s*summonStatusIn/);
  assert.doesNotMatch(css, /font-family:\s*ui-rounded/);
  assert.doesNotMatch(css, /\.summon-hint|summonBlueGlow|summonTipIn/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.summon-caption\s*\{[^}]*animation:\s*none/);
  assert.match(core, /getReducedMotion:\s*\(\)\s*=>\s*Boolean\(window\.matchMedia/);
  assert.match(core, /function showSummon\(\) \{[\s\S]*?summonFX\.show\(state\.summonAnchor\)/);
  assert.doesNotMatch(core, /chooseThinkingPlacement|summonScreenBlockers|summonControlBlockers/);
  assert.doesNotMatch(html, /summonEffectList|data-effect=|fx-preview/);
  assert.doesNotMatch(core, /summonEffect|setSummonEffect|previewSummon/);
  assert.doesNotMatch(bootstrap, /summon-effect-option|setSummonEffect|previewSummon/);
});

test("the top-right control keeps one active ring and no floating understanding card or font is added", () => {
  const html = read("public/index.html"),
    css = read("public/style.css"),
    source = read("public/summon.js"),
    core = read("src/client/app/core.js"),
    zh = read("public/locales/zh.js");
  assert.match(html, /id="aiOrb"[\s\S]*?class="ai-stop-icon"/);
  assert.match(core, /state\.busy \? t\("stopAIRequest"\) : t\("triggerAutoAI"\)/);
  assert.match(css, /@property --ai-orb-ring-angle[\s\S]*?body\[data-theme="studio"\] \.ai-embodiment\.working::before\s*\{[^}]*conic-gradient[^}]*ai-orb-ring-spin/);
  assert.doesNotMatch(css, /body\[data-theme="studio"\] \.ai-embodiment::before\s*\{/);
  assert.doesNotMatch(html, /understanding-card|summon-status-card/);
  assert.match(core, /summonUnderstanding:\s*"Understanding this part of the canvas\.\.\."/);
  assert.match(zh, /summonUnderstanding:\s*"正在理解这片内容…"/);
  assert.doesNotMatch(`${source}\n${css}`, /@font-face|\.woff2?|\.ttf|\.otf/);
});
