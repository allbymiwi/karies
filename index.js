// index.js (brush animation: circular orbit over tooth) - full file
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

// caches
const modelCache = {};         // for tooth models (file -> scene)
const interactorCache = {};    // for interactor models (action -> scene)

// tmp
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

const xrBtn = document.getElementById('xrBtn');

// lighting global
let spotLight = null;

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearAlpha(0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  scene = new THREE.Scene();

  // lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(1.5, 3, 2);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 1024;
  dir.shadow.mapSize.height = 1024;
  scene.add(dir);
  const rim = new THREE.PointLight(0xfff6d8, 0.6, 6);
  rim.position.set(-1.5, 1.5, -1.5);
  scene.add(rim);
  spotLight = new THREE.SpotLight(0xffffff, 0.6, 6, Math.PI / 8, 0.3, 1);
  spotLight.position.set(0.6, 1.8, 0.6);
  spotLight.target.position.set(0, 0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 1024;
  spotLight.shadow.mapSize.height = 1024;
  scene.add(spotLight);
  scene.add(spotLight.target);

  // reticle
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

  // IMPORTANT: listen for "ui-action-request" instead of instantly changing health
  window.addEventListener('ui-action-request', async (e) => {
    const action = e.detail && e.detail.action ? e.detail.action : e.detail || null;
    if (!action || !objectPlaced) {
      // notify UI that animation couldn't run
      window.dispatchEvent(new CustomEvent('interactor-finished', { detail: { action, status: 'skipped' } }));
      return;
    }
    try {
      await runInteractorAnimation(action);
      // notify UI that animation finished successfully
      window.dispatchEvent(new CustomEvent('interactor-finished', { detail: { action, status: 'ok' } }));
    } catch (err) {
      console.warn('interactor anim error', err);
      window.dispatchEvent(new CustomEvent('interactor-finished', { detail: { action, status: 'error' } }));
    }
  });

  // UI dispatches health-changed after it updates values (upon interactor-finished)
  window.addEventListener('health-changed', (e) => {
    const health = e.detail && typeof e.detail.health === 'number' ? e.detail.health : null;
    if (health === null) return;
    const key = clampHealthKey(health);
    currentHealthModelKey = key;
    if (objectPlaced) swapModelForHealthAfterDelay(key);
  });

  // reset listener
  window.addEventListener('reset', () => {
    console.log('Reset event received - removing placed model and resetting AR state.');
    if (placedObject) {
      scene.remove(placedObject);
      try { disposeObject(placedObject); } catch (err) { console.warn('dispose failed', err); }
      placedObject = null;
    }
    objectPlaced = false;
    currentHealthModelKey = DEFAULT_HEALTH_KEY;
  });

  console.log('index.js loaded. Ready.');
}

// clamp to discrete keys
function clampHealthKey(health) {
  if (health >= 100) return 100;
  if (health >= 75) return 75;
  if (health >= 50) return 50;
  if (health >= 25) return 25;
  return 0;
}

// apply tweaks to meshes for better contrast
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
        mat.transparent = true; // enable transparency for fade-outs
        mat.needsUpdate = true;
      }
    }
  });
}

