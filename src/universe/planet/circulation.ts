import { EARTH_RADIUS } from '../../core/physics/constants';
import { seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Characterization } from './types';

type Rgb = [number, number, number];

export interface CloudBand {
  /** Equatorward and poleward edges, radians (start < end). */
  latStartRad: number;
  latEndRad: number;
  /** Longitude drift relative to the spin frame, radians per day. */
  driftRadPerDay: number;
  /** Shear at the equatorward edge, 0..1 of the planet's strongest. */
  edgeShear: number;
  color: Rgb;
  kind: 'zone' | 'belt';
  /** Decadal fade-and-revival cycle (SEB-style): fresh ammonia decks
   *  bury the belt color, then a revival scours them away. 0 = steady. */
  fadePeriodDays: number;
  fadePhase01: number;
}

/** A recurring storm slot: one anticyclone habit at one latitude band.
 *  The live population at any time is a pure function of (slot, t). */
export interface StormSlot {
  kind: 'oval' | 'spot' | 'eruption';
  band: number;
  periodDays: number;
  lifeDays: number;
  phaseDays: number;
  sizeRad: number;
  driftRadPerDay: number;
  /** Slow meridional wobble of long-lived spots, radians. */
  wobbleRad: number;
  seed: number;
}

export interface ActiveStorm {
  kind: 'oval' | 'spot' | 'eruption';
  latRad: number;
  lonRad: number;
  sizeRad: number;
  /** Ovals and spots: 0 fresh (bright) → 1 aged (chromophore-stained).
   *  Eruptions: how far the fresh white head has spread down its band. */
  age01: number;
}

export interface PolarRegime {
  /** Cap boundary latitude, radians. */
  capStartRad: number;
  cycloneCount: number;
  /** Standing polar-jet wavenumber (the hexagon analog); 0 = none. */
  hexWave: number;
  hoodColor: Rgb;
}

export interface Circulation {
  regime: 'banded' | 'locked';
  /** Zonal-mean wind sampled pole to pole, m/s prograde. */
  uProfileMs: Float32Array;
  bands: CloudBand[];
  storms: StormSlot[];
  /** Index into storms of the long-lived great-spot analog, or −1. */
  spotIndex: number;
  polar: PolarRegime;
  /** 0 = washed out (cold quiet interior) → 1 = vivid. */
  contrast: number;
  /** Bands the physics asked for beyond the shader's macro budget —
   *  rendered as sub-band striping inside the macro bands. */
  fineBandCount: number;
  /** Storm deck colors: fresh upwelling and chromophore-aged. */
  stormFresh: Rgb;
  stormAged: Rgb;
  /** Auroral oval strength 0..1 and dipole tilt from the spin axis. */
  auroraStrength: number;
  auroraTiltRad: number;
  auroraAzimuthRad: number;
  /** Night-side self-luminosity for hot giants, K (0 = dark). */
  thermalGlowK: number;
  /** Locked regime: hotspot longitude east of substellar, radians. */
  hotspotOffsetRad: number;
  /** Zonal cloud-churn decorrelation rate, per day. */
  churnPerDay: number;
}

const LAT_SAMPLES = 181;
export const MAX_BANDS = 14;
export const MAX_ACTIVE_STORMS = 16;

/**
 * The giant's atmosphere as first-class objects, derived once from its
 * physics. The jets are not sampled: a one-shot potential-vorticity
 * mixing spin-up runs at generation — seeded convective stirring
 * homogenizes PV in patches at the local Rhines scale, the staircase
 * that survives IS the jet system (Dritschel–McIntyre), and the wind
 * profile follows by integrating the PV anomaly. Band count, widths,
 * drift, and jet speeds all emerge from rotation and interior heat
 * flux; everything downstream (bands, storm habits, poles) reads them.
 */
