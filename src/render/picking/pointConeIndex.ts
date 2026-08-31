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
  private readonly nodes: ConeNode[] = [];
  private readonly queryStack: number[] = [];

  constructor(
    private readonly positions: ArrayLike<number>,
    readonly count: number = Math.floor(positions.length / 3),
    private readonly leafSize = 32,
  ) {
    this.indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) this.indices[i] = i;
    if (count > 0) this.build(0, count);
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
    if (this.nodes.length === 0) return;
    const tanSq = tanHalfAngle * tanHalfAngle;
    const stack = this.queryStack;
    stack.length = 1;
    stack[0] = 0;

    while (stack.length > 0) {
      const node = this.nodes[stack.pop()!];
      const cx = node.centerX - originX;
      const cy = node.centerY - originY;
      const cz = node.centerZ - originZ;
      const axial = cx * directionX + cy * directionY + cz * directionZ;
      if (axial + node.radius <= 0) continue;
      const radialSq = Math.max(0, cx * cx + cy * cy + cz * cz - axial * axial);
      const coneRadius = Math.max(0, axial + node.radius) * tanHalfAngle + node.radius;
      if (radialSq > coneRadius * coneRadius) continue;

      if (node.left >= 0) {
        stack.push(node.left, node.right);
        continue;
      }
      for (let slot = node.start; slot < node.end; slot++) {
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
    const nodeIndex = this.nodes.length;
    const node: ConeNode = {
      start,
      end,
      centerX,
      centerY,
      centerZ,
      radius,
      left: -1,
      right: -1,
    };
    this.nodes.push(node);

    if (end - start <= this.leafSize) return nodeIndex;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    const axis = spanX >= spanY && spanX >= spanZ ? 0 : spanY >= spanZ ? 1 : 2;
    const middle = (start + end) >>> 1;
    this.select(start, end, middle, axis);
    node.left = this.build(start, middle);
    node.right = this.build(middle, end);
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

interface ConeNode {
  start: number;
  end: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  left: number;
  right: number;
}
