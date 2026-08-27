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
    const activityOnsetAu = rng.range(2.5, 4.5);
    let perihelionAu = logNormal(rng, Math.log(0.8), 0.6);
    if (i === 0) perihelionAu = Math.min(perihelionAu, activityOnsetAu * 0.6);
    // Aphelion in the scattered disc or beyond.
    const aphelionAu = Math.max(
      reservoirs.scatteredDiscInnerAu * rng.range(0.8, 3),
      perihelionAu * 20,
    );
    const semiMajorAu = (perihelionAu + aphelionAu) / 2;
    const eccentricity = 1 - perihelionAu / semiMajorAu;

    // The first comet's phase is pinned inside its active arc — the
    // mean-anomaly window where r stays below the activity onset. On a
    // near-parabolic orbit even a near-zero mean anomaly sits years
    // from perihelion, so the window must come from the orbit itself:
    // r = a(1 − e·cosE).
    const cosOnsetE = (1 - activityOnsetAu / semiMajorAu) / eccentricity;
    const onsetE = Math.acos(Math.min(1, Math.max(-1, cosOnsetE)));
    const activeWindow = onsetE - eccentricity * Math.sin(onsetE);

    comets.push({
      name: `${designation}/C${i + 1}`,
      elements: {
        semiMajorAxis: semiMajorAu * AU,
        eccentricity,
        inclination: rng.range(0, 0.6) + (rng.bool(0.2) ? rng.range(0.6, 2.4) : 0),
        longitudeOfAscendingNode: rng.range(0, 2 * Math.PI),
        argumentOfPeriapsis: rng.range(0, 2 * Math.PI),
        meanAnomalyAtEpoch:
          i === 0 ? rng.range(-0.7, 0.7) * activeWindow : rng.range(0, 2 * Math.PI),
        epoch: 0,
      },
      nucleusKm: logNormal(rng, Math.log(3), 0.8),
      activityOnsetAu,
      dustiness: rng.range(0.2, 0.95),
    });
  }
  return comets;
}
