import { CATALOG_ROWS, type CatalogCell } from './catalog';
import type { GalacticPosition } from './density';
import { rowSweepRadiusPc, type CellSurvey } from './skySurvey';

/**
 * The cell surveys a traveler carries from sky to sky.
 *
 * A survey is kept until the room is needed, and the room is taken
 * from the cells standing furthest from where the traveler is now,
 * measured in their own row's reach — a giant's cell six hundred
 * parsecs wide is near at a distance that puts a dwarf's cell far
 * behind. Nothing the current sky draws from is ever dropped, so a
 * sky bigger than the budget simply holds it for as long as it is
 * being stood in.
 */
export class SkySurveyCache {
  private readonly surveys = new Map<string, CellSurvey>();
  private held = 0;

  constructor(readonly starBudget: number) {}

  get size(): number {
    return this.surveys.size;
  }

  /** Stars held across every survey. */
  get stars(): number {
    return this.held;
  }

  get(rowIndex: number, cell: CatalogCell): CellSurvey | undefined {
    return this.surveys.get(surveyKey(rowIndex, cell));
  }

  put(survey: CellSurvey): void {
    const key = surveyKey(survey.rowIndex, survey.cell);
    const standing = this.surveys.get(key);
    if (standing) this.held -= standing.count;
    this.surveys.set(key, survey);
    this.held += survey.count;
  }

  clear(): void {
    this.surveys.clear();
    this.held = 0;
  }

  /**
   * Make room, furthest first, sparing every cell within its row's
   * sweep of the viewpoint.
   */
  trim(viewpoint: GalacticPosition): void {
    if (this.held <= this.starBudget) return;
    const ranked: { key: string; count: number; standing: number }[] = [];
    for (const [key, survey] of this.surveys) {
      const standing = standingReaches(survey, viewpoint);
      if (standing > 1) ranked.push({ key, count: survey.count, standing });
    }
    ranked.sort((a, b) => b.standing - a.standing);
    for (const { key, count } of ranked) {
      if (this.held <= this.starBudget) return;
      this.surveys.delete(key);
      this.held -= count;
    }
  }
}

function surveyKey(rowIndex: number, cell: CatalogCell): string {
  return `${rowIndex}:${cell.ix}:${cell.iy}:${cell.iz}`;
}

/** How far a cell stands from a point, in units of its row's sweep
 *  radius — 1 at the edge of the sky it would be swept for. */
function standingReaches(survey: CellSurvey, viewpoint: GalacticPosition): number {
  const row = CATALOG_ROWS[survey.rowIndex];
  const { cellPc } = row;
  const axis = (v: number, lo: number): number => Math.max(lo, Math.min(v, lo + cellPc)) - v;
  const gx = axis(viewpoint.xPc, survey.cell.ix * cellPc);
  const gy = axis(viewpoint.yPc, survey.cell.iy * cellPc);
  const gz = axis(viewpoint.zPc, survey.cell.iz * cellPc);
  return Math.sqrt(gx * gx + gy * gy + gz * gz) / rowSweepRadiusPc(row);
}
