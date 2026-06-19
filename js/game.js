/**
 * Anime City Walking Game
 * Three.js r134 — cel-shaded third-person city explorer
 */

'use strict';

// ─── GLOBALS ────────────────────────────────────────────────────────────────
const THREE = window.THREE;

let renderer, scene, camera, clock;
let player, playerMixer, walkAction, idleAction;
let cameraTarget = new THREE.Vector3();
let cameraOffset = new THREE.Vector3(0, 5, 10);
let camYaw = 0, camPitch = 0.3;
let camDistance = 10;
let mouseDown = false;
let lastMouse = { x: 0, y: 0 };

const keys = {};
const buildingMeshes = [];
const particleSystems = [];
let minimapCtx, minimapCanvas;

let weatherMode = 'clear';
let gameTime = 18.5; // 18:30
let sunLight, ambientLight, moonLight;

// Toon gradient texture (for cel shading)
let toonGradient;

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  clock = new THREE.Clock();

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffd6f0, 40, 150);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 6, 10);

  // Toon gradient
  toonGradient = makeToonGradient();

  // Build world
  buildLighting();
  buildSky();
  buildCity();
  buildPlayer();
  buildParticleSystems();

  // Minimap
  minimapCanvas = document.getElementById('minimap-canvas');
  minimapCtx = minimapCanvas.getContext('2d');

  // Events
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('wheel', onWheel, { passive: true });
  renderer.domElement.addEventListener('mousedown', e => { mouseDown = true; lastMouse = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('mouseup', () => { mouseDown = false; });
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: true });
  renderer.domElement.addEventListener('touchend', () => { mouseDown = false; });

  // Weather buttons
  document.querySelectorAll('.weather-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setWeather(btn.dataset.weather);
    });
  });

  // Start loop
  animate();
}

// ─── TOON GRADIENT ───────────────────────────────────────────────────────────
function makeToonGradient() {
  const colors = [
    [0.1, 0.1, 0.15],
    [0.3, 0.3, 0.35],
    [0.6, 0.6, 0.65],
    [0.9, 0.88, 0.92],
    [1.0, 0.98, 1.0],
  ];
  const size = 256;
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    // Step function for cel shading
    let step;
    if (t < 0.1) step = 0;
    else if (t < 0.3) step = 1;
    else if (t < 0.55) step = 2;
    else if (t < 0.75) step = 3;
    else step = 4;
    const c = colors[step];
    data[i * 4 + 0] = c[0] * 255;
    data[i * 4 + 1] = c[1] * 255;
    data[i * 4 + 2] = c[2] * 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function toonMat(color, options = {}) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient,
    ...options
  });
}

// ─── LIGHTING ────────────────────────────────────────────────────────────────
function buildLighting() {
  ambientLight = new THREE.AmbientLight(0xffd6f0, 0.6);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xffe8c0, 1.4);
  sunLight.position.set(30, 50, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 200;
  sunLight.shadow.camera.left = -80;
  sunLight.shadow.camera.right = 80;
  sunLight.shadow.camera.top = 80;
  sunLight.shadow.camera.bottom = -80;
  sunLight.shadow.bias = -0.001;
  scene.add(sunLight);

  moonLight = new THREE.DirectionalLight(0x6688cc, 0.0);
  moonLight.position.set(-30, 40, -10);
  scene.add(moonLight);

  // Hemisphere
  const hemi = new THREE.HemisphereLight(0xffd6f5, 0x443355, 0.5);
  scene.add(hemi);
}

// ─── SKY ─────────────────────────────────────────────────────────────────────
let skyMesh, skyUniforms;

function buildSky() {
  const skyGeo = new THREE.SphereGeometry(300, 32, 16);
  skyUniforms = {
    topColor: { value: new THREE.Color(0xff9de2) },
    bottomColor: { value: new THREE.Color(0xffd6f0) },
    horizColor: { value: new THREE.Color(0xffb3d9) },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col;
        if (h > 0.0) {
          col = mix(horizColor, topColor, smoothstep(0.0, 0.5, h));
        } else {
          col = mix(horizColor, bottomColor, smoothstep(0.0, -0.3, h));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);

  // Sun disc
  const sunGeo = new THREE.CircleGeometry(6, 32);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe090 });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(60, 80, -80);
  scene.add(sun);

  // Glow ring
  const glowGeo = new THREE.RingGeometry(6.5, 14, 32);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.copy(sun.position);
  scene.add(glow);

  buildClouds();
}

function buildClouds() {
  const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 20; i++) {
    const cloud = new THREE.Group();
    const parts = 3 + Math.floor(Math.random() * 4);
    for (let j = 0; j < parts; j++) {
      const r = 2 + Math.random() * 4;
      const g = new THREE.SphereGeometry(r, 8, 6);
      const m = new THREE.Mesh(g, cloudMat);
      m.position.set(j * 3 - parts * 1.5, Math.random() * 2, Math.random() * 2);
      cloud.add(m);
    }
    cloud.position.set(
      (Math.random() - 0.5) * 200,
      40 + Math.random() * 30,
      (Math.random() - 0.5) * 200
    );
    cloud.scale.setScalar(0.6 + Math.random() * 0.8);
    cloud.userData.speed = 0.5 + Math.random() * 1;
    scene.add(cloud);
    particleSystems.push({ type: 'cloud', mesh: cloud });
  }
}

