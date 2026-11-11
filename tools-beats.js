/* Pillow Auto Beats — drop a track, get beat markers, send them to After Effects. */
import {$, download} from './modules/tool-ui.mjs?v=94';
import {extractFeatures, detectStructure, autoBeats, AUTO_SENSITIVITY} from './modules/beat-analysis.mjs?v=94';
import {beatsPayload, payloadJsx} from './modules/ae-bridge.mjs?v=94';

const pane = $('[data-pane=beats]');
if (pane) {
  const st = $('.tool-status', pane), cv = $('canvas', pane), au = $('audio', pane), res = $('.beat-res', pane);
  const drop = $('.tool-drop', pane), input = $('input[type=file]', pane), fname = $('.tool-fname', pane);
  let buf = null, fileName = 'beats', sourceName = '', objUrl = null, selection = 0, busy = false, beats = [], bpm = 0, peaks = null;

  function computePeaks(W) {
    const d = buf.getChannelData(0), step = d.length / W, out = new Float32Array(W);
    for (let x = 0; x < W; x++) { let mx = 0; const a = Math.floor(x * step), b = Math.min(d.length, Math.floor((x + 1) * step)), inc = Math.max(1, Math.floor((b - a) / 64)); for (let j = a; j < b; j += inc) { const v = Math.abs(d[j]); if (v > mx) mx = v; } out[x] = mx; }
    return out;
  }
  function draw(cur) {
    if (!buf || res.hidden) return;
    const dpr = devicePixelRatio || 1, W = cv.width = Math.max(1, Math.round(cv.clientWidth * dpr)), H = cv.height = Math.round(128 * dpr);
    if (!peaks || peaks.length !== W) peaks = computePeaks(W);
    const g = cv.getContext('2d'), fg = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff', X = t => t / buf.duration * W, mid = H / 2, amp = H * .44;
    g.clearRect(0, 0, W, H); g.fillStyle = fg;
    g.globalAlpha = .3; for (let x = 0; x < W; x++) { const h = Math.max(dpr * .6, peaks[x] * amp); g.fillRect(x, mid - h, 1, h * 2); }
    g.globalAlpha = .85; for (const m of beats) g.fillRect(Math.round(X(m.time)), 6 * dpr, Math.max(1, dpr), H - 12 * dpr);
    if (cur > 0) { g.globalAlpha = 1; g.fillRect(X(cur) - dpr, 0, 2 * dpr, H); }
    g.globalAlpha = 1;
  }

  async function load(f) {
    if (busy) return;
    const current = ++selection; buf = null; beats = []; bpm = 0; peaks = null; res.hidden = true;
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    let ac = null; busy = true; drop.disabled = true;
    try {
      if (!f.size || f.size > 512 * 1024 * 1024) throw new Error('Choose an audio or video file under 512 MB.');
      fname.textContent = f.name; drop.classList.add('has-file');
      st.textContent = 'Reading audio…'; fileName = f.name.replace(/\.[^.]+$/, '') || 'beats'; sourceName = f.name;
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await ac.decodeAudioData(await f.arrayBuffer());
      if (current !== selection) return;
      if (decoded.duration > 900) throw new Error('Choose a track up to 15 minutes.');
      const channels = []; for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) channels.push(decoded.getChannelData(c));
      const F = await extractFeatures(channels, decoded.sampleRate, { onProgress: p => { if (current === selection) st.textContent = `Finding beats… ${Math.round(p * 100)}%`; } });
      const S = await detectStructure(F);
      if (current !== selection) return;
      buf = decoded; beats = autoBeats(F, S); bpm = S.bpm;
      objUrl = URL.createObjectURL(f); au.src = objUrl;
      $('.beat-count', res).textContent = beats.length;
      $('.beat-bpm', res).textContent = bpm ? String(Math.round(bpm)) : '—';
      st.textContent = beats.length ? '' : 'No clear beats in this file.';
      res.hidden = false; draw(0);
    } catch (e) {
      if (current === selection) st.textContent = e.name === 'EncodingError' || /decode/i.test(e.message || '') ? "Couldn't read audio from this file. Try WAV, MP3, M4A or an MP4 with sound." : e.message || "Couldn't read audio from this file.";
    } finally { if (ac) ac.close().catch(() => {}); if (current === selection) { busy = false; drop.disabled = false; } }
  }

  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) load(input.files[0]); input.value = ''; });
  ['dragover', 'dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); if (!busy) drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', ev => { if (ev.dataTransfer.files[0]) load(ev.dataTransfer.files[0]); });
  cv.addEventListener('click', e => { if (!buf) return; au.currentTime = Math.max(0, Math.min(buf.duration, e.offsetX / cv.clientWidth * buf.duration)); au.play().catch(() => {}); });
  au.addEventListener('timeupdate', () => draw(au.currentTime));
  window.addEventListener('pillow:tab', () => { if (buf && !pane.hidden) requestAnimationFrame(() => draw(au.currentTime)); });
  window.addEventListener('resize', () => { if (buf && !pane.hidden) draw(au.currentTime); });
  window.addEventListener('beforeunload', () => { if (objUrl) URL.revokeObjectURL(objUrl); });

  const payload = () => beatsPayload({ source: { name: sourceName, duration: buf.duration, sampleRate: buf.sampleRate }, analysis: { mode: 'auto', bpm, sensitivity: AUTO_SENSITIVITY }, markers: beats, options: { types: { hit: true, cut: false, section: false }, layers: 'none', target: 'auto' } });
  const ready = () => { if (!buf || !beats.length) { st.textContent = 'Add a track with beats first.'; return false; } return true; };
  $('.dl-jsx', pane).addEventListener('click', () => { if (!ready()) return; download(fileName + '_beats.jsx', payloadJsx(payload()), 'text/plain'); st.textContent = 'Saved. Run it in After Effects.'; });
  $('.dl-json', pane).addEventListener('click', () => { if (!ready()) return; download(fileName + '.pillow-beats.json', JSON.stringify(payload(), null, 2), 'application/json'); st.textContent = 'Saved. Pillow panel → Music → Import from Pillow Hub.'; });
  $('.dl-copy', pane).addEventListener('click', e => {
    if (!ready()) return; const b = e.currentTarget, text = beats.map(m => m.time.toFixed(3)).join(', ');
    navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy seconds'; }, 1500); }).catch(() => { st.textContent = 'Clipboard unavailable here.'; });
  });
}
