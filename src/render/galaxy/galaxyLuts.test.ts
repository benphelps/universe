import { afterEach,expect,it,vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
it('settles worker failure into an intact diffuse-only fallback',async()=>{
  for(const kind of ['constructor','error','messageerror']) {
    vi.resetModules();let worker:{onerror:()=>void;onmessageerror:()=>void;terminate:ReturnType<typeof vi.fn>}|undefined;
    const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
    vi.stubGlobal('Worker',class {onerror=()=>{};onmessageerror=()=>{};terminate=vi.fn();postMessage=vi.fn();constructor(){if(kind==='constructor')throw Error('worker');worker=this;}});
    const {galaxyLutTextures}=await import('./galaxyLuts');const luts=galaxyLutTextures();
    if(kind==='error')worker!.onerror();if(kind==='messageerror')worker!.onmessageerror();
    await luts.ready;expect(luts.particles).toBeNull();expect(galaxyLutTextures()).toBe(luts);expect(warning).toHaveBeenCalled();
    if(worker)expect(worker.terminate).toHaveBeenCalledOnce();warning.mockRestore();luts.armLut.dispose();luts.clumpTile.dispose();
  }
});