export function deriveCirculation(
  physical: Characterization,
  orbitalPeriodDays?: number,
): Circulation {
  const rng = new Rng(seedFromHex(physical.seedHex)).fork('circulation');
  const { rotation, interior, climate, bulk } = physical;

  const radiusM = bulk.radiusEarth * EARTH_RADIUS;
  const omega = (2 * Math.PI) / (Math.max(rotation.periodHours, 1) * 3600);
  // Mixing-length convective velocity from the interior's heat flux:
  // Jupiter's ~5 W/m² gives ~20 m/s; Uranus' ~0.04 barely stirs.
  const convectiveMs = 12 * Math.max(interior.heatFluxWm2, 0.01) ** (1 / 3);
  // Cold quiet interiors wash the deck out; vigorous ones sharpen it.
  const contrast = Math.min(1, 0.15 + 0.85 * Math.min(1, convectiveMs / 18));

  const uProfileMs = spinUpJets(rng.fork('spin-up'), radiusM, omega, convectiveMs, climate);
  const palette = chemistryPalette(rng.fork('chromophores'), climate.equilibriumK);
  const { bands, rawCount } = extractBands(rng.fork('bands'), uProfileMs, radiusM, palette, contrast);
  const { storms, spotIndex } = buildStormCatalog(
    rng.fork('storms'),
    bands,
    convectiveMs,
    climate.equilibriumK,
    orbitalPeriodDays,
  );

  const spinFactor = Math.sqrt(24 / Math.max(rotation.periodHours, 4));
  const polar: PolarRegime = {
    capStartRad: (rng.range(62, 72) * Math.PI) / 180,
    cycloneCount: Math.max(2, Math.min(9, Math.round(2 + 5 * spinFactor * rng.range(0.7, 1.3)))),
    hexWave: rng.bool(0.18) ? 4 + rng.int(4) : 0,
    hoodColor: palette.hood,
  };

  // Aurora wants a dynamo and a magnetosphere to feed it.
  const field = interior.magneticFieldRelEarth;
  const auroraStrength =
    field > 0.5 ? Math.min(1, (field / 8) ** 0.6) * rng.range(0.5, 1) : 0;

  return {
    regime: rotation.locked ? 'locked' : 'banded',
    uProfileMs,
    bands,
    storms,
    spotIndex,
    polar,
    contrast,
    fineBandCount: Math.max(0, rawCount - bands.length),
    stormFresh: palette.stormFresh,
    stormAged: palette.stormAged,
    auroraStrength,
    auroraTiltRad: rng.range(0.05, 0.22),
    auroraAzimuthRad: rng.range(0, 2 * Math.PI),
    thermalGlowK: climate.equilibriumK > 700 ? climate.equilibriumK : 0,
    hotspotOffsetRad: rotation.locked ? rng.range(0.15, 0.7) : 0,
    // Turbulent decorrelation: vigorous decks reshuffle in days.
    churnPerDay: 0.05 + 0.35 * Math.min(1, convectiveMs / 20),
  };
}

/** Latitude of profile sample i, radians. */
export function profileLatRad(i: number): number {
  return -Math.PI / 2 + (Math.PI * i) / (LAT_SAMPLES - 1);
}

/**
 * The spin-up: seeded convective stirring events each homogenize
 * absolute vorticity over a patch about one Rhines length wide (the
 * scale where beta arrests the inverse cascade); the surviving PV
 * staircase is inverted for the zonal wind. Jet count, spacing, and
 * speed are all outputs, not knobs — slow or cold planets mix in a few
 * broad steps, fast hot ones in many narrow ones. A deep equatorial
 * jet from the convective columns is added on top: prograde where the
 * envelope convects vigorously, retrograde on cold sluggish interiors,
 * as the solar system's giants split.
 */
