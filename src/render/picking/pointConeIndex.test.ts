import { describe, expect, it } from 'vitest';
import { PointConeIndex } from './pointConeIndex';

function bruteForce(
  positions: Float32Array,
  origin: [number, number, number],
  direction: [number, number, number],
  tangent: number,
): number[] {
  const found: number[] = [];
  for (let point = 0; point < positions.length / 3; point++) {
    const offset = point * 3;
    const x = positions[offset] - origin[0];
    const y = positions[offset + 1] - origin[1];
    const z = positions[offset + 2] - origin[2];
    const distance = x * direction[0] + y * direction[1] + z * direction[2];
    if (distance <= 0) continue;
    const perpendicularSq = Math.max(0, x * x + y * y + z * z - distance * distance);
    if (perpendicularSq <= distance * distance * tangent * tangent) found.push(point);
  }
  return found;
}

describe('PointConeIndex', () => {
  it('matches a brute-force cone query from translated viewpoints', () => {
    let state = 0x6d2b79f5;
    const random = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 0x1_0000_0000;
    };
    const positions = new Float32Array(12_000 * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (random() - 0.5) * 800;
    const index = new PointConeIndex(positions);
    const queries: Array<{
      origin: [number, number, number];
      direction: [number, number, number];
      tangent: number;
    }> = [
      { origin: [0, 0, 0], direction: [0, 0, -1], tangent: 0.012 },
      { origin: [120, -35, 64], direction: [1, 0, 0], tangent: 0.04 },
      { origin: [-210, 80, 12], direction: [0, 1, 0], tangent: 0.15 },
    ];
    for (let i = 0; i < 20; i++) {
      const x = random() * 2 - 1;
      const y = random() * 2 - 1;
      const z = random() * 2 - 1;
      const length = Math.hypot(x, y, z);
      queries.push({
        origin: [(random() - 0.5) * 500, (random() - 0.5) * 500, (random() - 0.5) * 500],
        direction: [x / length, y / length, z / length],
        tangent: 0.002 + random() * 0.2,
      });
    }

    for (const query of queries) {
      const actual: number[] = [];
      index.query(...query.origin, ...query.direction, query.tangent, actual);
      expect(actual.sort((a, b) => a - b)).toEqual(
        bruteForce(positions, query.origin, query.direction, query.tangent),
      );
    }
  });

  it('returns no points behind the camera or for an empty field', () => {
    const behind = new PointConeIndex(new Float32Array([0, 0, 3]));
    const found: number[] = [];
    behind.query(0, 0, 0, 0, 0, -1, 0.2, found);
    new PointConeIndex(new Float32Array()).query(0, 0, 0, 0, 0, -1, 0.2, found);
    expect(found).toEqual([]);
  });
});
