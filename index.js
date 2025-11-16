import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

var btn, gl, glCanvas, camera, scene, renderer, cube;
var controller, reticle;

var xrSession = null;
var xrViewerPose;
var hitTestSource = null;
var hitTestSourceRequested = false;

function loadScene() {
    console.log("loadScene:start", `secure=${
    window.isSecureContext} XR=${'xr' in navigator}`);

    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', { antialias: true });

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.z = 2;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: gl });
    renderer.xr.enabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearAlpha(0);
    document.body.appendChild(renderer.domElement);

    var geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    var material = new THREE.MeshPhongMaterial({ color: 0x89CFF0 });
    cube = new THREE.Mesh(geometry, material);
    cube.position.set(0, 0, -0.5);
    scene.add(cube);
    
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    var geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 32);

    function onSelect() {
    console.log("on select fired...");
    var material = new THREE.MeshPhongMaterial({
    color: 0xffffff * Math.random()
    });
    var mesh = new THREE.Mesh(geometry, material);
    // Position at reticle
    mesh.applyMatrix4(reticle.matrix);
    mesh.scale.y = Math.random() * 2 + 1; // random height
    scene.add(mesh);
    }

    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: "#00FF00" })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    let t = 0;
    function spinReticle() {
    requestAnimationFrame(spinReticle);  

    t += 0.01;
    cube.rotation.x = t;
    cube.rotation.y = t;

    renderer.render(scene, camera);
    }
    spinReticle();
    console.log("loadScene:end");

    var light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function init() {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      console.log("XR:supported", "immersive-ar=" + supported);
      if (supported) {
        btn = document.createElement("button");
        btn.textContent = "Enter XR";
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
    domOverlay: { root: document.body } // penting utk tombol/overlay saat AR
  })
  .then(onSessionStarted)
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
      renderer.setAnimationLoop(render);
      renderer.xr.setReferenceSpaceType('local');
      renderer.xr.setSession(xrSession);
      animate();
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
    xrSession.updateRenderState({ baseLayer: new XRWebGLLayer(xrSession, gl)});
    });
}

function animate() {
    console.log("animate:start");
    renderer.setAnimationLoop(render);
    }


function render(time, frame) {
  if (frame) {
    var referenceSpace = renderer.xr.getReferenceSpace();
    var session = frame.session;
    xrViewerPose = frame.getViewerPose(referenceSpace);

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
      var results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) {
        var hit = results[0];
        var pose = hit.getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        reticle.visible = false;
      }
      if (xrViewerPose) {
        console.log(xrViewerPose.transform.position);  // Misalnya untuk mendapatkan posisi pengguna
      }
    }
  }
  renderer.render(scene, camera);
}

function endXRSession() {
    xrSession?.end().then(() => {
    console.log('ending session...');
    xrSession.end().then(onSessionEnd);
    });
}

function onSessionEnd() {
    xrSession = null;
  btn.textContent = "Enter XR";
  btn.removeEventListener('click', endXRSession);
  btn.addEventListener('click', onRequestSession);
  console.log("onSessionEnd");
}

loadScene();
animate();
init();
