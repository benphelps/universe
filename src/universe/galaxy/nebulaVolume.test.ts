import { describe, expect, it } from 'vitest';
import { cloudReachPc, cloudsNear } from './clouds';
import { HOME_POSITION } from './density';
import { hydrogenBetaLuminosity, spitzerRadiusPc } from './ionization';
import { nebulaFor, type Nebula } from './nebula';
import { nebulaEmissionColor } from './nebulaLines';
import { bakeNebulaVolume } from './nebulaVolume';

/** The brightest H II region near home — the one the viewer would pick. */
function brightestNebula(): Nebula {
  const lit = cloudsNear(HOME_POSITION, 900)
    .map((cloud) => nebulaFor(cloud))
    .filter((nebula): nebula is Nebula => nebula !== null && nebula.photonRate > 0)
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

  it('conserves the recombination budget through the growth', () => {
    // Spitzer dilution is n ∝ R^{-3/2}, so n²V is invariant: the grown
    // region holds the same emission measure the natal one did. Baked
    // both ways — the same nebula frozen at its natal radius, and at
    // its age — the totals must agree up to the grid.
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
    const size = 32;
    const boxPc = cloudReachPc(grown.cloud);
    const measureOf = (bake: ReturnType<typeof bakeNebulaVolume>): number => {
      let total = 0;
      for (let i = 0; i < size ** 3; i++) {
        const n = (bake.data[i * 4 + 1] / 255) * bake.densityRef;
        total += n * n;
      }
      return total * (2 * bake.halfExtentsPc[0]) ** 3;
    };
    // Wind off on both sides: the invariant here is the Spitzer
    // dilution, and the cavity is a separate mechanism that
    // deliberately moves emission measure into its wall (its own test
    // pins that ring) — frozen at the natal radius the evolved cavity
    // would swallow the whole bubble and measure nothing.
    const natal = measureOf(
      bakeNebulaVolume(
        grown.cloud,
        { ...grown, bubbleRadiusPc: grown.stromgrenRadiusPc, windCavityPc: 0 },
        size,
        boxPc,
      ),
    );
    const evolved = measureOf(
      bakeNebulaVolume(grown.cloud, { ...grown, windCavityPc: 0 }, size, boxPc),
    );
    expect(evolved).toBeGreaterThan(natal * 0.2);
    expect(evolved).toBeLessThan(natal * 5);
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

  it('still carries the bubble at its own scale when one is warranted', () => {
    const nebula = brightestNebula();
    const size = 32;
    const bubble = bakeNebulaVolume(nebula.cloud, nebula, size);
    let ionized = 0;
    for (let i = 0; i < size ** 3; i++) if (bubble.data[i * 4 + 1] > 8) ionized++;
    expect(ionized).toBeGreaterThan(100);
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
    fronts.sort((a, b) => a - b);
    const low = fronts[Math.floor(0.15 * fronts.length)];
    const high = fronts[Math.floor(0.85 * fronts.length)];
    expect(low).toBeGreaterThan(0);
    expect(high / low).toBeGreaterThan(1.4);
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
