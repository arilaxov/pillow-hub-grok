#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js 18+. Скачать: https://nodejs.org"
  read -r -p "Нажми Return, чтобы закрыть..."; exit 1
fi
PILLOW_PORT=${PORT:-8765}
if [ -z "$PORT" ] && [ -f .env ]; then
  PILLOW_CONFIG_PORT=$(sed -n 's/^PORT=\([0-9]*\)$/\1/p' .env | head -1)
  [ -n "$PILLOW_CONFIG_PORT" ] && PILLOW_PORT="$PILLOW_CONFIG_PORT"
fi
(sleep 1.5; open "http://127.0.0.1:$PILLOW_PORT/") &
echo "Pillow Hub: http://127.0.0.1:$PILLOW_PORT/"
echo "Чтобы остановить сервер, нажми Ctrl+C."
node server.js
