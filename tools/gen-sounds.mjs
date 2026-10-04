// Synthesizes the sampled instruments and the hall impulse response embedded in life-music-box.html.
// Usage: node tools/gen-sounds.mjs > /tmp/sounds.js   (then splice between the SOUNDS markers)
// Deterministic: the same output on every run.

const SR = 32000;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wav(channels) {
  const n = channels[0].length, ch = channels.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * ch * 2, 40);
  let peak = 1e-9;
  channels.forEach(c => c.forEach(v => { peak = Math.max(peak, Math.abs(v)); }));
  const k = 0.89 / peak;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i] * k)) * 32767), 44 + (i * ch + c) * 2);
  }
  return buf.toString("base64");
}

// Sum of decaying partials: [ratio, amplitude, decaySeconds].
function modal(f0, partials, seconds, { attack = 0.002, click = 0, seed = 1 } = {}) {
  const n = Math.round(SR * seconds), out = new Float64Array(n), r = rng(seed);
  partials.forEach(([ratio, amp, decay]) => {
    const w = 2 * Math.PI * f0 * ratio / SR, ph = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * i + ph) * Math.exp(-i / (SR * decay));
  });
  const a = Math.round(SR * attack);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  if (click) { let lp = 0; for (let i = 0; i < SR * 0.006; i++) { lp += 0.35 * ((r() * 2 - 1) - lp); out[i] += click * lp * (1 - i / (SR * 0.006)); } }
  fadeOut(out, 0.08);
  return out;
}

function fadeOut(x, seconds) {
  const m = Math.round(SR * seconds), n = x.length;
  for (let i = 0; i < m; i++) x[n - 1 - i] *= i / m;
}

// Karplus-Strong plucked string with a slightly bright excitation.
function pluck(f0, seconds, seed) {
  const n = Math.round(SR * seconds), out = new Float64Array(n), r = rng(seed);
  const len = Math.round(SR / f0), line = new Float64Array(len);
  let lp = 0;
  for (let i = 0; i < len; i++) { lp += 0.6 * ((r() * 2 - 1) - lp); line[i] = lp; }
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = line[idx], b = line[(idx + 1) % len];
    line[idx] = 0.4985 * (a + b);
    out[i] = a; idx = (idx + 1) % len;
  }
  fadeOut(out, 0.1);
  return out;
}

// Stereo hall impulse response: early reflections, then decorrelated noise whose highs die faster than its lows.
function hall(seconds, rt60, seed) {
  const n = Math.round(SR * seconds), r = rng(seed);
  const chans = [new Float64Array(n), new Float64Array(n)];
  const taps = [[0.011, 0.8], [0.019, 0.6], [0.027, 0.55], [0.037, 0.45], [0.049, 0.4], [0.061, 0.32], [0.074, 0.28]];
  chans.forEach((c, ch) => {
    let low = 0, highPrev = 0;
    const kLow = 6.9 / (SR * rt60), kHigh = 6.9 / (SR * rt60 * 0.45);
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      low += 0.08 * (w - low);
      const high = w - low;
      const onset = Math.min(1, i / (SR * 0.02));
      c[i] = onset * (low * 2.2 * Math.exp(-i * kLow) + high * 0.5 * Math.exp(-i * kHigh));
      highPrev = high;
    }
    taps.forEach(([t, g], j) => {
      const at = Math.round(SR * (t + (ch ? 0.0031 * (j % 3) : 0)));
      if (at < n) c[at] += g * (ch ^ (j & 1) ? -1 : 1);
    });
    fadeOut(c, 0.2);
  });
  return chans;
}

const C4 = 261.63, C5 = 523.25;
const sounds = {
  // Steel comb tooth: a cantilever, so overtones sit at 6.27× and 17.55× and die quickly.
  musicbox: { root: 72, data: wav([modal(C5, [[1, 1, 1.6], [2, 0.12, 0.5], [6.27, 0.32, 0.18], [17.55, 0.08, 0.05]], 2.2, { click: 0.25, seed: 3 })]) },
  // Kalimba tine plus a little wooden box resonance.
  kalimba: { root: 60, data: wav([modal(C4, [[1, 1, 1.1], [1.003, 0.4, 0.9], [5.9, 0.25, 0.12], [2.01, 0.08, 0.3], [0.5, 0.05, 0.25]], 2.0, { click: 0.4, seed: 5 })]) },
  // Tuned rosewood bar: overtones near 4× and 10×, with the resonator holding the fundamental.
  marimba: { root: 60, data: wav([modal(C4, [[1, 1, 0.75], [3.93, 0.35, 0.16], [9.2, 0.1, 0.05]], 1.8, { attack: 0.003, click: 0.15, seed: 7 })]) },
  // Plucked gut string.
  harp: { root: 60, data: wav([pluck(C4, 2.4, 11)]) },
  // Free metal bar: the inharmonic 2.76 / 5.40 / 8.93 series gives the celesta its glassy shimmer.
  celesta: { root: 72, data: wav([modal(C5, [[1, 1, 1.8], [2.76, 0.3, 0.6], [5.4, 0.12, 0.25], [8.93, 0.05, 0.1]], 2.3, { seed: 13 })]) },
  hall: { data: wav(hall(2.6, 2.3, 17)) }
};

process.stdout.write("const SOUNDS = " + JSON.stringify(sounds) + ";\n");
