// ==========================================================================
// 1. GLOBAL DEĞİŞKENLER & DURUM YÖNETİMİ
// ==========================================================================
let renderer, camera, scene, earthMesh;
let globeInitialized = false;

let isDraggingCarousel = false;
let startDragX = 0;

// ==========================================================================
// 2. SAYFA GEÇİŞ SİSTEMİ (TAB SWITCHER)
// ==========================================================================
function switchPage(pageName) {
  const pages = {
    intro: document.getElementById('pageIntro'),
    deck: document.getElementById('pageDeck'),
    globe: document.getElementById('pageGlobe'),
    cards: document.getElementById('pageCards'),
    gallery: document.getElementById('pageGallery'),
    howto: document.getElementById('pageHowto'),
    faq: document.getElementById('pageFaq')
  };

  const navBtns = {
    deck: document.getElementById('navDeckBtn'),
    globe: document.getElementById('navGlobeBtn'),
    cards: document.getElementById('navCardsBtn'),
    gallery: document.getElementById('navGalleryBtn'),
    howto: document.getElementById('navHowBtn'),
    faq: document.getElementById('navFaqBtn')
  };

  // Tüm sayfaları ve buton vurgularını temizle
  Object.keys(pages).forEach(key => {
    if (pages[key]) pages[key].classList.remove('active');
    if (navBtns[key]) navBtns[key].classList.remove('active');
  });

  // Seçilen sayfayı ve ilgili butonu aktifleştir
  if (pages[pageName]) pages[pageName].classList.add('active');
  if (navBtns[pageName]) navBtns[pageName].classList.add('active');

  // aria-current="page": aktif baglanti renkle degil, tam cizgi + kalin etiketle de belli olsun
  Object.keys(navBtns).forEach(key => {
    const b = navBtns[key];
    if (!b) return;
    if (key === pageName) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  // odak yonetimi: ekran okuyucu yeni sayfanin basina gelsin
  const mainEl = document.getElementById('main');
  if (mainEl && pages[pageName]) {
    mainEl.focus({ preventScroll: true });
    const h = pages[pageName].querySelector('h1');
    if (h) announce(h.textContent.replace(/\s+/g, ' ').trim() + ' page');
  }

  // mobil sheet'i kapat
  const links = document.getElementById('navLinks'), menuBtn = document.getElementById('navMenuBtn');
  if (links) links.classList.remove('open');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');

  // 3D Dünya sayfasına geçildiyse kureyi kur ve MUTLAKA yeniden olcekle.
  // Kure deck'te kaset secilirken gizli kapta (0x0) kuruluyor; o yuzden canvas 1x1
  // kaliyor ve sayfaya gecince "kure yok" gorunuyordu. Artik her geciste zorla resize.
  if (pageName === 'globe') {
    if (!globeInitialized) initEarthGlobe();
    const kick = () => {
      const jg = window.JukeGlobe;
      if (!jg) return;
      const api = jg.api;
      if (api && api.resize) api.resize();
    };
    [0, 60, 200, 500, 1000].forEach((ms) => setTimeout(kick, ms));
  }
}

// ==========================================================================
// 3. THREE.JS 3D DÜNYA KÜRESİ VE DOKU OLUŞTURUCU
// ==========================================================================
function initEarthGlobe() {
  // Prosedürel "yeşil leke" küre kaldırıldı.
  // Gerçek uydu küresi + sonifikasyon: globe3d.js (boot.js üzerinden yüklenir)
  if (!window.JukeGlobe) { console.warn('JukeGlobe module missing'); return; }
  globeInitialized = true;
  window.JukeGlobe.mount();
}

// ==========================================================================
// 4. KASET YAYI (ceyrek daire) & DECK MEKANIZMASI
// ==========================================================================
let deckArc = null;                       // DOMContentLoaded icinde kurulur
let currentSelectedYear = '2020';

function selectYearAndOpenDeck(year) {
  currentSelectedYear = year;
  if (deckArc) deckArc.load(year);
  switchPage('deck');
}

function loadCassettesForYear(year) {
  currentSelectedYear = year;
  if (deckArc) deckArc.load(year);
}

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const deckDoor = $('deckDoor'), deckView = $('deckView');
  const trackDisplay = $('trackDisplay'), slotPlaceholder = $('slotPlaceholder');
  const statusLight = $('statusLight'), btnPlay = $('btnPlay'), btnStop = $('btnStop');
  const deckMeta = $('deckMeta');
  const arcStrip = $('arcStrip'), arcPrev = $('arcPrev'), arcNext = $('arcNext');

  /* --- yay geometrisi --- */
  const STEP = 15;        // derece / kaset
  const ARC_AX = 1050;    // yatay yaricap (kartlar arasi ~272px)
  const ARC_BY = 200;     // dikey yaricap (yay yuksekligi - yumusak)
  const ARC_DY = -6;      // tepe noktasi

  let items = [];         // {el, tp, idx}
  let year = currentSelectedYear;
  let shift = 0, targetShift = 0, shownIdx = -1;
  let insertedIdx = -1;
  let dragging = false, dragX = 0, dragShift = 0, dragMoved = 0;
  let suppressClick = false;
  let mouse = { x: .5, y: .5 };
  let raf = null;

  // surukleme sirasinda yumusak lastik pay birakir, birakinca ilk/son kasete kener
  const clampShift = (v) => Math.max(-2.5, Math.min(items.length - 1 + 2.5, v));
  const snapShift = (v) => Math.max(0, Math.min(items.length - 1, Math.round(v)));


  /* ---------- A24 tarzi kaset yuzu (duz etiket, serif baslik, ince cizgiler) ---------- */
  const ARC_PALETTE = [
    { c: '#7d8a4f', r: '#2a2f1c', a: '#efe9d6' },
    { c: '#b9ad8e', r: '#5c5342', a: '#f6f1e2' },
    { c: '#4c6f74', r: '#18292c', a: '#e5eeea' },
    { c: '#a83a2a', r: '#3d120c', a: '#f3ddd4' },
    { c: '#b4703a', r: '#4a2812', a: '#f2ddc6' },
    { c: '#3f4a45', r: '#161b18', a: '#dee5dc' },
    { c: '#6b5a8c', r: '#241d36', a: '#eae4f2' },
    { c: '#8d7d5f', r: '#39301f', a: '#f4eddd' },
  ];

  const shade = (hex, pct) => {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r * (100 + pct) / 100)));
    g = Math.max(0, Math.min(255, Math.round(g * (100 + pct) / 100)));
    b = Math.max(0, Math.min(255, Math.round(b * (100 + pct) / 100)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  function reelSVG(cx, cy, id) {
    const spokes = [0, 60, 120, 180, 240, 300].map(a => {
      const r1 = 9, r2 = 19,
        x1 = cx + r1 * Math.cos(a * Math.PI / 180), y1 = cy + r1 * Math.sin(a * Math.PI / 180),
        x2 = cx + r2 * Math.cos(a * Math.PI / 180), y2 = cy + r2 * Math.sin(a * Math.PI / 180);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#7e7b73" stroke-width="2"/>`;
    }).join('');
    return `
      <g class="reel-g">
        <circle cx="${cx}" cy="${cy}" r="22" fill="url(#hub${id})"/>
        <circle cx="${cx}" cy="${cy}" r="22" fill="none" stroke="#000" stroke-opacity=".18"/>
        <circle cx="${cx}" cy="${cy}" r="9" fill="#2c2b27"/>
        <circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="#000" stroke-opacity=".35"/>
        ${spokes}
      </g>`;
  }

  function cassetteSVG(tp, i) {
    const p = ARC_PALETTE[i % ARC_PALETTE.length];
    const W = 300, H = 170;
    const title = (tp.name || tp.key).toUpperCase();
    const meta = `${tp.key} · ${year}`;
    return `
    <svg class="tape-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g${i}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${shade(p.c, 8)}"/>
          <stop offset="1" stop-color="${shade(p.c, -16)}"/>
        </linearGradient>
        <radialGradient id="hub${i}" cx=".36" cy=".32" r=".85">
          <stop offset="0" stop-color="#ffffff"/>
          <stop offset=".55" stop-color="#d9d5cc"/>
          <stop offset="1" stop-color="#9d9a92"/>
        </radialGradient>
      </defs>

      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="8" fill="url(#g${i})"/>
      <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="8" fill="none" stroke="#000" stroke-opacity=".22"/>

      <!-- etiket -->
      <rect x="20" y="13" width="${W - 40}" height="56" rx="2" fill="${p.a}"/>
      <rect x="20" y="13" width="${W - 40}" height="56" rx="2" fill="none" stroke="${shade(p.c, -30)}" stroke-opacity=".35"/>
      <text x="30" y="38" font-family="Georgia, 'Times New Roman', serif" font-size="17" fill="#1b1b18">${title}</text>
      <line x1="30" y1="47" x2="${W - 30}" y2="47" stroke="${shade(p.c, -28)}" stroke-opacity=".45" stroke-width="1"/>
      <text x="30" y="60" font-family="Helvetica, Arial, sans-serif" font-size="7.5" letter-spacing="1.6" fill="#4a4740">HIGH BIAS · TYPE II</text>
      <text x="${W - 30}" y="60" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="7.5" letter-spacing="1.4" fill="#4a4740">${meta}</text>

      <!-- bant penceresi -->
      <rect x="20" y="76" width="${W - 40}" height="62" rx="3" fill="#141412"/>
      <rect x="27" y="83" width="${W - 54}" height="48" rx="2" fill="${p.r}"/>
      ${reelSVG(W / 2 - 48, 107, i)}
      ${reelSVG(W / 2 + 48, 107, i)}
      <rect x="${W / 2 - 38}" y="84" width="76" height="5" fill="#0d0d0b" opacity=".8"/>
      <rect x="${W / 2 - 38}" y="125" width="76" height="5" fill="#0d0d0b" opacity=".8"/>

      <!-- alt satir -->
      <text x="${W / 2}" y="156" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="7" letter-spacing="2.4" fill="${p.a}" opacity=".85">${tp.sub ? tp.sub.toUpperCase() : ''}</text>
      <circle cx="12" cy="${H - 12}" r="2.4" fill="#fff" opacity=".22"/>
      <circle cx="${W - 12}" cy="${H - 12}" r="2.4" fill="#fff" opacity=".22"/>
    </svg>`;
  }

  // ekran okuyucu duyurusu: tek bir canli bolge, hizli degisimlerde spam yapmaz
  let announceTimer = 0;
  function announce(msg) {
    const live = document.getElementById('srLive');
    if (!live) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { live.textContent = msg; }, 220);
  }

  function build(tapes) {
    arcStrip.innerHTML = '';
    items = tapes.map((tp, i) => {
      const el = document.createElement('div');
      el.className = 'arc-card';
      el.innerHTML = `
        <div class="body"><div class="box">
          <div class="face f-back"></div>
          <div class="face f-left"><span class="spine">${String(i + 1).padStart(2, '0')} // ${tp.key}</span></div>
          <div class="face f-right"></div>
          <div class="face f-top"></div>
          <div class="face f-bottom"></div>
          <div class="face f-front"><div class="f-clip">
            ${cassetteSVG(tp, i)}
            <div class="f-gloss"></div>
          </div></div>
        </div></div>`;
      // ekran okuyucu + klavye: kart gercek bir dugme gibi davranir
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label',
        `${tp.name}, ${tp.sub}${tp.from ? ', data from ' + tp.from : ''}. ` +
        'Enter ile ortala ve decke tak.');
      el.addEventListener('click', () => onCardClick(i));
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onCardClick(i); }
      });
      arcStrip.appendChild(el);
      return { el, tp, idx: i };
    });
    shift = targetShift = 0;
    shownIdx = -1;
    insertedIdx = -1;
    if (!raf) loop();
    else render();
  }

  function render() {
    if (!items.length) return;
    const offX = 0;   // tepe noktasi tam ortada, player'in altinda

    items.forEach((it, i) => {
      const k = i - shift;
      const th = k * STEP;
      const rad = th * Math.PI / 180;
      const x = offX + ARC_AX * Math.sin(rad);
      const y = ARC_DY - ARC_BY * (1 - Math.cos(rad));   // saga dogru YUKSELEN yay
      const sc = Math.max(.42, 1 - Math.abs(k) * .07) * 1.0;
      const near = Math.max(0, 1 - Math.abs(k) * .4);
      // mouse her zaman 0..1: baska sayfadayken sapan deger kalirsa kart savrulmasin
      const mx = Math.min(1, Math.max(0, mouse.x));
      const my = Math.min(1, Math.max(0, mouse.y));
      const tiltX = -(my - .5) * 18 * near;
      const tiltY = -(mx - .5) * 22 * near;

      it.el.style.transform =
        `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(th * .8).toFixed(2)}deg) scale(${sc.toFixed(3)})`;
      it.el.style.zIndex = String(500 - Math.round(Math.abs(k) * 20));
      it.el.style.opacity = Math.abs(k) > 4 ? 0 : (insertedIdx === i ? .32 : 1);
      it.el.querySelector('.box').style.transform =
        `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
      it.el.classList.toggle('is-center', Math.round(shift) === i);
      it.el.classList.toggle('in-deck', insertedIdx === i);
    });

    const idx = Math.max(0, Math.min(items.length - 1, Math.round(shift)));
    if (idx !== shownIdx) {
      shownIdx = idx;
      const t0 = items[idx] && items[idx].tp;
      if (t0) announce(`${t0.name}. ${t0.sub}. ${insertedIdx === idx ? 'In the deck.' : 'Press Enter to load it.'}`);
      if (deckMeta && insertedIdx < 0) {
        deckMeta.textContent = `${items[idx].tp.name} · ${items[idx].tp.sub} · click to load the deck`;
      }
      // sol panel HER ZAMAN ortadaki kasete bakar (surukleme/tekerlek/ok, tik gerekmez)
      if (items[idx]) updateInfo(items[idx].tp);
    }
  }

  /* playhead + ilerleme cubugu: kure API'sini dogrudan yokla (event her frame gelmiyor) */
  let lastSync = 0;
  function syncProgress(ts) {
    if (ts - lastSync < 60) return;
    lastSync = ts;
    const g = window.__globe;
    if (!g || !g.getState) return;
    let s;
    try { s = g.getState(); } catch (e) { return; }
    const pr = Math.max(0, Math.min(1, s.progress || 0));
    const head = document.getElementById('deckHead');
    const fill = document.querySelector('.deck-progress i');
    if (head) head.style.left = (pr * 100).toFixed(2) + '%';
    if (fill) fill.style.width = (pr * 100).toFixed(2) + '%';
    const bar = fill && fill.parentElement;
    if (bar) bar.setAttribute('aria-valuenow', Math.round(pr * 100));
    if (statusLight) statusLight.classList.toggle('active', !!s.playing);
    if (btnPlay) btnPlay.classList.toggle('pressed', !!s.playing);
  }

  function loop(ts) {
    // sinirin disinda kalmissa (sol/sag tasma) daha hizli toparla
    const outside = shift < 0 || shift > items.length - 1;
    shift += (targetShift - shift) * (dragging ? .5 : (outside ? .2 : .12));
    if (Math.abs(targetShift - shift) < .001) shift = targetShift;
    render();
    if (ts) syncProgress(ts);
    raf = requestAnimationFrame(loop);
  }

  /* --- deck'e ucus animasyonu + birkac partikul --- */
  function flyIntoDeck(it) {
    const card = it.el.getBoundingClientRect();
    const slot = deckDoor.getBoundingClientRect();
    if (!card.width || !slot.width) return;

    const clone = it.el.cloneNode(true);
    clone.style.cssText =
      `position:fixed;left:${card.left}px;top:${card.top}px;width:${card.width}px;height:${card.height}px;` +
      `margin:0;transform:none;opacity:1;z-index:9999;pointer-events:none;` +
      `transition:transform .62s cubic-bezier(.45,0,.25,1), opacity .62s ease;`;
    document.body.appendChild(clone);

    const dx = (slot.left + slot.width / 2) - (card.left + card.width / 2);
    const dy = (slot.top + slot.height / 2) - (card.top + card.height / 2);
    const k = Math.min(slot.width / card.width, slot.height / card.height) * 0.9;

    clone.getBoundingClientRect();            // reflow: transition kacmasin

    deckDoor.classList.add('receiving');
    setTimeout(() => deckDoor.classList.remove('receiving'), 700);

    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(${k}) rotate(0deg)`;
    });
    setTimeout(() => { clone.style.opacity = '0'; }, 520);
    setTimeout(() => clone.remove(), 760);

    spawnParticles(card);
  }

  function spawnParticles(card) {
    const cx = card.left + card.width / 2;
    const cy = card.top + card.height / 2;
    for (let n = 0; n < 12; n++) {
      const p = document.createElement('i');
      p.className = 'tape-particle';
      const ang = -Math.PI / 2 + (Math.random() - .5) * 1.7;
      const dist = 70 + Math.random() * 130;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--sz', (2 + Math.random() * 3).toFixed(1) + 'px');
      p.style.animationDelay = (Math.random() * .12).toFixed(2) + 's';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1100);
    }
  }

  /* --- yil secici --- */
  const deckYears = $('deckYears');
  if (deckYears) {
    deckYears.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-year]');
      if (!b) return;
      const y = b.dataset.year;
      deckYears.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      selectYearAndOpenDeck(y);
    });
  }

  /* --- sol bilgi paneli: secili kasetin konusu --- */
  const diLabel = $('diLabel'), diName = $('diName'), diSrc = $('diSrc');
  const diAbout = $('diAbout'), diEra = $('diEra'), diSpan = $('diSpan');
  const thisYear = new Date().getFullYear();

  function updateInfo(tp, opts) {
    const o = opts || {};
    if (diName) diName.textContent = tp ? tp.name : 'NO TAPE';
    if (diSrc) diSrc.textContent = tp ? tp.sub : '';
    if (diAbout) diAbout.textContent = tp ? (o.note || tp.about || '') : 'Centre a cassette to read what it measures.';
    if (diLabel) diLabel.textContent = o.inDeck ? 'IN THE DECK' : 'ARCHIVE TAPE';
    if (diEra) {
      const ey = o.year || year || currentSelectedYear;
      const extra = o.dataYear && String(o.dataYear) !== String(ey) ? ` · DATA ${o.dataYear}` : '';
      diEra.textContent = `ERA ${ey}${extra}`;
    }
    if (diSpan) {
      if (!tp) diSpan.textContent = '';
      else diSpan.textContent = tp.from ? `${tp.from} to ${thisYear}` : `TO ${thisYear}`;
    }
  }
  window.updateDeckInfo = updateInfo;

  /* --- deck islemleri --- */
  async function insertTape(i) {
    const it = items[i];
    if (!it || insertedIdx === i) return;
    if (insertedIdx >= 0) ejectTape(false);

    insertedIdx = i;
    flyIntoDeck(it);

    if (slotPlaceholder) slotPlaceholder.style.display = 'none';
    if (deckView) deckView.classList.remove('on');
    updateInfo(it.tp, { inDeck: true, note: 'Loading the layer from NASA...' });
    if (trackDisplay) trackDisplay.innerText = `LOADING: ${it.tp.key} ${year}`;
    if (deckMeta) deckMeta.textContent = `${it.tp.name} · ${it.tp.sub} · loading data...`;
    render();

    if (window.JukeGlobe) {
      const r = await window.JukeGlobe.loadTape({ key: it.tp.key, year });
      if (trackDisplay) trackDisplay.innerText = r ? `READY: ${it.tp.name}` : `ERROR: no data for ${it.tp.key}`;
      const lt = window.JukeGlobe.lastTape;
      const used = lt && lt.usedYear ? String(lt.usedYear) : String(year);
      updateInfo(it.tp, r
        ? { inDeck: true, dataYear: used }
        : { inDeck: true, note: 'No data for this era on the NASA tile server.' });
      if (deckMeta) deckMeta.textContent = r
        ? `${it.tp.name} · ${it.tp.sub} · press PLAY`
        : `${it.tp.name} · data unavailable`;
    }
  }

  function ejectTape(verbose) {
    const mini = deckDoor.querySelector('.deck-tape-label');
    if (mini) mini.remove();   // (yeni tasarimda yok)
    insertedIdx = -1;
    if (slotPlaceholder) slotPlaceholder.style.display = 'block';
    if (deckView) deckView.classList.remove('on');
    btnPlay.classList.remove('pressed');
    btnStop.classList.remove('pressed');
    statusLight.classList.remove('active');
    if (window.JukeGlobe) window.JukeGlobe.stop();
    updateInfo(items[Math.max(0, Math.min(items.length - 1, Math.round(shift)))]?.tp);
    if (verbose) {
      if (trackDisplay) trackDisplay.innerText = 'EJECTED - NO CASSETTE';
      if (deckMeta) deckMeta.textContent = 'kaseti ortala, click it to load the deck';
    }
    render();
  }

  /* --- tikla: ortala, ortadaysa deck'e tak (ilk/son tik mantigi) --- */
  function onCardClick(i) {
    if (suppressClick) { suppressClick = false; return; }   // suruklemeydi
    if (Math.round(shift) === i) insertTape(i); // zaten merkezde -> deck'e tak
    else targetShift = clampShift(i);           // once ortala
  }

  /* --- surukle / tekerlek / tuslar --- */
  arcStrip.addEventListener('pointerdown', (e) => {
    dragging = true; dragX = e.clientX; dragShift = targetShift; dragMoved = 0;
  });
  window.addEventListener('pointermove', (e) => {
    const r = arcStrip.getBoundingClientRect();
    // yay gizliyken (3D PLANET / baska sayfa) rect 0 olcuyor -> mouse 900'lere firlayip
    // kartlari rotateX(-7551deg) gibi absurt acilara savuruyordu. Olcum gecerliyse yaz.
    if (r.width > 2 && r.height > 2) {
      mouse.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      mouse.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    }
    if (!dragging) return;
    const dx = e.clientX - dragX;
    dragMoved = Math.max(dragMoved, Math.abs(dx));
    targetShift = clampShift(dragShift - dx / 240);   // 240px ~ bir kaset
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    suppressClick = dragMoved > 8;
    dragMoved = 0;
    targetShift = snapShift(targetShift);      // sola/saga tasmissa ilk ya da son kasete otur
  });
  window.addEventListener('pointercancel', () => { dragging = false; });

  arcStrip.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    targetShift = snapShift(targetShift + d / 220);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (!document.getElementById('pageDeck').classList.contains('active')) return;
    if (e.key === 'ArrowRight') targetShift = snapShift(targetShift + 1);
    if (e.key === 'ArrowLeft') targetShift = snapShift(targetShift - 1);

    // klavye ile deck kullanimi: Enter = ortadaki kaseti tak, Escape = cikar
    const onControl = e.target && e.target.closest && e.target.closest('button, [role="button"], input, select, a');
    if (e.key === 'Enter' && !onControl) {
      e.preventDefault();
      if (insertedIdx >= 0) btnPlay.click();
      else onCardClick(Math.max(0, Math.min(items.length - 1, Math.round(shift))));
    }
    if (e.key === 'Escape' && insertedIdx >= 0) { e.preventDefault(); ejectTape(true); }
  });

  /* --- deck butonlari --- */
  btnPlay.addEventListener('click', () => {
    if (insertedIdx < 0) {
      trackDisplay.innerText = 'ERROR: INSERT A CASSETTE FIRST';
      return;
    }
    btnPlay.classList.add('pressed');
    btnStop.classList.remove('pressed');
    statusLight.classList.add('active');
    deckDoor.querySelector('.deck-tape-label')?.classList.add('playing');
    trackDisplay.innerText = `▶ PLAYING: ${items[insertedIdx].tp.name}`;
    if (window.JukeGlobe) window.JukeGlobe.play();
  });

  btnStop.addEventListener('click', () => {
    if (insertedIdx < 0) return;
    btnPlay.classList.remove('pressed');
    btnStop.classList.add('pressed');
    setTimeout(() => btnStop.classList.remove('pressed'), 150);
    statusLight.classList.remove('active');
    deckDoor.querySelector('.deck-tape-label')?.classList.remove('playing');
    trackDisplay.innerText = `■ STOPPED: ${items[insertedIdx].tp.name}`;
    if (window.JukeGlobe) window.JukeGlobe.stop();
  });

  /* deck yuvasina tiklayinca kaset cikar */
  deckDoor.addEventListener('click', () => { if (insertedIdx >= 0) ejectTape(true); });

  /* --- disari acilan API --- */
  deckArc = {
    load(y) {
      year = y;
      const allTapes = window.NASA_TAPES || [];
      const yy0 = parseInt(y, 10) || 2020;
      const avail = allTapes.filter(t => !t.from || t.from <= yy0);
      if (trackDisplay) trackDisplay.innerText = `ERA ${y} READY - INSERT TAPE`;
      if (deckYears) deckYears.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.year === String(y)));
      updateInfo(null, { year: y });
      const tapes = avail;   // o yil icin verisi olmayan kasetler rafta gorunmez
      if (insertedIdx >= 0) {
        insertedIdx = -1;
        if (deckView) deckView.classList.remove('on');
        if (slotPlaceholder) slotPlaceholder.style.display = 'block';
      }
      build(tapes);
      if (!tapes.length && trackDisplay) trackDisplay.innerText = `NO DATA FOR ERA ${y}`;
      if (!tapes.length) updateInfo(null, { year: y, note: 'No datasets for this era.' });
    }
  };

  /* --- mobil menu (sheet) --- */
  const menuBtn = $('navMenuBtn'), navLinks = $('navLinks');
  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* --- tiklanabilir kartlari klavye/ekran okuyucu icin dugme yap --- */
  function upgradeClickables() {
    const els = document.querySelectorAll('.carousel-item, #cardContent section');
    els.forEach((el) => {
      if (el.dataset.a11y) return;
      el.dataset.a11y = '1';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      if (!el.getAttribute('aria-label')) {
        const label = (el.querySelector('.year-number') && el.querySelector('.year-number').textContent)
          || (el.querySelector('.title') && el.querySelector('.title').textContent) || el.textContent.trim().slice(0, 40);
        el.setAttribute('aria-label', label.trim() + '. Open.');
      }
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); }
      });
    });
  }
  upgradeClickables();

  /* --- 3D GALLERY: her yil kartindaki kaset sayisi TAPES'ten gelsin (sabit "4" yanlisti) --- */
  function syncGalleryCounts() {
    const tapes = window.NASA_TAPES || [];
    if (!tapes.length) return;
    document.querySelectorAll('.carousel-item').forEach((li) => {
      const yEl = li.querySelector('.year-number');
      const sub = li.querySelector('.year-sub');
      const y = parseInt(yEl && yEl.textContent, 10);
      if (!y || !sub) return;
      const n = tapes.filter((t) => !t.from || t.from <= y).length;
      sub.textContent = n === 1 ? '1 DATA TAPE' : `${n} DATA TAPES`;
    });
  }
  syncGalleryCounts();
  window.addEventListener('load', syncGalleryCounts);

  // Bilgi kartlari karusel fizigi
  initCardCarousel();

  // ilk yukleme (NASA_TAPES modulden gelir; henuz yoksa load'da tekrar dene)
  deckArc.load(currentSelectedYear);
  window.addEventListener('load', () => { if (!items.length) deckArc.load(currentSelectedYear); });
});

