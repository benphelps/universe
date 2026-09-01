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
  Points,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector4,
} from 'three';
import { rotateToScene } from '../../universe/galaxy/orientation';
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
} from '../../universe/galaxy/skyfield';

const MAX_NEBULAE = NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS;
const MAX_DARK = DARK_ATLAS_COLS * DARK_ATLAS_ROWS;

const NEBULA_FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform sampler2D uNebulaAtlas;
uniform vec4 uNebulaA[${MAX_NEBULAE}]; // dir.xyz, tangent half-extent
uniform vec4 uNebulaB[${MAX_NEBULAE}]; // right.xyz, brightness
uniform vec4 uNebulaC[${MAX_NEBULAE}]; // up.xyz, tile index
uniform int uNebulaCount;
uniform float uIntensity;

void main() {
  vec3 dir = normalize(vDir);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_NEBULAE}; i++) {
    if (i >= uNebulaCount) break;
    vec4 a = uNebulaA[i];
    float cosD = dot(dir, a.xyz);
    if (cosD < 0.2) continue;
    // Project onto the sprite's tangent plane (matches the ray-march).
    vec3 rel = dir / cosD - a.xyz;
    float u = dot(rel, uNebulaB[i].xyz) / a.w * 0.5 + 0.5;
    float v = dot(rel, uNebulaC[i].xyz) / a.w * 0.5 + 0.5;
    if (u <= 0.0 || u >= 1.0 || v <= 0.0 || v >= 1.0) continue;
    float tile = uNebulaC[i].w;
    vec2 tileOrigin = vec2(mod(tile, ${NEBULA_ATLAS_COLS}.0), floor(tile / ${NEBULA_ATLAS_COLS}.0));
    vec2 uv = (tileOrigin + vec2(u, v)) / vec2(${NEBULA_ATLAS_COLS}.0, ${NEBULA_ATLAS_ROWS}.0);
    sum += texture2D(uNebulaAtlas, uv).rgb * uNebulaB[i].w;
  }
  gl_FragColor = vec4(sum * uIntensity, 1.0);
}
`;

const POINTS_VERTEX = /* glsl */ `
attribute vec3 starColor;
attribute float brightness;

uniform float uIntensity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  // Photometric mapping: size and energy follow log irradiance,
  // compressed so only the very nearest stars blaze.
  float logE = log2(max(brightness, 1e-12));
  float size = clamp(1.5 + 0.45 * (logE + 17.0), 1.0, 6.5);
  float energy = clamp(0.055 * exp2(0.36 * (logE + 17.0)), 0.012, 1.7) * uIntensity;
  vColor = starColor * energy;
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mvPosition;
  // This sphere supplies direction only. Put unresolved starlight at the
  // reversed-Z far floor so every real body occludes it by depth, even if
  // a later material or render-queue change reorders the draw calls.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

const POINTS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float falloff = 1.0 - smoothstep(0.25, 1.0, length(c));
  gl_FragColor = vec4(vColor * falloff * vAlpha, 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // The dome is angular data, not a foreground shell. Pin it just inside
  // the reversed-Z far plane so planets and terrain always win the depth
  // test instead of relying solely on negative renderOrder.
  gl_Position.z = 1e-24 * gl_Position.w;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vDir;

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
  gl_FragColor = vec4(textureBicubic(uGlow, uv, uGlowSize).rgb * transmission * uIntensity, 1.0);
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
  riftData: Float32Array;
  sceneFromGalaxy: Float32Array;
  starCount: number;
  starDirs: Float32Array;
  starColors: Float32Array;
  starBrightness: Float32Array;
}

export class StarfieldBackdrop {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  /** Which cloud each nebula sprite stands for, and the uniform
   *  carrying its brightness — so a sprite can stand down when the
   *  cloud it stands for is drawn as the volume it really is. */
  private nebulaSeeds: bigint[] = [];
  private nebulaBrightness: Vector4[] = [];

  /** Match the galaxy layers' draw cutoff: below this the contribution
   * is visually nil, but the two full-screen domes are still expensive. */
  private static readonly VISIBILITY_FLOOR = 0.002;

  /** skipStars omits the first N sky entries (a 3D view of the near field). */
  constructor(sky: BackdropSource, radius: number, skipStars = 0) {
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

    // The whole backdrop draws in the opaque queue (transparent: false)
    // at negative renderOrder and is also pinned to the far-depth floor.
    // Render order makes the sky cheap; depth makes occlusion invariant.
    const pointsMaterial = new ShaderMaterial({
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      uniforms: { uIntensity: { value: 1 } },
      blending: AdditiveBlending,
      transparent: false,
      depthWrite: false,
    });
    this.materials.push(pointsMaterial);
    const points = new Points(geometry, pointsMaterial);
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
      },
      blending: AdditiveBlending,
      transparent: false,
      depthWrite: false,
      side: BackSide,
    });
    this.materials.push(glowMaterial);
    const dome = new Mesh(new SphereGeometry(radius * 1.01, 48, 24), glowMaterial);
    dome.frustumCulled = false;
    dome.renderOrder = -3;
    this.group.add(dome);

    if (sky.nebulae.length > 0) {
      const patches = sky.nebulae.slice(0, MAX_NEBULAE);
      const nebulaA = Array.from({ length: MAX_NEBULAE }, (_, i) => {
        const patch = patches[i];
        return patch ? toScene(patch.dir, patch.angularRadius * 1.6) : new Vector4(0, 1, 0, 1);
      });
      const nebulaB = Array.from({ length: MAX_NEBULAE }, (_, i) => {
        const patch = patches[i];
        return patch ? toScene(patch.right, patch.brightness) : new Vector4(1, 0, 0, 0);
      });
      const nebulaC = Array.from({ length: MAX_NEBULAE }, (_, i) => {
        const patch = patches[i];
        return patch ? toScene(patch.up, patch.tile) : new Vector4(0, 0, 1, 0);
      });
      const atlas = new DataTexture(
        sky.nebulaAtlas,
        NEBULA_ATLAS_COLS * NEBULA_TILE,
        NEBULA_ATLAS_ROWS * NEBULA_TILE,
        RGBAFormat,
        FloatType,
      );
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
          uNebulaA: { value: nebulaA },
          uNebulaB: { value: nebulaB },
          uNebulaC: { value: nebulaC },
          uNebulaCount: { value: patches.length },
          uIntensity: { value: 1 },
        },
        blending: AdditiveBlending,
        transparent: false,
        depthWrite: false,
        side: BackSide,
      });
      this.materials.push(nebulaMaterial);
      this.nebulaSeeds = patches.map((patch) => patch.seed);
      this.nebulaBrightness = nebulaB;
      const nebulaDome = new Mesh(new SphereGeometry(radius * 1.02, 48, 24), nebulaMaterial);
      nebulaDome.frustumCulled = false;
      nebulaDome.renderOrder = -3;
      this.group.add(nebulaDome);
    }
  }

  /** 1 = full night sky; approaches 0 under bright daylight. */
  /** Silence the sprite for one cloud: its volume has taken over. */
  suppressNebula(seed: bigint): void {
    const index = this.nebulaSeeds.indexOf(seed);
    if (index >= 0) this.nebulaBrightness[index].w = 0;
  }

  set intensity(value: number) {
    for (const material of this.materials) material.uniforms.uIntensity.value = value;
    this.group.visible = value > StarfieldBackdrop.VISIBILITY_FLOOR;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Points || obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}
