/* ui.js — Reset button at CENTER BOTTOM */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');
  const extraButtons = document.getElementById('extraButtons');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  let sweetCount = 0;
  let healthyCount = 0;

  // disable buttons initially
  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
    });
  }
  setButtonsEnabled(false);

  const clamp100 = v => Math.max(0, Math.min(100, Math.round(v * 100) / 100));

  function updateBars() {
    cleanFill.style.width = clamp100(cleanValue) + "%";
    healthFill.style.width = clamp100(healthValue) + "%";
  }
  function fadeInfo(t) {
    info.style.opacity = 0;
    setTimeout(() => { info.textContent = t; info.style.opacity = 1; }, 160);
  }

  // === CREATE RESET BUTTON ===
  function createResetButton() {
    extraButtons.innerHTML = "";
    const resetBtn = document.createElement("button");
    resetBtn.id = "resetBtn";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", onResetClicked);
    extraButtons.appendChild(resetBtn);
    extraButtons.classList.add("active");
  }

  function onResetClicked() {
    window.dispatchEvent(new CustomEvent('reset'));

    cleanValue = 100;
    healthValue = 100;
    sweetCount = 0;
    healthyCount = 0;
    updateBars();

    fadeInfo("Pengalaman di-reset. Tempatkan model lagi.");
    setButtonsEnabled(false);
  }

  // === UI button actions ===
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (!toothReady) {
        fadeInfo("Model belum siap.");
        return;
      }
      setButtonsEnabled(false);
      fadeInfo("Memainkan animasi...");

      window.dispatchEvent(new CustomEvent('ui-action-request', {
        detail: { action }
      }));
    });
  });

  // === When interactor animation done ===
  window.addEventListener('interactor-finished', e => {
    const { action, status } = e.detail || {};

    if (status !== "ok") {
      fadeInfo("Animasi gagal.");
      setButtonsEnabled(true);
      return;
    }

    performActionEffect(action);

    updateBars();
    window.dispatchEvent(new CustomEvent('health-changed', {
      detail: { health: healthValue, clean: cleanValue }
    }));

    if (cleanValue <= 0 && healthValue <= 0) {
      setButtonsEnabled(false);
      fadeInfo("⚠️ Gigi rusak total.");
    } else {
      setButtonsEnabled(true);
    }
  });

  // === Model placed ===
  window.addEventListener('model-placed', () => {
    toothReady = true;
    fadeInfo("Model siap!");
    setButtonsEnabled(true);
    updateBars();
  });

  // === XR started ===
  window.addEventListener('xr-started', () => {
    xrBtn.classList.add("hidden");
    createResetButton();       // show reset bottom-center
    fadeInfo("Arahkan kamera ke model.");
  });

  // === XR ended ===
  window.addEventListener('xr-ended', () => {
    xrBtn.classList.remove("hidden");
    extraButtons.classList.remove("active");
    toothReady = false;
    setButtonsEnabled(false);
    fadeInfo("AR berhenti.");
  });

  window.addEventListener('health-changed', e => {
    const d = e.detail || {};
    if (typeof d.clean === "number") cleanValue = d.clean;
    if (typeof d.health === "number") healthValue = d.health;
    updateBars();
  });

  // === Effect after animation ===
  function performActionEffect(a) {
    switch(a) {
      case "brush":
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        sweetCount = 0; healthyCount = 0;
        fadeInfo("🪥 Gigi dibersihkan!");
        break;

      case "sweet":
        cleanValue = clamp100(cleanValue - 12.5);
        sweetCount++;
        if (sweetCount >= 2) {
          sweetCount = 0;
          healthValue = clamp100(healthValue - 25);
          fadeInfo("🍭 Terlalu banyak manis!");
        } else {
          fadeInfo("🍭 Gula menempel.");
        }
        break;

      case "healthy":
        cleanValue = clamp100(cleanValue + 12.5);
        healthyCount++;
        if (healthyCount >= 2) {
          healthyCount = 0;
          healthValue = clamp100(healthValue + 25);
          fadeInfo("🥦 Makanan sehat meningkatkan kesehatan!");
        } else {
          fadeInfo("🥗 Kebersihan naik sedikit.");
        }
        break;
    }
  }

  updateBars();
})();