// ─── CITY ─────────────────────────────────────────────────────────────────────
const CITY_HALF = 60;
const BLOCK_SIZE = 20;
const ROAD_WIDTH = 6;

function buildCity() {
  buildGround();
  buildRoads();
  buildSidewalks();
  buildBlocks();
  buildProps();
}

function buildGround() {
  const geo = new THREE.PlaneGeometry(300, 300, 1, 1);
  const mat = toonMat(0x556655);
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildRoads() {
  const roadMat = toonMat(0x333344);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });

  // Grid of roads
  for (let x = -CITY_HALF; x <= CITY_HALF; x += BLOCK_SIZE) {
    addRoadSegment(x, 0, 0, CITY_HALF * 2, true, roadMat, lineMat);
  }
  for (let z = -CITY_HALF; z <= CITY_HALF; z += BLOCK_SIZE) {
    addRoadSegment(0, 0, z, CITY_HALF * 2, false, roadMat, lineMat);
  }
}

function addRoadSegment(x, y, z, length, isX, roadMat, lineMat) {
  const geo = new THREE.PlaneGeometry(
    isX ? ROAD_WIDTH : length,
    isX ? length : ROAD_WIDTH
  );
  const road = new THREE.Mesh(geo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, y + 0.01, z);
  road.receiveShadow = true;
  scene.add(road);

  // Dashed center line
  const dashCount = Math.floor(length / 4);
  for (let i = 0; i < dashCount; i++) {
    const dg = new THREE.PlaneGeometry(isX ? 0.15 : 1.2, isX ? 1.2 : 0.15);
    const dash = new THREE.Mesh(dg, lineMat);
    dash.rotation.x = -Math.PI / 2;
    const offset = -length / 2 + i * 4 + 2;
    dash.position.set(
      isX ? x : x + offset,
      y + 0.02,
      isX ? z + offset : z
    );
    scene.add(dash);
  }

  // Crosswalk lines at intersections
  for (let cx = -CITY_HALF; cx <= CITY_HALF; cx += BLOCK_SIZE) {
    for (let cz = -CITY_HALF; cz <= CITY_HALF; cz += BLOCK_SIZE) {
      addCrosswalk(cx, cz, lineMat);
    }
  }
}

function addCrosswalk(cx, cz, mat) {
  for (let i = -2; i <= 2; i++) {
    // E-W crosswalk
    const g1 = new THREE.PlaneGeometry(0.6, 2.4);
    const m1 = new THREE.Mesh(g1, mat);
    m1.rotation.x = -Math.PI / 2;
    m1.position.set(cx + i * 0.9, 0.02, cz + ROAD_WIDTH / 2 + 0.5);
    scene.add(m1);

    // N-S crosswalk
    const g2 = new THREE.PlaneGeometry(2.4, 0.6);
    const m2 = new THREE.Mesh(g2, mat);
    m2.rotation.x = -Math.PI / 2;
    m2.position.set(cx + ROAD_WIDTH / 2 + 0.5, 0.02, cz + i * 0.9);
    scene.add(m2);
  }
}

function buildSidewalks() {
  const swMat = toonMat(0x998877);
  const step = BLOCK_SIZE;
  const sw = ROAD_WIDTH / 2;

  for (let bx = -CITY_HALF; bx < CITY_HALF; bx += step) {
    for (let bz = -CITY_HALF; bz < CITY_HALF; bz += step) {
      const bw = step - ROAD_WIDTH;
      const geo = new THREE.BoxGeometry(bw, 0.12, bw);
      const sw_mesh = new THREE.Mesh(geo, swMat);
      sw_mesh.position.set(bx + step / 2, 0.06, bz + step / 2);
      sw_mesh.receiveShadow = true;
      scene.add(sw_mesh);
    }
  }
}

// ─── BUILDINGS ───────────────────────────────────────────────────────────────
const BLDG_PALETTES = [
  // Pastel anime palette
  [0xff9de2, 0xffd6f5, 0xffb3d9],  // pink
  [0x9de2ff, 0xd6f5ff, 0xb3d9ff],  // blue
  [0xb3ffde, 0xd6fff0, 0x9effd0],  // mint
  [0xffe09d, 0xfff5d6, 0xffd6b3],  // yellow/cream
  [0xc9b3ff, 0xe6d6ff, 0xb399ff],  // purple
  [0xff9999, 0xffd6d6, 0xff7777],  // coral
];

function buildBlocks() {
  const step = BLOCK_SIZE;
  const sw = ROAD_WIDTH / 2;

  for (let bx = -CITY_HALF; bx < CITY_HALF; bx += step) {
    for (let bz = -CITY_HALF; bz < CITY_HALF; bz += step) {
      const blockCX = bx + step / 2;
      const blockCZ = bz + step / 2;
      const usable = step - ROAD_WIDTH - 1;
      buildBlock(blockCX, blockCZ, usable);
    }
  }
}

