"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

// Swift source-boundary contracts, matching tenet-native-submission-share.test.js.
// Extracted ASCII patterns, byte signatures and arithmetic run in Node; these
// tests do not execute Foundation/UIKit or replace Xcode and iPad acceptance.
const source = readFileSync(resolve(__dirname,
  "../tools/mobile/plugins/tenet-ipad-native/ios/Plugin/TenetNativePlugin.swift"), "utf8");
const start = source.indexOf("    @objc public func exportFile(_ call: CAPPluginCall)");
assert.ok(start >= 0, "exportFile must exist");
const end = source.indexOf("\n    }", start);
assert.ok(end > start, "exportFile must have a complete method body");
const body = source.slice(start, end + "\n    }".length);

function before(first, second, text = body) {
  const a = text.indexOf(first), b = text.indexOf(second);
  assert.ok(a >= 0 && b > a, `${first} must precede ${second}`);
}

function filenamePattern() {
  const literal = /filename\.range\(of: ("(?:[^"\\]|\\.)*"), options: \.regularExpression\)/.exec(body);
  assert.ok(literal, "an explicit filename allowlist is required");
  const pattern = JSON.parse(literal[1]);
  assert.equal(pattern, "\\A[A-Za-z0-9][A-Za-z0-9._ -]{0,80}\\.(tenet|pdf|png)\\z");
  // Preserve absolute end-of-input matching rather than JavaScript's permissive $.
  return new RegExp(pattern.replace(/^\\A/, "^").replace(/\\z$/, "(?![\\s\\S])"));
}

