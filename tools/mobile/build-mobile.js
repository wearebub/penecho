"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const MOBILE_ROOT = __dirname;
const APP_PACKAGE = require(path.join(ROOT, "package.json"));
const CAPACITOR_BIN = path.join(MOBILE_ROOT, "node_modules", ".bin", process.platform === "win32" ? "cap.cmd" : "cap");
const RELEASE_DIR = path.join(ROOT, "release", "mobile");
const ICON_SOURCE = path.join(ROOT, "public", "tenet-whiteboard-icon-512.png");
const PRODUCT_NAME = "Tenet Whiteboard";
const ARTIFACT_NAME = "Tenet-Whiteboard";
const BUNDLE_ID = "ai.truemade.tenet.whiteboard";

function fail(message) {
  console.error(`Mobile packaging error: ${message}`);
  process.exitCode = 1;
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with status ${result.status}`);
}

function cap(...args) {
  if (!fs.existsSync(CAPACITOR_BIN)) {
    throw new Error('Mobile dependencies are missing. Run "npm run mobile:deps" first.');
  }
  run(CAPACITOR_BIN, args, MOBILE_ROOT);
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function buildNumber(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .split(".")
    .map(value => Number.parseInt(value, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}

async function writePng(source, target, width, height = width) {
  let sharp;
  try { sharp = require("sharp"); }
  catch { throw new Error("The root sharp dependency is required to generate mobile icons."); }
  ensureDir(path.dirname(target));
  await sharp(source)
    .resize(width, height, { fit: "contain", background: { r: 246, g: 242, b: 232, alpha: 1 } })
    .png()
    .toFile(target);
}

async function writeSplash(target) {
  const sharp = require("sharp");
  const metadata = await sharp(target).metadata();
  const width = metadata.width || 2732;
  const height = metadata.height || 2732;
  const logoSize = Math.max(96, Math.round(Math.min(width, height) * 0.3));
  const logo = await sharp(ICON_SOURCE).resize(logoSize, logoSize, { fit: "contain" }).png().toBuffer();
  const temporary = `${target}.tenet.png`;
  await sharp({
    create: { width, height, channels: 4, background: { r: 246, g: 242, b: 232, alpha: 1 } },
  }).composite([{ input: logo, gravity: "center" }]).png().toFile(temporary);
  fs.renameSync(temporary, target);
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

async function generateAndroidIcons() {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(sizes)) {
    const directory = path.join(MOBILE_ROOT, "android", "app", "src", "main", "res", `mipmap-${density}`);
    await writePng(ICON_SOURCE, path.join(directory, "ic_launcher.png"), size);
    await writePng(ICON_SOURCE, path.join(directory, "ic_launcher_round.png"), size);
    await writePng(ICON_SOURCE, path.join(directory, "ic_launcher_foreground.png"), size);
  }
  const adaptiveDirectory = path.join(MOBILE_ROOT, "android", "app", "src", "main", "res", "mipmap-anydpi-v26");
  const adaptiveXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <background android:drawable="@color/ic_launcher_background" />',
    '  <foreground android:drawable="@mipmap/ic_launcher_foreground" />',
    '</adaptive-icon>',
    "",
  ].join("\n");
  ensureDir(adaptiveDirectory);
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    fs.writeFileSync(path.join(adaptiveDirectory, name), adaptiveXml);
  }
  const resources = path.join(MOBILE_ROOT, "android", "app", "src", "main", "res");
  for (const splash of filesBelow(resources).filter(file => path.basename(file) === "splash.png")) {
    await writeSplash(splash);
  }
}

async function configureAndroidNetwork() {
  const { Builder, parseStringPromise } = require("xml2js");
  const manifestPath = path.join(MOBILE_ROOT, "android", "app", "src", "main", "AndroidManifest.xml");
  const manifest = await parseStringPromise(fs.readFileSync(manifestPath, "utf8"));
  manifest.manifest.application[0].$["android:usesCleartextTraffic"] = "false";
  fs.writeFileSync(manifestPath, new Builder().buildObject(manifest));
}

async function generateIosIcons() {
  const iconSet = path.join(MOBILE_ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset");
  const contentsPath = path.join(iconSet, "Contents.json");
  if (!fs.existsSync(contentsPath)) throw new Error(`Capacitor did not create ${contentsPath}`);
  const contents = JSON.parse(fs.readFileSync(contentsPath, "utf8"));
  for (const image of contents.images || []) {
    if (!image.filename || !image.size) continue;
    const width = Number.parseFloat(image.size.split("x")[0]);
    const scale = Number.parseInt(String(image.scale || "1x"), 10);
    if (Number.isFinite(width) && Number.isFinite(scale)) {
      await writePng(ICON_SOURCE, path.join(iconSet, image.filename), Math.round(width * scale));
    }
  }
  const splashSet = path.join(MOBILE_ROOT, "ios", "App", "App", "Assets.xcassets", "Splash.imageset");
  for (const splash of filesBelow(splashSet).filter(file => path.extname(file).toLowerCase() === ".png")) {
    await writeSplash(splash);
  }
}

function configureIosProject() {
  const projectPath = path.join(MOBILE_ROOT, "ios", "App", "App.xcodeproj", "project.pbxproj");
  let project = fs.readFileSync(projectPath, "utf8");
  project = project
    .replace(/TARGETED_DEVICE_FAMILY = [^;]+;/g, 'TARGETED_DEVICE_FAMILY = "2";')
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, "IPHONEOS_DEPLOYMENT_TARGET = 15.0;");
  fs.writeFileSync(projectPath, project);
}

function pbxQuoted(value, label) {
  const text = String(value || "");
  if (!text || /[\r\n]/.test(text)) throw new Error(`Invalid ${label} for the Xcode project.`);
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function configureIosAppSigning(iosRoot, signing) {
  const projectPath = path.join(iosRoot, "App", "App.xcodeproj", "project.pbxproj");
  let project = fs.readFileSync(projectPath, "utf8");
  const newline = project.includes("\r\n") ? "\r\n" : "\n";
  let appConfigurations = 0;

  project = project.replace(
    /(\s*buildSettings = \{\r?\n)([\s\S]*?)(\r?\n\s*\};)/g,
    (block, opening, settings, closing) => {
      const bundleSetting = `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE_ID};`;
      if (!settings.includes(bundleSetting)) return block;

      appConfigurations += 1;
      const indent = settings.match(/^(\s*)PRODUCT_BUNDLE_IDENTIFIER =/m)?.[1];
      if (!indent) throw new Error("Could not locate the App target signing indentation.");
      const cleaned = settings
        .replace(/^\s*CODE_SIGN_IDENTITY = [^;]*;\r?\n/gm, "")
        .replace(/^\s*CODE_SIGN_STYLE = [^;]*;\r?\n/gm, "")
        .replace(/^\s*DEVELOPMENT_TEAM = [^;]*;\r?\n/gm, "")
        .replace(/^\s*PROVISIONING_PROFILE_SPECIFIER = [^;]*;\r?\n/gm, "");
      const scopedSigning = [
        `${indent}CODE_SIGN_IDENTITY = ${pbxQuoted(signing.identity, "signing identity")};`,
        `${indent}CODE_SIGN_STYLE = Manual;`,
        `${indent}DEVELOPMENT_TEAM = ${pbxQuoted(signing.teamId, "Apple team ID")};`,
        `${indent}PROVISIONING_PROFILE_SPECIFIER = ${pbxQuoted(signing.profile, "provisioning profile")};`,
      ].join(newline);
      const configured = cleaned.replace(
        `${indent}${bundleSetting}`,
        `${scopedSigning}${newline}${indent}${bundleSetting}`,
      );
      return `${opening}${configured}${closing}`;
    },
  );

  if (appConfigurations !== 2) {
    throw new Error(`Expected two App target build configurations, found ${appConfigurations}.`);
  }
  fs.writeFileSync(projectPath, project);
}

function configureIosInfo() {
  const plist = require("plist");
  const plistPath = path.join(MOBILE_ROOT, "ios", "App", "App", "Info.plist");
  const info = plist.parse(fs.readFileSync(plistPath, "utf8"));
  info.CFBundleDisplayName = PRODUCT_NAME;
  info.CFBundleURLTypes = [{
    CFBundleTypeRole: "Editor",
    CFBundleURLName: BUNDLE_ID,
    CFBundleURLSchemes: ["tenet-whiteboard"],
  }];
  info.ITSAppUsesNonExemptEncryption = false;
  info.NSMicrophoneUsageDescription = "Tenet uses the microphone when you tap Talk to transcribe on this iPad. After 1.5 seconds without a new transcribed word, your transcript and selected or visible page image are automatically sent through your district Gateway. Audio is not uploaded or saved.";
  info.NSSpeechRecognitionUsageDescription = "Tenet transcribes speech on this iPad only. After 1.5 seconds without a new transcribed word, only transcribed text from your speech is automatically sent through your district Gateway, together with the selected or visible page image. Audio is not uploaded or saved.";
  info.UIApplicationSupportsIndirectInputEvents = true;
  info["UISupportedInterfaceOrientations~ipad"] = [
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationPortraitUpsideDown",
    "UIInterfaceOrientationLandscapeLeft",
    "UIInterfaceOrientationLandscapeRight",
  ];
  delete info.NSLocalNetworkUsageDescription;
  delete info.NSAppTransportSecurity;
  fs.writeFileSync(plistPath, plist.build(info));
}

function ensurePlatform(platform) {
  fs.copyFileSync(ICON_SOURCE, path.join(MOBILE_ROOT, "web", "tenet-whiteboard-icon.png"));
  const directory = path.join(MOBILE_ROOT, platform);
  if (!fs.existsSync(directory)) cap("add", platform);
  cap("sync", platform);
  return directory;
}

function copyArtifact(source, extension, suffix) {
  if (!fs.existsSync(source)) throw new Error(`Expected build artifact was not found: ${source}`);
  ensureDir(RELEASE_DIR);
  const target = path.join(RELEASE_DIR, `${ARTIFACT_NAME}-${APP_PACKAGE.version}-${suffix}.${extension}`);
  fs.copyFileSync(source, target);
  console.log(target);
}

function iosBuildNumber() {
  const explicit = Number.parseInt(process.env.IOS_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || "", 10);
  return Number.isSafeInteger(explicit) && explicit > 0 ? explicit : buildNumber(APP_PACKAGE.version);
}

function iosSigning() {
  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  const profile = String(process.env.IOS_PROVISIONING_PROFILE_SPECIFIER || "").trim();
  const identity = String(process.env.IOS_SIGNING_IDENTITY || "Apple Distribution").trim();
  const requested = Boolean(teamId || profile || process.env.IOS_SIGNING_IDENTITY);
  if (requested && (!teamId || !profile || !identity)) {
    throw new Error("Signed iOS builds require APPLE_TEAM_ID, IOS_PROVISIONING_PROFILE_SPECIFIER, and IOS_SIGNING_IDENTITY.");
  }
  return requested ? { teamId, profile, identity } : null;
}

async function buildAndroid() {
  const androidRoot = ensurePlatform("android");
  await generateAndroidIcons();
  await configureAndroidNetwork();
  cap("sync", "android");
  const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const signed = Boolean(process.env.ANDROID_SIGNING_STORE_FILE);
  const task = signed ? "assembleRelease" : "assembleDebug";
  const args = [
    `app:${task}`,
    "--no-daemon",
    `-Pandroid.injected.version.name=${APP_PACKAGE.version}`,
    `-Pandroid.injected.version.code=${buildNumber(APP_PACKAGE.version)}`,
  ];
  if (signed) {
    args.push(
      `-Pandroid.injected.signing.store.file=${process.env.ANDROID_SIGNING_STORE_FILE}`,
      `-Pandroid.injected.signing.store.password=${process.env.ANDROID_SIGNING_STORE_PASSWORD || ""}`,
      `-Pandroid.injected.signing.key.alias=${process.env.ANDROID_SIGNING_KEY_ALIAS || ""}`,
      `-Pandroid.injected.signing.key.password=${process.env.ANDROID_SIGNING_KEY_PASSWORD || ""}`,
    );
  }
  run(gradle, args, androidRoot);
  copyArtifact(
    path.join(androidRoot, "app", "build", "outputs", "apk", signed ? "release" : "debug", `app-${signed ? "release" : "debug"}.apk`),
    "apk",
    signed ? "android" : "android-debug",
  );
}

async function prepareIos() {
  const iosRoot = ensurePlatform("ios");
  await generateIosIcons();
  configureIosInfo();
  configureIosProject();
  cap("sync", "ios");
  console.log(`Prepared native iPad project: ${path.join(iosRoot, "App", "App.xcworkspace")}`);
  return iosRoot;
}

async function buildIos() {
  const iosRoot = await prepareIos();
  if (process.platform !== "darwin") {
    throw new Error("The Xcode project is prepared, but compiling or signing an iOS app requires macOS with Xcode.");
  }

  const signing = iosSigning();
  if (signing) configureIosAppSigning(iosRoot, signing);
  const projectVersion = String(iosBuildNumber());
  const archiveRoot = path.join(RELEASE_DIR, "ios", "TenetWhiteboard.xcarchive");
  fs.rmSync(archiveRoot, { recursive: true, force: true });
  const archiveArgs = [
    "archive",
    "-workspace", path.join(iosRoot, "App", "App.xcworkspace"),
    "-scheme", "App",
    "-configuration", "Release",
    "-sdk", "iphoneos",
    "-archivePath", archiveRoot,
    `MARKETING_VERSION=${APP_PACKAGE.version}`,
    `CURRENT_PROJECT_VERSION=${projectVersion}`,
  ];
  if (!signing) {
    archiveArgs.push("CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=");
  }
  run("xcodebuild", archiveArgs, MOBILE_ROOT);

  if (signing) {
    const exportRoot = path.join(RELEASE_DIR, "ios", "export");
    const exportOptionsPath = path.join(RELEASE_DIR, "ios", "ExportOptions.plist");
    fs.rmSync(exportRoot, { recursive: true, force: true });
    ensureDir(exportRoot);
    fs.writeFileSync(exportOptionsPath, require("plist").build({
      method: "app-store-connect",
      destination: "export",
      signingStyle: "manual",
      signingCertificate: signing.identity,
      teamID: signing.teamId,
      provisioningProfiles: { [BUNDLE_ID]: signing.profile },
      manageAppVersionAndBuildNumber: false,
      stripSwiftSymbols: true,
      uploadSymbols: true,
    }));
    run("xcodebuild", [
      "-exportArchive",
      "-archivePath", archiveRoot,
      "-exportPath", exportRoot,
      "-exportOptionsPlist", exportOptionsPath,
    ], MOBILE_ROOT);
    const exported = filesBelow(exportRoot).find(file => path.extname(file).toLowerCase() === ".ipa");
    if (!exported) throw new Error("Xcode export succeeded without producing an IPA.");
    copyArtifact(exported, "ipa", "ios");
    return;
  }

  const appPath = path.join(archiveRoot, "Products", "Applications", "App.app");
  const payloadRoot = path.join(RELEASE_DIR, "ios", "Payload");
  fs.rmSync(payloadRoot, { recursive: true, force: true });
  ensureDir(payloadRoot);
  fs.cpSync(appPath, path.join(payloadRoot, `${PRODUCT_NAME}.app`), { recursive: true });
  const ipa = path.join(RELEASE_DIR, `${ARTIFACT_NAME}-${APP_PACKAGE.version}-ios-unsigned.ipa`);
  fs.rmSync(ipa, { force: true });
  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", "Payload", ipa], path.join(RELEASE_DIR, "ios"));
  console.log(ipa);
}

const target = process.argv[2];
if (!["android", "ios", "ios-project"].includes(target)) {
  fail(`usage: node ${path.relative(ROOT, __filename)} <android|ios|ios-project>`);
} else {
  const task = target === "android" ? buildAndroid() : target === "ios" ? buildIos() : prepareIos();
  task.catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
