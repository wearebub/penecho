// Durable local assignment history. No server authorization or network transport.
(function installTenetProcessJournal(global) {
  "use strict";
  if (global.PENECHO_CONFIG?.tenetMode !== true) return;
  const captureEnabled = global.PENECHO_CONFIG?.tenetAssignmentPreview === true;
  const VERSION = 1;
  const MAX_EVENTS = 5000, MAX_ATTEMPT = 64 * 1024 * 1024;
  const MAX_PROFILE = 256 * 1024 * 1024, MAX_APPEND = 32 * 1024 * 1024;
  const MAX_ARCHIVE = 92 * 1024 * 1024;
  const TYPES = new Set(["image/png", "image/jpeg", "application/json", "application/octet-stream", "text/plain"]);
  const encoder = new TextEncoder();
  const writer = captureEnabled ? global.crypto.randomUUID() : null;
  let database;

  function request(value) {
    return new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(value.error || Error("Local history storage failed."));
    });
  }
  function completion(tx) {
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || Error("Local history transaction was not saved."));
    });
    // Transactions may abort before the caller finishes its read requests.
    void done.catch(() => {});
    return done;
  }
  function db() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const open = global.indexedDB.open("tenet-assignment-process", VERSION);
      open.onupgradeneeded = () => {
        const value = open.result;
        value.createObjectStore("attempts", { keyPath: "id" });
        const events = value.createObjectStore("events", { keyPath: ["attemptId", "sequence"] });
        events.createIndex("attemptId", "attemptId");
        const assets = value.createObjectStore("assets", { keyPath: ["attemptId", "hash"] });
        assets.createIndex("attemptId", "attemptId");
        value.createObjectStore("meta", { keyPath: "id" });
      };
      open.onsuccess = () => {
        const value = open.result;
        value.onversionchange = () => { value.close(); database = null; };
        resolve(value);
      };
      open.onerror = () => { database = null; reject(open.error || Error("Local history is unavailable.")); };
      open.onblocked = () => { database = null; reject(Error("Close another Tenet window to open history storage.")); };
    });
    return database;
  }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  async function hash(value) {
    const bytes = value instanceof Blob ? await value.arrayBuffer() : encoder.encode(value);
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function text(value, maximum, fallback = "") {
    return typeof value === "string" ? value.trim().slice(0, maximum) : fallback;
  }
  function publicAttempt(value) {
    if (!value) return null;
    const { writer: _writer, ...safe } = value;
    return safe;
  }
  async function readAttempt(id) {
    const value = await db(), tx = value.transaction("attempts", "readonly");
    return publicAttempt(await request(tx.objectStore("attempts").get(id)));
  }
  async function listAttempts() {
    const value = await db(), tx = value.transaction("attempts", "readonly");
    const rows = await request(tx.objectStore("attempts").getAll());
    return rows.map(publicAttempt).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function listEvents(id) {
    const value = await db(), tx = value.transaction("events", "readonly");
    return request(tx.objectStore("events").index("attemptId").getAll(id));
  }
  async function getAsset(id, digest) {
    const value = await db(), tx = value.transaction("assets", "readonly");
    const asset = await request(tx.objectStore("assets").get([id, digest]));
    if (!asset) throw Error("A recorded history attachment is missing.");
    return asset.blob;
  }
  async function createAttempt(metadata = {}) {
    const title = text(metadata.title, 80);
    if (!title) throw Error("Give this assignment a title first.");
    const value = await db(), tx = value.transaction(["attempts", "meta"], "readwrite"), done = completion(tx);
    const store = tx.objectStore("attempts");
    const count = await request(store.count());
    if (count >= 100) { tx.abort(); throw Error("This local preview holds up to 100 assignment histories. Export and remove an old history first."); }
    const now = Date.now();
    const attempt = { id: global.crypto.randomUUID(), title, subject: text(metadata.subject, 80), phase: "unconfigured",
      schemaVersion: VERSION, status: "recording", writer, eventCount: 0, bytes: 0,
      createdAt: now, updatedAt: now, lastHash: null, coverage: "local-checkpoints",
      verification: "unverified-client-record", incomplete: false, coverageNotes: [] };
    store.add(attempt);
    await done;
    return publicAttempt(attempt);
  }
  async function append(id, input) {
    if (!input || typeof input.type !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(input.type)) throw Error("Unsupported history event type.");
    const json = JSON.stringify(input.details || {});
    if (!json || encoder.encode(json).byteLength > 12 * 1024) throw Error("History event details are too large.");
    const details = JSON.parse(json), sources = input.assets || [];
    if (!Array.isArray(sources) || sources.length > 8) throw Error("Too many history attachments.");
    let total = 0;
    for (const source of sources) {
      if (!(source.blob instanceof Blob) || !TYPES.has(source.blob.type || "application/octet-stream")) throw Error("Unsupported history attachment.");
      total += source.blob.size;
    }
    if (total > MAX_APPEND) throw Error("This history checkpoint exceeds the local size limit. The canvas has not been deleted.");
    const prepared = [];
    for (const source of sources) prepared.push({ name: text(source.name, 80, "attachment"), hash: await hash(source.blob),
      mime: source.blob.type || "application/octet-stream", size: source.blob.size, blob: source.blob });
    const previous = await readAttempt(id);
    if (!previous || previous.status !== "recording") throw Error("This history is not recording.");
    const event = { schemaVersion: VERSION, eventId: global.crypto.randomUUID(), attemptId: id,
      sequence: previous.eventCount + 1, clientWallTime: Date.now(), monotonicMs: Math.round(performance.now()),
      deviceSessionId: writer, type: input.type, details,
      previousEventHash: previous.lastHash,
      assets: prepared.map(({ blob: _blob, ...descriptor }) => descriptor) };
    event.hash = await hash(canonical(event));
    const eventBytes = encoder.encode(JSON.stringify(event)).byteLength;
    const value = await db(), tx = value.transaction(["attempts", "events", "assets", "meta"], "readwrite"), done = completion(tx);
    const attempts = tx.objectStore("attempts"), assets = tx.objectStore("assets"), meta = tx.objectStore("meta");
    const [current, usage, existing] = await Promise.all([
      request(attempts.get(id)), request(meta.get("usage")),
      Promise.all(prepared.map(asset => request(assets.get([id, asset.hash]))))
    ]);
    if (!current || current.status !== "recording" || current.writer !== writer || current.lastHash !== previous.lastHash || current.eventCount !== previous.eventCount) {
      tx.abort(); throw Error("Another operation changed this history. Capture has stopped to avoid losing event order.");
    }
    const added = new Map();
    prepared.forEach((asset, index) => { if (!existing[index]) added.set(asset.hash, asset); });
    const bytes = eventBytes + Array.from(added.values()).reduce((sum, asset) => sum + asset.size, 0);
    if (current.eventCount >= MAX_EVENTS || current.bytes + bytes > MAX_ATTEMPT || (usage?.bytes || 0) + bytes > MAX_PROFILE) {
      tx.abort(); throw Error("Local history is full. Recording stopped; existing work is retained. Export this history before continuing elsewhere.");
    }
    for (const asset of added.values()) assets.add({ attemptId: id, hash: asset.hash, mime: asset.mime, size: asset.size, blob: asset.blob });
    tx.objectStore("events").add(event);
    current.eventCount = event.sequence; current.lastHash = event.hash; current.updatedAt = event.clientWallTime; current.bytes += bytes;
    attempts.put(current);
    meta.put({ id: "usage", bytes: (usage?.bytes || 0) + bytes });
    await done;
    return event;
  }
  async function updateAttempt(id, transform) {
    const value = await db(), tx = value.transaction("attempts", "readwrite"), done = completion(tx);
    const store = tx.objectStore("attempts"), current = await request(store.get(id));
    if (!current) { tx.abort(); throw Error("This local assignment could not be found."); }
    try { transform(current); } catch (error) { tx.abort(); throw error; }
    current.updatedAt = Date.now(); store.put(current); await done; return publicAttempt(current);
  }
  function pauseAttempt(id) {
    return updateAttempt(id, current => {
      if (current.status === "frozen") throw Error("A frozen history cannot be changed.");
      if (current.status === "recording" && current.writer !== writer) throw Error("Pause capture in the window recording this assignment first.");
      current.status = "paused";
    });
  }
  function resumeAttempt(id) {
    return updateAttempt(id, current => {
      if (current.status !== "paused") throw Error("Only a paused history can resume. A recording left by another window must first be recovered.");
      current.status = "recording"; current.writer = writer;
    });
  }
  function markIncomplete(id, reason) {
    return updateAttempt(id, current => {
      if (current.status === "frozen") throw Error("A frozen history cannot be changed.");
      current.incomplete = true;
      current.coverageNotes = [...current.coverageNotes, text(reason, 240, "Capture was interrupted.")].slice(-20);
    });
  }
  function recoverAttempt(id) {
    return updateAttempt(id, current => {
      if (current.status !== "recording") throw Error("Only an interrupted recording requires recovery.");
      // Explicit takeover invalidates the other window's writer on its next append.
      current.writer = writer; current.status = "paused"; current.incomplete = true;
      current.coverageNotes = [...current.coverageNotes, "Recording recovered after interruption or explicit window takeover; continuity is not guaranteed."].slice(-20);
    });
  }
  function freezeAttempt(id) {
    return updateAttempt(id, current => {
      if (current.status === "frozen") return;
      if (current.status !== "paused") throw Error("Pause and finish saving this history before freezing it.");
      current.status = "frozen"; current.frozenAt = Date.now();
      current.receipt = { kind: "local-only", eventCount: current.eventCount, lastEventHash: current.lastHash, receivedBySchoology: false };
    });
  }
  async function deleteAttempt(id) {
    const value = await db(), tx = value.transaction(["attempts", "events", "assets", "meta"], "readwrite"), done = completion(tx);
    const attempts = tx.objectStore("attempts"), events = tx.objectStore("events"), assets = tx.objectStore("assets"), meta = tx.objectStore("meta");
    const [current, usage, eventKeys, assetKeys] = await Promise.all([request(attempts.get(id)), request(meta.get("usage")),
      request(events.index("attemptId").getAllKeys(id)), request(assets.index("attemptId").getAllKeys(id))]);
    if (!current || current.status === "recording") { tx.abort(); throw Error("Pause the history before removing it."); }
    for (const key of eventKeys) events.delete(key);
    for (const key of assetKeys) assets.delete(key);
    attempts.delete(id); meta.put({ id: "usage", bytes: Math.max(0, (usage?.bytes || 0) - current.bytes) });
    await done;
  }
  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return global.btoa(binary);
  }
  async function exportAttempt(id) {
    const attempt = await readAttempt(id);
    if (!attempt || attempt.status !== "frozen") throw Error("Freeze this local revision before exporting it.");
    const events = await listEvents(id), value = await db(), tx = value.transaction("assets", "readonly");
    const rows = await request(tx.objectStore("assets").index("attemptId").getAll(id));
    const assets = [];
    for (const row of rows) assets.push({ hash: row.hash, mime: row.mime, size: row.size, base64: await base64(row.blob) });
    const blob = new Blob([JSON.stringify({ format: "tenet-work", schemaVersion: VERSION, exportedAt: Date.now(),
      warning: "Local checkpoint history, not a district-verified report or proof of independent work.", attempt, events, assets })], { type: "application/json" });
    if (blob.size > MAX_ARCHIVE) throw Error("This archive is too large for the local preview export.");
    return blob;
  }
  async function readArchive(file) {
    if (!(file instanceof Blob) || file.size > MAX_ARCHIVE) throw Error("Choose a Tenet work archive smaller than 92 MiB.");
    const bundle = JSON.parse(await file.text());
    if (bundle?.format !== "tenet-work" || bundle.schemaVersion !== VERSION || bundle.attempt?.status !== "frozen" ||
        !Array.isArray(bundle.events) || bundle.events.length > MAX_EVENTS || !Array.isArray(bundle.assets) || bundle.assets.length > MAX_EVENTS * 8) {
      throw Error("Unsupported or incomplete Tenet work archive.");
    }
    const decoded = new Map(); let size = 0;
    for (const asset of bundle.assets) {
      if (typeof asset.hash !== "string" || !/^[a-f0-9]{64}$/.test(asset.hash) || !TYPES.has(asset.mime) || typeof asset.base64 !== "string" ||
          !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_APPEND || decoded.has(asset.hash)) throw Error("Invalid history attachment.");
      size += asset.size;
      if (size > MAX_ATTEMPT || asset.base64.length > Math.ceil(asset.size / 3) * 4 + 4) throw Error("History attachments exceed the allowed size.");
      const binary = global.atob(asset.base64), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      if (bytes.length !== asset.size) throw Error("History attachment size does not match.");
      const blob = new Blob([bytes], { type: asset.mime });
      if (await hash(blob) !== asset.hash) throw Error("History attachment checksum does not match.");
      decoded.set(asset.hash, blob);
    }
    let previous = null, sequence = 0;
    for (const event of bundle.events) {
      if (event?.schemaVersion !== VERSION || event.sequence !== ++sequence || event.attemptId !== bundle.attempt.id || event.previousEventHash !== previous ||
          typeof event.type !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(event.type) || !Array.isArray(event.assets) || event.assets.length > 8) throw Error("History event order is invalid.");
      // Archives are untrusted even when their author recomputes valid hashes.
      // Apply the same UTF-8 details ceiling as append(), without changing v1.
      const detailsJson = JSON.stringify(event.details || {});
      if (!detailsJson || encoder.encode(detailsJson).byteLength > 12 * 1024) throw Error("History event details are too large.");
      const { hash: digest, ...unsigned } = event;
      if (await hash(canonical(unsigned)) !== digest) throw Error("History event checksum does not match.");
      for (const asset of event.assets) {
        const blob = decoded.get(asset.hash);
        if (!blob || blob.size !== asset.size || blob.type !== asset.mime) throw Error("An event references a missing or invalid attachment.");
      }
      previous = digest;
    }
    if (bundle.attempt.eventCount !== sequence || bundle.attempt.lastHash !== previous) throw Error("The frozen history does not match its event sequence.");
    // This verifies internal consistency, not student identity or authenticity.
    return { attempt: publicAttempt(bundle.attempt), events: bundle.events,
      getAsset: async (_id, digest) => { if (!decoded.has(digest)) throw Error("Missing archive attachment."); return decoded.get(digest); } };
  }
  // The ordinary Tenet demo can inspect a user-selected archive without opting
  // into capture. This reader returns only archive-local assets, never IndexedDB
  // access. Keep every storage/list/mutation capability behind the preview flag.
  global.TenetProcessJournal = Object.freeze(captureEnabled
    ? { createAttempt, append, readAttempt, listAttempts, listEvents, getAsset,
      pauseAttempt, resumeAttempt, markIncomplete, recoverAttempt, freezeAttempt, deleteAttempt, exportAttempt, readArchive }
    : { readArchive });
})(window);
