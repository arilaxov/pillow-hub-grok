/* Pillow Max Quality — MP4 container patch for TikTok Studio (desktop) uploads.
   Only the index (moov) is rewritten. Compressed video and audio bytes are copied untouched.

   Profiles
   - 'duration64' (default): the current public technique (Oct–Nov 2026). The movie header (mvhd) is
     upgraded to version 1 with every field kept and its duration set to all-ones ("unknown"); no ghost
     samples, no trailing marker. Same idea as buwryme/tiktok-lossless-upload's "mvhd" method (MIT) and
     what CompressBase's API calls "duration64" (Variant 1).
   - 'ghost': the earlier public technique. A clone of the audio track declares 10× its samples; the extra
     samples are tiny entries pointing at bytes that already exist. Edit list kept on the clone so the
     container duration does not drift. Approach documented by the Open Quality Method (MIT).
   Both: ftyp → moov → mdat layout, isom brand, a minimal metadata block, chunk offsets re-pointed.
   Written from the public descriptions; no third-party code is included. See THIRD-PARTY.md. */

export const PATCH_VERSION = '1';
export const PROFILES = Object.freeze(['duration64', 'ghost']);
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'dinf']);
const DUMMY = { avc1: 8, avc3: 8, hvc1: 16, hev1: 16, vp09: 4, av01: 4, mp4v: 8 };
const enc = new TextEncoder(), dec = new TextDecoder();
const fourcc = (u, o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
const view = u => new DataView(u.buffer, u.byteOffset, u.byteLength);
const u32 = (u, o) => view(u).getUint32(o);
const u64 = (u, o) => Number(view(u).getBigUint64(o));

async function bytes(blob, start, end) { return new Uint8Array(await blob.slice(start, end).arrayBuffer()); }

/* Top-level boxes without reading media data. */
export async function topLevel(blob) {
  const out = []; let pos = 0;
  while (pos + 8 <= blob.size) {
    const h = await bytes(blob, pos, Math.min(blob.size, pos + 16));
    let size = u32(h, 0), header = 8; const type = fourcc(h, 4);
    if (size === 1) { if (h.length < 16) break; size = u64(h, 8); header = 16; }
    else if (size === 0) size = blob.size - pos;
    if (size < header || pos + size > blob.size + 0) { if (type === 'mdat') size = blob.size - pos; else throw new Error('This MP4 is damaged or incomplete.'); }
    out.push({ type, offset: pos, size, header });
    pos += size;
  }
  return out;
}

function parse(u, start = 0, end = u.length) {
  const list = []; let p = start;
  while (p + 8 <= end) {
    let size = u32(u, p), header = 8; const type = fourcc(u, p + 4);
    if (size === 1) { size = u64(u, p + 8); header = 16; } else if (size === 0) size = end - p;
    if (size < header || p + size > end) throw new Error('This MP4 index is damaged.');
    const box = { type };
    if (CONTAINERS.has(type)) box.children = parse(u, p + header, p + size);
    else box.payload = u.slice(p + header, p + size);
    list.push(box); p += size;
  }
  return list;
}
const box = (type, payload) => ({ type, payload });
function size(b) { const body = b.children ? b.children.reduce((s, c) => s + size(c), 0) : b.payload.length; return body + 8 > 0xffffffff ? body + 16 : body + 8; }
function write(b, out, o) {
  const n = size(b), dv = view(out); let p = o;
  if (n > 0xffffffff) { dv.setUint32(p, 1); out.set(enc.encode(b.type), p + 4); dv.setBigUint64(p + 8, BigInt(n)); p += 16; }
  else { dv.setUint32(p, n); out.set(enc.encode(b.type), p + 4); p += 8; }
  if (b.children) for (const c of b.children) p = write(c, out, p); else { out.set(b.payload, p); p += b.payload.length; }
  return p;
}
function serialize(b) { const out = new Uint8Array(size(b)); write(b, out, 0); return out; }
const find = (b, ...path) => { let cur = b; for (const t of path) { cur = cur?.children?.find(c => c.type === t); if (!cur) return null; } return cur; };
const all = (b, t) => (b.children || []).filter(c => c.type === t);
const handler = trak => { const h = find(trak, 'mdia', 'hdlr'); return h ? fourcc(h.payload, 8) : ''; };
const sampleEntry = trak => { const s = find(trak, 'mdia', 'minf', 'stbl', 'stsd'); return s && s.payload.length >= 16 ? fourcc(s.payload, 12) : ''; };
const trackId = trak => { const t = find(trak, 'tkhd'); return u32(t.payload, t.payload[0] ? 20 : 12); };
function setTrackId(trak, id) { const t = find(trak, 'tkhd'), p = t.payload.slice(); view(p).setUint32(p[0] ? 20 : 12, id); t.payload = p; }
function cat(...parts) { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function be32(...v) { const u = new Uint8Array(v.length * 4), dv = view(u); v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0)); return u; }
function be64(...v) { const u = new Uint8Array(v.length * 8), dv = view(u); v.forEach((x, i) => dv.setBigUint64(i * 8, BigInt(x))); return u; }