// ---- PRELOAD ALL MODELS (tooth + interactors) ----
function preloadAllModelsAndInteractors() {
  const files = new Set(Object.values(MODEL_MAP).concat(Object.values(INTERACTORS)));
  const promises = [];
  files.forEach((file) => {
    if (!file) return;
    promises.push(new Promise((resolve) => {
      loader.load(file,
        (gltf) => {
          const node = gltf.scene || gltf.scenes[0];
          if (!node) { resolve(); return; }
          applyMeshMaterialTweaks(node);
          // store into appropriate cache (store original)
          if (Object.values(MODEL_MAP).includes(file)) modelCache[file] = node;
          if (Object.values(INTERACTORS).includes(file)) {
            const actionKey = Object.keys(INTERACTORS).find(k => INTERACTORS[k] === file);
            if (actionKey) interactorCache[actionKey] = node;
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn('preload failed for', file, err);
          resolve(); // don't block
        }
      );
    }));
  });
  return Promise.all(promises);
}

// spawn interactor (clone cached glb or load fallback)
async function runInteractorAnimation(action) {
  const file = INTERACTORS[action];
  if (!file) return;

  // Note: UI already disabled buttons upon request; index.js does not re-enable here.
  let interactorRoot = null;
  const cached = interactorCache[action];
  if (cached) interactorRoot = cached.clone(true);
  else {
    // fallback load
    const gltf = await new Promise((res, rej) => {
      loader.load(file, (g) => res(g), undefined, (err) => rej(err));
    });
    interactorRoot = gltf.scene || gltf.scenes[0];
  }

  if (!placedObject) return;

  // set initial local transform depending on action (fall from above for food)
  const localStart = new THREE.Vector3();
  const localRot = new THREE.Euler();
  const localScale = new THREE.Vector3(1,1,1);

  if (action === 'brush') {
    // sikat: a bit above/front for circular orbit
    localStart.set(0.0, 0.2, 0.0); // above tooth center (adjust if needed)
    localRot.set(0, 0, 0);       // tilted downwards
    localScale.set(0.55,0.55,0.55);  // suitable brush size
  } else if (action === 'healthy') {
    // wortel: start high above and a bit in front (will fall)
    localStart.set(0.0, 1.6, 0.65);
    localRot.set(-0.25, 0, -0.5);
    localScale.set(0.40,0.40,0.40); // slightly smaller
  } else if (action === 'sweet') {
    // permen: start higher & further, small
    localStart.set(0.08, 1.8, 0.7);
    localRot.set(0, 0.4, 0.8);
    localScale.set(0.32,0.32,0.32); // smaller
  }

  // wrapper group to animate local transforms easily
  const wrapper = new THREE.Group();
  wrapper.position.copy(localStart);
  wrapper.rotation.copy(localRot);
  wrapper.scale.copy(localScale);
  wrapper.userData._isInteractor = true;

  applyMeshMaterialTweaks(interactorRoot);
  wrapper.add(interactorRoot);
  // attach to placedObject so wrapper local coords are relative to tooth
  placedObject.add(wrapper);

  // animate depending on action
  let animPromise = null;
  if (action === 'brush') animPromise = animateBrush(wrapper);
  else if (action === 'healthy') animPromise = animateCarrotFade(wrapper); // fade version
  else if (action === 'sweet') animPromise = animateCandyFade(wrapper);     // fade version
  else animPromise = Promise.resolve();

  // wait animation finish
  await animPromise;

  // cleanup
  try {
    placedObject.remove(wrapper);
    disposeObject(wrapper);
  } catch (e) { /* ignore */ }

  return;
}

// ---- Anim helpers (simple tweening using requestAnimationFrame) ----
function lerp(a,b,t){ return a + (b-a)*t; }
function easeInOutQuad(t){ return t<0.5 ? 2*t*t : -1 + (4-2*t)*t; }

// --- NEW: animateBrush -> circular orbit above tooth
function animateBrush(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    // capture initial local pos/rot/scale
    const cx = wrapper.position.x;
    const cy = wrapper.position.y;
    const cz = wrapper.position.z;
    const initialRotZ = wrapper.rotation.z;
    const initialScale = wrapper.scale.x;

    // config: orbit radius (local), number of revolutions, durations (ms)
    const radius = 0.50;          // orbit radius in local units (adjustable)
    const revolutions = 5;        // how many circles
    const orbitDuration = 5000;    // ms total for orbit phase
    const approachDur = 140;      // move into orbit from slightly farther
    const retreatDur = 140;       // move back to start and finish
    const totalOrbitTime = orbitDuration;

    // We'll do: approach -> orbit (revolutions) -> retreat
    function frame(now) {
      const elapsed = now - start;

      // approach phase: move from slightly farther Z toward cz - 0.06 (closer)
      if (elapsed < approachDur) {
        const t = easeInOutQuad(elapsed / approachDur);
        wrapper.position.z = lerp(cz + 0.05, cz - 0.06, t); // come closer a bit
        // slight tilt change
        wrapper.rotation.x = lerp(wrapper.rotation.x, wrapper.rotation.x - 0.05, t);
        requestAnimationFrame(frame);
        return;
      }

      const orbitStart = approachDur;
      const orbitEnd = approachDur + totalOrbitTime;

      // orbit phase
      if (elapsed >= orbitStart && elapsed < orbitEnd) {
        const t = (elapsed - orbitStart) / (orbitEnd - orbitStart); // 0..1 through orbit
        const eased = easeInOutQuad(t);
        const angle = eased * revolutions * Math.PI * 2; // radians progressed
        // compute circular position in local coordinates (around tooth center)
        const ox = cx + Math.cos(angle) * radius;
        const oy = cy + Math.sin(angle) * (radius * 0.45); // elliptical: less vertical radius
        // slight vertical bob to simulate contact
        const contact = 0.02 * Math.sin(angle * 4); // small wiggle
        wrapper.position.x = ox;
        wrapper.position.y = oy - Math.abs(contact); // dip slightly on contact parts
        // rotate brush head a bit to follow motion for realism
        wrapper.rotation.z = initialRotZ + Math.sin(angle) * 0.25;
        wrapper.rotation.x = -0.85 + Math.cos(angle * 2) * 0.06;
        // maybe a tiny scale pulse to suggest pressure
        wrapper.scale.setScalar(initialScale * (1 + 0.02 * Math.sin(angle * 3)));
        requestAnimationFrame(frame);
        return;
      }

      // retreat phase: move back to original local pos and rotation
      if (elapsed >= orbitEnd && elapsed < orbitEnd + retreatDur) {
        const t2 = (elapsed - orbitEnd) / retreatDur;
        const tt2 = easeInOutQuad(t2);
        // interpolate position from current to original (cx,cy,cz)
        wrapper.position.x = lerp(wrapper.position.x, cx, tt2);
        wrapper.position.y = lerp(wrapper.position.y, cy, tt2);
        wrapper.position.z = lerp(wrapper.position.z, cz, tt2);
        // reset rotation & scale
        wrapper.rotation.z = lerp(wrapper.rotation.z, initialRotZ, tt2);
        wrapper.rotation.x = lerp(wrapper.rotation.x, -0.85, tt2);
        wrapper.scale.setScalar(lerp(wrapper.scale.x, initialScale, tt2));
        requestAnimationFrame(frame);
        return;
      }

      // done
      resolve();
    }

    requestAnimationFrame(frame);
  });
}