function limitFor(filename) {
  const expression = /let limit = ([^\r\n]+)/.exec(body);
  assert.ok(expression, "exportFile must select a bounded byte limit");
  return vm.runInNewContext(expression[1].replace(/\.hasSuffix\(/g, ".endsWith("),
    { filename }, { timeout: 1000 });
}

function pngSignature() {
  const guard = /if filename\.hasSuffix\("\.png"\), !data\.starts\(with: Data\(\[([^\]]+)\]\)\) \{\s*throw NSError\(domain: "TenetSubmission", code: 3,\s*userInfo: \[NSLocalizedDescriptionKey: "The PNG could not be read\."\]\)\s*\}/.exec(body);
  assert.ok(guard, "invalid PNG signatures must throw before any temporary file is created");
  const values = guard[1].split(",").map(value => Number(value.trim()));
  assert.deepEqual(values, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  before(guard[0], "createDirectory");
  before(guard[0], "data.write");
  return Buffer.from(values);
}

test("PNG sharing accepts bounded safe filenames alongside unchanged PDF and tenet names", () => {
  const pattern = filenamePattern();
  for (const extension of ["png", "pdf", "tenet"]) {
    for (const stem of ["a", "ELA - Page 1", "work-history_v1.11", "9_notes", "a".repeat(81)]) {
      assert.equal(pattern.test(`${stem}.${extension}`), true, `${stem}.${extension}`);
    }
    assert.equal(pattern.test(`${"a".repeat(82)}.${extension}`), false);
  }
  before("filename.range", "filename.hasSuffix");
  assert.match(body, /Choose a short \.tenet, \.pdf or \.png filename without path characters\./);
});

test("PNG sharing rejects traversal, controls, case variants and arbitrary file types", () => {
  const pattern = filenamePattern();
  for (const filename of [
    "", ".png", "../work.png", "..\\work.png", "/work.png", "C:\\work.png", "C:work.png",
    "folder/work.png", "folder\\work.png", "work.png/extra", "work.png\\extra",
    "work.png\n", "work.png\r\n", "work.png\r", "work.png\u2028", "work.png\u2029",
    "work\0.png", "work\t.png", "work\u00e9.png", "work\u202e.png", " work.png",
    "work.png ", "work.PNG", "work.PDF", "work.TENET", "work.jpg", "work.jpeg", "work.gif",
    "work.svg", "work.webp", "work.zip", "work.exe", "work.png.exe", "work.pdf.exe",
  ]) assert.equal(pattern.test(filename), false, JSON.stringify(filename));
});

test("PNG and PDF retain 24 MiB limits while tenet retains 64 MiB", () => {
  for (const [filename, expected] of [
    ["ELA.png", 24 * 1024 * 1024], ["ELA.pdf", 24 * 1024 * 1024], ["ELA.tenet", 64 * 1024 * 1024],
    ["ELA.tenet.png", 24 * 1024 * 1024], ["ELA.tenet.pdf", 24 * 1024 * 1024],
    ["ELA.png.tenet", 64 * 1024 * 1024],
  ]) assert.equal(limitFor(filename), expected, filename);
  assert.match(body, /guard !base64\.isEmpty, base64\.utf8\.count <= \(\(limit \+ 2\) \/ 3\) \* 4 else/);
  assert.match(body, /guard let data = Data\(base64Encoded: base64\), !data\.isEmpty, data\.count <= limit else/);
  assert.doesNotMatch(body, /ignoreUnknownCharacters/);
  before("base64.utf8.count", "Data(base64Encoded:");
  before("data.count <= limit", "createDirectory");
  before("data.count <= limit", "data.write");
});

test("encoded and decoded bounds cover exact limits and base64 padding overflow", () => {
  const encodedExpression = /base64\.utf8\.count <= \(\((limit \+ 2)\) \/ 3\) \* 4/.exec(body);
  assert.ok(encodedExpression, "base64 preflight must use the selected format limit");
  for (const filename of ["ELA.png", "ELA.pdf", "ELA.tenet"]) {
    const limit = limitFor(filename);
    // Swift integer division rounds down. Avoid allocating 64 MiB fixtures just
    // to exercise the extracted integer bound and padding edge cases.
    const encodedLimit = Math.floor(vm.runInNewContext(encodedExpression[1], { limit }, { timeout: 1000 }) / 3) * 4;
    assert.equal(encodedLimit, Math.ceil(limit / 3) * 4);
    assert.ok(Math.ceil((limit - 1) / 3) * 4 <= encodedLimit);
    assert.ok(Math.ceil(limit / 3) * 4 <= encodedLimit);
    assert.ok(Math.ceil((limit + 3) / 3) * 4 > encodedLimit);
    assert.equal(Math.ceil((limit + 1) / 3) * 4 <= encodedLimit, filename.endsWith(".tenet"),
      "the tenet padding boundary demonstrates why the decoded limit must also be enforced");
  }
});

test("a PNG fixture satisfies the full eight-byte signature before the protected write", () => {
  const signature = pngSignature();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9xkAAAAASUVORK5CYII=", "base64");
  assert.ok(signature.equals(png.subarray(0, signature.length)));
  before("Data(base64Encoded:", 'filename.hasSuffix(".png"), !data.starts');
});

test("PNG header validation rejects every truncated prefix, mutated byte and mismatched type", () => {
  const signature = pngSignature();
  const accepts = bytes => signature.equals(bytes.subarray(0, signature.length));
  for (let size = 0; size < signature.length; size++) {
    assert.equal(accepts(signature.subarray(0, size)), false, `truncated signature ${size}`);
    const mutated = Buffer.from(signature);
    mutated[size] ^= 0xff;
    assert.equal(accepts(mutated), false, `signature byte ${size}`);
  }
  for (const bytes of [Buffer.from("%PDF-1.7"), Buffer.from("GIF89a"), Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.from("<svg></svg>"), Buffer.from("not an image"), Buffer.concat([Buffer.from([0]), signature])]) {
    assert.equal(accepts(bytes), false);
  }
});

test("PDF header validation and opaque tenet submissions retain their existing contracts", () => {
  assert.match(body, /if filename\.hasSuffix\("\.pdf"\), !data\.starts\(with: Data\("%PDF-"\.utf8\)\) \{\s*throw NSError\(domain: "TenetSubmission", code: 2,/);
  before('Data("%PDF-".utf8)', "createDirectory");
  assert.equal((body.match(/!data\.starts\(with:/g) || []).length, 2,
    "only PDF and PNG have header checks; tenet bytes remain opaque");
  assert.doesNotMatch(body, /JSONSerialization|JSONDecoder|UIImage\(|CGImageSource/);
});

test("PNG uses the existing byte-only bridge, isolated protected storage and share presentation lock", () => {
  assert.deepEqual([...body.matchAll(/call\.getString\("([^"]+)"\)/g)].map(match => match[1]).sort(), ["base64", "filename"]);
  assert.doesNotMatch(body, /URLSession|Data\(contentsOf:|URL\(string:|print\(|NSLog\(|UserDefaults|KeychainStore/);
  assert.match(body, /temporaryDirectory\s*\.appendingPathComponent\("TenetSubmission-\\\(UUID\(\)\.uuidString\)", isDirectory: true\)/);
  assert.match(body, /createDirectory\(at: directory, withIntermediateDirectories: false,\s*attributes: \[\.protectionKey: FileProtectionType\.completeUntilFirstUserAuthentication\]\)/);
  assert.match(body, /directory\.appendingPathComponent\(filename, isDirectory: false\)/);
  assert.match(body, /data\.write\(to: url, options: \[\.atomic, \.completeFileProtectionUntilFirstUserAuthentication\]\)/);
  before("guard self.exportCall == nil", "self.exportCall = call");
  before("self.exportCall = call", "DispatchQueue.global");
  before("guard self.exportCall === call", "self.exportTemporaryUrl = url");
  assert.match(body, /presenter\.presentedViewController == nil/);
  assert.match(body, /presenter\.viewIfLoaded\?\.window != nil/);
  assert.match(body, /UIActivityViewController\(activityItems: \[url\], applicationActivities: nil\)/);
  assert.match(body, /popover\.sourceView = presenter\.view/);
  assert.match(body, /popover\.sourceRect = CGRect\(x: presenter\.view\.bounds\.midX, y: presenter\.view\.bounds\.midY,/);
  assert.match(body, /popover\.permittedArrowDirections = \[\]/);
});

test("PNG preparation failures and stale or completed shares keep their existing cleanup fences", () => {
  assert.match(body, /guard self\.exportCall === call else \{\s*try\? FileManager\.default\.removeItem\(at: directory\)\s*return\s*\}/);
  const completion = body.slice(body.indexOf("activity.completionWithItemsHandler"), body.indexOf("self.exportActivityController = activity"));
  before("removeItem(at: directory)", "guard let self, self.exportCall === call", completion);
  before("self.exportCall === call", "self.exportCall = nil", completion);
  assert.match(completion, /self\.exportTemporaryUrl = nil/);
  assert.match(completion, /self\.exportActivityController = nil/);
  assert.match(completion, /call\.resolve\(\["cancelled": !completed, "filename": filename\]\)/);
  assert.match(completion, /call\.reject\(error\.localizedDescription, "share_failed", error\)/);
  const failure = body.slice(body.lastIndexOf("} catch {"));
  before("removeItem(at: directory)", "DispatchQueue.main.async", failure);
  before("self.exportCall === call", "self.exportCall = nil", failure);
  before("self.exportCall === call", '"export_failed"', failure);
});
