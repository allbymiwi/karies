// index.js (full)
// Pastikan: modules/three.module.js dan modules/GLTFLoader.js ada di folder modules/
// dan gigisehat.glb ada di folder yang sama dengan index.html/index.js

import * as THREE from './modules/three.module.js';
import { GLTFLoader } from './modules/GLTFLoader.js';

const MODEL_PATH = './gigisehat.glb'; // ubah jika GLB di folder lain
const BASE_SCALE = 0.25; // ubah ini untuk menyesuaikan ukuran model di AR (0.01 .. 1.0)

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

  // Reticle (ring)
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // Light
  const hemi = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(hemi);

  // Controller (select)
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', onWindowResize);

  console.log('index.js loaded. Ready.');
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
  // Only place once, and only if reticle visible
  if (!reticle.visible || objectPlaced) {
    console.log('select ignored: reticle.visible=', reticle.visible, ' objectPlaced=', objectPlaced);
    return;
  }

  // decompose reticle matrix to position/quaternion/scale
  reticle.matrix.decompose(_pos, _quat, _scale);

  // load model and place
  loader.load(MODEL_PATH,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      if (!model) {
        console.error('GLTF has no scene.');
        return;
      }

      // apply transform from reticle
      model.position.copy(_pos);
      model.quaternion.copy(_quat);
      model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      scene.add(model);
      placedObject = model;
      objectPlaced = true;

      // hide reticle after placement
      reticle.visible = false;

      // dispatch global event so UI knows model is ready
      window.dispatchEvent(new CustomEvent('model-placed', { detail: model }));

      console.log('Model placed and model-placed event dispatched.');
    },
    (xhr) => {
      // optional progress logging
    },
    (err) => {
      console.error('Error loading model:', err);
      alert('Gagal memuat model. Cek console untuk detail.');
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
