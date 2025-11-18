// index.js (optimized pinch + wheel responsiveness)
// Replace whole file with this optimized version

import * as THREE from './modules/three.module.js';
import { GLTFLoader } from './modules/GLTFLoader.js';

// tooth model mapping
const MODEL_MAP = {
  100: 'gigisehat.glb',
  75:  'gigiplak.glb',
  50:  'gigiasam.glb',
  25:  'gigidemineralisasi.glb',
  0:   'gigikaries.glb'
};
const DEFAULT_HEALTH_KEY = 100;
const BASE_SCALE = 0.25;

// interactor files
const INTERACTORS = {
  brush: 'sikatgigi.glb',
  healthy: 'wortel.glb',
  sweet: 'permen.glb'
};

let renderer, scene, camera, gl;
let controller, reticle;
let loader;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let objectPlaced = false;
let placedObject = null;
let currentHealthModelKey = DEFAULT_HEALTH_KEY;

const modelCache = {};
const interactorCache = {};

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

const xrBtn = document.getElementById('xrBtn');

let spotLight = null;
let lastAction = null;
window.addEventListener('ui-last-action', (e) => {
  try { lastAction = e.detail && e.detail.action ? e.detail.action : null; } catch (err) { lastAction = null; }
});

function getHealthStateMessage(healthKey) {
  switch (healthKey) {
    case 100:
      return "😁 Makan makanan manis boleh tapi jangan terlalu sering ya!";
    case 75:
      return "🙂 Waduh! Ada sedikit plak yang menempel akibat kamu memakan makanan manis dan tidak menggosok gigi... Kamu harus segera menggosok gigimu ya!";
    case 50:
      return "😬 Oh tidak! Sukrosa yang terdapat pada sisa makanan menimbulkan bakteri dan membentuk asam laktat. Kalau tidak segera menggosok gigi, nanti gigimu berlubang lho!";
    case 25:
      return "⚠️ Hey jangan makan makanan manis terus dong... Gigimu jadi berlubang. Yuk makan makanan sehat dan berserat dan menggosok gigi agar gigimu tetap sehat!";
    case 0:
      return "🚨 Yah... Gigimu sudah berlubang hingga mencapai saraf gigi dan menimbulkan infeksi. Segera konsultasi ke dokter gigi ya! Kamu bisa menekan tombol RESET untuk memulai ulang.";
    default:
      return "Status gigi berubah.";
  }
}

xrBtn.addEventListener('click', () => {
  if (!xrSession) requestXRSession();
  else endXRSession();
});