function spinUpJets(
  rng: Rng,
  radiusM: number,
  omega: number,
  convectiveMs: number,
  climate: Characterization['climate'],
): Float32Array {
  const q = new Float64Array(LAT_SAMPLES);
  const area = new Float64Array(LAT_SAMPLES);
  for (let i = 0; i < LAT_SAMPLES; i++) {
    const lat = profileLatRad(i);
    q[i] = 2 * omega * Math.sin(lat);
    area[i] = Math.max(Math.cos(lat), 1e-4);
  }

  // The mixing width follows the flow it creates: patches start at the
  // convective forcing scale, and as the staircase's jets strengthen
  // the Rhines length grows with them, widening later events — the
  // inverse cascade arresting itself. Fast vigorous planets sweep from
  // fine stirring to broad jets; feeble interiors never leave the fine
  // scale.
  const events = 420;
  const targetPeakMs = (30 + 9 * convectiveMs) * rng.range(0.8, 1.25);
  const q0 = Float64Array.from(q);
  for (let e = 0; e < events; e++) {
    // Radiative restoration: between stirrings the PV structure decays
    // back toward planetary, so the staircase equilibrates where the
    // forcing can hold it instead of deepening without bound.
    for (let i = 0; i < LAT_SAMPLES; i++) q[i] += (q0[i] - q[i]) * 0.015;
    // Area-weighted center; width from the local Rhines scale at the
    // EDDY velocity — the arrest happens where the cascading eddies
    // meet the Rossby waves, not at the accumulated jet speed (feeble
    // interiors really do carve many narrow faint bands: Uranus in the
    // near-infrared).
    const centerLat = Math.asin(rng.range(-1, 1)) * 0.94;
    const beta = (2 * omega * Math.max(Math.cos(centerLat), 0.08)) / radiusM;
    const rhinesM = Math.PI * Math.sqrt((2 * convectiveMs) / beta);
    const widthRad = (rhinesM / radiusM) * rng.range(0.7, 1.4);
    const lo = Math.max(0, latIndex(centerLat - widthRad / 2));
    const hi = Math.min(LAT_SAMPLES - 1, latIndex(centerLat + widthRad / 2));
    if (hi - lo < 2) continue;
    let sum = 0;
    let weight = 0;
    for (let i = lo; i <= hi; i++) {
      sum += q[i] * area[i];
      weight += area[i];
    }
    const mean = sum / weight;
    // Partial homogenization, at the forcing's own strength: vigorous
    // convection scours PV toward the staircase; a feeble interior
    // stirs weakly, leaves the gradient mostly intact, and its jets
    // never grow wide — the energy budget the toy mixing otherwise
    // lacks.
    const relax = Math.min(0.55, 0.06 + convectiveMs / 40);
    for (let i = lo; i <= hi; i++) q[i] += (mean - q[i]) * relax;
  }

  const u = invertWind(q, radiusM, omega);

  // The staircase sets structure; its amplitude is renormalized to the
  // observed giant-wind scale (peaks grow with convective vigor —
  // Jupiter ~150 m/s, Neptune ~400), since the toy mixing has no
  // drag to equilibrate energy on its own. Polar samples are excluded:
  // the 1/cosφ inversion blows up there without meaning anything.
  let peak = 1e-9;
  for (let i = 0; i < LAT_SAMPLES; i++) {
    if (Math.abs(profileLatRad(i)) < 1.3) peak = Math.max(peak, Math.abs(u[i]));
  }
  const scale = targetPeakMs / peak;
  for (let i = 0; i < LAT_SAMPLES; i++) u[i] *= scale;

  // Deep equatorial jet from the convective columns: the flow relaxes
  // toward it inside the column belt, prograde on vigorous warm
  // envelopes, retrograde on cold methane worlds — the solar system's
  // own split.
  const equatorialMs =
    (climate.equilibriumK < 90 ? -1 : 1) * (15 + 4.5 * convectiveMs) * rng.range(0.7, 1.3);
  const eqWidth = rng.range(0.16, 0.28);
  for (let i = 0; i < LAT_SAMPLES; i++) {
    const lat = profileLatRad(i);
    const blend = Math.exp(-((lat / eqWidth) ** 2));
    u[i] += (equatorialMs - u[i]) * blend;
  }
  return u;
}

function latIndex(latRad: number): number {
  return Math.round(((latRad + Math.PI / 2) / Math.PI) * (LAT_SAMPLES - 1));
}

/**
 * Invert the PV anomaly for the zonal wind: d(u·cosφ)/dφ = R·cosφ·(f−q),
 * integrated from the pole. The net imbalance is gauged out first (the
 * restoration term exchanges a little angular momentum with the
 * interior), so the integral closes at the far pole instead of letting
 * a residue blow up through the 1/cosφ.
 */
function invertWind(q: Float64Array, radiusM: number, omega: number): Float32Array {
  const dLat = Math.PI / (LAT_SAMPLES - 1);
  let imbalance = 0;
  let weight = 0;
  for (let i = 0; i < LAT_SAMPLES; i++) {
    const lat = profileLatRad(i);
    const f = 2 * omega * Math.sin(lat);
    imbalance += (f - q[i]) * Math.cos(lat) * dLat;
    weight += Math.cos(lat) * dLat;
  }
  const gauge = imbalance / weight;
  const u = new Float32Array(LAT_SAMPLES);
  let uCos = 0;
  for (let i = 0; i < LAT_SAMPLES; i++) {
    const lat = profileLatRad(i);
    const f = 2 * omega * Math.sin(lat);
    uCos += radiusM * Math.cos(lat) * (f - q[i] - gauge) * dLat;
    u[i] = uCos / Math.max(Math.cos(lat), 0.05);
  }
  return u;
}

interface Palette {
  zone: Rgb;
  belt: Rgb;
  stormFresh: Rgb;
  stormAged: Rgb;
  hood: Rgb;
}