// --- FIXED: animate carrot with fade-out (fall -> bounce -> fade) using initialScale
function animateCarrotFade(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startY = wrapper.position.y;
    const startZ = wrapper.position.z;
    const initialScale = wrapper.scale.x;    // capture initial scale
    const fall = 420; // fall time
    const bounce = 180;
    const fade = 260;

    // set initial material opacity to 1
    wrapper.traverse((c) => { if (c.isMesh && c.material) c.material.opacity = 1.0; });

    function frame(now) {
      const elapsed = now - start;
      if (elapsed < fall) {
        const t = Math.min(1, elapsed / fall);
        const tt = t * t; // ease-in for gravity feel
        wrapper.position.y = lerp(startY, startY - 1.05, tt);
        wrapper.position.z = lerp(startZ, startZ - 0.45, tt);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + bounce) {
        const t2 = (elapsed - fall) / bounce;
        const pulse = Math.sin(t2 * Math.PI); // 0..1..0
        // scale relative to initialScale (no absolute jump)
        const scaleFactor = lerp(0.9, 1.02, pulse);
        wrapper.scale.setScalar(initialScale * scaleFactor);
        wrapper.position.y = lerp(startY - 1.05, startY - 0.92, pulse * 0.6);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + bounce + fade) {
        const t3 = (elapsed - fall - bounce) / fade;
        const tt3 = easeInOutQuad(t3);
        // fade opacity to 0
        wrapper.traverse((c) => {
          if (c.isMesh && c.material) c.material.opacity = 1 - tt3;
        });
        // slight upward move while fading
        wrapper.position.y = lerp(startY - 0.92, startY + 0.45, tt3);
        // shrink relative to initial
        wrapper.scale.setScalar(initialScale * lerp(1.02, 0.02, tt3));
        requestAnimationFrame(frame);
        return;
      }
      resolve();
    }
    requestAnimationFrame(frame);
  });
}

