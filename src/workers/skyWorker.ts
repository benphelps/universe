import { seedFromHex, seedToHex } from '../core/rng/hash';
import type { GenerationGrantMessage } from '../app/generationScheduler';
import type { GalacticPosition } from '../universe/galaxy/density';
import { PRIME_GALAXY_SEED, setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { viewpointForSeed } from '../universe/galaxy/sectors';
import { SkySurveyCache } from '../universe/galaxy/skySurveyCache';
import { GenerationPermits } from './generationPermits';
import { SkyBackgroundBuilder } from './skyBackground';
import { makeSkyBuild, runSkyBuild, type SkyBuild } from './skyBuild';
import { SkySweepPool } from './skySweepPool';

export interface SkyRequest {
  seedHex: string;
  /** The system's true locale (catalog travel); absent for bare seeds. */
  viewpoint?: GalacticPosition;
  /** The session's galaxy; absent means the prime galaxy. */
  galaxy?: string;
}

/** Give up every sky build queued or running. */
export interface SkyCancelMessage {
  type: 'sky-cancel';
}

/**
 * The sky coordinator. Builds queue and run one at a time; each is
 * planned against the cell surveys kept from earlier skies, so a jump
 * to a neighbouring star surveys only the cells the move brings newly
 * into reach. A cancelled build is given up in place — never by ending
 * the worker, whose cache is what makes the next arrival fast.
 */
const POOL_SIZE = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
/** Stars the cache may hold before the cells furthest away are let
 *  go: a couple of skies' worth in the inner disk, many near the rim. */
const SURVEY_STAR_BUDGET = 2_000_000;

const post = (message: unknown, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(message, transfer);

const permits = new GenerationPermits(post);
const cache = new SkySurveyCache(SURVEY_STAR_BUDGET);
const background = new SkyBackgroundBuilder(permits);
let pool: SkySweepPool | null = null;
let cacheGalaxy: string | null = null;
let nextTaskId = 1;
let current: SkyBuild | null = null;
const pending: SkyBuild[] = [];

function pump(): void {
  if (current || pending.length === 0) return;
  current = pending.shift()!;
  pool ??= new SkySweepPool(POOL_SIZE, (priority) => permits.acquire(priority));
  void runSkyBuild(current, {
    pool,
    cache,
    permits,
    background,
    post,
    nextTaskId: () => nextTaskId++,
  }).finally(() => {
    current = null;
    pump();
  });
}

function cancelAll(): void {
  for (const build of pending) build.abandon();
  pending.length = 0;
  current?.abandon();
  pool?.abandon();
  background.cancel();
  permits.abandonPending();
}

self.onmessage = (
  event: MessageEvent<SkyRequest | GenerationGrantMessage | SkyCancelMessage>,
) => {
  const data = event.data;
  if ('type' in data) {
    if (data.type === 'sky-cancel') cancelAll();
    else permits.grant(data.requestId);
    return;
  }
  const { seedHex, viewpoint, galaxy } = data;
  const seed = seedFromHex(seedHex);
  if (galaxy) setGalaxySeed(seedFromHex(galaxy));
  const galaxyHex = galaxy ?? seedToHex(PRIME_GALAXY_SEED);
  // Surveys are of one galaxy's cells; another galaxy's are no use.
  if (galaxyHex !== cacheGalaxy) {
    cache.clear();
    cacheGalaxy = galaxyHex;
  }
  pending.push(makeSkyBuild(seedHex, viewpoint ?? viewpointForSeed(seed), seed, galaxyHex));
  pump();
};
