import { AU } from '../../core/physics/constants';
import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { Reservoirs } from '../system/types';
import type { Comet } from './types';

/**
 * Notable comets sourced from the system's reservoirs: near-parabolic
 * orbits with perihelia among the planets. The first comet's phase is
 * pinned near perihelion so every system has an apparition in progress.
 */
export function generateComets(
  rng: Rng,
  designation: string,
  reservoirs: Reservoirs,
  count = 3,
): Comet[] {
  const comets: Comet[] = [];
  for (let i = 0; i < count; i++) {
    const perihelionAu = logNormal(rng, Math.log(0.8), 0.6);
    // Aphelion in the scattered disc or beyond.
    const aphelionAu = Math.max(
      reservoirs.scatteredDiscInnerAu * rng.range(0.8, 3),
      perihelionAu * 20,
    );
    const semiMajorAu = (perihelionAu + aphelionAu) / 2;
    const eccentricity = 1 - perihelionAu / semiMajorAu;

    comets.push({
      name: `${designation}/C${i + 1}`,
      elements: {
        semiMajorAxis: semiMajorAu * AU,
        eccentricity,
        inclination: rng.range(0, 0.6) + (rng.bool(0.2) ? rng.range(0.6, 2.4) : 0),
        longitudeOfAscendingNode: rng.range(0, 2 * Math.PI),
        argumentOfPeriapsis: rng.range(0, 2 * Math.PI),
        meanAnomalyAtEpoch: i === 0 ? rng.range(-0.015, 0.015) * 2 * Math.PI : rng.range(0, 2 * Math.PI),
        epoch: 0,
      },
      nucleusKm: logNormal(rng, Math.log(3), 0.8),
      activityOnsetAu: rng.range(2.5, 4.5),
      dustiness: rng.range(0.2, 0.95),
    });
  }
  return comets;
}
