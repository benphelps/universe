import { expect, it } from 'vitest';
import type { SkyField } from '../../universe/galaxy/skyfield';
import { PointConeIndex } from '../picking/pointConeIndex';
import { prepareSkyDrawing, skyDrawingTransfers } from './skyDrawing';

it('transfers ready drawing buffers without detaching source sky data or losing picking', () => {
  const sky = { starCount: 3, nearStarCount: 1,
    starDirs: new Float32Array([0, 0, 1, 1, 0, 0, 0, 0, -1]),
    starDistances: new Float32Array([1, 10, 20]), starBrightness: new Float32Array([99, 2, 3]),
    starColors: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    sceneFromGalaxy: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  } as SkyField;
  const drawing = prepareSkyDrawing(sky);
  const received = structuredClone(drawing, { transfer: skyDrawingTransfers(drawing) });
  expect(drawing.positions.byteLength).toBe(0);
  expect(sky.starDirs.length).toBe(9);
  expect(sky.starColors.length).toBe(9);
  expect([...received.positions]).toEqual([10, 0, 0, 0, 0, -20]);
  expect([...received.colors]).toEqual([0, 1, 0, 0, 0, 1]);
  expect([...received.luminosities]).toEqual([200, 1200]);
  expect([...received.radii]).toEqual([0, 0]);
  const index = PointConeIndex.fromData(received.positions, received.index);
  const hits: number[] = [];
  index.query(0, 0, 0, 0, 0, -1, 0.01, hits);
  expect(hits).toEqual([1]);
  expect(index.toData().bounds).toBe(received.index.bounds);
});
