/* Synthetic test media. Nothing here comes from real user files. */
import fs from 'node:fs';
/* A 120 BPM track with a clear structure: 8 bars intro (hats only), 8 bars build (kick + snare),
   8 bars drop (louder kick, bass, snare, hats), 4 bars break (pads only), 4 bars outro (kick). */
export function synthTrack({ rate = 44100, bpm = 120, offset = 0.25 } = {}) {
  const beat = 60 / bpm, bars = [['intro', 8], ['build', 8], ['drop', 8], ['break', 4], ['outro', 4]];
  const totalBeats = bars.reduce((s, [, n]) => s + n * 4, 0), duration = offset + totalBeats * beat + 1;
  const x = new Float32Array(Math.ceil(duration * rate));
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const add = (t, len, fn) => { const s = Math.round(t * rate); for (let i = 0; i < len * rate && s + i < x.length; i++) x[s + i] += fn(i / rate); };
  const kick = (t, g) => add(t, .25, u => g * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-u * 30)) * u) * Math.exp(-u * 14));
  const snare = (t, g) => add(t, .18, u => g * rnd() * Math.exp(-u * 22));
  const hat = (t, g) => add(t, .04, u => g * rnd() * Math.exp(-u * 120) * (Math.sin(2 * Math.PI * 9000 * u) > 0 ? 1 : -1));
  const truth = { beats: [], downbeats: [], sections: [] };
  let b = 0;
  for (const [name, n] of bars) {
    truth.sections.push({ label: name, start: offset + b * beat });
    for (let i = 0; i < n * 4; i++, b++) {
      const t = offset + b * beat; truth.beats.push(t); if (b % 4 === 0) truth.downbeats.push(t);
      if (name === 'intro') { hat(t, .12); hat(t + beat / 2, .08); }
      if (name === 'build') { kick(t, .45); if (b % 2) snare(t, .18); hat(t + beat / 2, .1); }
      if (name === 'drop') { kick(t, b % 4 === 0 ? .95 : .8); if (b % 2) snare(t, .35); hat(t + beat / 2, .16); add(t, beat * .9, u => .18 * Math.sin(2 * Math.PI * 55 * u)); }
      if (name === 'break') add(t, beat, u => .05 * Math.sin(2 * Math.PI * 220 * u) + .03 * Math.sin(2 * Math.PI * 330 * u));
      if (name === 'outro') { kick(t, .4); }
    }
  }
  for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i]));
  return { samples: x, rate, duration, truth };
}
export function wavBuffer(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(samples[i] * 32000), 44 + i * 2);
  return b;
}
export function writeTrack(file, opts) { const t = synthTrack(opts); fs.writeFileSync(file, wavBuffer(t.samples, t.rate)); return t; }