function initThree() {
  const canvas = document.getElementById('canvas');
  gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    alert('WebGL2 tidak tersedia. AR mungkin tidak berjalan di browser ini.');
  }

  renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true });
  renderer.xr.enabled = true;
  // keep pixel ratio reasonable for performance
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearAlpha(0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  scene = new THREE.Scene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.28);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444456, 0.45);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(1.5, 3, 2);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 1024;
  dir.shadow.mapSize.height = 1024;
  scene.add(dir);

  const rim = new THREE.PointLight(0xfff6d8, 0.6, 6);
  rim.position.set(-1.5, 1.5, -1.5);
  scene.add(rim);

  spotLight = new THREE.SpotLight(0xffffff, 1.0, 8, Math.PI / 6, 0.25, 1);
  spotLight.position.set(0.6, 1.8, 0.6);
  spotLight.target.position.set(0, 0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 2048;
  spotLight.shadow.mapSize.height = 2048;
  scene.add(spotLight);
  scene.add(spotLight.target);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', onWindowResize);

  window.addEventListener('ui-action-request', async (e) => {
    const action = e.detail && e.detail.action ? e.detail.action : e.detail || null;
    if (!action || !objectPlaced) {
      window.dispatchEvent(new CustomEvent('interactor-finished', { detail: { action, status: 'skipped' } }));
      return;
    }
    try {
      await runInteractorAnimation(action);
      window.dispatchEvent(new CustomEvent('interactor-finished', { detail: { action, status: 'ok' } }));
    } catch (err) {
      console.warn('interactor anim error', err);
      window.dispatchEvent(new CustomEvent('interactor-finished', { detail: { action, status: 'error' } }));
    }
  });

  window.addEventListener('health-changed', (e) => {
    const health = e.detail && typeof e.detail.health === 'number' ? e.detail.health : null;
    if (health === null) return;
    const key = clampHealthKey(health);
    currentHealthModelKey = key;
    if (objectPlaced) swapModelForHealthAfterDelay(key);
    if (health <= 0) {
      window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'health_zero' } }));
    }
  });

  window.addEventListener('reset', () => {
    if (placedObject) {
      scene.remove(placedObject);
      try { disposeObject(placedObject); } catch (err) { console.warn('dispose failed', err); }
      placedObject = null;
    }
    objectPlaced = false;
    currentHealthModelKey = DEFAULT_HEALTH_KEY;
    reticle.visible = false;
    lastAction = null;
  });

  window.addEventListener('request-exit-ar', () => {
    endXRSession();
  });

  // -------------------- OPTIMIZED PINCH & WHEEL --------------------
  // pointer-tables only store coords; actual scale applied inside RAF update
  const pointers = new Map();
  let isPinching = false;
  let pinchStartDist = 0;
  let pinchStartScale = BASE_SCALE;
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 2.0;

  // smoothing: target scale + current applied scale
  let pinchTargetScale = BASE_SCALE;
  let pinchAppliedScale = BASE_SCALE;
  const SCALE_LERP_ALPHA = 0.28; // smoothing factor; lower = smoother but slower

  // performance helpers: temporarily disable shadows while heavy gesture occurs
  let shadowsTemporarilyDisabled = false;
  let shadowRestoreTimeout = null;
  function disableShadowsDuringGesture() {
    if (!renderer.shadowMap.enabled) return;
    if (shadowRestoreTimeout) { clearTimeout(shadowRestoreTimeout); shadowRestoreTimeout = null; }
    renderer.shadowMap.enabled = false;
    shadowsTemporarilyDisabled = true;
  }
  function scheduleRestoreShadows(delay = 300) {
    if (shadowRestoreTimeout) clearTimeout(shadowRestoreTimeout);
    shadowRestoreTimeout = setTimeout(() => {
      renderer.shadowMap.enabled = true;
      shadowsTemporarilyDisabled = false;
      shadowRestoreTimeout = null;
    }, delay);
  }

  function getDistanceBetweenPointers() {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return 0;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function startPinch() {
    if (!placedObject) return;
    pinchStartDist = getDistanceBetweenPointers();
    pinchStartScale = placedObject.scale.x || BASE_SCALE;
    pinchTargetScale = pinchStartScale;
    pinchAppliedScale = pinchStartScale;
    isPinching = pinchStartDist > 0;
    // performance: disable shadows while pinching
    disableShadowsDuringGesture();
  }

  function updatePinchTarget() {
    if (!isPinching || !placedObject) return;
    const dist = getDistanceBetweenPointers();
    if (!dist || pinchStartDist === 0) return;
    const factor = dist / pinchStartDist;
    let newScale = pinchStartScale * factor;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    pinchTargetScale = newScale;
  }

  function endPinch() {
    isPinching = false;
    pinchStartDist = 0;
    // schedule shadows to be restored shortly after gesture ends
    scheduleRestoreShadows(300);
  }

  // pointer handlers
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) startPinch();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    // only update stored coords here (cheap)
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2 && isPinching) {
      // don't set scale directly; set target (cheap)
      updatePinchTarget();
    }
  });

  function releasePointer(ev) {
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    pointers.delete(ev.pointerId);
    if (isPinching && pointers.size < 2) endPinch();
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  // optimized wheel handler: adjust pinchTargetScale smoothly
  let wheelLast = 0;
  canvas.addEventListener('wheel', (ev) => {
    if (!placedObject) return;
    ev.preventDefault();
    // small multiplier per wheel tick; use time-based dampening
    const now = performance.now();
    if (now - wheelLast > 60) {
      // when wheel starts, disable shadows briefly for performance
      disableShadowsDuringGesture();
      wheelLast = now;
      // restore shadows shortly after wheel stops
      scheduleRestoreShadows(300);
    }
    const delta = ev.deltaY;
    const scaleFactor = delta > 0 ? 0.94 : 1.06;
    let newTarget = (pinchTargetScale || placedObject.scale.x) * scaleFactor;
    newTarget = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newTarget));
    pinchTargetScale = newTarget;
  }, { passive: false });
  // -------------------- end optimized pinch/wheel --------------------

  console.log('index.js loaded (optimized). Ready.');
}

