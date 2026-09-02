import {
  CM_PER_PC,
  CM_PER_S_LIGHT,
  ERG_PER_SOLAR_LUMINOSITY,
  MYR,
} from '../../core/physics/constants';

/**
 * Photoionization equilibrium: the scale on which a hot star's ionizing
 * output is used up by the gas around it. The nebula's structure comes
 * from marching this budget through the real density field; this is
 * the closed form the march has to agree with in a uniform medium.
 */

/** Case B recombination coefficient at 10⁴ K, cm³ s⁻¹. */
export const ALPHA_B = 2.59e-13;
/** Recombinations per steradian carried by one cm⁻⁶ over a pc³ shell:
 *  what a march spends its budget in, per step of ray. */
export const RECOMBINATION_SCALE = ALPHA_B * CM_PER_PC ** 3;
/**
 * How far past the evolved bubble radius the front can possibly reach.
 * Density only rises toward the source, so a ray runs furthest down
 * the thinnest channel it can find — measured at three to four times
 * the mean front, so five bounds it with margin — and a point beyond
 * this is neutral without needing a march to say so.
 */
export const IONIZATION_REACH = 5;

/**
 * Hβ luminosity of an ionization-bounded nebula, erg s⁻¹: every
 * ionizing photon is eventually answered by a recombination, and a
 * fixed share of those recombinations cascade through Hβ. So a
 * nebula's brightness is not a free parameter — it is its star's
 * ionizing output, converted.
 *
 * Q × (α_Hβ^eff / α_B) × hν(4861 Å), with α_Hβ^eff = 3.03e-14 cm³ s⁻¹
 * at 10⁴ K.
 */
export const HBETA_PER_IONIZING_PHOTON = (3.03e-14 / ALPHA_B) * 4.09e-12;

export function hydrogenBetaLuminosity(photonRate: number): number {
  return Math.max(0, photonRate) * HBETA_PER_IONIZING_PHOTON;
}

/**
 * Strömgren radius, pc: where recombinations inside the sphere exactly
 * consume the source's ionizing photons. Case B — recombinations
 * straight to the ground state emit a photon that ionizes again
 * nearby, so they do not count against the budget.
 */
export function stromgrenRadiusPc(photonRate: number, hydrogenDensity: number): number {
  if (photonRate <= 0 || hydrogenDensity <= 0) return 0;
  const radiusCm =
    ((3 * photonRate) / (4 * Math.PI * ALPHA_B * hydrogenDensity * hydrogenDensity)) ** (1 / 3);
  return radiusCm / CM_PER_PC;
}

/** Sound speed of 10⁴ K ionized gas, the piston of the expansion:
 *  ~10 km/s, in the pc/Myr this file thinks in. */
const IONIZED_SOUND_SPEED_PC_PER_MYR = 10.2;

/**
 * The region's radius at its age, pc: Spitzer's D-type expansion.
 *
 * A front does not sit at its natal Strömgren radius — the ionized gas
 * is ten thousand kelvin against a cold cloud, overpressured by orders
 * of magnitude, and it shovels the neutral gas outward behind a shock:
 * R(t) = R_s (1 + 7 c_i t / 4 R_s)^{4/7}. The interior dilutes as it
 * grows — ionization balance holds n ∝ R^{-3/2}, so the same photon
 * budget fills the whole expanded volume exactly — which is why an
 * evolved region is a great glowing shell and not a pinprick. Winds
 * and supernovae push harder still past a few Myr; this is the floor.
 */
export function spitzerRadiusPc(stromgrenPc: number, ageMyr: number): number {
  if (stromgrenPc <= 0) return 0;
  if (ageMyr <= 0) return stromgrenPc;
  const driven = (7 * IONIZED_SOUND_SPEED_PC_PER_MYR * ageMyr) / (4 * stromgrenPc);
  return stromgrenPc * (1 + driven) ** (4 / 7);
}

/** Share of the star's radiative momentum its line-driven wind carries
 *  (Ṁv∞ ≈ η L/c): about a third for an O star, collapsing through the
 *  weak-wind regime below ~30 kK — line driving needs the UV. */
function windMomentumShare(tEff: number): number {
  return 0.3 * Math.max(0, Math.min(1, (tEff - 18000) / 12000));
}

/** g cm⁻³ per hydrogen nucleus per cm³, helium included. */
const GRAMS_PER_HYDROGEN = 1.4 * 1.6726e-24;

/** Terminal momentum one core-collapse supernova hands its
 *  surroundings once the remnant goes radiative, g cm s⁻¹ — nearly
 *  independent of the density it happens in, which is what makes it
 *  the honest currency of supernova feedback. */
