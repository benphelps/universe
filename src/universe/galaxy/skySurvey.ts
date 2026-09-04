import { buildTemperatureLut } from '../../core/color/blackbody';
import { initialMassFromUnit } from '../star/imf';
import { MASS_BIT_SPAN, seedForIdentity, unitFromBits } from '../star/identity';
import {
  luminosityCeiling,
  rowCells,
  sweepCellStars,
  taperKeep,
  unitAtPosition,
  type CatalogCell,
  type CatalogRow,
  type SweepTaper,
} from './catalog';
import type { GalacticPosition } from './density';
import { NEIGHBOR_RADIUS_PC, neighborRadiusPc } from './neighborhood';
import { companionLuminosity, starPhotometry } from './photometry';
import { makeAccum, packAccum, pushTo, type StarAccum, type SweepSlab } from './skyStars';

/**
 * The star half of a sky, one catalog cell at a time.
 *
 * A cell is surveyed from a centre and kept as the stars themselves —
 * where each stands in the galaxy, its light, its seed — rather than
 * as the directions and brightnesses one viewpoint sees. Projecting a
 * survey from a viewpoint applies the sky's exact cuts there, so the
 * field it yields is the sweep's to the bit, and a survey taken with
 * reach holds enough that any viewpoint within that reach projects
 * from it the same. The neighbouring star a traveler jumps to is
 * inside the reach, which is what makes the jump cheap: only the cells
 * the move brings newly into range are swept.
 */

/** Keep far stars down to apparent magnitude ≈ 9. */
export const MIN_FAR_IRRADIANCE = 1.5e-4;

/**
 * How far past its reach a sweep tapers, as a factor of that reach. A
 * row's sky radius is a compute budget well inside where its brightest
 * members are still visible, and the near census ends where the
 * neighbourhood does — each a sphere the sky would otherwise show as
 * a step in its star density. The band beyond thins to nothing in
 * proportion to the distance left, so the sky's density falls off
 * rather than dropping.
 */
const SWEEP_TAPER = 1.5;
/** The census taper runs further: a census of every star is a
 *  hundred times the magnitude-limited sky's density, and a fall that
 *  steep needs the room. */
const NEAR_TAPER = 2;

/** How far a row's sweep actually runs: its reach and the taper past
 *  it, or the census taper for a row with no reach of its own. The
 *  census never reaches past the neighbourhood's shipped radius. */
export function rowSweepRadiusPc(row: CatalogRow): number {
  return Math.max(NEIGHBOR_RADIUS_PC * NEAR_TAPER, row.skyRadiusPc * SWEEP_TAPER);
}

/**
 * How far from a survey's centre a viewpoint may stand and still be
 * served by it: the neighbourhood's shipped radius, so every listed
 * neighbour is a jump the cache covers. The price is paid once, when
 * the survey is taken — its taper and its magnitude cut are held this
 * much further out than the centre alone would need.
 */
export const SURVEY_REACH_PC = NEIGHBOR_RADIUS_PC;

/** Where a survey stands and how far it serves. */
export interface SurveyFrame {
  center: GalacticPosition;
  /** Viewpoints this far from the centre project the far field
   *  exactly from the survey. */
  reachPc: number;
  /** Every star closer than this to the centre is held whatever its
   *  light: the census as seen from anywhere within the census's own
   *  slack, which is the neighbourhood radius at the centre. */
  censusHeldPc: number;
}

/** The frame a build at this viewpoint surveys its cells under. */
export function surveyFrameAt(center: GalacticPosition, reachPc = SURVEY_REACH_PC): SurveyFrame {
  const nearPc = neighborRadiusPc(center);
  return { center, reachPc, censusHeldPc: nearPc * NEAR_TAPER + nearPc };
}

/** Doubles per surveyed star: x, y, z (pc), luminosity, companion
 *  luminosity (L☉), effective temperature (K). */
export const SURVEY_STRIDE = 6;

