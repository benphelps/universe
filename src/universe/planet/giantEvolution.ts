import type { PlanetClass } from '../system/types';

/** Bounded cooling-track approximation, normalized at Solar-System age.
 * Early formation (<50 Myr), helium separation and stratification are not
 * evolved explicitly. Efficiency describes heat escaping a layered interior. */
export function giantCoolingFlux(
  planetClass: PlanetClass, massEarth: number, radiusEarth: number,
  ageGyr: number, efficiency: number,
): number {
  const gas = planetClass === 'gas-giant';
  const referenceMass = gas ? 318 : 17;
  const referenceRadius = gas ? 11.2 : 3.9;
  const referenceFlux = gas ? 5.4 : .43;
  const cooling = (Math.max(ageGyr, .05) / 4.6) ** -1.15;
  return referenceFlux * (massEarth / referenceMass) ** 1.1
    * (referenceRadius / radiusEarth) ** 2 * cooling * efficiency;
}

export function giantContraction(ageGyr: number): number {
  return Math.max(.9, Math.min(1.3, ((Math.max(ageGyr, .05) + .1) / 4.7) ** -.045));
}
