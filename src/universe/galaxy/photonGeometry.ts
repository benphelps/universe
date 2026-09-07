/** Unsigned solid angle of a rectangular face, seen from the source.
 * Coordinates use cell units; a face through the source is tangent
 * to the radial flux and carries zero. */
export function faceAngle(d: number, u0: number, u1: number, v0: number, v1: number): number {
  if (d <= 0) return 0;
  const corner = (u: number, v: number): number => Math.atan2(u * v, d * Math.sqrt(d * d + u * u + v * v));
  return Math.max(0, corner(u1, v1) - corner(u0, v1) - corner(u1, v0) + corner(u0, v0));
}

/** Exact face geometry for cell-centred sources. Translation, reflection
 * and coordinate permutation reduce a cube to one sorted positive
 * octant. One 160³ grade retains <17 MiB, shared by every member and
 * iteration; a new grade retains the shared prefix and replaces the
 * allocation, so decreasing grades still release memory. Off-centre sources
 * continue to use the general solid-angle formula. */
let edge = 0;
let angles = new Float64Array();
export function centredPhotonAngles(size: number, dx: number, dy: number, dz: number, out: Float64Array): void {
  if (edge !== size) {
    edge = size;
    const next = new Float64Array(size * (size + 1) * (size + 2) / 6 * 3).fill(-1);
    // The exact geometry depends on cell offsets, not the grid's edge.
    next.set(angles.subarray(0, Math.min(angles.length, next.length)));
    angles = next;
  }
  let a = Math.abs(dx), b = Math.abs(dy), c = Math.abs(dz), ia = 0, ib = 1, ic = 2;
  if (a > b) { [a, b] = [b, a]; [ia, ib] = [ib, ia]; }
  if (b > c) { [b, c] = [c, b]; [ib, ic] = [ic, ib]; }
  if (a > b) { [a, b] = [b, a]; [ia, ib] = [ib, ia]; }
  const at = (c * (c + 1) * (c + 2) / 6 + b * (b + 1) / 2 + a) * 3;
  if (angles[at] < 0) {
    angles[at] = faceAngle(a + 0.5, b - 0.5, b + 0.5, c - 0.5, c + 0.5);
    angles[at + 1] = faceAngle(b + 0.5, a - 0.5, a + 0.5, c - 0.5, c + 0.5);
    angles[at + 2] = faceAngle(c + 0.5, a - 0.5, a + 0.5, b - 0.5, b + 0.5);
  }
  const x = angles[at + (ia === 0 ? 0 : ib === 0 ? 1 : 2)];
  const y = angles[at + (ia === 1 ? 0 : ib === 1 ? 1 : 2)];
  const z = angles[at + (ia === 2 ? 0 : ib === 2 ? 1 : 2)];
  out[0] = dx <= 0 ? x : 0; out[1] = dx >= 0 ? x : 0;
  out[2] = dy <= 0 ? y : 0; out[3] = dy >= 0 ? y : 0;
  out[4] = dz <= 0 ? z : 0; out[5] = dz >= 0 ? z : 0;
}
export function photonGeometryBytes(): number { return angles.byteLength; }

/** Adjacent faces reuse the same rectangular-solid-angle corners.
 * Four z planes cover the interleaved outward sweep without a full
 * per-source 3D cache: <2.4 MiB at 160³, released after this sweep.
 * Keep the original arithmetic order, including its signed corners. */
export class LayeredPhotonGeometry {
  private readonly width: number;
  private readonly coordinates: Float64Array[];
  private readonly planes: Array<{ z: number; age: number; values: Float64Array }> = [];
  private lower!: Float64Array;
  private upper!: Float64Array;
  private zLow = 0;
  private zHigh = 0;
  private age = 0;
  private lastRow = -1;
  readonly compatible: boolean;

  constructor(size: number, source: readonly number[]) {
    this.width = size + 1;
    this.coordinates = source.map(s => Float64Array.from({ length: this.width }, (_, i) => i - s));
    // A shared vertex must have the identical value when reached from
    // either neighbour. Rare cancellation differences use the direct path.
    this.compatible = this.coordinates.every(values => values.subarray(0, size).every((low, i) => low + 1 === values[i + 1]));
  }

  setLayer(k: number): void {
    this.lower = this.plane(k);
    this.upper = this.plane(k + 1);
    this.zLow = this.coordinates[2][k];
    this.zHigh = this.coordinates[2][k + 1];
    this.lastRow = -1;
  }

  get bytes(): number { return this.planes.reduce((sum, plane) => sum + plane.values.byteLength, 0); }

  private plane(z: number): Float64Array {
    let plane = this.planes.find(p => p.z === z);
    if (!plane) {
      if (this.planes.length < 4) {
        plane = { z, age: 0, values: new Float64Array(3 * this.width ** 2) };
        this.planes.push(plane);
      } else {
        plane = this.planes.reduce((oldest, p) => p.age < oldest.age ? p : oldest);
        plane.z = z;
      }
      plane.values.fill(NaN);
    }
    plane.age = ++this.age;
    return plane.values;
  }

  private prepareRow(y: number, high: boolean): void {
    const values = high ? this.upper : this.lower, base = y * this.width;
    if (!Number.isNaN(values[base])) return;
    const py = this.coordinates[1][y], pz = high ? this.zHigh : this.zLow;
    const stride = this.width ** 2;
    const yy = py * py, zz = pz * pz, yz = py * pz, dy = Math.abs(py), dz = Math.abs(pz);
    for (let x = 0; x < this.width; x++) {
      const px = this.coordinates[0][x];
      const dx = Math.abs(px), xx = px * px;
      // x/y exchange only the first two addends, so their radii are
      // bit-identical. Keep the z face's different rounding order.
      const rxy = Math.sqrt(xx + yy + zz), rz = Math.sqrt(zz + xx + yy);
      values[base + x] = Math.atan2(yz, dx * rxy);
      values[stride + base + x] = Math.atan2(px * pz, dy * rxy);
      values[2 * stride + base + x] = Math.atan2(px * py, dz * rz);
    }
  }

  angles(i: number, j: number, out: Float64Array): void {
    if (this.lastRow !== j) {
      this.prepareRow(j, false); this.prepareRow(j + 1, false);
      this.prepareRow(j, true); this.prepareRow(j + 1, true);
      this.lastRow = j;
    }
    const xs = this.coordinates[0], ys = this.coordinates[1], w = this.width;
    const low = this.lower, high = this.upper, at = j * w + i, stride = w * w;
    for (let side = 0; side < 2; side++) {
      const x = i + side, y = j + side, a = at + side, b = stride + at + side * w;
      out[side] = (side ? xs[x] : -xs[x]) <= 0 ? 0 : Math.max(0,
        high[a + w] - high[a] - low[a + w] + low[a]);
      out[2 + side] = (side ? ys[y] : -ys[y]) <= 0 ? 0 : Math.max(0,
        high[b + 1] - high[b] - low[b + 1] + low[b]);
      const plane = side ? high : low, c = 2 * stride + at;
      out[4 + side] = (side ? this.zHigh : -this.zLow) <= 0 ? 0 : Math.max(0,
        plane[c + w + 1] - plane[c + w] - plane[c + 1] + plane[c]);
    }
  }
}
