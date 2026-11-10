/* Pillow AI — WebLLM runs here so the page never freezes. */
import { WebWorkerMLCEngineHandler } from '../vendor/web-llm/web-llm.js';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