/** Cloud chemistry sets the family; a per-planet chromophore draw sets
 *  the identity — the disclosed aesthetic degree of freedom. */
function chemistryPalette(rng: Rng, equilibriumK: number): Palette {
  let base: Palette;
  if (equilibriumK > 900) {
    // Alkali-darkened decks, thermally lit from below.
    base = {
      zone: [0.14, 0.11, 0.09],
      belt: [0.24, 0.16, 0.11],
      stormFresh: [0.36, 0.28, 0.2],
      stormAged: [0.3, 0.19, 0.12],
      hood: [0.1, 0.08, 0.07],
    };
  } else if (equilibriumK < 90) {
    // Methane absorption strips the red.
    base = {
      zone: [0.4, 0.63, 0.76],
      belt: [0.3, 0.53, 0.7],
      stormFresh: [0.88, 0.92, 0.96],
      stormAged: [0.16, 0.28, 0.45],
      hood: [0.34, 0.55, 0.68],
    };
  } else if (equilibriumK < 250) {
    // Ammonia decks with tholin-stained belts.
    base = {
      zone: [0.8, 0.73, 0.6],
      belt: [0.52, 0.38, 0.25],
      stormFresh: [0.92, 0.9, 0.85],
      stormAged: [0.75, 0.4, 0.26],
      hood: [0.55, 0.5, 0.42],
    };
  } else {
    // Water-cloud regime: bright low-contrast decks.
    base = {
      zone: [0.75, 0.78, 0.83],
      belt: [0.56, 0.61, 0.68],
      stormFresh: [0.92, 0.92, 0.94],
      stormAged: [0.72, 0.66, 0.6],
      hood: [0.6, 0.64, 0.7],
    };
  }
  const warm = rng.range(-0.06, 0.09);
  const lightness = rng.range(0.85, 1.12);
  const tint = ([r, g, b]: Rgb): Rgb => [
    Math.min(1, Math.max(0, (r + warm) * lightness)),
    Math.min(1, Math.max(0, g * lightness)),
    Math.min(1, Math.max(0, (b - warm) * lightness)),
  ];
  return {
    zone: tint(base.zone),
    belt: tint(base.belt),
    stormFresh: tint(base.stormFresh),
    stormAged: tint(base.stormAged),
    hood: tint(base.hood),
  };
}

/** Bands live between adjacent jet extrema; zones are the anticyclonic
 *  intervals, belts the cyclonic, straight from the wind shear. */
function extractBands(
  rng: Rng,
  u: Float32Array,
  radiusM: number,
  palette: Palette,
  contrast: number,
): { bands: CloudBand[]; rawCount: number } {
  const edges: number[] = [0];
  const capLat = (78 * Math.PI) / 180;
  for (let i = 1; i < LAT_SAMPLES - 1; i++) {
    const lat = profileLatRad(i);
    if (Math.abs(lat) > capLat) continue;
    if ((u[i] - u[i - 1]) * (u[i + 1] - u[i]) < 0) edges.push(i);
  }
  edges.push(LAT_SAMPLES - 1);
  edges.sort((a, b) => a - b);
  // Contiguity is a shader invariant: thin intervals merge into their
  // neighbors rather than leaving gaps between bands.
  const clean = [edges[0]];
  for (const edge of edges.slice(1)) {
    if (edge - clean[clean.length - 1] >= 3) clean.push(edge);
  }
  clean[clean.length - 1] = LAT_SAMPLES - 1;

  interface RawBand {
    lo: number;
    hi: number;
  }
  let raw: RawBand[] = [];
  for (let e = 0; e < clean.length - 1; e++) {
    raw.push({ lo: clean[e], hi: clean[e + 1] });
  }
  const rawCount = raw.length;
  // The shader carries a fixed budget: merge the narrowest neighbors.
  while (raw.length > MAX_BANDS) {
    let narrow = 0;
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].hi - raw[i].lo < raw[narrow].hi - raw[narrow].lo) narrow = i;
    }
    const eat = narrow === 0 ? 1 : narrow - 1;
    raw[eat] = { lo: Math.min(raw[eat].lo, raw[narrow].lo), hi: Math.max(raw[eat].hi, raw[narrow].hi) };
    raw = raw.filter((_, i) => i !== narrow);
  }

  let maxShear = 1e-9;
  for (const band of raw) {
    maxShear = Math.max(maxShear, Math.abs(u[band.hi] - u[band.lo]));
  }

  const bands = raw.map((band) => {
    const latStart = profileLatRad(band.lo);
    const latEnd = profileLatRad(band.hi);
    const mid = (latStart + latEnd) / 2;
    let mean = 0;
    for (let i = band.lo; i <= band.hi; i++) mean += u[i];
    mean /= band.hi - band.lo + 1;
    // Anticyclonic shear (a zone): u rising toward the pole in the
    // north, toward the equator in the south.
    const shearSign = (u[band.hi] - u[band.lo]) * Math.sign(mid || 1);
    const kind: CloudBand['kind'] = shearSign > 0 ? 'zone' : 'belt';
    const fades = kind === 'belt' && rng.bool(0.35);
    const base = kind === 'zone' ? palette.zone : palette.belt;
    const jitter = 1 + rng.range(-0.09, 0.09);
    const fade = 1 - (1 - contrast) * 0.55;
    const color: Rgb = [
      mix(palette.zone[0], base[0] * jitter, fade),
      mix(palette.zone[1], base[1] * jitter, fade),
      mix(palette.zone[2], base[2] * jitter, fade),
    ];
    return {
      latStartRad: latStart,
      latEndRad: latEnd,
      driftRadPerDay: (mean * 86400) / (radiusM * Math.max(Math.cos(mid), 0.2)),
      edgeShear: Math.abs(u[band.hi] - u[band.lo]) / maxShear,
      color,
      kind,
      fadePeriodDays: fades ? rng.range(3000, 15000) : 0,
      fadePhase01: fades ? rng.float() : 0,
    };
  });
  return { bands, rawCount };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Anticyclones as recurring habits: each slot spawns, drifts with its
 *  band, and dies on a seeded schedule, so the population at any sim
 *  time is reproducible without stored state. */
