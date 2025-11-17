/* ui.js (updated) — Reset button appears when AR starts and positioned under the action buttons) */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // counters for repeated actions
  let sweetCount = 0;    // 2x sweet -> health -25
  let healthyCount = 0;  // 2x healthy -> health +25

  // reset button element (may be created on XR start)
  let resetBtnEl = null;

  // helper to enable/disable action buttons
  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.tabIndex = enabled ? 0 : -1;
      if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    });
  }
  // initially disabled until model placed
  setButtonsEnabled(false);

  // helper: clamp value 0..100 with 2 decimals
  function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v * 100) / 100)); }

  // create reset button and attach UNDER the #buttons container
  function createResetButton() {
    if (resetBtnEl) return resetBtnEl;

    const container = document.getElementById('extraButtons') || (() => {
      // create container if not present
      const c = document.createElement('div');
      c.id = 'extraButtons';
      const ui = document.getElementById('ui') || document.body;
      const buttonsEl = document.getElementById('buttons');
      if (buttonsEl && buttonsEl.parentElement) {
        buttonsEl.parentElement.insertBefore(c, buttonsEl.nextSibling);
      } else {
        ui.appendChild(c);
      }
      return c;
    })();

    resetBtnEl = document.createElement('button');
    resetBtnEl.id = 'resetBtn';
    resetBtnEl.textContent = 'Reset';
    resetBtnEl.addEventListener('click', onResetClicked);

    // Ensure style (if ui.css not loaded yet) - default is in CSS but we keep safe fallback
    Object.assign(resetBtnEl.style, {
      padding: '10px 18px',
      fontSize: '14px',
      fontWeight: '600',
      borderRadius: '12px',
      border: 'none',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      color: '#fff',
      background: 'linear-gradient(180deg,#5bb0ff,#2177ff)'
    });

    container.appendChild(resetBtnEl);
    container.setAttribute('aria-hidden', 'false');

    return resetBtnEl;
  }

  function removeResetButton() {
    if (!resetBtnEl) return;
    resetBtnEl.removeEventListener('click', onResetClicked);
    if (resetBtnEl.parentElement) resetBtnEl.parentElement.removeChild(resetBtnEl);
    resetBtnEl = null;
    const container = document.getElementById('extraButtons');
    if (container) container.setAttribute('aria-hidden', 'true');
  }

  function onResetClicked() {
    // Send reset event so AR (index.js) can remove model
    window.dispatchEvent(new CustomEvent('reset'));
    // Reset UI state
    cleanValue = 100;
    healthValue = 100;
    sweetCount = 0;
    healthyCount = 0;
    updateBars();
    fadeInfo("Pengalaman di-reset. Tempatkan model lagi untuk memulai ulang.");
    // Disable action buttons until model-placed again
    setButtonsEnabled(false);
    // Keep reset button present (user wanted reset available from AR start),
    // so we don't remove it here; it remains until AR ends.
  }

  // notify AR UI that model is placed -> enable UI and sync health
  window.addEventListener('model-placed', (ev) => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();
  });

  // also show reset as soon as AR starts (so it's available from the beginning of AR)
  window.addEventListener('xr-started', () => {
    createResetButton();
  });

  // hide/reset button when AR ends
  window.addEventListener('xr-ended', () => {
    removeResetButton();
    // also ensure UI lock
    setButtonsEnabled(false);
  });

  // handle interactor finished notifications from index.js
  // detail: { action: 'brush'|'healthy'|'sweet', status: 'ok'|'skipped'|'error' }
  window.addEventListener('interactor-finished', (e) => {
    const d = e.detail || {};
    const action = d.action;
    const status = d.status;
    // if cancelled/skipped/error -> re-enable buttons unless terminal
    if (status !== 'ok') {
      fadeInfo(status === 'skipped' ? "Animasi tidak dijalankan." : "Terjadi error animasi.");
      safeEnableButtonsIfNotTerminal();
      return;
    }
    // perform actual state change AFTER animation finished
    performActionEffect(action);
    // update UI & dispatch health-changed for model swap
    updateBars();
    window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue } }));
    // check terminal condition and either enable buttons or show terminal message
    checkTerminalState();
  });

  // button handlers now REQUEST animation (do not change values immediately)
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!toothReady) {
        fadeInfo("Model belum siap. Arahkan kamera & tunggu model muncul.");
        return;
      }

      // request animation from index.js, UI disables buttons and waits for 'interactor-finished'
      setButtonsEnabled(false);
      fadeInfo("Memainkan animasi...");
      window.dispatchEvent(new CustomEvent('ui-action-request', { detail: { action } }));
    });
  });

  function fadeInfo(text) {
    if (!info) return;
    info.style.opacity = 0;
    setTimeout(() => {
      info.textContent = text;
      info.style.opacity = 1;
    }, 160);
  }

  function updateBars() {
    if (cleanFill) cleanFill.style.width = clamp100(cleanValue) + "%";
    if (healthFill) healthFill.style.width = clamp100(healthValue) + "%";
  }

  // this performs the actual effect to cleanValue/healthValue (called AFTER animation)
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        sweetCount = 0;
        healthyCount = 0;
        fadeInfo("🪥 Menggosok gigi selesai — kebersihan +25%, kesehatan +25%!");
        break;

      case 'sweet':
        cleanValue = clamp100(cleanValue - 12.5);
        sweetCount++;
        if (sweetCount >= 2) {
          sweetCount = 0;
          healthValue = clamp100(healthValue - 25);
          fadeInfo("🍭 Terlalu sering makan manis — kesehatan turun 25%!");
        } else {
          fadeInfo("🍭 Gula menempel! Kebersihan menurun sedikit...");
        }
        break;

      case 'healthy':
        cleanValue = clamp100(cleanValue + 12.5);
        healthyCount++;
        if (healthyCount >= 2) {
          healthyCount = 0;
          healthValue = clamp100(healthValue + 25);
          fadeInfo("🥦 Makanan sehat! Kesehatan naik 25% (setelah dua makanan sehat).");
        } else {
          fadeInfo("🥗 Makanan sehat menambah kebersihan sedikit...");
        }
        break;

      default:
        console.warn('Unknown action to perform effect:', action);
        return;
    }
  }

  function safeEnableButtonsIfNotTerminal() {
    const terminal = (cleanValue <= 0 && healthValue <= 0);
    if (!terminal) setButtonsEnabled(true);
    else {
      // Terminal - lock buttons, show terminal message and keep reset available
      setButtonsEnabled(false);
      fadeInfo("⚠️ Gigi sudah rusak parah — struktur gigi rusak, infeksi mencapai ujung akar. Perawatan terakhir: saluran akar atau pencabutan. Tidak bisa diperbaiki di aplikasi ini.");
      createResetButton();
    }
  }

  function checkTerminalState() {
    if (cleanValue <= 0 && healthValue <= 0) {
      // Terminal condition: lock and show terminal message (reset remains)
      setButtonsEnabled(false);
      fadeInfo("⚠️ Gigi sudah rusak parah — struktur gigi rusak, infeksi mencapai ujung akar. Perawatan terakhir: saluran akar atau pencabutan. Tidak bisa diperbaiki di aplikasi ini.");
      createResetButton();
    } else {
      // not terminal -> enable buttons again
      setButtonsEnabled(true);
    }
  }

  // expose for debugging
  window.kariesUI = {
    _getState: () => ({ cleanValue, healthValue, sweetCount, healthyCount }),
    setActionRequest: (a) => { window.dispatchEvent(new CustomEvent('ui-action-request', { detail: { action: a } })); },
    updateBars, fadeInfo, setButtonsEnabled, createResetButton, removeResetButton
  };
})();
