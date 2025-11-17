/* ui.js - clean UI wiring (extra buttons visible only in AR) - FIXED sweet logic */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');

  // NEW: references to extra buttons container + buttons
  const extraButtons = document.getElementById('extraButtons');
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // counters for repeated actions
  // toothStage: 0..8 (counts sweet presses / stages)
  let toothStage = 0;
  let healthyCount = 0;

  // initially action buttons disabled until model placed
  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.tabIndex = enabled ? 0 : -1;
      if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    });
    // DO NOT force extraButtons here — visibility is controlled by xr-started/xr-ended
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

  // show/hide extra buttons (called on xr-started/xr-ended)
  function setExtraButtonsVisible(visible) {
    if (!extraButtons) return;
    if (visible) extraButtons.classList.add('visible');
    else extraButtons.classList.remove('visible');
  }
  // ensure hidden by default
  setExtraButtonsVisible(false);

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
      // If terminal came from sweet final stage, keep that message visible (do not override).
      if (typeof toothStage === 'number' && toothStage >= 8) {
        // leave final sweet-stage message as-is
      } else {
        fadeInfo("⚠️ Gigi sudah rusak parah — struktur rusak. Perawatan akhir diperlukan (di dunia nyata).");
      }
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

  // when XR started: hide Enter AR button + show extra buttons
  window.addEventListener('xr-started', () => {
    if (xrBtn) xrBtn.classList.add('hidden');
    // show reset/exit now AR active
    setExtraButtonsVisible(true);
    fadeInfo("Arahkan kamera ke model dan tekan salah satu aksi.");
  });

  // when XR ended: show Enter AR again, hide extra buttons, and lock UI
  window.addEventListener('xr-ended', () => {
    if (xrBtn) xrBtn.classList.remove('hidden');
    // hide reset/exit after AR ends
    setExtraButtonsVisible(false);
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
        // brushing clears accumulated sweet presses (plak dihapus)
        toothStage = 0;
        healthyCount = 0;
        fadeInfo("🪥 Menggosok gigi: Kebersihan +25%, Kesehatan +25%");
        break;

      case 'sweet':
        // setiap tekan mengurangi kebersihan sedikit
        // guard: if already at final stage, show final message and ignore further sweet presses
        if (toothStage >= 8) {
          fadeInfo("⚠️ Giginya sudah bolong besar dan nggak bisa diselamatkan... Harus mulai ulang ya!");
          return;
        }

        // reduce cleanliness per press
        cleanValue = clamp100(cleanValue - 12.5);

        // increment toothStage (1..8)
        toothStage = (typeof toothStage === 'number') ? Math.min(8, toothStage + 1) : 1;

        // every 2 presses reduce health by 25 (i.e., when toothStage is even: 2,4,6,8)
        if (toothStage % 2 === 0) {
          healthValue = clamp100(healthValue - 25);
        }

        // tampilkan pesan sesuai tahap (urutan yang kamu minta)
        switch (toothStage) {
          case 1:
            fadeInfo("🍬 Peringatan Plak Gigi — Gulanya nempel di gigi dan mulai bikin plak, hati-hati ya!");
            cleanValue = 87.5;
            healthValue = 100;
            break;
          case 2:
            fadeInfo("🍬 Plak Gigi (Tetap Diingatkan) — Plaknya makin banyak nih… ayo jangan sering makan permen!");
            cleanValue = 75;
            healthValue = 75;
            break;
          case 3:
            fadeInfo("🍬 Peringatan Asam Laktat — Plak berubah jadi asam yang bisa merusak gigi, hati-hati ya!");
            cleanValue = 62.5;
            healthValue = 75;
            break;
          case 4:
            fadeInfo("🍬 Asam Laktat (Tetap Diingatkan) — Asamnya makin kuat… gigi bisa mulai rusak kalau terus begini!");
            cleanValue = 50;
            healthValue = 50;
            break;
          case 5:
            fadeInfo("🍬 Peringatan Demineralisasi Email — Lapisan luar gigi mulai melemah, jangan tambah permennya ya!");
            cleanValue = 37.5;
            healthValue = 50;
            break;
          case 6:
            fadeInfo("🍬 Demineralisasi Email (Tetap Diingatkan) — Email gigi makin rapuh… yuk hentikan sebelum bolong!");
            break;
            cleanValue = 25;
            healthValue = 25;
          case 7:
            fadeInfo("🍬 Peringatan Karies Gigi — Gigi mulai bolong kecil! Ini sudah berbahaya, kurangi manisnya!");
            break;
            cleanValue = 12.5;
            healthValue = 25;
          case 8:
            // final stage: keep this message visible and enforce terminal
            fadeInfo("⚠️ Karies Gigi Parah – Harus Reset — Giginya sudah bolong besar dan nggak bisa diselamatkan... harus mulai ulang ya!");
            cleanValue = 0;
            healthValue = 0;
            setButtonsEnabled(false);
            // dispatch terminal-reached so index.js & other listeners can react
            window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'karies_parah_stage8' } }));
            break;
          default:
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
    toothStage = 0;
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
    _getState: () => ({ cleanValue, healthValue, toothStage, healthyCount })
  };

  // initial UI
  updateBars();
})();
