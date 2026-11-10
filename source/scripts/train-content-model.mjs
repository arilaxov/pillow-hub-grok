/* Reproducible original tiny neural classifier, synthetic training data, no dependencies.
   Three classes describe a frame's encoding needs; this is not a super-resolution model. */
import {features,classify} from '../public/modules/content-analysis.mjs';
import {writeFileSync} from 'node:fs';
let state=1729;const rand=()=>{state=(1664525*state+1013904223)>>>0;return state/2**32;};
const W=48,H=48,labels=['smooth','detail','noise'];
function example(kind){
 const g=new Float32Array(W*H),phase=rand()*6, freq=1+rand()*8,base=.1+rand()*.5;
 const contrast=.08+rand()*.3;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  let v=base+contrast*(.3*Math.sin(x/W*freq+phase)+.3*Math.cos(y/H*freq));
  if(kind===1)v+=contrast*((Math.sin(x*(.3+freq/10)+phase)>0?1:-1)*.45+Math.cos(y*freq*.25)*.4);
  if(kind===2)v+=(rand()+rand()+rand()-1.5)*(.055+rand()*.22);
  else v+=(rand()-.5)*.008;
  g[y*W+x]=Math.max(0,Math.min(1,v));
 }
 return {x:features(g,W,H),y:kind};
}
const data=Array.from({length:3600},(_,i)=>example(i%3)),validation=Array.from({length:600},(_,i)=>example(i%3));
const mean=Array(8).fill(0),scale=Array(8).fill(0);
for(const {x}of data)x.forEach((v,i)=>mean[i]+=v/data.length);
for(const {x}of data)x.forEach((v,i)=>scale[i]+=(v-mean[i])**2/data.length);
scale.forEach((v,i)=>scale[i]=Math.max(.001,Math.sqrt(v)));
const hidden=12,w1=Array.from({length:hidden},()=>Array.from({length:8},()=>(rand()-.5)*.3));
const w2=Array.from({length:3},()=>Array.from({length:hidden},()=>(rand()-.5)*.3)),b1=Array(hidden).fill(0),b2=Array(3).fill(0);
for(let epoch=0;epoch<45;epoch++){
 for(let k=data.length-1;k>0;k--){const j=Math.floor(rand()*(k+1));[data[k],data[j]]=[data[j],data[k]];}
 const rate=.018/(1+epoch*.04);
 for(const sample of data){
  const x=sample.x.map((v,i)=>(v-mean[i])/scale[i]);
  const h=w1.map((w,j)=>Math.tanh(w.reduce((s,v,i)=>s+v*x[i],b1[j])));
  const z=w2.map((w,j)=>w.reduce((s,v,i)=>s+v*h[i],b2[j]));
  const m=Math.max(...z),e=z.map(v=>Math.exp(v-m)),sum=e.reduce((a,b)=>a+b),d=e.map((v,i)=>v/sum-(i===sample.y?1:0));
  const dh=h.map((v,j)=>(1-v*v)*d.reduce((s,g,i)=>s+g*w2[i][j],0));
  w2.forEach((w,j)=>{w.forEach((v,i)=>w[i]-=rate*d[j]*h[i]);b2[j]-=rate*d[j];});
  w1.forEach((w,j)=>{w.forEach((v,i)=>w[i]-=rate*dh[j]*x[i]);b1[j]-=rate*dh[j];});
 }
}
const model={version:1,name:'Pillow AI Content v1',architecture:'8 → 12 tanh → 3 softmax',training:'3600 original synthetic frames, seed 1729',labels,mean,scale,w1,b1,w2,b2};
const correct=validation.filter(s=>classify(s.x,model).kind===labels[s.y]).length;
model.validation={syntheticSamples:validation.length,accuracy:correct/validation.length};
writeFileSync(new URL('../public/assets/content-model.json',import.meta.url),JSON.stringify(model));
console.log(`Pillow content model: ${correct}/${validation.length} synthetic validation frames. Real-world quality requires visual evaluation.`);
