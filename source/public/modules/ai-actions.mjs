/* Pillow AI — runs the real site tools for the chat and returns download cards. */
import { ACTIONS } from './ai-intent.mjs?v=93';
const base = name => (name || 'video').replace(/\.[^.]+$/, '') || 'video';
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(1) + ' MB';

export async function runAction(action, file, hooks = {}) {
  if (!ACTIONS[action]) throw new Error('Unknown action');
  return action === 'beats' ? runBeats(file, hooks) : runVideo(action, file, hooks);
}

async function runVideo(action, file, { onStatus = () => {}, onProgress = () => {}, signal } = {}) {
  const { processVideo, inspectVideo } = await import('./video-engine.mjs?v=93');
  const name = base(file.name);
  if (action === 'enhance2k' || action === 'enhance4k') {
    const target = action === 'enhance4k' ? '4k' : '2k';
    try {
      const { enhanceSize } = await import('./video-plan.mjs?v=93');
      const info = await inspectVideo(file, { signal });
      if (!enhanceSize(info, target).available) {
        if (target === '2k' && enhanceSize(info, '4k').available) throw new Error('This video is already 2K. Try 4K.');
        throw new Error('This video is already ' + target.toUpperCase() + ' or larger.');
      }
    } catch (e) { if (/already/.test(e.message)) throw e; }
    const r = await processVideo(file, { mode: 'enhance', target }, { onStatus, onProgress, signal });
    const hevc = r.plan.codec === 'hevc';
    return { title: ACTIONS[action].label, meta: `${r.plan.width} × ${r.plan.height} · ${hevc ? 'H.265' : 'H.264'} · ${mb(r.output.size)}`, note: r.plan.fallback || '',
      files: [{ name: `${name}_pillow_${target}_${hevc ? 'h265' : 'h264'}.mp4`, blob: r.output, primary: true, label: 'Download video' }], preview: r.output };
  }
  const mode = action === 'max' ? 'max' : 'enhanced';
  const r = await processVideo(file, { mode }, { onStatus, onProgress, signal });
  const fps = Number(r.plan.fps.toFixed(2)), mbps = r.info.duration ? ` · ${(r.output.size * 8 / r.info.duration / 1e6).toFixed(1)} Mbps` : '';
  const files = [{ name: name + (mode === 'max' ? '_pillow_max.mp4' : '_pillow_enhanced.mp4'), blob: r.output, primary: true, label: 'Download for TikTok' }];
  if (mode === 'enhanced' && r.preview) files.push({ name: name + '_pillow_compatible.mp4', blob: r.preview, label: 'Compatible MP4' });
  return { title: ACTIONS[action].label, meta: `${r.plan.width} × ${r.plan.height} · ${fps} FPS${mode === 'max' ? mbps : ''} · ${mb(r.output.size)}`,
    note: 'Upload in TikTok Studio on a computer.', files, preview: r.preview || r.output };
}

async function runBeats(file, { onStatus = () => {}, signal } = {}) {
  const { extractFeatures, detectStructure, autoBeats, AUTO_SENSITIVITY } = await import('./beat-analysis.mjs?v=93');
  const { beatsPayload, payloadJsx } = await import('./ae-bridge.mjs?v=93');
  if (!file.size || file.size > 512 * 1024 * 1024) throw new Error('Choose an audio or video file under 512 MB.');
  onStatus('Reading audio…');
  const ac = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  let decoded;
  try { decoded = await ac.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error("Couldn't read audio from this file. Try WAV, MP3, M4A or an MP4 with sound."); }
  finally { ac.close().catch(() => {}); }
  if (decoded.duration > 900) throw new Error('Choose a track up to 15 minutes.');
  const channels = []; for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) channels.push(decoded.getChannelData(c));
  const F = await extractFeatures(channels, decoded.sampleRate, { signal, onProgress: p => onStatus(`Finding beats… ${Math.round(p * 100)}%`) });
  const S = await detectStructure(F, { signal });
  const beats = autoBeats(F, S);
  if (!beats.length) throw new Error('No clear beats in this file.');
  const payload = beatsPayload({ source: { name: file.name, duration: decoded.duration, sampleRate: decoded.sampleRate }, analysis: { mode: 'auto', bpm: S.bpm, sensitivity: AUTO_SENSITIVITY }, markers: beats, options: { types: { hit: true, cut: false, section: false }, layers: 'none', target: 'auto' } });
  const name = base(file.name);
  return { title: 'Auto Beats', meta: `${beats.length} beats · ${S.bpm ? Math.round(S.bpm) + ' BPM' : '—'} · ${decoded.duration.toFixed(1)} s`,
    note: 'File → Scripts → Run Script File. Markers go on the selected layer, or the comp.',
    files: [{ name: name + '_beats.jsx', blob: new Blob([payloadJsx(payload)], { type: 'text/plain' }), primary: true, label: 'Download .jsx' },
            { name: name + '.pillow-beats.json', blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), label: 'Panel .json' }],
    copy: beats.map(m => m.time.toFixed(3)).join(', '), beats: beats.map(m => m.time), duration: decoded.duration };
}
