import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const MODEL_PATH = './gigisehat.glb'; // ubah path jika perlu

let btn, gl, glCanvas, camera, scene, renderer;
let controller, reticle;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;

let loader;
let objectPlaced = false;
let placedObject = null;

// utilities for decomposing matrix
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function loadScene() {
  console.log("loadScene:start", `secure=${window.isSecureContext} XR=${'xr' in navigator}`);

  glCanvas = document.createElement('canvas');
  gl = glCanvas.getContext('webgl2', { antialias: true });

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.z = 2;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);

  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearAlpha(0);
  document.body.appendChild(renderer.domElement);

  // simple cube as debug (optional)
  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = new THREE.MeshPhongMaterial({ color: 0x89CFF0 });
  const cube = new THREE.Mesh(geometry, material);
  cube.position.set(0, 0, -0.5);
  scene.add(cube);

  // controller / select
  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // reticle (ring)
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // lighting
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // loader
  loader = new GLTFLoader();

  // handle resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  console.log("loadScene:end");
}

function init() {
  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    console.log("XR:supported", "immersive-ar=" + supported);
    if (supported) {
      btn = document.createElement("button");
      btn.textContent = "Enter XR";
      btn.style.position = 'absolute';
      btn.style.top = '10px';
      btn.style.left = '10px';
      btn.addEventListener('click', onRequestSession);
      (document.querySelector("header") || document.body).appendChild(btn);
    } else {
      navigator.xr.isSessionSupported('inline')
        .then(ok => console.log("XR:inline", "" + ok));
    }
  })
  .catch((e) => console.log("XR:check-failed", String(e)));
}

function onRequestSession() {
  navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['local-floor', 'dom-overlay'],
    domOverlay: { root: document.body }
  })
  .then(onSessionStarted)
  .catch(e => console.error('requestSession failed', e));
}

function onSessionStarted(session) {
  scene.background = null;
  console.log('starting session');

  btn.removeEventListener('click', onRequestSession);
  btn.addEventListener('click', endXRSession);
  btn.textContent = "STOP AR";

  xrSession = session;

  setupWebGLLayer()
    .then(() => {
      renderer.xr.setReferenceSpaceType('local');
      renderer.xr.setSession(xrSession);
      renderer.setAnimationLoop(render);
    })
    .catch((e) => console.log("setupWebGLLayer:fail", String(e)));

  xrSession.addEventListener("end", () => {
    hitTestSourceRequested = false;
    hitTestSource = null;
    console.log("session:end");
  });
}

function setupWebGLLayer() {
  console.log("makeXRCompatible:start");
  return gl.makeXRCompatible().then(() => {
    console.log("makeXRCompatible:ok");
    xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, gl) });
  });
}

function onSelect() {
  // only place once, only when reticle visible
  if (!reticle.visible || objectPlaced) {
    console.log('onSelect: ignored (reticle visible? ', reticle.visible, ' objectPlaced? ', objectPlaced, ')');
    return;
  }

  console.log("onSelect: placing model at reticle");

  // decompose reticle matrix
  reticle.matrix.decompose(_pos, _quat, _scale);

  loader.load(MODEL_PATH,
    (gltf) => {
      const model = gltf.scene || gltf.scenes[0];
      // position/orient model at reticle
      model.position.copy(_pos);
      model.quaternion.copy(_quat);

      // optional: adjust scale if model too big/small
      // you can tweak this scalar
      const BASE_SCALE = 0.5;
      model.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);

      scene.add(model);
      placedObject = model;
      objectPlaced = true;

      // hide reticle after placement (optional)
      reticle.visible = false;
      console.log('Model placed.');
    },
    undefined,
    (err) => {
      console.error('Error loading GLB', err);
    }
  );
}

function render(time, frame) {
  // rotate debug cube or other animations can be updated here
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = frame.session;

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
          console.log("hitTestSource:ok");
        });
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0 && !objectPlaced) {
        const hit = results[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        // if object already placed, keep reticle hidden
        if (!objectPlaced) reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}

function endXRSession() {
  if (!xrSession) return;
  xrSession.end().then(() => {
    console.log('ending session...');
    // onSessionEnd will be invoked by "end" event
  }).catch(err => console.error('end session failed', err));
}

loadScene();
init();
