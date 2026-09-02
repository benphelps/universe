import { GRAD3 } from '../../core/noise/simplex3';
import {
  CARVE_EXPONENT,
  CARVE_THRESHOLD,
  ENVELOPE_REACH,
  ENVELOPE_TIGHTNESS,
  TURBULENCE_LIFT,
  TURBULENCE_MEAN,
  TURBULENCE_OCTAVES,
} from '../../universe/galaxy/clouds';
import { glslFloat as f } from '../glsl/format';

/**
 * The cloud field in GLSL, for every bake that marches it on a GPU:
 * the seeded simplex with the galaxy's own permutation, and the carve
 * of universe/galaxy/clouds — envelope, cascade, threshold, exponent
 * — as a function of a point in the cloud's frame. The CPU field stays
 * the authority; this is a renderer of it, with the octave count
 * chosen per consumer exactly as the CPU's two densities choose it.
 */
/** The seeded simplex, Gustavson's formulation — the CPU sampler with
 *  its shuffled permutation read from a 512×1 integer texture. */
export const SEEDED_NOISE = `
uniform highp usampler2D uPerm;

const vec3 GRAD3[12] = vec3[12](
  ${GRAD3.map(([x, y, z]) => `vec3(${f(x)}, ${f(y)}, ${f(z)})`).join(',\n  ')});

int perm(int i) { return int(texelFetch(uPerm, ivec2(i, 0), 0).r); }

float cornerN(vec3 p, int gi) {
  float t = 0.6 - dot(p, p);
  if (t < 0.0) return 0.0;
  t *= t;
  return t * t * dot(GRAD3[gi], p);
}

float shapeNoise(vec3 v) {
  float s = (v.x + v.y + v.z) * ${f(1 / 3)};
  vec3 fl = floor(v + s);
  float t = (fl.x + fl.y + fl.z) * ${f(1 / 6)};
  vec3 p0 = v - fl + t;
  ivec3 o1;
  ivec3 o2;
  if (p0.x >= p0.y) {
    if (p0.y >= p0.z) { o1 = ivec3(1, 0, 0); o2 = ivec3(1, 1, 0); }
    else if (p0.x >= p0.z) { o1 = ivec3(1, 0, 0); o2 = ivec3(1, 0, 1); }
    else { o1 = ivec3(0, 0, 1); o2 = ivec3(1, 0, 1); }
  } else {
    if (p0.y < p0.z) { o1 = ivec3(0, 0, 1); o2 = ivec3(0, 1, 1); }
    else if (p0.x < p0.z) { o1 = ivec3(0, 1, 0); o2 = ivec3(0, 1, 1); }
    else { o1 = ivec3(0, 1, 0); o2 = ivec3(1, 1, 0); }
  }
  vec3 p1 = p0 - vec3(o1) + ${f(1 / 6)};
  vec3 p2 = p0 - vec3(o2) + ${f(2 / 6)};
  vec3 p3 = p0 - 0.5;
  ivec3 cell = ivec3(fl) & 255;
  float n = cornerN(p0, perm(cell.x + perm(cell.y + perm(cell.z))) % 12)
    + cornerN(p1, perm(cell.x + o1.x + perm(cell.y + o1.y + perm(cell.z + o1.z))) % 12)
    + cornerN(p2, perm(cell.x + o2.x + perm(cell.y + o2.y + perm(cell.z + o2.z))) % 12)
    + cornerN(p3, perm(cell.x + 1 + perm(cell.y + 1 + perm(cell.z + 1))) % 12);
  return 32.0 * n;
}
`;


/**
 * The dimensionless carve at a point in the cloud's own frame, for
 * the first `octaves` of the cascade: cloudLocalDensity's three or
 * cloudFineDensity's whole cascade. The per-cloud amplitude and gain
 * are left to the caller as a scale, so the value stays order unity.
 */
export function carveFunctionGlsl(name: string, octaves: number): string {
  return `
float ${name}(vec3 posPc, vec3 invStretch, float radiusPc, float seedOffset) {
  vec3 a = posPc * invStretch;
  float dSq = dot(a, a);
  float reach = radiusPc * ${f(ENVELOPE_REACH)};
  if (dSq > reach * reach) return 0.0;
  float envelope = exp(${f(-ENVELOPE_TIGHTNESS)} * dSq / (radiusPc * radiusPc));
  vec3 q = a / radiusPc + vec3(seedOffset, 0.0, 0.0);
  float turbulence = ${f(TURBULENCE_MEAN)}
    ${TURBULENCE_OCTAVES.slice(0, octaves)
      .map(([frequency, amplitude]) => `+ ${f(amplitude)} * shapeNoise(q * ${f(frequency)})`)
      .join('\n    ')};
  float carved = envelope * (max(turbulence, 0.0) + ${f(TURBULENCE_LIFT)}) - ${f(CARVE_THRESHOLD)};
  return carved <= 0.0 ? 0.0 : pow(carved, ${f(CARVE_EXPONENT)});
}
`;
}
