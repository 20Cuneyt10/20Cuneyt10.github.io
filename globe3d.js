// globe3d.js — Jukebox için 3D dünya motoru (globe projesinden uyarlanmış)
// - ArcGIS karoları (yerel önbellek, offline)
// - yüzeye kilitli kamera (1:1 sürükleme, hız tavanı, boşta dönüş)
// - tıkla -> 2x2 alanı sonifiye et
// - YENİ: küre yüzeyinde bölge sınırı (spline) + sesin şiddetiyle yükselen tarama çizgisi
import * as THREE from 'three';
import * as D2 from './libs/sonify-dsp.js';
import * as D3 from './sonify-v3.js';

const GLOBE_R = 100;
const FOV = 45;
const MIN_DIST = GLOBE_R + 1.15;
const MAX_DIST = 620;
const MAX_ANG_STEP = 0.30;   // tek pointer olayinda en fazla aci adimi (rad)
const MAX_DRAG_PX = 110;     // tek pointer olayinda en fazla piksel tasima
const SPIN_FRICTION = 6.0;   // birakinca donus sonumu (1/sn)
const FLING_MIN = 0.35;      // bu aci hizindan yavassa momentum yok (rad/sn)
const FLING_MAX = 2.8;       // en hizli firlatma (rad/sn)
const MAX_ZOOM_STEP = 1.35;
const IDLE_DELAY = 2500;
const IDLE_SPEED = 0.05;
const SPIN_FULL_DIST = 260;
const SPIN_STOP_DIST = 175;

const SF_SR = 22050, SF_BINS = 256, SF_FRAMES = 384, SF_NFFT = 512, SF_HOP = 256;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- karo -> koordinat ----------
const TILE_TMPL = './tiles/{z}/{x}/{y}.jpg';
const tileUrl = (x, y, z) => TILE_TMPL.replace('{z}', z).replace('{x}', x).replace('{y}', y);

