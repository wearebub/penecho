'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/client/app/tenet-process-journal.js'), 'utf8');
const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const archiveBlob = value => new Blob([JSON.stringify(value)], { type:'application/json' });

// Bounded transactional fixture for the exact IndexedDB operations used here.
// It models async requests, serialized transactions and atomic rollback, not
// browser eviction, Safari transaction lifetime, physical quota or crash recovery.
function memoryIndexedDB() {
  const stores = new Map();
  let initialized = false, tail = Promise.resolve(), nextFailure = null, opens = 0;
  const keyOf = (store, row) => Array.isArray(store.keyPath) ? store.keyPath.map(key => row[key]) : row[store.keyPath];
  function compare(a, b) {
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) { const value = compare(a[i], b[i]); if (value) return value; }
      return 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const database = {
    close() {},
    createObjectStore(name, options) {
      const store = { keyPath:options.keyPath, indexes:new Map(), rows:new Map() };
      stores.set(name, store);
      return { createIndex(index, key) { store.indexes.set(index, key); } };
    },
    transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      const pending = [], working = new Map();
      let active = false, scheduled = false, finished = false, release;
      const wait = new Promise(resolve => { release = resolve; });
      const previous = tail;
      tail = wait;
      const tx = { error:null, oncomplete:null, onabort:null, onerror:null,
        abort() { abort(Error('AbortError')); },
        objectStore(name) {
          assert.ok(names.includes(name));
          function request(operation) {
            if (finished) throw Error('TransactionInactiveError');
            const result = {};
            pending.push(() => {
              try { result.result = clone(operation(working.get(name))); result.onsuccess?.(); }
              catch (error) { result.error = error; result.onerror?.(); abort(error); }
            });
            schedule();
            return result;
          }
          return {
            get(key) { return request(store => store.rows.get(JSON.stringify(key))); },
            getAll() { return request(store => [...store.rows.values()].sort((a, b) => compare(keyOf(store, a), keyOf(store, b)))); },
            count() { return request(store => store.rows.size); },
            add(row) { return request(store => {
              assert.equal(mode, 'readwrite');
              const key = JSON.stringify(keyOf(store, row));
              if (store.rows.has(key)) throw Error('ConstraintError');
              store.rows.set(key, clone(row)); return keyOf(store, row);
            }); },
            put(row) { return request(store => {
              assert.equal(mode, 'readwrite'); store.rows.set(JSON.stringify(keyOf(store, row)), clone(row)); return keyOf(store, row);
            }); },
            delete(key) { return request(store => { assert.equal(mode, 'readwrite'); store.rows.delete(JSON.stringify(key)); }); },
            index(index) {
              const rows = (store, id) => [...store.rows.values()].filter(row => row[store.indexes.get(index)] === id)
                .sort((a, b) => compare(keyOf(store, a), keyOf(store, b)));
              return { getAll(id) { return request(store => rows(store, id)); },
                getAllKeys(id) { return request(store => rows(store, id).map(row => keyOf(store, row))); } };
            },
          };
        },
      };
      function abort(error) {
        if (finished) return;
        finished = true; tx.error = error;
        setImmediate(() => { tx.onabort?.(); release(); });
      }
      function schedule() {
        if (!active || scheduled || finished) return;
        scheduled = true;
        setImmediate(() => {
          scheduled = false;
          if (finished) return;
          const operation = pending.shift();
          if (operation) { operation(); schedule(); return; }
          if (mode === 'readwrite' && nextFailure) { const failure = nextFailure; nextFailure = null; abort(failure); return; }
          if (mode === 'readwrite') for (const [name, store] of working) stores.set(name, store);
          finished = true; tx.oncomplete?.(); release();
        });
      }
      void previous.then(() => {
        if (finished) return;
        for (const name of names) {
          const store = stores.get(name);
          working.set(name, { keyPath:store.keyPath, indexes:store.indexes, rows:new Map([...store.rows].map(([key, row]) => [key, clone(row)])) });
        }
        active = true; schedule();
      });
      return tx;
    },
  };
  return {
    get opens() { return opens; },
    open() {
      opens++;
      const result = {};
      setImmediate(() => {
        result.result = database;
        if (!initialized) { initialized = true; result.onupgradeneeded?.(); }
        result.onsuccess?.();
      });
      return result;
    },
    failNextWrite(message = 'QuotaExceededError') { nextFailure = Error(message); },
    seed(name, key, transform) {
      const store = stores.get(name), encoded = JSON.stringify(key);
      store.rows.set(encoded, transform(clone(store.rows.get(encoded))));
    },
  };
}

