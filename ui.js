/* ui.js - clean UI wiring (extra buttons visible only in AR) - FIXED: sweet reduces clean relatively */
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

  // toothStage for messages (0..8), counts number of sweet presses since last brush/reset
  let toothStage = 0;
  let healthyCount = 0;

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

  window.addEventListener('interactor-finished', (e) => {
    const d = e.detail || {};
    const action = d.action;
    const status = d.status;
    if (status !== 'ok') {
      fadeInfo(status === 'skipped' ? "Animasi tidak dijalankan." : "Terjadi error animasi.");
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
  });

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

  // ---------- GAME LOGIC (fixed) ----------
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        // brush increases clean by 25 (relative) and health by 25; also clears accumulated sweetStage
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        toothStage = 0; // clear accumulated sweet presses
        healthyCount = 0;
        fadeInfo("🪥 Menggosok gigi: Kebersihan +25%, Kesehatan +25%");
        break;

      case 'sweet':
        // if already at terminal sweet stage, keep final message
        if (toothStage >= 8) {
          fadeInfo("⚠️ Karies Gigi Parah – Harus Reset — Giginya sudah bolong besar dan nggak bisa diselamatkan... harus mulai ulang ya!");
          return;
        }

        // increment stage for messaging
        toothStage = Math.min(8, toothStage + 1);

        // IMPORTANT: reduce cleanValue RELATIVE to current value
        cleanValue = clamp100(cleanValue - 12.5);

        // every 2 presses (when toothStage is even) reduce health by 25
        if (toothStage % 2 === 0) {
          healthValue = clamp100(healthValue - 25);
        }

        // show per-stage message; stage 8 enforces terminal
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
            // enforce terminal state
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
    toothStage = 0;
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
    _getState: () => ({ cleanValue, healthValue, toothStage, healthyCount })
  };

  updateBars();
})();
