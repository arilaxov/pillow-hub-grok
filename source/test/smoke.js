'use strict';
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const assert=require('node:assert/strict');
const {createMock}=require('./mock-telegram');
const TOKEN='123456:TEST_TOKEN',TG_PORT=18081,WEB_PORT=18765,BASE=`http://127.0.0.1:${WEB_PORT}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<75;i++){const result=await fn();if(result)return result;await pause(80);}throw new Error('Timed out');}
async function req(p,options={}){
 const response=await fetch(BASE+p,{...options,headers:{'content-type':'application/json',...options.headers},body:options.body?JSON.stringify(options.body):undefined,redirect:'manual'});
 const json=response.headers.get('content-type')?.includes('json');
 return{status:response.status,headers:response.headers,data:json?await response.json():null,buf:json?null:Buffer.from(await response.arrayBuffer())};
}
function initData(user,{age=0,tamper=false}={}){
 const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify(user)});
 const str=[...params].map(([k,v])=>`${k}=${v}`).sort().join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(TOKEN).digest();
 params.set('hash',crypto.createHmac('sha256',secret).update(str).digest('hex'));
 if(tamper)params.set('user',JSON.stringify({...user,id:user.id+1}));return params.toString();
}
const message=(from,text)=>({message:{message_id:1,chat:{id:from.id,type:'private'},from,text}});
(async()=>{
 const mock=await createMock(TG_PORT),data=fs.mkdtempSync(path.join(os.tmpdir(),'pillow-test-'));
 const server=spawn(process.execPath,[path.join(__dirname,'../server.js')],{env:{...process.env,BOT_TOKEN:TOKEN,TELEGRAM_API:`http://127.0.0.1:${TG_PORT}`,HOST:'127.0.0.1',PORT:String(WEB_PORT),PUBLIC_URL:'https://example.com',DATA_DIR:data,FEEDBACK_CHAT_ID:'-100777',PANEL_VERSION:'1.0.0'},stdio:['ignore','pipe','pipe']});
 let logs='',passed=0;server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
 const ok=name=>{passed++;console.log('  ✓ '+name);};
 try{
  await until(async()=>{try{return(await req('/api/config')).status===200;}catch{return false;}});
  const config=(await req('/api/config')).data;
  assert.equal(config.downloadsOpen,true);assert.equal(config.bot,'pillow_hub_bot');assert.equal(config.channels,undefined);
  const staticConfig=(await req('/api/config.json')).data;assert.equal(staticConfig.downloadsOpen,true);assert.equal(staticConfig.bot,'pillow_hub_bot');ok('downloads open without account or channel membership');
  for(const p of ['/','/extension.html','/tools.html','/method.html','/site.css','/site.js','/tools.js','/method.js','/modules/video-engine.mjs','/modules/content-analysis.mjs','/assets/content-model.json','/vendor/ffmpeg/index.js','/vendor/ffmpeg/worker.js','/ai.html','/ai.js','/modules/ai-engine.mjs','/modules/ai-worker.mjs','/modules/ai-intent.mjs','/modules/ai-knowledge.mjs','/modules/ai-actions.mjs','/modules/ai-prompt.mjs','/assets/pillow-ai-knowledge.json','/vendor/web-llm/web-llm.js'])assert.equal((await req(p)).status,200,p);
  assert.match((await req('/modules/video-engine.mjs')).headers.get('content-type'),/javascript/);ok('all pages, video engine and local model are served');
  for(const p of ['/server.js','/.env','/data/db.json','/../server.js','/%2e%2e/.env','/..%2fserver.js','/gate.js','/gate.css','/studio.html','/library.html','/downloads/unknown.zip'])assert.ok([403,404].includes((await req(p)).status),p);
  ok('private files, removed sections and unknown downloads are not served');
  {const r=await req('/ai');assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/ai.html');}for(const url of ['/method','/tiktok-method.html','/upload-method']){const r=await req(url);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/method.html');}ok('older Method links resolve to the working page');
  const initial=(await req('/api/config')).data.stats;
  const download=await req('/downloads/Pillow-v192.zip');assert.equal(download.status,200);assert.ok(download.buf.length>7e6);assert.equal(download.buf.subarray(0,2).toString(),'PK');
  const head=await req('/downloads/Pillow-v192.zip',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await req('/api/config')).data.stats.downloads,initial.downloads+1);ok('free ZIP download works; HEAD does not increment downloads');
  const ticket=(await req('/api/download-ticket',{method:'POST',body:{file:'Pillow-v192.zip'}})).data;
  assert.equal((await req(ticket.url)).status,200);assert.equal((await req('/dl/invalid/Pillow-v192.zip')).status,403);
  assert.equal((await req('/api/download-ticket',{method:'POST',body:{file:'../server.js'}})).status,404);ok('download tickets only allow known extension files');
  const wasm=await fetch(BASE+'/vendor/core/ffmpeg-core.wasm',{headers:{'accept-encoding':'gzip'}});
  assert.equal(wasm.headers.get('content-type'),'application/wasm');assert.equal(wasm.headers.get('content-encoding'),'gzip');assert.match(wasm.headers.get('cache-control'),/max-age=604800/);
  const bytes=Buffer.from(await wasm.arrayBuffer());assert.ok(bytes.length>30e6);assert.equal(bytes.subarray(0,4).toString('hex'),'0061736d');ok('same-origin WASM is complete, compressed and cached');
  const version=await req('/version');assert.equal(version.data.version,'1.0.0');assert.equal(version.headers.get('access-control-allow-origin'),'*');ok('extension update API remains available');
  const pre=await fetch(BASE+'/feedback',{method:'OPTIONS'});assert.equal(pre.status,204);
  assert.equal((await req('/feedback',{method:'POST',body:{type:'review',text:'test',rating:0}})).status,400);
  assert.equal((await req('/feedback',{method:'POST',body:{type:'review',text:'A <panel>',rating:5,name:'Creator'}})).status,200);
  await until(()=>mock.state.sent.find(m=>m.chat_id==='-100777'&&m.text.includes('&lt;panel&gt;')));ok('feedback validation and HTML escaping work against a local mock');
  const alice={id:111,first_name:'Alice',username:'alice',language_code:'ru'};
  const start=(await req('/api/auth/start',{method:'POST',body:{}})).data;
  assert.equal((await req('/api/auth/status?token='+start.token)).data.status,'pending');
  mock.state.push(message(alice,'/start '+start.token));
  const login=await until(async()=>{const r=(await req('/api/auth/status?token='+start.token)).data;return r.status==='verified'?r:null;});
  assert.equal(login.user.id,111);assert.ok(login.session);assert.equal((await req('/api/auth/status?token='+start.token)).data.status,'expired');
  const auth={authorization:'Bearer '+login.session};assert.equal((await req('/api/me',{headers:auth})).data.ok,true);
  await req('/api/logout',{method:'POST',headers:auth});assert.equal((await req('/api/me',{headers:auth})).data.ok,false);ok('optional login is single-use and logout invalidates the session');
  const bob={id:222,first_name:'Bob',language_code:'en'};
  assert.equal((await req('/api/auth/webapp',{method:'POST',body:{initData:initData(bob)}})).data.ok,true);
  for(const options of [{tamper:true},{age:90000},{age:-3600}])assert.equal((await req('/api/auth/webapp',{method:'POST',body:{initData:initData(bob,options)}})).status,401);
  assert.equal((await req('/api/auth/webapp',{method:'POST',body:{initData:'hash=abc'}})).status,401);ok('Mini App accepts signed users and rejects forged, old or future data');
  mock.state.push(message(bob,'/extension'));await until(()=>mock.state.docs.length===1);assert.ok(mock.state.docs[0].bytes>7e6);
  mock.state.push(message(bob,'/extension'));await until(()=>mock.state.docs.length===2);assert.equal(mock.state.docs[1].byId,'FILE_ID_1');ok('bot sends free extension directly and reuses Telegram file_id');
  mock.state.push(message(bob,'/start get'));await until(()=>mock.state.docs.length===3);ok('legacy start=get sends the extension without membership checks');
  for(const command of ['tools','method']){mock.state.push(message(bob,'/'+command));await until(()=>mock.state.sent.find(m=>m.chat_id===222&&m.reply_markup?.inline_keyboard.flat().some(b=>b.url?.endsWith('/'+command+'.html'))));}
  ok('bot links to Tools and Method');
  const evil={id:333,first_name:'<b>x</b>&',language_code:'en'};mock.state.push(message(evil,'/start'));await until(()=>mock.state.sent.find(m=>m.chat_id===333&&m.text.includes('&lt;b&gt;x&lt;/b&gt;&amp;')));ok('bot escapes untrusted names');
  await until(()=>mock.state.menuButton);assert.equal(mock.state.menuButton.type,'web_app');ok('Telegram Mini App menu remains configured');
  console.log(`OK — ${passed} integration checks`);
 }catch(e){console.error(e);console.error(logs);process.exitCode=1;}
 finally{server.kill();mock.close();await pause(300);fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
