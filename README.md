# Riverscape — three.js + Vite

Minimal Vite + three.js site that loads a large canyon scene and an animated hawk (remote glTF assets) plus an optional local water glTF. Includes a small UI to play a SOMA FM stream. This README explains the tech used, how to run the project, and a code walkthrough so you can understand how the site is constructed.

---

## Contents

- Tech & libraries
- Project layout
- Quick start (dev & build)
- How the code works (index.html + src/main.js walkthrough)
- Assets & remote URLs
- Development tips, troubleshooting, deployment
- License

---

## Tech & libraries

- Vite — fast development server and build tool
- three — WebGL 3D engine
  - GLTFLoader (three/examples/jsm/loaders/GLTFLoader.js)
  - OrbitControls (three/examples/jsm/controls/OrbitControls.js)
  - BufferGeometryUtils (three/examples/jsm/utils/BufferGeometryUtils.js)
- Plain ES module JavaScript (no TypeScript)
- Static site: no front-end framework required

---

## Project layout (key files)

- `index.html` — entry HTML, background styling, SOMA FM play button, mounts `/src/main.js`
- `package.json` — scripts and dependencies
- `src/main.js` — three.js scene, GLTF loading, animation loop, optional water CPU animation
- `public/water.gltf` — optional local water glTF (used if present)
- `README.md` — this file

---

## Quick start

Requirements: Node 16+ (Node 18+ recommended)

1. Install dependencies
   npm install

2. Start dev server
   npm run dev

3. Open the app in your browser:
   http://localhost:5173/ (Vite default)

Build for production

1. Build:
   npm run build

2. Preview the built site locally:
   npm run preview

3. Deploy the contents of `dist/` to a static host (Netlify, GitHub Pages, S3/CloudFront, etc.)

---

## How the code works — overview & walkthrough

This section explains the responsibilities of the two main entry points: `index.html` and `src/main.js`.

### index.html

- Provides a full-page gradient background, a container element with id `app` and a circular toggle button `#soma-toggle` used to play a SOMA FM stream.
- The entry module is loaded with:
  <script type="module" src="/src/main.js"></script>
- Minimal inline script implements a small audio player:
  - Creates an `Audio` element using the SOMA FM Synphaera stream
  - Does not preload audio to avoid autoplay issues; audio playback is started by the user's click (user gesture required by browsers)
  - Toggles play/pause state and updates the button UI

### src/main.js — responsibilities

- Imports:
  - `three` (core)
  - `GLTFLoader` (for .gltf/.glb assets)
  - `BufferGeometryUtils` (utilities for geometry — used in water setup)
  - `OrbitControls` (camera orbiting)
- Creates the scene:
  - Adds fog to blend with the page background
  - Sets up `PerspectiveCamera` (FOV 60, near 0.1, far 5000)
  - Creates `WebGLRenderer` with antialias and `alpha: true` so the CSS background is visible behind the canvas
  - Clamps pixel ratio (max 2) to avoid excessive GPU usage on high-DPI screens
  - Appends the renderer canvas to `#app`, and adjusts pointer/touch behavior to ensure proper gestures
- OrbitControls:
  - Configured to allow rotation only (zoom and pan disabled)
  - Damping enabled for smooth motion
  - Initial controls target is set to the hawk position so the camera orbits the hawk once loaded
- Lighting:
  - `AmbientLight` for base illumination
  - `DirectionalLight` for stronger shading
- Mixers + animation:
  - Maintains an array of `THREE.AnimationMixer` instances (one per glTF with animations)
  - Uses `THREE.Clock()` to compute consistent delta time (dt) for mixer updates and animations

### GLTF loading

Three assets are loaded via `GLTFLoader`:

1. Canyon (remote)
   - URL: remote S3 GLB
   - Positioned with a large Y offset: `(0, -420, 0)` — model is large/offset
   - If animations exist inside the GLTF, an `AnimationMixer` is created and all clips are played
   - Canyon rotation is slowly animated in the render loop (a full rotation over ~460s)