function buildStormCatalog(
  rng: Rng,
  bands: CloudBand[],
  convectiveMs: number,
  equilibriumK: number,
  orbitalPeriodDays?: number,
): { storms: StormSlot[]; spotIndex: number } {
  const storms: StormSlot[] = [];
  if (bands.length === 0) return { storms, spotIndex: -1 };

  const zones = bands
    .map((band, i) => ({ band, i }))
    .filter(({ band }) => {
      const mid = (band.latStartRad + band.latEndRad) / 2;
      return band.kind === 'zone' && Math.abs(mid) > 0.2 && Math.abs(mid) < 0.75;
    });

  const spotChance = equilibriumK < 90 ? 0.3 : equilibriumK < 250 ? 0.45 : 0.25;
  let spotIndex = -1;
  if (zones.length > 0 && rng.bool(spotChance)) {
    // The great-spot analog lives for centuries, not forever: it
    // swells quickly, spends a long maturity shrinking (the Great Red
    // Spot has lost half its width in 150 years), pales, and dies —
    // and a successor eventually spins up at a freshly hashed
    // latitude of its zone.
    const { band, i } = zones[rng.int(zones.length)];
    const periodDays = rng.range(250, 1200) * 365.25;
    storms.push({
      kind: 'spot',
      band: i,
      periodDays,
      lifeDays: periodDays * rng.range(0.55, 0.85),
      phaseDays: rng.range(0, periodDays),
      sizeRad: rng.range(0.07, 0.16),
      driftRadPerDay: band.driftRadPerDay * rng.range(0.75, 0.92),
      wobbleRad: rng.range(0.01, 0.03),
      seed: rng.int(1 << 30),
    });
    spotIndex = 0;
  }

  // Seasonal eruptions on condensable-rich giants: a planet-circling
  // white storm once per orbit (Saturn's Great White Spots), or on a
  // seeded multi-year cadence when the orbit is too short to store a
  // season's worth of condensables.
  if (equilibriumK < 250 && zones.length > 0 && rng.bool(0.5)) {
    const { band, i } = zones[rng.int(zones.length)];
    const seasonal = orbitalPeriodDays !== undefined && orbitalPeriodDays > 1500;
    const periodDays = seasonal ? orbitalPeriodDays : rng.range(8, 35) * 365.25;
    storms.push({
      kind: 'eruption',
      band: i,
      periodDays,
      lifeDays: rng.range(120, 320),
      phaseDays: rng.range(0, periodDays),
      sizeRad: rng.range(0.045, 0.08),
      driftRadPerDay: band.driftRadPerDay,
      wobbleRad: 0,
      seed: rng.int(1 << 30),
    });
  }

  const slotCount = Math.round(rng.range(0.8, 1.2) * (2 + 9 * Math.min(1, convectiveMs / 22)));
  // Anticyclones live in the sheared mid-latitudes; the caps run their
  // own cyclone regime instead.
  const weights = bands.map((band) => {
    const mid = Math.abs(band.latStartRad + band.latEndRad) / 2;
    return mid > 1.1 ? 0 : 0.15 + band.edgeShear;
  });
  for (let s = 0; s < slotCount; s++) {
    let pick = rng.float() * weights.reduce((a, b) => a + b, 0);
    let bandIndex = 0;
    for (let i = 0; i < weights.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        bandIndex = i;
        break;
      }
    }
    const period = rng.range(240, 1600);
    storms.push({
      kind: 'oval',
      band: bandIndex,
      periodDays: period,
      lifeDays: period * rng.range(0.25, 0.6),
      phaseDays: rng.range(0, period),
      sizeRad: rng.range(0.018, 0.06),
      driftRadPerDay: bands[bandIndex].driftRadPerDay * rng.range(0.85, 0.98),
      wobbleRad: 0,
      seed: rng.int(1 << 30),
    });
  }
  return { storms, spotIndex };
}

