// index.js (UPDATED) - applied items 1,3,4,5,6,7,8
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

// caches now store { scene, clips? } so animations are preserved
const modelCache = {};         // file -> { scene, clips }
const interactorCache = {};    // action -> { scene, clips }

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

  // lighting improvements (item 5)
  const ambient = new THREE.AmbientLight(0xffffff, 0.28);
  scene.add(ambient);

  // hemisphere light to give nicer gradient lighting for cavities
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

  spotLight = new THREE.SpotLight(0xffffff, 1.0, 8, Math.PI / 6, 0.25, 1); // stronger & slightly wider angle
  spotLight.position.set(0.6, 1.8, 0.6);
  spotLight.target.position.set(0, 0, 0);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 2048;
  spotLight.shadow.mapSize.height = 2048;
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
      // notify UI that animation finished successfully (UI will update bars and dispatch 'health-changed')
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

    // also broadcast terminal event if health reached zero (item 6)
    if (health <= 0) {
      window.dispatchEvent(new CustomEvent('terminal-reached', { detail: { reason: 'health_zero' } }));
    }
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
        // keep transparency enabled so fade animations can work
        mat.transparent = true;
        // ensure we start fully opaque
        if (typeof mat.opacity === 'undefined') mat.opacity = 1.0;
        mat.needsUpdate = true;
      }
    }
  });
}

// ---- PRELOAD ALL MODELS (tooth + interactors) ----
// store both scene and animations (so we can play baked GLB clips)
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
          // store into appropriate cache (store original)
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
          resolve(); // don't block
        }
      );
    }));
  });
  return Promise.all(promises);
}

// clone helper: clone scene and attach clips (if any) to clone.userData._clips
function cloneSceneWithClips(entry) {
  // entry = { scene, clips }
  if (!entry || !entry.scene) return null;
  const cloned = entry.scene.clone(true);
  // copy animations (clips) onto userData for later use
  cloned.userData = cloned.userData || {};
  cloned.userData._clips = entry.clips ? entry.clips.slice() : [];
  return cloned;
}

