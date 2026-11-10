'use strict';
/* Full browser/video integration checks. Optional tools: Playwright, FFmpeg, FFprobe.
   No uploaded user media, external services, real Telegram tokens or production data are used. */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
let chromium;try{({chromium}=require('playwright'));}catch{console.error('Install optional browser-test tools: npm install --no-save playwright && npx playwright install chromium');process.exit(1);}
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pillow-browser-'));
const base='http://127.0.0.1:18766',screenshots=process.env.SCREENSHOT_DIR;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ffmpeg=(args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'pipe'});
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
const audio=(filename)=>{
 const rate=22050,frames=rate*6,b=Buffer.alloc(44+frames*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(26000*Math.sin(2*Math.PI*160*i/rate)*Math.exp(-((i/rate)%.5)*55)),44+i*2);fs.writeFileSync(filename,b);
};
let server,browser,passed=0;
const ok=name=>{passed++;console.log('  ✓ '+name);};
(async()=>{
 const landscape=path.join(temp,'landscape.mp4'),portrait=path.join(temp,'portrait.mp4'),high=path.join(temp,'120fps.mp4'),noise=path.join(temp,'noise.mp4'),rotated=path.join(temp,'rotated.mp4'),hdr=path.join(temp,'hdr.mp4'),beats=path.join(temp,'beats.wav');
 ffmpeg(['-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',landscape]);
 ffmpeg(['-f','lavfi','-i','testsrc2=size=360x640:rate=60','-f','lavfi','-i','sine=frequency=500:sample_rate=48000','-t','0.8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',portrait]);
 ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=120','-t','0.8','-c:v','libx264','-pix_fmt','yuv420p','-an',high]);
 ffmpeg(['-f','lavfi','-i','color=c=gray:size=320x180:rate=30','-vf','noise=alls=70:allf=t+u','-t','0.8','-c:v','libx264','-crf','10',noise]);
 // Set a real MP4 track display matrix; current FFmpeg does not write rotate tags on every build.
 const rotationBytes=fs.readFileSync(landscape);
 function rotateTrack(start,end){for(let offset=start;offset+8<=end;){const size=rotationBytes.readUInt32BE(offset),name=rotationBytes.toString('ascii',offset+4,offset+8);if(size<8||offset+size>end)return false;if(name==='tkhd'){const pos=offset+8+(rotationBytes[offset+8]===1?52:40);[0,65536,0,-65536,0,0,0,0,1073741824].forEach((v,i)=>rotationBytes.writeInt32BE(v,pos+i*4));return true;}if(['moov','trak'].includes(name)&&rotateTrack(offset+8,offset+size))return true;offset+=size;}return false;}
 assert.ok(rotateTrack(0,rotationBytes.length));fs.writeFileSync(rotated,rotationBytes);
 ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','0.8','-c:v','libx264','-color_trc','smpte2084','-colorspace','bt2020nc','-color_primaries','bt2020',hdr]);audio(beats);
 const clean=path.join(temp,'clean1080.mp4'),big=path.join(temp,'qhd.mp4'),qhd=path.join(temp,'qhd-land.mp4');
 ffmpeg(['-f','lavfi','-i','testsrc2=size=1080x1920:rate=30','-f','lavfi','-i','sine=frequency=330:sample_rate=48000','-t','1','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac',clean]);
 ffmpeg(['-f','lavfi','-i','testsrc2=size=1440x2560:rate=30','-f','lavfi','-i','sine=frequency=550:sample_rate=48000','-t','0.8','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',big]);
 ffmpeg(['-f','lavfi','-i','testsrc2=size=2560x1440:rate=30','-t','0.4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',qhd]);
 const {describeMp4}=await import('../public/modules/mp4-patch.mjs');
 const md5=(f,sel)=>execFileSync('ffmpeg',['-v','error','-i',f,'-map',sel,'-c','copy','-f','md5','-'],{encoding:'utf8'}).trim();
 const patched=async file=>{const d=await describeMp4(new Blob([fs.readFileSync(file)]));assert.deepEqual(d.layout,['ftyp','moov','mdat']);assert.equal(d.mvhdVersion,1);assert.equal(d.mvhdDuration,'ffffffffffffffff');assert.equal(d.brand,'isom');return d;};
 const report={};
 server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,BOT_TOKEN:'',HOST:'127.0.0.1',PORT:'18766',PUBLIC_URL:'',DATA_DIR:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
 let serverLogs='';server.stdout.on('data',d=>serverLogs+=d);server.stderr.on('data',d=>serverLogs+=d);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/config')).ok)break;}catch{}if(i===99)throw new Error('Server failed: '+serverLogs);await wait(100);}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:process.env.CI?['--no-sandbox']:[]});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const errors=[],external=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!url.startsWith(base)){external.push(url);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(180000);
 if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});
  for(const name of ['index','method','tools','extension','ai']){
   await page.goto(base+'/'+name+'.html');await page.locator('main').waitFor();
   assert.equal(await page.locator('nav.nav a').count(),5);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflows at '+width);
   assert.equal(await page.locator('[data-theme-toggle]').count(),1);
   const colors=await page.locator('body').evaluate(el=>({text:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
   for(const color of Object.values(colors)){const nums=color.match(/[\d.]+/g).map(Number);assert.ok(Math.max(...nums.slice(0,3))-Math.min(...nums.slice(0,3))<10,color);}
   if(name==='method'){assert.equal(await page.locator('input[type=checkbox]').count(),0);assert.equal(await page.locator('#method-cancel').isVisible(),false);assert.equal(await page.locator('#method-result').isVisible(),false);}
   if(screenshots&&width!==320){await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}.rv{opacity:1!important;transform:none!important}'});await page.locator('.rv').evaluateAll(nodes=>nodes.forEach(n=>n.classList.add('in')));await page.screenshot({path:path.join(screenshots,`${name}-${width}.png`),fullPage:true});}
  }
 }
 ok('all five pages keep monochrome colours and fit desktop, 390px and 320px screens; Method has no consent checkbox');
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/method.html');
 await page.locator('[data-theme-toggle]').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.locator('[data-theme-toggle]').click();ok('theme toggle persists and stays monochrome');
 async function select(file){await page.locator('#method-file').setInputFiles(file);await page.waitForFunction(()=>!document.querySelector('#method-start').disabled);}
 async function finished(){
  await page.waitForFunction(()=>!document.querySelector('#method-cancel').hidden,{},{timeout:10000});
  await page.waitForFunction(()=>document.querySelector('#method-cancel').hidden,{},{timeout:180000});
  assert.equal(await page.locator('#method-result').isVisible(),true,await page.locator('#method-status').textContent());
 }
 async function download(selector,name){const pending=page.waitForEvent('download');await page.locator(selector).click();const result=await pending;const file=path.join(temp,name);await result.saveAs(file);return file;}
 function verify(file,w,h,fps,audioExpected,container,codec='h264'){
  const info=probe(file),v=info.streams.find(s=>s.codec_type==='video');assert.equal(v.width,w);assert.equal(v.height,h);assert.equal(v.codec_name,codec);
  const [num,den]=v.r_frame_rate.split('/').map(Number);assert.ok(Math.abs(num/den-fps)<.1);assert.equal(info.streams.some(s=>s.codec_type==='audio'),audioExpected);assert.match(info.format.format_name,container);
  execFileSync('ffmpeg',['-v','error','-xerror','-i',file,'-f','null','-'],{stdio:'pipe'});return info;
 }
 await select(landscape);await page.locator('#method-start').click();await page.locator('#method-cancel').click();
 await page.waitForFunction(()=>document.querySelector('#method-cancel').hidden);assert.match(await page.locator('#method-status').textContent(),/Cancelled/);assert.equal(await page.locator('#method-start').isEnabled(),true);ok('cancel during engine startup unlocks controls');
 await page.locator('#method-start').click();await page.waitForFunction(()=>document.querySelector('#method-activity').dataset.stage==='prepare');
 await page.locator('#method-cancel').click();await page.waitForFunction(()=>document.querySelector('#method-cancel').hidden);assert.match(await page.locator('#method-status').textContent(),/Cancelled/);ok('cancel during encoding stops the worker and permits retry');
 await page.locator('#method-start').click();await finished();
 const enhanced=await download('#method-download','enhanced.mp4'),compatible=await download('#method-compatible','compatible.mp4');
 verify(enhanced,1920,1080,30,true,/mpegts/);verify(compatible,1920,1080,30,true,/mp4/);
 await page.locator('#result-preview').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('#result-preview').currentTime>.1);ok('Enhanced produces decodable Full HD TS and MP4 downloads with audio and a playable preview');
 if(screenshots)await page.screenshot({path:path.join(screenshots,'method-result.png'),fullPage:true});
 await select(portrait);assert.equal(await page.locator('#method-result').isVisible(),false);await page.locator('#method-start').click();await finished();verify(await download('#method-download','portrait-output.mp4'),1080,1920,60,true,/mpegts/);ok('Enhanced preserves portrait orientation, 60 FPS and audio');
 await page.locator('[name=method][value=max]').check();assert.equal(await page.locator('#format-summary').textContent(),'Max Quality');
 await select(clean);let t0=Date.now();await page.locator('#method-start').click();await finished();
 const maxClean=await download('#method-download','max-clean.mp4');verify(maxClean,1080,1920,30,true,/mp4/);const dClean=await patched(maxClean);
 assert.equal(md5(maxClean,'0:v:0'),md5(clean,'0:v:0'),'clean 1080p H.264 is kept bit-for-bit');assert.equal(md5(maxClean,'0:a:0'),md5(clean,'0:a:0'));
 assert.match(await page.locator('#analysis-label').textContent(),/Original stream/);assert.equal(await page.locator('#method-compatible').isVisible(),false);assert.match(await page.locator('#result-meta').textContent(),/Mbps/);
 report.clean={ms:Date.now()-t0,size:fs.statSync(maxClean).size,bitrate:Math.round(+probe(maxClean).format.bit_rate/1e3)+' kb/s',tracks:dClean.tracks.map(t=>t.handler+':'+t.codec).join(' '),comment:dClean.comment.join(' / ')};
 if(screenshots)await page.screenshot({path:path.join(screenshots,'method-max-result.png'),fullPage:true});
 await select(big);t0=Date.now();await page.locator('#method-start').click();await finished();
 const maxBig=await download('#method-download','max-big.mp4');const bigInfo=verify(maxBig,1080,1920,30,true,/mp4/);await patched(maxBig);
 const bigV=bigInfo.streams.find(x=>x.codec_type==='video'),bigA=bigInfo.streams.find(x=>x.codec_type==='audio');
 assert.equal(bigV.profile,'High');assert.equal(bigV.pix_fmt,'yuv420p');assert.equal(bigA.codec_name,'aac');assert.ok(+bigV.bit_rate>4e6,'high video bitrate '+bigV.bit_rate);
 report.downscaled={ms:Date.now()-t0,size:fs.statSync(maxBig).size,video:`${bigV.codec_name} ${bigV.profile} ${bigV.width}x${bigV.height} ${bigV.r_frame_rate} ${Math.round(bigV.bit_rate/1e3)} kb/s`,audio:`${bigA.codec_name} ${bigA.sample_rate} Hz ${Math.round(bigA.bit_rate/1e3)} kb/s`};
 await select(high);await page.locator('#method-start').click();await finished();const maxHigh=await download('#method-download','max-120.mp4');verify(maxHigh,320,180,60,false,/mp4/);await patched(maxHigh);
 ok('Max Quality: clean 1080p kept bit-for-bit, larger sources re-encoded to a high-bitrate 1080p master, 120 FPS → 60, container patched (ftyp→moov→mdat, mvhd v1 duration64)');
 await page.locator('[name=method][value=enhanced]').check();await select(noise);await page.locator('#method-start').click();await finished();assert.match(await page.locator('#analysis-label').textContent(),/Noise softened/);verify(await download('#method-download','noise-output.mp4'),1920,1080,30,false,/mpegts/);ok('Pillow AI selects and executes the denoising path on a noisy clip');
 await page.locator('[name=method][value=max]').check();await select(rotated);await page.locator('#method-start').click();await finished();verify(await download('#method-download','rotated-output.mp4'),360,640,30,true,/mp4/);ok('rotation metadata is respected in portrait output');
 await select(hdr);await page.locator('#method-start').click();await page.waitForFunction(()=>document.querySelector('#method-cancel').hidden);assert.match(await page.locator('#method-status').textContent(),/HDR/);assert.equal(await page.locator('#method-result').isVisible(),false);ok('unsupported HDR does not produce a falsely labelled SDR file');
 await page.locator('#method-file').setInputFiles({name:'broken.mp4',mimeType:'video/mp4',buffer:Buffer.from('not a video')});await page.locator('#method-start').click();await page.waitForFunction(()=>document.querySelector('#method-cancel').hidden);assert.match(await page.locator('#method-status').textContent(),/readable video/);assert.equal(await page.locator('#method-start').isEnabled(),true);ok('corrupt input reports an error and does not lock the next run');
 await page.locator('#method-file').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('hello')});assert.equal(await page.locator('#method-start').isEnabled(),false);ok('non-video input is rejected');
 // ---- Enhancer: 2K / 4K, always H.265, auto-tuned ----
 await page.goto(base+'/tools.html');const up=page.locator('[data-pane=upscaler]');
 assert.equal(await up.locator('[data-codec],[data-look],[data-size=original],[data-size="2x"]').count(),0,'no codec, finish or 2x controls');
 await up.locator('input[type=file]').setInputFiles(qhd);await page.waitForFunction(()=>document.querySelector('[data-pane=upscaler] .src-info').textContent.includes('2560'));
 assert.equal(await up.locator('[data-size="2k"]').isDisabled(),true,'2K off for a 1440p source');assert.equal(await up.locator('[data-size="4k"]').getAttribute('aria-checked'),'true');assert.match(await up.locator('[data-size="4k"] small').textContent(),/3840 × 2160/);
 await up.locator('input[type=file]').setInputFiles(landscape);await page.waitForFunction(()=>document.querySelector('[data-pane=upscaler] .src-info').textContent.includes('640')&&!document.querySelector('[data-pane=upscaler] .go').disabled);
 assert.match(await up.locator('[data-size="2k"] small').textContent(),/2560 × 1440/);assert.match(await up.locator('[data-size="4k"] small').textContent(),/3840 × 2160/);
 t0=Date.now();await up.locator('.go').click();
 await page.waitForFunction(()=>!document.querySelector('[data-pane=upscaler] .stop').hidden);await page.waitForFunction(()=>document.querySelector('[data-pane=upscaler] .stop').hidden,{},{timeout:600000});assert.equal(await up.locator('.tool-out').isVisible(),true,await up.locator('.tool-status').textContent());
 const up2k=await download('[data-pane=upscaler] .tool-out a','enhanced-2k.mp4');const hevcHere=/H\.265/.test(await up.locator('.meta').textContent());if(!hevcHere)assert.match(await up.locator('.render-info').textContent(),/No H\.265 encoder on this device/,'H.264 fallback is announced');const encCodec=hevcHere?'hevc':'h264';report.enhancerCodec=hevcHere?'H.265 (device encoder)':'H.264 fallback (no HEVC encoder in this browser)';const upInfo=verify(up2k,2560,1440,30,true,/mp4/,encCodec);assert.match(path.basename(up2k),/./);
 assert.match(await up.locator('.meta').textContent(),/2560 × 1440 · H\.26[45]/);report.enhancer2k={ms:Date.now()-t0,size:fs.statSync(up2k).size,video:(v=>`${v.codec_name} ${v.codec_tag_string} ${v.width}x${v.height} ${Math.round(v.bit_rate/1e3)} kb/s`)(upInfo.streams.find(x=>x.codec_type==='video'))};
 if(screenshots){await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:path.join(screenshots,'tools-enhancer-1440.png'),fullPage:true});}
 await up.locator('input[type=file]').setInputFiles(portrait);await page.waitForFunction(()=>!document.querySelector('[data-pane=upscaler] [data-size="4k"]').disabled&&!document.querySelector('[data-pane=upscaler] .go').disabled);await up.locator('[data-size="4k"]').click();t0=Date.now();await up.locator('.go').click();
 await page.waitForFunction(()=>!document.querySelector('[data-pane=upscaler] .stop').hidden);await page.waitForFunction(()=>document.querySelector('[data-pane=upscaler] .stop').hidden,{},{timeout:600000});assert.equal(await up.locator('.tool-out').isVisible(),true,await up.locator('.tool-status').textContent());
 const up4k=await download('[data-pane=upscaler] .tool-out a','enhanced-4k.mp4');const up4Info=verify(up4k,2160,3840,60,true,/mp4/,encCodec);
 report.enhancer4k={ms:Date.now()-t0,size:fs.statSync(up4k).size,video:(v=>`${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate} ${Math.round(v.bit_rate/1e3)} kb/s`)(up4Info.streams.find(x=>x.codec_type==='video'))};
 ok('Enhancer: 2K and 4K relative to the source (2K off for 1440p), H.265 where the device encodes it, else an announced H.264 fallback, with audio, portrait 60 FPS kept');
 await page.locator('#tab-upscaler').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#tab-beats').getAttribute('aria-selected'),'true');
 // ---- Auto Beats ----
 const {writeTrack}=await import('./fixtures.mjs'),{createAE,es3Problems}=await import('./ae-mock.mjs');
 const track=path.join(temp,'structured.wav');writeTrack(track);
 const bt=page.locator('[data-pane=beats]');
 assert.equal(await bt.locator('[data-mode],[name=bt-sens],[data-click],[data-layers],.ae-chip,.recent').count(),0,'no modes, sensitivity, editing, layer options or history');
 await bt.locator('input[type=file]').setInputFiles(track);await page.waitForFunction(()=>!document.querySelector('[data-pane=beats] .beat-res').hidden);
 assert.ok(Math.abs(Number(await bt.locator('.beat-bpm').textContent())-120)<1.5);const count=Number(await bt.locator('.beat-count').textContent());assert.ok(count>80&&count<140,'beats '+count);
 const json=JSON.parse(fs.readFileSync(await download('[data-pane=beats] .dl-json','beats.json'),'utf8'));assert.equal(json.schema,'pillow.beats.v1');assert.equal(json.markers.length,count);assert.ok(json.markers.every(m=>m.type==='hit'));
 const jsx=fs.readFileSync(await download('[data-pane=beats] .dl-jsx','beats.jsx'),'utf8');new Function(jsx);assert.deepEqual(es3Problems(jsx),[]);
 const ae=createAE({selected:{name:'Song'}});ae.run(jsx);assert.equal(ae.comp.selectedLayers[0].marker.keys.length,json.markers.filter(m=>m.time<=ae.comp.duration).length);assert.equal(ae.comp.added.length,0);
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await bt.locator('.dl-copy').click();await page.waitForFunction(()=>document.querySelector('[data-pane=beats] .dl-copy').textContent.includes('Copied'));
 const copied=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(copied.split(', ').length,count);
 if(screenshots){await page.screenshot({path:path.join(screenshots,'tools-beats-1440.png'),fullPage:true});}
 await bt.locator('input[type=file]').setInputFiles(beats);await page.waitForFunction(()=>!document.querySelector('[data-pane=beats] .beat-res').hidden&&document.querySelector('[data-pane=beats] .tool-status').textContent==='');
 assert.ok(Number(await bt.locator('.beat-count').textContent())>=6);
 ok('Auto Beats: drop a track → ~120 BPM beat markers on the grid, .jsx runs in an AE model, JSON for the panel, copy seconds');
 if(screenshots){
  const still='*,*::before,*::after{transition:none!important;animation:none!important}.rv{opacity:1!important;transform:none!important}';
  await page.setViewportSize({width:390,height:900});
  await page.goto(base+'/tools.html#beats');await page.locator('[data-pane=beats] input[type=file]').setInputFiles(track);await page.waitForFunction(()=>!document.querySelector('[data-pane=beats] .beat-res').hidden);await page.addStyleTag({content:still});await page.screenshot({path:path.join(screenshots,'tools-beats-390.png'),fullPage:true});
  await page.goto(base+'/tools.html#upscaler');await page.locator('[data-pane=upscaler] input[type=file]').setInputFiles(landscape);await page.waitForFunction(()=>!document.querySelector('[data-pane=upscaler] .go').disabled);await page.addStyleTag({content:still});await page.screenshot({path:path.join(screenshots,'tools-enhancer-390.png'),fullPage:true});
  await page.goto(base+'/method.html');await page.locator('[name=method][value=max]').check();await page.addStyleTag({content:still});await page.locator('.rv').evaluateAll(n=>n.forEach(x=>x.classList.add('in')));await page.screenshot({path:path.join(screenshots,'method-max-390.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/method.html');await page.locator('[name=method][value=max]').check();await page.addStyleTag({content:still});await page.locator('.rv').evaluateAll(n=>n.forEach(x=>x.classList.add('in')));await page.screenshot({path:path.join(screenshots,'method-max-1440.png'),fullPage:true});
 }
 // ---- Pillow AI: no-WebGPU guide mode (headless has no GPU), then a mocked engine for the full action flow ----
 {
  const webllm=[];const onReq=r=>{if(/web-llm|ai-worker/.test(r.url()))webllm.push(r.url());};page.on('request',onReq);
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/ai.html');await page.locator('#ai[data-ready=true]').waitFor();
  const gpuHere=await page.evaluate(async()=>!!(navigator.gpu&&await navigator.gpu.requestAdapter().catch(()=>null)));
  if(!gpuHere){assert.equal(await page.locator('#ai-notice').isVisible(),true);assert.match(await page.locator('#ai-notice').textContent(),/WebGPU/);assert.equal(await page.locator('#ai-load').isVisible(),false);}
  assert.ok(await page.locator('.ai-chip').count()>=4,'suggestion chips');
  await page.locator('#ai-text').fill('Кто тебя сделал?');await page.locator('#ai-text').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.ai-bot').length>0);assert.match(await page.locator('.ai-bot').last().textContent(),/ARILAX/);
  await page.locator('#ai-text').fill('how do I install the extension');await page.locator('#ai-send').click();
  await page.waitForFunction(()=>document.querySelectorAll('.ai-bot').length>1);assert.match(await page.locator('.ai-bot').last().textContent(),/CEP|extensions/);
  assert.deepEqual(webllm,[],'WebLLM is not loaded until asked');page.off('request',onReq);
  ok('Pillow AI page: no-WebGPU message, guide answers from the local knowledge base, WebLLM not fetched until asked');
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await ctx.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&!url.startsWith(base)){external.push(url);return route.abort();}return route.continue();});
  await ctx.addInitScript(()=>{window.__aiCalls=[];const chunks=s=>(async function*(){for(const c of s.match(/[\s\S]{1,5}/g))yield{choices:[{delta:{content:c}}]};})();
   window.__PILLOW_AI_MOCK__={cached:false,async create(id,onProgress){window.__aiModel=id;for(const p of [0,.25,.6,1]){onProgress({progress:p,text:`Fetching param cache[1/4]: ${Math.round(p*450)}MB fetched. ${Math.round(p*100)}% completed`});await new Promise(r=>setTimeout(r,120));}
    return{interruptGenerate(){},unload(){},chat:{completions:{async create(req){window.__aiCalls.push(req);const sys=req.messages[0].content;
     if(sys.startsWith('Classify'))return chunks('{"action":"max"}');return chunks('<think>x</think>Меня сделали **ARILAX** и **KABAN**. Каналы: @arilaxscp, @kaban_shashluk, @pillowex.');}}}};}};});
  const ai=await ctx.newPage();ai.on('pageerror',e=>errors.push(e.message));ai.setDefaultTimeout(180000);
  await ai.goto(base+'/ai.html');await ai.locator('#ai[data-ready=true]').waitFor();
  assert.match(await ai.locator('#ai-state').textContent(),/2B · 1\.1 GB/);
  await ai.locator('[data-model=lite]').click();assert.match(await ai.locator('#ai-state').textContent(),/0\.8B/);await ai.locator('[data-model=main]').click();
  await ai.locator('#ai-load').click();await ai.waitForFunction(()=>/ready/.test(document.querySelector('#ai-state').textContent));
  assert.equal(await ai.evaluate(()=>window.__aiModel),'Qwen3.5-2B-q4f16_1-MLC');assert.equal(await ai.locator('#ai-load').isVisible(),false);
  await ai.locator('#ai-text').fill('Кто тебя сделал?');await ai.locator('#ai-text').press('Enter');
  await ai.waitForFunction(()=>{const b=[...document.querySelectorAll('.ai-bot .ai-bubble')].pop();return b&&/@pillowex/.test(b.textContent);});
  const said=await ai.locator('.ai-bot').last().textContent();assert.ok(!/think/.test(said),'reasoning stripped');assert.equal(await ai.locator('.ai-bot').last().locator('a[href="https://t.me/arilaxscp"]').count(),1);
  const call=await ai.evaluate(()=>window.__aiCalls.at(-1));assert.match(call.messages[0].content,/ARILAX and KABAN/);assert.match(call.messages[0].content,/Answer in Russian/);assert.match(call.messages[0].content,/Facts:[\s\S]*Who Pillow AI is/);assert.equal(call.stream,true);assert.equal(call.extra_body.enable_thinking,false);
  ok('mocked WebLLM: model choice, load progress, streamed answer with identity prompt + retrieved facts, reasoning stripped');
  await ai.locator('#ai-file-input').setInputFiles(track);await ai.locator('#ai-text').fill('find beats and give me jsx');await ai.locator('#ai-text').press('Enter');
  await ai.locator('.ai-card').first().waitFor();assert.match(await ai.locator('.ai-card').first().textContent(),/Auto Beats[\s\S]*beats · 1\d\d BPM/);
  const jsxPending=ai.waitForEvent('download');await ai.locator('.ai-card').first().locator('a[download$=".jsx"]').click();const jsxFile=path.join(temp,'ai-beats.jsx');await (await jsxPending).saveAs(jsxFile);assert.match(fs.readFileSync(jsxFile,'utf8'),/pillow\.beats\.v1/);
  if(screenshots){await ai.addStyleTag({content:'.rv{opacity:1!important;transform:none!important}'});}
  await ai.locator('#ai-file-input').setInputFiles(clean);await ai.locator('#ai-text').fill('сделай как надо');await ai.locator('#ai-text').press('Enter');
  await ai.waitForFunction(()=>document.querySelectorAll('.ai-card').length===2);const card=ai.locator('.ai-card').nth(1);
  assert.match(await card.textContent(),/Max Quality[\s\S]*1080 × 1920/);assert.ok((await ai.evaluate(()=>window.__aiCalls.some(c=>c.messages[0].content.startsWith('Classify')))),'model broke the tie');
  const maxPending=ai.waitForEvent('download');await card.locator('a.button-primary').click();const aiMax=path.join(temp,'ai-max.mp4');await (await maxPending).saveAs(aiMax);
  const d=await patched(aiMax);assert.equal(d.mvhdDuration,'ffffffffffffffff');assert.deepEqual(d.layout,['ftyp','moov','mdat']);assert.equal(md5(aiMax,'0:v:0'),md5(clean,'0:v:0'));
  report.aiMax={size:fs.statSync(aiMax).size,layout:d.layout.join('→'),mvhd:'v'+d.mvhdVersion+' '+d.mvhdDuration};
  if(screenshots){await ai.locator('.ai-card').nth(1).scrollIntoViewIfNeeded();await ai.waitForTimeout(700);await ai.screenshot({path:path.join(screenshots,'ai-action-1440.png')});}
  await ai.setViewportSize({width:390,height:844});await ai.waitForTimeout(300);assert.ok(await ai.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'AI chat overflows at 390');
  if(screenshots){await ai.waitForTimeout(500);await ai.screenshot({path:path.join(screenshots,'ai-action-390.png')});}
  await ctx.close();
  ok('Pillow AI actions: dropped audio → Auto Beats card with .jsx; dropped video + vague ask → model picks Max Quality → patched MP4 download (bit-identical stream)');
  if(screenshots){for(const [w,h] of [[1440,1000],[390,844]]){await page.setViewportSize({width:w,height:h});await page.goto(base+'/ai.html');await page.locator('#ai[data-ready=true]').waitFor();await page.addStyleTag({content:'.rv{opacity:1!important;transform:none!important}'});await page.waitForTimeout(700);await page.screenshot({path:path.join(screenshots,`ai-${w}.png`)});}await page.setViewportSize({width:1440,height:1000});}
 }
 await page.goto(base+'/extension.html');const pending=page.waitForEvent('download');await page.locator('a[href^="downloads/Pillow-v192.zip"]').click();assert.match((await pending).suggestedFilename(),/Pillow-v192.zip/);assert.equal(await page.locator('[role=dialog]').count(),0);ok('extension download starts directly without a subscription dialog');
 assert.deepEqual(errors,[],'browser errors');assert.deepEqual(external,[],'unexpected external calls');ok('no uncaught browser errors or external media requests');
 console.log('Output report: '+JSON.stringify(report,null,1));
 console.log(`OK — ${passed} browser/media checks`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server){server.kill();await wait(300);}if(process.env.KEEP_TEST_OUTPUT)console.log('Test files:',temp);else fs.rmSync(temp,{recursive:true,force:true});});