/* mvhd v0 → v1 with duration 0xFFFFFFFFFFFFFFFF; rate, volume, matrix and next_track_ID kept as they are. */
export function mvhdDuration64(p) {
  let creation, modification, timescale, rest;
  if (p[0] === 0) { creation = u32(p, 4); modification = u32(p, 8); timescale = u32(p, 12); rest = p.slice(20); }
  else { creation = u64(p, 4); modification = u64(p, 12); timescale = u32(p, 20); rest = p.slice(32); }
  const head = new Uint8Array(32), dv = view(head);
  dv.setUint32(0, 1 << 24); dv.setBigUint64(4, BigInt(creation)); dv.setBigUint64(12, BigInt(modification)); dv.setUint32(20, timescale); dv.setBigUint64(24, 0xffffffffffffffffn);
  return cat(head, rest);
}
function setNextTrackId(mvhd, id) { const p = mvhd.payload.slice(); view(p).setUint32(p.length - 4, id); mvhd.payload = p; }

function metadata({ encoder, comment }) {
  const item = (name, text) => ({ type: name, children: null, payload: serialize(box('data', cat(be32(1, 0), enc.encode(text)))) });
  const items = [];
  if (encoder) items.push(item('\u00a9too', encoder));
  if (comment) items.push(item('\u00a9cmt', comment));
  const hdlr = cat(be32(0, 0), enc.encode('mdirappl'), new Uint8Array(9));
  const ilst = box('ilst', cat(...items.map(i => serialize({ type: i.type, payload: i.payload }))));
  // 'meta' is a full box whose body is a list of boxes.
  const meta = box('meta', cat(be32(0), serialize(box('hdlr', hdlr)), serialize(ilst)));
  return { type: 'udta', children: [meta] };
}

