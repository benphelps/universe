import { describe, expect, it } from 'vitest';
import { cloudsNear } from './clouds';
import { HOME_POSITION } from './density';
import { hydrogenBetaLuminosity } from './ionization';
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
  const bake = bakeNebulaVolume(nebula, size);

  it('spreads that budget over the gas by n²', () => {
    // The coefficient closes the books: total line light divided by the
    // emission measure that will carry it. A lit nebula has one.
    expect(bake.emissionCoefficient).toBeGreaterThan(0);
    expect(Number.isFinite(bake.emissionCoefficient)).toBe(true);
  });

  it('is sized to the ionized region rather than to the cloud', () => {
    // A giant molecular cloud is a hundred parsecs across and the
    // bubble its newborns blow is a few. Gridding the cloud puts the
    // whole nebula inside a single cell.
    expect(bake.halfExtentsPc[0]).toBeLessThan(Math.max(...nebula.halfExtentsPc));
    expect(bake.halfExtentsPc[0]).toBeGreaterThan(nebula.stromgrenRadiusPc);
    const cellPc = (2 * bake.halfExtentsPc[0]) / size;
    expect(nebula.stromgrenRadiusPc / cellPc).toBeGreaterThan(2);
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
    // shadow with, and no dark structure anywhere in the picture.
    expect(neutral).toBeGreaterThan(ionized * 0.2);
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
