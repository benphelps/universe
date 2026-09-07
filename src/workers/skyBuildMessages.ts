import type { SweepSlab } from '../universe/galaxy/skyStars';
import type {
  SkyBackground,
  SkyBackgroundPreview,
  SkyPreview,
  SkyProgress,
} from '../universe/galaxy/skyfield';

/** How a build reaches the main thread. */
export type Post = (message: unknown, transfer?: Transferable[]) => void;

/** Parallel producers own separate work shares. Once the star survey
 * finishes, report the background's real stage instead of its last row. */
export function skyBuildProgress(seedHex: string, post: Post): {
  survey: SkyProgress; background: SkyProgress; assembly: SkyProgress;
} {
  const report = progressReporter(seedHex, post);
  let survey = 0, background = 0, surveyStage = '', surveyStep = 0;
  let backgroundStage = 'waiting for sky background', backgroundStep = -1;
  const update = () => report(0.84 * survey + 0.05 * background,
    survey < 1 ? surveyStage : background >= 1 ? 'assembling sky' : backgroundStage,
    survey < 1 ? surveyStep : background >= 1 ? -1 : backgroundStep);
  return {
    survey(fraction, stage, step) { survey = Math.max(survey, Math.min(1, fraction)); surveyStage = stage; surveyStep = step; update(); },
    background(fraction, stage, step) { background = Math.max(background, Math.min(1, fraction)); backgroundStage = stage; backgroundStep = step; update(); },
    assembly: report,
  };
}

/** Progress, reported when it has moved enough to be worth a message. */
export function progressReporter(seedHex: string, post: Post): SkyProgress {
  let lastFraction = 0;
  let lastStage = '';
  let lastStageFraction = 0;
  return (fraction, stage, stageFraction) => {
    // A failed GPU background can retry on the CPU. Preserve completed
    // work in the bar while showing the replacement stage explicitly.
    fraction = Math.max(lastFraction, Math.min(1, fraction));
    if (
      stage === lastStage &&
      fraction - lastFraction < 0.01 &&
      Math.abs(stageFraction - lastStageFraction) < 0.04
    ) {
      return;
    }
    lastFraction = fraction;
    lastStage = stage;
    lastStageFraction = stageFraction;
    post({ seedHex, progress: fraction, stage, stageFraction });
  };
}

/**
 * Ship a slab's far stars for the traveler to look at while the rest
 * is still being surveyed. Only what a star needs to be drawn goes —
 * where it is, what colour, how bright, how far. Near stars are left
 * out: they are the neighbourhood, on screen as its own points before
 * the sky build even starts.
 */
export function sendPreview(seedHex: string, slab: SweepSlab, post: Post): void {
  const { far } = slab;
  if (far.brightness.length === 0) return;
  const preview: SkyPreview = {
    seedHex,
    dirs: far.dirs,
    colors: far.colors,
    brightness: far.brightness,
    distances: far.distances,
  };
  post(preview, [
    preview.dirs.buffer,
    preview.colors.buffer,
    preview.brightness.buffer,
    preview.distances.buffer,
  ]);
}

/**
 * Hand the finished background to the main thread so it can be drawn
 * while the stars are still coming in. A copy: the assembly still
 * needs all of it.
 */
export function sendBackgroundPreview(
  seedHex: string,
  background: SkyBackground,
  post: Post,
): void {
  const preview: SkyBackgroundPreview = {
    seedHex,
    background: {
      ...background,
      nebulaAtlas: background.nebulaAtlas.slice(),
      darkAtlas: background.darkAtlas.slice(),
      groupStars: background.groupStars,
      sceneFromGalaxy: background.sceneFromGalaxy.slice(),
      sectorBounds: background.sectorBounds.slice(),
      sectorHomeBounds: background.sectorHomeBounds.slice(),
      glowData: background.glowData.slice(),
      riftData: background.riftData.slice(),
    },
  };
  post(preview, [
    preview.background.nebulaAtlas.buffer,
    preview.background.darkAtlas.buffer,
    preview.background.sceneFromGalaxy.buffer,
    preview.background.sectorBounds.buffer,
    preview.background.sectorHomeBounds.buffer,
    preview.background.glowData.buffer,
    preview.background.riftData.buffer,
  ]);
}