function buildBlock(cx, cz, size) {
  const palette = BLDG_PALETTES[Math.floor(Math.random() * BLDG_PALETTES.length)];
  const count = 1 + Math.floor(Math.random() * 3);

  if (count === 1) {
    // Large single building
    placeBuilding(cx, cz, size * 0.85, size * 0.85, palette);
  } else {
    // Multiple smaller buildings
    const sub = size / 2;
    const offsets = [[-sub/2,-sub/2],[sub/2,-sub/2],[-sub/2,sub/2],[sub/2,sub/2]];
    const picks = shuffled(offsets).slice(0, count);
    picks.forEach(([ox, oz]) => {
      placeBuilding(cx + ox, cz + oz, sub * 0.8, sub * 0.8, palette);
    });
  }
}

function placeBuilding(cx, cz, w, d, palette) {
  const floors = 2 + Math.floor(Math.random() * 10);
  const h = floors * 2.2;
  const style = Math.floor(Math.random() * 4);

  const bldgGroup = new THREE.Group();

  // Main body
  const bodyColor = palette[0];
  const bodyMat = toonMat(bodyColor);
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  bldgGroup.add(body);

  // Windows
  addWindows(bldgGroup, w, h, d, floors, palette[2]);

  // Roof styles
  switch (style) {
    case 0: addFlatRoof(bldgGroup, w, h, d, palette[1]); break;
    case 1: addGableRoof(bldgGroup, w, h, d, palette[1]); break;
    case 2: addAntennaRoof(bldgGroup, w, h, d, palette[1]); break;
    case 3: addTiledRoof(bldgGroup, w, h, d, palette[1]); break;
  }

  // Random decorations
  if (Math.random() > 0.5) addNeonSign(bldgGroup, w, h, d);
  if (floors > 5 && Math.random() > 0.6) addACUnits(bldgGroup, w, h, d);
  if (Math.random() > 0.7) addBalconies(bldgGroup, w, h, d, floors);

  bldgGroup.position.set(cx, 0, cz);
  scene.add(bldgGroup);
  buildingMeshes.push({ x: cx, z: cz, w, d });
}

function addWindows(group, w, h, d, floors, color) {
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
  const winLitMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
  const winDarkMat = new THREE.MeshBasicMaterial({ color: 0x334455 });

  const cols = Math.max(1, Math.floor(w / 1.5));
  const ww = 0.55, wh = 0.7;
  const gap_x = w / (cols + 1);

  for (let fl = 0; fl < floors; fl++) {
    const fy = fl * 2.2 + 1.4;
    for (let ci = 0; ci < cols; ci++) {
      const fx = -w / 2 + gap_x * (ci + 1);
      const lit = Math.random() > 0.35;
      const mat = lit ? (Math.random() > 0.3 ? winLitMat : winMat) : winDarkMat;

      const geo = new THREE.PlaneGeometry(ww, wh);
      // Front
      const front = new THREE.Mesh(geo, mat);
      front.position.set(fx, fy, d / 2 + 0.01);
      group.add(front);
      // Back
      const back = new THREE.Mesh(geo, mat);
      back.position.set(fx, fy, -d / 2 - 0.01);
      back.rotation.y = Math.PI;
      group.add(back);
    }

    const rowsD = Math.max(1, Math.floor(d / 1.5));
    const gap_z = d / (rowsD + 1);
    for (let ri = 0; ri < rowsD; ri++) {
      const fz = -d / 2 + gap_z * (ri + 1);
      const lit = Math.random() > 0.35;
      const mat = lit ? winLitMat : winDarkMat;
      const geo = new THREE.PlaneGeometry(ww, wh);
      const left = new THREE.Mesh(geo, mat);
      left.position.set(-w / 2 - 0.01, fy, fz);
      left.rotation.y = -Math.PI / 2;
      group.add(left);
      const right = new THREE.Mesh(geo, mat);
      right.position.set(w / 2 + 0.01, fy, fz);
      right.rotation.y = Math.PI / 2;
      group.add(right);
    }
  }
}

function addFlatRoof(group, w, h, d, color) {
  const geo = new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3);
  const mesh = new THREE.Mesh(geo, toonMat(color));
  mesh.position.y = h + 0.15;
  mesh.castShadow = true;
  group.add(mesh);
}

function addGableRoof(group, w, h, d, color) {
  const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.7, 3, 4);
  const mesh = new THREE.Mesh(geo, toonMat(darken(color)));
  mesh.position.y = h + 1.5;
  mesh.rotation.y = Math.PI / 4;
  mesh.castShadow = true;
  group.add(mesh);
}

function addAntennaRoof(group, w, h, d, color) {
  addFlatRoof(group, w, h, d, color);
  const geo = new THREE.CylinderGeometry(0.06, 0.06, 4, 6);
  const mesh = new THREE.Mesh(geo, toonMat(0x888888));
  mesh.position.y = h + 2.3;
  group.add(mesh);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), toonMat(0xff3366));
  ball.position.y = h + 4.4;
  group.add(ball);
}

function addTiledRoof(group, w, h, d, color) {
  const geo = new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4);
  const roof = new THREE.Mesh(geo, toonMat(darken(color)));
  roof.position.y = h + 0.25;
  group.add(roof);
  // Ridge
  const ridgeGeo = new THREE.BoxGeometry(w * 0.7, 0.6, 0.4);
  const ridge = new THREE.Mesh(ridgeGeo, toonMat(color));
  ridge.position.y = h + 0.8;
  group.add(ridge);
}

