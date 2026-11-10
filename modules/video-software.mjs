import {features,classify} from './content-analysis.mjs';
import {makePlan,canCopyMethod,parseProbe,validateInfo,check,HEVC_FALLBACK} from './video-plan.mjs';
import {patchForUpload,describeMp4} from './mp4-patch.mjs';
let modelPromise=null;
async function probe(ff,name){
 const lines=[],logger=({message})=>lines.push(message);ff.on('log',logger);
 try{await ff.exec(['-hide_banner','-v','info','-i',name]);}finally{ff.off('log',logger);}
 return parseProbe(lines);
}
async function analyze(ff,input,info,signal){
 modelPromise??=fetch(new URL('../assets/content-model.json',import.meta.url),{signal}).then(r=>{if(!r.ok)throw new Error('Pillow AI could not load.');return r.json();}).catch(error=>{modelPromise=null;throw error;});
 const model=await modelPromise;check(signal);
 // Seek a little in, unless that lands outside the stream (e.g. MPEG-TS with a non-zero start time).
 const grab=async seek=>{try{await ff.deleteFile('analysis.gray');}catch{}
  const code=await ff.exec(['-y',...(seek?['-ss',String(Math.min(.08,info.duration*.1))]:[]),'-i',input,'-frames:v','1','-vf','crop=min(iw\\,96):min(ih\\,96),scale=48:48:flags=area,format=gray','-f','rawvideo','analysis.gray']);
  if(code!==0)return null;try{return await ff.readFile('analysis.gray');}catch{return null;}};
 let bytes=await grab(true);check(signal);
 if(!bytes||bytes.length!==48*48){bytes=await grab(false);check(signal);}
 if(!bytes)throw new Error('A video frame could not be read.');
 if(bytes.length!==48*48)throw new Error('The video frame is incomplete.');
 return {...classify(features(Float32Array.from(bytes,x=>x/255),48,48),model),model:model.name};
}
export async function processSoftware(file,options,hooks,ff){
 const {signal,onStage=()=>{},onStatus=()=>{},onProgress=()=>{}}=hooks;
 const suffix=(file.name?.match(/\.([a-z0-9]{2,5})$/i)||[])[1]||'mp4',input='input.'+suffix;
 const names=[input,'analysis.gray','preview.mp4','upload.ts','upload.mp4'];let info,plan;
 let progressStart=0,progressSpan=0;
 const progress=({progress})=>{if(Number.isFinite(progress))onProgress(progressStart+Math.min(.999,Math.max(0,progress))*progressSpan);};
 ff.on('progress',progress);
 try{
  check(signal);onStage('read');onStatus('Opening your video…');onProgress(.04);
  await ff.writeFile(input,new Uint8Array(await file.arrayBuffer()));check(signal);
  info=await probe(ff,input);validateInfo(info);hooks.onSource?.(info);
  let analysis={kind:'preserve',confidence:1};plan=makePlan(info,options,analysis);
  const copy=canCopyMethod(info,plan);let preview;
  if(copy){
   plan={...plan,engine:'copy',fast:true,sharp:0,denoise:0};hooks.onPlan?.(plan,analysis);onStage('prepare');onStatus('Keeping original video quality…');
   const code=await ff.exec(['-i',input,'-map','0:v:0','-map','0:a:0?','-c:v','copy',...(info.audioCodec==='aac'?['-c:a','copy']:['-c:a','aac','-b:a',plan.max?'320k':'192k']),'-map_metadata','-1','-movflags','+faststart','preview.mp4']);
   check(signal);if(code!==0)throw new Error('The video could not be prepared.');
  }else{
   if(plan.enhancing||options.mode==='enhanced'){onStage('analyze');onStatus('Pillow AI is reading the detail…');analysis=await analyze(ff,input,info,signal);}
   plan={...makePlan(info,options,analysis),engine:'compatibility',fast:false};
   hooks.onPlan?.(plan,analysis);onStage('prepare');onStatus(plan.codec==='hevc'?'Pillow AI is refining your video…':'Preparing with the compatibility engine…');
   progressStart=.1;progressSpan=.72;
   const audio=info.audio?['-map','0:a:0',...(info.audioCodec==='aac'?['-c:a','copy']:['-c:a','aac','-b:a',plan.max?'320k':'192k','-ar','48000'])]:['-an'];
   const encode=videoCodec=>ff.exec(['-i',input,'-map','0:v:0',...audio,'-map_metadata','-1','-sn','-dn','-vf',plan.filter,'-r',String(plan.fps),...videoCodec,'-pix_fmt','yuv420p','-threads','1',
    '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-movflags','+faststart','-metadata','comment=Prepared with Pillow AI','preview.mp4']);
   const x264=plan.max?['-c:v','libx264','-preset','veryfast','-crf',plan.crf,'-profile:v','high','-level:v',plan.fps>30?'4.2':'4.1','-g',String(plan.gop),'-keyint_min',String(plan.gop),'-maxrate',plan.maxrate,'-bufsize',String(parseInt(plan.maxrate)*2)+'M']
    :['-c:v','libx264','-preset','ultrafast','-crf',plan.crf,'-profile:v','high','-maxrate',plan.maxrate,'-bufsize',plan.maxrate];
   let code;
   if(plan.enhancing){
    // ffmpeg.wasm's libx265 never finishes in a browser (single- and multi-thread cores), so the software
    // Enhancer writes H.264 with the same intent: psycho-visual RD, auto-variance AQ and Pillow AI's CRF.
    if(plan.codec==='hevc'){plan.codec='avc';plan.fallback=HEVC_FALLBACK;hooks.onPlan?.(plan,analysis);}
    const rate=plan.width*plan.height*plan.fps,preset=rate>2.6e8?'ultrafast':rate>1.2e8?'superfast':'veryfast',t=plan.tune||{aqStrength:1,psy:1.6};
    code=await encode(['-c:v','libx264','-preset',preset,'-crf',String(Math.max(14,Number(plan.crf)-2)),'-profile:v','high','-g',String(plan.gop),'-keyint_min',String(plan.gop),
     '-x264-params',`aq-mode=3:aq-strength=${Math.min(1.3,t.aqStrength).toFixed(2)}:psy-rd=${Math.min(1.2,t.psy/1.6).toFixed(2)},0.15`]);
   }else code=await encode(x264);
   check(signal);if(code!==0)throw new Error('Encoding failed. Try a shorter clip or a smaller output.');
  }
  preview=new Blob([await ff.readFile('preview.mp4')],{type:'video/mp4'});let output=preview,patch=null;
  if(plan.max){
   onStage('package');onStatus('Patching the container…');onProgress(.88);
   ({blob:output,report:patch}=await patchForUpload(preview));check(signal);
   const d=await describeMp4(output);
   if(d.layout.join()!=='ftyp,moov,mdat'||d.mvhdVersion!==1||d.mvhdDuration!=='ffffffffffffffff')throw new Error('The patched file did not pass its checks.');
   await ff.writeFile('upload.mp4',new Uint8Array(await output.arrayBuffer()));
  }
  if(options.mode==='enhanced'){
   onStage('package');onStatus('Getting it ready for TikTok…');progressStart=.83;progressSpan=.08;
   const code=await ff.exec(['-i','preview.mp4','-map','0:v:0','-map','0:a:0?','-c','copy','-bsf:v','h264_mp4toannexb','-mpegts_flags','+resend_headers','-muxdelay','0','-muxpreload','0','-f','mpegts','upload.ts']);
   check(signal);if(code!==0)throw new Error('The upload copy could not be packaged.');
   const data=await ff.readFile('upload.ts');if(data.length<376||data[0]!==71||data[188]!==71)throw new Error('The upload container is incomplete.');
   output=new Blob([data],{type:'video/mp2t'});
  }
  // Check metadata and a short decoded prefix. Long clips no longer get decoded a second time in full.
  onStage('verify');onStatus('Checking the finished video…');onProgress(.93);
  // Max Quality: stream facts come from the unpatched master (its mvhd duration is intentionally 'unknown'); the patched file is decoded below.
  const name=options.mode==='enhanced'?'upload.ts':plan.max?'upload.mp4':'preview.mp4',outputInfo=await probe(ff,plan.max?'preview.mp4':name);check(signal);
  if(outputInfo.width!==plan.width||outputInfo.height!==plan.height||outputInfo.audio!==info.audio||Math.abs(outputInfo.duration-info.duration)>.75)throw new Error('The output did not pass its video and audio checks.');
  if(plan.codec==='hevc'&&outputInfo.codec!=='hevc')throw new Error('The H.265 output could not be produced.');
  progressStart=.94;progressSpan=.05;
  const verified=await ff.exec(['-v','error','-xerror','-i',name,'-t',String(Math.min(.25,info.duration)),'-map','0:v:0','-map','0:a:0?','-f','null','-']);
  check(signal);if(verified!==0)throw new Error('The video contains a decoding error.');
  onStage('done');onProgress(1);onStatus('Ready to download.');
  return {output,preview,info,plan,analysis,outputInfo,patch,mode:options.mode};
 }finally{
  ff.off('progress',progress);
  if(!signal?.aborted)for(const name of names){try{await ff.deleteFile(name);}catch{}}
 }
}
