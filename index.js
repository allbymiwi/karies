// index.js (full, integrated)
// Requirements:
// - modules/three.module.js
// - modules/GLTFLoader.js
// - gigisehat.glb, gigiplak.glb, gigiasam.glb, gigidemineralisasi.glb, gigikaries.glb
import * as THREE from './modules/three.module.js';
import { GLTFLoader } from './modules/GLTFLoader.js';

// Model mapping
const MODEL_MAP = {
  100: 'gigisehat.glb',
  75:  'gigiplak.glb',
  50:  'gigiasam.glb',
  25:  'gigidemineralisasi.glb',
  0:   'gigikaries.glb'
};
const DEFAULT_HEALTH_KEY = 100;
const BASE_SCALE = 0.25; // tweak if model too big/small

// renderer / scene
let renderer, scene, camera, gl;
let controller, reticle;
let loader;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let objectPlaced = false;
let placedObject = null;
let currentHealthModelKey = DEFAULT_HEALTH_KEY;

// preload cache: map modelFile -> gltf.scene (original loaded)
const modelCache = {};

// temp vars
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

const xrBtn = document.getElementById('xrBtn');

// lighting global (spot follow camera)
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

  // enable shadows
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  scene = new THREE.Scene();

  // --- Lighting ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(1.5, 3, 2);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 1024;
  dir.shadow.mapSize.height = 1024;
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 20;
  dir.shadow.camera.left = -2;
  dir.shadow.camera.right = 2;
  dir.shadow.camera.top = 2;
  dir.shadow.camera.bottom = -2;
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
  // --- end lighting ---

  // Reticle (ring)
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // controller
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', onWindowResize);

  // listen for UI health updates (swap model)
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

  console.log('index.js loaded. Ready.');
}

// clamp to discrete keys: 100/75/50/25/0
function clampHealthKey(health) {
  if (health >= 100) return 100;
  if (health >= 75) return 75;
  if (health >= 50) return 50;
  if (health >= 25) return 25;
  return 0;
}

// ---- PRELOAD MODELS ----
// returns Promise that resolves when all models loaded into modelCache
function preloadAllModels() {
  const promises = [];
  const loadedFiles = new Set();
  for (const key in MODEL_MAP) {
    const file = MODEL_MAP[key];
    if (!file || loadedFiles.has(file)) continue;
    loadedFiles.add(file);
    promises.push(new Promise((resolve, reject) => {
      loader.load(file,
        (gltf) => {
          const sceneNode = gltf.scene || gltf.scenes[0];
          if (!sceneNode) {
            console.warn('Preload: gltf has no scene', file);
            resolve();
            return;
          }
          // apply material/shadow tweaks on cached original
          applyMeshMaterialTweaks(sceneNode);
          // store original scene (not added to main scene)
          modelCache[file] = sceneNode;
          resolve();
        },
        undefined,
        (err) => {
          console.error('Preload failed for', file, err);
          // still resolve to avoid blocking everything
          resolve();
        }
      );
    }));
  }
  return Promise.all(promises);
}

// apply tweaks to meshes for better contrast & shadows
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

// swap model shown based on health key (100/75/50/25/0)
// this uses preloaded originals from modelCache and clones them
function swapModelForHealth(healthKey) {
  const modelFile = MODEL_MAP[healthKey];
  if (!modelFile) return;
  if (placedObject && placedObject.userData && placedObject.userData.modelFile === modelFile) return;

  console.log('Swapping model to', modelFile);

  // compute transform to reapply
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  if (placedObject) placedObject.matrixWorld.decompose(pos, quat, scl);
  else reticle.matrix.decompose(pos, quat, scl);

  // if cached, clone and use immediately
  const cached = modelCache[modelFile];
  if (cached) {
    // remove old
    if (placedObject) {
      scene.remove(placedObject);
      disposeObject(placedObject);
      placedObject = null;
    }
    // clone deep
    const newModel = cached.clone(true);
    newModel.position.copy(pos);
    newModel.quaternion.copy(quat);
    newModel.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
    newModel.userData.modelFile = modelFile;

    // ensure tweaks on clone meshes (some clone ops keep materials references)
    applyMeshMaterialTweaks(newModel);

    scene.add(newModel);
    placedObject = newModel;
    console.log('Model swapped (from cache) to', modelFile);
    return;
  }

  // fallback: load if not cached
  loader.load(modelFile,
    (gltf) => {
      const newModel = gltf.scene || gltf.scenes[0];
      if (!newModel) {
        console.error('GLTF has no scene:', modelFile);
        return;
      }
      if (placedObject) {
        scene.remove(placedObject);
        disposeObject(placedObject);
        placedObject = null;
      }
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
    (err) => {
      console.error('Failed to load model', modelFile, err);
    }
  );
}

// free geometry & material resources
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

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: document.body }
    });

    // preload models *before* showing initial placement to avoid swapping delays
    await preloadAllModels();

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

  // initial place uses healthy model (MODEL_MAP[100])
  reticle.matrix.decompose(_pos, _quat, _scale);

  const file = MODEL_MAP[DEFAULT_HEALTH_KEY];

  // If preloaded, clone from cache
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
    console.log('Initial model placed (from cache):', file);
    return;
  }

  // fallback load
  loader.load(file,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      if (!model) {
        console.error('GLTF has no scene.');
        return;
      }
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
    },
    undefined,
    (err) => {
      console.error('Error loading initial model:', err);
      alert('Gagal memuat model awal. Cek console.');
    }
  );
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

    // update spotLight to follow camera a bit (optional)
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
      } catch (err) {
        // ignore
      }
    }
  }

  renderer.render(scene, camera);
}

// initialize
initThree();