function harness(indexedDB = memoryIndexedDB(), config = { tenetMode:true, tenetAssignmentPreview:true }) {
  const window = { indexedDB, PENECHO_CONFIG:config, crypto:webcrypto, atob, btoa };
  vm.runInNewContext(source, { window, Blob, TextEncoder, Uint8Array, performance }, { filename:'tenet-process-journal.js' });
  return { api:window.TenetProcessJournal, indexedDB };
}
async function frozenFixture() {
  const h = harness(), attempt = await h.api.createAttempt({ title:'Synthetic algebra assignment' });
  const blob = new Blob(['synthetic drawing bytes'], { type:'application/octet-stream' });
  const first = await h.api.append(attempt.id, { type:'canvas.checkpoint', details:{ label:'baseline' }, assets:[{ name:'drawing.pkdrawing', blob }] });
  const second = await h.api.append(attempt.id, { type:'ai.request', details:{ question:'What should I consider next?' } });
  await h.api.pauseAttempt(attempt.id);
  await h.api.freezeAttempt(attempt.id);
  const archive = await h.api.exportAttempt(attempt.id);
  return { ...h, attempt, first, second, blob, archive, bundle:JSON.parse(await archive.text()) };
}
const options = { timeout:4000 };

test('journal installs no API outside explicit Tenet mode', options, () => {
  for (const config of [{}, { tenetMode:false, tenetAssignmentPreview:true }, { tenetMode:'true', tenetAssignmentPreview:true }]) {
    const h = harness(memoryIndexedDB(), config);
    assert.equal(h.api, undefined); assert.equal(h.indexedDB.opens, 0);
  }
});

test('ordinary Tenet mode exposes only the frozen archive reader with every storage capability default-off', options, () => {
  for (const config of [{ tenetMode:true }, { tenetMode:true, tenetAssignmentPreview:false },
    { tenetMode:true, tenetAssignmentPreview:'true' }, { tenetMode:true, tenetAssignmentPreview:1 }]) {
    const h = harness(memoryIndexedDB(), config);
    assert.deepEqual(Object.keys(h.api), ['readArchive']);
    assert.equal(Object.isFrozen(h.api), true);
    for (const name of ['createAttempt', 'append', 'readAttempt', 'listAttempts', 'listEvents', 'getAsset',
      'pauseAttempt', 'resumeAttempt', 'markIncomplete', 'recoverAttempt', 'freezeAttempt', 'deleteAttempt', 'exportAttempt'])
      assert.equal(h.api[name], undefined, name + ' must remain inaccessible outside capture preview');
    assert.equal(h.indexedDB.opens, 0);
  }
});

test('default-off archive playback validates hashes and serves only archive-local assets without opening IndexedDB', options, async () => {
  const fixture = await frozenFixture(), reader = harness(memoryIndexedDB(), { tenetMode:true });
  const archive = await reader.api.readArchive(fixture.archive);
  assert.equal(archive.attempt.id, fixture.attempt.id);
  assert.equal(archive.events[1].hash, fixture.second.hash);
  assert.equal(await (await archive.getAsset(fixture.attempt.id, fixture.first.assets[0].hash)).text(), await fixture.blob.text());
  await assert.rejects(archive.getAsset(fixture.attempt.id, '0'.repeat(64)), /Missing archive attachment/);
  const tampered = clone(fixture.bundle);
  tampered.events[0].details.label = 'tampered';
  await assert.rejects(reader.api.readArchive(archiveBlob(tampered)), /checksum/);
  assert.equal(reader.indexedDB.opens, 0);
  assert.deepEqual(Object.keys(reader.api), ['readArchive']);
});

test('archive-only Tenet runtime works with no IndexedDB implementation and retains the import detail cap', options, async () => {
  const fixture = await frozenFixture(), reader = harness(null, { tenetMode:true, tenetAssignmentPreview:false });
  const archive = await reader.api.readArchive(fixture.archive);
  assert.equal(archive.events.length, 2);
  const bundle = clone(fixture.bundle);
  bundle.events[1].details = { text:'x'.repeat(12 * 1024) };
  const { hash:_oldHash, ...unsigned } = bundle.events[1];
  bundle.events[1].hash = digest(canonical(unsigned));
  bundle.attempt.lastHash = bundle.events[1].hash;
  bundle.attempt.receipt.lastEventHash = bundle.events[1].hash;
  await assert.rejects(reader.api.readArchive(archiveBlob(bundle)), /details.*large/);
  await assert.rejects(reader.api.readArchive(archiveBlob({})), /Unsupported/);
});

test('attempts are unconfigured local observations, never local assignment-policy authority', options, async () => {
  const { api } = harness();
  await assert.rejects(api.createAttempt({}), /title/);
  const attempt = await api.createAttempt({ title:'Synthetic assignment', phase:'assessment-no-ai' });
  assert.equal(attempt.phase, 'unconfigured'); assert.equal(attempt.status, 'recording');
  assert.equal(attempt.verification, 'unverified-client-record'); assert.equal(attempt.coverage, 'local-checkpoints');
  assert.equal(Object.hasOwn(attempt, 'writer'), false);
});

