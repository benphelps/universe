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
  Mesh,
  Points,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector4,
} from 'three';
import {
  NEBULA_ATLAS_COLS,
  NEBULA_ATLAS_ROWS,
  NEBULA_TILE,
  RIFT_HEIGHT,
  RIFT_WIDTH,
  type SkyField,
} from '../../universe/galaxy/skyfield';

const MAX_NEBULAE = NEBULA_ATLAS_COLS * NEBULA_ATLAS_ROWS;

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
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform sampler2D uGlow;
uniform sampler2D uRift;
uniform float uIntensity;

void main() {
  // Scene frame → galactic frame: scene y is the disk normal.
  float latitude = asin(clamp(vDir.y, -1.0, 1.0));
  float longitude = atan(vDir.z, vDir.x);
  vec2 uv = vec2(longitude / 6.2831853 + 0.5, latitude / 3.14159265 + 0.5);
  // Smooth starlight base times the sharp nearby-cloud transmission.
  float rift = texture2D(uRift, uv).r;
  gl_FragColor = vec4(texture2D(uGlow, uv).rgb * rift * uIntensity, 1.0);
}
`;

/**
 * The night sky as scene backdrop: the sky field's resolved stars as
 * photometric points plus the Milky Way glow dome, both at a fixed
 * radius around the camera (the viewer re-centers the group each frame).
 * uIntensity lets daylight wash the stars out.
 */
export class StarfieldBackdrop {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];

  /** skipStars omits the first N sky entries (a 3D view of the near field). */
  constructor(sky: SkyField, radius: number, skipStars = 0) {
    const count = sky.starCount - skipStars;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s = i + skipStars;
      // Galactic (x, y, z-disk) → scene (x, z, y): the band lies on the horizon.
      positions[i * 3] = sky.starDirs[s * 3] * radius;
      positions[i * 3 + 1] = sky.starDirs[s * 3 + 2] * radius;
      positions[i * 3 + 2] = sky.starDirs[s * 3 + 1] * radius;
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

    const pointsMaterial = new ShaderMaterial({
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      uniforms: { uIntensity: { value: 1 } },
      blending: AdditiveBlending,
      transparent: true,
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
    const glowMaterial = new ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      uniforms: {
        uGlow: { value: texture },
        uRift: { value: riftTexture },
        uIntensity: { value: 1 },
      },
      blending: AdditiveBlending,
      transparent: true,
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
      // Galactic (x, y, z-disk) → scene (x, z, y), like the stars.
      const toScene = (v: [number, number, number], w: number): Vector4 =>
        new Vector4(v[0], v[2], v[1], w);
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
        transparent: true,
        depthWrite: false,
        side: BackSide,
      });
      this.materials.push(nebulaMaterial);
      const nebulaDome = new Mesh(new SphereGeometry(radius * 1.02, 48, 24), nebulaMaterial);
      nebulaDome.frustumCulled = false;
      nebulaDome.renderOrder = -3;
      this.group.add(nebulaDome);
    }
  }

  /** 1 = full night sky; approaches 0 under bright daylight. */
  set intensity(value: number) {
    for (const material of this.materials) material.uniforms.uIntensity.value = value;
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
