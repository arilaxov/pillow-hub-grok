/* Pillow Beat Sync — Smart analysis. Classical signal processing, no neural network:
   1. waveform → short-time spectrum (Hann window, FFT) → spectral flux per band (low / mid / high)
   2. onset curve → tempo (autocorrelation with a gentle 120 BPM prior) → beat grid (dynamic programming)
   3. downbeats: the beat phase where the low band hits hardest
   4. sections: bar-by-bar energy, novelty between neighbouring bars, labelled by relative energy
   5. suggestions: strong hits, plus sparse cut points on downbeats and section changes. */
const WIN = 1024, HOP = 256;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const abort = () => new DOMException('Analysis cancelled.', 'AbortError');

function fftPlan(n) {
  const rev = new Uint32Array(n), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1); rev[i] = r; }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  return { rev, cos, sin, n };
}
function fft(re, im, plan) {
  const { rev, cos, sin, n } = plan;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) for (let k = 0; k < half; k++) {
      const a = i + k, b = a + half, c = cos[k * step], s = sin[k * step];
      const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}

/* channels: Float32Array[] (AudioBuffer channel data) */
export async function extractFeatures(channels, sampleRate, { signal, onProgress } = {}) {
  const step = sampleRate >= 40000 ? 2 : 1, sr = sampleRate / step, len = Math.floor(channels[0].length / step);
  const x = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) x[i] += (step === 2 ? (ch[i * 2] + ch[i * 2 + 1]) * .5 : ch[i]) / channels.length;
  const frames = Math.max(0, Math.floor((len - WIN) / HOP) + 1), plan = fftPlan(WIN), half = WIN / 2;
  const win = new Float32Array(WIN); for (let i = 0; i < WIN; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (WIN - 1));
  const band = new Uint8Array(half); for (let i = 0; i < half; i++) { const hz = i * sr / WIN; band[i] = hz < 150 ? 0 : hz < 2500 ? 1 : 2; }
  const low = new Float32Array(frames), mid = new Float32Array(frames), high = new Float32Array(frames), rms = new Float32Array(frames);
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  let prev = new Float32Array(half), cur = new Float32Array(half);
  for (let f = 0; f < frames; f++) {
    if (f % 3000 === 0 && f) { if (signal?.aborted) throw abort(); onProgress?.(f / frames); await tick(); }
    const o = f * HOP; let e = 0;
    for (let i = 0; i < WIN; i++) { const v = x[o + i]; e += v * v; re[i] = v * win[i]; im[i] = 0; }
    rms[f] = Math.sqrt(e / WIN);
    fft(re, im, plan);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 1; i < half; i++) {
      const m = Math.log1p(100 * Math.hypot(re[i], im[i])); cur[i] = m;
      const d = m - prev[i];
      if (d > 0 && f) { if (band[i] === 0) s0 += d; else if (band[i] === 1) s1 += d; else s2 += d; }
    }
    const t = prev; prev = cur; cur = t;
    low[f] = s0; mid[f] = s1 / 8; high[f] = s2 / 24;
  }
  onProgress?.(1);
  return { sr, hop: HOP, win: WIN, fps: sr / HOP, frames, duration: len / sr, low, mid, high, rms };
}