// --- FIXED: animate candy with fade-out using initialScale
function animateCandyFade(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startY = wrapper.position.y;
    const startZ = wrapper.position.z;
    const initialScale = wrapper.scale.x; // capture initial scale
    const fall = 320;
    const stick = 260;
    const fade = 220;

    // set initial material opacity to 1
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

// ---- Swap model AFTER UI dispatches health-changed (no scale out/in) ----
function swapModelForHealthAfterDelay(healthKey) {
  const modelFile = MODEL_MAP[healthKey];
  if (!modelFile) return;
  if (placedObject && placedObject.userData && placedObject.userData.modelFile === modelFile) return;
  console.log('Scheduling swap to', modelFile);

  // capture world transform
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  if (placedObject) placedObject.matrixWorld.decompose(pos, quat, scl);
  else reticle.matrix.decompose(pos, quat, scl);

  const cached = modelCache[modelFile];

  (async () => {
    // replace model immediately (no fancy scale animation).
    if (placedObject) {
      try { scene.remove(placedObject); disposeObject(placedObject); } catch (e) {}
      placedObject = null;
    }

    if (cached) {
      const newModel = cached.clone(true);
      newModel.position.copy(pos);
      newModel.quaternion.copy(quat);
      newModel.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
      newModel.userData.modelFile = modelFile;
      applyMeshMaterialTweaks(newModel);
      scene.add(newModel);
      placedObject = newModel;
      console.log('Model swapped (cache) to', modelFile);
      return;
    }

    loader.load(modelFile,
      (gltf) => {
        const newModel = gltf.scene || gltf.scenes[0];
        if (!newModel) { console.error('GLTF has no scene:', modelFile); return; }
        newModel.position.copy(pos);
        newModel.quaternion.copy(quat);
        newModel.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
        newModel.userData.modelFile = modelFile;
        applyMeshMaterialTweaks(newModel);
        scene.add(newModel);
        placedObject = newModel;
        console.log('Model swapped (loaded) to', modelFile);
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

    // preload everything (tooth + interactors)
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
  hitTestSourceRequested = false;
  hitTestSource = null;
  renderer.setAnimationLoop(null);
  console.log('XR session ended.');
}

function endXRSession() {
  if (!xrSession) return;
  xrSession.end().catch(err => console.warn('end XR failed', err));
}

function onSelect() {
  if (!reticle.visible || objectPlaced) {
    console.log('select ignored: reticle.visible=', reticle.visible, ' objectPlaced=', objectPlaced);
    return;
  }

  reticle.matrix.decompose(_pos, _quat, _scale);
  const file = MODEL_MAP[DEFAULT_HEALTH_KEY];
  const cached = modelCache[file];
  if (cached) {
    const newModel = cached.clone(true);
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
    console.log('Initial model placed (cache):', file);
    return;
  }

  loader.load(file, (gltf) => {
    const model = gltf.scene || gltf.scenes[0];
    if (!model) { console.error('GLTF has no scene.'); return; }
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
    console.log('Initial model placed (loaded):', file);
  }, undefined, (err) => {
    console.error('Error loading initial model:', err);
    alert('Gagal memuat model awal. Cek console.');
  });
}

function render(time, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = frame.session;
    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer')
        .then((viewerSpace) => session.requestHitTestSource({ space: viewerSpace }))
        .then((source) => {
          hitTestSource = source;
          hitTestSourceRequested = true;
          console.log('hitTestSource ready');
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

    // update spotLight to follow camera a bit
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

  renderer.render(scene, camera);
}

// initialize
initThree();














