# Third-party notices

## Bundled code

- **Mediabunny 1.45.0** — MPL-2.0, unmodified. `public/vendor/mediabunny/` (LICENSE, NOTICE.txt).
- **ffmpeg.wasm 0.12 (@ffmpeg/ffmpeg, @ffmpeg/core)** — `public/vendor/ffmpeg/`, `public/vendor/core/`. The core includes FFmpeg (LGPL/GPL with libx264 and libx265, GPL).

- **WebLLM 0.2.88 (@mlc-ai/web-llm)** — Apache-2.0, unmodified `lib/index.js` saved as `public/vendor/web-llm/web-llm.js` (LICENSE, NOTICE.txt). https://github.com/mlc-ai/web-llm

## Downloaded at runtime (not bundled)

- **Qwen3.5 2B / 0.8B (MLC q4f16_1 / q4f32_1 builds)** — weights from https://huggingface.co/mlc-ai (Qwen3.5 by the Qwen team, Apache-2.0), WebGPU model libraries from https://github.com/mlc-ai/binary-mlc-llm-libs (Apache-2.0). Fetched only after the user presses Load on the Pillow AI page; cached by the browser (Cache Storage).

## Techniques credited (no code copied)

`public/modules/mp4-patch.mjs` (Method → Max Quality) is an independent JavaScript implementation written from the public descriptions below. No source files from these projects are included. Both are MIT-licensed; their notices are reproduced for attribution.

- **Open Quality Method (OQM)** — https://github.com/naveen-gunawardana/open-upload-method — documentation of the container patch catalogue (decoy / ghost audio track with kept edit list, mvhd unknown duration, ftyp→moov→mdat layout, minimal metadata) and the clean high-quality master export.
  > MIT License — Copyright (c) 2026 Open Quality Method contributors
- **tiktok-lossless-upload** — https://github.com/buwryme/tiktok-lossless-upload — description of the "mvhd" (duration64) method: mvhd v0 → v1 with all fields kept and the duration set to 0xFFFFFFFFFFFFFFFF, chunk offsets shifted.
  > MIT License — Copyright (c) 2026 miles

MIT License text (applies to the two notices above):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

CompressBase's Method API (https://compressbase.com/method-api) was read for its public description of variants only; Pillow does not call it.