function addNeonSign(group, w, h, d) {
  const colors = [0xff3399, 0x33ffcc, 0xff9900, 0xcc33ff, 0x33ccff];
  const c = colors[Math.floor(Math.random() * colors.length)];
  const signMat = new THREE.MeshBasicMaterial({ color: c });
  const fw = 1.2 + Math.random() * 2;
  const fh = 0.6;
  const geo = new THREE.BoxGeometry(fw, fh, 0.1);
  const sign = new THREE.Mesh(geo, signMat);
  const fl = 1 + Math.floor(Math.random() * 3);
  sign.position.set(0, fl * 2.2 + 1.0, d / 2 + 0.15);
  group.add(sign);

  // Point light for glow
  const pl = new THREE.PointLight(c, 0.8, 8);
  pl.position.copy(sign.position);
  pl.position.z += 1;
  group.add(pl);
}

function addACUnits(group, w, h, d) {
  const mat = toonMat(0xaaaaaa);
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BoxGeometry(0.7, 0.5, 0.5);
    const ac = new THREE.Mesh(geo, mat);
    ac.position.set(-w / 2 + 0.5 + i * 1.2, h + 0.25, d / 2 + 0.26);
    group.add(ac);
  }
}

function addBalconies(group, w, h, d, floors) {
  const mat = toonMat(0xddccbb);
  const railMat = toonMat(0xeeeeee);
  const pickedFloors = [Math.floor(floors * 0.33), Math.floor(floors * 0.66)];
  pickedFloors.forEach(fl => {
    const fy = fl * 2.2;
    const geo = new THREE.BoxGeometry(w * 0.5, 0.1, 1.0);
    const balc = new THREE.Mesh(geo, mat);
    balc.position.set(0, fy + 0.05, d / 2 + 0.5);
    group.add(balc);

    // Railing
    const rg = new THREE.BoxGeometry(w * 0.5, 0.6, 0.06);
    const rail = new THREE.Mesh(rg, railMat);
    rail.position.set(0, fy + 0.4, d / 2 + 1.0);
    group.add(rail);
  });
}

// ─── PROPS ───────────────────────────────────────────────────────────────────
function buildProps() {
  const step = BLOCK_SIZE;

  for (let bx = -CITY_HALF; bx < CITY_HALF; bx += step) {
    for (let bz = -CITY_HALF; bz < CITY_HALF; bz += step) {
      // Street lights at each corner
      placeStreetLight(bx + 0.8, bz + 0.8);
      placeStreetLight(bx + step - 0.8, bz + 0.8);
      placeStreetLight(bx + 0.8, bz + step - 0.8);
      placeStreetLight(bx + step - 0.8, bz + step - 0.8);

      // Trees scattered in blocks
      const blockCX = bx + step / 2;
      const blockCZ = bz + step / 2;
      if (Math.random() > 0.4) {
        placeTree(blockCX + (Math.random() - 0.5) * 4, blockCZ + (Math.random() - 0.5) * 4);
      }

      // Vending machine
      if (Math.random() > 0.7) {
        placeVendingMachine(bx + ROAD_WIDTH / 2 + 0.7, bz + ROAD_WIDTH / 2 + 0.3 + Math.random() * 3);
      }

      // Bench
      if (Math.random() > 0.6) {
        placeBench(blockCX + (Math.random() - 0.5) * 5, blockCZ + (Math.random() - 0.5) * 5);
      }
    }
  }
}

function placeStreetLight(x, z) {
  const group = new THREE.Group();
  const poleMat = toonMat(0x888899);

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 4.5, 8);
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 2.25;
  pole.castShadow = true;
  group.add(pole);

  // Arm
  const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.position.set(0.6, 4.5, 0);
  arm.rotation.z = Math.PI / 2;
  group.add(arm);

  // Lamp head
  const lampGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });
  const lamp = new THREE.Mesh(lampGeo, lampMat);
  lamp.position.set(1.2, 4.5, 0);
  group.add(lamp);

  // Point light
  const pl = new THREE.PointLight(0xffe8a0, 0.9, 12);
  pl.position.set(1.2, 4.3, 0);
  group.add(pl);

  group.position.set(x, 0, z);
  scene.add(group);
}

function placeTree(x, z) {
  const group = new THREE.Group();

  const trunkMat = toonMat(0x775533);
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.6, 8);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  group.add(trunk);

  // Layered foliage for anime look
  const pinkVariants = [0xff9de2, 0xffb3d9, 0xffd6f5, 0xff77cc, 0xee66bb];
  const greenVariants = [0x44bb66, 0x55cc77, 0x33aa55, 0x66cc88];
  const isSakura = Math.random() > 0.4;
  const foliageColors = isSakura ? pinkVariants : greenVariants;

  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const r = 1.6 - t * 0.3;
    const y = 1.8 + t * 1.0;
    const geo = new THREE.SphereGeometry(r, 10, 8);
    const color = foliageColors[Math.floor(Math.random() * foliageColors.length)];
    const mat = toonMat(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    mesh.castShadow = true;
    group.add(mesh);
  }

  group.position.set(x, 0, z);
  group.scale.setScalar(0.8 + Math.random() * 0.5);
  scene.add(group);
}

