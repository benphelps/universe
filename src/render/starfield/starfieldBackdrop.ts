import { GLOBAL_STAR_DUST_GLSL } from '../glsl/globalStarDust';
import { starGlobalDustUniforms, installStarDustCamera } from './globalDustState';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { installPointRaster, pointRasterVertex, pointRasterFragment } from './pointSpread';
import { SCATTER_OPACITY_RGB } from '../../universe/galaxy/dustScattering';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  Group,
  LinearFilter,
  Matrix3,
  Mesh,
  NearestFilter,
  Points,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { rotateToScene } from '../../universe/galaxy/orientation';
import type { DisplayInstrument } from '../../universe/galaxy/displayLaw';
import {
  pointUniforms,
  seatExtendedInstrument,
  seatPointInstrument,
  TRANSFER_GLSL,
  transferUniforms,
} from '../displayTransfer';
import {
  DARK_ATLAS_COLS,
  DARK_ATLAS_ROWS,
  DARK_TILE,
  NEBULA_ATLAS_COLS,
  NEBULA_ATLAS_ROWS,
  NEBULA_TILE,
  RIFT_HEIGHT,
  RIFT_WIDTH,
  type DarkCloudPatch,
  type NebulaPatch,
  type SkyPortraitUpdate,
  applySkyPortrait,
} from '../../universe/galaxy/skyfield';
import { AIR_VIEW_GLSL, airViewUniforms, applyAirView, type AirView } from '../lighting/airView';
import {
  SKY_EXTENDED_VISIBILITY_FLOOR,
  SKY_POINT_VISIBILITY_FLOOR,
} from '../fx/skyLayer';
import { DirectionalPatches } from './directionalPatches';

const MAX_NEBULAE = NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS;
const MAX_DARK = DARK_ATLAS_COLS * DARK_ATLAS_ROWS;

/** Per-sprite data rides in a small float texture, one row per
 *  sprite, rather than seven uniform arrays: at forty-eight sprites
 *  those ran past the uniform budget some GPUs guarantee a fragment
 *  shader. The columns, RGBA each. */
const SPRITE_DIR = 0; // dir.xyz, tangent half-extent
const SPRITE_RIGHT = 1; // right.xyz, peak radiance
const SPRITE_UP = 2; // up.xyz, tile index
const SPRITE_HUE_LINE = 3;
const SPRITE_HUE_NARROW = 4;
const SPRITE_HUE_SCATTER = 5;
const SPRITE_FADE = 6; // x: the crossfade against the standing volume
const SPRITE_COLUMNS = 8;

