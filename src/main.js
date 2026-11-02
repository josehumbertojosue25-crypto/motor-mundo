import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ============================================================
   MOTOR MUNDO v0.4
   Novo: semáforos · candeeiros e janelas acesas à noite · parque
         · parque de estacionamento · loja · gasolina/energia/moedas
         · minimapa · som do motor · guardar progresso
   v0.4: tela inicial · pausa · configuração (gráficos, áudio, música) · guarda a posição
   v0.3: céu realista com nuvens · empregos com níveis · casas (comprar, melhorar, dormir)
   ============================================================ */

const CHUNK = 100;
let RADIUS = 2;
const ROAD = 12;
const OFF = ROAD / 2 + 2;       // distância da linha central da estrada ao primeiro edifício
const DAY_SECONDS = 300;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (x, z) => ((x * 73856093) ^ (z * 19349663)) | 0;

/* ---------- ESTADO GUARDADO ---------- */
const SAVE_KEY = 'motormundo.v2';
const state = { money: 25, fuel: 100, energy: 100, color: 0xc0392b, jobXp: { builder: 0, guard: 0, sales: 0 }, houses: {} };
try { Object.assign(state, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { /* ignora */ }
function save() {
  try {
    state.pos = { x: player.pos.x, z: player.pos.z, yaw: player.yaw, cx: car.pos.x, cz: car.pos.z, ch: car.heading, drv: player.driving ? 1 : 0 };
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) { /* ignora */ }
}
addEventListener('pagehide', save);
addEventListener('visibilitychange', () => { if (document.hidden) save(); });

/* ---------- NÚCLEO ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x8cc0ee, 60, 330);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 420);
camera.rotation.order = 'YXZ';
const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1);
const sun = new THREE.DirectionalLight(0xfff2d6, 1);
scene.add(hemi, sun, sun.target);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* ---------- INTERFACE (criada aqui para só precisares de trocar este ficheiro) ---------- */
const css = document.createElement('style');
css.textContent = `
#hud{white-space:pre;font-size:13px;line-height:1.45}
#toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#000b;color:#fff;padding:8px 14px;border-radius:10px;font-size:14px;max-width:70vw;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s;z-index:5}
#minimap{position:fixed;top:8px;left:50%;transform:translateX(-50%);width:120px;height:120px;border-radius:8px;border:1px solid #fff4;pointer-events:none}
.abtn{position:fixed;right:30px;width:76px;height:76px;border-radius:50%;border:2px solid #fff6;background:#0007;color:#fff;font-size:14px}
#btnShop{bottom:268px;display:none;background:#b8860b99}
#shop{position:fixed;inset:0;margin:auto;width:min(86vw,420px);height:fit-content;max-height:86vh;overflow:auto;background:#10151ce8;border:1px solid #fff3;border-radius:14px;padding:14px 16px;display:none;z-index:10;color:#fff}
#shop h2{margin:0 0 4px;font-size:20px} #shop p{margin:0 0 10px;opacity:.85}
#shop button{display:block;width:100%;margin:6px 0;padding:11px;border-radius:9px;border:1px solid #fff3;background:#1e2a3a;color:#fff;font-size:15px;text-align:left}
#shop .row{display:flex;gap:6px;flex-wrap:wrap} #shop .row button{width:auto;flex:1;text-align:center;margin:3px 0}
#shop .close{background:#5a2020;text-align:center}
`;
document.head.appendChild(css);

const hud = document.getElementById('hud');
const btnE = document.getElementById('btnE');
const toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl);
const btnShop = document.createElement('button'); btnShop.id = 'btnShop'; btnShop.className = 'abtn'; btnShop.textContent = 'Loja'; document.body.appendChild(btnShop);
const shopEl = document.createElement('div'); shopEl.id = 'shop'; document.body.appendChild(shopEl);
const mm = document.createElement('canvas'); mm.id = 'minimap'; mm.width = mm.height = 120; document.body.appendChild(mm);
const mctx = mm.getContext('2d');

let toastTimer = 0;
function toast(msg, ms = 2800) {
  toastEl.textContent = msg; toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = 0; }, ms);
}

/* ---------- ENTRADA ---------- */
function makeStick(el) {
  const s = { x: 0, y: 0 };
  const knob = el.firstElementChild;
  const R = 45;
  let id = null, cx = 0, cy = 0;
  const move = (e) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    s.x = dx / R; s.y = dy / R;
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  };
  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId; el.setPointerCapture(id);
    const b = el.getBoundingClientRect();
    cx = b.left + b.width / 2; cy = b.top + b.height / 2;
    move(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; s.x = s.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return s;
}
const moveStick = makeStick(document.getElementById('moveStick'));
const lookStick = makeStick(document.getElementById('lookStick'));

const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (menuMode) return;
  if (e.code === 'KeyE') toggleCar();
  if (e.code === 'KeyF') { if (shopOpen) closeShop(); else if (nearShop) openShop(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
let mouseLook = null;
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') mouseLook = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { mouseLook = null; });
addEventListener('pointermove', (e) => {
  if (!mouseLook || e.pointerType !== 'mouse') return;
  player.yaw -= (e.clientX - mouseLook.x) * 0.004;
  player.pitch = clamp(player.pitch - (e.clientY - mouseLook.y) * 0.004, -1.2, 1.2);
  mouseLook = { x: e.clientX, y: e.clientY };
});
btnE.addEventListener('click', toggleCar);
btnShop.addEventListener('click', () => (shopOpen ? closeShop() : openShop()));

function readMove() {
  if (shopOpen) return { x: 0, y: 0 };
  let x = moveStick.x, y = moveStick.y;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y -= 1;
  if (keys.KeyS || keys.ArrowDown) y += 1;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}

/* ---------- SOM DO MOTOR ---------- */
let audio = null;
function initAudio() {
  try {
    if (audio) { if (audio.ac.state === 'suspended') audio.ac.resume(); return; }
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ac.createOscillator(); osc.type = 'sawtooth';
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = ac.createGain(); g.gain.value = 0;
    osc.connect(lp); lp.connect(g); g.connect(ac.destination); osc.start();
    audio = { ac, osc, g };
  } catch (e) { /* sem áudio */ }
}
addEventListener('pointerdown', initAudio);
addEventListener('keydown', initAudio);
function updateAudio() {
  if (!audio) return;
  const t = audio.ac.currentTime;
  const on = player.driving && state.fuel > 0 && !menuMode;
  audio.g.gain.setTargetAtTime((on ? 0.04 + Math.min(Math.abs(car.speed) / 42, 1) * 0.06 : 0) * sfxVol(), t, 0.12);
  audio.osc.frequency.setTargetAtTime(46 + Math.abs(car.speed) * 3.4, t, 0.12);
}

/* ---------- TEXTURAS ---------- */
function makeWindowTextures() {
  const S = 256, N = 4, cell = S / N;
  const a = document.createElement('canvas'), e = document.createElement('canvas');
  a.width = a.height = e.width = e.height = S;
  const A = a.getContext('2d'), E = e.getContext('2d');
  A.fillStyle = '#fff'; A.fillRect(0, 0, S, S);
  E.fillStyle = '#000'; E.fillRect(0, 0, S, S);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = i * cell + 14, y = j * cell + 12;
    A.fillStyle = '#34475a'; A.fillRect(x, y, 36, 40);
    if (Math.random() < 0.55) { E.fillStyle = '#ffd88a'; E.fillRect(x, y, 36, 40); }
  }
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
    return t;
  };
  return [mk(a), mk(e)];
}
function labelTexture(text, bg, fg, w, h, font) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const [winMap, winEmit] = makeWindowTextures();

/* ---------- MATERIAIS PARTILHADOS ---------- */
const L = (c) => new THREE.MeshLambertMaterial({ color: c });
const grassMat = L(0x4a7c3a), parkGrassMat = L(0x63a84c), roadMat = L(0x2b2b2e);
const lineMat = L(0xd8c24a), whiteMat = L(0xe6e6e6), sideMat = L(0x9b9a94);
const gravelMat = L(0xcdbf9a), lotMat = L(0x3a3a3e);
const trunkMat = L(0x5b3a1e), crownMat = L(0x2f6b2f), crownMat2 = L(0x3c8a3c);
const poleMat = L(0x555a60), darkMat = L(0x1b1d20), stoneMat = L(0x9a9a9a), waterMat = L(0x3a86c8), benchMat = L(0x7a5230);
const flowerMats = [0xe0457b, 0xf2c94c, 0xffffff].map(L);
const shopWallMat = L(0xe8d8b0), roofMat = L(0x6b4a3a), doorMat = L(0x3b2a1e), awningMat = L(0xc0392b);
const parkedMats = [0x2e6fd8, 0xe8e8e8, 0x2a2a2a, 0xd8a020, 0x3a8a4a, 0x8a3a9a, 0x9aa0a8].map(L);

const buildingMats = [0xb9b2a5, 0x9aa7b5, 0xc7a890, 0x8e9a8a, 0xd1d1cc, 0xa38b7a].map((c) =>
  new THREE.MeshLambertMaterial({ color: c, map: winMap, emissive: 0xffffff, emissiveMap: winEmit, emissiveIntensity: 0 }));

const glassDay = new THREE.Color(0x7fb2d6), glassNight = new THREE.Color(0xffe3a8);
const glassMat = new THREE.MeshBasicMaterial({ color: glassDay.clone() });
const shopSignMat = new THREE.MeshBasicMaterial({ map: labelTexture('LOJA', '#b8312a', '#ffffff', 256, 96, 'bold 64px sans-serif') });
const pSignMat = new THREE.MeshBasicMaterial({ map: labelTexture('P', '#1d4fa8', '#ffffff', 128, 128, 'bold 90px sans-serif') });
const jobSignMat = new THREE.MeshBasicMaterial({ map: labelTexture('EMPREGOS', '#1f6f43', '#ffffff', 256, 96, 'bold 46px sans-serif') });
const saleSignMat = new THREE.MeshBasicMaterial({ map: labelTexture('À VENDA', '#b8312a', '#ffffff', 256, 96, 'bold 54px sans-serif') });
const homeSignMat = new THREE.MeshBasicMaterial({ map: labelTexture('MINHA CASA', '#2a5a8a', '#ffffff', 256, 96, 'bold 40px sans-serif') });
const jobWallMat = L(0xd6e4d3), jobRoofMat = L(0x2f5a3c), crateMat = L(0xb98a4a), steelMat = L(0xd9a21b), fenceMat = L(0x8a6a44);
const houseRoofMats = [L(0x8a3b2a), L(0x4a4f58), L(0x3a2f2a)];
const houseWallCache = new Map();
function houseWallMat(c) { let m = houseWallCache.get(c); if (!m) { m = L(c); houseWallCache.set(c, m); } return m; }
const lampOff = new THREE.Color(0x777777), lampOn = new THREE.Color(0xffe2a0);
const lampHeadMat = new THREE.MeshBasicMaterial({ color: lampOff.clone() });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc870, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

// semáforos: um jogo de 3 lâmpadas por eixo (ns = norte-sul, ew = este-oeste)
const SIG_ON = { r: 0xff2a2a, y: 0xffc21a, g: 0x2aff5a };
const SIG_OFF = { r: 0x330808, y: 0x332a05, g: 0x06330f };
const sigMat = {
  ns: { r: new THREE.MeshBasicMaterial(), y: new THREE.MeshBasicMaterial(), g: new THREE.MeshBasicMaterial() },
  ew: { r: new THREE.MeshBasicMaterial(), y: new THREE.MeshBasicMaterial(), g: new THREE.MeshBasicMaterial() },
};
let sigT = 0;
function sigState(axis) {
  const t = sigT % 24;
  if (axis === 'ns') return t < 10 ? 'g' : t < 12 ? 'y' : 'r';
  return t < 12 ? 'r' : t < 22 ? 'g' : 'y';
}
function updateSignals() {
  for (const axis of ['ns', 'ew']) {
    const st = sigState(axis);
    for (const c of ['r', 'y', 'g']) sigMat[axis][c].color.setHex(st === c ? SIG_ON[c] : SIG_OFF[c]);
  }
}

