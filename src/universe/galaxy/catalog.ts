import { deriveSeed, mix64 } from '../../core/rng/hash';
import { poisson } from '../../core/rng/distributions';
import { Rng } from '../../core/rng/rng';
import { evolve, luminousLifetimeGyr } from '../star/evolution';
import {
  AGE_BIT_SPAN,
  ENTROPY_BITS,
  MASS_BIT_SPAN,
  massBitsAtLeast,
  seedForIdentity,
  unitFromBits,
} from '../star/identity';
import { initialMassFromUnit } from '../star/imf';
import { thinUnitForAge } from './population';
import {
  armBoost,
  ARM_BOOST_MAX,
  componentDensities,
  smoothComponentDensities,
  stellarDensity,
  stellarDensityCeiling,
  type GalacticPosition,
} from './density';
import { galaxySeed } from './galaxySeed';

/**
 * The star catalog: the galaxy's stellar population as a Poisson field
 * realized in deterministic cells, stratified by the identity bits every
 * seed carries. Each row is an independent slice of (mass × age) space
 * with its own cell size — faint common stars in fine cells, rare bright
 * ones in coarse cells so a sky can sweep them out to kiloparsecs, and
 * the old (post-luminous) slice of the massive strata in fine near-only
 * cells. The rows partition identity space exactly: every star in the
 * galaxy belongs to one slot of one cell of one row, materializes from
 * its constructed seed alone, and a randomly typed seed lands in exactly
 * one row with the correct population statistics.
 */
export interface CatalogRow {
  massLo: number;
  massHi: number;
  massBitsLo: number;
  massBitsHi: number;
  ageBitsLo: number;
  ageBitsHi: number;
  cellPc: number;
  /** How far the sky field surveys this row (0: near field only). */
  skyRadiusPc: number;
  salt: bigint;
}

/**
 * Above this initial mass a star can outlive its main sequence within
 * the oldest population age (13.2 Gyr) — the universe's turnoff mass,
 * separating the forever-dim bulk from the potential giants.
 */
export const TURNOFF_MASS = 0.91;

/** Oldest age the population model can produce (halo tail). */
const MAX_POPULATION_AGE_GYR = 13.2;

/**
 * Upper bound on the thin-disk fraction of the population mix over all
 * locales: the mix is thin-heaviest at the inner edge of the inhabited
 * belt, in the midplane, on an arm ridge.
 */
// Built on the smooth (wave-free) profile, which every galaxy shares:
// dividing the arm factor out and multiplying the universal ceiling
// back in is exactly the same number, and it never commits the module
// to a galaxy at import time.
const W_THIN_MAX = (() => {
  const parts = smoothComponentDensities({ xPc: 5200, yPc: 0, zPc: 0 });
  const thinMax = parts.thin * ARM_BOOST_MAX;
  return thinMax / (thinMax + parts.thick + parts.halo);
})();

/**
 * Age-bit boundary below which a star of at least this mass can still be
 * luminous somewhere: only thin-disk members can be young enough, and the
 * thin band is a prefix of the population unit range, so the luminous
 * stars of a stratum live under one universal cap (with margin).
 */
function luminousAgeBitCap(massLo: number): number {
  const unitCap = Math.min(
    1,
    W_THIN_MAX * thinUnitForAge(luminousLifetimeGyr(massLo)) * 1.03 + 1e-3,
  );
  return Math.min(AGE_BIT_SPAN, Math.ceil(unitCap * AGE_BIT_SPAN));
}

function makeRows(): CatalogRow[] {
  const bounds = [0.013, TURNOFF_MASS, 2.2, 7, 120];
  const cells = [10, 40, 160, 640];
  const radii = [90, 150, 600, 2500];
  const rows: CatalogRow[] = [];
  for (let i = 0; i < 4; i++) {
    const massBitsLo = massBitsAtLeast(bounds[i]);
    const massBitsHi = massBitsAtLeast(bounds[i + 1]);
    const cap = luminousAgeBitCap(bounds[i]);
    rows.push({
      massLo: bounds[i],
      massHi: bounds[i + 1],
      massBitsLo,
      massBitsHi,
      ageBitsLo: 0,
      ageBitsHi: cap,
      cellPc: cells[i],
      skyRadiusPc: radii[i],
      salt: 0n,
    });
    if (cap < AGE_BIT_SPAN) {
      // The stratum's post-luminous remainder: near-field-only fine cells.
      rows.push({
        massLo: bounds[i],
        massHi: bounds[i + 1],
        massBitsLo,
        massBitsHi,
        ageBitsLo: cap,
        ageBitsHi: AGE_BIT_SPAN,
        cellPc: 10,
        skyRadiusPc: 0,
        salt: 0n,
      });
    }
  }
  rows.forEach((row, i) => {
    void i;
  });
  return rows;
}

export const CATALOG_ROWS: CatalogRow[] = makeRows();