function placeVendingMachine(x, z) {
  const group = new THREE.Group();
  const colors = [0xff3366, 0x3366ff, 0x33cc66, 0xff9900];
  const c = colors[Math.floor(Math.random() * colors.length)];
  const bodyMat = toonMat(c);
  const geo = new THREE.BoxGeometry(0.7, 1.6, 0.45);
  const body = new THREE.Mesh(geo, bodyMat);
  body.position.y = 0.8;
  body.castShadow = true;
  group.add(body);

  // Screen
  const scrMat = new THREE.MeshBasicMaterial({ color: 0x88ffcc });
  const scrGeo = new THREE.PlaneGeometry(0.35, 0.5);
  const scr = new THREE.Mesh(scrGeo, scrMat);
  scr.position.set(0, 1.1, 0.23);
  group.add(scr);

  // Glow
  const pl = new THREE.PointLight(c, 0.6, 4);
  pl.position.set(0, 0.8, 0.5);
  group.add(pl);

  group.position.set(x, 0, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);
}

function placeBench(x, z) {
  const mat = toonMat(0x996633);
  const group = new THREE.Group();

  const seatGeo = new THREE.BoxGeometry(1.4, 0.1, 0.5);
  const seat = new THREE.Mesh(seatGeo, mat);
  seat.position.y = 0.45;
  group.add(seat);

  const backGeo = new THREE.BoxGeometry(1.4, 0.5, 0.06);
  const back = new THREE.Mesh(backGeo, mat);
  back.position.set(0, 0.75, -0.22);
  group.add(back);

  // Legs
  [-0.55, 0.55].forEach(lx => {
    const legGeo = new THREE.BoxGeometry(0.08, 0.45, 0.45);
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(lx, 0.22, 0);
    group.add(leg);
  });

  group.position.set(x, 0, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  scene.add(group);
}

// ─── PLAYER ──────────────────────────────────────────────────────────────────
function buildPlayer() {
  player = new THREE.Group();

  const skinColor = 0xffdbb4;
  const hairColor = 0x2b1a0a;
  const clothColor = 0x4466cc;
  const shoeColor = 0x333333;
  const skirtColor = 0xcc4488;

  // Head
  const headGeo = new THREE.SphereGeometry(0.32, 12, 10);
  const headMat = toonMat(skinColor);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.68;
  head.castShadow = true;
  player.add(head);

  // Anime eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2255cc });
  const eyeGeo = new THREE.PlaneGeometry(0.12, 0.14);
  [-0.11, 0.11].forEach(ex => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(ex, 1.70, 0.31);
    player.add(eye);
  });

  // Pupils
  const pupMat = new THREE.MeshBasicMaterial({ color: 0x000011 });
  const pupGeo = new THREE.PlaneGeometry(0.05, 0.07);
  [-0.11, 0.11].forEach(ex => {
    const pup = new THREE.Mesh(pupGeo, pupMat);
    pup.position.set(ex, 1.70, 0.32);
    player.add(pup);
  });

  // Eye shine
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shineGeo = new THREE.PlaneGeometry(0.04, 0.04);
  [-0.11, 0.11].forEach(ex => {
    const shine = new THREE.Mesh(shineGeo, shineMat);
    shine.position.set(ex + 0.03, 1.73, 0.33);
    player.add(shine);
  });

  // Mouth
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0xcc5566 });
  const mouthGeo = new THREE.PlaneGeometry(0.1, 0.03);
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, 1.60, 0.315);
  player.add(mouth);

  // Hair
  const hairMat = toonMat(hairColor);
  const hairGeo = new THREE.SphereGeometry(0.35, 12, 10);
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.set(0, 1.75, -0.05);
  hair.scale.set(1, 0.85, 1);
  hair.castShadow = true;
  player.add(hair);

  // Hair bangs
  const bangGeo = new THREE.BoxGeometry(0.5, 0.15, 0.2);
  const bang = new THREE.Mesh(bangGeo, hairMat);
  bang.position.set(0, 1.82, 0.25);
  player.add(bang);

  // Side hair
  [-0.28, 0.28].forEach(hx => {
    const sideGeo = new THREE.BoxGeometry(0.12, 0.5, 0.2);
    const side = new THREE.Mesh(sideGeo, hairMat);
    side.position.set(hx, 1.55, 0.1);
    player.add(side);
  });

  // Neck
  const neckGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8);
  const neck = new THREE.Mesh(neckGeo, headMat);
  neck.position.y = 1.35;
  player.add(neck);

  // Torso (shirt)
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.6, 0.28);
  const torso = new THREE.Mesh(torsoGeo, toonMat(clothColor));
  torso.position.y = 1.0;
  torso.castShadow = true;
  player.add(torso);

  // Collar
  const collarGeo = new THREE.BoxGeometry(0.34, 0.12, 0.3);
  const collar = new THREE.Mesh(collarGeo, toonMat(0xffffff));
  collar.position.set(0, 1.22, 0.02);
  player.add(collar);

  // Skirt
  const skirtMat = toonMat(skirtColor);
  const skirtGeo = new THREE.CylinderGeometry(0.32, 0.42, 0.38, 10);
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = 0.68;
  skirt.castShadow = true;
  player.add(skirt);

  // Arms
  const armMat = toonMat(clothColor);
  [[-0.36, 0], [0.36, 0]].forEach(([ax, az], idx) => {
    const armGeo = new THREE.CapsuleGeometry ?
      new THREE.CapsuleGeometry(0.09, 0.35, 4, 8) :
      new THREE.CylinderGeometry(0.08, 0.09, 0.42, 8);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(ax, 0.98, az);
    arm.userData.isArm = true;
    arm.userData.side = idx === 0 ? -1 : 1;
    arm.castShadow = true;
    player.add(arm);

    // Hand
    const handGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const hand = new THREE.Mesh(handGeo, headMat);
    hand.position.set(ax, 0.73, az);
    player.add(hand);
  });

  // Legs
  const legMat = toonMat(0x223366);
  [-0.14, 0.14].forEach((lx, idx) => {
    const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.45, 8);
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx, 0.36, 0);
    leg.userData.isLeg = true;
    leg.userData.side = idx === 0 ? -1 : 1;
    leg.castShadow = true;
    player.add(leg);

    // Shoe
    const shoeGeo = new THREE.BoxGeometry(0.16, 0.1, 0.24);
    const shoe = new THREE.Mesh(shoeGeo, toonMat(shoeColor));
    shoe.position.set(lx, 0.1, 0.04);
    player.add(shoe);
  });

  // Shadow blob
  const shadowGeo = new THREE.CircleGeometry(0.38, 16);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x220033, transparent: true, opacity: 0.3 });
  const shadowBlob = new THREE.Mesh(shadowGeo, shadowMat);
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.position.y = 0.01;
  player.add(shadowBlob);

  player.position.set(0, 0, 0);
  scene.add(player);
}