/* ---------- CONSTRUTOR DE GEOMETRIA FUNDIDA (poucos draw calls) ---------- */
class Builder {
  constructor() { this.map = new Map(); }
  add(mat, geo) { let a = this.map.get(mat); if (!a) { a = []; this.map.set(mat, a); } a.push(geo); }
  box(mat, w, h, d, x, y, z, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); this.add(mat, g); }
  flat(mat, w, d, x, y, z) { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, y, z); this.add(mat, g); }
  plane(mat, w, h, x, y, z, ry) { const g = new THREE.PlaneGeometry(w, h); g.rotateY(ry); g.translate(x, y, z); this.add(mat, g); }
  cyl(mat, rt, rb, h, x, y, z, seg = 8) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); this.add(mat, g); }
  cone(mat, r, h, x, y, z, seg = 7) { const g = new THREE.ConeGeometry(r, h, seg); g.translate(x, y, z); this.add(mat, g); }
  disc(mat, r, x, y, z) { const g = new THREE.CircleGeometry(r, 12); g.rotateX(-Math.PI / 2); g.translate(x, y, z); this.add(mat, g); }
  wbox(mat, w, h, d, x, z) { // edifício com janelas (UV em blocos de 12 m)
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const sc = [[d, h], [d, h], null, null, [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      if (!sc[f]) uv.setXY(k, 0.03, 0.03);
      else uv.setXY(k, uv.getX(k) * sc[f][0] / 12, uv.getY(k) * sc[f][1] / 12);
    }
    g.translate(x, h / 2, z); this.add(mat, g);
  }
  finish(group) {
    for (const [mat, geos] of this.map) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) { const m = new THREE.Mesh(merged, mat); m.castShadow = m.receiveShadow = true; group.add(m); }
    }
  }
}

/* ---------- OBJETOS DO MUNDO ---------- */
function tree(b, x, z) {
  b.cyl(trunkMat, 0.25, 0.35, 2.4, x, 1.2, z, 6);
  b.cone(crownMat, 1.9, 4.2, x, 4.2, z);
  b.cone(crownMat2, 1.4, 3.2, x, 6.0, z);
}
function lamp(b, x, z, dx, dz) { // poste com braço virado para a estrada
  b.cyl(poleMat, 0.09, 0.12, 6, x, 3, z, 6);
  b.box(poleMat, Math.abs(dx) ? 1 : 0.1, 0.1, Math.abs(dz) ? 1 : 0.1, x + dx * 0.5, 6, z + dz * 0.5);
  b.box(lampHeadMat, 0.7, 0.15, 0.7, x + dx, 5.95, z + dz);
  b.disc(glowMat, 7, x + dx * 2.8, 0.12, z + dz * 2.8);
}
function parkLamp(b, x, z) {
  b.cyl(poleMat, 0.08, 0.1, 3.6, x, 1.8, z, 6);
  b.box(lampHeadMat, 0.55, 0.55, 0.55, x, 3.8, z);
  b.disc(glowMat, 5, x, 0.12, z);
}
function signalPost(b, boxes, px, pz, fx, fz, axis) {
  b.cyl(poleMat, 0.1, 0.12, 5.2, px, 2.6, pz, 6);
  b.box(darkMat, 0.7, 2.0, 0.7, px, 5.4, pz);
  const lw = fx ? 0.12 : 0.45, ld = fz ? 0.12 : 0.45;
  const lx = px + fx * 0.38, lz = pz + fz * 0.38;
  b.box(sigMat[axis].r, lw, 0.45, ld, lx, 6.05, lz);
  b.box(sigMat[axis].y, lw, 0.45, ld, lx, 5.4, lz);
  b.box(sigMat[axis].g, lw, 0.45, ld, lx, 4.75, lz);
  boxes.push({ minx: px - 0.3, maxx: px + 0.3, minz: pz - 0.3, maxz: pz + 0.3 });
}
function parkedCar(b, boxes, x, z, r) {
  const m = parkedMats[Math.floor(r() * parkedMats.length)];
  b.box(m, 2, 0.7, 4.2, x, 0.75, z);
  b.box(darkMat, 1.8, 0.62, 2.1, x, 1.4, z + 0.2);
  boxes.push({ minx: x - 1, maxx: x + 1, minz: z - 2.1, maxz: z + 2.1 });
}

function buildCity(b, boxes, r, x0, x1, z0, z1) {
  const placed = [];
  for (let i = 0; i < 3; i++) {
    const w = 8 + r() * 10, d = 8 + r() * 10, h = 6 + r() * r() * 44;
    if (x1 - x0 < w || z1 - z0 < d) continue;
    const x = x0 + w / 2 + r() * (x1 - x0 - w);
    const z = z0 + d / 2 + r() * (z1 - z0 - d);
    const o = { minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2 };
    if (placed.some((p) => o.minx < p.maxx + 2 && o.maxx > p.minx - 2 && o.minz < p.maxz + 2 && o.maxz > p.minz - 2)) continue;
    placed.push(o);
    b.wbox(buildingMats[Math.floor(r() * buildingMats.length)], w, h, d, x, z);
  }
  for (let i = 0; i < 3; i++) {
    const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
    if (placed.some((p) => x > p.minx - 2.5 && x < p.maxx + 2.5 && z > p.minz - 2.5 && z < p.maxz + 2.5)) continue;
    tree(b, x, z);
  }
  boxes.push(...placed);
}

function buildPark(b, boxes, r, x0, x1, z0, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  b.flat(parkGrassMat, x1 - x0, z1 - z0, cx, 0.03, cz);
  b.flat(gravelMat, x1 - x0, 2.4, cx, 0.05, cz);
  b.flat(gravelMat, 2.4, z1 - z0, cx, 0.051, cz);
  // fonte
  b.cyl(stoneMat, 3.4, 3.6, 0.7, cx, 0.35, cz, 16);
  b.cyl(waterMat, 3.0, 3.0, 0.72, cx, 0.36, cz, 16);
  b.cyl(stoneMat, 0.45, 0.6, 2.2, cx, 1.1, cz, 8);
  b.cyl(stoneMat, 1.4, 0.5, 0.35, cx, 2.3, cz, 10);
  boxes.push({ minx: cx - 3.6, maxx: cx + 3.6, minz: cz - 3.6, maxz: cz + 3.6 });
  // bancos
  for (const [bx, bz, ry] of [[cx + 8, cz + 2.2, 0], [cx - 8, cz - 2.2, 0], [cx + 2.2, cz + 8, Math.PI / 2], [cx - 2.2, cz - 8, Math.PI / 2]]) {
    b.box(benchMat, 1.9, 0.12, 0.55, bx, 0.5, bz, ry);
    b.box(benchMat, 1.9, 0.5, 0.1, bx - 0.25 * Math.sin(ry), 0.85, bz - 0.25 * Math.cos(ry), ry);
    b.box(darkMat, 0.12, 0.5, 0.12, bx, 0.25, bz);
  }
  // árvores e flores
  for (let i = 0; i < 12; i++) {
    const x = x0 + 3 + r() * (x1 - x0 - 6), z = z0 + 3 + r() * (z1 - z0 - 6);
    if (Math.abs(x - cx) < 2.8 || Math.abs(z - cz) < 2.8 || Math.hypot(x - cx, z - cz) < 7) continue;
    tree(b, x, z);
  }
  for (let i = 0; i < 26; i++) {
    const x = x0 + 2 + r() * (x1 - x0 - 4), z = z0 + 2 + r() * (z1 - z0 - 4);
    if (Math.abs(x - cx) < 2 || Math.abs(z - cz) < 2 || Math.hypot(x - cx, z - cz) < 5.5) continue;
    b.box(flowerMats[Math.floor(r() * 3)], 0.35, 0.35, 0.35, x, 0.18, z);
  }
  for (const [lx, lz] of [[cx + 5, cz + 1.9], [cx - 5, cz - 1.9], [cx + 1.9, cz - 5], [cx - 1.9, cz + 5]]) parkLamp(b, lx, lz);
}

function buildLot(b, boxes, lots, parkedModels, r, qx, x0, x1, z0, z1) {
  const lx0 = x0 + 1.5, lx1 = x1 - 1.5, lz0 = z0 + 1.5, lz1 = z1 - 1.5;
  b.flat(lotMat, lx1 - lx0, lz1 - lz0, (lx0 + lx1) / 2, 0.05, (lz0 + lz1) / 2);
  const n = Math.floor((lx1 - lx0 - 2) / 3.2);
  const sx = (lx0 + lx1) / 2 - (n * 3.2) / 2;
  const slots = [];
  for (const rz of [lz0 + 2.9, lz1 - 2.9]) {
    for (let i = 0; i <= n; i++) b.box(whiteMat, 0.12, 0.02, 5.4, sx + i * 3.2, 0.07, rz);
    for (let i = 0; i < n; i++) {
      const x = sx + i * 3.2 + 1.6;
      const occ = r() < 0.5;
      if (occ) {
        parkedModels.push({ x, z: rz });
        boxes.push({ minx: x - 1, maxx: x + 1, minz: rz - 2.1, maxz: rz + 2.1 });
      }
      slots.push({ x, z: rz, occ, last: -999 });
    }
  }
  // sinal "P" virado para a estrada
  const sxp = qx === 0 ? lx1 - 0.6 : lx0 + 0.6, szp = (lz0 + lz1) / 2;
  b.cyl(poleMat, 0.08, 0.1, 4, sxp, 2, szp, 6);
  b.plane(pSignMat, 2, 2, sxp + (qx === 0 ? 0.1 : -0.1), 4.2, szp, qx === 0 ? Math.PI / 2 : -Math.PI / 2);
  lots.push({ minx: lx0, maxx: lx1, minz: lz0, maxz: lz1, slots });
}

function buildShop(b, boxes, shops, qx, x0, x1, z0, z1) {
  const w = 14, d = 22, h = 8;
  const fx = qx === 0 ? 1 : -1;
  const xc = qx === 0 ? x1 - w / 2 - 0.5 : x0 + w / 2 + 0.5;
  const zc = (z0 + z1) / 2;
  const ry = fx > 0 ? Math.PI / 2 : -Math.PI / 2;
  const fxp = xc + fx * (w / 2 + 0.05);
  b.box(shopWallMat, w, h, d, xc, h / 2, zc);
  b.box(roofMat, w + 0.6, 0.4, d + 0.6, xc, h + 0.2, zc);
  b.plane(doorMat, 3, 3.4, fxp, 1.7, zc, ry);
  b.plane(glassMat, 6, 3, fxp, 2.1, zc - 6.2, ry);
  b.plane(glassMat, 6, 3, fxp, 2.1, zc + 6.2, ry);
  b.plane(shopSignMat, 8, 2.4, fxp, 6.0, zc, ry);
  b.box(awningMat, 2.4, 0.25, 12, xc + fx * (w / 2 + 1.2), 4.2, zc);
  boxes.push({ minx: xc - w / 2, maxx: xc + w / 2, minz: zc - d / 2, maxz: zc + d / 2 });
  shops.push({ x: xc + fx * (w / 2 + 2.6), z: zc });
}

