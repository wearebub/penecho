"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function json(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

test("Android dependencies stay isolated from the root install", () => {
  const rootPackage = json("package.json");
  const rootLock = json("package-lock.json");
  const mobilePackage = json("tools/mobile/package.json");
  const mobileLock = json("tools/mobile/package-lock.json");
  for (const dependency of ["@capacitor/android", "@capacitor/cli", "@capacitor/core"]) {
    assert.equal(rootPackage.dependencies[dependency], undefined, dependency);
    assert.equal(rootPackage.devDependencies[dependency], undefined, dependency);
    assert.equal(rootLock.packages[`node_modules/${dependency}`], undefined, dependency);
    assert.equal(mobilePackage.dependencies[dependency], "7.4.3", dependency);
    assert.ok(mobileLock.packages[`node_modules/${dependency}`], dependency);
  }
  assert.equal(rootPackage.scripts["mobile:deps"], "npm ci --prefix tools/mobile");
  assert.equal(rootPackage.scripts["mobile:apk"], "node tools/mobile/build-mobile.js android");
});

test("mobile connection shell uses native auth and fixed governed hosts", () => {
  const config = json("tools/mobile/capacitor.config.json");
  const html = fs.readFileSync(path.join(ROOT, "tools/mobile/web/index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "tools/mobile/web/app.js"), "utf8");
  assert.equal(config.appId, "ai.truemade.tenet.whiteboard");
  assert.deepEqual(new Set(config.server.allowNavigation), new Set([
    "district.connect.truemadeai.com",
    "spanish.connect.truemadeai.com",
  ]));
  assert.equal(config.server.cleartext, false);
  assert.match(html, /Tenet Whiteboard/);
  assert.match(html, /id="primaryAction"[^>]*>Sign in with Google/);
  assert.doesNotMatch(html, /id="serverUrl"/);
  assert.match(app, /window\.Capacitor\.Plugins\.TenetNative/);
  assert.match(app, /bridge\.restoreSession\(\)/);
  assert.match(app, /bridge\.authenticate\(\{ baseUrl: configuration\.baseUrl \}\)/);
  assert.doesNotMatch(app, /localStorage/);
  assert.doesNotMatch(`${html}\n${app}`, /API[_ -]?key/i);
});

test("mobile builder creates branded, optionally signed APK targets", () => {
  const builder = fs.readFileSync(path.join(ROOT, "tools/mobile/build-mobile.js"), "utf8");
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(builder, /"assembleRelease" : "assembleDebug"/);
  assert.match(builder, /android\.injected\.version\.name/);
  assert.match(builder, /android:usesCleartextTraffic/);
  assert.match(builder, /ANDROID_SIGNING_STORE_FILE/);
  assert.match(builder, /tenet-whiteboard-icon-512\.png/);
  assert.match(builder, /android:usesCleartextTraffic"\] = "false"/);
  assert.match(builder, /android-debug/);
  assert.match(ignore, /tools\/mobile\/android\//);
  assert.match(ignore, /tools\/mobile\/web\/penecho-mark\.png/);
});

test("iOS builder exports a signed IPA with an independent CI build number", () => {
  const rootPackage = json("package.json");
  const builder = fs.readFileSync(path.join(ROOT, "tools/mobile/build-mobile.js"), "utf8");
  assert.equal(rootPackage.scripts["mobile:ipa"], "node tools/mobile/build-mobile.js ios");
  assert.match(builder, /IOS_BUILD_NUMBER/);
  assert.match(builder, /APP_STORE_CONNECT|app-store-connect/);
  assert.match(builder, /IOS_PROVISIONING_PROFILE_SPECIFIER/);
  assert.match(builder, /PROVISIONING_PROFILE_SPECIFIER/);
  assert.match(builder, /-exportArchive/);
  assert.match(builder, /ITSAppUsesNonExemptEncryption = false/);
  assert.match(builder, /ARTIFACT_NAME = "Tenet-Whiteboard"/);
  assert.match(builder, /\$\{ARTIFACT_NAME\}-\$\{APP_PACKAGE\.version\}-\$\{suffix\}/);
  assert.doesNotMatch(builder, /penecho_cloud|public\/canvas/);
});

test("iOS release workflow signs tag artifacts and keeps TestFlight upload explicit", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ios-release.yml"), "utf8");
  assert.match(workflow, /push:[\s\S]*?tags:/);
  assert.match(workflow, /environment: ios-signing/);
  assert.match(workflow, /IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64/);
  assert.match(workflow, /IOS_PROVISIONING_PROFILE_BASE64/);
  assert.match(workflow, /\/usr\/bin\/base64 -D/);
  assert.doesNotMatch(workflow, /base64 --decode/);
  assert.match(workflow, /npm run mobile:ipa/);
  assert.match(workflow, /release\/mobile\/\*\.ipa/);
  assert.match(workflow, /UPLOAD_TESTFLIGHT: \$\{\{ inputs\.upload_testflight == true \}\}/);
  assert.match(workflow, /xcrun altool --upload-app/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO[\s\S]*?build/);
  assert.match(workflow, /tenet-whiteboard-ios-simulator/);
});

test("the shared Canvas preserves coalesced Apple Pencil samples before committing ink", () => {
  const persistence = fs.readFileSync(path.join(ROOT, "src/client/app/persistence.js"), "utf8");
  const bindings = fs.readFileSync(path.join(ROOT, "src/client/app/ui-bootstrap.js"), "utf8");
  assert.match(persistence, /e\.pointerType !== "pen"[\s\S]*?e\.pressure/);
  assert.match(persistence, /state\.pen \* \(0\.72 \+ e\.pressure \* 0\.7\)/);
  assert.match(bindings, /if \(e\.pointerType === "touch"\)[\s\S]*?state\.panGesture/);
  assert.match(bindings, /const cssSize = erasing \? state\.eraser : pressureWidth\(e\)/);
  assert.match(bindings, /getCoalescedEvents[\s\S]*?coalesced\.length \? \[\.\.\.coalesced\] : \[event\][\s\S]*?source\.push\(event\)/);
  assert.match(bindings, /for \(let index = 0; index < samples\.length; index\+\+\)[\s\S]*?const sample = samples\[index\][\s\S]*?drawingClientPoint\(d, sample\)[\s\S]*?appendLiveInkSample\(d, p, size\)[\s\S]*?commitLiveInkDrawingProgress\(d\)/);
});

test("release workflow builds and publishes the Android APK", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/desktop-release.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:[\s\S]*?tags:/);
  assert.match(workflow, /^  android:$/m);
  assert.doesNotMatch(workflow, /android-actions\/setup-android/);
  assert.doesNotMatch(workflow, /\bsdkmanager\b/);
  assert.match(workflow, /npm ci --prefix tools\/mobile/);
  assert.match(workflow, /npm run mobile:apk/);
  assert.match(workflow, /release\/mobile\/\*\.apk/);
  assert.match(workflow, /needs: \[mac, windows, android\]/);
});
