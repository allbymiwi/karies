import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = './gigisehat.glb'; // pastikan file ada di folder yang sama

let renderer, scene, camera, gl;
let controller, reticle;
let loader;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let objectPlaced = false;
let placedObject = null;

// temp vars
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function createButtons() {
  // XR button
  const btn = document.createElement('button');
  btn.className = 'xr-btn';
  btn.textContent = 'Enter XR';
  btn.addEventListener('click', () => {
    if (!xrSession) requestXRSession();
    else endXRSession();
  });
  document.body.appendChild(btn);

  // Reset button (enabled only during session)
  const resetBtn = document.createElement('button');
  resetBtn.className = 'reset-btn';
  resetBtn.textContent = 'Reset Model';
  resetBtn.disabled = true;
  resetBtn.addEventListener('click', resetPlacedObject);
  document.body.appendChild(resetBtn);

  // expose for later toggling
  return { xrBtn: btn, resetBtn };
}
const ui = createButtons();

function initThree() {
  const canvas = document.getElementById('canvas');
  gl = canvas.getContext('webgl2', { antialias: true });
  renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearAlpha(0);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);

  scene = new THREE.Scene();

  // Reticle - ring
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // lighting
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(light);

  // controller
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function requestXRSession() {
  try {
    if (!('xr' in navigator)) throw new Error('WebXR not supported');

    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) throw new Error('immersive-ar not supported on this device/browser');

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: document.body }
    });
    onSessionStarted(session);
  } catch (err) {
    console.error('requestXRSession failed:', err);
    alert('Tidak bisa memulai AR: ' + err.message);
  }
}

async function onSessionStarted(session) {
  xrSession = session;
  ui.xrBtn.textContent = 'STOP AR';
  ui.resetBtn.disabled = false;

  await gl.makeXRCompatible();
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setSession(session);

  hitTestSourceRequested = false;
  hitTestSource = null;

  session.addEventListener('end', onSessionEnded);

  // start render loop
  renderer.setAnimationLoop(render);
}

function onSessionEnded() {
  xrSession = null;
  ui.xrBtn.textContent = 'Enter XR';
  ui.resetBtn.disabled = true;
  hitTestSourceRequested = false;
  hitTestSource = null;
  renderer.setAnimationLoop(null); // stop loop
  // cleanup placed object when session ends? keep or remove based on preference.
  // Here kita biarkan model tetap di scene (but session ended so not visible)
}

function endXRSession() {
  if (!xrSession) return;
  xrSession.end().catch(err => console.warn('end session failed', err));
}

function onSelect() {
  if (!reticle.visible || objectPlaced) {
    console.log('Select ignored. reticle.visible=%s objectPlaced=%s', reticle.visible, objectPlaced);
    return;
  }

  // decompose reticle matrix to position/orientation
  reticle.matrix.decompose(_pos, _quat, _scale);

  // load and place model
  loader.load(MODEL_PATH,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      model.position.copy(_pos);
      model.quaternion.copy(_quat);

      // tweak base scale jika diperlukan
      const BASE_SCALE = 0.5;
      model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      scene.add(model);
      placedObject = model;
      objectPlaced = true;
      // hide reticle once placed
      reticle.visible = false;
      console.log('Model placed.');
    },
    undefined,
    (err) => {
      console.error('Error loading model:', err);
      alert('Gagal load model. Cek console untuk detail.');
    }
  );
}

function resetPlacedObject() {
  if (placedObject) {
    scene.remove(placedObject);
    // dispose geometries / materials recursively to avoid mem leak
    placedObject.traverse((c) => {
      if (c.geometry) { c.geometry.dispose(); }
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
    placedObject = null;
  }
  objectPlaced = false;
  // show reticle again once we can detect hits
  reticle.visible = false; // will be toggled true when hit-test finds surface
  console.log('Model reset. You can place again.');
}

function render(time, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = frame.session;

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer')
        .then(viewerSpace => session.requestHitTestSource({ space: viewerSpace }))
        .then(source => {
          hitTestSource = source;
          hitTestSourceRequested = true;
          console.log('hitTestSource ready');
        })
        .catch(err => console.warn('hit test request failed', err));
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

// init
initThree();
createButtons(); // already called earlier but safe to call
// Note: we don't start animation loop here. It starts when XR session begins.

console.log('Script loaded. Pastikan gigisehat.glb ada di folder yang sama dan buka lewat localhost/https.');
