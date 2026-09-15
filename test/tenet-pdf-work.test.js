"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Reuse fixtures, not their registered tests. Run actual codec, PDF writer,
// teacher-view handlers and iPad export handler with controlled host boundaries.
function fixture(name, names) {
  const code = fs.readFileSync(path.join(__dirname, name), "utf8");
  const end = code.search(/\r?\ntest\(/);
  assert.ok(end > 0);
  return new Function("require", "__dirname", `${code.slice(0, end)}\nreturn {${names.join(",")}};`)(require, __dirname);
}
const { harness: codec, page, history, bytes } = fixture("tenet-submission.test.js", ["harness", "page", "history", "bytes"]);
const { harness: report } = fixture("tenet-submission-share.test.js", ["harness"]);
const { boot: viewer, settle } = fixture("tenet-process-ui.test.js", ["boot", "settle"]);
const source = fs.readFileSync(path.join(__dirname, "../src/client/app/tenet-ipad-usability.js"), "utf8");
const exportHandler = source.slice(source.indexOf("  async function exportCurrentPageAsPdf("), source.indexOf("  function installNativeActions()"));
const pause = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const plain = value => JSON.parse(JSON.stringify(value));

async function prepared() {
  const saved = page({ manifestExtensions: { tenetNativeInk: { version: 1, drawingBase64: "AAH/gA==" } } });
  const input = new Blob([' { "question": "Help me begin", "action": "hint" }\n'], { type: "application/json" });
  const crop = new Blob([new Uint8Array([0, 1, 128, 255])], { type: "image/png" });
  saved.item.workHistory = await history([["ai-input.json", input], ["ai-input.png", crop]]);
  const sender = codec(async () => saved);
  const result = await sender.api.exportSavedPage(saved.item.id);
  return { saved, input, crop, sender, result };
}
async function pdfFor(bundle) { return report().api.makePdf(bundle, () => {}, () => {}); }

test("PDF embeds the exact complete work file and reopens with unchanged history, native ink and AI inputs", async () => {
  const { result, input, crop } = await prepared();
  const pdf = await pdfFor(result.bundle), buffer = await bytes(pdf);
  const structure = buffer.toString("latin1");
  assert.match(structure, /\/Names << \/EmbeddedFiles \d+ 0 R >>/);
  assert.match(structure, /\/Type \/Filespec \/F \(work\.tenet\)/);
  assert.match(structure, /\/Type \/EmbeddedFile/);
  assert.equal(buffer.indexOf(await bytes(result.blob)) >= 0, true);
  const reopened = await codec().api.openFile(new File([pdf], "assignment.pdf", { type: "application/pdf" }));
  assert.equal(reopened.submission.container, "pdf");
  assert.deepEqual(plain(reopened.events), plain(result.bundle.events));
  assert.deepEqual(await bytes(await reopened.getWorkFile()), await bytes(result.blob));
  for (const [name, expected] of [["ai-input.json", input], ["ai-input.png", crop]]) {
    const ref = reopened.events[0].assets.find(asset => asset.name === name);
    assert.deepEqual(await bytes(await reopened.getAsset(reopened.attempt.id, ref.hash)), await bytes(expected));
  }
  const separate = await codec().api.openFile(await reopened.getWorkFile());
  assert.equal(separate.submission.container, "tenet");
  assert.deepEqual(plain(separate.events), plain(reopened.events));
});

test("PDF preparation and attachment use one saved snapshot read", async () => {
  let reads = 0;
  const sender = codec(async () => page({ name: `Saved version ${++reads}` }));
  const bundle = await sender.api.prepareSavedPage("saved-page", { includeWorkFile: true });
  assert.equal(reads, 1);
  const reopened = await codec().api.openFile(await pdfFor(bundle));
  assert.equal(reads, 1);
  assert.equal(reopened.title, bundle.title);
  assert.equal(reopened.title, "Saved version 1");
});

test("re-exporting an imported PDF embeds only the original work file, not recursively nested PDFs", async () => {
  const { result } = await prepared();
  const first = await pdfFor(result.bundle);
  const imported = await codec().api.openFile(first);
  const second = await pdfFor(imported);
  const again = await codec().api.openFile(second);
  assert.deepEqual(await bytes(await again.getWorkFile()), await bytes(result.blob));
  assert.equal(second.size, first.size);
});

test("ordinary or report-only PDFs never substitute fabricated history", async () => {
  const { api, drawn } = report();
  const pdf = await api.makePdf({ title: "Legacy example", events: [], synthetic: true }, () => {}, () => {});
  assert.match(drawn.join(" "), /REPORT ONLY/);
  await assert.rejects(codec().api.openFile(pdf), /original Tenet PDF|no supported embedded/);
});

test("PDF output never silently downgrades a missing saved-work attachment", async () => {
  await assert.rejects(pdfFor({ submission: { version: 1 }, events: [] }), /missing its portable work file/);
});

test("oversized attached work fails without truncation and remains separately shareable", async () => {
  const work = new Blob([new Uint8Array(23 * 1024 * 1024 + 1)]);
  const bundle = { getWorkFile: () => work, events: [], submission: { version: 1 } };
  await assert.rejects(pdfFor(bundle), /separate .tenet file.*no history was removed/);
  const h = report();
  assert.equal((await h.window.TenetSubmissionShare(work, "work.tenet")).downloaded, true);
  assert.equal(work.size, 23 * 1024 * 1024 + 1);
});

test("PDF input limit is enforced before parsing attachment objects", async () => {
  const pdf = new Blob(["%PDF-1.4\n", new Uint8Array(24 * 1024 * 1024)]);
  await assert.rejects(codec().api.openFile(pdf), /24 MiB/);
});

test("corrupted xref, attachment references, lengths and appended PDF revisions fail closed", async () => {
  const { result } = await prepared(), pdf = await bytes(await pdfFor(result.bundle));
  const original = pdf.toString("latin1");
  const mutations = [
    original.replace(/startxref\n\d+/, "startxref\n0"),
    original.replace(/\/EmbeddedFiles \d+ 0 R/, "/EmbeddedFiles 1 0 R"),
    original.replace("/F (work.tenet)", "/F (fake.tenet)"),
    original.replace("/TenetWorkVersion 1", "/TenetWorkVersion 2"),
    original.replace(/(\/Type \/EmbeddedFile[^\n]*\/Length )\d+/, "$11"),
    original + "1 0 obj\n<< /Type /Catalog >>\nendobj\nstartxref\n9\n%%EOF\n",
    original.replace("/Root 1 0 R", "/Root 1 0 R /Prev 9"),
  ];
  for (const value of mutations) await assert.rejects(codec().api.openFile(new Blob([Buffer.from(value, "latin1")])), /PDF|work|package/i);
});

test("damaged embedded work retains the existing SHA and gzip validation", async () => {
  const { result } = await prepared(), pdf = await bytes(await pdfFor(result.bundle));
  const index = pdf.indexOf(await bytes(result.blob));
  assert.ok(index > 0); pdf[index + 16] ^= 1;
  await assert.rejects(codec().api.openFile(new Blob([pdf])), /digest/);
});

test("attachment magic inside an ordinary PDF image is not an import fallback", async () => {
  const { result } = await prepared();
  const fake = new Blob(["%PDF-1.4\nstream\n", result.blob, "\nendstream\n%%EOF\n"]);
  await assert.rejects(codec().api.openFile(fake), /PDF/);
});

test("sign-out invalidates both original work and PDF-derived attachment getters", async () => {
  const { result, sender } = await prepared(), pdf = await pdfFor(result.bundle);
  const receiver = codec(), bundle = await receiver.api.openFile(pdf);
  receiver.signOut(); sender.signOut();
  assert.throws(() => bundle.getWorkFile(), /sign-out/);
  assert.throws(() => result.bundle.getWorkFile(), /sign-out/);
});

test("closing report ownership while its work attachment is preparing prevents PDF delivery", async () => {
  const { result } = await prepared(), gate = pause(); let current = true;
  const pending = report().api.makePdf({ ...result.bundle, getWorkFile: () => gate.promise }, () => { if (!current) throw Error("closed"); }, () => {});
  current = false; gate.resolve(result.blob);
  await assert.rejects(pending, /closed/);
});

test("report offers an independent .tenet share action without preparing the PDF", async () => {
  const { result } = await prepared(), h = report();
  h.window.TenetSubmissionReport(result.bundle);
  const button = h.nodes.find(node => node.tag === "button" && node.textContent === "Share .tenet only");
  assert.equal(button.hidden, false); await button.click();
  assert.match(h.nodes.find(node => node.tag === "a").download, /\.tenet$/);
  assert.equal(h.nodes.filter(node => node.tag === "canvas").length, 0);
});

function viewBundle(title = "PDF work") {
  return { title, attempt: { id: "saved", title, status: "saved" }, events: [], historyAvailable: false,
    submission: { version: 1 }, getAsset: async () => null, getWorkFile: () => new Blob(["work"]) };
}
test("teacher picker routes PDFs by extension and MIME to the portable codec, not legacy archives", async () => {
  for (const file of [{ name: "work.pdf" }, { name: "download", type: "application/pdf" }]) {
    const ui = viewer(); let reads = 0;
    ui.win.TenetSubmission = { openFile: async actual => { assert.equal(actual, file); reads++; return viewBundle(); } };
    assert.equal(await ui.win.TenetProcessUI.openFile(file), true);
    assert.equal(reads, 1); assert.equal(ui.calls.archive, 0);
    assert.match(ui.dialog.querySelector('[data-file="archive"]').getAttribute("accept"), /\.pdf/);
  }
});

test("invalid PDF preserves the teacher's existing selection and never tries another parser", async () => {
  const ui = viewer();
  ui.win.TenetSubmission = { openFile: async file => { if (file.name === "bad.pdf") throw Error("Invalid embedded work"); return viewBundle("Retained work"); } };
  await ui.win.TenetProcessUI.openFile({ name: "valid.tenet" });
  assert.equal(await ui.win.TenetProcessUI.openFile({ name: "bad.pdf" }), false);
  assert.equal(ui.value("title").textContent, "Retained work"); assert.equal(ui.calls.archive, 0);
});

test("teacher reports preserve the imported attachment getter and revoke it on selection change", async () => {
  const ui = viewer(), bundle = viewBundle(); let reportBundle;
  ui.win.TenetSubmission = { openFile: async () => bundle };
  ui.win.TenetSubmissionReport = value => { reportBundle = value; };
  await ui.win.TenetProcessUI.openFile({ name: "work.pdf" }); await ui.click("report");
  assert.equal(await (await reportBundle.getWorkFile()).text(), "work");
  ui.dialog.close(); await settle();
  await assert.rejects(reportBundle.getWorkFile(), /closed or changed/);
});

function ipad(options = {}) {
  const events = new Map(), calls = { saved: [], prepared: [], reports: [], suspended: [], resumed: [] };
  const state = { snapshotLoadGeneration: 2, currentSnapshotLocation: "device", currentSnapshotId: "page-a", currentSnapshotName: "Math", userRevision: 7, snapshotSavedRevision: 6 };
  const window = {
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); },
    TenetInk: { async suspend(reason) { calls.suspended.push(reason); }, async resume(reason) { calls.resumed.push(reason); } },
    TenetSubmission: { async prepareSavedPage(id, settings) { calls.prepared.push([id, settings]); return options.prepare ? options.prepare() : viewBundle(); } },
    TenetSubmissionReport(bundle, settings) { calls.reports.push({ bundle, settings }); },
  };
  const context = vm.createContext({ window, state, pdfExportActive: false, safeFileStem: () => "Math", showTenetMessage(message) { calls.message = message; },
    async saveSnapshot(settings) { calls.saved.push(settings); if (options.failSave) return null; state.snapshotSavedRevision = state.userRevision; return "page-a"; } });
  vm.runInContext(exportHandler + "\nglobalThis.runExport = exportCurrentPageAsPdf;", context);
  return { calls, state, window, run: context.runExport, fire: name => events.get(name)?.(), control: { disabled: false } };
}

