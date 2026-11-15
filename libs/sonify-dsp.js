// dsp.js — STFT / ISTFT / Griffin-Lim / Hilbert curve / WAV  (browser + node ES module)

/* ---------------- FFT (radix-2, cached tables) ---------------- */
const fftCache = new Map();

export function makeFFT(n) {
  if (fftCache.has(n)) return fftCache.get(n);
  const levels = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / n);
    sin[i] = Math.sin(-2 * Math.PI * i / n);
  }
  const obj = { n, rev, cos, sin };
  fftCache.set(n, obj);
  return obj;
}

// in-place FFT of two Float64Array(n) (re, im). inverse = true -> conjugated twiddles + 1/n scaling
export function fft(re, im, inverse = false) {
  const n = re.length;
  const { rev, cos, sin } = makeFFT(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const c = cos[k], s = inverse ? -sin[k] : sin[k];
        const l = j + half;
        const tre = re[l] * c - im[l] * s;
        const tim = re[l] * s + im[l] * c;
        re[l] = re[j] - tre; im[l] = im[j] - tim;
        re[j] += tre; im[j] += tim;
      }
    }
  }
  if (inverse) {
    const sc = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= sc; im[i] *= sc; }
  }
}

/* ---------------- window helpers ---------------- */
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

/* ---------------- STFT ---------------- */
// returns { re, im } each Float64Array(nFrames * nBins), frame-major
export function stft(x, nFft = 512, hop = 256) {
  const win = hann(nFft);
  const pad = nFft >> 1;
  const len = pad + x.length + pad;
  const buf = new Float64Array(len);
  buf.set(x, pad);
  // reflect the edges so the borders are not hard-silent (matches librosa center=True roughly)
  for (let i = 0; i < pad; i++) {
    buf[pad - 1 - i] = x[Math.min(i, x.length - 1)] || 0;
    buf[pad + x.length + i] = x[Math.max(0, x.length - 1 - i)] || 0;
  }
  const nBins = (nFft >> 1) + 1;
  const nFrames = Math.floor((len - nFft) / hop) + 1;
  const re = new Float64Array(nFrames * nBins);
  const im = new Float64Array(nFrames * nBins);
  const fr = new Float64Array(nFft), fi = new Float64Array(nFft);
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < nFft; i++) { fr[i] = buf[off + i] * win[i]; fi[i] = 0; }
    fft(fr, fi, false);
    for (let b = 0; b < nBins; b++) { re[f * nBins + b] = fr[b]; im[f * nBins + b] = fi[b]; }
  }
  return { re, im, nFrames, nBins };
}

/* ---------------- ISTFT (overlap-add / weighted) ---------------- */
export function istft(re, im, nFrames, nBins, nFft = 512, hop = 256, outLen = null) {
  const win = hann(nFft);
  const pad = nFft >> 1;
  const len = pad + outLen + pad;
  const out = new Float64Array(len);
  const wss = new Float64Array(len);
  const fr = new Float64Array(nFft), fi = new Float64Array(nFft);
  for (let f = 0; f < nFrames; f++) {
    for (let b = 0; b < nFft; b++) {
      if (b < nBins) { fr[b] = re[f * nBins + b]; fi[b] = im[f * nBins + b]; }
      else {
        const m = nFft - b;                       // conjugate mirror
        if (m < nBins) { fr[b] = re[f * nBins + m]; fi[b] = -im[f * nBins + m]; }
        else { fr[b] = 0; fi[b] = 0; }            // missing Nyquist bin
      }
    }
    fft(fr, fi, true);
    const off = f * hop;
    for (let i = 0; i < nFft; i++) {
      out[off + i] += fr[i] * win[i];
      wss[off + i] += win[i] * win[i];
    }
  }
  const y = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const w = wss[pad + i];
    y[i] = w > 1e-8 ? out[pad + i] / w : 0;
  }
  return y;
}

