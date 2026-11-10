import {processVideo,validateFile,inspectVideo} from './modules/video-engine.mjs?v=93';
import {enhanceSize} from './modules/video-plan.mjs?v=93';
import './tools-beats.js?v=93';
/* Pillow Tools — Enhancer here; Auto Beats lives in tools-beats.js. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmtMB = b => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB');
    const clock = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  // ---- tabs ----
  function openTab(name) {
    $$('.tool-tab').forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on); t.tabIndex=on?0:-1; });
    $$('.tool-pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    history.replaceState(null, '', '#' + name);
    window.dispatchEvent(new Event('pillow:tab'));
  }
  $$('.tool-tab').forEach(t => t.addEventListener('click', () => openTab(t.dataset.tab)));
  const tabFromHash = () => ['upscaler', 'beats'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'upscaler';
  openTab(tabFromHash());
  window.addEventListener('hashchange', () => openTab(tabFromHash()));

  $('.tool-tabs').addEventListener('keydown',e=>{const tabs=$$('.tool-tab'),i=tabs.indexOf(document.activeElement);if(i<0)return;let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();openTab(tabs[next].dataset.tab);tabs[next].focus();});

  // ---- drop zone ----
  function picker(pane, onFile) {
    const dz = $('.tool-drop', pane), inp = $('input[type=file]', pane), name = $('.tool-fname', pane);
    const take = f => { if (!f || dz.disabled) return; name.textContent = f.name + ' · ' + fmtMB(f.size); dz.classList.add('has-file'); onFile(f); };
    dz.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { take(inp.files[0]); inp.value = ''; });
    ['dragover', 'dragenter'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', ev => take(ev.dataTransfer.files[0]));
  }

  // ================= PILLOW AI ENHANCER =================
  // Output is always H.265. Size is relative to the source (2K / 4K short side); every other setting is picked by Pillow AI.
  (() => {
    const pane=$('[data-pane=upscaler]');if(!pane)return;
    let file=null,src=null,target='2k',busy=false,sourceURL=null,outURL=null,controller=null,probeController=null,selection=0,previewKind='enhanced';
    const go=$('.go',pane),stop=$('.stop',pane),status=$('.tool-status',pane),bar=$('.tool-bar',pane),out=$('.tool-out',pane),drop=$('.tool-drop',pane),input=$('input[type=file]',pane),activity=$('.method-activity',pane);
    const sizes=$$('[data-size]',pane);
    const dims=key=>src?enhanceSize(src,key):null;
    function paint(){
      if(src&&!busy){const avail=sizes.map(b=>b.dataset.size).filter(k=>dims(k).available);if(!avail.includes(target)&&avail.length)target=avail[0];}
      sizes.forEach(button=>{const p=dims(button.dataset.size),off=!!p&&!p.available;button.disabled=busy||!file||off;
        $('small',button).textContent=p?(p.available?`${p.width} × ${p.height}`:'Already there'):'—';
        const on=button.dataset.size===target&&!off;button.classList.toggle('on',on);button.setAttribute('aria-checked',String(on));button.tabIndex=on&&!button.disabled?0:-1;});
      const ok=!src||!!dims(target).available;go.disabled=!file||busy||!ok||!!probeController;drop.disabled=busy;input.disabled=busy;
      stop.hidden=!busy;activity.hidden=!busy;pane.setAttribute('aria-busy',String(busy));
    }
    function stage(name){
      activity.dataset.stage=name;
      const titles={load:'Getting ready',read:'Reading your video',analyze:'Finding the detail',prepare:'Refining your video',package:'Finishing your video',verify:'One final check',done:'Your video is ready'};
      $('.activity-copy strong',activity).textContent=titles[name]||'Preparing your video';
      const current=['load','read','analyze'].includes(name)?0:name==='prepare'?1:2;
      $$('[data-activity-step]',activity).forEach(step=>{const i=+step.dataset.activityStep;step.classList.toggle('is-current',i===current);step.classList.toggle('is-complete',i<current||name==='done');});
    }
    $$('[role=radiogroup]',pane).forEach(group=>group.addEventListener('keydown',event=>{
      const buttons=$$('button:not(:disabled)',group),current=buttons.indexOf(document.activeElement);if(current<0)return;
      let next;if(['ArrowRight','ArrowDown'].includes(event.key))next=(current+1)%buttons.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(current+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;
      event.preventDefault();buttons[next].focus();buttons[next].click();
    }));
    function clearOutput(){const v=$('video',out);v.onloadedmetadata=null;v.onerror=null;$('.render-info',pane).textContent='';v.pause();v.removeAttribute('src');v.load();out.hidden=true;if(outURL)URL.revokeObjectURL(outURL);outURL=null;$('.preview-note',out).hidden=true;}
    sizes.forEach(button=>button.addEventListener('click',()=>{target=button.dataset.size;paint();}));
    const describe=info=>`${info.width} × ${info.height} · ${Number(info.fps.toFixed(2))} FPS · ${clock(info.duration)}`;
    const tuned=plan=>{const t=plan.tune;if(!t)return '';const bits=[];if(t.denoise>.9)bits.push('noise cleaned');else if(t.denoise>.5)bits.push('light clean-up');if(t.sharp>.2)bits.push('detail restored');else bits.push('natural detail');return bits.join(' · ');};
    picker(pane,async next=>{
      if(busy)return;const current=++selection;probeController?.abort();probeController=new AbortController();clearOutput();file=null;src=null;target='2k';bar.value=0;
      if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=null;
      try{validateFile(next);}catch(error){status.textContent=error.message;$('.src-info',pane).textContent='';paint();return;}
      file=next;sourceURL=URL.createObjectURL(next);status.textContent='Reading your video…';paint();
      try{
        const info=await inspectVideo(next,{signal:probeController.signal});if(current!==selection)return;
        if(info.duration>600||info.hdr){file=null;throw new Error(info.hdr?'Choose an SDR / Rec.709 video.':'Choose a clip up to 10 minutes.');}
        src=info;$('.src-info',pane).textContent=describe(info);
        status.textContent=['2k','4k'].some(k=>enhanceSize(info,k).available)?'Ready.':'This video is already 4K.';
      }catch(error){if(current!==selection||error.name==='AbortError')return;if(/HDR|SDR|10 minutes/.test(error.message)){status.textContent=error.message;file=null;}else status.textContent='Ready. Pillow AI will check this source.';}
      finally{if(current===selection){probeController=null;paint();}}
    });
    stop.addEventListener('click',()=>{controller?.abort();stop.disabled=true;status.textContent='Stopping…';});
    go.addEventListener('click',async()=>{
      if(!file||busy)return;busy=true;controller=new AbortController();clearOutput();bar.value=0;stage('load');stop.disabled=false;paint();
      try{
        const result=await processVideo(file,{mode:'enhance',target},{signal:controller.signal,onStatus:text=>status.textContent=text,onStage:stage,onProgress:value=>bar.value=value,
          onSource:info=>{src={...src,...info};$('.src-info',pane).textContent=describe(info);},
          onPlan:plan=>{$('.render-info',pane).textContent=plan.fallback||[plan.codec==='hevc'?'H.265':'H.264',tuned(plan)].filter(Boolean).join(' · ');}});
        const plan=result.plan,hevc=plan.codec==='hevc';
        outURL=URL.createObjectURL(result.output);previewKind='enhanced';const v=$('video',out);v.hidden=false;v.src=outURL;
        v.onerror=()=>{v.hidden=true;$('.preview-note',out).textContent='Ready to download. This browser can’t preview H.265.';$('.preview-note',out).hidden=false;};
        const link=$('a[download]',out);link.href=outURL;link.download=file.name.replace(/\.[^.]+$/,'')+`_pillow_${target}_${hevc?'h265':'h264'}.mp4`;
        $('.meta',out).textContent=`${plan.width} × ${plan.height} · ${hevc?'H.265':'H.264'} · ${fmtMB(result.output.size)}`;
        $('.render-info',pane).textContent=plan.fallback||'';
        $$('[data-preview]',out).forEach(b=>{b.classList.toggle('on',b.dataset.preview==='enhanced');b.setAttribute('aria-pressed',String(b.dataset.preview==='enhanced'));});out.hidden=false;
      }catch(error){status.textContent=error.name==='AbortError'?'Stopped. Ready to try again.':error.message;bar.value=0;}
      finally{busy=false;controller=null;paint();}
    });
    $$('[data-preview]',out).forEach(button=>button.addEventListener('click',()=>{
      if(previewKind===button.dataset.preview)return;previewKind=button.dataset.preview;const v=$('video',out),time=v.currentTime||0,playing=!v.paused;v.pause();v.hidden=false;$('.preview-note',out).hidden=true;
      v.src=previewKind==='original'?sourceURL:outURL;v.onloadedmetadata=()=>{v.currentTime=Math.min(time,Math.max(0,v.duration-.02));if(playing)v.play().catch(()=>{});};
      $$('[data-preview]',out).forEach(b=>{b.classList.toggle('on',b===button);b.setAttribute('aria-pressed',String(b===button));});
    }));
    window.addEventListener('beforeunload',()=>{controller?.abort();probeController?.abort();if(sourceURL)URL.revokeObjectURL(sourceURL);if(outURL)URL.revokeObjectURL(outURL);});paint();
  })();

})();
