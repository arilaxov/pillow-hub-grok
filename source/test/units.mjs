/* Unit checks for v93: Auto Beats analysis, AE bridge (.jsx / .json), panel import, Enhancer auto-tuning
   and sizes, Max Quality plan and the MP4 container patch (verified with FFmpeg / FFprobe when present).
   Run: node test/units.mjs (part of npm test). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {analyzeSmart, buildSuggestions, autoBeats} from '../public/modules/beat-analysis.mjs';
import {beatsPayload, payloadJsx, AE_RUNTIME, SCHEMAS, toCSV, esLiteral, validatePayload} from '../public/modules/ae-bridge.mjs';
import {makePlan, enhanceSize, autoTune, maxSize, bitrateFor, canCopyMethod} from '../public/modules/video-plan.mjs';
import {patchForUpload, describeMp4, mvhdDuration64} from '../public/modules/mp4-patch.mjs';
import {synthTrack} from './fixtures.mjs';
import {createAE, es3Problems} from './ae-mock.mjs';

let passed = 0;
const ok = name => { passed++; console.log('  ✓ ' + name); };
const has = cmd => { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pillow-units-'));
const day = new Date(2026, 10, 10, 14, 30, 5);

try {
  // ---------- beats ----------
  const track = synthTrack(), steps = [];
  const r = await analyzeSmart([track.samples], track.rate, { onStatus: s => steps.push(s) });
  assert.deepEqual(steps, ['Analyzing waveform…', 'Detecting structure…', 'Building suggestions…']);
  assert.ok(Math.abs(r.structure.bpm - 120) < 1, 'tempo ' + r.structure.bpm);
  const errs = r.structure.beats.map(b => Math.min(...track.truth.beats.map(x => Math.abs(x - b)))).sort((a, b) => a - b);
  assert.ok(errs[errs.length >> 1] < .03, 'beat timing ' + errs[errs.length >> 1]);
  assert.ok(r.structure.downbeats.slice(0, 8).every(d => track.truth.downbeats.some(x => Math.abs(x - d) < .04)), 'downbeat phase');
  const labels = r.structure.sections.map(s => s.label);
  assert.equal(labels[0], 'Intro'); assert.ok(labels.includes('Drop'));
  const drop = r.structure.sections.find(s => s.label === 'Drop'); assert.ok(Math.abs(drop.start - track.truth.sections[2].start) < .1, 'drop starts at bar 17');
  assert.ok(r.cuts.length > 0 && r.cuts.length < r.hits.length / 4, 'cuts are sparse');
  assert.ok(r.cuts.every(c => track.truth.downbeats.some(x => Math.abs(x - c.time) < .05)), 'cuts sit on downbeats');
  const low = buildSuggestions(r.features, r.structure, 1), high = buildSuggestions(r.features, r.structure, 3);
  assert.ok(low.hits.length < high.hits.length && low.cuts.length < high.cuts.length, 'sensitivity scales markers');
  const auto = autoBeats(r.features, r.structure);
  assert.ok(auto.length > r.cuts.length && auto.length <= track.truth.beats.length + 2 && auto.every(m => m.type === 'hit'), 'auto beats are one marker type ' + auto.length);
  assert.ok(auto.every((m, i) => !i || m.time - auto[i - 1].time >= .08), 'auto beats are de-duplicated');
  assert.ok(r.cuts.every(c => auto.some(m => Math.abs(m.time - c.time) < .08)), 'every downbeat cut is a beat');
  const truthHits = auto.filter(m => track.truth.beats.some(x => Math.abs(x - m.time) < .05)).length;
  assert.ok(truthHits / auto.length > .95, 'auto beats sit on the beat grid ' + truthHits + '/' + auto.length);
  assert.ok(auto.length / track.truth.beats.length > .7, 'most beats found ' + auto.length + '/' + track.truth.beats.length);
  ok(`beats: Auto Beats (${auto.length} markers) on top of Smart analysis finds 120 BPM, beats, downbeats, Intro → Drop sections, sparse cuts (${r.hits.length} hits, ${r.cuts.length} cuts)`);

  // ---------- AE bridge: beats ----------
  const markers = [...r.hits.map(h => ({ time: h.time, type: 'hit' })), ...r.cuts.map(c => ({ time: c.time, type: 'cut' })), ...r.structure.sections.map(s => ({ time: s.start, type: 'section', label: s.label, duration: s.end - s.start }))];
  const payload = beatsPayload({ source: { name: 'Трек “drop” */ x.wav', duration: track.duration, sampleRate: 44100 }, analysis: { mode: 'smart', bpm: r.structure.bpm }, markers, options: { layers: 'nulls' } }, day);
  assert.equal(payload.schema, SCHEMAS.beats); assert.equal(payload.markers.length, markers.length);
  assert.equal(payload.markers.find(m => m.type === 'hit').label, 'Beat 1'); assert.equal(payload.markers.find(m => m.type === 'cut').label, 'Cut 1');
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload);
  const jsx = payloadJsx(payload);
  new Function(jsx); assert.deepEqual(es3Problems(jsx), []); assert.deepEqual(es3Problems(AE_RUNTIME), []);
  assert.ok(/^[\x00-\x7f]*$/.test(jsx), 'jsx is ASCII-only'); assert.match(jsx, /beginUndoGroup/); assert.match(jsx, /File > Scripts > Run Script File/);
  let ae = createAE({ selected: { name: 'Track', startTime: 2 } });
  ae.run(jsx);
  const layer = ae.comp.selectedLayers[0], keys = layer.marker.keys;
  assert.equal(keys.length, markers.filter(m => 2 + m.time <= ae.comp.duration).length, 'every marker on the selected layer');
  assert.ok(Math.abs(keys[0].t - (2 + payload.markers[0].time)) < 1e-9, 'layer start offset');
  assert.ok(keys.some(k => k.v.comment === 'Drop' && k.v.duration > 1 && k.v.params.pillow === 'section'));
  assert.equal(ae.comp.added.filter(l => l.kind === 'null').length, r.cuts.length, 'a null per cut');
  assert.ok(ae.comp.added.every(l => l.above === 'Track'));
  assert.deepEqual(ae.log.undo, ['begin Pillow · Auto Beats', 'end']); assert.match(ae.log.alerts[0], /markers on “Track”/);
  ae.run(jsx); assert.equal(layer.marker.keys.length, keys.length, 'running again replaces Pillow markers');
  ae = createAE(); ae.run(payloadJsx(payload, { types: { hit: false, cut: true, section: true }, layers: 'solids' }));
  assert.equal(ae.comp.markerProperty.keys.length, r.cuts.length + r.structure.sections.length, 'comp markers when nothing is selected, filtered by type');
  assert.equal(ae.comp.added.filter(l => l.kind === 'solid' && l.guideLayer).length, r.structure.sections.length, 'guide solids per section');
  ae = createAE(); ae.context.app.project.activeItem = null; ae.run(jsx); assert.match(ae.log.alerts[0], /Open a composition/);
  ok('bridge: beats JSON (pillow.beats.v1) and .jsx — ES3-safe, ASCII, undo group, layer/comp targets, type filters, nulls/solids, re-run safe');

  const autoPayload = beatsPayload({ source: { name: 'song.wav', duration: track.duration }, analysis: { mode: 'auto', bpm: r.structure.bpm }, markers: auto, options: { types: { hit: true, cut: false, section: false }, layers: 'none' } }, day);
  ae = createAE({ selected: { name: 'Song' } }); ae.run(payloadJsx(autoPayload));
  assert.equal(ae.comp.selectedLayers[0].marker.keys.length, auto.filter(m => m.time <= ae.comp.duration).length, 'auto beats land as markers');
  assert.equal(ae.comp.added.length, 0, 'no extra layers');
  assert.equal(validatePayload({ schema: 'pillow.rename.v1', items: [] }), 'Unknown schema.', 'rename schema is gone');
  assert.match(toCSV([['a', 'b,c', '=1+1', 'q"t']]), /^a,"b,c","'=1\+1","q""t"\n$/);
  assert.equal(esLiteral('ü\u2028'), '"\\u00fc\\u2028"');
  ok('bridge: Auto Beats .jsx puts plain markers on the layer; rename schema removed');

  // ---------- panel host ----------
  const panelZip = path.join(path.dirname(new URL(import.meta.url).pathname), '../public/downloads/Pillow-v192.zip');
  const {readZip, entryText} = await import('../scripts/build-panel.mjs');
  const entries = readZip(fs.readFileSync(panelZip)), text = n => entryText(entries.find(e => e.name === n));
  const host = text('Pillow/host/pillow.jsx');
  assert.ok(host.includes(AE_RUNTIME), 'panel host carries the current runtime');
  assert.match(text('Pillow/index.html'), /id="hub-import"[\s\S]*js\/hub-import\.js/); assert.match(text('Pillow/CSXS/manifest.xml'), /ExtensionBundleVersion="1\.1\.1"/);
  ae = createAE({ selected: { name: 'Song' } });
  ae.run(host);
  const reply = JSON.parse(ae.run(`pillowHubImport(${JSON.stringify(encodeURIComponent(JSON.stringify(payload)))})`));
  assert.equal(reply.ok, true, reply.error); assert.ok(reply.count > 0); assert.equal(ae.comp.selectedLayers[0].marker.keys.length, reply.count);
  const bad = JSON.parse(ae.run(`pillowHubImport(${JSON.stringify(encodeURIComponent('{"schema":"other"}'))})`)); assert.equal(bad.ok, false);
  const newer = JSON.parse(ae.run(`pillowHubImport(${JSON.stringify(encodeURIComponent('{"schema":"pillow.beats.v2"}'))})`)); assert.match(newer.error, /newer Pillow panel/);
  const old = JSON.parse(ae.run(`pillowHubImport(${JSON.stringify(encodeURIComponent('{"schema":"pillow.rename.v1","items":[]}'))})`)); assert.equal(old.ok, false);
  assert.doesNotMatch(text('Pillow/js/hub-import.js'), /rename/);
  ok('panel: Pillow-v192.zip (1.1.1) host imports pillow.beats.v1 through pillowHubImport and rejects unknown schemas');

  // ---------- Enhancer: sizes and auto-tuning ----------
  const p1080 = { width: 1080, height: 1920, fps: 30, bitrate: 12e6, duration: 10 };
  assert.deepEqual([enhanceSize(p1080, '2k').width, enhanceSize(p1080, '2k').height, enhanceSize(p1080, '2k').available], [1440, 2560, true]);
  assert.deepEqual([enhanceSize(p1080, '4k').width, enhanceSize(p1080, '4k').height], [2160, 3840]);
  const land = { width: 1920, height: 1080, fps: 60 };
  assert.deepEqual([enhanceSize(land, '2k').width, enhanceSize(land, '2k').height], [2560, 1440]);
  assert.equal(enhanceSize({ width: 2560, height: 1440 }, '2k').available, false, '1440p source: 2K off');
  assert.equal(enhanceSize({ width: 2560, height: 1440 }, '4k').available, true);
  assert.equal(enhanceSize({ width: 3840, height: 2160 }, '4k').available, false, '4K source: both off');
  const wide = enhanceSize({ width: 2520, height: 1080 }, '4k'); assert.ok(wide.width * wide.height <= 8.4e6 && wide.width % 2 === 0, 'very wide 4K stays in budget');
  assert.throws(() => makePlan({ width: 2560, height: 1440, fps: 30 }, { mode: 'enhance', target: '2k' }), /already 2K/);
  const clean = autoTune(p1080, { kind: 'detail', scores: [.1, .85, .05] }, 1.33), noisy = autoTune({ ...p1080, bitrate: 1.5e6 }, { kind: 'noise', scores: [.05, .15, .8] }, 1.33);
  assert.ok(noisy.denoise > clean.denoise + .5 && noisy.sharp < clean.sharp, 'noise and low bitrate → more clean-up, less sharpening');
  assert.ok(noisy.compressed > .5 && clean.compressed === 0, 'bitrate estimate');
  assert.ok(noisy.crf > clean.crf && noisy.psy < clean.psy && noisy.sao && !clean.sao, 'x265 settings follow the source');
  assert.ok(autoTune(p1080, { scores: [.3, .4, .3] }, 2).sharp > autoTune(p1080, { scores: [.3, .4, .3] }, 1.33).sharp, 'bigger step → more detail restore');
  const plan = makePlan(p1080, { mode: 'enhance', target: '2k' }, { kind: 'detail', scores: [.1, .85, .05] });
  assert.equal(plan.codec, 'hevc', 'always H.265'); assert.match(plan.x265, /aq-mode=3/); assert.match(plan.x265, /psy-rd=2/); assert.match(plan.x265, /keyint=60/);
  assert.ok(bitrateFor(plan) >= 10e6 && bitrateFor(makePlan(p1080, { mode: 'enhance', target: '4k' }, { scores: [.1, .85, .05] })) > bitrateFor(plan));
  ok('enhancer: 2K / 4K relative to the source, unavailable sizes off, H.265 always, parameters tuned from noise, detail, bitrate, fps');

  // ---------- Max Quality plan ----------
  assert.deepEqual(maxSize({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
  assert.deepEqual(maxSize({ width: 2160, height: 3840 }), { width: 1080, height: 1920 });
  assert.deepEqual(maxSize({ width: 3840, height: 2160 }), { width: 1920, height: 1080 });
  assert.deepEqual(maxSize({ width: 720, height: 1280 }), { width: 720, height: 1280 }, 'never upscaled');
  const mp = makePlan({ width: 1080, height: 1920, fps: 60 }, { mode: 'max' });
  assert.equal(mp.max, true); assert.equal(mp.codec, 'avc'); assert.equal(mp.crf, '16'); assert.ok(!/pad=/.test(mp.filter), 'no padding');
  assert.ok(bitrateFor(mp) >= 25e6 && bitrateFor(mp) <= 30e6, 'high but streamable bitrate ' + bitrateFor(mp));
  assert.equal(canCopyMethod({ codec: 'avc', width: 1080, height: 1920, fps: 30, rotation: 0 }, makePlan({ width: 1080, height: 1920, fps: 30 }, { mode: 'max' })), true, 'clean H.264 is kept as is');
  assert.equal(canCopyMethod({ codec: 'avc', width: 2160, height: 3840, fps: 30 }, makePlan({ width: 2160, height: 3840, fps: 30 }, { mode: 'max' })), false);
  ok('max quality: up to 1080p (short side), no padding or upscaling, CRF 16 / high bitrate, clean sources kept');

  // ---------- MP4 container patch ----------
  const v0 = new Uint8Array(100); v0[15] = 0x3c; v0[19] = 0x78; const v1 = mvhdDuration64(v0);
  assert.equal(v1.length, 112); assert.equal(v1[0], 1); assert.ok(v1.slice(24, 32).every(b => b === 255)); assert.deepEqual([...v1.slice(32)], [...v0.slice(20)], 'every other field kept');
  if (has('ffmpeg') && has('ffprobe')) {
    const make = (name, args) => { const f = path.join(temp, name); execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, f]); return f; };
    const sources = [
      make('end.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=60', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']),
      make('fast.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart']),
      make('hevc.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '1', '-c:v', 'libx265', '-x265-params', 'log-level=error', '-tag:v', 'hvc1'])];
    const md5 = (f, sel) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', sel, '-c', 'copy', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();
    for (const src of sources) for (const profile of ['duration64', 'ghost']) {
      const audio = !src.endsWith('hevc.mp4'); if (profile === 'ghost' && !audio) { await assert.rejects(patchForUpload(new Blob([fs.readFileSync(src)]), { profile }), /audio/); continue; }
      const { blob, report } = await patchForUpload(new Blob([fs.readFileSync(src)]), { profile });
      const out = src.replace('.mp4', `.${profile}.mp4`); fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
      const d = await describeMp4(blob);
      assert.deepEqual(d.layout, ['ftyp', 'moov', 'mdat']); assert.equal(d.brand, 'isom'); assert.deepEqual(d.comment, ['Lavf61.7.100', 'Prepared with Pillow']);
      assert.ok(d.tracks.every(t => t.firstChunk >= d.mdat.start && t.firstChunk < d.mdat.end), 'chunk offsets inside mdat');
      if (profile === 'duration64') { assert.equal(d.mvhdVersion, 1); assert.equal(d.mvhdDuration, 'ffffffffffffffff'); assert.ok(report.bytesAdded < 200, 'tiny overhead'); }
      else { assert.equal(d.tracks.length, 3); assert.equal(d.tracks[2].samples, d.tracks[1].samples * 10); assert.equal(d.tracks[2].firstChunk, d.tracks[1].firstChunk); assert.ok(d.tracks[2].edts, 'clone keeps its edit list'); }
      execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', out, '-map', '0:v', '-map', '0:a:0?', '-f', 'null', '-']);
      assert.equal(md5(out, '0:v:0'), md5(src, '0:v:0'), 'video bit-identical ' + out);
      if (audio) assert.equal(md5(out, '0:a:0'), md5(src, '0:a:0'), 'audio bit-identical ' + out);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }));
      const srcProbe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', src], { encoding: 'utf8' }));
      assert.ok(Math.abs(+probe.format.duration - +srcProbe.format.duration) < .03, 'container duration unchanged ' + out);
    }
    ok('mp4 patch: duration64 (mvhd v1, unknown duration) and ghost profiles, ftyp→moov→mdat, offsets re-pointed, streams bit-identical, duration unchanged');
  }
  {
    const plan = await import('../public/modules/video-plan.mjs');
    const avcc = (args) => { const f = path.join(temp, 'c.h264'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=1', '-frames:v', '1', '-c:v', 'libx264', ...args, '-f', 'h264', f]); const b = fs.readFileSync(f); const i = b.indexOf(Buffer.from([0, 0, 0, 1, 0x67])) + 4; let j = i; while (j < b.length - 3 && !(b[j] === 0 && b[j + 1] === 0 && b[j + 2] === 1)) j++; const sps = b.subarray(i, j); return Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps]); };
    const pq = plan.avcColor(avcc(['-x264-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc'])), sdr = plan.avcColor(avcc(['-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709']));
    assert.deepEqual([pq.primaries, pq.transfer, pq.matrix], [9, 16, 9]); assert.equal(plan.isHdrColor(pq), true); assert.equal(plan.isHdrColor(sdr), false); assert.equal(plan.isHdrColor(plan.avcColor(avcc([]))), false);
    ok('HDR found in the H.264 bitstream (SPS VUI) when the container has no colour box');
  }
  {
    const I = await import('../public/modules/ai-intent.mjs');
    const vid = { type: 'video/mp4', name: 'clip.mp4' }, wav = { type: 'audio/wav', name: 'track.wav' };
    const cases = [['make it max quality for TikTok', vid, 'max'], ['сделай максимальное качество для тиктока', vid, 'max'], ['upscale to 4K', vid, 'enhance4k'], ['апскейл в 4к', vid, 'enhance4k'], ['в 2к пожалуйста', vid, 'enhance2k'],
      ['find beats and give me jsx', wav, 'beats'], ['найди биты', vid, 'beats'], ['почисти шум', vid, 'enhanced'], ['', wav, 'beats'], ['привет', null, null], ['export 1440x1080 motion', null, null]];
    for (const [t, f, want] of cases) assert.equal(I.ruleIntent(t, f).action, want, `intent: "${t}"`);
    assert.equal(I.ruleIntent('залей в тикток', vid).confidence < .8, true, 'vague asks leave room for the model');
    assert.equal(I.parseModelIntent('```json\n{"action": "enhance4k"}\n```'), 'enhance4k'); assert.equal(I.parseModelIntent('<think>max?</think>{"action":"none"}'), null);
    assert.equal(I.parseModelIntent('I would pick beats'), 'beats'); assert.equal(I.parseModelIntent('{"action":"rm -rf"}'), null);
    assert.equal(I.pickAction({ action: 'max', confidence: .9 }, 'beats', vid), 'max'); assert.equal(I.pickAction({ action: 'max', confidence: .6 }, 'enhanced', vid), 'enhanced');
    assert.equal(I.fileKind({ type: '', name: 'a.MOV' }), 'video'); assert.equal(I.fileKind({ type: '', name: 'a.flac' }), 'audio'); assert.equal(I.fileKind({ type: 'text/plain', name: 'a.txt' }), null);
    ok('Pillow AI intent: RU/EN rules, model JSON parsing, tie-breaking, file kinds');
  }
  {
    const K = await import('../public/modules/ai-knowledge.mjs'), P = await import('../public/modules/ai-prompt.mjs');
    const base = JSON.parse(fs.readFileSync(new URL('../public/assets/pillow-ai-knowledge.json', import.meta.url))), idx = K.buildIndex(base);
    const top = q => K.retrieve(idx, q, 3).map(h => h.entry.id);
    const expect = [['кто тебя создал?', 'who'], ['who made you', 'who'], ['какие у вас каналы', 'channels'], ['как получить расширение через бота', 'bot'], ['how do I install the extension', 'install'],
      ['настройки x265 для хендбрейк', 'handbrake'], ['ffmpeg hevc psy-rd settings', 'hevc'], ['what is max quality', 'max'], ['как сделать биты в after effects', 'beats'], ['апскейл в 4к', 'enhancer'], ['советы для фан эдитов', 'fanedit'], ['tiktok blurry quality tips', 'tiktok-tips']];
    for (const [q, id] of expect) assert.ok(top(q).includes(id), `retrieval "${q}" → ${id}, got ${top(q)}`);
    assert.equal(K.retrieve(idx, 'qwerty zxcv', 3).length, 0, 'nothing for noise');
    for (const e of base.entries) assert.ok(e.id && e.title && e.tags && e.text.length > 40, e.id);
    const all = JSON.stringify(base); for (const fact of ['ARILAX', 'KABAN', '@arilaxscp', '@kaban_shashluk', '@pillowex', '@pillow_hub_bot', 'psy-rd=1.0', 'aq-mode=3', '1440×1080', 'Import from Pillow Hub']) assert.ok(all.includes(fact), fact);
    const sys = P.systemPrompt(K.retrieve(idx, 'кто ты', 2).map(h => h.entry), 'ru');
    assert.match(sys, /made and trained by ARILAX and KABAN/); assert.match(sys, /Answer in Russian/); assert.match(sys, /not sure/); assert.match(sys, /Facts:\n- Who Pillow AI is/);
    assert.equal(P.detectLang('привет'), 'ru'); assert.equal(P.detectLang('hello'), 'en');
    ok('Pillow AI knowledge: BM25 retrieval in Russian and English, required facts present, identity system prompt');
  }
  console.log(`OK — ${passed} unit checks`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
