/* Pillow Hub ↔ After Effects bridge.
   Every browser tool that hands work to After Effects goes through here, so the panel and the
   downloadable scripts share one schema and one ExtendScript runtime.
   - JSON payloads: versioned schema "pillow.beats.v1".
   - .jsx scripts: ExtendScript (ES3) — no let/const, arrows, template strings or JSON.parse. */
export const HUB_VERSION = '92.0.0';
export const SCHEMAS = Object.freeze({ beats: 'pillow.beats.v1' });
export const MARKER_TYPES = ['hit', 'cut', 'section'];

/* The same runtime is embedded in every downloaded .jsx and in the Pillow panel's host script
   (scripts/build-panel.mjs copies it there), so both routes behave identically. */
export const AE_RUNTIME = String.raw`/* >>> Pillow Hub bridge runtime ${HUB_VERSION} */
function pillowHubComp() {
  try {
    var c = app.project ? app.project.activeItem : null;
    if (c && c instanceof CompItem) return c;
  } catch (e) {}
  return null;
}

function pillowHubIsOwn(mv) {
  try { var p = mv.getParameters(); return !!(p && p.pillow); } catch (e) { return false; }
}

function pillowHubParse(text) {
  if (typeof pillowParse === "function") return pillowParse(text);
  if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
  return eval("(" + text + ")");
}

function pillowHubOut(o) {
  if (typeof pillowJson === "function") return pillowJson(o);
  return o.ok ? "ok" : String(o.error);
}

function pillowHubPlural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

/* Marker times in the payload are seconds of the source audio. On a selected layer they follow the
   layer's start and stretch; on the composition they start at 0. Old Pillow markers are replaced. */
function pillowHubApplyBeats(data, opt) {
  var comp = pillowHubComp();
  if (!comp) return { ok: false, error: "Open a composition first." };
  opt = opt || {};
  var types = opt.types || { hit: true, cut: true, section: true };
  var sel = comp.selectedLayers, layer = null;
  if (opt.target !== "comp" && sel && sel.length) layer = sel[0];
  if (opt.target === "layer" && !layer) return { ok: false, error: "Select a layer first." };
  var prop = layer ? layer.property("ADBE Marker") : comp.markerProperty;
  if (!prop) return { ok: false, error: "This layer can't hold markers." };
  var offset = 0, scale = 1;
  if (layer) {
    offset = layer.startTime;
    try { scale = layer.stretch / 100; } catch (eS) {}
    if (!(scale > 0)) scale = 1;
  }
  if (opt.replace !== false) {
    for (var k = prop.numKeys; k >= 1; k--) {
      try { if (pillowHubIsOwn(prop.keyValue(k))) prop.removeKey(k); } catch (eR) {}
    }
  }
  var list = data.markers || [], count = 0, keys = { cut: [], section: [] }, numbers = { hit: 0, cut: 0 };
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || !types[m.type]) continue;
    var t = offset + Number(m.time) * scale;
    if (!(t >= 0) || t > comp.duration) continue;
    var label = m.label ? String(m.label) : "";
    if (!label) { numbers[m.type] = (numbers[m.type] || 0) + 1; label = (m.type === "cut" ? "Cut " : "Beat ") + numbers[m.type]; }
    var mv = new MarkerValue(label);
    var span = m.type === "section" && Number(m.duration) > 0 ? Number(m.duration) * scale : 0;
    if (span > 0) { try { mv.duration = Math.min(span, comp.duration - t); } catch (eD) {} }
    try { var params = {}; params.pillow = String(m.type); mv.setParameters(params); } catch (eP) {}
    try { prop.setValueAtTime(t, mv); count++; } catch (eM) { continue; }
    if (keys[m.type]) keys[m.type].push({ t: t, d: span, label: label });
  }
  var made = 0, mode = opt.layers;
  if (mode === "nulls" || mode === "solids") {
    var points = mode === "solids" ? (keys.section.length ? keys.section : keys.cut) : (keys.cut.length ? keys.cut : keys.section);
    var fd = comp.frameDuration || (1 / 30);
    for (var j = 0; j < points.length; j++) {
      var start = points[j].t;
      var end = j + 1 < points.length ? points[j + 1].t : (points[j].d > 0 ? start + points[j].d : comp.duration);
      if (end > comp.duration) end = comp.duration;
      if (end - start < fd) end = Math.min(comp.duration, start + fd);
      if (end <= start) continue;
      var L;
      if (mode === "nulls") {
        L = comp.layers.addNull(end - start);
      } else {
        var g = j % 2 ? 0.32 : 0.18;
        L = comp.layers.addSolid([g, g, g], points[j].label + " (Pillow)", comp.width, comp.height, comp.pixelAspect, end - start);
        try { L.guideLayer = true; } catch (eG) {}
        try { L.property("ADBE Transform Group").property("ADBE Opacity").setValue(40); } catch (eO) {}
      }
      L.name = points[j].label + " (Pillow)";
      L.startTime = start;
      try { L.inPoint = start; L.outPoint = end; } catch (eIO) {}
      if (layer) { try { L.moveBefore(layer); } catch (eMv) {} }
      made++;
    }
  }
  var where = layer ? "\u201c" + layer.name + "\u201d" : "the composition";
  var msg = pillowHubPlural(count, "marker") + " on " + where;
  if (made) msg += " \u00b7 " + pillowHubPlural(made, mode === "nulls" ? "null" : "guide solid");
  return { ok: true, count: count, layers: made, target: layer ? layer.name : "", message: msg };
}

function pillowHubRun(data, opt) {
  if (!data || typeof data !== "object") return { ok: false, error: "This file isn't a Pillow Hub export." };
  var schema = String(data.schema || "");
  if (schema.indexOf("pillow.beats.") !== 0) return { ok: false, error: "This file isn't a Pillow Hub beats export." };
  if (schema !== "pillow.beats.v1") return { ok: false, error: "This export needs a newer Pillow panel." };
  var result = null, failure = null;
  app.beginUndoGroup("Pillow \u00b7 Auto Beats");
  try {
    result = pillowHubApplyBeats(data, opt || data.options);
  } catch (e) {
    failure = String(e && e.message ? e.message : e);
    try { if (e.line) failure += " (line " + e.line + ")"; } catch (eL) {}
  }
  try { app.endUndoGroup(); } catch (eEnd) {}
  if (failure) return { ok: false, error: failure };
  return result || { ok: false, error: "Nothing happened." };
}

/* Pillow panel entry point: pillowHubImport(encodeURIComponent(jsonText)) */
function pillowHubImport(encoded) {
  var data;
  try { data = pillowHubParse(decodeURIComponent(encoded)); } catch (e) { return pillowHubOut({ ok: false, error: "This file isn't a Pillow Hub export." }); }
  return pillowHubOut(pillowHubRun(data, data && data.options));
}
/* <<< Pillow Hub bridge runtime */`;