const frameTime = (f, F) => (f * F.hop + F.win * .5) / F.sr;
function mean(a, from = 0, to = a.length) { let s = 0; for (let i = from; i < to; i++) s += a[i]; return to > from ? s / (to - from) : 0; }
function percentile(values, p) { if (!values.length) return 0; const s = Float64Array.from(values).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

function onsetCurve(F) {
  const n = F.frames, o = new Float32Array(n), max = [F.low, F.mid, F.high].map(a => percentile(a, .98) || 1);
  for (let i = 0; i < n; i++) o[i] = F.low[i] / max[0] * 1.2 + F.mid[i] / max[1] + F.high[i] / max[2] * .6;
  // remove the slowly moving part so only attacks remain
  const w = Math.round(F.fps * .25), out = new Float32Array(n);
  let sum = 0, count = 0;
  for (let i = 0; i < Math.min(n, w); i++) { sum += o[i]; count++; }
  for (let i = 0; i < n; i++) {
    if (i + w < n) { sum += o[i + w]; count++; }
    if (i - w - 1 >= 0) { sum -= o[i - w - 1]; count--; }
    out[i] = Math.max(0, o[i] - sum / count);
  }
  return out;
}

function estimateTempo(o, fps) {
  const n = o.length, minLag = Math.floor(fps * 60 / 200), maxLag = Math.min(n - 2, Math.ceil(fps * 60 / 60));
  if (maxLag <= minLag + 2) return 0;
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = minLag >> 1; lag <= Math.min(n - 2, maxLag * 2); lag++) { let s = 0; for (let i = lag; i < n; i++) s += o[i] * o[i - lag]; ac[lag] = s / (n - lag); }
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * fps / lag, prior = Math.exp(-.5 * (Math.log2(bpm / 120) / .9) ** 2);
    const score = prior * (ac[lag] + .5 * (ac[lag * 2] || 0) + .25 * (ac[Math.round(lag / 2)] || 0));
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!bestLag) return 0;
  const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1], d = a - 2 * b + c;
  const lag = bestLag + (d < 0 ? .5 * (a - c) / d : 0);
  return 60 * fps / lag;
}

function trackBeats(o, period) {
  const n = o.length; if (!n || !(period > 1)) return [];
  const sd = Math.sqrt(mean(o.map(v => v * v))) || 1, local = o.map(v => v / sd);
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1), lo = Math.round(period / 2), hi = Math.round(period * 2), tight = 100;
  for (let i = 0; i < n; i++) {
    let best = -Infinity, arg = -1;
    for (let p = i - hi; p <= i - lo; p++) { if (p < 0) continue; const v = score[p] - tight * Math.log((i - p) / period) ** 2; if (v > best) { best = v; arg = p; } }
    score[i] = local[i] + (arg >= 0 ? best : 0); back[i] = arg;
  }
  let end = n - 1; for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[end]) end = i;
  const beats = []; for (let i = end; i >= 0; i = back[i]) beats.push(i);
  return beats.reverse();
}

const peakNear = (a, f, r = 2) => { let m = 0; for (let i = Math.max(0, f - r); i <= Math.min(a.length - 1, f + r); i++) m = Math.max(m, a[i]); return m; };

function labelSections(segments) {
  // energies are in dB: the loudest part (within 3.5 dB of the peak) reads as the drop
  const max = Math.max(...segments.map(s => s.energy)), loud = s => s.energy >= max - 3.5;
  segments.forEach((s, i) => {
    const prev = segments[i - 1], next = segments[i + 1];
    if (segments.length === 1) s.label = 'Groove';
    else if (loud(s)) s.label = 'Drop';
    else if (i === 0 && s.energy < max - 6) s.label = 'Intro';
    else if (!next && s.energy < max - 6 && segments.length > 2) s.label = 'Outro';
    else if (next && loud(next) && s.energy < next.energy) s.label = 'Build';
    else if (prev && loud(prev) && s.energy < max - 6) s.label = 'Break';
    else s.label = 'Groove';
  });
  const merged = [];
  for (const s of segments) { const last = merged[merged.length - 1]; if (last && last.label === s.label) { last.end = s.end; last.energy = Math.max(last.energy, s.energy); } else merged.push({ ...s }); }
  return merged.map(({ start, end, label, energy }) => ({ start, end, label, energy }));
}