// The rest of the file is largely identical to the app logic previously used,
// except we add a small touch in the render loop to smoothly apply pinchTargetScale.

function clampHealthKey(health) {
  if (health >= 100) return 100;
  if (health >= 75) return 75;
  if (health >= 50) return 50;
  if (health >= 25) return 25;
  return 0;
}

function applyMeshMaterialTweaks(model) {
  model.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
      const mat = c.material;
      if (mat) {
        if ('metalness' in mat) mat.metalness = Math.min(0.05, mat.metalness || 0);
        if ('roughness' in mat) mat.roughness = Math.min(0.9, (mat.roughness === undefined ? 0.6 : mat.roughness));
        mat.side = THREE.DoubleSide;
        mat.transparent = true;
        if (typeof mat.opacity === 'undefined') mat.opacity = 1.0;
        mat.needsUpdate = true;
      }
    }
  });
}

function preloadAllModelsAndInteractors() {
  const files = new Set(Object.values(MODEL_MAP).concat(Object.values(INTERACTORS)));
  const promises = [];
  files.forEach((file) => {
    if (!file) return;
    promises.push(new Promise((resolve) => {
      loader.load(file,
        (gltf) => {
          const node = gltf.scene || gltf.scenes[0];
          const clips = gltf.animations && gltf.animations.length ? gltf.animations.slice() : [];
          if (!node) { resolve(); return; }
          applyMeshMaterialTweaks(node);
          if (Object.values(MODEL_MAP).includes(file)) modelCache[file] = { scene: node, clips: clips };
          if (Object.values(INTERACTORS).includes(file)) {
            const actionKey = Object.keys(INTERACTORS).find(k => INTERACTORS[k] === file);
            if (actionKey) interactorCache[actionKey] = { scene: node, clips: clips };
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn('preload failed for', file, err);
          resolve();
        }
      );
    }));
  });
  return Promise.all(promises);
}

function cloneSceneWithClips(entry) {
  if (!entry || !entry.scene) return null;
  const cloned = entry.scene.clone(true);
  cloned.userData = cloned.userData || {};
  cloned.userData._clips = entry.clips ? entry.clips.slice() : [];
  return cloned;
}

async function runInteractorAnimation(action) {
  const file = INTERACTORS[action];
  if (!file) return;

  let interactorRoot = null;
  const cachedEntry = interactorCache[action];
  if (cachedEntry) interactorRoot = cloneSceneWithClips(cachedEntry);
  else {
    const gltf = await new Promise((res, rej) => {
      loader.load(file, (g) => res(g), undefined, (err) => rej(err));
    });
    const node = gltf.scene || gltf.scenes[0];
    const clips = gltf.animations && gltf.animations.length ? gltf.animations.slice() : [];
    if (!node) return;
    applyMeshMaterialTweaks(node);
    interactorRoot = node.clone(true);
    interactorRoot.userData = interactorRoot.userData || {};
    interactorRoot.userData._clips = clips;
  }

  if (!placedObject) return;

  const localStart = new THREE.Vector3();
  const localRot = new THREE.Euler();
  const localScale = new THREE.Vector3(1,1,1);

  if (action === 'brush') {
    localStart.set(0.0, 0.40, 0.12);
    localRot.set(0, 0, 0);
    localScale.set(0.55,0.55,0.55);
  } else if (action === 'healthy') {
    localStart.set(0.0, 1.6, 0.9);
    localRot.set(-0.25, 0, -0.5);
    localScale.set(0.34,0.34,0.34);
  } else if (action === 'sweet') {
    localStart.set(0.08, 1.8, 0.95);
    localRot.set(0, 0.4, 0.8);
    localScale.set(0.28,0.28,0.28);
  }

  const wrapper = new THREE.Group();
  wrapper.position.copy(localStart);
  wrapper.rotation.copy(localRot);
  wrapper.scale.copy(localScale);
  wrapper.userData._isInteractor = true;

  applyMeshMaterialTweaks(interactorRoot);
  wrapper.add(interactorRoot);
  placedObject.add(wrapper);

  let animPromise = null;
  if (action === 'brush') animPromise = animateBrushWithPossibleGLB(() => ({ wrapper, root: interactorRoot }));
  else if (action === 'healthy') animPromise = animateCarrotFade(wrapper);
  else if (action === 'sweet') animPromise = animateCandyFade(wrapper);
  else animPromise = Promise.resolve();

  await animPromise;

  try {
    placedObject.remove(wrapper);
    disposeObject(wrapper);
  } catch (e) { /* ignore */ }

  return;
}

function lerp(a,b,t){ return a + (b-a)*t; }
function easeInOutQuad(t){ return t<0.5 ? 2*t*t : -1 + (4-2*t)*t; }

function animateBrushWithPossibleGLB(getPair) {
  const pair = getPair();
  const wrapper = pair.wrapper;
  const root = pair.root;

  const clips = (root && root.userData && root.userData._clips) ? root.userData._clips : [];
  if (clips && clips.length) {
    return new Promise((resolve) => {
      const mixer = new THREE.AnimationMixer(root);
      const clip = clips[0];
      const action = mixer.clipAction(clip);
      action.reset();
      action.play();

      let lastTime = performance.now();
      function frame(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        try { mixer.update(dt); } catch (e) {}
        if (action.time >= clip.duration - 0.001) {
          action.stop();
          resolve();
        } else {
          requestAnimationFrame(frame);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  return animateBrushUpright(wrapper);
}

function animateBrushUpright(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();

    const cx = wrapper.position.x;
    const cy = wrapper.position.y;
    const cz = wrapper.position.z;
    const initialRotZ = wrapper.rotation.z;
    const initialScale = wrapper.scale.x;

    const radius = 0.50;
    const revolutions = 3;
    const orbitDuration = 1200;
    const approachDur = 100;
    const retreatDur = 100;
    const totalOrbitTime = orbitDuration;

    function frame(now) {
      const elapsed = now - start;

      if (elapsed < approachDur) {
        const t = easeInOutQuad(elapsed / approachDur);
        wrapper.position.z = lerp(cz + 0.02, cz - 0.03, t);
        wrapper.rotation.x = lerp(wrapper.rotation.x, 0, t);
        requestAnimationFrame(frame);
        return;
      }

      const orbitStart = approachDur;
      const orbitEnd = approachDur + totalOrbitTime;

      if (elapsed >= orbitStart && elapsed < orbitEnd) {
        const t = (elapsed - orbitStart) / (orbitEnd - orbitStart);
        const eased = easeInOutQuad(t);
        const angle = eased * revolutions * Math.PI * 2;

        const ox = cx + Math.cos(angle) * radius;
        const oy = cy + Math.sin(angle) * (radius * 0.35);

        const contactDip = 0.01 * Math.abs(Math.sin(angle * 3));
        wrapper.position.x = ox;
        wrapper.position.y = oy - contactDip;

        wrapper.rotation.x = 0;
        wrapper.rotation.z = initialRotZ + Math.sin(angle * 2) * 0.06;

        wrapper.scale.setScalar(initialScale * (1 + 0.01 * Math.sin(angle * 4)));

        requestAnimationFrame(frame);
        return;
      }

      if (elapsed >= orbitEnd && elapsed < orbitEnd + retreatDur) {
        const t2 = (elapsed - orbitEnd) / retreatDur;
        const tt2 = easeInOutQuad(t2);
        wrapper.position.x = lerp(wrapper.position.x, cx, tt2);
        wrapper.position.y = lerp(wrapper.position.y, cy, tt2);
        wrapper.position.z = lerp(wrapper.position.z, cz, tt2);
        wrapper.rotation.z = lerp(wrapper.rotation.z, initialRotZ, tt2);
        wrapper.scale.setScalar(lerp(wrapper.scale.x, initialScale, tt2));
        requestAnimationFrame(frame);
        return;
      }

      resolve();
    }

    requestAnimationFrame(frame);
  });
}

function animateCarrotFade(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startY = wrapper.position.y;
    const startZ = wrapper.position.z;
    const initialScale = wrapper.scale.x;
    const fall = 420;
    const bounce = 180;
    const fade = 260;

    wrapper.traverse((c) => { if (c.isMesh && c.material) c.material.opacity = 1.0; });

    function frame(now) {
      const elapsed = now - start;
      if (elapsed < fall) {
        const t = Math.min(1, elapsed / fall);
        const tt = t * t;
        wrapper.position.y = lerp(startY, startY - 1.05, tt);
        wrapper.position.z = lerp(startZ, startZ - 0.45, tt);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + bounce) {
        const t2 = (elapsed - fall) / bounce;
        const pulse = Math.sin(t2 * Math.PI);
        const scaleFactor = lerp(0.9, 1.02, pulse);
        wrapper.scale.setScalar(initialScale * scaleFactor);
        wrapper.position.y = lerp(startY - 1.05, startY - 0.92, pulse * 0.6);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + bounce + fade) {
        const t3 = (elapsed - fall - bounce) / fade;
        const tt3 = easeInOutQuad(t3);
        wrapper.traverse((c) => {
          if (c.isMesh && c.material) c.material.opacity = 1 - tt3;
        });
        wrapper.position.y = lerp(startY - 0.92, startY + 0.45, tt3);
        wrapper.scale.setScalar(initialScale * lerp(1.02, 0.02, tt3));
        requestAnimationFrame(frame);
        return;
      }
      resolve();
    }

    requestAnimationFrame(frame);
  });
}

function animateCandyFade(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startY = wrapper.position.y;
    const startZ = wrapper.position.z;
    const initialScale = wrapper.scale.x;
    const fall = 320;
    const stick = 260;
    const fade = 220;

    wrapper.traverse((c) => { if (c.isMesh && c.material) c.material.opacity = 1.0; });

    function frame(now) {
      const elapsed = now - start;
      if (elapsed < fall) {
        const t = Math.min(1, elapsed / fall);
        const tt = t * t;
        wrapper.position.y = lerp(startY, startY - 1.05, tt);
        wrapper.position.z = lerp(startZ, startZ - 0.45, tt);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + stick) {
        const t2 = (elapsed - fall) / stick;
        const pulse = 1 + 0.14 * Math.sin(t2 * Math.PI * 3);
        wrapper.scale.setScalar(initialScale * pulse);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + stick + fade) {
        const t3 = (elapsed - fall - stick) / fade;
        const tt3 = easeInOutQuad(t3);
        wrapper.traverse((c) => {
          if (c.isMesh && c.material) c.material.opacity = 1 - tt3;
        });
        wrapper.position.y = lerp(startY - 1.05, startY + 0.6, tt3);
        wrapper.scale.setScalar(initialScale * lerp(1.14, 0.01, tt3));
        requestAnimationFrame(frame);
        return;
      }
      resolve();
    }

    requestAnimationFrame(frame);
  });
}