// ─── PARTICLES ───────────────────────────────────────────────────────────────
let sakuraParticles, rainParticles;

function buildParticleSystems() {
  // Sakura petals
  const petalCount = 300;
  const petalGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(petalCount * 3);
  const velocities = [];
  for (let i = 0; i < petalCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = Math.random() * 30 + 2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    velocities.push({
      x: (Math.random() - 0.5) * 0.5,
      y: -(0.3 + Math.random() * 0.5),
      z: (Math.random() - 0.5) * 0.3,
      spin: (Math.random() - 0.5) * 2,
    });
  }
  petalGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const petalMat = new THREE.PointsMaterial({ color: 0xffaadd, size: 0.3, transparent: true, opacity: 0.85, sizeAttenuation: true });
  sakuraParticles = new THREE.Points(petalGeo, petalMat);
  sakuraParticles.userData.velocities = velocities;
  sakuraParticles.userData.count = petalCount;
  sakuraParticles.visible = false;
  scene.add(sakuraParticles);

  // Rain
  const rainCount = 800;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * 60;
    rainPos[i * 3 + 1] = Math.random() * 30;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.PointsMaterial({ color: 0x88aaff, size: 0.08, transparent: true, opacity: 0.6, sizeAttenuation: true });
  rainParticles = new THREE.Points(rainGeo, rainMat);
  rainParticles.visible = false;
  scene.add(rainParticles);
}

// ─── WEATHER ─────────────────────────────────────────────────────────────────
function setWeather(mode) {
  weatherMode = mode;
  sakuraParticles.visible = (mode === 'sakura');
  rainParticles.visible = (mode === 'rain');

  switch (mode) {
    case 'clear':
      scene.fog.color.set(0xffd6f0);
      skyUniforms.topColor.value.set(0xff9de2);
      skyUniforms.bottomColor.value.set(0xffd6f0);
      skyUniforms.horizColor.value.set(0xffb3d9);
      sunLight.intensity = 1.4;
      sunLight.color.set(0xffe8c0);
      ambientLight.color.set(0xffd6f0);
      ambientLight.intensity = 0.6;
      moonLight.intensity = 0;
      document.getElementById('weather-label').textContent = 'Clear Evening';
      break;
    case 'rain':
      scene.fog.color.set(0x8899bb);
      skyUniforms.topColor.value.set(0x556688);
      skyUniforms.bottomColor.value.set(0x8899bb);
      skyUniforms.horizColor.value.set(0x6677aa);
      sunLight.intensity = 0.4;
      sunLight.color.set(0xaabbcc);
      ambientLight.color.set(0x8899cc);
      ambientLight.intensity = 0.4;
      document.getElementById('weather-label').textContent = 'Rainy Night';
      break;
    case 'sakura':
      scene.fog.color.set(0xffccee);
      skyUniforms.topColor.value.set(0xff88cc);
      skyUniforms.bottomColor.value.set(0xffccee);
      skyUniforms.horizColor.value.set(0xffaadd);
      sunLight.intensity = 1.2;
      sunLight.color.set(0xffddcc);
      ambientLight.color.set(0xffccee);
      ambientLight.intensity = 0.7;
      moonLight.intensity = 0;
      document.getElementById('weather-label').textContent = 'Sakura Spring';
      break;
    case 'night':
      scene.fog.color.set(0x0a0a2a);
      skyUniforms.topColor.value.set(0x050515);
      skyUniforms.bottomColor.value.set(0x0a0a2a);
      skyUniforms.horizColor.value.set(0x111133);
      sunLight.intensity = 0.05;
      sunLight.color.set(0x223355);
      ambientLight.color.set(0x111133);
      ambientLight.intensity = 0.15;
      moonLight.intensity = 0.6;
      document.getElementById('weather-label').textContent = 'Neon Night';
      break;
  }
}

