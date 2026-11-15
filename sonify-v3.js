// dsp3.js — "PLEASING" sonifikasyon motoru (v3)
//
// v2 (SMOOTH) neyi yanlış yapıyordu:
//   görüntü satırı -> HAM FFT bin'i. sr 22050, nFft 512 => bin aralığı 43 Hz.
//   Çıkan frekanslar müzikal diziye oturmuyor (481, 524, 610 Hz...) -> inharmonik
//   küme, yavaş vuruşlar (beating), "org çalan rastgele notalar" hissi.
//
// v3 ne yapıyor:
//   1) Satır -> 2.5 oktavlık MÜZİKAL merdiven (log), sonra dizinin en yakın
//      derecesine SNAP (pentatonik/minör). Glide korunur -> portamento.
//   2) Tını: her kısmi = kök + 2. harmonik (%25) + 3. harmonik (%12), hafif detune.
//   3) Zarf: uzun attack/release + görüntü parlaklığına bağlı "nefes" LFO.
//   4) Stereo: perdeye göre pan + kanal başına farklı reverb.
//   5) Schroeder reverb (4 comb + 2 allpass) -> "stüdyoda çalınmış" hissi.
//   6) Alçak drone (kök + beşli, çok kısık) -> tonal merkez, her şey "akortlu".
//   7) Master: yumuşak doyum + normalize.

