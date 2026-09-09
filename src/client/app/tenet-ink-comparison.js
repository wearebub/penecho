;(function tenetInkComparisonModule() {
  'use strict';

  // Deliberately independent of the surrounding canvas closure.
  const STORAGE_KEY = 'tenet.ink-comparison.v1';
  const LIMIT = 20;
  const PREFIX = 'tenet-ink-comparison';
  const TASKS = {
    routine: 'Full routine',
    sentence: 'Write a sentence',
    loops: 'Fast loops',
    math: 'Small math',
    graph: 'Pan, zoom, and graph manipulation'
  };
  const TASK_DETAILS = {
    sentence: 'Write "The quick brown fox jumps over the lazy dog." twice at your normal writing size.',
    loops: 'Draw five rows of ten connected small loops, moving as quickly as you comfortably can.',
    math: 'Write y = 2x + 3 and x^2 + y^2 = 25 twice, including small superscripts and an equals sign.',
    graph: 'Pan away and back, zoom in and out, then select and move an existing graph or graph control and return it to its starting position. Use the same graph and gestures for both engines.'
  };
  const TOOLBAR_SELECTORS = [
    '[data-tenet-ink-toolbar]', '#top-toolbar', '#topToolbar',
    '[data-toolbar="top"]', '.top-toolbar', 'header [role="toolbar"]', '#toolbar'
  ];
  const state = {
    ui: null, status: null, phase: 'idle', trial: null, pendingId: null,
    results: [], loaded: false, storageWarning: '', hold: null,
    epoch: 0, disposed: false, sequence: 0, raf: null, lastFrame: null,
    listeners: [], observer: null, observerTimer: null, downloads: new Map(),
    returnFocus: null
  };

  function listen(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    state.listeners.push(() => target.removeEventListener(name, handler, options));
  }

  function availableApi() {
    const api = window.TenetInk;
    return api && api.available === true ? api : null;
  }

  function requireApi() {
    const api = availableApi();
    if (!api || ['getStatus', 'setEngine', 'flush', 'suspend', 'resume']
      .some(name => typeof api[name] !== 'function')) {
      throw new Error('Ink API unavailable');
    }
    return api;
  }

  function count(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function numeric(value) {
    return typeof value === 'number' && Number.isFinite(value) &&
      value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
  }

  function normalizeStatus(value) {
    if (!value || !['web', 'pencilkit'].includes(value.engine) ||
      typeof value.busy !== 'boolean' || typeof value.nativeAvailable !== 'boolean' ||
      (value.strokeCount !== null && count(value.strokeCount) === null)) throw new Error('Invalid ink status');
    return {
      engine: value.engine, busy: value.busy,
      nativeAvailable: value.nativeAvailable, strokeCount: value.strokeCount
    };
  }

  function readStatus() {
    return normalizeStatus(requireApi().getStatus());
  }

  function refreshStatus() {
    try { state.status = availableApi() ? readStatus() : null; }
    catch (_) { state.status = null; }
  }

  function live(epoch) {
    return !state.disposed && state.epoch === epoch;
  }

  function requireLive(epoch) {
    if (!live(epoch)) throw new Error('Comparison disposed');
  }

  function engineName(engine) {
    return engine === 'pencilkit' ? 'PencilKit' : 'Web';
  }

  function dialogOpen() {
    return Boolean(state.ui && state.ui.dialog.hasAttribute('open'));
  }

  function announce(message, error) {
    if (!state.ui || state.disposed) return;
    const target = dialogOpen() ? state.ui.dialogStatus : state.ui.notice;
    const other = dialogOpen() ? state.ui.notice : state.ui.dialogStatus;
    other.textContent = '';
    other.hidden = true;
    target.hidden = false;
    target.setAttribute('role', error ? 'alert' : 'status');
    target.setAttribute('aria-live', error ? 'assertive' : 'polite');
    target.textContent = message;
  }

  function emptyStats() {
    return { count: 0, mean: 0, m2: 0, min: Infinity, max: 0 };
  }

  function addStat(stats, value) {
    if (numeric(value) === null) return;
    stats.count += 1;
    const delta = value - stats.mean;
    stats.mean += delta / stats.count;
    stats.m2 += delta * (value - stats.mean);
    stats.min = Math.min(stats.min, value);
    stats.max = Math.max(stats.max, value);
  }

  function rounded(value) {
    return Math.round(value * 1000) / 1000;
  }

  function summarize(stats) {
    return {
      count: stats.count,
      mean: stats.count ? rounded(stats.mean) : null,
      min: stats.count ? rounded(stats.min) : null,
      max: stats.count ? rounded(stats.max) : null,
      standardDeviation: stats.count ? rounded(Math.sqrt(Math.max(0, stats.m2 / stats.count))) : null
    };
  }

  function sanitizedStats(value) {
    if (!value || count(value.count) === null) throw new Error('Invalid statistics');
    const result = { count: value.count };
    for (const key of ['mean', 'min', 'max', 'standardDeviation']) {
      if (value.count === 0) result[key] = null;
      else {
        if (numeric(value[key]) === null) throw new Error('Invalid statistic');
        result[key] = value[key];
      }
    }
    return result;
  }

  // Rebuild a whitelist on load: never echo arbitrary storage fields into exports.
  function sanitizedRecord(value) {
    try {
      if (!value || value.schemaVersion !== 1 || !['web', 'pencilkit'].includes(value.engine) ||
        !Object.prototype.hasOwnProperty.call(TASKS, value.task) ||
        !['stopped', 'interrupted'].includes(value.completion) ||
        !/^\d{13}-\d+$/.test(value.id) ||
        ![value.startedAt, value.endedAt].every(date => typeof date === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date)))) {
        return null;
      }
      const timing = {};
      for (const key of ['elapsedMs', 'visibleMs', 'hiddenMs']) {
        if (numeric(value.timing[key]) === null) return null;
        timing[key] = value.timing[key];
      }
      if (count(value.timing.visibilityPauses) === null) return null;
      timing.visibilityPauses = value.timing.visibilityPauses;
      const source = value.strokeDiagnostics;
      const strokes = {};
      for (const key of ['events', 'ignoredHiddenEvents']) {
        if (count(source[key]) === null) return null;
        strokes[key] = source[key];
      }
      // Web raster ink has no authoritative inventory. Only explicit null is
      // unknown; malformed counts must not be silently converted into null.
      for (const key of ['startStrokeCount', 'endStrokeCount', 'deltaStrokeCount']) {
        if (source[key] !== null && count(source[key]) === null) return null;
        strokes[key] = source[key];
      }
      if (strokes.startStrokeCount === null || strokes.endStrokeCount === null) {
        strokes.deltaStrokeCount = null;
      }
      strokes.strokeDurationMs = sanitizedStats(source.strokeDurationMs);
      strokes.samplesPerStroke = sanitizedStats(source.samplesPerStroke);
      strokes.commitMs = sanitizedStats(source.commitMs);
      const frames = sanitizedStats(value.frameIntervalsMs);
      if (count(value.frameIntervalsMs.over33Ms) === null) return null;
      frames.over33Ms = value.frameIntervalsMs.over33Ms;
      let ratings = null;
      if (value.ratings && ['smoothness', 'accuracy', 'toolUsability'].every(key =>
        Number.isInteger(value.ratings[key]) && value.ratings[key] >= 1 && value.ratings[key] <= 5)) {
        ratings = {
          smoothness: value.ratings.smoothness, accuracy: value.ratings.accuracy,
          toolUsability: value.ratings.toolUsability
        };
      }
      return {
        schemaVersion: 1, id: value.id, engine: value.engine, task: value.task,
        startedAt: value.startedAt, endedAt: value.endedAt, completion: value.completion,
        interruption: ['pagehide', 'engine-changed', 'unavailable', 'flush-failed'].includes(value.interruption)
          ? value.interruption : null,
        timing, strokeDiagnostics: strokes, frameIntervalsMs: frames,
        ratings, missedStrokes: count(value.missedStrokes)
      };
    } catch (_) { return null; }
  }

  function loadResults() {
    if (state.loaded) return;
    state.loaded = true;
    try {
      const text = window.localStorage.getItem(STORAGE_KEY);
      if (!text) return;
      if (text.length > 196608) throw new Error('Oversize comparison storage');
      const saved = JSON.parse(text);
      if (!saved || saved.schemaVersion !== 1 || !Array.isArray(saved.results)) {
        throw new Error('Invalid comparison storage');
      }
      const candidates = saved.results.slice(-LIMIT);
      state.results = candidates.map(sanitizedRecord).filter(Boolean);
      if (state.results.length !== candidates.length) {
        state.storageWarning = 'Some saved results could not be read. Valid results and new trials remain available.';
      }
    } catch (_) {
      state.storageWarning = 'Browser storage could not be read. Results will remain in memory; export them before leaving.';
    }
  }

  function persistResults() {
    state.results = state.results.slice(-LIMIT);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, results: state.results }));
      state.storageWarning = '';
    } catch (_) {
      state.storageWarning = 'Browser storage could not save. Your current results are still in memory. Export JSON before leaving.';
    }
  }

  function pauseClock(now) {
    if (state.raf !== null) window.cancelAnimationFrame(state.raf);
    state.raf = null;
    state.lastFrame = null;
    if (state.trial && state.trial.visibleSince !== null) {
      state.trial.visibleMs += Math.max(0, now - state.trial.visibleSince);
      state.trial.visibleSince = null;
    }
  }

  function frame(timestamp) {
    state.raf = null;
    const trial = state.trial;
    if (!trial || state.phase !== 'running' || document.hidden || state.disposed) {
      state.lastFrame = null;
      return;
    }
    if (state.lastFrame !== null) {
      const interval = timestamp - state.lastFrame;
      if (numeric(interval) !== null) {
        addStat(trial.frames, interval);
        if (interval > 33) trial.over33Ms += 1;
      }
    }
    state.lastFrame = timestamp;
    state.raf = window.requestAnimationFrame(frame);
  }

  function resumeClock() {
    if (!state.trial || document.hidden || state.phase !== 'running' || state.disposed) return;
    state.trial.visibleSince = performance.now();
    state.lastFrame = null;
    if (state.raf === null) state.raf = window.requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (!state.trial || state.phase !== 'running') return;
    if (document.hidden) {
      state.trial.visibilityPauses += 1;
      pauseClock(performance.now());
    } else resumeClock();
    render();
  }

  function onSample(event) {
    const trial = state.trial;
    if (!trial || !['running', 'stopping'].includes(state.phase)) return;
    const sample = event.detail;
    if (!sample || sample.kind !== 'stroke' || sample.engine !== trial.engine) return;
    if (document.hidden) {
      trial.ignoredHiddenEvents += 1;
      return;
    }
    trial.events += 1;
    addStat(trial.strokeDuration, sample.durationMs);
    if (count(sample.sampleCount) !== null) addStat(trial.samples, sample.sampleCount);
    addStat(trial.commits, sample.commitMs);
  }

  function finishRecord(interruption) {
    const trial = state.trial;
    if (!trial) return null;
    const now = trial.endMs === null ? performance.now() : trial.endMs;
    pauseClock(now);
    const elapsed = Math.max(0, now - trial.startMs);
    const visible = Math.min(elapsed, trial.visibleMs);
    const endCount = state.status && state.status.engine === trial.engine ? state.status.strokeCount : null;
    const record = {
      schemaVersion: 1, id: trial.id, engine: trial.engine, task: trial.task,
      startedAt: trial.startedAt, endedAt: trial.endedAt || new Date().toISOString(),
      completion: interruption ? 'interrupted' : 'stopped', interruption: interruption || null,
      timing: {
        elapsedMs: rounded(elapsed), visibleMs: rounded(visible),
        hiddenMs: rounded(Math.max(0, elapsed - visible)), visibilityPauses: trial.visibilityPauses
      },
      strokeDiagnostics: {
        events: trial.events, ignoredHiddenEvents: trial.ignoredHiddenEvents,
        startStrokeCount: trial.startStrokeCount, endStrokeCount: endCount,
        deltaStrokeCount: trial.startStrokeCount !== null && endCount !== null && endCount >= trial.startStrokeCount
          ? endCount - trial.startStrokeCount : null,
        strokeDurationMs: summarize(trial.strokeDuration), samplesPerStroke: summarize(trial.samples),
        commitMs: summarize(trial.commits)
      },
      frameIntervalsMs: { ...summarize(trial.frames), over33Ms: trial.over33Ms },
      ratings: null, missedStrokes: null
    };
    state.trial = null;
    state.results.push(record);
    state.pendingId = record.id;
    persistResults();
    return record;
  }

  async function releaseSurface(hold) {
    const owned = hold || state.hold;
    if (!owned) return;
    await owned.api.resume(owned.reason);
    if (state.hold === owned) state.hold = null;
  }

  function hideDialog() {
    if (!state.ui) return;
    const dialog = state.ui.dialog;
    if (dialog.hasAttribute('open')) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    state.ui.backdrop.hidden = true;
    // Restore focus after the owning operation reenables its toolbar controls.
  }

  async function showDialog(epoch) {
    if (dialogOpen()) return;
    const hold = state.hold || { api: requireApi(), reason: PREFIX + ':' + epoch };
    const needsSuspend = !state.hold;
    state.hold = hold;
    try {
      if (needsSuspend) await hold.api.suspend(hold.reason);
      requireLive(epoch);
      state.returnFocus = document.activeElement;
      const dialog = state.ui.dialog;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else {
        state.ui.backdrop.hidden = false;
        dialog.setAttribute('open', '');
      }
      state.ui.notice.hidden = true;
      state.ui.heading.focus();
    } catch (error) {
      try { await releaseSurface(hold); } catch (_) { /* Retry drawing retains the hold. */ }
      throw error;
    }
  }

  async function operation(phase, work, errorMessage, allowed) {
    if (state.disposed || !(allowed || ['idle']).includes(state.phase)) return false;
    const epoch = state.epoch;
    state.phase = phase;
    render();
    try {
      await work(epoch);
      requireLive(epoch);
      return true;
    } catch (_) {
      if (live(epoch)) {
        refreshStatus();
        announce(errorMessage, true);
      }
      return false;
    } finally {
      if (live(epoch)) {
        if (state.phase === phase) state.phase = 'idle';
        render();
        if (!dialogOpen() && state.returnFocus) {
          const previous = state.returnFocus;
          state.returnFocus = null;
          const target = state.trial ? state.ui.stop : [previous, state.ui.compare].find(element =>
            element && element.isConnected && !element.disabled &&
            !element.closest('[hidden]') && element.getClientRects().length);
          if (target) target.focus();
        }
      }
    }
  }

  async function openComparison() {
    if (state.phase === 'running') return stopTrial(null);
    if (dialogOpen() || state.phase !== 'idle') return;
    await operation('opening', async epoch => {
      await requireApi().flush();
      requireLive(epoch);
      state.status = readStatus();
      await showDialog(epoch);
      announce('Choose the same task and tools for each renderer. Start a trial to return to your notebook.');
    }, 'The comparison could not open. Your work has not been cleared. Use Retry drawing if the surface is hidden.');
  }

  async function closeComparison() {
    await operation('closing', async epoch => {
      hideDialog();
      await releaseSurface();
      requireLive(epoch);
      announce('Comparison closed. Your notebook is ready.');
    }, 'The drawing surface could not resume. Use Retry drawing. Your saved comparisons are retained.');
  }

  async function switchEngine(engine) {
    if (!['web', 'pencilkit'].includes(engine) || state.trial) return;
    await operation('switching', async epoch => {
      const api = requireApi();
      const before = readStatus();
      if (before.busy || (engine === 'pencilkit' && !before.nativeAvailable)) {
        throw new Error('Engine unavailable or busy');
      }
      await api.flush();
      requireLive(epoch);
      await api.setEngine(engine);
      requireLive(epoch);
      state.status = readStatus();
      if (state.status.engine !== engine || state.status.busy) throw new Error('Engine switch incomplete');
      announce('Ink is now using ' + engineName(engine) + '. Your notebook work is retained.');
    }, 'The renderer could not switch. Check the current engine shown here and try again. Your work was not cleared by this comparison.');
  }

  async function startTrial() {
    if (state.pendingId) {
      announce('Save or skip the previous ratings before starting another trial.', true);
      return;
    }
    await operation('starting', async epoch => {
      const api = requireApi();
      const task = state.ui.task.value;
      const engine = state.ui.engine.value;
      if (document.hidden || !Object.prototype.hasOwnProperty.call(TASKS, task)) {
        throw new Error('Trial cannot start');
      }
      const before = readStatus();
      if (before.busy || before.engine !== engine) throw new Error('Engine not ready');
      await api.flush();
      requireLive(epoch);
      hideDialog();
      await releaseSurface();
      requireLive(epoch);
      const ready = readStatus();
      if (document.hidden || ready.busy || ready.engine !== engine ||
        (engine === 'pencilkit' && !ready.nativeAvailable)) throw new Error('Engine not ready');
      state.status = ready;
      const now = performance.now();
      state.trial = {
        id: String(Date.now()) + '-' + (++state.sequence), engine, task,
        startedAt: new Date().toISOString(), endedAt: null, startMs: now, endMs: null,
        visibleSince: null, visibleMs: 0, visibilityPauses: 0,
        startStrokeCount: ready.strokeCount, events: 0, ignoredHiddenEvents: 0,
        strokeDuration: emptyStats(), samples: emptyStats(), commits: emptyStats(),
        frames: emptyStats(), over33Ms: 0
      };
      state.phase = 'running';
      resumeClock();
      render();
      state.ui.stop.focus();
      announce(engineName(engine) + ' trial started. Complete the selected task, then choose Stop and rate.');
    }, 'The trial could not start. No trial is running. Reopen Compare ink or use Retry drawing.');
  }

  async function stopTrial(interruption) {
    if (!state.trial || state.phase !== 'running') return;
    await operation('stopping', async epoch => {
      state.trial.endMs = performance.now();
      state.trial.endedAt = new Date().toISOString();
      pauseClock(state.trial.endMs);
      let reason = interruption;
      if (availableApi()) {
        try {
          await requireApi().flush();
          requireLive(epoch);
        } catch (_) {
          requireLive(epoch);
          reason = reason || 'flush-failed';
        }
      } else reason = reason || 'unavailable';
      requireLive(epoch);
      refreshStatus();
      if (!state.status) reason = reason || 'unavailable';
      else if (state.status.engine !== state.trial.engine) reason = reason || 'engine-changed';
      finishRecord(reason);
      resetRatings();
      renderResults();
      if (availableApi()) await showDialog(epoch);
      announce(reason
        ? 'Trial interrupted. Available diagnostics were retained; this is not a completed comparison. You can still add ratings or export.'
        : 'Trial stopped and diagnostics retained. Add your ratings and manual missed-stroke count.', Boolean(reason));
    }, 'The trial stopped, but the comparison dialog could not open. Retained results are available from Compare ink.', ['running']);
  }

  function onStatus(event) {
    ensureUI();
    if (!state.ui || state.disposed) return;
    try { state.status = availableApi() ? normalizeStatus(event.detail) : null; }
    catch (_) {
      state.status = null;
      announce('Ink status could not be read. Use Retry drawing to refresh the controls.', true);
    }
    if (state.trial && state.phase === 'running' &&
      (!state.status || state.status.engine !== state.trial.engine ||
        (state.trial.engine === 'pencilkit' && !state.status.nativeAvailable))) {
      void stopTrial(!state.status ? 'unavailable' : 'engine-changed');
    }
    if (!availableApi() && dialogOpen()) {
      hideDialog();
      const hold = state.hold;
      if (hold) void releaseSurface(hold).catch(() => {
        announce('Ink became unavailable and its surface could not resume.', true);
      });
    }
    render();
  }

  function resetRatings() {
    if (!state.ui) return;
    state.ui.ratingForm.reset();
  }

  function saveRatings(event) {
    event.preventDefault();
    const record = state.results.find(result => result.id === state.pendingId);
    if (!record) return;
    const form = state.ui.ratingForm;
    if (!form.checkValidity()) {
      announce('Choose all three ratings and enter a whole-number missed-stroke count from 0 to 1000000.', true);
      form.reportValidity();
      return;
    }
    record.ratings = {
      smoothness: Number(form.elements.namedItem('smoothness').value),
      accuracy: Number(form.elements.namedItem('accuracy').value),
      toolUsability: Number(form.elements.namedItem('toolUsability').value)
    };
    record.missedStrokes = Number(form.elements.namedItem('missedStrokes').value);
    state.pendingId = null;
    persistResults();
    renderResults();
    render();
    state.ui.start.focus();
    announce('Ratings saved for the ' + engineName(record.engine) + ' trial. You can now switch engines and repeat the same task.');
  }

  function skipRatings() {
    state.pendingId = null;
    render();
    state.ui.start.focus();
    announce('Diagnostics retained without ratings. You can start the next trial.');
  }

  function exportResults() {
    if (!state.results.length) return;
    let url = null;
    let anchor = null;
    try {
      const payload = {
        schemaVersion: 1, exportedAt: new Date().toISOString(),
        metricNote: 'Local software diagnostics and subjective ratings only. Frame intervals, stroke durations, sample counts, and commit durations do not measure hardware Pencil-to-pixel latency. Hidden time is excluded from active timing and frame statistics. Missing optional metrics are null, not zero.',
        tasks: TASK_DETAILS, results: state.results.map(sanitizedRecord).filter(Boolean)
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      url = window.URL.createObjectURL(blob);
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'tenet-ink-comparison-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      const retainedUrl = url;
      const timer = window.setTimeout(() => {
        window.URL.revokeObjectURL(retainedUrl);
        state.downloads.delete(retainedUrl);
      }, 60000);
      state.downloads.set(url, timer);
      announce('Local JSON export requested. Your browser handles the download; nothing was uploaded.');
    } catch (_) {
      if (url) window.URL.revokeObjectURL(url);
      announce('The JSON download could not start. Your current results are still retained; try exporting again.', true);
    } finally {
      if (anchor) anchor.remove();
    }
  }

  function renderResults() {
    if (!state.ui) return;
    const body = state.ui.results;
    body.replaceChildren();
    state.ui.resultCount.textContent = state.results.length + ' of ' + LIMIT + ' retained results';
    for (const record of state.results.slice().reverse()) {
      const row = document.createElement('tr');
      const mean = stats => stats.count ? stats.mean.toFixed(2) : 'Not reported';
      const ratings = record.ratings
        ? [record.ratings.smoothness, record.ratings.accuracy, record.ratings.toolUsability].join(' / ')
        : 'Not rated';
      const cells = [
        engineName(record.engine) + (record.completion === 'interrupted' ? ' (interrupted)' : ''),
        TASKS[record.task], new Date(record.startedAt).toLocaleString(),
        (record.timing.visibleMs / 1000).toFixed(1), String(record.strokeDiagnostics.events),
        mean(record.strokeDiagnostics.samplesPerStroke), mean(record.strokeDiagnostics.commitMs),
        mean(record.frameIntervalsMs), ratings,
        record.missedStrokes === null ? 'Not rated' : String(record.missedStrokes)
      ];
      cells.forEach((text, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.textContent = text;
        row.appendChild(cell);
      });
      body.appendChild(row);
    }
    if (!state.results.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 10;
      cell.textContent = 'No trials yet. Complete the same task once with each available engine.';
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  function render() {
    const ui = state.ui;
    if (!ui || state.disposed) return;
    const available = Boolean(availableApi());
    const status = state.status;
    const running = Boolean(state.trial);
    const idle = state.phase === 'idle';
    const blocked = !available || !status || status.busy || !idle || running;
    ui.toolbar.hidden = !available;
    ui.engineButton.textContent = state.phase === 'switching' ? 'Ink: Switching...' :
      'Ink: ' + (status ? engineName(status.engine) : 'Unavailable');
    ui.engineButton.disabled = blocked || !status.nativeAvailable || Boolean(state.hold && !dialogOpen());
    ui.engineButton.title = running ? 'Stop the trial before switching renderers.' :
      status && !status.nativeAvailable ? 'PencilKit is not available on this device.' :
        'Switch between Web and PencilKit without clearing your work.';
    ui.compare.textContent = state.phase === 'running' ? 'Stop and rate' : 'Compare ink';
    ui.compare.disabled = !available || (!idle && state.phase !== 'running');
    ui.engine.disabled = blocked;
    if (status) ui.engine.value = status.engine;
    ui.nativeOption.disabled = !status || !status.nativeAvailable;
    ui.nativeOption.textContent = status && status.nativeAvailable ? 'PencilKit' : 'PencilKit (unavailable)';
    ui.availability.textContent = !status ? 'Ink status unavailable. Retry drawing to refresh.' :
      status.busy ? 'The drawing engine is busy. Wait for it to finish.' :
        status.nativeAvailable ? 'Both engines are available on this device.' :
          'Web is available. PencilKit requires a native host that provides it.';
    ui.task.disabled = !idle || running;
    ui.start.disabled = blocked || Boolean(state.pendingId) || Boolean(state.hold && !dialogOpen());
    ui.start.textContent = state.phase === 'starting' ? 'Starting...' : 'Start trial';
    ui.close.disabled = !idle;
    ui.dialog.setAttribute('aria-busy', String(!idle));
    ui.trialBar.hidden = !running;
    ui.stop.disabled = state.phase !== 'running';
    if (running) {
      ui.trialText.textContent = engineName(state.trial.engine) + ' trial: ' + TASKS[state.trial.task] +
        (document.hidden ? '. Paused while this page is hidden.' : '. Draw in your notebook, then stop and rate.');
    }
    ui.ratings.hidden = !state.pendingId;
    const pending = state.results.find(result => result.id === state.pendingId);
    ui.ratingTitle.textContent = pending ? 'Rate your ' + engineName(pending.engine) + ' trial' : 'Rate your trial';
    ui.ratingFields.disabled = !idle;
    ui.exportButton.disabled = !state.results.length || !idle;
    ui.persistence.textContent = state.storageWarning ||
      'Up to 20 results are saved in this browser. No artwork, account details, or session data are stored.';
    ui.persistence.setAttribute('role', state.storageWarning ? 'alert' : 'status');
    ui.retry.hidden = !available || Boolean(status && (!state.hold || dialogOpen()));
    ui.retry.disabled = !idle || running;
    const selectedTask = ui.task.value;
    for (const item of ui.taskList.children) item.hidden = selectedTask !== 'routine' && item.dataset.task !== selectedTask;
  }

  function mountToolbar() {
    if (!state.ui) return false;
    for (const selector of TOOLBAR_SELECTORS) {
      const toolbar = document.querySelector(selector);
      if (toolbar && !toolbar.closest('.' + PREFIX)) {
        toolbar.appendChild(state.ui.toolbar);
        state.ui.toolbar.classList.remove('tic-floating-toolbar');
        return true;
      }
    }
    return false;
  }

  function onDialogKey(event) {
    if (!dialogOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.phase === 'idle') void closeComparison();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(state.ui.dialog.querySelectorAll(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]'
    )).filter(element => !element.closest('[hidden]') && element.getClientRects().length && !element.matches(':disabled'));
    if (!focusable.length) {
      event.preventDefault();
      state.ui.heading.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !state.ui.dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }

  function createUI() {
    const style = document.createElement('style');
    style.id = PREFIX + '-styles';
    style.textContent = `
      .tenet-ink-comparison { --tic-navy:#183447; --tic-paper:#fffaf1; --tic-line:#c6bcae;
        --tic-warm:#e8ac78; --tic-muted:#4c5c63; color:var(--tic-navy); font:15px/1.5 Georgia,serif;
        box-sizing:border-box; color-scheme:light; }
      .tenet-ink-comparison *, .tenet-ink-comparison *::before, .tenet-ink-comparison *::after { box-sizing:border-box; }
      .tenet-ink-comparison [hidden], .tenet-ink-comparison[hidden] { display:none !important; }
      .tenet-ink-comparison button, .tenet-ink-comparison select, .tenet-ink-comparison input {
        min-height:44px; min-width:44px; max-width:100%; border:1px solid var(--tic-line); border-radius:9px;
        padding:9px 13px; color:var(--tic-navy); background:#fffdf8; font:inherit; font-size:16px; }
      .tenet-ink-comparison button { cursor:pointer; touch-action:manipulation; font-weight:700; }
      .tenet-ink-comparison button:disabled, .tenet-ink-comparison select:disabled,
      .tenet-ink-comparison input:disabled { opacity:.55; cursor:default; }
      .tenet-ink-comparison :focus-visible { outline:3px solid #99602e; outline-offset:3px; }
      .tenet-ink-comparison .tic-primary { background:var(--tic-navy); color:#fffaf1; border-color:var(--tic-navy); }
      .tenet-ink-comparison.tic-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:4px; }
      .tenet-ink-comparison.tic-floating-toolbar { position:fixed; top:calc(10px + env(safe-area-inset-top,0px));
        right:calc(10px + env(safe-area-inset-right,0px)); z-index:10000; max-width:calc(100vw - 20px);
        background:var(--tic-paper); border:1px solid var(--tic-line); border-radius:13px; box-shadow:0 6px 22px #18344720; }
      .tenet-ink-comparison.tic-dialog { width:min(940px,calc(100vw - 24px)); max-height:calc(100vh - 32px);
        max-height:calc(100dvh - 32px); margin:auto; padding:0; border:1px solid var(--tic-line); border-radius:18px;
        background:linear-gradient(125deg,#fffaf1,#f4eadd); box-shadow:0 24px 90px #10283850; overflow:hidden; }
      .tenet-ink-comparison.tic-dialog:not([open]) { display:none; }
      .tenet-ink-comparison.tic-dialog[open] { display:flex; flex-direction:column; position:fixed; inset:0; z-index:10003; }
      .tenet-ink-comparison.tic-dialog::backdrop { background:#112c40a6; }
      .tenet-ink-comparison.tic-backdrop { position:fixed; inset:0; z-index:10002; background:#112c40a6; touch-action:none; }
      .tenet-ink-comparison .tic-header { display:flex; gap:18px; align-items:center; justify-content:space-between;
        flex-shrink:0; padding:20px 24px; border-bottom:1px solid var(--tic-line); }
      .tenet-ink-comparison h2, .tenet-ink-comparison h3, .tenet-ink-comparison p { margin:0 0 12px; }
      .tenet-ink-comparison h2 { font-size:clamp(24px,4vw,34px); line-height:1.15; margin:0; }
      .tenet-ink-comparison h3 { font-size:21px; }
      .tenet-ink-comparison .tic-eyebrow { font:700 11px/1.4 Verdana,sans-serif; letter-spacing:.13em; margin-bottom:6px; }
      .tenet-ink-comparison .tic-body { padding:22px 24px; overflow:auto; overscroll-behavior:contain; min-height:0; }
      .tenet-ink-comparison .tic-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin:16px 0; }
      .tenet-ink-comparison label { display:flex; flex-direction:column; gap:6px; font-weight:700; }
      .tenet-ink-comparison .tic-note { color:var(--tic-muted); font-size:14px; }
      .tenet-ink-comparison .tic-callout { padding:14px 16px; background:#f6e3cc; border-left:4px solid #a16b3c; border-radius:6px; }
      .tenet-ink-comparison .tic-actions { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; align-items:center; }
      .tenet-ink-comparison ol { margin:12px 0 18px; padding-left:24px; }
      .tenet-ink-comparison li { margin:8px 0; }
      .tenet-ink-comparison section { margin-top:24px; padding-top:20px; border-top:1px solid var(--tic-line); }
      .tenet-ink-comparison fieldset { padding:0; margin:0; border:0; min-width:0; }
      .tenet-ink-comparison .tic-table-scroll { overflow:auto; border:1px solid var(--tic-line); border-radius:9px; }
      .tenet-ink-comparison table { width:100%; border-collapse:collapse; background:#fffcf7; font-size:13px; }
      .tenet-ink-comparison th, .tenet-ink-comparison td { padding:10px 12px; text-align:left; vertical-align:top;
        border-bottom:1px solid #dfd7cb; min-width:92px; }
      .tenet-ink-comparison thead { background:#e9e0d2; }
      .tenet-ink-comparison caption { text-align:left; padding:10px 12px; font-weight:700; }
      .tenet-ink-comparison .tic-message { padding:12px 15px; margin:10px 0; background:#fffaf1;
        border:1px solid var(--tic-line); border-radius:9px; overflow-wrap:anywhere; }
      .tenet-ink-comparison [role="alert"] { border-color:#944821; }
      .tenet-ink-comparison.tic-dock { position:fixed; bottom:calc(10px + env(safe-area-inset-bottom,0px));
        left:calc(10px + env(safe-area-inset-left,0px)); right:calc(10px + env(safe-area-inset-right,0px));
        z-index:10001; pointer-events:none; display:grid; gap:8px; justify-items:start; }
      .tenet-ink-comparison.tic-dock > * { pointer-events:auto; max-width:min(760px,100%); }
      .tenet-ink-comparison .tic-trial-bar { display:flex; flex-wrap:wrap; gap:12px; align-items:center; padding:10px 14px;
        background:var(--tic-navy); color:#fffaf1; border-radius:12px; box-shadow:0 4px 20px #18344730; }
      .tenet-ink-comparison .tic-trial-bar span { flex:1 1 240px; }
      .tenet-ink-comparison.tic-dock .tic-message { margin:0; box-shadow:0 4px 18px #18344720; }
      @media(max-width:600px) {
        .tenet-ink-comparison .tic-grid { grid-template-columns:1fr; gap:12px; }
        .tenet-ink-comparison .tic-header, .tenet-ink-comparison .tic-body { padding:16px; }
        .tenet-ink-comparison.tic-dialog { width:calc(100vw - 16px); max-height:calc(100dvh - 16px); }
        .tenet-ink-comparison.tic-toolbar { gap:6px; }
      }
    `;
    const toolbar = document.createElement('div');
    toolbar.id = PREFIX + '-toolbar';
    toolbar.className = PREFIX + ' tic-toolbar tic-floating-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Ink renderer controls');
    toolbar.innerHTML = '<button type="button" data-tic="engine-button">Ink: Web</button><button type="button" data-tic="compare" aria-haspopup="dialog" aria-controls="tenet-ink-comparison-dialog">Compare ink</button>';
    const backdrop = document.createElement('div');
    backdrop.className = PREFIX + ' tic-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    const dialog = document.createElement('dialog');
    dialog.id = PREFIX + '-dialog';
    dialog.className = PREFIX + ' tic-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', PREFIX + '-title');
    dialog.setAttribute('aria-describedby', PREFIX + '-intro');
    dialog.innerHTML = `
      <header class="tic-header"><div><p class="tic-eyebrow">TENET / ON-DEVICE COMPARISON</p>
        <h2 id="tenet-ink-comparison-title" tabindex="-1" data-tic="heading">Compare ink</h2></div>
        <button type="button" data-tic="close">Close</button></header>
      <div class="tic-body">
        <p id="tenet-ink-comparison-intro">Try the same drawing work with Web and PencilKit on this iPad. Starting closes this dialog so you can draw in your existing notebook. Stop and rate when finished.</p>
        <p class="tic-callout">These are software diagnostics and your impressions. Stroke timing, commit timing, and animation frame intervals are <strong>not hardware Pencil-to-pixel latency</strong>.</p>
        <p data-tic="dialog-status" class="tic-message" role="status" aria-live="polite" aria-atomic="true" hidden></p>
        <div class="tic-grid">
          <label>Drawing engine<select data-tic="engine" aria-describedby="tenet-ink-comparison-availability"><option value="web">Web</option><option value="pencilkit" data-tic="native-option">PencilKit</option></select></label>
          <label>Task to repeat<select data-tic="task"><option value="routine">Full routine</option><option value="sentence">Write a sentence</option><option value="loops">Fast loops</option><option value="math">Small math</option><option value="graph">Pan, zoom, and graph manipulation</option></select></label>
        </div>
        <p id="tenet-ink-comparison-availability" data-tic="availability" class="tic-note"></p>
        <h3>Keep the work comparable</h3>
        <p>Use the same Pencil, pen width, color, zoom, and notebook area for both trials. Start from a comparable view and repeat the same task. Try reversing the engine order on a second pair.</p>
        <ol data-tic="task-list"></ol>
        <p class="tic-note">If there is no graph, prepare one with your usual notebook tools before starting either graph trial. This dialog does not create graphs or clear drawings. Hidden-page time is paused and excluded. Stop before changing engines.</p>
        <div class="tic-actions"><button type="button" class="tic-primary" data-tic="start">Start trial</button></div>
        <section data-tic="ratings" hidden aria-labelledby="tenet-ink-comparison-rating-title">
          <h3 id="tenet-ink-comparison-rating-title" data-tic="rating-title">Rate your trial</h3>
          <p id="tenet-ink-comparison-scale">Rate each item from 1 (poor) to 5 (excellent). Missed strokes are your manual count, not an automatic detection.</p>
          <form data-tic="rating-form" novalidate><fieldset data-tic="rating-fields" aria-describedby="tenet-ink-comparison-scale">
            <div class="tic-grid" data-tic="rating-inputs"></div>
            <div class="tic-actions"><button type="submit" class="tic-primary">Save ratings</button><button type="button" data-tic="skip">Skip ratings</button></div>
          </fieldset></form>
        </section>
        <section aria-labelledby="tenet-ink-comparison-results-title">
          <h3 id="tenet-ink-comparison-results-title">Local results</h3>
          <p data-tic="result-count" class="tic-note"></p>
          <div class="tic-table-scroll" tabindex="0" role="region" aria-label="Comparison results; scroll horizontally for more columns">
            <table><caption>Diagnostic averages and subjective ratings</caption><thead><tr>
              <th scope="col">Engine</th><th scope="col">Task</th><th scope="col">Started</th><th scope="col">Visible seconds</th>
              <th scope="col">Stroke events</th><th scope="col">Samples / stroke</th><th scope="col">Commit ms</th><th scope="col">Frame ms</th>
              <th scope="col">Smooth / accurate / tools</th><th scope="col">Missed strokes</th>
            </tr></thead><tbody data-tic="results"></tbody></table>
          </div>
          <p class="tic-note">Ratings are subjective. Frame intervals describe this page's animation scheduling, not native display presentation. Missing metrics are shown as Not reported. Full ranges and counts are in the JSON export.</p>
          <p data-tic="persistence" class="tic-note" role="status" aria-live="polite"></p>
          <div class="tic-actions"><button type="button" data-tic="export">Export JSON locally</button></div>
        </section>
      </div>`;
    const dock = document.createElement('div');
    dock.className = PREFIX + ' tic-dock';
    dock.innerHTML = '<div class="tic-trial-bar" data-tic="trial-bar" hidden><span data-tic="trial-text"></span><button type="button" data-tic="stop">Stop and rate</button></div><p class="tic-message" data-tic="notice" role="status" aria-live="polite" aria-atomic="true" hidden></p><button type="button" data-tic="retry" hidden>Retry drawing</button>';
    const roots = [toolbar, dialog, dock];
    const find = name => roots.map(root => root.querySelector('[data-tic="' + name + '"]')).find(Boolean);
    const ui = { style, toolbar, backdrop, dialog, dock };
    const names = {
      engineButton: 'engine-button', compare: 'compare', heading: 'heading', close: 'close',
      dialogStatus: 'dialog-status', engine: 'engine', nativeOption: 'native-option', task: 'task',
      availability: 'availability', taskList: 'task-list', start: 'start', ratings: 'ratings',
      ratingTitle: 'rating-title', ratingForm: 'rating-form', ratingFields: 'rating-fields',
      ratingInputs: 'rating-inputs', skip: 'skip', resultCount: 'result-count', results: 'results',
      persistence: 'persistence', exportButton: 'export', trialBar: 'trial-bar', trialText: 'trial-text',
      stop: 'stop', notice: 'notice', retry: 'retry'
    };
    for (const [key, name] of Object.entries(names)) ui[key] = find(name);
    for (const [task, description] of Object.entries(TASK_DETAILS)) {
      const item = document.createElement('li');
      item.dataset.task = task;
      item.textContent = description;
      ui.taskList.appendChild(item);
    }
    for (const [name, title] of [['smoothness', 'Smoothness'], ['accuracy', 'Accuracy'], ['toolUsability', 'Tool usability']]) {
      const label = document.createElement('label');
      label.textContent = title;
      const select = document.createElement('select');
      select.name = name;
      select.required = true;
      select.add(new Option('Choose a rating', ''));
      for (let value = 1; value <= 5; value += 1) {
        select.add(new Option(String(value) + (value === 1 ? ' - poor' : value === 5 ? ' - excellent' : ''), String(value)));
      }
      label.appendChild(select);
      ui.ratingInputs.appendChild(label);
    }
    const missed = document.createElement('label');
    missed.textContent = 'Missed strokes (manual count)';
    const input = document.createElement('input');
    input.type = 'number'; input.name = 'missedStrokes'; input.min = '0'; input.max = '1000000';
    input.step = '1'; input.defaultValue = '0'; input.required = true; input.inputMode = 'numeric';
    missed.appendChild(input);
    ui.ratingInputs.appendChild(missed);
    document.head.appendChild(style);
    document.body.append(toolbar, backdrop, dialog, dock);
    state.ui = ui;
    listen(ui.engineButton, 'click', () => {
      if (state.status) void switchEngine(state.status.engine === 'web' ? 'pencilkit' : 'web');
    });
    listen(ui.compare, 'click', () => { void openComparison(); });
    listen(ui.engine, 'change', () => { void switchEngine(ui.engine.value); });
    listen(ui.task, 'change', render);
    listen(ui.start, 'click', () => { void startTrial(); });
    listen(ui.stop, 'click', () => { void stopTrial(null); });
    listen(ui.close, 'click', () => { void closeComparison(); });
    listen(ui.dialog, 'cancel', event => {
      event.preventDefault();
      if (state.phase === 'idle') void closeComparison();
    });
    listen(document, 'keydown', onDialogKey, true);
    listen(document, 'focusin', event => {
      if (dialogOpen() && !ui.dialog.contains(event.target)) ui.heading.focus();
    });
    listen(ui.ratingForm, 'submit', saveRatings);
    listen(ui.skip, 'click', skipRatings);
    listen(ui.exportButton, 'click', exportResults);
    listen(ui.retry, 'click', () => {
      void operation('recovering', async epoch => {
        if (!dialogOpen()) await releaseSurface();
        requireLive(epoch);
        state.status = readStatus();
        announce(state.status.busy ? 'The drawing engine is still busy.' : 'Drawing controls are ready.');
      }, 'Drawing controls could not recover. Try again when the ink engine is available.');
    });
  }

  function ensureUI() {
    if (state.ui || state.disposed || document.readyState === 'loading' || !availableApi()) return;
    // A second inclusion must not install a second set of controls or storage writers.
    if (document.getElementById(PREFIX + '-toolbar')) return;
    createUI();
    loadResults();
    refreshStatus();
    if (!mountToolbar() && typeof MutationObserver === 'function') {
      state.observer = new MutationObserver(() => {
        if (mountToolbar()) {
          state.observer.disconnect(); state.observer = null;
          window.clearTimeout(state.observerTimer); state.observerTimer = null;
        }
      });
      state.observer.observe(document.body, { childList: true, subtree: true });
      state.observerTimer = window.setTimeout(() => {
        if (state.observer) state.observer.disconnect();
        state.observer = null; state.observerTimer = null;
      }, 10000);
    }
    renderResults();
    render();
    if (!state.status) announce('Ink status could not be read. Use Retry drawing.', true);
  }

  function onPageHide(event) {
    if (state.disposed) return;
    // pagehide cannot reliably await native work. Keep a clearly interrupted snapshot.
    if (state.trial) finishRecord('pagehide');
    state.disposed = true;
    state.epoch += 1;
    pauseClock(performance.now());
    state.phase = 'idle';
    state.listeners.splice(0).forEach(unregister => unregister());
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    window.clearTimeout(state.observerTimer);
    state.observerTimer = null;
    for (const [url, timer] of state.downloads) {
      window.clearTimeout(timer);
      window.URL.revokeObjectURL(url);
    }
    state.downloads.clear();
    const hold = state.hold;
    if (hold) {
      try {
        Promise.resolve(hold.api.resume(hold.reason)).then(() => {
          if (state.hold === hold) state.hold = null;
        }).catch(() => { /* A restored page exposes Retry drawing. */ });
      } catch (_) { /* A restored page exposes Retry drawing. */ }
    }
    if (state.ui) {
      const ui = state.ui;
      if (dialogOpen() && typeof ui.dialog.close === 'function') ui.dialog.close();
      [ui.toolbar, ui.dialog, ui.backdrop, ui.dock, ui.style].forEach(element => element.remove());
      state.ui = null;
    }
    state.returnFocus = null;
    if (event.persisted) window.addEventListener('pageshow', activate, { once: true });
  }

  function activate() {
    state.disposed = false;
    state.epoch += 1;
    listen(window, 'tenet:ink-status', onStatus);
    listen(window, 'tenet:ink-sample', onSample);
    listen(document, 'visibilitychange', onVisibility);
    listen(window, 'pagehide', onPageHide);
    if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', ensureUI, { once: true });
    else ensureUI();
  }

  activate();
})();