// ─── PLAYER MOVEMENT ─────────────────────────────────────────────────────────
const WALK_SPEED = 6;
const RUN_SPEED = 11;
let walkPhase = 0;
let isMoving = false;

function updatePlayer(dt) {
  const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? RUN_SPEED : WALK_SPEED;

  // Direction relative to camera yaw
  const forward = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
  const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));

  const move = new THREE.Vector3();
  if (keys['KeyW'] || keys['ArrowUp']) move.add(forward);
  if (keys['KeyS'] || keys['ArrowDown']) move.sub(forward);
  if (keys['KeyA'] || keys['ArrowLeft']) move.sub(right);
  if (keys['KeyD'] || keys['ArrowRight']) move.add(right);

  isMoving = move.lengthSq() > 0;

  if (isMoving) {
    move.normalize().multiplyScalar(speed * dt);
    const newPos = player.position.clone().add(move);

    // Basic collision with buildings
    if (!collidesWithBuilding(newPos)) {
      player.position.copy(newPos);
    }

    // Rotate player towards movement
    const angle = Math.atan2(move.x, move.z);
    player.rotation.y = lerpAngle(player.rotation.y, angle, 12 * dt);

    walkPhase += dt * (speed === RUN_SPEED ? 12 : 8);
  } else {
    walkPhase *= 0.9;
  }

  // Bob animation
  animateCharacter(dt);

  // Keep player on ground
  player.position.y = 0;
}

function animateCharacter(dt) {
  if (!player) return;

  const bob = isMoving ? Math.sin(walkPhase) * 0.05 : 0;
  const swing = isMoving ? Math.sin(walkPhase) * 0.3 : 0;

  player.children.forEach(child => {
    if (child.userData.isArm) {
      child.rotation.x = child.userData.side * swing * 0.8;
    }
    if (child.userData.isLeg) {
      child.rotation.x = -child.userData.side * swing;
    }
  });

  // Head bob
  const head = player.children.find(c => c.geometry && c.geometry.type === 'SphereGeometry' && c.position.y > 1.5 && !c.userData.isHair);
  if (head) head.position.y = 1.68 + bob;
}

function collidesWithBuilding(pos) {
  for (const b of buildingMeshes) {
    const hw = b.w / 2 + 0.5;
    const hd = b.d / 2 + 0.5;
    if (Math.abs(pos.x - b.x) < hw && Math.abs(pos.z - b.z) < hd) {
      return true;
    }
  }
  return false;
}

// ─── CAMERA ──────────────────────────────────────────────────────────────────
function updateCamera(dt) {
  const targetPos = player.position.clone().add(new THREE.Vector3(0, 1.2, 0));

  const spherical = new THREE.Spherical(camDistance, Math.PI / 2 - camPitch, camYaw);
  const offset = new THREE.Vector3().setFromSpherical(spherical);
  const desiredPos = targetPos.clone().add(offset);

  camera.position.lerp(desiredPos, 10 * dt);
  camera.lookAt(targetPos);

  cameraTarget.lerp(targetPos, 8 * dt);
}

// ─── MINIMAP ──────────────────────────────────────────────────────────────────
function drawMinimap() {
  if (!minimapCtx) return;
  const w = 140, h = 140, cx = 70, cy = 70;
  const scale = 1.2;

  minimapCtx.clearRect(0, 0, w, h);

  // Clip to circle
  minimapCtx.save();
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 68, 0, Math.PI * 2);
  minimapCtx.clip();

  // Background
  minimapCtx.fillStyle = '#1a1a2e';
  minimapCtx.fillRect(0, 0, w, h);

  // Roads
  minimapCtx.strokeStyle = '#334';
  minimapCtx.lineWidth = 3 * scale;
  for (let x = -CITY_HALF; x <= CITY_HALF; x += BLOCK_SIZE) {
    const px = cx + (x - player.position.x) * scale;
    minimapCtx.beginPath();
    minimapCtx.moveTo(px, 0);
    minimapCtx.lineTo(px, h);
    minimapCtx.stroke();
  }
  for (let z = -CITY_HALF; z <= CITY_HALF; z += BLOCK_SIZE) {
    const pz = cy + (z - player.position.z) * scale;
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, pz);
    minimapCtx.lineTo(w, pz);
    minimapCtx.stroke();
  }

  // Buildings
  minimapCtx.fillStyle = '#556';
  buildingMeshes.forEach(b => {
    const bx = cx + (b.x - player.position.x) * scale;
    const bz = cy + (b.z - player.position.z) * scale;
    minimapCtx.fillRect(bx - b.w * scale / 2, bz - b.d * scale / 2, b.w * scale, b.d * scale);
  });

  // Player dot
  minimapCtx.fillStyle = '#ff6eb4';
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, 4, 0, Math.PI * 2);
  minimapCtx.fill();

  // Direction arrow
  minimapCtx.save();
  minimapCtx.translate(cx, cy);
  minimapCtx.rotate(-player.rotation.y);
  minimapCtx.fillStyle = '#fff';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -8);
  minimapCtx.lineTo(-3, 0);
  minimapCtx.lineTo(3, 0);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();

  minimapCtx.restore();
}

