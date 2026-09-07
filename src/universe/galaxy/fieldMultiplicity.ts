import { initialMassDensity, KROUPA_SEGMENTS, massUnitForMass } from '../star/imf';
import { multiplicityFraction } from '../star/multiplicity';

/** The field catalogue draws primary masses from the IMF, then adds
 * coeval companions. Density counts individual objects, including those
 * companions and remnants; one catalogue slot therefore costs this many
 * objects in expectation. Nuclear clusters have their own single-star IMF. */
const PRIMARY_BREAKS = [0.013, 0.08, 0.3, 0.5, 0.8, 1.3, 3, 120];
export const FIELD_OBJECTS_PER_SYSTEM = 1 + PRIMARY_BREAKS.slice(1).reduce((sum, hi, i) => {
  const lo = PRIMARY_BREAKS[i];
  return sum + (massUnitForMass(hi)-massUnitForMass(lo))*1.25*multiplicityFraction((lo+hi)/2);
}, 0);

/** Integrate p(M) E[Ncomp|M] M^power on a primary-mass interval. The
 * IMF and multiplicity are power laws/steps, so no Monte Carlo is needed. */
function primaryIntegral(from: number, to: number, power: number): number {
  let result = 0;
  for (let i = 1; i < PRIMARY_BREAKS.length; i++) {
    const lo = Math.max(from, PRIMARY_BREAKS[i-1]);
    const hi = Math.min(to, PRIMARY_BREAKS[i]);
    if (hi <= lo) continue;
    const mid = (lo+hi)/2;
    const alpha = KROUPA_SEGMENTS.find(s => mid >= s.min && mid <= s.max)!.alpha;
    const exponent = 1-alpha+power;
    const coefficient = initialMassDensity(mid)*mid**alpha*1.25*multiplicityFraction(mid);
    result += coefficient*(hi**exponent-lo**exponent)/exponent;
  }
  return result;
}

/** Marginal companion mass PDF per primary for q uniform on [.15,.95].
 * The minimum-mass clamp is a separate atom, not a narrow PDF bin. */
export function companionMassDensity(mass: number): number {
  if (mass < .013 || mass > 114) return 0;
  return primaryIntegral(mass/.95,mass/.15,-1)/.8;
}
export const COMPANIONS_AT_MINIMUM = primaryIntegral(.013,.013/.95,0)
  + (.013*primaryIntegral(.013/.95,.013/.15,-1)-.15*primaryIntegral(.013/.95,.013/.15,0))/.8;
export const FIELD_MASS_BREAKS = [...new Set(PRIMARY_BREAKS.flatMap(m => [m,m*.15,m*.95]))]
  .filter(m => m >= .013 && m <= 120);