test("iPad Export PDF saves locally then prepares one matching package rather than the old image-only native path", async () => {
  const h = ipad(); await h.run(h.control);
  assert.equal(h.calls.saved.length, 1); assert.equal(h.calls.saved[0].location, "device");
  assert.equal(h.calls.prepared[0][0], "page-a"); assert.equal(h.calls.prepared[0][1].includeWorkFile, true);
  assert.equal(h.calls.reports.length, 1); assert.equal(h.control.disabled, true);
  h.calls.reports[0].settings.onClose();
  assert.equal(h.control.disabled, false); assert.deepEqual(h.calls.resumed, ["pdf-export"]);
});

test("failed iPad save never falls back to a PDF lacking recorded work", async () => {
  const h = ipad({ failSave: true }); await h.run(h.control);
  assert.equal(h.calls.prepared.length, 0); assert.equal(h.calls.reports.length, 0);
  assert.equal(h.control.disabled, false); assert.match(h.calls.message, /could not be saved/);
});

test("iPad navigation, edits and sign-out during package preparation abort stale exports", async () => {
  for (const boundary of ["navigation", "edit", "sign-out"]) {
    const entered = pause(), gate = pause();
    const h = ipad({ prepare: () => { entered.resolve(); return gate.promise; } });
    const pending = h.run(h.control); await entered.promise;
    if (boundary === "navigation") h.state.snapshotLoadGeneration++;
    else if (boundary === "edit") h.state.userRevision++;
    else h.fire("tenet:sign-out");
    gate.resolve(viewBundle()); await pending;
    assert.equal(h.calls.reports.length, 0); assert.equal(h.control.disabled, false);
  }
});

test("iPad repeated export presses cannot create overlapping save/report operations", async () => {
  const gate = pause(), entered = pause();
  const h = ipad({ prepare: () => { entered.resolve(); return gate.promise; } });
  const pending = h.run(h.control); await entered.promise; await h.run(h.control);
  gate.resolve(viewBundle()); await pending;
  assert.equal(h.calls.saved.length, 1); assert.equal(h.calls.reports.length, 1);
  h.calls.reports[0].settings.onClose();
});
