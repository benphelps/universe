import { ERG_PER_SOLAR_LUMINOSITY } from '../../core/physics/constants';
import { powerLaw } from '../../core/rng/distributions';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { evolve } from '../star/evolution';
import { ionizingPhotonRate } from '../star/ionizing';
import { NEBULA_MEAN_U, nebulaLineSum } from './nebulaLines';
import {
  cloudDustFactor,
  cloudHalfExtentsPc,
  cloudLocalDensity,
  cloudReachPc,
  cloudsNear,
  type MolecularCloud,
} from './clouds';
import { DUST_ALBEDO, DUST_OPACITY_PER_PC, type GalacticPosition } from './density';
import { cloudHydrogenDensity, hydrogenDensity } from './gas';
import { ismMetallicity } from './population';
import {
  DUST_DEPLETION,
  hydrogenBetaLuminosity,
  IONIZATION_REACH,
  RECOMBINATION_SCALE,
  SHELL_SKIN_SHARE,
  SHELL_WIDTH,
  spitzerRadiusPc,
  stromgrenRadiusPc,
  sweptCavityRadiusPc,
  sweptShellBoost,
  VENT_CONFINEMENT,
  ventResidual,
  WIND_CAVITY_RESIDUAL,
  WIND_REACH,
  WIND_STALL,
  WIND_WALL_BOOST,
  WIND_WALL_WIDTH,
} from './ionization';

/**
 * A nebula is a molecular cloud lit by the stars it just formed, and it
 * is that whoever is looking and from wherever — so it is built from
 * the cloud alone, never from a viewpoint. The sky's sprite is one
 * rendering of this object; the volume is another.
 *
 * The natal group is drawn here, once, and everything downstream reads
 * the same members: the sky pushes the visible ones into the catalog,
 * and the ionization bake takes the hot ones as its sources.
 */

/** One star of the natal group, placed in the cloud's own frame. */
export interface NebulaMember {
  dxPc: number;
  dyPc: number;
  dzPc: number;
  /** L☉. */
  luminosity: number;
  /** K. */
  tEff: number;
  /** R☉. */
  radiusSolar: number;
}

/** A member hot enough to ionize the gas it was born in. */
export interface IonizingSource extends NebulaMember {
  /** Hydrogen-ionizing photons per second. */
  photonRate: number;
}

/**
 * What the cloud is doing with the light it holds: emitting its own
 * lines where the gas is ionized, merely scattering starlight where it
 * is not, and dark where nothing luminous formed at all.
 */
export type NebulaKind = 'emission' | 'reflection' | 'dark';

