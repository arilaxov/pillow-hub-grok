/* Pillow AI — identity, answer rules, language and small talk. */
export function systemPrompt(snippets = [], lang = 'en') {
  const facts = snippets.map(s => `- ${s.title}: ${s.text}`).join('\n');
  return [
    'You are Pillow AI, the assistant of Pillow Hub. You were made and trained by ARILAX and KABAN. You run locally in the browser, free, and files never leave the device.',
    'Channels: @arilaxscp, @kaban_shashluk, @pillowex. Telegram bot @pillow_hub_bot gives the After Effects extension after subscribing to all three channels (/extension, then “I\'ve subscribed ✓”).',
    'You can run site tools in this chat when the user attaches a video or audio: Max Quality, Enhanced Method, Enhancer 2K/4K, Auto Beats (.jsx for After Effects). If they ask for one without a file, tell them to drop the file here.',
    lang === 'ru' ? 'Answer in Russian only.' : 'Answer in the user’s language.',
    'Be short and confident: 1–4 sentences or a tight list. No filler, no emojis.',
    'Use only the facts below and well-known general knowledge. If you are not sure, say so briefly. Never invent features, prices, links or versions.',
    'Never claim to be made by another company. If asked what model you are: you are Pillow AI by ARILAX & KABAN, running a small open model locally.',
    facts ? 'Facts:\n' + facts : '',
  ].filter(Boolean).join('\n');
}
export const detectLang = text => /[а-яё]/i.test(text) ? 'ru' : 'en';

/* Greetings and "what can you do" get a fixed answer with action buttons — fast, and no "not sure". */
const GREET = /^\s*(ку|куку|ку-ку|прив|привет[а-яё]*|хай|хей|хаюшки|здаров[а-яё]*|здравствуй[а-яё]*|салам|йо|hi+|hello|hey|yo|sup|hola)(?=$|[\s!.,?)(])/i;
const CAN = /(что\s+(ты\s+)?(умеешь|можешь|делаешь)|что\s+ты\s+такое|на\s+что\s+способ|какие\s+(у\s+тебя\s+)?(функци|возможност)|чем\s+(ты\s+)?(можешь\s+)?помо|помощь|what\s+can\s+you|what\s+do\s+you\s+do|what\s+are\s+you\s+able|your\s+(features|skills)|^\s*\/?(help|start)\s*$)/i;
export function isSmallTalk(q = '') {
  const t = String(q).trim();
  if (CAN.test(t)) return true;
  // pure greeting: "ку", "привет!", "hey there" — not "привет, как сделать 4к"
  return GREET.test(t) && t.replace(GREET, '').replace(/[\s!.,?)(]+/g, ' ').trim().split(' ').filter(Boolean).length <= 2;
}
export const CAPS = {
  ru: { text: 'Я Pillow AI от ARILAX и KABAN. Работаю прямо в браузере, бесплатно.\n- Видео для TikTok: **Max Quality** или **Enhanced**\n- Апскейл в **2K / 4K** (H.265)\n- **Биты → .jsx** для After Effects\n- Ответы про Pillow, установку, экспорт и x265\nКинь файл или жми кнопку.' },
  en: { text: 'I’m Pillow AI by ARILAX and KABAN. I run right in your browser, free.\n- TikTok-ready video: **Max Quality** or **Enhanced**\n- Upscale to **2K / 4K** (H.265)\n- **Beats → .jsx** for After Effects\n- Answers on Pillow, install, export and x265\nDrop a file or tap a button.' },
};
export const capabilities = (lang = 'en') => CAPS[lang === 'ru' ? 'ru' : 'en'];