test('append assigns sequence, links SHA-256 event hashes and deduplicates native attachments', options, async () => {
  const { api } = harness(), attempt = await api.createAttempt({ title:'Synthetic assignment' });
  const blob = new Blob(['native bytes'], { type:'application/octet-stream' });
  const first = await api.append(attempt.id, { type:'native.revision', details:{ strokeCount:2 }, assets:[{ name:'drawing.pkdrawing', blob }] });
  const before = await api.readAttempt(attempt.id);
  const second = await api.append(attempt.id, { type:'canvas.checkpoint', assets:[{ name:'same-drawing.pkdrawing', blob }] });
  const after = await api.readAttempt(attempt.id);
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2); assert.equal(second.previousEventHash, first.hash);
  for (const event of [first, second]) {
    const { hash, ...unsigned } = event;
    assert.equal(hash, digest(canonical(unsigned)));
  }
  assert.equal(first.assets[0].hash, digest(Buffer.from(await blob.arrayBuffer())));
  assert.equal(after.bytes - before.bytes, Buffer.byteLength(JSON.stringify(second)), 'Repeated blob bytes must not consume quota twice');
  assert.equal(await (await api.getAsset(attempt.id, first.assets[0].hash)).text(), 'native bytes');
});

test('frozen export/readArchive roundtrip verifies bytes and hashes without importing into local storage', options, async () => {
  const h = await frozenFixture(), archive = await h.api.readArchive(h.archive);
  assert.equal(archive.attempt.id, h.attempt.id); assert.equal(archive.events.length, 2);
  assert.equal(archive.events[1].hash, h.second.hash);
  assert.equal(await (await archive.getAsset(h.attempt.id, h.first.assets[0].hash)).text(), await h.blob.text());
  assert.equal((await h.api.listAttempts()).length, 1);
  assert.equal(archive.attempt.receipt.receivedBySchoology, false);
  assert.equal(archive.attempt.receipt.kind, 'local-only');
});

test('archive reader rejects changed assets, event bodies, ordering, missing assets and mismatched head hashes', options, async () => {
  const h = await frozenFixture();
  for (const mutate of [
    bundle => { bundle.assets[0].base64 = Buffer.from('x'.repeat(bundle.assets[0].size)).toString('base64'); },
    bundle => { bundle.events[0].details.label = 'tampered'; },
    bundle => { bundle.events.reverse(); },
    bundle => { bundle.assets = []; },
    bundle => { bundle.attempt.lastHash = '0'.repeat(64); },
    bundle => { bundle.events.pop(); },
  ]) {
    const bundle = clone(h.bundle); mutate(bundle);
    await assert.rejects(h.api.readArchive(archiveBlob(bundle)), /checksum|order|attachment|sequence/);
  }
});

test('freeze requires paused state and rejects later writes or recovery of the frozen revision', options, async () => {
  const { api } = harness(), attempt = await api.createAttempt({ title:'Synthetic assignment' });
  await assert.rejects(api.freezeAttempt(attempt.id), /Pause/);
  await assert.rejects(api.exportAttempt(attempt.id), /Freeze/);
  await api.pauseAttempt(attempt.id);
  await assert.rejects(api.append(attempt.id, { type:'canvas.commit' }), /not recording/);
  const frozen = await api.freezeAttempt(attempt.id);
  assert.equal(frozen.status, 'frozen');
  await assert.rejects(api.resumeAttempt(attempt.id), /paused/);
  await assert.rejects(api.markIncomplete(attempt.id, 'late'), /frozen/);
  await assert.rejects(api.recoverAttempt(attempt.id), /recording/);
});

test('another runtime cannot append or silently resume; explicit recovery invalidates the prior writer', options, async () => {
  const first = harness(), attempt = await first.api.createAttempt({ title:'Synthetic assignment' });
  await first.api.append(attempt.id, { type:'capture.started' });
  const second = harness(first.indexedDB);
  assert.equal((await second.api.readAttempt(attempt.id)).status, 'recording');
  await assert.rejects(second.api.append(attempt.id, { type:'canvas.commit' }), /Another operation/);
  await assert.rejects(second.api.pauseAttempt(attempt.id), /window recording/);
  await assert.rejects(second.api.resumeAttempt(attempt.id), /recovered/);
  const recovered = await second.api.recoverAttempt(attempt.id);
  assert.equal(recovered.status, 'paused'); assert.equal(recovered.incomplete, true);
  await second.api.resumeAttempt(attempt.id);
  await assert.rejects(first.api.append(attempt.id, { type:'canvas.commit' }), /Another operation/);
  const event = await second.api.append(attempt.id, { type:'capture.resumed' });
  assert.equal(event.sequence, 2);
});

