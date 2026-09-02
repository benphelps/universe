import { describe, expect, it } from 'vitest';
import { cloudFineDustDensity, cloudReachPc, cloudsNear } from './clouds';
import { HOME_POSITION } from './density';
import { hydrogenDensity } from './gas';
import { hydrogenBetaLuminosity, spitzerRadiusPc } from './ionization';
import { nebulaFor, type Nebula } from './nebula';
import { nebulaEmissionColor, nebulaLines } from './nebulaLines';
import {
  bakeNebulaVolume,
  bakeOccupancy,
  combinedOccupancy,
  marchNebulaCpu,
  OCCUPANCY_SIZE,
  planNebulaBake,
  type NebulaVolumeBake,
} from './nebulaVolume';

/** The brightest H II region near home whose group is still whole —
 *  the classic subject these bake tests reason about. A group that has
 *  had supernovae carries its wall at the very front and vents most
 *  directions, and that population has its own pins. */
function brightestNebula(): Nebula {
  const lit = cloudsNear(HOME_POSITION, 900)
    .map((cloud) => nebulaFor(cloud))
    .filter(
      (nebula): nebula is Nebula =>
        nebula !== null && nebula.photonRate > 0 && nebula.supernovae === 0,
    )
    .sort((a, b) => b.photonRate - a.photonRate);
  return lit[0];
}

describe('nebular colour', () => {
  it('is the line mixture, not a ramp', () => {
    // Hydrogen alone is magenta — Hα in the red and the Balmer series
    // in the blue, with nothing between them. That is why a true-colour
    // photograph of an H II region is pink rather than the teal of a
    // narrowband map.
    const [r, g, b] = nebulaEmissionColor(0);
    expect(r).toBeGreaterThan(g * 4);
    expect(b).toBeGreaterThan(g * 4);
    // Doubly ionized oxygen under a hot star takes it the other way.
    const hot = nebulaEmissionColor(1);
    expect(hot[1]).toBeGreaterThan(hot[0]);
    expect(hot[2]).toBeGreaterThan(hot[0]);
  });

  it('carries no brightness of its own', () => {
    // The volume's emission measure says how bright the gas is; the
    // colour must not smuggle brightness in beside it.
    for (const hardness of [0, 0.5, 1]) {
      const [r, g, b] = nebulaEmissionColor(hardness);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 6);
    }
  });

  it('takes oxygen further under hotter stars, monotonically', () => {
    const o3 = (tEff: number): number =>
      nebulaLines(0.8, tEff, 0).find(([nm]) => nm === 500.7)?.[1] ?? 0;
    let last = 0;
    for (const tEff of [30000, 33000, 36000, 39000, 42000, 46000]) {
      expect(o3(tEff)).toBeGreaterThanOrEqual(last);
      last = o3(tEff);
    }
    // Orion's core, roughly: Θ¹C at ~39 kK, high U, solar gas.
    const orion = o3(39000);
    expect(orion).toBeGreaterThan(2);
    expect(orion).toBeLessThan(4.5);
  });

  it('peaks its excitation below solar metallicity', () => {
    // Metal-poor gas cools badly and runs hot, exciting its scarce
    // oxygen harder per atom: [O III]/Hβ is stronger in an LMC-like
    // region than a solar one, and collapses only when the metals are
    // nearly gone — the classic inversion, and the reason colour now
    // varies with galactocentric radius on its own.
    const o3 = (feH: number): number =>
      nebulaLines(0.8, 42000, feH).find(([nm]) => nm === 500.7)?.[1] ?? 0;
    expect(o3(-0.5)).toBeGreaterThan(o3(0));
    expect(o3(0)).toBeGreaterThan(o3(-1.8));
    // And the low-ionization skin runs redder where metals run rich.
    const n2 = (feH: number): number =>
      nebulaLines(0.2, 42000, feH).find(([nm]) => nm === 658.4)?.[1] ?? 0;
    expect(n2(0.3)).toBeGreaterThan(n2(0));
    expect(n2(0)).toBeGreaterThan(n2(-1));
  });
});

