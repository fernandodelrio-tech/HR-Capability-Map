'use strict';
const THREE = window.THREE;

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
let player;
let camYaw = 0, camPitch = 0.3, camDistance = 10;
let mouseDown = false, lastMouse = { x: 0, y: 0 };
const keys = {};
const buildingAABB = []; // {x,z,hw,hd} collision only
let minimapCtx, minimapCanvas;
let weatherMode = 'clear';
let gameTime = 18.5;
let sunLight, ambientLight, moonLight;
let toonGradient;
let sakuraParticles, rainParticles;
let skyUniforms, skyMesh;
const cloudSprites = [];
let neonLightCount = 0;
const MAX_NEON_LIGHTS = 10;

// ─── MATERIAL CACHE ───────────────────────────────────────────────────────────
const _tC = new Map(), _bC = new Map();
function toonMat(color) {
  if (_tC.has(color)) return _tC.get(color);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient });
  _tC.set(color, m); return m;
}
function basicMat(color) {
  if (_bC.has(color)) return _bC.get(color);
  const m = new THREE.MeshBasicMaterial({ color });
  _bC.set(color, m); return m;
}

// ─── GEOMETRY CACHE ───────────────────────────────────────────────────────────
const _gC = new Map();
function cBox(w, h, d) {
  const k = `b${w},${h},${d}`;
  if (!_gC.has(k)) _gC.set(k, new THREE.BoxGeometry(w, h, d));
  return _gC.get(k);
}
function cCyl(rt, rb, h, s) {
  const k = `c${rt},${rb},${h},${s}`;
  if (!_gC.has(k)) _gC.set(k, new THREE.CylinderGeometry(rt, rb, h, s));
  return _gC.get(k);
}
function cSph(r, ws, hs) {
  const k = `s${r},${ws},${hs}`;
  if (!_gC.has(k)) _gC.set(k, new THREE.SphereGeometry(r, ws, hs));
  return _gC.get(k);
}

// ─── INSTANCED POOL HELPERS ───────────────────────────────────────────────────
const _mp = new THREE.Vector3(), _mq = new THREE.Quaternion();
const _ms = new THREE.Vector3(), _me = new THREE.Euler(), _m4 = new THREE.Matrix4();

function setIM(im, n, x, y, z, ry, sx, sy, sz) {
  _mp.set(x, y, z);
  _me.set(0, ry || 0, 0);
  _mq.setFromEuler(_me);
  _ms.set(sx || 1, sy || 1, sz || 1);
  _m4.compose(_mp, _mq, _ms);
  im.setMatrixAt(n, _m4);
}

// Instanced meshes + counters
const MAX_WIN = 3500, MAX_TREE = 120, MAX_POLE = 220;
let winLitIM, winDarkIM, winLitN = 0, winDarkN = 0;
let trunkIM, foliagePkIM, foliageGnIM;
let trunkN = 0, foliagePkN = 0, foliageGnN = 0;
let poleIM, lampIM, poleN = 0, lampN = 0;

// ─── HOT-PATH PRE-ALLOC ───────────────────────────────────────────────────────
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3(), _mv = new THREE.Vector3();
const _camTgt = new THREE.Vector3(), _sph = new THREE.Spherical(), _off = new THREE.Vector3();
const _want = new THREE.Vector3();

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CITY_HALF = 60, BLOCK = 20, ROAD = 6;
const BLDG_PALETTES = [
  [0xff9de2, 0xffd6f5], [0x9de2ff, 0xd6f5ff],
  [0xb3ffde, 0xd6fff0], [0xffe09d, 0xfff5d6],
  [0xc9b3ff, 0xe6d6ff], [0xff9999, 0xffd6d6],
];

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffd6f0, 30, 95);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 160);
  camera.position.set(0, 6, 10);

  toonGradient = makeToonGradient();
  buildLighting();
  buildSky();
  initPools();
  buildCity();
  buildPlayer();
  buildParticles();
  flushPools();

  minimapCanvas = document.getElementById('minimap-canvas');
  minimapCtx = minimapCanvas.getContext('2d');

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup',  e => { keys[e.code] = false; });
  window.addEventListener('wheel', onWheel, { passive: true });
  renderer.domElement.addEventListener('mousedown', e => { mouseDown = true; lastMouse = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('mouseup',   () => { mouseDown = false; });
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  renderer.domElement.addEventListener('touchmove',  onTouchMove,  { passive: true });
  renderer.domElement.addEventListener('touchend',   () => { mouseDown = false; });
  document.querySelectorAll('.weather-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.weather-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setWeather(btn.dataset.weather);
    })
  );
  animate();
}

