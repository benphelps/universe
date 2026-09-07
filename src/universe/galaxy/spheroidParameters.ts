import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { galaxyRoot } from './galaxySeed';

export type SpheroidKind = 'classical' | 'pseudo';
let cached: ReturnType<typeof draw> | null = null;
function draw() {
  const rng = new Rng(deriveSeed(galaxyRoot(0x42554c4745n), 'spheroid'));
  const kind: SpheroidKind = rng.float() < 0.62 ? 'pseudo' : 'classical';
  const massFraction = kind === 'pseudo' ? 0.05 * 5 ** rng.float() : 0.12 * (0.42 / 0.12) ** rng.float();
  return { kind, massFraction, sizeScatter: rng.range(0.75, 1.35) };
}

/** Dimensionless seed parameters precede the galaxy mass integration;
 * deriving a bulge fraction must never depend on that total itself. */
export function spheroidParameters(): ReturnType<typeof draw> {
  return cached ??= draw();
}

let clusterCached: { massFraction: number; sizeScatter: number } | null = null;
/** The nuclear cluster is part of the bulge inventory, not extra mass
 * added after B/T has already allocated the galaxy. */
export function nuclearClusterParameters(): { massFraction: number; sizeScatter: number } {
  if (clusterCached) return clusterCached;
  const rng = new Rng(deriveSeed(galaxyRoot(0x4e5343n), 'nuclear-cluster'));
  const massFraction = Math.min(0.1 * spheroidParameters().massFraction, 10 ** rng.normal(-3.3, 0.3));
  return clusterCached = { massFraction, sizeScatter: rng.range(0.7, 1.4) };
}