export const SCALES = {
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
  aeolian:   [0, 2, 3, 5, 7, 8, 10],
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  lydian:    [0, 2, 4, 6, 7, 9, 11],
  mixolydian:[0, 2, 4, 5, 7, 9, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
};

function scaleLadder(scale, rootMidi, lo, hi) {
  const set = SCALES[scale] || SCALES.minorPent;
  const out = [];
  for (let o = -3; o <= 4; o++) {
    for (const d of set) {
      const s = rootMidi + d + 12 * o;
      if (s >= lo && s <= hi) out.push(s);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

function nearestIdx(sorted, v) {
  let lo = 0, hi = sorted.length - 1;
  if (v <= sorted[0]) return 0;
  if (v >= sorted[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (sorted[m] <= v) lo = m; else hi = m;
  }
  return (v - sorted[lo] <= sorted[hi] - v) ? lo : hi;
}

/* ---------------- görüntü -> normalize edilmiş tepe haritası ---------------- */
function buildTargets(gray, nBins, nFrames, opt) {
  const { maxPartials, preSmooth, dBFloor, boost } = opt;
  // amplitüd matrisi (satır 0 = üst = yüksek perde)
  const mag = new Float64Array(nFrames * nBins);
  for (let f = 0; f < nFrames; f++) {
    for (let b = 0; b < nBins; b++) {
      const row = nBins - 1 - b;                       // üst satır -> yüksek derece
      let g = gray[row * nFrames + f];
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      mag[f * nBins + b] = Math.pow(g, 1 / (1 + boost));
    }
  }
  // sütun bazında tepe = 1
  for (let f = 0; f < nFrames; f++) {
    let m = 0;
    for (let b = 0; b < nBins; b++) { const v = mag[f * nBins + b]; if (v > m) m = v; }
    if (m > 1e-9) for (let b = 0; b < nBins; b++) mag[f * nBins + b] /= m;
  }
  // zaman ekseninde iki geçişli yumuşatma (gecikmesiz)
  const a = Math.min(0.98, Math.max(0, preSmooth));
  if (a > 0) {
    for (let b = 0; b < nBins; b++) {
      let z = mag[b];
      for (let f = 0; f < nFrames; f++) { const i = f * nBins + b; z = a * z + (1 - a) * mag[i]; mag[i] = z; }
      z = mag[(nFrames - 1) * nBins + b];
      for (let f = nFrames - 1; f >= 0; f--) { const i = f * nBins + b; z = a * z + (1 - a) * mag[i]; mag[i] = z; }
    }
  }
  // yalnızca frekans ekseninde hafif yumuşatma
  const sm = new Float64Array(nFrames * nBins);
  for (let f = 0; f < nFrames; f++) {
    const o = f * nBins;
    for (let b = 0; b < nBins; b++) {
      const l = mag[o + (b > 0 ? b - 1 : 0)], c = mag[o + b], r = mag[o + (b < nBins - 1 ? b + 1 : nBins - 1)];
      sm[o + b] = 0.25 * l + 0.5 * c + 0.25 * r;
    }
  }
  // tepe seçimi
  const peaks = [];
  let bright = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const o = f * nBins, arr = [];
    let sum = 0;
    for (let b = 1; b < nBins - 1; b++) {
      const v = sm[o + b];
      sum += v;
      if (v < 0.03) continue;
      if (v > sm[o + b - 1] && v >= sm[o + b + 1]) arr.push({ bin: b, amp: v });
    }
    bright[f] = sum / nBins;
    arr.sort((x, y) => y.amp - x.amp);
    peaks.push(arr.slice(0, maxPartials));
  }
  // parlaklığı 0..1'e normalize et (nefes LFO'su için)
  let bmax = 1e-9;
  for (let f = 0; f < nFrames; f++) if (bright[f] > bmax) bmax = bright[f];
  for (let f = 0; f < nFrames; f++) bright[f] = bright[f] / bmax;
  return { peaks, bright };
}

/* ---------------- Schroeder reverb ---------------- */
function reverb(x, sr, mix, decay, seedDelays) {
  const combs = [1557, 1617, 1491, 1422].map((d, i) => ({ d: Math.round((d + seedDelays) * sr / 44100), buf: null, i: 0, lp: 0 }));
  const aps = [225, 556].map(d => ({ d: Math.round((d + seedDelays * 0.5) * sr / 44100), buf: null, i: 0 }));
  for (const c of combs) c.buf = new Float64Array(Math.max(2, c.d));
  for (const p of aps) p.buf = new Float64Array(Math.max(2, p.d));
  const damp = 0.28;
  const fb = Math.min(0.92, decay);
  const out = new Float64Array(x.length);
  for (let t = 0; t < x.length; t++) {
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * (1 - damp) + c.lp * damp;
      c.buf[c.i] = x[t] + c.lp * fb;
      c.i = (c.i + 1) % c.buf.length;
      s += y;
    }
    s *= 0.25;
    for (const p of aps) {
      const y = p.buf[p.i];
      p.buf[p.i] = s + y * 0.5;
      p.i = (p.i + 1) % p.buf.length;
      s = y - s * 0.5;
    }
    out[t] = s;
  }
  for (let t = 0; t < x.length; t++) out[t] = x[t] * (1 - mix) + out[t] * mix;
  return out;
}

export const PRESETS = {
  // A — sıcak/soft: pentatonik minör, geniş aralık, yumuşak tını
  saf:    { scale: 'minorPent', loMidi: 52, hiMidi: 88, maxPartials: 6, minSpacing: 4,
            timbre: [1, 0.26, 0.10], reverbMix: 0.22, breath: 0.45, breatheDepth: 0.14, minNoteFrames: 6 },
  // B — parlak/çan: lydian, daha tiz, daha çok harmonik, kısa notalar
  parlak: { scale: 'lydian',    loMidi: 60, hiMidi: 96, maxPartials: 7, minSpacing: 3,
            timbre: [1, 0.35, 0.18], reverbMix: 0.30, breath: 0.7, breatheDepth: 0.20, minNoteFrames: 4 },
  // C — seyrek/ambient: az nota, uzun tutuş, geniş reverb
  seyrek: { scale: 'aeolian',   loMidi: 48, hiMidi: 84, maxPartials: 4, minSpacing: 5,
            timbre: [1, 0.20, 0.06], reverbMix: 0.42, breath: 0.30, breatheDepth: 0.10, minNoteFrames: 10 },
};

/* ---------------- ANA MOTOR ---------------- */
export function smoothAdditivePleasing(gray, opts = {}) {
  const o = {
    nBins: 256, nFrames: 384, sr: 22050, nFft: 512, hop: 256,
    maxPartials: 8,
    pitchGamma: 0.8,          // <1 -> satırların orta bandı daha tiz (daha parlak tını)
    minSpacing: 3,            // aynı oktavda min 3 yarım ton (küçük ikili = cızırtı)
    pitchHysteresis: 0.55,    // kullanılmıyor (minNoteFrames ile değiştirildi)
    minNoteFrames: 5,         // bir nota en az bu kadar sütun çalar (~58 ms)
    holdDebounce: 1.2,        // veri bu kadar yarım ton kaymadan nota değişmez
    ampGate: 0.16,            // bundan zayıf kısmi hiç çalınmaz (doku seyrelir, dinamik artar)
    preSmooth: 0.62,          // daha çok yumuşat -> daha az zıplama
    dBFloor: 80, boost: 0,
    glide: 0.26,              // portamento (yavaş kayma = yumuşak)
    attack: 0.07, release: 0.16,
    stretch: 1,
    // müzikal katman
    rootMidi: 57,             // A3
    scale: 'minorPent',
    loMidi: 52, hiMidi: 88,   // E3..E6 — tiz ciyaklama yok, bas çamuru yok
    snap: 1.0,                // 1 = tam dizide, 0 = serbest
    timbre: [1, 0.28, 0.13],  // harmonik ağırlıkları
    detune: 4,                // cent
    breathe: 0.55,            // nefes LFO Hz
    breatheDepth: 0.16,
    panWidth: 0.55,
    drone: 0.035,
    reverbMix: 0.22, reverbDecay: 0.80,
    drive: 1.0,
    peakTarget: 0.9,
    ...opts,
  };

  const { peaks, bright } = buildTargets(gray, o.nBins, o.nFrames, o);
  const ladder = scaleLadder(o.scale, o.rootMidi, o.loMidi, o.hiMidi);
  const span = (o.nBins - 1);
  const semitoneToHz = s => 440 * Math.pow(2, (s - 69) / 12);

  // --- hedef: her sütun için {semi, amp} listesi (diziye snap'li + SES ARALIĞI KURALI)
  //     Kural: aynı oktavda iki kısmi arası en az `minSpacing` yarım ton olacak.
  //     Çakışan zayıf kısmi oktav yukarı/aşağı taşınır. Yakın aralıklı küme = dissonance.
  const frames = [];
  const held = new Map();             // ses kimliği -> {semi, until, raw}
  for (let f = 0; f < o.nFrames; f++) {
    const pk = peaks[f];
    const raw = [];
    for (let i = 0; i < pk.length; i++) {
      const row = Math.pow((o.nBins - 1 - pk[i].bin) / span, o.pitchGamma);  // gamma>1 -> yukarı ağırlıklı
      raw.push({ semi: o.loMidi + row * (o.hiMidi - o.loMidi), amp: Math.pow(pk[i].amp, 1.6) });
    }
    raw.sort((a, b) => b.amp - a.amp);
    const used = [];
    const arr = [];
    for (let vi = 0; vi < raw.length; vi++) {
      const v = raw[vi];
      if (v.amp < o.ampGate) continue;
      const snapped = o.snap > 0 ? ladder[nearestIdx(ladder, v.semi)] : v.semi;
      // MİNİMUM NOTA SÜRESİ: nota birkaç sütun boyunca tutulur; veri eşiği
      // geçerse değişir. Aksi hâlde her sütunda perde değişir -> siren/cıvıltı.
      const h = held.get(vi);
      let semi = snapped;
      if (h && f < h.until && Math.abs(h.raw - v.semi) < o.holdDebounce) {
        semi = h.semi;
      } else {
        held.set(vi, { semi: snapped, until: f + o.minNoteFrames, raw: v.semi });
      }
      // ses aralığı kuralı: çakışan notayı merdivende kaydır
      let li = nearestIdx(ladder, semi), guard = 0;
      while (guard++ < 12 && used.some(u => Math.abs(u - ladder[li]) < o.minSpacing)) {
        li += 1;
        if (li >= ladder.length) break;
      }
      if (li >= ladder.length) continue;
      semi = ladder[li];
      if (semi > o.hiMidi + 12) continue;
      if (used.includes(semi)) continue;
      used.push(semi);
      arr.push({ semi, amp: v.amp });
      if (arr.length >= o.maxPartials) break;
    }
    frames.push(arr);
  }

  // --- zaman ızgarası
  const frameLen = o.hop * o.stretch;
  const outLen = Math.max(1, Math.round((o.nFrames - 1) * frameLen) + o.hop);
  const L = new Float64Array(outLen), R = new Float64Array(outLen);
  const N = o.maxPartials;

  // kısmi durumları: cSemi/cAmp = mevcut, tSemi/tAmp = hedef (glide + ADSR slew)
  const cSemi = new Float64Array(N), cAmp = new Float64Array(N);
  const tSemi = new Float64Array(N), tAmp = new Float64Array(N);
  const ph1 = new Float64Array(N), ph2 = new Float64Array(N), ph3 = new Float64Array(N);
  const pan = new Float64Array(N);
  const twoPi = Math.PI * 2;
  let droneAmp = 0, dronePh = 0, dronePh2 = 0;
  const droneHz = semitoneToHz(o.rootMidi - 12);
  const fifthHz = semitoneToHz(o.rootMidi - 12 + 7);

  for (let f = 0; f < o.nFrames; f++) {
    const t0 = Math.round(f * frameLen), t1 = Math.min(outLen, Math.round((f + 1) * frameLen));
    const n = Math.max(0, t1 - t0);
    if (n <= 0) continue;
    const tg = frames[f];
    for (let i = 0; i < N; i++) {
      const v = tg[i];
      if (v) {
        tSemi[i] = v.semi;
        tAmp[i] = v.amp;
        pan[i] = ((v.semi - o.loMidi) / (o.hiMidi - o.loMidi) * 2 - 1) * o.panWidth;
      } else {
        tAmp[i] = 0;               // hedef 0 -> yumuşak sönüş (hedef perde korunur)
      }
    }
    const gF = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, o.glide)), 1 / n);
    const gU = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, o.attack)), 1 / n);
    const gD = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, o.release)), 1 / n);
    const br = bright[f];
    const droneTarget = o.drone * (0.35 + 0.65 * br);

    for (let t = t0; t < t1; t++) {
      const tt = t / o.sr;
      // nefes: parlak alanda daha canlı (veriden gelen ritim hissi)
      const breath = 1 - o.breatheDepth * (0.5 + 0.5 * Math.sin(twoPi * o.breathe * tt + br * 3));
      let sl = 0, sr2 = 0;
      for (let i = 0; i < N; i++) {
        // ADSR: hedefe doğru slew
        cAmp[i] += (tAmp[i] - cAmp[i]) * (tAmp[i] > cAmp[i] ? gU : gD);
        cSemi[i] += (tSemi[i] - cSemi[i]) * gF;
        if (cAmp[i] < 1e-5) continue;
        const f1 = semitoneToHz(cSemi[i] + o.detune * 0.0025);
        const f2 = semitoneToHz(cSemi[i] + 12 - o.detune * 0.0025);
        const f3 = semitoneToHz(cSemi[i] + 19.0195);
        ph1[i] += twoPi * f1 / o.sr; if (ph1[i] > twoPi) ph1[i] -= twoPi * Math.floor(ph1[i] / twoPi);
        ph2[i] += twoPi * f2 / o.sr; if (ph2[i] > twoPi) ph2[i] -= twoPi * Math.floor(ph2[i] / twoPi);
        ph3[i] += twoPi * f3 / o.sr; if (ph3[i] > twoPi) ph3[i] -= twoPi * Math.floor(ph3[i] / twoPi);
        const s = (cAmp[i] * (Math.sin(ph1[i]) + o.timbre[1] * Math.sin(ph2[i]) + o.timbre[2] * Math.sin(ph3[i]))) * breath;
        const p = pan[i], gl = Math.cos((p + 1) * Math.PI / 4), gr = Math.sin((p + 1) * Math.PI / 4);
        sl += s * gl; sr2 += s * gr;
      }
      // drone (kök + beşli) — tonal merkez
      droneAmp += (droneTarget - droneAmp) * 0.00002;
      dronePh += twoPi * droneHz / o.sr; if (dronePh > twoPi) dronePh -= twoPi;
      dronePh2 += twoPi * fifthHz / o.sr; if (dronePh2 > twoPi) dronePh2 -= twoPi;
      const d = droneAmp * (Math.sin(dronePh) + 0.5 * Math.sin(dronePh2));
      L[t] += sl + d; R[t] += sr2 + d;
    }
  }

  softFades(L); softFades(R);

  const lr = reverb(L, o.sr, o.reverbMix, o.reverbDecay, 0);
  const rr = reverb(R, o.sr, o.reverbMix, o.reverbDecay, 37);

  // master: ÖNCE normalize, SONRA hafif doyum.
  // (Ters sıra, 8 kısmi toplamı çok yüksekken tanh'a girer -> intermodülasyon
  //  çarpıklığı -> dizide olmayan frekanslar -> "tonal% 30" felaketi.)
  let pre = 0;
  for (let i = 0; i < outLen; i++) {
    const m = Math.max(Math.abs(lr[i]), Math.abs(rr[i]));
    if (m > pre) pre = m;
  }
  const gp = pre > 1e-9 ? 0.7 / pre : 1;
  let peak = 0;
  const th = Math.tanh(o.drive);
  for (let i = 0; i < outLen; i++) {
    lr[i] = Math.tanh(lr[i] * gp * o.drive) / th;
    rr[i] = Math.tanh(rr[i] * gp * o.drive) / th;
    const m = Math.max(Math.abs(lr[i]), Math.abs(rr[i]));
    if (m > peak) peak = m;
  }
  if (peak > 1e-9) { const k = o.peakTarget / peak; for (let i = 0; i < outLen; i++) { lr[i] *= k; rr[i] *= k; } }

  const wave = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) wave[i] = 0.5 * (lr[i] + rr[i]);

  return {
    wave, left: lr, right: rr,
    frames: o.debug ? frames : null,
    meta: `${o.maxPartials} kısmi · ${o.scale} · kök MIDI ${o.rootMidi} · ${(outLen / o.sr).toFixed(2)} sn · reverb ${o.reverbMix}`,
  };
}

function softFades(y) {
  const n = y.length, f = Math.min(Math.round(0.04 * 22050), n >> 2);
  for (let i = 0; i < f; i++) { const g = i / f; y[i] *= g; y[n - 1 - i] *= g; }
}

export function interleave(l, r) {
  const n = l.length, out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { out[2 * i] = l[i]; out[2 * i + 1] = r[i]; }
  return out;
}
