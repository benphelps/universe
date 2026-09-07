import { AU, EARTH_MASS, G, SOLAR_MASS, YEAR } from '../../core/physics/constants';
import type { Belt, BeltInventory } from '../system/types';

/** Integral of D^power over positive diameter bounds, including log limit. */
function moment(lo: number, hi: number, power: number): number {
  if (!(hi > lo)) return 0;
  const exponent = power + 1;
  return Math.abs(exponent) < 1e-10 ? Math.log(hi / lo)
    : lo ** exponent * Math.expm1(exponent * Math.log(hi / lo)) / exponent;
}

/** dN/dD = A D^(-q-1), D in km. The volume integral owns normalization. */
export function beltDistribution(inventory: BeltInventory): { amplitude: number; count: number } {
  const { slope: q, minDiameterKm: lo, maxDiameterKm: hi, bulkDensityKgM3: density } = inventory;
  if (!(inventory.massEarth > 0) || !(hi > lo)) return { amplitude: 0, count: 0 };
  const amplitude = inventory.massEarth * EARTH_MASS /
    (density * Math.PI / 6 * 1e9 * moment(lo, hi, 2 - q));
  return { amplitude, count: amplitude * moment(lo, hi, -q - 1) };
}

/** Continuous moments, including non-rendered small parent bodies. */
export function beltInventoryMoments(inventory: BeltInventory, minKm = inventory.minDiameterKm, maxKm = inventory.maxDiameterKm) {
  const lo = Math.max(inventory.minDiameterKm, minKm), hi = Math.min(inventory.maxDiameterKm, maxKm);
  const { amplitude } = beltDistribution(inventory), q = inventory.slope;
  return {
    count: amplitude * moment(lo, hi, -q - 1),
    massEarth: amplitude * inventory.bulkDensityKgM3 * Math.PI / 6 * 1e9 * moment(lo, hi, 2 - q) / EARTH_MASS,
    crossSectionKm2: amplitude * Math.PI / 4 * moment(lo, hi, 1 - q),
  };
}

/** Largest-first rank interval. Its mass equals the exact SFD integral
 * over one expected object, rather than a random mass overdraft. */
export function beltRankDiameter(inventory: BeltInventory, rank: number): number {
  const { amplitude, count } = beltDistribution(inventory);
  if (!Number.isSafeInteger(rank) || rank < 0 || rank + 1 > Math.floor(count)) return 0;
  const q = inventory.slope;
  const x = inventory.maxDiameterKm ** -q + q * rank / amplitude;
  const delta = q / amplitude / x;
  const exponent = 1 - 3 / q;
  const volumeKm3 = Math.abs(exponent) < 1e-10 ? Math.log1p(delta) * amplitude / q
    : x ** exponent * Math.expm1(exponent * Math.log1p(delta)) / (q / amplitude * exponent);
  return Math.cbrt(volumeKm3);
}

/** Exact cutoff for the rank-integrated diameters, not an approximate
 * count that changes the identities when the requested floor changes. */
export function beltRankCount(inventory: BeltInventory, minKm: number): number {
  const { count } = beltDistribution(inventory);
  let lo = 0, hi = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count));
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (beltRankDiameter(inventory, mid) >= minKm) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Particle-in-a-box catastrophic lifetime: integrate projectile cross
 * sections above the disruption-energy threshold. Fixed Q* = 200 J/kg,
 * no focusing, a mixed annulus and a self-similar cascade are explicit
 * approximations; this is not a fitted exobelt occurrence model. */
export function beltCollisionLifetimeMyr(belt: Belt, inventory: BeltInventory, centralMassSolar: number): number {
  const r = Math.sqrt(belt.innerAu * belt.outerAu) * AU, width = (belt.outerAu - belt.innerAu) * AU;
  const inclination = Math.max(.01, belt.inclinationDispersionRad * .6);
  const speed = Math.sqrt(G * centralMassSolar * SOLAR_MASS / r) * Math.sqrt(1.25 * .1 ** 2 + inclination ** 2);
  const volume = 4 * Math.PI * r * r * width * Math.sin(inclination);
  const dc = inventory.maxDiameterKm, q = inventory.slope;
  const projectile = Math.max(inventory.minDiameterKm, dc * Math.cbrt(2 * 200 / (speed * speed)));
  const { amplitude } = beltDistribution(inventory);
  const area = amplitude * Math.PI / 4 * 1e6 * (
    dc * dc * moment(projectile, dc, -q - 1) +
    2 * dc * moment(projectile, dc, -q) + moment(projectile, dc, 1 - q)
  );
  return area > 0 && speed > 0 ? volume / (speed * area) / YEAR / 1e6 : Infinity;
}
