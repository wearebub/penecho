// Standalone, browser-only portable saved work. No database, fetch, execution
// of drawing/widget contents, automatic save, provider calls, or new authority.
// v1: 48-byte header (8-byte magic, uint32 version, uint32 expanded bytes,
// SHA-256 of expanded JSON), then gzip UTF-8 JSON. Integers are big-endian.
// Blob bytes are deduplicated by SHA-256; explicit paths restore null slots.
(() => {
  "use strict";
  const VERSION = 1, HEADER = 48, MIME = "application/vnd.tenet.whiteboard";
  const MiB = 1024 * 1024;
  const MAX_FILE = 64 * MiB, MAX_EXPANDED = 96 * MiB, MAX_ASSET_BYTES = 64 * MiB;
  const MAX_ASSET = 16 * MiB, MAX_PREVIEW = 8 * MiB, MAX_ASSETS = 10000, MAX_REFS = 20000;
  const MAX_EVENTS = 5000, MAX_DETAILS = 12 * 1024, MAX_NODES = 250000, MAX_DEPTH = 32;
  const encoder = new TextEncoder(), magic = encoder.encode("TENETWB\n");
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const hashPattern = /^[0-9a-f]{64}$/;
  const imageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const itemFields = new Set(["version", "id", "createdAt", "updatedAt", "name", "theme", "view", "tileCount",
    "animationCount", "animations", "widgetCount", "widgets", "textBoxCount", "textBoxes", "imageCount",
    "images", "preview", "manifestExtensions", "preservedAssets", "workHistory"]);
  let epoch = 0, signedOut = false, busy = false;
  window.addEventListener("tenet:sign-out", () => { signedOut = true; epoch++; });

  function need(condition, message) { if (!condition) throw Error(message); }
  function plain(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function safeKey(key) {
    return typeof key === "string" && key.length <= 256 && !["__proto__", "prototype", "constructor"].includes(key);
  }
  function mediaType(value) {
    return typeof value === "string" && value.length <= 128 &&
      (value === "" || /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value));
  }
  function sameKeys(value, allowed) { return plain(value) && Object.keys(value).every(key => allowed.has(key)); }
  const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
  function timestamp(value) {
    if (value === undefined || value === null) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  async function wait(promise, guard) {
    let timer;
    try {
      guard();
      const result = await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("Work package processing timed out.")), 60000);
      })]);
      guard();
      return result;
    } finally { clearTimeout(timer); }
  }
  async function operation(callback) {
    need(!busy, "Another work package is being processed. Please wait.");
    const startedEpoch = epoch, deadline = Date.now() + 60000;
    const assertAccount = () => need(!signedOut && epoch === startedEpoch, "Work sharing is unavailable after sign-out. Reopen the application.");
    const guard = () => { assertAccount(); need(Date.now() <= deadline, "Work package processing timed out."); };
    assertAccount();
    need(globalThis.crypto?.subtle, "This browser requires a secure connection to process work packages.");
    busy = true;
    try { return await callback(guard, assertAccount); }
    finally { busy = false; }
  }
  async function readStream(stream, maximum, guard) {
    const reader = stream.getReader(), chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await wait(reader.read(), guard);
        if (next.done) break;
        need(next.value instanceof Uint8Array, "Invalid work package byte stream.");
        bytes += next.value.byteLength;
        need(bytes <= maximum, "Work package exceeds its compressed or expanded size limit.");
        chunks.push(next.value);
      }
      guard();
      return new Blob(chunks);
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
  }
  function budget() { return { nodes:0, textBytes:0 }; }
  function inspect(value, depth, limits) {
    need(++limits.nodes <= MAX_NODES && depth <= MAX_DEPTH, "Work package data is too complex.");
    if (typeof value === "string") {
      need(value.length <= MAX_EXPANDED, "Work package text is too large.");
      limits.textBytes += encoder.encode(value).byteLength;
      need(limits.textBytes <= MAX_EXPANDED, "Work package text is too large.");
    } else if (typeof value === "number") need(Number.isFinite(value), "Invalid numeric work data.");
    else if (value !== null && typeof value !== "boolean") {
      need(Array.isArray(value) || plain(value), "Only plain drawing data can be shared.");
      need(Object.keys(value).length <= MAX_REFS, "Work package collection is too large.");
    }
  }
  // JSON.parse alone silently accepts duplicate keys. Check keys before it
  // discards evidence, including escaped spellings of the same key.
  function parseManifestJSON(text) {
    let at = 0, nodes = 0;
    const whitespace = () => { while (/[\x20\t\r\n]/.test(text[at] || "!")) at++; };
    function string(key = false) {
      const start = at++;
      while (at < text.length) {
        const char = text[at++];
        if (char === '"') return key ? JSON.parse(text.slice(start, at)) : null;
        if (char === "\\") at++;
      }
      throw Error("Unterminated JSON string.");
    }
    function value(depth) {
      need(depth <= 32 && ++nodes <= 250000, "Work package JSON structure exceeds limits.");
      whitespace();
      const first = text[at];
      if (first === '"') { string(); return; }
      if (first === "{" || first === "[") {
        const object = first === "{", end = object ? "}" : "]", keys = new Set();
        at++; whitespace();
        if (text[at] === end) { at++; return; }
        let count = 0;
        while (at < text.length) {
          need(++count <= 20000, "Work package JSON collection exceeds limits.");
          whitespace();
          if (object) {
            need(text[at] === '"', "Invalid JSON object key.");
            const key = string(true);
            need(safeKey(key) && !keys.has(key), "Unsafe or duplicate JSON field.");
            keys.add(key); whitespace();
            need(text[at++] === ":", "Invalid JSON field.");
          }
          value(depth + 1); whitespace();
          if (text[at] === end) { at++; return; }
          need(text[at++] === ",", "Invalid JSON separator.");
        }
        throw Error("Unterminated JSON collection.");
      }
      const start = at;
      while (at < text.length && !/[\x20\t\r\n,\]}]/.test(text[at])) at++;
      need(at > start, "Invalid JSON value.");
    }
    value(0); whitespace();
    need(at === text.length, "Unexpected JSON trailing content.");
    return JSON.parse(text);
  }
  function validatePlain(value, depth = 0, limits = budget()) {
    inspect(value, depth, limits);
    if (Array.isArray(value)) for (const child of value) validatePlain(child, depth + 1, limits);
    else if (plain(value)) for (const key of Object.keys(value)) {
      need(safeKey(key), "Unsafe work package field.");
      validatePlain(value[key], depth + 1, limits);
    }
  }
  function base64(buffer) {
    const data = new Uint8Array(buffer), parts = [];
    for (let index = 0; index < data.length; index += 32768)
      parts.push(String.fromCharCode(...data.subarray(index, index + 32768)));
    return btoa(parts.join(""));
  }
  function decodeBase64(text, size) {
    need(typeof text === "string" && text.length === Math.ceil(size / 3) * 4 && !/[^A-Za-z0-9+/=]/.test(text),
      "Invalid work package asset encoding.");
    let binary;
    try { binary = atob(text); } catch { throw Error("Invalid work package asset encoding."); }
    need(binary.length === size, "Work package asset length does not match.");
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  async function blobHash(blob, hashes, guard) {
    if (hashes.has(blob)) return hashes.get(blob);
    const buffer = await wait(blob.arrayBuffer(), guard);
    const hash = hex(await wait(crypto.subtle.digest("SHA-256", buffer), guard));
    hashes.set(blob, hash);
    return hash;
  }
  async function encodePage(page, guard, hashes) {
    const table = new Map(), refs = [], limits = budget();
    let total = 0;
    async function copy(value, path, depth) {
      guard();
      if (value instanceof Blob) {
        need(value.size <= MAX_ASSET && mediaType(value.type), "A drawing asset exceeds the 16 MiB portable limit or has invalid media metadata.");
        need(refs.length < MAX_REFS && depth <= MAX_DEPTH, "Too many work package asset references.");
        const hash = await blobHash(value, hashes, guard);
        if (!table.has(hash)) {
          total += value.size;
          need(table.size < MAX_ASSETS && total <= MAX_ASSET_BYTES, "Work assets exceed the portable package budget.");
          const buffer = await wait(value.arrayBuffer(), guard);
          table.set(hash, { hash, size:value.size, data:base64(buffer) });
        }
        refs.push({ path, hash, size:value.size, mime:value.type });
        return null;
      }
      if (value === undefined) return null;
      inspect(value, depth, limits);
      if (Array.isArray(value)) {
        const result = [];
        for (let index = 0; index < value.length; index++) result.push(await copy(value[index], path.concat(index), depth + 1));
        return result;
      }
      if (plain(value)) {
        const result = Object.create(null);
        for (const key of Object.keys(value)) {
          need(safeKey(key), "Unsafe saved drawing field.");
          if (value[key] !== undefined) result[key] = await copy(value[key], path.concat(key), depth + 1);
        }
        return result;
      }
      return value;
    }
    return { page:await copy(page, [], 0), blobRefs:refs, assets:Array.from(table.values()) };
  }
  function checkPage(page) {
    need(sameKeys(page, new Set(["item", "tileEntries"])) && sameKeys(page.item, itemFields), "Unsupported portable drawing fields.");
    const item = page.item;
    need(typeof item.id === "string" && item.id.length > 0 && item.id.length <= 256, "Invalid saved page identity.");
    need(item.name === undefined || (typeof item.name === "string" && item.name.length <= 512), "Invalid saved page title.");
    need(item.version === undefined || item.version === 1 || item.version === 2, "Unsupported saved drawing version.");
    if (item.manifestExtensions !== undefined)
      need(sameKeys(item.manifestExtensions, new Set(["tenetNativeInk"])), "Unsupported native drawing extension.");
    need(Array.isArray(page.tileEntries) && page.tileEntries.length <= MAX_ASSETS, "Invalid saved drawing tiles.");
    const keys = new Set();
    for (const tile of page.tileEntries) {
      need(sameKeys(tile, new Set(["k", "blob"])) && typeof tile.k === "string" && /^\d{1,6},\d{1,6}$/.test(tile.k) &&
        !keys.has(tile.k) && tile.blob instanceof Blob, "Invalid or duplicate saved drawing tile.");
      keys.add(tile.k);
    }
    need(item.preview instanceof Blob && item.preview.size > 0 && item.preview.size <= MAX_PREVIEW && imageTypes.has(item.preview.type),
      "This saved page does not have a supported final preview. Save it again before sharing.");
  }
  async function checkHistory(value, hashes, guard) {
    if (value === undefined || value === null) return { available:false, events:[], assets:new Map(), incomplete:false,
      incompleteReasons:[], droppedEvents:0 };
    need(plain(value) && value.version === 1 && Array.isArray(value.events) && value.events.length <= MAX_EVENTS &&
      Array.isArray(value.assets) && value.assets.length <= MAX_ASSETS, "Invalid saved work history.");
    const assets = new Map();
    let bytes = 0, sequence = 0;
    for (const asset of value.assets) {
      guard();
      need(plain(asset) && hashPattern.test(asset.hash) && !assets.has(asset.hash) && asset.blob instanceof Blob &&
        asset.size === asset.blob.size && asset.mime === asset.blob.type && asset.size <= MAX_ASSET,
      "Invalid saved history asset.");
      bytes += asset.size;
      need(bytes <= MAX_ASSET_BYTES, "Saved history exceeds its byte budget.");
      need(await blobHash(asset.blob, hashes, guard) === asset.hash, "Saved history asset hash does not match.");
      assets.set(asset.hash, { ...asset, refs:0 });
    }
    const events = [];
    for (const event of value.events) {
      guard();
      need(plain(event) && Number.isSafeInteger(event.sequence) && event.sequence > sequence &&
        typeof event.type === "string" && /^[a-z][a-z0-9.-]{0,63}$/.test(event.type) &&
        typeof event.timestamp === "string" && event.timestamp.length <= 64 && timestamp(event.timestamp) &&
        encoder.encode(JSON.stringify(event.details || {})).byteLength <= MAX_DETAILS &&
        Array.isArray(event.assets) && event.assets.length <= 2, "Invalid saved history event.");
      bytes += encoder.encode(JSON.stringify(event)).byteLength;
      need(bytes <= MAX_ASSET_BYTES, "Saved history exceeds its byte budget.");
      for (const reference of event.assets) {
        const asset = assets.get(reference?.hash);
        need(asset && asset.size === reference.size && asset.mime === reference.mime &&
          typeof reference.name === "string" && reference.name.length <= 64, "Missing or mismatched history asset reference.");
        asset.refs++;
      }
      events.push(JSON.parse(JSON.stringify(event))); sequence = event.sequence;
    }
    need(sequence < Number.MAX_SAFE_INTEGER - MAX_EVENTS, "Saved history sequence limit reached.");
    for (const asset of assets.values()) need(asset.refs > 0, "Unreferenced saved history asset.");
    return { available:events.length > 0, events, assets, incomplete:value.incomplete === true,
      incompleteReasons:Array.isArray(value.incompleteReasons) ? value.incompleteReasons.slice(0, 16).map(reason => String(reason).slice(0, 160)) : [],
      droppedEvents:Number.isSafeInteger(value.droppedEvents) && value.droppedEvents >= 0 ? value.droppedEvents : 0 };
  }
  async function finalPageFor(item, history, hashes, guard) {
    // Never call an arbitrary latest image the final state. A retained explicit
    // save checkpoint is usable only without later page/coverage events.
    for (let index = history.events.length - 1; index >= 0; index--) {
      const event = history.events[index];
      if (event.type.startsWith("ai.")) continue;
      if (event.type === "canvas.checkpoint" && event.details?.label === "saved-end-state" &&
          event.details.representation === "coalesced-rendered-page") {
        const reference = event.assets.find(asset => asset.name === "page.png" && imageTypes.has(asset.mime) && asset.size <= MAX_PREVIEW);
        if (reference) return { descriptor:{ asset:{ ...reference }, representation:"recorded-save-checkpoint",
          caption:"Full recorded save checkpoint", sourceEventSequence:event.sequence }, blob:history.assets.get(reference.hash).blob };
      }
      break;
    }
    const blob = item.preview, hash = await blobHash(blob, hashes, guard);
    return { descriptor:{ asset:{ name:"final-page." + blob.type.slice(6), hash, mime:blob.type, size:blob.size },
      representation:"saved-page-thumbnail", caption:"Saved page preview (thumbnail, not a recorded history moment)" }, blob };
  }
  function viewerBundle(item, history, final, submission, assertCurrent, workFile = null) {
    const readable = new Map(Array.from(history.assets, ([hash, asset]) => [hash, asset.blob]));
    const existing = readable.get(final.descriptor.asset.hash);
    need(!existing || existing.type === final.blob.type, "Ambiguous final preview media type.");
    readable.set(final.descriptor.asset.hash, final.blob);
    const title = item.name || "Untitled canvas", savedAt = timestamp(item.updatedAt ?? item.createdAt);
    return { title, savedAt, historyAvailable:history.available, events:history.events,
      attempt:{ id:item.id, title, phase:"unconfigured", status:"saved", createdAt:item.createdAt,
        updatedAt:item.updatedAt ?? item.createdAt, eventCount:history.events.length, incomplete:history.incomplete,
        incompleteReasons:history.incompleteReasons, droppedEvents:history.droppedEvents,
        evidence:"local-client-observation", serverVerified:false },
      finalPreview:final.blob, finalPage:final.descriptor, submission, assertCurrent,
      ...(workFile ? { getWorkFile() { assertCurrent(); return workFile; } } : {}),
      async getAsset(attemptId, hash) {
        assertCurrent();
        need(attemptId === item.id, "Work asset belongs to a different saved page.");
        const blob = readable.get(hash);
        need(blob, "Work history or final-preview attachment is unavailable.");
        assertCurrent();
        return blob;
      } };
  }
  function filename(title) {
    const name = String(title || "Saved work").normalize("NFKC").replace(/[\x00-\x1f<>:"/\\|?*]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "") || "Saved work";
    return "Tenet - " + name + ".tenet";
  }
  // Local report preparation does not build/compress an archive or force a save.
  async function prepareSavedPage(id, options = {}) {
    // A PDF and its attachment must come from one read, not two independently
    // selected saves. Keep the inexpensive preview-only API for other callers.
    if (options.includeWorkFile === true) return (await exportSavedPage(id)).bundle;
    return operation(async (guard, assertAccount) => {
      need(typeof window.TenetDocumentHistory?.readSubmissionSource === "function", "Saved notebook access is unavailable.");
      const saved = await wait(window.TenetDocumentHistory.readSubmissionSource(id), guard);
      const check = () => { guard(); saved.assertCurrent(); };
      const lease = () => { assertAccount(); saved.assertCurrent(); };
      check();
      const page = { item:saved.item, tileEntries:saved.tileEntries }, hashes = new WeakMap();
      checkPage(page);
      const history = await checkHistory(page.item.workHistory, hashes, check);
      const final = await finalPageFor(page.item, history, hashes, check);
      check();
      return viewerBundle(page.item, history, final, {
        version:VERSION, localOnly:true, integrity:"sha256-not-authorship", source:"local-saved-page"
      }, lease);
    });
  }
  async function exportSavedPage(id) {
    return operation(async (guard, assertAccount) => {
      need(typeof CompressionStream === "function", "This browser cannot compress work packages. Use a current supported browser.");
      need(typeof window.TenetDocumentHistory?.readSubmissionSource === "function", "Open a saved local whiteboard before sharing work.");
      const source = await wait(window.TenetDocumentHistory.readSubmissionSource(id), guard);
      const check = () => { guard(); source.assertCurrent(); };
      const lease = () => { assertAccount(); source.assertCurrent(); };
      check();
      const page = { item:source.item, tileEntries:source.tileEntries }, hashes = new WeakMap();
      checkPage(page);
      const encoded = await encodePage(page, check, hashes);
      const history = await checkHistory(page.item.workHistory, hashes, check);
      const final = await finalPageFor(page.item, history, hashes, check);
      const manifest = { format:"tenet-saved-work", version:VERSION, exportedAt:new Date().toISOString(),
        ...encoded, finalPage:final.descriptor };
      validatePlain(manifest);
      const text = JSON.stringify(manifest);
      need(text.length <= MAX_EXPANDED, "Work package exceeds the expanded JSON limit.");
      const expanded = new Blob([text], { type:"application/json" });
      need(expanded.size <= MAX_EXPANDED, "Work package exceeds the expanded UTF-8 limit.");
      const digest = await wait(crypto.subtle.digest("SHA-256", await wait(expanded.arrayBuffer(), check)), check);
      const compressed = await readStream(expanded.stream().pipeThrough(new CompressionStream("gzip")), MAX_FILE - HEADER, check);
      const header = new Uint8Array(HEADER), view = new DataView(header.buffer);
      header.set(magic); view.setUint32(8, VERSION); view.setUint32(12, expanded.size); header.set(new Uint8Array(digest), 16);
      const blob = new Blob([header, compressed], { type:MIME });
      need(blob.size <= MAX_FILE, "Work package exceeds the 64 MiB sharing limit. No history was removed.");
      check();
      const submission = { version:VERSION, exportedAt:manifest.exportedAt, assetCount:encoded.assets.length,
        compressedBytes:blob.size, expandedBytes:expanded.size, integrity:"sha256-not-authorship", localOnly:true };
      return { blob, filename:filename(page.item.name), bytes:blob.size, assetCount:encoded.assets.length,
        historyAvailable:history.available, incomplete:history.incomplete,
        bundle:viewerBundle(page.item, history, final, submission, lease, blob) };
    });
  }
  async function decodeAssets(manifest, guard, hashes) {
    need(Array.isArray(manifest.assets) && manifest.assets.length <= MAX_ASSETS &&
      Array.isArray(manifest.blobRefs) && manifest.blobRefs.length <= MAX_REFS, "Too many portable work assets.");
    const table = new Map();
    let total = 0;
    for (const asset of manifest.assets) {
      guard();
      need(sameKeys(asset, new Set(["hash", "size", "data"])) && typeof asset.hash === "string" && hashPattern.test(asset.hash) &&
        !table.has(asset.hash) && Number.isSafeInteger(asset.size) && asset.size >= 0 && asset.size <= MAX_ASSET,
      "Invalid or duplicate work package asset.");
      total += asset.size;
      need(total <= MAX_ASSET_BYTES, "Expanded work assets exceed the 64 MiB limit.");
      const bytes = decodeBase64(asset.data, asset.size);
      need(hex(await wait(crypto.subtle.digest("SHA-256", bytes), guard)) === asset.hash, "Work package asset hash does not match.");
      table.set(asset.hash, { blob:new Blob([bytes]), size:asset.size, used:false, typed:new Map() });
    }
    const paths = new Set();
    for (const reference of manifest.blobRefs) {
      guard();
      need(sameKeys(reference, new Set(["path", "hash", "size", "mime"])) && Array.isArray(reference.path) &&
        reference.path.length > 0 && reference.path.length <= MAX_DEPTH && mediaType(reference.mime), "Invalid work asset path.");
      const asset = table.get(reference.hash), key = JSON.stringify(reference.path);
      need(asset && asset.size === reference.size && !paths.has(key), "Duplicate or missing work asset reference.");
      paths.add(key);
      let parent = manifest.page;
      for (let index = 0; index < reference.path.length; index++) {
        const part = reference.path[index];
        need((Array.isArray(parent) && Number.isSafeInteger(part) && part >= 0 && part < parent.length) ||
          (plain(parent) && safeKey(part) && own(parent, part)), "Invalid work asset location.");
        if (index === reference.path.length - 1) {
          need(parent[part] === null, "Work asset would overwrite other drawing data.");
          let blob = asset.typed.get(reference.mime);
          if (!blob) { blob = asset.blob.slice(0, asset.size, reference.mime); asset.typed.set(reference.mime, blob); hashes.set(blob, reference.hash); }
          parent[part] = blob; asset.used = true;
        } else parent = parent[part];
      }
    }
    for (const asset of table.values()) need(asset.used, "Unreferenced work package asset.");
    return table;
  }
  // Read only our bounded, single-revision PDF envelope. Follow its xref and
  // EmbeddedFiles name tree, never search arbitrary image/attachment bytes for
  // magic or execute/render PDF actions. Rewritten/printed PDFs fail explicitly.
  async function workFileFromPdf(file, guard) {
    const message = "This PDF has no supported embedded Tenet work file, or was changed after export. Download the original Tenet PDF or open the separate .tenet file.";
    need(file.size <= 24 * MiB, "Choose a Tenet PDF no larger than 24 MiB, or open the separate .tenet file.");
    const readText = async (start, end) => new TextDecoder().decode(await wait(file.slice(start, end).arrayBuffer(), guard));
    const tail = await readText(Math.max(0, file.size - 256), file.size);
    const pointer = /startxref\n(\d+)\n%%EOF\n?$/.exec(tail);
    need(pointer, message);
    const xref = Number(pointer[1]);
    need(Number.isSafeInteger(xref) && xref > 8 && xref < file.size && file.size - xref <= 16384, message);
    const table = await readText(xref, file.size);
    const match = /^xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)trailer\n<< \/Size (\d+) \/Root 1 0 R >>\nstartxref\n(\d+)\n%%EOF\n?$/.exec(table);
    need(match, message);
    const count = Number(match[1]), rows = match[2].trimEnd().split("\n");
    need(count >= 9 && count <= 512 && Number(match[3]) === count && Number(match[4]) === xref && rows.length === count - 1, message);
    const offsets = [0, ...rows.map(row => Number(row.slice(0, 10))), xref];
    for (let i = 1; i < count; i++) need(Number.isSafeInteger(offsets[i]) && offsets[i] > offsets[i - 1] && offsets[i] < offsets[i + 1], message);
    const object = async id => {
      need(Number.isSafeInteger(id) && id > 0 && id < count && offsets[id + 1] - offsets[id] <= 4096, message);
      const text = await readText(offsets[id], offsets[id + 1]);
      const prefix = `${id} 0 obj\n`, suffix = "\nendobj\n";
      need(text.startsWith(prefix) && text.endsWith(suffix), message);
      return text.slice(prefix.length, -suffix.length);
    };
    const catalog = /^<< \/Type \/Catalog \/Pages 2 0 R \/Names << \/EmbeddedFiles (\d+) 0 R >> \/TenetWorkVersion 1 >>$/.exec(await object(1));
    need(catalog, message);
    const namesId = Number(catalog[1]);
    need(namesId === count - 3, message);
    const names = /^<< \/Names \[\(work\.tenet\) (\d+) 0 R\] >>$/.exec(await object(namesId));
    need(names && Number(names[1]) === namesId + 1, message);
    const spec = /^<< \/Type \/Filespec \/F \(work\.tenet\) \/UF \(work\.tenet\) \/Desc \(Tenet saved work with recorded history\) \/EF << \/F (\d+) 0 R >> >>$/.exec(await object(namesId + 1));
    need(spec && Number(spec[1]) === namesId + 2, message);
    const id = namesId + 2, start = offsets[id];
    const prefix = `${id} 0 obj\n`;
    const streamHeader = await readText(start, Math.min(start + 512, offsets[id + 1]));
    need(streamHeader.startsWith(prefix), message);
    const stream = /^<< \/Type \/EmbeddedFile \/Subtype \/application#2Fvnd\.tenet\.whiteboard \/Length (\d+) \/Params << \/Size (\d+) >> >>\nstream\n/.exec(streamHeader.slice(prefix.length));
    need(stream, message);
    const size = Number(stream[1]), dataStart = start + prefix.length + stream[0].length;
    const end = "\nendstream\nendobj\n";
    need(Number.isSafeInteger(size) && size > HEADER && size <= MAX_FILE && size === Number(stream[2]) && dataStart + size + end.length === offsets[id + 1], message);
    need(await readText(dataStart + size, offsets[id + 1]) === end, message);
    guard();
    return file.slice(dataStart, dataStart + size, MIME);
  }
  async function openFile(file) {
    return operation(async (guard, assertAccount) => {
      need(file instanceof Blob && file.size > HEADER && file.size <= MAX_FILE, "Choose a .tenet work file no larger than 64 MiB.");
      need(typeof DecompressionStream === "function", "This browser cannot open compressed work packages. Use a current supported browser.");
      let header = new Uint8Array(await wait(file.slice(0, HEADER).arrayBuffer(), guard));
      const pdf = header[0] === 37 && header[1] === 80 && header[2] === 68 && header[3] === 70 && header[4] === 45;
      if (pdf) {
        file = await workFileFromPdf(file, guard);
        header = new Uint8Array(await wait(file.slice(0, HEADER).arrayBuffer(), guard));
      }
      need(magic.every((byte, index) => header[index] === byte), "This is not a Tenet work package.");
      const view = new DataView(header.buffer);
      need(view.getUint32(8) === VERSION, "This Tenet work format version is not supported.");
      const expectedBytes = view.getUint32(12);
      need(expectedBytes > 0 && expectedBytes <= MAX_EXPANDED, "Work package declares an invalid expanded size.");
      // Enforce the bound while reading decompressed chunks, BEFORE allocating
      // a complete text/JSON value. A small compressed bomb cannot bypass it.
      const expanded = await readStream(file.slice(HEADER).stream().pipeThrough(new DecompressionStream("gzip")), expectedBytes, guard);
      need(expanded.size === expectedBytes, "Work package expanded length does not match.");
      const buffer = await wait(expanded.arrayBuffer(), guard);
      need(hex(await wait(crypto.subtle.digest("SHA-256", buffer), guard)) === hex(header.slice(16, 48)), "Work package digest does not match.");
      let manifest;
      try { manifest = parseManifestJSON(new TextDecoder("utf-8", { fatal:true }).decode(buffer)); }
      catch { throw Error("Work package JSON is invalid."); }
      validatePlain(manifest);
      need(sameKeys(manifest, new Set(["format", "version", "exportedAt", "page", "blobRefs", "assets", "finalPage"])) &&
        manifest.format === "tenet-saved-work" && manifest.version === VERSION &&
        typeof manifest.exportedAt === "string" && manifest.exportedAt.length <= 64 && timestamp(manifest.exportedAt),
      "Unsupported work package manifest.");
      const hashes = new WeakMap(), table = await decodeAssets(manifest, guard, hashes);
      checkPage(manifest.page);
      const item = manifest.page.item, history = await checkHistory(item.workHistory, hashes, guard);
      const final = await finalPageFor(item, history, hashes, guard);
      // Recompute the claimed final-page choice from saved data. Do not allow
      // an arbitrary AI input or unrelated blob to masquerade as the final page.
      need(JSON.stringify(manifest.finalPage) === JSON.stringify(final.descriptor), "Work package final-preview provenance does not match.");
      guard();
      return viewerBundle(item, history, final, { version:VERSION, exportedAt:manifest.exportedAt,
        assetCount:table.size, compressedBytes:file.size, expandedBytes:expectedBytes,
        integrity:"sha256-not-authorship", localOnly:true, container:pdf ? "pdf" : "tenet" }, assertAccount, file);
    });
  }
  window.TenetSubmission = Object.freeze({ exportSavedPage, openFile, prepareSavedPage });
})();
