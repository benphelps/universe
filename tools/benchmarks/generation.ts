import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { mix64 } from '../../src/core/rng/hash';
import { generateStar } from '../../src/universe/star/generate';
import { generateSystem } from '../../src/universe/system/generate';
import { CATALOG_ROWS, rowCells } from '../../src/universe/galaxy/catalog';
import { HOME_POSITION } from '../../src/universe/galaxy/density';
import { surveyCell, surveyFrameAt, rowSweepRadiusPc } from '../../src/universe/galaxy/skySurvey';
import { cloudsInCell } from '../../src/universe/galaxy/clouds';
import { nebulaFor } from '../../src/universe/galaxy/nebula';
import { bakeNebulaPair } from '../../src/universe/galaxy/nebulaPair';

const output = process.argv[2] ?? '.artifacts/generation';
const names = process.argv.slice(3);
const seeds = Array.from({length:1000},(_,i)=>mix64(BigInt(i+1)));
const cases: Record<string,()=>unknown> = {
 stars: () => seeds.map(seed=>generateStar(seed)),
 systems: () => seeds.slice(0,100).map(seed=>generateSystem(seed)),
 survey: () => {
  const row=CATALOG_ROWS[0],frame=surveyFrameAt(HOME_POSITION);
  return rowCells(row,HOME_POSITION,rowSweepRadiusPc(row)+frame.reachPc).slice(0,32).map(cell=>surveyCell(row,0,cell,frame));
 },
 surveyPopulated: () => {
  const frame=surveyFrameAt(HOME_POSITION);
  return CATALOG_ROWS.flatMap((row,index)=> {
   const distance=(cell:ReturnType<typeof rowCells>[number])=>Math.hypot(
    (cell.ix+.5)*row.cellPc-HOME_POSITION.xPc,
    (cell.iy+.5)*row.cellPc-HOME_POSITION.yPc,
    (cell.iz+.5)*row.cellPc-HOME_POSITION.zPc);
   return rowCells(row,HOME_POSITION,rowSweepRadiusPc(row)+frame.reachPc)
    .sort((a,b)=>distance(a)-distance(b)).slice(0,32).map(cell=>surveyCell(row,index,cell,frame));
  });
 },
 nebula48: () => { const cloud=cloudsInCell(15,-5,0).find(c=>c.seed===0xadb7a33b629c834an)!; return bakeNebulaPair(cloud,nebulaFor(cloud),48); },
};
for (const name of names) {
 if (!(name in cases)) throw new Error(`Unknown case: ${name}. Choose ${Object.keys(cases).join(', ')}`);
}
mkdirSync(dirname(output), { recursive: true });
const results=[];
for(const [name,run] of Object.entries(cases)) {
 if(names.length && !names.includes(name))continue;
 const before=performance.now();const first=run(),coldMs=performance.now()-before;
 const checksum=createHash('sha256').update(JSON.stringify(first,(_,v)=>typeof v==='bigint'?v.toString():v)).digest('hex');
 const samples=[];
 for(let repeat=0;repeat<5;repeat++){const start=performance.now();run();samples.push(performance.now()-start);}
 const profiler=new Session();profiler.connect();await profiler.post('Profiler.enable');await profiler.post('Profiler.start');
 for(let i=0;i<Math.max(1,Math.ceil(1000/samples[4]));i++)run();
 const {profile}=await profiler.post('Profiler.stop');profiler.disconnect();
 writeFileSync(`${output}-${name}.cpuprofile`,JSON.stringify(profile));
 const hits=new Map<number,number>();profile.samples?.forEach((id,i)=>hits.set(id,(hits.get(id)??0)+(profile.timeDeltas?.[i]??0)));
 const grouped=new Map<string,{function:string;file:string;line:number;micros:number}>();
 for(const n of profile.nodes){if(n.callFrame.url==='node:inspector')continue;const key=JSON.stringify(n.callFrame);
 const item=grouped.get(key)??{function:n.callFrame.functionName,file:n.callFrame.url,line:n.callFrame.lineNumber+1,micros:0};item.micros+=hits.get(n.id)??0;grouped.set(key,item);}
 const total=[...grouped.values()].reduce((a,b)=>a+b.micros,0);
 const top=[...grouped.values()].map(({micros,...n})=>({...n,share:micros/total})).sort((a,b)=>b.share-a.share).slice(0,18);
 const sorted=[...samples].sort((a,b)=>a-b);const result={name,coldMs,samples,medianMs:sorted[2],checksum,
  ...(name.startsWith('survey')?{cells:(first as {count:number}[]).length,stars:(first as {count:number}[]).reduce((sum,cell)=>sum+cell.count,0)}:{}),top};results.push(result);
 console.log(JSON.stringify(result));
}
writeFileSync(`${output}.json`,JSON.stringify({runtime:process.version,platform:process.platform,arch:process.arch,results},null,2));
