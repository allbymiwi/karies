/* ui.js - fixed: prevent double-processing & sanity checks so sweet won't unexpectedly zero both bars */
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

  // Guard to prevent processing the same interactor result twice
  let processingInteractor = false;

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

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!toothReady) {
        fadeInfo("Model belum siap. Arahkan kamera & tunggu model muncul.");
        return;
      }
      setButtonsEnabled(false);
      fadeInfo("Memainkan animasi...");
      window.dispatchEvent(new CustomEvent('ui-action-request', { detail: { action } }));
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('reset'));
      resetUIState();
    });
  }
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('request-exit-ar'));
      fadeInfo("Meminta keluar AR...");
    });
  }

  // ----------------- interactor-finished (with processing guard) -----------------
  window.addEventListener('interactor-finished', (e) => {
    // Prevent re-entrancy / double-processing
    if (processingInteractor) {
      console.warn('interactor-finished ignored: already processing previous event');
      return;
    }
    processingInteractor = true;

    try {
      const d = e.detail || {};
      const action = d.action;
      const status = d.status;
      if (status !== 'ok') {
        fadeInfo(status === 'skipped' ? "Animasi tidak dijalankan." : "Terjadi error animasi.");
        // re-enable UI in non-terminal case
        setTimeout(() => { setButtonsEnabled(true); }, 300);
        return;
      }

      performActionEffect(action);

      updateBars();
      window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue, clean: cleanValue } }));

      if (cleanValue <= 0 && healthValue <= 0) {
        setButtonsEnabled(false);
        if (typeof toothStage === 'number' && toothStage >= 8) {
          // keep final sweet message visible
        } else {
          fadeInfo("⚠️ Gigi sudah rusak parah — struktur rusak. Perawatan akhir diperlukan (di dunia nyata).");
        }
        window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'health_and_clean_zero' } }));
      } else {
        setButtonsEnabled(true);
      }
    } finally {
      // small delay before allowing next interactor event to avoid double-fires
      // this also handles cases where events inadvertently fire very rapidly
      setTimeout(() => { processingInteractor = false; }, 250);
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

  // ----------------- GAME LOGIC (robust ordering & guards) -----------------
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

        // determine nextStage but do not allow accidental big jumps
        const nextStage = Math.min(8, toothStage + 1);

        // PROTECTION: if nextStage would become 8 but health is already <= 0 due to other causes,
        // avoid forcing abrupt double-zero unless it's an intended stage-8 effect.
        // (we still allow stage 8 to enforce terminal when reached legitimately)
        if (nextStage === toothStage) {
          // no stage change - should not happen but guard anyway
          console.warn('sweet pressed but nextStage == toothStage', { toothStage });
        }

        // If the action completes a pair (nextStage even) -> health drops FIRST
        if (nextStage % 2 === 0) {
          // reduce health by 25 (clamped)
          const prevHealth = healthValue;
          healthValue = clamp100(healthValue - 25);
          // debug log if unexpected large drop
          if (prevHealth - healthValue > 25) console.warn('unexpected health drop', { prevHealth, healthValue, nextStage });
        }

        // Then reduce cleanliness relatively
        const prevClean = cleanValue;
        cleanValue = clamp100(cleanValue - 12.5);
        if (prevClean - cleanValue > 12.5 + 0.001) console.warn('unexpected clean drop', { prevClean, cleanValue, nextStage });

        // commit stage
        toothStage = nextStage;

        // show message per stage
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
            // enforce terminal state (only here)
            cleanValue = 0;
            healthValue = 0;
            setButtonsEnabled(false);
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

  function resetUIState() {
    cleanValue = 100;
    healthValue = 100;
    toothStage = 0; // explicit Reset clears the sweet-stage accumulation
    healthyCount = 0;
    toothReady = false;
    setButtonsEnabled(false);
    updateBars();
    fadeInfo("Model direset, silakan place ulang.");
  }

  window.kariesUI = {
    setButtonsEnabled,
    updateBars,
    fadeInfo,
    _getState: () => ({ cleanValue, healthValue, toothStage, healthyCount, processingInteractor })
  };

  updateBars();
})();