const NEBULA_FRAGMENT = /* glsl */ `
varying vec3 vDir;
varying vec3 vAirDir;

uniform sampler2D uNebulaAtlas;
uniform sampler2D uSprites;
uniform int uNebulaCount;
uniform float uIntensity;
uniform float uNarrowband;
${TRANSFER_GLSL}
${AIR_VIEW_GLSL}

vec4 sprite(int i, int column) {
  return texture2D(uSprites, vec2(
    (float(column) + 0.5) / ${SPRITE_COLUMNS}.0,
    (float(i) + 0.5) / ${MAX_NEBULAE}.0));
}

void main() {
  vec3 dir = normalize(vDir);
  // Overlapping sprites add their radiance before the law, not their
  // display energies after it: the pedestal's compression is paid
  // once for the light in this direction, whatever it is made of. The
  // crossfade against each standing volume stays a share of what is
  // shown, as the volume's own fade is.
  float radiance = 0.0;
  float shownShare = 0.0;
  vec3 tint = vec3(0.0);
  for (int i = 0; i < ${MAX_NEBULAE}; i++) {
    if (i >= uNebulaCount) break;
    vec4 a = sprite(i, ${SPRITE_DIR});
    float cosD = dot(dir, a.xyz);
    if (cosD < 0.2) continue;
    // Project onto the sprite's tangent plane (matches the ray-march).
    vec3 rel = dir / cosD - a.xyz;
    vec4 b = sprite(i, ${SPRITE_RIGHT});
    vec4 c = sprite(i, ${SPRITE_UP});
    float u = dot(rel, b.xyz) / a.w * 0.5 + 0.5;
    float v = dot(rel, c.xyz) / a.w * 0.5 + 0.5;
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) continue;
    float tile = c.w;
    vec2 tileOrigin = vec2(mod(tile, ${NEBULA_ATLAS_COLS}.0), floor(tile / ${NEBULA_ATLAS_COLS}.0));
    vec2 uv = (tileOrigin + vec2(u, v)) / vec2(${NEBULA_ATLAS_COLS}.0, ${NEBULA_ATLAS_ROWS}.0);
    // The tile carries physics — relative luminance and the local
    // line-vs-continuum mix — and here it meets the instrument: the
    // calibrated peak radiance, the law, the hue pair, what share of
    // continuum the filters pass, and the crossfade against the
    // standing volume, all uniforms.
    vec2 cell = texture2D(uNebulaAtlas, uv).rg;
    float pass = mix(uContinuumShare, 1.0, cell.g);
    float here = cell.r * b.w * pass;
    float lineShare = cell.g / max(pass, 1e-6);
    vec3 hue = mix(sprite(i, ${SPRITE_HUE_SCATTER}).xyz,
      mix(sprite(i, ${SPRITE_HUE_LINE}).xyz, sprite(i, ${SPRITE_HUE_NARROW}).xyz, uNarrowband),
      lineShare);
    float fade = sprite(i, ${SPRITE_FADE}).x;
    radiance += here;
    shownShare += here * fade;
    tint += hue * here * fade;
  }
  vec3 shown = shownShare > 0.0
    ? scotopic(tint / shownShare, radiance) * displayRadiance(radiance) * (shownShare / radiance)
    : vec3(0.0);
  gl_FragColor = vec4(shown * uIntensity * skyVisibility(vAirDir) * airTransmittance(vAirDir), 1.0);
}
`;

const POINTS_VERTEX = /* glsl */ `
attribute vec3 starColor;
attribute float brightness;

uniform float uIntensity;
uniform float uGamma;
uniform float uGain;
uniform float uFloor;
uniform float uCeil;
uniform float uLogPivot;
uniform float uCutoff;
uniform float uPointColorKnee;

${GLOBAL_STAR_DUST_GLSL}
uniform mat3 uStarCameraToGalaxy;
attribute float starDistance;
${AIR_VIEW_GLSL}

varying vec3 vColor;
${pointRasterVertex()}

void main() {
  // The sky's shared photometric law (universe/galaxy/displayLaw):
  // energy follows log irradiance, with an instrument-specific faint
  // release and detection threshold. A normalized angular PSF carries
  // that response without adding energy through its raster area.
  vec3 skyDir = normalize(mat3(modelMatrix) * position);
  vec3 galDir = normalize(uStarCameraToGalaxy * mat3(modelViewMatrix) * position);
  float tau = starGlobalOpticalDepth(uStarDustObserverPc,galDir*starDistance);
  vec3 transmitted = starColor * brightness * exp(-tau*vec3(${SCATTER_OPACITY_RGB.join(',')})) * airTransmittance(skyDir);
  float irradiance=dot(transmitted,vec3(.2126,.7152,.0722));
  vec3 sourceColor=irradiance>0.0?transmitted/irradiance:vec3(0.0);
  float logE = log2(max(irradiance, 1e-30)) - uLogPivot;
  float raw = uGain * exp2(uGamma * logE);
  // The same release from the floor the 3D star tiers take: a decade
  // below the floor's own brightness a point fades, two below it is
  // gone rather than held.
  float held = uFloor > 0.0
    ? smoothstep(-6.64, -3.32, log2(max(raw, 1e-12) / uFloor) / uGamma)
    : 1.0;
  float energy = max(raw, uFloor) * held;
  // An instrument with a real limit: points below it vanish outright
  // (half a magnitude of softness so the sky never pops), and colour
  // drains from the faint ones the way it does at the eyepiece.
  if (uCutoff > 0.0) energy *= smoothstep(uCutoff * 0.6, uCutoff * 1.6, irradiance);
  float sat = uPointColorKnee > 0.0 ? clamp(energy / uPointColorKnee, 0.0, 1.0) : 1.0;
  vec3 hue = mix(
    vec3(dot(sourceColor, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.86, 1.02, 1.07),
    sourceColor, sat);
  // The backdrop rides the eye, so a point's world direction is its
  // position turned by the group.
  vColor = hue * energy * uIntensity * skyVisibility(skyDir) * uPointScale * uPointScale;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  seatPointRaster(gl_Position);
  // This sphere supplies direction only. Put unresolved starlight at the
  // reversed-Z far floor so every real body occludes it by depth, even if
  // a later material or render-queue change reorders the draw calls.
  gl_Position.z = 1e-24 * gl_Position.w;
  if (held <= 0.0) gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
}
`;

