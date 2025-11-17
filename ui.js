// ui.js - UI wiring (action buttons -> dispatch ui-action-request),
// show/hide extraButtons on xr-started/xr-ended, reset & exit handlers.

(function(){
  // DOM
  const buttons = document.querySelectorAll('#buttons .action-btn');
  const extraButtons = document.getElementById('extraButtons');
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');
  const xrBtn = document.getElementById('xrBtn');
  const infoText = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');

  // minimal state (UI-only; game logic can live elsewhere)
  let cleanValue = 100;
  let healthValue = 100;

  // helper update bars
  function updateBars() {
    cleanFill.style.width = Math.max(0, Math.min(100, cleanValue)) + '%';
    healthFill.style.width = Math.max(0, Math.min(100, healthValue)) + '%';
  }

  // dispatch ui-action-request when an action button clicked
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (!action) return;
      // disable buttons briefly to avoid spam (AR runtime will re-enable if needed)
      setButtonsEnabled(false);
      // inform AR/index.js to run animation
      window.dispatchEvent(new CustomEvent('ui-action-request', { detail: { action } }));
    });
  });

  // listen for interactor-finished to re-enable buttons and optionally update UI
  window.addEventListener('interactor-finished', (e) => {
    const info = e.detail || {};
    const action = info.action;
    const status = info.status;

    // Re-enable buttons
    setButtonsEnabled(true);

    // Let the higher-level logic update health/clean (app may dispatch 'health-changed').
    // But if you want UI to change values locally, uncomment basic logic below:
    if (status === 'ok' && action) {
      // (OPTIONAL) simple local update: UI will reflect changes if other logic dispatches health-changed
      // For safety we do nothing here: main logic should update health via 'health-changed' event.
    }
  });

  // show extra buttons when AR starts (listen 'xr-started') OR when model placed
  window.addEventListener('xr-started', () => {
    extraButtons.classList.add('active');
    extraButtons.setAttribute('aria-hidden','false');
  });
  // also accept model-placed (in case you want to show on placement)
  window.addEventListener('model-placed', () => {
    extraButtons.classList.add('active');
    extraButtons.setAttribute('aria-hidden','false');
  });

  // hide when AR ended
  window.addEventListener('xr-ended', () => {
    extraButtons.classList.remove('active');
    extraButtons.setAttribute('aria-hidden','true');
  });

  // Reset button -> dispatch reset
  resetBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('reset'));
    // Optionally reset UI bars locally too:
    cleanValue = 100; healthValue = 100; updateBars();
    infoText.textContent = 'Status di-reset. Tempelkan kembali gigi untuk mulai.';
  });

  // Exit button -> call endXRSession (exposed by index.js)
  exitBtn.addEventListener('click', () => {
    if (typeof window.endXRSession === 'function') {
      window.endXRSession();
    } else {
      // fallback: dispatch custom event that index.js could listen to (if implemented)
      window.dispatchEvent(new CustomEvent('request-xr-end'));
    }
  });

  // helper to enable/disable action buttons (also visual)
  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.disabled = !enabled;
      b.style.opacity = enabled ? '1' : '0.6';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
    });
    // extra buttons remain interactive when AR active
    resetBtn.disabled = false;
    exitBtn.disabled = false;
  }

  // listen to health-changed to update progress bars UI (main logic should dispatch this)
  window.addEventListener('health-changed', (e) => {
    const detail = e.detail || {};
    if (typeof detail.clean === 'number') cleanValue = detail.clean;
    if (typeof detail.health === 'number') healthValue = detail.health;
    updateBars();
  });

  // initial UI update
  updateBars();

  // expose small helper in window for debugging
  window._karies_ui = {
    setButtonsEnabled,
    updateBars
  };
})();
