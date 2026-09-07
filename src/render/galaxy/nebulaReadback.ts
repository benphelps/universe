/** Batch adjacent atlas rows into one driver readback, retaining at
 * most 8 MiB of CPU scratch per baker. A callback must consume its
 * row before the next batch overwrites the shared buffer. */
export class NebulaAtlasReadback {
  private scratch = new Float32Array(0);
  constructor(private readonly gl: Pick<WebGL2RenderingContext, 'readPixels' | 'RGBA' | 'FLOAT'>,
    readonly budgetBytes = 8 << 20) {}
  get bytes(): number { return this.scratch.byteLength; }

  readRows(size: number, cols: number, rows: number, consume: (row: number, pixels: Float32Array) => void): void {
    const width = cols * size, rowFloats = width * size * 4;
    const batchRows = Math.min(rows, Math.floor(this.budgetBytes / (rowFloats * Float32Array.BYTES_PER_ELEMENT)));
    if (batchRows < 1) throw new Error('nebula atlas row exceeds the CPU readback budget');
    const capacity = rowFloats * batchRows;
    if (this.scratch.length < capacity) this.scratch = new Float32Array(capacity);
    for (let row = 0; row < rows; row += batchRows) {
      const count = Math.min(batchRows, rows - row);
      this.gl.readPixels(0, row * size, width, count * size, this.gl.RGBA, this.gl.FLOAT, this.scratch);
      for (let offset = 0; offset < count; offset++) {
        consume(row + offset, this.scratch.subarray(offset * rowFloats, (offset + 1) * rowFloats));
      }
    }
  }

  dispose(): void { this.scratch = new Float32Array(0); }
}
