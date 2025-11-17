/* ui.js - updated: sweet action now has 8-stage terminal messages */
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

  // NEW: sweetStage tracks 0..8 presses for "makanan manis"
  let sweetStage = 0;
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
      // emit terminal reached for other listeners
      window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'health_and_clean_zero' } }));
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

  // ------------ GAME LOGIC / ACTION EFFECTS ---------------
  // Sweet-stage messages (1..8)
  const SWEET_MESSAGES = {
    1: "🍬 Peringatan Plak Gigi — Gulanya nempel di gigi dan mulai bikin plak, hati-hati ya!",
    2: "🍬 Plak Gigi (Tetap Diingatkan) — Plaknya makin banyak nih… ayo jangan sering makan permen!",
    3: "🍬 Peringatan Asam Laktat — Plak berubah jadi asam yang bisa merusak gigi, hati-hati ya!",
    4: "🍬 Asam Laktat (Tetap Diingatkan) — Asamnya makin kuat… gigi bisa mulai rusak kalau terus begini!",
    5: "🍬 Peringatan Demineralisasi Email — Lapisan luar gigi mulai melemah, jangan tambah permennya ya!",
    6: "🍬 Demineralisasi Email (Tetap Diingatkan) — Email gigi makin rapuh… yuk hentikan sebelum bolong!",
    7: "🍬 Peringatan Karies Gigi — Gigi mulai bolong kecil! Ini sudah berbahaya, kurangi manisnya!",
    8: "⚠️ Karies Gigi Parah – Harus Reset — Giginya sudah bolong besar dan nggak bisa diselamatkan... harus mulai ulang ya!"
  };

  // apply the "game logic" to UI values AFTER animations finish (called by interactor-finished)
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        sweetStage = 0; healthyCount = 0;
        fadeInfo("🪥 Menggosok gigi: Kebersihan +25%, Kesehatan +25%");
        break;
      case 'sweet':
        // Each sweet press is one stage out of 8. Each press reduces clean by 12.5 (100/8).
        if (sweetStage < 8) sweetStage++;
        cleanValue = clamp100(cleanValue - (100 / 8));

        // Show the corresponding stage message
        const msg = SWEET_MESSAGES[sweetStage] || "🍭 Gula menempel — kebersihan turun.";
        fadeInfo(msg);

        // If reached final stage (8), force terminal: set both bars 0 and disable actions
        if (sweetStage >= 8) {
          cleanValue = 0;
          healthValue = 0;
          // inform other systems: health-changed + terminal
          // updateBars() + dispatch happen after this function returns in interactor-finished handler
          setButtonsEnabled(false);
          // also dispatch a terminal-reached event for index.js or other listeners
          window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'karies_parah_stage8' } }));
        } else {
          // optionally, keep previous mechanic of health drop after some repeats:
          // here we'll optionally penalize health at stage 4 and stage 6 as extra realism
          if (sweetStage === 4) {
            healthValue = clamp100(healthValue - 12.5);
            // small extra message appended
            // note: fadeInfo already showed main message; we briefly update after
            setTimeout(() => fadeInfo(SWEET_MESSAGES[sweetStage] + " (Asam mulai mengganggu kesehatan gigi.)"), 900);
          }
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
    sweetStage = 0;
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
    _getState: () => ({ cleanValue, healthValue, sweetStage, healthyCount })
  };

  // initial UI
  updateBars();
})();
