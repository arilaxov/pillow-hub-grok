/* Pillow AI — local knowledge retrieval (BM25 over a small JSON base, Russian + English). */
const STOP = new Set('a an the is are be to of in on for and or with how what why can do does i me my you your it this that как что где зачем почему это мне мой моя ты вы на в во и или с со для по из к ко не ли а но же бы у о об от до за при про так там тут есть'.split(' '));
const ALIAS = {
  'тикток': 'tiktok', 'тик': 'tiktok', 'тт': 'tiktok', 'ае': 'ae', 'афтер': 'ae', 'эффектс': 'ae', 'aftereffects': 'ae', 'after': 'ae',
  'битов': 'beats', 'биты': 'beats', 'бит': 'beats', 'beat': 'beats', 'хэвк': 'hevc', 'х265': 'x265', 'h265': 'hevc', 'h.265': 'hevc',
  'апскейл': 'upscale', 'апскейлер': 'upscale', 'энхансер': 'enhancer', 'энхансед': 'enhanced', 'топаз': 'topaz', 'хендбрейк': 'handbrake', 'хэндбрейк': 'handbrake',
  'эдит': 'edit', 'эдиты': 'edit', 'эдитов': 'edit', 'расширение': 'extension', 'расширения': 'extension', 'панель': 'panel', 'панели': 'panel',
};
export function stem(word) {
  let w = word.toLowerCase().replace(/ё/g, 'е');
  if (ALIAS[w]) return ALIAS[w];
  if (/[а-я]/.test(w)) w = w.replace(/(ями|ами|ого|его|ому|ему|ыми|ими|ах|ях|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ую|юю|ом|ем|ам|ям|ы|и|а|я|о|е|у|ю|ь)$/, '');
  else w = w.replace(/(ing|ed|es|s)$/, '');
  return w.length > 6 ? w.slice(0, 6) : w;
}
export function tokens(text) {
  return (String(text).toLowerCase().match(/[a-zа-яё0-9.+]+/gi) || []).map(t => t.replace(/^\.+|\.+$/g, '')).filter(t => t && !STOP.has(t)).map(stem).filter(Boolean);
}
export function buildIndex(base) {
  const docs = base.entries.map(e => {
    const t = [...tokens(e.title), ...tokens(e.title), ...tokens(e.title_ru || ''), ...tokens(e.tags), ...tokens(e.tags), ...tokens(e.text), ...tokens(e.text_ru || '')];
    const tf = new Map(); t.forEach(x => tf.set(x, (tf.get(x) || 0) + 1));
    // "prefer": regex of intents this entry must win (e.g. install questions → install steps, not the feature list)
    let prefer = null; try { prefer = e.prefer ? new RegExp(e.prefer, 'i') : null; } catch (_) {}
    return { entry: e, tf, len: t.length, prefer };
  });
  const df = new Map(); docs.forEach(d => d.tf.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)));
  const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  return { docs, df, avg, n: docs.length };
}
export function retrieve(index, query, k = 3) {
  const q = [...new Set(tokens(query))], k1 = 1.4, b = .7;
  const scored = index.docs.map(d => {
    let s = 0;
    for (const t of q) { const f = d.tf.get(t); if (!f) continue; const idf = Math.log(1 + (index.n - index.df.get(t) + .5) / (index.df.get(t) + .5)); s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d.len / index.avg)); }
    if (d.prefer && d.prefer.test(query)) s += 8;
    return { entry: d.entry, score: s };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
/* Entry text in the user's language (RU fields when present). */
export const localize = (entry, lang = 'en') => (lang === 'ru' && entry.text_ru ? { ...entry, title: entry.title_ru || entry.title, text: entry.text_ru } : entry);
let cached = null;
export async function loadKnowledge(url = new URL('../assets/pillow-ai-knowledge.json', import.meta.url)) {
  if (!cached) cached = fetch(url).then(r => { if (!r.ok) throw new Error('Knowledge base unavailable'); return r.json(); }).then(buildIndex).catch(e => { cached = null; throw e; });
  return cached;
}
