/* Pillow AI — chat UI. WebLLM loads only here, only when asked. */
import { MODELS, gpuStatus, modelFor, isCached, loadModel, ready, stream, complete, stripThink, isGpuLost, dropEngine } from './modules/ai-engine.mjs?v=94';
import { loadKnowledge, retrieve, localize } from './modules/ai-knowledge.mjs?v=94';
import { ruleIntent, parseModelIntent, pickAction, fileKind, ACTIONS, INTENT_PROMPT } from './modules/ai-intent.mjs?v=94';
import { systemPrompt, detectLang, isSmallTalk, capabilities } from './modules/ai-prompt.mjs?v=94';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const shell = $('#ai'), log = $('#ai-log'), form = $('#ai-form'), text = $('#ai-text'), send = $('#ai-send'), fileInput = $('#ai-file-input');
const loadBtn = $('#ai-load'), state = $('#ai-state'), notice = $('#ai-notice'), prog = $('#ai-progress'), chipsBox = $('#ai-chips'), filePill = $('#ai-file'), drop = $('#ai-drop');
const RU = /^ru\b/i.test(navigator.language || '');
const TX = {
  ru: {
  chips: ['Макс. качество для TikTok', 'Апскейл в 4K', 'Биты → .jsx', 'Кто тебя сделал?', 'Настройки x265'],
  dropFirst: 'Перетащи файл сюда — сделаю.', which: 'Что сделать с файлом?', guide: 'Из справочника Pillow', loadHint: 'Загрузи Pillow AI для полных ответов.',
  noGpu: 'Здесь нет WebGPU. Чат отвечает по справочнику Pillow, инструменты работают.', unsure: 'Не уверен. Спроси иначе или загляни в канал @pillowex.', working: 'Работаю…', done: 'Готово.',
  caps: [['max', 'Макс. качество'], ['enhanced', 'Enhanced'], ['enhance4k', 'Апскейл 4K'], ['beats', 'Биты → .jsx']],
  },
  en: {
  chips: ['Max Quality for TikTok', 'Upscale to 4K', 'Beats → .jsx', 'Who made you?', 'x265 settings'],
  dropFirst: 'Drop the file here — I’ll do it.', which: 'What should I do with it?', guide: 'From the Pillow guide', loadHint: 'Load Pillow AI for full answers.',
  noGpu: 'No WebGPU here. Chat answers from the Pillow guide; tools still work.', unsure: 'Not sure. Try asking another way or check @pillowex.', working: 'Working…', done: 'Done.',
  caps: [['max', 'Max Quality'], ['enhanced', 'Enhanced'], ['enhance4k', 'Upscale 4K'], ['beats', 'Beats → .jsx']],
  },
};
const T = TX[RU ? 'ru' : 'en'];
// answers follow the language of the question, not the browser
const TL = q => TX[detectLang(q)];
const CHIP_ACTION = [{ action: 'max' }, { action: 'enhance4k' }, { action: 'beats' }, {}, {}];
let gpu = null, modelKey = localStorage.getItem('ph_ai_model') || 'main', file = null, pendingFile = null, pendingAction = null, busy = false, history = [], urls = [];
let kb = null;