/* JSON with every non-ASCII character escaped, so ExtendScript reads it the same in any encoding. */
export function esLiteral(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
const commentSafe = text => String(text ?? '').replace(/[^\x20-\x7e]/g, '?').replace(/\*\//g, '* /').slice(0, 120);
const round = (n, d = 3) => Math.round(Number(n) * 10 ** d) / 10 ** d;

export function normalizeBeatOptions(options = {}) {
  const types = {};
  for (const type of MARKER_TYPES) types[type] = options.types ? !!options.types[type] : true;
  return {
    types,
    target: ['auto', 'comp', 'layer'].includes(options.target) ? options.target : 'auto',
    layers: ['none', 'nulls', 'solids'].includes(options.layers) ? options.layers : 'none',
    replace: options.replace !== false
  };
}

/* markers: [{time, type, label?, strength?, duration?}] */
export function beatsPayload({ source = {}, analysis = {}, markers = [], options = {} } = {}, now = new Date()) {
  const counts = { hit: 0, cut: 0 };
  const list = markers.filter(m => MARKER_TYPES.includes(m.type) && Number.isFinite(+m.time) && +m.time >= 0)
    .slice().sort((a, b) => a.time - b.time || MARKER_TYPES.indexOf(b.type) - MARKER_TYPES.indexOf(a.type))
    .map(m => {
      const out = { time: round(m.time), type: m.type };
      out.label = m.type === 'section' ? String(m.label || 'Section') : m.label ? String(m.label) : (m.type === 'cut' ? 'Cut ' : 'Beat ') + (++counts[m.type]);
      if (m.type === 'section' && m.duration > 0) out.duration = round(m.duration);
      if (Number.isFinite(m.strength)) out.strength = round(m.strength, 2);
      return out;
    });
  return {
    schema: SCHEMAS.beats,
    generator: { name: 'Pillow Hub', version: HUB_VERSION },
    created: now.toISOString(),
    source: { name: String(source.name || 'audio'), duration: round(source.duration || 0), sampleRate: source.sampleRate || null },
    analysis: { mode: analysis.mode || 'hits', bpm: analysis.bpm ? round(analysis.bpm, 1) : null, sensitivity: analysis.sensitivity ?? null },
    markers: list,
    options: normalizeBeatOptions(options)
  };
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Not a Pillow Hub export.';
  if (payload.schema === SCHEMAS.beats) return Array.isArray(payload.markers) ? '' : 'Beat data is missing.';
  return 'Unknown schema.';
}

function header(lines) {
  return ['/*  Pillow Hub -> After Effects', ...lines.map(l => '    ' + commentSafe(l)), '*/'].join('\n');
}

/* A ready-to-run ExtendScript file for a beats payload. */
export function payloadJsx(payload, options) {
  const problem = validatePayload(payload);
  if (problem) throw new Error(problem);
  const opts = normalizeBeatOptions(options || payload.options);
  const summary = [`Auto Beats markers for "${payload.source.name}" (${payload.markers.length} in the file).`,
    'Use: open the comp, select the audio layer (optional), then File > Scripts > Run Script File...',
    'Markers land on the selected layer, or on the composition when nothing is selected.',
    'Running it again replaces the earlier Pillow markers. One step to undo.'];
  return `${header([...summary, `Generated by Pillow Hub ${HUB_VERSION} on ${payload.created.slice(0, 10)} - schema ${payload.schema}`])}
(function () {
${AE_RUNTIME}

  var DATA = ${esLiteral(payload)};
  var OPTIONS = ${esLiteral(opts)};
  var result = pillowHubRun(DATA, OPTIONS);
  alert(result.ok ? "Pillow \\u00b7 " + result.message : "Pillow \\u00b7 " + result.error);
})();
`;
}

export function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s;
}
export const toCSV = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
