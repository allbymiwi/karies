// index.js (final) - integrated with falling interactors & animated swap
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

  // listen for UI health updates (swap tooth)
  window.addEventListener('health-changed', (e) => {
    const health = e.detail && typeof e.detail.health === 'number' ? e.detail.health : null;
    if (health === null) return;
    const key = clampHealthKey(health);
    currentHealthModelKey = key;
    if (objectPlaced) swapModelForHealth(key);
  });

  // listen reset event from UI
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

  // listen ui-action to spawn interactor animations
  window.addEventListener('ui-action', (e) => {
    const action = e.detail;
    if (!action || !objectPlaced) return;
    if (action === 'brush' || action === 'healthy' || action === 'sweet') {
      runInteractorAnimation(action).catch(err => console.warn('interactor anim error', err));
    }
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
          // store into appropriate cache
          if (Object.values(MODEL_MAP).includes(file)) modelCache[file] = node;
          if (Object.values(INTERACTORS).includes(file)) {
            const actionKey = Object.keys(INTERACTORS).find(k => INTERACTORS[k] === file);
            if (actionKey) interactorCache[actionKey] = node;
          }
          resolve();
        },
        undefined,
        (err) => {
          console.warn('preload failed', file, err);
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

  // disable UI buttons while interact anim runs (UI will re-enable if allowed)
  try { window.kariesUI?.setButtonsEnabled(false); } catch (e) {}

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

  if (!placedObject) {
    try { window.kariesUI?.setButtonsEnabled(true); } catch (e) {}
    return;
  }

  // set initial local transform depending on action (adjusted: falling from above for food)
  const localStart = new THREE.Vector3();
  const localRot = new THREE.Euler();
  const localScale = new THREE.Vector3(1,1,1);

  if (action === 'brush') {
    // sikat: a bit above/front for clear stroke
    localStart.set(0.42, 0.20, 0.32);
    localRot.set(-0.6, 0.6, -1.2);
    localScale.set(0.65,0.65,0.65);
  } else if (action === 'healthy') {
    // wortel: start high above and a bit in front (will fall)
    localStart.set(0.0, 1.6, 0.9);
    localRot.set(-0.25, 0, 0);
    localScale.set(0.38,0.38,0.38); // smaller
  } else if (action === 'sweet') {
    // permen: start higher & further, small
    localStart.set(0.08, 1.8, 0.95);
    localRot.set(0, 0.4, 0.1);
    localScale.set(0.28,0.28,0.28); // smaller
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
  else if (action === 'healthy') animPromise = animateCarrot(wrapper);
  else if (action === 'sweet') animPromise = animateCandy(wrapper);
  else animPromise = Promise.resolve();

  // wait animation finish
  await animPromise;

  // cleanup
  try {
    placedObject.remove(wrapper);
    disposeObject(wrapper);
  } catch (e) { /* ignore */ }

  // re-enable buttons only if UI not in terminal state
  try {
    const state = window.kariesUI && typeof window.kariesUI._getState === 'function' ? window.kariesUI._getState() : null;
    const terminal = state && (state.cleanValue <= 0 && state.healthValue <= 0);
    if (!terminal) {
      window.kariesUI?.setButtonsEnabled(true);
    } else {
      console.log('UI is terminal — leaving buttons locked after interactor.');
    }
  } catch (e) {
    try { window.kariesUI?.setButtonsEnabled(true); } catch (err) {}
  }

  return;
}

// ---- Anim helpers (simple tweening using requestAnimationFrame) ----
function lerp(a,b,t){ return a + (b-a)*t; }
function easeInOutQuad(t){ return t<0.5 ? 2*t*t : -1 + (4-2*t)*t; }

// animate brush: approach -> 2 strokes -> retreat
function animateBrush(wrapper) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const initial = { x: wrapper.position.x, y: wrapper.position.y, z: wrapper.position.z, rotZ: wrapper.rotation.z };
    const approachDur = 120;
    const strokeDur = 370;
    const retreatDur = 120;

    function frame(now){
      const elapsed = now - startTime;
      if (elapsed < approachDur) {
        const t = easeInOutQuad(elapsed / approachDur);
        wrapper.position.z = lerp(initial.z, initial.z - 0.12, t);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < approachDur + strokeDur) {
        const t = (elapsed - approachDur) / strokeDur;
        const tt = easeInOutQuad(t);
        wrapper.rotation.z = initial.rotZ + 0.45 * Math.sin(tt * Math.PI);
        wrapper.position.x = lerp(initial.x, initial.x - 0.18, tt);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < approachDur + 2*strokeDur) {
        const t2 = (elapsed - (approachDur + strokeDur)) / strokeDur;
        const tt2 = easeInOutQuad(t2);
        wrapper.rotation.z = lerp(initial.rotZ + 0.45, initial.rotZ - 0.25, Math.sin(tt2 * Math.PI));
        wrapper.position.x = lerp(initial.x - 0.18, initial.x + 0.06, tt2);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < approachDur + 2*strokeDur + retreatDur) {
        const t3 = (elapsed - (approachDur + 2*strokeDur)) / retreatDur;
        const tt3 = easeInOutQuad(t3);
        wrapper.position.z = lerp(initial.z - 0.12, initial.z, tt3);
        wrapper.position.x = lerp(initial.x + 0.06, initial.x, tt3);
        wrapper.rotation.z = lerp(initial.rotZ - 0.25, initial.rotZ, tt3);
        requestAnimationFrame(frame);
        return;
      }
      resolve();
    }
    requestAnimationFrame(frame);
  });
}

