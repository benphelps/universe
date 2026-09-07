import { describe, expect, it } from 'vitest';
import { CM_PER_PC, PROTON_MASS, SOLAR_MASS } from '../../core/physics/constants';
import { cloudHalfExtentsPc, cloudVolumePc3, type MolecularCloud } from './clouds';
import { HOME_POSITION } from './density';
import { cloudGasSummary, cloudHydrogenDensity, cloudMassSolar, MASS_PER_HYDROGEN } from './gas';

const cloud: MolecularCloud = { seed: 0xadb7a33b629c834an, positionPc: HOME_POSITION, radiusPc: 20, amplitude: 250 };
const massPerUnit = CM_PER_PC ** 3 * MASS_PER_HYDROGEN * PROTON_MASS / SOLAR_MASS;

describe('cloud inventory integration', () => {
  it('preserves the pointwise physical gas integral when invariant factors are lifted out', () => {
    const half = cloudHalfExtentsPc(cloud);
    for (const feH of [-1.5, 0, 0.4]) {
      let densitySum = 0;
      const n = 16;
      for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
        const p = [x, y, z].map((i, axis) => -half[axis] + (i + 0.5) * 2 * half[axis] / n);
        densitySum += cloudHydrogenDensity(cloud, p[0], p[1], p[2], feH);
      }
      const expected = densitySum * 8 * half[0] * half[1] * half[2] / n ** 3 * massPerUnit;
      expect(cloudMassSolar(cloud, feH, n) / expected).toBeCloseTo(1, 12);
    }
  });

  it('reports mass and mean density from the same gas and nominal volume', () => {
    const summary = cloudGasSummary(cloud);
    expect(summary.meanDensity * cloudVolumePc3(cloud) * massPerUnit / summary.massSolar).toBeCloseTo(1, 12);
    // A refinement check for the audited reflection-cloud shape.
    expect(Math.abs(summary.massSolar / cloudMassSolar(cloud, 0, 96) - 1)).toBeLessThan(0.01);
  });
});
