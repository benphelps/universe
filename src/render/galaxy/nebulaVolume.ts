import {
  BackSide,
  ClampToEdgeWrapping,
  Data3DTexture,
  GLSL3,
  LinearFilter,
  Matrix3,
  Mesh,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import type { NebulaVolumeBake } from '../../universe/galaxy/nebulaVolume';
import type { StarNebulaExtinction } from '../starfield/neighborStars';

/** Henyey–Greenstein asymmetry of interstellar grains in the optical:
 *  strongly forward-scattering. */
const HG_G = 0.6;

const VERTEX = /* glsl */ `
// The dome is a unit sphere centered on the camera and never rotated,
// so the local vertex position IS the view ray.
out vec3 vRay;
void main() {
  vRay = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // The nebula is hundreds of parsecs out and the far plane is tens:
  // it is a direction and a depth of its own, carried by a dome that
  // rides the camera, exactly as the galaxy volume is.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

const STEPS = 96;

export const NEBULA_FRAGMENT = /* glsl */ `
precision highp sampler3D;
// GLSL 3: a raw shader declares its own varying and its own output —
// three shims neither for a material it did not write.
in vec3 vRay;
out vec4 fragColor;
uniform sampler3D uVolume;
uniform vec3 uCentrePc;
uniform vec3 uCamPc;
uniform mat3 uWorldToGalaxy;
uniform float uHalfPc;
uniform float uDustRef;
uniform float uDensityRef;
uniform vec3 uEmissionHot;
uniform vec3 uEmissionCool;
uniform vec3 uReflection;
uniform float uEmissionCoefficient;
uniform sampler3D uFine;
uniform vec3 uFineOffsetPc;
uniform float uFineHalfPc;
uniform float uFineDustRef;
uniform float uFineDensityRef;
uniform float uFineEmissionCoefficient;
uniform vec3 uScatterSourcePc;
uniform float uScatterLum;
uniform float uScatterFloorPc2;
uniform float uFineScatterFloorPc2;
uniform float uOpacity;

/** Interleaved gradient noise: one cheap dither per pixel, so the
 *  march's step boundaries never line up into shells. */
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 dir = normalize(uWorldToGalaxy * vRay);
  // Everything below is in parsecs, in the box's own frame.
  vec3 rel = uCamPc - uCentrePc;
  vec3 inv = 1.0 / dir;
  vec3 a = (vec3(-uHalfPc) - rel) * inv;
  vec3 b = (vec3(uHalfPc) - rel) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  float near = max(max(lo.x, lo.y), max(lo.z, 0.0));
  float far = min(min(hi.x, hi.y), hi.z);
  if (far <= near) discard;

  float ds = (far - near) / float(${STEPS});
  float jitter = dither(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 p = rel + dir * (near + (float(i) + jitter) * ds);
    vec4 cell = texture(uVolume, p / (2.0 * uHalfPc) + 0.5);
    float dust = cell.r * uDustRef;
    float ionized = cell.g * uDensityRef;
    float coefficient = uEmissionCoefficient;
    float scatterFloor = uScatterFloorPc2;

    // A cloud is a hundred parsecs and the bubble its newborns blow is
    // a few: one grid cannot hold both, and a grid that holds the cloud
    // puts the whole ionized region inside a single cell. So it is
    // baked again at its own scale, and read here wherever the ray
    // passes through it.
    if (uFineHalfPc > 0.0) {
      vec3 q = p - uFineOffsetPc;
      if (all(lessThan(abs(q), vec3(uFineHalfPc)))) {
        vec4 fine = texture(uFine, q / (2.0 * uFineHalfPc) + 0.5);
        dust = fine.r * uFineDustRef;
        ionized = fine.g * uFineDensityRef;
        cell.b = fine.b;
        cell.a = fine.a;
        coefficient = uFineEmissionCoefficient;
        scatterFloor = uFineScatterFloorPc2;
      }
    }

    // Recombination lines: optically thin, and going as the square of
    // the density because every emission is an electron meeting a
    // proton. The hue is the line mixture at this cell's hardness.
    vec3 emission = mix(uEmissionCool, uEmissionHot, cell.b) * ionized * ionized * coefficient;
    // What the dust scatters of the group's light: the flux arriving
    // from the star it actually comes from, dimmed by the dust between
    // (cell.a), scattered by this cell's dust. The floor keeps the
    // source's own cell finite rather than singular.
    vec3 shine = p - uScatterSourcePc;
    float r2 = max(dot(shine, shine), scatterFloor);
    // Henyey–Greenstein phase, forward-peaked the way grains actually
    // throw light: dust between camera and star glows, dust lit from
    // the camera's side stays matte. Single scattering only, until the
    // multiple-scattering table lands with the reflection pass.
    float mu = -dot(shine, dir) * inversesqrt(r2);
    float phase = ${(1 - HG_G * HG_G).toFixed(4)} *
      pow(1.0 + ${(HG_G * HG_G).toFixed(4)} - ${(2 * HG_G).toFixed(4)} * mu, -1.5);
    vec3 scattered = uReflection * uScatterLum * phase * dust * cell.a / r2;

    float extinction = dust * ${DUST_OPACITY_PER_PC.toFixed(4)};
    light += transmittance * (emission + scattered) * ds;
    transmittance *= exp(-extinction * ds);
    if (transmittance < 0.004) break;
  }

  // Premultiplied: what the nebula emits, over what it lets past.
  fragColor = vec4(light * uOpacity, (1.0 - transmittance) * uOpacity);
}
`;

/**
 * One nebula as a volume, marched per pixel.
 *
 * The bake did the physics; this integrates it along the view ray —
 * emission accumulating linearly because the lines are optically thin,
 * dust taking its toll on everything behind it. The carrier is a dome
 * around the camera rather than a mesh at the nebula's place: the
 * camera's far plane is tens of parsecs and the nebula is hundreds
 * out, so a box at its true position would be clipped away. The ray
 * meets the box analytically instead, in parsecs, where the numbers
 * are small and honest.
 */
export class NebulaVolume {
  readonly mesh: Mesh;
  readonly seed: bigint;
  /** How far the camera stood from the box centre at the last update,
   *  pc — what residency ordering and the star march choose by. */
  cameraDistancePc = Infinity;
  private readonly material: ShaderMaterial;
  private readonly texture: Data3DTexture;
  private readonly fineTexture: Data3DTexture;
  private readonly sceneToGalaxy: Matrix3;
  private readonly cameraToGalaxy = new Matrix3();

  constructor(
    bake: NebulaVolumeBake,
    fine: NebulaVolumeBake | null,
    private readonly viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
  ) {
    this.seed = bake.seed;
    const m = sceneFromGalaxy;
    this.sceneToGalaxy = new Matrix3().set(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);

    this.fineTexture = fine ? volumeTexture(fine) : emptyVolume();
    this.texture = new Data3DTexture(bake.data, bake.size, bake.size, bake.size);
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.wrapR = ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: NEBULA_FRAGMENT,
      uniforms: {
        uVolume: { value: this.texture },
        uCentrePc: { value: new Vector3(...bake.centrePc) },
        uCamPc: { value: new Vector3() },
        uWorldToGalaxy: { value: new Matrix3() },
        uHalfPc: { value: bake.halfExtentsPc[0] },
        uDustRef: { value: bake.dustRef },
        uDensityRef: { value: bake.densityRef },
        uEmissionHot: { value: new Vector3(...bake.emissionHot) },
        uEmissionCool: { value: new Vector3(...bake.emissionCool) },
        uReflection: { value: new Vector3(...bake.reflectionColor) },
        uEmissionCoefficient: { value: bake.emissionCoefficient * NEBULA_PIXEL_SCALE },
        uScatterSourcePc: { value: new Vector3(...bake.scatterSourcePc) },
        uScatterLum: {
          value: bake.scatterLuminositySolar * SCATTER_EMISSIVITY_PER_LSUN * NEBULA_PIXEL_SCALE,
        },
        uScatterFloorPc2: { value: (bake.halfExtentsPc[0] / bake.size) ** 2 },
        uFineScatterFloorPc2: {
          value: fine ? (fine.halfExtentsPc[0] / fine.size) ** 2 : 1,
        },
        uOpacity: { value: 1 },
        uFine: { value: this.fineTexture },
        uFineOffsetPc: {
          value: fine
            ? new Vector3(
                fine.centrePc[0] - bake.centrePc[0],
                fine.centrePc[1] - bake.centrePc[1],
                fine.centrePc[2] - bake.centrePc[2],
              )
            : new Vector3(),
        },
        uFineHalfPc: { value: fine ? fine.halfExtentsPc[0] : 0 },
        uFineDustRef: { value: fine?.dustRef ?? 1 },
        uFineDensityRef: { value: fine?.densityRef ?? 1 },
        uFineEmissionCoefficient: {
          value: (fine?.emissionCoefficient ?? 0) * NEBULA_PIXEL_SCALE,
        },
      },
      side: BackSide,
      // Premultiplied alpha is exactly the volume-rendering composite:
      // what the nebula emits, plus what survives of everything behind.
      blending: NormalBlending,
      premultipliedAlpha: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 24, 12), this.material);
    // Behind the star points and the sky domes, in front of the galaxy.
    this.mesh.renderOrder = -6;
    this.mesh.frustumCulled = false;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
    this.mesh.visible = value > 0.002;
  }

  /** Per-frame: where the camera stands, in the galaxy's own frame. */
  update(cameraWorldKm: Vector3, worldToScene: Matrix3, pcKm: number, domeRadiusKm: number): void {
    const worldToGalaxy = this.material.uniforms.uWorldToGalaxy.value as Matrix3;
    worldToGalaxy.multiplyMatrices(this.sceneToGalaxy, worldToScene);
    const cam = this.material.uniforms.uCamPc.value as Vector3;
    cam.copy(cameraWorldKm).applyMatrix3(worldToGalaxy).divideScalar(pcKm);
    cam.set(
      cam.x + this.viewpointPc.xPc,
      cam.y + this.viewpointPc.yPc,
      cam.z + this.viewpointPc.zPc,
    );
    this.cameraDistancePc = cam.distanceTo(this.material.uniforms.uCentrePc.value as Vector3);
    this.mesh.position.copy(cameraWorldKm);
    this.mesh.scale.setScalar(domeRadiusKm);
  }

  /** What the star field needs to dim itself through this cloud. */
  extinctionFor(cameraRotation: Matrix3): StarNebulaExtinction {
    const uniforms = this.material.uniforms;
    return {
      volume: this.texture,
      halfPc: uniforms.uHalfPc.value as number,
      centrePc: uniforms.uCentrePc.value as Vector3,
      camPc: uniforms.uCamPc.value as Vector3,
      cameraToGalaxy: this.cameraToGalaxy.multiplyMatrices(
        uniforms.uWorldToGalaxy.value as Matrix3,
        cameraRotation,
      ),
      dustRef: uniforms.uDustRef.value as number,
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.fineTexture.dispose();
  }
}

/** A bake as a sampler-ready 3D texture. */
function volumeTexture(bake: NebulaVolumeBake): Data3DTexture {
  const texture = new Data3DTexture(bake.data, bake.size, bake.size, bake.size);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.wrapR = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Something for the sampler to bind to when there is no fine volume:
 *  an unbound sampler3D is a draw-time error, not an empty read. */
function emptyVolume(): Data3DTexture {
  const texture = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * What a solar luminosity per square parsec per steradian comes to on
 * screen. The nebula's own brightness is settled in the bake — its
 * star's ionizing budget fixes the line luminosity and the gas divides
 * it by n² — so this is the one conversion left, shared by every
 * nebula: the renderer's photometric zero point for surface
 * brightness, the counterpart of the one the star sprites carry.
 *
 * Calibrated against the sky's own sprites, which are the approved
 * look: the same cloud rendered both ways at the same distance matches
 * to within the tone map, so a nebula keeps its brightness when the
 * backdrop hands it off to the volume instead of stepping down by an
 * order of magnitude. The plan's sprite/volume agreement test is the
 * finer version of this number, cloud by cloud.
 */
const NEBULA_PIXEL_SCALE = 7.5;
/** Optical albedo of interstellar dust (Draine): the share of what
 *  falls on a grain that leaves it again as scattered light. */
const DUST_ALBEDO = 0.6;
/** Scattered emissivity per L☉ per unit dust at unit distance,
 *  L☉ pc⁻³ sr⁻¹: the flux L/(4πr²) times the dust's opacity per
 *  parsec, times albedo over the 4π sr it rescatters into — isotropic
 *  until the phase-function table lands with the reflection pass. */
const SCATTER_EMISSIVITY_PER_LSUN = (DUST_OPACITY_PER_PC * DUST_ALBEDO) / (16 * Math.PI ** 2);