describe('the region at its age', () => {
  it('expands from its natal radius by the Spitzer solution', () => {
    expect(spitzerRadiusPc(0.73, 0)).toBeCloseTo(0.73, 6);
    expect(spitzerRadiusPc(0.73, 5)).toBeGreaterThan(spitzerRadiusPc(0.73, 2));
    // The Suoriloth case that exposed this: a 0.73 pc natal front at
    // 11 Myr is a region of tens of parsecs, not a pinprick.
    const evolved = spitzerRadiusPc(0.73, 11);
    expect(evolved).toBeGreaterThan(14);
    expect(evolved).toBeLessThan(22);
  });

  it('is visible at cloud scale, where its sprite promised it', () => {
    // The seam this closes: the sky's impostor painted an emission
    // complex, and the volume that stood in for it carried the region
    // at its natal radius — under one cell, invisible. The evolved
    // front is what the cloud-scale grid resolves.
    const nebula = brightestNebula();
    const size = 32;
    const cloudScale = bakeNebulaVolume(nebula.cloud, nebula, size, cloudReachPc(nebula.cloud));
    let ionized = 0;
    for (let i = 0; i < size ** 3; i++) if (cloudScale.data[i * 4 + 1] > 8) ionized++;
    expect(nebula.bubbleRadiusPc).toBeGreaterThan(nebula.stromgrenRadiusPc);
    expect(ionized).toBeGreaterThan(50);
    expect(cloudScale.emissionCoefficient).toBeGreaterThan(0);
  });

  it('dilutes its interior by the Spitzer factor', () => {
    // The expansion's invariant, pinned directly: the interior gas is
    // the natal core read at contracted radius, diluted n ∝ R^{-3/2}
    // — which is what conserves the recombination budget through the
    // growth. The old total-emission-measure proxy could not survive
    // the shell's ionized skin, whose measure scales with the front's
    // area and rightly dwarfs the interior.
    const grown = cloudsNear(HOME_POSITION, 900)
      .map((cloud) => nebulaFor(cloud))
      .filter(
        (nebula): nebula is Nebula =>
          nebula !== null &&
          nebula.photonRate > 0 &&
          nebula.bubbleRadiusPc < 0.5 * Math.max(...nebula.halfExtentsPc),
      )
      .sort((a, b) => b.photonRate - a.photonRate)[0];
    expect(grown).toBeDefined();
    // The bubble-scale box, where the interior is actually resolved —
    // at cloud scale the band is a couple of cells. Raw grids, wind
    // and venting disarmed on the plan itself, surgically: the
    // interior band would otherwise sit partly inside the cavity with
    // its pockets gated, and bytes would quantize the diluted interior
    // away under the skin's reference.
    const size = 48;
    const plan = planNebulaBake(grown.cloud, grown, size);
    plan.windCavityPc = 0;
    plan.ventConfineDensity = 0;
    const fields = marchNebulaCpu(plan);
    const growth = Math.max(1, grown.bubbleRadiusPc / grown.stromgrenRadiusPc);
    const halfPc = Math.min(
      Math.max(...grown.halfExtentsPc),
      4 * grown.bubbleRadiusPc,
    );
    const cellPc = (2 * halfPc) / size;
    let sum = 0;
    let cells = 0;
    for (let k = 0; k < size; k++) {
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          // The bubble box is centred on the source itself.
          const x = -halfPc + (i + 0.5) * cellPc;
          const y = -halfPc + (j + 0.5) * cellPc;
          const z = -halfPc + (k + 0.5) * cellPc;
          const r = Math.hypot(x, y, z);
          if (r < 0.15 * grown.bubbleRadiusPc || r > 0.6 * grown.bubbleRadiusPc) continue;
          const value = fields.ionized[(k * size + j) * size + i];
          if (value > 0) {
            sum += value;
            cells++;
          }
        }
      }
    }
    expect(cells).toBeGreaterThan(10);
    const diluted = grown.sourceHydrogenDensity * growth ** -1.5;
    const mean = sum / cells;
    expect(mean).toBeGreaterThan(diluted * 0.2);
    expect(mean).toBeLessThan(diluted * 5);
  });

  it('is hollowed by its star wind into a ring, not a filled disc', () => {
    // Real evolved regions are limb-brightened shells — the wind
    // evacuates the interior and piles it into a photoionized wall,
    // which is where the n² emission concentrates. Along every ray
    // that has a cavity at all (a front stalled inside the cavity
    // radius has none), the bake's cavity must be dark against the
    // wall it rises to.
    const nebula = brightestNebula();
    expect(nebula.windCavityPc).toBeGreaterThan(0);
    const cavities = cavityEdges(bakeNebulaVolume(nebula.cloud, nebula, 48), nebula);
    expect(cavities.length).toBeGreaterThanOrEqual(8);
    for (const { insideByte, peakByte } of cavities) {
      expect(peakByte).toBeGreaterThan(5 * insideByte);
    }
  });

  it('blows the cavity out where the interior is thin and stalls it where it is dense', () => {
    // A snowplow's radius goes as the ploughed density to the −¼, so
    // the cavity is not one sphere: along a thin direction its edge
    // runs ahead of the mean, against a filament it hangs back — the
    // cloud's own turbulence corrugates it. The bake's cavity edge
    // must vary with direction, and in the sense the density says.
    const nebula = brightestNebula();
    const cavities = cavityEdges(bakeNebulaVolume(nebula.cloud, nebula, 48), nebula);
    const edges = cavities.map((c) => c.edgePc);
    expect(Math.max(...edges) / Math.min(...edges)).toBeGreaterThan(1.3);
    // Rank the rays by the interior density the wind ploughed at the
    // mean cavity's natal position: the thinnest third must carry the
    // edge further out than the densest third.
    const growth = Math.max(1, nebula.bubbleRadiusPc / nebula.stromgrenRadiusPc);
    const source = nebula.sources[0];
    const ranked = cavities
      .map((c) => ({
        edgePc: c.edgePc,
        ploughed: cloudFineDustDensity(
          nebula.cloud,
          source.dxPc + (c.dir[0] * nebula.windCavityPc) / growth,
          source.dyPc + (c.dir[1] * nebula.windCavityPc) / growth,
          source.dzPc + (c.dir[2] * nebula.windCavityPc) / growth,
        ),
      }))
      .sort((a, b) => a.ploughed - b.ploughed);
    const third = Math.floor(ranked.length / 3);
    const mean = (rows: typeof ranked): number =>
      rows.reduce((sum, row) => sum + row.edgePc, 0) / rows.length;
    expect(mean(ranked.slice(0, third))).toBeGreaterThan(mean(ranked.slice(-third)));
  });

  it('vents where the bubble outruns its own cloud', () => {
    // Champagne: hot gas is held together by the cloud around it, so a
    // bubble section standing where the natal field has run out must
    // stream away and go dim, while sections the cloud still confines
    // keep their brightness. The gate is the cloud's own carved
    // boundary — which is what opens a face-blister into a horseshoe.
    // Pinned as an A/B against the disarmed gate on the same nebula:
    // dense front cells barely exist to compare against, because a
    // dense direction stops its own ray before the front — the march
    // itself sees to that. What the gate must do is dim the thin-gas
    // sectors it gates, and leave everything else exactly alone.
    // The wind structures are identical in both variants and cancel in
    // the comparison, so no radial band is needed: every in-bubble
    // cell is fair, classified by the natal field alone. Bubble-scale
    // boxes, where cells resolve the interior; accumulated across
    // candidates, since any one region's live thin pockets can be
    // shadowed away. Raw march grids: the shell skin owns the byte
    // reference and would quantize away exactly the cells compared.
    const candidates = cloudsNear(HOME_POSITION, 1500)
      .map((cloud) => nebulaFor(cloud))
      .filter((n): n is Nebula => n !== null && n.photonRate > 0 && n.windCavityPc > 0)
      .sort((a, b) => b.photonRate - a.photonRate)
      .slice(0, 8);
    const size = 32;
    let thinOn = 0;
    let thinOff = 0;
    let denseOn = 0;
    let denseOff = 0;
    for (const nebula of candidates) {
      if (thinOff > 0 && denseOff > 0) break;
      const vented = marchNebulaCpu(planNebulaBake(nebula.cloud, nebula, size));
      // The gate disarmed on the plan itself — erosion keeps its
      // pivot, so fronted cells stay identical on both sides and only
      // the champagne gate differs.
      const heldPlan = planNebulaBake(nebula.cloud, nebula, size);
      heldPlan.ventConfineDensity = 0;
      const held = marchNebulaCpu(heldPlan);
      const source = nebula.sources[0];
      const halfPc = Math.min(
        Math.max(...nebula.halfExtentsPc),
        Math.max(5, 4 * nebula.bubbleRadiusPc),
      );
      const cellPc = (2 * halfPc) / size;
      const growth = Math.max(1, nebula.bubbleRadiusPc / nebula.stromgrenRadiusPc);
      const confine = nebula.sourceHydrogenDensity * growth ** -1.5;
      for (let k = 0; k < size; k++) {
        for (let j = 0; j < size; j++) {
          for (let i = 0; i < size; i++) {
            // The bubble box is centred on the source; the cloud frame
            // needs the source's own offset back.
            const x = -halfPc + (i + 0.5) * cellPc;
            const y = -halfPc + (j + 0.5) * cellPc;
            const z = -halfPc + (k + 0.5) * cellPc;
            if (Math.hypot(x, y, z) > 0.97 * nebula.bubbleRadiusPc) continue;
            const local = hydrogenDensity(
              cloudFineDustDensity(
                nebula.cloud,
                x + source.dxPc,
                y + source.dyPc,
                z + source.dzPc,
              ),
            );
            const cell = (k * size + j) * size + i;
            const gOn = vented.ionized[cell];
            const gOff = held.ionized[cell];
            if (local < 0.2 * confine) {
              thinOn += gOn;
              thinOff += gOff;
            } else if (local >= confine) {
              denseOn += gOn;
              denseOff += gOff;
            }
          }
        }
      }
    }
    // The gated sectors carried real emission and lost most of it.
    expect(thinOff).toBeGreaterThan(0);
    expect(thinOn).toBeLessThan(0.35 * thinOff);
    // Fully confined cells pass through the gate untouched — exactly,
    // since these are the raw march grids.
    expect(Math.abs(denseOn - denseOff)).toBeLessThanOrEqual(1e-6 * Math.max(1, denseOff));
  });

  it('still carries the bubble at its own scale when one is warranted', () => {
    const nebula = brightestNebula();
    const size = 32;
    const bubble = bakeNebulaVolume(nebula.cloud, nebula, size);
    let ionized = 0;
    for (let i = 0; i < size ** 3; i++) if (bubble.data[i * 4 + 1] > 8) ionized++;
    // A hundred was a filled natal ball's count. An evolved region is
    // a wind-hollowed, vented ring with a lit rim — fewer cells, and
    // rightly so; what matters is that a region stands at all.
    expect(ionized).toBeGreaterThan(30);
    expect(bubble.emissionCoefficient).toBeGreaterThan(0);
  });
});