function swapModelForHealthAfterDelay(healthKey) {
  const modelFile = MODEL_MAP[healthKey];
  if (!modelFile) return;

  if (placedObject && placedObject.userData && placedObject.userData.modelFile === modelFile) {
    try {
      let msgSame = "";
      if (lastAction === "brush") {
        msgSame = "Bagus kamu telah menggosok gigi! Kamu dianjurkan menggosok gigi minimal dua kali sehari, yaitu setelah sarapan pagi dan sebelum tidur malam. Setiap kali menyikat gigi, lakukan selama minimal 2 menit ya!";
      } else if (lastAction === "healthy") {
        msgSame = "Yummy! Makan makanan berserat itu artinya gigi kita kerja keras buat mengunyahnya. Jadi, dia membantu membuang kotoran dan sisa makanan yang menempel pada gigi!";
      } else if (lastAction === "sweet") {
        msgSame = getHealthStateMessage(healthKey);
      } else {
        msgSame = getHealthStateMessage(healthKey);
      }

      if (window.kariesUI && typeof window.kariesUI.fadeInfo === 'function') {
        window.kariesUI.fadeInfo(msgSame);
      } else {
        window.dispatchEvent(new CustomEvent('health-stage-info', { detail: { msg: msgSame, key: healthKey } }));
      }
    } catch (e) { /* ignore */ }
    return;
  }

  let prevScaleScalar = BASE_SCALE;
  if (placedObject) {
    try { prevScaleScalar = placedObject.scale.x || BASE_SCALE; } catch (e) { prevScaleScalar = BASE_SCALE; }
  } else {
    prevScaleScalar = BASE_SCALE;
  }

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  if (placedObject) placedObject.matrixWorld.decompose(pos, quat, scl);
  else reticle.matrix.decompose(pos, quat, scl);

  const cachedEntry = modelCache[modelFile];

  (async () => {
    if (placedObject) {
      try { scene.remove(placedObject); disposeObject(placedObject); } catch (e) {}
      placedObject = null;
    }

    let stateMsg = "";

    if (lastAction === "brush") {
      stateMsg = "Bagus kamu telah menggosok gigi! Kamu dianjurkan menggosok gigi minimal dua kali sehari, yaitu setelah sarapan pagi dan sebelum tidur malam. Setiap kali menyikat gigi, lakukan selama minimal 2 menit ya!";
    } else if (lastAction === "healthy") {
      stateMsg = "Yummy! Makan makanan berserat itu artinya gigi kita kerja keras buat mengunyahnya. Jadi, dia membantu membuang kotoran dan sisa makanan yang menempel pada gigi!";
    } else if (lastAction === "sweet") {
      stateMsg = getHealthStateMessage(healthKey);
    } else {
      stateMsg = getHealthStateMessage(healthKey);
    }

    if (cachedEntry) {
      const newModel = cloneSceneWithClips(cachedEntry);
      newModel.position.copy(pos);
      newModel.quaternion.copy(quat);
      newModel.scale.set(prevScaleScalar, prevScaleScalar, prevScaleScalar);
      newModel.userData.modelFile = modelFile;
      applyMeshMaterialTweaks(newModel);
      scene.add(newModel);
      placedObject = newModel;

      try {
        if (window.kariesUI && typeof window.kariesUI.fadeInfo === 'function') {
          window.kariesUI.fadeInfo(stateMsg);
        } else {
          window.dispatchEvent(new CustomEvent('health-stage-info', { detail: { msg: stateMsg, key: healthKey } }));
        }
      } catch (e) { /* ignore */ }

      return;
    }

    loader.load(modelFile,
      (gltf) => {
        const newModel = gltf.scene || gltf.scenes[0];
        if (!newModel) { console.error('GLTF has no scene:', modelFile); return; }
        newModel.position.copy(pos);
        newModel.quaternion.copy(quat);
        newModel.scale.set(prevScaleScalar, prevScaleScalar, prevScaleScalar);
        newModel.userData.modelFile = modelFile;
        applyMeshMaterialTweaks(newModel);
        scene.add(newModel);
        placedObject = newModel;

        try {
          if (window.kariesUI && typeof window.kariesUI.fadeInfo === 'function') {
            window.kariesUI.fadeInfo(stateMsg);
          } else {
            window.dispatchEvent(new CustomEvent('health-stage-info', { detail: { msg: stateMsg, key: healthKey } }));
          }
        } catch (e) { /* ignore */ }
      },
      undefined,
      (err) => { console.error('failed to load', modelFile, err); }
    );
  })();
}

