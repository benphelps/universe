import { cloudReachPc, type MolecularCloud } from './clouds';
import { displayPedestal, displaySurfaceBrightness } from './displayLaw';
import { MEMBER_SPREAD, nebulaLightSolar, type Nebula } from './nebula';

/** Sufficient for ranking, without retaining a cloud's full stellar population. */
export interface ResidencyLight { radiusPc: number; luminositySolar: number }
export function residencyLight(cloud: MolecularCloud, nebula: Nebula | null): ResidencyLight | null {
  return nebula ? { radiusPc: nebula.bubbleRadiusPc > 0 ? nebula.bubbleRadiusPc : MEMBER_SPREAD * cloud.radiusPc,
    luminositySolar: nebulaLightSolar(nebula) } : null;
}

/**
 * What a cloud is worth drawing as a volume from a viewpoint: the
 * display energy at stake if it were left to the sprite, through the
 * sky's own law. A dark cloud is a silhouette: its solid angle times
 * the display energy of the sky pedestal it blots out. A lit cloud is
 * that and its light: its whole budget spread over its ionized disc —
 * the natal group's spread where nothing ionizes — displayed as the
 * law's marginal response above the pedestal, over that disc's solid
 * angle. So a bright complex outranks a rift of its size, a great rift
 * outranks a faint smudge, and neither tier is ranked by size alone.
 */
export function residencyWeight(
  cloud: MolecularCloud,
  nebula: Nebula | null,
  distancePc: number,
  pedestalRadiance: number,
): number {
  return residencyWeightFromLight(cloud, residencyLight(cloud, nebula), distancePc, pedestalRadiance);
}

export function residencyWeightFromLight(
  cloud: MolecularCloud, light: ResidencyLight | null, distancePc: number, pedestalRadiance: number,
): number {
  const distance = Math.max(1, distancePc);
  const reach = cloudReachPc(cloud) / distance;
  let weight = Math.PI * reach * reach * displayPedestal(pedestalRadiance);
  if (light) {
    const litPc = light.radiusPc;
    const lit = Math.max(1e-6, litPc / distance);
    const solidAngle = Math.PI * lit * lit;
    const surface = light.luminositySolar / (4 * Math.PI * distance * distance * solidAngle);
    weight += solidAngle * displaySurfaceBrightness(surface, pedestalRadiance);
  }
  return weight;
}