// ─── TOON GRADIENT ────────────────────────────────────────────────────────────
function makeToonGradient() {
  // 4-step cel shade stored in a tiny 1D texture
  const data = new Uint8Array([
    26,  26,  38, 255,
    77,  77,  89, 255,
    153, 153, 166, 255,
    230, 225, 235, 255,
  ]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// ─── LIGHTING ─────────────────────────────────────────────────────────────────
function buildLighting() {
  ambientLight = new THREE.AmbientLight(0xffd6f0, 0.6);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xffe8c0, 1.4);
  sunLight.position.set(30, 50, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);  // was 2048×2048
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 80;
  // Shadow covers only a 50-unit radius around origin — updated each frame to follow player
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -40;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top  =  40;
  sunLight.shadow.bias = -0.002;
  scene.add(sunLight);

  moonLight = new THREE.DirectionalLight(0x6688cc, 0);
  moonLight.position.set(-30, 40, -10);
  scene.add(moonLight);

  scene.add(new THREE.HemisphereLight(0xffd6f5, 0x443355, 0.45));
}

// ─── SKY + CLOUDS ─────────────────────────────────────────────────────────────
function buildSky() {
  const skyGeo = new THREE.SphereGeometry(250, 12, 7);
  skyUniforms = {
    topColor:   { value: new THREE.Color(0xff9de2) },
    bottomColor:{ value: new THREE.Color(0xffd6f0) },
    horizColor: { value: new THREE.Color(0xffb3d9) },
  };
  skyMesh = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 topColor, bottomColor, horizColor;
      varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.0
          ? mix(horizColor, topColor, smoothstep(0.0,0.5,h))
          : mix(horizColor, bottomColor, smoothstep(0.0,-0.3,h));
        gl_FragColor = vec4(c,1.0);
      }
    `,
    side: THREE.BackSide, depthWrite: false,
  }));
  scene.add(skyMesh);

  // Sun
  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 20), basicMat(0xffe090));
  sun.position.set(60, 80, -80);
  scene.add(sun);
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(6.5, 14, 20),
    new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.14, side: THREE.DoubleSide })
  );
  glow.position.copy(sun.position);
  scene.add(glow);

  // Clouds as billboard sprites — 1 draw call each, no sphere clusters
  const cloudTex = makeCloudTexture();
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.88, depthWrite: false });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(cloudMat);
    s.position.set((Math.random() - 0.5) * 200, 42 + Math.random() * 28, (Math.random() - 0.5) * 200);
    const w = 20 + Math.random() * 16;
    s.scale.set(w * 2.2, w, 1);
    s.userData.speed = 0.25 + Math.random() * 0.4;
    scene.add(s);
    cloudSprites.push(s);
  }
}

function makeCloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const ctx = cv.getContext('2d');
  [[128,75,56],[80,88,44],[172,86,42],[112,52,34],[158,60,38],[94,72,30],[62,92,28],[198,90,30]].forEach(([px,py,pr]) => {
    const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
    g.addColorStop(0,   'rgba(255,252,255,0.92)');
    g.addColorStop(0.55,'rgba(255,248,255,0.55)');
    g.addColorStop(1,   'rgba(255,245,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
  });
  return new THREE.CanvasTexture(cv);
}

// ─── INSTANCED POOLS INIT ─────────────────────────────────────────────────────
function initPools() {
  const winGeo = new THREE.PlaneGeometry(0.55, 0.68);
  winLitIM  = new THREE.InstancedMesh(winGeo, basicMat(0xffee88), MAX_WIN);
  winDarkIM = new THREE.InstancedMesh(winGeo, basicMat(0x223344), MAX_WIN);
  winLitIM.count = winDarkIM.count = 0;
  scene.add(winLitIM, winDarkIM);

  trunkIM     = new THREE.InstancedMesh(cCyl(0.12, 0.18, 1.6, 6),  toonMat(0x775533), MAX_TREE);
  foliagePkIM = new THREE.InstancedMesh(cSph(1.5, 7, 5),            toonMat(0xff9de2), MAX_TREE * 2);
  foliageGnIM = new THREE.InstancedMesh(cSph(1.5, 7, 5),            toonMat(0x44bb66), MAX_TREE * 2);
  trunkIM.count = foliagePkIM.count = foliageGnIM.count = 0;
  foliagePkIM.castShadow = foliageGnIM.castShadow = true;
  scene.add(trunkIM, foliagePkIM, foliageGnIM);

  poleIM = new THREE.InstancedMesh(cCyl(0.055, 0.075, 4.5, 6), toonMat(0x888899), MAX_POLE);
  lampIM = new THREE.InstancedMesh(cSph(0.22, 7, 5),            basicMat(0xffeeaa), MAX_POLE);
  poleIM.count = lampIM.count = 0;
  scene.add(poleIM, lampIM);
}

function flushPools() {
  winLitIM.count  = winLitN;  winLitIM.instanceMatrix.needsUpdate  = true;
  winDarkIM.count = winDarkN; winDarkIM.instanceMatrix.needsUpdate = true;
  trunkIM.count   = trunkN;   trunkIM.instanceMatrix.needsUpdate   = true;
  foliagePkIM.count = foliagePkN; foliagePkIM.instanceMatrix.needsUpdate = true;
  foliageGnIM.count = foliageGnN; foliageGnIM.instanceMatrix.needsUpdate = true;
  poleIM.count = poleN; poleIM.instanceMatrix.needsUpdate = true;
  lampIM.count = lampN; lampIM.instanceMatrix.needsUpdate = true;
}

// ─── CITY ─────────────────────────────────────────────────────────────────────
function buildCity() {
  buildGround();
  buildRoads();
  buildBlocks();
  buildProps();
}

function buildGround() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), toonMat(0x444455));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
  scene.add(m);
}

function buildRoads() {
  const roadMat = toonMat(0x333344);
  const swMat   = toonMat(0x998877);

  for (let x = -CITY_HALF; x <= CITY_HALF; x += BLOCK) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, CITY_HALF * 2), roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, 0); m.receiveShadow = true;
    scene.add(m);
  }
  for (let z = -CITY_HALF; z <= CITY_HALF; z += BLOCK) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(CITY_HALF * 2, ROAD), roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.01, z); m.receiveShadow = true;
    scene.add(m);
  }

  // Sidewalk pads — one mesh per block, shared material
  for (let bx = -CITY_HALF; bx < CITY_HALF; bx += BLOCK) {
    for (let bz = -CITY_HALF; bz < CITY_HALF; bz += BLOCK) {
      const size = BLOCK - ROAD;
      const sw = new THREE.Mesh(cBox(size, 0.12, size), swMat);
      sw.position.set(bx + BLOCK / 2, 0.06, bz + BLOCK / 2);
      sw.receiveShadow = true;
      scene.add(sw);
    }
  }

  // Crosswalk stripes — one shared geo/mat, placed at every intersection
  const stripeGeo = new THREE.PlaneGeometry(0.55, 2.4);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xeeeebb });
  for (let cx = -CITY_HALF; cx <= CITY_HALF; cx += BLOCK) {
    for (let cz = -CITY_HALF; cz <= CITY_HALF; cz += BLOCK) {
      for (let i = -2; i <= 2; i++) {
        const s1 = new THREE.Mesh(stripeGeo, stripeMat);
        s1.rotation.x = -Math.PI / 2;
        s1.position.set(cx + i * 0.88, 0.025, cz + ROAD / 2 + 0.5);
        scene.add(s1);
        const s2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.55), stripeMat);
        s2.rotation.x = -Math.PI / 2;
        s2.position.set(cx + ROAD / 2 + 0.5, 0.025, cz + i * 0.88);
        scene.add(s2);
      }
    }
  }
}

// ─── BUILDINGS ────────────────────────────────────────────────────────────────
function buildBlocks() {
  for (let bx = -CITY_HALF; bx < CITY_HALF; bx += BLOCK) {
    for (let bz = -CITY_HALF; bz < CITY_HALF; bz += BLOCK) {
      const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
      const usable = BLOCK - ROAD - 1;
      const count = 1 + Math.floor(Math.random() * 3);
      if (count === 1) {
        placeBuilding(cx, cz, usable * 0.85, usable * 0.85);
      } else {
        const sub = usable / 2;
        const offs = shuffled([[-sub/2,-sub/2],[sub/2,-sub/2],[-sub/2,sub/2],[sub/2,sub/2]]).slice(0, count);
        offs.forEach(([ox, oz]) => placeBuilding(cx + ox, cz + oz, sub * 0.78, sub * 0.78));
      }
    }
  }
}

function placeBuilding(cx, cz, w, d) {
  const pal    = BLDG_PALETTES[Math.floor(Math.random() * BLDG_PALETTES.length)];
  const floors = 2 + Math.floor(Math.random() * 10);
  const h      = floors * 2.2;
  const style  = Math.floor(Math.random() * 4);

  // Body — casts shadow
  const body = new THREE.Mesh(cBox(w, h, d), toonMat(pal[0]));
  body.position.set(cx, h / 2, cz);
  body.castShadow = body.receiveShadow = true;
  scene.add(body);

  buildingAABB.push({ x: cx, z: cz, hw: w / 2, hd: d / 2 });

  // Windows via InstancedMesh
  addWindowsInstanced(cx, cz, w, d, floors);

  // Roof
  addRoof(cx, cz, w, h, d, style, pal[1]);

  // Neon sign (no point light — just emissive mesh)
  if (Math.random() > 0.5) addNeonSign(cx, cz, w, h, d);
}

function addWindowsInstanced(bx, bz, w, d, floors) {
  const CX = Math.min(2, Math.max(1, Math.floor(w / 2.8)));
  const CZ = Math.min(2, Math.max(1, Math.floor(d / 2.8)));
  const ROWS = Math.min(5, floors);
  const gx = w / (CX + 1), gz = d / (CZ + 1);

  for (let row = 0; row < ROWS; row++) {
    const fy = row * 2.2 + 1.4;
    for (let col = 0; col < CX; col++) {
      if (winLitN >= MAX_WIN || winDarkN >= MAX_WIN) return;
      const wx = bx - w / 2 + gx * (col + 1);
      const lit = Math.random() > 0.3;
      const im = lit ? winLitIM : winDarkIM;
      const n  = lit ? winLitN++ : winDarkN++;
      setIM(im, n,   wx, fy, bz + d / 2 + 0.01, 0);
      const n2 = lit ? winLitN++ : winDarkN++;
      setIM(lit ? winLitIM : winDarkIM, n2, wx, fy, bz - d / 2 - 0.01, Math.PI);
    }
    for (let col = 0; col < CZ; col++) {
      if (winLitN >= MAX_WIN || winDarkN >= MAX_WIN) return;
      const wz = bz - d / 2 + gz * (col + 1);
      const lit = Math.random() > 0.3;
      const im  = lit ? winLitIM : winDarkIM;
      const n   = lit ? winLitN++ : winDarkN++;
      setIM(im, n, bx - w / 2 - 0.01, fy, wz, -Math.PI / 2);
      const n2 = lit ? winLitN++ : winDarkN++;
      setIM(lit ? winLitIM : winDarkIM, n2, bx + w / 2 + 0.01, fy, wz, Math.PI / 2);
    }
  }
}

function addRoof(cx, cz, w, h, d, style, color) {
  let mesh;
  if (style === 1) {
    mesh = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.7, 3, 4), toonMat(darken(color)));
    mesh.position.set(cx, h + 1.5, cz); mesh.rotation.y = Math.PI / 4;
  } else {
    mesh = new THREE.Mesh(cBox(w + 0.3, 0.3, d + 0.3), toonMat(color));
    mesh.position.set(cx, h + 0.15, cz);
    if (style === 2) {
      const ant = new THREE.Mesh(cCyl(0.06, 0.06, 3.5, 5), toonMat(0x888888));
      ant.position.set(cx, h + 2.1, cz); scene.add(ant);
    }
  }
  mesh.castShadow = false; // roofs don't need shadow casting
  scene.add(mesh);
}

function addNeonSign(cx, cz, w, h, d) {
  const colors = [0xff3399, 0x33ffcc, 0xff9900, 0xcc33ff, 0x33ccff];
  const c = colors[Math.floor(Math.random() * colors.length)];
  const fw = 1.2 + Math.random() * 2;
  const sign = new THREE.Mesh(cBox(fw, 0.6, 0.08), basicMat(c));
  const fl = 1 + Math.floor(Math.random() * 3);
  sign.position.set(cx, fl * 2.2 + 1.0, cz + d / 2 + 0.15);
  scene.add(sign);

  // Cheap point light only for a few signs (GPU cost: 1 per fragment in range)
  if (neonLightCount < MAX_NEON_LIGHTS) {
    const pl = new THREE.PointLight(c, 0.7, 7);
    pl.position.set(cx, fl * 2.2 + 1.0, cz + d / 2 + 1.2);
    scene.add(pl);
    neonLightCount++;
  }
}

// ─── PROPS ────────────────────────────────────────────────────────────────────
function buildProps() {
  for (let bx = -CITY_HALF; bx < CITY_HALF; bx += BLOCK) {
    for (let bz = -CITY_HALF; bz < CITY_HALF; bz += BLOCK) {
      // 2 street lights per block corner (not 4 — halved)
      placeStreetLight(bx + 0.8, bz + 0.8);
      placeStreetLight(bx + BLOCK - 0.8, bz + BLOCK - 0.8);

      const bcx = bx + BLOCK / 2, bcz = bz + BLOCK / 2;
      if (Math.random() > 0.35) placeTree(bcx + (Math.random() - 0.5) * 5, bcz + (Math.random() - 0.5) * 5);
    }
  }
}

function placeStreetLight(x, z) {
  if (poleN >= MAX_POLE) return;
  setIM(poleIM, poleN++, x, 2.25, z);      // vertical pole
  setIM(lampIM, lampN++, x, 4.9, z);        // lamp on top (no arm, no PointLight)
}

function placeTree(x, z) {
  if (trunkN >= MAX_TREE) return;
  const sc = 0.8 + Math.random() * 0.45;
  const isSakura = Math.random() > 0.45;
  setIM(trunkIM, trunkN++, x, 0.8 * sc, z, 0, sc, 1, sc);
  for (let t = 0; t < 2; t++) {
    const fs = (1.3 - t * 0.25) * sc;
    const fy = (1.9 + t * 0.9) * sc;
    if (isSakura && foliagePkN < MAX_TREE * 2) {
      setIM(foliagePkIM, foliagePkN++, x, fy, z, 0, fs, fs, fs);
    } else if (!isSakura && foliageGnN < MAX_TREE * 2) {
      setIM(foliageGnIM, foliageGnN++, x, fy, z, 0, fs, fs, fs);
    }
  }
}

// ─── PLAYER ───────────────────────────────────────────────────────────────────
function buildPlayer() {
  player = new THREE.Group();
  const skin  = 0xffdbb4, hair = 0x2b1a0a;
  const cloth = 0x4466cc, shoe = 0x333333, skirt = 0xcc4488;

  // Head
  const head = new THREE.Mesh(cSph(0.32, 10, 8), toonMat(skin));
  head.position.y = 1.68; head.castShadow = true; player.add(head);

  // Anime eyes (BasicMaterial — no lighting needed)
  [[-0.11, 0x2255cc, 0.12, 0.14], [0.11, 0x2255cc, 0.12, 0.14]].forEach(([ex, c, pw, ph]) => {
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), basicMat(c));
    eye.position.set(ex, 1.70, 0.31); player.add(eye);
    const pup = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.07), basicMat(0x000011));
    pup.position.set(ex, 1.70, 0.32); player.add(pup);
    const shine = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), basicMat(0xffffff));
    shine.position.set(ex + 0.03, 1.73, 0.33); player.add(shine);
  });
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.03), basicMat(0xcc5566));
  mouth.position.set(0, 1.60, 0.315); player.add(mouth);

  // Hair
  const hairM = toonMat(hair);
  const hd = new THREE.Mesh(cSph(0.35, 10, 8), hairM);
  hd.position.set(0, 1.75, -0.05); hd.scale.set(1, 0.85, 1); hd.castShadow = true; player.add(hd);
  const bang = new THREE.Mesh(cBox(0.5, 0.15, 0.2), hairM);
  bang.position.set(0, 1.82, 0.25); player.add(bang);
  [-0.28, 0.28].forEach(hx => {
    const side = new THREE.Mesh(cBox(0.12, 0.5, 0.2), hairM);
    side.position.set(hx, 1.55, 0.1); player.add(side);
  });

  // Body
  const neck = new THREE.Mesh(cCyl(0.1, 0.12, 0.2, 7), toonMat(skin));
  neck.position.y = 1.35; player.add(neck);
  const torso = new THREE.Mesh(cBox(0.52, 0.6, 0.28), toonMat(cloth));
  torso.position.y = 1.0; torso.castShadow = true; player.add(torso);
  const collar = new THREE.Mesh(cBox(0.34, 0.12, 0.3), toonMat(0xffffff));
  collar.position.set(0, 1.22, 0.02); player.add(collar);
  const skirtM = new THREE.Mesh(cCyl(0.32, 0.42, 0.38, 9), toonMat(skirt));
  skirtM.position.y = 0.68; skirtM.castShadow = true; player.add(skirtM);

  // Arms and legs
  const armMat = toonMat(cloth), legMat = toonMat(0x223366);
  [[-0.36, 1], [0.36, -1]].forEach(([ax, side], idx) => {
    const arm = new THREE.Mesh(cCyl(0.08, 0.09, 0.42, 7), armMat);
    arm.position.set(ax, 0.98, 0);
    arm.userData.isArm = true; arm.userData.side = side;
    arm.castShadow = true; player.add(arm);
    const hand = new THREE.Mesh(cSph(0.1, 7, 5), toonMat(skin));
    hand.position.set(ax, 0.73, 0); player.add(hand);
  });
  [-0.14, 0.14].forEach((lx, idx) => {
    const leg = new THREE.Mesh(cCyl(0.09, 0.09, 0.45, 7), legMat);
    leg.position.set(lx, 0.36, 0);
    leg.userData.isLeg = true; leg.userData.side = idx === 0 ? -1 : 1;
    leg.castShadow = true; player.add(leg);
    const shoeM = new THREE.Mesh(cBox(0.16, 0.1, 0.24), toonMat(shoe));
    shoeM.position.set(lx, 0.1, 0.04); player.add(shoeM);
  });

  // Fake shadow blob (replaces expensive receiver shadow on props)
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.38, 14),
    new THREE.MeshBasicMaterial({ color: 0x220033, transparent: true, opacity: 0.28 })
  );
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.01; player.add(blob);

  player.position.set(0, 0, 0);
  scene.add(player);
}

// ─── PARTICLES ────────────────────────────────────────────────────────────────
function buildParticles() {
  // Sakura — 200 points (was 300)
  const pCount = 200;
  const pPos = new Float32Array(pCount * 3);
  const pVel = [];
  for (let i = 0; i < pCount; i++) {
    pPos[i*3]   = (Math.random() - 0.5) * 80;
    pPos[i*3+1] = Math.random() * 28 + 2;
    pPos[i*3+2] = (Math.random() - 0.5) * 80;
    pVel.push({ x: (Math.random()-0.5)*0.4, y: -(0.25+Math.random()*0.4), z: (Math.random()-0.5)*0.3 });
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  sakuraParticles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xffaadd, size: 0.28, transparent: true, opacity: 0.85, sizeAttenuation: true }));
  sakuraParticles.userData.velocities = pVel;
  sakuraParticles.userData.count = pCount;
  sakuraParticles.visible = false;
  scene.add(sakuraParticles);

  // Rain — 600 points (was 800)
  const rCount = 600;
  const rPos = new Float32Array(rCount * 3);
  for (let i = 0; i < rCount; i++) {
    rPos[i*3] = (Math.random()-0.5)*60; rPos[i*3+1] = Math.random()*28; rPos[i*3+2] = (Math.random()-0.5)*60;
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  rainParticles = new THREE.Points(rGeo, new THREE.PointsMaterial({ color: 0x88aaff, size: 0.07, transparent: true, opacity: 0.55, sizeAttenuation: true }));
  rainParticles.visible = false;
  scene.add(rainParticles);
}

// ─── WEATHER ──────────────────────────────────────────────────────────────────
function setWeather(mode) {
  weatherMode = mode;
  sakuraParticles.visible = mode === 'sakura';
  rainParticles.visible   = mode === 'rain';
  const presets = {
    clear:  { fog: 0xffd6f0, top: 0xff9de2, bot: 0xffd6f0, hor: 0xffb3d9, sun: 1.4, sunC: 0xffe8c0, amb: 0xffd6f0, ambI: 0.6, moon: 0,   label: 'Clear Evening' },
    rain:   { fog: 0x8899bb, top: 0x556688, bot: 0x8899bb, hor: 0x6677aa, sun: 0.4, sunC: 0xaabbcc, amb: 0x8899cc, ambI: 0.4, moon: 0,   label: 'Rainy Night' },
    sakura: { fog: 0xffccee, top: 0xff88cc, bot: 0xffccee, hor: 0xffaadd, sun: 1.2, sunC: 0xffddcc, amb: 0xffccee, ambI: 0.7, moon: 0,   label: 'Sakura Spring' },
    night:  { fog: 0x0a0a2a, top: 0x050515, bot: 0x0a0a2a, hor: 0x111133, sun: 0.05,sunC: 0x223355, amb: 0x111133, ambI: 0.15,moon: 0.6, label: 'Neon Night' },
  };
  const p = presets[mode];
  scene.fog.color.set(p.fog);
  skyUniforms.topColor.value.set(p.top);
  skyUniforms.bottomColor.value.set(p.bot);
  skyUniforms.horizColor.value.set(p.hor);
  sunLight.intensity = p.sun; sunLight.color.set(p.sunC);
  ambientLight.color.set(p.amb); ambientLight.intensity = p.ambI;
  moonLight.intensity = p.moon;
  document.getElementById('weather-label').textContent = p.label;
}

// ─── PLAYER MOVEMENT ──────────────────────────────────────────────────────────
const WALK_SPEED = 6, RUN_SPEED = 11;
let walkPhase = 0, isMoving = false;

function updatePlayer(dt) {
  const spd = (keys['ShiftLeft'] || keys['ShiftRight']) ? RUN_SPEED : WALK_SPEED;
  const cy = camYaw;
  _fwd.set(-Math.sin(cy), 0, -Math.cos(cy));
  _rgt.set( Math.cos(cy), 0, -Math.sin(cy));
  _mv.set(0, 0, 0);
  if (keys['KeyW'] || keys['ArrowUp'])    _mv.add(_fwd);
  if (keys['KeyS'] || keys['ArrowDown'])  _mv.sub(_fwd);
  if (keys['KeyA'] || keys['ArrowLeft'])  _mv.sub(_rgt);
  if (keys['KeyD'] || keys['ArrowRight']) _mv.add(_rgt);
  isMoving = _mv.lengthSq() > 0;
  if (isMoving) {
    _mv.normalize().multiplyScalar(spd * dt);
    const nx = player.position.x + _mv.x, nz = player.position.z + _mv.z;
    if (!collidesWithBuilding(nx, nz)) {
      player.position.x = nx; player.position.z = nz;
    }
    player.rotation.y = lerpAngle(player.rotation.y, Math.atan2(_mv.x, _mv.z), 12 * dt);
    walkPhase += dt * (spd === RUN_SPEED ? 12 : 8);
  } else {
    walkPhase *= 0.88;
  }
  animateCharacter();
  player.position.y = 0;
}

function animateCharacter() {
  const swing = isMoving ? Math.sin(walkPhase) * 0.28 : 0;
  player.children.forEach(c => {
    if (c.userData.isArm) c.rotation.x =  c.userData.side * swing * 0.85;
    if (c.userData.isLeg) c.rotation.x = -c.userData.side * swing;
  });
}

function collidesWithBuilding(x, z) {
  for (const b of buildingAABB) {
    if (Math.abs(x - b.x) < b.hw + 0.5 && Math.abs(z - b.z) < b.hd + 0.5) return true;
  }
  return false;
}

// ─── CAMERA ───────────────────────────────────────────────────────────────────
function updateCamera(dt) {
  _camTgt.set(player.position.x, player.position.y + 1.2, player.position.z);
  _sph.set(camDistance, Math.PI / 2 - camPitch, camYaw);
  _off.setFromSpherical(_sph);
  _want.copy(_camTgt).add(_off);
  camera.position.lerp(_want, 10 * dt);
  camera.lookAt(_camTgt);

  // Move shadow camera to follow player so shadows are always near-player
  sunLight.shadow.camera.position.copy(sunLight.position).add(player.position);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();
}

// ─── PARTICLES UPDATE ─────────────────────────────────────────────────────────
function updateParticles(dt) {
  if (sakuraParticles.visible) {
    const pos = sakuraParticles.geometry.attributes.position.array;
    const vel = sakuraParticles.userData.velocities;
    const cnt = sakuraParticles.userData.count;
    const px = player.position.x, pz = player.position.z;
    for (let i = 0; i < cnt; i++) {
      pos[i*3]   += vel[i].x * dt * 2;
      pos[i*3+1] += vel[i].y * dt * 2;
      pos[i*3+2] += vel[i].z * dt * 2;
      if (pos[i*3+1] < 0) {
        pos[i*3]   = px + (Math.random()-0.5)*80;
        pos[i*3+1] = 22 + Math.random()*10;
        pos[i*3+2] = pz + (Math.random()-0.5)*80;
      }
    }
    sakuraParticles.geometry.attributes.position.needsUpdate = true;
  }
  if (rainParticles.visible) {
    const pos = rainParticles.geometry.attributes.position.array;
    const cnt = pos.length / 3;
    const px = player.position.x, pz = player.position.z;
    for (let i = 0; i < cnt; i++) {
      pos[i*3]   += 1.8 * dt;
      pos[i*3+1] -= 14  * dt;
      if (pos[i*3+1] < 0) {
        pos[i*3]   = px + (Math.random()-0.5)*60;
        pos[i*3+1] = 24 + Math.random()*8;
        pos[i*3+2] = pz + (Math.random()-0.5)*60;
      }
    }
    rainParticles.geometry.attributes.position.needsUpdate = true;
  }
  cloudSprites.forEach(s => {
    s.position.x += s.userData.speed * dt * 0.4;
    if (s.position.x > CITY_HALF + 20) s.position.x = -CITY_HALF - 20;
  });
}

// ─── MINIMAP ──────────────────────────────────────────────────────────────────
function drawMinimap() {
  if (!minimapCtx) return;
  const W = 140, cx = 70, cy = 70, sc = 1.15;
  minimapCtx.clearRect(0, 0, W, W);
  minimapCtx.save();
  minimapCtx.beginPath(); minimapCtx.arc(cx, cy, 68, 0, Math.PI * 2); minimapCtx.clip();
  minimapCtx.fillStyle = '#12122a'; minimapCtx.fillRect(0, 0, W, W);
  // Roads
  minimapCtx.strokeStyle = '#334'; minimapCtx.lineWidth = 3;
  for (let x = -CITY_HALF; x <= CITY_HALF; x += BLOCK) {
    const px = cx + (x - player.position.x) * sc;
    minimapCtx.beginPath(); minimapCtx.moveTo(px, 0); minimapCtx.lineTo(px, W); minimapCtx.stroke();
  }
  for (let z = -CITY_HALF; z <= CITY_HALF; z += BLOCK) {
    const pz = cy + (z - player.position.z) * sc;
    minimapCtx.beginPath(); minimapCtx.moveTo(0, pz); minimapCtx.lineTo(W, pz); minimapCtx.stroke();
  }
  // Buildings
  minimapCtx.fillStyle = '#556';
  buildingAABB.forEach(b => {
    minimapCtx.fillRect(
      cx + (b.x - b.hw - player.position.x) * sc,
      cy + (b.z - b.hd - player.position.z) * sc,
      b.hw * 2 * sc, b.hd * 2 * sc
    );
  });
  // Player
  minimapCtx.fillStyle = '#ff6eb4';
  minimapCtx.beginPath(); minimapCtx.arc(cx, cy, 4, 0, Math.PI * 2); minimapCtx.fill();
  minimapCtx.save();
  minimapCtx.translate(cx, cy); minimapCtx.rotate(-player.rotation.y);
  minimapCtx.fillStyle = '#fff';
  minimapCtx.beginPath(); minimapCtx.moveTo(0,-8); minimapCtx.lineTo(-3,0); minimapCtx.lineTo(3,0);
  minimapCtx.closePath(); minimapCtx.fill();
  minimapCtx.restore();
  minimapCtx.restore();
}

// ─── GAME TIME ────────────────────────────────────────────────────────────────
function updateGameTime(dt) {
  gameTime += dt * 0.5;
  if (gameTime >= 24) gameTime -= 24;
  const h = Math.floor(gameTime), m = Math.floor((gameTime - h) * 60);
  document.getElementById('game-time').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function onMouseMove(e) {
  if (!mouseDown) return;
  camYaw   -= (e.clientX - lastMouse.x) * 0.005;
  camPitch  = Math.max(0.1, Math.min(1.2, camPitch + (e.clientY - lastMouse.y) * 0.005));
  lastMouse = { x: e.clientX, y: e.clientY };
}
function onWheel(e) { camDistance = Math.max(3, Math.min(22, camDistance + e.deltaY * 0.02)); }
function onTouchStart(e) {
  if (e.touches.length !== 1) return;
  mouseDown = true; lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onTouchMove(e) {
  if (e.touches.length !== 1 || !mouseDown) return;
  camYaw   -= (e.touches[0].clientX - lastMouse.x) * 0.005;
  camPitch  = Math.max(0.1, Math.min(1.2, camPitch + (e.touches[0].clientY - lastMouse.y) * 0.005));
  lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * Math.min(t, 1);
}
function darken(hex) {
  return (((hex >> 16 & 0xff) * 0.72 | 0) << 16) |
         (((hex >>  8 & 0xff) * 0.72 | 0) <<  8) |
          ((hex        & 0xff) * 0.72 | 0);
}
function shuffled(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i+1) | 0; [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
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

// ─── SPLASH ───────────────────────────────────────────────────────────────────
function makeSplashPetals() {
  const bg = document.getElementById('petals-bg');
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.style.cssText = `left:${Math.random()*100}%;top:-20px;animation-duration:${4+Math.random()*6}s;animation-delay:${Math.random()*5}s;width:${6+Math.random()*9}px;height:${6+Math.random()*9}px;opacity:${0.4+Math.random()*0.6};transform:rotate(${Math.random()*360}deg)`;
    bg.appendChild(p);
  }
}

document.getElementById('start-btn').addEventListener('click', () => {
  const ov = document.getElementById('overlay');
  ov.classList.add('hidden');
  setTimeout(() => ov.remove(), 1600);
});

makeSplashPetals();
init();
setWeather('clear');
