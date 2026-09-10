import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'wearebub/penecho';
const BASE = `repos/${REPO}`;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG = /^tenet-(?:web-v\d+\.\d+\.\d+|ipad-v\d+\.\d+\.\d+-build\.[1-9]\d*)$/;
const WEB_PATHS = [
  'public/app.js', 'public/index.html', 'public/tenet-ink-comparison.css',
  'public/tenet-ipad-usability.css', 'public/tenet-notebook.css',
  'public/tenet-selection-tools.css', 'scripts/build-client.js', 'src/client',
];
const WHITEBOARD_SERVER_PATHS = ['src/server/main.js', 'src/server/tenet-illustration.js'];

function command(name, args, options = {}) {
  return execFileSync(name, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

export function api(route, method = 'GET', payload) {
  const args = ['api', `${BASE}/${route}`, '--method', method];
  if (payload !== undefined) args.push('--input', '-');
  const result = command('gh', args, payload === undefined ? {} : { input: JSON.stringify(payload) });
  return result.trim() ? JSON.parse(result) : null;
}

export function releaseDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tenet-release-'));
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function committedSource(source) {
  assert.match(source, /^[a-f0-9]{40}$/, 'An exact source commit is required');
  assert.equal(command('git', ['rev-parse', `${source}^{commit}`]).trim(), source);
  return source;
}

export function createClientArchive(source, directory, version, includeWhiteboardServer = false) {
  committedSource(source);
  assert.match(version, VERSION);
  const archivePaths = includeWhiteboardServer ? [...WEB_PATHS, ...WHITEBOARD_SERVER_PATHS] : WEB_PATHS;
  const names = command('git', ['ls-tree', '-r', '--name-only', source, '--', ...archivePaths]).trim().split('\n');
  for (const required of WEB_PATHS.slice(0, -1)) assert(names.includes(required), `Missing client asset: ${required}`);
  if (includeWhiteboardServer) for (const required of WHITEBOARD_SERVER_PATHS) assert(names.includes(required), `Missing Whiteboard runtime: ${required}`);
  const files = names.map(name => {
    assert(!name.includes('..') && !name.includes('\\') && !name.startsWith('/'), 'Unsafe archive path');
    const data = command('git', ['show', `${source}:${name}`], { encoding: null });
    return { path: name, sha256: sha256(data) };
  });
  const archive = path.join(directory, `Tenet-Whiteboard-${includeWhiteboardServer ? 'runtime' : 'web'}-${version}.tar`);
  command('git', ['archive', '--format=tar', `--output=${archive}`, source, '--', ...archivePaths]);
  return { archive, files };
}

export function inspectIpa(ipa) {
  // The stdlib parser supports binary plists. Never extract or execute IPA contents.
  const python = process.platform === 'win32' ? 'python' : 'python3';
  return JSON.parse(command(python, ['-c', [
    'import json,plistlib,sys,zipfile',
    'z=zipfile.ZipFile(sys.argv[1])',
    'names=[n for n in z.namelist() if n.startswith("Payload/") and n.endswith(".app/Info.plist") and n.count("/")==2]',
    'assert len(names)==1, "Expected exactly one main app plist"',
    'assert z.getinfo(names[0]).file_size < 1048576, "Oversized plist"',
    'p=plistlib.loads(z.read(names[0]))',
    'print(json.dumps({k:p.get(k) for k in ["CFBundleIdentifier","CFBundleShortVersionString","CFBundleVersion"]}))',
  ].join('\n'), ipa]));
}

function verifyAssets(release, assets) {
  assert.equal(release.assets.length, assets.length, 'Unexpected or missing release assets');
  for (const expected of assets) {
    const actual = release.assets.find(asset => asset.name === expected.name);
    assert(actual, `Missing uploaded asset: ${expected.name}`);
    assert.equal(actual.state, 'uploaded');
    assert.equal(actual.size, expected.bytes);
    assert.equal(actual.digest, `sha256:${expected.sha256}`, `Upload digest mismatch: ${expected.name}`);
  }
}

export function publishRelease({ tag, sourceCommit, title, notes, directory, artifacts, provenance }) {
  assert.match(tag, TAG);
  committedSource(sourceCommit);
  const sourceArchive = path.join(directory, `${tag}-source.zip`);
  command('git', ['archive', '--format=zip', `--prefix=${tag}/`, `--output=${sourceArchive}`, sourceCommit]);
  const paths = [...artifacts, sourceArchive];
  const record = file => {
    const name = path.basename(file);
    assert.match(name, /^[A-Za-z0-9._-]+$/, 'Unsafe asset name');
    const data = fs.readFileSync(file);
    assert(data.length > 0 && data.length < 1_900_000_000, 'Invalid release asset size');
    return { name, bytes: data.length, sha256: sha256(data) };
  };
  const manifest = {
    schemaVersion: 1, product: 'Tenet Whiteboard', tag, sourceCommit,
    sourceDate: command('git', ['show', '-s', '--format=%cI', sourceCommit]).trim(),
    channel: 'testing', provenance, artifacts: paths.map(record),
  };
  const manifestPath = path.join(directory, 'release.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  paths.push(manifestPath);
  const checksumPath = path.join(directory, 'SHA256SUMS');
  fs.writeFileSync(checksumPath, paths.map(record).map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
  paths.push(checksumPath);
  const expectedAssets = paths.map(record);
  assert.equal(new Set(expectedAssets.map(asset => asset.name)).size, paths.length, 'Duplicate asset names');

  // Tag only committed source, never HEAD by implication or an uncommitted directory.
  const refName = `refs/tags/${tag}`;
  const refs = api(`git/matching-refs/tags/${tag}`);
  const existingRef = refs.find(ref => ref.ref === refName);
  if (existingRef) {
    assert.equal(existingRef.object.type, 'tag', 'Release tag must be annotated');
    const target = api(`git/tags/${existingRef.object.sha}`).object;
    assert.equal(target.type, 'commit');
    assert.equal(target.sha, sourceCommit, 'Refusing to move an existing release tag');
  } else {
    const annotated = api('git/tags', 'POST', {
      tag, message: `${title}\n\nSource: ${sourceCommit}\n\n${notes}`, object: sourceCommit, type: 'commit',
    });
    api('git/refs', 'POST', { ref: refName, sha: annotated.sha });
  }

  // List includes drafts for the publishing principal; pagination avoids missing older versions.
  const pages = JSON.parse(command('gh', ['api', `${BASE}/releases?per_page=100`, '--paginate', '--slurp']));
  let release = pages.flat().find(item => item.tag_name === tag);
  if (release && !release.draft) {
    verifyAssets(release, expectedAssets);
    assert.equal(release.immutable, true, 'Existing release is not immutable');
    console.log(release.html_url);
    return release;
  }
  if (!release) {
    release = api('releases', 'POST', {
      tag_name: tag, target_commitish: sourceCommit, name: title,
      body: notes, draft: true, prerelease: true, make_latest: 'false',
    });
  }
  for (let index = 0; index < paths.length; index += 1) {
    const expected = expectedAssets[index];
    const existing = release.assets.find(asset => asset.name === expected.name);
    if (existing) {
      assert.equal(existing.digest, `sha256:${expected.sha256}`, 'Refusing to overwrite a different draft asset');
    } else {
      command('gh', ['release', 'upload', tag, paths[index], '--repo', REPO]);
    }
  }
  release = api(`releases/${release.id}`);
  verifyAssets(release, expectedAssets);
  // Publish last: GitHub locks the annotated tag and verified assets at this boundary.
  release = api(`releases/${release.id}`, 'PATCH', { draft: false, prerelease: true, make_latest: 'false' });
  assert.equal(release.immutable, true, 'Repository immutable releases must be enabled');
  console.log(release.html_url);
  return release;
}

function workflowEvidence(kind) {
  assert.equal(process.env.GITHUB_REPOSITORY, REPO, 'Publishing is restricted to the Tenet fork');
  const runId = process.env.GITHUB_RUN_ID || '';
  assert.match(runId, /^\d+$/);
  const run = api(`actions/runs/${runId}`);
  const source = committedSource(process.env.GITHUB_SHA || '');
  assert.equal(run.head_sha, source);
  assert.equal(run.head_repository.full_name, REPO);
  assert(['push', 'workflow_dispatch'].includes(run.event), 'Untrusted workflow trigger');
  assert.equal(run.path, kind === 'ios' ? '.github/workflows/ios-release.yml' : '.github/workflows/tenet-web-release.yml');
  const response = api(`actions/runs/${runId}/jobs?per_page=100`);
  assert(response.total_count <= 100, 'Too many jobs to qualify safely');
  for (const node of ['22.x', '24.x']) {
    assert(response.jobs.some(job => job.name === `Required client CI / check (${node})` && job.conclusion === 'success'), `Full Node ${node} CI must pass`);
  }
  return { runId, run, source, jobs: response.jobs };
}

async function main(kind) {
  assert(['ios', 'web'].includes(kind), 'Usage: node scripts/publish-tenet-release.mjs <ios|web>');
  const { runId, run, source, jobs } = workflowEvidence(kind);
  const directory = releaseDirectory();
  if (kind === 'ios') {
    assert(jobs.some(job => job.name === 'Compile iPad app' && job.conclusion === 'success'));
    const signed = jobs.find(job => job.name === 'Build signed iPad application');
    assert.equal(signed?.conclusion, 'success', 'Signed build must succeed before archival');
    const download = path.join(directory, 'download');
    command('gh', ['run', 'download', runId, '--repo', REPO, '--name', 'tenet-whiteboard-ios', '--dir', download]);
    const ipas = fs.readdirSync(download).filter(name => name.endsWith('.ipa'));
    assert.equal(ipas.length, 1, 'Expected the exact signed IPA artifact');
    const ipa = path.join(download, ipas[0]);
    const info = inspectIpa(ipa);
    assert.equal(info.CFBundleIdentifier, 'ai.truemade.tenet.whiteboard');
    const version = info.CFBundleShortVersionString;
    const build = String(info.CFBundleVersion);
    assert.match(version, VERSION);
    assert.equal(build, String(run.run_number), 'IPA build does not match the producing workflow');
    assert.equal(version, JSON.parse(command('git', ['show', `${source}:package.json`])).version);
    const artifact = path.join(directory, `Tenet-Whiteboard-${version}-build.${build}.ipa`);
    fs.copyFileSync(ipa, artifact);
    const uploaded = signed.steps.some(step => step.name === 'Upload to TestFlight' && step.conclusion === 'success');
    publishRelease({
      tag: `tenet-ipad-v${version}-build.${build}`, sourceCommit: source,
      title: `Tenet Whiteboard iPad ${version} (${build})`, directory, artifacts: [artifact],
      notes: `Exact signed IPA from [workflow ${runId}](${run.html_url}). Full Node 22/24 CI, simulator compile, and signed verification passed.\n\nTestFlight upload: ${uploaded ? 'accepted by the upload command; Apple processing is separate' : 'not requested'}.\n\nHosted client releases are versioned separately. This is a testing prerelease, not App Store approval or physical-device qualification. See release.json and SHA256SUMS.`,
      provenance: { surface: 'ipad', version, build, bundleId: info.CFBundleIdentifier, workflow: run.html_url, artifact: 'tenet-whiteboard-ios', fullCi: 'passed', testFlightUpload: uploaded },
    });
  } else {
    const version = process.env.RELEASE_VERSION || '';
    const pairedIpad = process.env.RELEASE_IPAD_TAG || '';
    assert.match(version, VERSION);
    assert.match(pairedIpad, /^tenet-ipad-v\d+\.\d+\.\d+-build\.[1-9]\d*$/);
    const ipad = api(`releases/tags/${pairedIpad}`);
    assert(!ipad.draft && ipad.immutable, 'Pair with a published immutable iPad release');
    const current = version.split('.').map(BigInt);
    const refs = api('git/matching-refs/tags/tenet-web-v');
    for (const ref of refs) {
      const previous = ref.ref.replace('refs/tags/tenet-web-v', '');
      assert.match(previous, VERSION);
      const parts = previous.split('.').map(BigInt);
      const difference = current.map((value, index) => value - parts[index]).find(value => value !== 0n);
      assert(difference === undefined || difference > 0n, 'Hosted release versions must increase');
    }
    const { archive, files } = createClientArchive(source, directory, version, true);
    publishRelease({
      tag: `tenet-web-v${version}`, sourceCommit: source,
      title: `Tenet Whiteboard hosted runtime ${version}`, directory, artifacts: [archive],
      notes: `Whiteboard client and server overlay from [workflow ${runId}](${run.html_url}), after full Node 22/24 CI.\n\nPaired native release: ${pairedIpad}. This pairing is an operator selection, not a claim of physical-device testing.\n\nPublishing does NOT deploy. The TAR contains the client allowlist plus the Whiteboard command server and illustration rasterizer. Installing it requires a coordinated Whiteboard server restart. It does not include the Gateway, authentication service, secrets, dependencies, or notebook data. Back up every changed runtime file before installation. See release.json for every path/hash and SHA256SUMS for artifact integrity.`,
      provenance: { surface: 'hosted-runtime', version, pairedIpad, workflow: run.html_url, fullCi: 'passed', deployment: 'not performed by release publishing', requiresWhiteboardRestart: true, files },
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
