// boot.js — modül tarafı: gerçek 3D küreyi kurar, HUD ve deck ile bağlar.
import { create } from './globe3d.js';
import { TAPES, loadTapeSource } from './sources.js';

const $ = (id) => document.getElementById(id);

window.NASA_TAPES = TAPES;   // app.js kaset listesini bundan uretir

let api = null;
let mounting = null;

async function mount() {
  if (api) { resizeSoon(); return api; }
  if (mounting) return mounting;
  const container = $('globeContainer');
  if (!container) return null;
  mounting = (async () => {
    api = await create(container);
    window.__globe = api;
    window.NASA_TAPES = TAPES;
    resizeSoon();

    api.onState((s) => {
      const c = $('hudCoords'), m = $('hudMeta');
      if (c) c.textContent = s.lat == null ? '— click the globe —' : `${s.lat.toFixed(2)}°, ${s.lng.toFixed(2)}°`;
      if (m) m.textContent = s.meta || 'waiting for a tape';
      const pb = $('globePlay');
      if (pb) pb.classList.toggle('on', s.playing);
      document.dispatchEvent(new CustomEvent('juke:state', { detail: s }));
    });
    return api;
  })();
  return mounting;
}

function resizeSoon() {
  setTimeout(() => window.dispatchEvent(new Event('resize')), 120);
}

// --- kaset -> NASA veri seti -> ses -------------------------------------
async function loadTape(tape) {
  const g = await mount();
  if (!g) return null;

  const def = TAPES.find((t) => t.key === tape.key) || TAPES[0];
  const meta = $('deckMeta');
  if (meta) meta.textContent = `${def.name} · ${def.sub} · loading data...`;

  // küreyi ilgili bölgeye uçur
  if (def.lat != null) g.flyTo(def.lat, def.lng);

  let src;
  try {
    src = await loadTapeSource(def, tape.year);
  } catch (e) {
    if (meta) meta.textContent = `${def.name} · data unavailable (${e.message || e})`;
    return null;
  }

  const region = await g.sonifyFromCanvas(src.canvas, {
    lat: def.lat, lng: def.lng, span: def.span,
    name: def.key, label: `${def.name} · ${def.sub}${src.info ? ' · ' + src.info : ''}`,
  });

  // deck penceresine o veri setinin görüntüsü
  const img = $('deckImage');
  if (img && region) {
    img.src = region.canvas.toDataURL('image/jpeg', 0.85);
    const view = $('deckView');
    if (view) view.classList.add('on');
  }
  if (meta) meta.textContent = `${def.name} · ${def.sub} · ${src.info || ''} · press PLAY`;
  window.JukeGlobe.lastTape = { key: def.key, year: tape.year, usedYear: src.yearUsed || tape.year, info: src.info || '' };
  document.dispatchEvent(new CustomEvent('juke:tape', { detail: { ...tape, def, region, usedYear: src.yearUsed || tape.year } }));
  return region;
}

window.JukeGlobe = {
  mount,
  resize: () => { if (api && api.resize) api.resize(); },
  loadTape,
  play: async () => { const g = await mount(); g.play(); },
  stop: () => api && api.stop(),
  sonifyAt: async (lat, lng) => { const g = await mount(); return g.sonifyAt(lat, lng, true); },
  setEngine: (e) => { if (api) api.setEngine(e); },
  get api() { return api; },
  tapes: TAPES,
};

document.addEventListener('DOMContentLoaded', () => {
  const play = $('globePlay'), stop = $('globeStop'), eng = $('globeEngine');
  const zin = $('globeZoomIn'), zout = $('globeZoomOut');
  if (zin) zin.onclick = async () => { const g = await mount(); g.setDist(g.getState().dist * 0.72); };
  if (zout) zout.onclick = async () => { const g = await mount(); g.setDist(g.getState().dist * 1.39); };
  if (play) play.onclick = async () => { const g = await mount(); g.play(); };
  if (stop) stop.onclick = () => api && api.stop();
  if (eng) eng.onclick = async () => {
    const g = await mount();
    const next = g.getState().engine === 'v3' ? 'v2' : 'v3';
    g.setEngine(next);
    eng.textContent = 'motor: ' + next;
  };
});

window.addEventListener('load', () => {
  document.addEventListener('juke:state', (e) => {
    // playhead + ilerleme cubugunu app.js syncProgress() suruyor (tek yazici).
    // Burada ikinci kez yazmak cubuk ile cizgiyi ayri karelerde oynatiyordu.
    const st = $('statusLight');
    if (st) st.classList.toggle('active', e.detail.playing);
  });
});
