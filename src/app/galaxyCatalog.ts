/**
 * Four galaxies worth standing in the middle of.
 *
 * Every 64-bit seed names a whole galaxy, and the hole at its centre
 * follows from the bulge that galaxy happens to have grown. Two things
 * decide what the traveler will see there, and the catalogue is built
 * across both. The first is the regime: above a percent of Eddington
 * the gas cools into a thin disc, below it the flow puffs into a hot
 * torus you can see the sky through. The second is temperature at the
 * inner edge, and it is not free — T goes as (ṁ/M)^¼, so a hole heavy
 * enough to cast a shadow across Saturn's orbit cannot have a hot disc
 * and a light one cannot have a cold one. Cold and hot are therefore
 * two different sizes of hole, which is the finding, not a confound.
 *
 * Temperature shows as colour rather than as brightness: the tracer
 * sets its exposure from the hottest patch it can reach, so a starving
 * torus and a quasar arrive at the same shutter and it is the hue and
 * the transparency that separate them.
 *
 * None of these were placed. They are the ends of both distributions
 * over six hundred generated galaxies.
 *
 * The figures are carried as data rather than computed because the
 * galaxy seed locks at first use: a session standing in one galaxy
 * cannot generate the nucleus of another to describe it. So they are
 * checked instead — galaxyCatalog.test regenerates every one of them
 * and fails if the catalogue has drifted out of date. Home is carried
 * for that reason and no other: nobody needs to be sold on the galaxy
 * they started in, but a traveler standing somewhere else still has to
 * be able to read its row.
 */

export interface CatalogGalaxy {
  /** The galaxy's seed, and the address the traveler is sent to. */
  galaxy: string;
  /** A system to arrive in; the centre is the same wherever you enter. */
  seed: string;
  massSolar: number;
  spin: number;
  eddingtonRatio: number;
  /** Effective temperature at the flow's inner edge — the cold/hot axis. */
  innerTemperatureK: number;
  /** How much of what is behind the flow it stops. Not shown on the
   *  row, but it is half of why each of these was picked, so it is
   *  carried where the test can hold the model to it. */
  opacity: number;
  regime: 'thin-disc' | 'riaf';
}

/**
 * The galaxy every session boots into, and the hole at the middle of
 * it: a hot torus of middling supply, which is what most galactic
 * centres are doing. Not one of the survey's picks — the one everybody
 * already has.
 */
export const HOME_GALAXY: CatalogGalaxy = {
  galaxy: '53494d5f554e4956',
  seed: '92c174576e06c1d3',
  massSolar: 493150.9,
  spin: 0.890252,
  eddingtonRatio: 3.10965e-6,
  innerTemperatureK: 83315.2,
  opacity: 0.0314618,
  regime: 'riaf',
};

/** The four the survey picked, across regime and temperature. */
export const CATALOG_GALAXIES: CatalogGalaxy[] = [
  {
    // The coldest disc found: forty million suns, so the same
    // dissipated power is spread over an enormous surface and the
    // plate glows at two hundred thousand kelvin rather than a million.
    galaxy: '638fa1989d88dbbc',
    seed: 'dd12e25153ce6361',
    massSolar: 40706410,
    spin: 0.499394,
    eddingtonRatio: 0.0349313,
    innerTemperatureK: 202147,
    opacity: 1,
    regime: 'thin-disc',
  },
  {
    // The hottest: a hole a hundred and fifty times lighter eating a
    // fifth of its Eddington limit, which puts a million and a half
    // kelvin at the inner edge and holds the disc white to its rim.
    galaxy: '9d6bf2111a538d4c',
    seed: '4be7c6760446f0e2',
    massSolar: 260991.4,
    spin: 0.858096,
    eddingtonRatio: 0.216815,
    innerTemperatureK: 1432640,
    opacity: 1,
    regime: 'thin-disc',
  },
  {
    // The coldest torus: a hundred and fifty million suns starving at
    // a billionth of Eddington. Optical depth five ten-thousandths —
    // the far side of the flow, and the sky, show straight through it.
    galaxy: '2869ffa2dfd906df',
    seed: '5e2b91c7a04df386',
    massSolar: 152281200,
    spin: 0.931846,
    eddingtonRatio: 1.04307e-9,
    innerTemperatureK: 2779.56,
    opacity: 0.000523061,
    regime: 'riaf',
  },
  {
    // The hottest: eleven thousand suns, an intermediate-mass hole
    // running at a million kelvin — and still only τ 0.44, so the far
    // side of the torus and the lensed sky both come through it. Hotter
    // flows than this exist, but they are fed hard enough to turn
    // opaque, and a hot flow that hides what is behind it has given up
    // the half of a torus worth looking at.
    galaxy: '62765c1caafc1d12',
    seed: '2f8d05e6c1b74a93',
    massSolar: 11287.87,
    spin: 0.953408,
    eddingtonRatio: 0.00146297,
    innerTemperatureK: 1054830,
    opacity: 0.435826,
    regime: 'riaf',
  },
];
