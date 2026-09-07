import { deriveSeed, seedFromHex, seedToHex } from '../core/rng/hash';
import { setGalaxySeed } from '../universe/galaxy/galaxySeed';
import { generateSystem } from '../universe/system/generate';
import type { Neighbor } from '../universe/galaxy/neighborhood';
import type { GalacticPosition } from '../universe/galaxy/density';
import { buildSpiralStructure } from '../universe/galaxy/spiralStructure';
import { galaxyName } from '../universe/galaxy/regions';
import { cloudsNear } from '../universe/galaxy/clouds';
import { cloudGateway } from '../universe/galaxy/gateway';
import { galacticNucleus } from '../universe/galaxy/nucleus';
import { CATALOG_GALAXIES, HOME_GALAXY } from '../app/galaxyCatalog';
import { chartLocale } from '../app/localeInventory';
import { scenicWorlds, shortlistScenes, type SceneCandidate, type SceneFilter, type SceneProgress } from '../app/scenicFinder';
import { fmt, fmtSolarMasses } from '../app/ui/format';

export interface ScenicRequest {
  galaxy: string;
  seed: string;
  positionPc: GalacticPosition;
  neighbors: Pick<Neighbor, 'seedHex' | 'positionPc'>[];
  filter: SceneFilter;
  batch: number;
}
export type ScenicResponse = { type: 'progress'; progress: SceneProgress }
  | { type: 'complete'; candidates: SceneCandidate[] }
  | { type: 'error'; message: string };

