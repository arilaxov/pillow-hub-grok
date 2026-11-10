# Pillow Hub

Static site for [Pillow Hub](https://arilaxov.github.io/pillow-hub-grok/). GitHub Pages serves this branch from `/` (repository root).

The pages, styles, modules and `vendor/` files at the root are the contents of [`source/public/`](source/public/). The Node server, tests and panel scripts stay in [`source/`](source/). Run the local server from there: `cd source && node server.js`.

## What is different for GitHub Pages

- Links are relative (`ai.html`, `method.html`, `tools.html`), because Pages cannot redirect `/ai` the way `server.js` does. `ai/`, `method/`, `tiktok-method.html` and `upload-method/` are small relative redirects to those pages.
- `site.js` loads `api/config.json` relative to the current page. On Pages that file is the static fallback (downloads stay at 0). The Node server answers the same path with live counters.
- `version` and `version.json` are the static panel-update payload. `POST /feedback` still needs the Node server.
- ffmpeg.wasm uses the bundled single-thread core (`vendor/core/`). It does not need `SharedArrayBuffer`, so missing COOP/COEP headers are fine. Workers, the wasm core and `vendor/web-llm/web-llm.js` are loaded from relative URLs.
- `.nojekyll` keeps Pages from hiding `vendor/`.

## Pages setting

Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: **`main`**, folder: **`/ (root)`**.

The public URL is https://arilaxov.github.io/pillow-hub-grok/
