/** Unit-luminosity, finite Hernquist profile. Radii are in scale-radius
 * units. A tiny mass-preserving core removes the formal central
 * line-of-sight divergence; this is a resolution prescription, not a
 * fitted stellar cusp or a dynamical solution around the black hole. */
export const NUCLEAR_TRUNCATION = 12;
export const NUCLEAR_HELD_FRACTION = (NUCLEAR_TRUNCATION / (1 + NUCLEAR_TRUNCATION)) ** 2;
export const NUCLEAR_CORE = .001;
export const NUCLEAR_COLUMN_WIDTH = 512;
export const NUCLEAR_COLUMN_HEIGHT = 256;
export const NUCLEAR_COLUMN_LOG = Math.log1p(NUCLEAR_TRUNCATION / NUCLEAR_CORE);
const boundary = 1 / (2 * Math.PI * NUCLEAR_HELD_FRACTION * NUCLEAR_CORE * (1 + NUCLEAR_CORE) ** 3);
const mean = 3 / (4 * Math.PI * NUCLEAR_HELD_FRACTION * NUCLEAR_CORE * (1 + NUCLEAR_CORE) ** 2);
const slope = -boundary * (1 + 3 * NUCLEAR_CORE / (1 + NUCLEAR_CORE));
const c = (35 * (mean - boundary) + 7 * slope) / 8;
const b = slope / 2 - 2 * c, a = boundary - b - c;

export function nuclearProfileDensity(radius: number): number {
  if (radius > NUCLEAR_TRUNCATION) return 0;
  if (radius < NUCLEAR_CORE) { const t2 = (radius / NUCLEAR_CORE) ** 2; return (c * t2 + b) * t2 + a; }
  return 1 / (2 * Math.PI * NUCLEAR_HELD_FRACTION * radius * (1 + radius) ** 3);
}
export function nuclearProfileCdf(radius: number): number {
  if (radius <= 0) return 0;
  if (radius >= NUCLEAR_TRUNCATION) return 1;
  if (radius < NUCLEAR_CORE) {
    const t2 = (radius / NUCLEAR_CORE) ** 2;
    return 4 * Math.PI * radius ** 3 * (a / 3 + b * t2 / 5 + c * t2 * t2 / 7);
  }
  return (radius / (1 + radius)) ** 2 / NUCLEAR_HELD_FRACTION;
}
export function nuclearProfileRadius(unit: number): number {
  const u = Math.min(1, Math.max(0, unit));
  if (u >= nuclearProfileCdf(NUCLEAR_CORE)) {
    const root = Math.sqrt(u * NUCLEAR_HELD_FRACTION); return root / (1 - root);
  }
  let lo = 0, hi = NUCLEAR_CORE;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (nuclearProfileCdf(mid) < u) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export interface NuclearColumnTable { width: number; height: number; data: Float32Array }
let cachedColumn: NuclearColumnTable | undefined;
export function nuclearColumnTable(): NuclearColumnTable { return cachedColumn ??= buildNuclearColumnTable(); }
/** J(impact,z) = integral from 0 to z of rho(sqrt(impact²+s²)) ds.
 * Logarithmic coordinates resolve both the small core and outer envelope.
 * Building the cumulative integral costs O(width*height), in the worker. */
export function buildNuclearColumnTable(width = NUCLEAR_COLUMN_WIDTH, height = NUCLEAR_COLUMN_HEIGHT): NuclearColumnTable {
  const data = new Float32Array(width * height);
  const nodes = [.3399810435848563, .8611363115940526], weights = [.6521451548625461, .3478548451374538];
  for (let x = 0; x < width; x++) {
    const impact = NUCLEAR_CORE * Math.expm1(x / (width - 1) * NUCLEAR_COLUMN_LOG);
    const end = Math.sqrt(Math.max(0, NUCLEAR_TRUNCATION ** 2 - impact ** 2));
    let integral = 0, previous = 0;
    for (let y = 1; y < height; y++) {
      const z = Math.min(end, NUCLEAR_CORE * Math.expm1(y / (height - 1) * NUCLEAR_COLUMN_LOG));
      const half = (z - previous) / 2, mid = (z + previous) / 2;
      for (let n = 0; n < 2; n++) for (const sign of [-1, 1]) {
        integral += half * weights[n] * nuclearProfileDensity(Math.hypot(impact, mid + sign * half * nodes[n]));
      }
      data[y * width + x] = integral; previous = z;
    }
  }
  return {width, height, data};
}

export function nuclearColumnAt(table: NuclearColumnTable, impact: number, z: number): number {
  if (impact >= NUCLEAR_TRUNCATION || z <= 0) return 0;
  const x = Math.min(table.width - 1, Math.log1p(Math.max(0, impact) / NUCLEAR_CORE) / NUCLEAR_COLUMN_LOG * (table.width - 1));
  const y = Math.min(table.height - 1, Math.log1p(z / NUCLEAR_CORE) / NUCLEAR_COLUMN_LOG * (table.height - 1));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, table.width - 1), y1 = Math.min(y0 + 1, table.height - 1);
  const low = table.data[y0 * table.width + x0] * (1 - x + x0) + table.data[y0 * table.width + x1] * (x - x0);
  const high = table.data[y1 * table.width + x0] * (1 - x + x0) + table.data[y1 * table.width + x1] * (x - x0);
  return low * (1 - y + y0) + high * (y - y0);
}

/** Full forward ray in a scale-one sphere. Multiply by L/(4πa²)
 * for radiance in L☉ pc⁻² sr⁻¹. z is the observer's signed coordinate
 * along the sightline through its closest approach to the centre. */
export function nuclearRayColumn(table: NuclearColumnTable, impact: number, z: number, cutRadius = 0): number {
  if (impact >= NUCLEAR_TRUNCATION) return 0;
  const end = Math.sqrt(NUCLEAR_TRUNCATION ** 2 - impact ** 2);
  if (z >= end) return 0;
  let column = nuclearColumnAt(table, impact, end) - Math.sign(z) * nuclearColumnAt(table, impact, Math.min(Math.abs(z), end));
  // Used only for an observer outside the support: unresolved inner
  // luminosity is assigned to a normalized point kernel instead.
  if (cutRadius > impact && z < -end) column -= 2 * nuclearColumnAt(table, impact, Math.sqrt(cutRadius ** 2 - impact ** 2));
  return Math.max(0, column);
}