function disposeObject(obj) {
  obj.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) {
        c.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      } else {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function requestXRSession() {
  try {
    if (!('xr' in navigator)) throw new Error('WebXR tidak tersedia di browser ini.');
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) throw new Error('immersive-ar tidak didukung pada device/browser ini.');

    await preloadAllModelsAndInteractors();

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: document.body }
    });

    onSessionStarted(session);
  } catch (err) {
    console.error('requestXRSession failed:', err);
    alert('Gagal memulai AR: ' + (err && err.message ? err.message : err));
  }
}

async function onSessionStarted(session) {
  xrSession = session;
  xrBtn.textContent = 'STOP AR';
  xrBtn.classList.add('hidden');
  window.dispatchEvent(new CustomEvent('xr-started'));

  try {
    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    renderer.xr.setReferenceSpaceType('local');
    renderer.xr.setSession(session);
    hitTestSourceRequested = false;
    hitTestSource = null;
    session.addEventListener('end', onSessionEnded);
    renderer.setAnimationLoop(render);
  } catch (e) {
    console.error('Failed to start session render state:', e);
  }
}

function onSessionEnded() {
  xrSession = null;
  xrBtn.textContent = 'Enter AR';
  xrBtn.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('xr-ended'));
  hitTestSourceRequested = false;
  hitTestSource = null;
  renderer.setAnimationLoop(null);
}