/** One cell's stars, surveyed under a frame. */
export interface CellSurvey {
  rowIndex: number;
  cell: CatalogCell;
  frame: SurveyFrame;
  count: number;
  stars: Float64Array;
  seeds: BigUint64Array;
}

/** Sweep one cell under a frame into a survey. */
export function surveyCell(
  row: CatalogRow,
  rowIndex: number,
  cell: CatalogCell,
  frame: SurveyFrame,
): CellSurvey {
  const { center, reachPc, censusHeldPc } = frame;
  const ballPc = rowSweepRadiusPc(row) + reachPc;
  // The taper and the reach it ends, both held out by the frame's
  // reach: a star thinned here would be thinned from every viewpoint
  // the survey serves, since none stands nearer it than that.
  const taper: SweepTaper | undefined =
    row.skyRadiusPc > 0
      ? { innerPc: row.skyRadiusPc + reachPc, outerPc: row.skyRadiusPc * SWEEP_TAPER + reachPc }
      : undefined;
  const stars: number[] = [];
  const seeds: bigint[] = [];
  sweepCellStars(
    row,
    cell,
    center,
    ballPc,
    (x, y, z, massBits, ageBits, entropy) => {
      const dx = x - center.xPc;
      const dy = y - center.yPc;
      const dz = z - center.zPc;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const censused = distance < censusHeldPc;
      // The nearest any served viewpoint can stand to this star.
      const nearest = Math.max(0, distance - reachPc);
      const nearestSq = nearest * nearest;
      if (!censused) {
        if (row.skyRadiusPc <= 0) return;
        if (nearest > row.skyRadiusPc * SWEEP_TAPER) return;
        const mass = initialMassFromUnit(unitFromBits(massBits, MASS_BIT_SPAN));
        if (luminosityCeiling(mass) / nearestSq < MIN_FAR_IRRADIANCE) return;
      }
      const seed = seedForIdentity(massBits, ageBits, entropy);
      const position = { xPc: x, yPc: y, zPc: z };
      const physical = starPhotometry(seed, position);
      if (physical.luminosity <= 0) return;
      if (!censused && physical.luminosity / nearestSq < MIN_FAR_IRRADIANCE) return;
      stars.push(x, y, z, physical.luminosity, companionLuminosity(seed, position), physical.tEff);
      seeds.push(seed);
    },
    taper,
  );
  return {
    rowIndex,
    cell,
    frame,
    count: seeds.length,
    stars: Float64Array.from(stars),
    seeds: BigUint64Array.from(seeds),
  };
}

/** The nearest a point comes to a cell's box. */
function cellDistancePc(row: CatalogRow, cell: CatalogCell, point: GalacticPosition): number {
  const { cellPc } = row;
  const axis = (v: number, lo: number): number => Math.max(lo, Math.min(v, lo + cellPc)) - v;
  const gx = axis(point.xPc, cell.ix * cellPc);
  const gy = axis(point.yPc, cell.iy * cellPc);
  const gz = axis(point.zPc, cell.iz * cellPc);
  return Math.sqrt(gx * gx + gy * gy + gz * gz);
}

/**
 * Whether a survey holds everything a viewpoint's sky needs from its
 * cell. The far field is served within the frame's reach. The census
 * is served while the viewpoint's own census, carried the distance
 * between the two, still fits inside what was held — asked only of
 * cells the census can reach from here.
 */
export function surveyServes(
  survey: CellSurvey,
  row: CatalogRow,
  viewpoint: GalacticPosition,
  nearPc: number,
): boolean {
  const { center, reachPc, censusHeldPc } = survey.frame;
  const shift = Math.hypot(
    viewpoint.xPc - center.xPc,
    viewpoint.yPc - center.yPc,
    viewpoint.zPc - center.zPc,
  );
  if (shift > reachPc) return false;
  const censusPc = nearPc * NEAR_TAPER;
  if (cellDistancePc(row, survey.cell, viewpoint) >= censusPc) return true;
  return censusPc + shift <= censusHeldPc;
}