export interface Nebula {
  /** The natal cloud: this object's identity, name, and density field. */
  cloud: MolecularCloud;
  ageGyr: number;
  members: NebulaMember[];
  /** The ionizing members, brightest first — the bake's light sources. */
  sources: IonizingSource[];
  maxTeff: number;
  /** L☉, over every member whether or not it can be seen. */
  totalLuminosity: number;
  /** The group's ionizing output, photons s⁻¹. */
  photonRate: number;
  /** [Fe/H] of the gas here, which sets its dust-to-gas. */
  metallicity: number;
  /** The gas the ionizing stars actually sit in, cm⁻³ — a single
   *  sample at the geometric centre can land in a carved void. */
  sourceHydrogenDensity: number;
  /** The group's Strömgren radius in the core density, pc. */
  stromgrenRadiusPc: number;
  /** The ionized region at the group's age, pc: the natal front driven
   *  out by Spitzer expansion, bounded by the cloud that feeds it. */
  bubbleRadiusPc: number;
  /** The swept cavity inside it, pc — the wind's work plus every
   *  supernova's, zero only for groups with neither. What makes an
   *  evolved region a ring rather than a filled disc, and an old one
   *  a blown shell. */
  windCavityPc: number;
  /** Core-collapse deaths the group has already had: members drawn
   *  past their lifetime, struck from the light and counted here. */
  supernovae: number;
  kind: NebulaKind;
  /** Half-extents of the density field, pc — the volume's bounds. */
  halfExtentsPc: [number, number, number];
  /** Dust per unit of the cloud's local field where it sits — the
   *  disk's dust at that place, constant over the cloud, lifted out of
   *  every march through it. */
  dustFactor: number;
  /** The front's radius in each of FRONT_DIRECTIONS, pc: the group's
   *  budget spent along that ray through the natal field in contracted
   *  coordinates, exactly as the bake spends it, so the region's
   *  directional shape — venting down thin channels, stalling against
   *  dense ones — is known wherever a per-cell march is too dear.
   *  Empty when nothing ionizes. */
  frontPc: Float32Array;
  /** Where each ray's flow left the body, pc: the last radius before
   *  the front at which the natal cloud still confined the interior.
   *  Beyond it the champagne residue thins as the flow diverges. */
  ventPc: Float32Array;
  /** The farthest any marched ray reaches, pc: beyond it the cloud
   *  stands natal, and a read there need not ask which ray. */
  frontReachPc: number;
  /** The share of the group's continuum its dust catches and sends
   *  back out, at first order: the cloud's re-plumbed dust marched
   *  from the illuminant with the same flux floor the volume shines
   *  with, times the grains' albedo. What decides whether the object
   *  is a reflection nebula at all, and the scatter budget every
   *  rendering of it spends. */
  scatteredShare: number;
}

/** Directions the front and the interception are marched along, and
 *  the steps each ray takes: a few thousand field reads per nebula,
 *  comparable to drawing its group. */
export const FRONT_DIRECTIONS = 64;
const FRONT_STEPS = 64;

/** A Fibonacci sphere of unit vectors, xyz per direction. */
const FRONT_AXES: Float32Array = (() => {
  const axes = new Float32Array(FRONT_DIRECTIONS * 3);
  for (let i = 0; i < FRONT_DIRECTIONS; i++) {
    const z = 1 - (2 * i + 1) / FRONT_DIRECTIONS;
    const ring = Math.sqrt(1 - z * z);
    const azimuth = i * 2.399963;
    axes[i * 3] = ring * Math.cos(azimuth);
    axes[i * 3 + 1] = ring * Math.sin(azimuth);
    axes[i * 3 + 2] = z;
  }
  return axes;
})();

/** Which marched ray is nearest each cell of a latitude–longitude
 *  grid, so a lookup is one index rather than a search. */
export const FRONT_LOOKUP_COLS = 48;
export const FRONT_LOOKUP_ROWS = 24;
export const FRONT_LOOKUP: Uint8Array = (() => {
  const lookup = new Uint8Array(FRONT_LOOKUP_COLS * FRONT_LOOKUP_ROWS);
  for (let row = 0; row < FRONT_LOOKUP_ROWS; row++) {
    const latitude = ((row + 0.5) / FRONT_LOOKUP_ROWS - 0.5) * Math.PI;
    for (let col = 0; col < FRONT_LOOKUP_COLS; col++) {
      const longitude = ((col + 0.5) / FRONT_LOOKUP_COLS) * 2 * Math.PI;
      const ux = Math.cos(latitude) * Math.cos(longitude);
      const uy = Math.cos(latitude) * Math.sin(longitude);
      const uz = Math.sin(latitude);
      let best = -2;
      for (let i = 0; i < FRONT_DIRECTIONS; i++) {
        const along =
          ux * FRONT_AXES[i * 3] + uy * FRONT_AXES[i * 3 + 1] + uz * FRONT_AXES[i * 3 + 2];
        if (along > best) {
          best = along;
          lookup[row * FRONT_LOOKUP_COLS + col] = i;
        }
      }
    }
  }
  return lookup;
})();