describe('clouds that never lit', () => {
  it('are bodies too', () => {
    // The dark rifts are the same objects as the nebulae beside them,
    // and travelling to one has to give something to look at: dust,
    // with no emission and no source to light it.
    const dark = cloudsNear(HOME_POSITION, 600).find((cloud) => nebulaFor(cloud) === null);
    expect(dark).toBeDefined();
    const bake = bakeNebulaVolume(dark!, null, 24, cloudReachPc(dark!));
    let dusty = 0;
    let ionized = 0;
    for (let i = 0; i < 24 ** 3; i++) {
      if (bake.data[i * 4] > 8) dusty++;
      if (bake.data[i * 4 + 1] > 8) ionized++;
    }
    expect(dusty).toBeGreaterThan(0);
    expect(ionized).toBe(0);
    expect(bake.emissionCoefficient).toBe(0);
    // No stars, nothing for the dust to scatter: a rift is dark from
    // outside and from within.
    expect(bake.scatterLuminositySolar).toBe(0);
  });
});

describe('the emission budget', () => {
  it('takes its brightness from the ionizing budget', () => {
    // Every ionizing photon is answered by a recombination and a fixed
    // share of those cascade through Hβ, so a nebula's luminosity is
    // its star's output converted — not a dial. The standard
    // conversion is 4.78e-13 erg per ionizing photon per second.
    expect(hydrogenBetaLuminosity(1e49) / 1e49).toBeGreaterThan(4.5e-13);
    expect(hydrogenBetaLuminosity(1e49) / 1e49).toBeLessThan(5.1e-13);
    expect(hydrogenBetaLuminosity(2e49)).toBeCloseTo(2 * hydrogenBetaLuminosity(1e49), 6);
    expect(hydrogenBetaLuminosity(0)).toBe(0);
  });
});

