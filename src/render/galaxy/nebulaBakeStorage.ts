/** GPU working textures: R16F natal field plus a tiled RGBA32F atlas.
 * Driver bookkeeping is additional; these are exact texel payloads. */
export function nebulaStorageLayout(size: number): { cols: number; rows: number; bytes: number } {
  const cols = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / cols);
  return { cols, rows, bytes: 2 * size ** 3 + 16 * cols * rows * size ** 2 };
}

/** Reuse working textures within a byte budget. Release old entries
 * BEFORE allocation so a grade transition does not retain every past
 * resolution beside the new one. The owner detaches GL references
 * before calling acquire. This cache contains no rendered volume. */
export class NebulaBakeStorage<T> {
  private readonly entries = new Map<number, T>();
  private used = 0;
  constructor(readonly budgetBytes: number, private readonly create: (size: number) => T,
    private readonly destroy: (entry: T) => void) {}
  get bytes(): number { return this.used; }
  acquire(size: number): T {
    const prior = this.entries.get(size);
    if (prior !== undefined) {
      this.entries.delete(size); this.entries.set(size, prior);
      return prior;
    }
    const { bytes } = nebulaStorageLayout(size);
    if (bytes > this.budgetBytes) throw new Error(`nebula GPU grade exceeds ${this.budgetBytes} byte staging budget`);
    for (const [key, entry] of this.entries) {
      if (this.used + bytes <= this.budgetBytes) break;
      this.destroy(entry);
      this.entries.delete(key);
      this.used -= nebulaStorageLayout(key).bytes;
    }
    const made = this.create(size);
    this.entries.set(size, made);
    this.used += bytes;
    return made;
  }
  dispose(): void {
    for (const entry of this.entries.values()) this.destroy(entry);
    this.entries.clear(); this.used = 0;
  }
}
