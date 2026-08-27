import {
  AdditiveBlending,
  BackSide,
  Matrix3,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';

const VERTEX = /* glsl */ `
// The dome is a unit sphere centered on the camera and never rotated,
// so the local vertex position IS the view ray — no planet-scale
// world coordinates ever enter the varying.
varying vec3 vRay;
void main() {
  vRay = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The galaxy as a volume: the same line-of-sight integral the sky
 * field's glow map computes per texel (density model, arm enhancement,
 * dust extinction with clumping, knee, reddening — constants mirror
 * density.ts and skyfield.ts), marched per pixel from wherever the
 * camera actually is. From inside it reproduces the band; from outside
 * the spiral, bulge, and dust patchiness emerge from the same model.
 * The clump noise is the statistical limit of the molecular-cloud
 * population, the same convention the belt point cloud uses.
 */
const FRAGMENT = /* glsl */ `
varying vec3 vRay;
uniform vec3 uCamGalKpc;
uniform mat3 uWorldToGalaxy;
uniform float uMeanLum;
uniform float uOpacity;

${SIMPLEX_NOISE_GLSL}

// All marching runs in kiloparsecs so every intermediate stays within
// even mediump float range. Densities are per pc^3 (scale-free ratios);
// path lengths fold their pc conversion into the accumulation constants.

float wrapPi(float angle) {
  return mod(angle + 3.14159265, 6.28318531) - 3.14159265;
}

// Density-wave orbit family, mirroring density.ts line for line: the
// arms are the crowding caustics of nested oval orbits, each tilted a
// little further with size (Lin-Shu; construction after beltoforion's
// renderer). x = stellar arm boost, y = inner-edge dust-lane weight.
float waveWinding(float guidingKpc) {
  return log(max(guidingKpc, 3.0) / 3.0) / 0.2125566; // tan 12 deg pitch
}

float waveTilt(float guidingKpc) {
  float u = waveWinding(guidingKpc);
  return u + 0.14 * sin(1.1 * u + 1.3) + 0.06 * sin(2.6 * u + 4.2);
}

float waveAxisRatio(float guidingKpc) {
  float bump = smoothstep(0.0, 4.2, guidingKpc) *
    pow(1.0 - smoothstep(4.2, 15.0, guidingKpc), 0.8);
  return 1.0 - 0.16 * bump;
}

float waveRadius(float guidingKpc, float azimuth) {
  float g = azimuth - waveTilt(guidingKpc);
  float q = waveAxisRatio(guidingKpc);
  float c = cos(g);
  float s = sin(g);
  return guidingKpc * q / sqrt(q * q * c * c + s * s);
}

float waveGuidingRadius(float radiusKpc, float azimuth) {
  float guiding = radiusKpc;
  for (int i = 0; i < 2; i++) {
    float g = azimuth - waveTilt(guiding);
    float q = waveAxisRatio(guiding);
    float c = cos(g);
    float s = sin(g);
    guiding = radiusKpc * sqrt(q * q * c * c + s * s) / q;
  }
  return guiding;
}

// One inversion serves the wave crowding, the lane crowding (its
// slight azimuth shift barely moves the guiding radius), and the
// patchiness coordinates — the march-step cost lives here.
vec2 armProfile(float radiusKpc, float azimuth) {
  if (radiusKpc < 0.5) return vec2(0.0);
  float guiding = waveGuidingRadius(radiusKpc, azimuth);
  float h = 0.04;
  float jacobian = (waveRadius(guiding + h, azimuth) - waveRadius(guiding - h, azimuth)) /
    (2.0 * h);
  float wave = max(0.0, 1.0 / max(jacobian, 0.3) - 1.0);
  float laneJacobian =
    (waveRadius(guiding + h, azimuth + 0.07) - waveRadius(guiding - h, azimuth + 0.07)) /
    (2.0 * h);
  float laneWave = max(0.0, 1.0 / max(laneJacobian, 0.3) - 1.0);
  float u = waveWinding(guiding);
  float phase = azimuth - waveTilt(guiding);
  float seg = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(1.9 * u + 5.1 + 1.7 * cos(phase)), 1.2);
  float knot = max(0.0, sin(7.0 * u + 1.0 + 2.0 * cos(phase)) * sin(4.3 * u + 0.9));
  float asym = 1.0 + 0.28 * cos(phase + 0.8);
  float boost = 0.98 * wave * seg * asym * (1.0 + 0.8 * knot * knot);
  float lane = min(1.6, 0.5 * laneWave) * (0.4 + 0.6 * seg);
  return vec2(boost, lane);
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

// Clumped ISM overdensity beyond the per-cloud radius: patchiness at
// the cloud-complex scale, mildly sheared into trailing filaments.
float cloudClump(vec3 p) {
  vec3 q = swirl(p, 1.1);
  float n = snoise(q / 0.38) + 0.55 * snoise(q / 0.14 + vec3(37.0, -11.0, 53.0));
  return 3.2 * pow(max(1.0e-5, n - 0.25), 1.5);
}

void main() {
  vec3 dir = normalize(uWorldToGalaxy * vRay);
  vec3 cam = uCamGalKpc;

  // The ray's passage through the galaxy: a bounding sphere for the
  // halo, and inside it the disk slab where nearly all light and all
  // dust live. Sampling follows the geometry — fine steps across the
  // slab crossing, coarse steps through the smooth halo — so the disk
  // resolves whether the camera sits inside it or ten kiloparsecs up.
  float b = dot(cam, dir);
  float cc = dot(cam, cam) - 33.0 * 33.0;
  float disc = b * b - cc;
  if (disc <= 0.0) { gl_FragColor = vec4(0.0); return; }
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
    // transcendental budget of the march.
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
  float raw = light * uMeanLum * 0.092;
  float scale = raw / (1.0 + 0.2 * raw);
  vec3 color = vec3(
    scale,
    scale * 0.93 * (0.75 + 0.25 * reddening),
    scale * 0.85 * (0.55 + 0.45 * reddening)
  );
  gl_FragColor = vec4(color * uOpacity, 1.0);
}
`;

/** Dome around the camera carrying the volumetric galaxy raymarch. */
export class GalaxyVolume {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  /** Row-major scene→galactic rotation (transpose of sceneFromGalaxy). */
  private readonly sceneToGalaxy: Matrix3;

  constructor(
    private readonly viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
  ) {
    const m = sceneFromGalaxy;
    // sceneFromGalaxy is row-major galactic→scene; its transpose goes back.
    this.sceneToGalaxy = new Matrix3().set(
      m[0], m[3], m[6],
      m[1], m[4], m[7],
      m[2], m[5], m[8],
    );
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCamGalKpc: { value: new Vector3() },
        uWorldToGalaxy: { value: new Matrix3() },
        uMeanLum: { value: 1.76 },
        uOpacity: { value: 0 },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 24, 12), this.material);
    this.mesh.renderOrder = -8;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  set meanLuminosity(value: number) {
    this.material.uniforms.uMeanLum.value = value;
  }

  /**
   * Per-frame state: camera world position (km), the world→scene
   * rotation (inverse of the ground frame), fade opacity, and a dome
   * radius safely inside the far plane.
   */
  update(
    cameraWorldKm: Vector3,
    worldToScene: Matrix3,
    pcKm: number,
    opacity: number,
    domeRadiusKm: number,
  ): void {
    this.mesh.visible = opacity > 0.002;
    if (!this.mesh.visible) return;
    this.material.uniforms.uOpacity.value = opacity;

    const worldToGalaxy = this.material.uniforms.uWorldToGalaxy.value as Matrix3;
    worldToGalaxy.multiplyMatrices(this.sceneToGalaxy, worldToScene);

    const camGal = this.material.uniforms.uCamGalKpc.value as Vector3;
    camGal
      .copy(cameraWorldKm)
      .applyMatrix3(worldToGalaxy)
      .divideScalar(pcKm);
    camGal.set(
      (camGal.x + this.viewpointPc.xPc) / 1000,
      (camGal.y + this.viewpointPc.yPc) / 1000,
      (camGal.z + this.viewpointPc.zPc) / 1000,
    );

    this.mesh.position.copy(cameraWorldKm);
    this.mesh.scale.setScalar(domeRadiusKm);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