describe('the volume bake', () => {
  const nebula = brightestNebula();
  const size = 32;
  const bake = bakeNebulaVolume(nebula.cloud, nebula, size);

  it('spreads that budget over the gas by n²', () => {
    // The coefficient closes the books: total line light divided by the
    // emission measure that will carry it. A lit nebula has one.
    expect(bake.emissionCoefficient).toBeGreaterThan(0);
    expect(Number.isFinite(bake.emissionCoefficient)).toBe(true);
  });

  it('is sized to the ionized region rather than to the cloud', () => {
    // The box follows the region at its age: the bubble and its walls,
    // never wider than the cloud that bounds it, with cells fine
    // enough that the front has somewhere to stand.
    expect(bake.halfExtentsPc[0]).toBeLessThanOrEqual(Math.max(...nebula.halfExtentsPc));
    expect(bake.halfExtentsPc[0]).toBeGreaterThan(nebula.stromgrenRadiusPc);
    const cellPc = (2 * bake.halfExtentsPc[0]) / size;
    expect(nebula.bubbleRadiusPc / cellPc).toBeGreaterThan(2);
  });

  it('leaves both ionized gas and neutral gas', () => {
    let ionized = 0;
    let neutral = 0;
    for (let i = 0; i < size ** 3; i++) {
      const dust = bake.data[i * 4];
      const ion = bake.data[i * 4 + 1];
      if (ion > 8) ionized++;
      else if (dust > 8) neutral++;
    }
    expect(ionized).toBeGreaterThan(0);
    // If the front swallowed the box there would be nothing left to
    // shadow with, and no dark structure anywhere in the picture. An
    // evolved region has eaten deeper into its cloud than a natal one,
    // but the walls that survive are what carve the picture.
    expect(neutral).toBeGreaterThan(ionized * 0.1);
  });

  it('breaks the front against the gas instead of blowing a sphere', () => {
    // The ionizing budget is spent along each ray through the real
    // density field, so the front reaches further down thin channels
    // than through dense clumps. A front at one radius in every
    // direction would mean the field is smooth at the bubble's scale
    // and there is no structure for the light to find.
    const half = bake.halfExtentsPc[0];
    const cellPc = (2 * half) / size;
    const fronts: number[] = [];
    for (let a = 0; a < 160; a++) {
      const phi = a * 2.399963229728653;
      const cosTheta = 1 - (2 * (a + 0.5)) / 160;
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const dir = [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta];
      let front = 0;
      for (let r = cellPc * 0.5; r < half; r += cellPc * 0.5) {
        const index = dir.map((d) => Math.floor((d * r + half) / cellPc));
        if (index.some((c) => c < 0 || c >= size)) break;
        const cell = ((index[2] * size + index[1]) * size + index[0]) * 4;
        if (bake.data[cell + 1] > 8) front = r;
      }
      fronts.push(front);
    }
    // Venting honestly darkens some directions outright — a pocket the
    // cloud cannot confine has no glow to find a front in — so the
    // shape is measured over the directions that kept one, and enough
    // of them must have.
    // A quarter of the sky is enough directions for the percentiles
    // to mean something; a blister keeps far less than half.
    const found = fronts.filter((front) => front > 0).sort((a, b) => a - b);
    expect(found.length).toBeGreaterThan(fronts.length * 0.25);
    const low = found[Math.floor(0.15 * found.length)];
    const high = found[Math.floor(0.85 * found.length)];
    // Venting claims the farthest-reaching thin channels outright, so
    // the surviving fronts spread less than they once did — but a
    // smooth field would put this near one, and the carved field
    // measures a third over it.
    expect(high / low).toBeGreaterThan(1.2);
  });

  it('lights the dust from the star that shines on it', () => {
    // The scattered glow is the group's light, placed where the group
    // is: at the bubble scale the ionizing star is the box centre; at
    // cloud scale the same star keeps its true offset in the cloud.
    expect(bake.scatterLuminositySolar).toBe(nebula.totalLuminosity);
    expect(bake.scatterSourcePc).toEqual([0, 0, 0]);
    const cloudScale = bakeNebulaVolume(nebula.cloud, nebula, 16, cloudReachPc(nebula.cloud));
    const source = nebula.sources[0];
    expect(cloudScale.scatterSourcePc).toEqual([source.dxPc, source.dyPc, source.dzPc]);
    expect(cloudScale.scatterLuminositySolar).toBe(nebula.totalLuminosity);
  });

  it('dims the source light through the gas it crosses', () => {
    // Transmittance is the star's own light reaching each cell, which
    // is what the dust has to scatter. It can only fall with depth.
    const half = bake.halfExtentsPc[0];
    const centre = Math.floor(size / 2);
    const at = (i: number): number =>
      bake.data[((centre * size + centre) * size + i) * 4 + 3];
    expect(at(centre)).toBeGreaterThanOrEqual(at(0));
    expect(at(centre)).toBeGreaterThanOrEqual(at(size - 1));
    expect(half).toBeGreaterThan(0);
  });
});

