/* Pillow AI — what the user wants done with a dropped file. Rules first; the model only breaks ties. */
export const ACTIONS = {
  max:       { label: 'Max Quality', kind: 'video' },
  enhanced:  { label: 'Enhanced Method', kind: 'video' },
  enhance2k: { label: 'Enhancer · 2K', kind: 'video' },
  enhance4k: { label: 'Enhancer · 4K', kind: 'video' },
  beats:     { label: 'Auto Beats', kind: 'audio' },
};
const R = {
  beats: /(beat|bpm|marker|jsx|бит|битов|битам|маркер|ритм|такт|под музык)/i,
  k4: /(\b4\s?k\b|4к|2160|uhd|ultra ?hd)/i,
  k2: /(\b2\s?k\b|2к|1440p?\b|qhd)/i,
  upscale: /(upscal|enhancer|увелич|апскейл|разрешени|resolution|sharper|четче|чётче)/i,
  max: /(max(imum)?\s*(quality|bitrate)?|макс|максимал|best quality|highest|лучше[ем]? качеств|без потер|lossless|bitrate|битрейт|(?<![x×]\s?)1080p)/i,
  enhanced: /(enhanced|энхансед|pillow ai method|улучш|почисти|denoise|шум|clean ?up)/i,
  tiktok: /(tik ?tok|тик ?ток|\bтт\b|studio|залить|загрузить|upload)/i,
};
export function ruleIntent(text = '', file = null) {
  const t = String(text), isAudio = !!file && /^audio\//.test(file.type || '') || /\.(mp3|wav|m4a|aac|flac|ogg|aiff?)$/i.test(file?.name || '');
  if (R.beats.test(t)) return { action: 'beats', confidence: .95 };
  if (R.k4.test(t)) return { action: 'enhance4k', confidence: .95 };
  if (R.k2.test(t) && !/1440\s*[x×]\s*1080/.test(t)) return { action: 'enhance2k', confidence: .9 };
  if (R.upscale.test(t)) return { action: 'enhance2k', confidence: .6 };
  if (R.enhanced.test(t)) return { action: 'enhanced', confidence: .85 };
  if (R.max.test(t)) return { action: 'max', confidence: .9 };
  if (file && isAudio) return { action: 'beats', confidence: .8 };
  if (file && R.tiktok.test(t)) return { action: 'max', confidence: .6 };
  return { action: null, confidence: 0 };
}
/* Reads {"action":"..."} from model text, tolerating code fences and chatter. */
export function parseModelIntent(raw = '') {
  const s = String(raw).replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = s.match(/\{[\s\S]*?\}/);
  if (m) { try { const a = JSON.parse(m[0]).action; if (a === 'none' || a === null) return null; if (ACTIONS[a]) return a; } catch {} }
  const word = s.match(/\b(max|enhanced|enhance2k|enhance4k|beats|none)\b/);
  return word && ACTIONS[word[1]] ? word[1] : null;
}
export const INTENT_PROMPT = 'Classify the request about the attached file. Reply with JSON only: {"action":"max"|"enhanced"|"enhance2k"|"enhance4k"|"beats"|"none"}. max = maximum quality/bitrate TikTok upload, enhanced = Pillow AI cleanup for TikTok, enhance2k/enhance4k = upscale, beats = beat markers / jsx for After Effects.';
export function pickAction(rule, modelAction, file) {
  if (rule.action && rule.confidence >= .8) return rule.action;
  if (modelAction) return modelAction;
  return rule.action || null;
}
export function fileKind(file) {
  if (!file) return null;
  if (/^audio\//.test(file.type) || /\.(mp3|wav|m4a|aac|flac|ogg|aiff?)$/i.test(file.name)) return 'audio';
  if (/^video\//.test(file.type) || /\.(mp4|mov|mkv|webm|ts|m4v)$/i.test(file.name)) return 'video';
  return null;
}
