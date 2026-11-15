// sources.js — kasetlerin ARKASINDAKI GERÇEK NASA VERİSİ
// Üç tür kaynak:
//   series  : sayı dizisi (GISTEMP) -> eğri görüntüsüne çizilir -> sonifiye edilir
//   frames  : animasyon kareleri (SVS 5196 CO2) -> zaman şeridine dizilir
//   gibs    : NASA GIBS WMS katman görüntüsü (buz, kar, arazi, yağış, aerosol, CO2 akısı)
// Her yükleyici 512x512 canvas döndürür: motorun gördüğü tek şey bu.

const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

function canvas512() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  return c;
}

function img(url, timeoutMs = 30000) {
  return new Promise((res, rej) => {
    const i = new Image();
    const to = setTimeout(() => { i.src = ''; rej(new Error('timeout')); }, timeoutMs);
    i.crossOrigin = 'anonymous';
    i.onload = () => { clearTimeout(to); res(i); };
    i.onerror = () => { clearTimeout(to); rej(new Error('load error')); };
    i.src = url;
  });
}

// ---------------------------------------------------------------- series
// GISTEMP v4: her satır bir yıl, kolonlar aylar. J-D = yıllık ortalama anomali.
export async function loadTempSeries(file = './nasa/gistemp/GLB.Ts+dSST.csv', untilYear) {
  const txt = await (await fetch(file)).text();
  const lines = txt.split('\n').filter((l) => /^\d{4},/.test(l));
  const pts = [];
  for (const l of lines) {
    const c = l.split(',');
    const year = parseInt(c[0], 10);
    const v = parseFloat(c[c.length - 6]);        // J-D kolonu
    if (!isNaN(year) && !isNaN(v)) pts.push({ year, v });
  }
  const c = canvas512();
  const g = c.getContext('2d');
  // arka plan: koyu, orta çizgi = 0 anomali
  g.fillStyle = '#0a0d12'; g.fillRect(0, 0, 512, 512);
  const vals = pts.map((p) => p.v);
  // y-olcegi HER ZAMAN tum kayittan: boylece 1995 ile 2025 ayni eksende okunur
  const lo = Math.min(-0.6, Math.min(...vals)), hi = Math.max(...vals) + 0.25;
  // x ekseni de SABIT: 1880 solda, son yil sagda. Secilen donemden sonrasi bos kalir,
  // yani 1995'in egrisi sagda yarida biter (eskiden kirpilan seri tum genislige yayiliyordu
  // ve her donem ayni gorunuyordu).
  const y0 = pts[0].year, y1 = pts[pts.length - 1].year;
  const xOf = (yr) => ((yr - y0) / Math.max(1, y1 - y0)) * 511;
  const zeroY = 512 - ((0 - lo) / (hi - lo)) * 512;
  g.strokeStyle = 'rgba(120,140,160,0.45)';
  g.beginPath(); g.moveTo(0, zeroY); g.lineTo(512, zeroY); g.stroke();

  // secilen yildan sonrasini cizme
  const cutTo = parseInt(untilYear, 10);
  if (cutTo) {
    const k = pts.findIndex((p) => p.year > cutTo);
    if (k > 1) pts.length = k;
  }

  // sütun sütun: her yıl bir dikey çubuk (yükseklik = |anomali|)
  for (const p of pts) {
    const x = xOf(p.year);
    const y = 512 - ((p.v - lo) / (hi - lo)) * 512;
    // pozitif = kırmızı-sıcak, negatif = mavi-soğuk (gri tonlamada da farklı parlaklık)
    g.strokeStyle = p.v >= 0 ? 'rgba(255,120,90,0.9)' : 'rgba(90,150,255,0.9)';
    g.beginPath(); g.moveTo(x, zeroY); g.lineTo(x, y); g.stroke();
  }
  // eğri (spline hissi)
  g.strokeStyle = 'rgba(255,210,190,0.95)'; g.lineWidth = 1.6;
  g.beginPath();
  pts.forEach((p, i) => {
    const x = xOf(p.year);
    const y = 512 - ((p.v - lo) / (hi - lo)) * 512;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
  const n = pts.length;
  const shown = pts.map((p) => p.v);
  const full = cutTo ? ' · scale fixed to the full record' : '';
  return {
    canvas: c,
    yearUsed: cutTo || null,
    info: `${pts[0].year}–${pts[n - 1].year} · ${n} years · min ${Math.min(...shown).toFixed(2)} / max ${Math.max(...shown).toFixed(2)} °C${full}`,
  };
}

// ---------------------------------------------------------------- frames
// SVS 5196 DYAMOND CO2 animasyonu: kareler yan yana -> zaman ekseni
export async function loadFramesStrip(dir = './nasa/svs', count = 27, cols = 384) {
  const c = canvas512();
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  const per = Math.ceil(cols / count);      // column width of each frame
  for (let i = 0; i < count; i++) {
    try {
      const im = await img(`${dir}/f${String(i).padStart(3, '0')}.png`);
      const x = (i / count) * 512;
      const w = 512 / count;
      // karenin ortasındaki küreyi kırp (kenarlar boş siyah) -> sütunda gerçek veri olsun
      const sw = im.width * 0.62, sh = im.height * 0.92;
      const sx = (im.width - sw) / 2, sy = (im.height - sh) / 2;
      g.drawImage(im, sx, sy, sw, sh, x, 0, w, 512);
    } catch (_) { /* eksik kare atla */ }
  }
  // hafif dikey yumuşatma: kare sınırları duyulmasın
  g.globalAlpha = 0.22;
  for (let i = 0; i < count; i++) {
    const x = (i / count) * 512, w = 512 / count;
    g.drawImage(c, x - w * 0.5, 0, w, 512, x, 0, w, 512);
  }
  g.globalAlpha = 1;
  // kontrast: siyah arka planı hafifçe kaldır (motor eşiği için)
  const id = g.getImageData(0, 0, 512, 512);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * 1.35 + 6);
    d[i + 1] = Math.min(255, d[i + 1] * 1.35 + 6);
    d[i + 2] = Math.min(255, d[i + 2] * 1.35 + 6);
  }
  g.putImageData(id, 0, 0);
  // DYAMOND tek bir model kosusu: karelerin yili yok, bu yuzden her donemde ayni gorunur
  return { canvas: c, info: `DYAMOND CO2 · ${count} frames · one model run, identical in every era` };
}

