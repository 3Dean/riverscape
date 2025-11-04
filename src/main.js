// threejs-vite/src/main.js
// three.js scene with GLTF model loading and animation (hawk + canyon + optional water)
// Loads remote glb assets referenced in the old A-Frame index.html and plays any glTF animations.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const container = document.getElementById('app');

 // Scene
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffc974, 0, 300);

// Camera
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);
camera.position.set(0, 0, 8);

 // Renderer (transparent so CSS background can show through)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);
// Ensure pointer events / touch gestures reach the canvas and make it focusable
renderer.domElement.style.touchAction = 'none';
renderer.domElement.tabIndex = 0;
renderer.setClearColor(scene.fog.color, 0.5);

// OrbitControls: allow rotation only (look around), disable zoom and pan
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableZoom = false;
controls.enablePan = false;
controls.enableRotate = true;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
// Optionally disable keyboard controls to avoid camera movement via keys
controls.enableKeys = false;
// Allow full rotation vertically and horizontally and set rotation speed
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;
controls.rotateSpeed = 1.0;
// Keep the controls target where it originally points (e.g., towards hawk)
// Set initial target to the hawk so camera can orbit it
controls.target.set(0, 0, -6);
controls.update();


 // Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffc67c, 0.8);
dirLight.position.set(0, 2, -10);
scene.add(dirLight);

// Animation mixers (for glTF baked animations)
const mixers = [];
const clock = new THREE.Clock();

// GLTF loader
const loader = new GLTFLoader();

 // Keep references for custom animations
let canyonObj = null;
let hawkObj = null;

 // Water animation helpers (CPU-based per-vertex update)
const waterMeshes = [];
let waterUpdateCounter = 0;
const WATER_NORMALS_EVERY = 2; // recompute normals every N frames (tweak as needed)

/**
 * Prepare a mesh for CPU-based water animation.
 * - Converts indexed geometry to non-indexed so positions map 1:1 to logical vertices
 * - Caches per-vertex baseY, angle, amplitude and speed in typed arrays on mesh.userData.waterAnim
 */
function setupWaterMesh(mesh) {
  if (!mesh || !mesh.isMesh) return;
  let geom = mesh.geometry;
  if (!geom || !geom.attributes || !geom.attributes.position) return;

  // If geometry is non-indexed (duplicated vertices per face) try to merge vertices
  // back into indexed geometry so normals can be smoothed. This reduces visible
  // triangle faceting. If merge fails, fall back to using the geometry as-is.
  if (!geom.index && BufferGeometryUtils && typeof BufferGeometryUtils.mergeVertices === 'function') {
    try {
      const merged = BufferGeometryUtils.mergeVertices(geom, 1e-4);
      if (merged) {
        geom = merged;
        mesh.geometry = geom;
      }
    } catch (e) {
      // ignore and keep original geometry
      // console.warn('mergeVertices failed', e);
    }
  }

  // Ensure material uses smooth shading so shared normals interpolate
  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      for (const mat of mesh.material) {
        if ('flatShading' in mat) mat.flatShading = false;
        mat.needsUpdate = true;
      }
    } else {
      if ('flatShading' in mesh.material) mesh.material.flatShading = false;
      mesh.material.needsUpdate = true;
    }
  }

  const posAttr = geom.attributes.position;
  const vertexCount = posAttr.count;

  const baseY = new Float32Array(vertexCount);
  const ang = new Float32Array(vertexCount);
  const amp = new Float32Array(vertexCount);
  const speed = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    baseY[i] = posAttr.array[i * 3 + 1];
    ang[i] = Math.random() * Math.PI * 2;
    amp[i] = 0.5 + Math.random() * 0.15;
    speed[i] = 0.5 + Math.random(); // tuned for visible motion; scaled by dt in update
  }

  mesh.userData.waterAnim = {
    baseY,
    ang,
    amp,
    speed,
    posAttr,
    geom
  };

  waterMeshes.push(mesh);
}

/**
 * Advance all prepared water meshes by dt (seconds).
 * Updates position attribute in-place and recomputes normals.
 */
function updateWater(dt) {
  for (let mi = 0; mi < waterMeshes.length; mi++) {
    const mesh = waterMeshes[mi];
    const anim = mesh.userData.waterAnim;
    if (!anim) continue;

    const { baseY, ang, amp, speed, posAttr, geom } = anim;
    const arr = posAttr.array;
    const n = baseY.length;

    // update Y and angle
    for (let i = 0; i < n; i++) {
      arr[i * 3 + 1] = baseY[i] + Math.sin(ang[i]) * amp[i];
      ang[i] += speed[i] * dt;
    }

    posAttr.needsUpdate = true;
    // recompute normals for lighting occasionally to reduce CPU load
    waterUpdateCounter++;
    if (waterUpdateCounter % WATER_NORMALS_EVERY === 0) {
      if (geom && typeof geom.computeVertexNormals === 'function') {
        geom.computeVertexNormals();
      }
      // wrap the counter to avoid integer growth over long runs
      if (waterUpdateCounter > 1000000) waterUpdateCounter = 0;
    }
  }
}



