"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("teacher viewer is reproducibly bundled and included in the hosted release allowlist", () => {
  const build = read("scripts/build-client.js");
  const release = read("scripts/publish-tenet-release.mjs");
  for (const file of ["public/tenet-history-viewer.html", "public/tenet-history-viewer.js", "public/tenet-process.css"]) {
    assert.ok(release.includes(`'${file}'`), `Missing immutable release asset: ${file}`);
    assert.ok(fs.statSync(path.join(ROOT, file)).size > 0);
  }
  assert.match(build, /VIEWER_TARGET/);
  assert.match(read("public/tenet-history-viewer.js"), /tenetHistoryViewerOnly:\s*true/);
  assert.match(read("public/tenet-history-viewer.html"), /src="\.\/tenet-history-viewer\.js"/);
  assert.match(read("public/tenet-history-viewer.html"), /href="\.\/tenet-process\.css"/);
  assert.doesNotMatch(read("public/tenet-history-viewer.html"), /<style[\s>]/i);
});

test("public teacher preview publishes only the read-only viewer after full CI", () => {
  const workflow = read(".github/workflows/teacher-preview.yml");
  assert.match(workflow, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(workflow, /needs: full_ci/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /cp public\/tenet-history-viewer\.html release\/teacher-preview\/index\.html/);
  assert.match(workflow, /cp public\/tenet-history-viewer\.js release\/teacher-preview\/tenet-history-viewer\.js/);
  assert.match(workflow, /path: release\/teacher-preview/);
  assert.doesNotMatch(workflow, /cp -r|cp .*\*|path: ['"]?\.['"]?\s*$/m);
  assert.doesNotMatch(workflow, /secrets\.|student|notebook|\.env/);
});

test("marketing version and root lock metadata agree without dependency changes", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
});
