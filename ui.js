/* ui.js - clean UI wiring (controls visible only in AR) */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');

  // NEW: Tooth status elements
  const toothStatusIcon = document.getElementById('toothStatusIcon');
  const toothStatusText = document.getElementById('toothStatusText');
  const barsContainer = document.getElementById('bars');
  const toothStatusContainer = document.getElementById('toothStatus');

  // NEW extra buttons
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');

  // NEW scale buttons
  const scaleUpBtn = document.getElementById('scaleUpBtn');
  const scaleDownBtn = document.getElementById('scaleDownBtn');

  // containers (to toggle visibility)
  const extraButtonsContainer = document.getElementById('extraButtons');
  const scaleButtonsContainer = document.getElementById('scaleButtons');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // counters for repeated actions
  let sweetCount = 0;
  let healthyCount = 0;

  // track whether currently in XR session
  let inXR = false;

  // NEW: Function to update tooth status based on current health model
  function updateToothStatus(healthKey = null) {
    if (!toothReady || healthKey === null) {
      // No tooth placed
      toothStatusIcon.src = 'odontogram/odontogram_hilang.png';
      toothStatusText.textContent = 'Gigi tidak ada';
      return;
    }

    // Update based on health key
    switch(healthKey) {
      case 100: // gigisehat.glb
        toothStatusIcon.src = 'odontogram/odontogram_normal.png';
        toothStatusText.textContent = 'Odontogram: Gigi sehat';
        break;
      case 75: // gigiplak.glb
        toothStatusIcon.src = 'odontogram/odontogram_normal.png';
        toothStatusText.textContent = 'Odontogram: Gigi sehat';
        break;
      case 50: // gigiasam.glb
        toothStatusIcon.src = 'odontogram/odontogram_karang.png';
        toothStatusText.textContent = 'Odontogram: Gigi karang';
        break;
      case 25: // gigidemineralisasi.glb
        toothStatusIcon.src = 'odontogram/odontogram_karang.png';
        toothStatusText.textContent = 'Odontogram: Gigi karang';
        break;
      case 0: // gigikaries.glb
        toothStatusIcon.src = 'odontogram/odontogram_karies.png';
        toothStatusText.textContent = 'Odontogram: Gigi karies';
        break;
      default:
        toothStatusIcon.src = 'odontogram/odontogram_hilang.png';
        toothStatusText.textContent = 'Odontogram: Gigi hilang';
    }
  }

  // NEW: Function to show/hide AR UI elements
  function showARUI(show) {
    if (barsContainer) {
      if (show) {
        barsContainer.classList.add('visible-ar');
      } else {
        barsContainer.classList.remove('visible-ar');
      }
    }
    if (toothStatusContainer) {
      if (show) {
        toothStatusContainer.classList.add('visible-ar');
      } else {
        toothStatusContainer.classList.remove('visible-ar');
      }
    }
  }

  // initially buttons disabled until model placed; extra/scale hidden (CSS handles hidden by default)
  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.tabIndex = enabled ? 0 : -1;
      if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    });
    // scale buttons mirror action-buttons (only usable when model placed)
    if (scaleUpBtn) {
      scaleUpBtn.style.opacity = enabled ? '1' : '0.55';
      scaleUpBtn.style.pointerEvents = enabled ? 'auto' : 'none';
      scaleUpBtn.tabIndex = enabled ? 0 : -1;
      if (enabled) scaleUpBtn.removeAttribute('aria-disabled'); else scaleUpBtn.setAttribute('aria-disabled', 'true');
    }
    if (scaleDownBtn) {
      scaleDownBtn.style.opacity = enabled ? '1' : '0.55';
      scaleDownBtn.style.pointerEvents = enabled ? 'auto' : 'none';
      scaleDownBtn.tabIndex = enabled ? 0 : -1;
      if (enabled) scaleDownBtn.removeAttribute('aria-disabled'); else scaleDownBtn.setAttribute('aria-disabled', 'true');
    }

    // NOTE: Reset / Exit visibility & interactivity are controlled by inXR + CSS class.
    // Do NOT force them here; they become interactive when inXR === true and container has .visible-controls.
  }
  setButtonsEnabled(false);

  // helpers to show/hide AR-only controls
  function showARControls(show) {
    inXR = !!show;
    if (show) {
      if (extraButtonsContainer) extraButtonsContainer.classList.add('visible-controls');
      if (scaleButtonsContainer) scaleButtonsContainer.classList.add('visible-controls');
      // NEW: Show AR UI elements
      showARUI(true);
    } else {
      if (extraButtonsContainer) extraButtonsContainer.classList.remove('visible-controls');
      if (scaleButtonsContainer) scaleButtonsContainer.classList.remove('visible-controls');
      // NEW: Hide AR UI elements
      showARUI(false);
    }
    // When hiding AR controls, ensure they can't be focused or clicked
    if (!show) {
      if (resetBtn) { resetBtn.tabIndex = -1; resetBtn.setAttribute('aria-hidden', 'true'); }
      if (exitBtn)  { exitBtn.tabIndex = -1;  exitBtn.setAttribute('aria-hidden', 'true'); }
      if (scaleUpBtn) { scaleUpBtn.tabIndex = -1; scaleUpBtn.setAttribute('aria-hidden', 'true'); }
      if (scaleDownBtn) { scaleDownBtn.tabIndex = -1; scaleDownBtn.setAttribute('aria-hidden', 'true'); }
    } else {
      if (resetBtn) { resetBtn.tabIndex = 0; resetBtn.removeAttribute('aria-hidden'); }
      if (exitBtn)  { exitBtn.tabIndex = 0;  exitBtn.removeAttribute('aria-hidden'); }
      // scale buttons remain controlled by setButtonsEnabled (enabled only when model placed)
      if (scaleUpBtn) scaleUpBtn.removeAttribute('aria-hidden');
      if (scaleDownBtn) scaleDownBtn.removeAttribute('aria-hidden');
    }
  }

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

  // Scale buttons -> dispatch scale-request
  if (scaleUpBtn) {
    scaleUpBtn.addEventListener('click', () => {
      if (!toothReady) {
        fadeInfo("Tempatkan model terlebih dahulu untuk mengubah ukuran.");
        return;
      }
      window.dispatchEvent(new CustomEvent('scale-request', { detail: { dir: +1 } }));
    });
  }
  if (scaleDownBtn) {
    scaleDownBtn.addEventListener('click', () => {
      if (!toothReady) {
        fadeInfo("Tempatkan model terlebih dahulu untuk mengubah ukuran.");
        return;
      }
      window.dispatchEvent(new CustomEvent('scale-request', { detail: { dir: -1 } }));
    });
  }

  // Reset button -> dispatch reset & update UI state
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      // only allow when inXR
      if (!inXR) { fadeInfo("Fitur ini hanya tersedia saat berada di AR."); return; }
      // inform AR system to reset scene
      window.dispatchEvent(new CustomEvent('reset'));
      // reset local UI values & lock actions until model placed again
      resetUIState();
    });
  }

  // Exit AR button -> request exit; index.js will handle ending session
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      if (!inXR) { fadeInfo("Fitur ini hanya tersedia saat berada di AR."); return; }
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

    // Dispatch last action so index.js knows which button triggered this animation
    // (Important: we dispatch BEFORE performActionEffect so index.js can choose message
    //  based on both lastAction and the updated health.)
    window.dispatchEvent(new CustomEvent('ui-last-action', { detail: { action } }));

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
    // NEW: Update tooth status to initial healthy state
    updateToothStatus(100);
  });

  // when XR started: hide Enter AR button and show AR-only controls
  window.addEventListener('xr-started', () => {
    if (xrBtn) xrBtn.classList.add('hidden');
    fadeInfo("Arahkan kamera ke model dan tekan salah satu aksi.");

    // show AR controls (scale + extra) and AR UI elements
    showARControls(true);

    // note: action buttons still controlled by model-placed (so they remain disabled until model is placed)
  });

  // when XR ended: show Enter AR again and hide AR-only controls
  window.addEventListener('xr-ended', () => {
    if (xrBtn) xrBtn.classList.remove('hidden');
    toothReady = false;
    setButtonsEnabled(false);
    fadeInfo("AR berhenti. Arahkan kamera ke lantai dan tekan Enter AR.");

    // hide AR-only controls and AR UI elements
    showARControls(false);
    
    // NEW: Reset tooth status when AR ends
    updateToothStatus(null);
  });

  // local state changes (if some other part dispatches health-changed directly)
  window.addEventListener('health-changed', (e) => {
    const d = e.detail || {};
    if (typeof d.health === 'number') {
      healthValue = d.health;
      // NEW: Update tooth status based on health value
      const healthKey = getHealthKeyFromValue(healthValue);
      updateToothStatus(healthKey);
    }
    if (typeof d.clean === 'number') cleanValue = d.clean;
    updateBars();
  });

  // NEW: Helper function to convert health value to health key
  function getHealthKeyFromValue(health) {
    if (health >= 100) return 100;
    if (health >= 75) return 75;
    if (health >= 50) return 50;
    if (health >= 25) return 25;
    return 0;
  }

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
        cleanValue = clamp100(cleanValue - 12.5);
        sweetCount++;
        if (sweetCount >= 2) {
          sweetCount = 0;
          healthValue = clamp100(healthValue - 25);
          fadeInfo("🍭 Terlalu sering makan manis — kesehatan turun 25%!");
        } else {
          fadeInfo("🍭 Gula menempel — kebersihan sedikit menurun.");
        }
        break;
      case 'healthy':
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
    // NEW: Reset tooth status
    updateToothStatus(null);
    fadeInfo("Model direset, silakan place ulang.");
  }

  // expose for debugging
  window.kariesUI = {
    setButtonsEnabled,
    updateBars,
    fadeInfo,
    updateToothStatus, // NEW: expose tooth status function
    _getState: () => ({ cleanValue, healthValue, sweetCount, healthyCount })
  };

  // initial UI
  updateBars();
  // ensure AR controls hidden initially
  showARControls(false);
  // NEW: Initialize tooth status
  updateToothStatus(null);
})();