// di index.js — paste setelah deklarasi let placedObject = null; (atau dekat init)
window.addEventListener('ui-action', (e) => {
  const action = e.detail;
  if (!placedObject) return;
  // quick visual feedback: flash emissive color if material supports it
  placedObject.traverse((c) => {
    if (c.isMesh && c.material) {
      // store old emissive color (if any)
      if (!c.userData._oldEmissive) {
        c.userData._oldEmissive = c.material.emissive ? c.material.emissive.clone() : null;
      }
      if (c.material.emissive) c.material.emissive.setHex(0xffe066); // warm flash
    }
  });

  // small rotation animation (instant)
  if (action === 'brush') {
    placedObject.rotation.x += 0.12;
  } else if (action === 'sweet') {
    placedObject.rotation.y += 0.18;
  } else if (action === 'healthy') {
    placedObject.rotation.z += 0.12;
  }

  // revert emissive after short delay
  setTimeout(() => {
    placedObject.traverse((c) => {
      if (c.isMesh && c.material && c.userData._oldEmissive) {
        c.material.emissive.copy(c.userData._oldEmissive);
      }
    });
  }, 350);
});
