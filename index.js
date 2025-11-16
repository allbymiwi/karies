import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = 'asset/gigisehat.glb'; // pastikan file ada di folder yang sama

let renderer, scene, camera, gl;
let controller, reticle;
let loader;

let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let objectPlaced = false;
let placedObject = null;

// temp vectors for matrix decomposition
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function setupScene() {
  const canvas = document.getElementById('canvas');

  // WebGL2 context
  gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    console.error('WebGL2 tidak tersedia di browser ini.');
    alert('Browser tidak mendukung WebGL2. Coba di perangkat lain atau update browser.');
    return;
  }

  renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearAlpha(0);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);

  scene = new THREE.Scene();

  // reticle (ring)
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.20, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(hemi);

  // controller for select
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', onWindowResize);

  console.log('Scene setup complete.');
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function initXRButton() {
  try {
    if (!('xr' in navigator)) {
      console.warn('WebXR tidak tersedia di browser ini.');
      return;
    }
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    console.log('immersive-ar supported?', supported);
    if (supported) {
      const btn = document.createElement('button');
      btn.textContent = 'Enter XR';
      btn.style.position = 'absolute';
      btn.style.top = '10px';
      btn.style.left = '10px';
      btn.style.zIndex = 100;
      btn.addEventListener('click', () => {
        if (!xrSession) requestSession();
        else endSession();
      });
      document.body.appendChild(btn);
    } else {
      console.log('immersive-ar not supported on this device/browser.');
    }
  } catch (err) {
    console.error('Error checking XR support', err);
  }
}

async function requestSession() {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: document.body }
    });
    onSessionStarted(session);
  } catch (err) {
    console.error('requestSession failed', err);
    alert('Gagal memulai session AR: ' + err.message);
  }
}

async function onSessionStarted(session) {
  xrSession = session;
  // make XR-compatible and set base layer
  await gl.makeXRCompatible();
  xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, gl) });

  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setSession(xrSession);

  xrSession.addEventListener('end', onSessionEnded);

  // start rendering loop
  renderer.setAnimationLoop(render);
  console.log('XR session started');
}

function onSessionEnded() {
  xrSession = null;
  hitTestSourceRequested = false;
  hitTestSource = null;
  renderer.setAnimationLoop(null);
  console.log('XR session ended');
}

function endSession() {
  if (!xrSession) return;
  xrSession.end().catch(err => console.warn('end failed', err));
}

// onSelect: place the GLB exactly ONCE at the reticle
function onSelect() {
  if (!reticle.visible) {
    console.log('Select ignored: reticle not visible.');
    return;
  }
  if (objectPlaced) {
    console.log('Select ignored: object already placed.');
    return;
  }

  // decompose reticle matrix to pos/quat/scale
  reticle.matrix.decompose(_pos, _quat, _scale);

  console.log('Placing model at', _pos);

  loader.load(MODEL_PATH,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      model.position.copy(_pos);
      model.quaternion.copy(_quat);

      // tweak scale jika perlu (ubah nilai jika model terlalu besar/kecil)
      const BASE_SCALE = 0.5;
      model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      scene.add(model);
      placedObject = model;
      objectPlaced = true;

      // hide reticle after placing
      reticle.visible = false;

      console.log('Model placed.');
    },
    undefined,
    (err) => {
      console.error('Error loading model:', err);
      alert('Gagal load model. Cek console (404 / CORS).');
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
          console.warn('hit test request failed', err);
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

// init
setupScene();
initXRButton();

console.log('Script loaded. Pastikan gigisehat.glb ada di folder yang sama dan buka melalui localhost/https.');
