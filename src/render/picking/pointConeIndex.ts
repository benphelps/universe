/** Plain buffers can be transferred from a worker and adopted without
 * rebuilding the tree. Bounds retain the original Float64 precision. */
export interface PointConeIndexData {
  indices: Uint32Array;
  bounds: Float64Array;
  branches: Int32Array;
  nodeCount: number;
}

/**
 * A static k-d tree for points queried through a narrow view cone.
 *
 * The tree lives in the point cloud's local coordinates. Callers transform
 * the camera ray into that same frame, ask for conservative candidates, then
 * perform their exact screen-space and occlusion tests on the returned point
 * indices. The node test uses a bounding sphere, so it may return extras but
 * never deliberately rejects a point inside the cone.
 */
export class PointConeIndex {
  private readonly indices: Uint32Array;
  private readonly bounds: Float64Array;
  private readonly branches: Int32Array;
  private nodeCount = 0;
  private readonly queryStack: number[] = [];

  constructor(
    private readonly positions: ArrayLike<number>,
    readonly count: number = Math.floor(positions.length / 3),
    private readonly leafSize = 32,
    prepared?: PointConeIndexData,
  ) {
    if (prepared) {
      this.indices = prepared.indices;
      this.bounds = prepared.bounds;
      this.branches = prepared.branches;
      this.nodeCount = prepared.nodeCount;
      return;
    }
    const leaves = 2 ** Math.ceil(Math.log2(Math.max(1, count / leafSize)));
    const capacity = count > 0 ? 2 * leaves - 1 : 0;
    this.bounds = new Float64Array(capacity * 4);
    this.branches = new Int32Array(capacity * 4);
    this.indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) this.indices[i] = i;
    if (count > 0) this.build(0, count);
  }

  /** Adopt transferred buffers; the receiving frame does no tree work. */
  static fromData(positions: ArrayLike<number>, data: PointConeIndexData): PointConeIndex {
    return new PointConeIndex(positions, data.indices.length, 32, data);
  }

  /** The live buffers, suitable for transfer after the builder retires. */
  toData(): PointConeIndexData {
    return { indices: this.indices, bounds: this.bounds, branches: this.branches, nodeCount: this.nodeCount };
  }

  /**
   * Append point indices inside the forward cone to `out`.
   * `direction` must be normalized and `tanHalfAngle` non-negative.
   */
  query(
    originX: number,
    originY: number,
    originZ: number,
    directionX: number,
    directionY: number,
    directionZ: number,
    tanHalfAngle: number,
    out: number[],
  ): void {
    if (this.nodeCount === 0) return;
    const tanSq = tanHalfAngle * tanHalfAngle;
    const stack = this.queryStack;
    stack.length = 1;
    stack[0] = 0;

    while (stack.length > 0) {
      const at = stack.pop()! * 4;
      const cx = this.bounds[at] - originX;
      const cy = this.bounds[at + 1] - originY;
      const cz = this.bounds[at + 2] - originZ;
      const radius = this.bounds[at + 3];
      const axial = cx * directionX + cy * directionY + cz * directionZ;
      if (axial + radius <= 0) continue;
      const radialSq = Math.max(0, cx * cx + cy * cy + cz * cz - axial * axial);
      const coneRadius = Math.max(0, axial + radius) * tanHalfAngle + radius;
      if (radialSq > coneRadius * coneRadius) continue;

      if (this.branches[at + 2] >= 0) {
        stack.push(this.branches[at + 2], this.branches[at + 3]);
        continue;
      }
      for (let slot = this.branches[at]; slot < this.branches[at + 1]; slot++) {
        const point = this.indices[slot];
        const offset = point * 3;
        const x = this.positions[offset] - originX;
        const y = this.positions[offset + 1] - originY;
        const z = this.positions[offset + 2] - originZ;
        const distance = x * directionX + y * directionY + z * directionZ;
        if (distance <= 0) continue;
        const perpendicularSq = Math.max(0, x * x + y * y + z * z - distance * distance);
        if (perpendicularSq <= distance * distance * tanSq) out.push(point);
      }
    }
  }

  private build(start: number, end: number): number {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let slot = start; slot < end; slot++) {
      const offset = this.indices[slot] * 3;
      const x = this.positions[offset];
      const y = this.positions[offset + 1];
      const z = this.positions[offset + 2];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5;
    const nodeIndex = this.nodeCount++;
    const at = nodeIndex * 4;
    this.bounds[at] = centerX;
    this.bounds[at + 1] = centerY;
    this.bounds[at + 2] = centerZ;
    this.bounds[at + 3] = radius;
    this.branches[at] = start;
    this.branches[at + 1] = end;
    this.branches[at + 2] = -1;
    this.branches[at + 3] = -1;

    if (end - start <= this.leafSize) return nodeIndex;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    const axis = spanX >= spanY && spanX >= spanZ ? 0 : spanY >= spanZ ? 1 : 2;
    const middle = (start + end) >>> 1;
    this.select(start, end, middle, axis);
    this.branches[at + 2] = this.build(start, middle);
    this.branches[at + 3] = this.build(middle, end);
    return nodeIndex;
  }

  /** Partition the index range so the nth item is in sorted position. */
  private select(start: number, end: number, nth: number, axis: number): void {
    let left = start;
    let right = end - 1;
    while (left < right) {
      const pivot = this.coordinate(this.indices[(left + right) >>> 1], axis);
      let low = left;
      let high = right;
      while (low <= high) {
        while (this.coordinate(this.indices[low], axis) < pivot) low++;
        while (this.coordinate(this.indices[high], axis) > pivot) high--;
        if (low <= high) {
          const swap = this.indices[low];
          this.indices[low] = this.indices[high];
          this.indices[high] = swap;
          low++;
          high--;
        }
      }
      if (nth <= high) right = high;
      else if (nth >= low) left = low;
      else return;
    }
  }

  private coordinate(point: number, axis: number): number {
    return this.positions[point * 3 + axis];
  }
}
