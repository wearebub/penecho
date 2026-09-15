"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/tenet-submission-share.js"), "utf8");

function harness(options = {}) {
  const drawn = [], nodes = [], revoked = [], nativeCalls = [];
  const window = { PENECHO_CONFIG: { tenetMode: true }, addEventListener() {},
    Capacitor: { getPlatform: () => options.native ? "ios" : "web", Plugins: { TenetNative: options.plugin || {} } } };
  function node(tag) {
    const listeners = new Map();
    const result = { tag, children: [], attributes: {}, textContent: "", open: false,
      append(...items) { this.children.push(...items); },
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, f) { listeners.set(k, f); },
      showModal() { this.open = true; }, close() { this.open = false; listeners.get("close")?.(); },
      click() { return listeners.get("click")?.(); }, remove() { this.removed = true; } };
    if (tag === "canvas") {
      result.getContext = () => ({ fillRect() {}, drawImage() {}, fillText(value) { drawn.push(value); }, measureText(value) { return { width: Array.from(value).length * 13 }; } });
      result.toBlob = cb => cb(new Blob([new Uint8Array([255,216,255,217])], { type: "image/jpeg" }));
    }
    nodes.push(result); return result;
  }
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onload(); }, () => this.onerror());
    }
  }
  const context = vm.createContext({ window, document: { createElement: node, body: node("body") },
    Blob, File, FileReader: Reader, TextEncoder, Uint8Array, DataView,
    navigator: options.navigator || {}, Image: class {},
    URL: { createObjectURL: () => "blob:test", revokeObjectURL: value => revoked.push(value) },
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); if (ms > 1000) timer.unref(); return timer; }, clearTimeout });
  vm.runInContext(source.replace("window.TenetSubmissionShare = shareFile;", "window.__test = { interactions, makePdf, previewImage, filenameFor }; window.TenetSubmissionShare = shareFile;"), context);
  return { window, api: window.__test, nodes, drawn, revoked, nativeCalls };
}

const request = (id, question = "Why?") => ({ type: "ai.request", timestamp: "2026-09-15T10:00:00Z", details: { localRequestId: id, question, origin: "voice-question" } });
const response = (id, text = "Try a smaller step.") => ({ type: "ai.response", details: { localRequestId: id, text } });

test("report groups late recorded inputs and responses only by unique request id", () => {
  const { api } = harness();
  const result = api.interactions([request("a"), request("b"), response("a"), { type: "ai.finished", details: { localRequestId: "a", outcome: "success" } }, { type: "ai.input", details: { localRequestId: "a" } }]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].responses.length, 1);
  assert.equal(result.groups[0].inputs.length, 1);
  assert.equal(result.groups[1].responses.length, 0);
});

test("report never attributes duplicate or missing request identifiers by adjacency", () => {
  const { api } = harness();
  const result = api.interactions([request("duplicate"), request("duplicate"), request(undefined), response("duplicate"), response(undefined)]);
  assert.equal(result.unlinked, 2);
  assert.ok(result.groups.every(group => !group.responses.length));
});

test("report rejects event count beyond the existing history limit", () => {
  assert.throws(() => harness().api.interactions(Array(5001).fill({ type: "canvas.edit" })), /event count/);
});

test("browser export downloads a bounded safe-name file without uploading", async () => {
  const { window, nodes } = harness();
  const result = await window.TenetSubmissionShare(new Blob(["work"]), "../private/path.tenet");
  assert.equal(result.downloaded, true);
  const link = nodes.find(n => n.tag === "a");
  assert.match(link.download, /^[A-Za-z0-9][A-Za-z0-9._ -]*\.tenet$/);
  assert.equal(link.removed, true);
});

test("native sharing uses the bounded binary file bridge and preserves cancellation", async () => {
  const calls = [];
  const { window } = harness({ native: true, plugin: { async exportFile(payload) { calls.push(payload); return { cancelled: true }; } } });
  const result = await window.TenetSubmissionShare(new Blob(["bytes"]), "Algebra.tenet");
  assert.equal(result.cancelled, true);
  assert.deepEqual(calls.map(x => [x.filename, Buffer.from(x.base64, "base64").toString()]), [["Algebra.tenet", "bytes"]]);
});

test("older native app explains missing file capability rather than a broken download", async () => {
  const { window, nodes } = harness({ native: true, plugin: { async exportFile() { throw new Error("UNIMPLEMENTED"); } } });
  await assert.rejects(window.TenetSubmissionShare(new Blob(["bytes"]), "work.tenet"), /Update the Tenet iPad app/);
  assert.equal(nodes.some(n => n.tag === "a"), false);
});

