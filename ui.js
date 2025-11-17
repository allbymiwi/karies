/* ui.js - clean UI wiring (no reset, no extra buttons) */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');

  // NEW extra buttons
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // counters for repeated actions
  let sweetCount = 0;
  let healthyCount = 0;

  // initially buttons disabled until model placed
  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.tabIndex = enabled ? 0 : -1;
      if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    });
    // extra buttons (reset/exit) remain interactive even when action buttons are disabled
    if (resetBtn) {
      resetBtn.style.opacity = '1';
      resetBtn.style.pointerEvents = 'auto';
      resetBtn.tabIndex = 0;
    }
    if (exitBtn) {
      exitBtn.style.opacity = '1';
      exitBtn.style.pointerEvents = 'auto';
      exitBtn.tabIndex = 0;
    }
  }
  setButtonsEnabled(false);

  // UI helpers
  function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v * 100) / 100)); }
  function updateBars() {
    if (cleanFill) cleanFill.style.width = clamp100(cleanValue) + "%";
    if (healthFill) healthFill.style.width = clamp100(healthValue) + "%";
  }
  function fadeInfo(text) {
    if (!info) return;
    info.style.opacity = 0;
    setTimeout(() => {
      info.textContent = text;
      info.style.opacity = 1;
    }, 160);
  }

  // handle clicks -> request animation in index.js
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!toothReady) {
        fadeInfo("Model belum siap. Arahkan kamera & tunggu model muncul.");
        return;
      }
      // request AR to run interactor anim; UI locks buttons until 'interactor-finished'
      setButtonsEnabled(false);
      fadeInfo("Memainkan animasi...");
      window.dispatchEvent(new CustomEvent('ui-action-request', { detail: { action } }));
    });
  });

  // Reset button -> dispatch reset & update UI state
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // inform AR system to reset scene
      window.dispatchEvent(new CustomEvent('reset'));
      // reset local UI values & lock actions until model placed again
      resetUIState();
    });
  }

  // Exit AR button -> request exit; index.js will handle ending session
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('request-exit-ar'));
      fadeInfo("Meminta keluar AR...");
    });
  }

  // when an interactor animation finished, index.js dispatches this event
  // { action, status }
  window.addEventListener('interactor-finished', (e) => {
    const d = e.detail || {};
    const action = d.action;
    const status = d.status;
    if (status !== 'ok') {
      fadeInfo(status === 'skipped' ? "Animasi tidak dijalankan." : "Terjadi error animasi.");
      // re-enable unless terminal; index.js or other logic may emit health-changed next
      setTimeout(() => {
        setButtonsEnabled(true);
      }, 300);
      return;
    }

    // After a successful animation, UI logic updates local state and tells index.js to swap model
    performActionEffect(action);

    // update bars and inform other systems (index.js listens to health-changed to swap model)
    updateBars();
    window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue, clean: cleanValue } }));

    // check terminal condition
    if (cleanValue <= 0 && healthValue <= 0) {
      setButtonsEnabled(false);
      fadeInfo("⚠️ Gigi sudah rusak parah — struktur rusak. Perawatan akhir diperlukan (di dunia nyata).");
      // keep Enter AR handled by xr-ended when session ends
    } else {
      setButtonsEnabled(true);
    }
  });

  // enable buttons when model placed
  window.addEventListener('model-placed', () => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();
  });

  // when XR started: hide Enter AR button
  window.addEventListener('xr-started', () => {
    if (xrBtn) xrBtn.classList.add('hidden');
    fadeInfo("Arahkan kamera ke model dan tekan salah satu aksi.");
  });

  // when XR ended: show Enter AR again and lock UI
  window.addEventListener('xr-ended', () => {
    if (xrBtn) xrBtn.classList.remove('hidden');
    toothReady = false;
    setButtonsEnabled(false);
    fadeInfo("AR berhenti. Arahkan kamera ke lantai dan tekan Enter AR.");
  });

  // local state changes (if some other part dispatches health-changed directly)
  window.addEventListener('health-changed', (e) => {
    const d = e.detail || {};
    if (typeof d.clean === 'number') cleanValue = d.clean;
    if (typeof d.health === 'number') healthValue = d.health;
    updateBars();
  });

  // apply the "game logic" to UI values AFTER animations finish (called by interactor-finished)
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        sweetCount = 0; healthyCount = 0;
        fadeInfo("🪥 Menggosok gigi: Kebersihan +25%, Kesehatan +25%");
        break;
      case 'sweet':
        // FIRST: update counters and apply any health penalty (so health changes show first)
        sweetCount++;
        if (sweetCount >= 2) {
          sweetCount = 0;
          // apply health penalty first so UI shows health change before cleanliness reduction
          healthValue = clamp100(healthValue - 25);
          // then also decrease cleanliness
          cleanValue = clamp100(cleanValue - 12.5);
          fadeInfo("🍭 Terlalu sering makan manis — kesehatan turun 25%!");
        } else {
          // single sweet: still reduce cleanliness but health untouched
          cleanValue = clamp100(cleanValue - 12.5);
          fadeInfo("🍭 Gula menempel — kebersihan sedikit menurun.");
        }
        break;
      case 'healthy':
        // Keep existing healthy logic but apply cleanliness first, then health bump when threshold reached
        cleanValue = clamp100(cleanValue + 12.5);
        healthyCount++;
        if (healthyCount >= 2) {
          healthyCount = 0;
          healthValue = clamp100(healthValue + 25);
          fadeInfo("🥦 Makanan sehat membantu — kesehatan naik 25%!");
        } else {
          fadeInfo("🥗 Makanan sehat menambah kebersihan sedikit.");
        }
        break;
      default:
        console.warn('Unknown action', action);
    }
  }

  // NEW: reset local UI state
  function resetUIState() {
    cleanValue = 100;
    healthValue = 100;
    sweetCount = 0;
    healthyCount = 0;
    toothReady = false;
    setButtonsEnabled(false);
    updateBars();
    fadeInfo("Model direset, silakan place ulang.");
  }

  // expose for debugging
  window.kariesUI = {
    setButtonsEnabled,
    updateBars,
    fadeInfo,
    _getState: () => ({ cleanValue, healthValue, sweetCount, healthyCount })
  };

  // initial UI
  updateBars();
})();
