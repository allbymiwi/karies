/* ui.js - robust: match ui-action-request -> interactor-finished (pendingAction),
   prevent double-processing and accidental multi-increments of sweet stage */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');

  const extraButtons = document.getElementById('extraButtons');
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // toothStage counts sweet presses since last RESET (0..8). Brush no longer resets this.
  let toothStage = 0;
  let healthyCount = 0;

  // Guards
  let processingInteractor = false;
  let pendingAction = null;
  let pendingActionTimer = null;
  const PENDING_ACTION_TIMEOUT = 2500; // ms

  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.tabIndex = enabled ? 0 : -1;
      if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    });
  }
  setButtonsEnabled(false);

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

  function setExtraButtonsVisible(visible) {
    if (!extraButtons) return;
    if (visible) extraButtons.classList.add('visible');
    else extraButtons.classList.remove('visible');
  }
  setExtraButtonsVisible(false);

  // send ui-action-request and set pendingAction so we only accept matching finished events
  function sendUIActionRequest(action) {
    // If there's already a pending action, ignore new requests until processed (prevents rapid double-click)
    if (pendingAction) {
      console.warn('ui-action-request ignored: another action pending', { pendingAction, newAction: action });
      return false;
    }
    pendingAction = action;
    // safety timer to clear pendingAction in case interactor-finished never comes
    if (pendingActionTimer) clearTimeout(pendingActionTimer);
    pendingActionTimer = setTimeout(() => {
      console.warn('pendingAction timed out and cleared', { pendingAction });
      pendingAction = null;
      pendingActionTimer = null;
      // re-enable action buttons if not terminal
      if (!(cleanValue <= 0 && healthValue <= 0)) setButtonsEnabled(true);
    }, PENDING_ACTION_TIMEOUT);

    window.dispatchEvent(new CustomEvent('ui-action-request', { detail: { action } }));
    return true;
  }

  // attach to buttons
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!toothReady) {
        fadeInfo("Model belum siap. Arahkan kamera & tunggu model muncul.");
        return;
      }
      // disable UI immediately and send action request
      setButtonsEnabled(false);
      fadeInfo("Memainkan animasi...");
      const ok = sendUIActionRequest(action);
      if (!ok) {
        // re-enable briefly so user can try again
        setTimeout(() => { setButtonsEnabled(true); }, 200);
      }
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

  // ----------------- interactor-finished (with pendingAction + processing guard) -----------------
  window.addEventListener('interactor-finished', (e) => {
    // If interactor finished without a pendingAction, ignore it (could be stray)
    const d = e.detail || {};
    const action = d.action;
    const status = d.status;

    if (!pendingAction) {
      console.warn('interactor-finished ignored: no pendingAction', { action, status });
      return;
    }

    // Only process if the finished action matches the pendingAction
    if (action !== pendingAction) {
      console.warn('interactor-finished ignored: action mismatch', { pendingAction, action });
      return;
    }

    // Prevent re-entrancy
    if (processingInteractor) {
      console.warn('interactor-finished ignored: already processing');
      return;
    }
    processingInteractor = true;

    // clear pendingAction timer & value immediately (we will handle result)
    if (pendingActionTimer) { clearTimeout(pendingActionTimer); pendingActionTimer = null; }
    pendingAction = null;

    try {
      if (status !== 'ok') {
        fadeInfo(status === 'skipped' ? "Animasi tidak dijalankan." : "Terjadi error animasi.");
        // re-enable unless terminal
        setTimeout(() => {
          if (!(cleanValue <= 0 && healthValue <= 0)) setButtonsEnabled(true);
        }, 300);
        return;
      }

      performActionEffect(action);

      updateBars();
      window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue, clean: cleanValue } }));

      // terminal check
      if (cleanValue <= 0 && healthValue <= 0) {
        setButtonsEnabled(false);
        // if from sweet final stage we already showed message - keep it
        if (!(toothStage >= 8)) {
          fadeInfo("⚠️ Gigi sudah rusak parah — struktur rusak. Perawatan akhir diperlukan (di dunia nyata).");
        }
        window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'health_and_clean_zero' } }));
      } else {
        setButtonsEnabled(true);
      }
    } finally {
      // small cooldown to avoid very-rapid successive processing
      setTimeout(() => { processingInteractor = false; }, 150);
    }
  });

  // ----------------- other events -----------------
  window.addEventListener('model-placed', () => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();
  });

  window.addEventListener('xr-started', () => {
    if (xrBtn) xrBtn.classList.add('hidden');
    setExtraButtonsVisible(true);
    fadeInfo("Arahkan kamera ke model dan tekan salah satu aksi.");
  });

  window.addEventListener('xr-ended', () => {
    if (xrBtn) xrBtn.classList.remove('hidden');
    setExtraButtonsVisible(false);
    toothReady = false;
    setButtonsEnabled(false);
    fadeInfo("AR berhenti. Arahkan kamera ke lantai dan tekan Enter AR.");
  });

  window.addEventListener('health-changed', (e) => {
    const d = e.detail || {};
    if (typeof d.clean === 'number') cleanValue = d.clean;
    if (typeof d.health === 'number') healthValue = d.health;
    updateBars();
  });

  // ----------------- GAME LOGIC (same desired order: health-first when pair completes) -----------------
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        // Brush increases clean & health but DOES NOT reset toothStage now.
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        healthyCount = 0;
        fadeInfo("🪥 Menggosok gigi: Kebersihan +25%, Kesehatan +25%");
        break;

      case 'sweet':
        // extra sanity: if already terminal, keep final message and ignore
        if (toothStage >= 8) {
          fadeInfo("⚠️ Karies Gigi Parah – Harus Reset — Giginya sudah bolong besar dan nggak bisa diselamatkan... harus mulai ulang ya!");
          return;
        }

        // compute next logical stage
        const nextStage = Math.min(8, toothStage + 1);

        // If the nextStage is even, apply health drop FIRST
        if (nextStage % 2 === 0) {
          healthValue = clamp100(healthValue - 25);
        }

        // Then reduce cleanliness relatively
        cleanValue = clamp100(cleanValue - 12.5);

        // commit stage
        toothStage = nextStage;

        // stage messages & final-stage enforcement
        switch (toothStage) {
          case 1:
            fadeInfo("🍬 Peringatan Plak Gigi — Gulanya nempel di gigi dan mulai bikin plak, hati-hati ya!");
            break;
          case 2:
            fadeInfo("🍬 Plak Gigi (Tetap Diingatkan) — Plaknya makin banyak nih… ayo jangan sering makan permen!");
            break;
          case 3:
            fadeInfo("🍬 Peringatan Asam Laktat — Plak berubah jadi asam yang bisa merusak gigi, hati-hati ya!");
            break;
          case 4:
            fadeInfo("🍬 Asam Laktat (Tetap Diingatkan) — Asamnya makin kuat… gigi bisa mulai rusak kalau terus begini!");
            break;
          case 5:
            fadeInfo("🍬 Peringatan Demineralisasi Email — Lapisan luar gigi mulai melemah, jangan tambah permennya ya!");
            break;
          case 6:
            fadeInfo("🍬 Demineralisasi Email (Tetap Diingatkan) — Email gigi makin rapuh… yuk hentikan sebelum bolong!");
            break;
          case 7:
            fadeInfo("🍬 Peringatan Karies Gigi — Gigi mulai bolong kecil! Ini sudah berbahaya, kurangi manisnya!");
            break;
          case 8:
            fadeInfo("⚠️ Karies Gigi Parah – Harus Reset — Giginya sudah bolong besar dan nggak bisa diselamatkan... harus mulai ulang ya!");
            cleanValue = 0;
            healthValue = 0;
            setButtonsEnabled(false);
            window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'karies_parah_stage8' } }));
            break;
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

  function resetUIState() {
    cleanValue = 100;
    healthValue = 100;
    toothStage = 0; // explicit Reset clears the sweet-stage accumulation
    healthyCount = 0;
    toothReady = false;
    pendingAction = null;
    if (pendingActionTimer) { clearTimeout(pendingActionTimer); pendingActionTimer = null; }
    processingInteractor = false;
    setButtonsEnabled(false);
    updateBars();
    fadeInfo("Model direset, silakan place ulang.");
  }

  window.kariesUI = {
    setButtonsEnabled,
    updateBars,
    fadeInfo,
    _getState: () => ({ cleanValue, healthValue, toothStage, healthyCount, pendingAction, processingInteractor })
  };

  updateBars();
})();
