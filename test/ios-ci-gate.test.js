"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("iOS compilation and signing require the same full Node 22/24 CI as repository pushes", () => {
  const root = path.resolve(__dirname, ".."),
    ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"),
    ios = fs.readFileSync(path.join(root, ".github/workflows/ios-release.yml"), "utf8"),
    fullCi = ios.match(/^  full_ci:\r?\n([\s\S]*?)(?=^  \w+:|$(?![\s\S]))/m)?.[1] || "",
    compile = ios.match(/^  compile:\r?\n([\s\S]*?)(?=^  \w+:|$(?![\s\S]))/m)?.[1] || "",
    release = ios.slice(ios.indexOf("\n  release:"));

  assert.match(ci, /^  workflow_call:\s*$/m);
  assert.match(ci, /node-version: \[22\.x, 24\.x\]/);
  assert.match(ci, /fail-fast: false/);
  assert.match(ci, /run: npm ci\s/);
  assert.match(ci, /run: npm run check\s/);
  assert.match(fullCi, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.doesNotMatch(fullCi, /(?:if|continue-on-error):/);
  assert.match(compile, /^    needs: full_ci\s*$/m);
  assert.doesNotMatch(compile, /always\(\)|continue-on-error:/);
  assert.match(release, /^    needs: compile\s*$/m);
  assert.doesNotMatch(release, /always\(\)|continue-on-error:/);
  assert.match(release, /UPLOAD_TESTFLIGHT: \$\{\{ inputs\.upload_testflight == true \}\}/);
});