test("native presentation failures are not silently converted to browser downloads", async () => {
  const { window } = harness({ native: true, plugin: { async exportFile() { throw new Error("export_busy"); } } });
  await assert.rejects(window.TenetSubmissionShare(new Blob(["bytes"]), "work.tenet"), /export_busy/);
});

test("sharing rejects stale context before handing bytes to native", async () => {
  let calls = 0;
  const { window } = harness({ native: true, plugin: { async exportFile() { calls++; } } });
  await assert.rejects(window.TenetSubmissionShare(new Blob(["work"]), "work.tenet", { isCurrent: () => false }), /context changed/);
  assert.equal(calls, 0);
});

test("sharing enforces different PDF and work-file size limits", async () => {
  const { window } = harness();
  await assert.rejects(window.TenetSubmissionShare(new Blob([new Uint8Array(24 * 1024 * 1024 + 1)]), "work.pdf"), /limit/);
  await assert.rejects(window.TenetSubmissionShare(new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]), "work.tenet"), /limit/);
});

test("PDF report contains recorded questions and replies with observable limits", async () => {
  const { api, drawn } = harness();
  const blob = await api.makePdf({ title: "Algebra", savedAt: "2026-09-15", historyAvailable: true, events: [request("a", "How do I begin?"), response("a", "What can you simplify first?")] }, () => {}, () => {});
  assert.equal(blob.type, "application/pdf");
  const pdf = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Type \/Pages \/Count [1-9]/);
  assert.match(pdf, /\/Filter \/DCTDecode/);
  assert.match(drawn.join(" "), /How do I begin\?/);
  assert.match(drawn.join(" "), /What can you simplify first\?/);
  assert.match(drawn.join(" ").replace(/\s+/g, " "), /not a screen recording or proof of authorship/);
  const pointer = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(pointer, pointer + 4), "xref");
  const xref = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(pdf);
  const rows = xref[2].trimEnd().split("\n");
  for (let i = 1; i < rows.length; i++) {
    const offset = Number(rows[i].slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${i} 0 obj`.length), `${i} 0 obj`);
  }
});

test("PDF legacy saves state unavailable history rather than synthetic actions", async () => {
  const { api, drawn } = harness();
  await api.makePdf({ historyAvailable: false, events: [] }, () => {}, () => {});
  assert.match(drawn.join(" "), /No recorded work history/);
  assert.match(drawn.join(" "), /AI help: 0 recorded requests/);
});

test("PDF final asset access uses the attempt identity not an asset identifier", async () => {
  const calls = [];
  const { api } = harness();
  await api.makePdf({ attempt: { id: "document-a" }, finalPage: { asset: { hash: "hash-a" } }, getAsset: async (...args) => { calls.push(args); return null; }, events: [] }, () => {}, () => {});
  assert.deepEqual(calls, [["document-a", "hash-a"]]);
});

test("PDF rejects cancelled contexts without a partial result", async () => {
  const { api } = harness();
  await assert.rejects(api.makePdf({ events: [] }, () => { throw new Error("cancelled"); }, () => {}), /cancelled/);
});

test("PDF rejects oversized text rather than silently truncating a report", async () => {
  const { api } = harness();
  await assert.rejects(api.makePdf({ title: "x".repeat(2 * 1024 * 1024 + 1), events: [] }, () => {}, () => {}), /too much text/);
});

test("PDF preview rejects oversized headers before constructing an image", async () => {
  const { api } = harness();
  const bytes = Buffer.alloc(32);
  bytes.set([137, 80, 78, 71]); bytes.writeUInt32BE(100000, 16); bytes.writeUInt32BE(100000, 20);
  await assert.rejects(api.previewImage(new Blob([bytes], { type: "image/png" }), () => {}), /dimensions/);
});

test("report modal requires preparation before sharing and supports cleanup", async () => {
  const { window, nodes } = harness();
  window.TenetSubmissionReport({ title: "Saved work", events: [] }, { isCurrent: () => true });
  const dialog = nodes.find(n => n.tag === "dialog");
  assert.equal(dialog.open, true);
  const button = nodes.find(n => n.tag === "button" && n.textContent === "Prepare PDF");
  await button.click();
  assert.equal(button.textContent, "Share / save PDF");
  assert.equal(nodes.some(n => n.tag === "a"), false);
  dialog.close(); assert.equal(dialog.removed, true);
});

test("report runtime has no provider request, iframe, or executable imported markup", () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|innerHTML|createElement\(["']iframe|\.style\s*[.=]/);
});
