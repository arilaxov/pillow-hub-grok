import {validateFile,check,abortError,MAX_BYTES,parseProbe} from './video-plan.mjs';
export {validateFile,MAX_BYTES,parseProbe};
let active=false,warm=null,warming=null,idleTimer=null;
function destroyEngine(){
 clearTimeout(idleTimer);try{warm?.ff.terminate();}catch{}if(warm?.wasmURL)URL.revokeObjectURL(warm.wasmURL);warm=null;warming=null;
}
async function getEngine(signal,onStatus){
 clearTimeout(idleTimer);if(warm?.ff.loaded)return warm.ff;
 if(warming)return warming;
 warming=(async()=>{
  check(signal);onStatus('Loading the compatibility engine…');
  const {FFmpeg}=await import('../vendor/ffmpeg/index.js');check(signal);const ff=new FFmpeg();warm={ff,wasmURL:null};
  const base=new URL('../vendor/core/',import.meta.url);
  // Bundled core is single-thread (no SharedArrayBuffer). GitHub Pages cannot send
  // COOP/COEP, so the multithreaded ffmpeg.wasm build is not used.
  let response=await fetch(new URL('ffmpeg-core.wasm.gz',base),{signal}),blob;
  if(response.ok){blob=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).blob();}
  else{response=await fetch(new URL('ffmpeg-core.wasm',base),{signal});if(!response.ok)throw new Error('The compatibility engine could not load.');blob=await response.blob();}
  check(signal);warm.wasmURL=URL.createObjectURL(blob);
  await ff.load({coreURL:new URL('ffmpeg-core.js',base).href,wasmURL:warm.wasmURL});check(signal);return ff;
 })().catch(error=>{destroyEngine();throw error;}).finally(()=>{warming=null;});
 return warming;
}
export async function inspectVideo(file,{signal}={}){
 validateFile(file);const {deviceJob}=await import('./video-device.mjs?v=94');return deviceJob(file,{}, {signal},'inspect');
}
export async function getVideoCapabilities(plan,{signal}={}){
 const {deviceJob}=await import('./video-device.mjs?v=94');return deviceJob(null,{plan},{signal},'capabilities');
}
export async function processVideo(file,options={},hooks={}){
 validateFile(file);if(active)throw new Error('Another video is already being processed.');active=true;
 let lastProgress=-1,lastTime=0;const onProgress=fraction=>{
  const now=performance.now();fraction=Math.min(1,Math.max(0,fraction));
  if(fraction<lastProgress)return;
  if(fraction===1||now-lastTime>=70||lastProgress<0){lastTime=now;lastProgress=fraction;hooks.onProgress?.(fraction);}
 };
 const wrapped={...hooks,onProgress};const abort=()=>destroyEngine();hooks.signal?.addEventListener('abort',abort,{once:true});
 let result;
 try{
  check(hooks.signal);hooks.onStage?.('load');hooks.onStatus?.('Getting ready…');onProgress(.01);
  if(options.engine!=='compatibility'){
   try{const {deviceJob}=await import('./video-device.mjs?v=94');result=await deviceJob(file,options,wrapped);return result;}
   catch(error){check(hooks.signal);if(!error.recoverable)throw error;hooks.onStatus?.('Switching to the compatibility engine…');}
  }
  const ff=await getEngine(hooks.signal,text=>hooks.onStatus?.(text));check(hooks.signal);
  const {processSoftware}=await import('./video-software.mjs?v=94');
  result=await processSoftware(file,options,wrapped,ff);return result;
 }catch(error){
  if(hooks.signal?.aborted)throw abortError();
  const message=String(error?.message||error||'');
  destroyEngine();
  if(/memory|OOM|allocation|out of resources/i.test(message))throw new Error('The device ran out of memory. Try a smaller output or a shorter clip.');
  throw error instanceof Error?error:new Error(message);
 }finally{
  hooks.signal?.removeEventListener('abort',abort);active=false;
  if(warm){if(file.size>64*1024*1024||result?.plan.width*result?.plan.height>5e6)destroyEngine();else idleTimer=setTimeout(destroyEngine,30000);}
 }
}
if(typeof window!=='undefined')window.addEventListener('pagehide',destroyEngine);