/* ---------- CENTRO DE EMPREGOS E CASAS ---------- */
function buildJobs(b, boxes, jobs, qx, x0, x1, z0, z1) {
  const w = 14, d = 18, h = 7, fx = qx === 0 ? 1 : -1;
  const xc = qx === 0 ? x1 - w / 2 - 0.5 : x0 + w / 2 + 0.5;
  const zc = (z0 + z1) / 2 - 9;
  const ry = fx > 0 ? Math.PI / 2 : -Math.PI / 2, fxp = xc + fx * (w / 2 + 0.05);
  b.box(jobWallMat, w, h, d, xc, h / 2, zc);
  b.box(jobRoofMat, w + 0.6, 0.4, d + 0.6, xc, h + 0.2, zc);
  b.plane(doorMat, 3, 3.4, fxp, 1.7, zc, ry);
  b.plane(glassMat, 5, 2.8, fxp, 2.1, zc - 5.5, ry);
  b.plane(glassMat, 5, 2.8, fxp, 2.1, zc + 5.5, ry);
  b.plane(jobSignMat, 8, 2.4, fxp, 5.6, zc, ry);
  boxes.push({ minx: xc - w / 2, maxx: xc + w / 2, minz: zc - d / 2, maxz: zc + d / 2 });
  jobs.push({ x: xc + fx * (w / 2 + 2.6), z: zc });
  // estaleiro: caixotes e grua
  const yx = (x0 + x1) / 2, yz = zc + d / 2 + 11;
  b.box(crateMat, 2.4, 2.4, 2.4, yx - 8, 1.2, yz - 3);
  b.box(crateMat, 2.4, 2.4, 2.4, yx - 4.8, 1.2, yz - 3.4);
  b.box(crateMat, 2, 2, 2, yx - 6.4, 3.4, yz - 3.2);
  boxes.push({ minx: yx - 9.3, maxx: yx - 3.6, minz: yz - 4.7, maxz: yz - 1.8 });
  b.box(steelMat, 0.9, 16, 0.9, yx + 8, 8, yz);
  b.box(steelMat, 16, 0.7, 0.7, yx + 3, 16.3, yz);
  b.box(steelMat, 2, 1.4, 1.4, yx + 11, 15.8, yz);
  b.box(darkMat, 1.6, 1.6, 1.6, yx + 8, 15.2, yz + 1.2);
  boxes.push({ minx: yx + 7.5, maxx: yx + 8.5, minz: yz - 0.5, maxz: yz + 0.5 });
}

function buildPlot(b, boxes, homes, cx, cz, qx, qz, x0, x1, z0, z1) {
  const key = `${cx},${cz},${qx},${qz}`;
  const own = state.houses[key];
  const level = own ? own.level : 0;
  const fx = qx === 0 ? 1 : -1;
  const ry = fx > 0 ? Math.PI / 2 : -Math.PI / 2;
  const zc = (z0 + z1) / 2;
  const xf = qx === 0 ? x1 - 9 : x0 + 9;            // fachada da casa
  b.flat(parkGrassMat, x1 - x0, z1 - z0, (x0 + x1) / 2, 0.03, zc);
  b.flat(gravelMat, 9, 2.2, xf + fx * 4.5, 0.05, zc);
  homes.push({ key, cx, cz, x: xf + fx * 5, z: zc });
  if (level === 0) {
    const sx = xf + fx * 7.5;
    b.cyl(poleMat, 0.07, 0.09, 2.6, sx, 1.3, zc + 3, 6);
    b.plane(saleSignMat, 3.2, 1.2, sx + fx * 0.1, 2.3, zc + 3, ry);
    for (const [px, pz] of [[x0 + 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z0 + 1], [x1 - 1, z1 - 1]]) b.box(fenceMat, 0.3, 1, 0.3, px, 0.5, pz);
    return;
  }
  const [w, d] = [[10, 8], [12, 11], [14, 15]][level - 1];
  const h = [4, 5.2, 7.2][level - 1];
  const rh = [2.8, 3, 2.4][level - 1];
  const xc = xf - fx * w / 2;
  const wall = houseWallMat(own.color || 0xd9c7a0);
  b.box(wall, w, h, d, xc, h / 2, zc);
  boxes.push({ minx: xc - w / 2, maxx: xc + w / 2, minz: zc - d / 2, maxz: zc + d / 2 });
  // telhado em pirâmide
  const rg = new THREE.ConeGeometry(1, rh, 4);
  rg.rotateY(Math.PI / 4); rg.scale(w * 0.792, 1, d * 0.792); rg.translate(xc, h + rh / 2, zc);
  b.add(houseRoofMats[level - 1], rg);
  if (level < 3) b.box(stoneMat, 0.8, 2, 0.8, xc - fx * 2, h + 1.6, zc + d * 0.2);
  // porta, janelas e placa
  b.plane(doorMat, 1.6, 2.6, xf + fx * 0.05, 1.3, zc, ry);
  b.plane(homeSignMat, 2.2, 0.8, xf + fx * 0.06, h > 5 ? 3.5 : 3.2, zc, ry);
  for (const o of [-d * 0.28, d * 0.28]) {
    b.plane(glassMat, 1.8, 1.4, xf + fx * 0.05, 2.1, zc + o, ry);
    if (level === 3) b.plane(glassMat, 1.8, 1.4, xf + fx * 0.05, 5.4, zc + o, ry);
  }
  b.plane(glassMat, 1.8, 1.4, xc, 2.1, zc + d / 2 + 0.05, 0);
  b.plane(glassMat, 1.8, 1.4, xc, 2.1, zc - d / 2 - 0.05, Math.PI);
  if (level === 3) {
    for (const o of [-2.2, 2.2]) b.cyl(stoneMat, 0.25, 0.25, 4.6, xf + fx * 0.9, 2.3, zc + o, 8);
    b.box(stoneMat, 2.4, 0.3, 6, xf + fx * 1.2, 4.7, zc);
    // piscina
    b.flat(stoneMat, 7, 5, xc, 0.06, zc - d / 2 - 4);
    b.flat(waterMat, 6, 4, xc, 0.09, zc - d / 2 - 4);
  }
  if (level >= 2) { // garagem
    const gz = zc + d / 2 + 2.5, gw = 7;
    b.box(wall, gw, 3.2, 5, xc, 1.6, gz);
    b.box(roofMat, gw + 0.4, 0.3, 5.4, xc, 3.35, gz);
    b.plane(doorMat, 4, 2.6, xc + fx * (gw / 2 + 0.05), 1.3, gz, ry);
    boxes.push({ minx: xc - gw / 2, maxx: xc + gw / 2, minz: gz - 2.5, maxz: gz + 2.5 });
  }
  tree(b, xf + fx * 11, zc - 9); tree(b, xf + fx * 11, zc + 9);
  if (level === 3) { tree(b, xf + fx * 11, zc); parkLamp(b, xf + fx * 6, zc - 4); parkLamp(b, xf + fx * 6, zc + 4); }
}

/* ---------- CHUNKS ---------- */
const chunks = new Map(); // blocos carregados
let parkedCarModel = null;

function addParkedModels(group, positions) {
  if (!parkedCarModel || !positions) return;

  for (const pos of positions) {
    const car = parkedCarModel.clone(true);

    // Geometrias independentes: podem ser libertadas ao remover o bloco.
    car.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry = obj.geometry.clone();
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const initialBounds = new THREE.Box3().setFromObject(car);
    const initialSize = initialBounds.getSize(new THREE.Vector3());

    // Coloca o maior comprimento do veículo na direção do estacionamento.
    if (initialSize.x > initialSize.z) {
      car.rotation.y = Math.PI / 2;
    }

    const scale = Math.min(
      4.2 / Math.max(initialSize.x, initialSize.z, 0.001),
      1.8 / Math.max(initialSize.y, 0.001)
    );

    car.scale.setScalar(scale);

    const bounds = new THREE.Box3().setFromObject(car);
    const center = bounds.getCenter(new THREE.Vector3());

    car.position.set(
      pos.x - center.x,
      -bounds.min.y + 0.06,
      pos.z - center.z
    );

    group.add(car);
  }
}

// Carrega o modelo uma única vez e atualiza os blocos já existentes.
new GLTFLoader().load(
  '/models/covered_car.glb',
  (gltf) => {
    parkedCarModel = gltf.scene;
    for (const chunk of chunks.values()) {
      addParkedModels(chunk.group, chunk.parkedModels);
    }
    console.log('Modelo dos carros estacionados carregado.');
  },
  undefined,
  (error) => console.error('Erro ao carregar covered_car.glb:', error)
);

function quadType(cx, cz, qx, qz, r) {
  if (cx === 0 && cz === 0) {
    if (qx === 0 && qz === 1) return 'shop';
    if (qx === 1 && qz === 1) return 'lot';
    if (qx === 1 && qz === 0) return 'park';
    if (qx === 0 && qz === 0) return 'jobs';
    return 'city';
  }
  if (cx === 0 && cz === 1 && qz === 0) return 'plot';
  const v = r();
  if (v < 0.10) return 'park';
  if (v < 0.19) return 'lot';
  if (v < 0.24) return 'shop';
  if (v < 0.28) return 'jobs';
  if (v < 0.40) return 'plot';
  return 'city';
}

function buildChunk(cx, cz) {
  const b = new Builder();
  const boxes = [], shops = [], lots = [], jobs = [], homes = [], parkedModels = [];
  const r = rng(hash(cx, cz));
  const ox = cx * CHUNK, oz = cz * CHUNK, mx = ox + CHUNK / 2, mz = oz + CHUNK / 2;

  // chão, estradas e traços
  b.flat(grassMat, CHUNK, CHUNK, mx, 0, mz);
  b.flat(roadMat, CHUNK, ROAD, mx, 0.05, mz);
  b.flat(roadMat, ROAD, CHUNK, mx, 0.06, mz);
  for (let i = 0; i < 10; i++) {
    const t = i * 10 + 5;
    if (Math.abs(t - 50) > 9) {
      b.flat(lineMat, 5, 0.25, ox + t, 0.08, mz);
      b.flat(lineMat, 0.25, 5, mx, 0.09, oz + t);
    }
  }
  // passadeiras
  for (const s of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      b.flat(whiteMat, 0.8, 3, mx + k * 1.55, 0.1, mz + s * 9);
      b.flat(whiteMat, 3, 0.8, mx + s * 9, 0.1, mz + k * 1.55);
    }
  }
  // passeios
  for (const s of [-1, 1]) for (const h of [-1, 1]) {
    const c = h < 0 ? ox + 21 : ox + 79;
    b.flat(sideMat, 42, 2, c, 0.07, mz + s * 7);
    b.flat(sideMat, 2, 42, mx + s * 7, 0.07, (h < 0 ? oz + 21 : oz + 79));
  }
  // candeeiros
  [14, 34, 66, 86].forEach((t, i) => {
    const s = i % 2 ? 1 : -1;
    lamp(b, ox + t, mz + s * 7.2, 0, -s);
    lamp(b, mx - s * 7.2, oz + t, s, 0);
  });
  // semáforos
  signalPost(b, boxes, mx + 7, mz + 7, 0, 1, 'ns');
  signalPost(b, boxes, mx - 7, mz - 7, 0, -1, 'ns');
  signalPost(b, boxes, mx - 7, mz + 7, -1, 0, 'ew');
  signalPost(b, boxes, mx + 7, mz - 7, 1, 0, 'ew');

  // quarteirões
  for (let qx = 0; qx < 2; qx++) for (let qz = 0; qz < 2; qz++) {
    const x0 = qx ? mx + OFF : ox + 2, x1 = qx ? ox + CHUNK - 2 : mx - OFF;
    const z0 = qz ? mz + OFF : oz + 2, z1 = qz ? oz + CHUNK - 2 : mz - OFF;
    const type = quadType(cx, cz, qx, qz, r);
    if (type === 'park') buildPark(b, boxes, r, x0, x1, z0, z1);
    else if (type === 'lot') buildLot(b, boxes, lots, parkedModels, r, qx, x0, x1, z0, z1);
    else if (type === 'shop') buildShop(b, boxes, shops, qx, x0, x1, z0, z1);
    else if (type === 'jobs') buildJobs(b, boxes, jobs, qx, x0, x1, z0, z1);
    else if (type === 'plot') buildPlot(b, boxes, homes, cx, cz, qx, qz, x0, x1, z0, z1);
    else buildCity(b, boxes, r, x0, x1, z0, z1);
  }

  const group = new THREE.Group();
  b.finish(group);
  addParkedModels(group, parkedModels);
  scene.add(group);
  return { group, boxes, shops, lots, jobs, homes, parkedModels };
}

