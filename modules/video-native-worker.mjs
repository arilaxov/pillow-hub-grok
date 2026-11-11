import {processNative,inspectInput,videoCapabilities} from './video-native-core.mjs?v=94';
/* Mediabunny can leave an internal promise rejected after the same error was caught and reported below. */
self.addEventListener('unhandledrejection',event=>event.preventDefault());
self.onmessage=async({data:{file,options={},operation='process'}})=>{
 try{
  if(operation==='capabilities'){self.postMessage({type:'result',data:await videoCapabilities(options.plan)});return;}
  if(operation==='inspect'){const ctx=await inspectInput(file);try{self.postMessage({type:'result',data:{...ctx.info,decodable:await ctx.video.canDecode()}});}finally{ctx.input.dispose();}return;}
  let last=0;
  const result=await processNative(file,options,{
   onStatus:data=>self.postMessage({type:'status',data}),onStage:data=>self.postMessage({type:'stage',data}),
   onSource:data=>self.postMessage({type:'source',data}),onPlan:(plan,analysis)=>self.postMessage({type:'plan',data:{plan,analysis}}),
   onProgress:data=>{const now=performance.now();if(data===1||now-last>80){last=now;self.postMessage({type:'progress',data});}}
  });
  self.postMessage({type:'result',data:result});
 }catch(error){self.postMessage({type:'error',data:{name:error.name,message:error.message,recoverable:!!error.recoverable}});}
};
