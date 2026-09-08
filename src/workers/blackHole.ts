import { scheduleGeneration } from '../app/generationScheduler';
import type { AccretionFlow } from '../universe/galaxy/accretionFlow';
import type { BlackHoleTables, BlackHoleBuildProgress } from '../render/blackhole/blackHoleTables';

export interface BlackHoleTableCallbacks {
  ready:(data:BlackHoleTables)=>void;
  progress:(progress:BlackHoleBuildProgress)=>void;
  failed:(message:string)=>void;
}
type Reply={type:'progress';progress:BlackHoleBuildProgress}|{type:'ready';data:BlackHoleTables}|{type:'failed';message:string};
/** One bounded CPU cache. GPU storage remains owned by each visible object. */
let cached:{key:string;data:BlackHoleTables}|undefined;
export function requestBlackHoleTables(flow:AccretionFlow,rgM:number,callbacks:BlackHoleTableCallbacks):()=>void {
  const key=JSON.stringify([flow,rgM]);
  let stopped=false,worker:Worker|null=null,cancelPermit=()=>{};
  const finish=()=>{stopped=true;worker?.terminate();worker=null;cancelPermit();};
  if(cached?.key===key) {
    const data=cached.data;
    queueMicrotask(()=>{if(!stopped){stopped=true;callbacks.ready(data);}});
    return finish;
  }
  callbacks.progress({fraction:0,stage:'queued'});
  cancelPermit=scheduleGeneration('sky-preview',release=>{
    if(stopped){release();return;}
    const fail=(message:string)=>{if(stopped)return;finish();release();callbacks.failed(message);};
    try {
      const active=new Worker(new URL('./blackHoleWorker.ts',import.meta.url),{type:'module'});
      worker=active;
      active.onmessage=(event:MessageEvent<Reply>)=>{
        if(stopped||worker!==active)return;
        const message=event.data;
        if(message.type==='progress')callbacks.progress(message.progress);
        else if(message.type==='failed')fail(message.message);
        else {cached={key,data:message.data};finish();release();callbacks.ready(message.data);}
      };
      active.onerror=()=>fail('Black-hole generation worker failed');
      active.onmessageerror=()=>fail('Black-hole generation data could not be read');
      active.postMessage({flow,rgM});
    } catch(error) {fail(error instanceof Error?error.message:String(error));}
  });
  return finish;
}