describe('the occupancy grid', () => {
  it('marks a block, and the blocks a read beside it could reach', () => {
    // A single lit cell in the middle of a block marks that block
    // alone; one on a block's face also marks the block across the
    // face, since a trilinear read just inside that block touches it.
    // Four cells per block, so a cell can sit clear of every face.
    const size = OCCUPANCY_SIZE * 4;
    const data = new Uint8Array(size ** 3 * 4);
    const at = (i: number, j: number, k: number): number => ((k * size + j) * size + i) * 4;
    const block = (i: number, j: number, k: number): number =>
      (k * OCCUPANCY_SIZE + j) * OCCUPANCY_SIZE + i;
    data[at(5, 5, 5)] = 7;
    let occupancy = bakeOccupancy(data, size);
    expect(occupancy[block(1, 1, 1)]).toBe(255);
    expect(occupancy.reduce((n, value) => n + (value ? 1 : 0), 0)).toBe(1);
    data[at(5, 5, 5)] = 0;
    data[at(8, 5, 5) + 1] = 1;
    occupancy = bakeOccupancy(data, size);
    expect(occupancy[block(2, 1, 1)]).toBe(255);
    expect(occupancy[block(1, 1, 1)]).toBe(255);
    expect(occupancy.reduce((n, value) => n + (value ? 1 : 0), 0)).toBe(2);
  });

  it('is empty where the bake is', () => {
    const bake = bakeNebulaVolume(brightestNebula().cloud, brightestNebula(), 32);
    const occupied = bake.occupancy.reduce((n, value) => n + (value ? 1 : 0), 0);
    expect(occupied).toBeGreaterThan(0);
    expect(occupied).toBeLessThan(OCCUPANCY_SIZE ** 3);
  });
});

