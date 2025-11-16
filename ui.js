/* ui.js */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = document.querySelectorAll('.action-btn');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;
  let sweetCount = 0;

  // initially disable action buttons until model ready
  buttons.forEach(b => { b.style.opacity = 0.6; b.style.pointerEvents = 'none'; });

  // Listen for model placed event (dispatched by index.js)
  window.addEventListener('model-placed', (ev) => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    buttons.forEach(b => { b.style.opacity = 1; b.style.pointerEvents = 'auto'; });
    updateBars();
  });

  // XR may be started before model loaded — keep checking if placed
  document.getElementById('xrBtn').addEventListener('click', () => {
    // info change handled by index.js for session status if needed
    setTimeout(() => {
      // no-op here, just placeholder if you want to set info
    }, 200);
  });

  // action buttons
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      setAction(action);
    });
  });

  function fadeInfo(text) {
    info.style.opacity = 0;
    setTimeout(() => {
      info.textContent = text;
      info.style.opacity = 1;
    }, 200);
  }

  function updateBars() {
    cleanFill.style.width = Math.max(0, Math.min(100, cleanValue)) + "%";
    healthFill.style.width = Math.max(0, Math.min(100, healthValue)) + "%";
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
          healthValue -= 25;
          document.querySelector('.health .bar-inner').classList.add('damage');
          fadeInfo("⚠️ Terlalu sering makan manis! Kesehatan menurun!");
          setTimeout(() => {
            document.querySelector('.health .bar-inner').classList.remove('damage');
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

  // Expose for debugging if needed
  window.kariesUI = { setAction, updateBars, fadeInfo };
})();
