const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

// These are Swift source-boundary contracts, not execution of UIKit/Foundation.
// Hosted Xcode compilation and real iPad share/cancel/lifecycle checks remain required.
const source = readFileSync(resolve(__dirname,
  "../tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetNativePlugin.swift"), "utf8");

function method(name) {
  const declaration = name === "deinit" ? "deinit\\s*\\{" : `func\\s+${name}\\s*\\(`;
  const header = new RegExp(`^    (?:(?:@objc|public|private|override|static|final)\\s+)*${declaration}`, "m");
  const match = header.exec(source);
  assert.ok(match, `native method ${name} must exist`);
  const end = source.indexOf("\n    }", match.index);
  assert.ok(end > match.index, `${name} must have a complete method body`);
  return source.slice(match.index, end + "\n    }".length);
}

function before(text, first, second, message) {
  const a = text.indexOf(first), b = text.indexOf(second);
  assert.ok(a >= 0 && b > a, message || `${first} must precede ${second}`);
}

function exportCancellation() {
  const signOut = method("signOut");
  const call = /\b((?:cancel|retire|stop)\w*Export\w*)\(/.exec(signOut);
  assert.ok(call, "sign-out must retire pending native exports, not only voice/auth");
  return { name:call[1], body:method(call[1]) };
}

test("portable sharing is an explicit promise bridge accepting bytes, never a source path or URL", () => {
  assert.equal((source.match(/CAPPluginMethod\(name: "exportFile", returnType: CAPPluginReturnPromise\)/g) || []).length, 1);
  const body = method("exportFile");
  assert.match(body, /@objc public func exportFile\(_ call: CAPPluginCall\)/);
  assert.deepEqual([...body.matchAll(/call\.getString\("([^"]+)"\)/g)].map(match => match[1]).sort(), ["base64", "filename"]);
  assert.doesNotMatch(body, /URLSession|Data\(contentsOf:|URL\(string:|print\(|NSLog\(/,
    "sharing must not fetch arbitrary URLs, read supplied paths or log private payloads");
});

test("the native filename whitelist consumes the whole ASCII name, including final line terminators", () => {
  const body = method("exportFile");
  const literal = /filename\.range\(of: ("(?:[^"\\]|\\.)*"), options: \.regularExpression\)/.exec(body);
  assert.ok(literal, "the native filename validator must remain identifiable");
  const pattern = JSON.parse(literal[1]);
  assert.ok(pattern.startsWith("\\A") && pattern.endsWith("\\z"),
    "use ICU absolute anchors, not $ which can accept a final line terminator before suffix/limit checks");
  // Translate only ICU absolute anchors for exercising this extracted ASCII
  // whitelist. This does not purport to run Swift or the Foundation regex engine.
  const portablePattern = new RegExp(pattern.replace(/^\\A/, "^").replace(/\\z$/, "(?![\\s\\S])"));
  for (const filename of ["Math.tenet", "Problem 12.pdf", "work-history_v1.11.tenet", `${"a".repeat(81)}.pdf`])
    assert.equal(portablePattern.test(filename), true, filename);
  for (const filename of ["work.pdf\n", "work.pdf\r\n", "work.tenet\r", "work.pdf\u2028", "work.pdf\u2029",
    "../work.tenet", "..\\work.pdf", "/work.pdf", "C:\\work.tenet", ".tenet", "work.PDF", "work.zip", "work.pdf.exe",
    "work\0.pdf", "work\t.pdf", "work\u00e9.pdf", "work\u202e.pdf", `${"a".repeat(82)}.pdf`])
    assert.equal(portablePattern.test(filename), false, JSON.stringify(filename));
  before(body, "filename.range", "filename.hasSuffix", "filename validation must precede extension-dependent safety limits");
});

test("encoded and decoded export limits both enforce 64 MiB tenet and 24 MiB PDF before writing", () => {
  const body = method("exportFile");
  assert.match(body, /let limit = filename\.hasSuffix\("\.pdf"\) \? 24 \* 1024 \* 1024 : 64 \* 1024 \* 1024/);
  assert.match(body, /guard !base64\.isEmpty, base64\.utf8\.count <= \(\(limit \+ 2\) \/ 3\) \* 4/);
  assert.match(body, /guard let data = Data\(base64Encoded: base64\), !data\.isEmpty, data\.count <= limit else/);
  assert.doesNotMatch(body, /ignoreUnknownCharacters/);
  before(body, "base64.utf8.count", "Data(base64Encoded:");
  before(body, "data.count <= limit", "createDirectory");
  before(body, "data.count <= limit", "data.write");
});

test("PDF bytes require a PDF header and only an owned temporary file reaches the share sheet", () => {
  const body = method("exportFile");
  assert.match(body, /if filename\.hasSuffix\("\.pdf"\), !data\.starts\(with: Data\("%PDF-"\.utf8\)\)/);
  before(body, 'Data("%PDF-".utf8)', "data.write");
  assert.match(body, /UIActivityViewController\(activityItems: \[url\], applicationActivities: nil\)/);
  assert.match(body, /directory\.appendingPathComponent\(filename, isDirectory: false\)/);
  assert.doesNotMatch(body, /FileManager\.default\.(?:documentDirectory|applicationSupportDirectory)|UserDefaults|KeychainStore/);
});

test("portable export creates an isolated protected directory and atomically writes protected bytes", () => {
  const body = method("exportFile");
  assert.match(body, /FileManager\.default\.temporaryDirectory\s*\.appendingPathComponent\("TenetSubmission-\\\(UUID\(\)\.uuidString\)", isDirectory: true\)/);
  assert.match(body, /createDirectory\(at: directory, withIntermediateDirectories: false,\s*attributes: \[\.protectionKey: FileProtectionType\.completeUntilFirstUserAuthentication\]\)/);
  assert.match(body, /data\.write\(to: url, options: \[\.atomic, \.completeFileProtectionUntilFirstUserAuthentication\]\)/);
  assert.doesNotMatch(body, /\.write\([^\n]*(?:base64|filename)\)/, "the destination must be the locally constructed URL");
});

test("portable and legacy PDF exporters share the lock and fence post-worker presentation by exact call", () => {
  for (const name of ["exportFile", "exportPdf"]) {
    const body = method(name);
    before(body, "guard self.exportCall == nil", "self.exportCall = call", name);
    before(body, "self.exportCall = call", "DispatchQueue.global", name);
    assert.match(body, /presenter\.viewIfLoaded\?\.window != nil/);
    assert.match(body, /presenter\.presentedViewController == nil/);
    const worker = body.slice(body.indexOf("DispatchQueue.global"));
    before(worker, "self.exportCall === call", "self.exportTemporaryUrl =", `${name}: a canceled worker must not adopt a newer export's lock`);
    before(worker, "self.exportTemporaryUrl =", "presenter.present(activity", name);
    before(worker, "self.exportActivityController = activity", "presenter.present(activity", name);
    assert.match(body, /popover\.sourceView = presenter\.view/);
    assert.match(body, /popover\.sourceRect = CGRect\(/);
    assert.match(body, /popover\.permittedArrowDirections = \[\]/);
  }
});

test("share completion cleans its own file then refuses to settle or clear a successor operation", () => {
  for (const name of ["exportFile", "exportPdf"]) {
    const body = method(name), start = body.indexOf("activity.completionWithItemsHandler");
    assert.ok(start >= 0, name);
    const completion = body.slice(start, body.indexOf("presenter.present(activity", start));
    assert.match(completion, /removeItem\(at: directory\)|removeTemporaryExport\(/, name);
    assert.match(completion, /guard let self, self\.exportCall === call else \{ return \}/,
      `${name}: stale cancellation must not clear a newer share or settle the original call twice`);
    before(completion, "self.exportCall === call", "self.exportCall = nil", name);
    before(completion, "self.exportCall === call", "call.resolve", name);
    assert.match(completion, /"cancelled": !completed/);
    assert.match(completion, /call\.reject\(error\.localizedDescription, "share_failed", error\)/);
  }
});

test("portable export removes prepared bytes on stale presentation and preparation failure", () => {
  const body = method("exportFile"), staleStart = body.indexOf("guard self.exportCall === call");
  const stale = body.slice(staleStart, body.indexOf("self.exportTemporaryUrl = url", staleStart));
  assert.match(stale, /removeItem\(at: directory\)/);
  before(stale, "removeItem(at: directory)", "return");
  assert.match(stale, /guard self\.exportCall === call else \{\s*try\? FileManager\.default\.removeItem\(at: directory\)\s*return\s*\}/,
    "an operation already cancelled must clean its own file without clearing or settling a newer call");
  const failure = body.slice(body.lastIndexOf("} catch {"));
  before(failure, "removeItem(at: directory)", "DispatchQueue.main.async");
  assert.match(failure, /self\.exportCall === call/,
    "a stale failing worker must not clear a successor's lock");
  const pdf = method("exportPdf"), pdfFailure = pdf.slice(pdf.lastIndexOf("} catch {"));
  assert.match(pdfFailure, /guard self\.exportCall === call else \{ return \}/);
  before(pdfFailure, "self.exportCall === call", "self.exportCall = nil");
  before(pdfFailure, "self.exportCall === call", "call.reject");
});

test("sign-out and WKWebView navigation retire native sharing without canceling ordinary share-extension activation", () => {
  const cancellation = exportCancellation(), load = method("load");
  assert.match(load, /observe\(\\\.isLoading/);
  assert.match(load, /observe\(\\\.url/);
  assert.ok(load.split(`${cancellation.name}(`).length >= 3,
    "both loading and URL transitions must retire the share operation");
  const retirement = cancellation.body;
  assert.match(retirement, /exportCall = nil/);
  assert.match(retirement, /exportTemporaryUrl = nil/);
  assert.match(retirement, /removeTemporaryExport\(|removeItem\(/);
  assert.match(retirement, /completionWithItemsHandler = nil/,
    "canceling our activity must disarm its completion before settling the call");
  assert.match(retirement, /dismiss\(animated: false/);
  assert.match(retirement, /let activity = self\.exportActivityController/);
  assert.doesNotMatch(retirement, /presenter\.dismiss|presentedViewController\?\.dismiss/,
    "retirement may dismiss only the activity this plugin owns");
  before(retirement, "self.exportCall = nil", "activity?.dismiss");
  before(retirement, "completionWithItemsHandler = nil", "activity?.dismiss");
  assert.match(retirement, /\.reject\(/);
  assert.match(retirement, /"export_cancelled"/);
  assert.doesNotMatch(load, /(?:willResignActive|didEnterBackground)[\s\S]*?Export/,
    "opening an ordinary iOS share extension must not itself invalidate the export");
});

test("plugin teardown removes private temporary output rather than relying only on a share completion", () => {
  const teardown = method("deinit");
  assert.match(teardown, /exportTemporaryUrl/);
  assert.match(teardown, /removeTemporaryExport\(|removeItem\(/);
  assert.match(teardown, /let activity = exportActivityController/);
  assert.match(teardown, /completionWithItemsHandler = nil/);
  assert.match(teardown, /"export_cancelled"/);
  assert.doesNotMatch(teardown, /DispatchQueue\.main\.async\s*\{\s*\[weak self\][\s\S]*exportTemporaryUrl/,
    "an already deinitialized plugin cannot clean up through a deferred weak reference");
});