// ==========================================================================
// 5. BİLGİ KARTLARI KARUSELİ (5 KARTLIK MOMENTUM VE KENETLENME)
// ==========================================================================
function initCardCarousel() {
  const contentEl = document.getElementById("cardContent");
  const pageCards = document.getElementById("pageCards");
  if (!contentEl || !pageCards) return;

  const totalCards = contentEl.querySelectorAll("section").length;

  let mousePos = { x: 0, y: 0 };
  let lastMousePos = { x: 0, y: 0 };
  let isMouseDown = false;

  let scrollPosition = 0;
  let targetPosition = 0;
  let targetVelocity = 0;

  // Fare/Dokunmatik dinleyicileri (Yalnızca Cards sayfası aktifken çalışır)
  window.addEventListener("mousemove", (event) => {
    if (!pageCards.classList.contains("active")) return;
    mousePos.x = event.clientX;
    mousePos.y = event.clientY;

    if (isMouseDown && Math.abs(event.clientX - startDragX) > 8) {
      isDraggingCarousel = true;
    }
  });

  window.addEventListener("touchmove", (event) => {
    if (!pageCards.classList.contains("active")) return;
    mousePos.x = event.touches[0].clientX;
    mousePos.y = event.touches[0].clientY;

    if (isMouseDown && Math.abs(event.touches[0].clientX - startDragX) > 8) {
      isDraggingCarousel = true;
    }
  });

  contentEl.addEventListener("mousedown", (event) => {
    isMouseDown = true;
    isDraggingCarousel = false;
    startDragX = event.clientX;
    lastMousePos.x = event.clientX;
    lastMousePos.y = event.clientY;
  });

  contentEl.addEventListener("touchstart", (event) => {
    isMouseDown = true;
    isDraggingCarousel = false;
    startDragX = event.touches[0].clientX;
    lastMousePos.x = event.touches[0].clientX;
    lastMousePos.y = event.touches[0].clientY;
  });

  window.addEventListener("mouseup", () => { isMouseDown = false; });
  window.addEventListener("touchend", () => { isMouseDown = false; });

  // Karusel Animasyon ve Fizik Döngüsü
  function carouselFrame() {
    window.requestAnimationFrame(carouselFrame);
    if (!pageCards.classList.contains("active")) return;

    if (isMouseDown) {
      const rect = contentEl.getBoundingClientRect();
      targetVelocity = -1 * (mousePos.x - lastMousePos.x) / rect.width;
      lastMousePos.x = mousePos.x;
      lastMousePos.y = mousePos.y;
      targetPosition += targetVelocity;
      scrollPosition = scrollPosition * 0.8 + targetPosition * 0.2;
    } else {
      // karta kenetlenme (0 ile totalCards-1 arasi)
      const snappingPosition = Math.min(Math.max(0, Math.round(targetPosition)), totalCards - 1);
      const snappingForce = 0.05;
      targetVelocity += (snappingPosition - targetPosition) * snappingForce;
      targetVelocity *= 0.8;
      targetPosition += targetVelocity;
      scrollPosition = scrollPosition * 0.9 + targetPosition * 0.1;
    }

    contentEl.style.setProperty("--scroll", scrollPosition);
    contentEl.querySelectorAll("section").forEach(el => {
      const positionAttr = parseInt(el.style.getPropertyValue('--position')) || 0;
      const relativePosition = positionAttr - scrollPosition;
      el.style.setProperty(
        "--relPosition",
        relativePosition > 0 ? (relativePosition ** 0.75) : -1 * ((-1 * relativePosition) ** 0.75)
      );
      el.style.removeProperty("opacity");
      el.style.removeProperty("--a");
    });
  }

  carouselFrame();
}

// ==========================================================================
// 6. DETAY SAYFASINA YÖNLENDİRME FONKSİYONLARI
// ==========================================================================
function handleCardClick(topic) {
  // Eğer kullanıcı kartı sadece sürüklediyse sayfaya gitme
  if (!isDraggingCarousel) {
    redirectTo(topic);
  }
}

function redirectTo(topic) {
  window.location.href = `detail.html?topic=${topic}`;
}