describe('the combined occupancy', () => {
  it('marks the coarse blocks a fine grid holds gas in', () => {
    // A bubble-scale grid with one occupied block inside an otherwise
    // empty cloud-scale box: the march reads the fine grid there, so
    // the coarse blocks that block overlaps must count as occupied.
    const empty = (half: number, centre: [number, number, number]): NebulaVolumeBake =>
      ({
        halfExtentsPc: [half, half, half],
        centrePc: centre,
        occupancy: new Uint8Array(OCCUPANCY_SIZE ** 3),
      }) as unknown as NebulaVolumeBake;
    const coarse = empty(100, [0, 0, 0]);
    const fine = empty(25, [50, 0, 0]);
    // One fine block, chosen so its extent in the coarse frame sits
    // inside a single coarse block on every axis; the expected coarse
    // block follows from the geometry rather than being hand-picked.
    const half = OCCUPANCY_SIZE / 2;
    const fineBlockPc = 50 / OCCUPANCY_SIZE;
    const coarseBlockPc = 200 / OCCUPANCY_SIZE;
    const toCoarse = (pc: number): number => Math.floor((pc + 100) / coarseBlockPc);
    let chosen = -1;
    for (let b = 0; b < OCCUPANCY_SIZE; b++) {
      const lo = 50 - 25 + b * fineBlockPc;
      if (toCoarse(lo) === toCoarse(lo + fineBlockPc)) chosen = b;
    }
    expect(chosen).toBeGreaterThanOrEqual(0);
    fine.occupancy[(half * OCCUPANCY_SIZE + half) * OCCUPANCY_SIZE + chosen] = 255;
    const occupancy = combinedOccupancy(coarse, fine);
    const y = toCoarse(half * fineBlockPc - 25);
    expect(occupancy[(y * OCCUPANCY_SIZE + y) * OCCUPANCY_SIZE + toCoarse(25 + chosen * fineBlockPc)]).toBe(255);
    expect(occupancy.reduce((n, value) => n + (value ? 1 : 0), 0)).toBe(1);
  });
});

