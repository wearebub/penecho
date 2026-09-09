'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const MODULE_PATH = path.join(__dirname, '../src/client/app/tenet-ink-comparison.js');
const STORAGE_KEY = 'tenet.ink-comparison.v1';
const source = fs.readFileSync(MODULE_PATH, 'utf8');

// Expose private functions only inside the test VM. Production keeps its private
// IIFE and public-API-only integration, without a test hook on window.TenetInk.
const instrumented = source.replace(/\n  activate\(\);\s*\}\)\(\);\s*$/, `
  globalThis.inkTest = {
    state, normalizeStatus, emptyStats, addStat, finishRecord,
    sanitizedRecord, persistResults, loadResults
  };
  activate();
})();`);
assert.notEqual(instrumented, source, 'The test seam must match the module startup');
const script = new vm.Script(instrumented, { filename: MODULE_PATH });
let sequence = 0;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(storage = new Map()) {
  const window = Object.assign(new EventTarget(), {
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    cancelAnimationFrame() {
      assert.fail('A finalized fixture must not have a pending animation frame');
    }
  });
  // No available native API: startup registers listeners without constructing UI.
  const document = Object.assign(new EventTarget(), { readyState: 'complete' });
  const context = vm.createContext({ window, document, performance: { now: () => 1400 } });
  script.runInContext(context);
  return { api: context.inkTest, storage };
}

function finishTrial(instance, engine, startStrokeCount, endStrokeCount) {
  const { api } = instance;
  const start = api.normalizeStatus({ engine, strokeCount: startStrokeCount, busy: false, nativeAvailable: true });
  api.state.status = api.normalizeStatus({ engine, strokeCount: endStrokeCount, busy: false, nativeAvailable: true });
  const stats = values => {
    const result = api.emptyStats();
    values.forEach(value => api.addStat(result, value));
    return result;
  };
  api.state.trial = {
    id: '1700000000000-' + (++sequence), engine, task: 'sentence',
    startedAt: '2026-09-09T12:00:00.000Z', endedAt: '2026-09-09T12:00:00.400Z',
    startMs: 1000, endMs: 1400, visibleSince: null, visibleMs: 400,
    visibilityPauses: 0, startStrokeCount: start.strokeCount,
    events: 2, ignoredHiddenEvents: 0, strokeDuration: stats([8, 12]),
    samples: stats([16, 24]), commits: stats([2, 4]), frames: stats([16, 20]), over33Ms: 0
  };
  return plain(api.finishRecord(null));
}

function reload(instance) {
  const next = harness(instance.storage);
  next.api.loadResults();
  return next;
}

test('Web null inventory survives actual finish, persist, and fresh-context reload', () => {
  const first = harness();
  const expected = finishTrial(first, 'web', null, null);
  assert.equal(expected.strokeDiagnostics.startStrokeCount, null);
  assert.equal(expected.strokeDiagnostics.endStrokeCount, null);
  assert.equal(expected.strokeDiagnostics.deltaStrokeCount, null);
  assert.ok(first.storage.has(STORAGE_KEY));

  const next = reload(first);
  assert.deepEqual(plain(next.api.state.results), [expected]);
  assert.equal(next.api.state.storageWarning, '');
});

test('numeric PencilKit inventory and diagnostic aggregates survive reload unchanged', () => {
  const first = harness();
  const expected = finishTrial(first, 'pencilkit', 8, 10);
  assert.equal(expected.strokeDiagnostics.deltaStrokeCount, 2);
  assert.deepEqual(plain(reload(first).api.state.results), [expected]);
});

