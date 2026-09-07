import { elementsToState } from '../../core/math/kepler';
import { orbitalPeriod, type OrbitalElements } from '../../core/math/orbit';
import type { Vec3 } from '../../core/math/vec3';
import { SOLAR_LUMINOSITY, G, SOLAR_MASS } from '../../core/physics/constants';
import { mu as muOf, seconds, type Mu } from '../../core/physics/units';
import type { Star } from '../star/types';
import type { StellarCompanion, SystemConfiguration } from '../system/types';
import type { PlanetRotation } from './types';

export interface OrbitTerm { elements: OrbitalElements; mu: Mu; scale?: number }
export interface StellarForcing {
  sources: { luminositySolar: number; path: OrbitTerm[] }[];
  /** Origin of the planet's orbit; empty for a circumbinary barycentre. */
  origin: OrbitTerm[];
}
export interface PlanetForcing extends StellarForcing {
  orbit: OrbitTerm;
  satellite?: OrbitTerm;
}
export interface IncidentBeam { direction: Vec3; fluxWm2: number }

/** Orbital reference Z-up -> renderer Y-up. All returned distances are SI. */
export function orbitWorldPosition(path: readonly OrbitTerm[], tSeconds: number): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const term of path) {
    const p = elementsToState(term.elements, term.mu, seconds(tSeconds)).position;
    const scale = term.scale ?? 1;
    x += scale * p.x; y += scale * p.z; z -= scale * p.y;
  }
  return { x, y, z };
}

/** Shared inverse body orientation: R_y(-spin) R_z(+tilt).
 * The focused ground is stationary; distant solid meshes use its inverse.
 * Spin epoch is the viewer's existing zero-time meridian. */
export function bodyFrameQuaternion(rotation: Pick<PlanetRotation, 'periodHours' | 'obliquityRad'>, tSeconds: number): [number, number, number, number] {
  const spin = -2 * Math.PI * (tSeconds / (rotation.periodHours * 3600) % 1);
  const a = Math.sin(spin / 2), b = Math.cos(spin / 2);
  const c = Math.sin(rotation.obliquityRad / 2), d = Math.cos(rotation.obliquityRad / 2);
  return [a * c, a * d, b * c, b * d];
}

export function toBodyFrame(p: Vec3, rotation: PlanetRotation, tSeconds: number): Vec3 {
  const [qx, qy, qz, qw] = bodyFrameQuaternion(rotation, tSeconds);
  const tx = 2 * (qy * p.z - qz * p.y), ty = 2 * (qz * p.x - qx * p.z), tz = 2 * (qx * p.y - qy * p.x);
  return { x: p.x + qw * tx + qy * tz - qz * ty,
    y: p.y + qw * ty + qz * tx - qx * tz, z: p.z + qw * tz + qx * ty - qy * tx };
}

/** The same prescribed stellar orbits as the scene, including the inner
 * pair's barycentric reflex. This does not introduce an N-body model. */
export function stellarForcing(star: Star, companions: readonly StellarCompanion[], configuration: SystemConfiguration, hostIndex = 0): StellarForcing {
  const paths: OrbitTerm[][] = [[]];
  for (let i = 0; i < companions.length; i++) {
    const c = companions[i];
    const term = { elements: c.elements, mu: muOf(G * (star.mass + c.star.mass) * SOLAR_MASS) };
    if (i === 0 && configuration === 'p-type') {
      const q = c.star.mass / (star.mass + c.star.mass);
      paths[0] = [{ ...term, scale: -q }];
      paths.push([{ ...term, scale: 1 - q }]);
    } else paths.push([...paths[0], term]);
  }
  return {
    sources: [star, ...companions.map(c => c.star)].map((s, i) => ({ luminositySolar: s.luminosity, path: paths[i] })),
    origin: configuration === 'p-type' && hostIndex === 0 ? [] : paths[hostIndex],
  };
}

export function forcingPeriodSeconds(forcing: PlanetForcing): number {
  return orbitalPeriod(forcing.orbit.mu, forcing.orbit.elements.semiMajorAxis);
}

export function incidentBeams(forcing: PlanetForcing, rotation: PlanetRotation, tSeconds: number): IncidentBeam[] {
  const body = orbitWorldPosition([...forcing.origin, forcing.orbit, ...(forcing.satellite ? [forcing.satellite] : [])], tSeconds);
  return forcing.sources.map(source => {
    const p = orbitWorldPosition(source.path, tSeconds);
    const delta = { x: p.x - body.x, y: p.y - body.y, z: p.z - body.z };
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    const direction = toBodyFrame({ x: delta.x / distance, y: delta.y / distance, z: delta.z / distance }, rotation, tSeconds);
    return { direction, fluxWm2: source.luminositySolar * SOLAR_LUMINOSITY / (4 * Math.PI * distance ** 2) };
  });
}

export function instantaneousInsolation(normal: Vec3, beams: readonly IncidentBeam[]): number {
  let flux = 0;
  for (const beam of beams) flux += beam.fluxWm2 * Math.max(0,
    normal.x * beam.direction.x + normal.y * beam.direction.y + normal.z * beam.direction.z);
  return flux;
}

/** Exact rotation average for a fixed stellar declination/distance.
 * Use only when orbital motion during one solar day is negligible. */
export function dailyMeanInsolation(sinLatitude: number, beams: readonly IncidentBeam[]): number {
  const cosLat = Math.sqrt(Math.max(0, 1 - sinLatitude ** 2));
  let flux = 0;
  for (const { direction, fluxWm2 } of beams) {
    const a = sinLatitude * direction.y;
    const b = cosLat * Math.sqrt(Math.max(0, 1 - direction.y ** 2));
    const h = b < 1e-14 ? (a > 0 ? Math.PI : 0) : Math.acos(Math.max(-1, Math.min(1, -a / b)));
    flux += fluxWm2 * (h * a + b * Math.sin(h)) / Math.PI;
  }
  return Math.max(0, flux);
}