/**
 * Project a survey from a viewpoint: the sky's own cuts, applied where
 * the traveler stands. The near census reaches exactly as far as the
 * neighbourhood's 3D points do, then tapers: past it every star is
 * kept by the taper's share, drawn among the far points whatever its
 * light, so the census thins into the magnitude-limited sky instead
 * of ending on a sphere. Beyond that, a far star is kept while it
 * clears the magnitude limit and its row's tapered reach.
 */
export function projectSurvey(
  survey: CellSurvey,
  row: CatalogRow,
  viewpoint: GalacticPosition,
  nearPc: number,
  lut: Float32Array,
  near: StarAccum,
  far: StarAccum,
): void {
  const ballSq = rowSweepRadiusPc(row) ** 2;
  const nearSq = nearPc * nearPc;
  const nearTaper: SweepTaper = { innerPc: nearPc, outerPc: nearPc * NEAR_TAPER };
  const reachTaper: SweepTaper = {
    innerPc: row.skyRadiusPc,
    outerPc: row.skyRadiusPc * SWEEP_TAPER,
  };
  const { stars, seeds, count } = survey;
  for (let i = 0; i < count; i++) {
    const at = i * SURVEY_STRIDE;
    const x = stars[at];
    const y = stars[at + 1];
    const z = stars[at + 2];
    const dx = x - viewpoint.xPc;
    const dy = y - viewpoint.yPc;
    const dz = z - viewpoint.zPc;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > ballSq) continue;
    const distance = Math.sqrt(d2);
    if (row.skyRadiusPc > 0 && unitAtPosition(x, y, z) >= taperKeep(reachTaper, distance)) {
      continue;
    }
    // The home star itself: travel arrives exactly on a slot.
    if (d2 < 2.5e-5) continue;
    const luminosity = stars[at + 3];
    const light = luminosity + stars[at + 4];
    const tEff = stars[at + 5];
    const censused =
      d2 <= nearSq || unitAtPosition(x, y, z) < taperKeep(nearTaper, distance);
    if (censused) {
      pushTo(d2 <= nearSq ? near : far, lut, dx, dy, dz, light, tEff, seeds[i]);
      continue;
    }
    if (distance > reachTaper.outerPc) continue;
    if (luminosity / d2 < MIN_FAR_IRRADIANCE) continue;
    pushTo(far, lut, dx, dy, dz, light, tEff, seeds[i]);
  }
}

/** Project surveys, in the order given, into one slab. */
export function projectSurveys(
  surveys: Iterable<CellSurvey>,
  rows: CatalogRow[],
  viewpoint: GalacticPosition,
): SweepSlab {
  const nearPc = neighborRadiusPc(viewpoint);
  const lut = buildTemperatureLut(96);
  const near = makeAccum();
  const far = makeAccum();
  for (const survey of surveys) {
    projectSurvey(survey, rows[survey.rowIndex], viewpoint, nearPc, lut, near, far);
  }
  return { near: packAccum(near), far: packAccum(far) };
}

/**
 * Sweep one catalog row from a viewpoint, cell by cell: each cell
 * surveyed from where the traveler stands, with no reach to hold,
 * and projected straight back.
 */
export function sweepRow(
  row: CatalogRow,
  rowIndex: number,
  viewpoint: GalacticPosition,
  onProgress?: (fraction: number) => void,
): SweepSlab {
  const frame = surveyFrameAt(viewpoint, 0);
  const nearPc = neighborRadiusPc(viewpoint);
  const lut = buildTemperatureLut(96);
  const near = makeAccum();
  const far = makeAccum();
  const cells = rowCells(row, viewpoint, rowSweepRadiusPc(row));
  for (let i = 0; i < cells.length; i++) {
    onProgress?.(i / cells.length);
    const survey = surveyCell(row, rowIndex, cells[i], frame);
    projectSurvey(survey, row, viewpoint, nearPc, lut, near, far);
  }
  return { near: packAccum(near), far: packAccum(far) };
}