// animate carrot: fall from above, pop, vanish
function animateCarrot(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startY = wrapper.position.y;
    const startZ = wrapper.position.z;
    const approach = 420; // fall time
    const pop = 180;      // pop/bounce
    const out = 240;      // vanish

    function frame(now) {
      const elapsed = now - start;
      if (elapsed < approach) {
        const t = Math.min(1, elapsed / approach);
        const tt = t * t; // ease-in for gravity feel
        wrapper.position.y = lerp(startY, startY - 1.05, tt);
        wrapper.position.z = lerp(startZ, startZ - 0.45, tt);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < approach + pop) {
        const t2 = (elapsed - approach) / pop;
        const pulse = Math.sin(t2 * Math.PI);
        wrapper.scale.setScalar(lerp(0.9, 1.08, pulse));
        wrapper.position.y = lerp(startY - 1.05, startY - 0.9, pulse * 0.6);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < approach + pop + out) {
        const t3 = (elapsed - approach - pop) / out;
        const tt3 = easeInOutQuad(t3);
        wrapper.scale.setScalar(lerp(1.08, 0.02, tt3));
        wrapper.position.y = lerp(startY - 0.9, startY + 0.5, tt3);
        requestAnimationFrame(frame);
        return;
      }
      resolve();
    }
    requestAnimationFrame(frame);
  });
}

// animate candy: fall from above, stick pulse, vanish
function animateCandy(wrapper) {
  return new Promise((resolve) => {
    const start = performance.now();
    const startY = wrapper.position.y;
    const startZ = wrapper.position.z;
    const fall = 320;
    const stick = 260;
    const vanish = 220;
    const initialScale = wrapper.scale.x;

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
        const pulse = 1 + 0.16 * Math.sin(t2 * Math.PI * 3);
        wrapper.scale.setScalar(initialScale * pulse);
        requestAnimationFrame(frame);
        return;
      }
      if (elapsed < fall + stick + vanish) {
        const t3 = (elapsed - fall - stick) / vanish;
        const tt3 = easeInOutQuad(t3);
        wrapper.scale.setScalar(lerp(initialScale * 1.16, 0.01, tt3));
        wrapper.position.y = lerp(startY - 1.05, startY + 0.6, tt3);
        requestAnimationFrame(frame);
        return;
      }
      resolve();
    }
    requestAnimationFrame(frame);
  });
}

// ---- Animated swapModelForHealth (scale out/in) ----
function swapModelForHealth(healthKey) {
  const modelFile = MODEL_MAP[healthKey];
  if (!modelFile) return;
  if (placedObject && placedObject.userData && placedObject.userData.modelFile === modelFile) return;
  console.log('Swapping model to', modelFile);

  // capture world transform
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  if (placedObject) placedObject.matrixWorld.decompose(pos, quat, scl);
  else reticle.matrix.decompose(pos, quat, scl);

  const animateScale = (obj, from, to, duration=200) => {
    return new Promise(resolve => {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const tt = t<0.5 ? 2*t*t : -1 + (4-2*t)*t; // easeInOutQuad
        const s = from + (to - from) * tt;
        obj.scale.setScalar(s);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  };

  const cached = modelCache[modelFile];

  (async () => {
    if (placedObject) {
      try { await animateScale(placedObject, placedObject.scale.x, 0.01, 180); } catch(e){ console.warn(e); }
      try { scene.remove(placedObject); disposeObject(placedObject); } catch(e){/*ignore*/ }
      placedObject = null;
    }

    if (cached) {
      const newModel = cached.clone(true);
      newModel.position.copy(pos);
      newModel.quaternion.copy(quat);
      newModel.scale.set(0.01,0.01,0.01);
      newModel.userData.modelFile = modelFile;
      applyMeshMaterialTweaks(newModel);
      scene.add(newModel);
      placedObject = newModel;
      await animateScale(placedObject, 0.01, BASE_SCALE, 200);
      console.log('Model swapped (cache) to', modelFile);
      return;
    }

    loader.load(modelFile,
      async (gltf) => {
        const newModel = gltf.scene || gltf.scenes[0];
        if (!newModel) { console.error('GLTF has no scene:', modelFile); return; }
        newModel.position.copy(pos);
        newModel.quaternion.copy(quat);
        newModel.scale.set(0.01,0.01,0.01);
        newModel.userData.modelFile = modelFile;
        applyMeshMaterialTweaks(newModel);
        scene.add(newModel);
        placedObject = newModel;
        await animateScale(placedObject, 0.01, BASE_SCALE, 200);
        console.log('Model swapped (loaded) to', modelFile);
      },
      undefined,
      (err) => {
        console.error('Failed to load model', modelFile, err);
      }
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
