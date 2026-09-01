import { SOLAR_LUMINOSITY } from '../../core/physics/constants';
import { powerLaw } from '../../core/rng/distributions';
import { deriveSeed } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { evolve } from '../star/evolution';
import { ionizingPhotonRate } from '../star/ionizing';
import { hydrogenBetaLuminosity } from './ionization';
import { nebulaLineSum } from './nebulaLines';
import {
  cloudHalfExtentsPc,
  cloudLocalDensity,
  cloudsNear,
  type MolecularCloud,
} from './clouds';
import type { GalacticPosition } from './density';
import { cloudHydrogenDensity } from './gas';
import { spitzerRadiusPc, stromgrenRadiusPc, sweptCavityRadiusPc } from './ionization';

/** erg s⁻¹ per L☉ — the constants file carries watts. */
const ERG_PER_SOLAR_LUMINOSITY = SOLAR_LUMINOSITY * 1e7;

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

/** Where the group's spectrum sits on the line mixture's hardness
 *  axis, by its hottest star: the whole-object proxy for the
 *  ionization parameter the volume bake works out cell by cell. */
export function nebulaSpectralHardness(maxTeff: number): number {
  return Math.max(0, Math.min(1, (maxTeff - 28000) / 17000));
}

/** The group's total optical line output, L☉: its ionizing budget
 *  answered in recombinations, carrying every line the mixture holds. */
export function nebulaLineLuminositySolar(nebula: Nebula): number {
  return (
    (hydrogenBetaLuminosity(nebula.photonRate) *
      nebulaLineSum(nebulaSpectralHardness(nebula.maxTeff))) /
    ERG_PER_SOLAR_LUMINOSITY
  );
}

/** Fraction of the dust the group's light gets caught by and sent back
 *  out: optical albedo times an order-unity interception. */
const SCATTERED_SHARE_OF_CONTINUUM = 0.3;

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
  const scattered = SCATTERED_SHARE_OF_CONTINUUM * nebula.totalLuminosity * concentration;
  return lines / (lines + scattered + 1e-12);
}
import { ismMetallicity } from './population';

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
  const spreadPc = cloud.radiusPc * 0.35;

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
  return {
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
  };
}
