/** Bounded conjunction search for arbitrary moving spherical eclipse casters.
 * Coordinates are metres in the observer body's ground-fixed renderer frame. */
export interface EclipseVector {
  x: number;
  y: number;
  z: number;
}
export interface EclipseGeometry {
  star: EclipseVector;
  caster: EclipseVector;
}
export interface SurfaceEclipse {
  timeDays: number;
  startTimeDays: number;
  endTimeDays: number;
  arrivalTimeDays: number;
  obscuration: number;
  kind: 'total' | 'annular' | 'partial' | 'transit';
  /** Angular radii of the star's and the caster's discs from the site at maximum. */
  starAngularRadius: number;
  casterAngularRadius: number;
  surfaceDirection: [number, number, number];
  sunDirection: [number, number, number];
}
const dot = (a: EclipseVector, b: EclipseVector): number => a.x * b.x + a.y * b.y + a.z * b.z;
const size = (a: EclipseVector): number => Math.hypot(a.x, a.y, a.z);
const mul = (a: EclipseVector, k: number): EclipseVector => ({
  x: a.x * k,
  y: a.y * k,
  z: a.z * k,
});
const sub = (a: EclipseVector, b: EclipseVector): EclipseVector => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const unit = (a: EclipseVector): EclipseVector => mul(a, 1 / Math.max(size(a), 1e-30));
const angle = (a: EclipseVector, b: EclipseVector): number =>
  Math.atan2(
    size({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
    dot(a, b),
  );
const tuple = (a: EclipseVector): [number, number, number] => [a.x, a.y, a.z];

export function discObscuration(s: number, c: number, d: number): number {
  if (d >= s + c || s <= 0 || c <= 0) return 0;
  if (d <= Math.abs(s - c)) return Math.min(1, (c / s) ** 2);
  const clamp = (x: number): number => Math.max(-1, Math.min(1, x));
  return Math.max(
    0,
    Math.min(
      1,
      (s * s * Math.acos(clamp((d * d + s * s - c * c) / (2 * d * s))) +
        c * c * Math.acos(clamp((d * d + c * c - s * s) / (2 * d * c))) -
        0.5 * Math.sqrt(Math.max(0, (-d + s + c) * (d + s - c) * (d - s + c) * (d + s + c)))) /
        (Math.PI * s * s),
    ),
  );
}

export function observerDiscs(
  geometry: EclipseGeometry,
  surface: EclipseVector,
  bodyRadius: number,
  starRadius: number,
  casterRadius: number,
): {
  margin: number;
  obscuration: number;
  star: number;
  caster: number;
  separation: number;
  elevation: number;
} {
  const observer = mul(surface, bodyRadius);
  const sun = sub(geometry.star, observer),
    caster = sub(geometry.caster, observer);
  const sd = size(sun),
    cd = size(caster);
  const sr = Math.asin(Math.min(1, starRadius / sd)),
    cr = Math.asin(Math.min(1, casterRadius / cd));
  const separation = angle(sun, caster);
  const inFront = cd > casterRadius && dot(caster, unit(sun)) > 0 && cd < sd;
  return {
    margin: inFront ? sr + cr - separation : -1,
    obscuration: inFront ? discObscuration(sr, cr, separation) : 0,
    star: sr,
    caster: cr,
    separation,
    elevation: Math.asin(Math.max(-1, Math.min(1, dot(surface, unit(sun))))),
  };
}

function minimum(fn: (t: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 36; i++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3;
    if (fn(a) < fn(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

/** Refine angular minima rather than hoping a time sample lands inside a
 * short transit. The sampling rate follows the fastest eccentric orbit;
 * the cap bounds pathological generated configurations. */
export function findSurfaceEclipses(options: {
  geometry: (days: number) => EclipseGeometry;
  bodyRadius: number;
  starRadius: number;
  casterRadius: number;
  startDays: number;
  windowDays: number;
  shortestPeriodDays: number;
  minimumObscuration: number;
  planetaryTransit?: boolean;
}): SurfaceEclipse[] {
  const { geometry, bodyRadius, starRadius, casterRadius, startDays, windowDays } = options;
  const step = Math.max(1 / 14400, Math.min(0.125, options.shortestPeriodDays / 24));
  const lo = startDays - 1,
    hi = startDays + windowDays + 1;
  const count = Math.min(2048, Math.max(4, Math.ceil((hi - lo) / step)));
  const dt = (hi - lo) / count;
  const separation = (t: number): number => {
    const g = geometry(t);
    return angle(g.star, g.caster);
  };
  const values = Array.from({ length: count + 1 }, (_, i) => separation(lo + i * dt));
  const events: SurfaceEclipse[] = [];
  for (let i = 1; i < count; i++) {
    if (values[i] > values[i - 1] || values[i] > values[i + 1]) continue;
    const center = minimum(separation, lo + (i - 1) * dt, lo + (i + 1) * dt);
    const g = geometry(center),
      sun = unit(g.star),
      distance = size(g.caster);
    // Allow the entire observer globe's parallax before rejecting a pair.
    if (
      dot(g.caster, sun) <= 0 ||
      distance >= size(g.star) ||
      separation(center) >
        Math.asin(Math.min(1, (bodyRadius + casterRadius) / distance)) + starRadius / size(g.star)
    )
      continue;
    const reference = Math.abs(sun.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const tangent = unit(sub(reference, mul(sun, dot(reference, sun))));
    const side = {
      x: sun.y * tangent.z - sun.z * tangent.y,
      y: sun.z * tangent.x - sun.x * tangent.z,
      z: sun.x * tangent.y - sun.y * tangent.x,
    };
    let best: SurfaceEclipse | null = null;
    // Prefer an angled sky view, but permit high-altitude events when
    // that is the only real ground track (notably small sibling moons).
    for (const elevation of [20, 45, 90])
      for (let az = 0; az < (elevation === 90 ? 1 : 8); az++) {
        const e = (elevation * Math.PI) / 180,
          a = (az * Math.PI) / 4;
        const surface = {
          x: sun.x * Math.sin(e) + (tangent.x * Math.cos(a) + side.x * Math.sin(a)) * Math.cos(e),
          y: sun.y * Math.sin(e) + (tangent.y * Math.cos(a) + side.y * Math.sin(a)) * Math.cos(e),
          z: sun.z * Math.sin(e) + (tangent.z * Math.cos(a) + side.z * Math.sin(a)) * Math.cos(e),
        };
        const discs = (t: number) =>
          observerDiscs(geometry(t), surface, bodyRadius, starRadius, casterRadius);
        // Ground spin can be faster than orbital motion; do not wander to
        // another rotation while refining this fixed site's conjunction.
        const time = minimum((t) => discs(t).separation, center - dt, center + dt);
        const peak = discs(time);
        if (peak.obscuration < options.minimumObscuration || peak.elevation < (10 * Math.PI) / 180)
          continue;
        const edge = (direction: number): number | null => {
          let inside = time,
            step = 1 / 1440;
          for (let j = 0; j < 15; j++, step *= 1.6) {
            const outside = time + direction * step;
            if (discs(outside).margin <= 0) {
              let a = inside,
                b = outside;
              for (let k = 0; k < 32; k++) {
                const mid = (a + b) / 2;
                if (discs(mid).margin > 0) a = mid;
                else b = mid;
              }
              return (a + b) / 2;
            }
            inside = outside;
          }
          return null;
        };
        const start = edge(-1),
          end = edge(1);
        if (start === null || end === null || end < startDays || start > startDays + windowDays)
          continue;
        const arrival = start - 2 / 1440;
        // The whole event must remain above the local horizon.
        if ([arrival, start, time, end].some((t) => discs(t).elevation < (5 * Math.PI) / 180))
          continue;
        const arrivalSun = unit(sub(geometry(arrival).star, mul(surface, bodyRadius)));
        const kind =
          peak.obscuration >= 0.999999
            ? 'total'
            : options.planetaryTransit && peak.obscuration < 0.5
              ? 'transit'
              : peak.separation <= Math.abs(peak.star - peak.caster)
                ? 'annular'
                : 'partial';
        const event: SurfaceEclipse = {
          timeDays: time,
          startTimeDays: start,
          endTimeDays: end,
          arrivalTimeDays: arrival,
          obscuration: peak.obscuration,
          kind,
          starAngularRadius: peak.star,
          casterAngularRadius: peak.caster,
          surfaceDirection: tuple(surface),
          sunDirection: tuple(arrivalSun),
        };
        if (!best || event.obscuration > best.obscuration + 0.01) best = event;
      }
    if (best && !events.some((e) => Math.abs(e.timeDays - best!.timeDays) < dt)) events.push(best);
  }
  return events;
}
