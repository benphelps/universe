import {
  ARM_LUT_RADIUS_MAX_PC,
  ARM_LUT_RADIUS_MIN_PC,
} from '../../universe/galaxy/armLut';
import { CLUMP_TILE_PERIOD, CLUMP_TILE_RANGE } from '../galaxy/clumpTile';
import { glslFloat as f } from './format';

/**
 * The galaxy as a line-of-sight integral, in GLSL: the density model's
 * components (disks, halo, dust with clumping, knee, reddening —
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
export const buildGalaxyRadianceGlsl = (): string => /* glsl */ `
precision highp sampler3D;
uniform sampler2D uArmLut;
uniform sampler3D uClumpNoise;

// The density wave, read back off the model's own bake: x = stellar
// arm boost, y = inner-edge dust-lane weight. Azimuth wraps around
// the texture; log radius runs down it and clamps onto zero rows.
vec2 armProfile(float radiusKpc, float azimuth) {
  if (radiusKpc < ${f(ARM_LUT_RADIUS_MIN_PC / 1000)}) return vec2(0.0);
  float v = log(radiusKpc * ${f(1000 / ARM_LUT_RADIUS_MIN_PC)}) *
    ${f(1 / Math.log(ARM_LUT_RADIUS_MAX_PC / ARM_LUT_RADIUS_MIN_PC))};
  return texture(uArmLut, vec2(azimuth * ${f(1 / (2 * Math.PI))}, v)).rg;
}

// Off-slab light: outside the disk the thin component is negligible
// and the arms with it — the halo loops never pay for the wave.
float haloDensity(vec3 p) {
  float radius = length(p.xy);
  float absZ = abs(p.z);
  float thin = 2.08687 * exp(-radius / 2.6) * exp(-absZ / 0.3);
  float thick = 0.0943516 * exp(-radius / 3.6) * exp(-absZ / 0.9);
  float sphericalR = max(length(p), 0.5);
  float halo = 0.0008 * pow(sphericalR / 8.0, -3.5);
  return thin + thick + halo;
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
 * Radiance reaching camKpc from direction dir, in the galaxy's own
 * frame. The ray's passage: a bounding sphere for the halo, and inside
 * it the disk slab where nearly all light and all dust live. Sampling
 * follows the geometry — fine steps across the slab crossing, coarse
 * steps through the smooth halo — so the disk resolves whether the
 * camera sits inside it or ten kiloparsecs up.
 */
vec3 galaxyRadiance(vec3 camKpc, vec3 dir, float meanLum) {
  vec3 cam = camKpc;
  float b = dot(cam, dir);
  float cc = dot(cam, cam) - 33.0 * 33.0;
  float disc = b * b - cc;
  if (disc <= 0.0) return vec3(0.0);
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0);
  float t1 = max(-b + sq, 0.0);

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

  float light = 0.0;
  float tau = 0.0;

  // Halo before the slab: emission only, no dust out there.
  float preStep = (slab0 - t0) / 16.0;
  if (preStep > 0.001) {
    for (int i = 0; i < 16; i++) {
      vec3 p = cam + dir * (t0 + (float(i) + 0.5) * preStep);
      light += haloDensity(p) * preStep;
    }
  }

  // The disk crossing: emission with running dust extinction. Dust
  // opacity is 0.045 per pc of unit density: 45 per kpc. One arm
  // profile per step feeds the thin disk and the inner-edge dust
  // lane; clump patchiness stays arm-neutral so arms shine over
  // their own dust the way face-on spirals do.
  float diskStep = (slab1 - slab0) / 72.0;
  if (diskStep > 0.0005) {
    // The wave profile and the clump noise are smooth at step scale:
    // hold the wave for four steps and the clump for two — the
    // texture-fetch budget of the march.
    vec2 arm = vec2(0.0);
    float clumpNoise = 0.0;
    for (int i = 0; i < 72; i++) {
      float s = slab0 + (float(i) + 0.5) * diskStep;
      vec3 p = cam + dir * s;
      float radius = length(p.xy);
      if ((i & 3) == 0) arm = armProfile(radius, atan(p.y, p.x));
      if ((i & 1) == 0) clumpNoise = cloudClump(p);
      // Smooth count-level arms only: the particle layer carries the
      // young light and every grain of texture.
      float thin = 2.08687 * exp(-radius / 2.6) * exp(-abs(p.z) / 0.3) * (1.0 + arm.x);
      float thick = 0.0943516 * exp(-radius / 3.6) * exp(-abs(p.z) / 0.9);
      float halo = 0.0008 * pow(max(length(p), 0.5) / 8.0, -3.5);
      float dust = exp(-radius / 2.6) * exp(-abs(p.z) / 0.12) * (1.0 + 1.4 * arm.y);
      float clump = s > 1.5 ? (0.45 + 1.6 * clumpNoise) * (1.0 + 0.5 * arm.y) : 0.45;
      tau += dust * clump * 45.0 * diskStep;
      light += (thin + thick + halo) * diskStep * exp(-tau);
    }
  }

  // Halo behind, seen through the disk's dust.
  float postStep = (t1 - slab1) / 16.0;
  if (postStep > 0.001) {
    float through = exp(-tau);
    for (int i = 0; i < 16; i++) {
      vec3 p = cam + dir * (slab1 + (float(i) + 0.5) * postStep);
      light += haloDensity(p) * postStep * through;
    }
  }

  float reddening = exp(-tau * 0.25);
  // light is density * kpc: fold mean luminosity and the glow map's
  // 9.2e-5 photometric scale (times 1000 pc/kpc) into one constant.
  float raw = light * meanLum * 0.092;
  float scale = raw / (1.0 + 0.2 * raw);
  return vec3(
    scale,
    scale * 0.93 * (0.75 + 0.25 * reddening),
    scale * 0.85 * (0.55 + 0.45 * reddening)
  );
}
`;
