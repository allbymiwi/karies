/* ui.js (updated with final-state lock + reset button) */
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

  // reset button element (created when needed)
  let resetBtnEl = null;

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

  // create reset button (only once) and attach to DOM
  function createResetButton() {
    if (resetBtnEl) return resetBtnEl;
    resetBtnEl = document.createElement('button');
    resetBtnEl.id = 'resetBtn';
    resetBtnEl.textContent = 'Reset';
    // basic styling (you can move to CSS)
    Object.assign(resetBtnEl.style, {
      position: 'absolute',
      bottom: '18px',
      right: '16px',
      zIndex: '60',
      padding: '10px 14px',
      borderRadius: '10px',
      background: '#ff5252',
      color: '#fff',
      border: 'none',
      fontWeight: '700',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      cursor: 'pointer',
    });
    resetBtnEl.addEventListener('click', onResetClicked);
    document.body.appendChild(resetBtnEl);
    return resetBtnEl;
  }

  function removeResetButton() {
    if (!resetBtnEl) return;
    resetBtnEl.removeEventListener('click', onResetClicked);
    if (resetBtnEl.parentElement) resetBtnEl.parentElement.removeChild(resetBtnEl);
    resetBtnEl = null;
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
    // remove reset button after clicked (it can be re-created later if needed)
    removeResetButton();
  }

  // notify AR UI that model is placed -> enable UI and sync health
  window.addEventListener('model-placed', (ev) => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();
    // sync AR with current health
    window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue } }));
  });

  // handle UI-driven reset from elsewhere (if needed)
  window.addEventListener('perform-ui-reset', () => {
    onResetClicked();
  });

  // button handlers
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!toothReady) {
        fadeInfo("Model belum siap. Arahkan kamera & tunggu model muncul.");
        return;
      }
      handleAction(action);
      // notify AR general action (optional)
      window.dispatchEvent(new CustomEvent('ui-action', { detail: action }));
      // always notify AR of health update so it can swap model
      window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue } }));
      // check terminal condition after update
      checkTerminalState();
    });
  });

  function fadeInfo(text) {
    if (!info) return;
    info.style.opacity = 0;
    setTimeout(() => {
      info.textContent = text;
      info.style.opacity = 1;
    }, 180);
  }

  function updateBars() {
    if (cleanFill) cleanFill.style.width = clamp100(cleanValue) + "%";
    if (healthFill) healthFill.style.width = clamp100(healthValue) + "%";
  }

  function handleAction(action) {
    switch(action) {
      case 'brush':
        // Brush: langsung +25 kebersihan & +25 kesehatan
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        // brushing should reset sweet/healthy counters
        sweetCount = 0;
        healthyCount = 0;
        fadeInfo("🪥 Kamu menggosok gigi: kebersihan +25%, kesehatan +25%!");
        break;

      case 'sweet':
        // Sweet: kebersihan -12.5; setiap 2x -> health -25
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
        // Healthy food: kebersihan +12.5; after 2x -> health +25
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
        console.warn('Unknown action', action);
        return;
    }

    // clamp and update bars
    cleanValue = clamp100(cleanValue);
    healthValue = clamp100(healthValue);
    updateBars();

    // final messages for extremes
    if (healthValue <= 0) {
      fadeInfo("💀 Gigi rusak total! Sikat gigi untuk memulihkan.");
    } else if (healthValue >= 100 && cleanValue >= 100) {
      fadeInfo("✨ Gigi sangat sehat dan bersih!");
    }
  }

  function checkTerminalState() {
    // Terminal condition: both cleanliness and health are 0
    if (cleanValue <= 0 && healthValue <= 0) {
      // Lock all action buttons
      setButtonsEnabled(false);

      // show irreversible damage message
      fadeInfo("⚠️ Gigi sudah rusak parah — struktur gigi rusak, infeksi mencapai ujung akar. Perawatan terakhir: saluran akar atau pencabutan. Tidak bisa diperbaiki di aplikasi ini.");

      // show reset button so user can restart
      createResetButton();
    }
  }

  // expose for debugging
  window.kariesUI = {
    _getState: () => ({ cleanValue, healthValue, sweetCount, healthyCount }),
    setAction: (a) => handleAction(a),
    updateBars, fadeInfo, setButtonsEnabled, createResetButton, removeResetButton
  };
})();