function updateChunks(px, pz, max = 1) {
  const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
  for (let n = 0; n < max; n++) {
    let best = null, bd = 1e9;
    for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      if (chunks.has(`${ccx + dx},${ccz + dz}`)) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = [ccx + dx, ccz + dz]; }
    }
    if (!best) break;
    chunks.set(`${best[0]},${best[1]}`, buildChunk(best[0], best[1]));
  }
  for (const [k, c] of chunks) {
    const [x, z] = k.split(',').map(Number);
    if (Math.abs(x - ccx) > RADIUS + 1 || Math.abs(z - ccz) > RADIUS + 1) {
      scene.remove(c.group);
      c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      chunks.delete(k);
    }
  }
}

function rebuildChunk(cx, cz) {
  const k = `${cx},${cz}`, old = chunks.get(k);
  if (old) { scene.remove(old.group); old.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  chunks.set(k, buildChunk(cx, cz));
}

function nearbyChunks(pos) {
  const ccx = Math.floor(pos.x / CHUNK), ccz = Math.floor(pos.z / CHUNK);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = chunks.get(`${ccx + dx},${ccz + dz}`);
    if (c) out.push(c);
  }
  return out;
}

function collide(pos, radius) {
  let hit = false;
  for (const c of nearbyChunks(pos)) {
    for (const b of c.boxes) {
      const nx = clamp(pos.x, b.minx, b.maxx), nz = clamp(pos.z, b.minz, b.maxz);
      const ddx = pos.x - nx, ddz = pos.z - nz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < radius * radius) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = nx + (ddx / d) * radius;
          pos.z = nz + (ddz / d) * radius;
        } else {
          const l = pos.x - b.minx, r = b.maxx - pos.x, t = pos.z - b.minz, bt = b.maxz - pos.z;
          const m = Math.min(l, r, t, bt);
          if (m === l) pos.x = b.minx - radius; else if (m === r) pos.x = b.maxx + radius;
          else if (m === t) pos.z = b.minz - radius; else pos.z = b.maxz + radius;
        }
      }
    }
  }
  return hit;
}

/* ---------- JOGADOR ---------- */
const player = { pos: new THREE.Vector3(45, 0, 76), yaw: 0, pitch: 0, driving: false };

// Modos: a pé = terceira/primeira pessoa; carro = traseira/capô.
let cameraMode = 'third';

// Modelo simples do jogador para a câmara em terceira pessoa.
const avatar = new THREE.Group();
const avatarBodyMat = new THREE.MeshLambertMaterial({ color: 0x2468a8 });
const avatarSkinMat = new THREE.MeshLambertMaterial({ color: 0xc58b62 });
const avatarLegMat = new THREE.MeshLambertMaterial({ color: 0x202b3b });

function avatarPart(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  avatar.add(mesh);
  return mesh;
}

avatarPart(new THREE.BoxGeometry(0.62, 0.85, 0.34), avatarBodyMat, 0, 1.15, 0);
avatarPart(new THREE.SphereGeometry(0.23, 10, 8), avatarSkinMat, 0, 1.82, 0);

const avatarArms = [];
for (const x of [-0.39, 0.39]) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 1.48, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.65, 0.2), avatarBodyMat);
  arm.position.y = -0.31;
  pivot.add(arm);
  avatar.add(pivot);
  avatarArms.push(pivot);
}

const avatarLegs = [];
for (const x of [-0.19, 0.19]) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.76, 0);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.72, 0.25), avatarLegMat);
  leg.position.y = -0.34;
  pivot.add(leg);
  avatar.add(pivot);
  avatarLegs.push(pivot);
}

scene.add(avatar);
avatar.visible = true;
let avatarWalkTime = 0;

// Modelo 3D e animação procedural do jogador.
const avatarBones = {};
const avatarBoneRest = {};
let avatarMoveAmount = 0;
let avatarRunning = false;


function animateAvatar(dt) {
  if (!avatarBones.Hips) return;

  avatarWalkTime += dt * (avatarRunning ? 13 : 9);

  const swing = Math.sin(avatarWalkTime) * 0.48 * avatarMoveAmount;
  const armSwing = swing * 0.7;

  function rotateBone(name, angle) {
    const bone = avatarBones[name];
    const rest = avatarBoneRest[name];
    if (!bone || !rest) return;

    const offset = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);

    bone.quaternion.copy(rest).multiply(offset);
  }

  rotateBone('LeftUpLeg', swing);
  rotateBone('RightUpLeg', -swing);
  rotateBone('LeftLeg', Math.max(0, -swing) * 0.65);
  rotateBone('RightLeg', Math.max(0, swing) * 0.65);

  rotateBone('LeftArm', -armSwing);
  rotateBone('RightArm', armSwing);
  rotateBone('LeftForeArm', -Math.max(0, armSwing) * 0.35);
  rotateBone('RightForeArm', -Math.max(0, -armSwing) * 0.35);

  const hips = avatarBones.Hips;
  const restPosition = avatarBoneRest.HipsPosition;

  if (hips && restPosition) {
    hips.position.y = restPosition.y +
      Math.abs(Math.sin(avatarWalkTime * 2)) * 0.045 * avatarMoveAmount;
  }
}

new GLTFLoader().load(
  '/models/player/The_Gangster.glb',
  (gltf) => {
    const model = gltf.scene;

    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bounds.getSize(size);
    bounds.getCenter(center);

    const scale = 1.8 / Math.max(size.y, 0.001);
    model.scale.setScalar(scale);
    model.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale
    );

    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }

      if (obj.isBone) {
        const name = obj.name.toLowerCase().replace(/[^a-z0-9]/g, '');

        const boneNames = {
          hips: 'Hips',
          leftupleg: 'LeftUpLeg',
          rightupleg: 'RightUpLeg',
          leftleg: 'LeftLeg',
          rightleg: 'RightLeg',
          leftarm: 'LeftArm',
          rightarm: 'RightArm',
          leftforearm: 'LeftForeArm',
          rightforearm: 'RightForeArm'
        };

        const key = boneNames[name];
        if (key) {
          avatarBones[key] = obj;
          avatarBoneRest[key] = obj.quaternion.clone();
          if (key === 'Hips') {
            avatarBoneRest.HipsPosition = obj.position.clone();
          }
        }
      }
    });

    avatar.clear();
    avatar.add(model);

    console.log('Gangster carregado. Ossos encontrados:', Object.keys(avatarBones));
  },
  undefined,
  (error) => {
    console.error('Erro ao carregar o Gangster:', error);
  }
);

let nearShop = false;
let nearPlace = null;
let shopOpen = false;

function walk(dt) {
  const m = readMove();
  if (!shopOpen) {
    player.yaw -= lookStick.x * 2.2 * dt;
    player.pitch = clamp(player.pitch - lookStick.y * 1.5 * dt, -1.2, 1.2);
  }
  const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
  const fwd = -m.y, str = m.x;
  let sp = keys.ShiftLeft ? 9 : 5.5;
  if (state.energy <= 0) sp *= 0.5;
  player.pos.x += (-s * fwd + c * str) * sp * dt;
  player.pos.z += (-c * fwd - s * str) * sp * dt;
  collide(player.pos, 0.5);

  const moving = Math.hypot(m.x, m.y) > 0.12;

  avatarMoveAmount = moving ? 1 : 0;
  avatarRunning = !!keys.ShiftLeft;

  avatar.position.copy(player.pos);
  avatar.rotation.y = player.yaw;
  avatar.visible = cameraMode === 'third';


  if (cameraMode === 'third') {
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const target = player.pos.clone()
      .addScaledVector(forward, -5.2)
      .add(new THREE.Vector3(0, 2.8, 0));
    camera.position.lerp(target, 1 - Math.pow(0.001, dt));
    camera.lookAt(player.pos.x, 1.15, player.pos.z);
  } else {
    camera.position.set(player.pos.x, 1.7, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  state.energy = clamp(state.energy - 0.1 * dt * (moving ? 1.4 : 0.6), 0, 100);
}

/* ---------- CARRO ---------- */
const car = {
  pos: new THREE.Vector3(50, 0, 88), heading: 0, speed: 0, inside: false,
  mesh: new THREE.Group(), bodyMat: new THREE.MeshLambertMaterial({ color: state.color }),
};
const headOff = new THREE.Color(0xbbbbbb), headOn = new THREE.Color(0xfff6c8);
const headMat = new THREE.MeshBasicMaterial({ color: headOff.clone() });
const tailMat = new THREE.MeshBasicMaterial({ color: 0x661010 });
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), car.bodyMat); body.position.y = 0.75;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.65, 2.1), darkMat); cabin.position.set(0, 1.42, 0.2);
  car.mesh.add(body, cabin);
  const hl = new THREE.BoxGeometry(0.5, 0.22, 0.08), tl = new THREE.BoxGeometry(0.5, 0.2, 0.08);
  for (const x of [-0.65, 0.65]) {
    const h = new THREE.Mesh(hl, headMat); h.position.set(x, 0.85, -2.12);
    const t = new THREE.Mesh(tl, tailMat); t.position.set(x, 0.85, 2.12);
    car.mesh.add(h, t);
  }
  const wg = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), wm = L(0x111111);
  for (const [x, z] of [[-1, -1.4], [1, -1.4], [-1, 1.4], [1, 1.4]]) {
    const w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); car.mesh.add(w);
  }
  car.light = new THREE.PointLight(0xfff0c0, 0, 38);
  car.light.position.set(0, 1.2, -4.5);
  car.mesh.add(car.light);
  scene.add(car.mesh);
}
let fuelWarn = 0;
car.mesh.traverse((o) => { o.castShadow = true; });
if (state.pos && [state.pos.x, state.pos.z, state.pos.cx, state.pos.cz].every(Number.isFinite)) {
  player.pos.set(state.pos.x, 0, state.pos.z); player.yaw = state.pos.yaw || 0;
  car.pos.set(state.pos.cx, 0, state.pos.cz); car.heading = state.pos.ch || 0;
  player.driving = !!state.pos.drv;
}