/** The marched ray nearest a direction from the source. */
function nebulaRayToward(ux: number, uy: number, uz: number): number {
  const row = Math.min(
    FRONT_LOOKUP_ROWS - 1,
    Math.floor((Math.asin(Math.max(-1, Math.min(1, uz))) / Math.PI + 0.5) * FRONT_LOOKUP_ROWS),
  );
  let longitude = Math.atan2(uy, ux);
  if (longitude < 0) longitude += 2 * Math.PI;
  const col = Math.min(FRONT_LOOKUP_COLS - 1, Math.floor((longitude / (2 * Math.PI)) * FRONT_LOOKUP_COLS));
  return FRONT_LOOKUP[row * FRONT_LOOKUP_COLS + col];
}

/**
 * Where the front stands along each sample direction, and where the
 * flow vents: the natal field read in contracted coordinates,
 * recombinations in the ray's own solid angle summed until the group's
 * photons are spent — the bake's budget integral, one ray per
 * direction — and the last radius before the front at which the
 * uncontracted cloud still confined the interior. A ray that never
 * spends its budget within the reach a front can have stands at that
 * reach.
 */
function marchFront(nebula: Nebula): { front: Float32Array; vent: Float32Array } {
  const front = new Float32Array(FRONT_DIRECTIONS);
  const vent = new Float32Array(FRONT_DIRECTIONS);
  const source = nebula.sources[0];
  if (!source || nebula.bubbleRadiusPc <= 0) return { front, vent };
  const { cloud } = nebula;
  const { growth, dilution } = nebulaGrowth(nebula);
  const budget = nebula.photonRate / (4 * Math.PI);
  const reach = IONIZATION_REACH * nebula.bubbleRadiusPc;
  const ds = reach / FRONT_STEPS;
  const confining = VENT_CONFINEMENT * nebula.sourceHydrogenDensity * dilution;
  const hydrogenAt = (r: number, ux: number, uy: number, uz: number): number =>
    hydrogenDensity(
      cloudLocalDensity(cloud, source.dxPc + ux * r, source.dyPc + uy * r, source.dzPc + uz * r) *
        nebula.dustFactor,
      nebula.metallicity,
    );
  for (let i = 0; i < FRONT_DIRECTIONS; i++) {
    const ux = FRONT_AXES[i * 3];
    const uy = FRONT_AXES[i * 3 + 1];
    const uz = FRONT_AXES[i * 3 + 2];
    let recombined = 0;
    front[i] = reach;
    for (let s = 0; s < FRONT_STEPS; s++) {
      const r = (s + 0.5) * ds;
      const rn = r / growth;
      const n = hydrogenAt(rn, ux, uy, uz);
      recombined += n * n * RECOMBINATION_SCALE * rn * rn * (ds / growth);
      if (recombined >= budget) {
        front[i] = r;
        break;
      }
      if (hydrogenAt(r, ux, uy, uz) >= confining) vent[i] = r;
    }
  }
  return { front, vent };
}

/** The spread of the natal group about its cloud's centre, as a
 *  fraction of the cloud radius — where the members are drawn, and
 *  the size the group's light shines from as a source. */
export const MEMBER_SPREAD = 0.35;

/** Spitzer growth: the front at the group's age is the natal front
 *  scaled by this factor, its interior diluted by growth^{-3/2} —
 *  which conserves the recombination budget exactly (n²V invariant),
 *  so the natal march read in contracted coordinates IS the evolved
 *  region. */
export function nebulaGrowth(nebula: Nebula): { growth: number; dilution: number } {
  const stromgren = nebula.stromgrenRadiusPc;
  const growth = stromgren > 0 ? Math.max(1, nebula.bubbleRadiusPc / stromgren) : 1;
  return { growth, dilution: growth ** -1.5 };
}

/**
 * What stands at a point of the cloud's frame now that the region has
 * re-plumbed it: the natal cloud outside the bubble, piled into a
 * swept shell just past the front with the front's ionized skin eating
 * into it; inside, the diluted interior read from its natal position,
 * hollowed by the wind into a cavity and its wall, and thinned of dust
 * as ionized gas is. The front stands where the marched ray toward
 * this point put it; the bake breaks it finer against the real field,
 * cell by cell — this is the same object where that is too dear.
 */
