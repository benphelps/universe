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
vec3 warped(vec3 p, float freq) {
  vec3 c = p * (freq * ${f(0.5 / CLUMP_TILE_PERIOD)});
  vec3 n = vec3(
    texture(uDetailNoise, c).r,
    texture(uDetailNoise, c + 0.31).r,
    texture(uDetailNoise, c + 0.67).r
  ) * ${f(2 * CLUMP_TILE_RANGE)} - ${f(CLUMP_TILE_RANGE)};
  return p + (uDetailAmp * 0.75 / freq) * n;
}

float subCellDetail(vec3 p, float freq) {
  float n1 = texture(uDetailNoise, p * (freq * ${f(1 / CLUMP_TILE_PERIOD)}) + 0.13).r *
    ${f(2 * CLUMP_TILE_RANGE)} - ${f(CLUMP_TILE_RANGE)};
  return max(0.0, 1.0 + uDetailAmp * 0.18 * n1);
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
  // Per-channel: dust takes more blue than red out of everything the
  // march accumulates, so the nebula's own deep light reddens exactly
  // as transmitted starlight does. Green rides the V curve and is the
  // scalar the cover and the early-out read.
  vec3 transmittance = vec3(1.0);
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (i >= uSteps) break;
    vec3 p = rel + dir * (near + (float(i) + jitter) * ds);
    // The warp bends every texture read but never the geometry: flux
    // distances and the ray itself stay honest. Paid for only when
    // the volume is large in frame — the amp is zero otherwise and
    // the fetches are skipped.
    bool detailed = uDetailAmp > 0.001;
    vec3 ps = detailed ? warped(p, uDetailFreq) : p;
    vec4 cell = texture(uVolume, ps / (2.0 * uHalfPc) + 0.5);
    float dust = cell.r * uDustRef;
    float ionized = cell.g * uDensityRef;
    float coefficient = uEmissionCoefficient;

    // A cloud is a hundred parsecs and the bubble its newborns blow is
    // a few: one grid cannot hold both, and a grid that holds the cloud
    // puts the whole ionized region inside a single cell. So it is
    // baked again at its own scale, and read here wherever the ray
    // passes through it.
    if (uFineHalfPc > 0.0) {
      vec3 q = p - uFineOffsetPc;
      if (all(lessThan(abs(q), vec3(uFineHalfPc)))) {
        vec3 qs = detailed ? warped(q, uFineDetailFreq) : q;
        vec4 fine = texture(uFine, qs / (2.0 * uFineHalfPc) + 0.5);
        dust = fine.r * uFineDustRef;
        ionized = fine.g * uFineDensityRef;
        cell.b = fine.b;
        cell.a = fine.a;
        coefficient = uFineEmissionCoefficient;
      }
    }

    if (detailed) {
      float detail = subCellDetail(p, uDetailFreq);
      dust *= detail;
      ionized *= detail;
    }

    // Recombination lines: optically thin, and going as the square of
    // the density because every emission is an electron meeting a
    // proton. The hue is the line mixture at this cell's hardness.
    vec3 emission = mix(uEmissionCool, uEmissionHot, cell.b) * ionized * ionized * coefficient;
    // What the dust scatters of the group's light: the flux arriving
    // from the star it actually comes from, scattered by this cell's
    // dust through every order at once — the table carries the beam's
    // attenuation, the phase, and the diffuse field that seeps around
    // clumps, indexed by the optical depth the bake actually marched
    // (cell.a) and the scattering angle. Per channel, because the
    // opacity that drives it rises to the blue: the reason reflection
    // nebulae are blue at all. The floor keeps the source's own cell
    // finite rather than singular.
    vec3 shine = p - uScatterSourcePc;
    float r2 = max(dot(shine, shine), uScatterFloorPc2);
    float mu = -dot(shine, dir) * inversesqrt(r2);
    float muCoord = (clamp(mu, -1.0, 1.0) * 0.5 + 0.5) *
      ${f((SCATTER_TABLE_MUS - 1) / SCATTER_TABLE_MUS)} + ${f(0.5 / SCATTER_TABLE_MUS)};
    float tau = -log(max(cell.a, 0.0038));
    vec3 m = vec3(
      scatterM(tau * ${f(SCATTER_OPACITY_RGB[0])}, muCoord),
      scatterM(tau, muCoord),
      scatterM(tau * ${f(SCATTER_OPACITY_RGB[2])}, muCoord));
    vec3 scattered = uReflection *
      vec3(${f(SCATTER_OPACITY_RGB[0])} * m.r, m.g, ${f(SCATTER_OPACITY_RGB[2])} * m.b) *
      (uScatterLum * uContinuumShare * dust / r2);

    float extinction = dust * ${DUST_OPACITY_PER_PC.toFixed(4)};
    light += transmittance * (emission + scattered) * ds;
    transmittance *= exp(-extinction * ds *
      vec3(${f(SCATTER_OPACITY_RGB[0])}, 1.0, ${f(SCATTER_OPACITY_RGB[2])}));
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
    private readonly skyFloorRadiance = SKY_PEDESTAL_LSUN_PC2_SR,
  ) {
    this.palettes = {
      line: [bake.emissionHot, bake.emissionCool],
      narrowband: [bake.emissionHotNarrow, bake.emissionCoolNarrow],
    };
    this.seed = bake.seed;
    this.hasFine = fine !== null;
    this.bakedSize = bake.size;
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
        uEmissionCoefficient: { value: bake.emissionCoefficient },
        uScatterSourcePc: { value: new Vector3(...bake.scatterSourcePc) },
        uScatterLum: {
          value: bake.scatterLuminositySolar * SCATTER_EMISSIVITY_PER_LSUN,
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
        uScatterTable: { value: scatterTableTexture() },
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
        uFineEmissionCoefficient: { value: fine?.emissionCoefficient ?? 0 },
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

  /** Seat an instrument: the shared transfer over this sky's pedestal,
   *  and the line palette the mode asks for. */
  setInstrument(instrument: DisplayInstrument, exposure: number): void {
    seatExtendedInstrument(this.material.uniforms, this.skyFloorRadiance, instrument, exposure);
    const [hot, cool] = this.palettes[instrument.palette];
    (this.material.uniforms.uEmissionHot.value as Vector3).set(hot[0], hot[1], hot[2]);
    (this.material.uniforms.uEmissionCool.value as Vector3).set(cool[0], cool[1], cool[2]);
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

