import { selectedFieldEmission } from './fieldSelection';
import { neighborRadiusPc } from './neighborhood';
import { cellEmissionWeight } from '../../core/physics/radiativeTransfer';
import type { LinearRgb } from '../../core/color/srgb';
import { expectedCloudField } from './clouds';
import { DUST_OPACITY_PER_PC, sightlineDensities, type GalacticPosition } from './density';
import { SCATTER_OPACITY_RGB } from './dustScattering';
import { fieldPopulationMoments } from './fieldPopulation';

/** Interior sky column in optical-power RGB, L☉ pc⁻² sr⁻¹. Dust
 * attenuates each emitter only over its path to the observer, including
 * its own cell; dust behind foreground stars cannot redden their light.
 * Nearby discrete clouds are applied by the sky's separate depth tiers. */
export function integrateGalaxyGlowRay(viewpoint: GalacticPosition, direction: readonly number[], nearCloudPc: number): LinearRgb {
  const thin = fieldPopulationMoments('thin-disk').opticalRgbSolar;
  const thick = fieldPopulationMoments('thick-disk').opticalRgbSolar;
  const halo = fieldPopulationMoments('halo').opticalRgbSolar;
  const bulge = fieldPopulationMoments('bulge').opticalRgbSolar;
  const light: LinearRgb = [0, 0, 0];
  const position = { xPc: 0, yPc: 0, zPc: 0 };
  let opticalDepth = 0;
  const nearPc = neighborRadiusPc(viewpoint);
  for (let s = 0; s < 25000;) {
    const stepPc = Math.min(25000 - s, s < 180 ? 5 : Math.max(30, s * 0.11));
    const midpoint = s + 0.5 * stepPc;
    position.xPc = viewpoint.xPc + direction[0] * midpoint;
    position.yPc = viewpoint.yPc + direction[1] * midpoint;
    position.zPc = viewpoint.zPc + direction[2] * midpoint;
    const sample = sightlineDensities(position);
    const clump = midpoint > nearCloudPc ? 0.45 + 1.6 * expectedCloudField(sample.dust, sample.armBoost) : 0.45;
    const selected = selectedFieldEmission([sample.thin,sample.thick,sample.halo,sample.bulge],midpoint,nearPc);
    const depth = sample.dust * clump * DUST_OPACITY_PER_PC * stepPc;
    for (let c = 0; c < 3; c++) {
      const k = SCATTER_OPACITY_RGB[c];
      const emission = Math.max(0,sample.thin * thin[c] + sample.thick * thick[c] + sample.halo * halo[c] + sample.bulge * bulge[c]-selected[c]);
      light[c] += emission * stepPc * Math.exp(-opticalDepth * k) * cellEmissionWeight(depth * k);
    }
    opticalDepth += depth;
    s += stepPc;
  }
  for (let c = 0; c < 3; c++) light[c] /= 4 * Math.PI;
  return light;
}