// Load canyon (large scene)
loader.load(
  'https://aws-website-studiob-x-dqxqd.s3.amazonaws.com/assets/canyon/assets/canyonlargeopt.glb',
  (gltf) => {
    canyonObj = gltf.scene || gltf.scenes[0];
    // The original A-Frame placed canyon at y:-420, that suggests the model is large.
    // We'll keep the model's original scale and then frame it so the camera sees it.
    canyonObj.position.set(0, -420, 0);
    scene.add(canyonObj);

    // If there are animations embedded, attach an AnimationMixer
    if (gltf.animations && gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(canyonObj);
      gltf.animations.forEach((clip) => {
        const action = mixer.clipAction(clip);
        action.play();
      });
      mixers.push(mixer);
    }

    // Manual camera: do not auto-frame the canyon
    console.log('Canyon loaded (manual camera).');
  },
  undefined,
  (err) => {
    console.warn('Failed to load canyon glTF:', err);
  }
);

// Load hawk (animated)
loader.load(
  'https://aws-website-studiob-x-dqxqd.s3.amazonaws.com/assets/canyon/assets/hawkanimate13.glb',
  (gltf) => {
    hawkObj = gltf.scene || gltf.scenes[0];

    // Original A-Frame used position="0 0 -5" rotation="0 180 -6" scale="0.125"
    hawkObj.position.set(0, 0, -6);
    hawkObj.rotation.set(0, Math.PI, THREE.MathUtils.degToRad(-6));
    hawkObj.scale.set(0.125, 0.125, 0.125);
    scene.add(hawkObj);

    // Attach mixer and play all animations
    if (gltf.animations && gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(hawkObj);
      gltf.animations.forEach((clip) => {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat);
        action.play();
      });
      mixers.push(mixer);
    }
    // Point controls at the hawk when it finishes loading so orbiting works
    if (typeof controls !== 'undefined') {
      controls.target.copy(hawkObj.position);
      controls.update();
    }
    console.log('Hawk loaded (camera pointed at hawk).');
  },
  undefined,
  (err) => {
    console.warn('Failed to load hawk glTF:', err);
  }
);

 // Load water (optional local asset, same path as old project)
loader.load(
  '/water.gltf',
  (gltf) => {
    const water = gltf.scene || gltf.scenes[0];
    // Original A-Frame used position="0 -420 -5" — we'll place it near origin but slightly lowered
    water.position.set(0, -420, -5);
    scene.add(water);

    // Try to find meshes named 'water' and prepare them. If none found, prepare the first mesh encountered.
    water.traverse((node) => {
      if (node && node.isMesh && node.name && node.name.toLowerCase().includes('water')) {
        setupWaterMesh(node);
      }
    });

    // Fallback: if no waterMeshes were registered, try to register the first mesh found
    if (waterMeshes.length === 0) {
      water.traverse((node) => {
        if (node && node.isMesh && waterMeshes.length === 0) {
          setupWaterMesh(node);
        }
      });
    }

    if (gltf.animations && gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(water);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
      mixers.push(mixer);
    }

    console.log('Water glTF loaded (if present).');
  },
  undefined,
  (err) => {
    // Don't treat missing water as fatal — it's optional
    console.info('water.gltf not found or failed to load (this may be fine):', err.message || err);
  }
);

// Example mesh (kept from the original boilerplate)
const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
const material = new THREE.MeshStandardMaterial({
  color: 0x00adb5,
  roughness: 0.4,
  metalness: 0.1
});
const cube = new THREE.Mesh(geometry, material);
cube.position.y = 1;
//scene.add(cube);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  // advance all mixers
  for (const m of mixers) m.update(dt);

  // rotate the canyon very slowly similar to A-Frame (360 degrees over 460s)
  if (canyonObj) {
    const rotationSpeed = (2 * Math.PI) / 460.0; // radians per second
    canyonObj.rotation.x += rotationSpeed * dt;
  }

  // hawk bobbing & subtle rotation tween (mimics the A-Frame animation__pos / animation__rot)
  if (hawkObj) {
    const t = performance.now() / 1000; // seconds
    // position: alternate between y=0 and y=-0.5 over 4.8s
    const posPeriod = 4.8;
    const posCenter = -0.25;
    const posAmp = 0.25; // oscillates ±0.25 -> from 0 to -0.5
    hawkObj.position.y = posCenter + posAmp * Math.sin((2 * Math.PI * t) / posPeriod);

    // rotation: alternate between x:0->22deg and z:-6->5.5deg over 4s
    const rotPeriod = 4.0;
    const rotXCenter = THREE.MathUtils.degToRad(11); // center between 0 and 22
    const rotXAmp = THREE.MathUtils.degToRad(11);
    hawkObj.rotation.x = rotXCenter + rotXAmp * Math.sin((2 * Math.PI * t) / rotPeriod);

    const rotZMin = THREE.MathUtils.degToRad(-6);
    const rotZMax = THREE.MathUtils.degToRad(5.5);
    const rotZCenter = (rotZMin + rotZMax) / 2;
    const rotZAmp = (rotZMax - rotZMin) / 2;
    hawkObj.rotation.z = rotZCenter + rotZAmp * Math.sin((2 * Math.PI * t) / rotPeriod);
  }

  // cube rotation (keeps demo lively)
  cube.rotation.x += dt * 0.5;
  cube.rotation.y += dt * 0.7;

  // update CPU-based water animation
  updateWater(dt);

  // update OrbitControls (for smooth damping)
  if (typeof controls !== 'undefined') controls.update();

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
});

animate();

console.log('three.js scene initialized — loading glTF assets (canyon, hawk, water).');
