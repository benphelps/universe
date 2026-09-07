import { stellarHaloCount } from './stellarHalo';
import { armProfile, SMOOTH_MODEL } from './density';
import { fieldPopulationMoments } from './fieldPopulation';
import { spheroidParameters, nuclearClusterParameters } from './spheroidParameters';
import { nuclearMeanStellarMass } from './nuclearPopulation';

export interface GalaxyFieldCounts { thin: number; thick: number; halo: number }
let fieldMemo: GalaxyFieldCounts | null = null;

/** Number integrals of the current field profiles. Vertical and radial disc
 * exponentials and the oblate halo are analytic; spiral structure
 * preserves the inventory of every annulus. The halo includes its finite tail to
 * infinity, rather than silently truncating it in a cylindrical box. */
export function galaxyFieldStarCounts(): GalaxyFieldCounts {
  if (fieldMemo) return fieldMemo;
  const m = SMOOTH_MODEL;
  return fieldMemo = {
    thin: 4 * Math.PI * m.thinNorm * m.thinScaleHeightPc * m.thinScaleLengthPc ** 2,
    thick: 4 * Math.PI * m.thickNorm * m.thickScaleHeightPc * m.thickScaleLengthPc ** 2,
    halo: stellarHaloCount(),
  };
}

/** Uncached spatial quadrature for refinement audits. */
export function integrateGalaxyFieldCounts(radialSteps = 480, azimuthSteps = 96): GalaxyFieldCounts {
  const model = SMOOTH_MODEL;
  const maxRadius = 20 * model.thinScaleLengthPc;
  const dr = maxRadius / radialSteps;
  let thin = 0;
  for (let i = 0; i < radialSteps; i++) {
    const r = (i + 0.5) * dr;
    let boost = 0;
    for (let a = 0; a < azimuthSteps; a++) boost += armProfile(r, (a + 0.5) * 2 * Math.PI / azimuthSteps).boost;
    const column = 2 * model.thinScaleHeightPc * model.thinNorm * Math.exp(-r / model.thinScaleLengthPc);
    thin += 2 * Math.PI * r * dr * column * (1 + boost / azimuthSteps);
  }
  const thick = 4 * Math.PI * model.thickNorm * model.thickScaleHeightPc * model.thickScaleLengthPc ** 2;
  const halo = stellarHaloCount();
  return { thin, thick, halo };
}

/** Explicit field inventory: the local mixture is not a valid mass
 * conversion for an entire galaxy with old halo and bulge populations. */
export function galaxyFieldStellarMass(): number {
  const n = galaxyFieldStarCounts();
  return n.thin * fieldPopulationMoments('thin-disk').massSolar +
    n.thick * fieldPopulationMoments('thick-disk').massSolar + n.halo * fieldPopulationMoments('halo').massSolar;
}

/** Field plus bulge, with B/T allocated exactly once. The nuclear
 * cluster is allocated from that bulge, not added on top of it. */
export function galaxyStellarMass(): number {
  return galaxyFieldStellarMass() / (1 - spheroidParameters().massFraction);
}

export function galaxyBulgeStarCount(): number {
  const fraction = spheroidParameters().massFraction - nuclearClusterParameters().massFraction;
  return galaxyStellarMass() * fraction / fieldPopulationMoments('bulge').massSolar;
}

export function galaxyNuclearStarCount(): number {
  return galaxyStellarMass() * nuclearClusterParameters().massFraction / nuclearMeanStellarMass();
}

export function galaxyStarCount(): number {
  const n = galaxyFieldStarCounts();
  return n.thin + n.thick + n.halo + galaxyBulgeStarCount() + galaxyNuclearStarCount();
}

/** Galaxy-wide present-day mean; individual components retain theirs. */
export function meanStellarMass(): number {
  return galaxyStellarMass() / galaxyStarCount();
}