/** Deterministic seed for one cell of one row. */
// Row salts derive from the session's galaxy on first use.
let saltsFilled = false;
function ensureRowSalts(): void {
  if (saltsFilled) return;
  saltsFilled = true;
  CATALOG_ROWS.forEach((row, i) => {
    row.salt = deriveSeed(galaxySeed(), 'catalog', i);
  });
}

function cellSeed(row: CatalogRow, ix: number, iy: number, iz: number): bigint {
  ensureRowSalts();
  return mix64(
    row.salt ^
      ((BigInt(ix & 0xfffff) << 42n) | (BigInt(iy & 0xfffff) << 22n) | BigInt(iz & 0x3fffff)),
  );
}

export type StarVisitor = (
  xPc: number,
  yPc: number,
  zPc: number,
  massBits: number,
  ageBits: number,
  entropy: number,
) => void;

/**
 * A unit in [0, 1) fixed by a position alone: what a sweep thins by
 * where it must not touch the cell's own generator, since every draw
 * from that stream is a star's identity.
 */
export function unitAtPosition(xPc: number, yPc: number, zPc: number): number {
  let h =
    Math.imul((xPc * 8192) | 0, 0x9e3779b1) ^
    Math.imul((yPc * 8192) | 0, 0x85ebca77) ^
    Math.imul((zPc * 8192) | 0, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * How a sweep's reach ends: everything inside innerPc, thinning to
 * nothing at outerPc in proportion to the distance left. A row's reach
 * is a compute budget, not a limit any instrument has, and a budget
 * that stops on a sphere draws that sphere in the sky.
 */
export interface SweepTaper {
  innerPc: number;
  outerPc: number;
}

/** The share of stars a taper keeps at a distance, 1 inside it. */
export function taperKeep(taper: SweepTaper, distancePc: number): number {
  if (distancePc <= taper.innerPc) return 1;
  if (distancePc >= taper.outerPc) return 0;
  return (taper.outerPc - distancePc) / (taper.outerPc - taper.innerPc);
}

/** One cell of a catalog row's grid. */
export interface CatalogCell {
  ix: number;
  iy: number;
  iz: number;
}

/**
 * The cells of a row that a ball around a point touches, in the order
 * a sweep visits them: ix outer, then iy, then iz. Stars concatenated
 * in this order are the row's sweep, whoever swept which cell.
 */
export function rowCells(
  row: CatalogRow,
  center: GalacticPosition,
  radiusPc: number,
): CatalogCell[] {
  const { cellPc } = row;
  const radiusSq = radiusPc * radiusPc;
  const lo = [
    Math.floor((center.xPc - radiusPc) / cellPc),
    Math.floor((center.yPc - radiusPc) / cellPc),
    Math.floor((center.zPc - radiusPc) / cellPc),
  ];
  const hi = [
    Math.floor((center.xPc + radiusPc) / cellPc),
    Math.floor((center.yPc + radiusPc) / cellPc),
    Math.floor((center.zPc + radiusPc) / cellPc),
  ];
  const clampDelta = (v: number, cellLo: number): number =>
    Math.max(cellLo, Math.min(v, cellLo + cellPc)) - v;
  const cells: CatalogCell[] = [];
  for (let ix = lo[0]; ix <= hi[0]; ix++) {
    const gx = clampDelta(center.xPc, ix * cellPc);
    for (let iy = lo[1]; iy <= hi[1]; iy++) {
      const gy = clampDelta(center.yPc, iy * cellPc);
      for (let iz = lo[2]; iz <= hi[2]; iz++) {
        const gz = clampDelta(center.zPc, iz * cellPc);
        if (gx * gx + gy * gy + gz * gz > radiusSq) continue;
        cells.push({ ix, iy, iz });
      }
    }
  }
  return cells;
}

/**
 * Every star of one cell within a ball, visited with its raw identity
 * bits (the caller builds seeds only for stars it keeps). Every slot
 * of the cell takes the same draws from its stream whether it is
 * visited, out of reach, thinned, or thinned against the density, so
 * the cell's stars are a function of the cell alone and any
 * overlapping sweep sees the same ones.
 */
export function sweepCellStars(
  row: CatalogRow,
  cell: CatalogCell,
  center: GalacticPosition,
  radiusPc: number,
  visit: StarVisitor,
  /** Thin the sweep toward its edge. Stars past the taper's inner
   *  radius are dropped by a unit fixed by their position, before the
   *  density test that costs the most, and the cell's generator draws
   *  exactly what it always drew — every star inside the inner radius
   *  keeps its identity. */
  taper?: SweepTaper,
): void {
  const { cellPc } = row;
  const massSpan = row.massBitsHi - row.massBitsLo;
  const ageSpan = row.ageBitsHi - row.ageBitsLo;
  const share = (massSpan / MASS_BIT_SPAN) * (ageSpan / AGE_BIT_SPAN);
  if (share <= 0) return;
  const radiusSq = radiusPc * radiusPc;
  const { ix, iy, iz } = cell;
  const corner = { xPc: ix * cellPc, yPc: iy * cellPc, zPc: iz * cellPc };
  const ceiling = stellarDensityCeiling(corner, cellPc);
  const rng = new Rng(cellSeed(row, ix, iy, iz));
  const count = poisson(rng, ceiling * cellPc ** 3 * share);
  for (let i = 0; i < count; i++) {
    const x = (ix + rng.float()) * cellPc;
    const y = (iy + rng.float()) * cellPc;
    const z = (iz + rng.float()) * cellPc;
    const dx = x - center.xPc;
    const dy = y - center.yPc;
    const dz = z - center.zPc;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (
      d2 > radiusSq ||
      (taper && unitAtPosition(x, y, z) >= taperKeep(taper, Math.sqrt(d2)))
    ) {
      // Out of reach, or thinned away: the stream still takes the
      // draws this star would have taken, so its neighbours in the
      // cell stay who they are.
      rng.float();
      rng.int(massSpan);
      rng.int(ageSpan);
      rng.int(1 << ENTROPY_BITS);
      continue;
    }
    // Thin against the true density; the ceiling only overdraws.
    if (rng.float() * ceiling > stellarDensity({ xPc: x, yPc: y, zPc: z })) {
      rng.int(massSpan);
      rng.int(ageSpan);
      rng.int(1 << ENTROPY_BITS);
      continue;
    }
    const massBits = row.massBitsLo + rng.int(massSpan);
    const ageBits = row.ageBitsLo + rng.int(ageSpan);
    const entropy = rng.int(1 << ENTROPY_BITS);
    visit(x, y, z, massBits, ageBits, entropy);
  }
}

/** Every star of one catalog row within a ball, cell by cell in sweep
 *  order. */
export function sweepRowStars(
  row: CatalogRow,
  center: GalacticPosition,
  radiusPc: number,
  visit: StarVisitor,
  taper?: SweepTaper,
): void {
  for (const cell of rowCells(row, center, radiusPc)) {
    sweepCellStars(row, cell, center, radiusPc, visit, taper);
  }
}

export interface StarSlot {
  seed: bigint;
  positionPc: GalacticPosition;
  massInitial: number;
}

/** All catalog stars within radiusPc of a point, across every row. */
export function starsNear(positionPc: GalacticPosition, radiusPc: number): StarSlot[] {
  const slots: StarSlot[] = [];
  for (const row of CATALOG_ROWS) {
    sweepRowStars(row, positionPc, radiusPc, (x, y, z, massBits, ageBits, entropy) => {
      slots.push({
        seed: seedForIdentity(massBits, ageBits, entropy),
        positionPc: { xPc: x, yPc: y, zPc: z },
        massInitial: initialMassFromUnit(unitFromBits(massBits, MASS_BIT_SPAN)),
      });
    });
  }
  return slots;
}

/**
 * Conservative peak luminosity a star of this initial mass ever reaches
 * within the oldest population age — the sky's pre-photometry cull. Each
 * evolutionary phase interpolates between its anchors, so sampling the
 * anchors (with margin) bounds the whole track.
 */
const CEILING_BINS = 160;
const CEILING_LOG_LO = Math.log(0.013);
const CEILING_LOG_SPAN = Math.log(120 / 0.013);
const luminosityCeilingTable = (() => {
  const table = new Float64Array(CEILING_BINS + 1);
  const peakFor = (mass: number): number => {
    let peak = 0;
    const lifetime = luminousLifetimeGyr(mass);
    const msEnd = lifetime / 1.15;
    const ages = [0.05, Math.min(MAX_POPULATION_AGE_GYR, msEnd * 0.999)];
    if (lifetime < MAX_POPULATION_AGE_GYR) {
      for (const u of [0.05, 0.299, 0.45, 0.699, 0.75, 0.849, 0.9, 0.999]) {
        ages.push(msEnd * (1 + 0.15 * u));
      }
    }
    ages.push(MAX_POPULATION_AGE_GYR);
    for (const age of ages) peak = Math.max(peak, evolve(mass, age).luminosity);
    return peak;
  };
  for (let b = 0; b <= CEILING_BINS; b++) {
    const massLo = Math.exp(CEILING_LOG_LO + (CEILING_LOG_SPAN * b) / CEILING_BINS);
    const massHi = Math.exp(CEILING_LOG_LO + (CEILING_LOG_SPAN * (b + 1)) / CEILING_BINS);
    let peak = 0;
    for (const m of [massLo, massLo * 1.02, Math.sqrt(massLo * massHi), massHi]) {
      peak = Math.max(peak, peakFor(Math.min(m, 120)));
    }
    table[b] = peak * 1.25;
  }
  return table;
})();

export function luminosityCeiling(massInitial: number): number {
  const bin = Math.min(
    CEILING_BINS,
    Math.max(0, Math.floor(((Math.log(massInitial) - CEILING_LOG_LO) / CEILING_LOG_SPAN) * CEILING_BINS)),
  );
  return luminosityCeilingTable[bin];
}