function onSelect() {
  if (!reticle.visible || objectPlaced) {
    return;
  }

  reticle.matrix.decompose(_pos, _quat, _scale);
  const file = MODEL_MAP[DEFAULT_HEALTH_KEY];
  const cachedEntry = modelCache[file];
  if (cachedEntry) {
    const newModel = cloneSceneWithClips(cachedEntry);
    newModel.position.copy(_pos);
    newModel.quaternion.copy(_quat);
    newModel.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
    newModel.userData.modelFile = file;
    applyMeshMaterialTweaks(newModel);
    scene.add(newModel);
    placedObject = newModel;
    objectPlaced = true;
    reticle.visible = false;
    window.dispatchEvent(new CustomEvent('model-placed', { detail: newModel }));
    return;
  }

  loader.load(file, (gltf) => {
    const model = gltf.scene || gltf.scenes[0];
    if (!model) return;
    model.position.copy(_pos);
    model.quaternion.copy(_quat);
    model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
    model.userData.modelFile = file;
    applyMeshMaterialTweaks(model);
    scene.add(model);
    placedObject = model;
    objectPlaced = true;
    reticle.visible = false;
    window.dispatchEvent(new CustomEvent('model-placed', { detail: model }));
  }, undefined, (err) => {
    console.error('Error loading initial model:', err);
    alert('Gagal memuat model awal. Cek console.');
  });
}