// ─── TIME ────────────────────────────────────────────────────────────────────
function updateGameTime(dt) {
  gameTime += dt * 0.5; // 1 real second = 30 game minutes
  if (gameTime >= 24) gameTime -= 24;

  const h = Math.floor(gameTime);
  const m = Math.floor((gameTime - h) * 60);
  document.getElementById('game-time').textContent =
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── PARTICLES UPDATE ────────────────────────────────────────────────────────
function updateParticles(dt) {
  // Sakura
  if (sakuraParticles.visible) {
    const pos = sakuraParticles.geometry.attributes.position.array;
    const vel = sakuraParticles.userData.velocities;
    const count = sakuraParticles.userData.count;
    const px = player.position.x, pz = player.position.z;

    for (let i = 0; i < count; i++) {
      pos[i * 3] += vel[i].x * dt * 2;
      pos[i * 3 + 1] += vel[i].y * dt * 2;
      pos[i * 3 + 2] += vel[i].z * dt * 2;

      if (pos[i * 3 + 1] < 0) {
        pos[i * 3] = px + (Math.random() - 0.5) * 80;
        pos[i * 3 + 1] = 25 + Math.random() * 10;
        pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 80;
      }
    }
    sakuraParticles.geometry.attributes.position.needsUpdate = true;
  }

  // Rain
  if (rainParticles.visible) {
    const pos = rainParticles.geometry.attributes.position.array;
    const count = pos.length / 3;
    const px = player.position.x, pz = player.position.z;

    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= 15 * dt;
      pos[i * 3] += 2 * dt;

      if (pos[i * 3 + 1] < 0) {
        pos[i * 3] = px + (Math.random() - 0.5) * 60;
        pos[i * 3 + 1] = 25 + Math.random() * 10;
        pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 60;
      }
    }
    rainParticles.geometry.attributes.position.needsUpdate = true;
  }

  // Clouds drift
  particleSystems.forEach(ps => {
    if (ps.type === 'cloud') {
      ps.mesh.position.x += ps.mesh.userData.speed * dt * 0.3;
      if (ps.mesh.position.x > CITY_HALF + 20) {
        ps.mesh.position.x = -CITY_HALF - 20;
      }
    }
  });
}

// ─── INPUT HANDLERS ──────────────────────────────────────────────────────────
function onMouseMove(e) {
  if (!mouseDown) return;
  const dx = e.clientX - lastMouse.x;
  const dy = e.clientY - lastMouse.y;
  lastMouse = { x: e.clientX, y: e.clientY };
  camYaw -= dx * 0.005;
  camPitch = Math.max(0.1, Math.min(1.2, camPitch + dy * 0.005));
}

function onWheel(e) {
  camDistance = Math.max(3, Math.min(25, camDistance + e.deltaY * 0.02));
}

let touchStart = null;
function onTouchStart(e) {
  if (e.touches.length === 1) {
    mouseDown = true;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
}
function onTouchMove(e) {
  if (e.touches.length === 1 && mouseDown) {
    const dx = e.touches[0].clientX - lastMouse.x;
    const dy = e.touches[0].clientY - lastMouse.y;
    lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    camYaw -= dx * 0.005;
    camPitch = Math.max(0.1, Math.min(1.2, camPitch + dy * 0.005));
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * Math.min(t, 1);
}

function darken(hex) {
  const r = ((hex >> 16) & 0xff) * 0.75;
  const g = ((hex >> 8) & 0xff) * 0.75;
  const b = (hex & 0xff) * 0.75;
  return (r << 16) | (g << 8) | b;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── MAIN LOOP ───────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updatePlayer(dt);
  updateCamera(dt);
  updateParticles(dt);
  updateGameTime(dt);
  drawMinimap();

  renderer.render(scene, camera);
}

// ─── SPLASH SCREEN ───────────────────────────────────────────────────────────
function makeSplashPetals() {
  const bg = document.getElementById('petals-bg');
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = '-20px';
    p.style.animationDuration = (4 + Math.random() * 6) + 's';
    p.style.animationDelay = (Math.random() * 5) + 's';
    p.style.width = p.style.height = (6 + Math.random() * 10) + 'px';
    p.style.opacity = (0.4 + Math.random() * 0.6).toString();
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    bg.appendChild(p);
  }
}

document.getElementById('start-btn').addEventListener('click', () => {
  const overlay = document.getElementById('overlay');
  overlay.classList.add('hidden');
  setTimeout(() => overlay.remove(), 1600);
});

// ─── BOOT ────────────────────────────────────────────────────────────────────
makeSplashPetals();
init();
setWeather('clear');