/* Tempo, beats, downbeats and sections: independent of the sensitivity slider. */
export async function detectStructure(F, { signal } = {}) {
  const o = onsetCurve(F), duration = F.duration;
  await tick(); if (signal?.aborted) throw abort();
  let bpm = estimateTempo(o, F.fps);
  if (!(bpm > 0)) return { bpm: 0, beats: [], downbeats: [], sections: [{ start: 0, end: duration, label: 'Groove', energy: 0 }], onset: o };
  let beatFrames = trackBeats(o, F.fps * 60 / bpm);
  { const level = percentile(o, .9) * .25, active = beatFrames.map(f => peakNear(o, f, 3) > level), first = active.indexOf(true), last = active.lastIndexOf(true); if (first >= 0) beatFrames = beatFrames.slice(first, last + 1); }
  await tick(); if (signal?.aborted) throw abort();
  if (beatFrames.length > 8) { // refine tempo from the tracked grid
    const gaps = beatFrames.slice(1).map((f, i) => f - beatFrames[i]).sort((a, b) => a - b);
    const med = gaps[gaps.length >> 1], fit = (beatFrames[beatFrames.length - 1] - beatFrames[0]) / (beatFrames.length - 1);
    if (Math.abs(fit - med) / med < .08) bpm = 60 * F.fps / fit;
  }
  const lowMax = percentile(F.low, .98) || 1, midMax = percentile(F.mid, .98) || 1;
  // energy around each beat: section changes land on downbeats, kicks lead, snares sit on 2 and 4
  const beatEnergy = beatFrames.map((f, i) => mean(F.rms, f, beatFrames[i + 1] ?? Math.min(F.frames, f + Math.round(F.fps * 60 / bpm))));
  const jump = beatEnergy.map((_, i) => { if (i < 4 || i + 4 > beatEnergy.length) return 0; return Math.abs(Math.log((mean(beatEnergy, i, i + 4) + 1e-6) / (mean(beatEnergy, i - 4, i) + 1e-6))); });
  const jumpMax = Math.max(...jump) || 1;
  let phase = 0, bestPhase = -Infinity;
  for (let p = 0; p < 4; p++) {
    let s = 0, c = 0;
    for (let i = p; i < beatFrames.length; i += 4, c++) s += peakNear(F.low, beatFrames[i]) / lowMax - .3 * peakNear(F.mid, beatFrames[i]) / midMax + 1.5 * jump[i] / jumpMax;
    s /= Math.max(1, c);
    if (s > bestPhase) { bestPhase = s; phase = p; }
  }
  const beats = beatFrames.map(f => frameTime(f, F)), down = beatFrames.filter((_, i) => i % 4 === phase);
  // bar energy → novelty → section boundaries
  const bars = [];
  const barLen = F.fps * 240 / bpm, edges = [0, ...down.filter(f => f > barLen / 2 && F.frames - f > barLen / 2), F.frames];
  for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > 2) bars.push({ from: edges[i], to: edges[i + 1], e: mean(F.rms, edges[i], edges[i + 1]) + .5 * mean(F.low, edges[i], edges[i + 1]) / lowMax * mean(F.rms) });
  const e = bars.map(b => 20 * Math.log10(b.e + 1e-6)), eSpan = (Math.max(...e) - Math.min(...e)) || 1;
  const novelty = e.map((_, b) => { const w = Math.min(4, b, e.length - b); if (w < 2) return 0; return Math.abs(mean(e, b, b + w) - mean(e, b - w, b)) / eSpan; });
  const cuts = [0];
  const order = novelty.map((v, b) => [v, b]).filter(([v, b]) => v > .12 && v >= (novelty[b - 1] || 0) && v >= (novelty[b + 1] || 0)).sort((a, b) => b[0] - a[0]);
  for (const [, b] of order) if (cuts.every(c => Math.abs(c - b) >= 4) && e.length - b >= 2) cuts.push(b);
  cuts.sort((a, b) => a - b);
  const segments = cuts.map((b, i) => {
    const endBar = cuts[i + 1] ?? bars.length;
    const start = i === 0 ? 0 : frameTime(bars[b].from, F), end = endBar >= bars.length ? duration : frameTime(bars[endBar].from, F);
    return { start, end, energy: mean(e, b, endBar) };
  }).filter(s => s.end - s.start > .5);
  return { bpm: Math.round(bpm * 10) / 10, beats, downbeats: down.map(f => frameTime(f, F)), sections: labelSections(segments.length ? segments : [{ start: 0, end: duration, energy: 0 }]), onset: o, beatFrames, downFrames: down };
}

