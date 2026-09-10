// Inside the existing canvas closure. Reuse edit/history transactions rather
// than creating a second object model or changing the native ink archive.
var tenetResizeUi = null;

function tenetResizeBox(start, point, edge, minimum = 80, limit = 20000) {
  const west = edge.includes("w"), east = edge.includes("e");
  const north = edge.includes("n"), south = edge.includes("s");
  const horizontal = west || east, vertical = north || south;
  const anchorX = west ? start.x + start.w : start.x;
  const anchorY = north ? start.y + start.h : start.y;
  const maxW = west ? anchorX : limit - anchorX;
  const maxH = north ? anchorY : limit - anchorY;
  let w = horizontal ? (west ? anchorX - point.x : point.x - anchorX) : start.w;
  let h = vertical ? (north ? anchorY - point.y : point.y - anchorY) : start.h;
  if (horizontal && vertical) {
    const low = Math.max(minimum / start.w, minimum / start.h);
    const high = Math.min(maxW / start.w, maxH / start.h);
    const ratio = Math.min(high, Math.max(low, Math.max(w / start.w, h / start.h)));
    w = start.w * ratio;
    h = start.h * ratio;
  } else {
    if (horizontal) w = Math.min(maxW, Math.max(minimum, w));
    if (vertical) h = Math.min(maxH, Math.max(minimum, h));
  }
  return { ...start, x:west ? anchorX - w : start.x, y:north ? anchorY - h : start.y, w, h };
}

function tenetResizeTargets() {
  if (state.mode !== "hand" || state.viewMode || snapshotLoadInProgress) return [];
  const targets = [];
  if (state.pending) {
    const pending = state.pending;
    const index = pending.items ? Math.max(0, Math.min(pending.items.length - 1, pending.selectedIndex || 0)) : null;
    const item = index === null ? pending : pending.items[index];
    if (item && !item.erase) targets.push({ key:"draft:" + (index ?? "single"), kind:"pending", item, index,
      box:index === null ? draftBounds(pending) : pendingItemBounds(item), minimum:["plot_function", "draw_image"].includes(item.command?.tool) ? 80 : 40 });
  }
  const record = typeof handToolbarRecord === "function" ? handToolbarRecord() : null;
  const activeObject = record && !record.hiding ? handToolbarObject(record) : null;
  const image = (record?.kind === "image" ? activeObject : null) || (state.imageEdit ? selectedImage() : null);
  if (image) targets.push({ key:"image:" + image.id, kind:"image", item:image, box:imageBox(image), minimum:80 });
  const widget = state.pendingWidget || (record?.kind === "widget" ? activeObject : null) || (state.widgetEdit ? selectedWidget() : null);
  if (widget) targets.push({ key:"widget:" + widget.id, kind:"widget", item:widget, pending:widget === state.pendingWidget, box:widgetLayout(widget), minimum:300 });
  return targets;
}

function tenetBeginResize(event, descriptor, edge) {
  if (state.mode !== "hand" || state.viewMode || snapshotLoadInProgress || tenetResizeUi?.gesture) return null;
  const point = clientPoint(event);
  if (descriptor.kind === "image") beginImageGesture(event, point, { image:descriptor.item, hit:"move" });
  else if (descriptor.kind === "widget") beginWidgetGesture(event, point, { widget:descriptor.item, hit:"move", pending:descriptor.pending });
  else beginPendingGesture(event, "move", descriptor.index);
  const item = descriptor.item;
  const gesture = { id:event.pointerId, descriptor, edge, point, start:{...descriptor.box},
    scaleX:item.scaleX || 1, scaleY:item.scaleY || 1,
    contentW:item.contentW, contentH:item.contentH, generation:state.snapshotLoadGeneration };
  tenetResizeUi.gesture = gesture;
  if (state.handToolbarActiveKey) beginHandToolbarOperation(event.pointerId, state.handToolbarActiveKey);
  return gesture;
}