/**
 * The cavity along a fan of directions from the source: the radius
 * where the ionized byte first climbs to a third of the ray's peak,
 * for every ray whose innermost sample sits below that — a ray the
 * front stalls inside the cavity radius has no cavity to measure.
 */
function cavityEdges(
  bake: ReturnType<typeof bakeNebulaVolume>,
  nebula: Nebula,
): Array<{ dir: [number, number, number]; edgePc: number; insideByte: number; peakByte: number }> {
  const size = bake.size;
  const half = bake.halfExtentsPc[0];
  const cellPc = (2 * half) / size;
  const byteAt = (x: number, y: number, z: number): number => {
    const i = Math.floor((x + half) / cellPc);
    const j = Math.floor((y + half) / cellPc);
    const k = Math.floor((z + half) / cellPc);
    if (i < 0 || j < 0 || k < 0 || i >= size || j >= size || k >= size) return 0;
    return bake.data[((k * size + j) * size + i) * 4 + 1];
  };
  const cavities: Array<{ dir: [number, number, number]; edgePc: number; insideByte: number; peakByte: number }> = [];
  for (let n = 0; n < 27; n++) {
    const raw: [number, number, number] = [(n % 3) - 1, (Math.floor(n / 3) % 3) - 1, Math.floor(n / 9) - 1];
    if (raw[0] === 0 && raw[1] === 0 && raw[2] === 0) continue;
    const norm = Math.hypot(...raw);
    const dir: [number, number, number] = [raw[0] / norm, raw[1] / norm, raw[2] / norm];
    const radii: number[] = [];
    const bytes: number[] = [];
    for (let r = nebula.windCavityPc * 0.3; r <= nebula.windCavityPc * 1.9; r += cellPc * 0.5) {
      radii.push(r);
      bytes.push(byteAt(dir[0] * r, dir[1] * r, dir[2] * r));
    }
    const peakByte = Math.max(...bytes);
    const insideByte = bytes[0];
    // A ray too faint to read, or one the front stalls inside the
    // cavity radius, has no cavity to measure.
    if (peakByte < 16 || insideByte >= peakByte / 3) continue;
    const edge = bytes.findIndex((byte) => byte >= peakByte / 3);
    cavities.push({ dir, edgePc: radii[edge], insideByte, peakByte });
  }
  return cavities;
}
