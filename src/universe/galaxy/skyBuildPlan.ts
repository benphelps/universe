import { CATALOG_ROWS, rowCells, type CatalogCell } from './catalog';
import type { GalacticPosition } from './density';
import { neighborRadiusPc } from './neighborhood';
import {
  rowSweepRadiusPc,
  surveyCell,
  surveyServes,
  SURVEY_STRIDE,
  type CellSurvey,
  type SurveyFrame,
} from './skySurvey';
import type { SkySurveyCache } from './skySurveyCache';

/** One cell of a build, in sweep order, and the survey that serves it
 *  once one does. */
export interface PlannedCell {
  rowIndex: number;
  cell: CatalogCell;
  survey: CellSurvey | null;
}

/** A run of one row's unserved cells, for one worker to survey. */
export interface SurveyJob {
  rowIndex: number;
  cells: PlannedCell[];
}

export interface SkyBuildPlan {
  /** Every cell of the sky, in the order the field concatenates them. */
  cells: PlannedCell[];
  /** The cells no survey serves, cut into jobs. */
  jobs: SurveyJob[];
  /** Cells per row, and the share of each row already served. */
  rowCellCounts: number[];
  rowServedCounts: number[];
}

/**
 * What a sky at this viewpoint needs swept: every cell of every row
 * within its sweep, served from the cache where a survey there still
 * covers this viewpoint, and jobbed out where none does. Jobs are cut
 * from each row's unserved cells in sweep order, so a job is a
 * contiguous slab of the ball whatever the cache left of it.
 */
export function planSkyBuild(
  viewpoint: GalacticPosition,
  cache: SkySurveyCache,
  jobsPerRow: number,
): SkyBuildPlan {
  const nearPc = neighborRadiusPc(viewpoint);
  const cells: PlannedCell[] = [];
  const jobs: SurveyJob[] = [];
  const rowCellCounts: number[] = [];
  const rowServedCounts: number[] = [];
  CATALOG_ROWS.forEach((row, rowIndex) => {
    const unserved: PlannedCell[] = [];
    let served = 0;
    const rowCellsHere = rowCells(row, viewpoint, rowSweepRadiusPc(row));
    for (const cell of rowCellsHere) {
      const standing = cache.get(rowIndex, cell);
      const survey =
        standing && surveyServes(standing, row, viewpoint, nearPc) ? standing : null;
      const planned: PlannedCell = { rowIndex, cell, survey };
      cells.push(planned);
      if (survey) served++;
      else unserved.push(planned);
    }
    rowCellCounts.push(rowCellsHere.length);
    rowServedCounts.push(served);
    const count = Math.min(jobsPerRow, unserved.length);
    for (let j = 0; j < count; j++) {
      const lo = Math.floor((j * unserved.length) / count);
      const hi = Math.floor(((j + 1) * unserved.length) / count);
      jobs.push({ rowIndex, cells: unserved.slice(lo, hi) });
    }
  });
  return { cells, jobs, rowCellCounts, rowServedCounts };
}

/**
 * The order to hand jobs out in, heaviest star first.
 *
 * Which job a worker takes when has nothing to do with the sky that
 * comes out — cells are filed by place, so the assembled field is the
 * serial sweep's whichever way this sorts. What it decides is the
 * order the sky arrives in on screen, and the catalogue is banded by
 * mass: sweeping the giants and the hot stars before the dwarfs puts
 * the stars a traveler would actually notice up first and thickens
 * the faint field in behind them.
 */
export function jobOrder(jobs: SurveyJob[]): number[] {
  return jobs
    .map((_, index) => index)
    .sort((a, b) => {
      const byMass = CATALOG_ROWS[jobs[b].rowIndex].massHi - CATALOG_ROWS[jobs[a].rowIndex].massHi;
      return byMass !== 0 ? byMass : a - b;
    });
}

/** A job on the wire: one row's cells to survey under a frame. */
export interface SurveyTask {
  taskId: number;
  rowIndex: number;
  /** ix, iy, iz per cell. */
  cells: Int32Array;
  frame: SurveyFrame;
  /** The session's galaxy, hex. */
  galaxy: string;
}

/** A job's surveys on the wire: every cell's stars packed end to end,
 *  cut at starts. */
export interface SurveyResult {
  taskId: number;
  rowIndex: number;
  cells: Int32Array;
  frame: SurveyFrame;
  starts: Uint32Array;
  stars: Float64Array;
  seeds: BigUint64Array;
}

export function packCells(cells: CatalogCell[]): Int32Array {
  const packed = new Int32Array(cells.length * 3);
  cells.forEach((cell, i) => {
    packed[i * 3] = cell.ix;
    packed[i * 3 + 1] = cell.iy;
    packed[i * 3 + 2] = cell.iz;
  });
  return packed;
}

/** Survey a task's cells, in order, into one result. */
export function surveyTask(task: SurveyTask): SurveyResult {
  const row = CATALOG_ROWS[task.rowIndex];
  const count = task.cells.length / 3;
  const surveys: CellSurvey[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const cell = { ix: task.cells[i * 3], iy: task.cells[i * 3 + 1], iz: task.cells[i * 3 + 2] };
    const survey = surveyCell(row, task.rowIndex, cell, task.frame);
    surveys.push(survey);
    total += survey.count;
  }
  const starts = new Uint32Array(count + 1);
  const stars = new Float64Array(total * SURVEY_STRIDE);
  const seeds = new BigUint64Array(total);
  let at = 0;
  surveys.forEach((survey, i) => {
    starts[i] = at;
    stars.set(survey.stars, at * SURVEY_STRIDE);
    seeds.set(survey.seeds, at);
    at += survey.count;
  });
  starts[count] = at;
  return {
    taskId: task.taskId,
    rowIndex: task.rowIndex,
    cells: task.cells,
    frame: task.frame,
    starts,
    stars,
    seeds,
  };
}

/** The surveys a result carries, each with its own copy of its stars
 *  so the cache can let go of them one cell at a time. */
export function unpackSurveys(result: SurveyResult): CellSurvey[] {
  const count = result.cells.length / 3;
  const surveys: CellSurvey[] = [];
  for (let i = 0; i < count; i++) {
    const lo = result.starts[i];
    const hi = result.starts[i + 1];
    surveys.push({
      rowIndex: result.rowIndex,
      cell: { ix: result.cells[i * 3], iy: result.cells[i * 3 + 1], iz: result.cells[i * 3 + 2] },
      frame: result.frame,
      count: hi - lo,
      stars: result.stars.slice(lo * SURVEY_STRIDE, hi * SURVEY_STRIDE),
      seeds: result.seeds.slice(lo, hi),
    });
  }
  return surveys;
}
