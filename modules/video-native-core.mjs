import * as M from '../vendor/mediabunny/mediabunny.mjs';
import {features,classify} from './content-analysis.mjs';
import {makePlan,canCopyMethod,bitrateFor,validateInfo,check,HEVC_FALLBACK,avcColor,isHdrColor} from './video-plan.mjs';
import {createDetailRenderer} from './video-gl.mjs';
import {patchForUpload,describeMp4} from './mp4-patch.mjs';
export class NativeUnavailable extends Error{constructor(message){super(message);this.name='NativeUnavailable';this.recoverable=true;}}
export async function inspectInput(file){
 const input=new M.Input({source:new M.BlobSource(file),formats:M.ALL_FORMATS});
 try{
  const video=await input.getPrimaryVideoTrack();if(!video)throw new Error('No readable video stream was found.');
  const audio=await input.getPrimaryAudioTrack();
  const [width,height,codec,rotation,duration,stats,sar,hdr,parameter,container]=await Promise.all([
   video.getDisplayWidth(),video.getDisplayHeight(),video.getCodec(),video.getRotation(),video.getDurationFromMetadata(),video.computePacketStats(90),video.getPixelAspectRatio(),video.hasHighDynamicRange(),video.getCodecParameterString(),input.getFormat()
  ]);
  const profile=parameter?.startsWith('avc')?parseInt(parameter.split('.')[1]?.slice(0,2),16):null;
  const info={width,height,codec,rotation,duration:duration??await video.computeDuration(),fps:stats.averagePacketRate||30,audio:!!audio,audioCodec:audio?await audio.getCodec():null,
   bitrate:file.size&&duration?Math.round(file.size*8/duration):null,squarePixels:sar.num===sar.den,compatible8Bit:codec!=='avc'||[66,77,88,100].includes(profile),hdr,container:container.name};
  if(!info.hdr&&codec==='avc'){try{const dc=await video.getDecoderConfig();if(dc?.description&&isHdrColor(avcColor(dc.description)))info.hdr=true;}catch{}}
  return {input,video,audio,info};
 }catch(error){input.dispose();throw error;}
}
export async function videoCapabilities(plan){
 const caps={hevc:false,avc:false};
 if(typeof VideoEncoder==='undefined'||typeof VideoDecoder==='undefined'||typeof OffscreenCanvas==='undefined')return caps;
 let renderer;
 try{
  renderer=createDetailRenderer({...plan,width:16,height:16,denoise:.5,sharp:.28,contrast:1.01});
  if(plan.width>renderer.maxSize||plan.height>renderer.maxSize)return caps;
  for(const codec of ['hevc','avc'])caps[codec]=await M.canEncodeVideo(codec,{width:plan.width,height:plan.height,bitrate:bitrateFor(plan,codec),hardwareAcceleration:'prefer-hardware'});
 }catch{}finally{renderer?.dispose();}
 return caps;
}
async function analyzeFrame(video,info,signal){
 check(signal);
 const response=await fetch(new URL('../assets/content-model.json',import.meta.url),{signal});
 if(!response.ok)throw new Error('The Pillow AI model could not load.');
 const model=await response.json();check(signal);
 const sink=new M.CanvasSink(video,{width:48,height:48,fit:'fill',crop:{left:Math.max(0,Math.floor((info.width-96)/2)),top:Math.max(0,Math.floor((info.height-96)/2)),width:Math.min(info.width,96),height:Math.min(info.height,96)}});
 const frame=await sink.getCanvas(Math.max(0,await video.getFirstTimestamp())+Math.min(.08,info.duration*.1));check(signal);
 if(!frame)throw new Error('A source frame could not be read.');
 const ctx=frame.canvas.getContext('2d',{willReadFrequently:true});
 const rgba=ctx.getImageData(0,0,48,48).data,gray=new Float32Array(48*48);
 for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]*.2126+rgba[i*4+1]*.7152+rgba[i*4+2]*.0722)/255;
 return {...classify(features(gray,48,48),model),model:model.name};
}
async function runConversion(context,format,videoOptions,audioOptions,hooks,range){
 const target=new M.BufferTarget(),output=new M.Output({format,target});
 let conversion;
 try{
  const firstTimestamp=Math.min(0,await context.video.getFirstTimestamp(),context.audio?await context.audio.getFirstTimestamp():0);
  conversion=await M.Conversion.init({input:context.input,output,trim:{start:firstTimestamp},tracks:'primary',video:videoOptions,audio:audioOptions,tags:{comment:'Prepared with Pillow'},showWarnings:false});
  if(!conversion.isValid||!conversion.utilizedTracks.includes(context.video)||(context.audio&&!conversion.utilizedTracks.includes(context.audio)))throw new NativeUnavailable('The device cannot encode all tracks in this video.');
  check(hooks.signal);
  const abort=()=>{void conversion.cancel().catch(()=>{});};hooks.signal?.addEventListener('abort',abort,{once:true});
  conversion.onProgress=fraction=>{check(hooks.signal);hooks.onProgress?.(range[0]+Math.min(.999,fraction)*range[1]);};
  try{await conversion.execute();check(hooks.signal);}finally{hooks.signal?.removeEventListener('abort',abort);}
  if(!target.buffer?.byteLength)throw new Error('The encoded video is empty.');
  return new Blob([target.buffer],{type:format.mimeType});
 }catch(error){await output.cancel().catch(()=>{});throw error;}
}
export async function verifyContainer(blob,sourceInfo,plan){
 const ctx=await inspectInput(blob);
 try{
  const i=ctx.info;
  if(i.width!==plan.width||i.height!==plan.height||i.audio!==sourceInfo.audio||Math.abs(i.duration-sourceInfo.duration)>.75)throw new Error('The output did not pass its video and audio checks.');
  if(plan.codec==='hevc'&&i.codec!=='hevc')throw new Error('The selected H.265 output was not produced.');
  return i;
 }finally{ctx.input.dispose();}
}
export async function processNative(file,options={},hooks={}){
 const {signal,onStatus=()=>{},onProgress=()=>{},onStage=()=>{}}=hooks;
 let context=null,intermediate=null,renderer=null;
 try{
  check(signal);onStage('read');onStatus('Reading your video…');onProgress(.02);
  try{context=await inspectInput(file);}catch(error){throw new NativeUnavailable(error.message);}
  const {video,audio,info}=context;validateInfo(info);check(signal);hooks.onSource?.(info);
  let analysis={kind:'preserve',confidence:1};let plan=makePlan(info,options,analysis);
  const copy=canCopyMethod(info,plan)&&(!audio||info.audioCodec==='aac');
  let preview;
  if(copy){
   plan={...plan,fast:true,engine:'copy',denoise:0,sharp:0};hooks.onPlan?.(plan,analysis);
   onStage('prepare');onStatus('Keeping your original quality…');onProgress(.08);
   // Reuse a regular MP4 directly. Other supported containers are remuxed, never re-encoded.
   preview=info.container==='MP4'&&!plan.max?new Blob([file],{type:'video/mp4'}):await runConversion(context,new M.Mp4OutputFormat({fastStart:'in-memory'}),{}, {},hooks,[.08,.3]);
  }else{
   if(typeof VideoEncoder==='undefined'||typeof VideoDecoder==='undefined'||typeof OffscreenCanvas==='undefined')throw new NativeUnavailable('Device video processing is unavailable.');
   if(!await video.canDecode())throw new NativeUnavailable('The device cannot decode this source.');
   // Enhancer: always H.265 when the device has an HEVC encoder (Chrome/Edge/Safari use the GPU encoder).
   // ffmpeg.wasm's libx265 stalls in browsers, so without one the honest fallback is H.264 with a note.
   let codec=plan.enhancing?'hevc':'avc',fallback=null;
   const can=c=>M.canEncodeVideo(c,{width:plan.width,height:plan.height,bitrate:bitrateFor(plan,c),hardwareAcceleration:'prefer-hardware'});
   if(codec==='hevc'&&!await can('hevc')){codec='avc';fallback=HEVC_FALLBACK;}
   if(!await can(codec))throw new NativeUnavailable('The requested device encoder is unavailable.');
   if(audio&&info.audioCodec!=='aac'&&!await M.canEncodeAudio('aac',{sampleRate:48000,numberOfChannels:2}))throw new NativeUnavailable('The device audio encoder is unavailable.');
   onStage('analyze');onStatus(plan.enhancing?'Pillow AI is finding the detail…':plan.max?'Preparing a high-bitrate master…':'Preparing your video…');
   if(plan.enhancing||options.mode==='enhanced')analysis=await analyzeFrame(video,info,signal);
   plan={...makePlan(info,options,analysis),codec,engine:'device',fast:false};if(fallback)plan.fallback=fallback;check(signal);
   if(plan.sharp||plan.denoise){try{renderer=createDetailRenderer(plan);}catch(error){throw new NativeUnavailable(error.message);}}
   hooks.onPlan?.(plan,analysis);onStage('prepare');onStatus(plan.enhancing?'Pillow AI is refining your video…':'Preparing your video on this device…');
   const videoOptions={width:plan.width,height:plan.height,fit:'contain',allowRotationMetadata:false,codec,bitrate:bitrateFor(plan,codec),hardwareAcceleration:'prefer-hardware',forceTranscode:true,keyFrameInterval:2,latencyMode:'quality',bitrateMode:'variable'};
   if(plan.enhancing||plan.max)videoOptions.contentHint='detail';
   if(info.fps>60.1)videoOptions.frameRate=60;
   if(renderer){videoOptions.process=sample=>{check(signal);return renderer.render(sample);};videoOptions.processedWidth=plan.width;videoOptions.processedHeight=plan.height;}
   const audioOptions=info.audioCodec==='aac'?{}:{codec:'aac',bitrate:plan.max?320000:192000,sampleRate:48000};
   preview=await runConversion(context,new M.Mp4OutputFormat({fastStart:'in-memory'}),videoOptions,audioOptions,hooks,[.1,.72]);
  }
  check(signal);let output=preview,patch=null;
  if(plan.max){
   onStage('package');onStatus('Patching the container…');onProgress(.86);
   ({blob:output,report:patch}=await patchForUpload(preview));
   const d=await describeMp4(output);
   if(d.layout.join()!=='ftyp,moov,mdat'||d.mvhdVersion!==1||d.mvhdDuration!=='ffffffffffffffff'||d.tracks.some(t=>t.firstChunk!=null&&(t.firstChunk<d.mdat.start||t.firstChunk>=d.mdat.end)))throw new Error('The patched file did not pass its checks.');
  }
  if(options.mode==='enhanced'){
   onStage('package');onStatus('Getting it ready for TikTok…');
   intermediate=await inspectInput(preview);
   output=await runConversion(intermediate,new M.MpegTsOutputFormat(),{},{},hooks,[.83,.12]);
  }
  check(signal);onStage('verify');onStatus('Checking the finished video…');onProgress(.96);
  const outputInfo=await verifyContainer(plan.max?preview:output,info,plan);check(signal);
  onStage('done');onProgress(1);onStatus('Ready to download.');
  return {output,preview,info,plan,analysis,outputInfo,patch,mode:options.mode};
 }finally{renderer?.dispose();intermediate?.input.dispose();context?.input.dispose();}
}