function latLngToVec(lat, lng, r = 1) {
  // globe.html ile ayni konvansiyon: lat = 90 - acos(y), lng = atan2(x, z)
  const phi = (90 - lat) * Math.PI / 180;
  const lam = lng * Math.PI / 180;
  const sp = Math.sin(phi);
  return new THREE.Vector3(sp * Math.sin(lam) * r, Math.cos(phi) * r, sp * Math.cos(lam) * r);
}
function vecToLatLng(p) {
  const r = p.length();
  return {
    lat: 90 - (Math.acos(clamp(p.y / r, -1, 1)) * 180) / Math.PI,
    lng: (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180 + 360 - 360,
  };
}

export async function create(container) {
  // three-globe UMD'si global THREE bekler
  window.THREE = THREE;

  // ---------- three-globe (UMD) ----------
  if (!window.ThreeGlobe) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = './libs/three-globe.min.js';
      s.onload = res; s.onerror = () => rej(new Error('three-globe yuklenemedi'));
      document.head.appendChild(s);
    });
  }
  const ThreeGlobe = window.ThreeGlobe && (window.ThreeGlobe.default || window.ThreeGlobe);

  const scene = new THREE.Scene();
  const size = () => ({ w: container.clientWidth || 1, h: container.clientHeight || 1 });

  const camera = new THREE.PerspectiveCamera(FOV, (() => { const s = size(); return s.w / s.h; })(), 0.5, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  { const s = size(); renderer.setSize(s.w, s.h); }
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const globe = new ThreeGlobe()
    .globeTileEngineUrl(tileUrl)
    .showAtmosphere(true)
    .atmosphereColor('#4c7fa8')   // neon azaltildi: yumusak mavi
    .atmosphereAltitude(0.10);
  scene.add(globe);
  scene.add(new THREE.AmbientLight(0xffffff, 2.6));

  // LOD
  const tileEngine = globe.children[0] && globe.children[0].children[0] && globe.children[0].children[0].children[1];
  if (tileEngine && tileEngine.thresholds) {
    tileEngine.thresholds = Array.from({ length: 30 }, (_, i) => (8 / Math.pow(2, i)) * 2);
  }
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  setInterval(() => {
    if (!tileEngine) return;
    for (const t of tileEngine.children) {
      const map = t.material && t.material.map;
      if (map && map.anisotropy !== maxAniso) { map.anisotropy = maxAniso; map.needsUpdate = true; }
    }
  }, 300);

  // ---------- kamera ----------
  const camDir = new THREE.Vector3(0.1, 0.35, 1).normalize();
  const camUp = new THREE.Vector3(0, 1, 0).normalize();
  let dist = 300;

  function applyCamera() {
    camera.position.copy(camDir).multiplyScalar(dist);
    camera.up.copy(camUp);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }
  applyCamera();

  function radPerPixel() {
    const alt = Math.max(0.4, dist - GLOBE_R);
    const worldPerPx = (2 * alt * Math.tan((FOV * Math.PI) / 360)) / size().h;
    return worldPerPx / GLOBE_R;
  }

  const _right = new THREE.Vector3(), _upAx = new THREE.Vector3();
  let lastRotT = performance.now();

  function applyRot(dT, dP) {
    _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _upAx.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    camDir.applyAxisAngle(_upAx, dT);
    camDir.applyAxisAngle(_right, dP);
    camUp.applyAxisAngle(_right, dP);
    camUp.addScaledVector(camDir, -camUp.dot(camDir)).normalize();
    applyCamera();
  }

  // Surukleme goruntuye kilitli: aci = piksel * (dunya/piksel).
  // Zaman tabanli hiz siniri KULLANILMAZ (olay sikligina gore his degisiyordu);
  // sinir sadece tek olaydaki tasima icin, piksel cinsinden.
  function rotateBy(dx, dy) {
    dx = clamp(dx, -MAX_DRAG_PX, MAX_DRAG_PX);
    dy = clamp(dy, -MAX_DRAG_PX, MAX_DRAG_PX);
    const k = radPerPixel();
    let dT = -dx * k, dP = -dy * k;
    const mag = Math.hypot(dT, dP);
    if (mag > MAX_ANG_STEP) { const s = MAX_ANG_STEP / mag; dT *= s; dP *= s; }
    applyRot(dT, dP);
    return [dT, dP];
  }
  function zoomBy(f) {
    f = clamp(f, 1 / MAX_ZOOM_STEP, MAX_ZOOM_STEP);
    dist = clamp(dist * f, MIN_DIST, MAX_DIST);
    applyCamera();
  }

  // ---------- pointer ----------
  let lastInteract = performance.now();
  const touch = () => { lastInteract = performance.now(); };
  const pointers = new Map();
  let lastX = 0, lastY = 0, dragMoved = 0, pinchStart = 0;
  let lastMoveT = performance.now(), inertT = 0, inertP = 0, pinched = false;
  const dom = renderer.domElement;

  // Mobil/masaustu ayni davransin: tarayici bu yuzeyde kaydirma/yakinlastirma
  // hareketini almaz, aksi halde pointercancel gelip donus kesiliyor.
  dom.style.touchAction = 'none';
  dom.style.webkitUserSelect = 'none';
  dom.style.userSelect = 'none';

  dom.addEventListener('pointerdown', (e) => {
    touch();
    try { dom.setPointerCapture(e.pointerId); } catch (_) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    inertT = 0; inertP = 0;
    lastMoveT = performance.now();
    if (pointers.size === 1) {
      lastX = e.clientX; lastY = e.clientY; dragMoved = 0; pinched = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinched = true;
    }
    container.classList.add('dragging');
  });

  dom.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    touch();
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      let dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (dx || dy) {
        const now = performance.now();
        const dtm = clamp((now - lastMoveT) / 1000, 0.008, 0.12);
        lastMoveT = now;
        const [dT, dP] = rotateBy(dx, dy);
        // momentum icin aci hizi (rad/sn), asiri ziplamayi kirp
        inertT = clamp(dT / dtm, -FLING_MAX, FLING_MAX);
        inertP = clamp(dP / dtm, -FLING_MAX, FLING_MAX);
        dragMoved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX; lastY = e.clientY;
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      // iki parmagin arasi KAC PIKSELE degistiyse o oran kadar zoom
      // (eskiden dist/piksel oranlaniyordu, zoom neredeyse hic calismiyordu)
      if (pinchStart > 4 && d > 4) zoomBy(pinchStart / d);
      pinchStart = d;
    }
  });

  function endPointer(e, keepMomentum) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (!pointers.size) {
      container.classList.remove('dragging');
      if (!keepMomentum) { inertT = 0; inertP = 0; }
    } else {
      // iki parmaktan tek parmaga gecince sicrama olmasin
      const [a] = [...pointers.values()];
      lastX = a.x; lastY = a.y; lastMoveT = performance.now();
      inertT = 0; inertP = 0;
    }
    try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  dom.addEventListener('pointerup', (e) => {
    const wasClick = pointers.size === 1 && dragMoved < 6 && !pinched;
    const cx = e.clientX, cy = e.clientY;
    endPointer(e, true);
    if (wasClick) handleClick(cx, cy);
  });
  dom.addEventListener('pointercancel', (e) => endPointer(e, false));
  dom.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) endPointer(e, false); });
  // pointerleave YOK: capture varken kenardan cikinca suruklemeyi kesiyordu

  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;        // satir modu (Firefox)
    else if (e.deltaMode === 2) dy *= 100;  // sayfa modu
    if (!dy) return;
    const alt = Math.max(0.4, dist - GLOBE_R);
    // trackpad pinch (ctrlKey) cok daha kucuk delta uretir, ayri katsayi
    const rate = e.ctrlKey
      ? 0.0045
      : 0.0011 * (0.35 + 0.65 * Math.min(1, alt / 140));
    zoomBy(Math.exp(clamp(dy, -300, 300) * rate));
  }, { passive: false });

  // ---------- tik -> sonifikasyon ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(globe.children, true);
    return hits.length ? hits[0].point.clone() : null;
  }
  function toLatLng(v) {
    const r = v.length();
    return { lat: 90 - (Math.acos(clamp(v.y / r, -1, 1)) * 180) / Math.PI, lng: (Math.atan2(v.x, v.z) * 180) / Math.PI };
  }

  let region = null;               // {bounds, tile, lat, lng}
  const listeners = { onState: null };
  const state = { engine: 'v3', playing: false, progress: 0, meta: '', lat: null, lng: null };

  function emit() { listeners.onState && listeners.onState({ ...state }); }

  function handleClick(cx, cy) {
    const hit = pick(cx, cy);
    if (!hit) return;
    const { lat, lng } = toLatLng(hit);
    sonifyAt(lat, lng);
  }

  // ---------- 3x3 karo -> tiklanan nokta merkezde 512x512 ----------
  async function mosaic(lat, lng, z = 8) {
    // yeterli karo gelmediyse (internet yok / karo eksik) kademeli düş
    for (const zz of [z, 6, 5, 4]) {
      const r = await mosaicOnce(lat, lng, zz);
      if (r && r.filled >= 6) return r;
    }
    return mosaicOnce(lat, lng, z);
  }

  async function mosaicOnce(lat, lng, z) {
    const n = Math.pow(2, z);
    const tx = ((lng + 180) / 360) * n;
    const rad = clamp(lat, -85.05, 85.05) * Math.PI / 180;
    const ty = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
    const baseX = Math.floor(tx) - 1, baseY = Math.floor(ty) - 1;
    const fx = tx - Math.floor(tx), fy = ty - Math.floor(ty);

    const big = document.createElement('canvas');
    big.width = 768; big.height = 768;
    const bg = big.getContext('2d');
    const jobs = [];
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
      const X = ((baseX + dx) % n + n) % n, Y = baseY + dy;
      if (Y < 0 || Y >= n) continue;
      jobs.push(loadImg(`./tiles/${z}/${X}/${Y}.jpg`).then(img => ({ img, dx, dy })).catch(() => null));
    }
    const got = (await Promise.all(jobs)).filter(Boolean);
    for (const o of got) bg.drawImage(o.img, o.dx * 256, o.dy * 256, 256, 256);

    const cx = (1 + fx) * 256, cy = (1 + fy) * 256;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    c.getContext('2d').drawImage(big, Math.round(cx - 256), Math.round(cy - 256), 512, 512, 0, 0, 512, 512);

    const W = 256 * n;
    const px0 = tx * 256 - 256, py0 = ty * 256 - 256;
    const lonOf = px => (px / W) * 360 - 180;
    const latOf = py => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / W)));
    return {
      canvas: c,
      filled: got.length,
      tile: { z, x: Math.floor(tx), y: Math.floor(ty) },
      bounds: { west: lonOf(px0), east: lonOf(px0 + 512), north: latOf(py0), south: latOf(py0 + 512) },
    };
  }

  const imgCache = new Map();
  function loadImg(url) {
    if (imgCache.has(url)) return imgCache.get(url);
    const p = new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    imgCache.set(url, p);
    return p;
  }

  function grayOf(canvas, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const out = new Float64Array(w * h);
    for (let i = 0, q = 0; i < out.length; i++, q += 4) {
      out[i] = (0.2126 * d[q] + 0.7152 * d[q + 1] + 0.0722 * d[q + 2]) / 255;
    }
    return out;
  }

  // ---------- ses ----------
  let ctx = null, src = null, wave = null, channel = null, dur = 0, startT = 0, raf = 0;
  let gray = null;                 // sonifiye edilen matris (tarama cizgisinin siddeti icin)
  const SFP = { partials: 16, glide: 0.18, lp: 4800, stretch: 1 };

  function audioChain() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function render() {
    if (!region || !channel) return;
    gray = grayOf(region.canvas, SF_FRAMES, SF_BINS);
    let r;
    if (state.engine === 'v3') {
      r = D3.smoothAdditivePleasing(gray, {
        nBins: SF_BINS, nFrames: SF_FRAMES, sr: SF_SR, ...D3.PRESETS.saf,
        maxPartials: clamp(SFP.partials, 4, 8),
      });
      wave = { left: r.left, right: r.right };
    } else {
      r = D2.smoothAdditiveAudio(gray, {
        nBins: SF_BINS, nFrames: SF_FRAMES, nFft: SF_NFFT, hop: SF_HOP, sr: SF_SR,
        maxPartials: SFP.partials, glide: SFP.glide, attack: 0.10, release: 0.05,
        preSmooth: 0.55, lpHz: SFP.lp, stretch: SFP.stretch, birthFrames: 3,
      });
      wave = { mono: r.wave };
    }
    const len = wave.mono ? wave.mono.length : wave.left.length;
    const src = region.tile.z ? `${region.tile.z}/${region.tile.x}/${region.tile.y}` : (region.tile.source || 'nasa');
    state.meta = `${(len / SF_SR).toFixed(2)} sn · ${SF_PRESETS_LABEL(state.engine)} · ${src}`;
    buildOverlay();
    emit();
  }
  const SF_PRESETS_LABEL = (e) => e === 'v3' ? 'A minor pentatonic · 6 partials' : `${SFP.partials} partials`;

  function play() {
    if (!wave) return;
    audioChain();
    if (ctx.state === 'suspended') ctx.resume();
    stop(true);
    const len = wave.mono ? wave.mono.length : wave.left.length;
    const buf = ctx.createBuffer(wave.mono ? 1 : 2, len, SF_SR);
    if (wave.mono) buf.getChannelData(0).set(wave.mono);
    else { buf.getChannelData(0).set(wave.left); buf.getChannelData(1).set(wave.right); }
    src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 1.0;
    src.connect(g).connect(ctx.destination);
    src.start();
    dur = buf.duration;
    startT = performance.now();
    state.playing = true;
    tick();
  }

  function stop(quiet) {
    if (src) { try { src.stop(); } catch (_) {} src = null; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    state.playing = false;
    state.progress = 0;
    updateScan();
    if (!quiet) emit();
  }

  function tick() {
    raf = 0;
    if (!state.playing) return;
    const t = (performance.now() - startT) / 1000;
    state.progress = dur > 0 ? clamp(t / dur, 0, 1) : 0;
    updateScan();
    if (state.progress < 1) raf = requestAnimationFrame(tick);
    else stop();
  }

  // ---------- YUZEY KATMANI: sinir (spline) + siddetli tarama cizgisi ----------
  const overlay = new THREE.Group();
  scene.add(overlay);

  const BOUND_SEG = 96;      // sinir egrisinin ornek sayisi
  const CURT_SEG = 72;       // tarama cizgisinin dikey ornek sayisi
  const R_LINE = GLOBE_R * 1.003;
  let CURT_MAX_H = 6;        // siddet -> yukseklik (bolge boyutuna gore guncellenir)
  let RIBBON_HW = 0.3;       // sinir seridinin yari kalinligi

  let boundaryLine = null;
  let curtain = null, curtainGeo = null, curtainPos = null;
  let edgeLine = null, edgePos = null;

  // bir yol boyunca (kure yuzeyinde) ince serit uretir
  function ribbon(pts, halfWidth, color, opacity) {
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
      const tan = new THREE.Vector3().subVectors(next, prev).normalize();
      const radial = p.clone().normalize();
      // serit duzlemi: yuzey normali x teget => yan vektor
      const side = new THREE.Vector3().crossVectors(radial, tan).normalize().multiplyScalar(halfWidth);
      const a = p.clone().add(side), b = p.clone().sub(side);
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), side: THREE.DoubleSide,
      transparent: true, opacity, depthWrite: false,
    }));
  }

  function boundsPath(b) {
    // sinirlari lat/lng dikdortgeni olarak ornekle (kure uzerinde egri gorunur)
    const pts = [];
    const N = Math.round(BOUND_SEG / 4);
    for (let i = 0; i <= N; i++) pts.push([b.north, b.west + (b.east - b.west) * i / N]);
    for (let i = 1; i <= N; i++) pts.push([b.north + (b.south - b.north) * i / N, b.east]);
    for (let i = 1; i <= N; i++) pts.push([b.south, b.east + (b.west - b.east) * i / N]);
    for (let i = 1; i <= N; i++) pts.push([b.south + (b.north - b.south) * i / N, b.west]);
    return pts.map(([la, ln]) => latLngToVec(la, ln, R_LINE));
  }

  function buildOverlay() {
    if (!region) return;
    // bolge ne kadar buyukse cizgi/serit o kadar buyusun (kucuk kutuda gorunmez oluyordu)
    const spanDeg = Math.max(0.5, region.bounds.east - region.bounds.west);
    const arcLen = (spanDeg * Math.PI / 180) * GLOBE_R;   // kure uzerindeki yay uzunlugu
    CURT_MAX_H = clamp(arcLen * 0.30, 3.5, 30);
    RIBBON_HW = clamp(arcLen * 0.020, 0.35, 2.0);
    // --- sinir: kure yuzeyinde ince serit (WebGL'de linewidth calismadigi icin mesh)
    if (boundaryLine) { overlay.remove(boundaryLine); boundaryLine.geometry.dispose(); }
    boundaryLine = ribbon(boundsPath(region.bounds), RIBBON_HW, '#ff755a', 0.9);
    overlay.add(boundaryLine);

    // --- tarama cizgisi (siddet = yukseklik)
    if (curtain) { overlay.remove(curtain); curtain.geometry.dispose(); }
    curtainGeo = new THREE.BufferGeometry();
    curtainPos = new Float32Array((CURT_SEG + 1) * 2 * 3);
    curtainGeo.setAttribute('position', new THREE.BufferAttribute(curtainPos, 3));
    const idx = [];
    for (let i = 0; i < CURT_SEG; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    curtainGeo.setIndex(idx);
    curtain = new THREE.Mesh(curtainGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff755a'), side: THREE.DoubleSide,
      transparent: true, opacity: 0.20, depthWrite: false,
    }));
    overlay.add(curtain);

    // --- ust kenar cizgisi (parlak): yuksekligi sese gore degisir
    if (edgeLine) { overlay.remove(edgeLine); edgeLine.geometry.dispose(); }
    const eGeo = new THREE.BufferGeometry();
    edgePos = new Float32Array((CURT_SEG + 1) * 2 * 3);
    eGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
    const eIdx = [];
    for (let i = 0; i < CURT_SEG; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      eIdx.push(a, b, c, b, d, c);
    }
    eGeo.setIndex(eIdx);
    edgeLine = new THREE.Mesh(eGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffd0c4'), side: THREE.DoubleSide,
      transparent: true, opacity: 1, depthWrite: false,
    }));
    overlay.add(edgeLine);

    updateScan();
  }

  function updateScan() {
    if (!region || !curtainPos || !gray) return;
    const b = region.bounds;
    const p = state.progress;
    const lng = b.west + (b.east - b.west) * p;
    const col = clamp(Math.round(p * (SF_FRAMES - 1)), 0, SF_FRAMES - 1);
    // sutunun genel siddeti -> cizgi kalinligi/parlakligi
    let colMax = 1e-6;
    for (let r = 0; r < SF_BINS; r++) { const v = gray[r * SF_FRAMES + col]; if (v > colMax) colMax = v; }

    for (let i = 0; i <= CURT_SEG; i++) {
      const f = i / CURT_SEG;
      const lat = b.north + (b.south - b.north) * f;
      // gorsel satiri: 0 = ust = kuzey
      const row = clamp(Math.round(f * (SF_BINS - 1)), 0, SF_BINS - 1);
      const amp = gray[row * SF_FRAMES + col];               // 0..1 parlaklik = tepe yuksekligi
      const h = R_LINE + 0.6 + amp * CURT_MAX_H;

      const pIn = latLngToVec(lat, lng, R_LINE);
      const pOut = latLngToVec(lat, lng, h);
      const o = i * 6;
      curtainPos[o] = pIn.x; curtainPos[o + 1] = pIn.y; curtainPos[o + 2] = pIn.z;
      curtainPos[o + 3] = pOut.x; curtainPos[o + 4] = pOut.y; curtainPos[o + 5] = pOut.z;
      // ust kenar: ayni yukseklikte, ince serit (kure yuzeyine dik genislik)
      if (edgePos) {
        const w = latLngToVec(lat, lng + 0.12, h);
        edgePos[o] = w.x; edgePos[o + 1] = w.y; edgePos[o + 2] = w.z;
        const w2 = latLngToVec(lat, lng - 0.12, h);
        edgePos[o + 3] = w2.x; edgePos[o + 4] = w2.y; edgePos[o + 5] = w2.z;
      }
    }
    curtainGeo.attributes.position.needsUpdate = true;
    if (edgeLine) edgeLine.geometry.attributes.position.needsUpdate = true;
    curtainGeo.computeBoundingSphere();
    curtain.material.opacity = 0.12 + 0.20 * colMax;   // sadece ince bir doku; asil okunan ust cizgi
  }

  // ---------- ana dongu ----------
  let lastFrame = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    // birakinca momentum: dokunmatikte/uzaktan farede donus "yapis yapis" kalmasin
    if (!pointers.size && (inertT || inertP)) {
      if (pinched || Math.abs(inertT) + Math.abs(inertP) < FLING_MIN * 0.5) { inertT = 0; inertP = 0; }
      else {
        applyRot(inertT * dt, inertP * dt);
        const f = Math.exp(-SPIN_FRICTION * dt);
        inertT *= f; inertP *= f;
      }
    }

    if (!pointers.size && !state.playing) {
      const idle = now - lastInteract;
      if (idle > IDLE_DELAY) {
        const w = clamp((dist - SPIN_STOP_DIST) / (SPIN_FULL_DIST - SPIN_STOP_DIST), 0, 1);
        if (w > 0.001) {
          const a = IDLE_SPEED * w * dt;
          const up = new THREE.Vector3(0, 1, 0);
          camDir.applyAxisAngle(up, a);
          camUp.applyAxisAngle(up, a);
          camUp.addScaledVector(camDir, -camUp.dot(camDir)).normalize();
          applyCamera();
        }
      }
    }
    if (state.playing) updateScan();
    globe.setPointOfView(camera);
    renderer.render(scene, camera);
  }
  animate();

  // ---------- boyut ----------
  function resize() {
    const s = size();
    if (!s.w || !s.h) return;
    camera.aspect = s.w / s.h;
    camera.updateProjectionMatrix();
    renderer.setSize(s.w, s.h);
  }
  window.addEventListener('resize', resize);
  // GIZLI sayfada olusturulunca container 0x0 olcuyor (canvas 1x1 kaliyordu):
  // sayfa gorunur olunca ResizeObserver devreye girsin. Deck'ten kaset secip
  // 3D PLANET'e gecince "kure yok" sorunu buydu.
  try { new ResizeObserver(() => resize()).observe(container); } catch (e) {}
  setTimeout(resize, 60);
  setTimeout(resize, 400);

  // ---------- disari acilan API ----------
  // 512px karonun kapsadigi aciklik: 720 / 2^z derece
  function pickZoom() {
    const alt = Math.max(1, dist - GLOBE_R);
    const target = clamp(alt * 0.06, 2.5, 22);   // hedef: ~ekranin 1/8'i kadar alan
    for (let z = 3; z <= 8; z++) {
      if (720 / Math.pow(2, z) <= target) return z;
    }
    return 8;
  }

  // Kasetler icin: NASA veri setinden gelen hazir canvas'i sonifiye et
  async function sonifyFromCanvas(canvas, meta = {}) {
    const span = meta.span || 30;
    const lat = meta.lat != null ? meta.lat : 0;
    const lng = meta.lng != null ? meta.lng : 0;
    const half = span / 2;
    region = {
      canvas,
      tile: { z: 0, x: 0, y: 0, source: meta.name || 'nasa' },
      bounds: {
        west: Math.max(-179, lng - half), east: Math.min(179, lng + half),
        north: Math.min(85, lat + half), south: Math.max(-85, lat - half),
      },
      lat, lng,
    };
    channel = canvas;
    state.lat = lat; state.lng = lng;
    render();
    if (meta.label) { state.meta = meta.label + ' · ' + state.meta; emit(); }
    return region;
  }

  async function sonifyAt(lat, lng, autoPlay = true) {
    state.meta = 'loading tile...'; emit();
    const m = await mosaic(lat, lng, pickZoom());
    region = { canvas: m.canvas, tile: m.tile, bounds: m.bounds, lat, lng };
    channel = region.canvas;
    state.lat = lat; state.lng = lng;
    render();
    if (autoPlay) play();
    return region;
  }

  return {
    scene, camera, renderer, globe,
    sonifyAt,
    sonifyFromCanvas,
    play, stop,
    setEngine(e) { state.engine = e === 'v2' ? 'v2' : 'v3'; if (region) render(); },
    setParams(p) { Object.assign(SFP, p); if (region) render(); },
    getRegion: () => region,
    getState: () => ({ ...state, dist: dist, zoomPicked: pickZoom() }),
    // QA/olcum icin: kamera yonu ve mesafe (dondurme testleri bunu okur)
    getCam: () => ({ x: camDir.x, y: camDir.y, z: camDir.z, dist }),
    onState(fn) { listeners.onState = fn; emit(); },
    canvasEl: () => region && region.canvas,
    flyTo(lat, lng) {
      const target = latLngToVec(lat, lng, 1).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(camDir, target);
      const step = new THREE.Quaternion().identity().slerp(q, 0.16);
      camDir.applyQuaternion(step);
      camUp.applyQuaternion(step);
      camUp.addScaledVector(camDir, -camUp.dot(camDir)).normalize();
      applyCamera();
    },
    setDist(d) { dist = clamp(d, MIN_DIST, MAX_DIST); applyCamera(); },
    resize,
  };
}
