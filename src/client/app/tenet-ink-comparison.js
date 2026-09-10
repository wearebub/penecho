;(function tenetInkComparisonModule() {
  'use strict';

  // Keep the existing toolbar identity and engine-button hook for host integrations.
  // Benchmark trials, diagnostics, ratings, exports, and comparison storage are retired.
  const PREFIX = 'tenet-ink-comparison';
  const TOOLBAR_SELECTORS = [
    '[data-tenet-ink-toolbar]', '#top-toolbar', '#topToolbar',
    '[data-toolbar="top"]', '.top-toolbar', 'header [role="toolbar"]', '#toolbar'
  ];
  const state = {
    ui: null, status: null, phase: 'idle', epoch: 0, disposed: false,
    listeners: [], observer: null, observerTimer: null
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
    if (!api || ['getStatus', 'setEngine', 'flush'].some(name => typeof api[name] !== 'function')) {
      throw new Error('Ink API unavailable');
    }
    return api;
  }

  function normalizeStatus(value) {
    if (!value || !['web', 'pencilkit'].includes(value.engine) ||
      typeof value.busy !== 'boolean' || typeof value.nativeAvailable !== 'boolean' ||
      (value.strokeCount !== null && (!Number.isSafeInteger(value.strokeCount) || value.strokeCount < 0))) {
      throw new Error('Invalid ink status');
    }
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

  function engineName(engine) {
    return engine === 'pencilkit' ? 'PencilKit' : 'Web';
  }

  function clearNotice() {
    if (!state.ui) return;
    state.ui.notice.textContent = '';
    state.ui.dock.hidden = true;
  }

  function showError(message) {
    if (!state.ui || state.disposed) return;
    state.ui.dock.hidden = false;
    state.ui.notice.textContent = message;
  }

  async function switchEngine(engine) {
    if (state.disposed || state.phase !== 'idle' || !['web', 'pencilkit'].includes(engine)) return;
    const epoch = state.epoch;
    state.phase = 'switching';
    clearNotice();
    render();
    try {
      const api = requireApi();
      const before = readStatus();
      if (before.busy || (engine === 'pencilkit' && !before.nativeAvailable)) {
        throw new Error('Engine unavailable or busy');
      }
      // The adapter owns both histories. Flush before switching and never clear either.
      await api.flush();
      if (!live(epoch)) return;
      await api.setEngine(engine);
      if (!live(epoch)) return;
      state.status = readStatus();
      if (state.status.engine !== engine || state.status.busy) throw new Error('Engine switch incomplete');
    } catch (_) {
      if (live(epoch)) {
        refreshStatus();
        showError('The ink engine could not switch. Check the current engine, then try again.');
      }
    } finally {
      if (live(epoch)) {
        state.phase = 'idle';
        render();
      }
    }
  }

  function render() {
    const ui = state.ui;
    if (!ui || state.disposed) return;
    const available = Boolean(availableApi());
    const status = state.status;
    const switching = state.phase === 'switching';
    ui.toolbar.hidden = !available;
    ui.engineButton.textContent = switching ? 'Ink: Switching...' :
      'Ink: ' + (status ? engineName(status.engine) : 'Unavailable');
    ui.engineButton.disabled = !available || !status || status.busy || switching || !status.nativeAvailable;
    ui.engineButton.title = !status ? 'The ink engine is unavailable.' :
      status.busy ? 'Wait for the drawing engine to finish.' :
        !status.nativeAvailable ? 'PencilKit is not available on this device.' :
          'Switch between Web and PencilKit without clearing your work.';
    ui.toolbar.setAttribute('aria-busy', String(switching));
  }

  function onStatus(event) {
    ensureUI();
    if (!state.ui || state.disposed) return;
    try { state.status = availableApi() ? normalizeStatus(event.detail) : null; }
    catch (_) { state.status = null; }
    render();
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

  function stopObserving() {
    if (state.observer) state.observer.disconnect();
    state.observer = null;
    window.clearTimeout(state.observerTimer);
    state.observerTimer = null;
  }

  function createUI() {
    const style = document.createElement('link');
    style.id = PREFIX + '-styles';
    style.rel = 'stylesheet';
    style.href = '/tenet-ink-comparison.css';
    const toolbar = document.createElement('div');
    toolbar.id = PREFIX + '-toolbar';
    toolbar.className = PREFIX + ' tic-toolbar tic-floating-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Ink renderer controls');
    toolbar.innerHTML = '<button type="button" data-tic="engine-button">Ink: Web</button>';
    const dock = document.createElement('div');
    dock.className = PREFIX + ' tic-dock';
    dock.hidden = true;
    dock.innerHTML = '<p class="tic-message" data-tic="notice" role="alert" aria-live="assertive" aria-atomic="true"></p><button type="button" data-tic="dismiss" aria-label="Dismiss ink notification">Dismiss</button>';
    const engineButton = toolbar.querySelector('[data-tic="engine-button"]');
    const notice = dock.querySelector('[data-tic="notice"]');
    state.ui = { style, toolbar, dock, engineButton, notice };
    document.head.appendChild(style);
    document.body.append(toolbar, dock);
    listen(engineButton, 'click', () => {
      if (state.status) void switchEngine(state.status.engine === 'web' ? 'pencilkit' : 'web');
    });
    listen(dock.querySelector('[data-tic="dismiss"]'), 'click', () => {
      clearNotice();
      if (!engineButton.disabled && !toolbar.hidden) engineButton.focus();
    });
  }

  function ensureUI() {
    if (state.ui || state.disposed || document.readyState === 'loading' || !availableApi()) return;
    if (document.getElementById(PREFIX + '-toolbar')) return;
    createUI();
    refreshStatus();
    if (!mountToolbar() && typeof MutationObserver === 'function') {
      state.observer = new MutationObserver(() => {
        if (mountToolbar()) stopObserving();
      });
      state.observer.observe(document.body, { childList: true, subtree: true });
      state.observerTimer = window.setTimeout(stopObserving, 10000);
    }
    render();
  }

  function onPageHide(event) {
    if (state.disposed) return;
    state.disposed = true;
    state.epoch += 1;
    state.phase = 'idle';
    state.listeners.splice(0).forEach(unregister => unregister());
    stopObserving();
    if (state.ui) {
      [state.ui.toolbar, state.ui.dock, state.ui.style].forEach(element => element.remove());
      state.ui = null;
    }
    if (event.persisted) window.addEventListener('pageshow', activate, { once: true });
  }

  function activate() {
    state.disposed = false;
    state.epoch += 1;
    listen(window, 'tenet:ink-status', onStatus);
    listen(window, 'pagehide', onPageHide);
    if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', ensureUI, { once: true });
    else ensureUI();
  }

  activate();
})();
