import { expect, it } from 'vitest';
import { waterIceFraction } from './waterIce';
import type { SurfaceParams } from './params';
import type { SurfaceField } from './field';
import { buildChunkMesh } from './chunkMesh';
import { bakeSurfaceCube } from './surfaceBake';

const params = { radiusM: 6_371_000, surfaceMeanK: 273.16, poleDeltaK: 12, lapseKPerKm: 6.5,
  atmosphericCapK: 210, surfaceIce: true, magmaCoverage: 0, palette: { ice: [0.75, 0.8, 0.85] } } as SurfaceParams;
const ocean: [number, number, number] = [0.015, 0.04, 0.08];
const field = (recipe = params): SurfaceField => ({ params: recipe, seaLevelM: 0,
  heightAt: () => -100, waterLevelAt: () => 0, colorAt: () => [0.3, 0.2, 0.1] });

it('freezes actual water at its local height and leaves dry/magma materials alone', () => {
  const equator = { x: 1, y: 0, z: 0 }, pole = { x: 0, y: 1, z: 0 };
  expect(waterIceFraction(params, equator, 0)).toBe(0);
  expect(waterIceFraction(params, pole, 0)).toBe(1);
  expect(waterIceFraction(params, equator, 1000)).toBe(1);
  expect(waterIceFraction({ ...params, surfaceIce: false }, pole, 0)).toBe(0);
  expect(waterIceFraction({ ...params, magmaCoverage: 1 }, pole, 0)).toBe(0);
});

it('distant basins carry ice reflectance and only their liquid fraction carries glint', () => {
  for (const temperature of [250, 273.16, 290]) {
    const recipe = { ...params, surfaceMeanK: temperature, poleDeltaK: 0 };
    const ice = temperature === 250 ? 1 : temperature === 290 ? 0 : 0.5;
    for (const face of bakeSurfaceCube(field(recipe), 8, ocean)) for (let i = 0; i < face.length; i += 4) {
      expect(face[i + 3] / 255).toBeCloseTo(1 - ice, 2);
      for (let c = 0; c < 3; c++) {
        const expected = ocean[c] * (1 - ice) + params.palette.ice[c] * ice;
        expect(Math.abs((face[i + c] / 255) ** 2 - expected)).toBeLessThan(2 / 255);
      }
    }
  }
  const magma = { ...params, magmaCoverage: 1, fullyMolten: true };
  expect(bakeSurfaceCube(field(magma), 8, ocean).every(face => face.every((v, i) => i % 4 !== 3 || v === 255))).toBe(true);
  expect(buildChunkMesh(field(magma), 4, 0, 0, 0, 16).waterIce).toBeNull();
});

it('streamed ice reproduces parent triangle interpolation through every LOD transition', () => {
  const res = 16;
  for (const level of [1, 4, 12, 22]) {
    const x = 2 ** (level - 1) - 1, y = Math.floor(x * 0.4);
    const parent = buildChunkMesh(field(), 4, level - 1, x, y, res);
    expect(parent.waterIce!.byteLength).toBe(((res + 1) ** 2 + 4 * (res + 1)) * 2);
    for (const cx of [0, 1]) for (const cy of [0, 1]) {
      const child = buildChunkMesh(field(), 4, level, 2 * x + cx, 2 * y + cy, res);
      for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
        const u = cx * res / 2 + i / 2, v = cy * res / 2 + j / 2;
        const px = Math.min(Math.floor(u), res - 1), py = Math.min(Math.floor(v), res - 1);
        const fu = u - px, fv = v - py, a = py * (res + 1) + px, b = a + 1, c = a + res + 1, d = c + 1;
        const corners = fu + fv <= 1 ? [[a, 1 - fu - fv], [b, fu], [c, fv]] : [[b, 1 - fv], [d, fu + fv - 1], [c, 1 - fu]];
        const expected = corners.reduce((sum, [k, w]) => sum + parent.waterIce![k * 2] * w, 0);
        expect(Math.abs(child.waterIce![(j * (res + 1) + i) * 2 + 1] - expected)).toBeLessThanOrEqual(0.5);
        if (i % 2 === 0 && j % 2 === 0) expect(child.waterIce![(j * (res + 1) + i) * 2]).toBe(expected);
      }
      const gridCount = (res + 1) ** 2;
      for (let k = 0; k <= res; k++) for (const c of [0, 1]) expect(child.waterIce![(gridCount + k) * 2 + c]).toBe(child.waterIce![k * 2 + c]);
    }
  }
  expect(buildChunkMesh({ ...field(), heightAt: () => 100 }, 4, 0, 0, 0, 16).waterIce).toBeNull();
});