2. Hawk (remote)
   - URL: remote S3 GLB
   - Positioned at `(0, 0, -6)`, rotated and scaled to match original placement
   - Uses an `AnimationMixer` to play embedded animations; loops animations
   - After loading, `controls.target` is updated to the hawk position so orbiting will focus it
   - The hawk is also given subtle bobbing and rotation oscillation in the main animation loop (sine-based)

3. Water (optional local `public/water.gltf`)
   - The code traverses the loaded water scene to find meshes named like `water`
   - Each found water mesh is prepared for CPU-side per-vertex animation using `setupWaterMesh(mesh)`
   - If `public/water.gltf` is absent, the loader logs an informational message and the app continues — water is optional

### Water CPU animation (how it works)

- `setupWaterMesh(mesh)`
  - Ensures geometry is suitable for per-vertex animation:
    - If geometry is non-indexed, attempts to merge vertices using `BufferGeometryUtils.mergeVertices` (reduces faceting)
  - Ensures materials are smooth-shaded (`flatShading = false`)
  - Caches typed arrays on `mesh.userData.waterAnim`:
    - `baseY` — original vertex Y positions
    - `ang` — phase for sine wave
    - `amp` — amplitude per vertex
    - `speed` — per-vertex speed multiplier
  - Adds the mesh to a `waterMeshes` array for per-frame updates
- `updateWater(dt)`
  - Iterates prepared water meshes, updates Y positions with `baseY + sin(phase) * amp`, advances `phase` by `speed * dt`
  - Marks position attribute as `needsUpdate`
  - Occasionally recomputes vertex normals to keep lighting correct while controlling CPU cost

### Animation loop

- Uses `requestAnimationFrame(animate)` and `clock.getDelta()`:
  - Calls `mixer.update(dt)` for every `AnimationMixer`
  - Updates canyon rotation slowly
  - Updates hawk bobbing & rotation via sine waves
  - Calls `updateWater(dt)` to animate water meshes
  - Calls `controls.update()` (for damping)
  - Renders the scene

### Resize handling

- `window.addEventListener('resize', ...)`
  - Updates camera aspect ratio, projection matrix, and renderer size/pixel ratio

---


## Development tips & performance

- Use `npm run dev` for fast iteration
- The renderer clamps `window.devicePixelRatio` to 2 to reduce GPU cost on high-DPI devices
- For production:
  - Optimize GLB assets (Draco compression, mesh/texture optimization)
  - Consider hosting large assets on a CDN with proper CORS headers
  - Use progressive loading, LODs, or streaming strategies for very large scenes
- For mobile performance:
  - Reduce renderer pixel ratio
  - Simplify materials and large meshes
  - Consider disabling per-vertex water normals recomputation or lowering its frequency

---

## Troubleshooting

- Model load failures / CORS errors:
  - Check browser DevTools Console and Network tab for 404 or CORS issues
  - Ensure remote hosts send proper CORS headers and that URLs are reachable
- `water.gltf` not found:
  - Place `water.gltf` into `public/` if you want local water; missing water is non-fatal
- Audio doesn't play automatically:
  - Modern browsers require a user gesture to start audio. Click the SOMA FM button to start playback. Errors are caught and a visual error state is briefly shown
- Faceted water surface or lighting issues:
  - The code attempts to merge vertices and recompute normals; the best solution is to author the water mesh with shared vertices and smooth normals

---

## Deployment

- Build:
  npm run build

- Deploy the `dist/` folder to any static host (Netlify, GitHub Pages, S3 + CloudFront).
- If hosting at a subpath, set Vite `base` appropriately in a `vite.config.*` file.

---

## Contributing

- Open issues or PRs for bugs, improvements, or to replace remote large assets with smaller/optimized versions.

---

## License

MIT (see `package.json`)
