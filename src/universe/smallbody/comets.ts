import { AU } from '../../core/physics/constants';
import { logNormal } from '../../core/rng/distributions';
import type { Rng } from '../../core/rng/rng';
import type { Reservoirs } from '../system/types';
import type { Comet } from './types';

/**
 * Notable comets sourced from the system's reservoirs: near-parabolic
 * orbits with perihelia among the planets. These are a bounded sample of
 * candidate orbits, not a calibrated count of a system's icy population.
 * Uniform mean anomaly gives an unbiased observation time on each orbit.
 */
export function generateComets(
  rng: Rng,
  designation: string,
  reservoirs: Reservoirs,
  count = 3,
  hostLuminositySolar = 1,
): Comet[] {
  const comets: Comet[] = [];
  for (let i = 0; i < count; i++) {
    // Equal incident bolometric flux: L/r² fixes the approximate sublimation
    // onset. The solar-reference spread represents volatile/thermal diversity,
    // not a detailed nucleus heat or mass-loss model.
    const activityOnsetAu = rng.range(2.5, 4.5) * Math.sqrt(Math.max(0, hostLuminositySolar));
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
        meanAnomalyAtEpoch: rng.range(0, 2 * Math.PI),
        epoch: 0,
      },
      nucleusKm: logNormal(rng, Math.log(3), 0.8),
      activityOnsetAu,
      dustiness: rng.range(0.2, 0.95),
    });
  }
  return comets;
}
