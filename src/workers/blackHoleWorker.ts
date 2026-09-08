import { buildBlackHoleTables, blackHoleTableTransfers } from '../render/blackhole/blackHoleTables';
import type { AccretionFlow } from '../universe/galaxy/accretionFlow';

self.onmessage=(event:MessageEvent<{flow:AccretionFlow;rgM:number}>)=>{
  try {
    const data=buildBlackHoleTables(event.data.flow,event.data.rgM,
      progress=>self.postMessage({type:'progress',progress}));
    (self as unknown as Worker).postMessage({type:'ready',data},blackHoleTableTransfers(data));
  } catch(error) {
    self.postMessage({type:'failed',message:error instanceof Error?error.message:String(error)});
  }
};
