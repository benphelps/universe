/**
 * Galaxies worth standing in the middle of.
 *
 * Every 64-bit seed names a whole galaxy, and the hole at its centre
 * follows from the bulge that galaxy happens to have grown — so the
 * range across seeds is real and wide: quiescent holes at a millionth
 * of their Eddington limit, quasars at a third of it, spins from barely
 * turning to the Thorne limit, masses over four decades. None of these
 * were placed. They were found by generating nine hundred galaxies and
 * keeping the ends of each distribution.
 *
 * The figures are carried as data rather than prose so they can be
 * checked: galaxyCatalog.test recomputes every one of them from the
 * model and fails if the catalogue has drifted out of date.
 */

export interface CatalogGalaxy {
  /** The galaxy's seed, and the address the traveler is sent to. */
  galaxy: string;
  /** A system to arrive in; the centre is the same wherever you enter. */
  seed: string;
  name: string;
  /** What makes this one worth the trip. */
  note: string;
  massSolar: number;
  spin: number;
  eddingtonRatio: number;
  regime: 'thin-disc' | 'riaf';
}

export const CATALOG_GALAXIES: CatalogGalaxy[] = [
  {
    galaxy: '53494d5f554e4956',
    seed: '92c174576e06c1d3',
    name: 'The prime galaxy',
    note: 'the shared one every traveler knows — its centre starving at three parts in a million, a hot ion torus around a shadow, which is what most galaxies are doing',
    massSolar: 493150.9,
    spin: 0.89025,
    eddingtonRatio: 3.1097e-6,
    regime: 'riaf',
  },
  {
    galaxy: '638fa1989c659655',
    seed: 'dd12e25153ce6361',
    name: 'Talaemarou',
    note: 'a quasar: a third of its Eddington limit, two hundred billion suns of light off a disc that reaches almost to the horizon of a fast-spinning hole',
    massSolar: 22681188,
    spin: 0.94230,
    eddingtonRatio: 0.30189,
    regime: 'thin-disc',
  },
  {
    galaxy: '9071115a54694bda',
    seed: '4be7c6760446f0e2',
    name: 'Booraedael',
    note: 'the Thorne limit — a★ 0.998, the fastest a hole can turn, converting thirty-two percent of everything it swallows into light and dragging its shadow into a hard D',
    massSolar: 7854140,
    spin: 0.99772,
    eddingtonRatio: 1.1062e-4,
    regime: 'riaf',
  },
  {
    galaxy: '6ef372fe94f82a00',
    seed: '3b1f8e0c4a92d557',
    name: 'Otheryn',
    note: 'barely turning at all, a★ 0.07 — the round 3√3 shadow Schwarzschild described, and the direct comparison against a hole at the Thorne limit',
    massSolar: 822208,
    spin: 0.070911,
    eddingtonRatio: 1.7123e-3,
    regime: 'riaf',
  },
  {
    galaxy: '48508eadd1f27af2',
    seed: 'a94be70c5e659559',
    name: 'Zeikbael',
    note: 'fed but hardly spinning: a cold disc whose inner edge stands off at 5.7 gravitational radii, so the hole sits small and clear inside a bright plate',
    massSolar: 223120.9,
    spin: 0.085349,
    eddingtonRatio: 0.025011,
    regime: 'thin-disc',
  },
  {
    galaxy: '4426dc6283f3cbf8',
    seed: '7c19a4f0b3d82e16',
    name: 'Nuathrai',
    note: 'a quarter of Eddington onto a slow hole — bright as a quasar and shaped like a static one, which is the pairing that separates what feeding does from what spin does',
    massSolar: 30307646,
    spin: 0.344968,
    eddingtonRatio: 0.242703,
    regime: 'thin-disc',
  },
  {
    galaxy: 'd6acc6e27f5c6f4f',
    seed: '5e2b91c7a04df386',
    name: 'Haemvortha',
    note: 'two hundred million suns, the heaviest found — a shadow twenty astronomical units across, wider than Saturn’s orbit',
    massSolar: 200409508,
    spin: 0.133595,
    eddingtonRatio: 4.8885e-7,
    regime: 'riaf',
  },
  {
    galaxy: '62765c1caafc1d12',
    seed: '2f8d05e6c1b74a93',
    name: 'Kelisvenn',
    note: 'eleven thousand suns, the lightest found — an intermediate-mass hole whose whole shadow would fit inside Neptune',
    massSolar: 11287.9,
    spin: 0.953408,
    eddingtonRatio: 1.4630e-3,
    regime: 'riaf',
  },
];
