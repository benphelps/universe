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

// The spiral structure at one disk point, mirroring density.ts line for
// line: x = stellar arm boost, y = inner-edge dust-lane weight. Wobbled
// asymmetric ridges, breathing widths, segmented amplitudes studded
// with compact star-forming knots, five gated spurs, smooth emergence
// from the bulge.
vec2 armProfile(float radiusKpc, float azimuth) {
  float emerge = smoothstep(2.9, 4.6, radiusKpc);
  if (emerge <= 0.0) return vec2(0.0);
  float u = log(max(radiusKpc, 3.0) / 3.0) / 0.2125566; // tan 12 deg pitch
  float boost = 0.0;
  float lane = 0.0;
  for (int arm = 0; arm < 2; arm++) {
    float a = float(arm);
    float ridge = u + a * 3.36159265 +
      0.16 * sin(1.1 * u + 1.3 + 2.1 * a) + 0.07 * sin(2.6 * u + 4.2 + 1.7 * a);
    float d = abs(wrapPi(azimuth - ridge)) * radiusKpc;
    float width = 0.6 * (1.0 + 0.25 * sin(2.3 * u + 0.8 + 2.9 * a));
    float seg = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(1.9 * u + 5.1 + 2.45 * a), 1.3);
    float knot = max(0.0, sin(9.0 * u + 1.0 + 3.7 * a) * sin(5.7 * u + 0.9 + 2.0 * a));
    float body = d / width;
    float core = d / (0.5 * width);
    boost += (arm == 0 ? 1.0 : 0.78) * seg *
      (2.6 * exp(-body * body) + 2.6 * knot * knot * exp(-core * core));
    float laneD = abs(wrapPi(azimuth - (ridge - 0.05))) * radiusKpc / 0.3;
    lane += (0.4 + 0.6 * seg) * exp(-laneD * laneD);
  }
  float v = log(max(radiusKpc, 3.0) / 3.0) / 0.4452287; // tan 24 deg pitch
  for (int j = 0; j < 5; j++) {
    float d = abs(wrapPi(azimuth - (v + float(j) * 1.25663706 + 0.9))) * radiusKpc / 0.42;
    float gate = max(0.0, sin(2.6 * v + 2.4 * float(j) + 0.6));
    boost += 0.65 * gate * gate * exp(-d * d);
  }
  return vec2(boost, lane) * emerge;
}

float stellarDensity(vec3 p) {
  float radius = length(p.xy);
  float absZ = abs(p.z);
  float thin = 2.08687 * exp(-radius / 2.6) * exp(-absZ / 0.3) *
    (1.0 + armProfile(radius, atan(p.y, p.x)).x);
  float thick = 0.0943516 * exp(-radius / 3.6) * exp(-absZ / 0.9);
  float sphericalR = max(length(p), 0.5);
  float halo = 0.0008 * pow(sphericalR / 8.0, -3.5);
  return thin + thick + halo;
}

// Clumped ISM overdensity beyond the per-cloud radius: patchiness at
// the cloud-complex scale, in the amplitude range cloudFieldAt spans.
float cloudClump(vec3 p) {
  float n = snoise(p / 0.38) + 0.55 * snoise(p / 0.14 + vec3(37.0, -11.0, 53.0));
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
      light += stellarDensity(p) * preStep;
    }
  }

  // The disk crossing: emission with running dust extinction. Dust
  // opacity is 0.045 per pc of unit density: 45 per kpc. One arm
  // profile per step feeds the thin disk and the inner-edge dust
  // lane; clump patchiness stays arm-neutral so arms shine over
  // their own dust the way face-on spirals do.
  float diskStep = (slab1 - slab0) / 112.0;
  if (diskStep > 0.0005) {
    for (int i = 0; i < 112; i++) {
      float s = slab0 + (float(i) + 0.5) * diskStep;
      vec3 p = cam + dir * s;
      float radius = length(p.xy);
      vec2 arm = armProfile(radius, atan(p.y, p.x));
      float thin = 2.08687 * exp(-radius / 2.6) * exp(-abs(p.z) / 0.3) * (1.0 + arm.x);
      float thick = 0.0943516 * exp(-radius / 3.6) * exp(-abs(p.z) / 0.9);
      float halo = 0.0008 * pow(max(length(p), 0.5) / 8.0, -3.5);
      float dust = exp(-radius / 2.6) * exp(-abs(p.z) / 0.12) * (1.0 + 1.4 * arm.y);
      float clump = s > 1.5 ? 0.45 + 1.6 * cloudClump(p) : 0.45;
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
      light += stellarDensity(p) * postStep * through;
    }
  }

  float reddening = exp(-tau * 0.25);
  // light is density * kpc: fold mean luminosity and the glow map's
  // 2.3e-4 photometric scale (times 1000 pc/kpc) into one constant.
  float raw = light * uMeanLum * 0.23;
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
        uMeanLum: { value: 0.74 },
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
