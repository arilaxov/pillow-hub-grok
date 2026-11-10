/* Original Pillow content features. Luma in [0, 1]; shared by training and inference. */
export function features(gray, width, height, previous) {
  let mean=0, sq=0, edge=0, residual=0, motion=0, flatNoise=0, flatCount=0;
  const n=width*height;
  for(let i=0;i<n;i++){const v=gray[i];mean+=v;sq+=v*v;if(previous)motion+=Math.abs(v-previous[i]);}
  mean/=n;
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
    const i=y*width+x,v=gray[i];
    const e=(Math.abs(gray[i-2]-gray[i+2])+Math.abs(gray[i-2*width]-gray[i+2*width]))/2;
    const r=Math.abs(v-(gray[i-1]+gray[i+1]+gray[i-width]+gray[i+width])/4);
    edge+=e;residual+=r;if(e<.06){flatNoise+=r;flatCount++;}
  }
  const count=(width-4)*(height-4);
  return [mean,Math.sqrt(Math.max(0,sq/n-mean*mean)),edge/count,residual/count,flatNoise/Math.max(1,flatCount),flatCount/count,motion/n,1];
}
export function classify(input, model) {
  const x=input.map((v,i)=>(v-model.mean[i])/model.scale[i]);
  const h=model.w1.map((w,j)=>Math.tanh(w.reduce((s,v,i)=>s+v*x[i],model.b1[j])));
  const z=model.w2.map((w,j)=>w.reduce((s,v,i)=>s+v*h[i],model.b2[j]));
  const m=Math.max(...z), e=z.map(v=>Math.exp(v-m)),total=e.reduce((a,b)=>a+b,0);
  const scores=e.map(v=>v/total),index=scores.indexOf(Math.max(...scores));
  return {kind:model.labels[index],scores,confidence:scores[index]};
}
export function encodingPlan(info, mode='enhanced', analysis={kind:'detail',confidence:0}) {
  if(!info.width||!info.height)throw new Error('No readable video stream was found.');
  // Preserve composition, fit inside a Full HD canvas. Portrait keeps its orientation.
  const portrait=info.height>info.width, width=portrait?1080:1920,height=portrait?1920:1080;
  const fps=Math.min(60,Math.max(1,info.fps||30));
  const noisy=mode==='enhanced' && analysis.kind==='noise' && analysis.confidence>.65;
  const detailed=analysis.kind==='detail';
  const sharp=mode==='enhanced'?(noisy?.28:detailed?.38:.22):0;
  const filters=[];
  if(noisy)filters.push('hqdn3d=1.2:1.0:1.8:1.5');
  filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,'setsar=1');
  if(sharp)filters.push(`unsharp=5:5:${sharp}:5:5:0`);
  filters.push('format=yuv420p');
  return {width,height,fps,noisy,sharp,crf:mode==='enhanced'?'18':'20',maxrate:fps>35?'18M':'12M',filter:filters.join(',')};
}
