'use strict';
/* Минимальный мок Telegram Bot API: хватает, чтобы прогнать бота без доступа к api.telegram.org */
const http = require('http');

function createMock(port) {
  const state = {
    botId: 999, queue: [], waiters: [], sent: [], docs: [], answers: [], menuButton: null,
  };
  const BOT = { id: state.botId, is_bot: true, username: 'pillow_hub_bot', first_name: 'Pillow Hub' };
  let uid = 1;
  state.push = (u) => { u.update_id = uid++; state.queue.push(u); flush(); };
  function flush() {
    while (state.waiters.length && state.queue.length) {
      const w = state.waiters.shift(); clearTimeout(w.t);
      w.res(state.queue.splice(0)); // отдаём всё накопленное
    }
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const method = req.url.split('/').pop();
      const ctype = req.headers['content-type'] || '';
      let p = {}; if (ctype.includes('json')) { try { p = JSON.parse(raw.toString()); } catch (_) {} }
      const ok = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
      const fail = (code, description) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error_code: code, description })); };

      switch (method) {
        case 'getMe': return ok(BOT);
        case 'deleteWebhook': case 'setMyCommands': case 'setMyShortDescription': return ok(true);
        case 'setChatMenuButton': state.menuButton = p.menu_button; return ok(true);
        case 'getUpdates': {
          if (state.queue.length) return ok(state.queue.splice(0));
          const w = { res: ok };
          w.t = setTimeout(() => { state.waiters = state.waiters.filter(x => x !== w); ok([]); }, 800);
          state.waiters.push(w); return;
        }
        case 'sendMessage': state.sent.push({ type: 'send', ...p }); return ok({ message_id: state.sent.length });
        case 'editMessageText': state.sent.push({ type: 'edit', ...p }); return ok({ message_id: p.message_id });
        case 'answerCallbackQuery': state.answers.push(p); return ok(true);
        case 'sendDocument': state.docs.push({ bytes: raw.length, ctype, byId: ctype.includes('json') ? p.document : null }); return ok({ message_id: 1, document: { file_id: 'FILE_ID_1' } });
        default: return fail(404, 'Not Found: ' + method);
      }
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ state, close: () => server.close() })));
}
module.exports = { createMock };
