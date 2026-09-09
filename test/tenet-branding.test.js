const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Tenet branding is bundled after the base UI", () => {
  const buildScript = read("scripts/build-client.js");
  const baseUiIndex = buildScript.indexOf("src/client/app/ui-bootstrap.js");
  const brandingIndex = buildScript.indexOf("src/client/app/tenet-branding.js");

  assert.notEqual(baseUiIndex, -1);
  assert.notEqual(brandingIndex, -1);
  assert.ok(brandingIndex > baseUiIndex);
});

test("Tenet branding is gated and presents access identity without role claims", () => {
  const source = read("src/client/app/tenet-branding.js");

  assert.match(source, /config\.tenetMode !== true/);
  assert.match(source, /Tenet Whiteboard/);
  assert.match(source, /Student rules active/);
  assert.match(source, /Google sign-in grants access/);
  assert.doesNotMatch(source, /student session|teacher session|admin session/i);
  assert.doesNotMatch(source, /X-Auth-Request-Email/);
});

test("Tenet manifest defines an installable online iPad application", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));

  assert.equal(manifest.name, "Tenet Whiteboard");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ["192x192", "512x512"]
  );
  assert.ok(fs.existsSync(path.join(ROOT, "public/tenet-whiteboard-icon-180.png")));
  assert.ok(fs.existsSync(path.join(ROOT, "public/tenet-whiteboard-icon-192.png")));
  assert.ok(fs.existsSync(path.join(ROOT, "public/tenet-whiteboard-icon-512.png")));
});
