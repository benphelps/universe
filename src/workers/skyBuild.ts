import { CATALOG_ROWS } from '../universe/galaxy/catalog';
import type { GalacticPosition } from '../universe/galaxy/density';
import {
  jobOrder,
  packCells,
  planSkyBuild,
  unpackSurveys,
  type SurveyTask,
} from '../universe/galaxy/skyBuildPlan';
import { projectSurveys, surveyFrameAt, type CellSurvey } from '../universe/galaxy/skySurvey';
import type { SkySurveyCache } from '../universe/galaxy/skySurveyCache';
import { assembleSkyField, catalogRowWeights, rowStageName } from '../universe/galaxy/skyfield';
import type { GenerationPermits } from './generationPermits';
import type { SkyBackgroundBuilder } from './skyBackground';
import { progressReporter, sendBackgroundPreview, sendPreview, type Post } from './skyBuildMessages';
import type { SkySweepPool } from './skySweepPool';

/** One requested sky, and the means to give it up. */
export interface SkyBuild {
  seedHex: string;
  viewpoint: GalacticPosition;
  seed: bigint;
  galaxy: string;
  cancelled: boolean;
  /** Settles when the build is given up. */
  abandoned: Promise<void>;
  abandon: () => void;
}

export function makeSkyBuild(
  seedHex: string,
  viewpoint: GalacticPosition,
  seed: bigint,
  galaxy: string,
): SkyBuild {
  let abandon = (): void => {};
  const abandoned = new Promise<void>((resolve) => {
    abandon = resolve;
  });
  const build: SkyBuild = {
    seedHex,
    viewpoint,
    seed,
    galaxy,
    cancelled: false,
    abandoned,
    abandon: () => {
      build.cancelled = true;
      abandon();
    },
  };
  return build;
}

export interface SkyBuildDeps {
  pool: SkySweepPool;
  cache: SkySurveyCache;
  permits: GenerationPermits;
  background: SkyBackgroundBuilder;
  post: Post;
  nextTaskId: () => number;
}

/** The share of the progress bar the star survey owns. */
const SURVEY_SHARE = 0.84;

/**
 * Build one sky: what the cache already serves goes to the screen at
 * once, the cells it does not are jobbed across the pool and drawn
 * as each job lands, the background is built beside them, and the
 * field is projected and assembled once everything is in. Giving the
 * build up stops it at the next step; jobs already running still
 * come home to the cache.
 */
export async function runSkyBuild(build: SkyBuild, deps: SkyBuildDeps): Promise<void> {
  if (build.cancelled) return;
  const { seedHex, viewpoint, seed, galaxy } = build;
  const report = progressReporter(seedHex, deps.post);
  const frame = surveyFrameAt(viewpoint);
  const plan = planSkyBuild(viewpoint, deps.cache, deps.pool.size * 3);
  const weights = catalogRowWeights();
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  let doneWeight = 0;
  plan.rowCellCounts.forEach((count, rowIndex) => {
    if (count > 0) doneWeight += (weights[rowIndex] * plan.rowServedCounts[rowIndex]) / count;
  });

  const served = plan.cells.flatMap((planned) => (planned.survey ? [planned.survey] : []));
  if (served.length > 0) sendPreview(seedHex, projectSurveys(served, CATALOG_ROWS, viewpoint), deps.post);
  const stageOf = (jobIndex: number): string =>
    plan.jobs.length === 0 ? '' : rowStageName(CATALOG_ROWS[plan.jobs[jobIndex].rowIndex]);
  report((SURVEY_SHARE * doneWeight) / totalWeight, stageOf(0), 0);

  const jobDone = new Array<boolean>(plan.jobs.length).fill(false);
  let finished = 0;
  const surveyed = new Promise<void>((resolve) => {
    if (plan.jobs.length === 0) {
      resolve();
      return;
    }
    for (const jobIndex of jobOrder(plan.jobs)) {
      const job = plan.jobs[jobIndex];
      const task: SurveyTask = {
        taskId: deps.nextTaskId(),
        rowIndex: job.rowIndex,
        cells: packCells(job.cells.map((planned) => planned.cell)),
        frame,
        galaxy,
      };
      deps.pool.run(task, (result) => {
        const surveys = unpackSurveys(result);
        for (const survey of surveys) deps.cache.put(survey);
        if (build.cancelled) return;
        job.cells.forEach((planned, i) => {
          planned.survey = surveys[i];
        });
        jobDone[jobIndex] = true;
        finished++;
        doneWeight += (weights[job.rowIndex] * job.cells.length) / plan.rowCellCounts[job.rowIndex];
        // The stage the build is furthest behind on: the row that owns
        // the earliest job still outstanding.
        let behind = 0;
        while (behind < plan.jobs.length && jobDone[behind]) behind++;
        report(
          (SURVEY_SHARE * doneWeight) / totalWeight,
          stageOf(Math.min(behind, plan.jobs.length - 1)),
          finished / plan.jobs.length,
        );
        sendPreview(seedHex, projectSurveys(surveys, CATALOG_ROWS, viewpoint), deps.post);
        if (finished === plan.jobs.length) resolve();
      });
    }
  });

  // Ship the background the moment it exists — the sky has something
  // in it long before the stars are finished arriving.
  const backgroundReady = deps.background
    .start(seedHex, viewpoint, galaxy, () => build.cancelled)
    .then((built) => {
      if (!built || build.cancelled) return undefined;
      sendBackgroundPreview(seedHex, built, deps.post);
      return built;
    });

  await Promise.race([surveyed, build.abandoned]);
  if (build.cancelled) return;
  deps.cache.trim(viewpoint);
  const slab = projectSurveys(
    plan.cells.map((planned) => planned.survey as CellSurvey),
    CATALOG_ROWS,
    viewpoint,
  );
  const background = await Promise.race([backgroundReady, build.abandoned]);
  if (build.cancelled) return;
  const release = await deps.permits.acquire('background');
  if (build.cancelled) {
    release();
    return;
  }
  try {
    const sky = assembleSkyField(viewpoint, seed, [slab], report, background ?? undefined);
    deps.post({ seedHex, sky }, [
      sky.starDirs.buffer,
      sky.starColors.buffer,
      sky.starBrightness.buffer,
      sky.starDistances.buffer,
      sky.starTeffs.buffer,
      sky.starSeeds.buffer,
      sky.sectorBounds.buffer,
      sky.sectorHomeBounds.buffer,
      sky.constellationBounds.buffer,
      sky.nebulaAtlas.buffer,
      sky.glowData.buffer,
      sky.riftData.buffer,
      sky.darkAtlas.buffer,
    ]);
  } finally {
    release();
  }
}
