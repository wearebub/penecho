"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PENECHO_SUMMON = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TAU = Math.PI * 2,
    THINKING_LAYOUT = Object.freeze({
      viewportMargin:18,
      minPadding:34,
      maxPadding:76,
      innerGap:22,
      statusGap:16,
      statusHeight:28,
      statusWidth:360,
      fallbackWidth:460,
      fallbackHeight:220,
      samples:96,
      highlightFraction:0.14,
      cycleSeconds:12,
      fadeSeconds:0.32,
    });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function normalizeRegion(region) {
    if (!region || ![region.x, region.y, region.w, region.h].every(Number.isFinite)
      || region.w <= 0 || region.h <= 0) return null;
    return { x:region.x, y:region.y, w:region.w, h:region.h };
  }

  function projectRegion(region, transform = {}) {
    const normalized = normalizeRegion(region),
      scale = Math.max(0.03, Number(transform.scale) || 1);
    if (!normalized) return null;
    return {
      x:normalized.x * scale + (Number(transform.panX) || 0),
      y:normalized.y * scale + (Number(transform.panY) || 0),
      w:normalized.w * scale,
      h:normalized.h * scale,
    };
  }

  function fallbackRegion(width, height) {
    const w = Math.min(THINKING_LAYOUT.fallbackWidth, Math.max(180, width * 0.52)),
      h = Math.min(THINKING_LAYOUT.fallbackHeight, Math.max(110, height * 0.28));
    return {
      x:(width - w) / 2,
      y:Math.max(THINKING_LAYOUT.viewportMargin, (height - h) * 0.42),
      w,
      h,
    };
  }

  function echoLayout(region, viewport = {}) {
    const width = Math.max(1, Number(viewport.width) || 1),
      height = Math.max(1, Number(viewport.height) || 1),
      margin = Math.min(THINKING_LAYOUT.viewportMargin, width / 4, height / 4),
      normalized = normalizeRegion(region),
      intersects = normalized && normalized.x < width && normalized.y < height
        && normalized.x + normalized.w > 0 && normalized.y + normalized.h > 0,
      source = intersects ? normalized : fallbackRegion(width, height),
      visible = {
        x:clamp(source.x, margin, Math.max(margin, width - margin)),
        y:clamp(source.y, margin, Math.max(margin, height - margin)),
        w:0,
        h:0,
      };
    visible.w = Math.max(1, clamp(source.x + source.w, margin, Math.max(margin, width - margin)) - visible.x);
    visible.h = Math.max(1, clamp(source.y + source.h, margin, Math.max(margin, height - margin)) - visible.y);

    const padding = clamp(Math.max(visible.w, visible.h) * 0.1, THINKING_LAYOUT.minPadding, THINKING_LAYOUT.maxPadding),
      left = clamp(visible.x - padding, margin, Math.max(margin, width - margin - 1)),
      top = clamp(visible.y - padding, margin, Math.max(margin, height - margin - 1)),
      right = clamp(visible.x + visible.w + padding, left + 1, Math.max(left + 1, width - margin)),
      bottom = clamp(visible.y + visible.h + padding, top + 1, Math.max(top + 1, height - margin)),
      outer = { x:left, y:top, w:right - left, h:bottom - top },
      innerInset = Math.min(THINKING_LAYOUT.innerGap, Math.max(7, Math.min(outer.w, outer.h) * 0.08)),
      inner = {
        x:outer.x + innerInset,
        y:outer.y + innerInset,
        w:Math.max(1, outer.w - innerInset * 2),
        h:Math.max(1, outer.h - innerInset * 2),
      },
      below = outer.y + outer.h + THINKING_LAYOUT.statusGap,
      above = outer.y - THINKING_LAYOUT.statusGap - THINKING_LAYOUT.statusHeight,
      statusY = below + THINKING_LAYOUT.statusHeight <= height - margin
        ? below
        : above >= margin ? above : clamp(height - margin - THINKING_LAYOUT.statusHeight, margin, height),
      statusWidth = Math.min(THINKING_LAYOUT.statusWidth, Math.max(1, width - margin * 2));
    return {
      source,
      outer,
      inner,
      fallback:!intersects,
      status:{
        x:clamp(outer.x + outer.w / 2, margin + statusWidth / 2, Math.max(margin + statusWidth / 2, width - margin - statusWidth / 2)),
        y:statusY,
        w:statusWidth,
      },
    };
  }

  function buildEchoContour(rect, layer = "outer", samples = THINKING_LAYOUT.samples) {
    const normalized = normalizeRegion(rect);
    if (!normalized) return [];
    const count = Math.max(24, Math.round(Number(samples) || THINKING_LAYOUT.samples)),
      centerX = normalized.x + normalized.w / 2,
      centerY = normalized.y + normalized.h / 2,
      radiusX = normalized.w / 2,
      radiusY = normalized.h / 2,
      inner = layer === "inner",
      phase = inner ? 1.46 : 0.38,
      exponent = inner ? 3.75 : 4.15,
      points = [];
    for (let index = 0; index < count; index++) {
      const angle = index / count * TAU,
        cosine = Math.cos(angle),
        sine = Math.sin(angle),
        edgeDistance = Math.pow(
          Math.pow(Math.abs(cosine) / Math.max(1, radiusX), exponent)
            + Math.pow(Math.abs(sine) / Math.max(1, radiusY), exponent),
          -1 / exponent,
        ),
        ripple = 1
          + Math.sin(angle * 3 + phase) * (inner ? 0.018 : 0.027)
          + Math.sin(angle * 5 - phase * 0.7) * (inner ? 0.011 : 0.016),
        driftX = Math.sin(angle * 2 + phase) * Math.min(7, normalized.w * 0.012),
        driftY = Math.sin(angle * 3 - phase) * Math.min(6, normalized.h * 0.018);
      points.push({
        x:centerX + cosine * edgeDistance * ripple + driftX,
        y:centerY + sine * edgeDistance * ripple + driftY,
      });
    }
    return points;
  }

  function traceClosedPath(ctx, points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
    ctx.stroke();
  }

  function drawContour(ctx, points, color, alpha, lineWidth) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    traceClosedPath(ctx, points);
    ctx.restore();
  }

  function drawHighlight(ctx, points, color, progress, fade) {
    if (points.length < 2) return;
    const length = Math.max(6, Math.round(points.length * THINKING_LAYOUT.highlightFraction)),
      head = Math.floor(clamp01(progress) * points.length) % points.length;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let step = 0; step < length; step++) {
      const index = (head - length + step + points.length) % points.length,
        next = (index + 1) % points.length,
        strength = Math.sin((step + 1) / (length + 1) * Math.PI);
      ctx.globalAlpha = fade * (0.12 + strength * 0.82);
      ctx.beginPath();
      ctx.moveTo(points[index].x, points[index].y);
      ctx.lineTo(points[next].x, points[next].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function create(options) {
    const canvas = options.fxCanvas,
      ctx = canvas?.getContext("2d"),
      textLayer = options.textLayer,
      t = options.t,
      getTransform = options.getTransform,
      getAiColor = options.getAiColor || (() => "#526ff1"),
      getReducedMotion = options.getReducedMotion || (() => false),
      styleFor = options.styleFor || (() => null);
    let model = null,
      rafId = 0,
      startTime = 0,
      hideAt = 0,
      copyEl = null,
      copyStyle = null,
      captionEl = null;

    function now() {
      return performance.now() / 1000;
    }

    function applyText() {
      if (captionEl) captionEl.textContent = t("summonUnderstanding");
    }

    function buildText() {
      if (!textLayer) return;
      textLayer.textContent = "";
      copyEl = document.createElement("div");
      copyEl.className = "summon-copy";
      copyStyle = styleFor(copyEl);
      captionEl = document.createElement("div");
      captionEl.className = "summon-caption";
      copyEl.append(captionEl);
      textLayer.appendChild(copyEl);
      applyText();
    }

    function placeText(layout, fade, color) {
      if (!copyStyle) return;
      copyStyle.setProperty("left", `${layout.status.x}px`);
      copyStyle.setProperty("top", `${layout.status.y}px`);
      copyStyle.setProperty("width", `${layout.status.w}px`);
      copyStyle.setProperty("opacity", String(fade));
      copyStyle.setProperty("--summon-accent", color);
    }

    function stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      model = null;
      hideAt = 0;
      copyEl = null;
      copyStyle = null;
      captionEl = null;
      if (textLayer) textLayer.textContent = "";
      if (ctx && canvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        delete canvas.dataset.effect;
        canvas.hidden = true;
      }
    }

    function frame() {
      if (!model) return;
      rafId = requestAnimationFrame(frame);
      const transform = getTransform(),
        dpr = Math.max(1, Number(transform.dpr) || 1),
        elapsed = now() - startTime,
        layout = echoLayout(projectRegion(model.region, transform), transform),
        color = getAiColor() || "#526ff1";
      let fade = 1;
      if (hideAt) {
        fade = clamp01(1 - (now() - hideAt) / THINKING_LAYOUT.fadeSeconds);
        if (fade <= 0) {
          stop();
          return;
        }
      }
      if (canvas.width !== Math.round(transform.width * dpr) || canvas.height !== Math.round(transform.height * dpr)) {
        canvas.width = Math.round(transform.width * dpr);
        canvas.height = Math.round(transform.height * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const outer = buildEchoContour(layout.outer, "outer"),
        inner = buildEchoContour(layout.inner, "inner"),
        progress = getReducedMotion() ? 0.13 : (elapsed / THINKING_LAYOUT.cycleSeconds) % 1;
      drawContour(ctx, outer, color, fade * 0.2, 1.15);
      drawContour(ctx, inner, color, fade * 0.1, 0.9);
      drawHighlight(ctx, outer, color, progress, fade);
      placeText(layout, fade, color);
    }

    function show(region) {
      if (!ctx || !canvas || !textLayer) return false;
      stop();
      model = { region:normalizeRegion(region) };
      buildText();
      canvas.dataset.effect = "spatial-echo";
      canvas.hidden = false;
      startTime = now();
      hideAt = 0;
      rafId = requestAnimationFrame(frame);
      return true;
    }

    function hide() {
      if (model && !hideAt) hideAt = now();
      else if (!model) stop();
    }

    return {
      show,
      hide,
      refreshText:applyText,
      get type() {
        return model ? "spatial-echo" : "";
      },
      get active() {
        return Boolean(model);
      },
    };
  }

  return {
    THINKING_LAYOUT,
    normalizeRegion,
    projectRegion,
    echoLayout,
    buildEchoContour,
    create,
  };
});