function drive(dt) {
  const m = readMove();
  let throttle = -m.y;
  const steer = m.x;
  if (state.fuel <= 0 && throttle > 0) {
    throttle = 0;
    fuelWarn -= dt;
    if (fuelWarn <= 0) { toast('⛽ Sem gasolina! Compra na loja.'); fuelWarn = 6; }
  }
  car.speed += throttle * (throttle > 0 ? 16 : 22) * dt;
  car.speed -= car.speed * 0.35 * dt;
  if (Math.abs(throttle) < 0.05) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 6 * dt);
  car.speed = clamp(car.speed, -12, 42);
  car.heading -= steer * 1.7 * clamp(car.speed / 12, -1, 1) * dt;
  car.pos.x += -Math.sin(car.heading) * car.speed * dt;
  car.pos.z += -Math.cos(car.heading) * car.speed * dt;
  if (collide(car.pos, 2.1)) car.speed *= 0.4;
  syncCar();

  // luz de travão
  const braking = (throttle < -0.1 && car.speed > 0.5) || (throttle > 0.1 && car.speed < -0.5);
  tailMat.color.setHex(braking ? 0xff2a2a : (nightF > 0.4 ? 0xaa2020 : 0x661010));

  // consumos e ganhos
  state.fuel = clamp(state.fuel - Math.abs(car.speed) * 0.0085 * dt, 0, 100);
  state.energy = clamp(state.energy - 0.04 * dt, 0, 100);
  state.money += Math.abs(car.speed) * dt / 80;

  checkSignals();
  checkParking();

  // Câmara traseira ou dianteira (capô).
  avatar.visible = false;
  if (cameraMode === 'hood') {
    const hoodPosition = car.mesh.localToWorld(new THREE.Vector3(0, 2.0, -1.15));
    const hoodTarget = car.mesh.localToWorld(new THREE.Vector3(0, 1.0, -12));
    camera.position.lerp(hoodPosition, 1 - Math.pow(0.001, dt));
    camera.lookAt(hoodTarget);
  } else {
    const f = new THREE.Vector3(-Math.sin(car.heading), 0, -Math.cos(car.heading));
    const target = car.pos.clone().addScaledVector(f, -9).add(new THREE.Vector3(0, 4.5, 0));
    camera.position.lerp(target, 1 - Math.pow(0.001, dt));
    camera.lookAt(car.pos.x, 1.6, car.pos.z);
  }
  player.pos.copy(car.pos);
}
function syncCar() { car.mesh.position.copy(car.pos); car.mesh.rotation.y = car.heading; }
syncCar();

// multa por passar no vermelho
function checkSignals() {
  const mx = Math.floor(car.pos.x / CHUNK) * CHUNK + CHUNK / 2, mz = Math.floor(car.pos.z / CHUNK) * CHUNK + CHUNK / 2;
  const inside = Math.abs(car.pos.x - mx) < ROAD / 2 && Math.abs(car.pos.z - mz) < ROAD / 2;
  if (inside && !car.inside && Math.abs(car.speed) > 3) {
    const axis = Math.abs(Math.cos(car.heading)) >= Math.abs(Math.sin(car.heading)) ? 'ns' : 'ew';
    if (sigState(axis) === 'r') {
      const fine = Math.min(30, Math.floor(state.money));
      state.money -= fine;
      toast(`🚦 Sinal vermelho! Multa de ${fine} moedas`);
    }
  }
  car.inside = inside;
}

// bónus por estacionar bem num lugar livre
function checkParking() {
  if (Math.abs(car.speed) > 1.2 || Math.abs(Math.cos(car.heading)) < 0.94) return;
  const now = performance.now() / 1000;
  for (const c of nearbyChunks(car.pos)) for (const lot of c.lots) for (const s of lot.slots) {
    if (s.occ || now - s.last < 45) continue;
    if (Math.abs(car.pos.x - s.x) < 1.4 && Math.abs(car.pos.z - s.z) < 2.8) {
      s.last = now; state.money += 20;
      toast('🅿️ Estacionado! +20 moedas');
    }
  }
}

function toggleCar() {
  if (shopOpen) return;
  if (player.driving) {
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    player.pos.set(car.pos.x + rx * 3, 0, car.pos.z + rz * 3);
    player.yaw = car.heading; player.pitch = 0;
    player.driving = false; car.speed = 0;
  } else if (player.pos.distanceTo(car.pos) < 7) {
    player.driving = true;
  }
}

/* ---------- LOJA ---------- */
function openShop() { menuPlace = nearPlace; shopOpen = true; renderMenu(); shopEl.style.display = 'block'; }
function closeShop() { shopOpen = false; shopEl.style.display = 'none'; }
function buy(price, fn) {
  if (state.money < price) { toast('Moedas insuficientes'); return; }
  if (fn() === false) return;
  state.money -= price; save(); renderMenu();
}
function renderShop() {
  shopEl.innerHTML = `<h2>🏪 Loja</h2><p>💰 ${Math.floor(state.money)} moedas · ⛽ ${Math.round(state.fuel)}% · ⚡ ${Math.round(state.energy)}%</p>`;
  const item = (label, price, fn) => {
    const bt = document.createElement('button');
    bt.textContent = `${label} — ${price} 💰`;
    bt.onclick = () => buy(price, fn);
    shopEl.appendChild(bt);
  };
  item('⛽ Gasolina +25%', 8, () => { if (state.fuel >= 99) { toast('Depósito já está cheio'); return false; } state.fuel = Math.min(100, state.fuel + 25); });
  item('🥪 Comida (+30 energia)', 6, () => { state.energy = Math.min(100, state.energy + 30); });
  item('🥤 Bebida (+15 energia)', 3, () => { state.energy = Math.min(100, state.energy + 15); });
  const p = document.createElement('p'); p.style.margin = '10px 0 2px'; p.textContent = 'Pintar o carro (25 💰):'; shopEl.appendChild(p);
  const row = document.createElement('div'); row.className = 'row'; shopEl.appendChild(row);
  for (const [name, col] of [['Vermelho', 0xc0392b], ['Azul', 0x2e6fd8], ['Preto', 0x222222], ['Branco', 0xeeeeee], ['Amarelo', 0xe8c020]]) {
    const bt = document.createElement('button');
    bt.textContent = name;
    bt.onclick = () => buy(25, () => { state.color = col; car.bodyMat.color.setHex(col); });
    row.appendChild(bt);
  }
  const cl = document.createElement('button'); cl.className = 'close'; cl.textContent = 'Fechar'; cl.onclick = closeShop;
  shopEl.appendChild(cl);
}

/* ---------- LOCAIS PERTO DO JOGADOR ---------- */
let menuPlace = null;
function findNearPlace() {
  nearPlace = null;
  if (player.driving) return;
  let bestD = 1e9;
  const test = (x, z, r, info) => {
    const d = Math.hypot(player.pos.x - x, player.pos.z - z);
    if (d < r && d < bestD) { bestD = d; nearPlace = info; }
  };
  for (const c of nearbyChunks(player.pos)) {
    for (const s of c.shops) test(s.x, s.z, 5, { kind: 'shop', x: s.x, z: s.z });
    for (const j of c.jobs) test(j.x, j.z, 6, { kind: 'jobs', x: j.x, z: j.z });
    for (const h of c.homes) test(h.x, h.z, 8, { kind: 'home', key: h.key, cx: h.cx, cz: h.cz, x: h.x, z: h.z });
  }
}
function placeLabel(p) {
  if (!p || p.kind === 'shop') return 'Loja';
  if (p.kind === 'jobs') return 'Emprego';
  return state.houses[p.key] ? 'Casa' : 'Comprar';
}
function renderMenu() {
  const p = menuPlace;
  if (!p || p.kind === 'shop') renderShop();
  else if (p.kind === 'jobs') renderJobs();
  else renderHome(p);
}
function menuBtn(html, fn, cls) {
  const bt = document.createElement('button');
  bt.innerHTML = html; if (cls) bt.className = cls; bt.onclick = fn;
  shopEl.appendChild(bt);
  return bt;
}
const css2 = document.createElement('style');
css2.textContent = '#toast{white-space:pre-line}#shop small{display:block;opacity:.8;font-size:12px;margin-top:2px}#fade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .6s;z-index:20}';
document.head.appendChild(css2);
const fadeEl = document.createElement('div'); fadeEl.id = 'fade'; document.body.appendChild(fadeEl);

/* ---------- EMPREGOS ---------- */
const JOBS = {
  builder: { name: 'Construtor', icon: '🧱', color: 0xffb020, base: 14, xp: 6, drain: 0.1, foot: true, desc: 'A pé: carrega blocos e leva-os à obra (3 viagens).' },
  guard: { name: 'Segurança', icon: '🛡️', color: 0x3aa0ff, base: 10, xp: 6, drain: 0.04, night: 1.8, desc: 'Faz a ronda por 4 pontos. De noite paga ×1.8.' },
  sales: { name: 'Vendas', icon: '💼', color: 0x36e08a, base: 12, xp: 5, drain: 0.05, desc: 'Visita 5 clientes, de carro ou a pé. Quanto mais longe, mais paga.' },
};
const LEVELS = [
  { n: 'Iniciante', xp: 0, mult: 1 }, { n: 'Médio', xp: 100, mult: 1.5 },
  { n: 'Padrão', xp: 300, mult: 2.2 }, { n: 'Especialista', xp: 700, mult: 3.5 },
];
function levelOf(xp) { let i = 0; for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].xp) i = k; return { i, ...LEVELS[i] }; }
const SALE_ITEMS = ['um telemóvel', 'um frigorífico', 'uma bicicleta', 'um sofá', 'um relógio', 'uma televisão', 'um fogão'];
let job = null;

const beaconMat = new THREE.MeshBasicMaterial({ color: 0x33ff88, transparent: true, opacity: 0.32, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 70, 10, 1, true), beaconMat);
beacon.visible = false; beacon.frustumCulled = false; scene.add(beacon);

