export const MAX_BYTES=256*1024*1024;
export const abortError=()=>new DOMException('Processing cancelled.','AbortError');
export const check=signal=>{if(signal?.aborted)throw abortError();};
export function validateFile(file){
 if(!file?.size)throw new Error('Choose a video file first.');
 if(file.size>MAX_BYTES)throw new Error('Choose a video under 256 MB.');
 if(!/\.(mp4|mov|mkv|webm|m4v|avi|ts|mts)$/i.test(file.name||'')&&!file.type?.startsWith('video/'))throw new Error('Choose an MP4, MOV, WebM, MKV or TS video.');
}
export function validateInfo(info){
 if(!info.width||!info.height||!Number.isFinite(info.duration)||info.duration<=0)throw new Error('No readable video stream was found.');
 if(Math.max(info.width,info.height)>4096)throw new Error('Choose a source video up to 4K.');
 if(info.duration>600)throw new Error('Choose a clip up to 10 minutes.');
 if(info.hdr)throw new Error('This is an HDR video. Export an SDR / Rec.709 copy first to keep its colours correct.');
}
const even=n=>Math.max(2,Math.round(n/2)*2);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
/* Enhancer sizes are relative to the source: 2K = short side 1440, 4K = short side 2160, aspect kept. */
export const HEVC_FALLBACK='No H.265 encoder on this device, so this copy is H.264.';
export const ENHANCE_TARGETS=Object.freeze({'2k':1440,'4k':2160});
const MAX_PIXELS=8.4e6;
export function enhanceSize(info,target){
 const short=Math.min(info.width,info.height),goal=ENHANCE_TARGETS[target];
 if(!goal)throw new Error('Choose 2K or 4K.');
 let k=goal/short;const px=info.width*info.height*k*k,capped=px>MAX_PIXELS;if(capped)k*=Math.sqrt(MAX_PIXELS/px);
 const fit=n=>capped?Math.max(2,Math.floor(n/2)*2):even(n);
 return {width:fit(info.width*k),height:fit(info.height*k),scale:k,available:short<goal};
}
/* Max Quality keeps the source size up to TikTok's 1080p tier (short side 1080), never pads or upscales. */
export function maxSize(info){
 const short=Math.min(info.width,info.height),k=Math.min(1,1080/short,1920/Math.max(info.width,info.height));
 return {width:even(info.width*k),height:even(info.height*k)};
}
export const sourceBpp=info=>info.bitrate&&info.width&&info.height?info.bitrate/(info.width*info.height*Math.max(1,info.fps||30)):null;
/* Picks every enhancement parameter from the source: resolution step, noise/detail estimate, bitrate and fps. */
export function autoTune(info,analysis,scale){
 const noise=clamp(analysis.scores?.[2]??(analysis.kind==='noise'?analysis.confidence:0),0,1);
 const detail=clamp(analysis.scores?.[1]??(analysis.kind==='detail'?analysis.confidence:0),0,1);
 const bpp=sourceBpp(info),compressed=bpp==null?.25:clamp((.09-bpp)/.08,0,1);
 const fast=(info.fps||30)>40;
 const denoise=+clamp(.22+noise*1.15+compressed*.55,.2,1.7).toFixed(3);
 const sharp=+clamp((.16+.09*Math.log2(Math.max(1,scale)))*(1-noise*.45)*(1-compressed*.35)*(1-detail*.25)*(fast?.92:1),.08,.42).toFixed(3);
 const crf=noise>.6||compressed>.6?21:detail>.6?19:20;
 const psy=+(noise>.6?1.2:compressed>.5?1.6:2).toFixed(1);
 return {noise:+noise.toFixed(3),detail:+detail.toFixed(3),compressed:+compressed.toFixed(3),bpp:bpp==null?null:+bpp.toFixed(4),denoise,sharp,crf,psy,
  deblock:noise>.6||compressed>.6?'0,0':'-1,-1',sao:noise>.6||compressed>.6,aqStrength:+(noise>.6?1:.85).toFixed(2)};
}
export function makePlan(info,options={},analysis={kind:'detail',confidence:0}){
 const mode=options.mode==='upscale'?'enhance':options.mode;
 const enhancing=mode==='enhance',max=mode==='max';
 let width,height,scale=1;
 if(enhancing){const s=enhanceSize(info,options.target||'2k');if(!s.available)throw new Error(`This video is already ${options.target==='4k'?'4K':'2K'} or larger.`);width=s.width;height=s.height;scale=s.scale;}
 else if(max){({width,height}=maxSize(info));}
 else{width=info.height>info.width?1080:1920;height=info.height>info.width?1920:1080;}
 if(width*height>9e6||Math.max(width,height)>7680)throw new Error('Choose a smaller output size for browser processing.');
 const fps=Math.min(60,Math.max(1,info.fps||30));
 const noiseScore=clamp(analysis.scores?.[2]??(analysis.kind==='noise'?analysis.confidence:0),0,1);
 const noisy=noiseScore>.65,tune=enhancing?autoTune(info,analysis,scale):null;
 const denoise=enhancing?tune.denoise:mode==='enhanced'&&noisy?.7:0;
 const sharp=enhancing?tune.sharp:mode==='enhanced'?.22:0;
 const contrast=1;
 const codec=enhancing&&options.codec!=='avc'?'hevc':'avc';
 const filter=[];
 if(denoise)filter.push(`hqdn3d=${(denoise*4).toFixed(2)}:${(denoise*3).toFixed(2)}:${(denoise*4.8).toFixed(2)}:${(denoise*4).toFixed(2)}`);
 if(max)filter.push(`scale=${width}:${height}:flags=lanczos:out_color_matrix=bt709:out_range=tv`,'setsar=1');
 else filter.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos:out_color_matrix=bt709:out_range=tv`,`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,'setsar=1');
 if(sharp)filter.push(enhancing?`smartblur=lr=1:ls=-${sharp.toFixed(3)}:lt=-8:cr=1:cs=0:ct=0`:`unsharp=5:5:${sharp}:5:5:0`);
 if(contrast!==1)filter.push(`eq=contrast=${contrast}`);
 filter.push('format=yuv420p');
 const gop=Math.max(1,Math.round(fps*2));
 const x265=tune?[`keyint=${gop}`,`min-keyint=${gop}`,`aq-mode=3`,`aq-strength=${tune.aqStrength}`,`psy-rd=${tune.psy}`,`psy-rdoq=1.0`,`rdoq-level=1`,`deblock=${tune.deblock}`,tune.sao?'sao=1':'no-sao=1','log-level=error'].join(':'):null;
 return {mode,width,height,fps,codec,noisy,denoise,sharp,contrast,enhancing,max,tune,gop,x265,filter:filter.join(','),
  crf:enhancing?String(codec==='hevc'?tune.crf:18):max?'16':'19',maxrate:max?(fps>35?'30M':'24M'):fps>35?'18M':'12M'};
}
export function canCopyMethod(info,plan){
 return !plan.enhancing&&['avc','h264'].includes(info.codec)&&info.width===plan.width&&info.height===plan.height&&(info.rotation||0)===0&&info.fps<=60.1&&info.squarePixels!==false&&!info.hdr&&info.compatible8Bit!==false;
}
export function bitrateFor(plan,codec=plan.codec){
 if(plan.max)return Math.round(Math.min(30e6,Math.max(8e6,plan.width*plan.height*plan.fps*.24)));
 if(plan.enhancing&&codec==='hevc'){const k=plan.tune?(plan.tune.noise>.6||plan.tune.compressed>.6?.085:.1):.1;return Math.round(Math.min(60e6,Math.max(2e6,plan.width*plan.height*plan.fps*k)));}
 return Math.round(Math.min(codec==='hevc'?40e6:60e6,Math.max(1.2e6,plan.width*plan.height*plan.fps*(codec==='hevc'?.09:.14))));
}
export function parseProbe(lines){
 const text=lines.join('\n'),line=lines.find(v=>/Stream .*Video:/.test(v)&&!v.includes('attached pic'))||'';
 const dim=line.match(/\b(\d{2,5})x(\d{2,5})\b/),fps=line.match(/([\d.]+) fps/),duration=text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
 if(!dim)throw new Error('No readable video stream was found. Try another source.');
 const rotationMatch=text.match(/rotation of (-?[\d.]+) degrees/),rotation=rotationMatch?+rotationMatch[1]:0,swap=Math.abs(Math.round(rotation/90))%2===1;
 const sar=line.match(/SAR (\d+):(\d+)/),codec=line.match(/Video:\s*(\w+)/)?.[1];
 return {width:+(swap?dim[2]:dim[1]),height:+(swap?dim[1]:dim[2]),fps:fps?+fps[1]:30,duration:duration?+duration[1]*3600+ +duration[2]*60+ +duration[3]:0,
  codec,rotation,squarePixels:!sar||sar[1]===sar[2],compatible8Bit:/\byuv420p(?:\(|,|\s)/.test(line),
  bitrate:(+(text.match(/bitrate:\s*(\d+)\s*kb\/s/)||[])[1]||0)*1000||null,audio:/Stream .*Audio:/.test(text),audioCodec:text.match(/Audio:\s*(\w+)/)?.[1]||null,hdr:/bt2020|smpte2084|arib-std-b67/.test(line)};
}

// Reads colour primaries / transfer from the first SPS in an avcC record (H.264 VUI).
// Browsers' software decoders report BT.709 for everything, so HDR tagged only in the bitstream is found here.
export function avcColor(description){
 try{
  const d=description instanceof Uint8Array?description:new Uint8Array(description.buffer?description.buffer.slice(description.byteOffset,description.byteOffset+description.byteLength):description);
  if(d[0]!==1||(d[5]&31)<1)return null;const len=d[6]<<8|d[7];const raw=d.subarray(9,8+len);
  const b=[];for(let i=0;i<raw.length;i++){if(i>=2&&raw[i]===3&&raw[i-1]===0&&raw[i-2]===0)continue;b.push(raw[i]);}
  let p=0;const bit=()=>{if(p>>3>=b.length)throw 0;const v=b[p>>3]>>(7-(p&7))&1;p++;return v;},bits=n=>{let v=0;while(n--)v=v*2+bit();return v;},ue=()=>{let z=0;while(!bit())z++;return z?(2**z-1+bits(z)):0;},se=()=>{const k=ue();return k&1?(k+1)/2:-k/2;};
  const profile=b[0];p=24;ue();let bitDepth=8;
  if([100,110,122,244,44,83,86,118,128,138,139,134,135].includes(profile)){const cf=ue();if(cf===3)bit();bitDepth=8+ue();ue();bit();if(bit()){for(let i=0;i<(cf!==3?8:12);i++)if(bit()){const n=i<6?16:64;let last=8,next=8;for(let j=0;j<n;j++){if(next)next=(last+se()+256)%256;last=next||last;}}}}
  ue();const poc=ue();if(poc===0)ue();else if(poc===1){bit();se();se();const n=ue();for(let i=0;i<n;i++)se();}
  ue();bit();ue();ue();if(!bit())bit();bit();if(bit()){ue();ue();ue();ue();}
  if(!bit())return {bitDepth};
  if(bit()&&bits(8)===255)bits(32);if(bit())bit();
  if(!bit())return {bitDepth};bits(3);bit();if(!bit())return {bitDepth};
  return {bitDepth,primaries:bits(8),transfer:bits(8),matrix:bits(8)};
 }catch{return null;}
}
export const isHdrColor=c=>!!c&&(c.primaries===9||c.matrix===9||c.matrix===10||c.transfer===16||c.transfer===18);
