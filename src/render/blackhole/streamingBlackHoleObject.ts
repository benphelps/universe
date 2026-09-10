import { Group, type Object3D, type WebGLCubeRenderTarget, type WebGLRenderer } from 'three';
import { BlackHoleObject, type BlackHoleSolver, type TracedHole } from './blackHoleObject';
import { requestBlackHoleTables } from '../../workers/blackHole';
import type { BlackHoleTables } from './blackHoleTables';
import { rememberHotFlowModel } from '../../universe/galaxy/hotFlowEmission';

type Prepare=(object:Object3D)=>Promise<unknown>;
/** Stable scene identity while a cancellable worker builds material data.
 * The flow-free shadow remains interactive until the complete material and
 * its shaders are ready. No synchronous CPU fallback on worker failure. */
export class StreamingBlackHoleObject {
  readonly mesh=new Group();
  readonly ready:Promise<boolean>;
  readonly generation={pending:false,fraction:0,stage:'',error:null as string|null};
  preparedData:BlackHoleTables|null=null;
  private current:BlackHoleObject;
  private cancel=()=>{};
  private disposed=false;
  private skyTarget:WebGLCubeRenderTarget|null=null;
  private prepareObject:Prepare=()=>Promise.resolve();
  private initialPreparation:Promise<unknown>=Promise.resolve();
  private initialReady=true;
  private resolveReady!:(ready:boolean)=>void;

  constructor(model:TracedHole,frame:Float32Array,solver:BlackHoleSolver='regular',sampling:'atlas'|'direct'='atlas',request=requestBlackHoleTables) {
    const visible=model.flow.eddingtonRatio>1e-10;
    this.current=new BlackHoleObject(visible?{...model,flow:{...model.flow,eddingtonRatio:0}}:model,frame,solver,sampling);
    this.mesh.add(this.current.mesh);this.mesh.visible=false;
    this.ready=new Promise(resolve=>{this.resolveReady=resolve;});
    if(!visible){queueMicrotask(()=>{void this.initialPreparation.then(()=>this.resolveReady(!this.disposed));});return;}
    this.generation.pending=true;
    this.cancel=request(model.flow,model.gravitationalRadiusM,{
      progress:p=>{if(!this.disposed)Object.assign(this.generation,p);},
      failed:message=>{
        if(this.disposed)return;
        Object.assign(this.generation,{pending:false,error:message,stage:'generation failed'});this.resolveReady(false);
      },
      ready:data=>{
        if(this.disposed)return;
        this.generation.stage='preparing display';this.generation.fraction=.99;
        void this.install(data,model,frame,solver,sampling);
      },
    });
  }
  private async install(data:BlackHoleTables,model:TracedHole,frame:Float32Array,solver:BlackHoleSolver,sampling:'atlas'|'direct'):Promise<void> {
    let next:BlackHoleObject|undefined;
    try {
      next=new BlackHoleObject(model,frame,solver,sampling,data);
      await next.prepare(this.prepareObject);
      if(this.disposed){next.dispose();return;}
      if(this.skyTarget)next.sky=this.skyTarget;
      const previous=this.current;
      this.mesh.remove(previous.mesh);this.mesh.add(next.mesh);this.current=next;
      void this.initialPreparation.finally(()=>previous.dispose());
      this.initialReady=true;
      this.preparedData=data;
      if(data.hot)rememberHotFlowModel(model.flow,model.gravitationalRadiusM,data.hot.data.model);
      Object.assign(this.generation,{pending:false,fraction:1,stage:'ready'});this.resolveReady(true);
    } catch(error) {
      next?.dispose();
      if(this.disposed)return;
      Object.assign(this.generation,{pending:false,error:error instanceof Error?error.message:String(error),stage:'display preparation failed'});
      this.resolveReady(false);
    }
  }
  prepare(prepareObject:Prepare):void {
    this.prepareObject=prepareObject;
    this.initialReady=false;
    // Keep ownership until asynchronous shader compilation settles.
    this.initialPreparation=this.current.prepare(prepareObject).catch(()=>{}).then(()=>{this.initialReady=true;});
  }
  get kmPerRg(){return this.current.kmPerRg;}
  get spinAxisScene(){return this.current.spinAxisScene;}
  get diskStatus(){return this.current.diskStatus;}
  get plasmaStatus(){return this.current.plasmaStatus;}
  set sky(target:WebGLCubeRenderTarget){this.skyTarget=target;this.current.sky=target;}
  update(...args:Parameters<BlackHoleObject['update']>):void {
    if(this.disposed)return;
    this.current.update(...args);this.mesh.visible=this.initialReady&&this.current.mesh.visible;
  }
  render(renderer:WebGLRenderer):void {if(!this.disposed&&this.mesh.visible)this.current.render(renderer);}
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;this.cancel();this.generation.pending=false;this.resolveReady(false);
    const current=this.current;
    this.mesh.clear();void this.initialPreparation.finally(()=>current.dispose());
  }
}