// ponto sobre uma estrada (longe dos cruzamentos) a uma distância do ponto de origem
function roadPoint(ox, oz, minD, maxD) {
  for (let t = 0; t < 30; t++) {
    const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
    let x = ox + Math.cos(a) * d, z = oz + Math.sin(a) * d;
    const sx = Math.round((x - 50) / 100) * 100 + 50, sz = Math.round((z - 50) / 100) * 100 + 50;
    if (Math.abs(sx - x) < Math.abs(sz - z)) x = sx + (Math.random() - 0.5) * 5; else z = sz + (Math.random() - 0.5) * 5;
    const fx = ((x % 100) + 100) % 100, fz = ((z % 100) + 100) % 100;
    if (Math.abs(fx - 50) < 14 && Math.abs(fz - 50) < 14) continue;
    if (Math.hypot(x - ox, z - oz) < minD * 0.6) continue;
    return { x, z };
  }
  return { x: Math.round((ox - 50) / 100) * 100 + 50, z: oz + 25 };
}
function spaced(list, minD, gen) {
  let p = gen();
  for (let t = 0; t < 12 && list.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < minD); t++) p = gen();
  return p;
}
function genWaypoints(type, ox, oz) {
  const wps = [];
  if (type === 'builder') {
    for (let i = 0; i < 3; i++) {
      const pile = roadPoint(ox, oz, 20, 55), site = roadPoint(pile.x, pile.z, 25, 45);
      wps.push({ ...pile, kind: 'pick' }, { ...site, kind: 'drop' });
    }
  } else if (type === 'guard') {
    for (let i = 0; i < 4; i++) wps.push({ ...spaced(wps, 30, () => roadPoint(ox, oz, 35, 85)), kind: 'patrol' });
  } else {
    for (let i = 0; i < 5; i++) wps.push({ ...spaced(wps, 25, () => roadPoint(ox, oz, 40, 120)), kind: 'visit' });
  }
  return wps;
}
function startJob(type) {
  if (job) return;
  if (state.energy < 15) { toast('😩 Estás cansado. Come ou dorme primeiro.'); return; }
  const p = menuPlace;
  job = { type, wps: genWaypoints(type, p.x, p.z), i: 0, warn: 0, last: { x: p.x, z: p.z }, dist: 0, earned: 0 };
  closeShop();
  toast(`${JOBS[type].icon} Turno de ${JOBS[type].name} iniciado! Segue o farol e o ponto no mapa.`, 4500);
}
function cancelJob(msg) { job = null; beacon.visible = false; toast(msg, 3500); }
function completeWp(wp) {
  const J = JOBS[job.type], before = levelOf(state.jobXp[job.type] || 0);
  const d = Math.hypot(wp.x - job.last.x, wp.z - job.last.z);
  job.last = { x: wp.x, z: wp.z };
  if (wp.kind === 'pick') toast('🧱 Blocos carregados! Leva-os à obra.', 2500);
  else {
    let pay = J.base * before.mult;
    if (J.night && nightF > 0.5) pay *= J.night;
    if (job.type === 'sales') pay *= 1 + d / 150;
    pay = Math.round(pay);
    state.money += pay; job.earned += pay;
    state.jobXp[job.type] = (state.jobXp[job.type] || 0) + J.xp;
    const after = levelOf(state.jobXp[job.type]);
    const msg = job.type === 'sales' ? `Vendeste ${SALE_ITEMS[Math.floor(Math.random() * SALE_ITEMS.length)]}!` : job.type === 'guard' ? 'Ronda feita ✔' : 'Bloco colocado ✔';
    toast(`${J.icon} ${msg} +${pay} 💰 · +${J.xp} XP` + (after.i > before.i ? `\n🎉 Novo nível: ${after.n}!` : ''), 3400);
  }
  job.i++;
  if (job.i >= job.wps.length) {
    const lv = levelOf(state.jobXp[job.type] || 0), bonus = Math.round(J.base * lv.mult * 2);
    state.money += bonus; state.jobXp[job.type] = (state.jobXp[job.type] || 0) + 10;
    toast(`✅ Turno concluído! Ganhaste ${job.earned + bonus} 💰 (bónus ${bonus})`, 5000);
    job = null; beacon.visible = false; save();
  }
}
function updateJob(dt) {
  if (!job) return;
  const wp = job.wps[job.i], J = JOBS[job.type];
  beacon.visible = true; beacon.position.set(wp.x, 30, wp.z); beaconMat.color.setHex(J.color);
  state.energy = clamp(state.energy - J.drain * dt, 0, 100);
  if (state.energy <= 0) { cancelJob('😩 Exausto! O turno terminou.'); return; }
  job.dist = Math.hypot(player.pos.x - wp.x, player.pos.z - wp.z);
  job.warn -= dt;
  if (job.dist < (player.driving ? 6.5 : 4.5)) {
    if (J.foot && player.driving) { if (job.warn <= 0) { toast('Sai do carro para trabalhar (botão Sair).'); job.warn = 4; } }
    else completeWp(wp);
  }
}
function jobHud() {
  if (!job) return '';
  const J = JOBS[job.type], wp = job.wps[job.i];
  return `\n${J.icon} ${J.name} ${job.i + 1}/${job.wps.length} → ${Math.round(job.dist)} m${wp.kind === 'pick' ? ' (carregar)' : wp.kind === 'drop' ? ' (entregar)' : ''}`;
}
function renderJobs() {
  shopEl.innerHTML = `<h2>💼 Centro de Empregos</h2><p>💰 ${Math.floor(state.money)} · ⚡ ${Math.round(state.energy)}%</p>`;
  if (job) menuBtn(`Cancelar turno de ${JOBS[job.type].name}`, () => { cancelJob('Turno cancelado.'); renderMenu(); });
  else for (const t of Object.keys(JOBS)) {
    const J = JOBS[t], xp = state.jobXp[t] || 0, lv = levelOf(xp), nx = LEVELS[lv.i + 1];
    menuBtn(`${J.icon} ${J.name} — ${lv.n} · ~${Math.round(J.base * lv.mult)} 💰/tarefa<small>${J.desc}</small><small>${xp} XP${nx ? ' · próximo nível: ' + nx.xp + ' XP' : ' · nível máximo'}</small>`, () => startJob(t));
  }
  menuBtn('Fechar', closeShop, 'close');
}

/* ---------- CASAS ---------- */
const HOUSE = [{ name: 'Casa pequena', price: 300 }, { name: 'Casa média', price: 500 }, { name: 'Mansão', price: 1200 }];
let cookT = -1e9;
function sleepNow() {
  closeShop();
  fadeEl.style.opacity = 1;
  setTimeout(() => {
    timeOfDay = 0.27; state.energy = 100; save();
    fadeEl.style.opacity = 0;
    toast('😴 Dormiste bem. Já é de manhã!', 3500);
  }, 800);
}
function cookNow(lv) {
  const now = performance.now();
  if (now - cookT < 90000) { toast('🍳 A comida ainda está a ser preparada... espera um pouco.'); return; }
  cookT = now; state.energy = Math.min(100, state.energy + (lv === 3 ? 50 : 30));
  toast('🍳 Comeste em casa. Energia recuperada!'); renderMenu();
}
function renderHome(p) {
  const own = state.houses[p.key], lv = own ? own.level : 0;
  shopEl.innerHTML = `<h2>🏠 ${lv ? HOUSE[lv - 1].name : 'Terreno à venda'}</h2><p>💰 ${Math.floor(state.money)} · ⚡ ${Math.round(state.energy)}%</p>`;
  if (lv < 3) {
    const nx = HOUSE[lv];
    menuBtn(`${lv ? '⬆️ Melhorar para' : '🏷️ Comprar'} ${nx.name} — ${nx.price} 💰`, () => buy(nx.price, () => {
      state.houses[p.key] = { level: lv + 1, color: own ? own.color : 0xd9c7a0 };
      rebuildChunk(p.cx, p.cz);
      toast(`🏠 ${nx.name} é tua!`, 3500);
    }));
  }
  if (lv) {
    menuBtn('😴 Dormir (até de manhã)', sleepNow);
    menuBtn(`🍳 Cozinhar (grátis, +${lv === 3 ? 50 : 30} energia)`, () => cookNow(lv));
    const t = document.createElement('p'); t.style.margin = '10px 0 2px'; t.textContent = 'Pintar as paredes (15 💰):'; shopEl.appendChild(t);
    const row = document.createElement('div'); row.className = 'row'; shopEl.appendChild(row);
    for (const [name, col] of [['Creme', 0xd9c7a0], ['Branco', 0xf0efe9], ['Azul', 0x8fb3d9], ['Verde', 0x9cc49a], ['Rosa', 0xe3a8a0], ['Cinza', 0xb5b8bd]]) {
      const bt = document.createElement('button'); bt.textContent = name;
      bt.onclick = () => buy(15, () => { state.houses[p.key].color = col; rebuildChunk(p.cx, p.cz); });
      row.appendChild(bt);
    }
  }
  menuBtn('Fechar', closeShop, 'close');
}

/* ---------- NPCs ---------- */
const npcs = [];
{
  const bodyG = new THREE.BoxGeometry(0.55, 1.0, 0.35), headG = new THREE.SphereGeometry(0.22, 8, 6);
  const skin = L(0xe0b090);
  const cols = [0x6fa3d8, 0xd8c34a, 0xb55ad1, 0x7bc48a, 0xd86a6a, 0xeeeeee];
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const bd = new THREE.Mesh(bodyG, L(cols[i % cols.length])); bd.position.y = 0.95;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), darkMat); legs.position.y = 0.25;
    const hd = new THREE.Mesh(headG, skin); hd.position.y = 1.7;
    g.add(bd, legs, hd); scene.add(g);
    const n = { mesh: g, pos: new THREE.Vector3(), target: new THREE.Vector3(), wait: 0 };
    respawnNpc(n); npcs.push(n);
  }
}
function respawnNpc(n) {
  const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 90;
  n.pos.set(player.pos.x + Math.cos(a) * d, 0, player.pos.z + Math.sin(a) * d);
  pickTarget(n);
}
function pickTarget(n) {
  n.target.set(n.pos.x + (Math.random() - 0.5) * 70, 0, n.pos.z + (Math.random() - 0.5) * 70);
  n.wait = Math.random() * 3;
}
function updateNpcs(dt) {
  for (const n of npcs) {
    if (n.pos.distanceTo(player.pos) > 170) { respawnNpc(n); continue; }
    if (n.wait > 0) n.wait -= dt;
    else {
      const dx = n.target.x - n.pos.x, dz = n.target.z - n.pos.z, d = Math.hypot(dx, dz);
      if (d < 1) pickTarget(n);
      else { n.pos.x += (dx / d) * 1.4 * dt; n.pos.z += (dz / d) * 1.4 * dt; n.mesh.rotation.y = Math.atan2(dx, dz); }
      if (collide(n.pos, 0.4)) pickTarget(n);
    }
    n.mesh.position.set(n.pos.x, 0, n.pos.z);
  }
}

/* ---------- CÉU REALISTA: cúpula com gradiente, sol, lua, estrelas, nuvens ---------- */
const dayTop = new THREE.Color(0x2a69c2), dayHor = new THREE.Color(0xbfdcf2);
const duskTop = new THREE.Color(0x3b4f8f), duskHor = new THREE.Color(0xff9657);
const nightTop = new THREE.Color(0x02040b), nightHor = new THREE.Color(0x0c1424);
const duskSun = new THREE.Color(0xff8a40), duskCloud = new THREE.Color(0xffb48a);
const skyTop = new THREE.Color(), skyHor = new THREE.Color();

const skyUni = {
  top: { value: new THREE.Color(0x2a69c2) }, hor: { value: new THREE.Color(0xbfdcf2) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2c8) }, glow: { value: 1 },
};
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), new THREE.ShaderMaterial({
  uniforms: skyUni, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow;
varying vec3 vD;
void main(){
  vec3 d = normalize(vD);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(hor, top, pow(h, 0.5));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  c += sunCol * (pow(s, 8.0) * 0.28 + pow(s, 120.0) * 0.8) * glow;
  c = mix(c, hor * 0.8, 1.0 - smoothstep(-0.2, 0.0, d.y));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
}));
skyDome.renderOrder = -10; skyDome.frustumCulled = false;
scene.add(skyDome);

const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(13, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d0, fog: false }));
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe6ecfa, fog: false }));
sunMesh.frustumCulled = moonMesh.frustumCulled = false;
scene.add(sunMesh, moonMesh);

const puffTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const haloMat = new THREE.SpriteMaterial({ map: puffTex, color: 0x9fb4ff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
const halo = new THREE.Sprite(haloMat); halo.scale.set(95, 95, 1); halo.frustumCulled = false; scene.add(halo);

const cloudMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
const cloudShade = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
const clouds = new THREE.Group();
{
  const r = rng(777);
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, el = 0.09 + r() * 0.3, R = 300;
    const cx = Math.cos(a) * Math.cos(el) * R, cy = Math.sin(el) * R, cz = Math.sin(a) * Math.cos(el) * R;
    const n = 5 + Math.floor(r() * 4), w = 70 + r() * 80;
    for (let j = 0; j < n; j++) {
      const low = j % 2 === 1;
      const sp = new THREE.Sprite(low ? cloudShade : cloudMat), sc = w * (0.6 + r() * 0.7);
      sp.scale.set(sc, sc * 0.5, 1);
      sp.position.set(cx + (r() - 0.5) * w * 1.2, cy + (r() - 0.5) * w * 0.2 - (low ? w * 0.06 : 0), cz + (r() - 0.5) * w * 1.2);
      clouds.add(sp);
    }
  }
}
scene.add(clouds);

const stars = (() => {
  const N = 450, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2, cy = 0.05 + Math.random() * 0.95, sy = Math.sqrt(1 - cy * cy);
    p[i * 3] = Math.cos(th) * sy * 380; p[i * 3 + 1] = cy * 380; p[i * 3 + 2] = Math.sin(th) * sy * 380;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const s = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  s.frustumCulled = false; return s;
})();
scene.add(stars);

let timeOfDay = 0.45; // 0.5 = meio-dia
let nightF = 0;
function updateSky(dt) {
  timeOfDay = (timeOfDay + dt / DAY_SECONDS) % 1;
  const ang = timeOfDay * Math.PI * 2 - Math.PI / 2;
  const h = Math.sin(ang);
  const k = smooth(-0.12, 0.3, h);
  nightF = 1 - k;
  const dusk = Math.max(0, 1 - Math.abs(h) * 3.2) * 0.9;

  skyTop.copy(nightTop).lerp(dayTop, k).lerp(duskTop, dusk);
  skyHor.copy(nightHor).lerp(dayHor, k).lerp(duskHor, dusk);
  skyUni.top.value.copy(skyTop); skyUni.hor.value.copy(skyHor);
  scene.fog.color.copy(skyHor);

  const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.3).normalize();
  skyUni.sunDir.value.copy(dir);
  skyUni.sunCol.value.setHex(0xfff2c8).lerp(duskSun, dusk);
  skyUni.glow.value = smooth(-0.15, 0.1, h);

  hemi.color.setHex(0x8fa4d8).lerp(new THREE.Color(0xffffff), k).lerp(duskCloud, dusk * 0.5);
  hemi.intensity = 0.22 + 0.85 * k;
  sun.color.setHex(0xfff2d6).lerp(duskSun, dusk);
  sun.intensity = 1.1 * k;
  sun.position.set(player.pos.x + Math.cos(ang) * 200, Math.max(h, 0.02) * 200, player.pos.z + 60);
  sun.target.position.copy(player.pos);

  // luzes noturnas
  for (const m of buildingMats) m.emissiveIntensity = nightF * 1.1;
  lampHeadMat.color.copy(lampOff).lerp(lampOn, nightF);
  glowMat.opacity = nightF * 0.3; glowMat.visible = nightF > 0.03;
  glassMat.color.copy(glassDay).lerp(glassNight, nightF);
  const sg = 0.7 + 0.3 * nightF;
  shopSignMat.color.setScalar(sg); pSignMat.color.setScalar(sg);
  jobSignMat.color.setScalar(sg); saleSignMat.color.setScalar(sg); homeSignMat.color.setScalar(sg);
  headMat.color.copy(headOff).lerp(headOn, nightF);
  car.light.intensity = nightF * 2.4;
  stars.material.opacity = nightF * 0.9;

  // cúpula, astros e nuvens seguem a câmara
  const cp = camera.position;
  skyDome.position.copy(cp);
  sunMesh.position.copy(cp).addScaledVector(dir, 360); sunMesh.visible = dir.y > -0.05;
  sunMesh.material.color.setHex(0xfff6d0).lerp(duskSun, dusk);
  moonMesh.position.copy(cp).addScaledVector(dir, -360); moonMesh.visible = dir.y < 0.05;
  halo.position.copy(moonMesh.position); haloMat.opacity = nightF * 0.55; halo.visible = moonMesh.visible;
  stars.position.copy(cp);
  clouds.position.copy(cp); clouds.rotation.y += dt * 0.004;
  cloudMat.color.setHex(0x1a2236).lerp(new THREE.Color(0xffffff), k).lerp(duskCloud, dusk);
  cloudShade.color.copy(cloudMat.color).multiplyScalar(0.78);
  cloudMat.opacity = cloudShade.opacity = 0.35 + 0.55 * k;
}

/* ---------- MINIMAPA ---------- */
function drawMap() {
  const R = 150, S = 60 / R, px = player.pos.x, pz = player.pos.z;
  mctx.clearRect(0, 0, 120, 120);
  mctx.fillStyle = 'rgba(10,14,20,.6)'; mctx.fillRect(0, 0, 120, 120);
  mctx.strokeStyle = '#7d8590'; mctx.lineWidth = 3;
  for (let k = Math.floor((px - R) / CHUNK); k <= Math.floor((px + R) / CHUNK); k++) {
    const x = 60 + (k * CHUNK + 50 - px) * S; mctx.beginPath(); mctx.moveTo(x, 0); mctx.lineTo(x, 120); mctx.stroke();
  }
  for (let k = Math.floor((pz - R) / CHUNK); k <= Math.floor((pz + R) / CHUNK); k++) {
    const y = 60 + (k * CHUNK + 50 - pz) * S; mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(120, y); mctx.stroke();
  }
  for (const c of chunks.values()) {
    mctx.fillStyle = '#f2c94c';
    for (const s of c.shops) mctx.fillRect(60 + (s.x - px) * S - 3, 60 + (s.z - pz) * S - 3, 6, 6);
    mctx.fillStyle = '#4a8cff';
    for (const l of c.lots) mctx.fillRect(60 + ((l.minx + l.maxx) / 2 - px) * S - 3, 60 + ((l.minz + l.maxz) / 2 - pz) * S - 3, 6, 6);
    mctx.fillStyle = '#3ddc84';
    for (const j of c.jobs) mctx.fillRect(60 + (j.x - px) * S - 3, 60 + (j.z - pz) * S - 3, 6, 6);
    for (const hm of c.homes) { mctx.fillStyle = state.houses[hm.key] ? '#ff7ac8' : '#b58cff'; mctx.fillRect(60 + (hm.x - px) * S - 3, 60 + (hm.z - pz) * S - 3, 6, 6); }
  }
  if (job) {
    const wp = job.wps[job.i]; let ex = (wp.x - px) * S, ey = (wp.z - pz) * S;
    const l = Math.hypot(ex, ey); if (l > 54) { ex *= 54 / l; ey *= 54 / l; }
    mctx.fillStyle = '#00ffd0'; mctx.beginPath(); mctx.arc(60 + ex, 60 + ey, 4, 0, 7); mctx.fill();
  }
  mctx.fillStyle = '#e04040';
  mctx.beginPath(); mctx.arc(60 + (car.pos.x - px) * S, 60 + (car.pos.z - pz) * S, 3, 0, 7); mctx.fill();
  mctx.save(); mctx.translate(60, 60); mctx.rotate(-(player.driving ? car.heading : player.yaw));
  mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4, 5); mctx.lineTo(-4, 5); mctx.closePath(); mctx.fill();
  mctx.restore();
}

/* ---------- DEFINIÇÕES (gráficos, áudio, música) ---------- */
const SETTINGS_KEY = 'motormundo.settings';
const settings = { quality: 'medium', audioOn: true, volume: 0.8, musicOn: true, musicName: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* ignora */ }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignora */ } }
function sfxVol() { return settings.audioOn ? clamp(settings.volume, 0, 1) : 0; }

const QUALITY = {
  low: { name: 'Baixo', pr: 1, radius: 1, fogN: 30, fogF: 115, shadows: false, hint: 'Mais fps: resolução e vista reduzidas.' },
  medium: { name: 'Médio', pr: 1.25, radius: 2, fogN: 60, fogF: 215, shadows: false, hint: 'Equilíbrio entre fps e beleza.' },
  ultra: { name: 'Ultra', pr: 2, radius: 3, fogN: 90, fogF: 320, shadows: true, hint: 'Sombras, vista longa e resolução máxima. Pede um telemóvel forte.' },
};
sun.shadow.mapSize.set(1024, 1024);
{
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 500;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4;
}
function applyQuality(q) {
  const Q = QUALITY[q] || QUALITY.medium;
  RADIUS = Q.radius; scene.fog.near = Q.fogN; scene.fog.far = Q.fogF;
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  renderer.setSize(innerWidth, innerHeight);
  if (renderer.shadowMap.enabled !== Q.shadows) {
    renderer.shadowMap.enabled = Q.shadows;
    scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  }
  sun.castShadow = Q.shadows;
}

/* música do jogador: o ficheiro fica guardado no telemóvel (IndexedDB) */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('motormundo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbPut(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const rq = db.transaction('files').objectStore('files').get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
async function idbDel(k) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }

const musicEl = new Audio(); musicEl.loop = true;
let musicUrl = '';
function setMusicBlob(f) {
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  musicUrl = URL.createObjectURL(f); musicEl.src = musicUrl;
  settings.musicName = f.name || 'música';
}
function applyAudio() {
  musicEl.volume = clamp(sfxVol(), 0, 1);
  if (!settings.audioOn) musicEl.pause();
}
function playMusic() {
  if (!settings.audioOn || !settings.musicOn || !musicUrl) return;
  applyAudio();
  const p = musicEl.play(); if (p && p.catch) p.catch(() => {});
}
async function loadMusic() { try { const f = await idbGet('music'); if (f) setMusicBlob(f); } catch (e) { /* sem música guardada */ } applyAudio(); }
const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'audio/*'; fileIn.style.display = 'none';
document.body.appendChild(fileIn);
fileIn.onchange = async () => {
  const f = fileIn.files && fileIn.files[0]; if (!f) return;
  let kept = true;
  try { await idbPut('music', f); } catch (e) { kept = false; }
  setMusicBlob(f); settings.musicOn = true; saveSettings(); playMusic();
  fileIn.value = '';
  if (!kept) toast('A música toca, mas não ficou guardada para a próxima vez.', 4000);
  if (menuView === 'settings') renderSettings();
};

/* ---------- TELA INICIAL E MENU DE PAUSA ---------- */
const css3 = document.createElement('style');
css3.textContent = `
#menu{position:fixed;inset:0;z-index:30;display:none;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;align-items:center;overflow:auto;
  background:linear-gradient(90deg,rgba(4,8,16,.9) 0%,rgba(4,8,16,.6) 45%,rgba(4,8,16,.12) 100%)}
#menu.show{display:flex}
#menuBox{box-sizing:border-box;width:min(94vw,450px);margin:0 0 0 max(4vw,14px);padding:18px 22px}
.logo{font-size:clamp(32px,7vw,54px);font-weight:900;letter-spacing:.07em;line-height:1;background:linear-gradient(180deg,#fff 15%,#ffb347 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 12px rgba(0,0,0,.55))}
.tag{letter-spacing:.32em;font-size:11px;opacity:.75;margin:8px 0 20px}
.mbtn{display:flex;align-items:center;gap:14px;width:100%;box-sizing:border-box;margin:9px 0;padding:14px 18px;border-radius:13px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.09);color:#fff;font:inherit;font-size:18px;font-weight:650;text-align:left}
.mbtn:active{transform:scale(.98);background:rgba(255,179,71,.3)}
.mbtn i{font-style:normal;font-size:22px;width:28px;text-align:center}
.mbtn small{display:block;font-weight:400;font-size:12px;opacity:.72;margin-top:2px}
.mbtn[disabled]{opacity:.35}
.mbtn.primary{background:linear-gradient(90deg,#ff9f1c,#ff7a00);border-color:#ffc16b;color:#1a1004}
.mbtn.danger{background:#a22b2b;border-color:#ff7b7b}
.set{margin:14px 0}.set .lbl{display:block;font-size:12px;opacity:.8;margin-bottom:7px;letter-spacing:.08em;text-transform:uppercase}
.seg{display:flex;gap:6px}
.seg button{flex:1;padding:11px 6px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:15px}
.seg button.on{background:#ff9f1c;color:#161006;font-weight:700;border-color:#ffc16b}
.set input[type=range]{width:100%;accent-color:#ff9f1c;height:28px}
.hint{font-size:12px;opacity:.65;margin-top:6px}
.musicname{font-size:14px;margin-bottom:8px;word-break:break-all}
.foot{margin-top:16px;font-size:11px;opacity:.5;letter-spacing:.08em}
.msg{font-size:15px;line-height:1.45;margin:6px 0 12px;opacity:.92}
#pauseBtn{position:fixed;top:8px;right:8px;width:42px;height:42px;border-radius:10px;border:1px solid #fff4;background:#0008;color:#fff;font-size:20px;z-index:6}
#cameraBtn{position:fixed;top:58px;right:8px;min-width:92px;height:38px;padding:0 9px;border-radius:10px;border:1px solid #fff5;background:#0009;color:#fff;font-size:12px;font-weight:700;z-index:6}
body.inmenu #hud,body.inmenu .stick,body.inmenu #btnE,body.inmenu #btnShop,body.inmenu #minimap,body.inmenu #pauseBtn,body.inmenu #cameraBtn,body.inmenu #toast,body.inmenu #shop{display:none!important}
`;
document.head.appendChild(css3);
const menuEl = document.createElement('div'); menuEl.id = 'menu';
const menuBox = document.createElement('div'); menuBox.id = 'menuBox';
menuEl.appendChild(menuBox); document.body.appendChild(menuEl);
const pauseBtn = document.createElement('button'); pauseBtn.id = 'pauseBtn'; pauseBtn.textContent = '☰';
document.body.appendChild(pauseBtn);

