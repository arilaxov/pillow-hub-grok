import {check,abortError} from './video-plan.mjs';
export function deviceJob(file,options={},hooks={},operation='process'){
 check(hooks.signal);
 return new Promise((resolve,reject)=>{
  let worker;
  try{worker=new Worker(new URL('./video-native-worker.mjs?v=93',import.meta.url),{type:'module'});}catch(error){error.recoverable=true;reject(error);return;}
  const cleanup=()=>{hooks.signal?.removeEventListener('abort',abort);worker.terminate();};
  const abort=()=>{cleanup();reject(abortError());};
  hooks.signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=({data:{type,data}})=>{
   if(type==='result'){cleanup();resolve(data);return;}
   if(type==='error'){cleanup();const error=new Error(data.message);error.name=data.name;error.recoverable=data.recoverable;reject(error);return;}
   if(type==='plan'){hooks.onPlan?.(data.plan,data.analysis);return;}
   const callback={stage:'onStage',status:'onStatus',progress:'onProgress',source:'onSource'}[type];if(callback)hooks[callback]?.(data);
  };
  worker.onerror=()=>{cleanup();const error=new Error('Device processing could not start.');error.recoverable=true;reject(error);};
  worker.postMessage({file,options,operation});
 });
}
