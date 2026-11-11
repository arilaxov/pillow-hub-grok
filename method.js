import {processVideo,validateFile} from './modules/video-engine.mjs?v=94';
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const input=$('#method-file'),drop=$('#method-drop'),start=$('#method-start'),cancel=$('#method-cancel'),status=$('#method-status');
const activity=$('#method-activity'),workspace=$('.method-workspace');
let file=null,mode='enhanced',controller=null,sourceURL=null,resultURLs=[],selection=0,fastCopy=false;
const mb=bytes=>(bytes/1048576).toFixed(1)+' MB';
const stages={load:0,read:0,analyze:0,prepare:1,package:2,verify:2,done:2};
function setStage(stage){
 activity.dataset.stage=stage;workspace.dataset.stage=stage;
 const enhanced=mode==='enhanced';
 const titles={load:'Getting ready',read:'Reading your video',analyze:'Finding the details',prepare:fastCopy?'Keeping original quality':enhanced?'Refining your video':'Encoding at full bitrate',package:enhanced?'Ready for the feed':'Patching for TikTok',verify:'One final check',done:'Ready for TikTok'};
 $('#activity-brand').textContent=enhanced&&!fastCopy?'Pillow AI':'Max Quality';
 $('#activity-title').textContent=titles[stage]||'Preparing your video';
 $$('[data-activity-step]').forEach(step=>{
  const index=+step.dataset.activityStep,current=stages[stage]??0;
  step.classList.toggle('is-current',index===current);
  step.classList.toggle('is-complete',index<current||stage==='done');
 });
}
function setProgress(fraction){
 $('#method-progress').value=fraction;
 $('#progress-number').textContent=Math.round(fraction*100)+'%';
}
function clearResult(){
 const preview=$('#result-preview');preview.pause();preview.removeAttribute('src');preview.load();
 resultURLs.forEach(URL.revokeObjectURL);resultURLs=[];
 $('#method-result').hidden=true;$('#method-result').classList.remove('has-result');
}
function setBusy(busy){
 start.disabled=busy||!file;cancel.hidden=!busy;drop.disabled=busy;input.disabled=busy;
 $$('[name=method]').forEach(radio=>radio.disabled=busy);
 $('#method-progress-wrap').hidden=!busy;activity.hidden=!busy;activity.dataset.mode=mode;
 workspace.classList.toggle('is-processing',busy);
 $('.method-pane').setAttribute('aria-busy',String(busy));
 $('#method-step').textContent=busy?'02 / PROCESSING':file?'02 / READY TO PREPARE':'01 / YOUR VIDEO';
}
function resetFacts(){
 $('#output-resolution').textContent=mode==='enhanced'?'Full HD':'Up to 1080p';$('#output-fps').textContent='Up to 60 FPS';
 $('#analysis-label').textContent=mode==='enhanced'?'Pillow AI':'Max bitrate · patched';
}
async function take(nextFile){
 if(!nextFile||controller)return;
 const current=++selection;clearResult();file=null;setProgress(0);start.disabled=true;resetFacts();
 if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=null;
 const video=$('#source-preview');video.pause();video.removeAttribute('src');video.load();video.hidden=true;
 $('#source-placeholder').hidden=false;$('#source-facts').textContent='Your source will appear here';
 try{validateFile(nextFile);}catch(error){
  status.textContent=error.message;drop.classList.remove('has-file','file-picked');
  $('#file-label').textContent='Drop a video or choose a file';
  $('#file-detail').textContent='MP4, MOV, MKV, WebM · up to 256 MB · 10 minutes';
  return;
 }
 file=nextFile;$('#file-label').textContent=file.name;$('#file-detail').textContent=mb(file.size)+' · Ready';
 drop.classList.add('has-file');drop.classList.remove('file-picked');
 requestAnimationFrame(()=>{if(current===selection)drop.classList.add('file-picked');});
 status.textContent='Ready when you are.';setBusy(false);
 sourceURL=URL.createObjectURL(file);video.src=sourceURL;
 video.onloadedmetadata=()=>{
  if(current!==selection)return;
  video.hidden=false;$('#source-placeholder').hidden=true;
  $('#source-facts').textContent=`${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(1)}s · ${mb(nextFile.size)}`;
 };
 video.onerror=()=>{if(current===selection)$('#source-facts').textContent='Preview unavailable · ready to process';};
}
drop.addEventListener('click',()=>input.click());
drop.addEventListener('animationend',event=>{if(event.animationName==='file-picked')drop.classList.remove('file-picked');});
input.addEventListener('change',()=>{take(input.files[0]);input.value='';});
for(const name of ['dragenter','dragover'])drop.addEventListener(name,event=>{event.preventDefault();if(!controller)drop.classList.add('is-over');});
for(const name of ['drop','dragleave'])drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('is-over');});
drop.addEventListener('drop',event=>take(event.dataTransfer.files[0]));
$$('[name=method]').forEach(radio=>radio.addEventListener('change',()=>{
 mode=radio.value;activity.dataset.mode=mode;
 $('#format-summary').textContent=mode==='enhanced'?'Enhanced Method':'Max Quality';
 resetFacts();clearResult();status.textContent=file?'Ready when you are.':'Add a video to get started.';
}));
cancel.addEventListener('click',()=>{controller?.abort();status.textContent='Stopping…';cancel.disabled=true;});
start.addEventListener('click',async()=>{
 if(!file||controller)return;
 clearResult();fastCopy=false;controller=new AbortController();setBusy(true);setStage('load');cancel.disabled=false;setProgress(0);
 try{
  const result=await processVideo(file,{mode},{
   signal:controller.signal,onStatus:text=>status.textContent=text,onProgress:setProgress,onStage:setStage,
   onSource:info=>{$('#source-facts').textContent=`${info.width} × ${info.height} · ${info.fps} FPS · ${info.duration.toFixed(1)}s`;},
   onPlan:(plan,analysis)=>{
    fastCopy=!!plan.fast;activity.dataset.fast=String(fastCopy);
    $('#output-resolution').textContent=`${plan.width} × ${plan.height}`;
    $('#output-fps').textContent=Number(plan.fps.toFixed(2))+' FPS';
    $('#analysis-label').textContent=plan.fast?(mode==='enhanced'?'Original quality':'Original stream · patched'):mode==='enhanced'?(plan.noisy?'Noise softened':analysis.kind==='detail'?'Detail balanced':'Clean edges'):'Max bitrate · patched';
   }
  });
  const url=URL.createObjectURL(result.output),previewURL=URL.createObjectURL(result.preview);resultURLs=[url,previewURL];
  const name=file.name.replace(/\.[^.]+$/,'');
  const download=$('#method-download');download.href=url;
  download.download=name+(mode==='enhanced'?'_pillow_enhanced.mp4':'_pillow_max.mp4');
  download.textContent='Download for TikTok ↓';
  const compatible=$('#method-compatible');compatible.href=previewURL;compatible.download=name+'_pillow_compatible.mp4';compatible.hidden=mode!=='enhanced';
  $('#result-preview').src=previewURL;
  $('#result-title').textContent='Ready for TikTok.';
  const mbps=result.info.duration?` · ${(result.output.size*8/result.info.duration/1e6).toFixed(1)} Mbps`:'';
  $('#result-meta').textContent=`${result.plan.width} × ${result.plan.height} · ${Number(result.plan.fps.toFixed(2))} FPS${mode==='max'?mbps:''} · ${mb(result.output.size)}`;
  $('#result-format-note').textContent=mode==='enhanced'?'Use this copy for TikTok. Choose Compatible MP4 for players and other apps.':'Upload it in TikTok Studio on a computer. TikTok changes often — results can vary.';
  $('#method-result').hidden=false;$('#method-result').classList.add('has-result');
 }catch(error){
  status.textContent=error.name==='AbortError'?'Cancelled. Ready to try again.':error.message;setProgress(0);
 }finally{
  controller=null;setBusy(false);
  if(!$('#method-result').hidden)$('#method-step').textContent='03 / READY TO DOWNLOAD';
 }
});
window.addEventListener('beforeunload',()=>{controller?.abort();if(sourceURL)URL.revokeObjectURL(sourceURL);resultURLs.forEach(URL.revokeObjectURL);});
setBusy(false);
