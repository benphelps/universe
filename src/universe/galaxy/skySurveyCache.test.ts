import { describe, expect, it } from 'vitest';
import { CATALOG_ROWS, rowCells } from './catalog';
import { HOME_POSITION } from './density';
import { jobOrder, packCells, planSkyBuild, surveyTask, unpackSurveys } from './skyBuildPlan';
import {
  rowSweepRadiusPc,
  surveyCell,
  surveyFrameAt,
  SURVEY_STRIDE,
  type CellSurvey,
} from './skySurvey';
import { SkySurveyCache } from './skySurveyCache';

function fakeSurvey(rowIndex: number, ix: number, iy: number, iz: number, count: number): CellSurvey {
  return {
    rowIndex,
    cell: { ix, iy, iz },
    frame: surveyFrameAt(HOME_POSITION),
    count,
    stars: new Float64Array(count * SURVEY_STRIDE),
    seeds: new BigUint64Array(count),
  };
}

describe('sky survey cache', () => {
  it('holds surveys by cell and replaces a cell in place', () => {
    const cache = new SkySurveyCache(1000);
    cache.put(fakeSurvey(0, 1, 2, 3, 10));
    cache.put(fakeSurvey(0, 1, 2, 3, 25));
    cache.put(fakeSurvey(1, 1, 2, 3, 5));
    expect(cache.size).toBe(2);
    expect(cache.stars).toBe(30);
    expect(cache.get(0, { ix: 1, iy: 2, iz: 3 })?.count).toBe(25);
  });

  it('makes room from the cells furthest away, sparing the sky it stands in', () => {
    const cache = new SkySurveyCache(150);
    const cellPc = CATALOG_ROWS[0].cellPc;
    const ix = Math.floor(HOME_POSITION.xPc / cellPc);
    const iz = Math.floor(HOME_POSITION.zPc / cellPc);
    // Row 0 sweeps 135 pc: cells at 5, 30 and 60 reaches of that.
    cache.put(fakeSurvey(0, ix, 0, iz, 60));
    cache.put(fakeSurvey(0, ix + 500, 0, iz, 60));
    cache.put(fakeSurvey(0, ix + 3000, 0, iz, 60));
    cache.put(fakeSurvey(0, ix + 6000, 0, iz, 60));
    cache.trim(HOME_POSITION);
    expect(cache.stars).toBe(120);
    expect(cache.get(0, { ix, iy: 0, iz })).toBeDefined();
    expect(cache.get(0, { ix: ix + 500, iy: 0, iz })).toBeDefined();
    expect(cache.get(0, { ix: ix + 3000, iy: 0, iz })).toBeUndefined();
    expect(cache.get(0, { ix: ix + 6000, iy: 0, iz })).toBeUndefined();
  });

  it('never drops a cell the current sky draws from', () => {
    const cache = new SkySurveyCache(10);
    const cellPc = CATALOG_ROWS[0].cellPc;
    const ix = Math.floor(HOME_POSITION.xPc / cellPc);
    const iz = Math.floor(HOME_POSITION.zPc / cellPc);
    cache.put(fakeSurvey(0, ix, 0, iz, 60));
    cache.put(fakeSurvey(0, ix + 5, 0, iz, 60));
    cache.trim(HOME_POSITION);
    expect(cache.size).toBe(2);
  });
});

describe('sky build plan', () => {
  it('jobs every unserved cell exactly once, in sweep order, and none once served', () => {
    const cache = new SkySurveyCache(1e9);
    const plan = planSkyBuild(HOME_POSITION, cache, 12);
    CATALOG_ROWS.forEach((row, rowIndex) => {
      const cells = rowCells(row, HOME_POSITION, rowSweepRadiusPc(row));
      expect(plan.rowCellCounts[rowIndex]).toBe(cells.length);
      expect(plan.rowServedCounts[rowIndex]).toBe(0);
      const jobbed = plan.jobs
        .filter((job) => job.rowIndex === rowIndex)
        .flatMap((job) => job.cells.map((planned) => planned.cell));
      expect(jobbed).toEqual(cells);
    });
    expect(plan.cells.every((planned) => planned.survey === null)).toBe(true);
    // The heaviest stars go out first.
    const order = jobOrder(plan.jobs);
    expect(CATALOG_ROWS[plan.jobs[order[0]].rowIndex].massHi).toBe(120);

    const frame = surveyFrameAt(HOME_POSITION);
    for (const job of plan.jobs.filter((candidate) => CATALOG_ROWS[candidate.rowIndex].skyRadiusPc === 0)) {
      const task = {
        taskId: 1,
        rowIndex: job.rowIndex,
        cells: packCells(job.cells.map((planned) => planned.cell)),
        frame,
        galaxy: '',
      };
      for (const survey of unpackSurveys(surveyTask(task))) cache.put(survey);
    }
    const again = planSkyBuild(HOME_POSITION, cache, 12);
    CATALOG_ROWS.forEach((row, rowIndex) => {
      const served = row.skyRadiusPc === 0 ? again.rowCellCounts[rowIndex] : 0;
      expect(again.rowServedCounts[rowIndex]).toBe(served);
    });
    expect(again.jobs.every((job) => CATALOG_ROWS[job.rowIndex].skyRadiusPc > 0)).toBe(true);
  });

  it('a task round-trips its surveys through the wire', () => {
    const rowIndex = 5;
    const row = CATALOG_ROWS[rowIndex];
    const frame = surveyFrameAt(HOME_POSITION);
    const cells = rowCells(row, HOME_POSITION, rowSweepRadiusPc(row)).slice(0, 40);
    const direct = cells.map((cell) => surveyCell(row, rowIndex, cell, frame));
    const result = surveyTask({ taskId: 7, rowIndex, cells: packCells(cells), frame, galaxy: '' });
    const unpacked = unpackSurveys(result);
    expect(unpacked.length).toBe(cells.length);
    unpacked.forEach((survey, i) => {
      expect(survey.cell).toEqual(cells[i]);
      expect(survey.count).toBe(direct[i].count);
      expect(survey.stars).toEqual(direct[i].stars);
      expect(survey.seeds).toEqual(direct[i].seeds);
    });
    expect(result.starts[cells.length]).toBe(direct.reduce((sum, s) => sum + s.count, 0));
  });
});