/* ---------------- Griffin-Lim ---------------- */
// mag: Float64Array(nFrames*nBins) magnitude spectrogram. Returns waveform Float64Array(outLen)
export function griffinLim(mag, nFrames, nBins, nFft, hop, outLen, iters = 32, onProgress = null) {
  const re = new Float64Array(mag.length), im = new Float64Array(mag.length);
  // deterministic-pseudo-random initial phase
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < mag.length; i++) {
    const ph = rnd() * 2 * Math.PI;
    re[i] = mag[i] * Math.cos(ph); im[i] = mag[i] * Math.sin(ph);
  }
  let y = null;
  for (let it = 0; it <= iters; it++) {
    y = istft(re, im, nFrames, nBins, nFft, hop, outLen);
    if (it === iters) break;
    const S = stft(y, nFft, hop);
    const stride = S.nBins;
    for (let f = 0; f < nFrames; f++) {
      for (let b = 0; b < nBins; b++) {
        const i = f * nBins + b, j = f * stride + b;
        const m = Math.hypot(S.re[j], S.im[j]) || 1e-12;
        re[i] = mag[i] * S.re[j] / m;
        im[i] = mag[i] * S.im[j] / m;
      }
    }
    if (onProgress) onProgress((it + 1) / iters);
  }
  return y;
}

/* ---------------- image -> magnitude ---------------- */
// gray: Float64Array(nBins * nFrames) row-major, row 0 = TOP of image = HIGHEST freq
// dbFloor: dynamic-range in dB mapped to 0..1 of image brightness
export function grayToMagnitude(gray, nBins, nFrames, dbFloor = 80, boost = 0) {
  const mag = new Float64Array(nFrames * nBins);
  for (let f = 0; f < nFrames; f++) {
    for (let b = 0; b < nBins; b++) {
      const row = nBins - 1 - b;              // image row from top -> bin from low freq
      let g = gray[row * nFrames + f];
      g = Math.pow(Math.min(1, Math.max(0, g)), 1 / (1 + boost)); // gamma
      const db = g * dbFloor - dbFloor;       // 0 .. -dbFloor
      mag[f * nBins + b] = Math.pow(10, db / 20);
    }
  }
  mag[0] = mag[nBins] = 0;                    // kill DC of first frames
  for (let f = 0; f < nFrames; f++) mag[f * nBins] = 0;
  return mag;
}

