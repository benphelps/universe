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
import { glslFloat as f } from '../glsl/format';
import { galaxyLutTextures } from './galaxyLuts';
import { CLUMP_TILE_PERIOD, CLUMP_TILE_RANGE } from './clumpTile';
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

/** March budget: the base for a volume as an object in frame, the
 *  ceiling for one filling the sky, whose rays are longest and whose
 *  sub-cell detail is finest against them. */
const BASE_STEPS = 96;
const MAX_STEPS = 160;

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
uniform float uOpacity;
uniform sampler3D uDetailNoise;
uniform float uDetailAmp;
uniform float uDetailFreq;
uniform float uFineDetailFreq;
uniform int uSteps;

/** Interleaved gradient noise: one cheap dither per pixel, so the
 *  march's step boundaries never line up into shells. */
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

/**
 * The turbulent cascade continued below the grid. A cell of a
 * cloud-sized box spans degrees of sky from within, and trilinear
 * filtering renders it as featureless mush; real clouds are structured
 * all the way down. Two octaves of the galaxy's tiling noise, pitched
 * just under the cell and world-anchored in the box's own frame,
 * modulate the sampled density — statistical detail, deliberately
 * unseeded, the same line the terrain draws below its tiles. The amps
 * echo the model's own cascade and the clamp is its carve: a deep
 * trough goes to nothing, which is where the filaments come from.
 */
float subCellDetail(vec3 p, float freq) {
  float n1 = texture(uDetailNoise, p * (freq * ${f(1 / CLUMP_TILE_PERIOD)})).r *
    ${f(2 * CLUMP_TILE_RANGE)} - ${f(CLUMP_TILE_RANGE)};
  float n2 = texture(uDetailNoise, p * (freq * ${f(2.26 / CLUMP_TILE_PERIOD)}) + 0.37).r *
    ${f(2 * CLUMP_TILE_RANGE)} - ${f(CLUMP_TILE_RANGE)};
  return max(0.0, 1.0 + uDetailAmp * (0.55 * n1 + 0.3 * n2));
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

  float ds = (far - near) / float(uSteps);
  float jitter = dither(gl_FragCoord.xy);
  vec3 light = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= uSteps) break;
    vec3 p = rel + dir * (near + (float(i) + jitter) * ds);
    vec4 cell = texture(uVolume, p / (2.0 * uHalfPc) + 0.5);
    float dust = cell.r * uDustRef;
    float ionized = cell.g * uDensityRef;
    float coefficient = uEmissionCoefficient;
    float detailFreq = uDetailFreq;

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
        detailFreq = uFineDetailFreq;
      }
    }

    // Sub-cell structure, paid for only when the volume is large in
    // frame — the amp is zero otherwise and the fetches are skipped.
    if (uDetailAmp > 0.001) {
      float detail = subCellDetail(p, detailFreq);
      dust *= detail;
      ionized *= detail;
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
    float r2 = max(dot(shine, shine), uScatterFloorPc2);
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
    this.hasFine = fine !== null;
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
        uScatterFloorPc2: { value: bake.scatterFloorPc2 },
        uOpacity: { value: 1 },
        // The galaxy's tiling clump field, reused as the sub-cell
        // texture: zeros until its worker bake lands, which reads as
        // detail 1 — the plain grid, nothing false.
        uDetailNoise: { value: galaxyLutTextures().clumpTile },
        uDetailAmp: { value: 0 },
        // First sub-cell octave at half the cell of each grid.
        uDetailFreq: { value: bake.size / bake.halfExtentsPc[0] },
        uFineDetailFreq: { value: fine ? fine.size / fine.halfExtentsPc[0] : 1 },
        uSteps: { value: BASE_STEPS },
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

  /** Whether the bubble-scale grid rode in beside the cloud's — what
   *  tells the viewer this volume is complete and its source bakes
   *  need not be held for a reinstall. */
  readonly hasFine: boolean;
  /** Crossfade against the sprite tier, 0..1 — the viewer ramps it
   *  every frame, and the sprite carries the complement, so a volume
   *  arrives and leaves as a dissolve rather than a swap. */
  fade = 0;
  /** Standing down: fading toward removal — until residency wants the
   *  cloud again, which simply fades it back. */
  retiring = false;

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
    // Sub-cell detail is bought by apparent size: a volume filling the
    // sky shows its cells as degrees of mush and pays for the octaves
    // and the deeper march; one standing small in frame renders its
    // grid as-is at the base step count.
    const apparent =
      (this.material.uniforms.uHalfPc.value as number) / Math.max(1e-3, this.cameraDistancePc);
    const gate = Math.min(1, Math.max(0, (apparent - 0.35) / 0.85));
    const eased = gate * gate * (3 - 2 * gate);
    this.material.uniforms.uDetailAmp.value = eased;
    this.material.uniforms.uSteps.value =
      BASE_STEPS + Math.round((MAX_STEPS - BASE_STEPS) * eased);
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
 * star's ionizing budget fixes the line luminosity, the group's light
 * feeds the scatter, and the gas divides them out — so this is the one
 * conversion left, shared by every nebula: the renderer's photometric
 * zero point for surface brightness, the counterpart of the one the
 * star sprites carry. Order unity by that kinship — the scattered
 * light is the same starlight the sprites map — held provisionally
 * until the photometric systems are unified outright.
 */
const NEBULA_PIXEL_SCALE = 1.0;
/** Optical albedo of interstellar dust (Draine): the share of what
 *  falls on a grain that leaves it again as scattered light. */
const DUST_ALBEDO = 0.6;
/** Scattered emissivity per L☉ per unit dust at unit distance,
 *  L☉ pc⁻³ sr⁻¹: the flux L/(4πr²) times the dust's opacity per
 *  parsec, times albedo over the 4π sr it rescatters into — isotropic
 *  until the phase-function table lands with the reflection pass. */
const SCATTER_EMISSIVITY_PER_LSUN = (DUST_OPACITY_PER_PC * DUST_ALBEDO) / (16 * Math.PI ** 2);
