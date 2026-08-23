import type { Rng } from '../../core/rng/rng';
import type { StablePlanet } from './stability';
import type { Belt, BeltGap, Reservoirs } from './types';

const DEG = Math.PI / 180;

/** a of the interior p:q mean-motion resonance with a perturber at aGiant. */
export function resonanceSemiMajorAxisAu(aGiantAu: number, p: number, q: number): number {
  return aGiantAu * (q / p) ** (2 / 3);
}

const KIRKWOOD: Array<[string, number, number]> = [
  ['3:1', 3, 1],
  ['5:2', 5, 2],
  ['7:3', 7, 3],
  ['2:1', 2, 1],
];

/**
 * Belts appear where dynamics starved a region: a main belt interior to
 * the innermost giant (Kirkwood gaps carved at its resonances) and a
 * debris belt beyond the outermost planet (with a 3:2 resonant
 * population, plutino-style).
 */
export function generateBelts(rng: Rng, planets: StablePlanet[]): Belt[] {
  const belts: Belt[] = [];
  const giants = planets.filter((p) => p.slot.isGiant);
  const innermostGiant = giants[0];

  if (innermostGiant && rng.bool(0.8)) {
    const aGiant = innermostGiant.slot.aAu;
    const innerAu = aGiant * 0.38;
    const outerAu = aGiant * 0.65;
    // Only where no planet actually formed.
    const clear = planets.every((p) => p.slot.aAu < innerAu * 0.9 || p.slot.aAu > outerAu * 1.1);
    if (clear) {
      const gaps: BeltGap[] = KIRKWOOD.map(([resonance, p, q]) => ({
        resonance,
        semiMajorAxisAu: resonanceSemiMajorAxisAu(aGiant, p, q),
        widthAu: 0.02 * resonanceSemiMajorAxisAu(aGiant, p, q),
      })).filter((gap) => gap.semiMajorAxisAu > innerAu && gap.semiMajorAxisAu < outerAu);
      belts.push({
        kind: 'main',
        innerAu,
        outerAu,
        gaps,
        resonantPopulations: [],
        inclinationDispersionRad: rng.range(6, 12) * DEG,
      });
    }
  }

  const outermost = planets[planets.length - 1];
  if (outermost && rng.bool(0.9)) {
    const innerAu = outermost.slot.aAu * 1.15;
    belts.push({
      kind: 'outer',
      innerAu,
      outerAu: innerAu * rng.range(1.4, 1.8),
      gaps: [],
      resonantPopulations: [
        {
          resonance: '3:2',
          semiMajorAxisAu: outermost.slot.aAu * (3 / 2) ** (2 / 3),
        },
      ],
      inclinationDispersionRad: rng.range(8, 20) * DEG,
    });
  }

  return belts;
}

export function generateReservoirs(rng: Rng, planets: StablePlanet[]): Reservoirs {
  const outermostAu = planets.length > 0 ? planets[planets.length - 1].slot.aAu : 5;
  const scatteredDiscInnerAu = outermostAu * rng.range(1.6, 2.2);
  return {
    scatteredDiscInnerAu,
    oortInnerAu: rng.range(2000, 5000),
    oortOuterAu: rng.range(30000, 100000),
  };
}
