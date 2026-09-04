import {
  BackSide,
  ClampToEdgeWrapping,
  Data3DTexture,
  GLSL3,
  LinearFilter,
  Matrix3,
  Mesh,
  NearestFilter,
  NormalBlending,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { DUST_OPACITY_PER_PC } from '../../universe/galaxy/density';
import {
  SCATTER_OPACITY_RGB,
  SCATTER_TABLE_TAU_MAX,
  SCATTER_TABLE_TAUS,
  SCATTER_TABLE_MUS,
} from '../../universe/galaxy/dustScattering';
import { scatterTableTexture } from './scatterTable';
import {
  SKY_PEDESTAL_LSUN_PC2_SR,
  type DisplayInstrument,
} from '../../universe/galaxy/displayLaw';
import { seatExtendedInstrument, TRANSFER_GLSL, transferUniforms } from '../displayTransfer';
import {
  combinedOccupancy,
  OCCUPANCY_SIZE,
  SCATTER_EMISSIVITY_PER_LSUN,
  type NebulaVolumeBake,
} from '../../universe/galaxy/nebulaVolume';
import { glslFloat as f } from '../glsl/format';
import { galaxyLutTextures } from './galaxyLuts';
import { CLUMP_TILE_PERIOD, CLUMP_TILE_RANGE } from './clumpTile';
import type { StarNebulaExtinction } from '../starfield/neighborStars';

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
 *  sub-cell detail is finest against them. Samples are only spent in
 *  occupied blocks; an empty block costs one iteration to cross, so
 *  the loop carries room for the blocks a ray can meet on top — for
 *  every box a carrier marches. */
const BASE_STEPS = 96;
const MAX_STEPS = 160;
/** Boxes one carrier marches together: the volumes the camera stands
 *  inside, whose gas lies both before and behind each other's along
 *  every ray, so no whole-volume compositing order is right for them.
 *  Three keeps the carrier's samplers — three grids per box, the
 *  detail tile and the scattering table — inside the eight-sampler
 *  minimum a fragment shader is guaranteed times two. */
export const MAX_BOXES = 3;
const MAX_ITERATIONS = MAX_BOXES * (MAX_STEPS + 3 * OCCUPANCY_SIZE);

export const NEBULA_FRAGMENT = /* glsl */ `
#define MAX_BOXES ${MAX_BOXES}
precision highp sampler3D;
in vec3 vRay;
out vec4 fragColor;
uniform sampler3D uVolume[MAX_BOXES];
uniform sampler3D uOccupancy[MAX_BOXES];
uniform sampler3D uFine[MAX_BOXES];
uniform int uBoxCount;
uniform vec3 uCentrePc[MAX_BOXES];
uniform float uHalfPc[MAX_BOXES];
uniform float uDustRef[MAX_BOXES];
uniform float uDensityRef[MAX_BOXES];
uniform vec3 uEmissionHot[MAX_BOXES];
uniform vec3 uEmissionCool[MAX_BOXES];
uniform vec3 uReflection[MAX_BOXES];
uniform float uEmissionCoefficient[MAX_BOXES];
uniform vec3 uFineOffsetPc[MAX_BOXES];
uniform float uFineHalfPc[MAX_BOXES];
uniform float uFineDustRef[MAX_BOXES];
uniform float uFineDensityRef[MAX_BOXES];
uniform float uFineEmissionCoefficient[MAX_BOXES];
uniform vec3 uScatterSourcePc[MAX_BOXES];
uniform float uScatterLum[MAX_BOXES];
uniform float uScatterFloorPc2[MAX_BOXES];
uniform float uDetailAmp[MAX_BOXES];
uniform float uDetailFreq[MAX_BOXES];
uniform int uSteps[MAX_BOXES];
uniform vec3 uCamPc;
uniform mat3 uWorldToGalaxy;
uniform float uOpacity;
uniform sampler3D uDetailNoise;
uniform sampler2D uScatterTable;
${TRANSFER_GLSL}

/** The multiple-scattering table: what a voxel at optical depth tau
 *  from its source sends toward a viewer at scattering-angle cosine
 *  already folded into the y coordinate — every order of scattering,
 *  solved once (universe/galaxy/dustScattering). */
float scatterM(float tau, float muCoord) {
  float u = log(1.0 + min(tau, ${f(SCATTER_TABLE_TAU_MAX)})) *
    ${f(1 / Math.log1p(SCATTER_TABLE_TAU_MAX))};
  return texture(uScatterTable,
    vec2(u * ${f((SCATTER_TABLE_TAUS - 1) / SCATTER_TABLE_TAUS)} + ${f(0.5 / SCATTER_TABLE_TAUS)},
      muCoord)).r;
}

/** Interleaved gradient noise: one cheap dither per pixel, so the
 *  march's step boundaries never line up into shells. */
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

/**
 * The grid softened below its own cells. A cell of a cloud-sized box
 * spans degrees of sky from within, and every cell-aligned feature —
 * the trilinear mush, the baked shadow's banding — reads as blocks.
 * Noise painted over blocks is still blocks, so the treatment is a
 * domain warp instead: the sample position is bent by smooth tiling
 * noise a couple of cells in wavelength and well under a cell in
 * reach, world-anchored in the box's own frame, so straight grid
 * edges go organic without inventing brightness that is not in the
 * data. A single gentle octave of the same noise adds texture at an
 * amplitude a continued cascade could actually carry.
 */
/** One fetch of the tile serves the whole sub-cell treatment: the
 *  colour channels are the noise at three offsets — the warp's three
 *  components — and the alpha is the noise at twice the frequency, the
 *  octave of texture the warp's own frequency is too smooth to carry. */
vec4 detailNoise(vec3 p, float freq) {
  return texture(uDetailNoise, p * (freq * ${f(0.5 / CLUMP_TILE_PERIOD)})) *
    ${f(2 * CLUMP_TILE_RANGE)} - ${f(CLUMP_TILE_RANGE)};
}

// A sampler array takes only a constant index: each box's grids are
// reached through its own branch.
vec4 volumeAt(int b, vec3 uvw) {
  if (b == 0) return texture(uVolume[0], uvw);
  if (b == 1) return texture(uVolume[1], uvw);
  return texture(uVolume[2], uvw);
}
vec4 fineAt(int b, vec3 uvw) {
  if (b == 0) return texture(uFine[0], uvw);
  if (b == 1) return texture(uFine[1], uvw);
  return texture(uFine[2], uvw);
}
float occupancyAt(int b, vec3 uvw) {
  if (b == 0) return texture(uOccupancy[0], uvw).r;
  if (b == 1) return texture(uOccupancy[1], uvw).r;
  return texture(uOccupancy[2], uvw).r;
}

/**
 * One sample of one box at a point in its own frame: what the gas
 * there emits and scatters toward the viewer, and its dust. Empty
 * where the grids hold nothing.
 */
void sampleBox(int b, vec3 p, vec3 dir, out vec3 emission, out vec3 scattered, out float dust) {
  emission = vec3(0.0);
  scattered = vec3(0.0);
  dust = 0.0;
  bool detailed = uDetailAmp[b] > 0.001;
  // The warp bends every texture read but never the geometry: flux
  // distances and the ray itself stay honest. Paid for only when
  // the volume is large in frame — the amp is zero otherwise and
  // the fetch is skipped. One displacement serves both grids, so
  // the bubble's cells and the cloud's are bent into one space.
  vec4 noise = detailed ? detailNoise(p, uDetailFreq[b]) : vec4(0.0);
  vec3 shift = detailed ? (uDetailAmp[b] * 0.75 / uDetailFreq[b]) * noise.rgb : vec3(0.0);
  vec4 cell = volumeAt(b, (p + shift) / (2.0 * uHalfPc[b]) + 0.5);
  // The dust byte is a square root, so the thin columns that dim
  // the sky behind a cloud survive the quantization.
  dust = cell.r * cell.r * uDustRef[b];
  float ionized = cell.g * uDensityRef[b];
  float coefficient = uEmissionCoefficient[b];

  // A cloud is a hundred parsecs and the bubble its newborns blow is
  // a few: one grid cannot hold both, and a grid that holds the cloud
  // puts the whole ionized region inside a single cell. So it is
  // baked again at its own scale, and read here wherever the ray
  // passes through it.
  if (uFineHalfPc[b] > 0.0) {
    vec3 q = p - uFineOffsetPc[b];
    if (all(lessThan(abs(q), vec3(uFineHalfPc[b])))) {
      vec4 fine = fineAt(b, (q + shift) / (2.0 * uFineHalfPc[b]) + 0.5);
      dust = fine.r * fine.r * uFineDustRef[b];
      ionized = fine.g * uFineDensityRef[b];
      cell.b = fine.b;
      cell.a = fine.a;
      coefficient = uFineEmissionCoefficient[b];
    }
  }
  if (dust <= 0.0 && ionized <= 0.0) return;
  if (detailed) {
    float detail = max(0.0, 1.0 + uDetailAmp[b] * 0.18 * noise.a);
    dust *= detail;
    ionized *= detail;
  }

  // Recombination lines: optically thin, and going as the square of
  // the density because every emission is an electron meeting a
  // proton. The hue is the line mixture at this cell's hardness.
  emission = mix(uEmissionCool[b], uEmissionHot[b], cell.b) * ionized * ionized * coefficient;
  // What the dust scatters of the group's light: the flux arriving
  // from the star it actually comes from, scattered by this cell's
  // dust through every order at once — the table carries the beam's
  // attenuation, the phase, and the diffuse field that seeps around
  // clumps, indexed by the optical depth the bake actually marched
  // (cell.a) and the scattering angle. Per channel, because the
  // opacity that drives it rises to the blue: the reason reflection
  // nebulae are blue at all. The floor keeps the source's own cell
  // finite rather than singular.
  vec3 shine = p - uScatterSourcePc[b];
  float r2 = max(dot(shine, shine), uScatterFloorPc2[b]);
  float mu = -dot(shine, dir) * inversesqrt(r2);
  float muCoord = (clamp(mu, -1.0, 1.0) * 0.5 + 0.5) *
    ${f((SCATTER_TABLE_MUS - 1) / SCATTER_TABLE_MUS)} + ${f(0.5 / SCATTER_TABLE_MUS)};
  float tau = -log(max(cell.a, 0.0038));
  vec3 m = vec3(
    scatterM(tau * ${f(SCATTER_OPACITY_RGB[0])}, muCoord),
    scatterM(tau, muCoord),
    scatterM(tau * ${f(SCATTER_OPACITY_RGB[2])}, muCoord));
  scattered = uReflection[b] *
    vec3(${f(SCATTER_OPACITY_RGB[0])} * m.r, m.g, ${f(SCATTER_OPACITY_RGB[2])} * m.b) *
    (uScatterLum[b] * uContinuumShare * dust / r2);
}

void main() {
  vec3 dir = normalize(uWorldToGalaxy * vRay);
  vec3 inv = 1.0 / dir;
  // Everything below is in parsecs. Each box is met analytically in
  // its own frame and marched at its own pitch — its own step count,
  // its own empty blocks leapt — and the ray services whichever box's
  // next sample comes first, so gas in one box that lies before or
  // behind another's along the ray takes its true place in the
  // integral. With one box this is exactly the single march.
  vec3 rel[MAX_BOXES];
  float tFar[MAX_BOXES];
  float dsOf[MAX_BOXES];
  float tSample[MAX_BOXES];
  float jitter = dither(gl_FragCoord.xy);
  bool any = false;
  for (int b = 0; b < MAX_BOXES; b++) {
    tSample[b] = 1e30;
    tFar[b] = -1.0;
    dsOf[b] = 1.0;
    rel[b] = vec3(0.0);
    if (b >= uBoxCount) continue;
    rel[b] = uCamPc - uCentrePc[b];
    vec3 a = (vec3(-uHalfPc[b]) - rel[b]) * inv;
    vec3 c = (vec3(uHalfPc[b]) - rel[b]) * inv;
    vec3 lo = min(a, c);
    vec3 hi = max(a, c);
    float near = max(max(lo.x, lo.y), max(lo.z, 0.0));
    float far = min(min(hi.x, hi.y), hi.z);
    if (far <= near) continue;
    tFar[b] = far;
    dsOf[b] = (far - near) / float(uSteps[b]);
    tSample[b] = near + jitter * dsOf[b];
    any = true;
  }
  if (!any) discard;

  vec3 light = vec3(0.0);
  // Per-channel: dust takes more blue than red out of everything the
  // march accumulates, so the nebula's own deep light reddens exactly
  // as transmitted starlight does. Green rides the V curve and is the
  // scalar the cover and the early-out read.
  vec3 transmittance = vec3(1.0);
  for (int i = 0; i < ${MAX_ITERATIONS}; i++) {
    float t = min(tSample[0], min(tSample[1], tSample[2]));
    if (t >= 1e29) break;
    for (int b = 0; b < MAX_BOXES; b++) {
      if (tSample[b] > t) continue;
      if (t >= tFar[b]) {
        tSample[b] = 1e30;
        continue;
      }
      vec3 p = rel[b] + dir * t;
      // The box is mostly void. An empty block is crossed in one step:
      // the ray runs to the block's far face and samples nothing in it.
      vec3 g = p / (2.0 * uHalfPc[b]) + 0.5;
      if (occupancyAt(b, g) < 0.5) {
        vec3 blocks = g * ${OCCUPANCY_SIZE}.0;
        vec3 face = (floor(blocks) + step(vec3(0.0), dir)) * ${f(1 / OCCUPANCY_SIZE)};
        vec3 tFace = ((face - 0.5) * 2.0 * uHalfPc[b] - rel[b]) * inv;
        // A face already behind the ray — a zero direction component,
        // or the point sitting on the face — cannot be the exit.
        tFace = mix(tFace, vec3(tFar[b]), lessThan(tFace, vec3(t)));
        // Resume past the face at this pixel's own jitter, as the march
        // began: every ray resuming at the same offset from a face would
        // line its samples up into slabs at every block boundary.
        tSample[b] = min(tFace.x, min(tFace.y, tFace.z)) + (0.05 + jitter) * dsOf[b];
        continue;
      }
      vec3 emission;
      vec3 scattered;
      float dust;
      sampleBox(b, p, dir, emission, scattered, dust);
      float extinction = dust * ${DUST_OPACITY_PER_PC.toFixed(4)};
      light += transmittance * (emission + scattered) * dsOf[b];
      transmittance *= exp(-extinction * dsOf[b] *
        vec3(${f(SCATTER_OPACITY_RGB[0])}, 1.0, ${f(SCATTER_OPACITY_RGB[2])}));
      tSample[b] += dsOf[b];
    }
    // The march may stop once even the display-space transmittance —
    // the physical one raised to the law's exponent — is invisible.
    if (transmittance.g < 2e-7) {
      transmittance = vec3(0.0);
      break;
    }
  }

  // The march integrated physical radiance, L☉ pc⁻² sr⁻¹. What the
  // pixel shows for it is the sky's shared photometric law: the
  // marginal display energy above the sky's subtracted pedestal,
  // compressed on luminance so the line mixture keeps its hue — a
  // skirt far below the smooth sky vanishes into it instead of being
  // stretched into fog. The backdrop it covers holds display energies
  // already, so its dimming rides the law's point form, transmittance
  // to the gamma.
  float lum = dot(light, vec3(0.2126, 0.7152, 0.0722));
  float shown = displayRadiance(lum);
  vec3 display = lum > 1e-9 ? scotopic(light * (shown / lum), lum) : vec3(0.0);
  float cover = 1.0 - pow(transmittance.g, uGamma);

  // Premultiplied: what the nebula shows, over what it lets past.
  fragColor = vec4(display * uOpacity, cover * uOpacity);
}
`;

/** What one box hands its carrier: the grids and the numbers the
 *  march reads them by, in the box's own frame. */
export interface NebulaBox {
  volume: Data3DTexture;
  fine: Data3DTexture;
  occupancy: Data3DTexture;
  centrePc: Vector3;
  halfPc: number;
  dustRef: number;
  densityRef: number;
  emissionHot: Vector3;
  emissionCool: Vector3;
  reflection: Vector3;
  emissionCoefficient: number;
  fineOffsetPc: Vector3;
  fineHalfPc: number;
  fineDustRef: number;
  fineDensityRef: number;
  fineEmissionCoefficient: number;
  scatterSourcePc: Vector3;
  scatterLum: number;
  scatterFloorPc2: number;
  detailFreq: number;
  /** Per frame: sub-cell detail bought by apparent size, and the
   *  march's step count with it. */
  detailAmp: number;
  steps: number;
}

/**
 * A carrier: the dome that marches one to MAX_BOXES boxes per pixel.
 *
 * The bake did the physics; this integrates it along the view ray —
 * emission accumulating linearly because the lines are optically thin,
 * dust taking its toll on everything behind it. The carrier is a dome
 * around the camera rather than a mesh at the nebula's place: the
 * camera's far plane is tens of parsecs and the nebula is hundreds
 * out, so a box at its true position would be clipped away. The ray
 * meets each box analytically instead, in parsecs, where the numbers
 * are small and honest. Every volume carries its own; the viewer
 * hands one more the boxes the camera stands inside, so their gas
 * interleaves along the ray instead of compositing whole.
 */
export class NebulaCarrier {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly sceneToGalaxy: Matrix3;
  private readonly empty = emptyVolume();
  private readonly emptyOccupancy = emptyOccupancy();

  constructor(
    private readonly viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
    private skyFloorRadiance = SKY_PEDESTAL_LSUN_PC2_SR,
  ) {
    const m = sceneFromGalaxy;
    this.sceneToGalaxy = new Matrix3().set(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);
    const slots = <T>(make: () => T): T[] => Array.from({ length: MAX_BOXES }, make);
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: NEBULA_FRAGMENT,
      uniforms: {
        uVolume: { value: slots(() => this.empty) },
        uOccupancy: { value: slots(() => this.emptyOccupancy) },
        uFine: { value: slots(() => this.empty) },
        uBoxCount: { value: 0 },
        uCentrePc: { value: slots(() => new Vector3()) },
        uHalfPc: { value: slots(() => 1) },
        uDustRef: { value: slots(() => 0) },
        uDensityRef: { value: slots(() => 0) },
        uEmissionHot: { value: slots(() => new Vector3()) },
        uEmissionCool: { value: slots(() => new Vector3()) },
        uReflection: { value: slots(() => new Vector3()) },
        uEmissionCoefficient: { value: slots(() => 0) },
        uFineOffsetPc: { value: slots(() => new Vector3()) },
        uFineHalfPc: { value: slots(() => 0) },
        uFineDustRef: { value: slots(() => 1) },
        uFineDensityRef: { value: slots(() => 1) },
        uFineEmissionCoefficient: { value: slots(() => 0) },
        uScatterSourcePc: { value: slots(() => new Vector3()) },
        uScatterLum: { value: slots(() => 0) },
        uScatterFloorPc2: { value: slots(() => 1) },
        uDetailAmp: { value: slots(() => 0) },
        uDetailFreq: { value: slots(() => 1) },
        uSteps: { value: slots(() => BASE_STEPS) },
        uCamPc: { value: new Vector3() },
        uWorldToGalaxy: { value: new Matrix3() },
        uOpacity: { value: 1 },
        // The galaxy's tiling clump field, reused as the sub-cell
        // texture: zeros until its worker bake lands, which reads as
        // detail 1 — the plain grid, nothing false.
        uDetailNoise: { value: galaxyLutTextures().clumpTile },
        uScatterTable: { value: scatterTableTexture() },
        ...transferUniforms(skyFloorRadiance),
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

  /** The boxes this carrier marches, in slot order. */
  assign(boxes: readonly NebulaBox[]): void {
    const u = this.material.uniforms;
    u.uBoxCount.value = Math.min(MAX_BOXES, boxes.length);
    for (let b = 0; b < MAX_BOXES; b++) {
      const box = boxes[b];
      (u.uVolume.value as Data3DTexture[])[b] = box?.volume ?? this.empty;
      (u.uFine.value as Data3DTexture[])[b] = box?.fine ?? this.empty;
      (u.uOccupancy.value as Data3DTexture[])[b] = box?.occupancy ?? this.emptyOccupancy;
      if (!box) continue;
      (u.uCentrePc.value as Vector3[])[b].copy(box.centrePc);
      (u.uHalfPc.value as number[])[b] = box.halfPc;
      (u.uDustRef.value as number[])[b] = box.dustRef;
      (u.uDensityRef.value as number[])[b] = box.densityRef;
      (u.uEmissionHot.value as Vector3[])[b].copy(box.emissionHot);
      (u.uEmissionCool.value as Vector3[])[b].copy(box.emissionCool);
      (u.uReflection.value as Vector3[])[b].copy(box.reflection);
      (u.uEmissionCoefficient.value as number[])[b] = box.emissionCoefficient;
      (u.uFineOffsetPc.value as Vector3[])[b].copy(box.fineOffsetPc);
      (u.uFineHalfPc.value as number[])[b] = box.fineHalfPc;
      (u.uFineDustRef.value as number[])[b] = box.fineDustRef;
      (u.uFineDensityRef.value as number[])[b] = box.fineDensityRef;
      (u.uFineEmissionCoefficient.value as number[])[b] = box.fineEmissionCoefficient;
      (u.uScatterSourcePc.value as Vector3[])[b].copy(box.scatterSourcePc);
      (u.uScatterLum.value as number[])[b] = box.scatterLum;
      (u.uScatterFloorPc2.value as number[])[b] = box.scatterFloorPc2;
      (u.uDetailAmp.value as number[])[b] = box.detailAmp;
      (u.uDetailFreq.value as number[])[b] = box.detailFreq;
      (u.uSteps.value as number[])[b] = box.steps;
    }
  }

  /** Seat an instrument: the shared transfer over the sky's pedestal —
   *  the measured floor once the sky has one, which a carrier stood up
   *  before then takes here. The line palette rides on the boxes. */
  setInstrument(instrument: DisplayInstrument, exposure: number, pedestalRadiance = this.skyFloorRadiance): void {
    this.skyFloorRadiance = pedestalRadiance;
    seatExtendedInstrument(this.material.uniforms, pedestalRadiance, instrument, exposure);
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
    this.mesh.visible = value > 0.002;
  }

  /** Where the camera stands, in the galaxy's own frame — measured
   *  from where the viewpoint stands in the world, since the focus can
   *  carry the scene's origin away from it; the dome rides the camera. */
  update(
    cameraWorldKm: Vector3,
    viewpointWorldKm: Vector3,
    worldToScene: Matrix3,
    pcKm: number,
    domeRadiusKm: number,
  ): Vector3 {
    const worldToGalaxy = this.material.uniforms.uWorldToGalaxy.value as Matrix3;
    worldToGalaxy.multiplyMatrices(this.sceneToGalaxy, worldToScene);
    const cam = this.material.uniforms.uCamPc.value as Vector3;
    cam.copy(cameraWorldKm).sub(viewpointWorldKm).applyMatrix3(worldToGalaxy).divideScalar(pcKm);
    cam.set(
      cam.x + this.viewpointPc.xPc,
      cam.y + this.viewpointPc.yPc,
      cam.z + this.viewpointPc.zPc,
    );
    this.mesh.position.copy(cameraWorldKm);
    this.mesh.scale.setScalar(domeRadiusKm);
    return cam;
  }

  get worldToGalaxy(): Matrix3 {
    return this.material.uniforms.uWorldToGalaxy.value as Matrix3;
  }

  get camPc(): Vector3 {
    return this.material.uniforms.uCamPc.value as Vector3;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.empty.dispose();
    this.emptyOccupancy.dispose();
  }
}

/** One nebula as a volume: its baked grids, the box the march reads
 *  them by, and a carrier of its own. */
export class NebulaVolume {
  readonly seed: bigint;
  /** How far the camera stood from the box centre at the last update,
   *  pc — what residency ordering and the star march choose by. */
  cameraDistancePc = Infinity;
  /** Whether the camera stood inside the box at the last update. */
  enclosing = false;
  readonly box: NebulaBox;
  private readonly carrier: NebulaCarrier;
  private readonly texture: Data3DTexture;
  private readonly fineTexture: Data3DTexture;
  private readonly occupancyTexture: Data3DTexture;
  private readonly cameraToGalaxy = new Matrix3();

  constructor(
    bake: NebulaVolumeBake,
    fine: NebulaVolumeBake | null,
    viewpointPc: GalacticPosition,
    sceneFromGalaxy: Float32Array,
    skyFloorRadiance = SKY_PEDESTAL_LSUN_PC2_SR,
  ) {
    this.palettes = {
      line: [bake.emissionHot, bake.emissionCool],
      narrowband: [bake.emissionHotNarrow, bake.emissionCoolNarrow],
    };
    this.seed = bake.seed;
    this.hasFine = fine !== null;
    this.bakedSize = bake.size;

    this.fineTexture = fine ? volumeTexture(fine) : emptyVolume();
    this.occupancyTexture = occupancyTexture(fine ? combinedOccupancy(bake, fine) : bake.occupancy);
    this.texture = volumeTexture(bake);
    this.box = {
      volume: this.texture,
      fine: this.fineTexture,
      occupancy: this.occupancyTexture,
      centrePc: new Vector3(...bake.centrePc),
      halfPc: bake.halfExtentsPc[0],
      dustRef: bake.dustRef,
      densityRef: bake.densityRef,
      emissionHot: new Vector3(...bake.emissionHot),
      emissionCool: new Vector3(...bake.emissionCool),
      reflection: new Vector3(...bake.reflectionColor),
      emissionCoefficient: bake.emissionCoefficient,
      fineOffsetPc: fine
        ? new Vector3(
            fine.centrePc[0] - bake.centrePc[0],
            fine.centrePc[1] - bake.centrePc[1],
            fine.centrePc[2] - bake.centrePc[2],
          )
        : new Vector3(),
      fineHalfPc: fine ? fine.halfExtentsPc[0] : 0,
      fineDustRef: fine?.dustRef ?? 1,
      fineDensityRef: fine?.densityRef ?? 1,
      fineEmissionCoefficient: fine?.emissionCoefficient ?? 0,
      scatterSourcePc: new Vector3(...bake.scatterSourcePc),
      scatterLum: bake.scatterLuminositySolar * SCATTER_EMISSIVITY_PER_LSUN,
      scatterFloorPc2: bake.scatterFloorPc2,
      // First sub-cell octave at half the cell of each grid.
      detailFreq: bake.size / bake.halfExtentsPc[0],
      detailAmp: 0,
      steps: BASE_STEPS,
    };
    this.carrier = new NebulaCarrier(viewpointPc, sceneFromGalaxy, skyFloorRadiance);
    this.carrier.assign([this.box]);
  }

  /** The volume's own dome. */
  get mesh(): Mesh {
    return this.carrier.mesh;
  }

  /** Whether the bubble-scale grid rode in beside the cloud's — what
   *  tells the viewer this volume is complete and its source bakes
   *  need not be held for a reinstall. */
  readonly hasFine: boolean;
  /** Cells per axis of the standing grids — what residency compares
   *  against the resolution the view now deserves. */
  readonly bakedSize: number;
  /** Crossfade against the sprite tier, 0..1 — the viewer ramps it
   *  every frame, and the sprite carries the complement, so a volume
   *  arrives and leaves as a dissolve rather than a swap. */
  fade = 0;
  /** Standing down: fading toward removal — until residency wants the
   *  cloud again, which simply fades it back. */
  retiring = false;
  /** The bake's emission endpoints under each palette, so a mode
   *  switch is a uniform swap. */
  private readonly palettes: Record<
    'line' | 'narrowband',
    [readonly number[], readonly number[]]
  >;

  /** Seat an instrument on the volume's own carrier and take the line
   *  palette the mode asks for onto the box. */
  setInstrument(
    instrument: DisplayInstrument,
    exposure: number,
    pedestalRadiance?: number,
  ): void {
    this.carrier.setInstrument(instrument, exposure, pedestalRadiance);
    const [hot, cool] = this.palettes[instrument.palette];
    this.box.emissionHot.set(hot[0], hot[1], hot[2]);
    this.box.emissionCool.set(cool[0], cool[1], cool[2]);
  }

  set opacity(value: number) {
    this.carrier.opacity = value;
  }

  /** Per-frame: where the camera stands, in the galaxy's own frame. */
  update(
    cameraWorldKm: Vector3,
    viewpointWorldKm: Vector3,
    worldToScene: Matrix3,
    pcKm: number,
    domeRadiusKm: number,
  ): void {
    const cam = this.carrier.update(cameraWorldKm, viewpointWorldKm, worldToScene, pcKm, domeRadiusKm);
    this.cameraDistancePc = cam.distanceTo(this.box.centrePc);
    const half = this.box.halfPc;
    this.enclosing =
      Math.abs(cam.x - this.box.centrePc.x) < half &&
      Math.abs(cam.y - this.box.centrePc.y) < half &&
      Math.abs(cam.z - this.box.centrePc.z) < half;
    // Sub-cell detail is bought by apparent size: a volume filling the
    // sky shows its cells as degrees of mush and pays for the octaves
    // and the deeper march; one standing small in frame renders its
    // grid as-is at the base step count.
    const apparent = half / Math.max(1e-3, this.cameraDistancePc);
    const gate = Math.min(1, Math.max(0, (apparent - 0.35) / 0.85));
    const eased = gate * gate * (3 - 2 * gate);
    this.box.detailAmp = eased;
    this.box.steps = BASE_STEPS + Math.round((MAX_STEPS - BASE_STEPS) * eased);
    this.carrier.assign([this.box]);
  }

  /** What the star field needs to dim itself through this cloud. */
  extinctionFor(cameraRotation: Matrix3): StarNebulaExtinction {
    return {
      volume: this.texture,
      halfPc: this.box.halfPc,
      centrePc: this.box.centrePc,
      camPc: this.carrier.camPc,
      cameraToGalaxy: this.cameraToGalaxy.multiplyMatrices(
        this.carrier.worldToGalaxy,
        cameraRotation,
      ),
      dustRef: this.box.dustRef,
    };
  }

  dispose(): void {
    this.carrier.dispose();
    this.texture.dispose();
    this.fineTexture.dispose();
    this.occupancyTexture.dispose();
  }
}

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

function occupancyTexture(occupancy: Uint8Array): Data3DTexture {
  const texture = new Data3DTexture(occupancy, OCCUPANCY_SIZE, OCCUPANCY_SIZE, OCCUPANCY_SIZE);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.wrapR = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** A one-cell empty grid: what an absent fine grid samples as. */
function emptyVolume(): Data3DTexture {
  const texture = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.needsUpdate = true;
  return texture;
}

/** A one-block empty occupancy: an unassigned slot is never entered. */
function emptyOccupancy(): Data3DTexture {
  const texture = new Data3DTexture(new Uint8Array(1), 1, 1, 1);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
