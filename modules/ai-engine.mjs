/* Pillow AI — lazy WebLLM engine (Web Worker, WebGPU, browser cache). */
export const MODELS = [
  { key: 'main', id: 'Qwen3.5-2B-q4f16_1-MLC', f32: 'Qwen3.5-2B-q4f32_1-MLC', name: 'Qwen3.5 2B', label: 'Pillow AI', size: '1.1 GB', vram: 2245 },
  { key: 'lite', id: 'Qwen3.5-0.8B-q4f16_1-MLC', f32: 'Qwen3.5-0.8B-q4f32_1-MLC', name: 'Qwen3.5 0.8B', label: 'Lite', size: '0.45 GB', vram: 1630 },
];
let webllm = null, engine = null, loadedId = null, worker = null;
const lib = () => (webllm ??= import('../vendor/web-llm/web-llm.js'));
const mock = () => globalThis.__PILLOW_AI_MOCK__ || null;

export async function gpuStatus() {
  if (mock()) return { ok: true, f16: true, mock: true };
  if (!globalThis.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!navigator.gpu) return { ok: false, reason: 'nogpu' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: 'noadapter' };
    return { ok: true, f16: adapter.features.has('shader-f16'), vendor: adapter.info?.vendor || '' };
  } catch { return { ok: false, reason: 'noadapter' }; }
}
export function modelFor(key, gpu) { const m = MODELS.find(x => x.key === key) || MODELS[0]; return gpu?.f16 === false ? m.f32 : m.id; }

export async function isCached(id) {
  if (mock()) return !!mock().cached;
  try { const w = await lib(); return await w.hasModelInCache(id); } catch { return false; }
}
export async function loadModel(id, onProgress = () => {}) {
  if (engine && loadedId === id) return engine;
  if (mock()) { engine = await mock().create(id, onProgress); loadedId = id; return engine; }
  const w = await lib();
  if (engine) { try { await engine.unload(); } catch {} engine = null; loadedId = null; }
  worker = new Worker(new URL('./ai-worker.mjs?v=93', import.meta.url), { type: 'module' });
  try {
    engine = await w.CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: r => onProgress(r) }, { context_window_size: 4096 });
  } catch (e) { worker.terminate(); worker = null; throw e; }
  loadedId = id; return engine;
}
export const ready = () => !!engine;
export const isGpuLost = e => /device (was )?lost|instance reference|already been disposed|GPUDeviceLost/i.test(String(e?.message || e));
export function dropEngine() { try { worker?.terminate(); } catch {} worker = null; engine = null; loadedId = null; }
export const currentModel = () => loadedId;
export async function* stream(messages, { maxTokens = 420, temperature = .4, signal } = {}) {
  const chunks = await engine.chat.completions.create({ messages, stream: true, temperature, top_p: .9, max_tokens: maxTokens, extra_body: { enable_thinking: false } });
  for await (const c of chunks) { if (signal?.aborted) { try { engine.interruptGenerate(); } catch {} break; } const d = c.choices?.[0]?.delta?.content; if (d) yield d; }
}
export async function complete(messages, opts = {}) { let s = ''; for await (const d of stream(messages, { ...opts, temperature: 0 })) s += d; return s; }
export function stripThink(text) { return String(text).replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, ''); }