const cameraBtn = document.createElement('button');
cameraBtn.id = 'cameraBtn';
cameraBtn.textContent = 'CÂMARA';
cameraBtn.title = 'Mudar perspetiva da câmara';
document.body.appendChild(cameraBtn);

cameraBtn.addEventListener('click', () => {
  if (menuMode || shopOpen) return;
  if (player.driving) {
    cameraMode = cameraMode === 'hood' ? 'chase' : 'hood';
  } else {
    cameraMode = cameraMode === 'third' ? 'first' : 'third';
  }
  toast(player.driving
    ? (cameraMode === 'hood' ? 'Câmara dianteira' : 'Câmara traseira')
    : (cameraMode === 'third' ? 'Terceira pessoa' : 'Primeira pessoa'));
});

let menuMode = null;        // 'title' | 'pause' | null (a jogar)
let menuView = 'main';
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
function hasSavedGame() { try { return localStorage.getItem(SAVE_KEY) !== null; } catch (e) { return false; } }

let orbitA = 0.6;
function orbitCamera(dt) { // câmara aérea a rodar sobre a cidade
  orbitA += dt * 0.06;
  const ix = Math.floor(player.pos.x / CHUNK) * CHUNK + 50, iz = Math.floor(player.pos.z / CHUNK) * CHUNK + 50;
  camera.position.set(ix + Math.cos(orbitA) * 110, 58, iz + Math.sin(orbitA) * 110);
  camera.lookAt(ix, 18, iz);
}

function showMenu(mode, view = 'main') {
  menuMode = mode;
  if (mode === 'title') { timeOfDay = 0.7; applyQuality('medium'); }
  document.body.classList.add('inmenu'); menuEl.classList.add('show');
  renderMenuView(view);
}
function hideMenu() { menuMode = null; document.body.classList.remove('inmenu'); menuEl.classList.remove('show'); }
function resumeGame() {
  const fromTitle = menuMode === 'title';
  hideMenu();
  if (fromTitle) { timeOfDay = 0.4; applyQuality(settings.quality); }
  playMusic();
}
function openPause() { if (menuMode) return; save(); showMenu('pause'); }
function newGame() {
  Object.assign(state, { money: 25, fuel: 100, energy: 100, color: 0xc0392b, jobXp: { builder: 0, guard: 0, sales: 0 }, houses: {}, pos: null });
  car.bodyMat.color.setHex(state.color);
  job = null; beacon.visible = false; cookT = -1e9;
  closeShop();
  player.pos.set(45, 0, 76); player.yaw = 0; player.pitch = 0; player.driving = false;
  car.pos.set(50, 0, 88); car.heading = 0; car.speed = 0; syncCar();
  for (const k of [...chunks.keys()]) { const [cx, cz] = k.split(',').map(Number); rebuildChunk(cx, cz); }
  save();
  resumeGame();
  toast('🆕 Novo jogo! Boa sorte.', 3500);
}
function exitGame() {
  save();
  try {
    const C = window.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform() && C.nativePromise) { C.nativePromise('App', 'exitApp'); return; }
  } catch (e) { /* segue */ }
  try { window.close(); } catch (e) { /* segue */ }
  renderMenuView('bye');
}

function mbtn(icon, title, sub, fn, cls, disabled) {
  const b = el('button', 'mbtn' + (cls ? ' ' + cls : ''));
  b.innerHTML = `<i>${icon}</i><span>${title}${sub ? `<small>${sub}</small>` : ''}</span>`;
  if (disabled) b.disabled = true; else b.onclick = fn;
  menuBox.appendChild(b);
  return b;
}
function header(sub) {
  menuBox.innerHTML = '<div class="logo">MOTOR MUNDO</div><div class="tag">' + (sub || 'SIMULADOR DE MUNDO ABERTO') + '</div>';
}

function renderMenuView(view) {
  menuView = view;
  if (view === 'settings') return renderSettings();
  if (view === 'confirm') {
    header();
    menuBox.insertAdjacentHTML('beforeend', '<div class="msg">⚠️ Isto apaga o jogo guardado: dinheiro, empregos, casas e carro. Queres mesmo recomeçar?</div>');
    mbtn('🗑️', 'Sim, recomeçar', '', newGame, 'danger');
    mbtn('↩️', 'Cancelar', '', () => renderMenuView('main'));
    return;
  }
  if (view === 'bye') {
    header();
    menuBox.insertAdjacentHTML('beforeend', '<div class="msg">👋 Obrigado por jogar! O jogo foi guardado. Já podes fechar esta página.</div>');
    mbtn('↩️', 'Voltar ao menu', '', () => renderMenuView('main'), 'primary');
    return;
  }
  const pause = menuMode === 'pause', saved = hasSavedGame();
  header(pause ? 'JOGO EM PAUSA' : undefined);
  mbtn('▶️', 'Continuar', pause ? 'retomar o jogo' : (saved ? `jogo salvo · 💰 ${Math.floor(state.money)}` : 'ainda não há jogo salvo'), resumeGame, 'primary', !pause && !saved);
  mbtn('🆕', 'Novo jogo', 'reiniciar do zero', () => (saved || pause ? renderMenuView('confirm') : newGame()));
  mbtn('⚙️', 'Configuração', 'gráficos, áudio e música', () => renderMenuView('settings'));
  mbtn('🚪', 'Sair', 'guardar e fechar', exitGame);
  menuBox.insertAdjacentHTML('beforeend', '<div class="foot">MOTOR MUNDO · v0.4</div>');
}

function renderSettings() {
  menuBox.innerHTML = '<div class="logo" style="font-size:30px">⚙️ Configuração</div><div class="tag"></div>';
  const seg = (items, isOn, onPick) => {
    const d = el('div', 'seg');
    for (const [key, label] of items) {
      const b = el('button', isOn(key) ? 'on' : ''); b.textContent = label; b.onclick = () => onPick(key); d.appendChild(b);
    }
    return d;
  };
  // gráficos
  const g = el('div', 'set'); g.innerHTML = '<span class="lbl">Gráficos</span>';
  g.appendChild(seg(Object.keys(QUALITY).map((k) => [k, QUALITY[k].name]), (k) => settings.quality === k, (k) => {
    settings.quality = k; saveSettings();
    if (menuMode !== 'title') applyQuality(k);
    renderSettings();
  }));
  g.insertAdjacentHTML('beforeend', `<div class="hint">${QUALITY[settings.quality].hint}</div>`);
  menuBox.appendChild(g);
  // áudio
  const a = el('div', 'set'); a.innerHTML = '<span class="lbl">Áudio</span>';
  a.appendChild(seg([['on', 'Ligado'], ['off', 'Desligado']], (k) => (k === 'on') === settings.audioOn, (k) => {
    settings.audioOn = k === 'on'; saveSettings(); applyAudio(); if (settings.audioOn) playMusic(); renderSettings();
  }));
  menuBox.appendChild(a);
  // volume
  const v = el('div', 'set'); const vl = el('span', 'lbl'); vl.textContent = `Volume · ${Math.round(settings.volume * 100)}%`; v.appendChild(vl);
  const r = el('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(settings.volume * 100);
  r.oninput = () => { settings.volume = r.value / 100; vl.textContent = `Volume · ${r.value}%`; applyAudio(); };
  r.onchange = saveSettings;
  v.appendChild(r); menuBox.appendChild(v);
  // música
  const m = el('div', 'set'); m.innerHTML = '<span class="lbl">Música</span>';
  const nm = el('div', 'musicname'); nm.textContent = musicUrl ? `🎵 ${settings.musicName}` : 'Nenhum ficheiro adicionado'; m.appendChild(nm);
  menuBox.appendChild(m);
  mbtn('➕', musicUrl ? 'Trocar ficheiro de música' : 'Adicionar ficheiro de música', 'MP3, M4A, OGG, WAV…', () => fileIn.click());
  if (musicUrl) {
    mbtn(settings.musicOn ? '⏸️' : '▶️', settings.musicOn ? 'Pausar música' : 'Tocar música', '', () => {
      settings.musicOn = !settings.musicOn; saveSettings();
      if (settings.musicOn) playMusic(); else musicEl.pause();
      renderSettings();
    });
    mbtn('🗑️', 'Remover música', '', async () => {
      musicEl.pause(); musicEl.removeAttribute('src'); if (musicUrl) URL.revokeObjectURL(musicUrl);
      musicUrl = ''; settings.musicName = ''; saveSettings();
      try { await idbDel('music'); } catch (e) { /* ignora */ }
      renderSettings();
    });
  }
  mbtn('↩️', 'Voltar', '', () => renderMenuView('main'));
}

pauseBtn.onclick = openPause;
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (menuMode === 'pause') resumeGame(); else if (!menuMode) openPause();
});

applyQuality(settings.quality);
loadMusic();
showMenu('title');

/* ---------- CICLO PRINCIPAL ---------- */
updateChunks(player.pos.x, player.pos.z, 99);
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0, saveT = 0, mapT = 0, firstFrame = true;

function frame() {
  const dt = menuMode === 'pause' ? (clock.getDelta(), 0) : Math.min(clock.getDelta(), 0.05);
  sigT += dt;
  if (menuMode === 'title') orbitCamera(dt);
  else if (player.driving) drive(dt); else walk(dt);
  if (!player.driving) animateAvatar(dt);
  updateChunks(player.pos.x, player.pos.z, 1);
  updateNpcs(dt);
  if (menuMode !== 'title') updateJob(dt);
  updateSignals();
  updateSky(dt);
  updateAudio();
  renderer.render(scene, camera);

  // interação com locais: loja, empregos, casas
  findNearPlace();
  nearShop = !!nearPlace;
  if (shopOpen && !nearShop) closeShop();
  btnShop.style.display = nearShop ? 'block' : 'none';
  btnShop.textContent = shopOpen ? 'Fechar' : placeLabel(nearPlace);
  const nearCar = !player.driving && player.pos.distanceTo(car.pos) < 7;
  btnE.textContent = player.driving ? 'Sair' : 'Entrar';
  btnE.style.opacity = (player.driving || nearCar) ? 1 : 0.35;

  cameraBtn.style.display = (!menuMode && !shopOpen) ? 'block' : 'none';
  cameraBtn.textContent = player.driving
    ? (cameraMode === 'hood' ? 'CÂMARA: CAPÔ' : 'CÂMARA: TRÁS')
    : (cameraMode === 'first' ? 'CÂMARA: 1ª' : 'CÂMARA: 3ª');

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  const hh = Math.floor(timeOfDay * 24), mi = Math.floor((timeOfDay * 24 % 1) * 60);
  hud.textContent =
    `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')} · ${fps} fps` +
    (player.driving ? ` · ${Math.abs(Math.round(car.speed * 3.6))} km/h` : '') +
    `\n💰 ${Math.floor(state.money)}  ⛽ ${Math.round(state.fuel)}%  ⚡ ${Math.round(state.energy)}%` + jobHud();

  mapT += dt; if (mapT > 0.12) { mapT = 0; drawMap(); }
  saveT += dt; if (saveT > 5) { saveT = 0; save(); }
  if (firstFrame && !menuMode) { firstFrame = false; toast('Bem-vindo! 🏪 Loja aqui · 💼 Empregos a noroeste · 🏠 terrenos à venda a sul.', 6000); }
  requestAnimationFrame(frame);
}
frame();
