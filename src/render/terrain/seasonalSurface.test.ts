import { expect, it, vi } from 'vitest';
import { ShaderMaterial } from 'three';
import { applySeasonalSurface, seasonalSurfaceUniforms, SeasonalSurfaceOverlay } from './seasonalSurface';
import type { SurfaceParams } from '../../universe/surface/params';
import type { SeasonalSurfaceField } from '../../universe/planet/seasonalSurface';

it('shares one immutable texture, gates dry/magma/permanent ice and clears stale bindings',()=>{
  const field={latitudeCount:2,frameCount:2,temperatureK:new Float32Array([260,280,280,260]),cycleSeconds:100} as SeasonalSurfaceField;
  const overlay=new SeasonalSurfaceOverlay(field),disposed=vi.fn();overlay.texture.addEventListener('dispose',disposed);
  const material=new ShaderMaterial({uniforms:seasonalSurfaceUniforms()});
  const params={surfaceIce:true,globalIce:false,magmaCoverage:0,lapseKPerKm:6,atmosphericCapK:210,palette:{ice:[.8,.8,.8]}} as SurfaceParams;
  applySeasonalSurface(material,overlay,params);expect(material.uniforms.uSeasonalEnabled.value).toBe(1);
  const version=overlay.texture.version;
  for(let i=0;i<100;i++)material.uniforms.uSeasonalPhase.value=i/100;
  expect(overlay.texture.version).toBe(version);
  for(const change of [{surfaceIce:false},{globalIce:true},{magmaCoverage:.1}]) {
    applySeasonalSurface(material,overlay,{...params,...change});expect(material.uniforms.uSeasonalEnabled.value).toBe(0);
  }
  applySeasonalSurface(material,null);expect(material.uniforms.uSeasonalTemperature.value).toBe(null);
  expect(material.uniforms.uSeasonalEnabled.value).toBe(0);overlay.dispose();expect(disposed).toHaveBeenCalledOnce();material.dispose();
});