function ghostTrack(audio, video, inflate, mdatStart, mdatEnd) {
  const clone = structuredClone(audio);
  clone.children = clone.children.filter(c => c.type !== 'tref');
  const stbl = find(clone, 'mdia', 'minf', 'stbl'), stsz = find(stbl, 'stsz'), stts = find(stbl, 'stts'), stsc = find(stbl, 'stsc');
  const co = find(stbl, 'stco') || find(stbl, 'co64'), wide = co.type === 'co64', dummy = DUMMY[sampleEntry(video)] || 8;
  const uniform = u32(stsz.payload, 4), count = u32(stsz.payload, 8);
  const sizes = uniform ? new Array(count).fill(uniform) : Array.from({ length: count }, (_, i) => u32(stsz.payload, 12 + i * 4));
  const chunks = u32(co.payload, 4), first = wide ? u64(co.payload, 8) : u32(co.payload, 8);
  let extra = count * Math.max(0, inflate - 1);
  if (extra * dummy > mdatEnd - first) extra = Math.floor((mdatEnd - first) / dummy);
  const stscN = u32(stsc.payload, 4), desc = stscN ? u32(stsc.payload, 8 + 12 * (stscN - 1) + 8) : 1;
  stsz.payload = cat(be32(0, 0, count + extra), be32(...sizes), be32(...new Array(extra).fill(dummy)));
  stts.payload = cat(be32(0, u32(stts.payload, 4) + 1), stts.payload.slice(8), be32(extra, 1));
  stsc.payload = cat(be32(0, stscN + 1), stsc.payload.slice(8), be32(chunks + 1, extra, desc));
  co.payload = cat(be32(0, chunks + 1), co.payload.slice(8), wide ? be64(first) : be32(first));
  const h = find(clone, 'mdia', 'hdlr'); h.payload = cat(h.payload.slice(0, 24), enc.encode('SoundHandler\0'));
  return { clone, count, extra, dummy };
}

function shiftOffsets(moov, delta) {
  for (const trak of all(moov, 'trak')) {
    const stbl = find(trak, 'mdia', 'minf', 'stbl'); if (!stbl) continue;
    for (const co of stbl.children) {
      if (co.type !== 'stco' && co.type !== 'co64') continue;
      const p = co.payload.slice(), dv = view(p), n = dv.getUint32(4);
      for (let i = 0; i < n; i++) {
        if (co.type === 'stco') { const v = dv.getUint32(8 + i * 4) + delta; if (v > 0xffffffff || v < 0) throw new Error('This video is too large to patch.'); dv.setUint32(8 + i * 4, v); }
        else dv.setBigUint64(8 + i * 8, dv.getBigUint64(8 + i * 8) + BigInt(delta));
      }
      co.payload = p;
    }
  }
}

/* Returns { blob, report }. The input must be a regular (non-fragmented) MP4 with a single mdat. */
export async function patchForUpload(blob, { profile = 'duration64', inflate = 10, encoder = 'Lavf61.7.100', comment = 'Prepared with Pillow' } = {}) {
  if (!PROFILES.includes(profile)) throw new Error('Unknown patch profile.');
  const tops = await topLevel(blob);
  const ftypBox = tops.find(b => b.type === 'ftyp'), moovBox = tops.find(b => b.type === 'moov'), mdats = tops.filter(b => b.type === 'mdat');
  if (!moovBox || mdats.length !== 1 || tops.some(b => b.type === 'moof')) throw new Error('The prepared MP4 has an unexpected layout.');
  const mdat = mdats[0], mdatStart = mdat.offset + mdat.header, mdatEnd = mdat.offset + mdat.size;
  const moov = { type: 'moov', children: parse(await bytes(blob, moovBox.offset + moovBox.header, moovBox.offset + moovBox.size)) };
  if (find(moov, 'mvex')) throw new Error('Fragmented MP4 is not supported.');
  const traks = all(moov, 'trak'), video = traks.find(t => handler(t) === 'vide'), audio = traks.find(t => handler(t) === 'soun');
  if (!video) throw new Error('No video track found.');
  const report = { profile, version: PATCH_VERSION, applied: ['faststart', 'isom-brand'], videoCodec: sampleEntry(video), audio: !!audio, notes: [] };

  if (profile === 'duration64') {
    const mvhd = find(moov, 'mvhd'); mvhd.payload = mvhdDuration64(mvhd.payload); report.applied.push('mvhd-duration64');
  } else {
    if (!audio) throw new Error('This patch needs an audio track.');
    const g = ghostTrack(audio, video, inflate, mdatStart, mdatEnd), id = Math.max(...traks.map(trackId)) + 1;
    setTrackId(g.clone, id); moov.children.splice(moov.children.indexOf(audio) + 1, 0, g.clone); setNextTrackId(find(moov, 'mvhd'), id + 1);
    report.applied.push('ghost-audio'); report.notes.push(`ghost track: ${g.count} real + ${g.extra} × ${g.dummy} B samples`);
  }
  moov.children = moov.children.filter(c => c.type !== 'udta'); moov.children.push(metadata({ encoder, comment })); report.applied.push('clean-metadata');

  // isom brand, as written by FFmpeg/Lavf: major isom, minor 512, compatible isom iso2 <codec> mp41.
  const codecBrand = /^(avc|hvc|hev)/.test(report.videoCodec) ? (report.videoCodec.startsWith('avc') ? 'avc1' : 'hvc1') : 'iso6';
  const ftyp = serialize(box('ftyp', cat(enc.encode('isom'), be32(512), enc.encode('isom' + 'iso2' + codecBrand + 'mp41'))));
  if (!ftypBox) report.notes.push('ftyp added');
  // Chunk offsets: new payload start minus old payload start. Re-serialize until the moov size is stable.
  const mdatBytes = mdatEnd - mdatStart, mdatHeader = mdatBytes + 8 > 0xffffffff ? 16 : 8;
  const oldMoov = serialize(moov).length;
  let delta = ftyp.length + oldMoov + mdatHeader - mdatStart; shiftOffsets(moov, delta);
  const moovBytes = serialize(moov);
  if (moovBytes.length !== oldMoov) throw new Error('The MP4 index changed size while patching.');
  const head = new Uint8Array(mdatHeader), dv = view(head);
  if (mdatHeader === 16) { dv.setUint32(0, 1); head.set(enc.encode('mdat'), 4); dv.setBigUint64(8, BigInt(mdatBytes + 16)); }
  else { dv.setUint32(0, mdatBytes + 8); head.set(enc.encode('mdat'), 4); }
  const out = new Blob([ftyp, moovBytes, head, blob.slice(mdatStart, mdatEnd)], { type: 'video/mp4' });
  report.bytesAdded = out.size - blob.size;
  return { blob: out, report };
}