// ---------- rendering ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function md(src) {
  const lines = esc(src).split('\n'), out = []; let list = null;
  const inline = s => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])(@[a-z0-9_]{4,})/gi, (m, p, h) => `${p}<a href="https://t.me/${h.slice(1)}" target="_blank" rel="noopener">${h}</a>`);
  for (const l of lines) {
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) { if (!list) { list = []; } list.push(`<li>${inline(m[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
function bubble(role, html = '', cls = '') {
  $('#ai-empty')?.remove();
  const el = document.createElement('div'); el.className = `ai-msg ai-${role} ${cls}`.trim();
  el.innerHTML = `<div class="ai-bubble">${html}</div>`; log.appendChild(el);
  requestAnimationFrame(() => { el.classList.add('in'); log.scrollTop = log.scrollHeight; });
  return el;
}
const scroll = () => { log.scrollTop = log.scrollHeight; };
function setChips(list) {
  chipsBox.innerHTML = '';
  list.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ai-chip'; b.textContent = c.label; b.addEventListener('click', c.run); chipsBox.appendChild(b); });
  chipsBox.hidden = !list.length;
}
function defaultChips() {
  setChips(T.chips.map((label, i) => ({ label, run: () => { const a = CHIP_ACTION[i].action; if (a && !file && !pendingFile) { pendingAction = a; userSay(label); assistantSay(T.dropFirst); openPicker(); } else submit(label); } })));
}
function actionChips() { setChips(Object.entries(ACTIONS).filter(([k, v]) => v.kind === fileKind(pendingFile) || (v.kind === 'audio' && fileKind(pendingFile) === 'video')).map(([k, v]) => ({ label: v.label, run: () => { const f = pendingFile; pendingFile = null; userSay(v.label); act(k, f); } }))); }
const userSay = (t, f) => bubble('user', (f ? `<span class="ai-attach-pill">${esc(f.name)}</span>` : '') + (t ? `<p>${esc(t)}</p>` : ''));
const assistantSay = t => bubble('bot', md(t));

// ---------- model ----------
const modelInfo = () => MODELS.find(m => m.key === modelKey) || MODELS[0];
async function refreshState() {
  $$('[data-model]').forEach(b => { const on = b.dataset.model === modelKey; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  if (ready()) { state.textContent = `${modelInfo().name} · ready`; loadBtn.hidden = true; shell.classList.add('is-live'); return; }
  if (!gpu?.ok) { state.textContent = 'Guide mode'; loadBtn.disabled = true; return; }
  const cached = await isCached(modelFor(modelKey, gpu));
  state.textContent = cached ? `${modelInfo().name} · saved on this device` : `${modelInfo().name} · ${modelInfo().size}, once`;
  loadBtn.textContent = cached ? 'Start' : 'Load'; loadBtn.disabled = false; loadBtn.hidden = false;
}
async function startModel() {
  if (!gpu?.ok || busy) return false;
  const id = modelFor(modelKey, gpu); busy = true; loadBtn.disabled = true; prog.hidden = false; shell.classList.add('is-loading');
  const fill = $('#ai-progress-fill'), label = $('#ai-progress-text');
  try {
    await loadModel(id, r => {
      const p = Math.max(0, Math.min(1, r.progress || 0)); fill.style.transform = `scaleX(${p})`;
      const mbm = String(r.text || '').match(/([\d.]+)\s*MB (?:loaded|fetched)/i);
      label.textContent = p >= 1 ? 'Warming up…' : `${Math.round(p * 100)}%` + (mbm ? ` · ${Math.round(+mbm[1])} MB` : '') + (/loading model from cache/i.test(r.text || '') ? ' · from this device' : '');
    });
    localStorage.setItem('ph_ai_model', modelKey); prog.hidden = true; return true;
  } catch (e) {
    prog.hidden = true; notice.hidden = false;
    notice.textContent = /memory|OOM|device lost|allocate/i.test(e.message) ? 'Not enough GPU memory. Try Lite.' : 'Couldn’t start the model: ' + (e.message || e).toString().slice(0, 140);
    return false;
  } finally { busy = false; shell.classList.remove('is-loading'); refreshState(); updateSend(); }
}

// ---------- actions ----------
async function act(action, f) {
  busy = true; updateSend(); setChips([]);
  const msg = bubble('bot', `<div class="ai-run"><div class="ai-run-head"><b>${esc(ACTIONS[action].label)}</b><span class="ai-run-status">${T.working}</span></div><div class="ai-progress-track"><i></i></div><button class="ai-run-stop" type="button">Cancel</button></div>`, 'is-running');
  const status = $('.ai-run-status', msg), fill = $('.ai-progress-track i', msg), ctrl = new AbortController();
  $('.ai-run-stop', msg).addEventListener('click', () => ctrl.abort());
  try {
    const { runAction } = await import('./modules/ai-actions.mjs?v=94');
    const card = await runAction(action, f, { signal: ctrl.signal, onStatus: s => { status.textContent = s; }, onProgress: p => { fill.style.transform = `scaleX(${p})`; } });
    msg.classList.remove('is-running'); $('.ai-bubble', msg).innerHTML = renderCard(card); wireCard(msg, card);
    history.push({ role: 'assistant', content: `[Ran ${ACTIONS[action].label} on ${f.name}: ${card.meta}]` });
  } catch (e) {
    msg.classList.remove('is-running');
    $('.ai-bubble', msg).innerHTML = md(e.name === 'AbortError' || ctrl.signal.aborted ? (RU ? 'Отменено.' : 'Cancelled.') : (e.message || 'Something went wrong.'));
  } finally { busy = false; updateSend(); defaultChips(); scroll(); }
}
function renderCard(c) {
  const files = c.files.map((x, i) => `<a class="button ${x.primary ? 'button-primary' : 'button-quiet'}" data-file="${i}" download="${esc(x.name)}">${esc(x.label)} ↓</a>`).join('');
  const visual = c.beats ? '<canvas class="ai-card-wave" aria-label="Beat markers"></canvas>' : c.preview ? '<video class="ai-card-video" controls playsinline muted></video>' : '';
  return `<div class="ai-card"><div class="ai-card-head"><span class="ai-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div><b>${esc(c.title)}</b><span class="ai-card-meta">${esc(c.meta)}</span></div></div>${visual}<div class="ai-card-actions">${files}${c.copy ? '<button class="button button-quiet ai-copy" type="button">Copy seconds</button>' : ''}</div>${c.note ? `<p class="ai-card-note">${esc(c.note)}</p>` : ''}</div>`;
}
function wireCard(msg, c) {
  c.files.forEach((x, i) => { const u = URL.createObjectURL(x.blob); urls.push(u); $(`[data-file="${i}"]`, msg).href = u; });
  const v = $('video', msg); if (v) { const u = URL.createObjectURL(c.preview); urls.push(u); v.src = u; v.onerror = () => v.remove(); }
  const cv = $('canvas', msg); if (cv) drawBeats(cv, c);
  $('.ai-copy', msg)?.addEventListener('click', e => { navigator.clipboard?.writeText(c.copy).then(() => { e.target.textContent = 'Copied ✓'; }).catch(() => {}); });
}
function drawBeats(cv, c) {
  const dpr = devicePixelRatio || 1, W = cv.width = Math.max(1, Math.round((cv.clientWidth || 300) * dpr)), H = cv.height = Math.round(56 * dpr), g = cv.getContext('2d');
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff';
  g.globalAlpha = .18; g.fillRect(0, H / 2 - dpr / 2, W, dpr); g.globalAlpha = .9;
  c.beats.forEach((t, i) => { const x = Math.round(t / c.duration * W); const h = (i % 4 === 0 ? .9 : .55) * H; g.fillRect(x, (H - h) / 2, Math.max(1, dpr), h); });
}

// ---------- chat ----------
function showCapabilities(q) {
  const lang = detectLang(q), t = TX[lang];
  const el = assistantSay(capabilities(lang).text);
  const row = document.createElement('div'); row.className = 'ai-cap-actions';
  t.caps.forEach(([action, label]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ai-chip'; b.textContent = label;
    b.addEventListener('click', () => {
      if (busy) return;
      userSay(label);
      if (pendingFile) { const pf = pendingFile; pendingFile = null; return act(action, pf); }
      pendingAction = action; assistantSay(t.dropFirst); openPicker();
    });
    row.appendChild(b);
  });
  $('.ai-bubble', el).appendChild(row); scroll();
}
async function answer(q) {
  kb ??= await loadKnowledge().catch(() => null);
  const hits = kb ? retrieve(kb, q, 3) : [], lang = detectLang(q), t = TX[lang];
  if (!ready()) {
    const top = hits[0];
    if (!top || top.score < 2) { assistantSay(t.unsure); return; }
    const entry = localize(top.entry, lang);
    const el = assistantSay(`**${entry.title}**\n${entry.text}`); el.classList.add('is-guide');
    $('.ai-bubble', el).insertAdjacentHTML('beforeend', `<p class="ai-guide-note">${t.guide}${gpu?.ok ? ` · <button type="button" class="ai-inline-load">${t.loadHint}</button>` : ''}</p>`);
    $('.ai-inline-load', el)?.addEventListener('click', startModel);
    return;
  }
  const messages = [{ role: 'system', content: systemPrompt(hits.map(h => localize(h.entry, lang)), lang) }, ...history.slice(-6), { role: 'user', content: q }];
  const el = bubble('bot', '<p class="ai-typing"><i></i><i></i><i></i></p>'); const box = $('.ai-bubble', el);
  let raw = '';
  try {
    for await (const d of stream(messages)) { raw += d; const clean = stripThink(raw); if (clean) { box.innerHTML = md(clean); scroll(); } }
    const final = stripThink(raw).trim() || t.unsure; box.innerHTML = md(final);
    history.push({ role: 'user', content: q }, { role: 'assistant', content: final });
  } catch (e) {
    if (isGpuLost(e)) { dropEngine(); shell.classList.remove('is-live'); refreshState(); box.innerHTML = md(lang === 'ru' ? 'Видеокарта не справилась с моделью. Загрузи ещё раз или выбери **Lite**.' : 'The GPU couldn’t keep the model running. Load it again or pick **Lite**.'); }
    else box.innerHTML = md((lang === 'ru' ? 'Ошибка модели: ' : 'Model error: ') + String(e.message || e).slice(0, 160));
  }
}
async function submit(raw) {
  const q = (raw ?? text.value).trim(), f = file;
  if (busy || (!q && !f)) return;
  text.value = ''; autosize(); setFile(null); userSay(q, f); updateSend();
  if (f) {
    const rule = ruleIntent(q, f);
    let action = rule.action && rule.confidence >= .8 ? rule.action : null;
    if (!action && pendingAction && !q) action = pendingAction;
    if (!action && q && ready()) { try { busy = true; action = pickAction(rule, parseModelIntent(await complete([{ role: 'system', content: INTENT_PROMPT }, { role: 'user', content: `File: ${f.name} (${fileKind(f)}). Request: ${q}` }], { maxTokens: 24 })), f); } catch {} finally { busy = false; } }
    if (!action) action = rule.action;
    pendingAction = null;
    if (action && fileKind(f) === 'audio' && ACTIONS[action].kind === 'video') action = 'beats';
    if (action) return act(action, f);
    pendingFile = f; assistantSay(T.which); actionChips(); return;
  }
  if (isSmallTalk(q)) { showCapabilities(q); history.push({ role: 'user', content: q }, { role: 'assistant', content: capabilities(detectLang(q)).text }); return; }
  const rule = ruleIntent(q, null);
  if (rule.action && rule.confidence >= .85 && pendingFile) { const pf = pendingFile; pendingFile = null; return act(rule.action, pf); }
  if (rule.action && rule.confidence >= .9 && !/[?？]|как|how|что|what|почему|why/i.test(q)) { pendingAction = rule.action; assistantSay(TL(q).dropFirst); return; }
  busy = true; updateSend();
  try { await answer(q); } finally { busy = false; updateSend(); }
}

// ---------- composer ----------
function autosize() { text.style.height = 'auto'; text.style.height = Math.min(160, text.scrollHeight) + 'px'; }
function updateSend() { send.disabled = busy || (!text.value.trim() && !file); }
function setFile(f) {
  if (f && !fileKind(f)) { notice.hidden = false; notice.textContent = RU ? 'Нужен видео- или аудиофайл.' : 'Choose a video or audio file.'; return; }
  file = f || null; filePill.hidden = !file; if (file) { $('.ai-file-name', filePill).textContent = file.name; notice.hidden = !!gpu?.ok; if (gpu && !gpu.ok) notice.textContent = T.noGpu; }
  updateSend(); if (file) text.focus();
}
function openPicker() { fileInput.click(); }
form.addEventListener('submit', e => { e.preventDefault(); submit(); });
text.addEventListener('input', () => { autosize(); updateSend(); });
text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
$('#ai-attach').addEventListener('click', openPicker);
fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (!f) return; setFile(f); if (pendingAction) submit(''); });
$('button', filePill).addEventListener('click', () => setFile(null));
let depth = 0;
shell.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); depth++; drop.hidden = false; } });
shell.addEventListener('dragover', e => { if (!drop.hidden) e.preventDefault(); });
shell.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
shell.addEventListener('drop', e => { e.preventDefault(); depth = 0; drop.hidden = true; const f = e.dataTransfer?.files?.[0]; if (f) { setFile(f); if (pendingAction) submit(''); } });
loadBtn.addEventListener('click', startModel);
$$('[data-model]').forEach(b => b.addEventListener('click', () => { if (busy || ready()) return; modelKey = b.dataset.model; refreshState(); }));
$('#ai-new').addEventListener('click', () => { if (busy) return; history = []; pendingFile = null; pendingAction = null; urls.forEach(URL.revokeObjectURL); urls = []; log.innerHTML = ''; const e = document.createElement('div'); e.className = 'ai-empty'; e.id = 'ai-empty'; e.innerHTML = '<div class="ai-orb" aria-hidden="true"><span></span><span></span><span></span></div><h2>Hi. I’m Pillow AI.</h2><p>Made by ARILAX &amp; KABAN. Runs right here.</p>'; log.appendChild(e); defaultChips(); });
window.addEventListener('beforeunload', () => urls.forEach(URL.revokeObjectURL));

(async () => {
  defaultChips();
  gpu = await gpuStatus();
  if (!gpu.ok) { notice.hidden = false; notice.textContent = T.noGpu; shell.classList.add('no-gpu'); }
  if (gpu.ok && !gpu.f16 && !gpu.mock) state.dataset.precision = 'f32';
  await refreshState();
  shell.dataset.ready = 'true';
})();