const post = (message: ScenicResponse) => (self as unknown as Worker).postMessage(message);
self.onmessage = (event: MessageEvent<ScenicRequest>) => {
  try {
    const job = event.data;
    setGalaxySeed(seedFromHex(job.galaxy));
    let candidates: SceneCandidate[] = [];
    const wants = (kind: SceneFilter) => job.filter === 'all' || job.filter === kind;
    if (['all', 'ringed-moon', 'coastline', 'binary', 'rings', 'lava'].includes(job.filter)) {
      const destinations = new Map(job.neighbors.map(n => [n.seedHex, n.positionPc]));
      if (job.batch === 0) destinations.set(job.seed, job.positionPc);
      let checked = 0;
      for (const [seed, position] of destinations) {
        if (checked % 4 === 0) post({ type: 'progress', progress: { checked, total: destinations.size, stage: 'Nearby systems' } });
        // Match the precision retained by travel URLs before characterizing the body.
        const positionPc = Object.fromEntries(Object.entries(position).map(([key, value]) => [key, Number(value.toFixed(4))])) as unknown as GalacticPosition;
        candidates.push(...scenicWorlds(generateSystem(seedFromHex(seed), positionPc), job.galaxy, job.filter));
        // Bound retained metadata even in a very rich planetary neighborhood.
        if (++checked % 16 === 0) candidates = shortlistScenes(candidates, job.filter, 64);
      }
      post({ type: 'progress', progress: { checked, total: destinations.size, stage: 'Nearby systems' } });
    }
    if (wants('nebula')) {
      post({ type: 'progress', progress: { checked: 0, total: 1, stage: 'Local cloud survey' } });
      const inventory = chartLocale(job.positionPc);
      const clouds = [...new Map([...inventory.sector.clouds, ...inventory.nearClouds].map(c => [c.seedHex, c])).values()];
      const dark = clouds.filter(c => c.kind === 'dark');
      const distance = (a: GalacticPosition, b: GalacticPosition) => Math.hypot(a.xPc-b.xPc, a.yPc-b.yPc, a.zPc-b.zPc);
      const lit = clouds.filter(c => c.kind !== 'dark').map(c => ({ cloud: c,
        dust: dark.filter(d => distance(c.positionPc, d.positionPc) < (c.spanPc + d.spanPc) / 2 + 100).length }))
        .sort((a, b) => (b.dust > 0 ? 1 : 0) - (a.dust > 0 ? 1 : 0) || b.cloud.ionizingStars - a.cloud.ionizingStars || b.cloud.spanPc-a.cloud.spanPc).slice(0, 6);
      for (const { cloud, dust } of lit) {
        const physical = cloudsNear(cloud.positionPc, 5).find(c => seedToHex(c.seed) === cloud.seedHex);
        if (!physical) continue;
        const gateway = cloudGateway(physical);
        candidates.push({ id: `cloud:${job.galaxy}:${cloud.seedHex}`, kind: 'nebula', name: cloud.name,
          score: Math.round(50 + 20 * Number(dust > 0) + 20 * Math.min(1, cloud.ionizingStars / 10) + 10 * Math.min(1, cloud.spanPc / 150)),
          reasons: [`${cloud.kind} nebula · ${fmt(cloud.spanPc)} pc across`, `${dust} nearby dark clouds · ${cloud.ionizingStars} ionizing stars`],
          framing: 'Orbit the illuminated cloud face. Nearby dark clouds are candidates for silhouettes; their overlap depends on your line of sight.',
          destination: { galaxy: job.galaxy, seed: gateway.seedHex, positionPc: gateway.positionPc, cloud: cloud.seedHex } });
      }
    }
    if (wants('galaxy')) {
      const seeds = [seedFromHex(job.galaxy), ...Array.from({ length: 24 }, (_, i) => deriveSeed(seedFromHex(job.galaxy), 'scenic-galaxy', job.batch * 24 + i))];
      for (const [index, seed] of seeds.entries()) {
        post({ type: 'progress', progress: { checked: index, total: seeds.length, stage: 'Galaxy shapes' } });
        const shape = buildSpiralStructure(seed);
        const pitchRange = Math.max(...shape.arms.flatMap(a => [...a.pitchDegrees])) - Math.min(...shape.arms.flatMap(a => [...a.pitchDegrees]));
        candidates.push({ id: `galaxy:${seedToHex(seed)}`, kind: 'galaxy', variant: shape.family, name: galaxyName(seed),
          score: Math.round(55 + 20 * Number(shape.barRadiusPc > 0) + 15 * Math.min(1, pitchRange / 25) + 10 * Number(shape.family === 'grand-design')),
          reasons: [`${shape.family.replace('-', ' ')} · ${shape.arms.length} main arms`, shape.barRadiusPc ? `${fmt(shape.barRadiusPc / 1000)} kpc bar · branching dust lanes` : 'Unbarred · irregular arm structure'],
          framing: 'Arrive at the core, ride out until the galaxy fills the frame, then look down the galactic pole. Shape is ranked; final lighting needs inspection.',
          destination: { galaxy: seedToHex(seed), seed: job.seed, core: true } });
      }
    }
    if (wants('nucleus')) {
      const current = galacticNucleus();
      const entries = new Map([HOME_GALAXY, ...CATALOG_GALAXIES].map(g => [g.galaxy, { galaxy: g.galaxy, seed: g.seed, massSolar: g.massSolar, regime: g.regime, eddingtonRatio: g.eddingtonRatio }]));
      entries.set(job.galaxy, { galaxy: job.galaxy, seed: job.seed, massSolar: current.massSolar, regime: current.flow.regime, eddingtonRatio: current.flow.eddingtonRatio });
      for (const entry of entries.values()) if (entry.eddingtonRatio >= 0.001) candidates.push({
        id: `nucleus:${entry.galaxy}`, kind: 'nucleus', name: `${galaxyName(seedFromHex(entry.galaxy))} core`,
        score: Math.round(60 + 30 * Number(entry.regime === 'thin-disc') + 10 * Math.min(1, entry.eddingtonRatio)),
        reasons: [`${fmtSolarMasses(entry.massSolar)} M☉ · ${entry.regime === 'thin-disc' ? 'luminous disc' : 'hot torus'}`, `${fmt(entry.eddingtonRatio)} Eddington ratio · galaxy catalog`],
        framing: 'Tilt toward the flow plane until the shadow and lensed light separate clearly. Adjust exposure for bright accretion.',
        destination: { galaxy: entry.galaxy, seed: entry.seed, core: true } });
    }
    post({ type: 'complete', candidates: shortlistScenes(candidates, job.filter, 32) });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : 'The scenic survey failed.' });
  }
};