export function nebulaGasAt(
  nebula: Nebula,
  xPc: number,
  yPc: number,
  zPc: number,
): { dust: number; ionized: number } {
  const { cloud, dustFactor } = nebula;
  const source = nebula.sources[0];
  if (!source || nebula.bubbleRadiusPc <= 0) {
    return { dust: cloudLocalDensity(cloud, xPc, yPc, zPc) * dustFactor, ionized: 0 };
  }
  const dx = xPc - source.dxPc;
  const dy = yPc - source.dyPc;
  const dz = zPc - source.dzPc;
  const r = Math.hypot(dx, dy, dz);
  // Past every ray's front and its shell, the skin has died away and
  // the cloud is simply itself.
  if (r > nebula.frontReachPc * 1.5) {
    return { dust: cloudLocalDensity(cloud, xPc, yPc, zPc) * dustFactor, ionized: 0 };
  }
  const ray = r > 0 ? nebulaRayToward(dx / r, dy / r, dz / r) : -1;
  const bubble = ray >= 0 ? nebula.frontPc[ray] : nebula.bubbleRadiusPc;
  const { growth, dilution } = nebulaGrowth(nebula);
  if (r < bubble) {
    const contracted = 1 / growth;
    const natal =
      cloudLocalDensity(
        cloud,
        source.dxPc + dx * contracted,
        source.dyPc + dy * contracted,
        source.dzPc + dz * contracted,
      ) *
      dustFactor *
      dilution;
    // The cavity toward this point: the mean radius eroded to the −¼
    // against the interior the wind ploughed in this direction.
    let cavity = nebula.windCavityPc;
    if (cavity > 0 && r > 0) {
      const rc = cavity / growth / r;
      const ploughed = hydrogenDensity(
        cloudLocalDensity(cloud, source.dxPc + dx * rc, source.dyPc + dy * rc, source.dzPc + dz * rc) *
          dustFactor,
        nebula.metallicity,
      );
      cavity *= Math.min(
        WIND_REACH,
        Math.max(WIND_STALL, (nebula.sourceHydrogenDensity / Math.max(1e-6, ploughed)) ** 0.25),
      );
    }
    const wind =
      r < cavity ? WIND_CAVITY_RESIDUAL : r <= cavity * (1 + WIND_WALL_WIDTH) ? WIND_WALL_BOOST : 1;
    // The champagne gate: the interior holds its density only where
    // the cloud at this very place could confine it, and streams to a
    // residue where the bubble has outrun the body — a residue that
    // thins past the opening this ray's flow left through.
    const confining = VENT_CONFINEMENT * nebula.sourceHydrogenDensity * dilution;
    const confinement =
      confining > 0
        ? Math.max(
            ventResidual(ray >= 0 ? nebula.ventPc[ray] : 0, r),
            Math.min(
              1,
              hydrogenDensity(
                cloudLocalDensity(cloud, xPc, yPc, zPc) * dustFactor,
                nebula.metallicity,
              ) / confining,
            ),
          )
        : 1;
    const dust = natal * wind * confinement;
    return { dust: dust / DUST_DEPLETION, ionized: hydrogenDensity(dust, nebula.metallicity) };
  }
  const swept = r <= bubble * (1 + SHELL_WIDTH) ? sweptShellBoost(dilution) : 1;
  const dust = cloudLocalDensity(cloud, xPc, yPc, zPc) * dustFactor * swept;
  const skin = Math.exp(-(r - bubble) / (SHELL_SKIN_SHARE * SHELL_WIDTH * bubble));
  return {
    dust: dust / (1 + (DUST_DEPLETION - 1) * skin),
    ionized: hydrogenDensity(dust, nebula.metallicity) * skin,
  };
}

