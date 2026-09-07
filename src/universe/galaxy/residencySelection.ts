import { cloudReachPc, cloudsNear, type MolecularCloud } from './clouds';
import type { GalacticPosition } from './density';
import { buildNebula, type Nebula } from './nebula';
import { residencyLight, residencyWeightFromLight, type ResidencyLight } from './residency';
import { nebulaBakeMemory } from './nebulaBakeMemory';

export interface ResidencyQuery {
  position: GalacticPosition;
  reachPc: number;
  minimumAngular: number;
  count: number;
  pedestal: number;
  focused: MolecularCloud | null;
  /** Precompute admission plans off the frame thread for these grades. */
  grades?: number[];
}
export type ResidencyEstimates = Record<number, ReturnType<typeof nebulaBakeMemory>>;
export interface ResidencyChoice { cloud: MolecularCloud; nebula: Nebula | null; weight: number; estimates: ResidencyEstimates }
export interface ResidencySelection {
  chosen: ResidencyChoice[];
  candidates: number;
  built: number;
  cached: number;
  elapsedMs: number;
}

/** Worker-owned compact ranking cache. Full populations are retained only for
 * a small set of selected clouds; scanning a dense center cannot flush every
 * ranking entry just because it contains more than 4,096 clouds. */
export class ResidencySelector {
  private readonly lights = new Map<bigint, ResidencyLight | null>();
  private readonly selected = new Map<bigint, { nebula: Nebula | null; estimates: ResidencyEstimates }>();
  constructor(private readonly capacity = 16384,
    private readonly generate = buildNebula,
    private readonly find = cloudsNear) {}

  async select(query: ResidencyQuery, cancelled = () => false,
    yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))): Promise<ResidencySelection | null> {
    const started = performance.now();
    let slice = started, built = 0;
    const ranked: Array<{ cloud: MolecularCloud; weight: number }> = [];
    for (const cloud of this.find(query.position, query.reachPc)) {
      if (cancelled()) return null;
      const distance = Math.hypot(cloud.positionPc.xPc - query.position.xPc,
        cloud.positionPc.yPc - query.position.yPc, cloud.positionPc.zPc - query.position.zPc);
      if (cloudReachPc(cloud) / Math.max(1, distance) < query.minimumAngular) continue;
      let light = this.lights.get(cloud.seed);
      if (light === undefined) {
        light = residencyLight(cloud, this.generate(cloud));
        built++;
      } else this.lights.delete(cloud.seed);
      this.lights.set(cloud.seed, light);
      if (this.lights.size > this.capacity) this.lights.delete(this.lights.keys().next().value!);
      ranked.push({ cloud, weight: residencyWeightFromLight(cloud, light, distance, query.pedestal) });
      if (performance.now() - slice >= 8) { await yieldTask(); slice = performance.now(); }
    }
    if (cancelled()) return null;
    ranked.sort((a, b) => b.weight - a.weight);
    const chosen = ranked.slice(0, query.count);
    if (query.focused && !chosen.some(c => c.cloud.seed === query.focused!.seed)) {
      if (chosen.length === query.count) chosen.pop();
      chosen.push({ cloud: query.focused, weight: Infinity });
    }
    const result: ResidencyChoice[] = [];
    for (const candidate of chosen) {
      if (cancelled()) return null;
      let held = this.selected.get(candidate.cloud.seed);
      if (!held) held = { nebula: this.generate(candidate.cloud), estimates: {} };
      else this.selected.delete(candidate.cloud.seed);
      for (const size of query.grades ?? []) {
        held.estimates[size] ??= nebulaBakeMemory(candidate.cloud, held.nebula, size);
        if (performance.now() - slice >= 8) { await yieldTask(); slice = performance.now(); }
        if (cancelled()) return null;
      }
      this.selected.set(candidate.cloud.seed, held);
      if (this.selected.size > 64) this.selected.delete(this.selected.keys().next().value!);
      result.push({ ...candidate, ...held });
      if (performance.now() - slice >= 8) { await yieldTask(); slice = performance.now(); }
    }
    return cancelled() ? null : { chosen: result, candidates: ranked.length, built,
      cached: this.lights.size, elapsedMs: performance.now() - started };
  }
}
