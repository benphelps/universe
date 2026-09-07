import { SMOOTH_MODEL, DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import { GALAXY_COMPONENT_GLSL } from './galaxyComponents';
import { CELL_TRANSFER_GLSL } from '../../core/physics/radiativeTransfer';
import {
  ARM_LUT_RADIUS_MAX_PC,
  ARM_LUT_RADIUS_MIN_PC,
} from '../../universe/galaxy/armLut';
import { CLUMP_TILE_PERIOD, CLUMP_TILE_RANGE } from '../galaxy/clumpTile';
import { OVERVIEW_RADIUS_PC } from '../../universe/galaxy/overviewSurvey';
import { glslFloat as f } from './format';

/**
 * The galaxy as a line-of-sight integral, in GLSL: the density model's
 * components (disks, halo, dust with clumping and RGB extinction —
 * constants mirror density.ts and skyfield.ts), evaluated from any
 * point in any direction. The dome around the camera marches it to
 * paint the band and the spiral.
 *
 * The expensive fields come baked, not computed: the march used to
 * re-solve the orbit family and evaluate simplex per step per pixel,
 * and that was nearly the whole frame. The emitted code reads two
 * textures the material must bind — uArmLut from galaxyLuts (the
 * model's own armProfile on a polar grid, which also ends the shader
 * mirror that had frozen the prime galaxy's modulation constants into
 * every derived galaxy) and uClumpNoise (the tiling clump field).
 * GLSL 3 only, for the sampler3D.
 *
 * All marching runs in kiloparsecs so every intermediate stays within
 * even mediump float range. Densities are per pc³ (scale-free ratios);
 * path lengths fold their pc conversion into the accumulation
 * constants. The clump noise is the statistical limit of the
 * molecular-cloud population, the same convention the belt point cloud
 * uses.
 */
export const buildGalaxyRadianceGlsl = (overview = false, transmissionOnly = false): string => /* glsl */ `
${CELL_TRANSFER_GLSL}
${GALAXY_COMPONENT_GLSL}
precision highp sampler3D;
uniform sampler2D uArmLut;
uniform sampler3D uClumpNoise;
${overview ? `uniform vec3 uSelectedThin;
uniform float uDustScale;
vec3 overviewEmission(vec3 p, float armBoost) {
  vec3 n = galaxyFieldDensity(p);
  n.x *= 1.0 + armBoost;
  vec4 counts = vec4(n,galaxyBulgeDensity(p));
  vec3 full = vec3(dot(counts,uPopulationR),dot(counts,uPopulationG),dot(counts,uPopulationB));
  float thin = n.x;
  return full - (length(p.xy) < ${f(OVERVIEW_RADIUS_PC/1000)} ? thin * uSelectedThin : vec3(0.0));
}` : ''}

// Shared signed contrasts: x = stellar arm redistribution,
// y = patchy dust lanes and branches. Azimuth wraps around
// the texture; log radius runs down it and clamps onto zero rows.
vec2 armProfile(float radiusKpc, float azimuth) {
  if (radiusKpc < ${f(ARM_LUT_RADIUS_MIN_PC / 1000)}) return vec2(0.0);
  float v = log(radiusKpc * ${f(1000 / ARM_LUT_RADIUS_MIN_PC)}) *
    ${f(1 / Math.log(ARM_LUT_RADIUS_MAX_PC / ARM_LUT_RADIUS_MIN_PC))};
  return texture(uArmLut, vec2(azimuth * ${f(1 / (2 * Math.PI))}, v)).rg;
}

// Off-slab light: outside the disk the thin component is negligible
// and the arms with it — the halo loops never pay for the wave.
vec3 haloDensity(vec3 p) {
  return ${overview ? 'overviewEmission' : 'galaxyEmissionDensity'}(p, 0.0);
}

// Differential rotation curves structure: rotate by an angle growing
// with log radius. Gentle strengths only — hard shear combs noise
// into stripes; k is per-octave so features never all align.
vec3 swirl(vec3 p, float k) {
  float ang = k * log(max(length(p.xy), 0.8));
  float c = cos(ang);
  float s = sin(ang);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z * 1.7);
}

// The tiling noise field, read where shader simplex used to run: the
// coordinate is in noise wavelengths, the tile spans a period of them.
float tileNoise(vec3 at) {
  return texture(uClumpNoise, at * ${f(1 / CLUMP_TILE_PERIOD)}).r *
    ${f(2 * CLUMP_TILE_RANGE)} - ${f(CLUMP_TILE_RANGE)};
}

// Clumped ISM overdensity beyond the per-cloud radius: patchiness at
// the cloud-complex scale, mildly sheared into trailing filaments.
float cloudClump(vec3 p) {
  vec3 q = swirl(p, 1.1);
  float n = tileNoise(q / 0.38) + 0.55 * tileNoise(q / 0.14 + vec3(37.0, -11.0, 53.0));
  float carved = max(1.0e-5, n - 0.25);
  return 3.2 * carved * sqrt(carved);
}

/**
 * Integrate a continuous sequence of cells through the disk. A Cauchy
 * change of variable concentrates cells near the ray's closest approach
 * to the dusty disk (3 kpc radially, 180 pc vertically). These widths
 * control quadrature, not physical density. Fractional counts and cell
 * boundaries move continuously with the ray, avoiding rounded thin/thick
 * allocations that turn grazing sightlines into visible sampling sheets.
 * Each cell samples its own arms and 3D clouds and uses its actual length.
 */
void marchDisk(vec3 cam, vec3 dir, float from, float to, inout vec3 light, inout vec3 transmission) {
  if (to - from <= 0.0005) return;
  vec3 metric = vec3(1.0 / 3.0, 1.0 / 3.0, 1.0 / 0.18);
  vec3 scaledDir = dir * metric;
  float inverseWidth = length(scaledDir);
  float center = -dot(cam * metric, scaledDir) / dot(scaledDir, scaledDir);
  float angleFrom = atan((from - center) * inverseWidth);
  float angleTo = atan((to - center) * inverseWidth);
  // A vertical ray only needs to resolve the 120 pc dust height. Long
  // grazing rays must also resolve the 140 pc cloud octave. Keeping the
  // count fractional gives the last cell a continuously growing width;
  // rounding it would shift every sample when a new cell is needed.
  float budget = mix(384.0, 64.0, smoothstep(0.0, 0.35, abs(dir.z)));
  float steps = max(1.0, (angleTo - angleFrom) * budget / 3.141592653589793);
  float cellFrom = from;
  for (int i = 0; i < 384; i++) {
    if (float(i) >= steps) break;
    float fraction = min(float(i + 1) / steps, 1.0);
    float angle = mix(angleFrom, angleTo, fraction);
    float cellTo = fraction == 1.0 ? to : clamp(center + tan(angle) / inverseWidth, cellFrom, to);
    float step = cellTo - cellFrom;
    float s = 0.5 * (cellFrom + cellTo);
    cellFrom = cellTo;
    vec3 p = cam + dir * s;
    float radius = length(p.xy);
    vec2 arm = armProfile(radius, atan(p.y, p.x));
    ${transmissionOnly ? '' : `vec3 emission = ${overview ? 'overviewEmission' : 'galaxyEmissionDensity'}(p, arm.x);`}
    float dust = exp(-radius / ${f(SMOOTH_MODEL.dustScaleLengthPc / 1000)}) *
      exp(-abs(p.z) / ${f(SMOOTH_MODEL.dustScaleHeightPc / 1000)}) * (1.0 + ${f(SMOOTH_MODEL.dustLaneWeight)} * arm.y);
    // The local cloud renderer takes over nearby. Blend that handoff
    // across a finite distance instead of cutting a camera-centered shell.
    float cloudShare = smoothstep(1.2, 1.8, s);
    float clump = 0.45;
    if (cloudShare > 0.0) clump = mix(clump, (0.45 + 1.6 * cloudClump(p)) * (1.0 + 0.5 * arm.y), cloudShare);
    float depth = dust * clump * ${f(DUST_OPACITY_PER_PC * 1000)} * step ${overview ? '* uDustScale' : ''};
    vec3 cellDepth = depth * GALAXY_DUST_RGB;
    vec3 cellThrough = exp(-cellDepth);
    ${transmissionOnly ? '' : 'light += emission * step * transmission * cellEmissionWeight(cellDepth, cellThrough);'}
    transmission *= cellThrough;
  }
}

/**
 * Radiance reaching camKpc from direction dir, in the galaxy's own
 * frame. The ray's passage: a bounding sphere for the halo, and inside
 * it the disk slab where nearly all light and all dust live. Sampling
 * follows the geometry — fine steps across the slab crossing, coarse
 * steps through the smooth halo — so the disk resolves whether the
 * camera sits inside it or ten kiloparsecs up.
 */
vec3 galaxyIntegral(vec3 camKpc, vec3 dir, float maximumDistance, out vec3 transmission) {
  transmission = vec3(1.0);
  vec3 cam = camKpc;
  float b = dot(cam, dir);
  float cc = dot(cam, cam) - 33.0 * 33.0;
  float disc = b * b - cc;
  if (disc <= 0.0) return vec3(0.0);
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = min(max(-b + sq, 0.0), maximumDistance);
  if (t1 <= t0) return vec3(0.0);

  float zMax = 2.6;
  float slab0;
  float slab1;
  if (abs(dir.z) < 1.0e-5) {
    slab0 = abs(cam.z) < zMax ? t0 : t1;
    slab1 = t1;
  } else {
    float ta = (-zMax - cam.z) / dir.z;
    float tb = (zMax - cam.z) / dir.z;
    slab0 = clamp(min(ta, tb), t0, t1);
    slab1 = clamp(max(ta, tb), t0, t1);
  }

  vec3 light = vec3(0.0);

  // Halo before the slab: emission only, no dust out there.
  float preStep = (slab0 - t0) / 16.0;
  if (${transmissionOnly ? 'false' : 'preStep > 0.001'}) {
    for (int i = 0; i < 16; i++) {
      vec3 p = cam + dir * (t0 + (float(i) + 0.5) * preStep);
      light += haloDensity(p) * preStep;
    }
  }

  marchDisk(cam, dir, slab0, slab1, light, transmission);

  // Halo behind, seen through the disk's dust.
  float postStep = (t1 - slab1) / 16.0;
  if (${transmissionOnly ? 'false' : 'postStep > 0.001'}) {
    for (int i = 0; i < 16; i++) {
      vec3 p = cam + dir * (slab1 + (float(i) + 0.5) * postStep);
      light += haloDensity(p) * postStep * transmission;
    }
  }

  // Densities are L☉/pc³, steps are kpc, and isotropic emission
  // spreads into 4π sr. Do not apply a display curve inside transport.
  return light * (1000.0 / 12.566370614359172);
}
vec3 galaxyRadiance(vec3 camKpc, vec3 dir) {
  vec3 through;
  return galaxyIntegral(camKpc, dir, 1e6, through);
}
vec3 galaxyTransmission(vec3 observerKpc, vec3 sourceKpc) {
  vec3 delta = sourceKpc - observerKpc;
  float distance = length(delta);
  if (distance < 1e-8) return vec3(1.0);
  vec3 through;
  galaxyIntegral(observerKpc, delta / distance, distance, through);
  return through;
}
`;