/* Read-back summary used for checks and tests. */
export async function describeMp4(blob) {
  const tops = await topLevel(blob), moovBox = tops.find(b => b.type === 'moov'), ftypBox = tops.find(b => b.type === 'ftyp');
  if (!moovBox) throw new Error('No moov box.');
  const moov = { type: 'moov', children: parse(await bytes(blob, moovBox.offset + moovBox.header, moovBox.offset + moovBox.size)) };
  const mvhd = find(moov, 'mvhd').payload, ftyp = ftypBox ? await bytes(blob, ftypBox.offset + 8, ftypBox.offset + ftypBox.size) : null;
  const mdat = tops.find(b => b.type === 'mdat');
  const tracks = all(moov, 'trak').map(t => {
    const stbl = find(t, 'mdia', 'minf', 'stbl'), stsz = find(stbl, 'stsz'), co = find(stbl, 'stco') || find(stbl, 'co64');
    const first = co ? (co.type === 'co64' ? u64(co.payload, 8) : u32(co.payload, 8)) : null;
    return { id: trackId(t), handler: handler(t), codec: sampleEntry(t), samples: u32(stsz.payload, 8), firstChunk: first, edts: !!find(t, 'edts') };
  });
  const ilst = find(moov, 'udta')?.children?.find(c => c.type === 'meta');
  return {
    layout: tops.map(b => b.type), brand: ftyp ? fourcc(ftyp, 0) : null,
    mvhdVersion: mvhd[0], mvhdDuration: mvhd[0] ? view(mvhd).getBigUint64(24).toString(16) : u32(mvhd, 16).toString(16),
    tracks, mdat: mdat ? { start: mdat.offset + mdat.header, end: mdat.offset + mdat.size } : null,
    comment: ilst ? (dec.decode(ilst.payload).match(/Prepared with Pillow|Lavf[\d.]+/g) || []) : []
  };
}