test('failed atomic writes preserve prior sequence, asset storage and usage; coverage notes remain bounded', options, async () => {
  const { api, indexedDB } = harness(), attempt = await api.createAttempt({ title:'Synthetic assignment' });
  const blob = new Blob(['never committed'], { type:'text/plain' });
  indexedDB.failNextWrite();
  await assert.rejects(api.append(attempt.id, { type:'canvas.checkpoint', assets:[{ name:'draft.txt', blob }] }), /QuotaExceeded/);
  const stored = await api.readAttempt(attempt.id);
  assert.equal(stored.eventCount, 0); assert.equal(stored.bytes, 0); assert.equal(stored.lastHash, null);
  assert.equal((await api.listEvents(attempt.id)).length, 0);
  await assert.rejects(api.getAsset(attempt.id, digest('never committed')), /missing/);
  for (let index = 0; index < 23; index++) await api.markIncomplete(attempt.id, 'coverage-' + index + '-'.repeat(300));
  const marked = await api.readAttempt(attempt.id);
  assert.equal(marked.incomplete, true); assert.equal(marked.coverageNotes.length, 20);
  assert.ok(marked.coverageNotes.every(note => note.length <= 240));
});

test('event, per-attempt and profile ceilings reject atomically without allocating full-size fixtures', options, async () => {
  for (const cap of ['events', 'attempt', 'profile']) {
    const { api, indexedDB } = harness(), attempt = await api.createAttempt({ title:'Synthetic assignment' });
    if (cap === 'events') indexedDB.seed('attempts', attempt.id, row => ({ ...row, eventCount:5000 }));
    if (cap === 'attempt') indexedDB.seed('attempts', attempt.id, row => ({ ...row, bytes:64 * 1024 * 1024 }));
    if (cap === 'profile') indexedDB.seed('meta', 'usage', () => ({ id:'usage', bytes:256 * 1024 * 1024 }));
    const before = await api.readAttempt(attempt.id);
    await assert.rejects(api.append(attempt.id, { type:'canvas.commit' }), /history is full/);
    const after = await api.readAttempt(attempt.id);
    assert.equal(after.eventCount, before.eventCount); assert.equal(after.bytes, before.bytes);
    assert.equal((await api.listEvents(attempt.id)).length, 0);
  }
});

test('append enforces details bytes, attachment count/type/size and event-name bounds before writing', options, async () => {
  const { api } = harness(), attempt = await api.createAttempt({ title:'Synthetic assignment' });
  const large = new Blob(['small size-guard fixture'], { type:'text/plain' });
  Object.defineProperty(large, 'size', { value:32 * 1024 * 1024 + 1 });
  for (const input of [
    { type:'canvas.commit', details:{ text:'\0'.repeat(3000) } },
    { type:'canvas.commit', assets:Array.from({ length:9 }, () => ({ name:'x', blob:new Blob(['x'], { type:'text/plain' }) })) },
    { type:'canvas.commit', assets:[{ name:'x', blob:new Blob(['x'], { type:'image/svg+xml' }) }] },
    { type:'canvas.commit', assets:[{ name:'x', blob:large }] },
    { type:'UpperCase' }, { type:'a'.repeat(65) },
  ]) await assert.rejects(api.append(attempt.id, input), /large|many|Unsupported|exceeds/);
  assert.equal((await api.readAttempt(attempt.id)).eventCount, 0);
});

test('attachment lookup is attempt-scoped even when its SHA-256 is known', options, async () => {
  const { api } = harness(), first = await api.createAttempt({ title:'First synthetic assignment' }), second = await api.createAttempt({ title:'Second synthetic assignment' });
  const event = await api.append(first.id, { type:'canvas.checkpoint', assets:[{ name:'x.txt', blob:new Blob(['scoped'], { type:'text/plain' }) }] });
  await assert.rejects(api.getAsset(second.id, event.assets[0].hash), /missing/);
});

test('archive import rejects oversized event details even when an untrusted author recomputes valid hashes', options, async () => {
  const h = await frozenFixture(), bundle = clone(h.bundle);
  bundle.events[1].details = { text:'x'.repeat(12 * 1024) };
  const { hash:_oldHash, ...unsigned } = bundle.events[1];
  bundle.events[1].hash = digest(canonical(unsigned));
  bundle.attempt.lastHash = bundle.events[1].hash;
  bundle.attempt.receipt.lastEventHash = bundle.events[1].hash;
  await assert.rejects(h.api.readArchive(archiveBlob(bundle)), /details|large|size|limit/);
});