/** The star whose light the dust scatters: the ionizing star when one
 *  stands, else the brightest of the natal group — every renderer's
 *  single illuminant, so the sprite and the volume agree on it. */
export function nebulaIlluminant(nebula: Nebula): NebulaMember | undefined {
  return (
    nebula.sources[0] ??
    nebula.members.reduce(
      (best, member) => (member.luminosity > (best?.luminosity ?? 0) ? member : best),
      undefined as NebulaMember | undefined,
    )
  );
}

/** The group's total optical line output, L☉: its ionizing budget
 *  answered in recombinations, carrying every line the grid holds at
 *  this group's own star and gas. */
export function nebulaLineLuminositySolar(nebula: Nebula): number {
  return (
    (hydrogenBetaLuminosity(nebula.photonRate) *
      nebulaLineSum(NEBULA_MEAN_U, nebula.maxTeff, nebula.metallicity)) /
    ERG_PER_SOLAR_LUMINOSITY
  );
}

/** The group's continuum the dust sends back out, L☉. */
export function nebulaScatteredSolar(nebula: Nebula): number {
  return nebula.scatteredShare * nebula.totalLuminosity;
}

/** Everything a lit cloud sends out, L☉: its lines plus the share of
 *  the group's continuum the dust catches and rescatters. The budget
 *  every rendering of the object spends — the sprite's flux closure
 *  and the volume's emission and scatter books draw on the same two
 *  terms. */
export function nebulaLightSolar(nebula: Nebula): number {
  return nebulaLineLuminositySolar(nebula) + nebulaScatteredSolar(nebula);
}

/**
 * The share of the group's light its dust intercepts and scatters, at
 * first order: from the illuminant outward, the re-plumbed dust's
 * opacity through the beam's own attenuation, over the flux a source
 * spread like the group delivers — the volume's scatter integrand,
 * marched over the whole cloud rather than one box. The higher orders
 * the volume's table adds are what its scatter can exceed this by.
 */
function interceptedShare(nebula: Nebula): number {
  const source = nebulaIlluminant(nebula);
  if (!source) return 0;
  const reach =
    cloudReachPc(nebula.cloud) + Math.hypot(source.dxPc, source.dyPc, source.dzPc);
  const ds = reach / FRONT_STEPS;
  const floorSq = (MEMBER_SPREAD * nebula.cloud.radiusPc) ** 2;
  let caught = 0;
  for (let i = 0; i < FRONT_DIRECTIONS; i++) {
    const ux = FRONT_AXES[i * 3];
    const uy = FRONT_AXES[i * 3 + 1];
    const uz = FRONT_AXES[i * 3 + 2];
    let tau = 0;
    for (let s = 0; s < FRONT_STEPS; s++) {
      const r = (s + 0.5) * ds;
      const { dust } = nebulaGasAt(
        nebula,
        source.dxPc + ux * r,
        source.dyPc + uy * r,
        source.dzPc + uz * r,
      );
      if (dust <= 0) continue;
      // What this step takes out of the beam, exactly — a clump can
      // be many depths thick within one step and still catch no more
      // than all of what arrives.
      const depth = dust * DUST_OPACITY_PER_PC * ds;
      caught += Math.exp(-tau) * -Math.expm1(-depth) * ((r * r) / Math.max(r * r, floorSq));
      tau += depth;
    }
  }
  return (DUST_ALBEDO * caught) / FRONT_DIRECTIONS;
}

/**
 * How much of the light where the object glows is line emission rather
 * than scattered continuum — what decides whether it reads pink or
 * blue. The lines concentrate in the bubble while the scattered
 * continuum spreads over the whole cloud, so the comparison is between
 * surface brightnesses, not totals. A dozen B stars put out tens of
 * thousands of solar luminosities of continuum against tens of line
 * emission and stay a blue reflection complex; an O group's ionizing
 * budget rivals its continuum and the pink takes over its bubble.
 */
