import type { Rng } from '../../core/rng/rng';
import { EARTH_MASS } from '../../core/physics/constants';
import { beltCollisionLifetimeMyr } from '../smallbody/inventory';
import { diskSolidsBetween, type DiskModel } from './disk';
import type { StablePlanet } from './stability';
import type { Belt, BeltGap, BeltInventory, FormationInventory, Reservoirs } from './types';

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
 * debris belt beyond the outermost planet. A period commensurability
 * alone does not establish a trapped resonant population.
 */
export function generateBelts(rng: Rng, planets: StablePlanet[], context: {
  disk: DiskModel; formation: FormationInventory; ageGyr: number; centralMassSolar: number;
  innerLimitAu: number; outerLimitAu: number; orbitalExpansion: number;
}): Belt[] {
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
      resonantPopulations: [],
      inclinationDispersionRad: rng.range(8, 20) * DEG,
    });
  }

  const { disk, formation, orbitalExpansion: expansion } = context;
  const remaining = formation.remainingSolidsEarth;
  const allocated: Belt[] = [];
  for (const belt of belts) {
    belt.innerAu = Math.max(belt.innerAu, context.innerLimitAu, .05 * expansion);
    belt.outerAu = Math.min(belt.outerAu, context.outerLimitAu, disk.outerAu * expansion);
    if (!(belt.outerAu > belt.innerAu)) continue;
    belt.gaps = belt.gaps.filter(gap => gap.semiMajorAxisAu > belt.innerAu && gap.semiMajorAxisAu < belt.outerAu);
    // The remaining reservoir is mixed in the original solid column.
    // Disjoint belt intervals receive their share, never a second disk.
    const fraction = diskSolidsBetween(disk, belt.innerAu / expansion, belt.outerAu / expansion) /
      formation.initialSolidsEarth;
    const initialMassEarth = Math.min(formation.remainingSolidsEarth, remaining * fraction);
    if (!(initialMassEarth > 0)) continue;
    const bulkDensityKgM3 = belt.kind === 'main' ? 1800 : 1100;
    const maxDiameterKm = Math.min(belt.kind === 'main' ? 1000 : 2000,
      .5 * Math.cbrt(initialMassEarth * EARTH_MASS / (bulkDensityKgM3 * Math.PI / 6)) / 1000);
    if (!(maxDiameterKm > .1)) continue;
    const inventory: BeltInventory = {
      initialMassEarth, massEarth: initialMassEarth, bulkDensityKgM3,
      minDiameterKm: .1, maxDiameterKm, slope: 2.3, collisionLifetimeMyr: 0,
    };
    // Most of the age precedes white-dwarf mass loss. Do not apply the
    // much slower collision rate of the expanded belt to its whole past.
    inventory.collisionLifetimeMyr = beltCollisionLifetimeMyr({ ...belt,
      innerAu: belt.innerAu / expansion, outerAu: belt.outerAu / expansion,
    }, inventory, context.centralMassSolar * expansion);
    // Self-similar collisional depletion: tc scales inversely with mass.
    inventory.massEarth /= 1 + Math.max(0, context.ageGyr) * 1000 / inventory.collisionLifetimeMyr;
    belt.inventory = inventory;
    formation.remainingSolidsEarth -= initialMassEarth;
    formation.beltMassEarth += inventory.massEarth;
    formation.lostMassEarth += initialMassEarth - inventory.massEarth;
    allocated.push(belt);
  }
  return allocated;
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