/* ---------------- Hilbert curve ---------------- */
// canonical d2xy: order n -> side 2^n, index k in [0, 4^n)
export function hilbertD2XY(n, k) {
  let rx, ry, t = k, x = 0, y = 0;
  for (let s = 1; s < (1 << n); s <<= 1) {
    rx = 1 & Math.floor(t / 2);
    ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx; y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

export function hilbertPath(n) {
  const N = 1 << (2 * n);
  const xs = new Uint16Array(N), ys = new Uint16Array(N);
  for (let k = 0; k < N; k++) { const p = hilbertD2XY(n, k); xs[k] = p[0]; ys[k] = p[1]; }
  return { xs, ys, N, side: 1 << n };
}

/* ---------------- SMOOTH (additive, phase-continuous) ----------------
   "Bir sonraki sütun YENİ TON ÜRETMEZ" motoru.
   - Önce spektrogram zaman (ve frekans) ekseninde yumuşatılır: her sütun,
     bir öncekinin hafifçe değişmiş hâli olur.
   - Kısmi (partial) izleri: bir tepe, önceki kısmiyle eşlenirse frekansı
     yavaşça (glide) kayar; eşleşmezse söner. Yeni bir tona ancak HİSTEREZİ
     (üst üste birkaç sütun) sonrası izin verilir.
   - Amplitude slew (attack/release) + tek kutuplu alçak geçiren = yumuşatma.
*/
export function smoothAdditiveAudio(gray, opts = {}) {
  const {
    nBins = 256, nFrames = 384, sr = 22050, nFft = 512, hop = 256,
    maxPartials = 16, glide = 0.18, attack = 0.10, release = 0.05,
    preSmooth = 0.55, birthFrames = 3, matchBins = 7,
    lpHz = 4800, stretch = 1, dbFloor = 80, boost = 0, peakTarget = 0.9,
  } = opts;

  const mag = grayToMagnitude(gray, nBins, nFrames, dbFloor, boost);

  for (let f = 0; f < nFrames; f++) {
    let m = 0;
    for (let b = 0; b < nBins; b++) if (mag[f * nBins + b] > m) m = mag[f * nBins + b];
    if (m > 1e-9) for (let b = 0; b < nBins; b++) mag[f * nBins + b] /= m;
  }

  // --- zaman ekseninde ileri-geri tek kutuplu yumuşatma (gecikmesiz, iki geçiş)
  const a = Math.min(0.98, Math.max(0, preSmooth));
  if (a > 0) {
    const tmp = new Float64Array(nBins);
    for (let b = 0; b < nBins; b++) {
      let z = mag[b];
      for (let f = 0; f < nFrames; f++) { const i = f * nBins + b; z = a * z + (1 - a) * mag[i]; mag[i] = z; }
      z = mag[(nFrames - 1) * nBins + b];
      for (let f = nFrames - 1; f >= 0; f--) { const i = f * nBins + b; z = a * z + (1 - a) * mag[i]; mag[i] = z; }
    }
    tmp[0] = 0;
  }
  // --- frekans ekseninde 3 binlik yumuşatma
  const sm = new Float64Array(nFrames * nBins);
  for (let f = 0; f < nFrames; f++) {
    const o = f * nBins;
    for (let b = 0; b < nBins; b++) {
      const l = mag[o + Math.max(0, b - 1)], c = mag[o + b], r = mag[o + Math.min(nBins - 1, b + 1)];
      sm[o + b] = 0.25 * l + 0.5 * c + 0.25 * r;
    }
  }

  // --- sütun başına tepe seçimi (parabolik interpolasyon)
  const peaks = [];
  for (let f = 0; f < nFrames; f++) {
    const o = f * nBins, arr = [];
    for (let b = 2; b < nBins - 2; b++) {
      const v = sm[o + b];
      if (v < 0.02) continue;
      if (v > sm[o + b - 1] && v >= sm[o + b + 1]) {
        const p = sm[o + b - 1], q = sm[o + b + 1];
        const den = p - 2 * v + q;
        const d = Math.abs(den) > 1e-9 ? (p - q) / (2 * den) : 0;
        arr.push({ bin: b + Math.max(-0.5, Math.min(0.5, d)), amp: v });
      }
    }
    arr.sort((x, y) => y.amp - x.amp);
    peaks.push(arr.slice(0, maxPartials));
  }

  // --- izleme + histerezis
  let births = 0;          // kaç kez YENİ bir kısmi doğdu (hedef: sütun sayısından çok az)
  const slots = [];        // mevcut kısmi izleri {bin}
  const cands = [];        // doğum adayları {bin, amp, life}
  const targets = [];
  for (let f = 0; f < nFrames; f++) {
    const pk = peaks[f];
    const used = new Uint8Array(pk.length);
    const out = [];
    for (const v of slots) {
      let best = -1, bestD = matchBins;
      for (let i = 0; i < pk.length; i++) {
        if (used[i]) continue;
        const d = Math.abs(pk[i].bin - v.bin);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) { used[best] = 1; out.push({ bin: pk[best].bin, amp: pk[best].amp }); }
      else out.push({ bin: v.bin, amp: 0 });              // hedef 0 -> yumuşak sönüş
    }
    // adaylar: yeni tepeler önce "bekleme odasına" girer
    for (const c of cands) c.hit = false;
    for (let i = 0; i < pk.length; i++) {
      if (used[i]) continue;
      let c = null;
      for (const q of cands) if (Math.abs(q.bin - pk[i].bin) < matchBins) { c = q; break; }
      if (c) { c.bin = pk[i].bin; c.amp = pk[i].amp; c.life++; c.hit = true; }
      else cands.push({ bin: pk[i].bin, amp: pk[i].amp, life: 1, hit: true });
    }
    // bu sütunda görülmeyen adayın ömrü azalır
    for (let i = cands.length - 1; i >= 0; i--) {
      if (!cands[i].hit) { cands[i].life--; if (cands[i].life <= 0) cands.splice(i, 1); }
    }
    // yeterince ısrar eden aday -> gerçek kısmi (yavaş doğar: amp*0.5)
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i];
      if (c.life >= birthFrames && out.length < maxPartials) {
        out.push({ bin: c.bin, amp: c.amp * 0.5 });
        cands.splice(i, 1);
        births++;
      }
    }
    if (out.length === 0) out.push({ bin: 8, amp: 0 });
    slots.length = 0;
    for (const o of out) slots.push({ bin: o.bin });
    targets.push(out);
  }

  // --- sentez
  const frameLen = hop * stretch;
  const outLen = Math.max(1, Math.round((nFrames - 1) * frameLen) + hop);
  const y = new Float64Array(outLen);
  const freqPerBin = sr / nFft;
  const N = maxPartials;
  const ph = new Float64Array(N), cf = new Float64Array(N), ca = new Float64Array(N);
  const tf = new Float64Array(N), ta = new Float64Array(N);
  const twoPi = Math.PI * 2;

  for (let f = 0; f < nFrames; f++) {
    const t0 = Math.round(f * frameLen), t1 = Math.min(outLen, Math.round((f + 1) * frameLen));
    const n = t1 - t0;
    if (n <= 0) continue;
    const tg = targets[f];
    for (let i = 0; i < N; i++) {
      const v = tg[i];
      if (v) { tf[i] = v.bin * freqPerBin; ta[i] = v.amp; } else { ta[i] = 0; }
    }
    const gF = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, glide)), 1 / n);
    const gU = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, attack)), 1 / n);
    const gD = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, release)), 1 / n);
    for (let t = t0; t < t1; t++) {
      let s = 0;
      for (let i = 0; i < N; i++) {
        if (ca[i] < 1e-5 && ta[i] < 1e-5) continue;
        cf[i] += (tf[i] - cf[i]) * gF;
        ca[i] += (ta[i] - ca[i]) * (ta[i] > ca[i] ? gU : gD);
        ph[i] += twoPi * cf[i] / sr;
        if (ph[i] > twoPi) ph[i] -= twoPi * Math.floor(ph[i] / twoPi);
        s += ca[i] * Math.sin(ph[i]);
      }
      y[t] += s;
    }
  }

  if (lpHz > 0 && lpHz < sr / 2) {
    const c = 1 - Math.exp(-twoPi * lpHz / sr);
    let z = 0;
    for (let t = 0; t < outLen; t++) { z += c * (y[t] - z); y[t] = z; }
  }
  const fade = Math.min(Math.round(sr * 0.03), outLen >> 2);
  for (let i = 0; i < fade; i++) { const g2 = i / fade; y[i] *= g2; y[outLen - 1 - i] *= g2; }
  let peak = 0;
  for (let i = 0; i < outLen; i++) if (Math.abs(y[i]) > peak) peak = Math.abs(y[i]);
  if (peak > 1e-9) { const k = peakTarget / peak; for (let i = 0; i < outLen; i++) y[i] *= k; }

  return {
    wave: y,
    births,
    meta: `${maxPartials} kısmi · ${(outLen / sr).toFixed(2)} sn · glide ${glide} · attack ${attack} · ön-yumuşatma ${preSmooth}`,
  };
}

/* ---------------- WAV ---------------- */
export function encodeWav(samples, sampleRate = 22050, channels = 2) {
  const n = samples.length;
  const bytes = n * channels * 2;
  const ab = new ArrayBuffer(44 + bytes);
  const dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * 2, true); dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    const s = v < 0 ? v * 32768 : v * 32767;
    for (let c = 0; c < channels; c++) { dv.setInt16(o, s, true); o += 2; }
  }
  return ab;
}