export function nebulaEmissionShare(nebula: Nebula): number {
  const lines = nebulaLineLuminositySolar(nebula);
  const concentration = Math.min(
    1,
    (nebula.bubbleRadiusPc / Math.max(...nebula.halfExtentsPc)) ** 2,
  );
  const scattered = nebulaScatteredSolar(nebula) * concentration;
  return lines / (lines + scattered + 1e-12);
}

/** How many places a member is offered before it settles on the
 *  densest of them. */
const MEMBER_PROPOSALS = 6;

/** The lightest star the natal group is drawn down to. */
const MEMBER_MIN_MASS = 1.0;
/** Below this nothing in the group shines on the cloud at all. */
const LUMINOUS_TEFF = 6500;
/** An ionized region at least this big is an H II region and the cloud
 *  emits its own lines; below it the group only lights a cocoon, and
 *  what escapes the cloud is scattered starlight. Absolute, not a
 *  fraction of the cloud: a compact H II region inside a great cloud
 *  is still an emission nebula. */
const EMISSION_RADIUS_PC = 0.5;
/** A group's ionizing output is the top of its mass function and
 *  nothing else — Q runs eleven decades from a B star to an O star. The
 *  total keeps every contribution; the source list keeps the ones a
 *  shadow ray would notice. */
const SOURCE_SHARE_FLOOR = 1e-3;

const cache = new Map<bigint, Nebula | null>();

/**
 * The nebula a cloud is, or null if it is not forming stars. Cached on
 * the cloud's seed: the sky, the sprite atlas and the volume tier all
 * ask for the same object.
 */
export function nebulaFor(cloud: MolecularCloud): Nebula | null {
  const cached = cache.get(cloud.seed);
  if (cached !== undefined) return cached;
  const nebula = buildNebula(cloud);
  cache.set(cloud.seed, nebula);
  if (cache.size > 4096) cache.clear();
  return nebula;
}

/** Every nebula within reach of a point — the camera's, not a system's. */
export function nebulaeNear(positionPc: GalacticPosition, radiusPc: number): Nebula[] {
  const found: Nebula[] = [];
  for (const cloud of cloudsNear(positionPc, radiusPc)) {
    const nebula = nebulaFor(cloud);
    if (nebula) found.push(nebula);
  }
  return found;
}

