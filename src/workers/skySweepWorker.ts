import { seedFromHex } from '../core/rng/hash';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import {
  surveyTask,
  type SurveyResult,
  type SurveyTask,
} from '../universe/galaxy/skyBuildPlan';

/** One job of the sky's cell survey — the parallel unit the sky
 *  coordinator farms out. */
self.onmessage = (event: MessageEvent<SurveyTask>) => {
  setGalaxySeed(seedFromHex(event.data.galaxy));
  const result = surveyTask(event.data);
  (self as unknown as Worker).postMessage(result, [
    result.cells.buffer,
    result.starts.buffer,
    result.stars.buffer,
    result.seeds.buffer,
  ]);
};