const POINTS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
${pointRasterFragment()}

void main() {
  gl_FragColor = vec4(vColor * pointPixelWeight(), 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vAirDir;

void main() {
  vDir = normalize(position);
  vAirDir = normalize(mat3(modelMatrix) * position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // The dome is angular data, not a foreground shell. Pin it just inside
  // the reversed-Z far plane so planets and terrain always win the depth
  // test instead of relying solely on negative renderOrder.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vDir;
varying vec3 vAirDir;

uniform mat3 uSceneToGalaxy;
uniform sampler2D uGlow;
uniform vec2 uGlowSize;
uniform sampler2D uRift;
uniform sampler2D uDarkAtlas;
uniform vec4 uDarkA[${MAX_DARK}]; // dir.xyz, tangent half-extent
uniform vec4 uDarkB[${MAX_DARK}]; // right.xyz, tile index
uniform vec4 uDarkC[${MAX_DARK}]; // up.xyz, unused
uniform int uDarkCount;
uniform float uIntensity;
${AIR_VIEW_GLSL}
uniform float uPedestalRadiance;
${TRANSFER_GLSL}

// B-spline weights for one axis of the bicubic fetch.
vec4 cubicWeights(float t) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - t;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}

// Bicubic B-spline via four bilinear taps: the glow map's gradients
// are C1-smooth on screen, so a texel-wide dust lane fades instead of
// creasing — the low-resolution look was bilinear's kinks, not the
// data.
vec4 textureBicubic(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 st = uv * texSize - 0.5;
  vec2 f = fract(st);
  st -= f;
  vec4 wx = cubicWeights(f.x);
  vec4 wy = cubicWeights(f.y);
  vec4 c = st.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(wx.xz + wx.yw, wy.xz + wy.yw);
  vec4 offset = (c + vec4(wx.yw, wy.yw) / s) / texSize.xxyy;
  vec4 sample0 = texture2D(tex, offset.xz);
  vec4 sample1 = texture2D(tex, offset.yz);
  vec4 sample2 = texture2D(tex, offset.xw);
  vec4 sample3 = texture2D(tex, offset.yw);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(sample3, sample2, sx), mix(sample1, sample0, sx), sy);
}

void main() {
  vec3 dir = normalize(vDir);
  // Into the galactic frame (per-system orientation); z is the disk normal.
  vec3 g = uSceneToGalaxy * dir;
  float latitude = asin(clamp(g.z, -1.0, 1.0));
  // The glow and rift maps are written with longitude in [0, 2pi)
  // (skyfield's buildGlow); sample with the same origin, or the whole
  // band lands rotated half a turn in galactic longitude.
  float longitude = atan(g.y, g.x);
  if (longitude < 0.0) longitude += 6.2831853;
  vec2 uv = vec2(longitude / 6.2831853, latitude / 3.14159265 + 0.5);

  // Smooth starlight base, shadowed by the small-cloud map and by each
  // prominent cloud's own ray-marched transmission sprite — projected
  // exactly like the nebula sprites.
  float transmission = textureBicubic(uRift, uv, vec2(${RIFT_WIDTH}.0, ${RIFT_HEIGHT}.0)).r;
  for (int i = 0; i < ${MAX_DARK}; i++) {
    if (i >= uDarkCount) break;
    vec4 a = uDarkA[i];
    float cosD = dot(dir, a.xyz);
    if (cosD < 0.2) continue;
    vec3 rel = dir / cosD - a.xyz;
    float u = dot(rel, uDarkB[i].xyz) / a.w * 0.5 + 0.5;
    float v = dot(rel, uDarkC[i].xyz) / a.w * 0.5 + 0.5;
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) continue;
    float tile = uDarkB[i].w;
    vec2 tileOrigin = vec2(mod(tile, ${DARK_ATLAS_COLS}.0), floor(tile / ${DARK_ATLAS_COLS}.0));
    vec2 tuv = (tileOrigin + vec2(u, v)) / vec2(${DARK_ATLAS_COLS}.0, ${DARK_ATLAS_ROWS}.0);
    transmission *= texture2D(uDarkAtlas, tuv).r;
  }
  // RGB already carries population spectra and diffuse-dust transport.
  // Discrete cloud maps store V-like transmission; use the same RGB
  // opacity ratios as the volume tiers before instrument compression.
  vec3 column = textureBicubic(uGlow, uv, uGlowSize).rgb *
    pow(vec3(max(transmission, 0.0)), vec3(${SCATTER_OPACITY_RGB.join(', ')}));
  float power = dot(column, vec3(0.2126, 0.7152, 0.0722));
  float radiance = (power - uPedestalRadiance) * uContinuumShare;
  vec3 hue = power > 0.0 ? column / power : vec3(0.0);
  gl_FragColor = vec4(scotopic(hue * displayRadiance(radiance), radiance) * uIntensity
    * skyVisibility(vAirDir) * airTransmittance(vAirDir), 1.0);
}
`;

/**
 * The night sky as scene backdrop: the sky field's resolved stars as
 * photometric points plus the Milky Way glow dome, both at a fixed
 * radius around the camera (the viewer re-centers the group each frame).
 * uIntensity lets daylight wash the stars out.
 */
/**
 * What a backdrop reads: the unresolved sky, and whatever stars it is
 * asked to draw itself.
 *
 * Narrower than a SkyField on purpose. The gas, dust and glow do not
 * depend on the star sweep, so they arrive well before it finishes,
 * and a backdrop can be stood up from them alone — which is what it
 * amounts to anyway wherever the caller draws the stars as 3D content
 * and hands this a skipStars of all of them.
 */
export interface BackdropSource {
  nebulae: NebulaPatch[];
  nebulaAtlas: Float32Array;
  darkClouds: DarkCloudPatch[];
  darkAtlas: Float32Array;
  glowWidth: number;
  glowHeight: number;
  glowData: Float32Array;
  skyFloorRadiance: number;
  riftData: Float32Array;
  sceneFromGalaxy: Float32Array;
  starCount: number;
  starDirs: Float32Array;
  starColors: Float32Array;
  starBrightness: Float32Array;
  starDistances?: Float32Array;
  viewpointPc?: GalacticPosition;
}


export class StarfieldBackdrop {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  /** Which cloud each nebula sprite stands for, and the fade uniform
   *  it dissolves through — so a sprite can stand down while the
   *  cloud it stands for is drawn as the volume it really is, and
   *  stand back up when the volume leaves. */
  private nebulaSeeds: bigint[] = [];
  /** The per-sprite table's texels; the fade column is rewritten as
   *  volumes come and go. */
  private spriteTable: Float32Array = new Float32Array();
  private atlasTexture: DataTexture | null = null;
  private readonly portraitSource: Pick<BackdropSource, 'nebulae' | 'nebulaAtlas'>;
  private readonly ownedTextures: DataTexture[] = [];
  private spriteTexture: DataTexture | null = null;
  private spritesDirty = false;
  private volumeFades: ReadonlyMap<bigint, number> = new Map();
  private readonly pedestalRadiance: number;
  private pointsMaterial!: ShaderMaterial;
  private glowMaterial!: ShaderMaterial;
  private nebulaMaterial: ShaderMaterial | null = null;
  private points!: Points;
  private glow!: Mesh;
  private nebulaDome: Mesh | null = null;

  /** skipStars omits the first N sky entries (a 3D view of the near field). */
  constructor(sky: BackdropSource, radius: number, skipStars = 0) {
    this.portraitSource = { nebulae: sky.nebulae, nebulaAtlas: sky.nebulaAtlas };
    this.pedestalRadiance = sky.skyFloorRadiance;
    const orientation = sky.sceneFromGalaxy;
    const count = sky.starCount - skipStars;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s = i + skipStars;
      // Galactic direction into this system's randomly-oriented frame.
      const [x, y, z] = rotateToScene(
        orientation,
        sky.starDirs[s * 3],
        sky.starDirs[s * 3 + 1],
        sky.starDirs[s * 3 + 2],
      );
      positions[i * 3] = x * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = z * radius;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute(
      'starColor',
      new BufferAttribute(sky.starColors.subarray(skipStars * 3), 3),
    );
    geometry.setAttribute(
      'brightness',
      new BufferAttribute(sky.starBrightness.subarray(skipStars), 1),
    );

    geometry.setAttribute('starDistance',new BufferAttribute(sky.starDistances?.subarray(skipStars) ?? new Float32Array(count),1));

    // The whole backdrop draws in the opaque queue (transparent: false)
    // at negative renderOrder and is also pinned to the far-depth floor.
    // Render order makes the sky cheap; depth makes occlusion invariant.
    const pointsMaterial = new ShaderMaterial({
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      uniforms: {
        uIntensity: { value: 1 },
        ...airViewUniforms(),
        ...pointUniforms(),
        ...starGlobalDustUniforms,
        // A held sky keeps its bake observer while its directions rotate
        // into the new scene. Its column must not jump to the next system.
        uStarDustObserverPc:{value:new Vector3(sky.viewpointPc?.xPc ?? 0,sky.viewpointPc?.yPc ?? 0,sky.viewpointPc?.zPc ?? 0)},
      },
      blending: AdditiveBlending,
      transparent: false,
      depthWrite: false,
    });
    installPointRaster(pointsMaterial);
    installStarDustCamera(pointsMaterial);
    this.materials.push(pointsMaterial);
    this.pointsMaterial = pointsMaterial;
    const points = new Points(geometry, pointsMaterial);
    this.points = points;
    points.frustumCulled = false;
    points.renderOrder = -2;
    this.group.add(points);

    const texture = new DataTexture(
      sky.glowData,
      sky.glowWidth,
      sky.glowHeight,
      RGBAFormat,
      FloatType,
    );
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    const riftTexture = new DataTexture(
      sky.riftData,
      RIFT_WIDTH,
      RIFT_HEIGHT,
      RedFormat,
      FloatType,
    );
    riftTexture.minFilter = LinearFilter;
    riftTexture.magFilter = LinearFilter;
    riftTexture.wrapS = RepeatWrapping;
    riftTexture.wrapT = ClampToEdgeWrapping;
    riftTexture.needsUpdate = true;
    const darkTexture = new DataTexture(
      sky.darkAtlas,
      DARK_ATLAS_COLS * DARK_TILE,
      DARK_ATLAS_ROWS * DARK_TILE,
      RedFormat,
      FloatType,
    );
    this.ownedTextures.push(texture, riftTexture, darkTexture);
    darkTexture.minFilter = LinearFilter;
    darkTexture.magFilter = LinearFilter;
    darkTexture.wrapS = ClampToEdgeWrapping;
    darkTexture.wrapT = ClampToEdgeWrapping;
    darkTexture.needsUpdate = true;
    // Galactic vectors into this system's frame, like the stars.
    const toScene = (v: [number, number, number], w: number): Vector4 =>
      new Vector4(...rotateToScene(orientation, v[0], v[1], v[2]), w);
    const darkA = Array.from({ length: MAX_DARK }, (_, i) => {
      const patch = sky.darkClouds[i];
      return patch ? toScene(patch.dir, patch.halfExtent) : new Vector4(0, 1, 0, 1);
    });
    const darkB = Array.from({ length: MAX_DARK }, (_, i) => {
      const patch = sky.darkClouds[i];
      return patch ? toScene(patch.right, patch.tile) : new Vector4(1, 0, 0, 0);
    });
    const darkC = Array.from({ length: MAX_DARK }, (_, i) => {
      const patch = sky.darkClouds[i];
      return patch ? toScene(patch.up, 0) : new Vector4(0, 0, 1, 0);
    });
    const glowMaterial = new ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      uniforms: {
        uSceneToGalaxy: {
          value: new Matrix3().set(
            orientation[0], orientation[3], orientation[6],
            orientation[1], orientation[4], orientation[7],
            orientation[2], orientation[5], orientation[8],
          ),
        },
        uGlow: { value: texture },
        uGlowSize: { value: new Vector2(sky.glowWidth, sky.glowHeight) },
        uRift: { value: riftTexture },
        uDarkAtlas: { value: darkTexture },
        uDarkA: { value: darkA },
        uDarkB: { value: darkB },
        uDarkC: { value: darkC },
        uDarkCount: { value: sky.darkClouds.length },
        uIntensity: { value: 1 },
        ...airViewUniforms(),
        uPedestalRadiance: { value: sky.skyFloorRadiance },
        ...transferUniforms(sky.skyFloorRadiance),
      },
      blending: AdditiveBlending,
      transparent: false,
      depthWrite: false,
      side: BackSide,
    });
    this.materials.push(glowMaterial);
    this.glowMaterial = glowMaterial;
    const dome = new Mesh(new SphereGeometry(radius * 1.01, 48, 24), glowMaterial);
    this.glow = dome;
    dome.frustumCulled = false;
    dome.renderOrder = -3;
    this.group.add(dome);
    const darkSelection = new DirectionalPatches(darkA.slice(0, sky.darkClouds.length));
    let previousDark = sky.darkClouds.map((_, i) => i);
    dome.onBeforeRender = (_renderer, _scene, camera) => {
      const visible = darkSelection.select(camera, dome, radius * 1.01);
      if (visible.length === previousDark.length && visible.every((id, i) => id === previousDark[i])) return;
      previousDark = [...visible];
      glowMaterial.uniforms.uDarkCount.value = visible.length;
      glowMaterial.uniforms.uDarkA.value = visible.map(i => darkA[i]);
      glowMaterial.uniforms.uDarkB.value = visible.map(i => darkB[i]);
      glowMaterial.uniforms.uDarkC.value = visible.map(i => darkC[i]);
      // GLSL uniform arrays retain their declared capacity, including
      // when no patch overlaps the view.
      for (const key of ['uDarkA', 'uDarkB', 'uDarkC']) {
        const array = glowMaterial.uniforms[key].value as Vector4[];
        while (array.length < MAX_DARK) array.push(darkA[0]);
      }
      glowMaterial.uniformsNeedUpdate = true;
    };

    if (sky.nebulae.length > 0) {
      const patches = sky.nebulae.slice(0, MAX_NEBULAE);
      const table = new Float32Array(MAX_NEBULAE * SPRITE_COLUMNS * 4);
      const put = (i: number, column: number, x: number, y: number, z: number, w: number): void => {
        const at = (i * SPRITE_COLUMNS + column) * 4;
        table[at] = x;
        table[at + 1] = y;
        table[at + 2] = z;
        table[at + 3] = w;
      };
      patches.forEach((patch, i) => {
        const dir = toScene(patch.dir, patch.angularRadius * 1.6);
        const right = toScene(patch.right, patch.peakRadiance);
        const up = toScene(patch.up, patch.tile);
        put(i, SPRITE_DIR, dir.x, dir.y, dir.z, dir.w);
        put(i, SPRITE_RIGHT, right.x, right.y, right.z, right.w);
        put(i, SPRITE_UP, up.x, up.y, up.z, up.w);
        put(i, SPRITE_HUE_LINE, ...patch.emissionHue, 0);
        put(i, SPRITE_HUE_NARROW, ...patch.emissionHueNarrow, 0);
        put(i, SPRITE_HUE_SCATTER, ...patch.reflectionHue, 0);
        put(i, SPRITE_FADE, 1, 0, 0, 0);
      });
      const spriteTexture = new DataTexture(
        table,
        SPRITE_COLUMNS,
        MAX_NEBULAE,
        RGBAFormat,
        FloatType,
      );
      spriteTexture.minFilter = NearestFilter;
      spriteTexture.magFilter = NearestFilter;
      spriteTexture.needsUpdate = true;
      this.spriteTable = table;
      this.spriteTexture = spriteTexture;
      const atlas = new DataTexture(
        sky.nebulaAtlas,
        NEBULA_ATLAS_COLS * NEBULA_TILE,
        NEBULA_ATLAS_ROWS * NEBULA_TILE,
        RGBAFormat,
        FloatType,
      );
      this.ownedTextures.push(spriteTexture, atlas);
      this.atlasTexture = atlas;
      atlas.minFilter = LinearFilter;
      atlas.magFilter = LinearFilter;
      atlas.wrapS = ClampToEdgeWrapping;
      atlas.wrapT = ClampToEdgeWrapping;
      atlas.needsUpdate = true;
      const nebulaMaterial = new ShaderMaterial({
        vertexShader: GLOW_VERTEX,
        fragmentShader: NEBULA_FRAGMENT,
        uniforms: {
          uNebulaAtlas: { value: atlas },
          uSprites: { value: spriteTexture },
          uNebulaCount: { value: patches.length },
          uIntensity: { value: 1 },
        ...airViewUniforms(),
          uNarrowband: { value: 0 },
          ...transferUniforms(sky.skyFloorRadiance),
        },
        blending: AdditiveBlending,
        transparent: false,
        depthWrite: false,
        side: BackSide,
      });
      this.materials.push(nebulaMaterial);
      this.nebulaMaterial = nebulaMaterial;
      this.nebulaSeeds = patches.map((patch) => patch.seed);
      this.applyNebulaSuppression();
      const nebulaDome = new Mesh(new SphereGeometry(radius * 1.02, 48, 24), nebulaMaterial);
      this.nebulaDome = nebulaDome;
      nebulaDome.frustumCulled = false;
      nebulaDome.renderOrder = -3;
      this.group.add(nebulaDome);
      const directions = patches.map((_, i) => new Vector4().fromArray(table, i * SPRITE_COLUMNS * 4));
      const selection = new DirectionalPatches(directions);
      // Keep the canonical rows for fades; compact only the draw table.
      const drawTable = new Float32Array(table);
      this.spriteTexture!.image.data = drawTable;
      let previous = patches.map((_, i) => i);
      nebulaDome.onBeforeRender = (_renderer, _scene, camera) => {
        const visible = selection.select(camera, nebulaDome, radius * 1.02);
        if (!this.spritesDirty && visible.length === previous.length && visible.every((id, i) => id === previous[i])) return;
        previous = [...visible];
        this.spritesDirty = false;
        const stride = SPRITE_COLUMNS * 4;
        visible.forEach((id, i) => drawTable.set(table.subarray(id * stride, (id + 1) * stride), i * stride));
        nebulaMaterial.uniforms.uNebulaCount.value = visible.length;
        this.spriteTexture!.needsUpdate = true;
        nebulaMaterial.uniformsNeedUpdate = true;
      };
    }
  }

  /** Upload only the completed tile and its small photometry row. */
  updatePortrait(update: SkyPortraitUpdate): void {
    if (!this.atlasTexture || !applySkyPortrait(this.portraitSource, update)) return;
    const { patch } = update;
    const row = patch.tile * SPRITE_COLUMNS * 4;
    this.spriteTable[row + SPRITE_RIGHT * 4 + 3] = patch.peakRadiance;
    this.spriteTable.set([...patch.emissionHue, 0], row + SPRITE_HUE_LINE * 4);
    this.spriteTable.set([...patch.emissionHueNarrow, 0], row + SPRITE_HUE_NARROW * 4);
    this.spriteTable.set([...patch.reflectionHue, 0], row + SPRITE_HUE_SCATTER * 4);
    const width = NEBULA_ATLAS_COLS * NEBULA_TILE;
    for (let y = 0; y < NEBULA_TILE; y++) {
      const start = ((Math.floor(patch.tile / NEBULA_ATLAS_COLS) * NEBULA_TILE + y) * width + patch.tile % NEBULA_ATLAS_COLS * NEBULA_TILE) * 4;
      this.atlasTexture.addUpdateRange(start, NEBULA_TILE * 4);
    }
    this.atlasTexture.needsUpdate = true;
    this.spritesDirty = true;
  }

  /** How far each cloud's volume is standing, 0..1: the sprite carries
   *  the complement, so the two tiers crossfade instead of swapping.
   *  A cloud absent from the map holds its baked brightness. */
  setNebulaVolumeFades(fades: ReadonlyMap<bigint, number>): void {
    this.volumeFades = fades;
    this.applyNebulaSuppression();
  }

  private applyNebulaSuppression(): void {
    let changed = false;
    for (let i = 0; i < this.nebulaSeeds.length; i++) {
      const fade = 1 - (this.volumeFades.get(this.nebulaSeeds[i]) ?? 0);
      const at = (i * SPRITE_COLUMNS + SPRITE_FADE) * 4;
      if (this.spriteTable[at] !== fade) {
        this.spriteTable[at] = fade;
        changed = true;
      }
    }
    if (changed) this.spritesDirty = true;
  }

  /** Seat an instrument on every tier of the backdrop — points, glow,
   *  sprites — over this sky's own measured pedestal. */
  setInstrument(instrument: DisplayInstrument, exposure: number): void {
    seatPointInstrument(this.pointsMaterial.uniforms, instrument, exposure);
    seatExtendedInstrument(this.glowMaterial.uniforms, this.pedestalRadiance, instrument, exposure);
    if (this.nebulaMaterial) {
      seatExtendedInstrument(
        this.nebulaMaterial.uniforms,
        this.pedestalRadiance,
        instrument,
        exposure,
      );
      this.nebulaMaterial.uniforms.uNarrowband.value = instrument.palette === 'narrowband' ? 1 : 0;
    }
  }

  /** The air between the eye and the whole sky, on every tier. */
  setAirView(air: AirView | null): void {
    for (const material of this.materials) applyAirView(material, air);
  }

  /** Set one visibility for all tiers, retained for instruments and tests. */
  set intensity(value: number) {
    this.setVisibility(value, value);
  }

  /**
   * Seat high-contrast points and low-contrast extended light against
   * daylight independently. Stars become detectable before the smooth
   * Milky Way and nebular background, as they do through real twilight.
   */
  setVisibility(pointValue: number, extendedValue: number): void {
    const point = Math.min(1, Math.max(0, pointValue));
    const extended = Math.min(1, Math.max(0, extendedValue));
    this.pointsMaterial.uniforms.uIntensity.value = point;
    this.glowMaterial.uniforms.uIntensity.value = extended;
    if (this.nebulaMaterial) this.nebulaMaterial.uniforms.uIntensity.value = extended;
    this.points.visible = point > SKY_POINT_VISIBILITY_FLOOR;
    this.glow.visible = extended > SKY_EXTENDED_VISIBILITY_FLOOR;
    if (this.nebulaDome) {
      this.nebulaDome.visible = extended > SKY_EXTENDED_VISIBILITY_FLOOR;
    }
    this.group.visible =
      this.points.visible || this.glow.visible || Boolean(this.nebulaDome?.visible);
  }

  dispose(): void {
    // Materials do not own/dispose their texture uniforms in Three.
    // Release only maps created here, never a borrowed air/light input.
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedTextures.length = 0;
    this.atlasTexture = null;
    this.spriteTexture = null;
    this.group.traverse((obj) => {
      if (obj instanceof Points || obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
    this.group.clear();
  }
}
