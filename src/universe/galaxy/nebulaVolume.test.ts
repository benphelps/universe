import { describe, expect, it } from 'vitest';
import { cloudFineDustDensity, cloudReachPc, cloudsNear } from './clouds';
import { HOME_POSITION } from './density';
import { hydrogenDensity } from './gas';
import { hydrogenBetaLuminosity, spitzerRadiusPc } from './ionization';
import { nebulaFor, type Nebula } from './nebula';
import { nebulaEmissionColor, nebulaLines } from './nebulaLines';
import { bakeNebulaVolume, marchNebulaCpu, planNebulaBake } from './nebulaVolume';

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
    plan.windWallPc = 0;
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
    // which is where the n² emission concentrates. The bake's cavity
    // must be dark against its own wall.
    const nebula = brightestNebula();
    expect(nebula.windCavityPc).toBeGreaterThan(0);
    const size = 32;
    const bake = bakeNebulaVolume(nebula.cloud, nebula, size);
    const half = bake.halfExtentsPc[0];
    const cellPc = (2 * half) / size;
    let cavitySum = 0;
    let cavityCells = 0;
    let wallSum = 0;
    let wallCells = 0;
    for (let k = 0; k < size; k++) {
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const x = -half + (i + 0.5) * cellPc;
          const y = -half + (j + 0.5) * cellPc;
          const z = -half + (k + 0.5) * cellPc;
          const r = Math.hypot(x, y, z);
          const g = bake.data[((k * size + j) * size + i) * 4 + 1];
          if (r < nebula.windCavityPc * 0.6) {
            cavitySum += g;
            cavityCells++;
          } else if (r >= nebula.windCavityPc && r <= nebula.windCavityPc * 1.15) {
            wallSum += g;
            wallCells++;
          }
        }
      }
    }
    expect(cavityCells).toBeGreaterThan(0);
    expect(wallCells).toBeGreaterThan(0);
    expect(wallSum / wallCells).toBeGreaterThan(5 * (cavitySum / Math.max(1, cavityCells)));
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