function buildNebula(cloud: MolecularCloud): Nebula | null {
  const rng = new Rng(deriveSeed(cloud.seed, 'formation'));
  // Bigger clouds are likelier to be forming stars right now.
  if (rng.float() > 0.1 + cloud.radiusPc / 170) return null;

  const ageGyr = rng.range(0.0015, 0.012);
  const tries = Math.min(240, Math.round(cloud.radiusPc ** 1.5 * rng.range(0.4, 1.1)));
  const spreadPc = cloud.radiusPc * MEMBER_SPREAD;

  const members: NebulaMember[] = [];
  const sources: IonizingSource[] = [];
  let maxTeff = 0;
  let totalLuminosity = 0;
  let photonRate = 0;
  let supernovae = 0;
  for (let i = 0; i < tries; i++) {
    // Stars form where the gas is, not on a sphere about the middle:
    // the densest of a few proposals wins, so the group traces its
    // cloud's own filaments and its hot stars stand in the gas they go
    // on to ionize. Ranked rather than accept-or-reject, because a
    // carved field's densities are a small fraction of its peak and an
    // acceptance test against that peak would almost never fire.
    let dxPc = 0;
    let dyPc = 0;
    let dzPc = 0;
    let densest = -1;
    for (let attempt = 0; attempt < MEMBER_PROPOSALS; attempt++) {
      const x = rng.normal(0, spreadPc);
      const y = rng.normal(0, spreadPc);
      const z = rng.normal(0, spreadPc * 0.7);
      const density = cloudLocalDensity(cloud, x, y, z);
      if (density > densest) {
        densest = density;
        dxPc = x;
        dyPc = y;
        dzPc = z;
      }
    }
    const physical = evolve(powerLaw(rng, 2.3, MEMBER_MIN_MASS, 60), ageGyr);
    // A member that has already died is not a member any more: a
    // remnant is dark at these scales and its million-kelvin cooling
    // track has no business setting the group's hue or its ionizing
    // budget. What it leaves the region is its supernova.
    if (physical.stage === 'neutron-star' || physical.stage === 'black-hole') {
      supernovae++;
      continue;
    }
    const member: NebulaMember = {
      dxPc,
      dyPc,
      dzPc,
      luminosity: physical.luminosity,
      tEff: physical.tEff,
      radiusSolar: physical.radius,
    };
    members.push(member);
    totalLuminosity += physical.luminosity;
    if (physical.tEff > maxTeff) maxTeff = physical.tEff;
    const rate = ionizingPhotonRate(physical.tEff, physical.radius);
    if (rate > 0) {
      sources.push({ ...member, photonRate: rate });
      photonRate += rate;
    }
  }
  sources.sort((a, b) => b.photonRate - a.photonRate);
  const floor = (sources[0]?.photonRate ?? 0) * SOURCE_SHARE_FLOOR;
  const lighting = sources.filter((source) => source.photonRate >= floor);

  const metallicity = ismMetallicity(cloud.positionPc);
  const sourceHydrogenDensity = lighting.length
    ? lighting.reduce(
        (sum, s) => sum + cloudHydrogenDensity(cloud, s.dxPc, s.dyPc, s.dzPc, metallicity),
        0,
      ) / lighting.length
    : cloudHydrogenDensity(cloud, 0, 0, 0, metallicity);
  const stromgren = stromgrenRadiusPc(photonRate, sourceHydrogenDensity);
  const halfExtentsPc = cloudHalfExtentsPc(cloud);
  // An 11 Myr region is not its natal pinprick: the front has been
  // driven out for its whole age. The cloud bounds what it can light.
  const bubbleRadiusPc = Math.min(
    spitzerRadiusPc(stromgren, ageGyr * 1000),
    Math.max(...halfExtentsPc),
  );
  // The wind — and every supernova the group has had — ploughs the
  // *diluted* interior the expansion left behind. Capped just inside
  // the front: a supernova-driven shell catches the ionization front
  // and merges with it, leaving the thin bright shell a superbubble
  // actually shows rather than overrunning the region outright.
  const growth = stromgren > 0 ? Math.max(1, bubbleRadiusPc / stromgren) : 1;
  const windCavityPc = Math.min(
    sweptCavityRadiusPc(
      lighting[0]?.luminosity ?? 0,
      lighting[0]?.tEff ?? 0,
      ageGyr * 1000,
      sourceHydrogenDensity * growth ** -1.5,
      supernovae,
    ),
    0.9 * bubbleRadiusPc,
  );
  const nebula: Nebula = {
    cloud,
    ageGyr,
    members,
    sources: lighting,
    maxTeff,
    totalLuminosity,
    photonRate,
    metallicity,
    sourceHydrogenDensity,
    stromgrenRadiusPc: stromgren,
    bubbleRadiusPc,
    windCavityPc,
    supernovae,
    kind:
      maxTeff < LUMINOUS_TEFF
        ? 'dark'
        : bubbleRadiusPc > EMISSION_RADIUS_PC
          ? 'emission'
          : 'reflection',
    halfExtentsPc,
    dustFactor: cloudDustFactor(cloud),
    frontPc: new Float32Array(),
    ventPc: new Float32Array(),
    frontReachPc: 0,
    scatteredShare: 0,
  };
  const { front, vent } = marchFront(nebula);
  nebula.frontPc = front;
  nebula.ventPc = vent;
  nebula.frontReachPc = nebula.frontPc.reduce((best, front) => Math.max(best, front), 0);
  nebula.scatteredShare = interceptedShare(nebula);
  return nebula;
}