// ------------------------------------------------------------------ gibs
export async function loadGIBS(layer, date, lat, lng, spanDeg = 26, fmt = 'image/png') {
  const half = spanDeg / 2;
  const north = Math.min(85, lat + half), south = Math.max(-85, lat - half);
  const west = lng - half, east = lng + half;
  const url = (size, ms) => {
    const q = `${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326`
      + `&BBOX=${south},${west},${north},${east}&WIDTH=${size}&HEIGHT=${size}&FORMAT=${fmt}`
      + `&LAYERS=${encodeURIComponent(layer)}` + (date ? `&TIME=${date}` : '');
    return img(q, ms);
  };
  // GIBS bazi katmanlari 512'de 10-15s suruyor: once 512, yavas ise 256 ile devam et
  let im;
  try { im = await url(512, 12000); }
  catch (e) { if (e && e.message !== 'timeout') throw e; im = await url(256, 20000); }
  const c = canvas512();
  c.getContext('2d').drawImage(im, 0, 0, 512, 512);
  return { canvas: c, info: `${layer} · ${date || 'static'} · ${spanDeg}°` };
}

// ------------------------------------------------------------------ kaset
// Her kaset = bir NASA veri seti. era -> görüntü katmanlarında tarih.
export const TAPES = [
  { key: 'TEMP', name: 'SURFACE TEMPERATURE', sub: 'GISS GISTEMP v4', kind: 'series',
    about: 'Global mean surface temperature anomaly measured against the 1951 to 1980 baseline, monthly since 1880.',
    href: 'https://data.giss.nasa.gov/gistemp/', lat: 0, lng: 0, span: 180, from: 1880 },
  { key: 'CO2', name: 'CARBON DIOXIDE', sub: 'SVS 5196 DYAMOND', kind: 'frames',
    about: 'Column averaged CO2 from a global DYAMOND model run, played as 27 consecutive time steps.',
    href: 'https://svs.gsfc.nasa.gov/5196/', lat: 10, lng: 20, span: 120, from: 1880 },
  { key: 'ICE', name: 'SEA ICE', sub: 'NSIDC · AMSR2 concentration', kind: 'gibs',
    about: 'Share of the ocean covered by ice, read by the AMSR2 microwave radiometer since 2012.',
    layer: 'AMSRU2_Sea_Ice_Concentration_12km', lat: 78, lng: 0, span: 90, from: 2012 },
  { key: 'SNOW', name: 'SNOW & ICE COVER', sub: 'MODIS NDSI', kind: 'gibs',
    about: 'Normalized snow index from MODIS Terra: how much of the ground is under snow, daily since 2000.',
    layer: 'MODIS_Terra_NDSI_Snow_Cover', lat: 66, lng: -45, span: 70, from: 2000 },
  { key: 'LAND', name: 'LAND COVER', sub: 'MODIS IGBP annual class', kind: 'gibs',
    about: 'Land cover class of every pixel, from forest to cropland to bare ground, mapped once a year since 2001.',
    layer: 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual', lat: -5, lng: -60, span: 60, from: 2001 },
  { key: 'CO2FLUX', name: 'CARBON FLUX', sub: 'Net ecosystem CO2 exchange', kind: 'gibs',
    about: 'Where the biosphere takes carbon in and where it gives it back, as net ecosystem exchange.',
    layer: 'Net Ecosystem CO2 Exchange', lat: 0, lng: -60, span: 120, from: 2015 },
  { key: 'RAIN', name: 'PRECIPITATION', sub: 'GPM IMERG daily', kind: 'gibs',
    about: 'Rain and snow fall rate in millimetres per hour, merged from the GPM satellite constellation.',
    layer: 'IMERG_Precipitation_Rate', lat: 8, lng: 20, span: 90, from: 2000 },
  { key: 'AEROSOL', name: 'AEROSOL', sub: 'MODIS Terra optical depth', kind: 'gibs',
    about: 'Aerosol optical depth: how much dust, smoke and haze sits in the air column, from MODIS Terra.',
    layer: 'MODIS_Terra_Aerosol', lat: 10, lng: 10, span: 90, from: 2000 },
];

// era (1990…2025) -> görüntü katmanı için tarih
export function eraToDate(era, now = new Date()) {
  const y = parseInt(era, 10) || 2020;
  const today = new Date();
  if (y >= today.getFullYear()) {
    const d = new Date(today.getTime() - 3 * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // geçmiş yıllar için aylık ürün varsa ayın 1'i
  return `${y}-07-01`;
}

export async function loadTapeSource(tape, era) {
  const want = parseInt(era, 10) || 2020;
  if (tape.kind === 'series') return loadTempSeries(undefined, want);
  if (tape.kind === 'frames') return loadFramesStrip();

  const first = tape.from || 0;
  const fmt = /TrueColor|CityLights/.test(tape.layer) ? 'image/jpeg' : 'image/png';

  // once yerel karo onbellegi (nasa/gibs/deck) -> aninda, cevrimdisi da calisir
  // o yil yoksa onbellekteki en yakin donem (2020/2015/2010/2005/2000) kullanilir
  for (const y of [want, 2020, 2015, 2010, 2005, 2000]) {
    if (y < Math.max(1990, first)) continue;
    const local = await localTile(tape.key, y);
    if (local && hasData(local.canvas)) {
      if (y !== want) local.info = `${local.info} · data ${y}`;
      return local;
    }
  }

  // denenecek yillar: istenen (veri baslangicindan once ise ilk yil), sonra yedekler
  const cand = [];
  const push = (y) => {
    if (y >= Math.max(1990, first) && y <= new Date().getFullYear() && !cand.includes(y)) cand.push(y);
  };
  push(Math.max(want, first));   // secilen yil veriden onceyse ilk veri yili
  [2020, 2018, 2015, 2013, 2012, 2010, 2005, 2001, 2000].forEach(push);

  let lastErr = null;
  for (const y of cand) {
    try {
      const r = await loadGIBS(tape.layer, eraToDate(String(y)), tape.lat, tape.lng, tape.span, fmt);
      if (!hasData(r.canvas)) continue;
      if (y !== want) r.info = `${r.info} · data ${y}`;
      r.yearUsed = y;
      return r;
    } catch (e) {
      if (e && e.message === 'timeout') throw new Error('NASA tile server unreachable');
      lastErr = e;
    }
  }
  throw lastErr || new Error('no data for this year');
}

// yerel karo onbellegi: nasa/gibs/deck/<KEY>_<yil>.png
async function localTile(key, year) {
  try {
    const im = await img(`./nasa/gibs/deck/${key}_${year}.png`, 5000);
    const c = canvas512();
    c.getContext('2d').drawImage(im, 0, 0, 512, 512);
    return { canvas: c, info: `${year} · cached`, yearUsed: parseInt(year, 10) };
  } catch (e) {
    return null;
  }
}

// goruntu gercekten veri iceriyor mu (bos/saydam karo = o yil icin veri yok)
function hasData(c) {
  try {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 37) { if (d[i] > 12) n++; }
    return n > 40;
  } catch (e) { return true; }
}
