// index.js — import from local modules folder
import * as THREE from './modules/three.module.js';
import { GLTFLoader } from './modules/GLTFLoader.js';

const MODEL_PATH = './gigisehat.glb'; // pastikan file ada di folder yang sama

let renderer, scene, camera, gl;
let controller, reticle;
let loader;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let objectPlaced = false;
let placedObject = null;

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
    alert('WebGL2 tidak tersedia di browser ini — AR mungkin tidak berjalan.');
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

  // lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  scene.add(hemi);

  // controller
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  loader = new GLTFLoader();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  console.log('Script loaded. Ready.');
}

async function requestXRSession() {
  try {
    if (!('xr' in navigator)) throw new Error('WebXR tidak tersedia di browser ini.');
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) throw new Error('immersive-ar tidak didukung di device/browser ini.');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: document.body }
    });
    onSessionStarted(session);
  } catch (err) {
    console.error('requestXRSession failed:', err);
    alert('Gagal memulai AR: ' + err.message);
  }
}

async function onSessionStarted(session) {
  xrSession = session;
  xrBtn.textContent = 'STOP AR';
  await gl.makeXRCompatible();
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setSession(session);

  session.addEventListener('end', onSessionEnded);

  hitTestSourceRequested = false;
  hitTestSource = null;

  renderer.setAnimationLoop(render);
}

function onSessionEnded() {
  xrSession = null;
  xrBtn.textContent = 'Enter AR';
  hitTestSourceRequested = false;
  hitTestSource = null;
  renderer.setAnimationLoop(null);
}

function endXRSession() {
  if (!xrSession) return;
  xrSession.end().catch(e => console.warn('end XR failed', e));
}

function onSelect() {
  if (!reticle.visible || objectPlaced) {
    console.log('select ignored (reticle.visible=%s objectPlaced=%s)', reticle.visible, objectPlaced);
    return;
  }
  reticle.matrix.decompose(_pos, _quat, _scale);

  loader.load(MODEL_PATH,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      model.position.copy(_pos);
      model.quaternion.copy(_quat);

      const BASE_SCALE = 0.5; // ubah kalau perlu
      model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      scene.add(model);
      placedObject = model;
      objectPlaced = true;
      reticle.visible = false;
      console.log('Model placed.');
    },
    undefined,
    (err) => {
      console.error('Error loading model', err);
      alert('Gagal load model. Cek console.');
    }
  );
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