// spawn interactor (clone cached glb or load fallback)
async function runInteractorAnimation(action) {
  const file = INTERACTORS[action];
  if (!file) return;

  // Note: UI already disabled buttons upon request; index.js does not re-enable here.
  let interactorRoot = null;
  const cachedEntry = interactorCache[action];
  if (cachedEntry) {
    interactorRoot = cloneSceneWithClips(cachedEntry);
  } else {
    // fallback load
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

  // set initial local transform depending on action (fall from above for food)
  const localStart = new THREE.Vector3();
  const localRot = new THREE.Euler();
  const localScale = new THREE.Vector3(1,1,1);

  // === ITEM 1: new recommended brush position & orbit center ===
  if (action === 'brush') {
    // Recommended natural starting point: slightly above & in front of tooth center,
    // so the brush orbits around the crown area without being too far.
    localStart.set(0.0, 0.32, 0.12); // x (right), y (up), z (forward)
    localRot.set(-1.0, 0.2, 0);      // tilt the brush toward the tooth
    localScale.set(0.45,0.45,0.45);  // smaller, natural scale
  } else if (action === 'healthy') {
    // ITEM 3: adjust carrot smaller and start higher so it falls and doesn't appear huge
    localStart.set(0.0, 1.6, 0.9);
    localRot.set(-0.25, 0, -0.5);
    localScale.set(0.34,0.34,0.34);
  } else if (action === 'sweet') {
    // ITEM 3: candy smaller and start higher
    localStart.set(0.08, 1.8, 0.95);
    localRot.set(0, 0.4, 0.8);
    localScale.set(0.28,0.28,0.28);
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
  if (action === 'brush') animPromise = animateBrushWithPossibleGLB(animatorWrap(wrapper, interactorRoot));
  else if (action === 'healthy') animPromise = animateCarrotFade(wrapper);
  else if (action === 'sweet') animPromise = animateCandyFade(wrapper);
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

// small helper to attach interactor root as second param for brush animation that may play GLB clips
function animatorWrap(wrapper) {
  return function getWrapperAndRoot() {
    // wrapper is the group; first child is the interactor model
    const root = wrapper.children && wrapper.children[0] ? wrapper.children[0] : null;
    return { wrapper, root };
  };
}

// ---- Anim helpers (simple tweening using requestAnimationFrame) ----
function lerp(a,b,t){ return a + (b-a)*t; }
function easeInOutQuad(t){ return t<0.5 ? 2*t*t : -1 + (4-2*t)*t; }

// animateBrush: tries to play GLB internal animation first, otherwise do circular orbit
function animateBrushWithPossibleGLB(getPair) {
  // getPair returns { wrapper, root }
  const pair = getPair();
  const wrapper = pair.wrapper;
  const root = pair.root;

  // if root has clips in userData, play them via AnimationMixer
  const clips = (root && root.userData && root.userData._clips) ? root.userData._clips : [];
  if (clips && clips.length) {
    return new Promise((resolve) => {
      const mixer = new THREE.AnimationMixer(root);
      // play first clip (you can choose by name if desired)
      const clip = clips[0];
      const action = mixer.clipAction(clip);
      action.reset();
      action.play();

      let lastTime = performance.now();
      function frame(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        try { mixer.update(dt); } catch (e) { /* ignore */ }
        // if action finished -> resolve
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

  // FALLBACK: do circular orbit above tooth (configurable params)
  return animateBrush(wrapper);
}

// previous animateBrush function (circular orbit) - uses parameters from earlier convo (item 1)
function animateBrush(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    // capture initial local pos/rot/scale
    const cx = wrapper.position.x;
    const cy = wrapper.position.y;
    const cz = wrapper.position.z;
    const initialRotZ = wrapper.rotation.z;
    const initialScale = wrapper.scale.x;

    // CONFIGURABLE: radius, revolutions, orbitDuration (you can tweak these)
    const radius = 0.12;          // orbit radius (local units) - set smaller for natural orbit
    const revolutions = 2;        // number of circles
    const orbitDuration = 900;    // duration in ms for all revolutions
    const approachDur = 120;
    const retreatDur = 120;
    const totalOrbitTime = orbitDuration;

    function frame(now) {
      const elapsed = now - start;

      // approach phase
      if (elapsed < approachDur) {
        const t = easeInOutQuad(elapsed / approachDur);
        wrapper.position.z = lerp(cz + 0.03, cz - 0.04, t);
        wrapper.rotation.x = lerp(wrapper.rotation.x, wrapper.rotation.x - 0.03, t);
        requestAnimationFrame(frame);
        return;
      }

      const orbitStart = approachDur;
      const orbitEnd = approachDur + totalOrbitTime;

      // orbit phase
      if (elapsed >= orbitStart && elapsed < orbitEnd) {
        const t = (elapsed - orbitStart) / (orbitEnd - orbitStart); // 0..1
        const eased = easeInOutQuad(t);
        const angle = eased * revolutions * Math.PI * 2;
        const ox = cx + Math.cos(angle) * radius;
        const oy = cy + Math.sin(angle) * (radius * 0.45);
        const contact = 0.015 * Math.sin(angle * 4);
        wrapper.position.x = ox;
        wrapper.position.y = oy - Math.abs(contact);
        wrapper.rotation.z = initialRotZ + Math.sin(angle) * 0.18;
        wrapper.rotation.x = -1.0 + Math.cos(angle * 2) * 0.04;
        wrapper.scale.setScalar(initialScale * (1 + 0.015 * Math.sin(angle * 3)));
        requestAnimationFrame(frame);
        return;
      }

      // retreat
      if (elapsed >= orbitEnd && elapsed < orbitEnd + retreatDur) {
        const t2 = (elapsed - orbitEnd) / retreatDur;
        const tt2 = easeInOutQuad(t2);
        wrapper.position.x = lerp(wrapper.position.x, cx, tt2);
        wrapper.position.y = lerp(wrapper.position.y, cy, tt2);
        wrapper.position.z = lerp(wrapper.position.z, cz, tt2);
        wrapper.rotation.z = lerp(wrapper.rotation.z, initialRotZ, tt2);
        wrapper.rotation.x = lerp(wrapper.rotation.x, -1.0, tt2);
        wrapper.scale.setScalar(lerp(wrapper.scale.x, initialScale, tt2));
        requestAnimationFrame(frame);
        return;
      }

      resolve();
    }

    requestAnimationFrame(frame);
  });
}

// --- carrot fall + fade (uses initialScale to avoid exploding) ---
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

// --- candy fall + fade (uses initialScale) ---
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

  const cachedEntry = modelCache[modelFile];

  (async () => {
    // replace model immediately (no fancy scale animation).
    if (placedObject) {
      try { scene.remove(placedObject); disposeObject(placedObject); } catch (e) {}
      placedObject = null;
    }

    if (cachedEntry) {
      const newModel = cloneSceneWithClips(cachedEntry);
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

    // preload everything (tooth + interactors) - item 7
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
