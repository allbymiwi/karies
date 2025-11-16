// index.js (updated) - model swap on health change
import * as THREE from './modules/three.module.js';
import { GLTFLoader } from './modules/GLTFLoader.js';

const MODEL_PATH = './gigisehat.glb'; // default healthy model (used for initial placement)
const MODEL_MAP = {
  100: 'gigisehat.glb',               // full health
  75:  'gigiplak.glb',                // first hit
  50:  'gigiasam.glb',                // second hit
  25:  'gigidemineralisasi.glb',      // third hit
  0:   'gigikaries.glb'               // dead
};
const BASE_SCALE = 0.25; // adjust as needed

let renderer, scene, camera, gl;
let controller, reticle;
let loader;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let objectPlaced = false;
let placedObject = null;
let currentHealthModelKey = 100; // tracks which model currently shown (100/75/50/25/0)

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

const xrBtn = document.getElementById('xrBtn');

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

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  scene = new THREE.Scene();

  // Reticle
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(hemi);

  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', onWindowResize);

  // Listen for health changes from UI (ui.js dispatches 'health-changed')
  window.addEventListener('health-changed', (e) => {
    const health = e.detail && typeof e.detail.health === 'number' ? e.detail.health : null;
    if (health === null) return;
    // Only swap model if object already placed
    if (objectPlaced) swapModelForHealth(health);
    // update currentHealthModelKey hold (even if not placed yet)
    currentHealthModelKey = clampHealthKey(health);
  });

  console.log('index.js loaded. Ready.');
}

function clampHealthKey(health) {
  // ensure health value snapped to 100/75/50/25/0
  if (health >= 100) return 100;
  if (health >= 75) return 75;
  if (health >= 50) return 50;
  if (health >= 25) return 25;
  return 0;
}

function swapModelForHealth(health) {
  const key = clampHealthKey(health);
  const modelFile = MODEL_MAP[key];
  if (!modelFile) return;

  // if already showing the correct model, do nothing
  if (placedObject && placedObject.userData && placedObject.userData.modelFile === modelFile) {
    return;
  }

  console.log('Swapping model to', modelFile);

  // store current transform to reapply (position/orientation)
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  if (placedObject) {
    placedObject.matrixWorld.decompose(pos, quat, scl);
  } else {
    // fallback to reticle position if exists
    reticle.matrix.decompose(pos, quat, scl);
  }

  // load new model
  loader.load(modelFile,
    (gltf) => {
      const newModel = gltf.scene || gltf.scenes[0];
      if (!newModel) {
        console.error('Loaded GLB has no scene:', modelFile);
        return;
      }

      // cleanup old
      if (placedObject) {
        scene.remove(placedObject);
        disposeObject(placedObject);
        placedObject = null;
      }

      // position and scale newModel
      newModel.position.copy(pos);
      newModel.quaternion.copy(quat);
      newModel.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      // mark which file this model came from
      newModel.userData.modelFile = modelFile;

      scene.add(newModel);
      placedObject = newModel;
      currentHealthModelKey = key;

      console.log('Model swapped to', modelFile);
    },
    undefined,
    (err) => {
      console.error('Failed to load model', modelFile, err);
    }
  );
}

function disposeObject(obj) {
  obj.traverse((c) => {
    if (c.geometry) {
      c.geometry.dispose();
    }
    if (c.material) {
      if (Array.isArray(c.material)) {
        c.material.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
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

    // reset hit-test flags
    hitTestSourceRequested = false;
    hitTestSource = null;

    session.addEventListener('end', onSessionEnded);

    // start render loop
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

  // initial placement uses the healthy model (MODEL_PATH)
  loader.load(MODEL_PATH,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      if (!model) {
        console.error('GLTF has no scene.');
        return;
      }

      model.position.copy(_pos);
      model.quaternion.copy(_quat);
      model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      model.userData.modelFile = MODEL_PATH;
      scene.add(model);
      placedObject = model;
      objectPlaced = true;

      reticle.visible = false;

      // inform UI that model placed
      window.dispatchEvent(new CustomEvent('model-placed', { detail: model }));

      console.log('Initial model placed:', MODEL_PATH);
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
  }

  renderer.render(scene, camera);
}

// initialize
initThree();
