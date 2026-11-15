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
    img.alt = `${def.name}, ${def.sub}, era ${tape.year}. The image is this dataset read as a spectrogram.`;
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
  // arama sonucu: kure o noktaya ucar ve o bolgeyi calar
  go: async (lat, lng) => {
    const g = await mount();
    g.flyTo(lat, lng);
    return g.sonifyAt(lat, lng, true);
  },
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


/* ---------------- yer arama (3D PLANET) ----------------
   Cevrimdisi calisir: data/cities.json (GeoNames, nufus 100.000+ ve tum TR sehirleri).
   Klavye + ekran okuyucu: combobox + listbox, oklar/Enter/Escape. */
(function initPlaceSearch() {
  const input = document.getElementById('globeSearchInput');
  const list = document.getElementById('globeSearchList');
  if (!input || !list) return;

  let cities = null;
  let loading = null;
  let results = [];
  let active = -1;

  // aksan/Turkce farki olmasin: İstanbul == istanbul, Şanlıurfa == sanliurfa
  const TR = { 'ı': 'i', 'İ': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };
  const norm = (s) => (s || '').toLowerCase().replace(/[ıİşğüöçâîû]/g, (m) => TR[m] || m)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();

  async function ensureCities() {
    if (cities) return cities;
    if (!loading) {
      loading = fetch('./data/cities.json').then((r) => r.json()).then((rows) => {
        cities = rows.map((c) => ({ ...c, k: norm(c.n) }));
        return cities;
      }).catch(() => []);
    }
    return loading;
  }

  function announce(msg) {
    const live = document.getElementById('srLive');
    if (live) live.textContent = msg;
  }

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    results = [];
  }

  function render() {
    list.innerHTML = results.map((c, i) => `
      <li role="option" id="cs-${i}" data-i="${i}" aria-selected="${i === active}">
        ${c.n} <span class="cs-country">${c.c}</span>
      </li>`).join('');
    list.hidden = !results.length;
    input.setAttribute('aria-expanded', results.length ? 'true' : 'false');
    if (active >= 0) input.setAttribute('aria-activedescendant', `cs-${active}`);
    else input.removeAttribute('aria-activedescendant');
    list.querySelectorAll('li').forEach((li) => {
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(+li.dataset.i); });
    });
  }

  async function search(q) {
    const key = norm(q);
    if (key.length < 2) { close(); return; }
    const all = await ensureCities();
    const scored = [];
    for (const c of all) {
      const at = c.k.indexOf(key);
      if (at < 0) continue;
      scored.push({ c, s: (c.k === key ? 0 : at === 0 ? 1 : 2) * 1e9 - c.p });
    }
    scored.sort((a, b) => a.s - b.s);
    results = scored.slice(0, 6).map((x) => x.c);
    active = results.length ? 0 : -1;
    render();
    if (results.length) announce(`${results.length} places found. ${results[0].n}, ${results[0].c}. Press Enter.`);
    else announce('No place found.');
  }

  async function pick(i) {
    const c = results[i];
    if (!c) return;
    close();
    input.value = c.n;
    announce(`Loading ${c.n}, ${c.c}.`);
    try {
      await window.JukeGlobe.go(c.lat, c.lon);
      announce(`Playing ${c.n}, ${c.c}.`);
    } catch (e) {
      announce(`Could not load ${c.n}.`);
    }
  }

  let t = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => search(input.value), 130);
  });
  input.addEventListener('focus', () => ensureCities());

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      render();
      announce(`${results[active].n}, ${results[active].c}`);
    } else if (e.key === 'Enter') {
      if (!results.length) return;
      e.preventDefault();
      pick(active < 0 ? 0 : active);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 120));

  // '/' ile arama kutusuna atla (klavye kullanicilari icin)
  document.addEventListener('keydown', (e) => {
    const globe = document.getElementById('pageGlobe');
    if (!globe || !globe.classList.contains('active')) return;
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
  });
})();

window.addEventListener('load', () => {
  let wasPlaying = false;
  document.addEventListener('juke:state', (e) => {
    // playhead + ilerleme cubugunu app.js syncProgress() suruyor (tek yazici).
    // Burada ikinci kez yazmak cubuk ile cizgiyi ayri karelerde oynatiyordu.
    const st = $('statusLight');
    if (st) st.classList.toggle('active', e.detail.playing);
    // ekran okuyucu: sadece durum DEGISINCE duyur, her karede degil
    if (!!e.detail.playing !== wasPlaying) {
      wasPlaying = !!e.detail.playing;
      const live = $('srLive');
      if (live) live.textContent = wasPlaying ? 'Playing.' : 'Stopped.';
    }
  });
});