function render(time, frame) {
  // hit test & reticle update
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = frame.session;
    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer')
        .then((viewerSpace) => session.requestHitTestSource({ space: viewerSpace }))
        .then((source) => {
          hitTestSource = source;
          hitTestSourceRequested = true;
        })
        .catch((err) => {
          console.warn('requesting hit test source failed:', err);
        });
    }

    if (hitTestSource && !objectPlaced) {
      const hitResults = frame.getHitTestResults(hitTestSource);
      if (hitResults.length > 0) {
        const hit = hitResults[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        reticle.visible = false;
      }
    }

    // update light follow
    if (spotLight && renderer.xr.isPresenting) {
      try {
        const xrCamera = renderer.xr.getCamera(camera);
        const camPos = new THREE.Vector3();
        xrCamera.getWorldPosition(camPos);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(xrCamera.quaternion);
        const upOffset = new THREE.Vector3(0, 0.45, 0);
        const spotPos = camPos.clone().add(forward.clone().multiplyScalar(0.45)).add(upOffset);
        spotLight.position.copy(spotPos);
        spotLight.target.position.copy(camPos.clone().add(forward.clone().multiplyScalar(1.2)));
        spotLight.target.updateMatrixWorld();
      } catch (err) { /* ignore */ }
    }
  }

  // ---------- APPLY SMOOTHED PINCH-TARGET SCALE HERE ----------
  // We only touch the object's scale if it exists and if pinchTargetScale is defined.
  // This keeps pointermove lightweight and surfaces scale changes inside RAF (GPU-friendly).
  try {
    if (placedObject && typeof pinchTargetScale !== 'undefined') {
      // create small epsilon to avoid micro changes
      const current = placedObject.scale.x;
      // apply smoothing lerp from current to target
      const next = lerp(current, pinchTargetScale, typeof SCALE_LERP_ALPHA !== 'undefined' ? SCALE_LERP_ALPHA : 0.28);
      // only set if difference passes threshold to avoid constant GPU state churn
      if (Math.abs(next - current) > 0.0005) {
        placedObject.scale.setScalar(next);
      }
    }
  } catch (err) { /* ignore */ }
  // ----------------------------------------------------------------

  renderer.render(scene, camera);
}

// initialize
initThree();
