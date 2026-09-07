import { expect, it } from 'vitest';
import type { Vec3 } from '../../core/math/vec3';
import { buildChunkMesh, type ChunkMesh } from './chunkMesh';
import type { SurfaceField } from './field';

function field(heightAt: (p: Vec3) => number, waterLevelAt: (p: Vec3) => number): SurfaceField {
  return { params: { radiusM: 8_800_000 } as SurfaceField['params'], seaLevelM: 0,
    heightAt, waterLevelAt, colorAt: () => [0.3, 0.3, 0.3] };
}

function compareParent(parent: ChunkMesh, child: ChunkMesh, cx: number, cy: number, res: number): number {
  if (!child.waterPositions) return 0;
  expect(parent.waterPositions).not.toBeNull();
  let maximum = 0;
  for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
    // Intersect the child's UV with triangles in an independently built
    // full parent tile, including the other three child quadrants.
    const u = cx * res / 2 + i / 2, v = cy * res / 2 + j / 2;
    const x = Math.min(Math.floor(u), res - 1), y = Math.min(Math.floor(v), res - 1);
    const fx = u - x, fy = v - y;
    const a = y * (res + 1) + x, b = a + 1, c = a + res + 1, d = c + 1;
    const corners = fx + fy <= 1 ? [[a, 1 - fx - fy], [b, fx], [c, fy]] :
      [[b, 1 - fy], [d, fx + fy - 1], [c, 1 - fx]];
    const index = (j * (res + 1) + i) * 3;
    for (let axis = 0; axis < 3; axis++) {
      const expected = parent.centerKm[axis] + corners.reduce((s, [k, w]) => s + parent.waterPositions![k * 3 + axis] * w, 0);
      const actual = child.centerKm[axis] + child.waterPositions[index + axis] - child.waterMorph![index + axis];
      maximum = Math.max(maximum, Math.abs(actual - expected));
    }
  }
  return maximum;
}

it('fluid transitions reproduce actual parent triangles from orbit to walking scale', () => {
  const surface = field(() => -100, p => 10 * Math.sin(3 * p.x) + 5 * p.y);
  const res = 16;
  for (const level of [1, 4, 12, 22]) {
    const x = Math.floor(2 ** (level - 1) / 2), y = x;
    const parent = buildChunkMesh(surface, 4, level - 1, x, y, res);
    for (const cx of [0, 1]) for (const cy of [0, 1]) {
      const child = buildChunkMesh(surface, 4, level, x * 2 + cx, y * 2 + cy, res);
      // f32 anchor-relative vertex precision scales with tile extent.
      expect(compareParent(parent, child, cx, cy, res)).toBeLessThan(Math.max(5e-9, 8800 / 2 ** level * 4e-7));
    }
  }
});

it('dry parent fluid fallbacks match their real mesh instead of moving with seabed relief', () => {
  const surface = field(p => 100 * p.x, p => p.x > 0.2 ? -Infinity : 0);
  const res = 16, parent = buildChunkMesh(surface, 4, 0, 0, 0, res);
  let checked = 0;
  for (const cx of [0, 1]) for (const cy of [0, 1]) {
    const child = buildChunkMesh(surface, 4, 1, cx, cy, res);
    if (!child.waterPositions) continue;
    checked++;
    expect(compareParent(parent, child, cx, cy, res)).toBeLessThan(0.002);
  }
  expect(checked).toBe(4);
});

it('does not expose buried fluid over dry land at any morph weight', () => {
  const surface = field(p => p.x < 0.25 ? -50 : 20, () => 0);
  const res = 64, mesh = buildChunkMesh(surface, 4, 1, 1, 1, res);
  let dry = 0, formerFalseFloods = 0;
  for (let i = 0; i < (res + 1) ** 2; i++) {
    const up = [0, 1, 2].map(c => mesh.positions[i * 3 + c] + mesh.centerKm[c]);
    const length = Math.hypot(...up); for (let c = 0; c < 3; c++) up[c] /= length;
    const ground = [0, 1, 2].map(c => mesh.positions[i * 3 + c]);
    const water = [0, 1, 2].map(c => mesh.waterPositions![i * 3 + c]);
    const groundDelta = [0, 1, 2].map(c => mesh.morph[i * 4 + c]);
    const waterDelta = [0, 1, 2].map(c => mesh.waterMorph![i * 3 + c]);
    const fineGap = ground.reduce((s, v, c) => s + (v - water[c]) * up[c], 0);
    const parentGap = ground.reduce((s, v, c) => s + (v - groundDelta[c] - water[c] + waterDelta[c]) * up[c], 0);
    if (Math.min(fineGap, parentGap) < 0.015) continue;
    dry++;
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      const gap = ground.reduce((s, v, c) => s + (v - groundDelta[c] * (1 - weight) - water[c] + waterDelta[c] * (1 - weight)) * up[c], 0);
      expect(gap).toBeGreaterThan(0.014);
    }
    const oldGap = ground.reduce((s, v, c) => s + (v - groundDelta[c] - water[c]) * up[c], 0);
    if (oldGap < 0) formerFalseFloods++;
  }
  expect(dry).toBeGreaterThan(1000);
  expect(formerFalseFloods).toBeGreaterThan(1000);
});

it('leaves root fluid unmodified and allocates no fluid morph for dry tiles', () => {
  const wet = buildChunkMesh(field(() => -100, () => 0), 4, 0, 0, 0, 16);
  expect(wet.waterMorph!.every(v => v === 0)).toBe(true);
  const dry = buildChunkMesh(field(() => 100, () => -Infinity), 4, 2, 1, 1, 16);
  expect(dry.waterPositions).toBeNull();
  expect(dry.waterMorph).toBeNull();
});
