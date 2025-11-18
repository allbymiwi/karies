/* ui.js - clean UI wiring (controls visible only in AR) */
(() => {
  const info = document.getElementById('infoText');
  const cleanFill = document.getElementById('cleanFill');
  const healthFill = document.getElementById('healthFill');
  const buttons = Array.from(document.querySelectorAll('.action-btn'));
  const xrBtn = document.getElementById('xrBtn');

  // NEW: Splash screen elements
  const splashScreen = document.getElementById('splashScreen');
  const startBtn = document.getElementById('startBtn');

  // NEW: Odontogram elements
  const odontogramBtn = document.getElementById('odontogramBtn');
  const odontogramPopup = document.getElementById('odontogramPopup');
  const closePopup = document.getElementById('closePopup');
  const popupOdontogramImage = document.getElementById('popupOdontogramImage');
  const popupOdontogramText = document.getElementById('popupOdontogramText');

  const barsContainer = document.getElementById('bars');
  const buttonsContainer = document.getElementById('buttons');
  const infoContainer = document.getElementById('infoText');

  // NEW extra buttons
  const resetBtn = document.getElementById('resetBtn');
  const exitBtn = document.getElementById('exitBtn');

  // NEW scale buttons
  const scaleUpBtn = document.getElementById('scaleUpBtn');
  const scaleDownBtn = document.getElementById('scaleDownBtn');

  // containers (to toggle visibility)
  const extraButtonsContainer = document.getElementById('extraButtons');
  const scaleButtonsContainer = document.getElementById('scaleButtons');

  let toothReady = false;
  let cleanValue = 100;
  let healthValue = 100;

  // counters for repeated actions
  let sweetCount = 0;
  let healthyCount = 0;

  // track whether currently in XR session
  let inXR = false;

  // NEW: Function to show splash screen
  function showSplashScreen() {
    if (splashScreen) {
      splashScreen.classList.remove('hidden');
    }
    // Reset semua state UI
    resetUIState();
  }

  // NEW: Function to hide splash screen
  function hideSplashScreen() {
    if (splashScreen) {
      splashScreen.classList.add('hidden');
    }
  }

  // NEW: Function to directly request AR session (tanpa lewat tombol Enter AR)
  async function startARSession() {
    try {
      // Hide splash screen
      hideSplashScreen();
      
      // Langsung panggil requestXRSession dari window (yang ada di index.js)
      if (window.requestXRSession) {
        await window.requestXRSession();
      } else {
        // Fallback: panggil melalui event
        window.dispatchEvent(new CustomEvent('request-ar-session'));
      }
    } catch (error) {
      console.error('Failed to start AR session:', error);
      // Jika gagal, tampilkan kembali splash screen
      showSplashScreen();
      alert('Gagal memulai AR: ' + error.message);
    }
  }

  // NEW: Start button click handler
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startARSession();
    });
  }

  // NEW: Function to update popup odontogram based on health key
  function updatePopupOdontogram(healthKey = null) {
    if (!popupOdontogramImage || !popupOdontogramText) return;

    let imageSrc = '';
    let description = '';

    if (!toothReady || healthKey === null) {
      // No tooth placed
      imageSrc = 'odontogram/odontogram_hilang.png';
      description = 'Gigi Hilang: Gigi tidak ada/tanggal';
    } else {
      // Update based on health key
      switch(healthKey) {
        case 100: // gigisehat.glb
          imageSrc = 'odontogram/odontogram_normal.png';
          description = 'Gigi Normal: Gigi sehat tanpa masalah';
          break;
        case 75: // gigiplak.glb
          imageSrc = 'odontogram/odontogram_normal.png';
          description = 'Gigi Normal: Gigi sehat tanpa masalah';
          break;
        case 50: // gigiasam.glb
          imageSrc = 'odontogram/odontogram_karang.png';
          description = 'Gigi Bermasalah: Ada karang gigi atau plak';
          break;
        case 25: // gigidemineralisasi.glb
          imageSrc = 'odontogram/odontogram_karang.png';
          description = 'Gigi Bermasalah: Ada karang gigi atau plak';
          break;
        case 0: // gigikaries.glb
          imageSrc = 'odontogram/odontogram_karies.png';
          description = 'Gigi Karies: Gigi berlubang/rusak';
          break;
        default:
          imageSrc = 'odontogram/odontogram_hilang.png';
          description = 'Gigi Hilang: Gigi tidak ada/tanggal';
      }
    }

    popupOdontogramImage.src = imageSrc;
    popupOdontogramText.textContent = description;
  }

  // NEW: Function to show popup
  function showOdontogramPopup() {
    if (!inXR) {
      fadeInfo("Fitur ini hanya tersedia saat berada di AR.");
      return;
    }
    
    // Update popup content based on current health
    const healthKey = getHealthKeyFromValue(healthValue);
    updatePopupOdontogram(healthKey);
    
    // Show popup and add class to body to block background interactions
    odontogramPopup.classList.remove('hidden');
    document.body.classList.add('popup-active');
  }

  // NEW: Function to hide popup
  function hideOdontogramPopup() {
    odontogramPopup.classList.add('hidden');
    document.body.classList.remove('popup-active');
  }

  // NEW: Odontogram button click handler
  if (odontogramBtn) {
    odontogramBtn.addEventListener('click', showOdontogramPopup);
  }

  // NEW: Close popup handler - FIXED
  if (closePopup) {
    closePopup.addEventListener('click', hideOdontogramPopup);
  }

  // Close popup when clicking outside content - FIXED
  if (odontogramPopup) {
    odontogramPopup.addEventListener('click', (e) => {
      if (e.target === odontogramPopup) {
        hideOdontogramPopup();
      }
    });
  }

  // NEW: Function to show/hide AR UI elements
  function showARUI(show) {
    const elements = [barsContainer, buttonsContainer, infoContainer, odontogramBtn];
    
    elements.forEach(element => {
      if (element) {
        if (show) {
          element.classList.add('visible-ar');
        } else {
          element.classList.remove('visible-ar');
        }
      }
    });
  }

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
  }
  setButtonsEnabled(false);

  // helpers to show/hide AR-only controls
  function showARControls(show) {
    inXR = !!show;
    if (show) {
      if (extraButtonsContainer) extraButtonsContainer.classList.add('visible-controls');
      if (scaleButtonsContainer) scaleButtonsContainer.classList.add('visible-controls');
      // NEW: Show AR UI elements
      showARUI(true);
    } else {
      if (extraButtonsContainer) extraButtonsContainer.classList.remove('visible-controls');
      if (scaleButtonsContainer) scaleButtonsContainer.classList.remove('visible-controls');
      // NEW: Hide AR UI elements
      showARUI(false);
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
      // reset local UI values & lock actions until model placed again
      resetUIState();
      // Set info text kembali ke awal AR
      fadeInfo("Arahkan kamera ke lantai untuk memunculkan gigi.");
    });
  }

  // Exit AR button -> request exit; index.js will handle ending session
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      if (!inXR) { fadeInfo("Fitur ini hanya tersedia saat berada di AR."); return; }
      window.dispatchEvent(new CustomEvent('request-exit-ar'));
      fadeInfo("Keluar AR...");
      
      // NEW: Langsung show splash screen tanpa delay
      showSplashScreen();
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
  window.addEventListener('model-placed', () => {
    toothReady = true;
    fadeInfo("Model gigi siap! Pilih aksi di bawah ini.");
    setButtonsEnabled(true);
    updateBars();
  });

  // when XR started: hide Enter AR button and show AR-only controls
  window.addEventListener('xr-started', () => {
    fadeInfo("Arahkan kamera ke lantai untuk memunculkan gigi.");

    // show AR controls (scale + extra) and AR UI elements
    showARControls(true);
  });

  // when XR ended: langsung kembali ke splash screen tanpa show tombol Enter AR
  window.addEventListener('xr-ended', () => {
    toothReady = false;
    setButtonsEnabled(false);

    // hide AR-only controls and AR UI elements
    showARControls(false);
    
    // NEW: Langsung show splash screen tanpa menampilkan tombol Enter AR
    showSplashScreen();
  });

  // local state changes (if some other part dispatches health-changed directly)
  window.addEventListener('health-changed', (e) => {
    const d = e.detail || {};
    if (typeof d.health === 'number') {
      healthValue = d.health;
    }
    if (typeof d.clean === 'number') cleanValue = d.clean;
    updateBars();
  });

  // NEW: Helper function to convert health value to health key
  function getHealthKeyFromValue(health) {
    if (health >= 100) return 100;
    if (health >= 75) return 75;
    if (health >= 50) return 50;
    if (health >= 25) return 25;
    return 0;
  }

  // apply the "game logic" to UI values AFTER animations finish (called by interactor-finished)
  function performActionEffect(action) {
    switch(action) {
      case 'brush':
        cleanValue = clamp100(cleanValue + 25);
        healthValue = clamp100(healthValue + 25);
        sweetCount = 0; healthyCount = 0;
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
  }

  // expose for debugging
  window.kariesUI = {
    setButtonsEnabled,
    updateBars,
    fadeInfo,
    startARSession, // NEW: expose start AR function
    _getState: () => ({ cleanValue, healthValue, sweetCount, healthyCount })
  };

  // initial UI
  updateBars();
  // ensure AR controls hidden initially
  showARControls(false);
})();