export const SUPERNOVA_MOMENTUM = 3e43;

/**
 * The swept cavity inside the region at its age, pc.
 *
 * The star's wind — and every supernova the group has already had —
 * sweeps the ionized interior into a shell around a near-empty bubble,
 * which is why an evolved H II region is a ring in Hα, not a filled
 * disc, and an old one a blown shell. Weaver's energy-driven solution
 * famously overruns what is observed (the bubbles leak); the momentum
 * snowplow is the leaky limit and lands where the surveys put
 * cavities. Total momentum P = ṗ t + N · p_SN with ṗ = η L / c swept
 * into a shell of the interior density gives R = (3 P t / 2π ρ)^¼.
 * A single supernova outweighs the whole wind's ṗ t sixtyfold, so a
 * group's first death is what blows its region open.
 */
export function sweptCavityRadiusPc(
  luminositySolar: number,
  tEff: number,
  ageMyr: number,
  hydrogenDensity: number,
  supernovae = 0,
): number {
  if (ageMyr <= 0 || hydrogenDensity <= 0) return 0;
  const share = windMomentumShare(tEff);
  const windFlux =
    share > 0 && luminositySolar > 0
      ? (share * luminositySolar * ERG_PER_SOLAR_LUMINOSITY) / CM_PER_S_LIGHT
      : 0;
  const seconds = ageMyr * MYR;
  const momentum = windFlux * seconds + supernovae * SUPERNOVA_MOMENTUM;
  if (momentum <= 0) return 0;
  const density = hydrogenDensity * GRAMS_PER_HYDROGEN;
  const radiusCm = ((3 * momentum * seconds) / (2 * Math.PI * density)) ** 0.25;
  return radiusCm / CM_PER_PC;
}

/**
 * The structure an evolved region leaves in its cloud — shared by the
 * model, the bake and the sprite so every rendering re-plumbs the
 * cloud the same way.
 */

/** Fraction of the front radius the swept shell spans. */
export const SHELL_WIDTH = 0.12;
/**
 * How deep the ionization front eats into its swept shell, as a share
 * of the shell's own width. The skin is where most recombinations
 * actually happen — the bright rim of every real region — and it is
 * what puts the glow on the *directional* front the budget march
 * carves, rather than leaving all the light to the spherical wind
 * wall inside it.
 */
export const SHELL_SKIN_SHARE = 0.35;
/** Peak overdensity of a fully swept shell: the mass the expansion
 *  cleared from the bubble, spread over that width — R/(3ΔR) of it. */
const SHELL_COMPRESSION = 3;

/** How much a swept shell actually piles up: nothing when the region
 *  has barely left its natal radius, the full compression once the
 *  interior mass is gone. */
export function sweptShellBoost(dilution: number): number {
  return 1 + (SHELL_COMPRESSION - 1) * (1 - dilution);
}

/** How much thinner in dust an ionized region is than the neutral gas
 *  around it. Models and infrared observations of H II regions put this
 *  at a few, not the near-total removal a clean cavity would imply. */
export const DUST_DEPLETION = 5;

/** Fraction of the wind cavity's radius its swept wall spans. */
export const WIND_WALL_WIDTH = 0.15;
/** What the wind leaves behind it: shocked gas at millions of kelvin
 *  and a hundredth the density — X-ray bright, optically nothing. */
export const WIND_CAVITY_RESIDUAL = 0.02;
/** The cavity's gas piled into its wall, by mass: what turns a filled
 *  disc into the ring an evolved region actually is — the emission
 *  goes as n², so the compressed wall is where the light concentrates
 *  while the total stays pinned to the ionizing budget by the finish. */
export const WIND_WALL_BOOST =
  1 + (1 - WIND_CAVITY_RESIDUAL) / ((1 + WIND_WALL_WIDTH) ** 3 - 1);

/**
 * Champagne venting: ten-thousand-kelvin gas is held together by the
 * cloud around it, and where the bubble has outrun the cloud's own
 * body there is nothing left to hold — the ionized gas streams out
 * and thins. Quasi-static, like the rest of the region's structure:
 * the interior keeps its density only where the natal field at that
 * place could confine it, ramping down to a streaming residue where
 * the cloud is gone. Because the gate is the cloud's own carved
 * boundary, a region on a cloud's face opens into the horseshoe a
 * blister actually is.
 */
export const VENT_RESIDUAL = 0.05;
/** Ambient natal density that fully confines, in units of the diluted
 *  interior's own density. */
export const VENT_CONFINEMENT = 1;
