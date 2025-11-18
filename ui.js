// ui.js — MERGED final (PART 1/3)
// Paste the three parts in order to reconstruct the full file.

(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');

  // NEW extra buttons
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');

  // NEW scale buttons
  const scaleUpBtn = document.getElementById('scaleUpBtn');
  const scaleDownBtn = document.getElementById('scaleDownBtn');

  // containers (to toggle visibility)
  const extraButtonsContainer = document.getElementById('extraButtons');
  const scaleButtonsContainer = document.getElementById('scaleButtons');

  // NEW helper UI elements (small icon + label)
  // If these are not present in DOM they will be created defensively later.
  let helperBar = document.getElementById('helperBar');
  let helperIcon = document.getElementById('helperIcon');
  let helperLabel = document.getElementById('helperLabel');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // counters for repeated actions
  let sweetCount = 0;
  let healthyCount = 0;

  // track whether currently in XR session
  let inXR = false;

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
    } else {
      if (extraButtonsContainer) extraButtonsContainer.classList.remove('visible-controls');
      if (scaleButtonsContainer) scaleButtonsContainer.classList.remove('visible-controls');
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

  // -----------------------
  // NEW: Helper bar logic
  // -----------------------

  // mapping model filenames -> label + icon (odontogram folder)
  const MODEL_HELPER_MAP = {
    'gigisehat.glb':            { text: 'gigi sehat',           icon: 'odontogram/odontogram_normal.png' },
    'gigiplak.glb':             { text: 'gigi plak',            icon: 'odontogram/odontogram_normal.png' },
    'gigiasam.glb':             { text: 'gigi asam',            icon: 'odontogram/odontogram_karang.png' },
    'gigidemineralisasi.glb':   { text: 'gigi demineralisasi',  icon: 'odontogram/odontogram_karang.png' },
    'gigikaries.glb':           { text: 'gigi karies',          icon: 'odontogram/odontogram_karies.png' }
  };
  const NO_TOOTH = { text: 'gigi tidak ada', icon: 'odontogram/odontogram_hilang.png' };

  // Defensive helper: ensure DOM helper block exists; create if missing
  function ensureHelperElements() {
    helperBar = document.getElementById('helperBar');
    helperIcon = document.getElementById('helperIcon');
    helperLabel = document.getElementById('helperLabel');
    if (helperBar && helperIcon && helperLabel) return;

    const bars = document.getElementById('bars');
    if (!bars) return; // can't create if parent not present

    const div = document.createElement('div');
    div.className = 'status-bar helper';
    div.id = 'helperBar';
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');

    const img = document.createElement('img');
    img.id = 'helperIcon';
    img.className = 'helper-icon';
    img.src = NO_TOOTH.icon;
    img.alt = NO_TOOTH.text;

    const span = document.createElement('span');
    span.id = 'helperLabel';
    span.className = 'helper-label';
    span.textContent = NO_TOOTH.text;

    div.appendChild(img);
    div.appendChild(span);
    bars.appendChild(div);

    // reassign references
    helperBar = document.getElementById('helperBar');
    helperIcon = document.getElementById('helperIcon');
    helperLabel = document.getElementById('helperLabel');
  }

  // set helper by model filename or null -> NO_TOOTH
  function setHelperByModelFile(modelFile) {
    ensureHelperElements();
    if (!helperIcon || !helperLabel) return;

    let entry = NO_TOOTH;
    if (modelFile && typeof modelFile === 'string') {
      const name = modelFile.split('/').pop();
      if (MODEL_HELPER_MAP[name]) entry = MODEL_HELPER_MAP[name];
    }

    helperLabel.textContent = entry.text;
    helperIcon.setAttribute('src', entry.icon);
    helperIcon.setAttribute('alt', entry.text);
  }

  // initial helper state
  setHelperByModelFile(null);

  // -----------------------
  // end helper init
  // -----------------------
// ui.js — MERGED final (PART 2/3)
// Continue pasting after Part 1/3

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

      // NEW — also reset helper bar to "gigi tidak ada"
      setHelperByModelFile(null);

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
    } else {
      setButtonsEnabled(true);
    }
  });

  // enable buttons when model placed
  window.addEventListener('model-placed', (e) => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();

    // NEW — sync helper bar when model is placed
    try {
      const detail = e.detail || {};
      const file = detail.modelFile || (detail.userData && detail.userData.modelFile) || null;
      setHelperByModelFile(file);
    } catch (_) {}
  });

  // when XR started: hide Enter AR button and show AR-only controls
  window.addEventListener('xr-started', () => {
    if (xrBtn) xrBtn.classList.add('hidden');
    fadeInfo("Arahkan kamera ke model dan tekan salah satu aksi.");

    showARControls(true);
  });

  // when XR ended: show Enter AR again and hide AR-only controls
  window.addEventListener('xr-ended', () => {
    if (xrBtn) xrBtn.classList.remove('hidden');
    toothReady = false;
    setButtonsEnabled(false);
    fadeInfo("AR berhenti. Arahkan kamera ke lantai dan tekan Enter AR.");

    showARControls(false);

    // NEW — reset helper bar too
    setHelperByModelFile(null);
  });

  // local state changes (if some other part dispatches health-changed directly)
  window.addEventListener('health-changed', (e) => {
    const d = e.detail || {};
    if (typeof d.clean === 'number') cleanValue = d.clean;
    if (typeof d.health === 'number') healthValue = d.health;
    updateBars();

    // NEW: Translate health numeric → model file and update helper bar
    try {
      const h = healthValue;
      let key;
      if      (h >= 100) key = 100;
      else if (h >= 75)  key = 75;
      else if (h >= 50)  key = 50;
      else if (h >= 25)  key = 25;
      else               key = 0;

      const keyToFile = {
        100: "gigisehat.glb",
        75:  "gigiplak.glb",
        50:  "gigiasam.glb",
        25:  "gigidemineralisasi.glb",
        0:   "gigikaries.glb"
      };

      setHelperByModelFile(keyToFile[key]);
    } catch (_) {}
  });

  // fallback event sometimes used by index.js
  window.addEventListener('health-stage-info', (e) => {
    try {
      const d = e.detail || {};
      if (typeof d.key === 'number') {
        const keyToFile = {
          100: "gigisehat.glb",
          75:  "gigiplak.glb",
          50:  "gigiasam.glb",
          25:  "gigidemineralisasi.glb",
          0:   "gigikaries.glb"
        };
        setHelperByModelFile(keyToFile[d.key]);
      }
    } catch (_) {}
  });
// ui.js — MERGED final (PART 3/3)
// Continue pasting after Part 2/3

  // apply the "game logic" to UI values AFTER animations finish (called by interactor-finished)
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        sweetCount = 0; 
        healthyCount = 0;
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
    fadeInfo("Model direset, silakan place ulang.");

    // ALSO reset helper bar
    setHelperByModelFile(null);
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

  // ensure AR controls hidden initially
  showARControls(false);

})(); // end IIFE