function hash01(x: number): number {
  let h = (x | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 0xffffffff;
}

/**
 * The live storm population at a sim time: pure function of the
 * catalog and t, so any visitor at any time — forward, backward,
 * fast-forwarded — sees the same weather. Each incarnation of a slot
 * rehashes its longitude and latitude inside its band; spots run a
 * century arc, eruptions spread down their band and fade.
 */
export function activeStorms(circulation: Circulation, tDays: number): ActiveStorm[] {
  const out: ActiveStorm[] = [];
  for (const slot of circulation.storms) {
    const local = tDays - slot.phaseDays + slot.periodDays * 4096;
    const cycle = Math.floor(local / slot.periodDays);
    const ageDays = local - cycle * slot.periodDays;
    if (ageDays > slot.lifeDays) continue;
    const band = circulation.bands[slot.band];
    if (!band) continue;
    const h1 = hash01(slot.seed + cycle * 7919);
    const h2 = hash01(slot.seed + cycle * 7919 + 1);
    const span = band.latEndRad - band.latStartRad;
    const lat =
      band.latStartRad + span * (0.3 + 0.4 * h1) + Math.sin(tDays * 0.011) * slot.wobbleRad;
    const lon = h2 * 2 * Math.PI + slot.driftRadPerDay * tDays;
    const age01 = Math.min(1, ageDays / Math.max(slot.lifeDays, 1));

    if (slot.kind === 'spot') {
      // The century arc: swell fast, shrink through the long maturity
      // (the Great Red Spot has lost half its width in 150 years),
      // pale out at the end.
      const grow = Math.min(1, ageDays / (slot.lifeDays * 0.06));
      const shrink = 1 - 0.6 * smooth01((age01 - 0.25) / 0.75);
      const size = slot.sizeRad * grow * shrink;
      if (size < 0.012) continue;
      const redden = Math.min(1, age01 * 8) * (1 - 0.7 * smooth01((age01 - 0.85) / 0.15));
      out.push({ kind: 'spot', latRad: lat, lonRad: lon, sizeRad: size, age01: redden });
    } else if (slot.kind === 'eruption') {
      // A fresh white head that spreads down its band until the jet
      // has smeared it planet-wide, then dissipates.
      out.push({ kind: 'eruption', latRad: lat, lonRad: lon, sizeRad: slot.sizeRad, age01 });
    } else {
      // Grow fast, fade slow.
      const envelope = Math.min(1, ageDays / (slot.lifeDays * 0.15)) * (1 - age01 ** 3);
      if (envelope <= 0.02) continue;
      out.push({
        kind: 'oval',
        latRad: lat,
        lonRad: lon,
        sizeRad: slot.sizeRad * (0.55 + 0.45 * envelope),
        age01,
      });
    }
    if (out.length >= MAX_ACTIVE_STORMS) break;
  }
  return out;
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Where a band sits in its fade-and-revival cycle: 0 vivid, 1 buried
 *  under fresh white deck (SEB-style). Pure function of time. */
export function bandFade01(band: CloudBand, tDays: number): number {
  if (band.fadePeriodDays <= 0) return 0;
  const phase = (((tDays / band.fadePeriodDays + band.fadePhase01) % 1) + 1) % 1;
  // Vivid for most of the cycle; the fade rolls in, lingers, revives.
  if (phase < 0.7) return 0;
  return Math.sin(((phase - 0.7) / 0.3) * Math.PI) * 0.85;
}