test('either absent inventory endpoint keeps the delta null at finish and on reload', () => {
  for (const [start, end] of [[null, null], [null, 0], [null, 7], [0, null], [7, null]]) {
    const instance = harness();
    const record = finishTrial(instance, 'web', start, end);
    assert.equal(record.strokeDiagnostics.deltaStrokeCount, null, `finish ${start} -> ${end}`);
    // Earlier records may contain a numeric delta computed by coercing null to 0.
    record.strokeDiagnostics.deltaStrokeCount = 7;
    instance.storage.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, results: [record] }));
    const restored = plain(reload(instance).api.state.results);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].strokeDiagnostics.startStrokeCount, start);
    assert.equal(restored[0].strokeDiagnostics.endStrokeCount, end);
    assert.equal(restored[0].strokeDiagnostics.deltaStrokeCount, null, `reload ${start} -> ${end}`);
  }
});

test('authoritative zero inventories remain numeric and decreasing inventories have null delta', () => {
  for (const [start, end, expectedDelta] of [[0, 0, 0], [0, 3, 3], [3, 3, 0], [5, 3, null]]) {
    const instance = harness();
    const record = finishTrial(instance, 'pencilkit', start, end);
    assert.equal(record.strokeDiagnostics.deltaStrokeCount, expectedDelta);
    assert.deepEqual(plain(reload(instance).api.state.results), [record]);
  }
});

test('negative, string, and other malformed diagnostic counts are refused, not coerced', () => {
  const instance = harness();
  const record = finishTrial(instance, 'pencilkit', 8, 10);
  for (const key of ['events', 'ignoredHiddenEvents', 'startStrokeCount', 'endStrokeCount', 'deltaStrokeCount']) {
    for (const invalid of [-1, '0', '2', undefined, false, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = plain(record);
      malformed.strokeDiagnostics[key] = invalid;
      assert.equal(instance.api.sanitizedRecord(malformed), null, `${key}: ${String(invalid)}`);
    }
  }
  for (const invalid of [-1, '0', '2']) {
    assert.throws(() => instance.api.normalizeStatus({
      engine: 'web', strokeCount: invalid, busy: false, nativeAvailable: true
    }), /Invalid ink status/);
  }
});

test('reload drops records with invalid counts while keeping valid Web and native results', () => {
  const instance = harness();
  const web = finishTrial(instance, 'web', null, null);
  const native = finishTrial(instance, 'pencilkit', 8, 10);
  const malformed = [];
  for (const key of ['startStrokeCount', 'endStrokeCount', 'deltaStrokeCount']) {
    for (const invalid of [-1, '2']) {
      const record = plain(native);
      record.strokeDiagnostics[key] = invalid;
      malformed.push(record);
    }
  }
  instance.storage.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, results: [web, ...malformed, native] }));
  const next = reload(instance);
  assert.deepEqual(plain(next.api.state.results), [web, native]);
  assert.match(next.api.state.storageWarning, /Some saved results could not be read/);
});

test('reload and subsequent persistence strip unknown top-level and nested fields', () => {
  const instance = harness();
  const expected = finishTrial(instance, 'web', null, null);
  expected.ratings = { smoothness: 3, accuracy: 4, toolUsability: 5 };
  expected.missedStrokes = 0;
  const untrusted = plain(expected);
  untrusted.artwork = { coordinates: [[1, 2]] };
  untrusted.authToken = 'synthetic-test-value';
  untrusted.session = { id: 'synthetic-session' };
  untrusted.timing.privateTimestamp = 123;
  untrusted.strokeDiagnostics.coordinates = [[3, 4]];
  untrusted.strokeDiagnostics.strokeDurationMs.raw = [8, 12];
  untrusted.strokeDiagnostics.samplesPerStroke.pressure = [0.5];
  untrusted.strokeDiagnostics.commitMs.token = 'synthetic-test-value';
  untrusted.frameIntervalsMs.rawFrames = [16, 20];
  untrusted.ratings.account = 'synthetic-account';
  instance.storage.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, results: [untrusted] }));

  const next = reload(instance);
  assert.deepEqual(plain(next.api.state.results), [expected]);
  next.api.persistResults();
  assert.deepEqual(JSON.parse(instance.storage.get(STORAGE_KEY)), { schemaVersion: 1, results: [expected] });
});
