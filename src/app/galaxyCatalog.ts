/**
 * Four galaxies worth standing in the middle of.
 *
 * Every 64-bit seed names a whole galaxy, and the hole at its centre
 * follows from the bulge that galaxy happens to have grown. Two things
 * decide what the traveler will see there, and the catalogue retains
 * examples across both. The first is the regime: above a percent of Eddington
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
 * Which is why the two pairs are not the same pair. Blackbody hue
 * freezes above about thirty thousand kelvin — a flow at two hundred
 * thousand and one at a million and a half are the same blue-white to
 * within a few percent of one channel — so the tori, which straddle
 * that, are a temperature pair and the discs, which are both far above
 * it, cannot be. What separates the two discs is size: hundreds of times
 * the mass, and the same again in the width of the shadow. The temperature is why they are both blue and the mass is
 * what you actually see, and those are the same fact read twice, since
 * a cold disc is nothing but a heavier hole.
 *
 * These seeds were selected from an original survey of six hundred
 * galaxies. Values are regenerated when the physical model changes;
 * the retained seeds are no longer claimed to be its current extremes.
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
  massSolar: 321426.071914,
  spin: 0.890252032216,
  eddingtonRatio: 0.00000310965456797,
  innerTemperatureK: 92725.4364432,
  opacity: 0.0314617936215,
  regime: 'riaf',
};

/** The four the survey picked: two regimes, and within each the axis
 *  that regime can actually show. */
export const CATALOG_GALAXIES: CatalogGalaxy[] = [
  {
    // The retained cool-disc example: tens of millions of suns, so the same
    // dissipated power is spread over an enormous surface and the
    // plate glows at two hundred thousand kelvin rather than a million.
    galaxy: '638fa1989d88dbbc',
    seed: 'dd12e25153ce6361',
    massSolar: 40872246.5742,
    spin: 0.499393919645,
    eddingtonRatio: 0.0349312703002,
    innerTemperatureK: 201941.439834,
    opacity: 1.00000000000,
    regime: 'thin-disc',
  },
  {
    // The other disc, and the axis between them is mass: a hole a
    // few hundred times lighter, so a shadow proportionately
    // narrower, tight and bright where the first is
    // broad. It runs seven times hotter as well — that is what being
    // light means at a fifth of Eddington — but both are far past the
    // temperature where hue stops changing, so that part does not
    // reach the eye.
    galaxy: '9d6bf2111a538d4c',
    seed: '4be7c6760446f0e2',
    massSolar: 168988.337029,
    spin: 0.858096115115,
    eddingtonRatio: 0.216814956190,
    innerTemperatureK: 1597093.78628,
    opacity: 1.00000000000,
    regime: 'thin-disc',
  },
  {
    // The retained cool torus: roughly a hundred million suns starving at
    // a billionth of Eddington. Optical depth five ten-thousandths —
    // the far side of the flow, and the sky, show straight through it.
    galaxy: '2869ffa2dfd906df',
    seed: '5e2b91c7a04df386',
    massSolar: 129852775.149,
    spin: 0.931846025406,
    eddingtonRatio: 1.04306849225e-9,
    innerTemperatureK: 2892.51323422,
    opacity: 0.000523061213176,
    regime: 'riaf',
  },
  {
    // The retained hot torus: thousands of suns, an intermediate-mass hole
    // running at a million kelvin — and still only τ 0.44, so the far
    // side of the torus and the lensed sky both come through it. Hotter
    // flows than this exist, but they are fed hard enough to turn
    // opaque, and a hot flow that hides what is behind it has given up
    // the half of a torus worth looking at.
    galaxy: '62765c1caafc1d12',
    seed: '2f8d05e6c1b74a93',
    massSolar: 7183.52843492,
    spin: 0.953408352584,
    eddingtonRatio: 0.00146296684003,
    innerTemperatureK: 1181003.75826,
    opacity: 0.435825886173,
    regime: 'riaf',
  },
];
