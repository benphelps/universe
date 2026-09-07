import { describe, expect, it } from 'vitest';
import { centredPhotonAngles, photonGeometryBytes, LayeredPhotonGeometry } from './photonGeometry';
import { faceAngle } from './photonTransport';

describe('shared cell-centred photon geometry', () => {
  it('matches the general formula across reflections, permutations and source planes', () => {
    const out = new Float64Array(6);
    for (let x = -5; x <= 5; x++) for (let y = -5; y <= 5; y++) for (let z = -5; z <= 5; z++) {
      centredPhotonAngles(8, x, y, z, out);
      const low = [x - 0.5, y - 0.5, z - 0.5], high = low.map(v => v + 1);
      for (let axis = 0; axis < 3; axis++) {
        const a = (axis + 1) % 3, b = (axis + 2) % 3;
        expect(out[2 * axis]).toBeCloseTo(faceAngle(-low[axis], low[a], high[a], low[b], high[b]), 12);
        expect(out[2 * axis + 1]).toBeCloseTo(faceAngle(high[axis], low[a], high[a], low[b], high[b]), 12);
      }
    }
  });
  it('replaces grades and bounds retained geometry independently of member count', () => {
    const out = new Float64Array(6);
    centredPhotonAngles(160, 100, 20, 15, out);
    expect(photonGeometryBytes()).toBeLessThan(17 << 20);
    centredPhotonAngles(48, 20, 15, 2, out);
    expect(photonGeometryBytes()).toBeLessThan(1 << 20);
  });
});

describe('layered off-centre photon geometry', () => {
  it('preserves the direct formula exactly through outward sweeps and plane eviction', () => {
    const size = 8, out = new Float64Array(6);
    for (const source of [[3.25, 4.125, 2.75], [0, 8, 0.25], [0.5, 7.5, 4], [4, 4, 4]]) {
      const geometry = new LayeredPhotonGeometry(size, source);
      expect(geometry.compatible).toBe(true);
      const order = source.map(s => Array.from({ length: size }, (_, i) => i)
        .sort((a, b) => Math.abs(a + 0.5 - s) - Math.abs(b + 0.5 - s)));
      for (const k of [...order[2], ...[...order[2]].reverse()]) {
        geometry.setLayer(k);
        for (const j of order[1]) for (const i of order[0]) {
          geometry.angles(i, j, out);
          const low = [i, j, k].map((v, axis) => v - source[axis]), high = low.map(v => v + 1);
          expect([...out]).toEqual([
            faceAngle(-low[0], low[1], high[1], low[2], high[2]), faceAngle(high[0], low[1], high[1], low[2], high[2]),
            faceAngle(-low[1], low[0], high[0], low[2], high[2]), faceAngle(high[1], low[0], high[0], low[2], high[2]),
            faceAngle(-low[2], low[0], high[0], low[1], high[1]), faceAngle(high[2], low[0], high[0], low[1], high[1]),
          ]);
        }
      }
      expect(geometry.bytes).toBe(4 * 3 * (size + 1) ** 2 * 8);
    }
  });
  it('bounds high-grade storage and declines vertices with different rounding histories', () => {
    const geometry = new LayeredPhotonGeometry(160, [80.25, 70.75, 60.125]);
    for (let k = 0; k < 160; k++) geometry.setLayer(k);
    expect(geometry.bytes).toBeLessThan(2.4 * 1024 ** 2);
    expect(new LayeredPhotonGeometry(8, [8 / 10001, 0.2, 0.3]).compatible).toBe(false);
  });
});
