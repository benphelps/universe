import { expect, it, vi } from 'vitest';
import { NebulaAtlasReadback } from './nebulaReadback';

it('returns every atlas row in order across batches, including a partial final batch', () => {
  const readPixels = vi.fn((_x: number, y: number, width: number, height: number, _format: number, _type: number, buffer: Float32Array) => {
    for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
      buffer[(row * width + x) * 4 + c] = ((y + row) * width + x) * 4 + c;
    }
  });
  const readback = new NebulaAtlasReadback({ RGBA: 1, FLOAT: 2, readPixels } as unknown as WebGL2RenderingContext, 2 * 3 * 6 * 16);
  const result: number[] = [], rows: number[] = [];
  readback.readRows(3, 2, 5, (row, pixels) => { rows.push(row); result.push(...pixels); });
  expect(rows).toEqual([0, 1, 2, 3, 4]);
  expect(result).toEqual(Array.from({ length: 5 * 3 * 6 * 4 }, (_, i) => i));
  expect(readPixels.mock.calls.map(call => [call[1], call[3]])).toEqual([[0, 6], [6, 6], [12, 3]]);
  const storage = readPixels.mock.calls[0][6];
  readback.readRows(2, 2, 2, () => {});
  expect(readPixels.mock.calls.at(-1)![6]).toBe(storage);
  expect(readback.bytes).toBeLessThanOrEqual(readback.budgetBytes);
  readback.dispose(); expect(readback.bytes).toBe(0);
});

it('reduces production readback calls without exceeding the per-baker scratch budget', () => {
  const readPixels = vi.fn();
  const readback = new NebulaAtlasReadback({ RGBA: 1, FLOAT: 2, readPixels } as unknown as WebGL2RenderingContext);
  for (const [size, expected] of [[32, 1], [48, 1], [64, 1], [96, 2], [160, 13]]) {
    readPixels.mockClear();
    const cols = Math.ceil(Math.sqrt(size)), rows = Math.ceil(size / cols);
    readback.readRows(size, cols, rows, () => {});
    expect(readPixels).toHaveBeenCalledTimes(expected);
    expect(readback.bytes).toBeLessThanOrEqual(8 << 20);
  }
  expect(() => readback.readRows(256, 16, 16, () => {})).toThrow(/budget/);
  readback.dispose();
});