/* Strong hits and sparse cut suggestions; cheap, so it reruns live with the slider (1…3). */
export function buildSuggestions(F, S, sensitivity = 2.4) {
  const o = S.onset, n = o.length, sens = Math.min(3, Math.max(1, +sensitivity || 2.4));
  if (!n) return { hits: [], cuts: [] };
  const k = 1 + (3 - sens) * .9, w = Math.round(F.fps * .4), r = Math.max(1, Math.round(F.fps * .05)), gap = Math.round(F.fps * .09);
  const floor = percentile(o, .5) + 1e-6, top = percentile(o, .995) || 1;
  const prefix = new Float64Array(n + 1); for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + o[i];
  const raw = [];
  for (let i = 1; i < n - 1; i++) {
    const v = o[i]; if (v < floor * 2 || v < top * (.5 - (sens - 1) * .22)) continue;
    let isPeak = true; for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (o[j] > v || (o[j] === v && j < i)) { isPeak = false; break; }
    if (!isPeak) continue;
    const a = Math.max(0, i - w), b = Math.min(n, i + w), local = (prefix[b] - prefix[a]) / (b - a);
    if (v > local * k + floor * .5 && (!raw.length || i - raw[raw.length - 1].f >= gap)) raw.push({ f: i, v });
  }
  const beatTimes = S.beats || [];
  const snap = t => { let lo = 0, hi = beatTimes.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (beatTimes[m] < t) lo = m + 1; else hi = m; } let best = t; for (const c of [beatTimes[lo - 1], beatTimes[lo]]) if (c != null && Math.abs(c - t) < .035 && Math.abs(c - t) < Math.abs(best - t) + .035) best = c; return best; };
  const hits = []; for (const p of raw) { const t = snap(frameTime(p.f, F)); if (!hits.length || t - hits[hits.length - 1].time > .05) hits.push({ time: t, strength: Math.min(1, p.v / top) }); }
  // cut candidates: downbeats, weighted by attack and low end; section starts always qualify
  const lowMax = percentile(F.low, .98) || 1, bar = S.bpm ? 240 / S.bpm : 2;
  const candidates = (S.downFrames || []).map(f => ({ time: frameTime(f, F), strength: Math.min(1, .65 * peakNear(o, f) / top + .35 * peakNear(F.low, f) / lowMax) }));
  for (const s of S.sections.slice(1)) candidates.push({ time: s.start, strength: 1.01, section: true });
  const minBars = sens >= 2.5 ? 1 : sens >= 1.7 ? 2 : 4, threshold = percentile(candidates.filter(c => !c.section).map(c => c.strength), .45 - (sens - 2) * .2);
  const cuts = [];
  for (const c of candidates.sort((a, b) => b.strength - a.strength)) {
    if (!c.section && c.strength < threshold) continue;
    if (cuts.every(x => Math.abs(x.time - c.time) >= bar * minBars * .9)) cuts.push({ time: c.time, strength: Math.min(1, c.strength) });
  }
  cuts.sort((a, b) => a.time - b.time);
  return { hits, cuts };
}

/* One call for tests and simple use. onStatus receives the three progressive steps. */
export async function analyzeSmart(channels, sampleRate, { sensitivity = 2.4, onStatus, signal } = {}) {
  onStatus?.('Analyzing waveform…');
  const F = await extractFeatures(channels, sampleRate, { signal });
  onStatus?.('Detecting structure…');
  const S = await detectStructure(F, { signal });
  onStatus?.('Building suggestions…'); await tick();
  return { features: F, structure: S, ...buildSuggestions(F, S, sensitivity) };
}

/* Auto Beats: one marker per tracked beat that actually carries a hit, plus section starts.
   Fixed sensitivity, on the grid, nothing in silence or quiet breaks. */
export const AUTO_SENSITIVITY = 0.2;
export function autoBeats(F, S) {
  const o = S.onset || [], top = percentile(o, .995) || 1, out = [];
  const frame = t => Math.max(0, Math.round((t * F.sr - F.win * .5) / F.hop));
  for (const t of S.beats || []) { const v = peakNear(o, frame(t), 3) / top; if (v >= AUTO_SENSITIVITY) out.push({ time: t, type: 'hit', strength: Math.min(1, v) }); }
  for (const s of (S.sections || []).slice(1)) if (!out.some(m => Math.abs(m.time - s.start) < .08)) out.push({ time: s.start, type: 'hit', strength: 1 });
  return out.sort((a, b) => a.time - b.time).map(m => ({ ...m, time: Math.round(m.time * 1000) / 1000, strength: Math.round(m.strength * 100) / 100 }));
}