function tenetApplyResize(gesture, point, cancel = false) {
  const { descriptor, start, edge } = gesture;
  if (gesture.generation !== state.snapshotLoadGeneration || state.mode !== "hand") return;
  if (!tenetResizeTargets().some(target => target.item === descriptor.item)) return;
  const edgeX = edge.includes("w") ? start.x : start.x + start.w;
  const edgeY = edge.includes("n") ? start.y : start.y + start.h;
  const box = cancel ? start : tenetResizeBox(start, { x:edgeX + point.x - gesture.point.x, y:edgeY + point.y - gesture.point.y }, edge, descriptor.minimum, SIZE);
  const item = descriptor.item;
  if (descriptor.kind === "pending") {
    item.x = box.x; item.y = box.y;
    item.scaleX = gesture.scaleX * box.w / start.w;
    item.scaleY = gesture.scaleY * box.h / start.h;
  } else {
    Object.assign(item, box);
    const transaction = descriptor.kind === "image" ? state.imageGesture : state.widgetGesture;
    if (transaction) transaction.changed = ["x", "y", "w", "h"].some(key => Math.abs(item[key] - start[key]) > 0.01);
    if (descriptor.kind === "widget") {
      if (edge === "e" || edge === "w") item.contentW = (gesture.contentW ?? start.w) * box.w / start.w;
      if (edge === "n" || edge === "s") item.contentH = (gesture.contentH ?? start.h) * box.h / start.h;
      positionWidget(item);
    }
  }
  requestRender();
  requestInteractionLayerRender();
}

function tenetFinishResize(event, cancel = false) {
  const gesture = tenetResizeUi?.gesture;
  if (!gesture || gesture.id !== event.pointerId) return;
  if (cancel) tenetApplyResize(gesture, gesture.point, true);
  if (gesture.generation === state.snapshotLoadGeneration) finishObjectChromeGesture(event);
  tenetResizeUi.gesture = null;
  requestInteractionLayerRender();
}

function tenetSyncResizeHandles() {
  if (window.PENECHO_CONFIG?.tenetMode !== true || !view || !document.body) return;
  if (!tenetResizeUi) {
    const layer = document.createElement("div");
    layer.className = "tenet-resize-layer";
    view.append(layer);
    tenetResizeUi = { layer, handles:new Map(), gesture:null };
    window.addEventListener("pagehide", event => {
      if (tenetResizeUi?.gesture) tenetFinishResize({pointerId:tenetResizeUi.gesture.id}, true);
      if (!event.persisted) { layer.remove(); tenetResizeUi = null; }
    });
  }
  const ui = tenetResizeUi, active = new Set();
  const labels = { nw:"top left corner", n:"top edge", ne:"top right corner", e:"right edge", se:"bottom right corner", s:"bottom edge", sw:"bottom left corner", w:"left edge" };
  for (const descriptor of tenetResizeTargets()) {
    const screen = screenObjectBox(descriptor.box);
    for (const [edge, label] of Object.entries(labels)) {
      const key = descriptor.key + ":" + edge;
      active.add(key);
      let button = ui.handles.get(key);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "tenet-resize-handle trh-" + edge;
        button.setAttribute("aria-label", "Resize " + label);
        button.title = "Drag " + label + (edge.length === 2 ? " to resize proportionally" : " to stretch") + ". Arrow keys also resize.";
        button.addEventListener("pointerdown", event => {
          if (event.button !== 0 || !button.tenetDescriptor) return;
          event.preventDefault(); event.stopPropagation();
          if (tenetBeginResize(event, button.tenetDescriptor, edge)) {
            try { button.setPointerCapture(event.pointerId); } catch {}
          }
        });
        button.addEventListener("pointermove", event => {
          if (ui.gesture?.id !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation();
          tenetApplyResize(ui.gesture, clientPoint(event));
        });
        const finish = event => {
          if (ui.gesture?.id !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation();
          tenetFinishResize(event, event.type !== "pointerup");
        };
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(name, finish);
        button.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const rect = button.getBoundingClientRect();
          const input = {pointerId:-1, button:0, clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2};
          const gesture = tenetBeginResize(input, button.tenetDescriptor, edge);
          if (!gesture) return;
          const step = (event.shiftKey ? 10 : 1) / state.scale;
          tenetApplyResize(gesture, {x:gesture.point.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y:gesture.point.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0)});
          tenetFinishResize(input);
        });
        ui.layer.append(button);
        ui.handles.set(key, button);
      }
      button.tenetDescriptor = descriptor;
      const x = screen.left + (edge.includes("w") ? 0 : edge.includes("e") ? screen.width : screen.width / 2);
      const y = screen.top + (edge.includes("n") ? 0 : edge.includes("s") ? screen.height : screen.height / 2);
      const declaration = runtimeElementStyle(button, "tenet-resize-position-" + key);
      declaration?.setProperty("left", x + "px");
      declaration?.setProperty("top", y + "px");
    }
  }
  for (const [key, button] of ui.handles) if (!active.has(key)) { button.remove(); ui.handles.delete(key); }
  ui.layer.hidden = !active.size;
}
