/* ui.js (updated for health-changed event) */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;
  let sweetCount = 0;

  function setButtonsEnabled(enabled) {
    buttons.forEach(b => {
      b.style.opacity = enabled ? '1' : '0.55';
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.tabIndex = enabled ? 0 : -1;
      if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
    });
  }
  setButtonsEnabled(false);

  // notify AR UI that model is placed (listener in index.js will enable logic)
  window.addEventListener('model-placed', (ev) => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();
    // also send current health so AR can sync model if needed
    window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue } }));
  });

  // action buttons: update UI and dispatch ui-action for AR to react
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      setAction(action); // local UI update logic
      window.dispatchEvent(new CustomEvent('ui-action', { detail: action })); // notify AR (optional)
      // after state changes, notify AR of health change
      window.dispatchEvent(new CustomEvent('health-changed', { detail: { health: healthValue } }));
    });
  });

  function fadeInfo(text) {
    if (!info) return;
    info.style.opacity = 0;
    setTimeout(() => {
      info.textContent = text;
      info.style.opacity = 1;
    }, 200);
  }

  function updateBars() {
    if (cleanFill) cleanFill.style.width = Math.max(0, Math.min(100, cleanValue)) + "%";
    if (healthFill) healthFill.style.width = Math.max(0, Math.min(100, healthValue)) + "%";
  }

  function setAction(action) {
    if (!toothReady) {
      fadeInfo("Model belum siap. Arahkan kamera & tunggu model muncul.");
      return;
    }

    switch(action) {
      case 'brush':
        cleanValue = 100;
        healthValue = 100;
        sweetCount = 0;
        fadeInfo("🪥 Gigi bersih total! Sehat kembali ✨");
        break;

      case 'sweet':
        cleanValue -= 12.5;
        sweetCount++;
        if (sweetCount >= 2) {
          sweetCount = 0;
          healthValue -= 25; // 1 nyawa hilang
          document.querySelector('.health .bar-inner')?.classList.add('damage');
          fadeInfo("🍭 Terlalu sering makan manis — kesehatan turun!");
          setTimeout(() => {
            document.querySelector('.health .bar-inner')?.classList.remove('damage');
          }, 500);
        } else {
          fadeInfo("🍭 Gula menempel! Kebersihan menurun sedikit...");
        }
        break;

      case 'healthy':
        fadeInfo("🥦 Makanan sehat baik untuk gigi, namun harus tetap menggosok gigi ya!");
        break;
    }

    cleanValue = Math.max(0, cleanValue);
    healthValue = Math.max(0, healthValue);
    updateBars();

    if (healthValue <= 0) {
      fadeInfo("💀 Gigi rusak total! Yuk sikat gigi untuk memulihkannya!");
    }
  }

  // expose for debugging
  window.kariesUI = { setAction, updateBars, fadeInfo, setButtonsEnabled };
})();
